#!/usr/bin/env node
/**
 * Spreadsheet -> JSON.
 *
 * Reads the workbooks in data/ and writes plain JSON into src/_data/, which
 * Eleventy then bakes into the pages at build time. Nothing here ships to the
 * browser: readers download the JSON, never a spreadsheet parser.
 *
 * Update workflow: replace the file in data/, commit. CI reruns this.
 *
 * Run directly with:  npm run data
 */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readXlsxFile from "read-excel-file/node";
import {
  FIELD_ALIASES, FIELD_LABELS, normaliseHeader, mapHeaders,
  MIN_YEAR, MAX_YEAR, parseWhen, formatWhen,
  SheetError, parseCsv,
  slugify, SHAPES, MAX_SLOTS, assertUniqueIdentity,
} from "./lib/parse.mjs";


const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "src", "_data");

/* ------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------ */

// read-excel-file returns either a flat array of rows (single sheet) or an array
// of { sheet, data } (multi-sheet), depending on the workbook and version. Fold
// both into one shape rather than depending on which one we get.
function asSheetMap(result) {
  const map = new Map();
  if (Array.isArray(result) && result.length && result[0] && !Array.isArray(result[0]) && Array.isArray(result[0].data)) {
    for (const s of result) map.set(String(s.sheet), s.data);
  } else {
    map.set("Sheet1", result);
  }
  return map;
}

async function readSheet(file) {
  const full = path.join(DATA_DIR, file);

  // CSV is the canonical format: the approval Action appends a row to it in one
  // line of script, and a commit diff shows exactly what changed. A workbook's
  // second sheet has no CSV equivalent, so colour/shape pins live alongside in
  // categories.csv.
  if (/\.csv$/i.test(file)) {
    const rows = parseCsv(await readFile(full, "utf8"));
    const sheetMap = new Map([["Timeline", rows]]);
    const companion = path.join(DATA_DIR, "categories.csv");
    try {
      sheetMap.set("Categories", parseCsv(await readFile(companion, "utf8")));
    } catch { /* optional */ }
    return { rows, sheetMap, sheetName: null };
  }

  const sheetMap = asSheetMap(await readXlsxFile(full));
  const names = [...sheetMap.keys()];

  // Pick the data sheet by name where possible, so reordering tabs in Excel or
  // adding a scratch tab doesn't silently change what gets published.
  const preferred =
    names.find((s) => normaliseHeader(s) === "timeline") ??
    names.find((s) => normaliseHeader(s) !== "categories") ??
    names[0];

  return { rows: sheetMap.get(preferred) ?? [], sheetMap, sheetName: preferred };
}

// Optional second sheet pinning track order, group, colour slot and marker shape.
// Columns: Category | Group | Color | Shape — all but Category optional.
// Color pins the GROUP's slot (colour belongs to the group, not the track).
function readCategorySheet(sheetMap) {
  const name = sheetMap && [...sheetMap.keys()].find((s) => normaliseHeader(s) === "categories");
  if (!name) return null;

  const rows = [...(sheetMap.get(name) ?? [])];
  const header = rows.shift() || [];
  const idx = {};
  header.forEach((h, i) => { idx[normaliseHeader(h)] = i; });
  if (idx.category === undefined) return null;

  const cell = (row, i) => (i !== undefined && row[i] != null && String(row[i]).trim() !== ""
    ? String(row[i]).trim() : null);

  const out = [];
  for (const row of rows) {
    const label = cell(row, idx.category);
    if (!label) continue;
    const color = cell(row, idx.color);
    const shape = cell(row, idx.shape);
    out.push({
      name: label,
      group: cell(row, idx.group),
      colorIndex: color != null && Number.isFinite(Number(color)) ? Number(color) - 1 : null,
      shape: shape ? shape.toLowerCase() : null,
    });
  }
  return out.length ? out : null;
}

/* ------------------------------------------------------------------ *
 * Provenance — "data current as of"
 *
 * Prefer the file's last commit date: it survives a fresh CI checkout, where
 * mtime is just the moment the runner cloned the repo.
 * ------------------------------------------------------------------ */
async function lastUpdated(file) {
  try {
    const { stdout } = await execFileAsync(
      "git", ["log", "-1", "--format=%cI", "--", path.join("data", file)], { cwd: ROOT }
    );
    if (stdout.trim()) return stdout.trim();
  } catch { /* not a repo, or file never committed — fall through */ }
  try {
    return (await stat(path.join(DATA_DIR, file))).mtime.toISOString();
  } catch {
    return null;
  }
}


