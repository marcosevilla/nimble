# Design facelift scorecard — 2026-09-22

Scores are 1–5 per dimension (UI / Interaction / UX / Accessibility), from `docs/audit-findings/<surface>/2026-09-22-loop<N>.md`. "After" columns are filled by the re-score step of each loop.

## Loop 1 — baseline (before any fix)

| Surface | UI | Int | UX | A11y | Avg | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|
| Today | 3 | 2 | 2 | 3 | 2.50 | 9 | 10 | 5 |
| Tasks + detail | 3 | 2 | 3 | 2 | 2.50 | 6 | 8 | 6 |
| Inbox | 3 | 2 | 2 | 2 | 2.25 | 5 | 12 | 4 |
| Goals | 3 | 2 | 3 | 2 | 2.50 | 6 | 11 | 6 |
| Session | 2 | 2 | 3 | 2 | 2.25 | 5 | 8 | 6 |
| Docs | 3 | 2 | 3 | 2 | 2.50 | 3 | 10 | 7 |
| Settings + setup | 2 | 2 | 2 | 3 | 2.25 | 4 | 16 | 3 |
| Shell | 3 | 2 | 3 | 2 | 2.50 | 7 | 12 | 5 |
| **Grid** | 2.75 | 2.00 | 2.63 | 2.25 | **2.41** | **45** | **87** | **42** |

Root causes shared by every surface (see `2026-09-22-loop1-plan.md`):
1. Focus ring imperceptible (`--ring/50`, measured 1.44:1 light) and zero `prefers-reduced-motion`.
2. Hardcoded palette colors (73 sites) where `--success` and friends exist or should.
3. Mouse-only rows and hover-only actions on Tasks, Inbox, Docs, Goals; advertised shortcuts (`j/k`, `?`, `g`-prefix, ⌥M) not wired.
4. Urgency-performing copy and color (red past-due dates, "needs attention", "Overdue Check-in", Title Case).
5. Seven page frames, four card recipes, three ring recipes, ≈45 literal durations.

## Loop 1 — after (re-scored 2026-09-23 on main `988d048`)

Scored after Stages A+B+C and Agentation passes 1+2, with the same rubric and anchor as the baseline. Per-surface files: `docs/audit-findings/<surface>/2026-09-23-loop1-rescore.md`. Screenshots: `screenshots/loop1-rescore/`.

| Surface | UI | Int | UX | A11y | Avg | Δ | P1 left |
|---|---|---|---|---|---|---|---|
| Today | 4 | 3 | 3 | 4 | 3.50 | +1.00 | 6 (5 carried, 1 new) |
| Tasks + detail | 4 | 4 | 3 | 3 | 3.50 | +1.00 | 2 (1 + 1) |
| Inbox | 4 | 3 | 3 | 4 | 3.50 | +1.25 | 1 (0 + 1) |
| Goals | 4 | 3 | 3 | 4 | 3.50 | +1.00 | 2 (1 + 1) |
| Session | 3 | 4 | 3 | 4 | 3.50 | +1.25 | 1 (0 + 1) |
| Docs | 3 | 3 | 4 | 3 | 3.25 | +0.75 | 2 (1 + 1) |
| Settings + setup | 3 | 3 | 3 | 4 | 3.25 | +1.00 | 3 (2 + 1) |
| Shell | 4 | 3 | 3 | 3 | 3.25 | +0.75 | 3 (1 + 2) |
| **Grid** | 3.63 | 3.25 | 3.13 | 3.63 | **3.41** | **+1.00** | **20** (11 + 9) |

P2 left ≈ 67 (per-surface counts; each includes new P2s found this pass). Baseline was 45 P1 / 87 P2.

Stop-condition check (`docs/prompts/2026-09-22-design-facelift-loop.md`): P1 > 0 and the grid gained 1.00 (≥ 0.2), so loop 2 is warranted.

What loop 1 bought: Interaction (+1.25) and Accessibility (+1.38) moved most — focus ring, reduced motion, the shortcut registry and keyboard rows landed everywhere. UX moved least (+0.50): it is held back by IA items already queued for Marco or loop 2 (Settings sub-pages, task-detail edit model, routing vocabulary).

New P1 themes from the re-score (9 new P1s, most from the Agentation shell changes):
1. **Key handlers fire outside their region.** Calendar rail eats `t`/`←`/`→` typed in Inbox capture while hovered (`CalendarPanel.tsx:446-466`); Docs-tree arrows also drive the Inbox/Tasks list handlers (`d` can dismiss a capture); Today's page-wide Enter handler (`TodayPage.tsx:150-163`) swallows Enter on every focused button in the review. One fix: scope global key handlers to the focused region.
2. **Nav trees.** The Tasks project tree rows are click-only `<div>`s (Tab skips every project); an open tree pushes Goals/Activity off screen at the 800px default window (`NavSidebar.tsx:378`), worse with 63 real projects.
3. **Habits behind a tab.** Habit check-off lives only in the right rail, which opens on Calendar with no shortcut to the Habits tab.
4. **Token/weight leftovers.** Raw amber in the rail heatmap; `font-medium` in `CommandBarResults.tsx:268,285`; `font-bold` on the Goals ✓ badge; template-literal class in Settings.

Also found (P2, real data only): the Activity log shows completed tasks as "Status changed" with no name and logs no focus sessions since `b48ee12` — the mock hides this because it logs `task_completed`, which the backend never writes (NEEDS RUST).
