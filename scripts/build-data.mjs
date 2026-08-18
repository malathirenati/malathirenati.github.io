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
 * Registry — add a dataset by adding a line here
 * ------------------------------------------------------------------ */
const DATASETS = [
  { out: "timeline", match: /^timeline\.(xlsx|csv)$/i, build: buildTimeline },
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
