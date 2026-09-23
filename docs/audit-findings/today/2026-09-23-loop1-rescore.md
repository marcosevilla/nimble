# Today — Loop 1 re-score (2026-09-23)

Baseline: `2026-09-22-loop1.md` · Screenshots: `loop1-rescore/today-review-{light,dark}.png`, `loop1-rescore/today-dashboard-{light,dark}.png` (main at `988d048`); compared against `loop1-before/today-*.png`.

Method: I checked every baseline finding against current code on main. I didn't use a browser. States missing from the four screenshots were judged from code and are marked "code". The harness caveat still applies: mock tasks are dated 2026-08-01, so the dashboard task list is empty in both shots, and row density is judged from `TaskItem.tsx`.

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3/5 | 4/5 | Every card uses one recipe: `surface-panel` in `TodayPage.tsx:80`, `:244`, `ReminderCatchUp.tsx:87` and `PrioritiesSection.tsx:266`. Raw-palette literals are at 0, the date strip is a `text-meta` control (`DateStrip.tsx:21`), and page titles follow one recipe. Minor notes: `--destructive` is reused as a source dot, the pending step is dimmed twice, and brief headers have a dead hover. |
| Interaction | 2/5 | 3/5 | Dismiss is optimistic with a 5 s Undo toast (`ReminderCatchUp.tsx:46-84`). Motion is fully tokenized with a reduced-motion block (`index.css:565`), and scroll resets on hand-off (`TodayPage.tsx:467-471`). The keyboard path is still broken: energy has no key, the window-level handler swallows Enter on every focused button in review mode, and a failed AI call still traps the user. |
| UX | 2/5 | 3/5 | Reminders now sit below the header with neutral copy. The brief's "Overdue Check-in" heading shows as "Still open" (`briefParser.ts:11-13`). The lane runs Priorities → Tasks → collapsed Brief, and habits moved to the rail. Still open: the review asks for two confirmations, the header shows "2 remaining" for tasks the page never lists, a sync banner sits above the title, and about 8 items are visible above the fold. |
| Accessibility | 3/5 | 4/5 | There's a global `:focus-visible` ring. Dark `--muted-foreground` is 5.93:1 on card (`themes.css:83`). Reminders are an `h2` region, date controls have `aria-label`s, and reduced motion is respected. Minor notes: sibling cards mix `h2` and `h3`, the pending step title measures 1.85:1, and regenerate is named only by `title`. |

