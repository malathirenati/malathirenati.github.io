/**
 * Shared parsing and identity rules.
 *
 * Imported by scripts/build-data.mjs (the site build) AND by
 * scripts/apply-submission.mjs (the approve-and-publish Action), so a submission
 * is validated by exactly the same code that will later render it. If these ever
 * diverge, an entry can pass review and then break the build — or land in a
 * different place than the reviewer saw.
 *
 * The browser editor (src/assets/js/timeline-editor.js) mirrors the date rules
 * by hand because it cannot import from here; keep the three in step.
 */

/* ------------------------------------------------------------------ *
 * Column aliases
 *
 * Header matching is case-insensitive and ignores punctuation/spacing, so
 * "Start Year", "start_year" and "START YEAR" all land in the same place.
 * Add a synonym here rather than renaming a column in the sheet.
 * ------------------------------------------------------------------ */
const FIELD_ALIASES = {
  // "group" deliberately absent here — it names the level above a track.
  category: ["category", "type", "track", "theme", "stream"],
  group: ["group", "section", "family", "area", "band"],
  title: ["event", "title", "name", "milestone", "label", "headline"],
  start: ["start", "startyear", "year", "date", "from", "startdate", "begin"],
  end: ["end", "endyear", "to", "until", "enddate", "finish"],
  detail: ["detail", "details", "tooltip", "description", "note", "notes", "summary"],
  location: ["location", "place", "city", "country", "venue", "host"],
  link: ["link", "url", "source", "reference", "href"],
  highlight: ["highlight", "featured", "key", "important", "star"],
  // Marks a source that has not been checked against an authoritative record —
  // typically an encyclopedia standing in until a primary source is found.
  verify: ["verify", "unverified", "needscheck", "checksource", "sourcestatus"],
};

// What each field is called in the sheet, for error messages. The internal key
// and the column heading differ (title -> "Event"), and errors must name the
// heading the reader will actually go looking for.
const FIELD_LABELS = {
  category: "Category", group: "Group", title: "Event", start: "Start", end: "End",
  detail: "Detail", location: "Location", link: "Link", highlight: "Highlight",
  verify: "Verify",
};

const normaliseHeader = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function mapHeaders(headerRow) {
  const map = {};
  const unknown = [];
  headerRow.forEach((raw, index) => {
    const key = normaliseHeader(raw);
    if (!key) return;
    const field = Object.keys(FIELD_ALIASES).find((f) => FIELD_ALIASES[f].includes(key));
    if (field && !(field in map)) map[field] = index;
    else if (!field) unknown.push(String(raw));
  });
  return { map, unknown };
}

/* ------------------------------------------------------------------ *
 * Dates
 *
 * A timeline column may hold a bare year (1928), a real date, text like
 * "July 1948", or an ancient date like "776 BC" / "c. 3000 BCE" / "AD 79".
 * Everything resolves to a fractional year for positioning plus a precision
 * flag, so a bare year is never rendered as "1 January".
 *
 * Years use ASTRONOMICAL numbering internally: 0 is 1 BC, -1 is 2 BC. That
 * makes the arithmetic ordinary; BC/AD is purely a display concern, handled
 * by formatWhen().
 * ------------------------------------------------------------------ */
const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december"];

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// Proleptic Gregorian, extended backwards. Fine for a timeline: the point is a
// consistent, monotonic position, not historical calendar reconstruction.
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Deliberately does NOT use Date. `Date.UTC` maps years 0-99 onto 1900-1999
 * (Date.UTC(50, 0, 1) is 1950), which is a live trap directly beneath any
 * ancient-date feature. Plain arithmetic has no such surprise and works for
 * any year, BC included.
 */
function fractionalYear(y, m = 0, d = 1) {
  const dayOfYear = DAYS_BEFORE_MONTH[m] + (m > 1 && isLeap(y) ? 1 : 0) + d;
  return y + (dayOfYear - 1) / (isLeap(y) ? 366 : 365);
}

// Wide enough for deep prehistory without accepting obvious typos.
const MIN_YEAR = -50000;
const MAX_YEAR = 3000;

const when = (y, mo, d, precision, circa = false) => ({
  year: y, month: mo, day: d, precision, circa,
  position: fractionalYear(y, mo, d),
});
const year = (y, circa = false) => when(y, 0, 1, "year", circa);

