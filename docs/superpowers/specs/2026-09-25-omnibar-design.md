# Omnibar — unified ⌘K / ⌘F bar (design)

Date: 2026-09-25 · Status: approved in conversation, awaiting spec review · Supersedes the 2026-08 decision "⌘K is actions-only; vault search lives in the Docs sidebar" (Marco reversed it 2026-09-25).

## Goal

One keyboard-first bar that searches and creates every kind of item — tasks, notes, docs, goals, projects, labels — and runs app actions. Filters are no longer dropdown pills; they are **inferred from what you type** and become removable pills inside the text field.

Success looks like:
- ⌘K and ⌘F open the same bar; there is no second search overlay.
- Typing `completed` offers "Filter by status: completed"; typing `photography` offers "Filter by label: photography"; accepting turns the word into a pill and narrows results.
- Typing `go on a 4K run` offers Create Task · Note · Doc · Goal · Project · Label.
- Pills carry into creation (label/project applied to a new task).

## Decisions (Marco, 2026-09-25)

| Question | Decision |
|---|---|
| App actions (go to page, toggles, settings) | Mixed into the same result list as their own **Actions** group and filterable type |
| Item types | **Note** = captures (Inbox "Notes"). **Doc** = native docs + Obsidian vault notes (vault opens read-only, marked with a vault icon). Create doc = new native doc |
| Pills + create | Pills carry over: label + project applied to the new item; a `type:` pill promotes that type to the default create row; status pills ignored for creation |
| Architecture | Approach A: fan out over existing search sources, results grouped by type, **no schema migration** |

## 1. The bar (UI + keyboard)

```
┌──────────────────────────────────────────────────────────┐
│ ⌕ [label: photography ×] [status: open ×] portola▍       │
├──────────────────────────────────────────────────────────┤
│ FILTERS                                                  │
│   ⏷ Filter by project: Portola 2026            Tab       │
│ TASKS                                                    │
│ ▸ ○ Portola recap to Sara                   Portfolio    │
│   ○ Portola credential will call                         │
│ DOCS                                                     │
│   ▤ Portola shot list                                    │
│   ◇ Portola 2025 notes (vault)                           │
│ ACTIONS                                                  │
│   → Go to Settings                                       │
│ CREATE                                                   │
│   + Task "portola"   · Note · Doc · Goal · Project · Label│
└──────────────────────────────────────────────────────────┘
```

1. **Opening.** ⌘K and ⌘F both open the Omnibar (same instance, never stacked). Existing prefixes stay: `/task`, `/capture` / `/note`, `/doc`, and user capture routes. The old ⌘F overlay and its Status/Label/Project dropdown chips are removed.
2. **Field.** A single row: pills first, then the text input. Each pill shows `kind: value ×`; clicking × removes it. **Backspace in an empty input removes the last pill.**
3. **Inferred filters (FILTERS group, top, max 3 rows).** Each whitespace-separated token of the text (and the whole text, for multi-word names) is matched case-insensitively, emoji/diacritics-stripped, by prefix against:
   - statuses: `open`, `completed` (aliases `done`, `complete`)
   - labels (non-archived) — `Filter by label: photography`
   - projects (non-archived) — `Filter by project: Portola 2026`
   - types: `task`/`tasks`, `note`/`notes`, `doc`/`docs`, `goal`/`goals`, `action`/`actions`
   Exact matches rank above prefix matches; ties: status, type, label, project. A suggestion is never offered for a kind+value already pilled, and only one status / one type pill may exist (accepting a new one replaces it). Multiple label pills AND together; one project pill at a time.
   **Accepting** (click, Enter on the row, or **Tab** = accept the top suggestion) adds the pill and removes the matched word(s) from the text. Filters never apply unless accepted.