Average: 2.5 → 3.5

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | Reminder strip performs urgency (red alert, "needs attention") | Fixed | `ReminderCatchUp.tsx:111` now reads "No valid time yet — open the task to pick one". The refresh error is `<Meta>` (`:104`), with no `role="alert"` and no `text-destructive`. The title is "Reminders" (`:102`). |
| P1-2 | Strip mounted above page header, outweighs page | Fixed | It renders inside `PageFrame`, below the `h1`, in both modes (`TodayPage.tsx:175`, `:363`). It uses `surface-panel px-4 py-2` (`ReminderCatchUp.tsx:87`) and is labelled by an `h2` (`:88-90`). Residual: four full-foreground ghost buttons for two rows (`:114-115`). |
| P1-3 | One decision wrapped in two confirmation clicks | Open | The flow is still "Next ↵", then energy, then "Ready to go ↵" (`TodayPage.tsx:197-201`, `:207-214`). The step still stacks a second "How's your energy?" heading and an explainer (`PrioritiesSection.tsx:158-162`). |
| P1-4 | Failed priorities call traps user in review | Deferred | Queued for Marco #1 (Rust `set_review_complete`). The frontend half the plan called executable was not done either: the error state still offers only "Try again" (`PrioritiesSection.tsx:216`) and renders raw `String(e)` (`:138`, `:215`). |
| P1-5 | No single-key shortcuts on Today | Open | There's no key handler on the energy buttons (`PrioritiesSection.tsx:167-176`), and the registry has no Today section (`lib/shortcuts.ts:49-98`). Only Enter is bound (`TodayPage.tsx:150-163`), and it's unlisted. The date control's ‹ › buttons are mouse-only apart from Tab. |
| P1-6 | Raw palette and non-semantic accent-blue | Partly | Fixed: `text-success` checks (`BriefDisplay.tsx:103`, `:122`), a neutral source pill with a 6 px dot (`PrioritiesSection.tsx:72-75`), muted Sparkles (`:159`, `:228`), and no blue today pill (`DateStrip.tsx`). Raw-palette grep is 0. Still open: `--destructive` serves as the Todoist source dot (`PrioritiesSection.tsx:27`) and the error icon (`:212`), against the plan's own rule that "`--destructive` is reserved for destructive actions". |
| P1-7 | Brief renders "## Overdue Check-in" verbatim | Fixed | `lib/briefParser.ts:11-13` maps it to "Still open", `:17-23` strips the leading emoji, and `DEFAULT_OPEN` is keyed on the normalised name (`:26-36`). |
| P1-8 | Template-literal classNames dodge tailwind-merge | Partly | The token groups are now registered (`lib/utils.ts:17-41`), and the Priorities site is a plain string. The leftover `!text-label` override is now unnecessary (`PrioritiesSection.tsx:70-72`). `TaskItem.tsx:32` and `:76` are still template literals and render on Today via `LocalTaskRow`. |
| P1-9 | Dismiss round-trips, disables all, no undo | Fixed | Rows are removed optimistically, and the acknowledge fires on toast close with Undo (`ReminderCatchUp.tsx:46-84`). No `disabled={busy}` remains. |
| P2-1 | Task list buried; ~8 items above fold | Partly | The lane order is fixed and habits are out of the primary lane (`TodayPage.tsx:354-410`). The date strip is gone from the lane. In `loop1-rescore/today-dashboard-light.png`, reminders take 140 px and a 350 px prose priorities card follows. Tasks start near y≈645, so roughly 8 items are visible, well short of the 15–25 target. |
| P2-2 | Still-open tasks never appear | Deferred | Queued #2 (Rust `dueOnOrBefore`). The query is still `useLocalTasks({ dueDate: today })` (`TodayPage.tsx:314`). |
| P2-3 | Review→dashboard instant remount, re-fetch, restyle | Partly | Scroll resets before paint (`TodayPage.tsx:467-471`). The brief is read once and handed to both modes (`:429-438`), and both modes use one `PageFrame` column and one surface. Still open: the swap is an unanimated remount with no `--ease-entrance` stagger, and the day's one designed moment is a hard cut. |
| P2-4 | Four card recipes | Fixed | The `surface-panel` utility (`index.css:173-175`) is used by ReviewStep (`TodayPage.tsx:80`), BriefCard (`:244`), Reminders (`ReminderCatchUp.tsx:87`) and Priorities (`PrioritiesSection.tsx:266`). |
| P2-5 | DateStrip heaviest band, duplicates rail | Fixed | It's now "‹ Today ›" in `text-meta`, inside the brief card header (`DateStrip.tsx:21-55`, `TodayPage.tsx:245-248`). |
| P2-6 | Reminder time is raw `toLocaleString()` | Fixed | `lib/reminderTime.ts:8-13` produces "Aug 1 · 9:00", rendered in `<time dateTime>` (`ReminderCatchUp.tsx:112`). |
| P2-7 | Footer reads "Energy: set" | Partly | On reload, `cachedEnergy` is forwarded (`TodayPage.tsx:451`, `:366`) and shows "Energy: high". On the same-session hand-off, `handleReviewComplete` (`:460-463`) sets only priorities, so the dashboard mounts with `initialEnergy={null}` and prints "Energy: not set" (`PrioritiesSection.tsx:249`) right after the user picked one. (code) |
| P2-8 | Type-scale doc vs CSS drift | Fixed | `docs/typography-system.md:5-19` is regenerated from `index.css`, with 0 `text-heading/caption/display-xl` usages. New drift from the page-title recipe is logged as N-P2-4. |
| P2-9 | No energy sparkline, no triage step | Deferred | Queued #3 (Rust energy-history query, plus Marco's decision on the two-step review). |
| P2-10 | Dark muted-foreground below AA on cards | Fixed | `themes.css:83` sets `oklch(0.66 0.01 60)`, which measures 5.93:1 on card and 6.39:1 on background. |
| P3-1 | Hardcoded durations, `transition-all` | Fixed | `duration-[0-9]+` count is 0 and `transition-all` count is 0 app-wide. In-scope sites use `duration-(--transition-*)` (`TodayPage.tsx:49`, `:250`, `BriefDisplay.tsx:22`). |
| P3-2 | No reduced-motion guard | Fixed | `index.css:565-600` zeroes the transition tokens, disables app keyframes including `animate-progress-enter`, and reduces `animate-in` to opacity-only. |
| P3-3 | Hit areas under 40 px | Partly | The date ‹ › buttons get a 40 px-tall `after:` target (`IconButton.tsx:17-20`). Still small: regenerate is `icon-xs` (24 px) and named only via `title` (`PrioritiesSection.tsx:231-236`). "Change" (`:251-256`), "Dismiss all" (`ReminderCatchUp.tsx:93-99`) and the brief `CollapsibleBlock` trigger (`BriefDisplay.tsx:244-246`) have no padding. |
| P3-4 | Dead hover on brief section headers | Open | It's still `text-muted-foreground group-hover:text-muted-foreground` (`BriefDisplay.tsx:25`). |
| P3-5 | Inactive step title 1.85:1 / 1.65:1 | Open | `opacity-40` (`TodayPage.tsx:80`) still sits on a `text-muted-foreground` title (`:92`). The C1 fix covered done steps only. It's visible in `loop1-rescore/today-review-{light,dark}.png` (step 2). |

