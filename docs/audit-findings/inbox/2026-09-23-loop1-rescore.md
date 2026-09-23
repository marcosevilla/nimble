# Inbox — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/inbox-{light,dark}.png (main at `988d048`). Only the default state was retaken. Hover, focus, picker, route-pill and empty states are judged from code; the baseline shots in `loop1-before/` are now stale for those states. No browser used.

Files re-read: `apps/desktop/src/components/pages/InboxPage.tsx` (691 lines, rewritten by B3a + C1), `tasks/TaskItem.tsx`, `tasks/LocalTaskRow.tsx`, `shared/SelectionCheckbox.tsx`, `tasks/StatusDropdown.tsx`, `hooks/useTaskNavigation.ts`, `lib/rowNav.ts`, `lib/shortcuts.ts`, `shared/PageFrame.tsx`, `shared/PageHeader.tsx`, `shared/EmptyState.tsx`, `shared/SyncHealthBanner.tsx`, `layout/Dashboard.tsx`, `layout/RightSidebar.tsx`, `layout/NavTrees.tsx`, `tasks/ProjectSidebar.tsx`, `calendar/CalendarPanel.tsx`, `shared/CommandBar*.tsx`, `shared/CaptureStrip.tsx`, `detail/CaptureDetailPage.tsx`, `ui/popover.tsx`, `index.css`, `themes.css`, `docs/typography-system.md`.

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3/5 | 4/5 | The route pill now uses the LabelChipPill recipe (`InboxPage.tsx:383-387`). There is no `transition-all`, the picker radii are concentric (`:552`, `:663`) and both row kinds are 36px on one recipe (`:508`, `TaskItem.tsx:171`). Minor notes: task titles sit about 24px right of note titles (screenshot), inline icons are 12/14/16px at stroke 2 while the shell's `Icon` primitive uses 14px at 1.75, and the capture strip is still off-token. |
| Interaction | 2/5 | 3/5 | There is a full keyboard layer (`c`, `j`/`k`, `Enter`, `t`/`m`/`d`, `Esc`), with hints (`:398`, `:546`, `:567`, `:572`) and registry entries (`shortcuts.ts:109-116`). The picker now runs on `Popover` (`:542-563`), and add, convert and dismiss are optimistic, with Undo on dismiss (`:211-292`). Held at 3 by one new P1: while the pointer is over the calendar rail, `t`/`←`/`→` are swallowed in the capture field and `t` also moves the calendar (`CalendarPanel.tsx:446-466`). Row action hit areas also overlap. |
| UX | 2/5 | 3/5 | Routed captures have left triage (`:182`), dismiss has Undo, the empty state is positive with no button (`:412-414`) and `c` makes capture a single key. Still missing: the convert picker, defer, move to project and breakdown (§2.3). The placeholder still lies about routes (`:376`). Two different "Inbox" nav destinations show different counts. Prefix routing and NL dates are Deferred. |
| Accessibility | 2/5 | 4/5 | The input is named (`:377`), the checkbox has a label and `aria-pressed` (`SelectionCheckbox.tsx:42-44`), the status trigger is named (`StatusDropdown.tsx:153`), the picker moves focus in and back out (`:553`, `:674`), and hidden controls leave the tab order. Minor note: the actions, checkbox and status trigger are nested inside `role="button"` rows (`:493`, `TaskItem.tsx:156`). |

Average: 2.25 → 3.5

