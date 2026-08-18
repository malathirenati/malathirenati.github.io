# MNR Sport

A static site for sports writing and data visualisation. Built with Eleventy,
with charts generated from spreadsheets at build time.

**Nothing ships to the browser but HTML, CSS and a little vanilla JavaScript.**
There are no runtime dependencies — no framework, no charting library, no
spreadsheet parser. Every dependency is a build tool.

---

> **Running the site day to day?** See **[docs/ADMIN.md](docs/ADMIN.md)** —
> approving submissions, adding and deleting entries, fixing mistakes, and
> first-time setup. This README is the technical overview.

## Updating the data

This is the whole workflow:

1. Edit `data/timeline.csv`.
2. Commit and push it.

GitHub Actions rebuilds and republishes the site. To preview locally first:

```bash
npm run serve
```

Then open <http://localhost:8080>.

### What the timeline spreadsheet looks like

`data/timeline.csv` — one row per event, with a header row. Headings are matched
loosely: `Start Year`, `start_year` and `YEAR` all work.

| Column | Required | Notes |
|---|---|---|
| `Category` | yes | The track this event belongs to. Also: Type, Track, Theme |
| `Group` | no | Groups related tracks. Also: Section, Family, Area |
| `Event` | yes | The label. Also: Title, Name, Milestone |
| `Start` | yes | See date formats below |
| `End` | no | If present, the event draws as a bar instead of a point |
| `Detail` | no | Tooltip body. Also: Tooltip, Description, Note |
| `Location` | no | Shown in the tooltip and the table |
| `Link` | no | Makes the event clickable through to a source |
| `Highlight` | no | `yes` keeps the label visible when a lane gets crowded |
| `Verify` | no | `yes` marks the source as unchecked — shown on the site |

Accepted dates:

| Form | Example |
|---|---|
| Year | `1948` |
| Month / full date | `1948-07` · `1948-07-29` · `29/07/1948` · `July 1948` |
| BC | `776 BC` · `776 BCE` |
| First millennium AD | `AD 79` · `79 CE` |
| Approximate | `c. 3000 BC` · `circa 1200 BCE` — shown with a leading `c.` |

A bare year stays a bare year — it is never rendered as "1 January". A bare
negative number like `-500` is read as an astronomical year and displays as
`501 BC`, so prefer writing `501 BC` explicitly.

### Sources

Link the body that holds the record — the IOC for Olympic results, the RBI for
Indian monetary policy, the Smithsonian's Global Volcanism Program for eruptions,
India Code for statute. An encyclopedia is a fallback, not a first choice.

Where no authoritative source is available, use the best one you can and set
**`Verify`** to `yes`. The event then shows *Source not yet verified* in its
tooltip and an `unverified` marker in the table, so a reader is never given a
link that looks settled when it isn't.

Of the 124 sample events, 65 are currently flagged. Clearing them is ordinary
editorial work: find the primary source, replace the link, remove the flag.

### Groups, and why they matter past 8 tracks

**Colour identifies the group; shape identifies the track within it.** So
"Olympic Games" and "Commonwealth Games" both sit in the Sport group, share its
colour, and are told apart by their marker shape.

This is what lets the timeline carry 10–20 tracks. There are only eight
distinguishable colours, so without groups a ninth track would be drawn exactly
like the first. The build refuses to let that happen:

```
timeline.csv: "Track 9" and "Track 1" would both draw as a circle in colour 1
  — they'd be indistinguishable on the chart.
```

If you see that, give the tracks different groups. Up to 8 groups × 8 tracks
each. Four groups or fewer is the sweet spot — that's where the colours stay
fully distinct even with every track on one axis.

Without any `Group` column everything behaves as a flat list, which is fine up
to 8 tracks.

### Pinning colours and shapes

**`data/categories.csv`** fixes each track's group, colour and shape so they stay
put as rows are added:

| Category | Group | Color | Shape |
|---|---|---|---|
| Olympic Games | Sport | 4 | circle |
| Commonwealth Games | Sport | 4 | diamond |