## New findings

### N-P1-1 Review mode swallows Enter on every focused control
- Anchor: `apps/desktop/src/components/pages/TodayPage.tsx:150-163`. The window `keydown` handler exempts only `input, textarea, [contenteditable]` and calls `e.preventDefault()` before checking the step.
- Rubric: §1.5, §3.6
- Screens: not visible in a still (keyboard). Traced in code. Pre-existing (identical at `1c2caa7^`) and missed by the baseline. It matters more now that Stage A made Tab focus visible.
- What's wrong: when Tab lands on "Dismiss", "View task", a brief section header, an energy button, "Change" or "Try again", pressing Enter cancels the button's native activation. In step 1 it advances the review instead. In step 2, before priorities exist, it does nothing. The energy choice, the one decision in the flow, can't be made with Enter.
- Fix: return early when `target.closest('button, a, [role="button"], [role="tab"]')` is not the step's own advance button, and call `preventDefault` only when the handler actually advances.

### N-P2-1 Header says "N remaining" for tasks the page never lists
- Anchor: `TodayPage.tsx:346-352` (Obsidian daily-note tasks are counted), `:359-360` (the count goes into the header meta and progress bar), `:398-399` (the code comment admits they "aren't listed")
- Rubric: §2.1 ("merged Obsidian + Todoist + native tasks in one prioritized list"), §1.2 ("don't make the user choose where to look")
- Screens: light `loop1-rescore/today-dashboard-light.png` and dark `…-dark.png` show "Good morning · 2 remaining" and "1/3" with no task list on the page.
- What's wrong: this is pre-existing. Agentation pass 1 promoted it from the body into the page title row. The most prominent number on Today points at items the user has to go to Obsidian to find. The meta line and the progress bar also state the same count twice.
- Fix: render the daily-note tasks as rows in the Tasks group (read-only source icon), or count only listed tasks. Keep one of "N remaining" or "n/t", not both.

### N-P2-2 Sync banner outranks the Today title every stale morning
- Anchor: `components/shared/SyncHealthBanner.tsx:66-78` (a 40 px band with `text-body` foreground copy and a secondary button), `components/layout/Dashboard.tsx:293` (mounted above every page), `lib/syncHealth.ts:3` (1 h threshold)
- Rubric: §1.4 ("earned attention: chrome dimmer than content"), §1.1 (elapsed-time framing on the morning surface)
- Screens: light `loop1-rescore/today-review-light.png`, dark `…-review-dark.png`. The banner is the first line above "Today".
- What's wrong: new since the baseline (`3e45ca2`). After a night with the Mac asleep, the first thing the guided morning shows is "Todoist hasn't synced in over an hour." at full body contrast, above the `h1`. It clears only on the next 60 s poll or window focus, not when a sync finishes. Its `px-4` gutter also doesn't line up with the 640 px column below.
- Fix: show only `error`, or `stale` beyond a much longer window (for example 12 h, and not in the first minutes after launch). Render stale as a `text-meta` muted row, and refresh on the sync-complete event. CROSS-SURFACE (every page).

