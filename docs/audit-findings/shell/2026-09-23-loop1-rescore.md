# Shell — Loop 1 re-score (2026-09-23)
Baseline: 2026-09-22-loop1.md · Screenshots: loop1-rescore/shell-commandbar-{light,dark}.png, shell-help-{light,dark}.png, plus the nav + rail in today-dashboard-*, tasks-list-*, inbox-*, docs-* (all under `docs/audit-findings/screenshots/loop1-rescore/`). Compared against `loop1-before/`.

Main at `988d048`. Code read: `components/layout/{Dashboard,NavSidebar,NavTrees,RightSidebar}.tsx`, `components/shared/{CommandBar,CommandBarResults,HelpPanel,PageHeader,IconButton,Icon,SyncHealthBanner}.tsx`, `components/tasks/ProjectSidebar.tsx`, `components/docs/FolderTree.tsx` (nav-tree role only), `components/calendar/CalendarPanel.tsx`, `hooks/useCalendar.ts`, `components/ui/{sonner,tabs}.tsx` + a grep sweep of `ui/`, `lib/{shortcuts,rightRail,roadmap}.ts`, `stores/layoutStore.ts`, `index.css`, `themes.css` (warm only). No browser used. States not in the screenshots (hover, focus ring, toasts, breakdown, command-bar results, collapsed rail, reduced motion) were judged from code only.

## Scorecard
| Dimension | Before | After | Evidence |
| --- | --- | --- | --- |
| UI / visual | 3 | 4 | Shell token layer is now clean: 0 `duration-N`, 0 `transition-all`, 0 palette literals (only the exempt now-line `CalendarPanel.tsx:173-174`), warm sidebar tokens (`themes.css:54,102`), `ui/` retokenized, toasts in Geist on `--shadow-popover`, one `<Icon>` stroke. Minor notes left: two `font-medium` stacks, `border-secondary` rail dividers, `surface-popover` defined with 0 consumers, and two different tree recipes stacked in one nav. |
| Interaction | 2 | 3 | Every baseline interaction P1 is fixed (Escape on help, nested button, skeleton breakdown, one calendar error channel, ⌥M works, nav Space). New gaps from the Agentation passes: the Tasks tree in the nav is mouse-only, habits check-off moved into a rail tab with no key path, calendar hover keys swallow typed characters, rail resize is mouse-only. |
| UX | 3 | 3 | `?`, `g`-prefix and a registry-backed help panel are real gains. The labeled nav with inline trees gives some of it back: on Docs (the default 800px window) Goals and Activity scroll out of view under a hidden scrollbar, "Activity" and "Session" name the same page, the sync banner appears on every page with no dismiss, and `?` still floats over rail content. |
| Accessibility | 2 | 3 | Focus ring 4.23:1 / 6.14:1 with a global `:focus-visible` (`index.css:133-135`), full `prefers-reduced-motion` block (`index.css:565-619`), dark muted-foreground 6.39:1, nav `aria-current` + labels, rail tabs use the Base UI ARIA tabs pattern. Remaining: Tasks-tree rows aren't focusable, the command bar has no combobox/listbox semantics, the help panel isn't a dialog and doesn't take focus, resize handles have no role or keyboard. |

Average: 2.5 → 3.25

## Baseline findings status
17 Fixed · 5 Partly · 1 Open · 1 Deferred (of 24).