`Color` is a slot from 1–8 and applies to the whole **group** (see
[docs/DESIGN.md](docs/DESIGN.md)). `Shape` is one of circle, diamond, square,
triangle, hexagon, chevron, cross, star. Without this file, groups and tracks are
assigned in the order they first appear.

In an `.xlsx` the same information goes in a second sheet named `Categories`.

### Viewing modes

| Mode | Shows |
|---|---|
| **Lanes** | One lane per track — the default |
| **Threads** | One lane per group, tracks still separated by shape |
| **Compact** | One thin row per track; all of them on roughly one screen |
| **Compare** | Only the tracks you pinned, with guides linking them |
| **Merged** | Everything on a single axis |

### Getting around a very long timeline

The axis reaches back to BC and **panning left has no end stop** — it keeps
working as you add prehistory. That makes navigation the important part:

- **Minimap** — the strip under the chart shows the entire record with a window
  marking your current view. Drag the window to travel millennia; drag its edges
  to zoom. This is the fastest way to move around.
- **Era buttons** — All · Ancient · Medieval · Modern · Since 1900 · Last 25 years.
- **Period boxes** — type dates directly, including `776 BC` or `AD 79`.
- **Lasting at least** — filters to events of a given length, so you can pull out
  the long arcs (empires, eras) and leave the single days behind.

Panning into empty time is allowed; the chart says so, and the minimap window
shows you how far out you have gone.

Because the scale stays linear and honest, a view spanning 4,000 years compresses
the modern era into a sliver. That is real, not a bug — use **Compact** mode or
the era buttons to see recent centuries properly.

---

## Editing in the browser

Add `?edit` to the timeline URL:

```
http://localhost:8080/sports/timeline/?edit
```

That reveals an editor bar and an Edit button on every table row. You can add,
edit and delete events, create tracks and groups, and export the result.

**Edits are local to your browser.** The site is static — there is no server to
save to — so nothing you do here changes what a visitor sees. That is also why
there is no login: an in-page editor simply has no way to publish. To publish:

1. Make your changes.
2. **Export CSV** (or XLSX).
3. Replace `data/timeline.csv` with the downloaded file and commit.

Or use **Submit for publishing**, which opens a pre-filled GitHub issue for the
entry you last touched — then approve it like any other submission.

Work in progress is kept in `localStorage`, so a refresh mid-edit won't lose it.
The bar shows *unsaved local changes* until you discard them; **Discard changes**
clears the draft and reloads the published data.

The editor is a separate file that is only fetched when `?edit` is present —
readers download none of it.

### Notes on the editor

- **New tracks need a group.** Colour comes from the group and shape from the
  track's slot within it, so the editor picks the first unused shape in that
  group automatically and refuses a combination that already exists.
- **Dates are validated as you save**, using the same rules as the build, so an
  event can't land in a different place before and after a rebuild.
- **Export XLSX keeps both sheets**, including the `Categories` sheet that pins
  colours and shapes. CSV carries the events only, so keep `categories.csv` as
  it is when you replace the events file.
- **Links** must start with `http://` or `https://`. They appear as a clickable
  source in the tooltip and on the event name in the table.


### When a sheet has a problem

The build fails loudly and names the row and column:

```
Could not read timeline.csv:
timeline.csv: row 14, column "Start" — could not read "nineteen fifty" as a date.
  Accepted: 1948 · 1948-07 · 1948-07-29 · 29/07/1948 · July 1948
            776 BC · 776 BCE · AD 79 · 79 CE · c. 3000 BC
```

Rows missing a category or an event are skipped with a warning rather than
failing the build, so one blank row can't take the site down.

---

## Submissions

Readers suggest entries through a **GitHub issue form**. Both the form and the
review queue live on GitHub — there is no server, no form service and no
credential to store.

```
GitHub issue form ──→ you add the `approved` label ──→ Action validates,
                                                       appends a row to
                                                       data/timeline.csv,
                                                       commits, rebuilds
```

Approving is one action: **add the `approved` label**. Everything after that is
automatic, including the rebuild and a confirming comment. If validation fails
nothing is committed — the label comes back off and the issue explains why.

