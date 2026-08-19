# Design notes

Short record of the decisions that are easy to undo by accident, and why they
are the way they are.

## Two colour systems, kept apart

**Page chrome** — warm sand, cream, soft borders. Low chroma on purpose. This is
where the "warm pastel" character lives.

**Series colours** — eight saturated slots for data marks. Pastel data marks fail
contrast and collapse under colour-vision deficiency, so warmth is never applied
to a mark. Warm surroundings, legible data.

Both sets are defined as CSS custom properties at the top of
`src/assets/css/main.css`, once per theme.

## Identity is composite: colour × shape

**Colour identifies the group. Shape identifies the track within that group.**

| Channel | Carries | Ceiling |
|---|---|---|
| Colour — 8 validated slots | Group | 8 groups |
| Shape — 8 marker shapes | Track within a group | 8 tracks per group |

64 unique pairs. Shapes repeat *across* groups on purpose — a blue circle and a
green circle are different tracks, and the pair is what identifies them.

This exists because colour alone does not scale. Checked across all pairs rather
than just neighbours, the eight hues separate at most **four** series; no
ordering fixes it and no substitute palette does either. Before groups existed
the build wrapped both channels at 8 together (`colorIndex % 8`, with shape
derived from `colorIndex`), so a ninth track was drawn *identically* to the
first. `assertUniqueIdentity()` in `scripts/build-data.mjs` now fails the build
on any duplicate pair, because two tracks drawing the same is the one failure a
reader cannot work around.

The current data uses **4 groups**, which is deliberate — four is the largest
number that clears all-pairs colour separation in both themes. Group colours are
slots 1, 3, 4, 5 (blue, yellow, magenta, green), which measure:

- **Light** — worst all-pairs CVD ΔE **13.0**, normal-vision **19.6**
- **Dark** — worst all-pairs CVD ΔE **6.9** (floor band, covered by shape),
  normal-vision **19.3**

**There is no good fifth colour.** Measured against those four, every remaining
slot fails the hard normal-vision floor of 15 on all pairs:

| Fifth slot | worst CVD ΔE | worst normal ΔE |
|---|---:|---:|
| aqua | 1.6 | 11.9 |
| orange | 2.7 | 10.6 |
| violet | 1.9 | 9.8 |
| red | 6.7 | 7.8 |

Violet looks like the obvious pick in light mode and is one of the worst in dark,
where its step lands almost on top of dark blue — which is exactly why this gets
measured rather than eyeballed.

So a fifth group would leave two sectors that full-colour readers cannot reliably
tell apart. When a sector needs adding, fold it into an existing group: it keeps
its own named tracks and its own shapes, and only shares a colour. That is why
natural events live under *Economy & environment* rather than in a group of their
own — and it puts volcanoes, epidemics and climate beside economic shocks, which
is where the correlations are (Tambora 1815 → the Year Without a Summer 1816).

## The categorical palette

Slot order (light / dark):

| Slot | Hue | Light | Dark |
|-----:|-----|---------|---------|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | aqua | `#1baf7a` | `#199e70` |
| 3 | yellow | `#eda100` | `#c98500` |
| 4 | magenta | `#e87ba4` | `#d55181` |
| 5 | green | `#008300` | `#008300` |
| 6 | red | `#e34948` | `#e66767` |
| 7 | violet | `#4a3aa7` | `#9085e9` |
| 8 | orange | `#eb6834` | `#d95926` |

This ordering was not hand-picked. All 5,040 blue-first orderings were checked
against the lightness band, chroma floor, colour-vision separation, the
normal-vision floor and contrast, in both themes; 118 passed, and this is the
passing order that leads with blue, green and yellow.

Verify after any change:

```bash
node scripts/validate_palette.js "#2a78d6,#1baf7a,#eda100,#e87ba4,#008300,#e34948,#4a3aa7,#eb6834" --mode light --surface "#fdfbf6"
```

(`scripts/validate_palette.js` lives in the dataviz skill, not this repo.)

Results as shipped:

- **Light** — worst adjacent CVD ΔE **7.2**, normal-vision **19.6**. Three slots
  (aqua, yellow, magenta) sit below 3:1 against the cream surface.
