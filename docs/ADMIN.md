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
10. [Changing how the site looks](#changing-how-the-site-looks)
11. [When something breaks](#when-something-breaks)
12. [Undoing a mistake](#undoing-a-mistake)
13. [Secrets, tokens and access](#secrets-tokens-and-access)
14. [First-time setup](#first-time-setup)

---

## The five-minute version

| I want to… | Do this |
|---|---|
| Publish someone's suggestion | Add the `approved` label to their issue. Done. |
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

Suggestions arrive as GitHub issues, whether they came through the website form
or from someone with a GitHub account. They're all in one place:

**`https://github.com/<your-repo>/issues?q=is:open+label:submission`**

For each one:

1. **Read it.** Check the date looks right and the source link supports the claim.
2. **Decide.**
   - **Publish it** — add the **`approved`** label. That's the entire action.
   - **Reject it** — close the issue. A short comment saying why is kind but optional.
   - **Fix it first** — edit the issue body (the pencil icon), correct the field,
     *then* add `approved`. It publishes what the issue says at the moment you
     label it, so always edit before labelling.

When you add `approved`, a robot validates the entry, adds it to the spreadsheet,
commits it, rebuilds the site, comments to confirm, and closes the issue. You do
nothing else.

### If it says it couldn't publish

The robot removes the `approved` label and comments with a link to the log. The
usual cause is a date it can't read. Edit the issue to fix it, then add `approved`
again. Nothing was committed, so there is nothing to clean up.

### If it says "NEW TRACK"

The entry named a track that didn't exist, so one was created and given the next
free shape in its group. That's fine and it works — but if you care what colour
and shape it gets, see [Adding a track](#adding-a-track).

---

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
https://<your-site>/timeline/?edit
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

## Secrets, tokens and access

### Who can publish

Anyone with **write access to the repository**. Approving is done by labelling an
issue, so repository access *is* admin access — there is no separate password to
manage, and nothing for you to store.

Review who has access at **Settings → Collaborators** now and then.

### The submission token

The website form needs one credential: a GitHub token that lets it open issues.

It lives **only** in the hosting environment, never in the repository and never
in the website. Anyone reading the site's source cannot find it.

Create it at **GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens**:

- **Repository access:** only this repository
- **Permissions:** *Issues: Read and write*, nothing else
- **Expiry:** 90 days is sensible

> Do **not** give it *Contents: write*. It only needs to file issues. Publishing
> is done by the Action, which uses its own separate, automatic credential.

Then in **Cloudflare Pages → your project → Settings → Environment variables**:

| Name | Value |
|---|---|
| `GITHUB_TOKEN` | the token you just created |
| `GITHUB_REPO` | `owner/repository` |
| `TURNSTILE_SECRET` | *(optional — spam protection)* |

### Rotating it

Tokens expire; GitHub emails you first. To replace one: create a new token, paste
it over `GITHUB_TOKEN` in Cloudflare, redeploy, delete the old token.

If you ever think a token leaked, **delete it on GitHub immediately** — that
kills it instantly — then create a replacement. Nothing else is at risk, because
it can only open issues.

### Spam

If the form starts attracting junk, turn on Cloudflare Turnstile:

1. Cloudflare dashboard → **Turnstile** → add a site. You get two keys.
2. Put the **site key** in `src/_data/site.json` as `turnstileSiteKey`, commit.
3. Put the **secret key** in the Pages environment as `TURNSTILE_SECRET`.

Until then, a hidden honeypot field catches simple bots. Nothing reaches the site
without your approval regardless — the worst spam can do is make your issues list
untidy.

---

## First-time setup

Only needed once.

### 1. Put the code on GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then set `repo` in `src/_data/site.json` to `<you>/<repo>`.

### 2. Create the labels

**Issues → Labels → New label**, twice:

- `submission` — new suggestions
- `approved` — **the one that publishes.** Give it a loud colour.
- `published` — added automatically once it's live

### 3. Publish the site

**Cloudflare Pages → Create a project → Connect to Git**, choose the repository:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `_site` |
| Node version | `22` |

Cloudflare rebuilds on every push to `main`. Add your own domain under
**Custom domains** whenever you're ready.

> **Why not GitHub Pages?** It serves files only — it can't run the submission
> form, which needs somewhere to keep the token. If you don't want public
> submissions at all, GitHub Pages works fine and the included
> `.github/workflows/deploy.yml` handles it; people can still submit as GitHub
> issues.

### 4. Add the submission token

See [Secrets, tokens and access](#secrets-tokens-and-access).

### 5. Check it works

- Open `/submit/`, send a test entry
- It appears in **Issues**
- Add `approved`
- Watch **Actions** run, then find it on the timeline
- Delete the test row from `data/timeline.csv` afterwards

---

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
