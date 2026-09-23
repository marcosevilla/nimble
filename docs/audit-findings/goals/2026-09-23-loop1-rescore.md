# Goals — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/goals-{light,dark}.png (main at `988d048`); compared against loop1-before/goals-{light,dark}.png. The rescore set has no timeline, Habits-tab, Activity-tab or keyboard-focus shots, so those states are judged from code only (noted per row). No browser was used for this pass.

Files read: `apps/desktop/src/components/pages/GoalsPage.tsx`, `components/goals/GoalTimeline.tsx`, `components/goals/HabitsSection.tsx`, `components/activity/ActivityHeatmap.tsx` + `ActivityPanel.tsx` (the heatmap moved here from HabitsSection), `components/layout/RightSidebar.tsx`, `stores/goalsStore.ts`, `stores/layoutStore.ts`, `lib/goalStatus.ts`, `lib/habitToggle.ts`, `lib/rightRail.ts`, `lib/shortcuts.ts`, `components/shared/SyncHealthBanner.tsx`, `components/shared/PageFrame.tsx`, token layer `index.css` + `themes.css` (warm).

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3/5 | 4/5 | 0 stock-palette literals and 0 raw `text-sm/xs` in the goals files. Progress bars are neutral `bg-foreground/70` (`GoalsPage.tsx:115`), status colors are role tokens (`goalStatus.ts:4-8`), and the header follows the shared 20px recipe in both themes. Notes left: skeleton height mismatch, one `font-bold`, `en-US` date, hardcoded amber heatmap ramp. |
| Interaction | 2/5 | 3/5 | All four baseline P1s are fixed: Enter/Space on habits (`HabitsSection.tsx:157-164`), cards and rows as buttons, an optimistic toggle with rollback (`goalsStore.ts:65-83`), click-to-complete, 0 `duration-N`/`transition-all`. But every goal mutation still swaps the page for a skeleton (`goalsStore.ts:33`), and habit check-off now sits behind a rail tab with no shortcut. |
| UX | 3/5 | 3/5 | Timeline labels stay visible and `T` snaps to today, habits show real icons and names, the Flame is gone, and the undated timeline has copy. Offsetting that: habits left Today's main lane for a rail tab that opens on Calendar by default, the "Both" heatmap saturates, and bingo and compass are still absent (deferred). |
| Accessibility | 2/5 | 4/5 | The global `:focus-visible` ring covers the card, row, habit and grid (`index.css:133`). The heatmap is one tab stop with an `aria-live` cursor readout (`ActivityHeatmap.tsx:123-153`), the Today pill is fixed (the code comment says 19.4:1; not re-measured here), and there is a `prefers-reduced-motion` block (`index.css:565`). Left: the Import icon button has no accessible name, and the filter pills are 25px. |
Average: 2.5 → 3.5

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | Habit check-off mouse-only | Fixed | `components/goals/HabitsSection.tsx:157-164` (Enter/Space on keydown, `stopPropagation` + `e.repeat` guard); focus ring from global `:focus-visible` `index.css:133-136`. Code only, no focus screenshot. |
| P1-2 | Goal cards / timeline rows click-only divs | Fixed | `components/pages/GoalsPage.tsx:59-76` (`role="button" tabIndex={0}`, Enter/Space, `e.target === currentTarget` guard); `components/goals/GoalTimeline.tsx:120-126` (rows are `<button type="button">`). |
| P1-3 | Habit toggle not optimistic, skeleton flash | Fixed | `stores/goalsStore.ts:51-54` (skeleton only when `habits.length === 0`), `:65-83` + `lib/habitToggle.ts:31-38` (flip first, roll back, rethrow); `HabitsSection.tsx:242-248` shows `toast.error`. |
| P1-4 | Hold-to-complete friction | Fixed · intensity Deferred | `HabitsSection.tsx:144-150`: click completes and the hold is optional. The intensity parameter is plan "Queued for Marco" #11 (Rust). |
| P1-5 | Stock-palette colors instead of theme vars | Fixed | `lib/goalStatus.ts:4-8` (`text-status-*`, `text-success`); `GoalTimeline.tsx:178` Today pill is `bg-foreground text-background`; the `'#f59e0b'` fallbacks are gone (`GoalsPage.tsx:56`, `GoalTimeline.tsx:118`). `GOAL_COLORS` stays as a sanctioned user-data swatch (`goalStatus.ts:19-24`). A sibling `text-white` that the baseline missed is logged as N-P3-3. |
| P1-6 | `font-*` weight stacks instead of scale tokens | Partly | Tooltip titles are now `text-meta-strong` (`GoalTimeline.tsx:233`). `HabitsSection.tsx:203-204` still carries `font-bold` and a "kept for legibility" comment on the ✓ badge, even though its color is now `bg-success text-success-fg`. |
| P2-1 | Progress fill = category color | Partly | The fill is neutral on cards (`GoalsPage.tsx:111-117`) and on the timeline (`GoalTimeline.tsx:217-222`), and the label is `text-foreground` (`:226`). The health-based fill that `goals-ux-decisions.md` decided on is not built. |
| P2-2 | Infinite `animate-pulse` on finished goal | Fixed | No `animate-pulse` remains in the goals files (grep); the bar is `transition-[width] duration-(--transition-base)` (`GoalsPage.tsx:115`). An achieved goal is still dimmed with `opacity-75` (`:74`). |
| P2-3 | Motion durations bypass tokens / `transition-all` | Fixed | 0 `duration-[0-9]` and 0 `transition-all` across the goals files (grep). The 6 bare `transition-colors` (e.g. `GoalsPage.tsx:444, 465, 482`) use Tailwind's 150ms default, which equals `--transition-fast` (`index.css:111`). |
| P2-4 | Heatmap month labels never render | Fixed | `components/activity/ActivityHeatmap.tsx:111`: the label row is `relative`. |
| P2-5 | Timeline hides labels; no Today snap | Fixed | `GoalTimeline.tsx:226` (`sticky left-2` label), `:110-113` (Today button with `T` kbd), `:75-78` (`T` key), registered at `lib/shortcuts.ts:127`. Off-screen arrow indicators are not built. Code only, no timeline screenshot. |
| P2-6 | Two habits render as identical ⭐ | Fixed | `HabitsSection.tsx:35-46, 111, 201` (Lucide icon map), `:223` (visible name). Habits created in the app still store `icon: 'Circle'` (`:357`), so they get the emoji fallback, but the name now identifies them. |
| P2-7 | Unchecked habit reads as disabled | Fixed | `HabitsSection.tsx:181-183`: unchecked is `border-border bg-card` at full opacity; checked is `bg-success/10`. |
| P2-8 | 364 tab stops in heatmap | Fixed | `ActivityHeatmap.tsx:123-147`: one `tabIndex={0}` group, arrow/Home/End cursor, cells are `<div title>`. |
| P2-9 | Flame streak icon | Fixed | `HabitsSection.tsx:275, 299` uses `Sparkles` (muted). |
| P2-10 | Header-only timeline when no dated goals | Fixed | `GoalTimeline.tsx:85-93`: the guard is on `timelineGoals.length`. |
| P2-11 | Bingo card + compass absent | Deferred | Plan "Queued for Marco" #13; `NEXT.md` roadmap item 5 (Figma-gated). `GoalsPage.tsx:337` is still `'cards' \| 'timeline'`. |
| P3-1 | Skeleton ≠ card height | Open | `GoalsPage.tsx:417` is still `h-36` (144px) for a card of about 118px (the rescore screenshot shows the same card height as the baseline). |
| P3-2 | Heatmap cells render as dots | Fixed | `ActivityHeatmap.tsx:137` `rounded-xs`, which is not overridden in `index.css:102-108`, so it is the Tailwind default of 2px. |
| P3-3 | Hold press scale 0.95 / 1.05 | Fixed | `HabitsSection.tsx:180, 184` use `active:scale-[0.96]` and `scale-[0.96]`; `scale-105` is gone. |
| P3-4 | Raw ISO date, hardcoded locale | Partly | Heatmap dates are localized (`ActivityHeatmap.tsx:25-28`) and the copy says "check-ins" (`ActivityPanel.tsx:93`). The card target date still forces `'en-US'` (`GoalsPage.tsx:138`). |
| P3-5 | Hit areas under 40px | Partly | Manage habits has a `before:-inset-2` extension (`HabitsSection.tsx:435`). The filter pills are still `px-2 py-1`, about 25px (`GoalsPage.tsx:465, 482`), and Import is `size-7` with no extension (`:444`). |
| P3-6 | Invisible pill hover | Fixed | `GoalsPage.tsx:468, 485` use `hover:bg-hover`, and `--hover` is an 8% (light) / 9% (dark) foreground mix (`themes.css:30, 85`). |

