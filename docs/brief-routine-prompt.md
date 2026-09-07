# The task prompt

The daily brief is written by a **scheduled task in the Claude desktop app**,
listed under **Scheduled** in the sidebar as *Daily Sports Brief (9:30 IST)*.
This file is the copy of record for its instructions.

The live copy is at `~/.claude/scheduled-tasks/daily-sports-brief/SKILL.md`.
Edit it there, or ask Claude to update the task, and keep this file in step.

**It is not at <https://claude.ai/code/routines>,** and it cannot be. A routine
created there runs in an environment whose egress proxy blocks outbound HTTP, so
it cannot search or fetch — it could not research a brief. This task runs on
Malathi's own machine instead, where the web and the repository checkout are
both already reachable.

**The ordering is deliberate.** Everything up to and including validating the
edition touches only local files and the public web, and raises no permission
prompt. Only the last step — the push — needs approval. So by the time the run
stops and waits, the work is done and one approval finishes it.

**It runs only while the app is open.** If the app is closed at 09:30, the run
happens on next launch.

The daily steps for you are in [BRIEF-DAILY.md](BRIEF-DAILY.md).

---

```text
This is a scheduled daily run. Work through it without asking questions — but a
human WILL be present to approve the push at the end, so if a permission prompt
appears, wait for it rather than giving up or finding another way. Do not use
AskUserQuestion. This is a fresh session with no memory of any prior run.

Your job: write today's edition of the MNR Sports News daily brief and push it
to GitHub.

The repository is already checked out at /Users/malathir/malathirenati.github.io
on this machine. Work there. Do not clone anything.

Work in this order. Steps 1-6 touch only local files and the public web, and
should raise no permission prompt. Leave the push to step 7 so there is one
approval, at the end, once the work is already done.

## Step 0 — sync

    cd /Users/malathir/malathirenati.github.io && git pull --rebase

## Step 1 — what day is it, and is it already done?

Get today's date with `date -u +%F`. Every date in this task is UTC.

If src/static/sports/brief/data/<today>.json already exists, today's edition is
done. STOP — write nothing, push nothing, say it was already done.

## Step 2 — read the spec

Read docs/BRIEF.md in the repository. That is the specification: the exact JSON
schema, the house style, the sourcing rules, and the list of things the build
refuses. Follow it exactly — scripts/check-brief.mjs enforces it, and an edition
that departs from it will be rejected.

Then read the two or three most recent editions in
src/static/sports/brief/data/ for tone, length and shape — and to avoid
repeating a story they already carry.

## Step 3 — research

Find what happened in sport over roughly the last 24-48 hours, across two desks
(india, global) and three lenses:

- government — policy, regulation, ministry and federation actions, public
  funding, hosting bids, doping and anti-doping, courts and governance
- markets — money: sponsorship, broadcast and media rights, franchise
  valuations, league business, betting and gaming regulation, athlete labour
- society — participation, fan culture, gender and inclusion, grassroots sport,
  athlete welfare, controversies, and on-field stories carrying a wider point

Cover a range of sports, not only cricket and football. Use WebSearch to find
candidates, then WebFetch each article and READ it before writing about it.

Fetch only URLs that came back from a search. Never assemble a URL yourself.

## Step 4 — write it

Write the edition directly to src/static/sports/brief/data/<today>.json, to the
schema in BRIEF.md. House shape: 12-18 items spread across the six buckets,
summaries of roughly 40-80 words, one paragraph each, no bullets. Then 5-8
"opportunities" — blog, op-ed or podcast angles not already well covered in what
you read. Those carry no sources by design.

Check every source URL you are about to cite actually resolves, with curl. A
citation that does not support its own claim is worse than a missing item: make
sure each URL is the page the summary is about, not merely a page you read.

## Step 5 — validate

    npm run brief && npm run build

Fix whatever it rejects. NEVER weaken the validator, the spec, or the schema to
make an edition pass — if an item cannot satisfy the rules, drop the item.

Do not commit index.json by hand; `npm run brief` regenerates it and it is
gitignored.

## Step 6 — show your work

Print a short summary: the date, how many items per desk and lens, how many
opportunities, and every source domain you cited. This is what the human reads
before approving the push.

If you could not source anything at all, say so and STOP here. Make no commit.
The page skips missing dates without complaint. A gap in the archive is honest;
a padded edition is not.

## Step 7 — publish (this is the step that needs approval)

    git add src/static/sports/brief/data/
    git commit -m "Add the brief for <today>"
    git push

Commit only that one file. The push deploys the site by itself. Do not open a
pull request. Do not modify any other file.

If the push is refused, do not improvise a workaround. Say plainly that it
failed; the edition is already saved in the working tree and can be pushed by
hand later.

## Step 8 — say that it is live

Once the push succeeds, report the date, the number of items, and this URL:
https://malathirenati.github.io/sports/brief/

The site rebuilds itself about a minute after the push.

## Hard rules

These matter more than filling the page. The repository is public and the brief
attributes claims to real publications by name.

- Every source must be a page you actually fetched and read. Never write a
  summary from a search-result snippet, a headline, or an aggregator blurb.
- Never construct, guess or complete a URL. If the fetch failed, the item does
  not go in.
- The URL you cite must be the page the claim comes from. Do not substitute a
  different article because the real one is hard to reach — drop the item.
- Prefer established news outlets. If the only source for a story is a partisan
  opinion site or an aggregator, leave the story out.
- Do not reproduce sentences from a source. Write every summary in your own
  words.
- A quiet day is a short edition, not an invented one. An empty lens is [].

## Do not

Do NOT create an artifact. Do not call the Artifact tool at all. The delivery
path is the JSON file in the repository and nothing else. On 7 September 2026 a
run wrote the brief as an HTML artifact instead of the JSON file, and nothing
published as a result.

Do not repeat an item that already appears in a recent edition. A running story
returns only if something new has actually happened.

Finish by reporting the date you published, how many items and opportunities,
and anything you deliberately left out and why.
```