/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */
async function buildTimeline(file) {
  const { rows, sheetMap, sheetName } = await readSheet(file);
  const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  if (nonEmpty.length < 2) throw new SheetError(`${file}: needs a header row and at least one event row.`);

  const { map, unknown } = mapHeaders(nonEmpty[0]);
  for (const required of ["category", "title", "start"]) {
    if (map[required] === undefined) {
      throw new SheetError(
        `${file}: missing the "${FIELD_LABELS[required]}" column.\n` +
        `  Recognised headings for it: ${FIELD_ALIASES[required].join(", ")}\n` +
        `  Found instead: ${nonEmpty[0].map((h) => `"${h}"`).join(", ")}`
      );
    }
  }
  if (unknown.length) {
    console.warn(`  note: ignoring unrecognised column(s) ${unknown.map((u) => `"${u}"`).join(", ")}`);
  }

  const cell = (row, field) => {
    const i = map[field];
    if (i === undefined) return null;
    const v = row[i];
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };

  const events = [];
  const order = [];              // tracks, in order of first appearance
  const groupOf = new Map();     // track name -> group name
  const skipped = [];

  nonEmpty.slice(1).forEach((row, i) => {
    const rowNumber = i + 2; // 1-indexed, +1 for the header
    const category = cell(row, "category");
    const title = cell(row, "title");

    if (!category || !title) {
      skipped.push(`row ${rowNumber} (missing ${!category ? "category" : "event"})`);
      return;
    }

    const rawStart = map.start !== undefined ? row[map.start] : null;
    const rawEnd = map.end !== undefined ? row[map.end] : null;
    const start = parseWhen(rawStart, { field: FIELD_LABELS.start, row: rowNumber, file });
    if (!start) { skipped.push(`row ${rowNumber} (no start date)`); return; }
    const end = parseWhen(rawEnd, { field: FIELD_LABELS.end, row: rowNumber, file });

    if (end && end.position < start.position) {
      throw new SheetError(`${file}: row ${rowNumber} — end (${formatWhen(end)}) is before start (${formatWhen(start)}).`);
    }

    if (!order.includes(category)) order.push(category);

    // A track's group is taken from the first row that names one, so it only
    // has to be filled in once rather than repeated down the column.
    const rowGroup = cell(row, "group");
    if (rowGroup && !groupOf.has(category)) groupOf.set(category, rowGroup);

    const highlightRaw = (cell(row, "highlight") || "").toLowerCase();

    events.push({
      id: `${slugify(category)}-${slugify(title)}-${start.year}`,
      category,
      categorySlug: slugify(category),
      title,
      start: formatWhen(start),
      startPos: Number(start.position.toFixed(4)),
      startYear: start.year,
      end: end ? formatWhen(end) : null,
      endPos: end ? Number(end.position.toFixed(4)) : null,
      endYear: end ? end.year : null,
      span: Boolean(end),
      circa: Boolean(start.circa || (end && end.circa)),
      detail: cell(row, "detail"),
      location: cell(row, "location"),
      link: cell(row, "link"),
      highlight: ["true", "yes", "y", "1", "x", "star"].includes(highlightRaw),
      // A source that still needs checking against an authoritative record. The
      // chart says so out loud rather than implying the entry is settled.
      verify: ["true", "yes", "y", "1", "x"].includes((cell(row, "verify") || "").toLowerCase()),
    });
  });

  if (!events.length) throw new SheetError(`${file}: no usable rows found.`);
  if (skipped.length) console.warn(`  note: skipped ${skipped.length} row(s) — ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}`);

  // Explicit Categories sheet wins; otherwise order of first appearance.
  const override = readCategorySheet(sheetMap);
  const names = override
    ? [...override.map((c) => c.name).filter((n) => order.includes(n)), ...order.filter((n) => !override.some((c) => c.name === n))]
    : order;

  // The Categories sheet can also supply a track's group.
  for (const o of override ?? []) {
    if (o.group && !groupOf.has(o.name)) groupOf.set(o.name, o.group);
  }

  // No Group anywhere: every track is its own group. That reproduces the
  // one-level behaviour exactly — colour and shape both track the index.
  const grouped = groupOf.size > 0;
  const groupNameFor = (track) => (grouped ? (groupOf.get(track) ?? "Other") : track);

  const groupOrder = [];
  for (const name of names) {
    const g = groupNameFor(name);
    if (!groupOrder.includes(g)) groupOrder.push(g);
  }

  // Colour is pinned to the group. An explicit Color on any of a group's rows
  // pins it; the first one wins so the sheet can be terse.
  const pinnedColor = new Map();
  for (const o of override ?? []) {
    if (o.colorIndex == null || o.colorIndex < 0) continue;
    const g = groupNameFor(o.name);
    if (!pinnedColor.has(g)) pinnedColor.set(g, o.colorIndex % MAX_SLOTS);
    else if (pinnedColor.get(g) !== o.colorIndex % MAX_SLOTS) {
      console.warn(`  note: group "${g}" has conflicting Color values; keeping ${pinnedColor.get(g) + 1}`);
    }
  }

  const groupColor = new Map();
  groupOrder.forEach((g, i) => {
    groupColor.set(g, pinnedColor.has(g) ? pinnedColor.get(g) : i % MAX_SLOTS);
  });

  const seenInGroup = new Map();   // group -> how many tracks assigned so far
  const categories = names.map((name) => {
    const groupName = groupNameFor(name);
    const nth = seenInGroup.get(groupName) ?? 0;
    seenInGroup.set(groupName, nth + 1);
    const o = override?.find((c) => c.name === name);
    const colorIndex = groupColor.get(groupName);
    // Grouped: shape separates tracks inside a group, which all share a colour.
    // Ungrouped: every track is its own group, so shape tracks the colour slot —
    // which is the one-level behaviour, each track a distinct colour AND shape.
    const shapeIndex = grouped ? nth % MAX_SLOTS : colorIndex;
    return {
      name,
      slug: slugify(name),
      group: groupName,
      groupSlug: slugify(groupName),
      colorIndex,
      shape: o?.shape && SHAPES.includes(o.shape) ? o.shape : SHAPES[shapeIndex],
      count: events.filter((e) => e.category === name).length,
    };
  });

  if (groupOrder.length > MAX_SLOTS) {
    console.warn(
      `  note: ${groupOrder.length} groups but only ${MAX_SLOTS} colours — ` +
      `"${groupOrder[MAX_SLOTS]}" onward reuse earlier colours.`
    );
  }
  for (const [g, n] of seenInGroup) {
    if (n > MAX_SLOTS) console.warn(`  note: group "${g}" has ${n} tracks but only ${MAX_SLOTS} shapes — some repeat.`);
  }

  // Two tracks drawing identically is the one failure that cannot be worked
  // around by the reader, so it stops the build rather than shipping.
  assertUniqueIdentity(categories, file);

  const groups = groupOrder.map((name) => {
    const tracks = categories.filter((c) => c.group === name);
    return {
      name,
      slug: slugify(name),
      colorIndex: groupColor.get(name),
      tracks: tracks.map((c) => c.slug),
      count: tracks.reduce((sum, c) => sum + c.count, 0),
    };
  });

  events.forEach((ev) => {
    const cat = categories.find((c) => c.name === ev.category);
    ev.group = cat.group;
    ev.groupSlug = cat.groupSlug;
  });

  events.sort((a, b) => a.startPos - b.startPos || a.title.localeCompare(b.title));

  const positions = events.flatMap((e) => (e.endPos != null ? [e.startPos, e.endPos] : [e.startPos]));
  return {
    source: file,
    sheet: sheetName ?? null,
    updated: await lastUpdated(file),
    minYear: Math.floor(Math.min(...positions)),
    maxYear: Math.ceil(Math.max(...positions)),
    grouped,
    groups,
    categories,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * Articles
 * ------------------------------------------------------------------ */

/* Its own header map rather than the timeline's: an article has a publication
   and a URL where an event has a category and a track, and sharing one alias
   table would mean each dataset silently accepting the other's columns. Dates,
   though, go through the same parseWhen — so "2025-07-02", "Jul 2025" and
   "2025" are all accepted here exactly as they are on the timeline. */
const ARTICLE_ALIASES = {
  title:       ["title", "headline", "name"],
  date:        ["date", "published", "when", "publisheddate"],
  publication: ["publication", "outlet", "publisher", "where"],
  type:        ["type", "kind", "format"],
  url:         ["url", "link", "href", "source"],
  tags:        ["tags", "keywords", "topics", "categories"],
  summary:     ["summary", "description", "blurb", "note"],
};

function mapArticleHeaders(headerRow) {
  const map = {}, unknown = [];
  headerRow.forEach((raw, i) => {
    const key = normaliseHeader(raw);
    if (!key) return;
    const field = Object.keys(ARTICLE_ALIASES).find((f) => ARTICLE_ALIASES[f].includes(key));
    if (field === undefined) unknown.push(raw);
    else if (map[field] === undefined) map[field] = i;
  });
  return { map, unknown };
}

// datetime="" must be a valid ISO 8601 date or the attribute is meaningless to
// a screen reader or a crawler. Truncate to the precision we actually have.
function isoOf(w) {
  const pad = (n) => String(n).padStart(2, "0");
  if (!w || w.year < 1) return "";
  if (w.precision === "year") return String(w.year);
  if (w.precision === "month") return `${w.year}-${pad(w.month + 1)}`;
  return `${w.year}-${pad(w.month + 1)}-${pad(w.day)}`;
}

async function buildArticles(file) {
  const rows = parseCsv(await readFile(path.join(DATA_DIR, file), "utf8"));
  const nonEmpty = rows.filter((r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== ""));
  if (nonEmpty.length < 2) throw new SheetError(`${file}: needs a header row and at least one article row.`);

  const { map, unknown } = mapArticleHeaders(nonEmpty[0]);
  for (const required of ["title", "date", "url"]) {
    if (map[required] === undefined) {
      throw new SheetError(
        `${file}: missing the "${required}" column.\n` +
        `  Recognised headings for it: ${ARTICLE_ALIASES[required].join(", ")}\n` +
        `  Found instead: ${nonEmpty[0].map((h) => `"${h}"`).join(", ")}`
      );
    }
  }
  if (unknown.length) {
    console.warn(`  note: ignoring unrecognised column(s) ${unknown.map((u) => `"${u}"`).join(", ")}`);
  }

  const cell = (row, field) => {
    const i = map[field];
    if (i === undefined) return null;
    const v = row[i];
    if (v == null) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };

  const items = [];
  const seen = new Map();          // url -> row number, so a duplicate names both
  const tagCount = new Map();
  const typeCount = new Map();
  const pubCount = new Map();

  nonEmpty.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const title = cell(row, "title");
    const url = cell(row, "url");
    if (!title) throw new SheetError(`${file}: row ${rowNo} has no title.`);
    if (!url) throw new SheetError(`${file}: row ${rowNo} ("${title}") has no URL.`);

    /* Only http(s). A javascript: or data: URL in a CSV would become a live
       link in the page, and this file is appended to by an Action. */
    if (!/^https?:\/\//i.test(url)) {
      throw new SheetError(`${file}: row ${rowNo} ("${title}") — URL must start with http:// or https://, got "${url}".`);
    }
    if (seen.has(url)) {
      throw new SheetError(`${file}: rows ${seen.get(url)} and ${rowNo} share the URL ${url}.`);
    }
    seen.set(url, rowNo);

    const when = parseWhen(cell(row, "date"), { field: "Date", row: rowNo, file });
    if (!when) throw new SheetError(`${file}: row ${rowNo} ("${title}") has no readable date.`);

    const publication = cell(row, "publication") || "Self-published";
    const type = (cell(row, "type") || "article").toLowerCase();
    const tags = (cell(row, "tags") || "")
      .split(/[;,|]/).map((t) => t.trim()).filter(Boolean)
      .map((name) => ({ name, slug: slugify(name) }))
      // A row listing "sport; Sport" should contribute one chip, not two.
      .filter((t, j, all) => all.findIndex((o) => o.slug === t.slug) === j);

    for (const t of tags) tagCount.set(t.slug, { name: t.name, count: (tagCount.get(t.slug)?.count || 0) + 1 });
    typeCount.set(type, (typeCount.get(type) || 0) + 1);
    pubCount.set(publication, (pubCount.get(publication) || 0) + 1);

    items.push({
      title,
      url,
      publication,
      publicationSlug: slugify(publication),
      type,
      typeSlug: slugify(type),
      tags,
      // Space-joined for the filter's data-tags attribute: Nunjucks has no map
      // filter, and doing it here keeps the template to one interpolation.
      tagSlugs: tags.map((t) => t.slug).join(" "),
      summary: cell(row, "summary") || "",
      year: when.year,
      iso: isoOf(when),
      dateLabel: formatWhen(when),
      position: when.position,
      /* Precomputed so the client filter never lowercases the same string on
         every keystroke — this list only grows. */
      haystack: [title, publication, type, cell(row, "summary") || "", ...tags.map((t) => t.name)]
        .join(" ").toLowerCase(),
    });
  });

  items.sort((a, b) => b.position - a.position || a.title.localeCompare(b.title));

  // Grouped server-side so the page renders complete without JavaScript.
  const years = [];
  for (const it of items) {
    const last = years[years.length - 1];
    if (last && last.year === it.year) last.items.push(it);
    else years.push({ year: it.year, items: [it] });
  }

  const byCountThenName = (a, b) => b.count - a.count || a.name.localeCompare(b.name);

  return {
    count: items.length,
    minYear: items.length ? items[items.length - 1].year : null,
    maxYear: items.length ? items[0].year : null,
    years,
    items,
    tags: [...tagCount].map(([slug, v]) => ({ slug, name: v.name, count: v.count })).sort(byCountThenName),
    types: [...typeCount].map(([name, count]) => ({ slug: slugify(name), name, count })).sort(byCountThenName),
    publications: [...pubCount].map(([name, count]) => ({ slug: slugify(name), name, count })).sort(byCountThenName),
  };
}

