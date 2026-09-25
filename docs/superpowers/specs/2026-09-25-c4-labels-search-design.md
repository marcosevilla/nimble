# C4: grouped labels and task search

**Status:** approved in conversation 2026-09-25 (Marco). Supersedes the C4 row of `docs/todoist-replacement-decisions.md` where they differ (D7's ENERGY / TIME / TYPE / CREATIVE groups and emoji backfill; D8's "⌘K /search" surface). D8's core stands: device-local FTS5 over title + description, including completed tasks, plus `dt task search`.

## 0. Decisions (2026-09-25)

| # | Question | Decision |
|---|---|---|
| 1 | Which groups | **Seed by real use.** EFFORT (`deep`, `quick`) · TYPE (`comms`, `admin`, `errands`, `photography`, `health`) · STATE (`waiting`, `avoidance`) · ASSIST (`needs-claude`). `from-instinct` and `nimble` go in a **system** group, hidden from pickers and row chips. The 25 labels with no open tasks are **archived** (restorable). Seeding is a post-install `dt` script, not a migration: new profiles start with no groups. |
| 2 | Exclusivity | **Per-group "Pick one" switch** (Linear label groups / GitLab scoped labels). EFFORT is pick-one; the rest are multi. Enforced only on user edits. |
| 3 | Search surface | **⌘F search overlay**, separate from ⌘K. ⌘K's `/search` mode hands its query to ⌘F. Completed tasks are always included, ranked below open ones (Linear), never behind an extra click (Things / Todoist). |
| 4 | System labels | Hidden in pickers and row chips; still listed in the label filter under "System". (Claude's call, approved.) |

Why the D7 taxonomy changed: in the live DB (2026-09-25) only 8 of 33 labels are on open tasks (`deep` 349, `quick` 335, `comms` 115, `from-instinct` 75, `needs-claude` 34, `nimble` 17, `waiting` 10, `avoidance` 6), every `labels.group` is NULL, and only 6 labels carry an emoji prefix, so an emoji backfill would group almost nothing.

## 1. Goals and non-goals

- **Goal:** labels read as a small, ordered taxonomy everywhere they appear, and one keystroke finds any task Marco has ever written, open or done.
- **Goal:** it works for a new user: groups start empty, nothing depends on Marco's label names.
- **Non-goals:** saved searches, a search query language (`label:x`), searching docs/captures from ⌘F (Docs keeps its own `/` search), nested groups, per-label keyboard shortcuts, label colors redesign.

## 2. Data model (schema v24)

One statement per `;` (the migration runner splits on it).

```sql
CREATE TABLE label_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  exclusive INTEGER NOT NULL DEFAULT 0,   -- 1 = "Pick one"
  system INTEGER NOT NULL DEFAULT 0,      -- 1 = hidden from pickers + row chips
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);
ALTER TABLE labels ADD COLUMN archived_at TEXT;
CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id UNINDEXED, content, description, tokenize = 'unicode61 remove_diacritics 2')
```

- `labels."group"` (v20, all NULL today) stores a `label_groups.id`. A dangling id reads as ungrouped.
- `label_groups` and `labels.archived_at` sync through `sync_log`, are added to `initialize_remote`, and are gated by `turso_schema_v24_upgraded` (same idiom as v20–v23 in `nimble-core/src/db/sync.rs`).
- `tasks_fts` is **device-local, never synced**, like `vault_fts`. It is maintained in code, not by triggers.
- Todoist has no groups or archive. Both fields are local-only metadata: the Todoist pull maps labels by name (`todoist_migration.rs` `get_or_create_label_by_name`) and never touches `group` or `archived_at`; new labels from Todoist arrive ungrouped and unarchived.
- Mobile mirror skipped (dormant).

## 3. Label groups

### 3.1 Rules

- A label belongs to zero or one group. Ungrouped labels are always multi.
- **Pick one:** in an exclusive group, applying a label removes any other label from that group on the same task. The picker renders that group as a radio set. Rust `set_task_labels` does **not** enforce it (sync can legitimately deliver two, and a sync must never drop data). The UI enforces it on edit; a task that already holds two keeps both until the next edit of that group.
- **System** groups: their labels are hidden from `LabelPicker`, row chips (`MetadataChips`) and the create-task modal. They stay in the label filter under their group name and in task detail's label row as muted text (read-only). The auto-applied `nimble` origin label keeps working.
- **Archived** labels: hidden from pickers and the label filter; still render on tasks that have them (chips normal, so completed history reads correctly). Applying an archived label from Todoist does not unarchive it. Restore = clear `archived_at`.
- Order everywhere: group `position`, then label `position`; ungrouped last; system group after ungrouped (filter only).

### 3.2 Surfaces

- **LabelPicker** (`components/tasks/LabelPicker.tsx`, used by row `l`, row chip click, task detail, create modal): sections with a small-caps group header (`text-caption`, muted), exclusive groups as radio rows (`role=radio` in a `radiogroup`), others as checkbox rows. Type-to-filter searches across all groups and keeps section headers for matches. "Create "x"" row at the end creates an ungrouped label. ↑/↓ cross sections, Space/Enter toggles, focus returns to the trigger (existing contract).
- **Row chips**: grouped order, system hidden. No visual group marker on chips (keeps rows quiet).
- **Label filter** (`lib/labelFilter.ts` + `TaskListHeader.tsx`): same grouped sections, tri-state per label unchanged; system group listed last; archived not listed.
- **Label Manager** (Settings → Tasks & capture → Labels, `components/settings/LabelManager.tsx`):
  - Sections per group, then Ungrouped, then System (collapsed), then **Archived (N)** (collapsed, each row has Restore).
  - Group header row: inline rename, **Pick one** switch, ⋯ menu (Delete group → its labels become ungrouped; Undo via `lib/undoable.ts`).
  - "New group" button. Drag labels between groups and drag groups to reorder (`@dnd-kit/sortable`, precedent `components/focus/FocusQueueList.tsx`); `⌥↑/↓` moves the focused label or group for keyboard users.
  - **Archive unused** button, shown when ≥1 visible label has 0 open tasks: confirm dialog lists the count ("Archive 25 labels with no open tasks? They stay on completed tasks and you can restore them.") → archive → toast with Undo.
  - Mark a group as System only via `dt` (keeps the Settings surface simple; system groups are for integration labels).

### 3.3 Commands and contract

- Rust `nimble-core/src/db/labels.rs` (or the existing labels module): `list_label_groups`, `create_label_group(name, exclusive)`, `update_label_group(id, {name?, exclusive?, system?, position?})`, `delete_label_group(id)` (ungroups members in the same transaction), `reorder_label_groups(ids)`, `set_label_group(label_id, group_id|null)`, `archive_labels(ids)`, `restore_label(id)`, `unused_label_ids()` (no open task). All mutations append `sync_log`.
- `Label` type gains `archived_at: string | null`; new `LabelGroup` type. `DataProvider.labels` gains `groups: { list, create, update, delete, reorder }`, `setGroup`, `archive`, `restore`, `unusedIds`. `TursoProvider` implements all of them (plain SQL over Turso).
- `dt label list --json` · `dt label group create <name> [--pick-one] [--system]` · `dt label group assign <label> <group>` · `dt label archive <label…> | --unused` · `dt label restore <label>`. Names resolve case-insensitively; ambiguity is an error.

### 3.4 Seeding Marco's data (post-install, with Marco's OK)

A checked-in script `tools/seed-label-groups.sh` runs the `dt` commands for decision 1, after a backup, and prints before/after counts. It is idempotent (existing groups are reused by name). Not run by any migration or on any other profile.

## 4. Task search

### 4.1 Index

- `tasks_fts(task_id, content, description)` holds every row of `local_tasks` (open, completed, any project, including archived projects). Deleted tasks are removed.
- Maintained at the single write funnel in `nimble-core/src/db/tasks.rs` (create, update, the `update_*_if_unchanged` variants, status changes, delete) **and** on every incoming apply (Turso pull, Todoist pull, reconcile). Index writes are fire-and-forget like `log_activity`: an index failure never fails the user's mutation.
- **Self-healing rebuild:** on startup, if `tasks_fts` row count ≠ `local_tasks` row count, or setting `tasks_fts_version` ≠ current, rebuild in one transaction (≈1.4k rows, well under a second). Same entry point is exposed as `dt task search --reindex`.

### 4.2 Query

- Input is sanitized into FTS5 tokens: split on whitespace, strip FTS syntax characters (`"*:^()-+`), drop empties; each token becomes `"tok"*` (prefix match for as-you-type), joined with AND. An empty result after sanitizing returns no results, never an FTS syntax error.
- Ranking: open tasks first (`status != 'complete'`), then `bm25(tasks_fts, 0, 10.0, 1.0)` (title matches weigh 10× description), then `updated_at` DESC.
- Snippet: `snippet(tasks_fts, 2, '\u0002', '\u0003', '…', 12)` from the description only when the match is in the description; the frontend splits on the control markers into `<mark>` spans (never `dangerouslySetInnerHTML`).
- Filters (all optional): `status: 'all' | 'open' | 'completed'` (default `all`), `label_ids` (any-of), `project_id`. Limit 50.
- Rust `search_tasks(pool, query, filters, limit) -> Vec<TaskSearchHit { task: LocalTask, snippet: Option<String>, matched_in: 'title'|'description' }>`; Tauri `search_tasks`; `DataProvider.tasks.search(query, filters)`.
- **Web** (`TursoProvider`): no FTS over Turso. Same signature, implemented as `LIKE` on `content`/`description` with the same open-first ordering and a plain substring snippet built client-side. Documented as degraded, not hidden.
- `dt task search <query> [--status open|completed|all] [--label <name>] [--project <name>] [--limit N] [--json]`.

### 4.3 ⌘F overlay

- New `components/search/TaskSearch.tsx`, built on the existing command primitives (`components/ui/command.tsx`) and the same dialog shell as `CommandBar`, so it looks like ⌘K. Registered in `lib/shortcuts.ts` (`⌘F` "Search tasks", appended) and opened from anywhere except while another overlay is open (`OVERLAY_SELECTOR` guard). ⌘K search mode (`/search`) closes ⌘K and opens ⌘F with the query.
- Layout: input with filter chips on the right (Status, Label → grouped `LabelPicker` in filter mode, Project). Results in two groups, **Open** then **Completed** (completed rows use the existing completed-row styling: muted title, check mark, completion date on the right instead of project). Each row: status mark, title with matched terms highlighted, project name; second line snippet when the match is in the description.
- Empty query: **Recent** (last 8 queries, per device, `localStorage` wrapped in try/catch) and nothing else. No results: `EmptyState` "No tasks match "x"." with the active filters listed and a Clear filters action.
- Keys: type to search (debounced 80 ms; stale responses dropped by request id), ↑/↓ move, ↵ opens the task in detail, ⌘↵ opens its project with the task selected, Tab moves to the filter chips, Esc closes and restores focus.
- Performance target: results under 50 ms for Marco's data on the Mac.

## 5. Testing and acceptance

- Rust: group CRUD + ungroup-on-delete; archive/restore/unused; `set_task_labels` does not enforce exclusivity; FTS kept in sync across create/update/status/delete/incoming apply; rebuild on count mismatch; sanitizer (quotes, `*`, `-`, unicode, empty); ranking (open before completed, title before description); filters.
- Frontend unit (`node --test`): exclusive-group toggle logic, grouped ordering helper, snippet marker splitting, recent-search store.
- e2e (Playwright + axe, `tools/qa-frozen.sh`): picker sections + radio behavior; Label Manager drag + archive unused + restore; ⌘F search open/completed grouping, filters, keyboard flow, focus restore; axe baseline holds. `tools/mock-tauri.js` gains every new command (unmocked commands only warn, so e2e would silently pass).
- **Exit test (real app, Marco):** after the seed script, the picker shows EFFORT / TYPE / STATE / ASSIST with EFFORT as pick-one; `from-instinct` and `nimble` chips are gone from rows; ⌘F "portfolio" returns open tasks first and at least one completed task, with description snippets; `dt task search edd --status completed --json` returns completed EDD tasks.
