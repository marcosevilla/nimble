# Tasks Page Figma Polish Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Tasks experience (list view, task details, task composer, due-date popover, sidebar, calendar panel) to match the "Updated Task Page Designs" Figma frames (file `LOMNIeeWkvouIHKnugKm0d`, section `85:2609`) with all interaction decisions locked in the 2026-08-12 Q&A with Marco.

**Architecture:** Restyle existing components in place where they exist (TaskItem, ProjectSidebar, NavSidebar, CalendarPanel, TaskDetailPage); build three new shared components (`DueDatePopover`, `MetadataChips`, `TaskComposerCard`) that replace `TaskEditor.tsx` and `QuickCreateDialog.tsx`; add sort/filter grouping to the project list header; add a floating multi-select action bar on top of the existing `selectionStore`.

**Tech Stack:** React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (base-nova), lucide-react, dnd-kit (existing), react-day-picker via shadcn Calendar (new), Zustand stores + DataProvider.

## Global Constraints

- All styling via semantic tokens/Tailwind utilities merged with `cn()` — never template literals, EXCEPT the two documented tailwind-merge exceptions in `TaskItem.tsx` (see file comments; preserve them).
- Typography via semantic classes only: `text-label` (11 med), `text-meta` (12 reg), `text-meta-strong` (12 med), `text-body` (13 reg), `text-body-strong` (13 med), `text-display` (20 semibold). Never raw `text-[13px]`.
- Color mapping from Figma vars → Tailwind classes: `color/background`→`bg-background`, `color/card`→`bg-card`, `color/secondary`+`color/muted`→`bg-secondary`/`bg-muted`/`border-secondary`, `color/foreground`→`text-foreground`, `color/muted-foreground`→`text-muted-foreground`, `color/input`+`color/border`→`border-input`/`border-border`, `color/accent`→`bg-accent`, `color/primary`→`bg-primary`, `color/destructive`→`text-destructive`. Breadcrumb grey `#9d9995` → `text-muted-foreground/70`. Never hardcode hex (exception: existing now-line red in CalendarPanel stays as-is).
- Icons: lucide-react only, imported per-file. Stroke/sizing per existing conventions (12px in rows/chips, 16px in nav).
- No guilt UI: red (`text-destructive`) on due dates strictly for **overdue** (past, not today); today/future = `text-muted-foreground`. Keep existing "Today"/"Tomorrow" relative labels.
- Keep both documented `TaskItem.tsx` template-literal exceptions and their comments.
- `npx tsc --noEmit` is a no-op in `apps/desktop` — the real type check is `npm run build` (runs `tsc -b`). Use it in every verify step.
- No test suite exists in this repo. The test cycle for every task = `npm run build` clean + visual verification in the browser QA harness (Vite dev server + `tools/mock-tauri.js` init-script, mock "today" = 2026-08-01).
- All paths below relative to `nimble/apps/desktop/` unless noted. Branch: `tasks-figma-polish`.
- Out of scope (explicitly deferred by Marco): attachments/paperclip (hide entirely), calendar panel functional changes, project nesting data work (already exists).

## Decisions Log (from Q&A 2026-08-12 — binding)

1. Row click anywhere opens Task Details; interactive elements (status icon, checkbox, grip) stop propagation.
2. Breadcrumb hidden for top-level projects; shown as `‹ Parent` inside nested projects.
3. Subtask detail breadcrumb: `‹ Portfolio / Nimble / <parent task title truncated>`, each segment navigates.
4. Sidebar nesting already exists — restyle only.
5. Hover checkbox = **multi-select** (existing `SelectionCheckbox`/`selectionStore`), in-flow reserved slot, no overlap.
5b. Floating action bar at bottom of list when ≥1 selected: Complete, Move to…, Set priority, Delete, ✕ clear.
6. Hover grip = real drag handle wired to existing dnd-kit sortable listeners.
7. Status icons: keep production's current icon set (StatusDropdown); restyle size/placement only. "Up next" in frames is a section title, not a status.
8. Due date red = overdue only.
9. The pill in task rows is a **label chip** (labels array), never project or section name.
10. Sort (grouping): Status / Priority / Due date / Section / Manual. Filter: status (multi), priority, label. "All" = no filter.
11. Icons: `ArrowUpDown` (sort), `ListFilter` (filter), `Calendar` (due), paperclip deferred.
12. Details gear menu: Move to project…, Duplicate task, Copy ID, divider, Delete (destructive, confirm).
13. Attachments deferred — no paperclip rendered.
14. One composer component replaces both `TaskEditor` (inline) and `QuickCreateDialog` (modal). Editing existing tasks routes to Task Details (see Task 8 note).
15. Raw markdown everywhere: composer = plain textarea; details = rendered markdown display, click-to-edit swaps to raw textarea. Tiptap retired for tasks (legacy-HTML descriptions render read-only via existing sniff path).
16. Composer keys: Esc cancels (confirm if dirty), ⌘Enter saves, Enter in title → description, Tab cycles fields.
17. Chip defaults — composer: Priority, Due, Labels visible; `[+]` adds Project, Section. Details: Priority, Due, Labels visible; `[+]` adds Section, Linked doc. Duration & Repeat live INSIDE the due-date popover only.
18. Inline title on details: Linear-style (click to edit, Enter/blur saves, Esc reverts) — reuse `InlineTitle`.
19. Date picker = shadcn Calendar (react-day-picker), restyled to tokens.
20. Duration expanded: preset chips 15m/30m/1h/2h + free minutes input. Repeat expanded: Daily/Weekdays/Weekly/Monthly presets + "Every N days/weeks" custom. ✕ clears each once set.
21. Due popover includes an optional "Add time" field (`due_time`).
22. One branch, increments in order: sidebar+calendar → list view → composer+popover → details → action bar.
23. Dark mode: token mapping only; Marco reviews in QA.
24. Calendar panel: restyle only (white bg + left border), now-line untouched.

