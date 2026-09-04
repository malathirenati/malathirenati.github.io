# The routine prompt

The daily brief is written by a scheduled Cowork routine — "Daily Sports Brief
(9:30 IST)" at <https://claude.ai/code/routines>. Its prompt lives in that web
form, not in this repository, so this file is the copy of record: if the routine
is ever lost or you want to change what it does, this is the text to paste back
in.

It deliberately delegates the schema and the sourcing rules to
[BRIEF.md](BRIEF.md) rather than restating them, so editing that file changes
what the brief contains without touching the routine.

---

```text
This is an unattended, scheduled daily run — nobody is present to answer
questions, so make reasonable judgment calls and proceed. Do not use
AskUserQuestion. This is a fresh session with no memory of any prior run.

Your job: write today's edition of the MNR Sports News daily brief into the
GitHub repository malathirenati/malathirenati.github.io and push it.

Do all of this in this cloud session's own container, not on the user's
machine. Their laptop may be asleep; nothing here should depend on it.

## Step 1 — get the repository

Call add_repo for malathirenati/malathirenati.github.io with access: "push".
You need write access, not read: the job ends in a push. If access cannot be
granted, stop and say so plainly — do not fall back to publishing an artifact,
emailing, or sending a zip. Then clone it and work inside the clone.

## Step 2 — check whether today is already done

Get today's date with `date -u +%F`. Every date in this task is UTC.

If src/static/sports/brief/data/<today>.json already exists, STOP. Do not
overwrite it and do not commit. Report that today's edition already existed.

## Step 3 — read the spec

Read docs/BRIEF.md in the repository. It is the specification: the exact JSON
schema, the house style, the sourcing rules, and the list of things the build
refuses. Follow it exactly — the site's validator enforces it, so an edition
that departs from it will be rejected and nothing will publish.

Then read src/static/sports/brief/data/2026-09-03.json, the reference edition,
for tone, length and shape.

## Step 4 — research

Find what happened in sport over roughly the last 24–48 hours, across two desks
(india, global) and three lenses:

- government — policy, regulation, ministry and federation actions, public
  funding, hosting bids, doping and anti-doping, courts and governance
- markets — money: sponsorship, broadcast and media rights, franchise
  valuations, league business, betting and gaming regulation, athlete labour
- society — participation, fan culture, gender and inclusion, grassroots sport,
  athlete welfare, controversies, and on-field stories carrying a wider point

Cover a range of sports, not only cricket and football. Use WebSearch to find
candidates, then WebFetch each article and READ it before writing about it.

## Step 5 — write it

Write src/static/sports/brief/data/<today>.json to the schema in docs/BRIEF.md.
House shape: 12–18 items spread across the six buckets, summaries of roughly
40–80 words, one paragraph each, no bullets. Then 5–8 "opportunities" — blog,
op-ed or podcast angles not already well covered in what you read. Those carry
no sources by design.

## Step 6 — prove it builds, then push

Run: npm ci, then npm run brief && npm run build.

Fix whatever it rejects. NEVER weaken the validator, the spec, or the schema to
make an edition pass — if an item cannot satisfy the rules, drop the item.

Then commit only the new edition file and push to main. The push deploys the
site by itself. Do not open a pull request. Do not touch index.json; it is
generated and gitignored. Do not modify any other file.

## Hard rules

These matter more than filling the page. The repository is public and the brief
attributes claims to real publications by name.

- Every source must be a page you actually fetched and read. Never write a
  summary from a search-result snippet, a headline, or an aggregator blurb.
- Never construct, guess or complete a URL. If the fetch failed, the item does
  not go in.
- Do not reproduce sentences from a source. Write every summary in your own
  words.
- A quiet day is a short edition, not an invented one. An empty lens is [].
- If you cannot source anything at all, publish nothing: make no commit, and
  say why. The page skips missing dates without complaint. A gap in the archive
  is honest; a padded edition is not.

## Do not

Earlier versions of this routine published the brief to a claude.ai artifact.
That is no longer the delivery path — the site is. Do not publish or update an
artifact.

Finish by reporting the date you published, how many items and opportunities,
and anything you deliberately left out and why.
```