| File | Role |
|---|---|
| `.github/ISSUE_TEMPLATE/timeline-entry.yml` | The submission form |
| `.github/workflows/approve.yml` | Triggered by the `approved` label |
| `scripts/apply-submission.mjs` | Validates and appends |
| `scripts/lib/parse.mjs` | Shared with the build, so review and build agree |
| `src/sports/submit.njk` | Public page explaining how to submit |

The workflow runs under GitHub's own per-run `GITHUB_TOKEN`, which is created
for that run and destroyed after it. Nothing to rotate.

### Not currently in use

`functions/api/submit.js` is a tested relay that would let people submit without
a GitHub account, by taking a form post and opening the issue for them. GitHub
Pages serves static files only and cannot run it, so it is dormant. Enabling it
means hosting on Cloudflare Pages, or running that one function as a standalone
Worker. Its header comment documents the permissions it needs.

Operational detail is in [docs/ADMIN.md](docs/ADMIN.md).

## Commands

| Command | Does |
|---|---|
| `npm run serve` | Convert data, build, and serve with live reload |
| `npm run build` | Convert data and build into `_site/` |
| `npm run data` | Convert spreadsheets to JSON only |
| `npm run clean` | Delete `_site/` |

---

## How it fits together

```
data/timeline.csv           the source of truth — you edit this
data/categories.csv         pins each track's group, colour and shape
  └─ scripts/build-data.mjs converts it to JSON, validates it, fails loudly
      └─ src/_data/timeline.json   generated; git-ignored
          └─ Eleventy         bakes it into the pages
              └─ _site/       plain static files
```

Submissions rejoin that flow at the top:

```
public form  ─┐
              ├─→ GitHub issue ─→ you add `approved` ─→ Action appends a row
GitHub issue ─┘                                          to data/timeline.csv
                                                              └─→ rebuild & deploy
```

The spreadsheet parser runs on the build machine only. Readers download JSON.

```
src/
  _data/site.json        title, repo, and the list of sections
  _includes/base.njk     the shared page shell + top-level nav
  _includes/section.njk  adds a section's sub-nav
  _includes/shapes.njk   marker shapes (an accessibility channel — see DESIGN.md)
  index.njk              site home — lists the sections
  sports/                one section
    sports.json          applies the section layout to the whole folder
    index.njk            /sports/
    timeline.njk         /sports/timeline/
    data.njk             /sports/data/
    submit.njk           /sports/submit/
  assets/css/main.css    all styling, design tokens at the top
  assets/js/timeline.js  the chart
```

The site is organised in **sections**, so `/sports/` can sit beside `/music/` or
`/writing/` later without anything being rearranged. Navigation has two levels:
the masthead lists sections, and a sub-nav lists the pages inside the current
one.

### Adding a page to an existing section

Drop `src/sports/whatever.njk` into the folder and add it to that section's `nav`
in `src/_data/site.json`. The folder's `sports.json` gives it the layout and
sub-nav automatically — no front matter beyond a title.

### Adding a whole new section

1. Add an entry to `sections` in `src/_data/site.json` (slug, title, url, blurb, nav).
2. Create `src/<slug>/` with a `<slug>.json` containing
   `{ "layout": "section.njk", "section": "<slug>" }`.
3. Add pages.

The masthead, the home page cards and the sub-nav all read from that one list.

### Adding another dataset

Add a builder function and one line to the `DATASETS` registry at the bottom of
`scripts/build-data.mjs`. It becomes available to templates automatically.

---

## Deploying

### GitHub Pages

Push to `main`, then in the repository: **Settings → Pages → Source → GitHub
Actions**. The included workflow handles the rest, and sets the path prefix
automatically for project sites (`user.github.io/repo/`). Private repositories
work on paid plans.

### Anywhere else

`npm run build` produces `_site/`, which is plain static files — any host will
serve it. For a custom domain at the root, build with an empty prefix:

```bash
PATH_PREFIX=/ npm run build
```

---

## Notes

- Dark mode is a designed variant, not an inverted light mode; both palettes are
  validated against their own surfaces.
- The site sets no cookies and loads nothing from third parties.
- Design decisions that are easy to undo by accident — the palette, the marker
  shapes, the table view — are recorded in [docs/DESIGN.md](docs/DESIGN.md).