## Figma frame reference

| Frame | Node | What it specifies |
|---|---|---|
| Tasks — Sections | `74:1634` | List view, sidebar, calendar panel restyle |
| Task Details (Filled) | `79:2009` | Detail page with chips, description, subtasks |
| Task Details (Empty) | `83:2378` | Placeholder states |
| editor-card empty | `70:1210` | Composer placeholders, disabled Save |
| editor-card filled | `71:1555` | Filled chips, hover ✕, enabled Save |
| due-date-popover | `71:1521` | Calendar + Duration/Repeat collapsed buttons |

Key measured values: main column 600px centered; task row h-10 (40px) with `border-b border-secondary`; section head `pt-5 pb-1` `text-body-strong`; chips h-6 (24px) `rounded-md`; label pill h-5 `rounded-full bg-secondary px-2` with 6px dot; composer card `rounded-xl border border-input bg-card px-5 py-4 shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06)]` with 32px vertical gap between header/fields/chips/footer; popover `rounded-[10px] border border-input p-2 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)]` w-[228px]; buttons h-8 `rounded-lg` (Cancel ghost, Save `bg-primary text-primary-foreground`, disabled = 50% opacity); sidebar rows h-9 w-full `rounded-md pl-2 pr-1.5` (nested: `pl-8`), counts in a fixed `w-3 text-center` slot.

## File Structure

**Create:**
- `src/components/ui/calendar.tsx` — shadcn Calendar primitive (generated, then token-restyled)
- `src/components/tasks/DueDatePopover.tsx` — calendar + time + duration + repeat popover
- `src/components/tasks/MetadataChips.tsx` — chip row (priority/due/labels + `[+]`) shared by composer & details
- `src/components/tasks/TaskComposerCard.tsx` — the new editor card (inline + modal contexts)
- `src/components/tasks/TaskListHeader.tsx` — breadcrumb + title + sort/filter controls
- `src/components/tasks/SelectionActionBar.tsx` — floating multi-select bar
- `src/lib/task-view.ts` — pure `groupTasks()` / `filterTasks()` helpers + types

**Modify:**
- `src/components/layout/NavSidebar.tsx` — unified surface tokens
- `src/components/tasks/ProjectSidebar.tsx` — row anatomy, no color dots, count slot, indent
- `src/components/calendar/CalendarPanel.tsx` — white bg + left border
- `src/components/tasks/TaskItem.tsx` — row anatomy per frame (order, height, border, label chip, grip)
- `src/components/tasks/LocalTaskRow.tsx` — feed labels + row-click navigation
- `src/components/tasks/SectionedTaskList.tsx` — section head styling, grouping modes, add-task row
- `src/components/tasks/ProjectDetailPage.tsx` — use TaskListHeader, view state
- `src/components/pages/TasksPage.tsx` — All Tasks variant wiring
- `src/components/detail/TaskDetailPage.tsx` — full restyle per frames
- `src/components/tasks/QuickCreateDialog.tsx` → gutted to a thin modal shell around TaskComposerCard
- `src/stores/selectionStore.ts` — (only if missing) selected-ids accessors for the action bar

**Delete (end state):**
- `src/components/tasks/TaskEditor.tsx` (replaced; delete once no imports remain)

---

### Task 0: Branch + harness baseline

**Files:** none modified.

