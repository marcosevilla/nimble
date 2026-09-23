# Tasks + detail — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/tasks-list-{light,dark}.png, loop1-rescore/tasks-detail-{light,dark}.png (compared against loop1-before/ same names)

Code: main at `988d048`, `apps/desktop/src`. No browser used. Hover, focus-ring, popover and reduced-motion states are not in the re-score set, so those are judged from code (noted per row). Contrast figures use the baseline's method (oklch → sRGB, alpha composited on `--background`, warm theme).

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3/5 | 4/5 | Status and AI colors are theme tokens now (`StatusDropdown.tsx:27-31`, `themes.css:60-64,105-109`; 0 palette literals on the surface), rows are 36px, dates are `text-meta` muted, and the list shares the page-title recipe on the 640px column. Remaining notes: off-scale `rounded-[7px]` and black `rgba` shadows (5 sites), the spinner glyph for In progress, and project badges crowding titles (N-P2-2). |
| Interaction | 2/5 | 4/5 | j/k/x/s/f/Enter/Escape are wired on All tasks and project lists (`TasksPage.tsx:74`, `ProjectDetailPage.tsx:100`). Rows focus, close-focus returns to the row (`StatusDropdown.tsx` `finalFocus`), a leaf delete gives Undo, the composer keeps its draft, and motion uses the tokens. Open: the project tree in the nav is mouse-only (N-P1-1), and single-key `x`/`s` have no Undo (N-P2-5). |
| UX | 3/5 | 3/5 | Dates are no longer red, there's an "Add a task…" row with a `Q` hint, and project badges show in All tasks. Still missing: §2.2 row inline editing and a single detail edit model (both deferred). New since the baseline: a redundant badge on every project-view row, two "Inbox" entries next to each other in the nav, and a sync banner on every page. |
| Accessibility | 2/5 | 3/5 | No invisible tab stops (`SelectionCheckbox.tsx:36-42`), the status trigger is named (`StatusDropdown.tsx:153`), there's a global 4.2:1 focus ring and a `prefers-reduced-motion` block (`index.css:133,565`). Still open: the Description placeholder measures 1.78:1 light / 1.94:1 dark, `role="button"` rows contain nested controls (N-P2-1), and the nav project rows can't be focused (N-P1-1). |