| ID | Title (short) | Status | Evidence (path:line) |
| --- | --- | --- | --- |
| P1-1 | No `?` for shortcuts | Fixed | `components/layout/Dashboard.tsx:153-158` (`?` toggles, not in inputs); `components/shared/HelpPanel.tsx:73` (`aria-label="Keyboard shortcuts (?)"`) |
| P1-2 | Help panel ignores Escape | Fixed | `HelpPanel.tsx:53-67` (capture-phase Escape, yields to any open dialog/menu/listbox/popover) |
| P1-3 | Nested `<button>` in result row | Fixed | `CommandBarResults.tsx:351-366` (`TooltipTrigger render={<DropdownMenuTrigger/>}`, one element) |
| P1-4 | Spinner in AI breakdown | Fixed | `CommandBarResults.tsx:102-112` (three `Skeleton` rows, `role="status"`); `components/ui/sonner.tsx:28-30` (static `CircleDashedIcon`) |
| P1-5 | No G-prefix navigation | Fixed | `Dashboard.tsx:245-278` (600ms chord, capture phase, modifier-safe); `lib/shortcuts.ts:35-45` |
| P1-6 | Hardcoded palette colors | Fixed | `CommandBarResults.tsx:344,346` (`text-success`, `text-ai`); `NavSidebar.tsx:339,344` (`bg-warning`); `#6366f1` fallback gone; shell grep for `(text\|bg\|border)-<palette>-NNN` = 0 |
| P1-7 | `font-medium` stacks in command bar | **Open** | `CommandBarResults.tsx:268` and `:285` still `truncate font-medium` on the quoted query (`:146` carries its justified comment) |
| P2-1 | Type-scale drift doc vs CSS | Fixed | `docs/typography-system.md:5-20` now mirrors `index.css:37-54` (8 tokens); `text-heading\|caption\|display-xl` usages = 0 |
| P2-2 | Help listing ≠ handlers | Fixed | One registry `lib/shortcuts.ts:47-135` read by `HelpPanel.tsx:140`; ⌥M implemented `CommandBar.tsx:256-262`; "1–6" matches the 6-item `DEFAULT_NAV_ORDER` (`layoutStore.ts:28`). A new label drift is reported as N-P2-4. |
| P2-3 | No reduced-motion handling | Fixed | `index.css:565-619` (tokens → 0ms, keyframes off, `animate-in` opacity-only, wildcard 0.01ms + 1 iteration) |
| P2-4 | Imperceptible focus ring | Fixed | `themes.css:36` light `0.58` (4.23:1), `:91` dark `0.65` (6.14:1); `index.css:122-135` full-alpha 2px `:focus-visible`; `ring-3/ring-[3px]` focus recipes gone from `ui/` (only `aria-invalid:` rings remain). Straggler: `CommandBarResults.tsx:123` breakdown input keeps its own `focus:ring-1 ring-accent-blue/40`. |
| P2-5 | Dark muted-foreground low contrast + alpha hacks | Partly | Token fixed: `themes.css:83` (6.39:1), `--muted-foreground-subtle` added `:25,84`. But 11 `text-muted-foreground/NN` alpha hacks remain app-wide, one in the shell: `PageHeader.tsx:21` (`/70` on the breadcrumb). |
| P2-6 | Calendar toast per keypress; header vanishes | Fixed | `hooks/useCalendar.ts:47-50` (toast removed, inline error only); `CalendarPanel.tsx:478-497` (header stays mounted, only the grid skeletons) |
| P2-7 | Toasts collide with help button, wrong font | Fixed | `sonner.tsx:14` (`offset` bottom 64), `:40` (`--font-sans` inline), `:48` (`--shadow-popover`). The help button now collides with rail content instead, see N-P2-3. |
| P2-8 | §2.7 docked bar vs built palette | Deferred | Plan "Queued for Marco" #14; `NEXT.md` roadmap item 2(b), "amend `ux-intent.md` §2.7". Form factor unchanged at `CommandBar.tsx:313`. |
| P2-9 | `ui/` raw sizes, weight stacks, tracking | Fixed | `grep -E "text-base\|text-\[0.8rem\]\|tracking-widest\|rounded-\[Npx\]\|font-medium\|md:text-" components/ui` = 0; durations tokenized |
| P2-10 | Nav semantics / no name / no current state | Fixed | `NavSidebar.tsx:64-73` (real `<button>` in both modes, 2px active bar), `:97-100` and `:176-177` (`aria-label`, `aria-current="page"`), `:157-159` (Enter/Space navigate, ⌥Enter reorders) |
| P2-11 | Sidebar tokens neutral gray | Partly | Tokens warm: `themes.css:52-54` (light, unused sidebar tokens deleted), `:102` (dark = `--card`). Divider still borrows a fill token: `NavSidebar.tsx:328` and `RightSidebar.tsx:74` `border-secondary`. |
| P2-12 | Stale roadmap proposing streaks | Fixed | `HelpPanel.tsx:9-16` + `lib/roadmap.ts` parse `NEXT.md` at build time; no hand array, no streak item |
| P3-1 | `transition-all` / raw durations | Fixed | App-wide `duration-N` = 0, `transition-all` = 0; `RightSidebar.tsx:74` uses `ease-(--ease-entrance)`; no raw `cubic-bezier` outside the token defs (`index.css:118-119`). Note: `CommandBar.tsx:121-129` unmounts after a hard-coded 200ms while `.command-bar-flyout-out` runs `--transition-base` (220ms), so the exit is clipped. |
| P3-2 | Five overlay elevation recipes | Partly | `surface-popover` exists (`index.css:179-181`) with **0** consumers; toasts adopted `--shadow-popover`. Still bespoke: `CommandBar.tsx:314` (`border-border/50 shadow-lg shadow-black/10`), `CommandBarResults.tsx:87,167` (`shadow-lg`), `HelpPanel.tsx:98` (`border-border/30 shadow-xl`), `ui/popover.tsx:38` / `ui/dropdown-menu.tsx:42` (`shadow-md ring-1`). |
| P3-3 | Off-scale `rounded`; rows not concentric | Partly | Palette kbd chips now `rounded-sm` (`CommandBar.tsx:325`, `CommandBarResults.tsx:270,364,411`). Still `rounded`: `HelpPanel.tsx:149` (kbd), `:195`. Rows still `rounded-md` inside a `rounded-xl p-1` container: `CommandBarResults.tsx:207,236,260,277,318`. |
| P3-4 | Hit areas under 40px | Fixed | `NavSidebar.tsx:67` (`after:-inset-0.5` → 40px); `IconButton.tsx:17-21`; `CalendarPanel.tsx:63` (24×40); `CommandBarResults.tsx:22-23` (24×36), `:97` (breakdown X) |
| P3-5 | Icon size/stroke drift | Partly | `components/shared/Icon.tsx:18-24` (1.75 stroke, 14/16px) used by nav, rail and palette chrome. Raw Lucide at default 2px stroke remains in the shell: `CommandBarResults.tsx:213,242,266,283`; `HelpPanel.tsx:84,104,108,208`. |