- [ ] **Step 1:** `git checkout -b tasks-figma-polish` in `nimble/`.
- [ ] **Step 2:** `cd apps/desktop && npm run build` — must pass BEFORE any changes (baseline).
- [ ] **Step 3:** Start harness: `npm run dev` (port 5173). Drive with Playwright injecting `tools/mock-tauri.js` via `addInitScript` (pattern in `tools/capture-r1.js` — do not run that script verbatim, its Chromium path is machine-specific). Screenshot the Tasks page → save to scratchpad as `baseline-tasks.png`.
- [ ] **Step 4:** Commit nothing (baseline only).

### Task 1: Sidebar restyle (NavSidebar + ProjectSidebar)

**Files:**
- Modify: `src/components/layout/NavSidebar.tsx`
- Modify: `src/components/tasks/ProjectSidebar.tsx`

**Interfaces:** none produced; pure restyle. Do not touch drag-reorder or collapse logic.

- [ ] **Step 1:** In `NavSidebar.tsx` note the current surface class (the rail background). Both the rail and the project sidebar must share ONE surface: apply the same background token to both (frame value maps to the sidebar/muted surface — if the rail already uses e.g. `bg-sidebar` or `bg-muted/50`, reuse exactly that on ProjectSidebar; the deliverable is *unified*, not a specific token). Rail keeps `border-r border-secondary`.
- [ ] **Step 2:** In `ProjectSidebar.tsx`:
  - Remove the colored dot/indicator rendered before each project name (delete the element, not just hide).
  - Row anatomy: `h-9 w-full rounded-md pl-2 pr-1.5 flex items-center gap-2`; name `flex-1 min-w-0 truncate text-meta text-foreground`; count in a fixed slot `w-3 shrink-0 text-center text-meta text-muted-foreground` so all counts align vertically.
  - Nested (child) project rows: `pl-8` instead of `pl-2`.
  - Active row: `bg-muted` + `text-meta-strong` on the name (weight shift only).
  - Parent rows with children keep their expand chevron at the far right (12px, `text-muted-foreground`), occupying the same `w-3` slot as counts.
  - "All Tasks" row keeps its 14px list icon; "New project" row at the bottom: `h-8 px-2 flex items-center gap-2 text-body text-muted-foreground` with 12px `Plus`.
- [ ] **Step 3:** `npm run build` — expect clean.
- [ ] **Step 4:** Harness screenshot; compare against frame `74:1634` left region: unified background, no dots, aligned counts, indented children. Also toggle dark mode (`document.documentElement.classList`) and screenshot.
- [ ] **Step 5:** Commit: `git commit -m "feat(tasks-ui): unify sidebar surfaces, align counts, indent nested projects"`.

### Task 2: CalendarPanel restyle

**Files:**
- Modify: `src/components/calendar/CalendarPanel.tsx` (and `src/components/layout/RightSidebar.tsx` if the surface class lives there)

- [ ] **Step 1:** Panel surface → `bg-background` (same as main content) with `border-l border-secondary`. Remove any distinct tinted background. Keep header layout, hour markers (`text-label text-muted-foreground`), hairlines (`border-secondary`), and the red now-line EXACTLY as they are.
- [ ] **Step 2:** `npm run build`; harness screenshot vs frame `74:1634` right region, light + dark.
- [ ] **Step 3:** Commit: `feat(tasks-ui): calendar panel matches main surface with left hairline`.

### Task 3: Task row anatomy (TaskItem + LocalTaskRow)

**Files:**
- Modify: `src/components/tasks/TaskItem.tsx`
- Modify: `src/components/tasks/LocalTaskRow.tsx`

**Interfaces:**
- Produces: `TaskItemData` gains `labels?: { name: string; color: string }[]`; `TaskItemProps` gains `onOpen?: () => void` (row-level open) and `dragHandleProps?: Record<string, unknown>` (dnd-kit listeners+attributes spread onto the grip).
- `ProjectBadge` is no longer rendered in rows (keep the component export if other call sites use it; check with grep first).

- [ ] **Step 1:** Restructure the row per frame `74:1634`:
  - Container: `group flex h-10 items-center gap-3 min-w-0 border-b border-secondary transition-colors hover:bg-accent/20` (selected/focused/completing classes unchanged). Row gets `onClick={onOpen}` + `cursor-default`; every interactive child calls `e.stopPropagation()`.
  - Left hover cluster (in-flow, fixed slots so revealing never shifts content): grip then checkbox. Grip: `GripVertical` 12px inside a `w-4 shrink-0` slot, `opacity-0 group-hover:opacity-100 cursor-grab text-muted-foreground`, spread `{...dragHandleProps}`. Checkbox: existing `SelectionCheckbox` (already fades in on hover/selection — keep).
  - Then: status (`StatusDropdown`, unchanged icons), then priority (`PriorityBars`), then name (`text-body`, truncate, completed → `text-muted-foreground line-through`). **Order change: status now precedes priority** (production currently renders priority first).
  - Right meta cluster `ml-auto flex shrink-0 items-center gap-2`: `SubtaskSummary` (keep), label chips, `DueDateBadge` (keep, incl. its template-literal comment).