- **Dark** — worst adjacent CVD ΔE **8.4**, normal-vision **19.3**, all slots
  above 3:1.

Two consequences follow, and both are load-bearing.

### 1. Shape is a required channel, not decoration

A worst pair in the 6–8 CVD band is only acceptable when something other than
hue also identifies the series. Here that is **marker shape**: circle, diamond,
square, triangle, hexagon, chevron, cross, star — defined in
`src/_includes/shapes.njk` and used by the chart, the legend, the filter panel
and the table.

Don't replace the shapes with plain dots, and don't shrink them below about
12px. Every track carries both a colour and a shape, and the build enforces that
the pair is unique.

### 1b. View modes

Five, all running the same packer and differing only in how events are bucketed
into lanes (`MODES` at the top of `src/assets/js/timeline.js`):

| Mode | Lane per | Notes |
|---|---|---|
| Lanes | track | The default. Labels where they fit. |
| Threads | group | Rolls a whole group into one lane; shape still separates tracks. |
| Compact | track | One thin row each, markers only, names in a left gutter. 14 tracks on a screen. |
| Compare | pinned track | Up to 3 pinned tracks, generous labels, plus guides dropped from the first track's events across the others. |
| Merged | — | Everything on one axis. |

Compact's gutter is a third of the width, capped at 156px — a fixed gutter left
about 100px of plot on a phone. Names that don't fit are trimmed with an ellipsis
and kept in full on the row's `<title>` and `aria-label`. Note that a `<title>`
placed inside an SVG `<text>` is laid out as visible glyphs, so it belongs on the
hit rectangle instead.

### 2. The table view is not optional

Three light-mode slots sit below 3:1 against the surface. That is permitted only
where the values are readable another way. Two things provide it, and both must
stay:

- direct labels on the marks wherever they fit, and
- the full table under the chart, which mirrors the current filters.

The table is rendered server-side and is visible by default; JavaScript hides it
behind a toggle. With JavaScript off it simply stays open, so the data is never
gated behind the chart.

## Text contrast

All body, secondary and muted text clears WCAG AA (4.5:1) against every surface
it is used on, in both themes. `--muted` is the tight one at 4.80:1 on
`--surface-2`; it was darkened from `#6f6a5e` to `#6a6558` for exactly this
reason. Re-check before lightening it.

## Chart conventions

- Gridlines and axes: hairline, solid, one step off the surface. Never dashed.
- Markers: 14px, with a 2px ring in the surface colour so they stay legible
  where they overlap.
- Span bars: 8px tall, 4px rounded ends.
- Labels: measured before placing. A label that fits on neither side of its
  marker is dropped rather than clipped — the tooltip and table still carry it.
- Text never wears a series colour. Identity comes from the coloured mark beside
  the text.
- A legend is always present when two or more tracks are shown.

## The editor (`?edit`)

`src/assets/js/timeline-editor.js` is fetched only when `?edit` is in the URL, so
the reader payload is unchanged by it. The contract between the two files is the
`window.__timeline` object at the bottom of `timeline.js` — model, `render`,
`applyModelChange`, and a few helpers. Keep that surface small.

Two invariants the editor has to respect, both of which have already bitten:

- **New groups take the first *unused* colour slot, not `groups.length`.** The
  `Categories` sheet can pin colours out of order (this data uses 1, 3, 4, 5), so
  counting groups hands a new one a colour that is already taken.
- **A newly added track starts visible.** `rebuildModel()` captures the known
  track slugs *before* reindexing, so anything new is added to `state.active`
  rather than arriving switched off with its events missing from the chart.

Date parsing is deliberately duplicated between `timeline-editor.js` and
`scripts/build-data.mjs`. They must agree — if they diverge, an event sits in one
place in the editor and another after the next build.

Export writes CSV and XLSX with no dependencies; an `.xlsx` is a zip of XML
parts, so the editor carries a small ZIP writer (stored, not deflated, plus a
CRC32). Round-tripping an exported file back through `npm run data` is the test
that matters.

## Deep time

The axis runs from prehistory to the present and is **not bounded by the data**.