## Cross-cutting status
| Item | Status | Evidence |
| --- | --- | --- |
| Focus ring (visible, one recipe) | Fixed | `index.css:122-135`; `themes.css:36,91`; `focus-ring` utility on `ui/button.tsx:9`, `input.tsx:12`, `toggle.tsx:7`, `badge.tsx:8` |
| Reduced motion | Fixed | `index.css:565-619`; one leftover to watch: `SyncHealthBanner.tsx:70` carries its own `motion-reduce:animate-none` (redundant but harmless) |
| Type-scale drift (doc vs CSS) | Fixed | `docs/typography-system.md:5-20` = `index.css:37-54` |
| Motion token drift (durations, `transition-all`, easing) | Fixed | 0 / 0 app-wide; one entrance per page (`Dashboard.tsx:327` `page-enter`); panels on `panel-in` (`index.css:305-330`). New preset site: `SyncHealthBanner.tsx:70` `slide-in-from-top` (see N-P2-5) |
| Palette literals / semantic roles | Fixed | 0 `(text\|bg\|border)-<palette>-NNN` in `*.tsx`; `--warning`, `--ai`, `--status-*`, `--shadow-popover` in `themes.css:59-67,104-110` |
| Warm sidebar / dark border visibility | Partly | Tokens fixed (`themes.css:54,89,102`); rail dividers still `border-secondary` (`NavSidebar.tsx:328`, `RightSidebar.tsx:74`); `border-border/20` ×19 and `/30` ×17 remain in `components/` |
| One surface set (panel / inset / popover) | Partly | `surface-panel` ×5, `surface-inset` ×1, `surface-popover` ×0 consumers |
| PageFrame / SectionTitle / EmptyState | Fixed (shell view) | `<PageFrame` ×8, `<SectionTitle` ×20, `<EmptyState` ×8 in `components/`; page header recipe `PageHeader.tsx:15-21` shared with Tasks |

## New findings

Pre-existing issues the baseline missed are marked *(pre-existing)*. Everything else was introduced by Stage C or the two Agentation passes.