- [ ] **Step 2:** Add `LabelChipPill` inside `TaskItem.tsx`: `<span className="flex h-5 shrink-0 items-center gap-[5px] rounded-full bg-secondary px-2 text-meta text-muted-foreground">` with a 6px `rounded-full` dot colored via `style={{ backgroundColor: color }}`. Render at most 2 chips + a `+N` overflow chip (same pill, text `+{n}`). Remove `ProjectBadge` from the render path (grep `ProjectBadge` first; if `SortableTaskList.tsx`/others consume it via TaskItem only, delete the render; keep export if imported elsewhere).
- [ ] **Step 3:** In `LocalTaskRow.tsx`: resolve the task's `labels: string[]` ids to `{name, color}` via the labels source `LabelPicker.tsx` uses (it fetches the label list — extract/reuse its hook or `dp.listLabels()` equivalent; add a small module-level cache keyed off `emitTasksChanged` if none exists). Pass `onOpen` = existing detail-open call (`detailStore` open, same as current content click) and `dragHandleProps` passed through from the sortable wrapper.
- [ ] **Step 4:** In the sortable wrapper (inside `SectionedTaskList.tsx`/`SortableTaskList.tsx`, wherever `useSortable` lives): stop spreading `listeners` on the row container; pass `{...attributes, ...listeners}` down as `dragHandleProps` instead so ONLY the grip initiates drag.
- [ ] **Step 5:** `npm run build`; harness: hover a row (grip + checkbox fade in, nothing shifts), drag by grip across sections, click row → details opens, click status icon → no navigation. Screenshot vs frame rows.
- [ ] **Step 6:** Commit: `feat(tasks-ui): new task row anatomy — grip+checkbox hover cluster, label chips, row-click opens details`.

### Task 4: List column, section heads, add-task row

**Files:**
- Modify: `src/components/tasks/SectionedTaskList.tsx`
- Modify: `src/components/tasks/ProjectDetailPage.tsx` (column width wrapper)
- Modify: `src/components/shared/CollapsibleSection.tsx` (header styling only)

- [ ] **Step 1:** Main content column: `w-full max-w-[600px] mx-auto` (header + list share it). Ensure `min-w-0` on every flex ancestor (known gotcha) and `overflow-x-hidden` on the scroll container.
- [ ] **Step 2:** Section header: `pt-5 pb-1 text-body-strong text-foreground` (no background, no border). Collapse affordance behavior unchanged.
- [ ] **Step 3:** "Add a task" row at list bottom: `pt-5 flex items-center gap-2 text-meta text-muted-foreground hover:text-foreground` with 12px `Plus`; clicking it mounts the composer (Task 8 wires this — for now keep whatever it currently opens).
- [ ] **Step 4:** `npm run build`; harness screenshot vs frame `74:1634` center region.
- [ ] **Step 5:** Commit: `feat(tasks-ui): 600px centered list column, restyled section heads and add-task row`.

### Task 5: List header — breadcrumb, title, sort & filter

**Files:**
- Create: `src/lib/task-view.ts`
- Create: `src/components/tasks/TaskListHeader.tsx`
- Modify: `src/components/tasks/ProjectDetailPage.tsx`, `src/components/pages/TasksPage.tsx`, `src/components/tasks/SectionedTaskList.tsx`

**Interfaces:**
- Produces (`src/lib/task-view.ts`):
  ```ts
  export type GroupBy = 'status' | 'priority' | 'due' | 'section' | 'manual'
  export interface TaskFilter { statuses: TaskStatus[]; priorities: number[]; labelIds: string[] }
  export const EMPTY_FILTER: TaskFilter = { statuses: [], priorities: [], labelIds: [] }
  export function filterTasks(tasks: LocalTask[], f: TaskFilter): LocalTask[]
  export function groupTasks(tasks: LocalTask[], by: GroupBy, sections: Section[]): { key: string; title: string; tasks: LocalTask[] }[]
  ```
  Group titles: status → workflow order using the display names StatusDropdown uses; priority → Urgent/High/Medium/Normal (4→1); due → Overdue is NOT a group title (no-guilt): use "Still open", "Today", "Tomorrow", "This week", "Later", "No date"; section/manual → section names, `__unsectioned__` lane first (manual = section grouping + drag enabled).
