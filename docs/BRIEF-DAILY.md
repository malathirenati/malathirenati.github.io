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

The approval is what keeps this running on your Claude subscription, with no
API key and nothing to pay.

---

## Contents

- [Where the task lives](#where-the-task-lives)
- [Every morning](#every-morning)
- [Checking it actually went live](#checking-it-actually-went-live)
- [When something is wrong](#when-something-is-wrong)
- [Publishing by hand](#publishing-by-hand)

---

## Where the task lives

The brief is written by a **scheduled task in the Claude desktop app**, listed
under **Scheduled** in the sidebar as *Daily Sports Brief (9:30 IST)*.

It runs **on this machine**, in the checkout at
`/Users/malathir/malathirenati.github.io`. That is why it works: it has the web
access it needs for research and the repository is already there, so there is no
clone and no repository to attach. Its instructions are stored at
`~/.claude/scheduled-tasks/daily-sports-brief/SKILL.md`; the copy of record is
[brief-routine-prompt.md](brief-routine-prompt.md).

**It is not at <https://claude.ai/code/routines>.** Nothing is listed there, and
a routine created there could not do this job — that environment has no web
access, so it cannot research.

### The one thing to know

**The task runs only while the Claude app is open.** If the app is closed at
09:30, the run happens the next time you launch it, not at 09:30. Leaving the
app running overnight is the difference between an edition at 09:35 and one
whenever you next sit down.

---

## Every morning

| Time (IST) | What happens | You |
|---|---|---|
| 09:30 | The task wakes and starts searching | nothing |
| ~09:35 | It has read its sources, written and validated the edition | nothing |
| ~09:35 | It stops and waits for permission to push | **this is your cue** |
| whenever you get to it | You approve | ~2 minutes |
| about a minute later | The site is live | nothing |

### The two minutes

1. Open the Claude app → **Scheduled** in the sidebar → **Daily Sports Brief
   (9:30 IST)** → this morning's run.
2. **Read the summary it printed.** It lists the date, how many items are in
   each desk and lens, how many content opportunities, and every publication it
   cited. This is your review — it is the only point at which a human looks at
   the content before it is public.
3. If it looks right, **approve the push.** By then the edition is already
   written and validated on disk; the prompt is only asking to send it.
4. The site rebuilds itself about a minute later.

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
The likeliest cause is that the Claude app was closed at 09:30 — the task runs
on next launch instead. Otherwise check it is still enabled under **Scheduled**
in the sidebar. Runs also start a few minutes late by design, to spread load.

**It says the push was refused.**
The edition is already written and validated in the working tree — nothing is
lost. Approve it yourself from a terminal:

```bash
cd /Users/malathir/malathirenati.github.io
git add src/static/sports/brief/data/ && git commit -m "Add the brief for $(date -u +%F)" && git push
```

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