**Years are astronomical internally**: 0 is 1 BC, −1 is 2 BC. Arithmetic is then
ordinary and BC/AD is purely a display concern (`formatYear`, defined identically
in `scripts/build-data.mjs`, `timeline.js` and `timeline-editor.js` — all three
must agree).

**`fractionalYear` must never use `Date`.** `Date.UTC` maps years 0–99 onto
1900–1999 — `Date.UTC(50, 0, 1)` is 1950 — so any first-century event would be
silently misplaced. It is plain proleptic-Gregorian arithmetic instead:
`year + (dayOfYear − 1) / daysInYear`.

**BC ticks are offset by one.** BC labels count *down* as the axis runs right, so
a round display year sits one off the round astronomical one: 500 BC is
astronomical −499. `axisTicks()` applies `t <= 0 ? t + 1 : t`, without which a
millennium axis reads "2501 BC, 2001 BC, 1501 BC" — correct, and obviously not
what anyone wants to see.

**Panning has no end stop.** `clampView()` holds the view inside a generous
`WORLD` envelope (−50000 to a couple of centuries out) rather than inside the
data, so the axis keeps working as prehistory is added. Panning into empty space
is allowed and says so; the minimap is the way back.

**The minimap is not decoration.** With an unbounded axis it is the navigation
instrument — the whole record as one tick per event coloured by group, with a
draggable window. Removing it would leave a reader able to pan into empty
millennia with no way to tell where they are.

`render()` cancels any pending pan frame on entry: a stale `requestAnimationFrame`
would otherwise repaint the old view after a synchronous render, and rAF does not
fire at all in a hidden tab.

## Tooltips and sources

The tooltip takes pointer events **only when the event has a link**
(`data-interactive`), so it never blocks the chart otherwise, and hiding is
delayed ~220ms so the pointer can travel from the mark into the tooltip to click
the source. Links render as the hostname rather than a raw URL.

## Sports theme

Deliberately restrained: a lane stripe under the masthead, a chequered-flag
underline on the active tab, running-track banding behind the swimlanes, and a
dotted "NOW" line. The data is the loud thing on the page.

---

## Keyed stat tiles (Sport landing page)

The "What's on the timeline" tiles carry their track's colour. Three numbers in
`.stat-keyed` were arrived at by measuring all eight slots in both themes on the
rendered page, and they should not be nudged by eye.

| Value | Chosen | Why not more |
|---|---|---|
| Background tint | **6%** of the slot colour into `--surface-2` | At 10% the `--muted` label fell to **4.22:1** against its own tile. `--muted` is only guaranteed ≥4.5:1 against the untinted surfaces. |
| Rule colour | **66%** slot / **34%** `--ink` | Neat `--s3` (yellow) is **1.68:1** against its tile — a 3px rule nobody can see. At 66% the worst slot is **3.30:1** light and **5.34:1** dark. Raising it towards neat colour walks `--s3` back down through 3:1. |
| Label token | `--ink-2`, not `--muted` | The tint moves the background off the surface `--muted` was measured against. `--ink-2` holds **5.97:1** light / **8.69:1** dark. |

Mixing the rule towards `--ink` rather than towards black or white is what lets
one declaration serve both themes: `--ink` is dark in the light theme and light
in the dark one, so the rule darkens or lightens in whichever direction actually
raises contrast.

**Why not fill the tile with the slot colour.** Three of the eight slots sit
below 3:1 against the ink tokens. A filled tile would put its own count on one
of those. The rule carries the identity instead, and the text stays on a surface
it was measured against.

Measured after any change with the contrast sweep in the browser console —
worst-case label, value and rule ratios across every rendered tile, both themes.

## Logos on the dark theme

The section marks are blue line art on transparency (94-96% of each file is
transparent), and several carry their own accent colours. Measured from the
actual pixels, against `--page` in each theme:

| Ink | Share of the mark | On the dark page | On the plate |
|---|---|---|---|
| `#0048a8` — the wordmark blue | 72-100% of every mark | **2.24:1** | 7.27:1 |
| `#001848` — the path in `timelines` | 22% of that mark | **1.10:1** | 14.81:1 |
| `#000000` — the newspaper outline in `newsletters` | 10% of that mark | **1.11:1** | 18.13:1 |