### N-P2-3 Today's task list ignores j / k / x / s that Help advertises
- Anchor: `TodayPage.tsx:369-395` (a `LocalTaskRow` list with no `useTaskNavigation`), `lib/shortcuts.ts:63-68` ("Tasks" section: j/k/x/s/Enter), `hooks/useTaskNavigation.ts:171` (wired only in TasksPage, ProjectDetailPage, SectionedTaskList and InboxPage)
- Rubric: §1.5, §3.6; cross-surface inconsistency
- Screens: not exercisable (the harness list is empty). Traced in code.
- What's wrong: the Help panel lists row shortcuts globally, and they work on Tasks and Inbox. The morning list is the one surface where `j` and `x` do nothing. Enter still opens a focused row via `TaskItem.tsx:161`.
- Fix: mount `useTaskNavigation` over `topLevelLocal` ids with `useTaskRowActions`, the same as `SectionedTaskList`.

### N-P2-4 Page-title recipe reopened the type-doc drift
- Anchor: `components/shared/PageHeader.tsx:19` (`PAGE_TITLE = 'text-display …'`, 20 px) vs `docs/typography-system.md:18-19` (`text-title` = "Page titles… greeting", `text-display` = "Editor H1, celebration moments"). `components/shared/typography.tsx:58-60` `PageTitle` still uses `text-title` and has no callers.
- Rubric: §3.4
- Screens: all four `loop1-rescore/today-*` (20 px "Today").
- What's wrong: A4 had just made the doc match the CSS. Agentation pass 2 changed the page title token without updating the doc, and it left a dead second title primitive that says the opposite.
- Fix: update the two doc rows and delete `PageTitle`, or point it at `PAGE_TITLE`. CROSS-SURFACE (every page).

### N-P2-5 Sibling cards use mixed heading levels
- Anchor: `ReminderCatchUp.tsx:88` (`h2`), `TodayPage.tsx:245-246` (BriefCard `h2`), `TodayPage.tsx:92` (ReviewStep `SectionTitle` defaults to `h3`), `PrioritiesSection.tsx:160`, `:229` (`h3`), `shared/CollapsibleSection.tsx:36` (Tasks `h3`)
- Rubric: §2.1 (surface hierarchy); cross-surface inconsistency (the `SectionTitle` default is `h3`, `typography.tsx:113`)
- Screens: n/a (DOM)
- What's wrong: on the dashboard the outline reads h1 Today → h2 Reminders → h3 Today's priorities → h3 Tasks → h2 Daily brief. The four cards are peers but sit at two levels. In review, the step titles are `h3` under an `h2` that isn't their parent. NEXT.md lists this as a deferred minor, but it's anchored here so it gets tracked.
- Fix: make Today's top-level cards all `h2` (pass `as="h2"` to ReviewStep, Priorities and the Tasks section), with nested headings at `h3`.

### N-P3-1 Reminder rows have two different line rhythms
- Anchor: `ReminderCatchUp.tsx:112`. An inline `<time>` sits directly in a div, so it takes the inherited line box, while the no-time variant is a block `<Meta as="p">` (`:111`).
- Rubric: §3.5 (spacing rhythm); craft: "Optical Over Geometric Alignment"
- Screens: light `loop1-rescore/today-dashboard-light.png`, dark `…-dark.png`. Row 1's meta line sits about 4 px lower than row 2's (title→meta 22 px vs 18 px).
- What's wrong: two rows in one list have different heights for the same anatomy.
- Fix: render the time as `<Meta as="time" dateTime={…} className="block">` so both variants share one line box.

## Remaining P1 count: 6 (baseline carry-over 5 + new 1)
Carry-over: P1-3, P1-5 (Open), P1-6 and P1-8 (Partly), P1-4 (Deferred, Rust). New: N-P1-1.
Remaining P2: 10 (carry-over 5: P2-1, P2-3, P2-7 Partly; P2-2, P2-9 Deferred; new 5). Remaining P3: 4 (P3-3 Partly, P3-4 and P3-5 Open; new N-P3-1).

## Cross-surface notes
- The Habits tab in the right rail uses Sparkles (`layout/RightSidebar.tsx:18`), the same glyph as the AI priorities heading on this page (`PrioritiesSection.tsx:228`). One icon now means two things on one screen.
- The calendar now-line is still saturated red in both themes (`calendar/CalendarPanel.tsx:172`, commented as intentional). It's the highest-chroma mark on Today.
- `TodayPage.tsx:374` still uses `-mt-3!` to fight `space-y-4`.
