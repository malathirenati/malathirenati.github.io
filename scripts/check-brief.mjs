#!/usr/bin/env node
/**
 * Daily brief editions -> data/index.json, and a gate on their shape.
 *
 * The brief at src/static/sports/brief/ is a static page that reads its own
 * data at runtime: data/index.json for the list of dates, then
 * data/<date>.json for the edition. index.json is DERIVED from the edition
 * files present — like src/_data/*.json, it is generated and gitignored, so
 * adding tomorrow's brief means writing one file and nothing else.
 *
 * Everything here is validation the page cannot do for itself. The page fetches
 * its data after loading, so a malformed edition is not a build error — it is a
 * blank column in the reader's browser. This runs in the build instead, which
 * means a bad edition fails CI before it is ever served.
 *
 * The strictness is deliberate: editions are written by a scheduled agent
 * (.github/workflows/brief.yml), and an unattended writer needs a hard schema
 * to fail against rather than a page that quietly renders half of one.
 *
 * Run:  npm run brief          rewrite index.json
 *       npm run brief -- --check   verify only, touch nothing (CI)
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "src", "static", "sports", "brief", "data");
const INDEX = path.join(DATA_DIR, "index.json");
const CHECK_ONLY = process.argv.includes("--check");

/* Must match LENSES and REGION_LABEL in the page's inline script. A lens the
   page does not know about renders as nothing at all. */
const REGIONS = ["india", "global"];
const LENSES = ["government", "markets", "society"];
const FORMATS = ["Blog", "Op-ed", "Podcast", "Newsletter", "Talk"];

const EDITION_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

class BriefError extends Error {}

const fail = (where, msg) => {
  throw new BriefError(`${where}: ${msg}`);
};

/* ------------------------------------------------------------------ *
 * Field checks
 * ------------------------------------------------------------------ */

function str(obj, key, where, { min = 1, max = 2000 } = {}) {
  const v = obj[key];
  if (typeof v !== "string") fail(where, `"${key}" must be a string, got ${typeof v}`);
  const t = v.trim();
  if (t.length < min) fail(where, `"${key}" is empty`);
  if (t.length > max) fail(where, `"${key}" is ${t.length} chars, over the ${max} limit`);
  return t;
}

/* Sources are the load-bearing part of the brief: every claim carries a link a
   reader can follow. A source without a working-shaped URL is worse than no
   source, because it reads as verified when it is not. */
function checkSource(src, where) {
  if (typeof src !== "object" || src === null) fail(where, "source must be an object");
  str(src, "name", where, { max: 120 });
  const url = str(src, "url", where);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(where, `"${url}" is not a URL`);
  }
  if (parsed.protocol !== "https:") fail(where, `source URL must be https, got ${parsed.protocol}//`);
  if (!parsed.hostname.includes(".")) fail(where, `"${parsed.hostname}" is not a real host`);
  /* An agent that cannot find a source has to say so, not point at a search
     page or the publication's front door and call it a citation. */
  if (parsed.pathname === "/" || parsed.pathname === "") {
    fail(where, `source URL is a bare homepage (${url}) — link the article itself`);
  }
}

function checkItem(item, where, seenIds) {
  if (typeof item !== "object" || item === null) fail(where, "item must be an object");
  const id = str(item, "id", where, { max: 60 });
  if (seenIds.has(id)) fail(where, `duplicate id "${id}"`);
  seenIds.add(id);

  str(item, "title", where, { max: 200 });
  str(item, "summary", where, { min: 40 });

  const sources = item.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    fail(where, `"sources" must be a non-empty array — every item needs a citation`);
  }
  sources.forEach((s, i) => checkSource(s, `${where}.sources[${i}]`));
}

function checkOpportunity(opp, where, seenIds) {
  if (typeof opp !== "object" || opp === null) fail(where, "opportunity must be an object");
  const id = str(opp, "id", where, { max: 60 });
  if (seenIds.has(id)) fail(where, `duplicate id "${id}"`);
  seenIds.add(id);

  const format = str(opp, "format", where, { max: 40 });
  if (!FORMATS.includes(format)) {
    fail(where, `format "${format}" is not one of ${FORMATS.join(", ")}`);
  }
  str(opp, "title", where, { max: 200 });
  str(opp, "summary", where, { min: 40 });
}

