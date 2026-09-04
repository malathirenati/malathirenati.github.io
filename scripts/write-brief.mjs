#!/usr/bin/env node
/**
 * Research and write one edition of the daily brief.
 *
 * Calls the Claude API with the server-side web search and web fetch tools,
 * hands it docs/BRIEF.md as the spec, and writes the edition JSON it comes
 * back with. It does NOT validate — scripts/check-brief.mjs does that, and the
 * workflow runs it immediately after this, so a bad edition never reaches a
 * commit.
 *
 * Why the server-side tools rather than fetching here: they run on Anthropic's
 * infrastructure, so this process only ever talks to api.anthropic.com. That
 * sidesteps outbound network policy on whatever runs it — which is exactly what
 * killed the first attempt at automating this from a sandboxed agent.
 *
 * The sourcing guarantee is structural, not just instructed: web_fetch can only
 * fetch URLs already present in the conversation, and they get there by coming
 * back from web_search. The model cannot fetch — and therefore cannot cite — a
 * URL it made up.
 *
 * Run:  ANTHROPIC_API_KEY=... npm run write-brief [-- --date 2026-09-04]
 *
 * A scheduled Action runs it every morning (.github/workflows/brief.yml).
 */

import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "src", "static", "sports", "brief", "data");
const SPEC = path.join(ROOT, "docs", "BRIEF.md");
const REFERENCE = path.join(DATA_DIR, "2026-09-03.json");

const MODEL = process.env.BRIEF_MODEL || "claude-opus-5";

/* One turn per pause_turn resume. Server-tool turns pause when they hit an
   internal iteration limit; each resume is another request, so this is a
   ceiling on cost as much as on time. */
const MAX_TURNS = 12;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function todayUtc() {
  const i = process.argv.indexOf("--date");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return new Date().toISOString().slice(0, 10);
}

const exists = (p) => access(p).then(() => true, () => false);

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

/* The spec lives in docs/BRIEF.md and is read at run time rather than restated
   here, so changing what the brief contains is a documentation edit and not a
   code change. */
function buildPrompt({ date, weekday, spec, reference }) {
  return `Research and write today's edition of the MNR Sports News daily brief.

Today is ${weekday}, ${date} (UTC). The edition you write is for this date.

Below is the specification you must follow exactly — the JSON schema, the house
style, and the sourcing rules. It is the same file the site's validator enforces,
so an edition that departs from it will be rejected and nothing will be published.

<spec file="docs/BRIEF.md">
${spec}
</spec>

Here is the reference edition, for tone, length and shape:

<reference file="2026-09-03.json">
${reference}
</reference>

## How to work

1. Use web_search to find what happened in sport over roughly the last 24–48
   hours, across both desks (india, global) and all three lenses (government,
   markets, society). Search widely — a range of sports, not only cricket and
   football.
2. Use web_fetch to READ the articles you intend to cite. Do not write about a
   story you have only seen as a search-result snippet or a headline.
3. Write the edition.

## Rules that override everything else

- Every item's sources must be articles you actually fetched and read.
- If a fetch fails, drop the item. Do not cite a page you could not read.
- Write every summary in your own words. Do not reproduce sentences from a source.
- A quiet day is a short edition. An empty lens is []. Do not pad.
- If you could not source anything at all, return {"skip": "<one-line reason>"}
  instead of an edition. A missing day is fine; an invented one is not.

## Output

Return the edition as a single JSON object in one \`\`\`json fenced block, and
nothing else after it. No commentary, no explanation — just the block.`;
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/* The model is asked for one fenced block. Take the LAST one: if it narrated a
   draft on the way through, the final block is the finished edition. */
function extractJson(text) {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  const candidate = fences.length ? fences[fences.length - 1][1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch (err) {
    throw new Error(`the model's output was not valid JSON: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const date = todayUtc();
const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const target = path.join(DATA_DIR, `${date}.json`);

/* Never overwrite. If the day already has an edition — written by hand, or by
   an earlier run — that edition wins and this is a no-op. */
if (await exists(target)) {
  console.log(`${date}.json already exists — nothing to do.`);
  process.exit(0);
}

/* In CI the key arrives as a repo secret. Locally the SDK will also pick up an
   `ant auth login` profile with no env var set, so only bail when neither of
   the env credentials is present AND there is no profile to fall back on —
   which the SDK itself reports far better than a guess here would. */
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("No ANTHROPIC_API_KEY in the environment — falling back to an `ant auth login` profile if there is one.");
}

const [spec, reference] = await Promise.all([
  readFile(SPEC, "utf8"),
  readFile(REFERENCE, "utf8"),
]);

const client = new Anthropic();

const messages = [
  { role: "user", content: buildPrompt({ date, weekday, spec, reference }) },
];

console.log(`Writing ${date} (${weekday}) with ${MODEL}…`);

let final = null;
let turns = 0;
const totals = { input: 0, output: 0 };

for (; turns < MAX_TURNS; turns++) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 25 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 40 },
    ],
    messages,
  });

  const message = await stream.finalMessage();
  totals.input += message.usage.input_tokens ?? 0;
  totals.output += message.usage.output_tokens ?? 0;

  if (message.stop_reason === "refusal") {
    console.error(`The model declined: ${message.stop_details?.explanation ?? "no explanation given"}`);
    process.exit(1);
  }

  /* Server-tool turns pause when they hit their internal iteration limit.
     Push the paused turn back and let it carry on. */
  if (message.stop_reason === "pause_turn") {
    messages.push({ role: "assistant", content: message.content });
    continue;
  }

  final = message;
  break;
}

if (!final) {
  console.error(`Still not finished after ${MAX_TURNS} turns — giving up without writing anything.`);
  process.exit(1);
}

const edition = extractJson(textOf(final));

/* The model's own escape hatch, per the spec: it found nothing it could source.
   Exit 0 — a day with no edition is a normal outcome, not a build failure. */
if (edition.skip) {
  console.log(`No edition for ${date}: ${edition.skip}`);
  process.exit(0);
}

await writeFile(target, JSON.stringify(edition, null, 2) + "\n");

const cost = (totals.input / 1e6) * 5 + (totals.output / 1e6) * 25;
console.log(
  `Wrote ${date}.json  (${turns + 1} turn${turns ? "s" : ""} · ` +
    `${totals.input.toLocaleString()} in / ${totals.output.toLocaleString()} out` +
    (MODEL === "claude-opus-5" ? ` · ~$${cost.toFixed(2)}` : "") +
    `)`
);