- Produces (`TaskListHeader.tsx`): `props { title: string; breadcrumb?: { label: string; onClick: () => void }[]; groupBy: GroupBy; onGroupBy: (g: GroupBy) => void; filter: TaskFilter; onFilter: (f: TaskFilter) => void; labels: {id,name,color}[] }`.

- [ ] **Step 1:** Write `task-view.ts` pure helpers. An empty filter array = facet not filtering. `filterTasks` ANDs facets, ORs within a facet.
- [ ] **Step 2:** Build `TaskListHeader`: top row = breadcrumb (left) + controls (right); second row = `text-display` title with `pl-4`. Breadcrumb: 12px `ChevronLeft` + segments `text-meta text-muted-foreground/70`, `/` separators, whole segment clickable, hidden entirely when `breadcrumb` is undefined/empty (Decision 2). Controls: two `h-6 rounded-[7px] px-1.5 hover:bg-accent` triggers — sort: `ArrowUpDown` 12px + current grouping label (`text-meta text-muted-foreground`); filter: `ListFilter` 12px + "All" or active-count label, icon LEFT of text (Decision 11). Menus: shadcn `DropdownMenu` — sort = radio group of the five `GroupBy` options; filter = checkbox items in three labeled groups (Status, Priority, Label) + "Clear filters" item when any active.
- [ ] **Step 3:** Wire into `ProjectDetailPage.tsx`: replace the current header + filter pills. View state `{groupBy, filter}` per container: `useState` initialized from `localStorage['nimble.taskview.' + projectId]`, persisted on change (same pattern for All Tasks with key `all`). Default `groupBy: 'section'` for projects (current behavior), `'status'` for All Tasks. Pass filtered+grouped output to the list: SectionedTaskList renders the returned groups; drag between lanes only when `groupBy` is `section`/`manual` (pass `dragEnabled` prop; when false, omit sortable context between groups but keep the grip visible working within... NO — simpler and correct: when `dragEnabled` is false hide the grip entirely via prop threaded to TaskItem `showGrip={dragEnabled}`).
- [ ] **Step 4:** Breadcrumb data: project's `parent_id` → parent project name via `useProjects`; `onClick` navigates to parent project view (same mechanism the sidebar uses to select a project).
- [ ] **Step 5:** `npm run build`; harness: group by each of the five modes, apply a status+label filter, confirm persistence across reload, breadcrumb only on the nested "Nimble" project (mock data has Portfolio→Nimble per the frames — if mock data lacks nesting, extend `tools/mock-tauri.js` accordingly).
- [ ] **Step 6:** Commit: `feat(tasks-ui): list header with breadcrumb, grouping and filter menus`.

### Task 6: DueDatePopover

**Files:**
- Create: `src/components/ui/calendar.tsx` (via `npx shadcn@latest add calendar` — accept the base-nova style; it adds `react-day-picker` to package.json)
- Create: `src/components/tasks/DueDatePopover.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface DueValue { dueDate: string | null; dueTime: string | null; durationMinutes: number | null; recurrenceRule: string | null }
  export function DueDatePopover(props: { value: DueValue; onChange: (v: DueValue) => void; children: ReactNode /* trigger */ })
  ```
- Consumes: `RECURRENCE_OPTIONS`, `parseRecurrenceRule`, `formatRecurrenceBase` from `@/lib/recurrence` (already exist — see TaskEditor.tsx:21); duration presets follow TaskEditor's `DURATION_OPTIONS` values.

- [ ] **Step 1:** Generate the shadcn calendar; restyle: day cells `text-meta`, selected day `bg-primary text-primary-foreground rounded-md`, today `bg-accent rounded-md`, nav chevrons 14px `text-muted-foreground`, month label `text-meta-strong`.
- [ ] **Step 2:** Build popover on shadcn `Popover`: content `w-[228px] rounded-[10px] border border-input bg-card p-2 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)]`, containing: Calendar; then an "Add time" collapsed row; then Duration; then Repeat — each collapsed state a full-width `h-7 rounded-[7px] border border-border text-body text-muted-foreground/60 flex items-center justify-center hover:bg-accent` button (per frame `71:1521`).
  - Expanded Duration (click): preset chips row (15m, 30m, 1h, 2h — values 15/30/60/120) as `h-6 rounded-md border border-border px-2 text-meta hover:bg-accent`, active chip `bg-secondary border-input`, plus a 3ch minutes `Input` (`h-6 text-meta`). Once set, collapsed row shows the value + a 12px `X` button that clears (`durationMinutes: null`).
  - Expanded Repeat: preset list Daily / Weekdays / Weekly / Monthly mapped through `RECURRENCE_OPTIONS`/`formatRecurrenceBase` canonical strings, plus a custom row: "Every" + number `Input` + days/weeks `Select`. Selected shows in collapsed row + `X` clears.
  - "Add time": expands to `<Input type="time">` (`h-7 text-meta`); set → collapsed row shows e.g. "9:00 AM" + `X` clears (`dueTime: null`).
  - Clearing the date (re-click selected day) also nulls time+duration (mirror TaskEditor.tsx:113 semantics).
