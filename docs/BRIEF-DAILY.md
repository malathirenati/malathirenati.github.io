# Publishing the daily brief

What you do, and when, to get each morning's edition live at
<https://malathirenati.github.io/sports/brief/>.

**The short version:** at about **09:40 IST**, open the routine, read the
summary, approve the push. Two minutes, once a day. Skipping a day costs
nothing.

## Why there is a step at all

The routine researches and writes on its own. It cannot publish on its own:
pushing to a public repository raises a permission prompt, and a scheduled run
has nobody to answer it. It waits for you instead.

That prompt is the only thing standing between a finished edition and the live
site. Everything before it — search, reading the articles, writing the edition,
checking it against the spec — happens without you.

This is the free arrangement, and the approval is what makes it free. The paid
alternative is in [the note at the end](#if-you-get-tired-of-the-daily-tap).

---

## Contents

- [One-time setup](#one-time-setup)
- [Every morning](#every-morning)
- [Checking it actually went live](#checking-it-actually-went-live)
- [When something is wrong](#when-something-is-wrong)
- [Publishing by hand](#publishing-by-hand)
- [If you get tired of the daily tap](#if-you-get-tired-of-the-daily-tap)

---

## One-time setup

Three things, once. Fifteen minutes at most.

### 1. Put the prompt into the routine

Go to <https://claude.ai/code/routines> and open **Daily Sports Brief
(9:30 IST)**.

Replace its prompt with the text inside the code fence in
[brief-routine-prompt.md](brief-routine-prompt.md) — the whole block, nothing
outside it.

The prompt it has now publishes to a claude.ai artifact, which is the old
delivery path. Until you replace it, the routine will keep doing that and your
site will not update.

### 2. Enable it

Same page. The routine is currently **switched off**. Turn it on.

Check the schedule reads **04:00 UTC** — that is 09:30 IST. It should already.

### 3. Attach the repository, if the routine settings offer it

Look for an option to add a **source** or **repository** to the routine, and add
`malathirenati/malathirenati.github.io` with write or push access.

This is optional and may not exist. If it does, it removes one of the two
approvals below, because the repository is then already attached when the run
starts. If you cannot find it, skip it — the routine asks for access itself.

---

## Every morning

| Time (IST) | What happens | You |
|---|---|---|
| 09:30 | The routine wakes and starts searching | nothing |
| ~09:35 | It has read its sources and written the edition | nothing |
| ~09:35 | It stops and waits for permission to push | **this is your cue** |
| whenever you get to it | You approve | ~2 minutes |
| about a minute later | The site is live | nothing |

### The two minutes

1. Open <https://claude.ai/code/routines> → **Daily Sports Brief (9:30 IST)** →
   the run from this morning.
2. **Read the summary it printed.** It lists the date, how many items are in
   each desk and lens, how many content opportunities, and every publication it
   cited. This is your review — it is the only point at which a human looks at
   the content before it is public.
3. If it looks right, **approve** the permission prompt. It may ask twice: once
   to attach the repository, once to push. Approve both.
4. It then validates and pushes. The site rebuilds itself.

### If you skip a day

Nothing breaks. That date simply has no edition, and the page's date picker
skips it without complaint. The next morning's run is unaffected.

Do not try to approve yesterday's stalled run today — the edition it wrote is a
day stale. Let it go and take today's.

---

## Checking it actually went live

About a minute after you approve, open:

<https://malathirenati.github.io/sports/brief/>

It should open on today's date. If it opens on yesterday's, the deploy has not
finished — wait a minute and reload.

If you want to be certain, the repository's **Actions** tab shows a "Build and
deploy" run triggered by the push. Green tick means live.

---

## When something is wrong

**The run says it found nothing worth publishing.**
That is a correct outcome, not a failure. It is instructed to publish nothing
rather than pad an edition with stories it could not read. Take the day off.

**The run never appeared.**
Check the routine is still enabled at <https://claude.ai/code/routines>.
Scheduled runs also start a few minutes late when the platform is busy.

**It says repository access was refused.**
It will print the edition JSON in full instead. Save that and use
[Publishing by hand](#publishing-by-hand) below. Then check that the Claude
GitHub App still has **Contents: Read and write** on the repository, at
<https://github.com/settings/installations>.

**The push was approved but the build failed.**
The validator rejected the edition — the Actions log says exactly which rule.
Nothing was published; the site still shows yesterday. Either fix the file by
hand or skip the day.

**Something in a published edition is wrong.**
Editions are ordinary files. Edit
`src/static/sports/brief/data/<date>.json` and push to correct it, or delete the
file and push to withdraw the day entirely. The date list rebuilds itself.

---

## Publishing by hand

If the routine writes an edition but cannot push it, save its JSON and do this
yourself:

```bash
cd /Users/malathir/malathirenati.github.io
git pull
```

Save the JSON as `src/static/sports/brief/data/<today>.json` — the filename must
be the date, e.g. `2026-09-05.json`. Then:

```bash
npm run brief && npm run build
```

If that passes, publish it:

```bash
git add src/static/sports/brief/data/ && git commit -m "Add the brief for $(date -u +%F)" && git push
```

If `npm run brief` complains, it tells you exactly which rule the edition
breaks. The rules are in [BRIEF.md](BRIEF.md); fix the file rather than the
validator.

---

## If you get tired of the daily tap

Everything for the unattended version is already built and committed — it just
costs money, which is why it is switched off.

Add an `ANTHROPIC_API_KEY` secret under **Settings → Secrets and variables →
Actions** and the **Daily brief** workflow takes over completely: no approval,
no routine, live by 09:35 every morning whether or not you look. Roughly $1 a
day on `claude-opus-5`, or about a fifth of that if you set `BRIEF_MODEL` to
`claude-sonnet-5` in [the workflow](../.github/workflows/brief.yml).

**Disable the routine first**, or both will write the same file.

One thing you would be giving up by switching: nobody reads the edition before
it is public. The validator guarantees every item cites a real page that was
actually fetched — it cannot tell whether a summary has misread that page.
Right now your morning approval is what catches that.