## Baseline findings status
| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | Move-to-doc picker is mouse-only | Fixed | `InboxPage.tsx:542-563`: shadcn `Popover` gives Escape, dismissal and `role="dialog"`, and `finalFocus={rowRef}` returns focus to the row. `:674` autofocuses the first doc. `:555-559` stops list keys from leaking out. |
| P1-2 | Row actions unreachable by keyboard and undiscoverable | Fixed | `:537` `group-hover:flex group-focus-within:flex`. `:493-506` makes the row focusable with Enter/Space. `:336-345` binds `t`/`m`/`d` via `useRowNavigation`, and `<kbd>` hints sit at `:546`, `:567`, `:572`. `SelectionCheckbox.tsx:42-44` gives `tabIndex -1` while hidden plus `aria-label`/`aria-pressed`. `StatusDropdown.tsx:153` has an `aria-label`. |
| P1-3 | No single-key way to start a capture | Fixed | `:140-150` makes `c` focus the field (guarded by `isEditableTarget`). `:374` makes Escape blur. `:398` shows the `C` hint and `shortcuts.ts:109` registers it. `q` is untouched. |
| P1-4 | Add and convert not optimistic, input locks | Fixed | `:232-251` adds a temp row, reconciles it and reverts on error. The input has no `disabled` (`:368-379`). `:254-265` removes the row on convert and restores it on failure. |
| P1-5 | "Loading..." text in picker | Fixed | `:661-666` renders three `Skeleton h-8 rounded-sm` rows instead. |
| P2-1 | Prefix routing in 1 of 3 entry points, two vocabularies | Deferred | Plan "Queued for Marco" #15 (loop 2, pending the §2.7 decision). Still true: `CommandBar.tsx:25`, `:30` (`note:`/`idea:`/`/capture`), and `CaptureStrip.tsx` never calls `parseRoutePrefix`. |
| P2-2 | Routed captures re-enter triage | Fixed | `:182` `c.source !== 'route'`. The routed submit adds no row (`:217-230`). |
| P2-3 | 3 of 5 per-item actions missing; convert no picker; dismiss no undo | Partly | Dismiss with Undo exists (`:269-292`, `:569-573`). Still missing: the convert picker (`:258` `convertToTask(capture.id)`, no project/date/priority), defer, move to project and AI breakdown. Capture detail still says "Delete" with no Undo (`CaptureDetailPage.tsx:58-65`, `:144-148`), so the same action has two names and two safety levels. |
| P2-4 | Route hints hardcoded in placeholder | Open | `:376` still reads `"Write a note… (/i idea, /q quote, /t task)"` while `routes` is fetched at `:91-93`. |
| P2-5 | Empty state flat, pushes an action | Fixed | `:412-414` renders `EmptyState` with "Inbox zero. New thoughts land here — ⌘K or the capture strip." and no button. Import stays in the header (`:351-361`). |
| P2-6 | Inbox rows and Tasks rows are two components | Fixed | Task rows render `LocalTaskRow` → `TaskItem` (`:420-430`). The note row copies its recipe (`:507-518` vs `TaskItem.tsx:170-212`), and both are `h-9`. The residual title offset is N-P3-1. |
| P2-7 | Capture field: no focus state, no name | Fixed | `:366` `focus-within:border-ring` (ring is 4.2:1 light / 6.1:1 dark per `themes.css:36`, `:91`) and `:377` `aria-label="Capture a note"`. |
| P2-8 | `text-white` route pill fails contrast | Fixed | `:383-387`: `bg-secondary text-label text-muted-foreground` with the route color as a 6px dot. |
| P2-9 | `font-medium` stacks in command-bar capture rows | Open | `CommandBarResults.tsx:268`, `:285` still `font-medium` inside `text-body` rows. Not assigned in the plan. |
| P2-10 | Capture strip off-token size/opacity | Open | `CaptureStrip.tsx:175` `text-[15px]`, `placeholder:text-muted-foreground/80`. `:164` raw `rgba` shadow stack. `:192` `border-foreground/25 text-foreground/80`. Only the motion was tokenised (`duration-(--transition-fast)`). |
| P2-11 | No natural-language dates | Deferred | Plan "Queued for Marco" #10 (needs `chrono-node`). |
| P2-12 | Type scale drift | Fixed | `docs/typography-system.md` now documents the live 8-token scale and says it was reconciled 2026-09-22. Residue: `docs/ux-intent.md:196` (§3.4) still lists the 10-token scale. That is a rubric fix, not a surface fix. |
| P3-1 | `transition-all` / hardcoded durations | Fixed | `:508` `transition-colors`. The popover uses `duration-(--transition-fast)` (`ui/popover.tsx:38`). The file has no `duration-N`. |
| P3-2 | Hit areas below floor, nearly touching | Partly | Targets are enlarged: checkbox `after:-inset-2` (`SelectionCheckbox.tsx:47`), status trigger `size-7 -m-1.5` (`StatusDropdown.tsx`), row actions `after:-inset-2` (`:581-582`). But `gap-1` (`:537`) against 8px `::after` bleed means neighbouring actions now **overlap** by about 12px. The right edge of "Convert to task" hits "Dismiss". Craft: "never let hit areas touch". |
| P3-3 | Picker radii not concentric | Fixed | `:552` `rounded-xl p-2` (14 = 6 + 8) with `rounded-sm` items (`:642`, `:663`, `:676`). |
| P3-4 | Three icon sizes, 2px stroke beside 400 text | Open | `:358`, `:385`, `:544`, `:565`, `:570`, `:678` are `size-3`. `:367` is `size-3.5`. `:519` is `size-4`. All use Lucide's default stroke 2. The shell's new `Icon` primitive (`shared/Icon.tsx:18-23`, 14px at stroke 1.75) is not adopted here. |

Totals: Fixed 13, Partly 2, Open 4, Deferred 2 (of 21 baseline findings: 5 P1, 12 P2, 4 P3).

## New findings