Left alone, the dominant blue sits below the 3:1 non-text minimum everywhere,
and about a fifth of the timelines mark and a tenth of the newsletters mark
disappear into the background entirely.

Brightening the artwork was the obvious fix and is the wrong one: the same marks
carry red (`#d84848`), orange (`#d86000`) and black accents that already have
adequate contrast on dark — 4.44:1, 5.02:1 — and lifting everything to rescue
the blue would blow those out.

The dark theme puts the mark back on paper instead: `--logo-plate`, the site's
own warm surface colour rather than white, with 4px of padding and a small
radius. Every mark keeps its true colours, and the plate reads as part of the
design. In the light theme the same token is `transparent`, so one rule serves
both and there is no second set of assets to keep in step.

## The home banner

The banner ran as a 150px strip with `object-fit: cover`, which threw away about
three-quarters of the artwork — the landmarks along the top and the waves along
the bottom never appeared on screen at all.

Widening the display box cannot fix that on its own. The height of a full-width
image is set by its aspect ratio, so a 1.79:1 illustration at a 1200px page
needs 670px to show completely. Every display-side option trades one thing for
another: crop it, shrink it to a centred picture with empty bands beside it, or
let it run past a screenful.

**The artwork was trimmed instead.** Measuring ink per row showed the top 150
rows of `mnr-banner.jpg` contained none at all — empty pastel sky above the
Tower Bridge and Statue of Liberty. Removing them is lossless and takes the file
from 1.79:1 to 2.23:1, which is what allows the banner to be full-width *and*
complete at 575px on a 1280px page, and 168px on a 375px phone.

| | Before | After |
|---|---|---|
| Artwork | 1376×768 (1.79:1) | 1376×618 (2.23:1) |
| Shown | ~25% of it | all of it |
| Height at 1280px wide | 150px | 575px |

`--banner-max: 85vh` is a safety net for a short or very wide window, not the
normal path; at 1280×800 the cap is 680px against a natural 575px.

**If the artwork is ever replaced, re-trim its empty margins rather than
reintroducing a crop here** — the crop is what was wrong in the first place. The
row-ink measurement that found the 150 empty rows is worth repeating on any new
file; a replacement at 1.79:1 or taller will otherwise stand ~670px tall.

The uncropped original remains in git history at commit `d314eda`.

### Shortening it to a banner, and art direction

Trimming the empty sky made the image complete, but at 2.23:1 it still stood
575px on a 1280px page — 72% of the first screenful, which reads as a picture
placed at the top rather than a banner.

Measuring ink per row separates the figures from the pale landmark washes, and
they fall away at very different rates as the band is shortened:

| Ratio | Height @1280 | All ink kept | Figures kept |
|---|---|---|---|
| 2.23:1 | 573px | 99% | 100% |
| 3.2:1 | 400px | 87% | 97% |
| **4:1** | **320px** | 74% | **96%** |
| 5:1 | 256px | 62% | 88% |

4:1 halves the height and still keeps 96% of the figures; what goes is sky and
the tops of the landmarks. It is also the conventional banner ratio — LinkedIn
covers are 1584×396, and the common CMS presets ship 1600×400 and 2560×640 — and
it puts the banner at 40% of the fold, so the content beneath starts above it.

**Two crops, not one image scaled.** A 4:1 band is only 94px tall on a 375px
phone. Phones therefore get the 2.23:1 crop (`mnr-banner-tall.jpg`, 168px, 21% of
the fold) through a `<picture>` with a `min-width: 700px` source. Both carry
width/height, and the attributes have to sit on the `<source>` as well as the
`<img>` because the two have different aspect ratios and each must reserve its
own space.

Tiling was considered and rejected: the artwork's left and right edges differ by
21/255 per channel, so a repeat would show a visible seam.


### Re-cut for the replacement artwork (3307x1654)

The new banner is a true 2:1 with a different composition: landmarks occupy the
upper half, athletes the lower. That moves the answer. Measuring landmark ink
and athlete linework separately, per candidate ratio:

| Ratio | Height @1280 | % of fold | Landmarks kept | Athletes kept |
|---|---|---|---|---|
| 2.0:1 | 640px | 80% | 100% | 100% |
| 2.75:1 | 465px | 58% | 92% | 100% |
| 3.0:1 | 426px | 53% | 77% | 100% |
| **3.5:1** | **365px** | **46%** | **92%** | **96%** |
| 4:1 | 320px | 40% | 73% | 94% |

