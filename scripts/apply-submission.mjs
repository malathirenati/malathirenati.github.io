#!/usr/bin/env node
/**
 * Turn an approved submission issue into a row in data/timeline.csv.
 *
 * Run by .github/workflows/approve.yml when a maintainer adds the `approved`
 * label. Reads the issue body from stdin (or --body-file) and appends one row.
 *
 * Validation uses scripts/lib/parse.mjs — the same module the site build uses —
 * so anything that gets committed here is guaranteed to build. A submission that
 * fails validation exits non-zero with a message the workflow posts back to the
 * issue, and nothing is written.
 *
 *   node scripts/apply-submission.mjs --body-file body.md [--dry-run]
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseWhen, formatWhen, SheetError, parseCsv, slugify, normaliseHeader,
} from "./lib/parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(ROOT, "data", "timeline.csv");

/* ------------------------------------------------------------------ *
 * Issue body -> fields
 *
 * GitHub renders an Issue Form as "### Label" followed by the value, and writes
 * "_No response_" for blanks. The serverless relay in functions/api/submit.js
 * emits the identical shape, so a form submission and a GitHub-native issue
 * parse through this one path.
 * ------------------------------------------------------------------ */
function parseIssueBody(body) {
  const fields = {};
  const sections = String(body).split(/^###\s+/m).slice(1);

  for (const section of sections) {
    const nl = section.indexOf("\n");
    if (nl < 0) continue;
    const label = normaliseHeader(section.slice(0, nl));
    const value = section.slice(nl + 1).trim();
    if (!label) continue;
    if (/^_?no response_?$/i.test(value) || value === "") continue;
    fields[label] = value;
  }
  return fields;
}

const FIELD_MAP = {
  track: ["track", "category"],
  group: ["group", "sector"],
  event: ["event", "title"],
  start: ["start", "startdate", "date"],
  end: ["end", "enddate"],
  detail: ["detail", "details", "description"],
  location: ["location", "place"],
  link: ["sourcelink", "link", "source", "url"],
};

function pick(fields, key) {
  for (const alias of FIELD_MAP[key]) {
    if (fields[alias] != null) return fields[alias];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */
const MAX = { event: 200, detail: 1000, location: 120, track: 120, group: 120, link: 500 };

function clean(value, field) {
  if (value == null) return null;
  // Collapse newlines: a CSV row is one line, and a pasted multi-paragraph blob
  // would otherwise split the file.
  let v = String(value).replace(/\s*\n+\s*/g, " ").trim();
  if (!v) return null;
  if (MAX[field] && v.length > MAX[field]) {
    throw new SheetError(`"${field}" is too long (${v.length} characters, limit ${MAX[field]}).`);
  }
  return v;
}

/* parseWhen's errors name a spreadsheet row and column, which is the right
   thing on a build log and the wrong thing on an issue. Re-word them for the
   person who filled in the form. */
function readDate(raw, label) {
  if (!raw) return null;
  try {
    const w = parseWhen(raw, { field: label, row: 1, file: "submission" });
    if (!w) return null;
    return w;
  } catch (err) {
    throw new SheetError(
      `Could not read "${raw}" as a ${label} date.\n` +
      `Accepted: 1948 · 1948-07-29 · July 1948 · 776 BC · AD 79 · c. 3000 BC`
    );
  }
}

function validate(fields, { knownTracks }) {
  const track = clean(pick(fields, "track"), "track");
  const event = clean(pick(fields, "event"), "event");
  if (!track) throw new SheetError("Missing a Track.");
  if (!event) throw new SheetError("Missing an Event name.");

  const startRaw = clean(pick(fields, "start"), "start");
  if (!startRaw) throw new SheetError("Missing a Start date.");
  const start = readDate(startRaw, "start");
  if (!start) throw new SheetError(`Could not read "${startRaw}" as a start date.`);

  const endRaw = clean(pick(fields, "end"), "end");
  const end = readDate(endRaw, "end");
  if (end && end.position < start.position) {
    throw new SheetError(`End (${formatWhen(end)}) is before start (${formatWhen(start)}).`);
  }

  const link = clean(pick(fields, "link"), "link");
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) {
    throw new SheetError(`Source link must be a plain http(s) URL — got "${link}".`);
  }

  // A track the maintainer hasn't defined yet is allowed, but flagged: it will
  // land in whatever group the row names (or "Other") and pick up the next free
  // shape, which is worth knowing before it appears on the chart.
  const isNewTrack = !knownTracks.has(slugify(track));

  return {
    row: {
      Category: track,
      Group: clean(pick(fields, "group"), "group") || "",
      Event: event,
      Start: startRaw,
      End: endRaw || "",
      Detail: clean(pick(fields, "detail"), "detail") || "",
      Location: clean(pick(fields, "location"), "location") || "",
      Link: link || "",
      Highlight: "",
    },
    isNewTrack,
    display: `${formatWhen(start)}${end ? " – " + formatWhen(end) : ""}`,
  };
}

/* ------------------------------------------------------------------ *
 * CSV append
 * ------------------------------------------------------------------ */
const esc = (v) => {
  v = v == null ? "" : String(v);
  return /["\,\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

async function main() {
  const args = process.argv.slice(2);
  const bodyFileIdx = args.indexOf("--body-file");
  const dryRun = args.includes("--dry-run");

  const body = bodyFileIdx >= 0
    ? await readFile(args[bodyFileIdx + 1], "utf8")
    : await new Promise((resolve) => {
        let s = ""; process.stdin.on("data", (c) => { s += c; });
        process.stdin.on("end", () => resolve(s));
      });

  const existing = parseCsv(await readFile(CSV, "utf8"));
  const header = (existing[0] || []).map((h) => String(h ?? "").trim());
  if (!header.length) throw new SheetError("data/timeline.csv has no header row.");

  const catIdx = header.findIndex((h) => normaliseHeader(h) === "category");
  const evIdx = header.findIndex((h) => normaliseHeader(h) === "event");
  const knownTracks = new Set(
    existing.slice(1)
      .map((r) => r[catIdx])
      .filter(Boolean)
      .map((n) => slugify(String(n)))
  );

  const fields = parseIssueBody(body);
  if (!Object.keys(fields).length) {
    throw new SheetError("Could not find any '### Field' sections in the issue body.");
  }

  const { row, isNewTrack, display } = validate(fields, { knownTracks });

  // Refuse an exact duplicate rather than quietly adding a second copy.
  const duplicate = existing.slice(1).some((r) =>
    r[catIdx] && r[evIdx] &&
    slugify(String(r[catIdx])) === slugify(row.Category) &&
    slugify(String(r[evIdx])) === slugify(row.Event)
  );
  if (duplicate) {
    throw new SheetError(`"${row.Event}" already exists on the ${row.Category} track.`);
  }

  // Write in the file's own column order, so a reordered header still works.
  const line = header.map((h) => {
    const key = Object.keys(row).find((k) => normaliseHeader(k) === normaliseHeader(h));
    return esc(key ? row[key] : "");
  }).join(",");

  const summary = [
    `event=${row.Event}`,
    `track=${row.Category}`,
    `when=${display}`,
    isNewTrack ? "NEW TRACK" : null,
  ].filter(Boolean).join(" · ");

  if (dryRun) {
    console.log("would append:", line);
    console.log("summary:", summary);
    return;
  }

  let text = await readFile(CSV, "utf8");
  if (!/\r?\n$/.test(text)) text += "\r\n";
  await writeFile(CSV, text + line + "\r\n");

  console.log(`appended: ${summary}`);
  // Consumed by the workflow for the closing comment.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `new_track=${isNewTrack}\n`);
  }
}

main().catch((err) => {
  // SheetError messages are written for a human and get posted back to the
  // issue; anything else is a bug and deserves a stack trace in the log.
  console.error(err instanceof SheetError ? err.message : err.stack);
  process.exit(1);
});
