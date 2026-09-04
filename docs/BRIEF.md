# The daily brief

The brief at `/sports/brief/` is a static page that reads its own data at
runtime. It is `noindex`, not linked from the public site, and reachable by
direct URL — but the repository is public, so treat everything in it as
publishable.

A scheduled routine writes one edition each morning at 04:00 UTC (09:30 IST)
and pushes it. This file is the spec that writer works from — it reads this file
out of the repository before writing, so editing this file is how you change
what the brief contains. It is also the reference for writing an edition by
hand.

## Contents

- [Adding an edition](#adding-an-edition)
- [The edition file](#the-edition-file)
- [What the validator refuses](#what-the-validator-refuses)
- [Sourcing rules](#sourcing-rules)
- [When there is no news](#when-there-is-no-news)
- [If the agent gets it wrong](#if-the-agent-gets-it-wrong)

## Adding an edition

Write one file:

    src/static/sports/brief/data/2026-09-04.json

Then commit and push. That is the whole job. `index.json` is **generated** from
the files present — it is gitignored, rebuilt by `npm run brief`, and must never
be edited by hand. Pushing triggers the deploy, and the edition is live in about
a minute.

Check it before pushing:

```bash
npm run brief && npm run build
```

## The edition file

```jsonc
{
  "date": "2026-09-04",        // must equal the filename
  "weekday": "Friday",         // must be the real weekday for that date (UTC)
  "regions": {
    "india":  { "government": [], "markets": [], "society": [] },
    "global": { "government": [], "markets": [], "society": [] }
  },
  "opportunities": []
}
```

Both desks (`india`, `global`) and all three lenses (`government`, `markets`,
`society`) must be present. An empty lens is `[]` — that is a normal, quiet day,
not an error. The page renders exactly these six buckets and silently ignores
anything else, which is why the validator rejects unknown keys rather than
letting them disappear.

A **news item**, in any lens:

```jsonc
{
  "id": "in-gov-1",            // unique within the edition
  "title": "Doping cases before the Asian Games reach a dozen",
  "summary": "Wushu player … just over a fortnight before the Games open.",
  "sources": [
    { "name": "Business Standard, Sept 2", "url": "https://www.business-standard.com/sports/…" }
  ]
}
```

Ids follow `<desk>-<lens>-<n>`: `in-gov-1`, `gl-mkt-2`, `in-soc-3`.

An **opportunity** — an angle not yet well covered elsewhere, which is the
editorial half of the brief and carries no sources because nobody has written it
yet:

```jsonc
{
  "id": "opp-1",
  "format": "Blog",            // Blog | Op-ed | Podcast | Newsletter | Talk
  "title": "The supplement supply chain behind India's doping wave",
  "summary": "Most of the 12 pre-Asiad positives look less like deliberate cheating than …"
}
```

House shape, from the first edition: 12–18 items spread across the six buckets,
5–8 opportunities, summaries of roughly 40–80 words. One paragraph, no bullets,
no headlines-with-colons. Say what happened and why it matters to someone who
works on sport policy; assume they already know the sport.

## What the validator refuses

`npm run brief` runs in the build, so all of these fail CI rather than reaching a
reader:

| Rejected | Why |
|---|---|
| `date` not matching the filename | the page trusts the filename |
| a weekday that is not that date's | the reader sees both, side by side |
| a missing desk or lens | renders as a silently absent column |
| an unknown desk, lens or `format` | the page drops it without a word |
| an item with no `sources` | every claim in the brief carries a link |
| a source URL that is not `https` | |
| a source URL that is a bare homepage | a front door is not a citation |
| a duplicate `id` | breaks filtering and search |
| a summary under 40 characters | a stub, not a summary |
| an edition with no items at all | see below |

## Sourcing rules

These are the ones that matter, because the brief attributes claims to real
publications by name:

1. **Every item carries at least one source that was actually read.** Not a
   search result, not a headline, not an inferred URL — the page itself.
2. **Never write a summary from a title.** If the article could not be opened,
   the item does not go in.
3. **Never construct a plausible-looking URL.** A dead or invented link
   attributed to Bloomberg is worse than omitting the story.
4. **`name` is the publication, optionally with the publication date**
   ("Business Standard, Sept 2"). It is not a headline.
5. **Summaries are written, not pasted.** Do not reproduce sentences from the
   source.

## When there is no news

Publish a short edition. A quiet Tuesday is four items, not four invented ones.

If a whole lens has nothing, it is `[]`. If **nothing** could be sourced at all,
publish no edition for that day — the validator rejects an empty one, and the
page skips missing dates without complaint. A gap in the archive is honest; a
padded edition is not.

## If the agent gets it wrong

Editions are ordinary files. To fix one, edit
`src/static/sports/brief/data/<date>.json` and push. To withdraw one, delete the
file and push — `index.json` regenerates without it and the date disappears from
the picker.

The runs are at <https://claude.ai/code/routines> under "Daily Sports Brief
(9:30 IST)"; that is where to look when a morning's edition does not appear. A
run that publishes nothing is a success, not a failure — the log says which of
the two happened. The routine's instructions are kept in
[brief-routine-prompt.md](brief-routine-prompt.md).

## How the writing works

The routine researches with web search and fetch, reads this file for the
schema and the rules, writes the edition, and pushes. `npm run brief` validates
it and the build has to pass before the commit lands.

### The dormant second path

`scripts/write-brief.mjs` plus the **Daily brief** Actions workflow do the same
job through the Claude API instead. It is switched off — the job no-ops unless
an `ANTHROPIC_API_KEY` secret exists — and kept only in case the routine ever
loses repository access. Do not add that secret while the routine is enabled, or
both will write the same file.

It differs from the routine in two ways that matter if you ever switch to it:

- **The research runs on Anthropic's servers, not on the GitHub runner**, via
  the server-side `web_search` / `web_fetch` tools. The runner only reaches
  `api.anthropic.com`, so no outbound network policy can break it. That was the
  point: a third approach — a Claude Code cloud routine — failed exactly there,
  its sandbox blocking every news site, and correctly published nothing.
- **It cannot cite a link it invented.** `web_fetch` only fetches URLs already
  in the conversation, and they arrive by coming back from `web_search`. The
  sourcing rules above hold by the shape of the tools, not only by instruction.
- **It costs money** — one API call a day on `claude-opus-5`, roughly a dollar.
  The routine runs on the Claude subscription instead.

Either path refuses to overwrite an edition that already exists, so re-running
on a day that already has one is safe and does nothing.