- [ ] **Step 3:** `npm run build`; harness: temporarily mount the popover from any chip (Task 7 wires it properly) OR verify via Task 7. If deferring visual check to Task 7, still verify build + a smoke render.
- [ ] **Step 4:** Commit: `feat(tasks-ui): due-date popover with calendar, time, duration and repeat`.

### Task 7: MetadataChips

**Files:**
- Create: `src/components/tasks/MetadataChips.tsx`

**Interfaces:**
- Consumes: `DueDatePopover` + `DueValue` (Task 6), `LabelPicker` (existing), `PriorityBars`, `PRIORITY_OPTIONS` (mirror TaskEditor.tsx:23 — Normal 1 / Medium 2 / High 3 / Urgent 4).
- Produces:
  ```ts
  export interface ChipValues { priority: number; due: DueValue; labelIds: string[]; projectId?: string; sectionId?: string | null; linkedDocId?: string | null }
  export type ExtraField = 'project' | 'section' | 'linkedDoc'
  export function MetadataChips(props: {
    values: ChipValues
    onChange: (patch: Partial<ChipValues>) => void
    context: 'composer' | 'details'   // composer [+] → project, section; details [+] → section, linkedDoc
    projects?: Project[]; sections?: Section[]; labels: { id: string; name: string; color: string }[]
  })
  ```

- [ ] **Step 1:** Chip anatomy, two visual states per frames `70:1210`/`71:1555`:
  - Empty chip: `h-6 rounded-md border border-border px-2.5 text-body text-muted-foreground hover:bg-accent` with field name ("Priority", "Due", "Labels").
  - Filled chip: `h-6 rounded-md bg-secondary border border-input pl-2.5 pr-1 text-body text-foreground flex items-center gap-[5px]` — content: priority → `PriorityBars` 12px + label; due → `Calendar` 12px + "Due Aug 12" (relative labels reused from DueDateBadge logic); labels → 6px color dot + name (one chip per label); project/section/linkedDoc → name. Trailing ✕: 12px `X` in a `size-4` hit area, `opacity-0 group-hover/chip:opacity-100` (chip gets `group/chip`), click clears that field (`e.stopPropagation()`).
  - `[+]` chip: `h-6 rounded-md border border-dashed border-input px-2.5 hover:bg-accent` with 12px `Plus` → `DropdownMenu` listing not-yet-set extra fields for the context (Decision 17). Selecting one immediately opens that field's picker.
  - On details context the row uses `gap-4` between chips (frame `79:2009`); composer uses `gap-1.5` (frame `70:1210`).
- [ ] **Step 2:** Pickers: priority → `DropdownMenu` of the four options with `PriorityBars` preview; due → wrap chip in `DueDatePopover`; labels → existing `LabelPicker` in a `Popover`; project/section → shadcn `Select`-style dropdown lists from props; linkedDoc → reuse the existing linked-doc picker from `TaskDetailPage.tsx` (grep its current implementation and lift it).
- [ ] **Step 3:** `npm run build`; smoke-render in harness (can temporarily mount in ProjectDetailPage behind a dev flag, removed before commit — or verify via Task 8).
- [ ] **Step 4:** Commit: `feat(tasks-ui): shared metadata chip row with pickers`.

### Task 8: TaskComposerCard (replaces TaskEditor + QuickCreateDialog)

**Files:**
- Create: `src/components/tasks/TaskComposerCard.tsx`
- Modify: `src/components/tasks/QuickCreateDialog.tsx` (becomes a thin Dialog shell), `src/components/tasks/SectionedTaskList.tsx` (inline mount from "Add a task" / "Add subtask"), plus every `TaskEditor` call site (grep `TaskEditor`)
- Delete: `src/components/tasks/TaskEditor.tsx` (final step, once grep shows zero imports)

**Interfaces:**
- Consumes: `MetadataChips` (Task 7), `useDataProvider`, `emitTasksChanged`, `taskToast` from `@/lib/taskToast`.
- Produces: `TaskComposerCard(props: { defaults?: Partial<ChipValues> & { projectId?: string; sectionId?: string; parentId?: string }; onClose: () => void; onCreated?: (t: LocalTask) => void })`. **Create-only** (Decision 14 + 18: editing an existing task happens on Task Details; the old TaskEditor edit flow routes to opening details instead — update its call sites accordingly).