Average: 2.5 → 3.5

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | j/k row navigation dead | Fixed | `components/pages/TasksPage.tsx:72-74` and `components/tasks/ProjectDetailPage.tsx:100` mount `useTaskNavigation`, with `focusedId` threaded via `SectionedTaskList`. `hooks/useTaskNavigation.ts:94-129` handles j/k/↑/↓/Enter/Escape plus x/s/f. The registry lists them in `lib/shortcuts.ts:62-68,103-105`. A live keypress wasn't retested (no browser). |
| P1-2 | Rows mouse-only, invisible tab stops | Fixed | Rows are `role="button" tabIndex={0}` with Enter/Space in `components/tasks/TaskItem.tsx:155-169`. `SelectionCheckbox.tsx:36-42` sets `tabIndex={hidden ? -1 : 0}` and reveals on `group-focus-within`. The status trigger has `aria-label` at `StatusDropdown.tsx:153`. The grip reveals on focus-within at `TaskItem.tsx:197`. The new nested-control issue is N-P2-1. |
| P1-3 | Past-due dates red | Fixed | `TaskItem.tsx:17-38`: every date is `text-muted-foreground`, and Today is `text-foreground`. The rescore screens show no red dates in either theme (`tasks-list-*`, `tasks-detail-*` subtask "Aug 1"). |
| P1-4 | Focus rings stripped | Fixed | Tasks + detail now have 0 `outline-none` / `focus-visible:ring-0` (grep). The one remaining site, `InlineDescription.tsx:56`, is Goals-only. The global `:focus-visible` is at `index.css:133-136`, and `SelectionActionBar.tsx:29-31` relies on it on purpose. Not screenshotted; code-verified. |
| P1-5 | Rows 40px; density | Partly | Rows are `h-9` (36px) at `TaskItem.tsx:171,189,212`. The section trigger is still `pt-5 pb-1` (20px, off the 8px grid) at `shared/CollapsibleSection.tsx:42`. The rescore list at 1280×800 shows 13 task rows, under the 15-row §1.4 floor, partly because of the 40px banner (N-P2-4). |
| P1-6 | `window.confirm` + no undo | Fixed | 0 `window.confirm` on the surface. A leaf delete is optimistic with Undo (`components/tasks/useDeleteTasks.tsx:35-52`, `lib/taskUndo.ts`). An AlertDialog appears only when the task has subtasks (`useDeleteTasks.tsx:64-81`), which is justified by the cascade. The composer stashes its draft instead of confirming discard (`TaskComposerCard.tsx:68-71,124-126`). An id-preserving restore still needs Rust (documented at `lib/taskUndo.ts:12-16`). |
| P2-1 | Row omits project badge | Fixed | `TaskItem.tsx:247-254` renders it, `TasksPage.tsx:77-81,130` resolves it per row, and it's visible in `tasks-list-*`. The regression this introduced is N-P2-2. |
| P2-2 | Only status editable inline | Deferred | QUEUED FOR MARCO (#6, row-level inline editing). `TaskItem.tsx:221` `PriorityBars` and `:255` `DueDateBadge` are still static. |
| P2-3 | Type scale doc drift | Fixed | `docs/typography-system.md:5-7` now documents the live 8 tokens and matches `index.css:37-55`. There are 0 `text-heading|text-caption|display-xl` usages. The residual drift is in the rubric itself: `ux-intent.md` §3.4 still names the 10-token scale (cross-surface note). |
| P2-4 | Raw `text-xs` on label chips | Fixed | 0 `text-xs`/`text-sm` in `components/tasks` + `components/detail`. |
| P2-5 | Hardcoded status/activity colors | Fixed | `StatusDropdown.tsx:27-31` uses `text-status-*`, the tokens are per-mode in `themes.css:60-64,105-109`, the AI sparkle uses `text-ai` (`TaskDetailPage.tsx:583-585`), and grep finds 0 palette literals across tasks/detail/TasksPage/NavTrees. |
| P2-6 | Detail mixes three edit models, two left edges | Deferred | QUEUED FOR MARCO (#4). `ReminderPicker.tsx:29-37` is unchanged: `px-5`, `border-b`, a "Save reminder" button, a native checkbox, and `text-body font-medium`. The "executable now" half wasn't done either. In `tasks-detail-*` the Reminder label sits at x≈333 while the chips are at x≈313. |
| P2-7 | No create affordance in All tasks | Partly | `TasksPage.tsx:134-148` adds "Add a task…" with a `Q` kbd hint, but only after the last row, so it's below the fold even with the 15 mock tasks (not visible in `tasks-list-*`). With real data (hundreds of open tasks) it's effectively unreachable by eye. |
| P2-8 | Opacity text < 3:1 | Partly | `--muted-foreground-subtle` exists (`themes.css:25,84`) and dark `--muted-foreground` was raised (`muted/70` dark 2.80 → 3.62:1), but no surface site adopted the token. `text-foreground/25` is still 1.78:1 light / 1.94:1 dark at `TaskDetailPage.tsx:534,546` and `TaskComposerCard.tsx:186,199`, `muted/60` is still 2.66:1 at `DueDatePopover.tsx:78`, and `muted/70` breadcrumbs are now codified in `shared/PageHeader.tsx:21` and copied at `TaskDetailPage.tsx:428-435`. |
| P3-1 | Off-scale radii, black shadows | Open | `rounded-[7px]` at `TaskListHeader.tsx:38`, `DueDatePopover.tsx:78,80`, `TaskDetailPage.tsx:451`. `rgba(0,0,0,…)` shadows at `DueDatePopover.tsx:204`, `SelectionActionBar.tsx:154`, `TaskComposerCard.tsx:166`. |
| P3-2 | Motion bypasses tokens / reduced-motion | Fixed | 0 `duration-N` / `transition-all` on the surface. `CollapsibleSection.tsx:46,60` use `duration-(--transition-fast)`. `index.css:565-597` zeroes the tokens and turns `animate-task-complete` into a fade and `animate-count-pulse` into none. |
| P3-3 | 16px hit areas | Partly | Status is 28px (`StatusDropdown.tsx:150-158`, `size-7 -m-1.5`), the checkbox is 32px via `after:-inset-2` (`SelectionCheckbox.tsx:47`), the grip is `size-6` (`TaskItem.tsx:197`), and the chip ✕ is 32px (`MetadataChips.tsx:90`). The nav project edit/delete controls are still 16px boxes widened only vertically, about 18×32 (`ProjectSidebar.tsx:143,151`), and the parent chevron is `w-3` (`:162`). |
| P3-4 | In-progress uses spinner glyph | Open | `StatusDropdown.tsx:29` still uses `icon: Loader`. It's visible on both In progress rows and the detail title in `tasks-list-*` and `tasks-detail-*`. |
| P3-5 | Due date in body size | Fixed | `TaskItem.tsx:32` uses `text-meta` with muted color. `tabular-nums` is still redundant with the global rule. |
| P3-6 | Project colors duplicated | Fixed | Both files now import `lib/projectColors.ts:6` (`ProjectSidebar.tsx:8`, `ProjectEditDialog.tsx:14`). |

Tally of 20 baseline findings: 12 Fixed, 4 Partly, 2 Open, 2 Deferred.

## New findings

### N-P1-1 The project tree in the left nav can't be used from the keyboard
- Anchor: `apps/desktop/src/components/tasks/ProjectSidebar.tsx:121-129` (each project row is `<div onClick>`, with no `role`, `tabIndex` or `onKeyDown`); `:140` (edit/delete are `hidden group-hover:flex`, so they aren't in the DOM for focus); mounted by `components/layout/NavTrees.tsx:34-44` into `components/layout/NavSidebar.tsx:213-216`.
- Rubric: §1.5 (keyboard-first, every common action has a key), §3.6, plus the Accessibility dimension (roles, focus order). Cross-surface inconsistency: the Docs tree in the same nav slot is a roving tree with ↑/↓/←/→/Enter (`lib/shortcuts.ts` Docs section).
- Screens: light `loop1-rescore/tasks-list-light.png`, dark `loop1-rescore/tasks-list-dark.png` (the project rows under Tasks). No focus shot exists; this is from code.
- What's wrong: Agentation pass 2 made this tree the only way into a project. "All tasks" is a `<button>`, but Tab skips every project row (Inbox, Portfolio, Nimble, Mobile app…), and nothing else opens a project from the keyboard. The sibling Docs tree is fully keyboard-driven, so the same nav behaves two different ways.
- Fix: Give the project tree the Docs `FolderTree` roving pattern: rows become `role="treeitem"` buttons with `aria-selected`/`aria-expanded`, ↑/↓ moves, ←/→ collapses and expands parents, Enter selects. Reveal edit/delete on `group-focus-within` instead of `hidden group-hover:flex`. CROSS-SURFACE: shell (nav).

### N-P2-1 `role="button"` rows wrap nested interactive controls
- Anchor: `apps/desktop/src/components/tasks/TaskItem.tsx:155-169` (row `role="button"`) contains the grip `<button>` (`:194-202`), `SelectionCheckbox` (`:204`), the status `PopoverTrigger` (`:215` → `StatusDropdown.tsx:150`) and `TaskRowActions` (`:256` → `focus/FocusTaskEntry.tsx:126-138`, which has two more buttons).
- Rubric: Accessibility dimension (roles), §1.5.
- Screens: n/a (semantics). Traced from code.
- What's wrong: ARIA treats a `button`'s descendants as presentational, so the P1-2 fix created nested-interactive markup. The row's accessible name concatenates the title, labels, project and date, and at best assistive tech announces the four or five inner controls ambiguously. Keyboard use still works because `decideRowKey` passes keys through, so this is P2, not P1.
- Fix: Drop `role="button"` from the row. Make it a focusable `role="row"`/`listitem` container named by the title (`aria-labelledby`) with Enter/Space → `onOpen`, or make the title span the open `<button>` and keep the row as a plain focus target for j/k. CROSS-SURFACE: Today and Inbox (same `TaskItem`).

### N-P2-2 The project badge is redundant in project views and crowds titles in All tasks
- Anchor: `apps/desktop/src/components/tasks/ProjectDetailPage.tsx:163-164` passes `projectName`/`projectColor` for every row → `SectionedTaskList.tsx:84-85` → `TaskItem.tsx:247-254`. All tasks: `TasksPage.tsx:90` (`max-w-page` = 640, content 592px), right cluster `TaskItem.tsx:237-257`, plus `TaskRowActions` reserving two `size-6` slots at opacity-0 (`FocusTaskEntry.tsx:25,125-133`).
- Rubric: §1.4 (earned attention: metadata dimmer and smaller than primary content, color for semantic meaning only), §1.2 (don't make the user sort through noise).
- Screens: light `loop1-rescore/tasks-list-light.png`, dark `loop1-rescore/tasks-list-dark.png` ("Refresh portfolio case study: Ca…" is truncated at 1280px behind a 0/2 badge, two label pills, the project name and a date. On other rows the project dot and label dots are the same 6px and read as one list of tags).
- What's wrong: Inside "Portfolio", every row repeats "● Portfolio". In All tasks, the metadata cluster is now wider than many titles on the 592px column, so the primary content is the part that truncates. From code, when focus actions are available, invisible trailing buttons push the cluster another ~52px left.
- Fix: Only render the badge when the list spans projects (`projectsById` set, not `projectName`). Cap the right cluster: 1 label + `+N`, project name `max-w-[96px] truncate`. Make the focus-queue buttons `absolute` overlays on hover instead of in-flow slots.

### N-P2-3 Two "Inbox" entries sit next to each other in the nav
- Anchor: `apps/desktop/src/components/tasks/ProjectSidebar.tsx:209-217` renders the `inbox` project under Tasks. `components/layout/NavSidebar.tsx:43,52` is the Inbox page (captures), shown directly below the tree.
- Rubric: §1.2 (reduce decision overhead; don't make the user choose where to look), §2.3 (Inbox is the capture surface).
- Screens: light `loop1-rescore/tasks-list-light.png`, dark `loop1-rescore/tasks-list-dark.png` ("Inbox 1" under Tasks at y≈177, "Inbox" page at y≈445).
- What's wrong: The tree used to live in its own column. Nesting it in the nav put two differently-behaving "Inbox" items one tree apart: a task project, and the quick-capture page. "Where did my thing go?" now has two plausible answers with the same label and icon context.
- Fix: Rename the project's display label in the tree to "Unsorted tasks" (display only, no data change), or hide the `inbox` project from the tree and surface its count on the Inbox page. That's a naming decision, so it's QUEUED FOR MARCO if the label must match Todoist.

### N-P2-4 The persistent sync banner takes 40px of chrome on every page and can't be dismissed
- Anchor: `apps/desktop/src/components/shared/SyncHealthBanner.tsx:66-87` (`h-10`, full-contrast `text-body`, no dismiss); mounted for every page at `components/layout/Dashboard.tsx:293`, and it stacks with `FocusBanner` (`:296`); `lib/syncHealth.ts:20` also returns `stale` when there is no `last_sync_at`, so the copy "hasn't synced in over an hour" is wrong for a never-synced state.
- Rubric: §1.4 (earned attention: chrome dimmer than content; density 15–25 rows), §1.1 (the app nudges, it doesn't nag).
- Screens: light `loop1-rescore/tasks-list-light.png`, `tasks-detail-light.png`; dark `loop1-rescore/tasks-list-dark.png`, `tasks-detail-dark.png`.
- What's wrong: On Tasks, the banner is the highest-contrast text in the main column after the title and costs about one row of density (13 rows visible). It stays until the next successful sync, which after an overnight sleep means the morning triage opens under a warning strip. The signal is legitimate (the silent 401), but it has no quiet state.
- Fix: Keep it for `error`. For `stale`, collapse to a `text-meta` muted line or an indicator by the nav's sync affordance, with a dismiss that snoozes it for the session. Fix the never-synced copy. CROSS-SURFACE: every page (shell owns it).

### N-P2-5 Single-key `x` and `s` act immediately with no Undo
- Anchor: `apps/desktop/src/components/tasks/useTaskRowActions.ts:28-38` (`s` overwrites `dueDate` with tomorrow, and the toast offers "View" only); `components/tasks/StatusDropdown.tsx:41-55` (`completeTaskWithExit`, used by `x` and the menu: no Undo toast).
- Rubric: §1.6 (instant feedback), Interaction dimension ("undo where destructive"), §3.2 (friction). Single-key actions are exactly where §1.5 invites mis-hits.
- Screens: n/a (keyboard). Traced from code.
- What's wrong: B3a made one keystroke complete or reschedule the focused row. A stray `s` silently loses the original due date (nothing records it), and a stray `x` animates the row away, so recovering means finding it in Complete. Deletes got Undo in this loop, but these two faster actions didn't.
- Fix: Snapshot `due_date`/`due_time`/`status` before the write and pass an Undo action to `taskToast` for both (frontend-only via `dp.tasks.update` / `updateStatus`). CROSS-SURFACE: Today (same hook).

### N-P2-6 Template-literal classNames kept on a stale justification
- Anchor: `apps/desktop/src/components/tasks/TaskItem.tsx:26-34` and `:70-78`. The comment says `cn()` would drop `text-meta` next to `text-muted-foreground`, but `lib/utils.ts:17-40` already registers every custom size and color with `extendTailwindMerge`.
- Rubric: §3.3 ("Template literals for class names — use `cn()`"). Filed at P2, matching the baseline's calibration for rule-letter items with no user-visible defect.
- Screens: n/a.
- What's wrong: Two of the surface's most-rendered spans (`DueDateBadge`, `SubtaskSummary`) break the house rule, and their comments teach the next agent a workaround that is no longer needed.
- Fix: `cn('shrink-0 text-meta', today ? 'text-foreground' : 'text-muted-foreground')` (and the same for `SubtaskSummary`). Delete both comments and the redundant `tabular-nums`.

## Remaining P1 count: 2 (baseline carry-over 1 + new 1)
- Carry-over: P1-5 (Partly — 20px section-header padding, and 13 rows visible vs the 15-row floor).
- New: N-P1-1 (the nav project tree is mouse-only).
- P2 still open: 8 (carry-over P2-7 and P2-8, both Partly, + new N-P2-1…6). Deferred: P2-2 and P2-6.
- P3 still open: 3 (P3-1 and P3-4 Open, P3-3 Partly).

Notes (not scored as findings):
- Queued item #5 (PageFrame on task detail) now shows more: the list adopted the page-title recipe in pass 2, but detail still hand-rolls `max-w-[600px] pt-[30px]` inside a `p-6` wrapper (`TaskDetailPage.tsx:422`, `TasksPage.tsx:243`) with its own breadcrumb copy (`TaskDetailPage.tsx:424-440` vs `PageHeader.tsx:20-21`). The detail title renders at y≈178 against the list title at y≈80. Worth weighing when Marco decides #5.
- `StatusDropdown.tsx:16` says `TASK_COMPLETE_ANIM_MS = 580` "matches" the keyframe, but `index.css:466` runs 600ms.
- Rubric drift: `docs/ux-intent.md` §3.4 still lists the 10-token scale that `typography-system.md` now says never shipped. Amend §3.4 so audits stop citing class names that don't exist.