### N-P1-1 The calendar rail swallows `t`, `←` and `→` from the capture field, and `t` fires twice with a focused note
- Anchor: `apps/desktop/src/components/calendar/CalendarPanel.tsx:446-466` (a `document` keydown listener gated only on pointer hover, `onMouseEnter` at `:475`, with no editable-target check and no `defaultPrevented` check) vs `InboxPage.tsx:338` (`t` = convert focused note, via `useRowNavigation`'s `window` listener) and `:368-379` (the capture input)
- Rubric: §1.5 (keyboard-first), §3.6, §1.6
- Screens: light `docs/audit-findings/screenshots/loop1-rescore/inbox-light.png`, dark `.../inbox-dark.png` (the Calendar tab is the default rail on Inbox). Code-anchored; not reproducible in a still.
- What's wrong: The pointer often rests over the right rail. In that state, typing "take the cat to the vet" into the capture field saves "ake he ca o he ve", because the handler calls `preventDefault()` on every `t`. The arrow keys can't move the caret either. With a note row focused, one `t` both converts the note and jumps the calendar to today. The handler predates loop 1, but B3a made `t` an Inbox row key, so on this page the conflict is new.
- Fix: In `CalendarPanel`'s handler, return early when `e.defaultPrevented` or when the target is an input, textarea or contenteditable (reuse `decideRowKey`/`isEditableTarget`). Better still, scope the calendar keys to the rail having DOM focus rather than hover. `CROSS-SURFACE` (Today and Tasks bind row keys with the rail visible: `x`/`s`/`f` don't collide, but the typing swallow applies to every text field on every page with the rail open).