### N-P1-1 Opening a nav tree pushes Goals and Activity out of view behind a hidden scrollbar
- Anchor: `apps/desktop/src/components/layout/NavSidebar.tsx:378` (all page items and both trees share one `overflow-y-auto … [scrollbar-width:none]` column), `:213-217` (tree rendered inline under its page item), `:235-240` (going to Docs or Tasks auto-opens that tree)
- Rubric: §1.2 (batch information; don't make the user choose where to look), §3.2 (multi-step where one step would work)
- Screens: light `loop1-rescore/docs-light.png`, `shell-help-light.png`; dark `shell-help-dark.png` (Docs tree open: Today, Tasks, Inbox, Docs, then tree rows down to Command. Goals and Activity are not on screen)
- What's wrong: At the default 1280×800 window, the Docs tree (search + 3 folders + vault) fills the column, so two of six page items scroll off with no scrollbar and no "more" cue. The mock has 6 projects. Marco's real data has 63, so the Tasks tree will do the same to Inbox, Docs, Goals and Activity. Page items also move vertically depending on which tree is open (Inbox sits at y≈141 on Docs and y≈445 on Inbox), which breaks spatial memory for the nav.
- Fix: Keep the six page items in a fixed, non-scrolling group and give the open tree its own scroll region below them, or cap the tree height (`max-h` + visible thin scrollbar). Either way, page items never leave the viewport.

### N-P1-2 The Tasks project tree in the nav is mouse-only
- Anchor: `apps/desktop/src/components/tasks/ProjectSidebar.tsx:120-130` (project row is a `<div onClick>` with no `role`, `tabIndex` or key handler), `:136` (edit/delete are `hidden group-hover:flex`, so they're `display:none` to the keyboard), `:106-113` (delete-confirm ✓/✕ icon buttons have no `aria-label`); mounted into the nav at `NavTrees.tsx:35-44`
- Rubric: §1.5 (keyboard-first, every common action has a key), §3.6
- Screens: light `tasks-list-light.png`, dark `tasks-list-dark.png` (tree rows under Tasks); focus behaviour judged from code
- What's wrong: Now that this tree is the shell's project switcher, Tab reaches "All tasks", the parent chevrons and "New project" but skips every project row. Picking a project, renaming it or deleting it can't be done from the keyboard. The Docs tree directly below it in the same nav is a proper roving `role="tree"` (`FolderTree.tsx:264-301`), so keyboard behaviour changes depending on which tree is open.
- Fix: Reuse the FolderTree pattern: rows as `<button role="treeitem">` with roving tabindex, ↑/↓/←/→/Enter, actions revealed with `group-focus-within`, and `aria-label` on the confirm buttons. Add rows to the `Tasks` section of `lib/shortcuts.ts`. CROSS-SURFACE (Tasks owns `ProjectSidebar`).

### N-P2-1 Two different tree recipes stacked in one nav
- Anchor: `ProjectSidebar.tsx:123-126` (`h-9`, `text-meta`, `hover:bg-muted/50`, no leading icon, count column) vs `components/docs/FolderTree.tsx:20-23` (`h-8`, body text, `hover:bg-hover`, folder/doc icons, reveal actions)
- Rubric: §1.4 (one restrained, designed object), cross-surface inconsistency (P2 per brief)
- Screens: light `tasks-list-light.png` vs `docs-light.png`; dark `tasks-list-dark.png` vs `shell-help-dark.png`
- What's wrong: Row height (36 vs 32), type size (12 vs 13), hover token, iconography and selected treatment all differ between the two trees that share the nav. The 36px project rows are also the same height as the top-level page items, so hierarchy rests on indent alone. The tree also shows an "Inbox" project directly above the "Inbox" page item (`tasks-list-light.png`, `inbox-dark.png`), so the same label appears twice in the nav.
- Fix: One `NavTreeRow` recipe (32px, `text-meta`, `hover:bg-hover`, `bg-muted` + `text-meta-strong` selected, optional 14px icon) used by both trees; show the Inbox project with its project dot, or as "Inbox (project)", to separate it from the page. CROSS-SURFACE (Tasks, Docs).

### N-P2-2 Calendar hover shortcuts swallow typed characters *(pre-existing, wider exposure)*
- Anchor: `apps/desktop/src/components/calendar/CalendarPanel.tsx:446-466` (document-level `keydown`; the only guard is `if (!focused)` at `:448`, set by `onMouseEnter` at `:475`; no input/contenteditable check before `preventDefault()` on ←/→/`t`)
- Rubric: §3.2 (friction), §1.5
- Screens: n/a (behavioural; the Calendar tab is the default rail tab in every rescore shot)
- What's wrong: With the pointer resting on the rail, typing `t` in the Inbox capture field, the command bar or the Docs editor is swallowed and the calendar jumps to today, and ←/→ stop moving the caret. The Calendar tab now shows by default on every page except Settings/Activity, which widens the exposure. `t` also collides with Inbox's `t` (convert) (`lib/shortcuts.ts:87` vs `:113`).
- Fix: Run the shared `shouldIgnoreKey(e.target)` guard (`lib/keyGuard.ts:33`) first, and scope the keys to focus-within the panel rather than hover.

### N-P2-3 Help: the floating `?` button covers rail content, and the panel doesn't take focus
- Anchor: `apps/desktop/src/components/shared/HelpPanel.tsx:72-82` (`fixed bottom-4 right-4 z-30` circle), `:88-98` (panel: no `role`/`aria-label`, focus stays on the page, `max-h-[50vh]` scroll region that isn't focusable)
- Rubric: §1.5 ("shortcuts are discoverable via `?`"), §3.2
- Screens: light `tasks-list-light.png`, `shell-help-light.png`; dark `inbox-dark.png`, `shell-help-dark.png`
- What's wrong: With the rail on every page, the 36px circle sits over its bottom rows (calendar 7p–8p here; the habits list per NEXT.md's deferred minor). This is a known Stage C minor and still Open. Pressing `?` opens a list of ~60 rows that shows 11 at 800px (`shell-help-*`: Navigation only). Focus doesn't move into the panel, so a keyboard user can't scroll the list they just asked for.
- Fix: Move the entry point into the nav's pinned bottom group next to Command and Settings (`NavSidebar.tsx:393-411`, labeled, no overlap). Render the panel as a Base UI `Popover`/`Dialog` with `aria-label="Keyboard shortcuts"` and initial focus on the tab list; order sections so the current page's section comes first.

### N-P2-4 "Activity" and "Session" name the same page, and "Activity" names two things
- Anchor: `NavSidebar.tsx:55` (`session: 'Activity'`), `components/pages/SessionPage.tsx:252` (`title="Activity"`) vs `lib/shortcuts.ts:54` ("Go to Session", `g s`), `:129-134` (section "Session"); `RightSidebar.tsx:19` (a rail tab also called "Activity" that is a different view, the heatmap)
- Rubric: §1.2 (decision overhead), §1.5 (shortcut discoverability), cross-surface inconsistency
- Screens: light `shell-help-light.png` ("Go to Session") beside the nav ("Activity") and the rail's Activity tab icon; dark `shell-help-dark.png`
- What's wrong: The help panel teaches `g s` → "Session" for a page the nav, title and number keys call "Activity", and the rail has an "Activity" tab that isn't that page. The user has to map three names onto two places.
- Fix: Label the row "Go to Activity" (keep `g s`, and add `g a` as an additive alias if wanted), rename the registry section to match the page, and give the rail tab a distinct name (e.g. "Heatmap").

### N-P2-5 The sync banner nags on every page and stacks with the focus banner
- Anchor: `apps/desktop/src/components/shared/SyncHealthBanner.tsx:9` (60s poll), `:66-88` (no dismiss/snooze; `h-10` strip that slides in with `slide-in-from-top` and pushes the page down 40px), `:59` (`toast.error(\`Todoist sync failed: ${e}\`)`, which duplicates the banner with a raw error string); mounted for every page at `Dashboard.tsx:293`, directly above `FocusBanner` at `:296`
- Rubric: §1.1 ("the app nudges …; it does not nag"), §1.4 (earned attention: chrome must not compete with content), §1.6 (proportionate feedback)
- Screens: light `today-dashboard-light.png`, `tasks-list-light.png`; dark `inbox-dark.png`, `tasks-list-dark.png`
- What's wrong: The copy passes the no-guilt check ("Todoist hasn't synced in over an hour." is neutral and names the system, not the user). The behaviour doesn't pass: the strip is the first line on every page, can't be dismissed, can reappear mid-task on the poll, shifts layout when it does, and with a queued focus session there's 80px of banner chrome above every page title. A failed "Sync now" then shows the same news again as a red toast.
- Fix: Add a "Hide for today" dismiss (per health state), fold the failure into the banner text instead of a toast, animate with `panel-in` opacity-only (no layout slide), and share one banner slot with `FocusBanner`. The staleness threshold is a product call, so ask Marco.

### N-P2-6 The command bar has no combobox/listbox semantics *(pre-existing)*
- Anchor: `apps/desktop/src/components/shared/CommandBar.tsx:313` (`role="dialog"` without `aria-modal`, no focus trap), `:316-324` (input: no `aria-label`, no `role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant`), `:119-130` (close doesn't restore focus to the invoking element); `CommandBarResults.tsx:204-215, 233-245, 316-322` (rows lack `role="option"`/`aria-selected`; selection is `bg-hover` only)
- Rubric: §1.5 (Cmd+K is the universal entry point), §3.6
- Screens: light `shell-commandbar-light.png`, dark `shell-commandbar-dark.png` (results state judged from code)
- What's wrong: ↑/↓ move a purely visual highlight, so assistive tech hears nothing as the selection changes, and after Escape focus lands on `body` instead of where the user was. The in-app model already exists in `DocsSearch.tsx:121` (`role="listbox"`).
- Fix: Input `role="combobox" aria-expanded aria-controls aria-activedescendant aria-label="Command bar"`; results container `role="listbox"` with `role="option" aria-selected` rows carrying ids; `aria-modal="true"`; remember `document.activeElement` on open and restore it on close.

### N-P2-7 Habit check-off moved into a rail tab with no keyboard path
- Anchor: `apps/desktop/src/components/layout/RightSidebar.tsx:149-151` (`HabitsSection` now lives only here; no other page renders it), `lib/rightRail.ts:22-29` (⇧F is the only shortcut that opens a rail tab, and only Focus); DOM order `Dashboard.tsx:287-342` puts the rail after the whole page
- Rubric: §1.5 ("every common action has a single-key shortcut"), §3.6
- Screens: light `today-dashboard-light.png` (no habits on Today; Habits is the rail's second tab), dark `today-dashboard-dark.png`
- What's wrong: A daily action that used to sit on Today is now reachable from the keyboard only by tabbing through the nav and every focusable row on the page, then arrowing to the Habits tab. The ARIA tabs pattern works (Base UI `Tabs`, `RightSidebar.tsx:115-135`), but nothing jumps to it.
- Fix: Additive `⇧`-letter shortcuts that open each rail tab and move focus into it, mirroring ⇧F (e.g. ⇧C calendar, ⇧H habits, ⇧A activity), registered in `lib/shortcuts.ts`.

### N-P3-1 Rail resize handles are mouse-only slivers in accent blue
- Anchor: `NavSidebar.tsx:414-420` (4px `div onMouseDown`, `hover:bg-accent-blue/20`), `RightSidebar.tsx:107-113` (1px, widens to 4px only after it's already hovered)
- Rubric: §1.5, §1.4 (color only for semantic meaning) + make-interfaces-feel-better "Minimum hit area"
- Screens: n/a (hover/drag state not captured; code only)
- What's wrong: No `role="separator"`, `aria-orientation`, `aria-valuenow` or arrow-key resizing, and the grab target is 1–4px. Blue here is chrome, not status. The nav's collapse button covers the binary case, but the 160–360 range added in pass 2 is pointer-only.
- Fix: An 8px transparent hit strip centred on the border, `role="separator" tabIndex={0}` with ←/→ in 16px steps, hover/drag in `bg-border`/`--ring`.

### Known deferred minors (listed in NEXT.md, not queued for Marco/Rust → Open)
| Item | Severity | Anchor | Rubric |
| --- | --- | --- | --- |
| `?` button overlaps the bottom of right-rail habits | P2 | folded into N-P2-3 | §3.2 |
| Focus tray footer truncates "From: Today" at the 288px default rail | P3 | `components/focus/FocusSourcePicker.tsx:75` (`max-w-36 truncate`) vs `stores/layoutStore.ts:25` (`RIGHT_DEFAULT_WIDTH = 288`) | §1.2 + make-interfaces "truncation" |
| Demo dot pulses forever | P3 | `NavSidebar.tsx:344` (`animate-pulse`, infinite outside reduced motion) | §1.4 + make-interfaces "motion restraint" |

## Remaining P1 count: 3 (baseline carry-over 1 + new 2)
- Carry-over: P1-7 (`font-medium` at `CommandBarResults.tsx:268,285`).
- New: N-P1-1 (nav trees hide page items), N-P1-2 (Tasks tree mouse-only).
- P2 open: 9 (carry-over Partly P2-5, P2-11 + new N-P2-1…7), plus 1 Deferred (P2-8, §2.7 decision). P3 open: 6 (Partly P3-2, P3-3, P3-5 + N-P3-1 + two known minors).
