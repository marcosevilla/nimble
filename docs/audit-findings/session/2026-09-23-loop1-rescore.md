# Session — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/session-{light,dark}.png (baselines: loop1-before/session-*.png)

Main at `988d048`. Read-only, no browser. Only the Timeline tab (default state) was captured this round. Focus view, banner, completion note, Sessions tab, the rail Activity heatmap and the error and empty states are judged from code. Since the baseline, the focus system was replaced by the Focus Queue engine (`b48ee12`, merged into main), so most focus anchors point to new files. The timeline rows in the screenshot look right only because `tools/mock-tauri.js:956` logs `task_completed`, and the real backend never does (N-P2-1).

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 2 | 3 | Palette literals are gone from this surface (`text-green` = 0 app-wide; `lib/activityMeta.ts:11-20` has four semantic roles), and PageFrame and motion tokens are in. Still left: `▶`/`•`/`⚡` glyphs on the Sessions tab, rows at about 31px, four raw amber `oklch` literals in the rail heatmap, and the page-title role drift |
| Interaction | 2 | 4 | Enter/Esc/`s` work in FocusView (`FocusView.tsx:52-80`, `keyGuard.ts:67-76`). The completion note never starts the next task (`FocusCelebration.tsx:14-35`). Changing page collapses the view to the banner (`Dashboard.tsx:102-108`). Timeline has an error state with a retry. The remaining notes are minor: controls are 24–28px |
| UX | 3 | 3 | Focus entry points, round copy and the no-guilt empty states are fixed. But on real data the log misreports its core content: completions show as "Status changed" with no task name, focus is no longer logged, and the summary and heatmap undercount (N-P2-1, N-P2-2). The page is also named Activity/Session inconsistently, and a day with only noise entries renders blank |
| Accessibility | 2 | 4 | A global `prefers-reduced-motion` rule (`index.css:565`) and a silent chime (`lib/sound.ts:13`). The completion note has `role="status" aria-live` (`FocusCelebration.tsx:39-40`), "Show all" has `aria-pressed`, and the focus ring is global. Minor gaps: the Sessions disclosure has no `aria-expanded`, and targets are below 40px |