function parseWhen(value, { field, row, file }) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear(), m = value.getUTCMonth(), d = value.getUTCDate();
    // A cell formatted as a date but only ever meant as a year shows up as 1 Jan.
    return when(y, m, d, m === 0 && d === 1 ? "year" : "day");
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const y = Math.trunc(value);
    if (y < MIN_YEAR || y > MAX_YEAR) {
      throw new SheetError(`${file}: row ${row}, column "${field}" — ${value} is not a usable year.`);
    }
    return year(y);
  }

  let text = String(value).trim();

  // "c. 3000 BC" / "circa 776 BCE" — ancient dates are usually approximate, and
  // the chart should not imply precision the source doesn't have.
  let circa = false;
  const circaMatch = text.match(/^(?:c\.?|ca\.?|circa|approx\.?|around)\s+(.*)$/i);
  if (circaMatch) { circa = true; text = circaMatch[1].trim(); }

  // Era suffixes/prefixes: 776 BC · 776 BCE · AD 79 · 79 CE.
  // BC maps to astronomical numbering, where 1 BC is year 0.
  let m = text.match(/^(\d{1,6})\s*(BC|BCE|B\.C\.|B\.C\.E\.)$/i);
  if (m) return year(1 - Number(m[1]), circa);

  m = text.match(/^(?:AD|CE|A\.D\.|C\.E\.)\s*(\d{1,4})$/i) ||
      text.match(/^(\d{1,4})\s*(?:AD|CE|A\.D\.|C\.E\.)$/i);
  if (m) return year(Number(m[1]), circa);

  m = text.match(/^(-?\d{1,6})$/);
  if (m) return year(Number(m[1]), circa);

  m = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/); // 1948-07 / 1948-07-29
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1];
    return when(y, mo, d, m[3] ? "day" : "month", circa);
  }

  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // 29/07/1948 (day first)
  if (m) return when(Number(m[3]), Number(m[2]) - 1, Number(m[1]), "day", circa);

  m = text.match(/^([A-Za-z]+)\s+(\d{4})$/); // July 1948
  if (m) {
    const mo = MONTHS.findIndex((name) => name.startsWith(m[1].toLowerCase().slice(0, 3)));
    if (mo >= 0) return when(Number(m[2]), mo, 1, "month", circa);
  }

  m = text.match(/\b(\d{4})\b/); // last resort: pull a year out of free text
  if (m) return year(Number(m[1]), circa);

  throw new SheetError(
    `${file}: row ${row}, column "${field}" — could not read "${text}" as a date.\n` +
    `  Accepted: 1948 · 1948-07 · 1948-07-29 · 29/07/1948 · July 1948\n` +
    `            776 BC · 776 BCE · AD 79 · 79 CE · c. 3000 BC`
  );
}

/**
 * Astronomical year -> what a reader expects to see.
 *   0 -> "1 BC",  -775 -> "776 BC",  79 -> "AD 79",  1896 -> "1896"
 * The AD prefix is only used for the first millennium, where a bare "79" would
 * be ambiguous; nobody needs "AD 1896".
 */
function formatYear(y) {
  if (y <= 0) return `${1 - y} BC`;
  if (y < 1000) return `AD ${y}`;
  return String(y);
}

function formatWhen(w) {
  if (!w) return "";
  const prefix = w.circa ? "c. " : "";
  const y = formatYear(w.year);
  if (w.precision === "year") return prefix + y;
  const mon = MONTHS[w.month].slice(0, 3).replace(/^./, (c) => c.toUpperCase());
  if (w.precision === "month") return `${prefix}${mon} ${y}`;
  return `${prefix}${w.day} ${mon} ${y}`;
}

class SheetError extends Error {}

/* ------------------------------------------------------------------ *
 * Readers
 * ------------------------------------------------------------------ */

// RFC 4180 CSV — quoted fields, embedded commas/newlines, doubled quotes.
// Hand-rolled so a .csv workflow needs no dependency at all.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  return rows.map((r) => r.map((c) => {
    const t = c.trim();
    return t === "" ? null : t;
  }));
}

// read-excel-file returns either a flat array of rows (single sheet) or an array
// of { sheet, data } (multi-sheet), depending on the workbook and version. Fold
const slugify = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

/* ------------------------------------------------------------------ *
 * Identity: colour x shape
 *
 * There are eight validated hues, and in any view where two marks can sit side
 * by side, colour alone separates at most four series. So identity is composite:
 *
 *   colour  ->  the GROUP     (max 8 groups)
 *   shape   ->  the TRACK within that group  (max 8 tracks per group)
 *
 * 64 unique pairs, no repeats. Shapes repeat across groups on purpose: a blue
 * circle and a green circle are different tracks, and the pair identifies them.
 * assertUniqueIdentity() below is what stops that invariant rotting.
 * ------------------------------------------------------------------ */
const SHAPES = ["circle", "diamond", "square", "triangle", "hexagon", "chevron", "cross", "star"];
const MAX_SLOTS = 8;

function assertUniqueIdentity(categories, file) {
  const seen = new Map();
  for (const c of categories) {
    const key = `${c.colorIndex}/${c.shape}`;
    if (seen.has(key)) {
      throw new SheetError(
        `${file}: "${c.name}" and "${seen.get(key)}" would both draw as a ${c.shape} ` +
        `in colour ${c.colorIndex + 1} — they'd be indistinguishable on the chart.\n` +
        `  Colour comes from the Group, shape from the track's position within it.\n` +
        `  Fix: give them different Groups, or set an explicit Shape for one of them\n` +
        `  in the Categories sheet (${SHAPES.join(", ")}).`
      );
    }
    seen.set(key, c.name);
  }
}

export {
  FIELD_ALIASES, FIELD_LABELS, normaliseHeader, mapHeaders,
  MONTHS, isLeap, fractionalYear, MIN_YEAR, MAX_YEAR,
  parseWhen, formatYear, formatWhen,
  SheetError, parseCsv,
  slugify, SHAPES, MAX_SLOTS, assertUniqueIdentity,
};