3.5:1 beats both its neighbours because the best window at that height spans
both bands; 4:1 has to abandon the landmarks to hold the athletes, keeping only
73% of them. The extra 45px over 4:1 buys 19 points of landmark retention, so
3.5:1 is the cut in use. The window was then nudged 90px down from the pure
ink-maximum so the hockey player's legs, the football and the swimmer are not
clipped at the bottom edge — an ink metric cannot see that a figure is severed.

Delivered at 2400x685 (169KB) for desktop and 1400x700 (111KB) for phones, from
a 1.26MB source. Only one is fetched per device, and the desktop file still has
1.88x of retina headroom at a 1280px layout.


### Second replacement (mnr-banner2.jpg, 3780x1890)

The same method, re-measured rather than reusing the previous offsets — the
composition changed again, with Victoria Falls added on the left.

| Ratio | Height @1280 | % of fold | Landmarks | Athletes |
|---|---|---|---|---|
| 3.0:1 | 426px | 53% | 92% | 100% |
| 3.25:1 | 393px | 49% | 99% | 99% |
| **3.5:1** | **365px** | **46%** | **98%** | **99%** |
| 4:1 | 320px | 40% | 83% | 99% |

This artwork suits the wide cut better than the last: its top 23% is empty sky,
so 3.5:1 costs almost nothing (98% / 99%) where the previous file gave up 8% of
its landmarks at the same ratio. 4:1 still drops to 83%, so 3.5:1 stands.

The window sits at rows 165-479 of 550, nudged down from the ink maximum at
149-463 because the figures run to row 482 and the maximum clipped their feet.

**Source artwork now lives in `art/`, not `src/assets/`.** `src/assets` is copied
wholesale into the build, so the 1.7MB original was being deployed even though
no page references it. Only the two derived crops ship: 2400x685 (199KB) and
1400x700 (124KB), one per device.

## The default view window

The chart opened on the full extent of the data, which sounds right and reads
badly. Measured against a 1,179px axis:

| Era | Events | Pixels |
|---|---|---|
| 2600 BC – AD 0 | 13 | 765px |
| AD 0 – 1500 | 9 | 382px |
| 1500 – 1900 | 6 | 102px |
| 1900 – 1980 | 40 | 20px |
| 1980 – 2000 | 22 | **5px** |
| 2000 – 2026 | 39 | **8px** |

78% of the events fell after 1900 and shared 32px; everything after 1954 landed
inside 18px, at 3.9 years per pixel. Thirteen ancient events took two-thirds of
the width. Recent marks overlapped so heavily that their labels were dropped
altogether — an event could be present, correct and invisible.

The default is now `max(minYear, maxYear - 140)`, so the last ~140 years,
starting just before the 1896 Games. That is 0.12 years per pixel and 102 of the
129 events in view. Nothing is hidden: the overview strip above the chart still
shows the whole record with the current window marked, "All" is one click, and a
`#from`/`#to` in the URL still overrides it.

Derived from the data rather than hardcoded to 1886, so it stays sensible if the
dataset's centre of gravity moves.

### Third artwork (mnr-banner3.jpg, 2835x1417)

A revised composition, not a re-export: the landmarks are rearranged and the
whole scene is more vertically compact. That suits the wide cut better than
either predecessor — all content sits in rows 132-465 of 550, with the top 24%
and bottom 15% empty.

| Ratio | Height @1280 | % of fold | Landmarks | Athletes |
|---|---|---|---|---|
| 3.0:1 | 426px | 53% | 100% | 100% |
| **3.5:1** | **365px** | **46%** | **99%** | **100%** |
| 4:1 | 320px | 40% | 95% | 100% |

3.5:1 is now all but lossless, so it stands. Window at rows 148-462 of 550.

**A 2:1 upload replacing `mnr-banner.jpg` directly will be cover-cropped**, because
the markup declares the derived crop's 3.5:1 and the CSS fills that box. Upload
new artwork, then re-derive — do not point the page at a raw 2:1 file.