- [ ] **Step 1:** Card per frames: `rounded-xl border border-input bg-card px-5 py-4 shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06)] flex flex-col gap-8`. Header row: `text-body-strong` "New task" + 17px `X` close button right. Title: borderless `input` styled `text-display placeholder:text-foreground/25` (placeholder "Task title"), autofocus. Description: borderless auto-growing `Textarea` `text-body placeholder:text-foreground/25` (placeholder "Description"), raw markdown, min 1 row. Chips: `MetadataChips context="composer"`. Footer right-aligned: Cancel `h-8 rounded-lg px-3.5 text-body` ghost; Save `h-8 rounded-lg px-4 bg-primary text-body text-primary-foreground disabled:opacity-50`, disabled while `title.trim() === ''`.
- [ ] **Step 2:** Keyboard (Decision 16): card-level `onKeyDown` — Esc: if any field dirty, `window.confirm('Discard this task?')` then `onClose()`, else close immediately; ⌘Enter: save if enabled. Title `onKeyDown`: plain Enter → `preventDefault()` + focus description. Natural Tab order title → description → chips (no custom trap).
- [ ] **Step 3:** Save: `dp` create-task call with `{ content, description: description || null, project_id, section_id, parent_id, priority, due_date, due_time, duration_minutes, recurrence_rule, labels }` (match the exact create signature in `useLocalTasks`/`tauri.ts` — grep `createTask`), then `emitTasksChanged()`, `taskToast`, reset fields, keep card open for rapid entry in inline context / close in modal context (prop `closeOnSave?: boolean`).
- [ ] **Step 4:** Mount points: (a) "Add a task" row → replaces itself with an inline card (list bottom, same 600px column); (b) "Add subtask" on details → inline card with `parentId` defaulted; (c) `QuickCreateDialog` → shadcn `Dialog` containing only the card (`closeOnSave`), delete its old form body.
- [ ] **Step 5:** Route old TaskEditor edit-callsites to detail-open (`detailStore`), then delete `TaskEditor.tsx`. `grep -r "TaskEditor" src/` must return nothing.
- [ ] **Step 6:** `npm run build`; harness: create task inline (chips: set priority via dropdown, date+time+repeat via popover, label), ⌘Enter saves, Esc-dirty confirms, Save disabled when empty, quick-create modal path works. Screenshots vs frames `70:1210`/`71:1555`.
- [ ] **Step 7:** Commit: `feat(tasks-ui): unified composer card replaces TaskEditor and QuickCreateDialog form`.

### Task 9: Task Details page restyle

**Files:**
- Modify: `src/components/detail/TaskDetailPage.tsx`
- Modify (if breadcrumb markup lives there): `src/components/detail/DetailSidebar.tsx`

**Interfaces:**
- Consumes: `MetadataChips context="details"`, `TaskComposerCard` (Add subtask), `useTaskDetail`, `InlineTitle`.

- [ ] **Step 1:** Layout: 600px centered column, `pt-[30px]`. Top row: breadcrumb (`‹ Portfolio / Nimble / <parent task>` per Decisions 2/3 — segments from project chain + optional parent task via `useTaskDetail`; hide when nothing to show) left; right cluster: ONLY the gear trigger (`Settings` 12px, `h-6 w-6 rounded-[7px] hover:bg-accent`) — no paperclip (Decision 13).
- [ ] **Step 2:** Gear `DropdownMenu` (Decision 12): "Move to project…" (submenu of projects → update task), "Duplicate task" (create copy with same fields, toast), "Copy ID" (`navigator.clipboard.writeText(task.id)`), separator, "Delete task" (`text-destructive`, `window.confirm`, then delete + close detail).
- [ ] **Step 3:** Title: `InlineTitle` restyled `text-display pl-4` (click-to-edit unchanged). Below, `MetadataChips` with `gap-4`, values bound to the task, `onChange` patches via the same update calls TaskDetailPage already makes for priority/status/etc.
- [ ] **Step 4:** Description (Decision 15): replace the Tiptap editing surface for markdown-canonical tasks — display = rendered markdown (reuse whatever renderer the app already has for read-only markdown; grep for the Tiptap read-only usage or a markdown renderer — if only Tiptap exists, render read-only Tiptap but NEVER write back through it); click anywhere on it swaps to a raw auto-grown `Textarea` seeded with `task.description`; blur or ⌘Enter saves raw string; Esc reverts. Empty state: `text-body text-foreground/25` "Description" placeholder, click → edit mode. Legacy-HTML tasks (existing sniff at TaskDetailPage.tsx:76-79): keep read-only rendered view; editing converts nothing silently — leave the current legacy path untouched.
- [ ] **Step 5:** Subtasks: section header "Subtask" (`text-body-strong pb-1`), subtask rows via the SAME `TaskItem` row (Task 3 anatomy, `onOpen` navigates detail to that subtask), "Add subtask" row (12px `Plus` + `text-meta text-muted-foreground`) mounting an inline `TaskComposerCard` with `parentId`. 48px gap between description block and subtask block (`gap-12` on the column, frame `79:2009`).
- [ ] **Step 6:** `npm run build`; harness (drive `detailStore` via `window.__stores`): filled + empty states vs frames `79:2009`/`83:2378`, gear actions, breadcrumb on subtask, description edit round-trip preserves markdown verbatim (type `**bold** and `code``, save, reopen, confirm identical string).
- [ ] **Step 7:** Commit: `feat(tasks-ui): task details page — chips, raw-markdown description, subtasks, gear menu`.