/* ------------------------------------------------------------------ *
 * Careers
 * ------------------------------------------------------------------ */

const CAREER_ALIASES = {
  role:           ["role", "jobrole", "job", "title", "position"],
  category:       ["category", "ecosystemcategory", "ecosystem", "area", "sector"],
  qualifications: ["qualifications", "qualificationsrequired", "qualification", "education"],
  institutes:     ["institutes", "reputedindianuniversitiesinstitutescourses", "universities", "courses", "where"],
  notes:          ["notes", "note", "detail", "comment"],
  employers:      ["employers", "employer", "hiring"],
  sources:        ["sources", "source", "references"],
  verify:         ["verify", "unverified", "needscheck", "checksource"],
};

/* Its own alias table per dataset rather than one shared one: sharing would mean
   each dataset silently accepting the others' columns, which hides a mistake in
   a header instead of reporting it. */
function mapAliases(headerRow, aliases) {
  const map = {}, unknown = [];
  headerRow.forEach((raw, i) => {
    const key = normaliseHeader(raw);
    if (!key) return;
    const field = Object.keys(aliases).find((f) => aliases[f].includes(key));
    if (field === undefined) unknown.push(raw);
    else if (map[field] === undefined) map[field] = i;
  });
  return { map, unknown };
}

function cellReader(map) {
  return (row, field) => {
    const i = map[field];
    if (i === undefined) return null;
    const v = row[i];
    if (v == null) return null;
    const t = String(v).trim();
    return t === "" ? null : t;
  };
}