/* ------------------------------------------------------------------ *
 * Edition
 * ------------------------------------------------------------------ */

function checkEdition(edition, filename) {
  const where = filename;
  const dateFromName = filename.match(EDITION_RE)[1];

  const date = str(edition, "date", where);
  if (date !== dateFromName) {
    fail(where, `"date" is ${date} but the file is named ${dateFromName}`);
  }

  /* Parsed as UTC, and compared against a UTC weekday. The page prints the two
     side by side, so a mismatch is visible to the reader as a wrong day. */
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) fail(where, `"${date}" is not a real date`);
  const expected = WEEKDAYS[d.getUTCDay()];
  const weekday = str(edition, "weekday", where);
  if (weekday !== expected) {
    fail(where, `${date} is a ${expected}, not a ${weekday}`);
  }

  const regions = edition.regions;
  if (typeof regions !== "object" || regions === null) fail(where, `"regions" must be an object`);

  const seenIds = new Set();
  let itemCount = 0;

  for (const region of REGIONS) {
    const lenses = regions[region];
    if (typeof lenses !== "object" || lenses === null) {
      fail(where, `regions.${region} is missing — both desks must be present, even if a lens is empty`);
    }
    for (const lens of LENSES) {
      const items = lenses[lens];
      if (!Array.isArray(items)) {
        fail(where, `regions.${region}.${lens} must be an array (use [] for a quiet day)`);
      }
      items.forEach((item, i) => {
        checkItem(item, `${where} regions.${region}.${lens}[${i}]`, seenIds);
        itemCount += 1;
      });
    }
    for (const key of Object.keys(lenses)) {
      if (!LENSES.includes(key)) fail(where, `regions.${region}.${key} is not a lens the page renders`);
    }
  }

  for (const key of Object.keys(regions)) {
    if (!REGIONS.includes(key)) fail(where, `regions.${key} is not a desk the page renders`);
  }

  /* A wholly empty edition means the writer found nothing and published anyway.
     Better to fail and skip the day than to serve an empty page. */
  if (itemCount === 0) fail(where, "no items in any desk — an edition with nothing in it should not be published");

  const opportunities = edition.opportunities;
  if (!Array.isArray(opportunities)) fail(where, `"opportunities" must be an array (use [] if none)`);
  opportunities.forEach((o, i) => checkOpportunity(o, `${where} opportunities[${i}]`, seenIds));

  return { itemCount, oppCount: opportunities.length };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const files = (await readdir(DATA_DIR)).filter((f) => EDITION_RE.test(f)).sort();

if (files.length === 0) {
  console.error("No editions in src/static/sports/brief/data/ — nothing to index.");
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  let edition;
  try {
    edition = JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"));
  } catch (err) {
    console.error(`  ${file}  INVALID JSON: ${err.message}`);
    failures += 1;
    continue;
  }
  try {
    const { itemCount, oppCount } = checkEdition(edition, file);
    console.log(`  ${file}  ${itemCount} items · ${oppCount} opportunities`);
  } catch (err) {
    if (!(err instanceof BriefError)) throw err;
    console.error(`  ${err.message}`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\n${failures} edition${failures === 1 ? "" : "s"} rejected. index.json not written.`);
  process.exit(1);
}

const dates = files.map((f) => f.match(EDITION_RE)[1]);
const next = JSON.stringify({ dates }, null, 2) + "\n";
const current = await readFile(INDEX, "utf8").catch(() => null);

if (CHECK_ONLY) {
  if (current !== next) {
    console.error("\nindex.json is out of date. Run: npm run brief");
    process.exit(1);
  }
  console.log(`\n${dates.length} edition${dates.length === 1 ? "" : "s"} · index.json up to date`);
} else {
  if (current !== next) await writeFile(INDEX, next);
  console.log(`\n${dates.length} edition${dates.length === 1 ? "" : "s"} -> data/index.json  (latest ${dates[dates.length - 1]})`);
}
