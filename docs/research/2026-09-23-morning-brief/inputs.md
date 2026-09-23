# Morning brief rethink: Marco's inputs (2026-09-23)

Recorded verbatim so the concept work has the source material. The two prompts below are **reference examples** of briefs Marco runs in Claude Code today. They are directional input, not a spec: "I don't want all this specific content, necessarily, but I want something that directionally produces something like this comprehensive brief."

## What Marco asked for (his words, lightly tidied)

I want to re-think the morning brief completely. I want it to be a productized, customizable, AI-powered feature that is dynamic yet shows the same containers of information consistently. Consistent information:
- Weather (based on location)
- Preview of schedule
- Top priorities
- Quick wins: tasks that AI can help with, plus stuff that I have to do
- More integrations that the user can connect

Right now in Claude Code we have a few things that pull in important information, and I want it to function similarly but fit within the product seamlessly.

Also:
- There should be an **onboarding setup process for the Today page**.
- The ability to **look at past pages** (past briefs).
- **Task completion goals and karma points**, very similar to Todoist.

Context: this came up while deciding whether the built 2-step morning review (brief → energy + priorities) should gain a 4th "triage" step (ux-intent §2.1). Marco replaced that decision with this redesign.

## Reference 1: nightly chief-of-staff prompt (Claude Code)

> Act as my nightly chief-of-staff agent, America/Los_Angeles timezone. Steps: (1) Pull all open Todoist tasks due within 7 days or overdue. (2) For each task, search email, calendar, iMessage group and 1:1 threads, and the relevant project NEXT.md or scope docs (always prefer the canonical scope doc over later emails) for evidence of completion or a changed next step. (3) Sort tasks into: CLOSE (proof found, with the quote), UPDATE (the real next step changed), DRAFT (needs a reply, so draft it but don't send), DECIDE (needs me). (4) Apply CLOSE and UPDATE actions only when confidence is high; log everything else. (5) Dedupe the 'complete today' project and build tomorrow's calendar time blocks around existing events, flagging conflicts. (6) Refresh the finance dashboard data and note anomalies over $100. (7) Write a morning brief to outputs/briefs/<date>.md covering decisions needed first, then drafts, then what you closed with evidence. Commit it. Never send messages, pay anything or delete files.

## Reference 2: `/morning` scheduled routine (Claude Code, daily 6:35 AM Pacific)

Sections, in order below a hero: Needs attention; Before you start; Calendar events; Todoist tasks; Overdue and waiting; Upcoming priorities; Open threads, messages, or loops; Goal progress; Job digest; Design news and inspiration; Ideas; Last-minute notes; Affirmation.

Key design rules from that routine (Marco approved 2026-08-06):
- **Needs attention:** hairline rows, faint numerals, right-aligned uppercase due tag. Action buttons live only here, and only where Claude could actually move the thing (draft a reply, research, draft a doc, think through options). Never on decisions only Marco can make, places he must be, or money/health/credentials. Imperative labels of five words or fewer naming what pressing it produces ("Draft the reply").
- **Before you start:** identical every day, no fetch. A body-check line (eaten · water · meds), six core habits as checkbox rows, a BONUS line of optional habits. No scoring, no streaks, no completion counts, never a reference to yesterday: "a checklist, not a report card."
- **Calendar events:** TODAY / TOMORROW labels, time gutter, event blocks with location/meta.
- **Tasks:** checkbox rows, title + one-line note, priority and due/age labels.
- **Overdue and waiting:** five oldest, grey age tags only, a total count, one quiet line suggesting Someday for anything more than 60 days old (for the group, never per row).
- **Upcoming priorities:** small vertical timeline (TODAY / THIS WEEKEND / AHEAD).
- **Open threads:** awaiting vs resolved status dots.
- **Goal progress:** open with the week's actual movement (tasks completed in 7 days, then the 2–3 that mattered, in Marco's words), then meters for weekly goal / yesterday / today vs the Todoist daily goal, a karma number and a 7-day karma sparkline. "Wins before meters."
- **Job digest, Design news:** tiles and rows from other scheduled jobs.
- **Ideas; Last-minute notes** (an editable scratchpad); **Affirmation** (register chosen from the evidence: GENTLE after heavy output, DIRECT naming one stalled thing without judgment, MIRROR handing back his own words. Never scold, never cheerlead).
- Color: one accent (clay) with two jobs kept visually separate: solid fill = an action button, text only = a flag (due today / first seen today). Nothing else becomes a button or filled badge.

## Reference 3: screenshot (Claude app activity card)

Marco shared a screenshot of Claude's own usage card as a reference for an activity/stats module. Contents: a greeting headline with a small clay asterisk mark ("What's up next, Marco?"); a rounded light-grey card with tabs (Overview / Models) and a range toggle (All / 30d / 7d); a 3×2 grid of stat tiles (Sessions 657, Messages 165,243, Total tokens 11.9B, Active days 107, Peak hour 8 AM, Favorite model); a GitHub-style heatmap of rounded squares, grey for empty days and blue shades for activity intensity; a playful one-line footnote comparison ("You've used ~44565× more tokens than Moby-Dick"). The file itself was a temporary screenshot and is not saved.