4. **Result groups**, in order: Tasks, Notes, Docs, Goals, Actions. Each group shows up to 5 rows plus "Show all N" (expands that group in place). Tasks: open first, completed dimmed, snippet when the title doesn't contain every token (reusing C4 behavior). Docs: native docs and vault notes interleaved by source order (native first), vault rows carry a vault icon and open the read-only vault viewer. A `type:` pill shows only that group. Status/label/project pills filter Tasks only; while any of them is active, non-task groups are hidden (they can't match those filters).
5. **Empty query.** Shows recent searches (existing `recentSearches`, device-local) then the default Actions list.
6. **CREATE group (always last, whenever text is non-empty).** Rows: Task, Note, Doc, Goal, Project, Label — Task first unless a `type:` pill promotes another. Task create keeps date parsing (`useCaptureDate`: "tomorrow 9am"). Carry-over: label pills → labels on the new task; project pill → task's project (and a new Doc/Goal ignores them). Goal created with name only (no life area); Project with name only; Label ungrouped.
7. **Enter / default row — "Tasks or create" (Marco, 2026-09-25, replaces "first search result").** Enter activates the highlighted row. On each query change the highlight goes to the first Tasks row if the Tasks group has any, otherwise to the first CREATE row (Create task, or the create a `type:` pill promotes). Notes, Docs, vault notes, Goals and Actions never take the default; you arrow to them. The old ⌘K rules still apply: a first word that is an action verb (buy, call, email, book, schedule, …) defaults to Create task even when tasks match, and a `note:` / `idea:` / `remember` start defaults to Create note. A non-task `type:` pill (or `/doc`) defaults to that group's first row, else its create row. An empty bar defaults to the first recent search, else nothing, so Enter does nothing. Arrow keys move across groups. Task-row quick actions ⌥C (complete), ⌥B (AI breakdown), ⌥M (move to project) keep working.
8. **After activation.** Opening an item / running an action closes the bar. Creating closes the bar and shows the existing success toast with an Open link where one exists today.

## 2. Build

### Backend (nimble-core + src-tauri) — read-only additions, no migration
- `search_captures(query, limit)` — LIKE over capture text, newest first, excludes archived/converted captures if such a state exists (match current Inbox visibility).
- `search_goals(query, limit)` — LIKE over name + description, active before completed/archived.
- Tauri commands + `DataProvider` methods for both. Reused as-is: `search_tasks` (status/label/project filters), `search_documents`, `vault_search`.
- Rust unit tests for both functions (match, ordering, limit, empty query).

### Frontend (`apps/desktop/src`)
- `lib/omnibarQuery.ts` (pure) — field state `{ pills, text }`; `suggestFilters(text, catalog)`; `acceptSuggestion`; `removeLastPill`; pill rules (single status/type/project, multiple labels).
- `lib/omnibarSearch.ts` + `hooks/useOmnibarResults.ts` — parallel fan-out, ~120 ms debounce, stale-response guard (request id), per-source failure isolation (failed source → empty group, logged, no toast), grouping + per-group limits.
- `lib/omnibarCreate.ts` (pure mapping + thin effectful creators) — create rows, type promotion, pill carry-over; calls existing `addTask`, `captures.create`, `create_document`, `create_goal`, `create_project`, `get_or_create_label_by_name`.
- `components/omnibar/Omnibar.tsx` (+ `OmnibarField`, `OmnibarResults`) — replaces `components/shared/CommandBar.tsx`, reusing row parts from `CommandBarResults.tsx`. Keyboard: ⌘K + ⌘F + `open-command-bar` event.
- Delete: `components/search/TaskSearch.tsx`, `SearchFilterChips.tsx`, `stores/taskSearchStore.ts`, the `/search ` handoff in `commandBarMode.ts`; update `lib/shortcuts.ts` (⌘F label → "Search").
- Actions list: existing ⌘K action source, unchanged, rendered as the Actions group.

### Web build
Tasks (existing `searchTasksLike`) and Notes (new Turso LIKE) work. The Docs group (doc search isn't implemented on web), Goals group and "Create goal" are hidden on web. Create Task/Note/Doc/Project/Label stay. No Vercel deploy as part of this work.

### Testing
- Unit: `omnibarQuery` (suggestions, ranking, aliases, Tab/Backspace, pill rules), `omnibarCreate` (carry-over, promotion), `omnibarSearch` (grouping, stale guard, failure isolation).
- Rust: `search_captures`, `search_goals`.
- e2e: replace `e2e/c4-search.spec.ts` with `e2e/omnibar.spec.ts` — ⌘K and ⌘F open the same bar and never stack; Tab turns `completed` into a status pill and results narrow; Backspace removes it; `type:` pill shows one group; create task with label+project pills carries both; axe clean. Keep `e2e/t2-row-keys.spec.ts:531` passing.
- Keep existing `commandBarMode`, `captureDate`, `captureRoutes` tests green.

## Delivery
Own branch/worktree off main (`omnibar/unified-bar`), no schema version, so it can build in parallel with brief phase 3 (v26) and momentum (v27) and merge after them; expected conflicts only in Tauri command registration (`lib.rs`) and `DataProvider`.

## Out of scope
- Explicit `#project` / `@label` typed syntax (inferred suggestions cover it; revisit later).
- Cross-type relevance ranking; semantic/AI search.
- Editing vault notes; searching brief notes or doc_notes.
- Web deploy.