### Task 10: SelectionActionBar

**Files:**
- Create: `src/components/tasks/SelectionActionBar.tsx`
- Modify: `src/components/tasks/ProjectDetailPage.tsx` + `src/components/pages/TasksPage.tsx` (mount), `src/stores/selectionStore.ts` (only if bulk helpers are missing)

**Interfaces:**
- Consumes: `useSelectionStore` (selected ids, clear), `useDataProvider` mutations, `useProjects`.

- [ ] **Step 1:** Bar: fixed within the list container, bottom-centered (`sticky bottom-4 mx-auto w-fit`), `rounded-[10px] border border-input bg-card px-2 py-1.5 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)] flex items-center gap-1`, animate in with existing app patterns (or `animate-in fade-in slide-in-from-bottom-2`). Renders only when ≥1 task selected. Contents: `text-meta text-muted-foreground` count ("3 selected"), separator, then `h-7 rounded-md px-2 text-body hover:bg-accent` buttons: Complete, Move to… (project submenu), Priority (submenu of 4), Delete (`text-destructive`, confirm), and a 12px `X` icon-button that clears selection.
- [ ] **Step 2:** Actions loop the selected ids through the existing single-task mutations (complete/update/delete via `dp`), then `emitTasksChanged()` + clear selection + one summary toast. (No new bulk backend commands — YAGNI at current data sizes.)
- [ ] **Step 3:** `npm run build`; harness: select 3 rows via hover checkboxes, run each action, bar clears. Screenshot.
- [ ] **Step 4:** Commit: `feat(tasks-ui): floating multi-select action bar`.

### Task 11: Full QA sweep + plan close-out

**Files:** fixes only as found.

- [ ] **Step 1:** `npm run build` clean.
- [ ] **Step 2:** Harness sweep, screenshots saved to scratchpad: list view (all five groupings), filters active, row hover, drag, composer inline + modal, due popover fully expanded, details filled/empty/subtask, action bar — each in light AND dark, plus at least one non-default accent theme.
- [ ] **Step 3:** Compare against all six frames; fix deviations. Re-run `npm run build` after fixes.
- [ ] **Step 4:** Grep sweep: `TaskEditor` (must be gone), `ProjectBadge` (no dangling imports), `text-[1` (no raw font sizes introduced), hex colors in changed files (only the sanctioned now-line red).
- [ ] **Step 5:** Final commit; leave branch UNMERGED — Marco reviews in the real app (`npm run tauri dev`) before merge + `npm run update-app`.

## Self-Review (done at write time)

- Spec coverage: all 24 Q&A decisions map to tasks (1→T3, 2→T5/T9, 3→T9, 5/5b→T3/T10, 6→T3, 7→T3, 8→existing DueDateBadge kept, 9→T3, 10→T5, 11→T5/T7, 12→T9, 13→T9, 14→T8, 15→T8/T9, 16→T8, 17→T7, 18→T9, 19→T6, 20→T6, 21→T6, 22→task order, 23→T11, 24→T2). Annotation items: sidebar (T1), header/600px (T4/T5), sort/filter icons (T5), row border+hover (T3), calendar surface (T2), chips hover-shade (T7), seamless title/description edit (T9), composer save-gating (T8), popover merge of duration/repeat (T6).
- Type consistency: `DueValue`/`ChipValues`/`GroupBy`/`TaskFilter` defined once (T5/T6/T7) and consumed by name in T8–T10.
- Open judgment calls delegated to implementers are marked with grep-first instructions rather than invented signatures (create-task call shape, labels lookup, markdown renderer availability).