function rowsOf(text, file, what) {
  const rows = parseCsv(text).filter(
    (r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== "")
  );
  if (rows.length < 2) throw new SheetError(`${file}: needs a header row and at least one ${what} row.`);
  return rows;
}

const splitList = (v) => (v || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean);

async function buildCareers(file) {
  const rows = rowsOf(await readFile(path.join(DATA_DIR, file), "utf8"), file, "role");
  const { map, unknown } = mapAliases(rows[0], CAREER_ALIASES);
  for (const required of ["role", "category"]) {
    if (map[required] === undefined) {
      throw new SheetError(
        `${file}: missing the "${required}" column.\n` +
        `  Recognised headings for it: ${CAREER_ALIASES[required].join(", ")}\n` +
        `  Found instead: ${rows[0].map((h) => `"${h}"`).join(", ")}`
      );
    }
  }
  if (unknown.length) console.warn(`  note: ignoring unrecognised column(s) ${unknown.map((u) => `"${u}"`).join(", ")}`);

  const cell = cellReader(map);
  const items = [];
  const seen = new Map();
  const catCount = new Map();

  rows.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const role = cell(row, "role");
    const category = cell(row, "category");
    if (!role) throw new SheetError(`${file}: row ${rowNo} has no role.`);
    if (!category) throw new SheetError(`${file}: row ${rowNo} ("${role}") has no category.`);

    const key = slugify(role);
    if (seen.has(key)) throw new SheetError(`${file}: rows ${seen.get(key)} and ${rowNo} both describe "${role}".`);
    seen.set(key, rowNo);

    const institutes = splitList(cell(row, "institutes"));
    const sources = (cell(row, "sources") || "").split(",").map((t) => t.trim()).filter(Boolean);
    const qualifications = cell(row, "qualifications") || "";
    const notes = cell(row, "notes") || "";
    const employers = cell(row, "employers") || "";

    catCount.set(category, (catCount.get(category) || 0) + 1);

    items.push({
      role, slug: key,
      category, categorySlug: slugify(category),
      qualifications,
      /* The summary line of a collapsed row. Cut at a sentence end where there
         is one, so the teaser does not stop mid-clause. */
      lede: (() => {
        const stop = qualifications.indexOf(". ");
        const t = stop > 30 ? qualifications.slice(0, stop + 1) : qualifications;
        return t.length > 150 ? t.slice(0, 147).replace(/[\s,;]+$/, "") + "…" : t;
      })(),
      institutes,
      notes, employers, sources,
      verify: /^(y|yes|true|1)$/i.test(cell(row, "verify") || ""),
      haystack: [role, category, qualifications, institutes.join(" "), notes, employers]
        .join(" ").toLowerCase(),
    });
  });

  items.sort((a, b) => a.category.localeCompare(b.category) || a.role.localeCompare(b.role));

  const groups = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === it.category) last.items.push(it);
    else groups.push({ name: it.category, slug: it.categorySlug, items: [it] });
  }

  return {
    count: items.length,
    items, groups,
    categories: [...catCount].map(([name, count]) => ({ name, slug: slugify(name), count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    unverified: items.filter((i) => i.verify).length,
  };
}

/* ------------------------------------------------------------------ *
 * Books
 * ------------------------------------------------------------------ */

const BOOK_ALIASES = {
  title:    ["title", "book", "bookname", "name"],
  authors:  ["authors", "author", "by", "writer"],
  year:     ["year", "published", "yearofpublication", "publicationyear"],
  genre:    ["genre", "kind", "type", "category"],
  region:   ["region", "origin", "where", "scope"],
  synopsis: ["synopsis", "review", "summary", "blurb", "description"],
  link:     ["link", "url", "buy", "purchase", "purchaselink", "onlinepurchaselink"],
  verify:   ["verify", "unverified", "needscheck", "checksource"],
};

async function buildBooks(file) {
  const rows = rowsOf(await readFile(path.join(DATA_DIR, file), "utf8"), file, "book");
  const { map, unknown } = mapAliases(rows[0], BOOK_ALIASES);
  for (const required of ["title", "year"]) {
    if (map[required] === undefined) {
      throw new SheetError(
        `${file}: missing the "${required}" column.\n` +
        `  Recognised headings for it: ${BOOK_ALIASES[required].join(", ")}\n` +
        `  Found instead: ${rows[0].map((h) => `"${h}"`).join(", ")}`
      );
    }
  }
  if (unknown.length) console.warn(`  note: ignoring unrecognised column(s) ${unknown.map((u) => `"${u}"`).join(", ")}`);

  const cell = cellReader(map);
  const items = [];
  const seen = new Map();
  const genreCount = new Map(), regionCount = new Map();

  rows.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const title = cell(row, "title");
    if (!title) throw new SheetError(`${file}: row ${rowNo} has no title.`);

    // Same parser as the timeline, so "1963", "1963-04" and "c. 1963" all work.
    const when = parseWhen(cell(row, "year"), { field: "Year", row: rowNo, file });
    if (!when) throw new SheetError(`${file}: row ${rowNo} ("${title}") has no readable year.`);

    const authors = cell(row, "authors") || "";
    const key = slugify(`${title} ${authors}`);
    if (seen.has(key)) throw new SheetError(`${file}: rows ${seen.get(key)} and ${rowNo} are the same book ("${title}").`);
    seen.set(key, rowNo);

    /* A CSV row becomes a live link on the page, and this file is edited by
       hand — a javascript: or data: URL must not survive to the template. */
    const link = cell(row, "link");
    if (link && !/^https?:\/\//i.test(link)) {
      throw new SheetError(`${file}: row ${rowNo} ("${title}") — link must start with http:// or https://, got "${link}".`);
    }

    const genre = cell(row, "genre") || "Uncategorised";
    const region = cell(row, "region") || "Global";
    genreCount.set(genre, (genreCount.get(genre) || 0) + 1);
    regionCount.set(region, (regionCount.get(region) || 0) + 1);

    const synopsis = cell(row, "synopsis") || "";
    items.push({
      title, authors, link: link || "",
      year: when.year,
      genre, genreSlug: slugify(genre),
      region, regionSlug: slugify(region),
      synopsis,
      verify: /^(y|yes|true|1)$/i.test(cell(row, "verify") || ""),
      haystack: [title, authors, genre, region, synopsis].join(" ").toLowerCase(),
    });
  });

  items.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  // Grouped by decade: 32 books over sixty years is too many headings by year
  // and too few for a single undifferentiated list.
  const decades = [];
  for (const it of items) {
    const d = Math.floor(it.year / 10) * 10;
    const last = decades[decades.length - 1];
    if (last && last.decade === d) last.items.push(it);
    else decades.push({ decade: d, label: `${d}s`, items: [it] });
  }

  const byCountThenName = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  return {
    count: items.length,
    minYear: items.length ? items[items.length - 1].year : null,
    maxYear: items.length ? items[0].year : null,
    items, decades,
    genres: [...genreCount].map(([name, count]) => ({ name, slug: slugify(name), count })).sort(byCountThenName),
    regions: [...regionCount].map(([name, count]) => ({ name, slug: slugify(name), count })).sort(byCountThenName),
    unverified: items.filter((i) => i.verify).length,
  };
}

