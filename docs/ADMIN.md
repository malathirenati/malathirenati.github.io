# Admin guide

Everything you need to run this site. Written to be read out of order — find
your task in the contents and go straight there.

**The one rule worth remembering:** `data/timeline.csv` is the source of truth.
The website is built from it. If the CSV is right, the site is right.

---

## Contents

1. [The five-minute version](#the-five-minute-version)
2. [Approving a submission](#approving-a-submission)
3. [Adding an event yourself](#adding-an-event-yourself)
4. [Editing an event](#editing-an-event)
5. [Deleting an event](#deleting-an-event)
6. [Sources and the "unverified" marker](#sources-and-the-unverified-marker)
7. [Adding a track](#adding-a-track)
8. [Adding or changing a group](#adding-or-changing-a-group)
9. [Deleting a track or group](#deleting-a-track-or-group)
10. [Articles, newsletters and the feeds](#articles-newsletters-and-the-feeds)
11. [Changing how the site looks](#changing-how-the-site-looks)
12. [When something breaks](#when-something-breaks)
13. [Undoing a mistake](#undoing-a-mistake)
14. [Access, and why there are no secrets](#access-and-why-there-are-no-secrets)
15. [Setup — what is done, and the one thing left](#setup--what-is-done-and-the-one-thing-left)
16. [Routine maintenance](#routine-maintenance)
17. [The daily brief](#the-daily-brief) — daily steps in [BRIEF-DAILY.md](BRIEF-DAILY.md)

---

## The five-minute version

| I want to… | Do this |
|---|---|
| Publish someone's suggestion | Add the `approved` label to their issue. Done. |
| See what's waiting | [Open submissions](https://github.com/malathirenati/malathirenati.github.io/issues?q=is:open+label:submission) |
| Add an event | Edit `data/timeline.csv` on GitHub, commit |
| Fix a typo | Same — edit the cell, commit |
| Delete an event | Delete its row, commit |
| Change the site name or menu | Edit `src/_data/site.json`, commit |
| Undo anything | Revert the commit |

Every commit to `main` rebuilds and republishes the site automatically. There is
no separate "deploy" step and nothing to remember.

Give it a couple of minutes, then hard-refresh the page (**Cmd/Ctrl + Shift + R**)
if you still see the old version.

---

## Approving a submission

Suggestions arrive as **GitHub issues**. That is the whole system — there is no
separate inbox, no form service, and nothing to log into but GitHub.

### Where they appear

**https://github.com/malathirenati/malathirenati.github.io/issues?q=is:open+label:submission**

GitHub emails you when one arrives (you're watching your own repository by
default). If you'd rather have them somewhere else, Settings → Notifications.

### The link to share

This is what `/sports/submit/` points at, and what you can paste anywhere:

```
https://github.com/malathirenati/malathirenati.github.io/issues/new?template=timeline-entry.yml
```

It opens a structured form — one box per timeline column — rather than a blank
issue. Submitters need a free GitHub account.

### Reviewing one

1. **Read it.** Does the date look right? Does the source actually support the
   claim? Is the source the body that holds the record, or an encyclopedia?
2. **Decide:**
   - **Publish** — add the **`approved`** label. That is the entire action.
   - **Reject** — close the issue. A one-line comment saying why is kind.
   - **Fix first** — edit the issue body with the pencil icon, correct the field,
     *then* add `approved`.

> **Always edit before labelling.** The robot publishes what the issue says at
> the moment the label goes on. Labelling first and editing after publishes the
> old version.

### What happens when you label it

Automatically, in about a minute:

1. The entry is validated — same code the site build uses, so anything that
   passes here is guaranteed to build.
2. A row is appended to `data/timeline.csv` and committed.
3. The site rebuilds and redeploys.
4. The issue gets a confirming comment, a `published` label, and is closed.

You do nothing else. Watch it happen under the **Actions** tab if you like.

### If it says it couldn't publish

The robot removes the `approved` label and comments with a link to the log. The
usual cause is a date it can't read. Fix the issue body, add `approved` again.
Nothing was committed, so there is nothing to clean up.

### If it says "NEW TRACK"

The entry named a track that didn't exist, so one was created and given the next
free shape in its group. That works — but if you care which colour and shape it
gets, see [Adding a track](#adding-a-track).

### Submitting your own entries

Two routes, both ending in the same review:

- **The browser editor.** Open `/sports/timeline/?edit`, add the event, then
  press **Submit for publishing**. It opens a pre-filled issue. Label it
  `approved` and it publishes.
- **Straight to the spreadsheet.** For your own entries you can skip the queue
  entirely and edit `data/timeline.csv` — see the next section.

## Adding an event yourself

Three ways. Use whichever suits where you are.

### On GitHub (easiest, works from a phone)

1. Go to `data/timeline.csv` in the repository.
2. Click the pencil icon.
3. Add a line at the bottom, following the pattern of the lines above.
4. **Commit changes**.

The columns, in order:

```
Category,Group,Event,Start,End,Detail,Location,Link,Highlight
```

A worked example:

```
Olympic Games,Sport,Brisbane Games,2032,,Scheduled for Brisbane.,Brisbane,https://en.wikipedia.org/wiki/2032_Summer_Olympics,
```

Leave a field empty by putting nothing between the commas. **If any value
contains a comma, wrap the whole value in double quotes:**

```
Olympic Games,Sport,Some event,1896,,"Held in Athens, Greece.",Athens,,
```

### In the browser editor

Open the timeline with `?edit` on the end of the address:

```
https://malathirenati.github.io/sports/timeline/?edit
```

You get an editor bar and an **Edit** button on every row of the table. Add,
change and delete freely — **it only affects your own browser**. When you're
happy, either:

- **Export CSV** and replace `data/timeline.csv` in the repository, or
- **Submit for publishing**, which opens a pre-filled issue for the last entry
  you touched. Then label it `approved` like any other submission.

The editor keeps your work in the browser if you refresh, and shows *unsaved
local changes* until you export or discard. Nothing you do there is public until
you commit or approve.

### In a spreadsheet program

Open `data/timeline.csv` in Excel, Numbers or Google Sheets, edit it, and save it
back **as CSV** (not .xlsx). Upload it to GitHub to replace the file.

> If you save as `.xlsx`, the build will still read it — but approved submissions
> get written to the CSV, so a stray `.xlsx` would sit there being ignored while
> you wonder why new entries aren't appearing. The build warns you if both exist.
> Keep it to CSV.

### Dates it understands

| You write | Meaning |
|---|---|
| `1896` | A year |
| `1948-07` | A month |
| `1948-07-29` or `29/07/1948` | A day |
| `July 1948` | A month |
| `776 BC` or `776 BCE` | Before Christ |
| `AD 79` or `79 CE` | The first millennium |
| `c. 3000 BC` | Approximate — shown with a "c." |

Put an **End** date only for things that lasted. That draws the event as a bar
instead of a point.

**Highlight** — put `yes` to keep the event's label visible even when its lane
gets crowded. Use it sparingly; if everything is highlighted, nothing is.

---

## Editing an event

Find its row in `data/timeline.csv`, change the cell, commit. That's it.

To correct something a reader reported, the fastest route is GitHub's file
search: press `t` in the repository and type the event name.

---

## Deleting an event

Delete its whole line from `data/timeline.csv` and commit.

Nothing else references events, so there's nothing to tidy up afterwards. If the
event was the only one on its track, the track disappears too — which is usually
what you want.

---

## Sources and the "unverified" marker

**Link the body that holds the record.** The IOC for Olympic results, the RBI for
Indian monetary policy, India Code for statute, the Election Commission for
elections, the Smithsonian's Global Volcanism Program for eruptions. An
encyclopedia is a fallback, never a first choice.

When no authoritative source is available, use the best you can find and put
`yes` in the **`Verify`** column. The event then shows *Source not yet verified*
in its tooltip and an `unverified` marker in the table — so a reader is never
handed a link that looks settled when it isn't.

### Clearing a flag

This is ordinary editorial work, and a good task to chip away at:

1. Find the entry in `data/timeline.csv` — the flagged ones have `yes` in the
   last column.
2. Track down the primary source.
3. Replace the `Link`, empty the `Verify` cell, commit.

To see what's outstanding, sort the CSV by that column, or search the site's
table for "unverified".

### Why some links are flagged even though they work

Three different situations all produce a flag, and they need different fixes:

| Situation | What to do |
|---|---|
| Encyclopedia standing in for a primary source | Find the primary source |
| A section page rather than the exact record — e.g. Commonwealth Sport's Games index rather than a page for the 1954 Games | Find the per-event page, if one exists |
| A site that blocks automated checking, so it couldn't be confirmed | Open it yourself; if it's right, clear the flag |

Some known cases in the starting data: the Commonwealth Games Federation
rebranded to **commonwealthsport.com** and its per-Games pages no longer resolve;
the **Olympic Council of Asia** site did not respond at all when checked, so the
Asian Games entries fall back to an encyclopedia; and the Smithsonian, UNESCO,
IWM and IMF all block automated checks even though their pages are correct.

---

## Adding a track

A **track** is one lane on the timeline (*Olympic Games*, *Cold War*). Every track
belongs to a **group**.

The quick way: just start using the track name in the `Category` column of a new
event. It gets created automatically with the next free shape in its group.

To control how it looks, add a line to `data/categories.csv`:

```
Category,Group,Color,Shape
Ancient Olympics,Sport,4,circle
```

- **Color** is the group's colour slot, 1–8. **Use the same number as the other
  tracks in that group** — colour identifies the group, not the track.
- **Shape** is one of: `circle`, `diamond`, `square`, `triangle`, `hexagon`,
  `chevron`, `cross`, `star`. It must be **different from every other track in
  the same group**.

If two tracks in a group end up with the same shape, the build stops and tells
you exactly which two. It will not publish two tracks that look identical,
because a reader would have no way to tell them apart.

**Maximum 8 tracks per group** — there are only eight shapes.

---

## Adding or changing a group

A **group** is a colour: a sector like *Sport* or *World politics*.

To add one, use a new name in the `Group` column and give it an unused `Color`
number in `data/categories.csv`.

> ### Please read this before adding a fifth group
>
> The site currently has four, and that is a deliberate limit, not an accident.
>
> Four colours is the most that can be told apart reliably — including by readers
> with colour-vision deficiency, and in both light and dark mode. Every possible
> fifth colour has been measured and every one fails: two of your sectors would
> look the same to a significant number of people.
>
> **If you need a new sector, add it as a track inside an existing group.** It
> keeps its own name and its own shape on the chart; it just shares a colour.
> That's why *Volcanoes & earthquakes* sits under *Economy & environment* rather
> than in a group of its own.
>
> The numbers behind this are in `docs/DESIGN.md`.

---

## Deleting a track or group

1. Delete or reassign every event using it in `data/timeline.csv`.
2. Delete its line from `data/categories.csv`.
3. Commit.

Order doesn't matter much — but if you remove the `categories.csv` line while
events still use the track, the track survives with an automatically chosen
colour and shape, which is probably not what you meant.

---

## Articles, newsletters and the feeds

The Articles page is a second spreadsheet, `data/articles.csv`, handled exactly
like the timeline one. Some of it fills itself in.

### What updates itself, and what doesn't

| Source | How it gets on the page |
|---|---|
| Medium | Automatic, weekly |
| Project Management Simplified | Automatic, weekly |
| SportLight | Automatic, weekly |
| Deccan Herald, Indian Express, The Hindu, Hindustan Times | **By hand** |
| PMI Standards+, journal papers | **By hand** |

The three feeds update themselves because they publish RSS. No Indian newspaper
publishes a per-author feed, so there is nothing to read for those — an op-ed
has to be added the same way a timeline event is.

### Adding an article by hand

Same routine as a timeline event, on GitHub, from any device:

1. Open `data/articles.csv` in the repository.
2. Click the pencil icon.
3. Add one line at the top of the list, newest first.
4. "Commit changes".

The columns are:

```
Title,Date,Publication,Type,URL,Tags,Summary
```

- **Date** accepts everything the timeline accepts — `2026-06-23`, `2026-06`,
  `2026`, `23/06/2026`, `June 2026`. Use the full date when you know it.
- **Type** is one of `op-ed`, `blog`, `newsletter`, `journal`, `practice`,
  `explainer`, `reference`. A new value here is allowed and becomes its own
  filter chip — but check the spelling first, because `oped` and `op-ed` will
  show up as two separate chips.
- **Tags** are separated by semicolons: `sport;policy;anti-doping`. A tag used
  more than once becomes a chip; a one-off tag is still searchable.
- **Summary** is one sentence. It is allowed to be empty.

If a title, publication or summary contains a comma, wrap the whole field in
double quotes — `"India's indigenous sports: reviving culture, bridging communities"`.
The GitHub editor won't do this for you.

### What the build refuses

The page will not publish, and the Actions tab will tell you why, if:

- a row has no title, no date, or no URL
- a URL doesn't start with `http://` or `https://`
- two rows share the same URL
- a date can't be read

These are the same protections the timeline has. A rejected build leaves the
live site exactly as it was.

### The weekly sync

`.github/workflows/fetch-feeds.yml` runs every Monday. It reads the three feeds,
ignores anything whose URL is already in the file, adds the rest in date order,
and commits only if something actually changed. It never edits a row that is
already there — so if you correct a title or write a better summary for a
Medium post, your version stays.

**To pull in a post you published today** rather than waiting for Monday: open
the **Actions** tab → **Sync feeds** → **Run workflow**. It takes about a minute.

**To see what it would do without changing anything**, if you are working on the
site locally:

```bash
node scripts/fetch-feeds.mjs --dry-run
```

**If the sync fails**, the run is marked red in the Actions tab. Almost always
this is one feed being briefly unreachable; the next Monday picks up everything
missed, so there is nothing to repair. Nothing is committed on a failed run.

### Adding a newsletter

The Newsletters page is driven from `newsletters` in `src/_data/site.json`, not
from a template. A third newsletter is four lines:

```json
{
  "title": "Name of it",
  "url": "https://example.substack.com/",
  "logo": "/assets/img/its-logo.png",
  "blurb": "One sentence, in your words.",
  "cadence": "Monthly · Substack"
}
```

If it should also feed the Articles page automatically, add it to the `FEEDS`
list at the top of `scripts/fetch-feeds.mjs` as well — one line, same shape as
the three already there.

### Logos

Every logo lives in `src/assets/img/` and every filename is **lowercase**.
This matters more than it looks: your laptop treats `Logo.png` and `logo.png`
as the same file and GitHub's servers do not, so a capital letter works locally
and shows a blank space on the live site. It has already happened once here,
with the portrait.

The dark theme puts a light plate behind each logo rather than recolouring it,
so a mark with red or green in it keeps its own colours in both themes.

---

## Changing how the site looks

**`src/_data/site.json`** holds the site name, the tagline, the menu and the
repository address. Edit it on GitHub and commit.

Adding a menu item is one line:

```json
{ "text": "About", "url": "/about/" }
```

(The page has to exist — see below.)

**Adding a page:** create `src/about.njk` with this at the top:

```
---
layout: base.njk
title: About
---
```

…then write the content underneath in HTML. Add it to `nav` in `site.json`.

**Colours, spacing and type** live at the top of `src/assets/css/main.css`, as a
list of named values. Change a value there and it changes everywhere.

> Don't change the `--s1` … `--s8` values. Those are the chart colours, and they
> have been checked against colour-blindness and contrast standards as a set.
> Changing one by eye will quietly break that. `docs/DESIGN.md` explains how to
> re-check them if you really need to.

---

## When something breaks

### The site didn't update

1. Open the **Actions** tab in the repository.
2. Look at the most recent run. Green tick = published. Red cross = it failed.
3. Click a failed run and read the last red step. The message says what's wrong.

### The build failed

Almost always a date it can't read, or a missing column. The error names the
exact row:

```
timeline.csv: row 47, column "Start" — could not read "sometime in 1990" as a date.
  Accepted: 1948 · 1948-07 · 1948-07-29 · 29/07/1948 · July 1948
            776 BC · 776 BCE · AD 79 · 79 CE · c. 3000 BC
```

Row 47 counts the header as row 1. Fix that row and commit.

**The site stays up while a build is failing.** The last good version keeps
serving, so a broken commit is never an outage — just a delay.

### Other messages you might see

| Message | Means |
|---|---|
| `"X" and "Y" would both draw as a circle in colour 1` | Two tracks in one group share a shape. Change one in `categories.csv`. |
| `missing the "Event" column` | The header row got renamed or a column was deleted. |
| `end (1980) is before start (1990)` | Dates the wrong way round. |
| `note: skipped 2 row(s)` | Not an error — blank or half-filled rows were ignored. |
| `data/ has both timeline.csv and timeline.xlsx` | Delete the `.xlsx`. |

### The form says submissions aren't configured

The relay is missing its environment variables. See
[Secrets, tokens and access](#secrets-tokens-and-access).

---

## Undoing a mistake

**Everything is reversible.** Every change is a commit, and every commit can be
undone without losing anything.

1. Go to the **Commits** list in the repository.
2. Find the change you want to undo, click it.
3. **Revert** → **Create pull request** → **Merge**.

The site rebuilds with the change removed. The history is kept, so you can
always revert the revert.

To see the site as it was, open any older commit and click **Browse files**.

---

## Access, and why there are no secrets

**There is nothing to store.** No API key, no token, no password, no service
account. The whole publishing flow runs on GitHub's own permissions.

### Who can publish

Anyone with **write access to this repository**. Approving is done by labelling
an issue, so repository access *is* admin access.

Review who has it now and then: **Settings → Collaborators**.

### What the robot uses

The approve workflow runs with `GITHUB_TOKEN` — a credential GitHub creates for
that single run and destroys when it finishes. It is scoped to this repository,
you never see it, and there is nothing to rotate.

### Spam

Submissions require a GitHub account, which stops nearly all of it. If something
does get through, close the issue — nothing reaches the site without your label.

Persistent abuse: **Settings → Moderation options** lets you block a user or
limit who can interact with the repository.

### If you later want a form that needs no GitHub account

The code for it is already written and tested — `functions/api/submit.js`, a
small relay that takes a form post and opens the issue on the submitter's behalf.
It is **not in use**: GitHub Pages serves static files only and cannot run it.

Turning it on means hosting the site on Cloudflare Pages (or running that one
function as a standalone Cloudflare Worker, keeping the site where it is). Only
then do you need a token, and the file's own header comment explains exactly
which permissions it needs and which it must not have.

Until then, ignore it. It costs nothing to leave in place.

## Setup — what is done, and the one thing left

The site is live at **https://malathirenati.github.io/**, published from this
repository by GitHub Actions on every push to `main`.

| Step | Status |
|---|---|
| Repository on GitHub | done |
| GitHub Pages, Source = GitHub Actions | done |
| Deploy on every push | done |
| Submission form (GitHub issue template) | done |
| Approve-and-publish workflow | done |
| **The three labels** | **see below** |

### Create the three labels

**This is required — the workflow cannot publish without them.** Go to
**Issues → Labels → New label** and create:

| Label | Purpose | Suggested colour |
|---|---|---|
| `submission` | Applied automatically to every new suggestion | grey |
| `approved` | **The one that publishes.** You add this by hand | something loud — red or green |
| `published` | Applied automatically once it's live | blue |

Spell them exactly, in lower case. The workflow matches on the literal string
`approved`, so `Approved` will not trigger it.

### Then test it end to end

Worth doing once, so you've seen the whole loop:

1. Open the submission form and file a test entry — anything, dated 2032.
2. It appears in **Issues** with the `submission` label.
3. Add the `approved` label.
4. Watch **Actions**; in about a minute the run goes green.
5. Find it on the timeline at `/sports/timeline/`.
6. Delete the test row from `data/timeline.csv` and commit.

If step 4 fails, the issue will tell you why.

### Custom domain, if you ever want one

**Settings → Pages → Custom domain**. The build reads its path prefix from Pages
at build time, so a domain change needs no code edit. A domain is the only thing
in this entire setup that costs money.

---

## Routine maintenance

There is no server, no database and no runtime dependencies, so nothing rots on
its own. Everything below is optional and can be done whenever.

| How often | What |
|---|---|
| As they arrive | Review submissions — label or close |
| Occasionally | Clear `unverified` source flags (see [Sources](#sources-and-the-unverified-marker)) |
| Once or twice a year | `npm update` locally, check the site still builds, commit the lockfile |
| Rarely | Check **Settings → Collaborators** is still who you expect |
| Weekly, at a glance | Skim the week's brief editions — the agent writes them unattended |

Build tooling only changes when you choose to update it. If you never run
`npm update`, the site keeps building and serving exactly as it does today.

## The daily brief

`/sports/brief/` is an internal page: `noindex`, not linked from anywhere on the
public site, reachable only by its direct URL. The repository is public, so
assume anything committed to it can be read.

**There is one thing to do each morning.** A scheduled routine — "Daily Sports
Brief (9:30 IST)" at <https://claude.ai/code/routines> — researches and writes
an edition on its own at **04:00 UTC (09:30 IST)**, then stops and waits for you
to approve the push. Pushing to a public repository raises a permission prompt,
and a scheduled run has nobody to answer it.

So the daily shape is: it writes, you read the summary and approve, it publishes.
About two minutes. **[BRIEF-DAILY.md](BRIEF-DAILY.md) is the step-by-step** —
setup, the morning routine, and what to do when something is wrong.

It runs on your Claude subscription, so there is no API key and nothing to pay.
Its prompt lives in the routine's web form; the copy of record is
[brief-routine-prompt.md](brief-routine-prompt.md) — edit the routine there, and
keep that file in step.

A **Daily brief** GitHub Actions workflow in this repository does the same job
unattended, through the Claude API, with no approval step. It is **dormant** —
it no-ops unless an `ANTHROPIC_API_KEY` secret exists, and there isn't one —
because it costs roughly a dollar a day. Switching it on is described at the end
of BRIEF-DAILY.md. Disable the routine first, or both will write the same file.

**To read the editions:** <https://malathirenati.github.io/sports/brief/>

**When a morning's edition doesn't appear:** you did not approve it, the writer
found nothing it could source, or the run failed. All three are visible in the
routine's run history at <https://claude.ai/code/routines>. A missing date is
skipped by the page without complaint — there is nothing to repair.

**Read the summary before you approve.** The validator checks that every item
carries a real, fetched source and that the edition is well formed. It cannot
tell whether a summary has misread the article it cites. Your approval is the
only point where a person sees the content before it is public — which is the
main argument for keeping the approval step at all.

**To fix or withdraw an edition:** edit or delete
`src/static/sports/brief/data/<date>.json` and push. The date list regenerates
itself.

**To write one yourself,** or to change what the agent is told to write:
[docs/BRIEF.md](BRIEF.md) is the spec — the schema, the sourcing rules, and
what the build refuses.

## Working on it locally

Only if you want to preview changes before pushing.

```bash
npm install
npm run serve
```

Then open `http://localhost:8080`. It reloads as you edit.

```bash
npm run build    # build once into _site/
npm run data     # just re-read the spreadsheet, to check for errors
```

`npm run data` is the quick way to check a spreadsheet edit is valid without
waiting for a full build.

---

## Adding a book

Edit [`data/books.csv`](../data/books.csv) on GitHub and commit. The site rebuilds
itself; nothing else to do.

| Column | Required | Notes |
|---|---|---|
| `Title` | **yes** | |
| `Authors` | | `A and B`, or `A with B` for a ghostwritten memoir |
| `Year` | **yes** | `1963`, or `1963-04` — same date parser as the timeline |
| `Genre` | | Reuse an existing one where you can; a new value creates a new chip |
| `Region` | | `India` or `Global` — drives the second chip row |
| `Synopsis` | | One or two sentences. Shown in full, so keep it tight |
| `Link` | | Must start with `http`. Currently a retailer *search* URL, not a product page |
| `Verify` | | `yes` while the year or edition is unconfirmed |

Anything with a comma needs quoting: `"Cricket, caste and country"`.

**On the links.** Every seeded row points at an Amazon India search rather than a
product page, because a product URL that is guessed rather than checked either
rots or sends the reader to the wrong edition. A search always resolves. Replace
any of them with a real product or publisher link whenever you have one.

## Adding a career

Edit [`data/careers.csv`](../data/careers.csv) the same way.

| Column | Required | Notes |
|---|---|---|
| `Role` | **yes** | Must be unique — the build rejects two rows with the same role |
| `Category` | **yes** | One of the nine ecosystem groups; a new value creates a new group and chip |
| `Qualifications` | | Prose. The first sentence becomes the collapsed row's summary line |
| `Institutes` | | **Semicolon-separated** — each becomes a bullet |
| `Notes` | | Shown as "Worth knowing" |
| `Employers` | | Shown as "Who hires" |
| `Sources` | | Comma-separated domains, shown small at the foot of the row |
| `Verify` | | `yes` adds "not independently verified" beside the sources |

The original spreadsheet had a single `Notes & Sources (to verify)` column; it was
split into `Notes`, `Employers` and `Sources` during conversion so each can be
corrected on its own.

**The whole careers dataset currently carries `Verify: yes`.** It was compiled from
one spreadsheet and has not been checked against the institutes themselves. Clear
the flag row by row as you confirm each one.