### N-P2-1 Two "Inbox" destinations in the left nav, with different counts
- Anchor: `components/layout/NavSidebar.tsx:52` (the "Inbox" page) and `components/tasks/ProjectSidebar.tsx:103` via `layout/NavTrees.tsx:34-44` (the "Inbox" project row under Tasks, which opens the Tasks page filtered to the inbox project)
- Rubric: §1.2 (don't make the user choose where to look), §2.3, cross-surface consistency
- Screens: light `.../loop1-rescore/inbox-light.png`, dark `.../inbox-dark.png` (Tasks tree shows "Inbox 1"; the page nav "Inbox" sits 270px lower; the page header says "7 items")
- What's wrong: Since Agentation pass 2 nested the project tree under Tasks, the nav shows two identical labels. One leads to a task-only list with 1 item and the other to the triage page with 7 items (notes plus the same task). The user has to learn which Inbox is "the" inbox.
- Fix: Rename or relabel one of them. For example, show the inbox project row in the Tasks tree as "Inbox tasks", or hide it there because the Inbox page already renders those tasks. If both stay, let the page nav carry the 7-item count. `CROSS-SURFACE` (Shell, Tasks).

### N-P2-2 Persistent sync-staleness banner outranks the content it sits above
- Anchor: `components/shared/SyncHealthBanner.tsx:66-88` (mounted for every page at `layout/Dashboard.tsx:293`)
- Rubric: §1.4 (earned attention: chrome dimmer than content), §3.1 (performs urgency at the user)
- Screens: light `.../loop1-rescore/inbox-light.png`, dark `.../inbox-dark.png`
- What's wrong: For the soft "stale" state, which only means no sync in over an hour and has no error, the banner renders a tinted band (`bg-warning/5`) with `text-body` in full foreground, the same weight as the inbox rows, above the page title. It has no dismiss or snooze. Its `px-4` left edge (x≈256) ignores the 640px content column (x≈317). The error state earns this treatment. A quiet staleness notice doesn't.
- Fix: Keep the band for `error`. For `stale`, drop to `text-meta text-muted-foreground` with no tint (or show a nav-footer status dot), and allow dismissing it until the next state change. Align the text to the page column. `CROSS-SURFACE` (every page).

### N-P2-3 Inbox task rows lose the Tasks row keys, and note keys fail silently on them
- Anchor: `InboxPage.tsx:336-345` (`t`/`m`/`d` resolve only `note:` ids through `noteFromRow`, so a `task:` row is a no-op) vs `hooks/useTaskNavigation.ts:181-186` (`x` complete, `s` snooze and `f` focus are registered only for `pages: ['today', 'tasks']`)
- Rubric: §1.5, §3.6 (common action without a single-key shortcut), cross-surface consistency
- Screens: light `.../loop1-rescore/inbox-light.png` ("Research pedalboard flight case options"), dark `.../inbox-dark.png`
- What's wrong: With P2-6 fixed, the inbox task row looks exactly like a Tasks row but ignores `x`/`s`/`f`. Pressing `t` or `d` on it does nothing and gives no feedback. The help panel promises `x` "Complete focused task" without saying it's Tasks-only (`shortcuts.ts:66`).
- Fix: Merge the task handlers (`useTaskRowActions` → `x`/`s`/`f`) into the Inbox `rowKeys` map for `task:` ids. Optionally map `d` on a task row to the same delete-with-Undo that Tasks uses.

### N-P2-4 Interactive controls nested inside `role="button"` rows
- Anchor: `InboxPage.tsx:491-576` (the row is `role="button"` and contains the `SelectionCheckbox` button, the `PopoverTrigger` and two action buttons) and `tasks/TaskItem.tsx:155-259` (the same structure plus `StatusDropdown` and `TaskRowActions`)
- Rubric: §1.5 (keyboard-first includes reaching every action), cross-surface consistency
- Screens: light `.../loop1-rescore/inbox-light.png`, dark `.../inbox-dark.png`
- What's wrong: ARIA treats `button` children as presentational, so VoiceOver's reading cursor flattens the row into one button labelled with all its text ("Idea: intensity heatmap… from Figma Move to doc M Convert to task T Dismiss D"). Tab still reaches the inner controls, which is why this is P2 and not P1. B3a introduced the `role="button"` for keyboard rows.
- Fix: Make the row a `role="listitem"` (in a `role="list"`, or `grid`/`row` if `j`/`k` stay) with `tabIndex={0}` and an `aria-label` of the title, and keep open-on-Enter in the key handler. `CROSS-SURFACE` (Tasks, Today).

### N-P2-5 The page-title recipe uses `text-display`, which the typography doc reserves for editor H1 and celebrations
- Anchor: `components/shared/PageHeader.tsx:19` (`PAGE_TITLE = 'text-display …'`) vs `docs/typography-system.md` table (`text-title`: "Page titles, dialog titles"; `text-display`: "Editor H1, celebration moments")
- Rubric: §3.4 (type drift; the brief treats doc/CSS disagreement as a finding)
- Screens: light `.../loop1-rescore/inbox-light.png` (20px "Inbox"), dark `.../inbox-dark.png`
- What's wrong: Agentation pass 2 deliberately moved every page title to 20px, but the doc that loop 1 just reconciled already contradicts the code again. The next audit will flag every page against the wrong role.
- Fix: Update the `text-title` and `text-display` rows in `typography-system.md` to match the pass-2 decision. No code change. `CROSS-SURFACE` (every page, reported once here).

### N-P2-6 Hover and focus reveal shrinks the note title (layout shift)
- Status: **Deferred**, open Marco decision (c) in `NEXT.md` → Design facelift ("Inbox hover shrinks note titles — overlay the actions instead?")
- Anchor: `InboxPage.tsx:535-539` (`hidden … group-hover:flex group-focus-within:flex` puts about 290px of actions into the flex row, so the title at `:521` and the "from {context}" meta at `:524-528` re-truncate)
- Rubric: §1.4 (restraint), §1.6 (instant, stable feedback)
- Screens: not retaken. The baseline `loop1-before/inbox-row-hover-{light,dark}.png` predates the change.
- What's wrong: Moving the pointer down the list (or `j`/`k`) makes each title jump shorter and the source meta disappear, so the row being triaged is the one the user can read least.
- Fix: Marco's decision. The option on the table is an absolutely positioned action overlay with a background fade over the title's tail.

### N-P3-1 Task titles sit about 24px right of note titles in the mixed list
- Status: known, listed in `NEXT.md` "Stage C deferred minors (loop 2)"
- Anchor: `InboxPage.tsx:518-521` (icon 16px + `gap-3` → title) vs `tasks/TaskItem.tsx:212-233` (status 16px + `gap-3` + `PriorityBars` + `gap-3` → title)
- Rubric: §1.4 + craft principle "Optical alignment"
- Screens: light `.../loop1-rescore/inbox-light.png` (title x≈385 vs 361), dark `.../inbox-dark.png`
- What's wrong: One list, two text edges. The eye reads the task as a subtask of the note above it.
- Fix: Give the note row a fixed-width empty priority slot (same width as `PriorityBars`), or hide an empty `PriorityBars` in the inbox context so both titles start at the same x.

## Remaining P1 count: 1 (baseline carry-over 0 + new 1)

P2 remaining: 9 open or partly fixed (baseline P2-3, P2-4, P2-9, P2-10 + new N-P2-1 to N-P2-5) plus 3 Deferred (P2-1, P2-11, N-P2-6). P3 remaining: 3 (P3-2 partly, P3-4, N-P3-1).

Cross-surface notes:
- `tools/mock-tauri.js:386`, `:397`, `:408` still define route prefixes without the leading `/`, so the route pill still can't render in the harness (baseline note unchanged).
- `docs/ux-intent.md:196` §3.4 still names the retired 10-token scale. Amend the rubric so later audits don't cite dead tokens.