/* ------------------------------------------------------------------ *
 * Registry — add a dataset by adding a line here
 * ------------------------------------------------------------------ */
const DATASETS = [
  { out: "timeline",  match: /^timeline\.(xlsx|csv)$/i, build: buildTimeline },
  { out: "articles",  match: /^articles\.csv$/i,        build: buildArticles },
  { out: "careers",   match: /^careers\.csv$/i,         build: buildCareers },
  { out: "books",     match: /^books\.csv$/i,           build: buildBooks },
];

async function main() {
  let files = [];
  try {
    files = await readdir(DATA_DIR);
  } catch {
    console.error(`No data/ directory at ${DATA_DIR}`);
    process.exit(1);
  }

  let failed = false;

  for (const dataset of DATASETS) {
    /* CSV wins when both exist. The approval Action appends to the CSV, so if a
       stale .xlsx took precedence every approved submission would silently fail
       to appear — the worst kind of bug, because nothing errors. Warn loudly
       rather than quietly picking one. */
    const candidates = files.filter((f) => dataset.match.test(f))
      .sort((a, b) => (/\.csv$/i.test(b) ? 1 : 0) - (/\.csv$/i.test(a) ? 1 : 0));

    if (candidates.length > 1) {
      console.warn(
        `! data/ has both ${candidates.join(" and ")}. Using ${candidates[0]}; ` +
        `the other is ignored. Delete it to avoid confusion.`
      );
    }

    if (!candidates.length) {
      console.warn(`! no source file for "${dataset.out}" in data/ — skipping`);
      continue;
    }

    try {
      const result = await dataset.build(candidates[0]);
      await writeFile(
        path.join(OUT_DIR, `${dataset.out}.json`),
        JSON.stringify(result, null, 2) + "\n"
      );
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const detail = result.events
        ? `${plural(result.events.length, "event", "events")} · ` +
          `${plural(result.categories.length, "track", "tracks")}` +
          (result.grouped ? ` in ${plural(result.groups.length, "group", "groups")}` : "") +
          ` · ${result.minYear}-${result.maxYear}`
        : result.groups && result.categories
          ? `${plural(result.count, "role", "roles")} · ` +
            `${plural(result.categories.length, "category", "categories")}`
          : result.decades
            ? `${plural(result.count, "book", "books")} · ` +
              `${plural(result.genres.length, "genre", "genres")} · ${result.minYear}-${result.maxYear}`
            : result.items
              ? `${plural(result.count, "article", "articles")} · ` +
                `${plural(result.tags.length, "tag", "tags")} · ${result.minYear}-${result.maxYear}`
              : "ok";
      console.log(`  ${candidates[0]} -> src/_data/${dataset.out}.json  (${detail})`);
    } catch (err) {
      failed = true;
      console.error(`\nCould not read ${candidates[0]}:\n${err instanceof SheetError ? err.message : err.stack}\n`);
    }
  }

  if (failed) process.exit(1);
}

main();