## New findings

### N-P1-1 Habit check-off left Today and now sits behind a rail tab that opens on Calendar by default, with no shortcut
- Anchor: `apps/desktop/src/components/layout/RightSidebar.tsx:16-21, 149-151`; `apps/desktop/src/stores/layoutStore.ts:36-44` (default tab `'calendar'`); `apps/desktop/src/components/pages/TodayPage.tsx:354-355` (the comment "Habits live in the right rail under the calendar" is stale: they are a separate tab, not under it); `apps/desktop/src/lib/shortcuts.ts:72` (only ⇧F opens a rail tab)
- Rubric: §1.2 (don't make the user choose where to look), §3.6 (a common action without a single-key shortcut), §2.6 ("checkable from the app")
- Screens: light `loop1-rescore/goals-light.png`, dark `loop1-rescore/goals-dark.png`, where the rail shows Calendar and Habits is an unlabeled Sparkles icon. Also `loop1-rescore/today-dashboard-{light,dark}.png`. The Habits tab itself was not captured.
- What's wrong: At baseline the habit strip sat in Today's main lane. After Agentation pass 1 it lives only in the rail's Habits tab. On a fresh install, or whenever the last tab isn't Habits, the daily check-off takes a mouse click on a 28px icon tab, or a long Tab walk through the nav trees. There is no rail on Settings or Session (`lib/rightRail.ts:7-9`), and a detail sidebar replaces the rail. The keyboard fix in P1-1 works once you're there, but getting there has no key.
- Fix: add `⇧H` next to ⇧F (`openRightTab('habits')`, toggle-closes like `toggleFocusQueue`) and register it in `SHORTCUTS`. Show the `n/m` habit count on the Habits tab trigger so today's state is visible from Calendar. Fix the stale TodayPage comment. `CROSS-SURFACE`: Today.

### N-P2-1 Every goal mutation swaps the page for a skeleton and drops the header controls
- Anchor: `apps/desktop/src/stores/goalsStore.ts:32-41` (`set({ goalsLoading: true })` on every load); `apps/desktop/src/components/pages/GoalsPage.tsx:412-421` (skeleton branch renders `PageFrame` without `actions`/`secondary`). Callers: `GoalsPage.tsx:399, 547`; `components/detail/GoalDetailPage.tsx:79, 90` (every milestone or field edit).
- Rubric: §1.6 (immediate visual response; skeletons only while loading), §3.6 (optimistic updates missing)
- Screens: not capturable from static shots; judged from code
- What's wrong: This is the same defect class as P1-3, fixed for habits but not for goals. Creating a goal, importing, or checking a milestone in the goal sidebar unmounts all cards, the view toggle, Import, New goal and the area pills, then remounts them. That contradicts PageFrame's own promise that "the header never flickers" (`PageFrame.tsx:40-41`). The baseline missed it because it audited only first load.
- Fix: in `loadGoals`, set `goalsLoading` only when `get().goals.length === 0`. Pass `actions`/`secondary` into the skeleton-branch `PageFrame` too.

### N-P2-2 The "Both" activity heatmap sums habit intensity and task counts on a 4-step ramp, so it saturates
- Anchor: `apps/desktop/src/components/activity/ActivityPanel.tsx:22-30` (default mode `'both'`), `:81-88` (adds intensity + task count); `apps/desktop/src/components/activity/ActivityHeatmap.tsx:19-23` (`value >= 4` → top level)
- Rubric: §2.6 (amber heatmap as the momentum view), §1.2 (batch information that stays readable)
- Screens: Activity tab not captured; judged from code
- What's wrong: The heatmap moved into the rail's Activity tab (Agentation pass 1) and defaults to Both. A day with two habit check-ins at intensity 1 and two finished tasks already scores 4, the maximum. With Marco's real task volume, nearly every active day renders at the darkest amber, so the view that was meant to show habit momentum stops telling days apart. It also mixes units (intensity and count) in one cell.
- Fix: default the mode to `'habits'`, or scale the four levels to quartiles of the visible window's non-zero values instead of a fixed `>= 4`.

### N-P2-3 Sync-health banner is a persistent, body-weight strip above every page, with no dismiss
- Anchor: `apps/desktop/src/components/shared/SyncHealthBanner.tsx:66-87`; mounted at `apps/desktop/src/components/layout/Dashboard.tsx:293`
- Rubric: §1.4 (earned attention: chrome dimmer than content), §1.1 (the app nudges; it does not nag)
- Screens: light `loop1-rescore/goals-light.png`, dark `loop1-rescore/goals-dark.png`. The banner shows because the mock reports a sync over an hour ago (INDEX.md), so it is harness-driven but a real state.
- What's wrong: The strip is 40px and full width, with `text-body text-foreground` copy at the same size and color as the goal titles. It sits above the page title, so on Goals the first line of the page is Todoist status rather than goals. There is no way to acknowledge it short of syncing, and it re-polls every 60s. The copy is neutral, which is good, but the weight and persistence aren't.
- Fix: `text-meta text-muted-foreground` at `h-8`, plus a "Hide until it changes" control keyed to the last-sync timestamp. `CROSS-SURFACE`: every page with the shell (Today, Tasks, Inbox, Docs, Activity). The owner is the shell, not Goals.

### N-P3-1 Import icon button has no accessible name and a 28px target
- Anchor: `apps/desktop/src/components/pages/GoalsPage.tsx:441-452`
- Rubric: §1.5; craft: Minimum hit area
- Screens: light `loop1-rescore/goals-light.png`, dark `loop1-rescore/goals-dark.png` (the download glyph left of New goal)
- What's wrong: `TooltipTrigger` wraps only an icon and carries no `aria-label`, and base-ui tooltips don't name their trigger. Keyboard and screen-reader users land on a nameless button whose action is "import from Obsidian". It is also `size-7` with no hit-area extension, unlike the fixed Manage habits button.
- Fix: `aria-label="Import from Obsidian vault"` plus the `relative before:absolute before:-inset-1.5` extension used at `HabitsSection.tsx:435`, or render it as `IconButton`.

### N-P3-2 Habit names truncate in the 288px rail
- Anchor: `apps/desktop/src/components/goals/HabitsSection.tsx:167` (`w-14` column), `:223` (`truncate`), `:311` (`flex-wrap gap-3`); `apps/desktop/src/stores/layoutStore.ts:25` (`RIGHT_DEFAULT_WIDTH = 288`)
- Rubric: §2.6, §1.2; craft (better-typography): truncation
- Screens: Habits tab not captured; judged from code
- What's wrong: The strip was sized for Today's 640px lane. In the rail's 256px content box, four 56px columns plus gaps (260px) don't fit, so the circles wrap three to a row. Each name gets 56px of `text-label`, so "Morning pages" or "Stretch 5 min" truncates. That partly undoes P2-6: the name is the only identifier for habits created in the app, which fall back to emoji.
- Fix: in the rail, lay habits out as rows (circle + full name + momentum), 36px each like other lists, or allow a two-line wrapped name.

### N-P3-3 Destructive confirm buttons hardcode `text-white`
- Anchor: `apps/desktop/src/components/goals/HabitsSection.tsx:459`; `apps/desktop/src/components/detail/GoalDetailPage.tsx:233`
- Rubric: §3.4 (hardcoded colors instead of theme vars); craft (better-colors): semantic token pairs
- Screens: dialogs not captured; judged from code
- What's wrong: The baseline missed this; it is the same class as P1-5. `themes.css` defines `--destructive` but no foreground pair, so both delete dialogs paint a literal white. Contrast is fine today, but it won't follow a theme change. These are the last palette literal in the goals files (grep).
- Fix: add `--destructive-foreground` to `themes.css` (both blocks), and use `text-destructive-foreground`, or the Button `destructive` variant if one exists.

## Remaining P1 count: 2 (baseline carry-over 1 + new 1)
- Carry-over: P1-6 (Partly: one `font-bold` badge). Deferred and not counted: the intensity half of P1-4.
- New: N-P1-1.
- P2 left: 4 (P2-1 Partly + N-P2-1, N-P2-2, N-P2-3), plus 1 Deferred (P2-11). P3 left: 6 (P3-1, P3-4, P3-5 + N-P3-1..3).

## Cross-surface notes
- The `?` help button still overlaps the bottom of the right rail (visible over the calendar in both rescore shots). It is already on the Stage C deferred-minors list.
- The Habits and Activity tabs repeat their tab label as a `SectionTitle` directly underneath (`HabitsSection.tsx:300`, `ActivityPanel.tsx:114`), giving two headings for one panel.
- The Habits tab uses `Sparkles`, the same glyph the AI priorities use (`PrioritiesSection.tsx:159`). The rail then shows the AI marker as the habits icon.
- Timeline: every goal has two tab stops with the same action, the row button (`GoalTimeline.tsx:120`) and the bar trigger (`:207`). The undated-timeline copy is a bare `<p>` (`:87-91`), not the shared `EmptyState` the card view uses.
- GoalCard's `aria-label="Open goal …"` (`GoalsPage.tsx:63`) overrides its inner text, so screen readers don't hear progress, milestones or date.