Average: 2.25 → 3.5 (the baseline file rounded its average to 2.3)

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | No reduced-motion handling | Fixed | `apps/desktop/src/index.css:565-600` (global block; keyframes off, `animate-in` opacity-only); `lib/sound.ts:9-13` (chime silent under reduce); confetti overlay removed (`FocusCelebration.tsx:37-63` is an inline note) |
| P1-2 | Escape on celebration starts next task | Fixed | `components/focus/FocusCelebration.tsx:14,24-35` (Enter/Escape/Space/click/timeout only dismiss; next stays paused); copy "…is ready when you are." `:54` |
| P1-3 | No Complete/Stop/Minimize shortcuts | Fixed | `components/focus/FocusView.tsx:52-80` + `lib/keyGuard.ts:67-76` (Esc→minimize, Enter→complete, `s`→stop); `<Kbd>Esc</Kbd>` hint `FocusView.tsx:139`; registry `lib/shortcuts.ts:130-134` |
| P1-4 | Hardcoded green; `--success` unused | Fixed | `grep -rn "text-green\|green-500" src` → 0; `FocusCelebration.tsx:41,43` `bg-success/10`/`text-success`; `FocusTaskCard.tsx:63` `hover:border-success`; confetti hexes gone |
| P1-5 | Timeline 8 raw hues | Fixed | `lib/activityMeta.ts:11-20,33-76` (four roles), shared by `ActivityTimeline.tsx:10` and `detail/TaskActivityLog.tsx:7` |
| P2-1 | Nav locked while expanded | Fixed | `components/layout/Dashboard.tsx:102-108` (page change → `setExpanded(false)`) |
| P2-2 | "Round 0 of 2 complete" | Fixed | Rewritten: `lib/focusQueueIntents.ts:158-165` (`Break · round ${round} of ${rounds}`; old FocusView copy removed) |
| P2-3 | No focus entry from row/detail | Fixed | `tasks/LocalTaskRow.tsx:180` (`TaskRowActions`), `detail/TaskDetailPage.tsx:447` (`TaskFocusControls`), `lib/shortcuts.ts:105` (`f` on focused row). The plan queued the detail header for Marco (#12), but it shipped with the Focus Queue work |
| P2-4 | Timeline errors shown as empty day | Fixed | `components/activity/ActivityTimeline.tsx:114,128-131,153-162` (neutral copy + Try again, `role="status"`) |
| P2-5 | Type scale drift | Fixed | `docs/typography-system.md:13-20` = `index.css:37-54` (8 tokens). New role drift from the title recipe is logged separately as N-P2-5 |
| P2-6 | Motion bypasses tokens | Partly | Focus/activity: 0 `duration-N` (grep). Left: `pages/SessionPage.tsx:128` `transition-transform` has no token duration; `index.css:531` `checkmark-draw 600ms` literal (the curve is tokenised) |
| P2-7 | Round dot / ring track invisible | Fixed | Ring and dots removed in the engine rewrite; round is now a text caption (`lib/focusQueueIntents.ts:164`) |
| P2-8 | Text glyphs instead of lucide | Open | `components/pages/SessionPage.tsx:132` (`▶` rotated), `:162` (`• `), `:168` (`⚡`) |
| P3-1 | Infinite pulse while paused | Fixed | `grep animate-pulse components/focus components/activity` → 0 |
| P3-2 | Wiki-link spans use interactive color | Open | `components/pages/SessionPage.tsx:42` (`text-accent-blue` span, no handler) vs `:50` (link) |
| P3-3 | Sub-40px targets | Partly | Minimize is `Button size="sm"`, 28px tall (`FocusView.tsx:136`). Banner buttons are `icon-sm`, 28×28 (`FocusBanner.tsx:66-79`, `ui/button.tsx:35-36`). "Show all" is `size="xs"`, 24px, with `aria-pressed` (`ActivityTimeline.tsx:181-189`). Better than baseline but still under the 40px craft target |
| P3-4 | Redundant heading, 31px rows | Partly | The heading is renamed "Today" rather than removed (`ActivityTimeline.tsx:179-193`), so the stack is h1 "Activity" → "Timeline" tab → summary → "Today" h3, and the summary sits *above* its own heading (`:175`). Rows are still `py-1.5` (`:83`), about 31px measured in `loop1-rescore/session-light.png` (row tops 248→278) |
| P3-5 | Celebration silent to AT; chime not mutable | Fixed | `FocusCelebration.tsx:39-40,48` (`role="status" aria-live="polite"`, sr-only "Completed"); mute via `FocusView.tsx:154-155` (`soundMuted`) + `lib/sound.ts:13` |
| P3-6 | Technical copy in Sessions states | Fixed | `components/pages/SessionPage.tsx:225-236` ("Couldn't read today's session log.", raw error in `title`; "Nothing logged yet today.") |
| — | UTC "today" in ActivityTimeline / TaskActivityLog | Deferred | `ActivityTimeline.tsx:117`, `detail/TaskActivityLog.tsx:43` (`toISOString().slice(0,10)`). Queued as a Stage C minor in `NEXT.md:84` |
| — | Energy sparkline | Deferred | NEEDS RUST (`NEXT.md:97,107`); not rendered on this surface |

## New findings

### N-P1-1 Rail Activity heatmap paints with four raw `oklch` literals
- Anchor: `apps/desktop/src/components/activity/ActivityHeatmap.tsx:11-17` (`AMBER_LEVELS`), `:144` (literal border `oklch(from var(--border) … / 0.15)`)
- Rubric: §3.4 (hardcoded colors instead of frame theme vars) + §1.4
- Screens: not captured. The rail is hidden on the Activity page (`lib/rightRail.ts:8`) and the rescore set shows the Calendar tab, so this is judged from code
- What's wrong: The warm-amber ramp itself was a Goals decision. What breaks §3.4 is how it's applied: the same four values render in both themes and never go through `themes.css`. Moving the heatmap into the Activity tab (`5a9ee7b`, lifted from Goals) put it on this surface, and the Stage B color gate only greps Tailwind palette names, so it missed these. Amber also now means two things: activity intensity here and `--warning` in the sync banner (`SyncHealthBanner.tsx:71`).
- Fix: `CROSS-SURFACE` (Goals owns the palette decision). Add `--heat-1..4` to both `themes.css` blocks, derived from the warm accent. Read them via `var()`, and use `var(--border)` at a token alpha for empty cells.

### N-P2-1 Completions on real data read as "Status changed", with no task name and no count
- Anchor: `nimble-core/src/db/tasks.rs:364-371` and `nimble-core/src/db/focus/engine.rs:1093-1095` (a completion logs `status_changed {old_status,new_status}` or `task_recurred`, never `task_completed`); `apps/desktop/src/components/activity/ActivityTimeline.tsx:35` (description is `todo → complete`, with no title), `:54` (the "N completed" summary counts `task_completed` only); `lib/activityMeta.ts:35,39` (no `task_recurred` entry, so it falls back to a neutral "Task recurred" with `Zap`); `components/activity/ActivityPanel.tsx:20` (heatmap "Tasks" = `task_completed` + `task_recurred`)
- Rubric: §2.5 (a visible timeline of what the user did) + cross-surface inconsistency
- Screens: light `loop1-rescore/session-light.png`, dark `loop1-rescore/session-dark.png`. These show the *mock* state; `tools/mock-tauri.js:956` logs `task_completed`, which hides the defect
- What's wrong: On Marco's real data, finishing a task shows a gray "Status changed — todo → complete" with no task name. The summary never says "N completed", and the rail heatmap's Tasks mode counts only recurring completions. So the page meant to record what he did fails on the one action that matters most.
- Fix: Frontend only. Render `status_changed` with `new_status === 'complete'` as "Completed task" in the `done` color, with the title looked up by `target_id` from local tasks. Add `task_recurred` to `ACTION_META` as "Completed (repeats)". Derive the completed count and the heatmap from `getLog`, not `getSummary`. Make the mock log `status_changed` so the harness reflects reality. Optionally, `NEEDS RUST → queue for Marco`: include `content` in `status_changed` metadata.

### N-P2-2 Focus sessions are no longer logged at all
- Anchor: `b48ee12` removed the legacy `focus_started`/`focus_completed` writes along with `startSession`/`endSession`. `nimble-core/src/db/focus/engine.rs:1079-1099` logs only task events. `ActivityTimeline.tsx:55,60` ("N focus sessions") and `lib/activityMeta.ts:51-56` (six `focus_*` rows) now have nothing to read
- Rubric: §2.5 ("Every action logged: … focused …") + cross-surface (Focus ↔ Activity)
- Screens: not captured (the mock still returns old-shape rows)
- What's wrong: The Focus Queue engine records durable segments but writes no activity row. A focused morning therefore leaves no trace on the Activity timeline, and the summary line's focus count can never appear. This is a regression since the baseline, not a pre-existing gap.
- Fix: `NEEDS RUST → queue for Marco`. The engine should call `activity::log_activity` on start, pause, complete and stop (fire-and-forget, per the architecture rule), with `task_content` and `duration_secs` in metadata. Once it does, the existing `getDescription` (`ActivityTimeline.tsx:39`) renders "Focused for 25m" as is.

### N-P2-3 A day with only "noise" entries renders a heading over nothing
- Anchor: `apps/desktop/src/components/activity/ActivityTimeline.tsx:164` (the empty-state check uses `entries`, not `filtered` from `:151`); `App.tsx:31,115` (`app_opened` and `page_viewed` are logged the moment the app opens)
- Rubric: §1.1 (positive empty states) + §2.5
- Screens: not captured (the mock day has real entries)
- What's wrong: On a fresh morning the log already holds `app_opened`/`page_viewed`, so the empty state never shows. The user sees "Today", a "Show all" button and blank space, with no summary (`SummaryBar` returns null at `:51`). This is likely the most common state on first visit each day.
- Fix: `if (filtered.length === 0 && !showNoise)` → the existing `EmptyState` copy, keeping "Show all" available as its action.

### N-P2-4 One page, three names: Activity, Session, and a second "Activity"
- Anchor: `components/layout/NavSidebar.tsx:55` and `pages/SessionPage.tsx:252` ("Activity"); `lib/shortcuts.ts:54` ("Go to Session"), `:129-134` (a "Session" section that actually documents FocusView keys and repeats the Focus rows at `:73`); `layout/RightSidebar.tsx:19` (rail tab "Activity" = a 365-day heatmap), hidden on this page by `lib/rightRail.ts:8`
- Rubric: §1.5 (shortcuts discoverable via `?`) + cross-surface inconsistency
- Screens: light `loop1-rescore/session-light.png` (nav "Activity"); the help panel lives in `loop1-rescore/shell-help-{light,dark}.png`
- What's wrong: The help panel tells you `g s` goes to "Session", a word that no longer appears in the nav. "Session" in the help panel now means the focus view. "Activity" means today's list in the nav but a year-long heatmap in the rail, and you can never see both at once, because the Activity page hides the rail.
- Fix: Keep `g s` (§1.5 names GS). Relabel it "Go to Activity" and fold the Session shortcut rows into Focus, removing the duplicates. Then pick one of two options: put the heatmap at the top of the Activity page as its overview, or rename the rail tab ("History"). The first option is recommended.

### N-P2-5 The page-title recipe re-opened title-role drift
- Anchor: `components/shared/PageHeader.tsx:15-19` (`PAGE_TITLE = 'text-display'`, 20px); `index.css:47` (`--text-title` = "page titles"), `:49` (`--text-display` = "editor H1, celebration moments"); `docs/typography-system.md:59-60` (SectionTitle and PageTitle = `text-title`) vs `shared/typography.tsx:123` (SectionTitle = `text-body-strong`) and `:148` (PageTitle = `text-title`)
- Rubric: §3.4
- Screens: light `loop1-rescore/session-light.png`, dark `loop1-rescore/session-dark.png` ("Activity" at 20px over a 13px "Today")
- What's wrong: The token *set* now matches, but the *roles* disagree three ways. The doc and CSS comments say page titles are 15px, the recipe renders 20px, and the `PageTitle` primitive still renders 15px. Anyone following the doc builds the wrong header. Reported once.
- Fix: `CROSS-SURFACE` (every PageFrame page). Update the `index.css` comments and `typography-system.md` to "page titles = display, section titles = body-strong", and point `PageTitle` at `PAGE_TITLE` (or delete it if unused).

### N-P2-6 Rail heatmap hides load failures and mislabels habit intensity as check-ins
- Anchor: `components/activity/ActivityPanel.tsx:57,74` (`.catch(() => setHabitDays({}))` / `setTaskDays({})`), `:54` (sums `intensity` 1–5), `:93,96` (labelled "check-ins")
- Rubric: §2.5 + §1.6 (truthful feedback). The same defect as the fixed P2-4, now on the rail
- Screens: not captured
- What's wrong: A failed query renders as a full year of "nothing logged". One habit logged at intensity 3 reads as "3 check-ins".
- Fix: Add a `failed` state with the same neutral "Couldn't load activity. Try again" row as `ActivityTimeline.tsx:153-162`, and count logs (`+1`) rather than summing intensity. Alternatively, keep the sum and label it "effort".

### N-P2-7 The sync-health strip is the loudest element on a reflection page
- Anchor: `components/shared/SyncHealthBanner.tsx:66-88` (full-width `bg-warning/5` strip on every page, no dismiss or snooze, polls every 60s at `:9,29`), `:59` (`toast.error(\`Todoist sync failed: ${e}\`)` prints the raw error)
- Rubric: §1.4 (earned attention: chrome dimmer than content) + §1.1 (the same technical-copy class as the fixed P3-6)
- Screens: light `loop1-rescore/session-light.png`, dark `loop1-rescore/session-dark.png` (top strip)
- What's wrong: A stale-but-working sync after only one hour puts a tinted, full-width row with a button above the page title on every surface, and nothing can quiet it. On a failure the toast shows the Rust error verbatim.
- Fix: `CROSS-SURFACE` (shell-owned; every page). Show the stale state as a dim status in the nav footer or Settings row, and keep the strip for `error` only. Change the toast to "Couldn't reach Todoist. Try again from Settings.", with the detail in a tooltip.

### N-P3-1 Sessions-tab disclosure doesn't expose its state
- Anchor: `components/pages/SessionPage.tsx:122-125` (`<button onClick=…>` with no `aria-expanded`/`aria-controls`; the state lives only in the rotated glyph at `:126-133`)
- Rubric: §1.5 + craft: Hit areas & states (make-interfaces-feel-better). Accessibility
- Screens: not captured (Sessions tab); baseline `loop1-before/session-sessions-tab-{light,dark}.png`
- What's wrong: Screen readers announce a button with no open or closed state, and every card starts expanded (`:118`), so a keyboard user can't tell what Enter will do.
- Fix: Add `aria-expanded={expanded}` and `aria-controls` on the bullets container. The P2-8 `ChevronRight` swap then carries the visual state.

## Remaining P1 count: 1 (baseline carry-over 0 + new 1)
Remaining P2: 9 (carry-over P2-6 Partly, P2-8 Open + new 7). Remaining P3: 4 (carry-over P3-2, P3-3, P3-4 + new 1). Deferred: 2.
