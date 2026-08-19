#!/usr/bin/env node
/**
 * RSS -> data/articles.csv.
 *
 * Reads the feeds listed in FEEDS, drops anything whose URL is already in the
 * CSV, and merges the rest in date order. Existing rows are never rewritten,
 * so a title or summary corrected by hand stays corrected.
 *
 * Newspaper op-eds are added by hand — no Indian newspaper publishes a
 * per-author feed — so this only ever covers Medium and the two Substacks.
 *
 * Run:  node scripts/fetch-feeds.mjs [--dry-run]
 *
 * A scheduled Action runs it weekly (.github/workflows/fetch-feeds.yml) and
 * commits only when the file actually changes.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSV = path.join(ROOT, "data", "articles.csv");
const DRY = process.argv.includes("--dry-run");

const FEEDS = [
  { url: "https://medium.com/feed/@mnr500",                       publication: "Medium",                         type: "blog" },
  { url: "https://projectmanagementsimplified.substack.com/feed", publication: "Project Management Simplified",  type: "newsletter" },
  { url: "https://sportlightforindia.substack.com/feed",          publication: "SportLight",                     type: "newsletter" },
];

const HEADER = ["Title", "Date", "Publication", "Type", "URL", "Tags", "Summary"];

/* Substack seeds every new publication with an empty "Coming soon" post. It is
   not an article and there is no point carrying it. */
const IGNORE_TITLE = /^coming soon$/i;

/* ------------------------------------------------------------------ *
 * XML
 * ------------------------------------------------------------------ */

/* Enough of an RSS reader for three known feeds, and no more. A general XML
   parser would be a new dependency in a project whose whole point is not
   having any; these feeds are machine-generated and uniform. */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#\d+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (item, name) => {
  const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
};

const allTags = (item, name) =>
  [...item.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => decode(m[1]));

/* Feed dates are RFC 822 ("Wed, 18 Jun 2026 06:12:41 GMT"), which Date parses
   reliably. Everything downstream wants YYYY-MM-DD, and the CSV's own parser
   validates it again at build time. */
function isoDate(rfc822) {
  const t = new Date(rfc822);
  if (Number.isNaN(t.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/* Medium appends ?source=rss-…, Substack appends UTM parameters. Both point at
   the same article, so a URL kept with its query string would be re-added as a
   new row every time the parameter changed. */
const canonical = (u) => u.split("?")[0].split("#")[0].replace(/\/+$/, "");

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

const esc = (v) => {
  const s = v == null ? "" : String(v);
  return /["\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: {
      // Medium returns 403 to a bare fetch. This is the same request a feed
      // reader makes; it is a public feed either way.
      "user-agent": "Mozilla/5.0 (compatible; malathirenati.github.io feed sync)",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const xml = await res.text();

  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).flatMap((item) => {
    const title = tag(item, "title");
    const link = canonical(tag(item, "link"));
    const date = isoDate(tag(item, "pubDate"));
    if (!title || !link || !date) return [];
    if (IGNORE_TITLE.test(title)) return [];
    if (!/^https?:\/\//i.test(link)) return [];

    const tags = allTags(item, "category").map((t) => t.toLowerCase())
      .filter((t, i, all) => t && all.indexOf(t) === i).slice(0, 6);

    return [[
      title, date, feed.publication, feed.type, link,
      tags.join(";"),
      tag(item, "description").slice(0, 180),
    ]];
  });
}

async function main() {
  const existing = parseCsv(await readFile(CSV, "utf8"))
    .filter((r) => Array.isArray(r) && r.some((c) => c != null && String(c).trim() !== ""));

  const header = existing[0];
  const rows = existing.slice(1);

  const urlCol = header.findIndex((h) => String(h).trim().toLowerCase() === "url");
  const dateCol = header.findIndex((h) => String(h).trim().toLowerCase() === "date");
  if (urlCol < 0 || dateCol < 0) {
    console.error(`${CSV}: expected a URL and a Date column, found ${header.join(", ")}`);
    process.exit(1);
  }

  const known = new Set(rows.map((r) => canonical(String(r[urlCol] ?? "").trim())));

  const added = [];
  let failed = false;

  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      const fresh = items.filter((it) => !known.has(it[4]));
      // Guard against a feed listing the same post twice in one response.
      for (const it of fresh) {
        if (known.has(it[4])) continue;
        known.add(it[4]);
        added.push(it);
      }
      console.log(`  ${feed.publication.padEnd(30)} ${String(items.length).padStart(3)} in feed, ${fresh.length} new`);
    } catch (err) {
      /* One unreachable feed must not lose the other two, and must not let a
         scheduled run report success. */
      failed = true;
      console.error(`  ${feed.publication.padEnd(30)} FAILED: ${err.message}`);
    }
  }

  if (!added.length) {
    console.log(added.length === 0 && !failed ? "\nNothing new." : "\nNothing new (with errors above).");
    process.exit(failed ? 1 : 0);
  }

  console.log(`\n${added.length} to add:`);
  for (const a of added) console.log(`  ${a[1]}  ${a[0]}`);

  if (DRY) {
    console.log("\n--dry-run: nothing written.");
    process.exit(failed ? 1 : 0);
  }

  /* Merge into date order rather than appending. The file is already sorted, so
     inserting in place keeps the commit diff to the new lines alone. Existing
     rows are carried through untouched, hand-edits included. */
  const merged = [...rows, ...added].sort((a, b) => {
    const d = String(b[dateCol] ?? "").localeCompare(String(a[dateCol] ?? ""));
    return d || String(a[0] ?? "").localeCompare(String(b[0] ?? ""));
  });

  await writeFile(CSV, toCsv([header.length ? header : HEADER, ...merged]));
  console.log(`\nWrote data/articles.csv (${merged.length} articles).`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
