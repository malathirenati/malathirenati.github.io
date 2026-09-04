# The routine prompt

The daily brief is written by a scheduled Cowork routine — "Daily Sports Brief
(9:30 IST)" at <https://claude.ai/code/routines>. Its prompt lives in that web
form, not in this repository, so this file is the copy of record: if the routine
is ever lost, or you want to change what it does, this is the text to paste in.

**The ordering is deliberate.** Everything up to and including writing the
edition uses the public `raw.githubusercontent.com` URLs, which need no
repository access and raise no permission prompt. Only the last step — cloning
and pushing — needs your approval. So by the time the run stops and waits for
you, the work is already done and one approval finishes it. Reordering this
means approving things twice, several minutes apart.

The daily steps for you are in [BRIEF-DAILY.md](BRIEF-DAILY.md).

---

```text
This is a scheduled daily run. Work through it without asking questions — but
note that a human WILL be present to approve the permission prompt at the end,
so if a prompt appears, wait for it rather than giving up or finding another
way. Do not use AskUserQuestion. This is a fresh session with no memory of any
prior run.

Your job: write today's edition of the MNR Sports News daily brief and push it
to GitHub at malathirenati/malathirenati.github.io.

Do everything in this cloud session's own container, not on the user's machine.
Their laptop may be asleep; nothing here should depend on it.

Work in this order. Steps 1–5 need no repository access and should raise no
permission prompt; leave all of that to step 6.

## Step 1 — what day is it, and is it already done?

Get today's date with `date -u +%F`. Every date in this task is UTC.

Fetch:
https://raw.githubusercontent.com/malathirenati/malathirenati.github.io/main/src/static/sports/brief/data/<today>.json

If that returns content, today's edition already exists. STOP — do not write
one, do not push. Say it was already done.

If it 404s, carry on.

## Step 2 — read the spec

Fetch and read:
https://raw.githubusercontent.com/malathirenati/malathirenati.github.io/main/docs/BRIEF.md

That is the specification: the exact JSON schema, the house style, the sourcing
rules, and the list of things the build refuses. Follow it exactly — a validator
enforces it, so an edition that departs from it will be rejected and nothing
will publish.

Then fetch the reference edition for tone, length and shape:
https://raw.githubusercontent.com/malathirenati/malathirenati.github.io/main/src/static/sports/brief/data/2026-09-03.json

## Step 3 — research

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

Fetch only URLs that came back from a search. A URL you assembled yourself may
require a separate approval, which will stall this step — and an unread source
cannot be cited anyway.

## Step 4 — write it

Write the edition to a scratch file in this session, to the schema in BRIEF.md.
House shape: 12–18 items spread across the six buckets, summaries of roughly
40–80 words, one paragraph each, no bullets. Then 5–8 "opportunities" — blog,
op-ed or podcast angles not already well covered in what you read. Those carry
no sources by design.

## Step 5 — show your work

Before touching the repository, print a short summary: the date, how many items
per desk and lens, how many opportunities, and every source domain you cited.
This is what the human reads before approving the push.

If you could not source anything at all, say so and STOP here. Make no commit.
The page skips missing dates without complaint. A gap in the archive is honest;
a padded edition is not.

## Step 6 — publish (this is the step that needs approval)

Now, and only now:

1. Call add_repo for malathirenati/malathirenati.github.io with access: "push".
2. Clone it.
3. Copy your edition to src/static/sports/brief/data/<today>.json
4. Run: npm ci, then npm run brief && npm run build
   Fix whatever it rejects. NEVER weaken the validator, the spec, or the schema
   to make an edition pass — if an item cannot satisfy the rules, drop it.
5. Commit only that one file and push to main. The push deploys the site by
   itself. Do not open a pull request. Do not touch index.json; it is generated
   and gitignored. Do not modify any other file.

If repository access is refused, do not improvise a workaround — no artifact, no
email, no zip. Print the edition JSON in full so it can be saved by hand, and
say plainly that the push failed.

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

## Do not

Earlier versions of this routine published to a claude.ai artifact. That is no
longer the delivery path — the site is. Do not publish or update an artifact.

Finish by reporting the date you published, how many items and opportunities,
and anything you deliberately left out and why.
```
