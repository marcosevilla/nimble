# C4 Grouped Labels + Task Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Labels read as a small ordered taxonomy (groups, "Pick one", system, archive) everywhere they appear, and ⌘F finds any task Marco has ever written, open or done, from a device-local FTS5 index.

**Architecture:** Schema v24 adds `label_groups`, `labels.archived_at` (both synced through `sync_log`, gated on Turso by `turso_schema_v24_upgraded`) and a device-local `tasks_fts` FTS5 table maintained in code at the real write funnel (`db/task_tx.rs`) and at the one incoming-apply boundary (`focus::task_write::TaskWrite::commit`), with a self-healing rebuild on startup. A new `db/task_search.rs` owns the index and the ranked query; the frontend gets pure, node-tested helpers (`lib/labelTaxonomy.ts`, `lib/labelManagerModel.ts`, `lib/taskSearch.ts`, `lib/recentSearches.ts`), one shared taxonomy hook, a grouped `LabelPicker`, a rebuilt Label Manager and a ⌘F `TaskSearch` overlay.

**Tech Stack:** Rust (`nimble-core`, sqlx SQLite + FTS5, Tauri 2 commands, `dt` clap CLI), React 19 + TS + Tailwind v4 + base-ui/shadcn + cmdk + @dnd-kit/sortable + zustand, Turso HTTP (web), node:test, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-09-25-c4-labels-search-design.md` (§0 decisions are binding; read it before any task).

## Global Constraints

- **Lane B worktree:** `git -C /Users/marcosevilla/Developer/marco-task-app/nimble worktree add /Users/marcosevilla/Developer/marco-task-app/.nimble-wt/c4 -b c4/labels-search plan/2026-09-25`. Every command below runs in `/Users/marcosevilla/Developer/marco-task-app/.nimble-wt/c4` (the "worktree root") unless it says `cd apps/desktop`. The worktree has no `node_modules`: run `npm install --no-audit --no-fund` once at the worktree root before the first frontend step (a symlink to the main checkout's `node_modules` would resolve `@nimble/types` to main's copy and hide this lane's type changes).
- **Schema version is v24** (current is 23; brief phase 2 plans v25 and phase 3 v26 on top of this lane). Tag every v24 site with a `// schema-v24` comment — migration entry, `CURRENT_SCHEMA_VERSION`, the `version >= 24` export-policy and `fts_tables_for_version` branches, the `backup.rs` match, the recovery rebuild, `ensure_remote_v24_schema` and its three call sites, and each repinned test — so a renumber is one `grep -rn "schema-v24"`. If another lane merges a v24 first, renumber every tagged site (including the `turso_schema_v24_upgraded` key) to the next free number before merging.
- Spec §0 decisions, verbatim: groups are seeded by real use — EFFORT (`deep`, `quick`) · TYPE (`comms`, `admin`, `errands`, `photography`, `health`) · STATE (`waiting`, `avoidance`) · ASSIST (`needs-claude`); `from-instinct` and `nimble` in a **system** group; seeding is a post-install `dt` script, never a migration. **Per-group "Pick one"** (EFFORT pick-one, rest multi), enforced only on user edits. **⌘F search overlay**, separate from ⌘K; ⌘K `/search` hands its query to ⌘F; completed tasks always included, ranked below open ones. **System labels** hidden in pickers and row chips; still listed in the label filter under their group.
- Migrations: the runner splits on `;` — one statement per `;`, no triggers.
- `tasks_fts` is **device-local, never synced**, maintained in code (never triggers). Index writes are fire-and-forget like `log_activity`: an index failure is logged and never fails the user's mutation.
- Rust `set_task_labels` must **not** enforce "Pick one" (sync can deliver two; a sync never drops data). Exclusivity lives only in the UI toggle helper.
- The Todoist pull maps labels by name (`get_or_create_label_by_name`) and never touches `"group"` or `archived_at`.
- Web (`TursoProvider`) has no FTS: `tasks.search` is a `LIKE` fallback with the same signature and open-first order — documented as degraded. Label **writes** stay desktop-only on web (`ni()`), matching the existing `labels.create/update/delete` (see "Spec deviations" at the end).
- Commands: Rust `cargo test --workspace --offline` (worktree root). Frontend unit `cd apps/desktop && node --test tests/<file>.test.mjs`. Type check + build `cd apps/desktop && npm run build` (**never** `npx tsc --noEmit` — it checks nothing). Web `cd apps/desktop && npm run build:web`. Lint delta: record `cd apps/desktop && npx eslint src 2>&1 | tail -2` before Task 6 and after every frontend task — the problem count must not increase.
- node tests import TS directly (`import { x } from '../src/lib/x.ts'`). Any `src/lib/*.ts` a node test imports may only `import type` from `@nimble/types` and must import sibling values with an explicit `.ts` extension — no `@/` aliases.
- `services/data-provider.ts` is type-only at runtime; runtime provider access is `@/services/provider-context`.
- `tsconfig.app.json` has `noUnusedLocals`, `noUnusedParameters` and `verbatimModuleSyntax`: types are imported with `import type` / inline `type`, and any import a change leaves unused must be removed or `npm run build` fails.
- Every new Tauri command is mocked in `tools/mock-tauri.js` in the same task (unmocked commands only warn, so e2e would silently pass). Mock errors must be `return Promise.reject(new Error(...))` — a synchronous `throw` is swallowed into `null` by the dispatcher.
- Design system: tokens from `apps/desktop/src/themes.css` / `index.css` (`text-label`, `text-meta`, `text-body`, `text-body-strong`), typography primitives (`Caption`, `Meta`, `Label` from `components/shared/typography.tsx`), `components/ui/*` primitives, `surface-*` utilities, `cn()` for every conditional class, `EmptyState` for empties, `Skeleton` never spinners or "Loading…" text, no guilt copy, keyboard-first, focus returns to the trigger, `lib/shortcuts.ts` append-only (new sections go at the end).
- Commit in the lane worktree after each task, message `feat(c4): …`, ending with exactly:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb
  ```
- After install, `dt` must be rebuilt: `tools/dt/src/profile.rs` refuses any profile whose schema differs from `CURRENT_SCHEMA_VERSION`.

## Review Focus

1. **Hostile or odd search input** (`"`, `*`, `-`, `NEAR(`, `c++`, `follow-up`, emoji-only, `portfolio &`) → never an FTS syntax error; punctuation-only tokens are ignored so `portfolio &` still finds portfolio. Pinned in Task 4 (`fts_query_*`, `search_never_errors_on_hostile_input`).
2. **Typing an archived label's exact name in the picker** → the row offers `Restore "x"` (and applies it) instead of failing on the `labels.name` UNIQUE constraint. Pinned in Task 6 (`pickerCreateAction`) and Task 2 (`creating_an_archived_name_is_refused_so_the_ui_must_restore`).
3. **A task edited or deleted elsewhere** (Turso pull, Todoist pull, reconcile) → search reflects it immediately, no restart. Pinned in Task 3 (`incoming_turso_apply_updates_and_removes_index_rows`, `task_write_commit_mirrors_effects`).
4. **A label whose group id dangles** (group deleted on another device, or a group delete pending Undo) → reads as ungrouped everywhere; nothing is lost. Pinned in Task 6 (`dangling group id reads as ungrouped`) and Task 2 (`delete_group_ungroups_members_in_one_step`).
5. **Fast typing against slower responses** → an older query's results never replace a newer one's; clearing the input drops in-flight results. Pinned in Task 8 (`latest guard drops stale responses`).

---

## File Map

| File | Responsibility | Task |
|---|---|---|
| `nimble-core/src/db/migrations.rs` | v24 DDL | 1 |
| `nimble-core/src/types.rs` | `Label.archived_at`, `LabelGroup`, `LabelGroupPatch`, `TaskSearchFilters`, `TaskSearchHit` | 1, 2, 4 |
| `nimble-core/src/db/export_policy.rs`, `export.rs`, `backup.rs`, `recovery.rs` | v24 portable policy, FTS tables per version, rebuild index on restore | 1 |
| `nimble-core/src/db/sync.rs` | `label_groups` sync, v24 remote gate | 1 |
| `nimble-core/src/db/labels.rs` | groups, archive/restore, unused, reorder | 1, 2 |
| `nimble-core/src/db/origin_label.rs` | reuse `labels::LABEL_COLS` | 1 |
| `nimble-core/src/db/task_search.rs` (new) | index maintenance, rebuild, sanitizer, ranked search | 3, 4 |
| `nimble-core/src/db/task_tx.rs`, `db/focus/task_write.rs`, `db/tasks.rs`, `api/todoist_migration.rs` | index hooks | 3 |
| `apps/desktop/src-tauri/src/commands/labels.rs`, `commands/local_tasks.rs`, `lib.rs` | commands, startup heal | 2, 3, 4 |
| `tools/dt/src/args.rs`, `tools/dt/src/commands/mod.rs`, `tools/dt/tests/contracts.rs` | `dt label …`, `dt task search` | 5 |
| `tools/seed-label-groups.sh` (new) | one-time seed | 5 |
| `packages/types/src/index.ts`, `data-provider.ts` | shared types + contract | 1, 2, 4 |
| `apps/desktop/src/services/tauri.ts`, `tauri-provider.ts`, `turso-provider.ts`, `turso/labels.ts`, `turso/tasks.ts`, `turso/search.ts` (new) | providers | 1, 2, 4 |
| `tools/mock-tauri.js` | browser harness | 1, 2, 4 |
| `apps/desktop/src/lib/labelTaxonomy.ts` (new) | grouped ordering, exclusivity, create/restore action | 6 |
| `apps/desktop/src/hooks/useLabelTaxonomy.ts` (new) | one shared labels+groups cache | 6 |
| `apps/desktop/src/components/tasks/LabelPicker.tsx`, `MetadataChips.tsx`, `LocalTaskRow.tsx`, `TaskListHeader.tsx`, `pages/TasksPage.tsx`, `tasks/ProjectDetailPage.tsx` | grouped picker, chips, filter | 6 |
| `apps/desktop/src/lib/labelManagerModel.ts` (new), `components/settings/LabelManager.tsx` | Label Manager | 7 |
| `apps/desktop/src/lib/taskSearch.ts` (new), `lib/recentSearches.ts` (new), `stores/taskSearchStore.ts` (new), `components/search/TaskSearch.tsx` (new), `components/search/SearchFilterChips.tsx` (new), `lib/commandBarMode.ts`, `components/shared/CommandBar.tsx`, `components/layout/Dashboard.tsx`, `hooks/useTaskNavigation.ts` | ⌘F overlay | 4, 8 |
| `apps/desktop/src/lib/shortcuts.ts`, `tests/shortcuts.test.mjs` | registry rows | 6, 7, 8 |
| `apps/desktop/e2e/c4-labels.spec.ts`, `c4-search.spec.ts` (new) | browser QA + axe | 9 |

---

### Task 1: Schema v24 — tables, types, portable-export policy, Turso v24 gate

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append v24 to `MIGRATIONS`, `CURRENT_SCHEMA_VERSION` → 24, move the version assert out of `v23_tests`)
- Modify: `nimble-core/src/types.rs:121-130` (`Label`), add `LabelGroup` after it
- Modify: `nimble-core/src/db/labels.rs:10` (`LABEL_COLS`), `nimble-core/src/db/origin_label.rs:14`
- Modify: `nimble-core/src/db/export_policy.rs` (whole `tables_for_version` + `FTS_TABLES`), `nimble-core/src/db/export.rs` (lines 7, 60, 91, 217), `nimble-core/src/db/backup.rs:298`, `nimble-core/src/db/recovery.rs:311-312`
- Modify: `nimble-core/src/db/sync.rs` (new const + gate next to `ensure_remote_v23_schema`, calls at lines ~399, ~630, ~1291, `sanitize_table_name`, `seed_existing_data`)
- Modify tests: `nimble-core/tests/focus_backup.rs:31`, `nimble-core/tests/focus_schema.rs:72`, `nimble-core/tests/schema20_compatibility.rs:371`, `nimble-core/tests/schema22_origin_label.rs:30`, `nimble-core/tests/backup_export.rs:35,59` (+ one new test), `nimble-core/tests/backup_recovery.rs` (one new assertion)
- Modify: `packages/types/src/index.ts:177-186`, `apps/desktop/src/services/turso/labels.ts`, `tools/mock-tauri.js:108-114` and `create_label`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - SQL: `label_groups(id TEXT PK, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, exclusive INTEGER NOT NULL DEFAULT 0, system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`, `labels.archived_at TEXT`, `tasks_fts USING fts5(task_id UNINDEXED, content, description, tokenize='unicode61 remove_diacritics 2')`.
  - Rust: `types::Label { id, name, color, position: i64, group: Option<String>, created_at, archived_at: Option<String> }`; `types::LabelGroup { id: String, name: String, position: i64, exclusive: bool, system: bool, created_at: String, updated_at: String }`; `pub(crate) const db::labels::LABEL_COLS`; `pub(crate) fn db::export_policy::fts_tables_for_version(version: i64) -> Vec<(&'static str, &'static [&'static str])>`.
  - TS (`@nimble/types`): `Label.archived_at: string | null`; `interface LabelGroup { id: string; name: string; position: number; exclusive: boolean; system: boolean; created_at: string; updated_at: string }`.

- [ ] **Step 1: Write the failing migration test**

In `nimble-core/src/db/migrations.rs`, change `v23_tests` to drop its version pin (delete the line `assert_eq!(super::CURRENT_SCHEMA_VERSION, 23);`) and append:

```rust
#[cfg(test)]
mod v24_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v24_adds_label_groups_archive_and_the_task_index() {
        let pool = test_pool().await;
        let cols: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('label_groups') ORDER BY cid")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(cols, ["id", "name", "position", "exclusive", "system", "created_at", "updated_at"]);
        let label_cols: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('labels') ORDER BY cid")
            .fetch_all(&pool).await.unwrap();
        assert!(label_cols.iter().any(|c| c == "archived_at"), "{label_cols:?}");
        sqlx::query("INSERT INTO tasks_fts (task_id, content, description) VALUES ('t1', 'Résumé tweaks', '')")
            .execute(&pool).await.unwrap();
        let hit: Option<String> = sqlx::query_scalar("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH '\"resume\"*'")
            .fetch_optional(&pool).await.unwrap();
        assert_eq!(hit.as_deref(), Some("t1"), "remove_diacritics folds é");
        assert_eq!(super::CURRENT_SCHEMA_VERSION, 24);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --workspace --offline -p nimble-core v24_adds_label_groups`
Expected: FAIL — `no such table: label_groups` (panic in `fetch_all` unwrap or assertion on empty cols).

- [ ] **Step 3: Add the migration**

Append to `MIGRATIONS` (after version 23) and bump the constant:

```rust
    Migration {
        version: 24,
        description: "Label groups, label archive, device-local task search index",
        sql: "CREATE TABLE label_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                exclusive INTEGER NOT NULL DEFAULT 0,
                system INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            ALTER TABLE labels ADD COLUMN archived_at TEXT;
            CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id UNINDEXED, content, description, tokenize = 'unicode61 remove_diacritics 2')",
    },
];

pub const CURRENT_SCHEMA_VERSION: i64 = 24;
```

Also update the "Current version" line of the worktree-root `CLAUDE.md` Database Migrations bullet: append `; v24: label_groups, labels.archived_at (synced, gated by turso_schema_v24_upgraded) and device-local tasks_fts (FTS5, never synced)` and change **23** to **24**. Add to Key Tables: `` - `label_groups` — label taxonomy groups (name, position, exclusive = "Pick one", system = hidden integration group); synced `` and `` - `tasks_fts` — FTS5 index over task title+description. Device-local, never synced, written by `db::task_search`, self-heals on startup ``.

- [ ] **Step 4: Types and the shared column list**

`nimble-core/src/types.rs` — replace the `Label` struct and add `LabelGroup` right after it:

```rust
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    /// `label_groups.id`; a dangling id reads as ungrouped.
    #[serde(default)]
    pub group: Option<String>,
    pub created_at: String,
    /// Hidden from pickers and the filter when set; still renders on tasks.
    #[serde(default)]
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, sqlx::FromRow)]
pub struct LabelGroup {
    pub id: String,
    pub name: String,
    pub position: i64,
    /// "Pick one": the UI keeps at most one of this group's labels per task.
    pub exclusive: bool,
    /// Integration labels: hidden from pickers and row chips.
    pub system: bool,
    pub created_at: String,
    pub updated_at: String,
}
```

`nimble-core/src/db/labels.rs:10`:

```rust
pub(crate) const LABEL_COLS: &str = "id, name, color, position, created_at, \"group\", archived_at";
```

`nimble-core/src/db/origin_label.rs:14` — delete the local `const LABEL_COLS` line and add to the imports `use crate::db::labels::LABEL_COLS;`.

- [ ] **Step 5: Run the migration test and the label tests**

Run: `cargo test --workspace --offline -p nimble-core v24_adds_label_groups labels::`
Expected: PASS.

- [ ] **Step 6: Portable export policy for v24**

`nimble-core/src/db/export_policy.rs` — replace the `FTS_TABLES` const with:

```rust
/// Vault note index (v18+): schema-checked, never exported.
const VAULT_FTS_TABLES: &[(&str, &[&str])] = &[
    ("vault_fts", &["note_id", "title", "content"]),
    ("vault_fts_config", &["k", "v"]),
    ("vault_fts_content", &["id", "c0", "c1", "c2"]),
    ("vault_fts_data", &["id", "block"]),
    ("vault_fts_docsize", &["id", "sz"]),
    ("vault_fts_idx", &["segid", "term", "pgno"]),
];

/// Device-local task search index (v24+): schema-checked, never exported.
const TASKS_FTS_TABLES: &[(&str, &[&str])] = &[
    ("tasks_fts", &["task_id", "content", "description"]),
    ("tasks_fts_config", &["k", "v"]),
    ("tasks_fts_content", &["id", "c0", "c1", "c2"]),
    ("tasks_fts_data", &["id", "block"]),
    ("tasks_fts_docsize", &["id", "sz"]),
    ("tasks_fts_idx", &["segid", "term", "pgno"]),
];

/// FTS virtual + shadow tables a database at `version` must have.
pub(crate) fn fts_tables_for_version(version: i64) -> Vec<(&'static str, &'static [&'static str])> {
    let mut tables = VAULT_FTS_TABLES.to_vec();
    if version >= 24 {
        tables.extend_from_slice(TASKS_FTS_TABLES);
    }
    tables
}
```

In `tables_for_version`: replace `if version != 20 && version != 21 && version != 22 && version != 23 { return None; }` with `if !(20..=24).contains(&version) { return None; }`, add to the doc comment `/// V24 adds reviewed, included label_groups + labels.archived_at; tasks_fts is device-local and excluded.`, and insert before `tables.sort_by_key(...)`:

```rust
    if version >= 24 {
        for policy in &mut tables {
            if policy.name == "labels" {
                *policy = table!("labels"; ["id","name","color","position","created_at","group","archived_at"]; ["id","name","color","position","created_at","group","archived_at"]);
            }
        }
        tables.push(table!("label_groups"; ["id","name","position","exclusive","system","created_at","updated_at"]; ["id","name","position","exclusive","system","created_at","updated_at"]));
    }
```

`nimble-core/src/db/export.rs`: change the import on line 7 to `use super::export_policy::{fts_tables_for_version, tables_for_version, TablePolicy};`, then replace each of the three `FTS_TABLES` uses:
- line 60: `.chain(fts_tables_for_version(version).into_iter().map(|(name, _)| name.to_owned()))`
- line 91: `for (name, reviewed) in fts_tables_for_version(version) {` (body unchanged; `name`/`reviewed` are now owned refs, so the `columns(tx, name)` call and `reviewed.iter()` compile as-is)
- line 217: `for (name, columns) in fts_tables_for_version(version) {` and in its body `excluded.insert(name.to_owned(), names);`

`nimble-core/src/db/backup.rs:298`: `|| !matches!(manifest.schema_version, 19 | 20 | 21 | 22 | 23 | 24)`.

`nimble-core/src/db/recovery.rs` — right after the two `vault_fts` statements (lines 311-312) add:

```rust
        if version >= 24 {
            // Device-local task index: rebuilt from the restored rows, never exported.
            // Raw SQL (not task_search::rebuild_task_index) so the restored copy gains
            // no settings row; the app heals the version key on first launch.
            sqlx::query("DELETE FROM tasks_fts").execute(&pool).await?;
            sqlx::query("INSERT INTO tasks_fts(task_id,content,description) SELECT id,content,COALESCE(description,'') FROM local_tasks").execute(&pool).await?;
        }
```

- [ ] **Step 7: Repin the version tests and add the v24 export/recovery tests**

Repin `23` → `24` in: `nimble-core/tests/focus_backup.rs:31`, `nimble-core/tests/focus_schema.rs:72`, `nimble-core/tests/schema20_compatibility.rs:371`, `nimble-core/tests/schema22_origin_label.rs:30`, `nimble-core/tests/backup_export.rs:35`. In `backup_export.rs:59` change the "future" probe `VALUES (24,'future',…)` → `VALUES (25,'future',…)`.

Append to `nimble-core/tests/backup_export.rs`:

```rust
#[tokio::test]
async fn v24_exports_label_groups_and_archive_state_but_not_the_task_index() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("INSERT INTO label_groups (id,name,position,exclusive,system,created_at,updated_at) VALUES ('g1','EFFORT',0,1,0,'2026-09-25 09:00:00','2026-09-25 09:00:00')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO labels (id,name,color,position,\"group\",archived_at) VALUES ('l1','deep','gray',0,'g1',NULL),('l2','old','gray',1,NULL,'2026-09-25 09:00:00')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO tasks_fts (task_id, content, description) VALUES ('t1','x','')")
        .execute(&pool).await.unwrap();
    let export = export_portable(&pool).await.unwrap();
    let data: serde_json::Value = serde_json::from_slice(&export.data).unwrap();
    assert_eq!(data["label_groups"][0]["exclusive"].as_i64(), Some(1));
    let old = data["labels"].as_array().unwrap().iter().find(|l| l["id"] == "l2").unwrap();
    assert_eq!(old["archived_at"], "2026-09-25 09:00:00");
    assert!(data.get("tasks_fts").is_none(), "the search index is device-local");
    let format: serde_json::Value = serde_json::from_slice(&export.format).unwrap();
    assert!(format["excluded"].get("tasks_fts").is_some());
    close(pool, path).await;
}
```

In `nimble-core/tests/backup_recovery.rs`, inside `both_routes_round_trip_without_changing_source`, in the `if route == "export"` block after the `vault_fts` count assertion, add:

```rust
            let (indexed, tasks): (i64, i64) = sqlx::query_as(
                "SELECT (SELECT COUNT(*) FROM tasks_fts), (SELECT COUNT(*) FROM local_tasks)",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(indexed, tasks, "restore rebuilds the device-local task index");
```

- [ ] **Step 8: Run the backup/recovery suites**

Run: `cargo test --workspace --offline -p nimble-core --test backup_export --test backup_recovery --test backup_snapshot --test focus_backup --test focus_schema --test schema20_compatibility --test schema22_origin_label`
Expected: PASS (a `table_drift` / `fts_drift` failure means a name or column list in Step 6 is off — compare against `SELECT name FROM sqlite_master`).

- [ ] **Step 9: Sync plumbing + Turso v24 gate (tests first)**

Append to the `#[cfg(test)]` module in `nimble-core/src/db/sync.rs` that contains `fn briefs_sync_by_date`:

```rust
    #[test]
    fn label_groups_sync_but_the_task_index_never_does() {
        assert!(super::sanitize_table_name("label_groups").is_ok());
        assert!(super::sanitize_table_name("tasks_fts").is_err(), "device-local only");
    }

    #[tokio::test]
    async fn remote_label_groups_ddl_matches_the_local_v24_table() {
        let local = crate::test_util::test_pool().await;
        let remote = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(super::REMOTE_LABEL_GROUPS_DDL).execute(&remote).await.unwrap();
        let sql = "SELECT name FROM pragma_table_info('label_groups') ORDER BY cid";
        let a: Vec<String> = sqlx::query_scalar(sql).fetch_all(&local).await.unwrap();
        let b: Vec<String> = sqlx::query_scalar(sql).fetch_all(&remote).await.unwrap();
        assert_eq!(a, b);
    }

    #[tokio::test]
    async fn a_pulled_label_group_and_archive_state_land() {
        let pool = crate::test_util::test_pool().await;
        let group = serde_json::json!({"id":"g1","name":"EFFORT","position":0,"exclusive":true,"system":false,
            "created_at":"2026-09-25 09:00:00","updated_at":"2026-09-25 09:00:00"}).to_string();
        super::apply_remote_change(&pool, "label_groups", "g1", "INSERT", Some(&group)).await.unwrap();
        let label = serde_json::json!({"id":"l1","name":"deep","color":"gray","position":0,
            "created_at":"2026-09-25 09:00:00","group":"g1","archived_at":"2026-09-25 10:00:00"}).to_string();
        super::apply_remote_change(&pool, "labels", "l1", "INSERT", Some(&label)).await.unwrap();
        let row: (i64, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT g.exclusive, l.\"group\", l.archived_at FROM labels l JOIN label_groups g ON g.id = l.\"group\" WHERE l.id = 'l1'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(row, (1, Some("g1".into()), Some("2026-09-25 10:00:00".into())));
    }

    #[tokio::test]
    async fn seed_existing_data_covers_label_groups() {
        let pool = crate::test_util::test_pool().await;
        sqlx::query("INSERT INTO label_groups (id,name,position,exclusive,system,created_at,updated_at) VALUES ('g1','EFFORT',0,1,0,'x','x')")
            .execute(&pool).await.unwrap();
        super::seed_existing_data(&pool).await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name = 'label_groups' AND row_id = 'g1'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(n, 1);
    }
```

Run: `cargo test --workspace --offline -p nimble-core label_groups_sync remote_label_groups_ddl a_pulled_label_group seed_existing_data_covers_label_groups`
Expected: FAIL — `REMOTE_LABEL_GROUPS_DDL` not found (compile error).

- [ ] **Step 10: Implement the sync plumbing**

In `nimble-core/src/db/sync.rs`, after `REMOTE_BRIEFS_DDL`:

```rust
/// Remote DDL for the v24 `label_groups` table. Mirrors `migrations.rs` v24
/// exactly; single definition shared by `ensure_remote_v24_schema`.
const REMOTE_LABEL_GROUPS_DDL: &str = "CREATE TABLE IF NOT EXISTS label_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    exclusive INTEGER NOT NULL DEFAULT 0,
    system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)";
```

After `ensure_remote_v23_schema`:

```rust
async fn ensure_remote_v24_schema(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let done: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='turso_schema_v24_upgraded'")
        .fetch_optional(pool).await?;
    if done.is_some() { return Ok(()); }
    let requests = [
        turso_execute("ALTER TABLE labels ADD COLUMN archived_at TEXT", vec![]),
        turso_execute(REMOTE_LABEL_GROUPS_DDL, vec![]),
        serde_json::json!({"type":"close"}),
    ];
    let body = turso_pipeline(turso_url, turso_token, requests.to_vec()).await?;
    // "duplicate column name" = the ALTER landed on an earlier run; anything else must not latch the gate.
    check_pipeline_statement_errors(&body, "Turso v24 schema upgrade", true)?;
    sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('turso_schema_v24_upgraded','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')")
        .execute(pool).await?;
    Ok(())
}
```

Wire it in three places, each right after the matching `ensure_remote_v23_schema` call:
- `initialize_remote` latched branch: `ensure_remote_v24_schema(pool, turso_url, turso_token).await?;`
- `initialize_remote` fresh path (after `ensure_remote_v23_schema(...).await?;`): `ensure_remote_v24_schema(pool, turso_url, turso_token).await?;`
- `push`: 
  ```rust
      if let Err(e) = ensure_remote_v24_schema(pool, turso_url, turso_token).await {
          log::warn!("Turso v24 schema gate failed, pushing anyway (gate retries next push): {e}");
      }
  ```

Add `"label_groups",` to the `ALLOWED` list in `sanitize_table_name` (after `"briefs",`) and to `tables_with_id` in `seed_existing_data` (after `"labels", "sections",`). Update the CLAUDE.md Sync Protocol bullet "Vault tables replicate … stay device/Mac-local" to read "`vault_fts`, `tasks_fts`, `todoist_outbox`, and `integration_sync_state` stay device/Mac-local".

Run: `cargo test --workspace --offline -p nimble-core sync::`
Expected: PASS.

- [ ] **Step 11: TypeScript `Label.archived_at` + `LabelGroup`, web decode, mock fixture**

`packages/types/src/index.ts` — replace the `Label` interface and add `LabelGroup`:

```ts
export interface Label {
  /** `label_groups.id`; a dangling id reads as ungrouped. */
  group: string | null
  /** Set = archived: hidden from pickers and the filter, still shown on tasks. */
  archived_at: string | null
  id: string
  name: string
  color: string
  position: number
  created_at: string
}

export interface LabelGroup {
  id: string
  name: string
  position: number
  /** "Pick one": the UI keeps at most one of this group's labels per task. */
  exclusive: boolean
  /** Integration labels: hidden from pickers and row chips. */
  system: boolean
  created_at: string
  updated_at: string
}
```

`apps/desktop/src/services/turso/labels.ts` — the remote gains `archived_at` only after a v24 desktop push runs its gate, so read it tolerantly:

```ts
const LABEL_COLS = 'id, name, color, position, created_at, "group", archived_at'
/** Pre-v24 remotes (gate not yet run by a desktop push) lack `archived_at`. */
const LABEL_COLS_V23 = 'id, name, color, position, created_at, "group"'

function toLabel(row: Row): Label {
  return {
    group: strOrNull(row, 'group'),
    archived_at: 'archived_at' in row ? strOrNull(row, 'archived_at') : null,
    id: str(row, 'id'),
    name: str(row, 'name'),
    color: str(row, 'color'),
    position: num(row, 'position'),
    created_at: str(row, 'created_at'),
  }
}

export async function listLabels(): Promise<Label[]> {
  try {
    const rows = await query(`SELECT ${LABEL_COLS} FROM labels ORDER BY position, created_at`)
    return rows.map(toLabel)
  } catch (e) {
    if (!(e instanceof TursoError) || !/no such column/i.test(e.message)) throw e
    const rows = await query(`SELECT ${LABEL_COLS_V23} FROM labels ORDER BY position, created_at`)
    return rows.map(toLabel)
  }
}
```

(import `TursoError` from `./client` next to `query, str, strOrNull, num, type Row`; keep the existing doc comments above each function.)

`tools/mock-tauri.js` — add `group: null, archived_at: null,` to each of the five `LABELS` fixtures and to the object built in `create_label`, and add an empty groups fixture right after `LABELS`:

```js
  // ── Label groups (C4): empty by default; e2e specs seed their own via invoke ──
  var LABEL_GROUPS = []
```

- [ ] **Step 12: Full verification**

Run: `cargo test --workspace --offline`
Expected: PASS (all suites).
Run: `npm install --no-audit --no-fund` (worktree root, first time only), then `cd apps/desktop && npm run build && npm run build:web`
Expected: both builds succeed.

- [ ] **Step 13: Commit**

```bash
git add nimble-core packages/types apps/desktop/src/services/turso/labels.ts tools/mock-tauri.js CLAUDE.md
git commit -m "feat(c4): schema v24 — label groups, label archive, device-local tasks_fts

Adds label_groups + labels.archived_at (synced, Turso gate v24) and the
device-local tasks_fts FTS5 table; v24 portable-export policy (task index
excluded, rebuilt on restore); repins schema-version tests.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 2: Label groups, archive and unused — Rust API, Tauri commands, DataProvider (Tauri + Turso), mock

**Files:**
- Modify: `nimble-core/src/types.rs` (add `LabelGroupPatch` after `LabelGroup`)
- Modify: `nimble-core/src/db/labels.rs` (new fns + tests; `set_label_group` gains validation)
- Modify: `apps/desktop/src-tauri/src/commands/labels.rs`, `apps/desktop/src-tauri/src/lib.rs:571-575` (register)
- Modify: `packages/types/src/index.ts` (`LabelGroupPatch`), `packages/types/src/data-provider.ts:150-157` (labels domain)
- Modify: `apps/desktop/src/services/tauri.ts` (Labels section), `apps/desktop/src/services/tauri-provider.ts:81-87`, `apps/desktop/src/services/turso-provider.ts:157-164`, `apps/desktop/src/services/turso/labels.ts`
- Modify: `tools/mock-tauri.js` (label section, after `set_task_labels`)

**Interfaces:**
- Consumes (Task 1): `types::{Label, LabelGroup}`, `labels::LABEL_COLS`, `label_groups` table.
- Produces:
  - Rust `nimble_core::types::LabelGroupPatch { name: Option<String>, exclusive: Option<bool>, system: Option<bool>, position: Option<i64> }` (Default, Serialize, Deserialize).
  - Rust `nimble_core::db::labels::`
    - `get_label(pool, id: &str) -> Result<Label>`
    - `list_label_groups(pool) -> Result<Vec<LabelGroup>>` (ORDER BY position, created_at)
    - `create_label_group(pool, name: &str, exclusive: bool) -> Result<LabelGroup>` (trims; rejects empty and case-insensitive duplicate names)
    - `update_label_group(pool, id: &str, patch: LabelGroupPatch) -> Result<LabelGroup>`
    - `delete_label_group(pool, id: &str) -> Result<Vec<String>>` (returns the ungrouped label ids; one transaction)
    - `reorder_label_groups(pool, ids: &[String]) -> Result<()>` (position = index)
    - `set_label_group(pool, id: &str, group: Option<&str>) -> Result<Label>` (existing; now errors on unknown label/group)
    - `reorder_labels(pool, ids: &[String]) -> Result<()>` (position = index)
    - `archive_labels(pool, ids: &[String]) -> Result<Vec<Label>>` (returns only labels this call archived)
    - `restore_labels(pool, ids: &[String]) -> Result<Vec<Label>>` (returns only labels this call restored)
    - `unused_label_ids(pool) -> Result<Vec<String>>` (not archived, not in a system group, no open task)
  - Tauri commands (invoke args): `list_label_groups()`, `create_label_group({ name, exclusive })`, `update_label_group({ id, patch })`, `delete_label_group({ id })`, `reorder_label_groups({ ids })`, `set_label_group({ labelId, groupId })`, `reorder_labels({ ids })`, `archive_labels({ ids })`, `restore_labels({ ids })`, `unused_label_ids()`.
  - TS `LabelGroupPatch { name?: string; exclusive?: boolean; system?: boolean; position?: number }`; `DataProvider.labels` gains `reorder(ids: string[]): Promise<void>`, `setGroup(labelId: string, groupId: string | null): Promise<Label>`, `archive(ids: string[]): Promise<Label[]>`, `restore(ids: string[]): Promise<Label[]>`, `unusedIds(): Promise<string[]>`, `groups: { list(): Promise<LabelGroup[]>; create(name: string, exclusive: boolean): Promise<LabelGroup>; update(id: string, patch: LabelGroupPatch): Promise<LabelGroup>; delete(id: string): Promise<string[]>; reorder(ids: string[]): Promise<void> }`.
  - `tauri.ts`: `listLabelGroups`, `createLabelGroup`, `updateLabelGroup`, `deleteLabelGroup`, `reorderLabelGroups`, `setLabelGroup`, `reorderLabels`, `archiveLabels`, `restoreLabels`, `unusedLabelIds`.

- [ ] **Step 1: Write the failing Rust tests**

Append inside `mod tests` in `nimble-core/src/db/labels.rs`:

```rust
    use crate::types::{LabelGroupPatch, UpdateTaskInput};

    #[tokio::test]
    async fn group_crud_orders_and_rejects_duplicate_names() {
        let pool = test_pool().await;
        let effort = create_label_group(&pool, "  EFFORT ", true).await.unwrap();
        assert_eq!((effort.name.as_str(), effort.exclusive, effort.system, effort.position), ("EFFORT", true, false, 0));
        let ty = create_label_group(&pool, "TYPE", false).await.unwrap();
        assert!(create_label_group(&pool, "effort", false).await.is_err(), "case-insensitive duplicate");
        assert!(create_label_group(&pool, "   ", false).await.is_err(), "empty name");

        let ty = update_label_group(&pool, &ty.id, LabelGroupPatch { name: Some("Kind".into()), system: Some(true), ..Default::default() })
            .await.unwrap();
        assert_eq!((ty.name.as_str(), ty.system), ("Kind", true));
        assert!(update_label_group(&pool, &ty.id, LabelGroupPatch { name: Some("EFFORT".into()), ..Default::default() }).await.is_err());

        reorder_label_groups(&pool, &[ty.id.clone(), effort.id.clone()]).await.unwrap();
        let names: Vec<String> = list_label_groups(&pool).await.unwrap().into_iter().map(|g| g.name).collect();
        assert_eq!(names, ["Kind", "EFFORT"]);
        assert!(reorder_label_groups(&pool, &["nope".to_string()]).await.is_err());

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name = 'label_groups'")
            .fetch_one(&pool).await.unwrap();
        assert!(n >= 5, "create×2, update, reorder×2 all replicate (got {n})");
    }

    #[tokio::test]
    async fn delete_group_ungroups_members_in_one_step() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        let quick = create_label(&pool, "quick", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        set_label_group(&pool, &quick.id, Some(&g.id)).await.unwrap();
        assert!(set_label_group(&pool, &deep.id, Some("missing-group")).await.is_err());
        assert!(set_label_group(&pool, "missing-label", Some(&g.id)).await.is_err());

        let mut ungrouped = delete_label_group(&pool, &g.id).await.unwrap();
        ungrouped.sort();
        let mut expected = vec![deep.id.clone(), quick.id.clone()];
        expected.sort();
        assert_eq!(ungrouped, expected);
        assert!(list_label_groups(&pool).await.unwrap().is_empty());
        assert!(list_labels(&pool).await.unwrap().iter().all(|l| l.group.is_none()));
        let deletes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name='label_groups' AND operation='DELETE'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(deletes, 1);
    }

    #[tokio::test]
    async fn archive_restore_and_unused() {
        let pool = test_pool().await;
        let used = create_label(&pool, "deep", "gray").await.unwrap();
        let idle = create_label(&pool, "old", "gray").await.unwrap();
        let done_only = create_label(&pool, "shipped", "gray").await.unwrap();
        let sys = create_label(&pool, "from-instinct", "gray").await.unwrap();
        let system = create_label_group(&pool, "SYSTEM", false).await.unwrap();
        update_label_group(&pool, &system.id, LabelGroupPatch { system: Some(true), ..Default::default() }).await.unwrap();
        set_label_group(&pool, &sys.id, Some(&system.id)).await.unwrap();

        let open = create_local_task(&pool, CreateTaskInput { content: "open".into(), ..Default::default() }).await.unwrap();
        set_task_labels(&pool, &open.id, &[used.id.clone()]).await.unwrap();
        let done = create_local_task(&pool, CreateTaskInput { content: "done".into(), ..Default::default() }).await.unwrap();
        set_task_labels(&pool, &done.id, &[done_only.id.clone()]).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &done.id, "complete", None).await.unwrap();

        let mut unused = unused_label_ids(&pool).await.unwrap();
        unused.sort();
        let mut expected = vec![idle.id.clone(), done_only.id.clone()];
        expected.sort();
        assert_eq!(unused, expected, "system labels and labels on open tasks are never 'unused'");

        let first = archive_labels(&pool, &[idle.id.clone()]).await.unwrap();
        assert_eq!(first.len(), 1);
        // Undo of a later "archive unused" must restore only what THAT call archived.
        let second = archive_labels(&pool, &[idle.id.clone(), done_only.id.clone()]).await.unwrap();
        assert_eq!(second.iter().map(|l| l.id.clone()).collect::<Vec<_>>(), vec![done_only.id.clone()]);
        assert!(second[0].archived_at.is_some());
        assert!(unused_label_ids(&pool).await.unwrap().is_empty(), "archived labels are not listed as unused");
        assert!(archive_labels(&pool, &["ghost".to_string()]).await.is_err());

        // Archived labels still render on the tasks that have them.
        assert_eq!(labels_for_task(&pool, &done.id).await.unwrap(), vec![done_only.id.clone()]);

        let restored = restore_labels(&pool, &[done_only.id.clone(), used.id.clone()]).await.unwrap();
        assert_eq!(restored.iter().map(|l| l.id.clone()).collect::<Vec<_>>(), vec![done_only.id.clone()]);
        assert!(get_label(&pool, &done_only.id).await.unwrap().archived_at.is_none());
    }

    #[tokio::test]
    async fn todoist_name_match_never_unarchives_or_regroups() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        archive_labels(&pool, &[deep.id.clone()]).await.unwrap();
        let pulled = get_or_create_label_by_name(&pool, "Deep").await.unwrap();
        assert_eq!(pulled.id, deep.id);
        assert!(pulled.archived_at.is_some());
        assert_eq!(pulled.group.as_deref(), Some(g.id.as_str()));
        let fresh = get_or_create_label_by_name(&pool, "brand-new").await.unwrap();
        assert!(fresh.group.is_none() && fresh.archived_at.is_none());
    }

    #[tokio::test]
    async fn creating_an_archived_name_is_refused_so_the_ui_must_restore() {
        let pool = test_pool().await;
        let old = create_label(&pool, "old", "gray").await.unwrap();
        archive_labels(&pool, &[old.id.clone()]).await.unwrap();
        assert!(create_label(&pool, "old", "gray").await.is_err(), "labels.name is UNIQUE");
    }

    #[tokio::test]
    async fn set_task_labels_never_enforces_pick_one() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        let quick = create_label(&pool, "quick", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        set_label_group(&pool, &quick.id, Some(&g.id)).await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() }).await.unwrap();
        let t = set_task_labels(&pool, &t.id, &[deep.id.clone(), quick.id.clone()]).await.unwrap();
        assert_eq!(t.labels.len(), 2, "sync may deliver two; Rust keeps both");
        let t = crate::db::tasks::update_local_task(&pool, &t.id, UpdateTaskInput { label_ids: Some(vec![deep.id.clone(), quick.id.clone()]), ..Default::default() }).await.unwrap();
        assert_eq!(t.labels.len(), 2);
    }

    #[tokio::test]
    async fn reorder_labels_sets_positions() {
        let pool = test_pool().await;
        let a = create_label(&pool, "a", "gray").await.unwrap();
        let b = create_label(&pool, "b", "gray").await.unwrap();
        reorder_labels(&pool, &[b.id.clone(), a.id.clone()]).await.unwrap();
        let names: Vec<String> = list_labels(&pool).await.unwrap().into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["b", "a"]);
        assert!(reorder_labels(&pool, &["ghost".to_string()]).await.is_err());
    }
```

(`UpdateTaskInput` derives `Default`, so `..Default::default()` works.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --workspace --offline -p nimble-core labels::`
Expected: FAIL — compile errors (`create_label_group`, `LabelGroupPatch` not found).

- [ ] **Step 3: Add `LabelGroupPatch`**

`nimble-core/src/types.rs`, after `LabelGroup`:

```rust
/// Partial update for a label group; `None` leaves a field as it is.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct LabelGroupPatch {
    pub name: Option<String>,
    pub exclusive: Option<bool>,
    pub system: Option<bool>,
    pub position: Option<i64>,
}
```

- [ ] **Step 4: Implement the label-group API**

In `nimble-core/src/db/labels.rs` change the imports to `use crate::types::{Label, LabelGroup, LabelGroupPatch, LocalTask};`, replace the existing `set_label_group` with the version below, and add the rest after `LABEL_COLS`:

```rust
const GROUP_COLS: &str = "id, name, position, exclusive, system, created_at, updated_at";

fn not_found(kind: &str, id: &str) -> crate::Error {
    crate::Error::Other(format!("no such {kind} '{id}'"))
}

pub async fn get_label(pool: &SqlitePool, id: &str) -> crate::Result<Label> {
    sqlx::query_as::<_, Label>(&format!("SELECT {LABEL_COLS} FROM labels WHERE id = ?"))
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| not_found("label", id))
}

async fn get_group(pool: &SqlitePool, id: &str) -> crate::Result<LabelGroup> {
    sqlx::query_as::<_, LabelGroup>(&format!("SELECT {GROUP_COLS} FROM label_groups WHERE id = ?"))
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| not_found("label group", id))
}

/// Best-effort like every other sync_log append: the row is already written.
async fn log_group(pool: &SqlitePool, group: &LabelGroup, operation: &str, changed: Option<&[&str]>) {
    let snapshot = serde_json::to_string(group).unwrap_or_default();
    let changed = changed.map(|c| serde_json::json!(c).to_string());
    if let Err(e) = sync::append_sync_log(pool, "label_groups", &group.id, operation, changed.as_deref(), Some(&snapshot)).await {
        log::warn!("label_groups sync_log append failed for {}: {e}", group.id);
    }
}

async fn log_label(pool: &SqlitePool, label: &Label, changed: &[&str]) {
    let snapshot = serde_json::to_string(label).unwrap_or_default();
    let changed = serde_json::json!(changed).to_string();
    if let Err(e) = sync::append_sync_log(pool, "labels", &label.id, "UPDATE", Some(&changed), Some(&snapshot)).await {
        log::warn!("labels sync_log append failed for {}: {e}", label.id);
    }
}

fn clean_group_name(name: &str) -> crate::Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(crate::Error::Other("label group name must not be empty".into()));
    }
    Ok(trimmed.to_string())
}

async fn group_name_taken(pool: &SqlitePool, name: &str, except: Option<&str>) -> crate::Result<bool> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM label_groups WHERE name = ? COLLATE NOCASE AND id != COALESCE(?, '')")
        .bind(name).bind(except).fetch_one(pool).await?;
    Ok(n > 0)
}

pub async fn list_label_groups(pool: &SqlitePool) -> crate::Result<Vec<LabelGroup>> {
    Ok(sqlx::query_as::<_, LabelGroup>(&format!("SELECT {GROUP_COLS} FROM label_groups ORDER BY position, created_at"))
        .fetch_all(pool).await?)
}

pub async fn create_label_group(pool: &SqlitePool, name: &str, exclusive: bool) -> crate::Result<LabelGroup> {
    let name = clean_group_name(name)?;
    if group_name_taken(pool, &name, None).await? {
        return Err(crate::Error::Other(format!("a label group named '{name}' already exists")));
    }
    let id = Uuid::new_v4().to_string();
    let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM label_groups")
        .fetch_one(pool).await?;
    sqlx::query("INSERT INTO label_groups (id, name, position, exclusive, system, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, datetime('now','localtime'), datetime('now','localtime'))")
        .bind(&id).bind(&name).bind(position).bind(exclusive).execute(pool).await?;
    let group = get_group(pool, &id).await?;
    log_group(pool, &group, "INSERT", None).await;
    Ok(group)
}

pub async fn update_label_group(pool: &SqlitePool, id: &str, patch: LabelGroupPatch) -> crate::Result<LabelGroup> {
    let current = get_group(pool, id).await?;
    let mut changed: Vec<&str> = Vec::new();
    let name = match patch.name {
        Some(raw) => {
            let name = clean_group_name(&raw)?;
            if name != current.name {
                if group_name_taken(pool, &name, Some(id)).await? {
                    return Err(crate::Error::Other(format!("a label group named '{name}' already exists")));
                }
                changed.push("name");
            }
            name
        }
        None => current.name.clone(),
    };
    let exclusive = patch.exclusive.unwrap_or(current.exclusive);
    if exclusive != current.exclusive { changed.push("exclusive"); }
    let system = patch.system.unwrap_or(current.system);
    if system != current.system { changed.push("system"); }
    let position = patch.position.unwrap_or(current.position);
    if position != current.position { changed.push("position"); }
    if changed.is_empty() {
        return Ok(current);
    }
    sqlx::query("UPDATE label_groups SET name = ?, exclusive = ?, system = ?, position = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .bind(&name).bind(exclusive).bind(system).bind(position).bind(id).execute(pool).await?;
    changed.push("updated_at");
    let group = get_group(pool, id).await?;
    log_group(pool, &group, "UPDATE", Some(changed.as_slice())).await;
    Ok(group)
}

/// Deletes the group and ungroups its labels in one transaction. Returns the
/// ungrouped label ids (their `labels` UPDATEs replicate after commit).
pub async fn delete_label_group(pool: &SqlitePool, id: &str) -> crate::Result<Vec<String>> {
    get_group(pool, id).await?;
    let mut tx = pool.begin().await?;
    let members: Vec<String> = sqlx::query_scalar("SELECT id FROM labels WHERE \"group\" = ? ORDER BY position, created_at")
        .bind(id).fetch_all(&mut *tx).await?;
    sqlx::query("UPDATE labels SET \"group\" = NULL WHERE \"group\" = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM label_groups WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    for member in &members {
        if let Ok(label) = get_label(pool, member).await {
            log_label(pool, &label, &["group"]).await;
        }
    }
    if let Err(e) = sync::append_sync_log(pool, "label_groups", id, "DELETE", None, None).await {
        log::warn!("label_groups sync_log DELETE failed for {id}: {e}");
    }
    Ok(members)
}

pub async fn reorder_label_groups(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    let mut tx = pool.begin().await?;
    for (index, id) in ids.iter().enumerate() {
        let done = sqlx::query("UPDATE label_groups SET position = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(index as i64).bind(id).execute(&mut *tx).await?;
        if done.rows_affected() == 0 {
            return Err(not_found("label group", id));
        }
    }
    tx.commit().await?;
    for id in ids {
        if let Ok(group) = get_group(pool, id).await {
            log_group(pool, &group, "UPDATE", Some(&["position", "updated_at"][..])).await;
        }
    }
    Ok(())
}

/// Move a label into a group (or out of every group with `None`).
pub async fn set_label_group(pool: &SqlitePool, id: &str, group: Option<&str>) -> crate::Result<Label> {
    get_label(pool, id).await?;
    if let Some(group_id) = group {
        get_group(pool, group_id).await?;
    }
    sqlx::query("UPDATE labels SET \"group\" = ? WHERE id = ?").bind(group).bind(id).execute(pool).await?;
    let label = get_label(pool, id).await?;
    log_label(pool, &label, &["group"]).await;
    Ok(label)
}

pub async fn reorder_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    let mut tx = pool.begin().await?;
    for (index, id) in ids.iter().enumerate() {
        let done = sqlx::query("UPDATE labels SET position = ? WHERE id = ?")
            .bind(index as i64).bind(id).execute(&mut *tx).await?;
        if done.rows_affected() == 0 {
            return Err(not_found("label", id));
        }
    }
    tx.commit().await?;
    for id in ids {
        if let Ok(label) = get_label(pool, id).await {
            log_label(pool, &label, &["position"]).await;
        }
    }
    Ok(())
}

/// `archived = true` archives, `false` restores. Validates every id first;
/// returns only the labels whose state this call changed, so an Undo can
/// reverse exactly this call.
async fn set_archived(pool: &SqlitePool, ids: &[String], archived: bool) -> crate::Result<Vec<Label>> {
    for id in ids {
        get_label(pool, id).await?;
    }
    let sql = if archived {
        "UPDATE labels SET archived_at = datetime('now','localtime') WHERE id = ? AND archived_at IS NULL"
    } else {
        "UPDATE labels SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL"
    };
    let mut tx = pool.begin().await?;
    let mut changed_ids = Vec::new();
    for id in ids {
        if sqlx::query(sql).bind(id).execute(&mut *tx).await?.rows_affected() == 1 {
            changed_ids.push(id.clone());
        }
    }
    tx.commit().await?;
    let mut changed = Vec::with_capacity(changed_ids.len());
    for id in &changed_ids {
        let label = get_label(pool, id).await?;
        log_label(pool, &label, &["archived_at"]).await;
        changed.push(label);
    }
    Ok(changed)
}

pub async fn archive_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<Vec<Label>> {
    set_archived(pool, ids, true).await
}

pub async fn restore_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<Vec<Label>> {
    set_archived(pool, ids, false).await
}

/// Visible labels with no open task: not archived, not in a system group,
/// and on no task whose status is not `complete`.
pub async fn unused_label_ids(pool: &SqlitePool) -> crate::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT l.id FROM labels l
         LEFT JOIN label_groups g ON g.id = l.\"group\"
         WHERE l.archived_at IS NULL
           AND COALESCE(g.system, 0) = 0
           AND NOT EXISTS (
             SELECT 1 FROM task_labels tl JOIN local_tasks t ON t.id = tl.task_id
             WHERE tl.label_id = l.id AND t.status != 'complete')
         ORDER BY l.position, l.created_at",
    )
    .fetch_all(pool)
    .await?)
}
```

- [ ] **Step 5: Run the Rust tests**

Run: `cargo test --workspace --offline -p nimble-core labels::`
Expected: PASS (7 new tests + the existing 5).

- [ ] **Step 6: Tauri commands**

Append to `apps/desktop/src-tauri/src/commands/labels.rs` (and change its type import to `pub use nimble_core::types::{Label, LabelGroup, LabelGroupPatch, LocalTask};`):

```rust
#[tauri::command]
pub async fn list_label_groups(app: AppHandle) -> Result<Vec<LabelGroup>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::list_label_groups(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_label_group(app: AppHandle, name: String, exclusive: bool) -> Result<LabelGroup, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::create_label_group(pool.inner(), &name, exclusive)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |g| vec![g.id.clone()])
}

#[tauri::command]
pub async fn update_label_group(app: AppHandle, id: String, patch: LabelGroupPatch) -> Result<LabelGroup, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::update_label_group(pool.inner(), &id, patch)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |g| vec![g.id.clone()])
}

#[tauri::command]
pub async fn delete_label_group(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::delete_label_group(pool.inner(), &id)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ids| ids.clone())
}

#[tauri::command]
pub async fn reorder_label_groups(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::reorder_label_groups(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |_| ids.clone())
}

#[tauri::command]
pub async fn set_label_group(app: AppHandle, label_id: String, group_id: Option<String>) -> Result<Label, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::set_label_group(pool.inner(), &label_id, group_id.as_deref())
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |l| vec![l.id.clone()])
}

#[tauri::command]
pub async fn reorder_labels(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::reorder_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |_| ids.clone())
}

#[tauri::command]
pub async fn archive_labels(app: AppHandle, ids: Vec<String>) -> Result<Vec<Label>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::archive_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ls| ls.iter().map(|l| l.id.clone()).collect())
}

#[tauri::command]
pub async fn restore_labels(app: AppHandle, ids: Vec<String>) -> Result<Vec<Label>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::restore_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ls| ls.iter().map(|l| l.id.clone()).collect())
}

#[tauri::command]
pub async fn unused_label_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::unused_label_ids(pool.inner()).await.map_err(|e| e.to_string())
}
```

Register in `apps/desktop/src-tauri/src/lib.rs` right after `labels::set_task_labels,`:

```rust
            labels::list_label_groups,
            labels::create_label_group,
            labels::update_label_group,
            labels::delete_label_group,
            labels::reorder_label_groups,
            labels::set_label_group,
            labels::reorder_labels,
            labels::archive_labels,
            labels::restore_labels,
            labels::unused_label_ids,
```

Run: `cargo test --workspace --offline -p app --no-run 2>&1 | tail -3` (the Tauri crate's package name is `app`).
Expected: compiles.

- [ ] **Step 7: Shared TS contract**

`packages/types/src/index.ts`, after `LabelGroup`:

```ts
export interface LabelGroupPatch {
  name?: string
  exclusive?: boolean
  system?: boolean
  position?: number
}
```

`packages/types/src/data-provider.ts` — add `LabelGroup, LabelGroupPatch,` to the type import list and replace the `labels` block:

```ts
  labels: {
    list(): Promise<Label[]>
    create(name: string, color: string): Promise<Label>
    update(id: string, opts: { name?: string; color?: string }): Promise<Label>
    delete(id: string): Promise<void>
    /** Replaces the full label set on a task; returns the updated task. */
    setForTask(taskId: string, labelIds: string[]): Promise<LocalTask>
    /** Persists label order: position = index in `labelIds`. */
    reorder(labelIds: string[]): Promise<void>
    /** Moves a label into a group, or out of every group with `null`. */
    setGroup(labelId: string, groupId: string | null): Promise<Label>
    /** Returns only the labels this call archived (for an exact Undo). */
    archive(labelIds: string[]): Promise<Label[]>
    /** Returns only the labels this call restored. */
    restore(labelIds: string[]): Promise<Label[]>
    /** Visible labels (not archived, not system) with no open task. */
    unusedIds(): Promise<string[]>
    groups: {
      list(): Promise<LabelGroup[]>
      create(name: string, exclusive: boolean): Promise<LabelGroup>
      update(id: string, patch: LabelGroupPatch): Promise<LabelGroup>
      /** Deletes the group; returns the ids of its labels, now ungrouped. */
      delete(id: string): Promise<string[]>
      reorder(groupIds: string[]): Promise<void>
    }
  }
```

- [ ] **Step 8: Tauri wrappers + provider**

`apps/desktop/src/services/tauri.ts` — add `LabelGroup, LabelGroupPatch,` to both the `export type { … }` re-export list and the `import type { … }` list, then append to the Labels section:

```ts
export async function reorderLabels(ids: string[]): Promise<void> {
  return invoke<void>('reorder_labels', { ids })
}

export async function setLabelGroup(labelId: string, groupId: string | null): Promise<Label> {
  return invoke<Label>('set_label_group', { labelId, groupId })
}

export async function archiveLabels(ids: string[]): Promise<Label[]> {
  return invoke<Label[]>('archive_labels', { ids })
}

export async function restoreLabels(ids: string[]): Promise<Label[]> {
  return invoke<Label[]>('restore_labels', { ids })
}

export async function unusedLabelIds(): Promise<string[]> {
  return invoke<string[]>('unused_label_ids')
}

export async function listLabelGroups(): Promise<LabelGroup[]> {
  return invoke<LabelGroup[]>('list_label_groups')
}

export async function createLabelGroup(name: string, exclusive: boolean): Promise<LabelGroup> {
  return invoke<LabelGroup>('create_label_group', { name, exclusive })
}

export async function updateLabelGroup(id: string, patch: LabelGroupPatch): Promise<LabelGroup> {
  return invoke<LabelGroup>('update_label_group', { id, patch })
}

export async function deleteLabelGroup(id: string): Promise<string[]> {
  return invoke<string[]>('delete_label_group', { id })
}

export async function reorderLabelGroups(ids: string[]): Promise<void> {
  return invoke<void>('reorder_label_groups', { ids })
}
```

`apps/desktop/src/services/tauri-provider.ts` — replace the `labels` block:

```ts
    labels: {
      list: tauri.listLabels,
      create: tauri.createLabel,
      update: tauri.updateLabel,
      delete: tauri.deleteLabel,
      setForTask: tauri.setTaskLabels,
      reorder: tauri.reorderLabels,
      setGroup: tauri.setLabelGroup,
      archive: tauri.archiveLabels,
      restore: tauri.restoreLabels,
      unusedIds: tauri.unusedLabelIds,
      groups: {
        list: tauri.listLabelGroups,
        create: tauri.createLabelGroup,
        update: tauri.updateLabelGroup,
        delete: tauri.deleteLabelGroup,
        reorder: tauri.reorderLabelGroups,
      },
    },
```

- [ ] **Step 9: Web reads (writes stay desktop-only)**

Append to `apps/desktop/src/services/turso/labels.ts` (add `LabelGroup` to its `@nimble/types` import and `bool` to the `./client` import):

```ts
const GROUP_COLS = 'id, name, position, exclusive, system, created_at, updated_at'

function toGroup(row: Row): LabelGroup {
  return {
    id: str(row, 'id'),
    name: str(row, 'name'),
    position: num(row, 'position'),
    exclusive: bool(row, 'exclusive'),
    system: bool(row, 'system'),
    created_at: str(row, 'created_at'),
    updated_at: str(row, 'updated_at'),
  }
}

/** Groups in desktop order. A remote without the v24 table reads as "no groups". */
export async function listLabelGroups(): Promise<LabelGroup[]> {
  try {
    const rows = await query(`SELECT ${GROUP_COLS} FROM label_groups ORDER BY position, created_at`)
    return rows.map(toGroup)
  } catch (e) {
    if (e instanceof TursoError && /no such table/i.test(e.message)) return []
    throw e
  }
}

/** Mirrors `labels.rs::unused_label_ids`. */
export async function unusedLabelIds(): Promise<string[]> {
  const rows = await query(
    `SELECT l.id FROM labels l
     LEFT JOIN label_groups g ON g.id = l."group"
     WHERE l.archived_at IS NULL
       AND COALESCE(g.system, 0) = 0
       AND NOT EXISTS (
         SELECT 1 FROM task_labels tl JOIN local_tasks t ON t.id = tl.task_id
         WHERE tl.label_id = l.id AND t.status != 'complete')
     ORDER BY l.position, l.created_at`,
  )
  return rows.map((r) => str(r, 'id'))
}
```

`apps/desktop/src/services/turso-provider.ts` — import `listLabelGroups, unusedLabelIds` beside `listLabels` and replace the `labels` block:

```ts
    // Reads IN; label + group writes stay desktop-only (they need the full-row
    // sync_log snapshots mutations.ts requires — see its header).
    labels: {
      list: listLabels,
      create: ni('labels.create'),
      update: ni('labels.update'),
      delete: ni('labels.delete'),
      setForTask: ni('labels.setForTask'),
      reorder: ni('labels.reorder'),
      setGroup: ni('labels.setGroup'),
      archive: ni('labels.archive'),
      restore: ni('labels.restore'),
      unusedIds: unusedLabelIds,
      groups: {
        list: listLabelGroups,
        create: ni('labels.groups.create'),
        update: ni('labels.groups.update'),
        delete: ni('labels.groups.delete'),
        reorder: ni('labels.groups.reorder'),
      },
    },
```

- [ ] **Step 10: Mock every new command**

In `tools/mock-tauri.js`, add after `set_task_labels`:

```js
    // Label groups, archive, unused (C4) — mirror nimble-core/src/db/labels.rs.
    list_label_groups: function () {
      return LABEL_GROUPS.slice().sort(function (a, b) { return a.position - b.position })
    },
    create_label_group: function (args) {
      var name = String((args && args.name) || '').trim()
      if (!name) return Promise.reject(new Error('label group name must not be empty'))
      if (LABEL_GROUPS.some(function (g) { return g.name.toLowerCase() === name.toLowerCase() })) {
        return Promise.reject(new Error("a label group named '" + name + "' already exists"))
      }
      var group = {
        id: newId('lg'), name: name, position: LABEL_GROUPS.length,
        exclusive: !!(args && args.exclusive), system: false,
        created_at: nowStamp(), updated_at: nowStamp(),
      }
      LABEL_GROUPS.push(group)
      return group
    },
    update_label_group: function (args) {
      var g = LABEL_GROUPS.find(function (x) { return x.id === (args && args.id) })
      if (!g) return Promise.reject(new Error('no such label group'))
      var p = (args && args.patch) || {}
      if (p.name != null) g.name = String(p.name).trim()
      if (p.exclusive != null) g.exclusive = !!p.exclusive
      if (p.system != null) g.system = !!p.system
      if (p.position != null) g.position = p.position
      g.updated_at = nowStamp()
      return Object.assign({}, g)
    },
    delete_label_group: function (args) {
      var id = args && args.id
      var ungrouped = LABELS.filter(function (l) { return l.group === id }).map(function (l) { l.group = null; return l.id })
      for (var i = LABEL_GROUPS.length - 1; i >= 0; i--) if (LABEL_GROUPS[i].id === id) LABEL_GROUPS.splice(i, 1)
      return ungrouped
    },
    reorder_label_groups: function (args) {
      ((args && args.ids) || []).forEach(function (id, i) {
        var g = LABEL_GROUPS.find(function (x) { return x.id === id })
        if (g) g.position = i
      })
      return null
    },
    set_label_group: function (args) {
      var l = LABELS.find(function (x) { return x.id === (args && args.labelId) })
      if (!l) return Promise.reject(new Error('no such label'))
      l.group = (args && args.groupId) || null
      return Object.assign({}, l)
    },
    reorder_labels: function (args) {
      ((args && args.ids) || []).forEach(function (id, i) {
        var l = LABELS.find(function (x) { return x.id === id })
        if (l) l.position = i
      })
      return null
    },
    archive_labels: function (args) {
      return LABELS.filter(function (l) { return ((args && args.ids) || []).indexOf(l.id) !== -1 && !l.archived_at })
        .map(function (l) { l.archived_at = nowStamp(); return Object.assign({}, l) })
    },
    restore_labels: function (args) {
      return LABELS.filter(function (l) { return ((args && args.ids) || []).indexOf(l.id) !== -1 && l.archived_at })
        .map(function (l) { l.archived_at = null; return Object.assign({}, l) })
    },
    unused_label_ids: function () {
      var systemIds = LABEL_GROUPS.filter(function (g) { return g.system }).map(function (g) { return g.id })
      return LABELS.filter(function (l) {
        if (l.archived_at || systemIds.indexOf(l.group) !== -1) return false
        return !TASKS.some(function (t) { return t.status !== 'complete' && (t.labels || []).indexOf(l.id) !== -1 })
      }).sort(function (a, b) { return a.position - b.position }).map(function (l) { return l.id })
    },
```

- [ ] **Step 11: Verify**

Run: `cargo test --workspace --offline`
Expected: PASS.
Run: `cd apps/desktop && npm run build && npm run build:web`
Expected: both succeed (a missing provider key is a compile error — that is the point of the shared contract).

- [ ] **Step 12: Commit**

```bash
git add nimble-core apps/desktop/src-tauri packages/types apps/desktop/src/services tools/mock-tauri.js
git commit -m "feat(c4): label groups, archive/restore and unused labels end to end

Rust CRUD for label_groups (ungroup-on-delete in one transaction), label
reorder, archive/restore returning exactly what changed, unused = no open
task and not system. Tauri commands, DataProvider contract, Tauri + Turso
(read-only) providers, mock-tauri handlers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 3: `tasks_fts` index maintenance + self-healing rebuild

**Files:**
- Create: `nimble-core/src/db/task_search.rs` (index half; Task 4 adds the query half)
- Modify: `nimble-core/src/db/mod.rs` (add `pub mod task_search;`)
- Modify: `nimble-core/src/db/task_tx.rs` (`create_task_with_id_tx`, `update_task_tx`, `delete_task_tx`, `restore_deleted_tasks_tx`)
- Modify: `nimble-core/src/db/focus/task_write.rs:53` (`commit`)
- Modify: `nimble-core/src/db/tasks.rs` (end of `migrate_tasks_to_markdown`), `nimble-core/src/api/todoist_migration.rs:985` (end of `apply_migration`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (after `run_migrations` / `drop(schema_lock)`, ~line 339)

**Interfaces:**
- Consumes (Task 1): the `tasks_fts` table.
- Produces (`nimble_core::db::task_search`):
  - `pub const TASKS_FTS_VERSION: &str = "1"` (settings key `tasks_fts_version`)
  - `pub(crate) async fn index_task_conn(conn: &mut SqliteConnection, id: &str, content: &str, description: Option<&str>)` — never fails
  - `pub(crate) async fn unindex_task_conn(conn: &mut SqliteConnection, id: &str)` — never fails
  - `pub(crate) async fn apply_effects_conn(conn: &mut SqliteConnection, effects: &TaskEffects)` — never fails
  - `pub async fn rebuild_task_index(pool: &SqlitePool) -> crate::Result<u64>` (rows indexed; writes the version key)
  - `pub(crate) async fn rebuild_after_bulk_write(pool: &SqlitePool)` — never fails
  - `pub async fn ensure_task_index(pool: &SqlitePool) -> crate::Result<bool>` (true = rebuilt)

Why these hook points: every native task write — `db::tasks`, the focus engine, focus import, `dt` — goes through `task_tx`, and every incoming apply — Turso pull, Todoist pull, reconcile, Google Calendar edits — commits through `TaskWrite::commit(&TaskEffects)`. Status changes need no hook: the index holds only text, and status is read from `local_tasks` at query time.

- [ ] **Step 1: Write the failing tests**

Create `nimble-core/src/db/task_search.rs` with only the test module for now (`mod.rs`: add `pub mod task_search;` after `pub mod task_tx;`):

```rust
//! Device-local full-text index over task titles and descriptions (C4).

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sync::{self, RemoteRow};
    use crate::db::tasks::{create_local_task, delete_local_task, update_local_task, update_task_status};
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, UpdateTaskInput};
    use sqlx::SqlitePool;

    async fn hits(pool: &SqlitePool, token: &str) -> Vec<String> {
        sqlx::query_scalar("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ? ORDER BY task_id")
            .bind(format!("\"{token}\"*"))
            .fetch_all(pool)
            .await
            .unwrap()
    }

    fn remote(row_id: &str, op: &str, snapshot: Option<String>) -> RemoteRow {
        RemoteRow {
            entry_id: uuid::Uuid::new_v4().to_string(),
            table_name: "local_tasks".into(),
            row_id: row_id.into(),
            operation: op.into(),
            changed_columns: None,
            snapshot,
            device_id: "remote-device".into(),
            timestamp: "2099-01-01T00:00:00.000Z".into(),
        }
    }

    #[tokio::test]
    async fn local_create_update_status_delete_keep_the_index_in_sync() {
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput {
            content: "Update portfolio".into(), description: Some("deck notes".into()), ..Default::default()
        }).await.unwrap();
        assert_eq!(hits(&pool, "portf").await, vec![t.id.clone()]);
        assert_eq!(hits(&pool, "deck").await, vec![t.id.clone()]);

        update_local_task(&pool, &t.id, UpdateTaskInput { content: Some("Renamed".into()), ..Default::default() }).await.unwrap();
        assert!(hits(&pool, "portfolio").await.is_empty());
        assert_eq!(hits(&pool, "renamed").await, vec![t.id.clone()]);

        update_task_status(&pool, &t.id, "complete", None).await.unwrap();
        assert_eq!(hits(&pool, "renamed").await, vec![t.id.clone()], "completed tasks stay searchable");

        delete_local_task(&pool, &t.id).await.unwrap();
        assert!(hits(&pool, "renamed").await.is_empty());
    }

    #[tokio::test]
    async fn deleting_a_parent_unindexes_its_subtasks_and_restore_reindexes() {
        let pool = test_pool().await;
        let parent = create_local_task(&pool, CreateTaskInput { content: "Parent alpha".into(), ..Default::default() }).await.unwrap();
        let child = create_local_task(&pool, CreateTaskInput {
            content: "Child alpha".into(), parent_id: Some(parent.id.clone()), ..Default::default()
        }).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let effects = crate::db::task_tx::delete_task_tx(&mut tx, &parent.id, crate::db::task_tx::MutationPolicy::User).await.unwrap();
        tx.commit().await.unwrap();
        assert!(hits(&pool, "alpha").await.is_empty());
        let mut tx = pool.begin().await.unwrap();
        crate::db::task_tx::restore_deleted_tasks_tx(&mut tx, &effects.deleted).await.unwrap();
        tx.commit().await.unwrap();
        let mut expected = vec![parent.id.clone(), child.id.clone()];
        expected.sort();
        assert_eq!(hits(&pool, "alpha").await, expected);
    }

    #[tokio::test]
    async fn incoming_turso_apply_updates_and_removes_index_rows() {
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput { content: "Old words".into(), ..Default::default() }).await.unwrap();
        let mut snap: serde_json::Value = serde_json::from_str(&sync::task_sync_snapshot(&t)).unwrap();
        snap["content"] = "Portfolio rewrite".into();
        snap["description"] = "from the phone".into();
        sync::apply_remote_rows_with_focus(&pool, None, &[remote(&t.id, "UPDATE", Some(snap.to_string()))]).await.unwrap();
        assert_eq!(hits(&pool, "portfolio").await, vec![t.id.clone()]);
        assert_eq!(hits(&pool, "phone").await, vec![t.id.clone()]);
        assert!(hits(&pool, "old").await.is_empty());

        let mut fresh = snap.clone();
        fresh["id"] = "remote-new".into();
        fresh["content"] = "Brand new remote".into();
        sync::apply_remote_rows_with_focus(&pool, None, &[remote("remote-new", "INSERT", Some(fresh.to_string()))]).await.unwrap();
        assert_eq!(hits(&pool, "brand").await, vec!["remote-new".to_string()]);

        sync::apply_remote_rows_with_focus(&pool, None, &[remote(&t.id, "DELETE", None)]).await.unwrap();
        assert!(hits(&pool, "portfolio").await.is_empty());
    }

    #[tokio::test]
    async fn task_write_commit_mirrors_effects() {
        // The Todoist pull, reconcile and calendar edits all commit this way.
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput { content: "Before".into(), ..Default::default() }).await.unwrap();
        let mut write = crate::db::focus::task_write::TaskWrite::begin(&pool, None).await.unwrap();
        sqlx::query("UPDATE local_tasks SET content = 'Fresh from Todoist' WHERE id = ?")
            .bind(&t.id).execute(write.conn()).await.unwrap();
        let changed: crate::types::LocalTask = sqlx::query_as(&format!("SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS))
            .bind(&t.id).fetch_one(write.conn()).await.unwrap();
        write.commit(&crate::db::task_tx::TaskEffects { changed: vec![changed], ..Default::default() }).await.unwrap();
        assert_eq!(hits(&pool, "todoist").await, vec![t.id.clone()]);
        assert!(hits(&pool, "before").await.is_empty());
    }

    #[tokio::test]
    async fn ensure_rebuilds_on_count_or_version_drift_only() {
        let pool = test_pool().await;
        assert!(ensure_task_index(&pool).await.unwrap(), "fresh profile has no version key yet");
        assert!(!ensure_task_index(&pool).await.unwrap(), "steady state does nothing");
        // A write that bypassed the funnel (raw SQL) leaves the counts apart.
        sqlx::query("INSERT INTO local_tasks (id, content, project_id, status, completed) VALUES ('raw', 'Legacy import', 'inbox', 'complete', 1)")
            .execute(&pool).await.unwrap();
        assert!(ensure_task_index(&pool).await.unwrap());
        assert_eq!(hits(&pool, "legacy").await, vec!["raw".to_string()], "completed rows are indexed too");
        sqlx::query("UPDATE settings SET value = '0' WHERE key = 'tasks_fts_version'").execute(&pool).await.unwrap();
        assert!(ensure_task_index(&pool).await.unwrap(), "a version bump forces a rebuild");
        assert_eq!(rebuild_task_index(&pool).await.unwrap(), 1);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --workspace --offline -p nimble-core task_search::`
Expected: FAIL — `ensure_task_index` / `rebuild_task_index` not found (compile error).

- [ ] **Step 3: Implement the index half of `task_search.rs`**

Put this above the test module:

```rust
//! Device-local full-text index over task titles and descriptions (C4).
//!
//! `tasks_fts` is never synced (like `vault_fts`) and is written in code, not
//! by triggers (the migration runner splits on `;`). Every write here is
//! best-effort, like `activity::log_activity`: an index failure is logged and
//! never fails the task mutation that caused it. `ensure_task_index` heals any
//! drift on startup; `dt task search --reindex` forces a rebuild.
use sqlx::{SqliteConnection, SqlitePool};

use crate::db::task_tx::TaskEffects;

/// Bump to make every device rebuild its index on next launch.
pub const TASKS_FTS_VERSION: &str = "1";
const VERSION_KEY: &str = "tasks_fts_version";

async fn try_index(conn: &mut SqliteConnection, id: &str, content: &str, description: Option<&str>) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?").bind(id).execute(&mut *conn).await?;
    sqlx::query("INSERT INTO tasks_fts (task_id, content, description) VALUES (?, ?, ?)")
        .bind(id).bind(content).bind(description.unwrap_or("")).execute(&mut *conn).await?;
    Ok(())
}

/// Refresh one task's row inside the caller's transaction.
pub(crate) async fn index_task_conn(conn: &mut SqliteConnection, id: &str, content: &str, description: Option<&str>) {
    if let Err(e) = try_index(conn, id, content, description).await {
        log::warn!("tasks_fts: indexing {id} failed: {e}");
    }
}

pub(crate) async fn unindex_task_conn(conn: &mut SqliteConnection, id: &str) {
    if let Err(e) = sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?").bind(id).execute(&mut *conn).await {
        log::warn!("tasks_fts: unindexing {id} failed: {e}");
    }
}

/// Mirror an incoming apply (Turso pull, Todoist pull, reconcile, calendar
/// edit) in the same transaction that applied it.
pub(crate) async fn apply_effects_conn(conn: &mut SqliteConnection, effects: &TaskEffects) {
    for task in &effects.deleted {
        unindex_task_conn(conn, &task.id).await;
    }
    for task in &effects.changed {
        index_task_conn(conn, &task.id, &task.content, task.description.as_deref()).await;
    }
}

/// Rebuild from `local_tasks` in one transaction (~1.4k rows: well under a second).
pub async fn rebuild_task_index(pool: &SqlitePool) -> crate::Result<u64> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("DELETE FROM tasks_fts").execute(&mut *tx).await?;
    let indexed = sqlx::query(
        "INSERT INTO tasks_fts (task_id, content, description) SELECT id, content, COALESCE(description, '') FROM local_tasks",
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(VERSION_KEY)
    .bind(TASKS_FTS_VERSION)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(indexed)
}

/// After a raw-SQL bulk write that bypasses `task_tx` (legacy importer,
/// markdown backfill). Best-effort.
pub(crate) async fn rebuild_after_bulk_write(pool: &SqlitePool) {
    if let Err(e) = rebuild_task_index(pool).await {
        log::warn!("tasks_fts: rebuild after bulk write failed: {e}");
    }
}

/// Startup heal: rebuild when row counts differ or the index version changed.
pub async fn ensure_task_index(pool: &SqlitePool) -> crate::Result<bool> {
    let indexed: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks_fts").fetch_one(pool).await?;
    let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks").fetch_one(pool).await?;
    let version: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(VERSION_KEY)
        .fetch_optional(pool)
        .await?;
    if indexed == tasks && version.as_deref() == Some(TASKS_FTS_VERSION) {
        return Ok(false);
    }
    rebuild_task_index(pool).await?;
    Ok(true)
}
```

- [ ] **Step 4: Hook the native write funnel (`task_tx.rs`)**

- `create_task_with_id_tx`: right after `let task = fetch(conn, &id).await?;` add
  `crate::db::task_search::index_task_conn(conn, &task.id, &task.content, task.description.as_deref()).await;`
- `update_task_tx`: right after `let task = fetch(conn, id).await?;` add the same line.
- `delete_task_tx`: inside the existing `for task in &effects.deleted { … DELETE FROM local_tasks … }` loop, after the `.execute(&mut *conn).await?;`, add
  `crate::db::task_search::unindex_task_conn(conn, &task.id).await;`
- `restore_deleted_tasks_tx`: after the `INSERT INTO local_tasks(...)` `.execute(&mut *conn).await?;` add
  `crate::db::task_search::index_task_conn(conn, &task.id, &task.content, task.description.as_deref()).await;`

- [ ] **Step 5: Hook the incoming-apply boundary (`task_write.rs`)**

Replace `commit`:

```rust
    /// Reconcile queue/ledger effects and commit in the same transaction.
    /// The device-local search index mirrors the applied rows first
    /// (best-effort; it never fails the apply).
    pub async fn commit(mut self, effects: &TaskEffects) -> crate::Result<()> {
        crate::db::task_search::apply_effects_conn(self.conn(), effects).await;
        match self {
            Self::Owned(guard) => {
                guard.commit(effects).await?;
            }
            Self::Headless(mut tx) => {
                reconcile_remote_task_effects_tx(&mut tx, effects).await?;
                tx.commit().await?;
            }
        }
        Ok(())
    }
```

- [ ] **Step 6: Hook the two raw-SQL bulk writers**

- `nimble-core/src/db/tasks.rs`, end of `migrate_tasks_to_markdown`, directly before `Ok(TasksMdResult { … })`: `crate::db::task_search::rebuild_after_bulk_write(pool).await;`
- `nimble-core/src/api/todoist_migration.rs:985`, end of `apply_migration`, directly before `Ok(result)`: `crate::db::task_search::rebuild_after_bulk_write(pool).await;`

- [ ] **Step 7: Run the index tests**

Run: `cargo test --workspace --offline -p nimble-core task_search::`
Expected: PASS (5 tests).

- [ ] **Step 8: Startup heal in the app**

In `apps/desktop/src-tauri/src/lib.rs`, directly after `drop(schema_lock);`:

```rust
                // Device-local task search index: rebuild on count/version drift.
                match nimble_core::db::task_search::ensure_task_index(&pool).await {
                    Ok(true) => log::info!("Task search index rebuilt"),
                    Ok(false) => {}
                    Err(e) => log::warn!("Task search index check failed: {e}"),
                }
```

- [ ] **Step 9: Full Rust suite**

Run: `cargo test --workspace --offline`
Expected: PASS (existing focus/Todoist/reconcile suites confirm the hooks never fail a write).

- [ ] **Step 10: Commit**

```bash
git add nimble-core apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(c4): keep device-local tasks_fts in sync at every write path

Index maintained in task_tx (every native write) and TaskWrite::commit
(every incoming apply), rebuilt after raw bulk writers, healed on startup
by count/version check. Index writes never fail the user's mutation.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 4: `search_tasks` — sanitizer, ranking, snippets, filters; Tauri + web fallback + mock

**Files:**
- Modify: `nimble-core/src/types.rs` (add `TaskSearchFilters`, `TaskSearchHit` after `LabelGroupPatch`)
- Modify: `nimble-core/src/db/task_search.rs` (query half + tests)
- Modify: `apps/desktop/src-tauri/src/commands/local_tasks.rs`, `apps/desktop/src-tauri/src/lib.rs` (register after `local_tasks::migrate_tasks_to_markdown,`)
- Modify: `packages/types/src/index.ts`, `packages/types/src/data-provider.ts` (`tasks.search`)
- Modify: `apps/desktop/src/services/tauri.ts`, `tauri-provider.ts:97-108`, `turso-provider.ts` (tasks block), `turso/tasks.ts` (export `SELECT_COLS`, `toTask`)
- Create: `apps/desktop/src/services/turso/search.ts`, `apps/desktop/src/lib/taskSearch.ts`, `apps/desktop/tests/taskSearch.test.mjs`
- Modify: `tools/mock-tauri.js` (add `search_tasks`)

**Interfaces:**
- Consumes (Task 3): populated `tasks_fts`; `crate::db::tasks::SELECT_COLS`; `LocalTask: FromRow`.
- Produces:
  - Rust `types::TaskSearchFilters { status: Option<String> /* "all" | "open" | "completed" */, label_ids: Vec<String>, project_id: Option<String> }` (Default, serde-default fields); `types::TaskSearchHit { task: LocalTask, snippet: Option<String>, matched_in: String /* "title" | "description" */ }`.
  - `task_search::DEFAULT_LIMIT: i64 = 50`; `pub fn fts_query(input: &str) -> Option<String>`; `pub async fn search_tasks(pool: &SqlitePool, query: &str, filters: &TaskSearchFilters, limit: i64) -> crate::Result<Vec<TaskSearchHit>>`.
  - Tauri `search_tasks({ query, filters, limit })`.
  - TS `type TaskSearchStatus = 'all' | 'open' | 'completed'`; `interface TaskSearchFilters { status?: TaskSearchStatus; label_ids?: string[]; project_id?: string | null }`; `interface TaskSearchHit { task: LocalTask; snippet: string | null; matched_in: 'title' | 'description' }`; `DataProvider.tasks.search(query: string, filters?: TaskSearchFilters): Promise<TaskSearchHit[]>`; `tauri.searchTasks(query, filters?)`.
  - `lib/taskSearch.ts`: `MARK_OPEN = '\u0002'`, `MARK_CLOSE = '\u0003'`, `searchTokens(input: string): string[]`, `interface Segment { text: string; mark: boolean }`, `splitMarked(marked: string): Segment[]`, `markTitle(title: string, tokens: readonly string[]): Segment[]`, `likeSnippet(text: string | null, tokens: readonly string[], radius?: number): string | null`.
  - `services/turso/search.ts`: `searchTasksLike(input: string, filters?: TaskSearchFilters, limit?: number): Promise<TaskSearchHit[]>`.

- [ ] **Step 1: Rust types**

`nimble-core/src/types.rs`:

```rust
/// Optional ⌘F / `dt task search` filters.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct TaskSearchFilters {
    /// "all" (default), "open" or "completed".
    #[serde(default)]
    pub status: Option<String>,
    /// Any-of.
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskSearchHit {
    pub task: LocalTask,
    /// Description excerpt with U+0002 … U+0003 around matches. Only when the
    /// title alone does not contain every query token.
    pub snippet: Option<String>,
    /// "title" | "description"
    pub matched_in: String,
}
```

- [ ] **Step 2: Write the failing Rust tests**

Append to `mod tests` in `nimble-core/src/db/task_search.rs` (add `use crate::types::TaskSearchFilters;` to the module's imports):

```rust
    async fn titles(pool: &SqlitePool, q: &str, filters: &TaskSearchFilters) -> Vec<String> {
        search_tasks(pool, q, filters, DEFAULT_LIMIT).await.unwrap().into_iter().map(|h| h.task.content).collect()
    }

    /// (title match, description match, completed title match)
    async fn seed(pool: &SqlitePool) -> (String, String, String) {
        let title = create_local_task(pool, CreateTaskInput { content: "Portfolio review".into(), ..Default::default() }).await.unwrap();
        let desc = create_local_task(pool, CreateTaskInput {
            content: "Email Jo".into(), description: Some("Ask about the portfolio deck before Friday".into()), ..Default::default()
        }).await.unwrap();
        let done = create_local_task(pool, CreateTaskInput { content: "Old portfolio draft".into(), ..Default::default() }).await.unwrap();
        update_task_status(pool, &done.id, "complete", None).await.unwrap();
        (title.id, desc.id, done.id)
    }

    #[test]
    fn fts_query_quotes_prefixes_and_strips_syntax() {
        assert_eq!(fts_query("portfolio").as_deref(), Some("\"portfolio\"*"));
        assert_eq!(fts_query("  Up   port ").as_deref(), Some("\"Up\"* AND \"port\"*"));
        assert_eq!(fts_query("follow-up").as_deref(), Some("\"follow up\"*"));
        assert_eq!(fts_query("say \"hi\"").as_deref(), Some("\"say\"* AND \"hi\"*"));
        assert_eq!(fts_query("c++ café").as_deref(), Some("\"c\"* AND \"café\"*"));
        assert_eq!(fts_query("portfolio &").as_deref(), Some("\"portfolio\"*"), "punctuation-only tokens are dropped");
    }

    #[test]
    fn fts_query_empty_after_sanitizing_is_none() {
        for input in ["", "   ", "\"", "*", "-", "()", "^:+", "&", "🎸", "— …"] {
            assert_eq!(fts_query(input), None, "{input:?}");
        }
    }

    #[tokio::test]
    async fn open_before_completed_and_title_before_description() {
        let pool = test_pool().await;
        seed(&pool).await;
        assert_eq!(titles(&pool, "portf", &Default::default()).await, ["Portfolio review", "Email Jo", "Old portfolio draft"]);
    }

    #[tokio::test]
    async fn snippets_only_for_description_matches() {
        let pool = test_pool().await;
        seed(&pool).await;
        let hits = search_tasks(&pool, "portfolio", &Default::default(), DEFAULT_LIMIT).await.unwrap();
        let by_title = hits.iter().find(|h| h.task.content == "Portfolio review").unwrap();
        assert_eq!((by_title.matched_in.as_str(), by_title.snippet.is_none()), ("title", true));
        let by_desc = hits.iter().find(|h| h.task.content == "Email Jo").unwrap();
        assert_eq!(by_desc.matched_in, "description");
        assert!(by_desc.snippet.as_deref().unwrap().contains("\u{2}portfolio\u{3}"), "{:?}", by_desc.snippet);
    }

    #[tokio::test]
    async fn a_title_and_description_split_counts_as_description() {
        let pool = test_pool().await;
        seed(&pool).await;
        let hits = search_tasks(&pool, "email deck", &Default::default(), DEFAULT_LIMIT).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].matched_in, "description");
        assert!(hits[0].snippet.as_deref().unwrap().contains("\u{2}deck\u{3}"));
    }

    #[tokio::test]
    async fn filters_status_label_and_project() {
        let pool = test_pool().await;
        let (title_id, desc_id, _) = seed(&pool).await;
        let open = TaskSearchFilters { status: Some("open".into()), ..Default::default() };
        assert_eq!(titles(&pool, "portfolio", &open).await, ["Portfolio review", "Email Jo"]);
        let completed = TaskSearchFilters { status: Some("completed".into()), ..Default::default() };
        assert_eq!(titles(&pool, "portfolio", &completed).await, ["Old portfolio draft"]);
        let bad = TaskSearchFilters { status: Some("later".into()), ..Default::default() };
        assert!(search_tasks(&pool, "portfolio", &bad, DEFAULT_LIMIT).await.is_err());

        let deep = crate::db::labels::create_label(&pool, "deep", "gray").await.unwrap();
        let quick = crate::db::labels::create_label(&pool, "quick", "gray").await.unwrap();
        crate::db::labels::set_task_labels(&pool, &desc_id, &[deep.id.clone()]).await.unwrap();
        let any_of = TaskSearchFilters { label_ids: vec![quick.id.clone(), deep.id.clone()], ..Default::default() };
        let hits = search_tasks(&pool, "portfolio", &any_of, DEFAULT_LIMIT).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].task.labels, vec![deep.id.clone()], "hits carry their labels");

        let project = crate::db::projects::create_project(&pool, "Site", "blue", None).await.unwrap();
        update_local_task(&pool, &title_id, UpdateTaskInput { project_id: Some(project.id.clone()), ..Default::default() }).await.unwrap();
        let in_project = TaskSearchFilters { project_id: Some(project.id.clone()), ..Default::default() };
        assert_eq!(titles(&pool, "portfolio", &in_project).await, ["Portfolio review"]);
    }

    #[tokio::test]
    async fn search_never_errors_on_hostile_input() {
        let pool = test_pool().await;
        seed(&pool).await;
        for q in ["\"", "*", "-", "a:b", "NEAR(", "(", ")", "AND", "OR portfolio", "^x", "portfolio &", "🎸", "c++", "follow-up", "col:portfolio"] {
            let result = search_tasks(&pool, q, &Default::default(), DEFAULT_LIMIT).await;
            assert!(result.is_ok(), "{q:?}: {result:?}");
        }
        assert_eq!(titles(&pool, "portfolio &", &Default::default()).await.len(), 3);
        assert!(titles(&pool, "\"*\"", &Default::default()).await.is_empty());
    }

    #[tokio::test]
    async fn diacritics_prefix_and_limit() {
        let pool = test_pool().await;
        create_local_task(&pool, CreateTaskInput { content: "Résumé tweaks".into(), ..Default::default() }).await.unwrap();
        assert_eq!(titles(&pool, "resu", &Default::default()).await, ["Résumé tweaks"]);
        assert_eq!(titles(&pool, "RÉSUMÉ", &Default::default()).await, ["Résumé tweaks"]);
        for i in 0..5 {
            create_local_task(&pool, CreateTaskInput { content: format!("Batch item {i}"), ..Default::default() }).await.unwrap();
        }
        assert_eq!(search_tasks(&pool, "batch", &Default::default(), 3).await.unwrap().len(), 3);
    }
```

Run: `cargo test --workspace --offline -p nimble-core task_search::`
Expected: FAIL — `search_tasks`, `fts_query`, `DEFAULT_LIMIT` not found.

- [ ] **Step 3: Implement the query half**

Add to the imports of `task_search.rs`:

```rust
use std::collections::HashSet;

use sqlx::{FromRow, Row};

use crate::db::tasks::SELECT_COLS;
use crate::types::{LocalTask, TaskSearchFilters, TaskSearchHit};
```

and after `ensure_task_index`:

```rust
pub const DEFAULT_LIMIT: i64 = 50;

/// User text → FTS5 query. Whitespace tokens; FTS syntax characters
/// (`"*:^()-+`) become spaces inside the token (so "follow-up" stays a
/// phrase); tokens without a letter or digit are dropped (so "portfolio &"
/// still matches); each token is a quoted prefix match; all ANDed.
/// `None` = nothing searchable, never an FTS syntax error.
pub fn fts_query(input: &str) -> Option<String> {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(|raw| {
            raw.chars()
                .map(|c| if matches!(c, '"' | '*' | ':' | '^' | '(' | ')' | '-' | '+') { ' ' } else { c })
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|t| t.chars().any(char::is_alphanumeric))
        .collect();
    if tokens.is_empty() {
        return None;
    }
    Some(tokens.iter().map(|t| format!("\"{t}\"*")).collect::<Vec<_>>().join(" AND "))
}

/// Ranked search: open before completed, then bm25 with title matches
/// weighted 10× description, then most recently updated. Limit ≤ 200.
pub async fn search_tasks(
    pool: &SqlitePool,
    query: &str,
    filters: &TaskSearchFilters,
    limit: i64,
) -> crate::Result<Vec<TaskSearchHit>> {
    let status_clause = match filters.status.as_deref().unwrap_or("all") {
        "all" => "",
        "open" => " AND t.status != 'complete'",
        "completed" => " AND t.status = 'complete'",
        other => return Err(crate::Error::Other(format!("unknown search status '{other}'"))),
    };
    let Some(fts) = fts_query(query) else { return Ok(Vec::new()) };

    // Rows whose title alone holds every token get no description snippet.
    let title_only: HashSet<String> = sqlx::query_scalar("SELECT task_id FROM tasks_fts WHERE tasks_fts MATCH ?")
        .bind(format!("content : ({fts})"))
        .fetch_all(pool)
        .await?
        .into_iter()
        .collect();

    // Explicit aliases: SQLite leaves an un-aliased `t.col` result name unspecified.
    let cols = SELECT_COLS.split(", ").map(|c| format!("t.{c} AS {c}")).collect::<Vec<_>>().join(", ");
    let mut sql = format!(
        "SELECT {cols}, snippet(tasks_fts, 2, char(2), char(3), '…', 12) AS search_snippet
         FROM tasks_fts JOIN local_tasks t ON t.id = tasks_fts.task_id
         WHERE tasks_fts MATCH ?{status_clause}"
    );
    if filters.project_id.is_some() {
        sql.push_str(" AND t.project_id = ?");
    }
    if !filters.label_ids.is_empty() {
        let marks = vec!["?"; filters.label_ids.len()].join(", ");
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id IN ({marks}))"
        ));
    }
    sql.push_str(" ORDER BY CASE WHEN t.status = 'complete' THEN 1 ELSE 0 END, bm25(tasks_fts, 0.0, 10.0, 1.0), t.updated_at DESC LIMIT ?");

    let mut q = sqlx::query(&sql).bind(&fts);
    if let Some(project) = &filters.project_id {
        q = q.bind(project);
    }
    for id in &filters.label_ids {
        q = q.bind(id);
    }
    let rows = q.bind(limit.clamp(1, 200)).fetch_all(pool).await?;

    let mut hits = Vec::with_capacity(rows.len());
    for row in &rows {
        let task = LocalTask::from_row(row)?;
        let in_title = title_only.contains(&task.id);
        let snippet: Option<String> = if in_title { None } else { row.try_get("search_snippet")? };
        hits.push(TaskSearchHit {
            snippet: snippet.filter(|s| !s.is_empty()),
            matched_in: if in_title { "title" } else { "description" }.to_string(),
            task,
        });
    }
    attach_labels(pool, &mut hits).await?;
    Ok(hits)
}

async fn attach_labels(pool: &SqlitePool, hits: &mut [TaskSearchHit]) -> crate::Result<()> {
    if hits.is_empty() {
        return Ok(());
    }
    let marks = vec!["?"; hits.len()].join(", ");
    let sql = format!("SELECT task_id, label_id FROM task_labels WHERE task_id IN ({marks}) ORDER BY rowid");
    let mut q = sqlx::query_as::<_, (String, String)>(&sql);
    for hit in hits.iter() {
        q = q.bind(hit.task.id.clone());
    }
    for (task_id, label_id) in q.fetch_all(pool).await? {
        if let Some(hit) = hits.iter_mut().find(|h| h.task.id == task_id) {
            hit.task.labels.push(label_id);
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Run the Rust tests**

Run: `cargo test --workspace --offline -p nimble-core task_search::`
Expected: PASS (13 tests). If `content : (…)` is rejected by the bundled SQLite, replace the `title_only` query's MATCH argument with `{content} : ({fts})` (both forms are FTS5 column filters) and re-run.

- [ ] **Step 5: Tauri command**

`apps/desktop/src-tauri/src/commands/local_tasks.rs`:

```rust
#[tauri::command]
pub async fn search_tasks(
    app: AppHandle,
    query: String,
    filters: Option<nimble_core::types::TaskSearchFilters>,
    limit: Option<i64>,
) -> Result<Vec<nimble_core::types::TaskSearchHit>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::task_search::search_tasks(
        pool.inner(),
        &query,
        &filters.unwrap_or_default(),
        limit.unwrap_or(nimble_core::db::task_search::DEFAULT_LIMIT),
    )
    .await
    .map_err(|e| e.to_string())
}
```

Register `local_tasks::search_tasks,` in `lib.rs` after `local_tasks::migrate_tasks_to_markdown,`.

- [ ] **Step 6: Write the failing node tests for `lib/taskSearch.ts`**

Create `apps/desktop/tests/taskSearch.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { MARK_OPEN as O, MARK_CLOSE as C, searchTokens, splitMarked, markTitle, likeSnippet } from '../src/lib/taskSearch.ts'

test('searchTokens: syntax becomes spaces, punctuation-only and emoji tokens drop', () => {
  assert.deepEqual(searchTokens('  follow-up  c++ "hi" & 🎸 café '), ['follow', 'up', 'c', 'hi', 'café'])
  assert.deepEqual(searchTokens('***'), [])
})

test('splitMarked: runs, and unbalanced markers never throw', () => {
  assert.deepEqual(splitMarked(`a ${O}port${C} b`), [
    { text: 'a ', mark: false }, { text: 'port', mark: true }, { text: ' b', mark: false },
  ])
  assert.deepEqual(splitMarked(`x${O}open`), [{ text: 'x', mark: false }, { text: 'open', mark: true }])
  assert.deepEqual(splitMarked(`stray${C}close`), [{ text: 'stray', mark: false }, { text: 'close', mark: false }])
  assert.deepEqual(splitMarked(''), [])
})

test('markTitle: words starting with a token, case- and diacritic-insensitive', () => {
  assert.deepEqual(markTitle('Update Résumé draft', ['resu', 'DR']), [
    { text: 'Update ', mark: false }, { text: 'Résumé', mark: true }, { text: ' ', mark: false }, { text: 'draft', mark: true },
  ])
  assert.deepEqual(markTitle('Email Jo', ['deck']), [{ text: 'Email Jo', mark: false }])
  assert.deepEqual(markTitle('Email Jo', []), [{ text: 'Email Jo', mark: false }])
})

test('likeSnippet: window around the first hit, every hit marked, ellipses when cut', () => {
  const text = 'A'.repeat(80) + ' ask about the portfolio deck and the Portfolio site ' + 'B'.repeat(200)
  const s = likeSnippet(text, ['portfolio'], 20)
  assert.ok(s.startsWith('…') && s.endsWith('…'), s)
  assert.ok(s.includes(`${O}portfolio${C}`), s)
  assert.equal(likeSnippet('short portfolio', ['portfolio']), `short ${O}portfolio${C}`)
  assert.equal(likeSnippet('nothing here', ['portfolio']), null)
  assert.equal(likeSnippet(null, ['portfolio']), null)
})
```

Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs`
Expected: FAIL — cannot find module `../src/lib/taskSearch.ts`.

- [ ] **Step 7: Implement `lib/taskSearch.ts` (first half)**

Create `apps/desktop/src/lib/taskSearch.ts`:

```ts
/* Pure task-search helpers (C4). Type-only imports and no `@/` aliases, so
   node tests load this file directly (tests/taskSearch.test.mjs). */

/** Snippet markers — Rust's `snippet(tasks_fts, 2, char(2), char(3), …)`. */
export const MARK_OPEN = '\u0002'
export const MARK_CLOSE = '\u0003'

const SYNTAX = /["*:^()\-+]/g
const WORDY = /[\p{L}\p{N}]/u

/** Word tokens for highlighting and the web LIKE fallback. FTS syntax
 *  characters become spaces; tokens without a letter or digit are dropped.
 *  (Rust keeps "follow-up" as one phrase; for highlighting, two words.) */
export function searchTokens(input: string): string[] {
  return input.replace(SYNTAX, ' ').split(/\s+/).filter((t) => WORDY.test(t))
}

export interface Segment {
  text: string
  mark: boolean
}

/** Split a marked string into plain/marked runs; unbalanced markers are tolerated. */
export function splitMarked(marked: string): Segment[] {
  const out: Segment[] = []
  let mark = false
  let buf = ''
  const flush = () => {
    if (buf) out.push({ text: buf, mark })
    buf = ''
  }
  for (const ch of marked) {
    if (ch === MARK_OPEN) { flush(); mark = true }
    else if (ch === MARK_CLOSE) { flush(); mark = false }
    else buf += ch
  }
  flush()
  return out
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Title runs with every word that starts with a token marked
 *  (case- and diacritic-insensitive, like the index's tokenizer). */
export function markTitle(title: string, tokens: readonly string[]): Segment[] {
  const needles = tokens.map(fold).filter(Boolean)
  if (needles.length === 0) return title ? [{ text: title, mark: false }] : []
  const out: Segment[] = []
  let last = 0
  for (const m of title.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = m[0]
    const start = m.index ?? 0
    if (!needles.some((n) => fold(word).startsWith(n))) continue
    if (start > last) out.push({ text: title.slice(last, start), mark: false })
    out.push({ text: word, mark: true })
    last = start + word.length
  }
  if (last < title.length) out.push({ text: title.slice(last), mark: false })
  return out
}

/** Web-fallback snippet: a window around the first token hit, every hit
 *  wrapped in markers, `…` where cut. `null` when nothing matches. */
export function likeSnippet(text: string | null, tokens: readonly string[], radius = 48): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  const needles = tokens.map((t) => t.toLowerCase()).filter(Boolean)
  const firsts = needles.map((n) => lower.indexOf(n)).filter((i) => i >= 0)
  if (firsts.length === 0) return null
  const first = Math.min(...firsts)
  const start = Math.max(0, first - radius)
  const end = Math.min(text.length, first + radius * 2)
  const slice = text.slice(start, end)
  const sliceLower = slice.toLowerCase()
  const ranges: [number, number][] = []
  for (const n of needles) {
    for (let i = sliceLower.indexOf(n); i !== -1; i = sliceLower.indexOf(n, i + n.length)) ranges.push([i, i + n.length])
  }
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let pos = 0
  for (const [s, e] of ranges) {
    if (s < pos) continue
    out += slice.slice(pos, s) + MARK_OPEN + slice.slice(s, e) + MARK_CLOSE
    pos = e
  }
  out += slice.slice(pos)
  return (start > 0 ? '…' : '') + out + (end < text.length ? '…' : '')
}
```

Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 8: Shared TS contract, Tauri wrapper, providers, web fallback**

`packages/types/src/index.ts` (after `LabelGroupPatch`):

```ts
export type TaskSearchStatus = 'all' | 'open' | 'completed'

export interface TaskSearchFilters {
  status?: TaskSearchStatus
  /** Any-of. */
  label_ids?: string[]
  project_id?: string | null
}

export interface TaskSearchHit {
  task: LocalTask
  /** Description excerpt with U+0002 … U+0003 around matches; null for title matches. */
  snippet: string | null
  matched_in: 'title' | 'description'
}
```

`packages/types/src/data-provider.ts` — add `TaskSearchFilters, TaskSearchHit,` to the type imports and, inside `tasks: { … }` after `migrateToMarkdown(): Promise<TasksMdResult>`:

```ts
    /** Full-text search over every task, open first. Desktop: FTS5; web: LIKE (degraded). */
    search(query: string, filters?: TaskSearchFilters): Promise<TaskSearchHit[]>
```

`apps/desktop/src/services/tauri.ts` — add `TaskSearchFilters, TaskSearchHit,` to both type lists and, after `migrateTasksToMarkdown`:

```ts
export async function searchTasks(query: string, filters?: TaskSearchFilters): Promise<TaskSearchHit[]> {
  return invoke<TaskSearchHit[]>('search_tasks', { query, filters: filters ?? null, limit: 50 })
}
```

`tauri-provider.ts` tasks block: add `search: tauri.searchTasks,`.

`apps/desktop/src/services/turso/tasks.ts`: change `const SELECT_COLS =` to `export const SELECT_COLS =` and `function toTask(` to `export function toTask(`.

Create `apps/desktop/src/services/turso/search.ts`:

```ts
/**
 * Task search for the web build — DEGRADED on purpose. Turso has no FTS5
 * index (tasks_fts is device-local), so this is a LIKE scan with the same
 * signature and open-first order as nimble-core/src/db/task_search.rs:
 * every token must appear in the title or description; title-only matches
 * rank first within open/completed. No prefix ranking, no diacritic folding,
 * ASCII-only case folding.
 */
import type { TaskSearchFilters, TaskSearchHit } from '@nimble/types'
import { likeSnippet, searchTokens } from '@/lib/taskSearch'
import { integer, pipeline, str, text, type TursoArg } from './client'
import { SELECT_COLS, toTask } from './tasks'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function searchTasksLike(input: string, filters: TaskSearchFilters = {}, limit = 50): Promise<TaskSearchHit[]> {
  const tokens = searchTokens(input)
  if (tokens.length === 0) return []
  const where: string[] = []
  const args: TursoArg[] = []
  for (const token of tokens) {
    const pattern = text(`%${escapeLike(token)}%`)
    where.push(`(content LIKE ? ESCAPE '\\' OR COALESCE(description, '') LIKE ? ESCAPE '\\')`)
    args.push(pattern, pattern)
  }
  const status = filters.status ?? 'all'
  if (status === 'open') where.push(`status != 'complete'`)
  if (status === 'completed') where.push(`status = 'complete'`)
  if (filters.project_id) {
    where.push('project_id = ?')
    args.push(text(filters.project_id))
  }
  const labelIds = filters.label_ids ?? []
  if (labelIds.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = local_tasks.id AND tl.label_id IN (${labelIds.map(() => '?').join(', ')}))`)
    for (const id of labelIds) args.push(text(id))
  }
  const titleHasAll = tokens.map(() => `content LIKE ? ESCAPE '\\'`).join(' AND ')
  for (const token of tokens) args.push(text(`%${escapeLike(token)}%`))
  args.push(integer(limit))

  const [rows, labelRows] = await pipeline([
    {
      sql: `SELECT ${SELECT_COLS} FROM local_tasks WHERE ${where.join(' AND ')}
            ORDER BY CASE WHEN status = 'complete' THEN 1 ELSE 0 END,
                     CASE WHEN ${titleHasAll} THEN 0 ELSE 1 END,
                     updated_at DESC
            LIMIT ?`,
      args,
    },
    { sql: 'SELECT task_id, label_id FROM task_labels ORDER BY rowid', args: [] },
  ])
  const labelsByTask = new Map<string, string[]>()
  for (const row of labelRows) {
    const id = str(row, 'task_id')
    labelsByTask.set(id, [...(labelsByTask.get(id) ?? []), str(row, 'label_id')])
  }
  return rows.map((row) => {
    const task = toTask(row, labelsByTask.get(str(row, 'id')) ?? [])
    const title = task.content.toLowerCase()
    const inTitle = tokens.every((t) => title.includes(t.toLowerCase()))
    return {
      task,
      matched_in: inTitle ? 'title' : 'description',
      snippet: inTitle ? null : likeSnippet(task.description, tokens),
    }
  })
}
```

`turso-provider.ts`: import `{ searchTasksLike } from '@/services/turso/search'` and add `search: searchTasksLike,` to its `tasks` block.

- [ ] **Step 9: Mock `search_tasks`**

In `tools/mock-tauri.js`, next to the task handlers:

```js
    // ⌘F search (C4): substring stand-in for FTS5 with the same ordering —
    // open first, title-only matches next, then most recently updated.
    search_tasks: function (args) {
      var tokens = String((args && args.query) || '').replace(/["*:^()\-+]/g, ' ').split(/\s+/)
        .filter(function (t) { return /[\p{L}\p{N}]/u.test(t) })
        .map(function (t) { return t.toLowerCase() })
      if (!tokens.length) return []
      var f = (args && args.filters) || {}
      var status = f.status || 'all'
      var labelIds = f.label_ids || []
      function snippet(text) {
        var lower = text.toLowerCase()
        var first = Math.min.apply(null, tokens.map(function (t) { var i = lower.indexOf(t); return i < 0 ? Infinity : i }))
        if (!isFinite(first)) return null
        var start = Math.max(0, first - 40)
        var slice = text.slice(start, first + 80)
        tokens.forEach(function (t) {
          slice = slice.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), function (m) { return '\u0002' + m + '\u0003' })
        })
        return (start > 0 ? '…' : '') + slice + (first + 80 < text.length ? '…' : '')
      }
      var hits = TASKS.filter(function (t) {
        var hay = (t.content + ' ' + (t.description || '')).toLowerCase()
        if (!tokens.every(function (tok) { return hay.indexOf(tok) !== -1 })) return false
        var done = t.status === 'complete'
        if (status === 'open' && done) return false
        if (status === 'completed' && !done) return false
        if (f.project_id && t.project_id !== f.project_id) return false
        if (labelIds.length && !labelIds.some(function (id) { return (t.labels || []).indexOf(id) !== -1 })) return false
        return true
      }).map(function (t) {
        var inTitle = tokens.every(function (tok) { return t.content.toLowerCase().indexOf(tok) !== -1 })
        return { task: Object.assign({}, t), matched_in: inTitle ? 'title' : 'description', snippet: inTitle ? null : snippet(t.description || '') }
      })
      hits.sort(function (a, b) {
        var da = a.task.status === 'complete' ? 1 : 0
        var db = b.task.status === 'complete' ? 1 : 0
        if (da !== db) return da - db
        var ta = a.matched_in === 'title' ? 0 : 1
        var tb = b.matched_in === 'title' ? 0 : 1
        if (ta !== tb) return ta - tb
        return String(b.task.updated_at).localeCompare(String(a.task.updated_at))
      })
      return hits.slice(0, (args && args.limit) || 50)
    },
```

- [ ] **Step 10: Verify**

Run: `cargo test --workspace --offline`
Expected: PASS.
Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs && npm run build && npm run build:web`
Expected: tests pass, both builds succeed.

- [ ] **Step 11: Commit**

```bash
git add nimble-core apps/desktop/src-tauri packages/types apps/desktop/src/services apps/desktop/src/lib/taskSearch.ts apps/desktop/tests/taskSearch.test.mjs tools/mock-tauri.js
git commit -m "feat(c4): ranked task search — FTS5 on desktop, LIKE fallback on web

Sanitized prefix-AND FTS query (never a syntax error), open before
completed, bm25 title x10, description snippets with control markers,
status/label/project filters. search_tasks command, DataProvider
tasks.search, degraded web LIKE fallback, mock, pure highlight helpers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 5: `dt label …`, `dt task search`, and the one-time seed script

**Files:**
- Modify: `tools/dt/src/args.rs` (`Task::Search`, `Label::{Unused, Group, Archive, Restore}`, new `LabelGroupCommand`)
- Modify: `tools/dt/src/commands/mod.rs` (resolvers + execute arms)
- Modify: `tools/dt/tests/contracts.rs` (two new tests)
- Create: `tools/seed-label-groups.sh` (executable)

**Interfaces:**
- Consumes: Task 2 `db::labels::{list_label_groups, create_label_group, update_label_group, set_label_group, archive_labels, restore_labels, unused_label_ids}`, `types::{LabelGroup, LabelGroupPatch}`; Task 3 `db::task_search::rebuild_task_index`; Task 4 `db::task_search::search_tasks`, `types::TaskSearchFilters`.
- Produces (CLI, all support the global `--json`):
  - `dt label list` (now carries `group`, `archived_at`) · `dt label unused` · `dt label group list` · `dt label group create <name> [--pick-one] [--system]` (idempotent: reuses a group by case-insensitive name; flags only ever switch on) · `dt label group assign <label> <group>` · `dt label archive <label…> | --unused` · `dt label restore <label…>`.
  - `dt task search [<query>] [--status open|completed|all] [--label <name|id>]… [--project <name|id>] [--limit N] [--reindex]` → `data` = `TaskSearchHit[]`, or `{ "reindexed": N }` with `--reindex` and no query.
  - Names resolve by exact id first, then case-insensitive name; more than one name match → `validation` error (exit 2); no match → `not_found` (exit 1).

- [ ] **Step 1: Write the failing contract tests**

Append to `tools/dt/tests/contracts.rs`:

```rust
fn data_id(v: &Value) -> String {
    v["data"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn label_groups_archive_restore_and_search_round_trip() {
    let root = fixture().await;
    let (_, deep) = run(&root, &["label", "create", "deep"]);
    run(&root, &["label", "create", "quick"]);
    run(&root, &["label", "create", "Comms"]);
    run(&root, &["label", "create", "comms"]); // UNIQUE is case-sensitive, so this is allowed

    let (code, effort) = run(&root, &["label", "group", "create", "EFFORT", "--pick-one"]);
    assert_eq!(code, 0, "{effort}");
    assert_eq!(effort["data"]["exclusive"], true);
    let (_, again) = run(&root, &["label", "group", "create", "effort"]);
    assert_eq!(data_id(&again), data_id(&effort), "create reuses a group by name");
    assert_eq!(again["data"]["exclusive"], true, "a re-run never switches a flag off");
    let (_, system) = run(&root, &["label", "group", "create", "SYSTEM", "--system"]);
    assert_eq!(system["data"]["system"], true);
    let (_, groups) = run(&root, &["label", "group", "list"]);
    assert_eq!(groups["data"].as_array().unwrap().len(), 2);

    let (code, assigned) = run(&root, &["label", "group", "assign", "DEEP", "Effort"]);
    assert_eq!(code, 0, "{assigned}");
    assert_eq!(assigned["data"]["group"], data_id(&effort).as_str());
    let (code, ambiguous) = run(&root, &["label", "group", "assign", "COMMS", "effort"]);
    assert_eq!((code, ambiguous["error"]["code"].as_str()), (2, Some("validation")), "{ambiguous}");
    let (code, missing) = run(&root, &["label", "archive", "nope"]);
    assert_eq!((code, missing["error"]["code"].as_str()), (1, Some("not_found")), "{missing}");

    let (_, task) = run(&root, &["task", "create", "Update portfolio", "--labels", &data_id(&deep)]);
    let (_, unused) = run(&root, &["label", "unused"]);
    let names: Vec<&str> = unused["data"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"quick") && !names.contains(&"deep"), "{names:?}");

    let (code, archived) = run(&root, &["label", "archive", "--unused"]);
    assert_eq!(code, 0, "{archived}");
    assert_eq!(archived["data"].as_array().unwrap().len(), 3, "quick, Comms, comms");
    let (code, restored) = run(&root, &["label", "restore", "quick"]);
    assert_eq!(code, 0, "{restored}");
    assert!(restored["data"][0]["archived_at"].is_null());

    let (_, done) = run(&root, &["task", "create", "Old portfolio draft"]);
    let (code, c) = run(&root, &["task", "complete", &data_id(&done)]);
    assert_eq!(code, 0, "{c}");
    let (code, hits) = run(&root, &["task", "search", "portf"]);
    assert_eq!(code, 0, "{hits}");
    let titles: Vec<&str> = hits["data"].as_array().unwrap().iter().map(|h| h["task"]["content"].as_str().unwrap()).collect();
    assert_eq!(titles, ["Update portfolio", "Old portfolio draft"], "open first, completed included");
    let (_, completed) = run(&root, &["task", "search", "portfolio", "--status", "completed"]);
    assert_eq!(completed["data"].as_array().unwrap().len(), 1);
    let (_, by_label) = run(&root, &["task", "search", "portfolio", "--label", "DEEP"]);
    assert_eq!(by_label["data"][0]["task"]["id"], data_id(&task).as_str());
    let (code, reindexed) = run(&root, &["task", "search", "--reindex"]);
    assert_eq!(code, 0, "{reindexed}");
    assert_eq!(reindexed["data"]["reindexed"], 2);
    let (code, bad) = run(&root, &["task", "search"]);
    assert_eq!((code, bad["error"]["code"].as_str()), (2, Some("validation")));
}

#[tokio::test]
async fn seed_script_is_idempotent_and_keeps_taxonomy_labels_visible() {
    let root = fixture().await;
    for name in ["deep", "quick", "comms", "from-instinct", "stale-idea"] {
        run(&root, &["label", "create", name]);
    }
    let (_, deep) = run(&root, &["label", "list"]);
    let deep_id = deep["data"].as_array().unwrap().iter().find(|l| l["name"] == "deep").unwrap()["id"].as_str().unwrap().to_string();
    run(&root, &["task", "create", "Focus block", "--labels", &deep_id]);

    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/seed-label-groups.sh");
    for pass in 0..2 {
        let out = Command::new("bash")
            .arg(script)
            .args(["--profile", root.to_str().unwrap()])
            .env("DT", env!("CARGO_BIN_EXE_dt"))
            .env("SKIP_BACKUP", "1")
            .output()
            .unwrap();
        assert!(out.status.success(), "pass {pass}: {}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    }
    let (_, groups) = run(&root, &["label", "group", "list"]);
    let groups = groups["data"].as_array().unwrap();
    let names: Vec<&str> = groups.iter().map(|g| g["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["EFFORT", "TYPE", "STATE", "ASSIST", "SYSTEM"]);
    assert_eq!(groups[0]["exclusive"], true);
    assert_eq!(groups[4]["system"], true);
    let (_, labels) = run(&root, &["label", "list"]);
    let archived: Vec<&str> = labels["data"].as_array().unwrap().iter()
        .filter(|l| !l["archived_at"].is_null()).map(|l| l["name"].as_str().unwrap()).collect();
    assert_eq!(archived, ["stale-idea"], "taxonomy labels stay visible even with no open tasks");
}
```

Run: `cargo test --workspace --offline -p nimble-cli --test contracts label_groups_archive seed_script`
Expected: FAIL (`label group` is not a recognized subcommand → exit 2 on the first assertion).

- [ ] **Step 2: CLI arguments**

In `tools/dt/src/args.rs`, add to `enum Task` (after `Labels { … }`):

```rust
    /// Full-text search over titles and descriptions: open tasks first,
    /// completed included. Reads this Mac's device-local index.
    Search {
        query: Option<String>,
        #[arg(long, value_parser = ["all", "open", "completed"], default_value = "all")]
        status: String,
        /// Label name or id; repeat for any-of.
        #[arg(long)]
        label: Vec<String>,
        /// Project name or id.
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 50, value_parser = clap::value_parser!(i64).range(1..=200))]
        limit: i64,
        /// Rebuild the search index first (alone, when no query is given).
        #[arg(long)]
        reindex: bool,
    },
```

Add to `enum Label` (after `Delete { … }`):

```rust
    /// Visible labels with no open task (what `archive --unused` archives).
    Unused,
    #[command(subcommand)]
    Group(LabelGroupCommand),
    /// Archive labels (name or id), or every unused label.
    Archive {
        #[arg(required_unless_present = "unused", conflicts_with = "unused")]
        labels: Vec<String>,
        #[arg(long)]
        unused: bool,
    },
    /// Restore archived labels (name or id).
    Restore {
        #[arg(required = true)]
        labels: Vec<String>,
    },
```

and after `enum Label`:

```rust
#[derive(Subcommand, Debug, Clone)]
pub enum LabelGroupCommand {
    List,
    /// Create a group, or reuse the one with this name (case-insensitive).
    Create {
        name: String,
        /// "Pick one": at most one of this group's labels per task (UI-enforced).
        #[arg(long)]
        pick_one: bool,
        /// Integration group: its labels are hidden from pickers and row chips.
        #[arg(long)]
        system: bool,
    },
    /// Put a label (name or id) into a group (name or id).
    Assign { label: String, group: String },
}
```

- [ ] **Step 3: Resolvers and execute arms**

In `tools/dt/src/commands/mod.rs`, extend the core import to `types::{CreateTaskInput, Label as LabelRow, LabelGroup, LabelGroupPatch, TaskSearchFilters, UpdateTaskInput},` (the `args::*` glob already brings the clap `Label` enum, hence the alias), and add after `section_exists`:

```rust
fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Exact id first, then case-insensitive name; two name matches is an error.
fn pick<'a, T>(items: &'a [T], key: &str, id: impl Fn(&T) -> &str, name: impl Fn(&T) -> &str, what: &str) -> Result<&'a T, CliError> {
    if let Some(found) = items.iter().find(|i| id(i) == key) {
        return Ok(found);
    }
    let matches: Vec<&T> = items.iter().filter(|i| same_name(name(i), key)).collect();
    match matches.len() {
        0 => Err(CliError::new("not_found", format!("No {what} named \"{key}\"."))),
        1 => Ok(matches[0]),
        n => Err(CliError::validation(format!("{n} {what}s are named \"{key}\" (ignoring case). Use its id."))),
    }
}

async fn resolve_label(pool: &SqlitePool, key: &str) -> Result<LabelRow, CliError> {
    let labels = db::labels::list_labels(pool).await?;
    pick(&labels, key, |l| l.id.as_str(), |l| l.name.as_str(), "label").cloned()
}

async fn resolve_labels(pool: &SqlitePool, keys: &[String]) -> Result<Vec<String>, CliError> {
    let mut ids = Vec::with_capacity(keys.len());
    for key in keys {
        ids.push(resolve_label(pool, key).await?.id);
    }
    Ok(ids)
}

async fn resolve_group(pool: &SqlitePool, key: &str) -> Result<LabelGroup, CliError> {
    let groups = db::labels::list_label_groups(pool).await?;
    pick(&groups, key, |g| g.id.as_str(), |g| g.name.as_str(), "label group").cloned()
}

async fn resolve_project(pool: &SqlitePool, key: &str) -> Result<String, CliError> {
    let projects = db::projects::get_projects(pool).await?;
    Ok(pick(&projects, key, |p| p.id.as_str(), |p| p.name.as_str(), "project")?.id.clone())
}
```

In `execute`, add to the `Command::Task` match (after the `Task::Labels` arm):

```rust
            Task::Search { query, status, label, project, limit, reindex } => {
                let query = query.unwrap_or_default();
                if query.trim().is_empty() && !reindex {
                    return Err(CliError::validation("Give a search query, or --reindex."));
                }
                let reindexed = if reindex { Some(db::task_search::rebuild_task_index(pool).await?) } else { None };
                if query.trim().is_empty() {
                    return result(json!({ "reindexed": reindexed }), vec![]);
                }
                let filters = TaskSearchFilters {
                    status: Some(status),
                    label_ids: resolve_labels(pool, &label).await?,
                    project_id: match &project { Some(key) => Some(resolve_project(pool, key).await?), None => None },
                };
                result(db::task_search::search_tasks(pool, &query, &filters, limit).await?, vec![])
            }
```

and to the `Command::Label` match (after `Label::Delete`):

```rust
            Label::Unused => {
                let ids = db::labels::unused_label_ids(pool).await?;
                let labels: Vec<LabelRow> = db::labels::list_labels(pool).await?.into_iter().filter(|l| ids.contains(&l.id)).collect();
                result(labels, vec![])
            }
            Label::Group(command) => match command {
                LabelGroupCommand::List => result(db::labels::list_label_groups(pool).await?, vec![]),
                LabelGroupCommand::Create { name, pick_one, system } => {
                    nonempty(&name)?;
                    let existing = db::labels::list_label_groups(pool).await?.into_iter().find(|g| same_name(&g.name, &name));
                    let group = match existing {
                        Some(g) => g,
                        None => db::labels::create_label_group(pool, &name, pick_one).await?,
                    };
                    // Flags only ever switch on, so re-running the seed never undoes a manual change.
                    let patch = LabelGroupPatch {
                        exclusive: (pick_one && !group.exclusive).then_some(true),
                        system: (system && !group.system).then_some(true),
                        ..Default::default()
                    };
                    result(db::labels::update_label_group(pool, &group.id, patch).await?, vec![Domain::Labels])
                }
                LabelGroupCommand::Assign { label, group } => {
                    let label = resolve_label(pool, &label).await?;
                    let group = resolve_group(pool, &group).await?;
                    result(db::labels::set_label_group(pool, &label.id, Some(&group.id)).await?, vec![Domain::Labels])
                }
            },
            Label::Archive { labels, unused } => {
                // Every name resolves before anything is written.
                let ids = if unused { db::labels::unused_label_ids(pool).await? } else { resolve_labels(pool, &labels).await? };
                result(db::labels::archive_labels(pool, &ids).await?, vec![Domain::Labels])
            }
            Label::Restore { labels } => {
                let ids = resolve_labels(pool, &labels).await?;
                result(db::labels::restore_labels(pool, &ids).await?, vec![Domain::Labels])
            }
```

- [ ] **Step 4: The seed script**

Create `tools/seed-label-groups.sh` and `chmod +x` it:

```bash
#!/usr/bin/env bash
# Seed Marco's C4 label taxonomy (spec 2026-09-25-c4-labels-search-design.md §0, decision 1).
# One-time, post-install, only with Marco's OK. Never run by a migration or on another profile.
# Idempotent: groups are reused by name, re-assigning is a no-op, archived labels stay archived.
#
#   tools/seed-label-groups.sh                                    # live profile; Nimble must be running (backs up first)
#   SKIP_BACKUP=1 tools/seed-label-groups.sh --profile <synthetic-profile-dir>   # rehearsal
#
# Extra arguments are passed to every dt call as global flags. Needs jq (macOS ships /usr/bin/jq).
set -euo pipefail

DT=${DT:-dt}
EXTRA=("$@")
# ${EXTRA[@]+...}: an empty array under `set -u` is an error in macOS's bash 3.2.
dtj() { "$DT" --json ${EXTRA[@]+"${EXTRA[@]}"} "$@"; }

EFFORT=(deep quick)
TYPE=(comms admin errands photography health)
STATE=(waiting avoidance)
ASSIST=(needs-claude)
SYSTEM=(from-instinct nimble)
KEEP_VISIBLE=("${EFFORT[@]}" "${TYPE[@]}" "${STATE[@]}" "${ASSIST[@]}" "${SYSTEM[@]}")

summary() {
  dtj label list | jq -r '.data | "  labels \(length) · archived \([.[] | select(.archived_at != null)] | length) · grouped \([.[] | select(.group != null)] | length)"'
  dtj label group list | jq -r '.data[] | "  group \(.name)\(if .exclusive then " · pick one" else "" end)\(if .system then " · system" else "" end)"'
}

group() { dtj label group create "$@" | jq -e '.ok' >/dev/null; }

assign() {
  local target=$1 label out
  shift
  for label in "$@"; do
    if out=$(dtj label group assign "$label" "$target"); then
      echo "  $label → $target"
    else
      echo "  skipped $label: $(echo "$out" | jq -r '.error.message')"
    fi
  done
}

echo "Before:"
summary

if [ -z "${SKIP_BACKUP:-}" ]; then
  echo "Backing up first (Nimble must be running)…"
  dtj backup now | jq -e '.ok' >/dev/null || { echo "Backup failed. Nothing was changed." >&2; exit 1; }
fi

group EFFORT --pick-one
group TYPE
group STATE
group ASSIST
group SYSTEM --system
assign EFFORT "${EFFORT[@]}"
assign TYPE "${TYPE[@]}"
assign STATE "${STATE[@]}"
assign ASSIST "${ASSIST[@]}"
assign SYSTEM "${SYSTEM[@]}"

echo "Archiving labels with no open tasks (taxonomy labels stay visible)…"
keep_json=$(printf '%s\n' "${KEEP_VISIBLE[@]}" | jq -R 'ascii_downcase' | jq -s .)
to_archive=$(dtj label unused | jq -r --argjson keep "$keep_json" \
  '.data[] | select((.name | ascii_downcase) as $n | ($keep | index($n)) == null) | .id')
if [ -n "$to_archive" ]; then
  # Word splitting is intended: one id per argument.
  # shellcheck disable=SC2086
  dtj label archive $to_archive | jq -r '.data | "  archived \(length)"'
else
  echo "  nothing to archive"
fi

echo "After:"
summary
```

> **UX checkpoint:** Decision 1 puts `admin`, `errands`, `photography`, `health` in TYPE, but the live DB (spec §0) shows them on **no** open task, while "the 25 labels with no open tasks are archived" would archive them too — the two statements conflict. Options: (a) keep every taxonomy label visible and archive only the rest (≈21 archived) — the script's default via `KEEP_VISIBLE`; (b) archive them too (TYPE shows only `comms` until restored); (c) drop them from TYPE and archive them. **Recommended: (a)** — the taxonomy stays readable for new tasks. Ask Marco before the script is run on the live profile; for (b) empty `KEEP_VISIBLE` of the four names.

- [ ] **Step 5: Run the contract tests**

Run: `cargo test --workspace --offline -p nimble-cli`
Expected: PASS (existing contracts + the two new tests).

- [ ] **Step 6: Commit**

```bash
git add tools/dt tools/seed-label-groups.sh
git commit -m "feat(c4): dt label groups/archive/restore/unused, dt task search, seed script

Names resolve by id then case-insensitive name (ambiguity is an error).
group create is idempotent; seed-label-groups.sh backs up, seeds decision 1,
archives unused non-taxonomy labels and prints before/after counts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 6: Grouped LabelPicker ("Pick one" radios), row chips, detail muted system labels, grouped label filter

**Files:**
- Create: `apps/desktop/src/lib/labelTaxonomy.ts`, `apps/desktop/tests/labelTaxonomy.test.mjs`, `apps/desktop/src/hooks/useLabelTaxonomy.ts`
- Modify: `apps/desktop/src/components/tasks/LabelPicker.tsx` (list extracted to `LabelPickerList`, grouped + radios + restore)
- Modify: `apps/desktop/src/components/tasks/MetadataChips.tsx:34-45` (`labels: Label[]`), `:303-371` (`LabelsChips`)
- Modify: `apps/desktop/src/components/tasks/LocalTaskRow.tsx:11-86` (cache moves into the hook), `:146-154`
- Modify: `apps/desktop/src/components/tasks/TaskListHeader.tsx` (grouped label sections)
- Modify: `apps/desktop/src/lib/shortcuts.ts`, `apps/desktop/tests/shortcuts.test.mjs`

**Interfaces:**
- Consumes (Tasks 1–2): `Label.archived_at`, `LabelGroup`, `dp.labels.groups.list`, `dp.labels.restore`, `dp.labels.create`.
- Produces:
  - `lib/labelTaxonomy.ts`: `interface LabelSection { group: LabelGroup | null; labels: Label[] }`; `interface ManagerModel { groups: LabelSection[]; ungrouped: Label[]; system: LabelSection[]; archived: Label[] }`; `groupOf(label, groupsById): LabelGroup | null`; `pickerSections(labels, groups): LabelSection[]`; `filterSections(labels, groups): LabelSection[]`; `isFlat(sections): boolean`; `managerSections(labels, groups, hiddenGroupIds?: ReadonlySet<string>): ManagerModel`; `orderTaskLabels(labelIds, labels, groups): Label[]`; `systemTaskLabels(labelIds, labels, groups): Label[]`; `toggleLabel(selected, labelId, labels, groups): string[]`; `type CreateAction = { kind: 'none' } | { kind: 'apply'; label: Label } | { kind: 'restore'; label: Label } | { kind: 'create'; name: string }`; `pickerCreateAction(query, labels, groups): CreateAction`.
  - `hooks/useLabelTaxonomy.ts`: `useLabelTaxonomy(): { labels: Label[]; groups: LabelGroup[]; loading: boolean; reload(): void }`; `fetchLabelTaxonomy(force?: boolean): Promise<{ labels: Label[]; groups: LabelGroup[] }>`.
  - `LabelPicker.tsx`: `type LabelPickerMode = 'edit' | 'filter'`; `LabelPickerList({ value, onChange, mode? })` (Task 8 uses `mode="filter"`); `LabelPicker` props unchanged.
  - Picker DOM contract (e2e relies on it): each row is a `<label>` wrapping `button[role=checkbox|radio][aria-checked][data-label-control]`; exclusive groups render `role="radiogroup"`, others `role="group"`, both `aria-labelledby` their header; the trigger keeps `aria-label="Add label"`.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/desktop/tests/labelTaxonomy.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  pickerSections, filterSections, managerSections, orderTaskLabels, systemTaskLabels,
  toggleLabel, pickerCreateAction, isFlat,
} from '../src/lib/labelTaxonomy.ts'

const g = (id, name, position, extra = {}) => ({
  id, name, position, exclusive: false, system: false,
  created_at: '2026-09-25 09:00:00', updated_at: '2026-09-25 09:00:00', ...extra,
})
const l = (id, position, group = null, archived_at = null) => ({
  id, name: id, color: 'gray', position, group, archived_at, created_at: '2026-09-25 09:00:00',
})

const groups = [g('type', 'TYPE', 1), g('effort', 'EFFORT', 0, { exclusive: true }), g('sys', 'SYSTEM', 2, { system: true })]
const labels = [
  l('comms', 0, 'type'), l('quick', 1, 'effort'), l('deep', 0, 'effort'),
  l('loose', 5), l('old', 6, null, '2026-09-01 10:00:00'), l('nimble', 7, 'sys'), l('orphan', 8, 'deleted-group'),
]
const shape = (sections) => sections.map((s) => [s.group?.name ?? null, s.labels.map((x) => x.id)])

test('picker: groups by position, then Ungrouped; no system, archived or empty sections', () => {
  assert.deepEqual(shape(pickerSections(labels, groups)), [
    ['EFFORT', ['deep', 'quick']], ['TYPE', ['comms']], [null, ['loose', 'orphan']],
  ])
})

test('dangling group id reads as ungrouped', () => {
  assert.ok(pickerSections(labels, groups).at(-1).labels.some((x) => x.id === 'orphan'))
  assert.ok(managerSections(labels, groups).ungrouped.some((x) => x.id === 'orphan'))
})

test('filter: system group listed last; archived never listed', () => {
  assert.deepEqual(shape(filterSections(labels, groups)).map(([name]) => name), ['EFFORT', 'TYPE', null, 'SYSTEM'])
  assert.ok(!filterSections(labels, groups).flatMap((s) => s.labels).some((x) => x.id === 'old'))
})

test('no groups at all renders flat (a new profile)', () => {
  assert.equal(isFlat(pickerSections([l('a', 0), l('b', 1)], [])), true)
  assert.equal(isFlat(pickerSections(labels, groups)), false)
})

test('manager: empty groups kept; system and archived buckets; a pending-delete group reads as ungrouped', () => {
  const m = managerSections(labels, [...groups, g('empty', 'EMPTY', 3)], new Set(['type']))
  assert.deepEqual(m.groups.map((s) => s.group.name), ['EFFORT', 'EMPTY'])
  assert.deepEqual(m.ungrouped.map((x) => x.id), ['comms', 'loose', 'orphan'])
  assert.deepEqual(m.system.map((s) => s.labels.map((x) => x.id)), [['nimble']])
  assert.deepEqual(m.archived.map((x) => x.id), ['old'])
})

test('row chips: taxonomy order, system hidden, archived kept; detail lists system separately', () => {
  assert.deepEqual(orderTaskLabels(['loose', 'nimble', 'comms', 'old', 'deep'], labels, groups).map((x) => x.id), ['deep', 'comms', 'loose', 'old'])
  assert.deepEqual(systemTaskLabels(['loose', 'nimble'], labels, groups).map((x) => x.id), ['nimble'])
})

test('Pick one: applying swaps the group sibling; multi groups add; hidden labels are kept', () => {
  assert.deepEqual(toggleLabel(['deep', 'nimble', 'comms'], 'quick', labels, groups), ['nimble', 'comms', 'quick'])
  assert.deepEqual(toggleLabel(['deep'], 'comms', labels, groups), ['deep', 'comms'])
  assert.deepEqual(toggleLabel(['deep', 'quick'], 'deep', labels, groups), ['quick'], 'toggling off leaves a sync-delivered sibling alone')
})

test('create action: apply a visible match, restore an archived one, create new, never a system name', () => {
  assert.equal(pickerCreateAction('  ', labels, groups).kind, 'none')
  assert.deepEqual(pickerCreateAction('DEEP', labels, groups), { kind: 'apply', label: labels[2] })
  assert.deepEqual(pickerCreateAction('Old', labels, groups), { kind: 'restore', label: labels[4] })
  assert.deepEqual(pickerCreateAction('brand new', labels, groups), { kind: 'create', name: 'brand new' })
  assert.equal(pickerCreateAction('nimble', labels, groups).kind, 'none')
})
```

Run: `cd apps/desktop && node --test tests/labelTaxonomy.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `lib/labelTaxonomy.ts`**

```ts
/* Label taxonomy (C4): grouped ordering, "Pick one", system and archived
   visibility, the picker's create/restore action. Pure; node tests import
   it (tests/labelTaxonomy.test.mjs), so type-only imports and no `@/`. */
import type { Label, LabelGroup } from '@nimble/types'

export interface LabelSection {
  /** null = Ungrouped. */
  group: LabelGroup | null
  labels: Label[]
}

export interface ManagerModel {
  /** Regular groups by position, empty ones included (drop targets). */
  groups: LabelSection[]
  ungrouped: Label[]
  /** System groups by position, empty ones included. */
  system: LabelSection[]
  archived: Label[]
}

type Ordered = { position: number; created_at: string }
const byPosition = (a: Ordered, b: Ordered) => a.position - b.position || a.created_at.localeCompare(b.created_at)

function indexGroups(groups: LabelGroup[], hidden: ReadonlySet<string> = new Set()): Map<string, LabelGroup> {
  return new Map(groups.filter((g) => !hidden.has(g.id)).map((g) => [g.id, g]))
}

/** The label's group; null when ungrouped or when its group id dangles. */
export function groupOf(label: Label, groupsById: ReadonlyMap<string, LabelGroup>): LabelGroup | null {
  return label.group ? groupsById.get(label.group) ?? null : null
}

function sections(labels: Label[], groups: LabelGroup[], includeSystem: boolean): LabelSection[] {
  const byId = indexGroups(groups)
  const visible = labels.filter((l) => !l.archived_at).sort(byPosition)
  const ordered = [...byId.values()].sort(byPosition)
  const of = (group: LabelGroup): LabelSection => ({ group, labels: visible.filter((l) => l.group === group.id) })
  return [
    ...ordered.filter((g) => !g.system).map(of),
    { group: null, labels: visible.filter((l) => groupOf(l, byId) === null) },
    ...(includeSystem ? ordered.filter((g) => g.system).map(of) : []),
  ].filter((s) => s.labels.length > 0)
}

/** Picker: regular groups, then Ungrouped. No system, archived or empty sections. */
export function pickerSections(labels: Label[], groups: LabelGroup[]): LabelSection[] {
  return sections(labels, groups, false)
}

/** Label filter: like the picker, plus system groups last. */
export function filterSections(labels: Label[], groups: LabelGroup[]): LabelSection[] {
  return sections(labels, groups, true)
}

/** Only the Ungrouped bucket (e.g. a profile with no groups): render without headers. */
export function isFlat(list: LabelSection[]): boolean {
  return list.length <= 1 && (list[0]?.group ?? null) === null
}

export function managerSections(labels: Label[], groups: LabelGroup[], hiddenGroupIds: ReadonlySet<string> = new Set()): ManagerModel {
  const byId = indexGroups(groups, hiddenGroupIds)
  const sorted = [...labels].sort(byPosition)
  const live = sorted.filter((l) => !l.archived_at)
  const ordered = [...byId.values()].sort(byPosition)
  const of = (group: LabelGroup): LabelSection => ({ group, labels: live.filter((l) => l.group === group.id) })
  return {
    groups: ordered.filter((g) => !g.system).map(of),
    ungrouped: live.filter((l) => groupOf(l, byId) === null),
    system: ordered.filter((g) => g.system).map(of),
    archived: sorted.filter((l) => l.archived_at),
  }
}

/** Row chips: the task's labels in taxonomy order (group position, then
 *  label position, ungrouped last), system hidden, archived kept. */
export function orderTaskLabels(labelIds: readonly string[], labels: Label[], groups: LabelGroup[]): Label[] {
  const byId = indexGroups(groups)
  const rank = new Map<string, number>()
  ;[...byId.values()].filter((g) => !g.system).sort(byPosition).forEach((g, i) => rank.set(g.id, i))
  const rankOf = (l: Label) => {
    const group = groupOf(l, byId)
    return group ? rank.get(group.id) ?? rank.size : rank.size
  }
  return labels
    .filter((l) => labelIds.includes(l.id) && !groupOf(l, byId)?.system)
    .sort((a, b) => rankOf(a) - rankOf(b) || byPosition(a, b))
}

/** The task's system-group labels (task detail shows them muted, read-only). */
export function systemTaskLabels(labelIds: readonly string[], labels: Label[], groups: LabelGroup[]): Label[] {
  const byId = indexGroups(groups)
  return labels.filter((l) => labelIds.includes(l.id) && !!groupOf(l, byId)?.system).sort(byPosition)
}

/** Toggle one label, honouring "Pick one": applying a label of an exclusive
 *  group removes that group's other labels. Ids the picker doesn't show
 *  (system, archived) are always kept. */
export function toggleLabel(selected: readonly string[], labelId: string, labels: Label[], groups: LabelGroup[]): string[] {
  if (selected.includes(labelId)) return selected.filter((id) => id !== labelId)
  const label = labels.find((l) => l.id === labelId)
  const group = label ? groupOf(label, indexGroups(groups)) : null
  if (!group?.exclusive) return [...selected, labelId]
  const siblings = new Set(labels.filter((l) => l.group === group.id).map((l) => l.id))
  return [...selected.filter((id) => !siblings.has(id)), labelId]
}

export type CreateAction =
  | { kind: 'none' }
  | { kind: 'apply'; label: Label }
  | { kind: 'restore'; label: Label }
  | { kind: 'create'; name: string }

/** What Enter (and the list's last row) does with the typed text: apply an
 *  exact, case-insensitive visible match; restore an archived match (creating
 *  it would hit labels.name UNIQUE); create a new ungrouped label. A system
 *  label's name offers nothing — system labels stay out of the picker. */
export function pickerCreateAction(query: string, labels: Label[], groups: LabelGroup[]): CreateAction {
  const name = query.trim()
  if (!name) return { kind: 'none' }
  const match = labels.find((l) => l.name.toLowerCase() === name.toLowerCase())
  if (!match) return { kind: 'create', name }
  if (groupOf(match, indexGroups(groups))?.system) return { kind: 'none' }
  return match.archived_at ? { kind: 'restore', label: match } : { kind: 'apply', label: match }
}
```

Run: `cd apps/desktop && node --test tests/labelTaxonomy.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 3: One shared taxonomy hook**

Create `apps/desktop/src/hooks/useLabelTaxonomy.ts` (this replaces the module cache in `LocalTaskRow.tsx`):

```ts
import { useCallback, useEffect, useState } from 'react'
import type { Label, LabelGroup } from '@nimble/types'
import { getDataProvider } from '@/services/provider-context'
import { subscribeDataChanges } from '@/lib/dataChanges'

export interface LabelTaxonomy {
  labels: Label[]
  groups: LabelGroup[]
}

// One module-level cache for every row, picker, filter and the Label
// Manager: N visible rows must not each fetch the label table. Invalidated
// by `tasks-changed` (labels can be created inline) and the `labels` data
// domain (another window, `dt`, a sync). `generation` drops a slower,
// older fetch that resolves after a newer one.
let cache: LabelTaxonomy | null = null
let inflight: Promise<LabelTaxonomy> | null = null
let generation = 0
const subscribers = new Set<(t: LabelTaxonomy) => void>()

export function fetchLabelTaxonomy(force = false): Promise<LabelTaxonomy> {
  if (force) {
    cache = null
    inflight = null
  }
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    const mine = ++generation
    // Resolve the provider at call time, never at module eval.
    const dp = getDataProvider()
    inflight = Promise.all([dp.labels.list(), dp.labels.groups.list().catch(() => [] as LabelGroup[])])
      .then(([labels, groups]) => {
        if (mine !== generation) return cache ?? { labels, groups }
        cache = { labels, groups }
        for (const notify of subscribers) notify(cache)
        return cache
      })
      .catch((e: unknown) => {
        if (mine === generation) inflight = null
        throw e
      })
  }
  return inflight
}

if (typeof window !== 'undefined') {
  const refresh = () => { fetchLabelTaxonomy(true).catch(() => {}) }
  window.addEventListener('tasks-changed', refresh)
  subscribeDataChanges('labels', refresh)
}

export function useLabelTaxonomy(): LabelTaxonomy & { loading: boolean; reload: () => void } {
  const [state, setState] = useState<LabelTaxonomy>(() => cache ?? { labels: [], groups: [] })
  const [loading, setLoading] = useState(cache === null)
  useEffect(() => {
    let live = true
    const onChange = (t: LabelTaxonomy) => {
      if (!live) return
      setState(t)
      setLoading(false)
    }
    subscribers.add(onChange)
    fetchLabelTaxonomy().then(onChange, () => { if (live) setLoading(false) })
    return () => {
      live = false
      subscribers.delete(onChange)
    }
  }, [])
  const reload = useCallback(() => { fetchLabelTaxonomy(true).catch(() => {}) }, [])
  return { ...state, loading, reload }
}
```

- [ ] **Step 4: Grouped `LabelPicker`**

Replace everything in `apps/desktop/src/components/tasks/LabelPicker.tsx` below `LabelChip` (keep `LabelChip` byte-for-byte) and update the imports:

```tsx
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import type { Label } from '@nimble/types'
import { cn } from '@/lib/utils'
import { labelColor, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { filterSections, isFlat, orderTaskLabels, pickerCreateAction, pickerSections, toggleLabel } from '@/lib/labelTaxonomy'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Caption } from '@/components/shared/typography'
```

```tsx
/** A row is a <label> (whole row clickable, and the existing e2e selectors
 *  keep working) around a real role=checkbox / role=radio button, so Space
 *  and Enter toggle natively. The explicit aria-label names the control for
 *  every AT and axe (implicit <label> naming of a <button> is unreliable). */
function LabelOption({ label, checked, radio, onToggle }: { label: Label; checked: boolean; radio: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover has-[:focus-visible]:bg-hover">
      <button
        type="button"
        role={radio ? 'radio' : 'checkbox'}
        aria-checked={checked}
        aria-label={label.name}
        data-label-control=""
        onClick={onToggle}
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center border border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          radio ? 'rounded-full' : 'rounded-[4px]',
          checked && 'border-transparent bg-primary text-primary-foreground',
        )}
      >
        {checked && (radio
          ? <span className="size-1.5 rounded-full bg-current" />
          : <Check className="size-2.5" strokeWidth={3} aria-hidden />)}
      </button>
      <span className="size-2 shrink-0 rounded-full" style={{ background: labelColor(label.color) }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-body">{label.name}</span>
    </label>
  )
}

export type LabelPickerMode = 'edit' | 'filter'

/** The searchable, grouped list. `edit` honours "Pick one" (radios) and can
 *  create or restore; `filter` is plain any-of and lists system labels last. */
export function LabelPickerList({ value, onChange, mode = 'edit' }: { value: string[]; onChange: (ids: string[]) => void; mode?: LabelPickerMode }) {
  const dp = useDataProvider()
  const { labels, groups, loading, reload } = useLabelTaxonomy()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  const all = useMemo(() => (mode === 'filter' ? filterSections(labels, groups) : pickerSections(labels, groups)), [mode, labels, groups])
  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q ? all.map((s) => ({ ...s, labels: s.labels.filter((l) => l.name.toLowerCase().includes(q)) })).filter((s) => s.labels.length > 0) : all),
    [all, q],
  )
  const action = mode === 'edit' ? pickerCreateAction(query, labels, groups) : ({ kind: 'none' } as const)
  const flat = isFlat(shown)

  const toggle = (id: string) => {
    if (mode === 'filter') onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
    else onChange(toggleLabel(value, id, labels, groups))
  }

  const runAction = async () => {
    if (busy || action.kind === 'none') return
    if (action.kind === 'apply') {
      if (!value.includes(action.label.id)) toggle(action.label.id)
      setQuery('')
      return
    }
    setBusy(true)
    try {
      if (action.kind === 'restore') {
        await dp.labels.restore([action.label.id])
        onChange(toggleLabel(value, action.label.id, labels, groups))
      } else {
        const created = await dp.labels.create(action.name, DEFAULT_LABEL_COLOR)
        onChange([...value, created.id])
      }
      reload()
      setQuery('')
    } catch (e) {
      toast.error(`Couldn't save the label: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  // ↑/↓ move through every row across sections; ↑ from the first row returns to the field.
  const moveFocus = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const controls = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-label-control]') ?? [])
    if (controls.length === 0) return
    e.preventDefault()
    const at = controls.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') (controls[at + 1] ?? controls[controls.length - 1]).focus()
    else if (at <= 0) inputRef.current?.focus()
    else controls[at - 1].focus()
  }

  return (
    <div className="flex flex-col gap-1.5" onKeyDown={moveFocus}>
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (action.kind !== 'none') { void runAction(); return }
          const only = shown.flatMap((s) => s.labels)
          if (only.length === 1) toggle(only[0].id)
        }}
        placeholder={mode === 'filter' ? 'Filter labels…' : 'Search or create…'}
        aria-label={mode === 'filter' ? 'Filter labels' : 'Search or create a label'}
        className="h-7 text-meta"
        autoFocus
      />
      <div ref={listRef} className="max-h-64 space-y-1 overflow-y-auto">
        {loading && labels.length === 0 && (
          <div className="space-y-1.5 px-1.5 py-1" aria-hidden>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {shown.map((section) => {
          const headerId = `${baseId}-${section.group?.id ?? 'ungrouped'}`
          const radio = mode === 'edit' && !!section.group?.exclusive
          return (
            <div
              key={section.group?.id ?? 'ungrouped'}
              role={radio ? 'radiogroup' : 'group'}
              aria-labelledby={flat ? undefined : headerId}
              aria-label={flat ? 'Labels' : undefined}
            >
              {!flat && (
                <Caption as="div" id={headerId} className="px-1.5 pt-1 pb-0.5">
                  {section.group?.name ?? 'Ungrouped'}
                </Caption>
              )}
              {section.labels.map((label) => (
                <LabelOption key={label.id} label={label} checked={value.includes(label.id)} radio={radio} onToggle={() => toggle(label.id)} />
              ))}
            </div>
          )
        })}
        {!loading && all.length === 0 && !q && (
          <p className="px-1.5 py-1 text-label text-muted-foreground">No labels yet.</p>
        )}
        {(action.kind === 'create' || action.kind === 'restore') && (
          <button
            type="button"
            data-label-control=""
            onClick={() => void runAction()}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-body text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:bg-hover disabled:opacity-50"
          >
            {action.kind === 'restore' ? <RotateCcw className="size-3" aria-hidden /> : <Plus className="size-3" aria-hidden />}
            {action.kind === 'restore' ? `Restore "${action.label.name}"` : `Create "${action.name}"`}
          </button>
        )}
      </div>
    </div>
  )
}

interface LabelPickerProps {
  value: string[]
  onChange: (labelIds: string[]) => void
  /** Controlled state of the "Add label" list. Omit both to let the picker own it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function LabelPicker({ value, onChange, open: openProp, onOpenChange }: LabelPickerProps) {
  const { labels, groups } = useLabelTaxonomy()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  // Chips: taxonomy order; system labels stay hidden (they are kept in `value`).
  const selectedLabels = useMemo(() => orderTaskLabels(value, labels, groups), [value, labels, groups])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedLabels.map((label) => (
        <LabelChip key={label.id} label={label} onRemove={() => onChange(value.filter((v) => v !== label.id))} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/60 px-2 py-0.5 text-meta text-muted-foreground hover:border-border hover:text-foreground transition-colors"
          aria-label="Add label"
        >
          <Plus className="size-3" />
          Label
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" sideOffset={4} className="w-60 gap-1.5 p-1.5">
          <LabelPickerList value={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
```

- [ ] **Step 5: Row chips and task detail**

`LocalTaskRow.tsx`: delete the whole `// ── Labels cache ──` block through the end of `useLabelsMap` (lines 11–86), drop the now-unused `getDataProvider` import, add `import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'` and `import { orderTaskLabels } from '@/lib/labelTaxonomy'`, and replace the `labelsMap`/`taskLabels` block with:

```tsx
  const { labels, groups } = useLabelTaxonomy()
  const taskLabels = useMemo(
    () => orderTaskLabels(task.labels, labels, groups).map((l) => ({ name: l.name, color: labelColor(l.color) })),
    [task.labels, labels, groups],
  )
```

(Remove `Label` from the `@nimble/types` import if it is now unused.)

`MetadataChips.tsx`: add `Label` to the `@nimble/types` import, `import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'`, `import { orderTaskLabels, systemTaskLabels } from '@/lib/labelTaxonomy'`, `import { Meta } from '@/components/shared/typography'`; change `MetadataChipsProps.labels` to `labels: Label[]`; in `LabelsChips` change the `labels` prop type to `Label[]` and replace its `selected` memo with:

```tsx
  const { groups } = useLabelTaxonomy()
  const selected = useMemo(() => orderTaskLabels(labelIds, labels, groups), [labelIds, labels, groups])
  // System labels (integrations) are read-only here: muted text, not chips.
  const system = useMemo(() => systemTaskLabels(labelIds, labels, groups), [labelIds, labels, groups])
```

and replace its `return (…)` with (the popover is the existing one, byte-for-byte, now inside a fragment followed by the muted system names):

```tsx
  return (
    <>
      <LabelsPopover
        value={labelIds}
        onChange={onChange}
        open={open}
        onOpenChange={setOpen}
        triggerProps={{
          className: 'inline-flex items-center gap-1.5',
          nativeButton: false,
          render: <div className="inline-flex items-center gap-1.5" tabIndex={-1} />,
        }}
      >
        {/* Real <button>s, not <div>s — see the Due chip's comment above:
            display:contents trigger wrappers drop non-button children from
            the tab order entirely. */}
        {selected.length === 0 ? (
          <button type="button" tabIndex={0} className={CHIP_EMPTY}>
            Labels
          </button>
        ) : (
          selected.map((label) => (
            <FilledChip
              key={label.id}
              clear={<ClearButton onClear={() => onChange(labelIds.filter((id) => id !== label.id))} label={`Remove ${label.name}`} />}
            >
              <button type="button" tabIndex={0} className={CHIP_FILLED}>
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: labelColor(label.color) }} />
                {label.name}
              </button>
            </FilledChip>
          ))
        )}
      </LabelsPopover>
      {system.length > 0 && (
        <Meta className="inline-flex items-center" title="Added by an integration">
          {system.map((l) => l.name).join(' · ')}
        </Meta>
      )}
    </>
  )
```

- [ ] **Step 6: Grouped label filter**

`TaskListHeader.tsx`: change the `labels` prop type to `labels: Label[]` (add `import type { Label } from '@nimble/types'`), and add `import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'` plus `import { filterSections, isFlat } from '@/lib/labelTaxonomy'`. In the component body, after `const nimbleLabel = …`:

```tsx
  const { groups } = useLabelTaxonomy()
  // Callers pass the labels used in this list; archived ones drop out here.
  const labelSections = filterSections(labels, groups)
  const flatLabels = isFlat(labelSections)
```

Replace the whole `{labels.length > 0 && ( … )}` block (from that line through its closing `)}` before `{activeCount > 0 && (`) with:

```tsx
              {labelSections.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      Label
                      {activeLabelCount > 0 && (
                        <span className="ml-1 text-muted-foreground/70">({activeLabelCount})</span>
                      )}
                    </DropdownMenuLabel>

                    {/* Shortcuts against the auto-applied `nimble` label —
                        replace the whole label predicate rather than merge
                        with the per-label toggles below. */}
                    {nimbleLabel && (
                      <>
                        <DropdownMenuItem
                          onClick={() => onFilter({ ...filter, labelFilter: { include: [nimbleLabel.id], exclude: [] } })}
                        >
                          Made in Nimble
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onFilter({ ...filter, labelFilter: { include: [], exclude: [nimbleLabel.id] } })}
                        >
                          From Todoist
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuGroup>

                  {/* One group per taxonomy section; system groups come last. */}
                  {labelSections.map((section) => (
                    <DropdownMenuGroup key={section.group?.id ?? 'ungrouped'}>
                      {!flatLabels && (
                        <DropdownMenuLabel className="text-label">{section.group?.name ?? 'Ungrouped'}</DropdownMenuLabel>
                      )}
                      {section.labels.map((l) => {
                        const included = filter.labelFilter.include.includes(l.id)
                        const excluded = filter.labelFilter.exclude.includes(l.id)
                        return (
                          <DropdownMenuItem
                            key={l.id}
                            closeOnClick={false}
                            onClick={() => cycleLabel(l.id)}
                            className={cn(excluded && 'opacity-50')}
                          >
                            <span className="size-2 shrink-0 rounded-full" style={{ background: labelColor(l.color) }} />
                            <span className="flex-1 min-w-0 truncate">{l.name}</span>
                            {(included || excluded) && (
                              <DropdownMenuShortcut>{included ? 'Only' : 'Hide'}</DropdownMenuShortcut>
                            )}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                  ))}
                </>
              )}
```

(The trailing `DropdownMenuSeparator` that used to follow the nimble shortcuts is gone: section headers now separate the groups.)

- [ ] **Step 7: Shortcut rows (append-only)**

`lib/shortcuts.ts`: add `| 'Labels'` to `ShortcutSection`, append `'Labels'` to the end of `SHORTCUT_SECTIONS`, and append at the end of `SHORTCUTS`:

```ts
  // ── C4: label picker (components/tasks/LabelPicker.tsx) ──
  { section: 'Labels', keys: '↑ / ↓', label: 'Move through labels in the picker, across groups' },
  { section: 'Labels', keys: 'Space / Enter', label: 'Toggle the focused label ("Pick one" groups swap)' },
```

`tests/shortcuts.test.mjs`: change the `deepEqual(SHORTCUT_SECTIONS, …)` list to end `…, 'Today', 'Capture', 'Labels']`; in the "Capture section is appended last" test replace its first assertion with `assert.ok(SHORTCUT_SECTIONS.indexOf('Capture') > SHORTCUT_SECTIONS.indexOf('Today'), 'Capture follows Today')` (and rename the test "Capture section lists routes, ⌫ and ⌘Z"); append:

```js
test('Labels section (C4) lists the picker keys', () => {
  const keys = SHORTCUTS.filter((s) => s.section === 'Labels').map((s) => s.keys)
  for (const k of ['↑ / ↓', 'Space / Enter']) assert.ok(keys.includes(k), `missing Labels ${k}`)
})
```

- [ ] **Step 8: Verify**

Run: `cd apps/desktop && node --test tests/labelTaxonomy.test.mjs tests/shortcuts.test.mjs src/lib/labelFilter.test.mjs && npm run build && npm run build:web && npx eslint src 2>&1 | tail -2`
Expected: tests pass, builds succeed, lint problem count ≤ the count recorded before this task.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src apps/desktop/tests
git commit -m "feat(c4): grouped label picker with Pick-one radios, ordered chips, grouped filter

labelTaxonomy helpers (tested), one shared labels+groups cache, picker
sections with radiogroups and cross-section arrow keys, Restore for an
archived exact match, system labels hidden from chips and muted in detail,
label filter grouped with system last.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 7: Label Manager — groups, drag and ⌥↑/↓, Pick one, archive unused, restore

**Files:**
- Create: `apps/desktop/src/lib/labelManagerModel.ts`, `apps/desktop/tests/labelManagerModel.test.mjs`
- Modify: `apps/desktop/src/components/settings/LabelManager.tsx` (rewrite of `LabelManager`; `LabelRow` kept)
- Modify: `apps/desktop/src/lib/shortcuts.ts`, `apps/desktop/tests/shortcuts.test.mjs`

**Interfaces:**
- Consumes: Task 2 `dp.labels.{setGroup, reorder, archive, restore, unusedIds, groups.*}`; Task 6 `managerSections`, `ManagerModel`, `useLabelTaxonomy`; existing `useDeferredDeletes`, `createUndoable`, `showUndoToast`, `DEFERRED_DELETE_MS`.
- Produces (`lib/labelManagerModel.ts`): `UNGROUPED_KEY = 'ungrouped'`; `groupKey(id)`, `labelKey(id)`; `type ManagerItem = { kind: 'group'; key; groupId } | { kind: 'ungrouped'; key } | { kind: 'label'; key; labelId }`; `interface DropResult { items: ManagerItem[]; moved?: { labelId: string; groupId: string | null }; labelOrder?: string[]; groupOrder?: string[] }`; `flattenManager(model): ManagerItem[]`; `applyDrop(items, activeKey, overKey): DropResult | null`; `moveByKey(items, key, 'up' | 'down'): DropResult | null`; `fullLabelOrder(items, model): string[]`; `applyToTaxonomy(labels, groups, result, fullOrder): { labels; groups }`; `nextGroupName(groups): string`.
- DOM contract (e2e): group name inputs are named `Group name <name>` (never `Rename …`, which t4 reads as the label list); grips carry `data-manager-grip="<key>"` and `aria-label="Drag label <name>"` / `"Drag group <name>"`; the switch is named `Pick one in <group>`; the ⋯ button `More for group <name>`; archived rows have a `Restore <name>` button.

The manager renders **one** flat sortable list — group header, its labels, next header…, the Ungrouped header, its labels — so a label's group is simply the nearest header above it (a label can never sit above the first header; groups never move below Ungrouped). System and Archived render outside the sortable list (system groups are set via `dt` only).

- [ ] **Step 1: Write the failing model tests**

Create `apps/desktop/tests/labelManagerModel.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDrop, applyToTaxonomy, flattenManager, fullLabelOrder, moveByKey, nextGroupName, UNGROUPED_KEY } from '../src/lib/labelManagerModel.ts'
import { managerSections } from '../src/lib/labelTaxonomy.ts'

const g = (id, position, extra = {}) => ({ id, name: id.toUpperCase(), position, exclusive: false, system: false, created_at: 'x', updated_at: 'x', ...extra })
const l = (id, position, group = null, archived_at = null) => ({ id, name: id, color: 'gray', position, group, archived_at, created_at: 'x' })
const groups = [g('effort', 0), g('type', 1), g('sys', 2, { system: true })]
const labels = [l('deep', 0, 'effort'), l('quick', 1, 'effort'), l('comms', 2, 'type'), l('loose', 3), l('bot', 4, 'sys'), l('old', 5, null, 'then')]
const model = managerSections(labels, groups)
const items = flattenManager(model)
const keys = (xs) => xs.map((i) => i.key)

test('flatten: headers then their labels, Ungrouped last; system and archived stay out', () => {
  assert.deepEqual(keys(items), ['group:effort', 'label:deep', 'label:quick', 'group:type', 'label:comms', UNGROUPED_KEY, 'label:loose'])
})

test('drop a label into another group: it moves and the order is reported', () => {
  const r = applyDrop(items, 'label:loose', 'label:comms')
  assert.deepEqual(r.moved, { labelId: 'loose', groupId: 'type' })
  assert.deepEqual(r.labelOrder, ['deep', 'quick', 'loose', 'comms'])
})

test('drop a label on the Ungrouped header ungroups it', () => {
  assert.deepEqual(applyDrop(items, 'label:deep', UNGROUPED_KEY).moved, { labelId: 'deep', groupId: null })
})

test('reorder inside a group keeps membership', () => {
  const r = applyDrop(items, 'label:quick', 'label:deep')
  assert.equal(r.moved, undefined)
  assert.deepEqual(r.labelOrder.slice(0, 2), ['quick', 'deep'])
})

test('a label never lands above the first header', () => {
  const r = applyDrop(items, 'label:comms', 'group:effort')
  assert.equal(keys(r.items)[0], 'group:effort')
  assert.deepEqual(r.moved, { labelId: 'comms', groupId: 'effort' })
})

test('drag a group: the whole block moves, Ungrouped stays last, no-op is null', () => {
  const r = applyDrop(items, 'group:type', 'group:effort')
  assert.deepEqual(r.groupOrder, ['type', 'effort'])
  assert.deepEqual(keys(r.items), ['group:type', 'label:comms', 'group:effort', 'label:deep', 'label:quick', UNGROUPED_KEY, 'label:loose'])
  assert.equal(applyDrop(items, 'group:effort', 'group:effort'), null)
  assert.deepEqual(applyDrop(items, 'group:effort', 'label:loose').groupOrder, ['type', 'effort'])
})

test('⌥↑/⌥↓: labels step across headers, groups swap, edges are no-ops', () => {
  assert.deepEqual(moveByKey(items, 'label:comms', 'up').moved, { labelId: 'comms', groupId: 'effort' })
  assert.deepEqual(moveByKey(items, 'label:quick', 'down').moved, { labelId: 'quick', groupId: 'type' })
  assert.equal(moveByKey(items, 'label:deep', 'up'), null)
  assert.equal(moveByKey(items, 'label:loose', 'down'), null)
  assert.deepEqual(moveByKey(items, 'group:effort', 'down').groupOrder, ['type', 'effort'])
  assert.equal(moveByKey(items, 'group:type', 'down'), null)
})

test('full order keeps system and archived after the visible list; the optimistic view applies it', () => {
  const r = applyDrop(items, 'label:loose', 'label:comms')
  const order = fullLabelOrder(r.items, model)
  assert.deepEqual(order, ['deep', 'quick', 'loose', 'comms', 'bot', 'old'])
  const loose = applyToTaxonomy(labels, groups, r, order).labels.find((x) => x.id === 'loose')
  assert.deepEqual([loose.group, loose.position], ['type', 2])
})

test('nextGroupName avoids taken names, ignoring case', () => {
  assert.equal(nextGroupName([]), 'New group')
  assert.equal(nextGroupName([g('a', 0, { name: 'New group' }), g('b', 1, { name: 'new group 2' })]), 'New group 3')
})
```

Run: `cd apps/desktop && node --test tests/labelManagerModel.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `lib/labelManagerModel.ts`**

```ts
/* Label Manager drag + keyboard model (C4). The manager is one flat sortable
   list — group header, its labels, …, the Ungrouped header, its labels — so
   a label's group is the nearest header above it. Pure; node tests import it
   (tests/labelManagerModel.test.mjs). */
import type { Label, LabelGroup } from '@nimble/types'
import type { ManagerModel } from './labelTaxonomy.ts'

export const UNGROUPED_KEY = 'ungrouped'
export const groupKey = (id: string) => `group:${id}`
export const labelKey = (id: string) => `label:${id}`

export type ManagerItem =
  | { kind: 'group'; key: string; groupId: string }
  | { kind: 'ungrouped'; key: typeof UNGROUPED_KEY }
  | { kind: 'label'; key: string; labelId: string }

export interface DropResult {
  items: ManagerItem[]
  /** Set when a label changed group (null = Ungrouped). */
  moved?: { labelId: string; groupId: string | null }
  /** Visible label ids in their new order (label moves only). */
  labelOrder?: string[]
  /** Regular group ids in their new order (group moves only). */
  groupOrder?: string[]
}

export function flattenManager(model: ManagerModel): ManagerItem[] {
  const items: ManagerItem[] = []
  for (const section of model.groups) {
    if (!section.group) continue
    items.push({ kind: 'group', key: groupKey(section.group.id), groupId: section.group.id })
    for (const l of section.labels) items.push({ kind: 'label', key: labelKey(l.id), labelId: l.id })
  }
  items.push({ kind: 'ungrouped', key: UNGROUPED_KEY })
  for (const l of model.ungrouped) items.push({ kind: 'label', key: labelKey(l.id), labelId: l.id })
  return items
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Group of the nearest header above `index`; null under Ungrouped. */
function headerAbove(items: readonly ManagerItem[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'group') return item.groupId
    if (item.kind === 'ungrouped') return null
  }
  return null
}

const labelIds = (items: readonly ManagerItem[]) => items.flatMap((i) => (i.kind === 'label' ? [i.labelId] : []))
const groupIds = (items: readonly ManagerItem[]) => items.flatMap((i) => (i.kind === 'group' ? [i.groupId] : []))

/** The flat list with group blocks in `order`; the Ungrouped block stays last. */
function withGroupOrder(items: readonly ManagerItem[], order: readonly string[]): ManagerItem[] {
  const blocks = new Map<string | null, ManagerItem[]>()
  let current: string | null = null
  for (const item of items) {
    if (item.kind === 'group') current = item.groupId
    if (item.kind === 'ungrouped') current = null
    blocks.set(current, [...(blocks.get(current) ?? []), item])
  }
  return [...order.flatMap((id) => blocks.get(id) ?? []), ...(blocks.get(null) ?? [])]
}

/** dnd-kit `onDragEnd`: drop `activeKey` onto `overKey`. null = nothing changed. */
export function applyDrop(items: readonly ManagerItem[], activeKey: string, overKey: string): DropResult | null {
  const from = items.findIndex((i) => i.key === activeKey)
  const to = items.findIndex((i) => i.key === overKey)
  if (from < 0 || to < 0 || from === to) return null
  const active = items[from]
  if (active.kind === 'label') {
    let next = move(items, from, to)
    let at = to
    if (at === 0) {
      next = move(next, 0, 1) // never above the first header
      at = 1
    }
    const before = headerAbove(items, from)
    const after = headerAbove(next, at)
    return {
      items: next,
      moved: before === after ? undefined : { labelId: active.labelId, groupId: after },
      labelOrder: labelIds(next),
    }
  }
  if (active.kind === 'group') {
    const order = groupIds(items)
    const target = items[to]
    const targetGroup = target.kind === 'group' ? target.groupId : target.kind === 'label' ? headerAbove(items, to) : null
    const toIndex = targetGroup === null ? order.length - 1 : order.indexOf(targetGroup)
    const nextOrder = move(order, order.indexOf(active.groupId), toIndex)
    if (nextOrder.every((id, i) => id === order[i])) return null
    return { items: withGroupOrder(items, nextOrder), groupOrder: nextOrder }
  }
  return null
}

/** ⌥↑ / ⌥↓: a label steps one row (crossing a header moves it into the
 *  neighbouring group); a group swaps with its neighbour. */
export function moveByKey(items: readonly ManagerItem[], key: string, direction: 'up' | 'down'): DropResult | null {
  const at = items.findIndex((i) => i.key === key)
  if (at < 0) return null
  const item = items[at]
  if (item.kind === 'label') {
    const target = direction === 'up' ? at - 1 : at + 1
    if (target < 1 || target >= items.length) return null
    return applyDrop(items, key, items[target].key)
  }
  if (item.kind === 'group') {
    const order = groupIds(items)
    const target = order.indexOf(item.groupId) + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= order.length) return null
    return applyDrop(items, key, groupKey(order[target]))
  }
  return null
}

/** Every label id in manager order — visible list, then system, then
 *  archived — so `labels.reorder` keeps every position unique. */
export function fullLabelOrder(items: readonly ManagerItem[], model: ManagerModel): string[] {
  return [
    ...labelIds(items),
    ...model.system.flatMap((s) => s.labels.map((l) => l.id)),
    ...model.archived.map((l) => l.id),
  ]
}

/** The optimistic view after a drop, as the server will store it. */
export function applyToTaxonomy(
  labels: Label[],
  groups: LabelGroup[],
  result: DropResult,
  fullOrder: readonly string[],
): { labels: Label[]; groups: LabelGroup[] } {
  const labelPos = new Map(fullOrder.map((id, i) => [id, i]))
  const groupPos = new Map((result.groupOrder ?? []).map((id, i) => [id, i]))
  return {
    labels: labels.map((l) => ({
      ...l,
      group: result.moved?.labelId === l.id ? result.moved.groupId : l.group,
      position: result.labelOrder ? labelPos.get(l.id) ?? l.position : l.position,
    })),
    groups: groups.map((g) => ({ ...g, position: groupPos.get(g.id) ?? g.position })),
  }
}

export function nextGroupName(groups: readonly LabelGroup[]): string {
  const taken = new Set(groups.map((g) => g.name.toLowerCase()))
  if (!taken.has('new group')) return 'New group'
  for (let n = 2; ; n++) if (!taken.has(`new group ${n}`)) return `New group ${n}`
}
```

Run: `cd apps/desktop && node --test tests/labelManagerModel.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 3: Rewrite `LabelManager`**

Replace the `LabelManager` function (keep `toastFailure` and `LabelRow` as they are, except delete the stale sentence "Grouping by ENERGY/TIME/TYPE/CREATIVE is C4." from `LabelRow`'s comment) and update the imports:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Label, LabelGroup } from '@nimble/types'
import { cn } from '@/lib/utils'
import { labelColor, LABEL_COLOR_OPTIONS, DEFAULT_LABEL_COLOR } from '@/lib/labelColors'
import { useDataProvider } from '@/services/provider-context'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { useDeferredDeletes } from '@/hooks/useDeferredDeletes'
import { managerSections } from '@/lib/labelTaxonomy'
import { applyDrop, applyToTaxonomy, flattenManager, fullLabelOrder, moveByKey, nextGroupName, type DropResult } from '@/lib/labelManagerModel'
import { createUndoable } from '@/lib/undoable'
import { DEFERRED_DELETE_MS } from '@/lib/deferredDelete'
import { showUndoToast } from '@/components/shared/undoToast'
import { CollapsibleSection } from '@/components/shared/CollapsibleSection'
import { IconButton } from '@/components/shared/IconButton'
import { Caption } from '@/components/shared/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { settingsFailure } from '@/lib/settingsMessage'
```

```tsx
export function LabelManager() {
  const dp = useDataProvider()
  const { labels, groups, loading, reload } = useLabelTaxonomy()
  // Optimistic overlay after a drag or ⌥-move. It is tied to the `labels`
  // array it was built from, so the next fetch (a new array) retires it
  // without a setState-in-effect.
  const [overlay, setOverlay] = useState<{ base: Label[]; value: { labels: Label[]; groups: LabelGroup[] } } | null>(null)
  const view = useMemo(
    () => (overlay && overlay.base === labels ? overlay.value : { labels, groups }),
    [overlay, labels, groups],
  )

  // Deferred deletes: label ids, and `group:<id>` for groups. A group pending
  // delete reads as gone, so its labels show under Ungrouped until Undo.
  const { hidden, defer } = useDeferredDeletes()
  const hiddenGroups = useMemo(
    () => new Set([...hidden].filter((k) => k.startsWith('group:')).map((k) => k.slice('group:'.length))),
    [hidden],
  )
  const model = useMemo(
    () => managerSections(view.labels.filter((l) => !hidden.has(l.id)), view.groups, hiddenGroups),
    [view, hidden, hiddenGroups],
  )
  const items = useMemo(() => flattenManager(model), [model])

  const [unused, setUnused] = useState<string[]>([])
  useEffect(() => { dp.labels.unusedIds().then(setUnused, () => setUnused([])) }, [dp, labels])

  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<string>(DEFAULT_LABEL_COLOR)
  const [saving, setSaving] = useState(false)

  // Keyboard moves and "New group" put focus back where the user expects it.
  const refocus = useRef<{ selector: string; select?: boolean } | null>(null)
  useEffect(() => {
    const target = refocus.current
    if (!target) return
    const el = document.querySelector<HTMLElement>(target.selector)
    if (!el) return
    refocus.current = null
    el.focus()
    if (target.select && el instanceof HTMLInputElement) el.select()
  }, [items])

  const persist = useCallback(async (result: DropResult | null) => {
    if (!result) return
    const order = fullLabelOrder(result.items, model)
    setOverlay({ base: labels, value: applyToTaxonomy(view.labels, view.groups, result, order) })
    try {
      if (result.moved) await dp.labels.setGroup(result.moved.labelId, result.moved.groupId)
      if (result.labelOrder) await dp.labels.reorder(order)
      if (result.groupOrder) await dp.labels.groups.reorder(result.groupOrder)
    } catch (e) {
      toastFailure(e)
    } finally {
      reload()
    }
  }, [dp, model, view, labels, reload])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) void persist(applyDrop(items, String(active.id), String(over.id)))
  }
  // ⌥↑/⌥↓ from a row's grip (never from its rename field, where ⌥↑ moves the caret).
  const onMoveKey = (key: string) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    if ((e.target as HTMLElement).dataset.managerGrip === undefined) return
    e.preventDefault()
    e.stopPropagation()
    refocus.current = { selector: `[data-manager-grip="${window.CSS.escape(key)}"]` }
    void persist(moveByKey(items, key, e.key === 'ArrowUp' ? 'up' : 'down'))
  }

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim()
    if (!trimmed || saving) return
    const archived = view.labels.find((l) => l.archived_at && l.name.toLowerCase() === trimmed.toLowerCase())
    if (archived) {
      toast(`"${archived.name}" is archived. Restore it from Archived below.`)
      return
    }
    setSaving(true)
    try {
      await dp.labels.create(trimmed, newColor)
      reload()
      toast.success(`Label created: "${trimmed}"`)
      setNewName('')
      setNewColor(DEFAULT_LABEL_COLOR)
      setShowForm(false)
    } catch (e) {
      toastFailure(e)
    } finally {
      setSaving(false)
    }
  }, [dp, newName, newColor, saving, view.labels, reload])

  const handleRename = useCallback(async (id: string, name: string): Promise<boolean> => {
    try {
      await dp.labels.update(id, { name })
      reload()
      return true
    } catch (e) {
      toastFailure(e)
      return false
    }
  }, [dp, reload])

  const handleColorChange = useCallback(async (id: string, color: string) => {
    try {
      await dp.labels.update(id, { color })
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }, [dp, reload])

  const handleDelete = useCallback((label: Label) => {
    defer(label.id, `Label "${label.name}" deleted`, async () => {
      try {
        await dp.labels.delete(label.id)
      } catch (e) {
        toastFailure(e)
      } finally {
        reload()
      }
    })
  }, [dp, defer, reload])

  const newGroup = async () => {
    try {
      const group = await dp.labels.groups.create(nextGroupName(view.groups), false)
      refocus.current = { selector: `[data-group-name="${window.CSS.escape(group.id)}"]`, select: true }
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }

  const renameGroup = async (id: string, name: string): Promise<boolean> => {
    try {
      await dp.labels.groups.update(id, { name })
      reload()
      return true
    } catch (e) {
      toastFailure(e)
      return false
    }
  }

  const setPickOne = async (id: string, exclusive: boolean) => {
    try {
      await dp.labels.groups.update(id, { exclusive })
      reload()
    } catch (e) {
      toastFailure(e)
    }
  }

  const deleteGroup = (group: LabelGroup) => {
    defer(`group:${group.id}`, `Group "${group.name}" deleted. Its labels are ungrouped.`, async () => {
      try {
        await dp.labels.groups.delete(group.id)
      } catch (e) {
        toastFailure(e)
      } finally {
        reload()
      }
    })
  }

  const archiveUnused = async () => {
    try {
      const archived = await dp.labels.archive(unused)
      reload()
      const ids = archived.map((l) => l.id)
      // Already committed; Undo restores exactly what this call archived.
      const pending = createUndoable({
        onCommit: () => {},
        onUndo: () => { dp.labels.restore(ids).then(() => reload(), toastFailure) },
      })
      showUndoToast(`Archived ${ids.length} label${ids.length === 1 ? '' : 's'}`, pending, DEFERRED_DELETE_MS)
    } catch (e) {
      toastFailure(e)
    }
  }

  const restore = async (label: Label) => {
    try {
      await dp.labels.restore([label.id])
      reload()
      toast.success(`Restored "${label.name}"`)
    } catch (e) {
      toastFailure(e)
    }
  }

  if (loading && labels.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    )
  }

  const labelRow = (label: Label) => (
    <LabelRow label={label} onRename={handleRename} onColorChange={handleColorChange} onDelete={() => handleDelete(label)} />
  )
  const systemCount = model.system.reduce((n, s) => n + s.labels.length, 0)

  return (
    <div className="space-y-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5">
            {items.map((item) => {
              if (item.kind === 'group') {
                const group = view.groups.find((g) => g.id === item.groupId)
                if (!group) return null
                return (
                  <SortableRow key={item.key} id={item.key} gripLabel={`Drag group ${group.name}`} onKeyDown={onMoveKey(item.key)} className="pt-3 first:pt-0">
                    <GroupHeader group={group} onRename={renameGroup} onPickOne={setPickOne} onDelete={() => deleteGroup(group)} />
                  </SortableRow>
                )
              }
              if (item.kind === 'ungrouped') {
                return (
                  <SortableRow key={item.key} id={item.key} fixed className="pt-3 first:pt-0">
                    <Caption as="div" className="px-1 py-1">Ungrouped</Caption>
                  </SortableRow>
                )
              }
              const label = view.labels.find((l) => l.id === item.labelId)
              if (!label) return null
              return (
                <SortableRow key={item.key} id={item.key} gripLabel={`Drag label ${label.name}`} onKeyDown={onMoveKey(item.key)}>
                  {labelRow(label)}
                </SortableRow>
              )
            })}
            {items.length === 1 && (
              <p className="px-1 text-body text-muted-foreground">No labels yet.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {systemCount > 0 && (
        <CollapsibleSection title="System" count={systemCount} variant="nested" defaultOpen={false}>
          {model.system.map((section) => (
            <div key={section.group?.id} className="space-y-0.5 pl-5">
              <Caption as="div" className="px-1 py-1">{section.group?.name}</Caption>
              {section.labels.map((label) => <div key={label.id}>{labelRow(label)}</div>)}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {model.archived.length > 0 && (
        <CollapsibleSection title="Archived" count={model.archived.length} variant="nested" defaultOpen={false}>
          <div className="space-y-0.5 pl-5">
            {model.archived.map((label) => (
              <div key={label.id} className="flex items-center gap-2 rounded-md px-2 py-1">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: labelColor(label.color) }} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body text-muted-foreground">{label.name}</span>
                <Button variant="ghost" size="sm" onClick={() => void restore(label)} aria-label={`Restore ${label.name}`}>
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {showForm ? (
        <div className="space-y-4 rounded-md border p-4">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Label name"
            autoFocus
          />
          <div className="flex items-center gap-2">
            {LABEL_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'size-6 rounded-full border-2 transition-[border-color,scale] duration-(--transition-fast)',
                  newColor === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50',
                )}
                style={{ backgroundColor: labelColor(c) }}
                onClick={() => setNewColor(c)}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? 'Adding...' : 'Add label'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setNewName(''); setNewColor(DEFAULT_LABEL_COLOR) }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            + Add label
          </Button>
          <Button variant="outline" size="sm" onClick={() => void newGroup()}>
            <Plus className="size-3" />
            New group
          </Button>
          {unused.length > 0 && <ArchiveUnusedButton count={unused.length} onConfirm={() => void archiveUnused()} />}
        </div>
      )}
    </div>
  )
}

/** One row of the flat sortable list. Handle-only drag (FocusQueueList precedent). */
function SortableRow({
  id,
  fixed = false,
  gripLabel,
  onKeyDown,
  className,
  children,
}: {
  id: string
  fixed?: boolean
  gripLabel?: string
  onKeyDown?: (e: KeyboardEvent) => void
  className?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: fixed ? { draggable: true, droppable: false } : false })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className={cn('group/row flex items-center gap-1', isDragging && 'relative z-10 rounded-md bg-background opacity-90 shadow-md', className)}
    >
      {fixed ? (
        <span className="w-5 shrink-0" aria-hidden />
      ) : (
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          data-manager-grip={id}
          aria-label={gripLabel}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-opacity duration-(--transition-fast) group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function GroupHeader({
  group,
  onRename,
  onPickOne,
  onDelete,
}: {
  group: LabelGroup
  onRename: (id: string, name: string) => Promise<boolean>
  onPickOne: (id: string, exclusive: boolean) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(group.name)
  useEffect(() => { setDraft(group.name) }, [group.name])
  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === group.name) {
      setDraft(group.name)
      return
    }
    if (!(await onRename(group.id, trimmed))) setDraft(group.name)
  }
  return (
    <div className="flex items-center gap-2 rounded-md px-1 py-1">
      <input
        value={draft}
        data-group-name={group.id}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(group.name); e.currentTarget.blur() }
        }}
        aria-label={`Group name ${group.name}`}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-body-strong underline-offset-4 decoration-muted-foreground-subtle hover:underline focus-visible:no-underline"
      />
      <span className="flex shrink-0 items-center gap-1.5">
        <Switch
          size="sm"
          checked={group.exclusive}
          onCheckedChange={(checked) => onPickOne(group.id, checked)}
          aria-label={`Pick one in ${group.name}`}
        />
        <span className="text-meta text-muted-foreground" aria-hidden>Pick one</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton aria-label={`More for group ${group.name}`}>
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onDelete}>
            <Trash2 className="size-3.5" />
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ArchiveUnusedButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  const noun = count === 1 ? 'label' : 'labels'
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Archive className="size-3" />
            Archive unused
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {count} {noun} with no open tasks?</AlertDialogTitle>
          <AlertDialogDescription>They stay on completed tasks and you can restore them.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Archive {count}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

(The switch's `aria-label` contains the visible words "Pick one", so the visible text can stay `aria-hidden`.)

- [ ] **Step 4: Shortcut row**

Append to `SHORTCUTS` in `lib/shortcuts.ts`:

```ts
  { section: 'Labels', keys: '⌥↑ / ⌥↓', label: 'Move the focused label or group (Settings → Labels, from its grip)' },
```

and add `'⌥↑ / ⌥↓'` to the key list in the `Labels section (C4)` test in `tests/shortcuts.test.mjs`.

- [ ] **Step 5: Verify**

Run: `cd apps/desktop && node --test tests/labelManagerModel.test.mjs tests/labelTaxonomy.test.mjs tests/shortcuts.test.mjs tests/deferredDelete.test.mjs && npm run build && npm run build:web && npx eslint src 2>&1 | tail -2`
Expected: all pass; builds succeed; lint count not above the recorded baseline.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src apps/desktop/tests
git commit -m "feat(c4): Label Manager with groups, drag + ⌥↑/↓, Pick one, archive unused

One flat sortable list (a label's group is the header above it), deferred
group delete with Undo (labels read as ungrouped meanwhile), New group,
System and Archived sections with Restore, Archive unused with a counted
confirm and an exact Undo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 8: ⌘F TaskSearch overlay, ⌘K `/search` handoff, recent searches, shortcuts

**Files:**
- Modify: `apps/desktop/src/lib/taskSearch.ts` (second half), `apps/desktop/tests/taskSearch.test.mjs`
- Create: `apps/desktop/src/lib/recentSearches.ts`, `apps/desktop/tests/recentSearches.test.mjs`
- Create: `apps/desktop/src/stores/taskSearchStore.ts`, `apps/desktop/src/components/search/TaskSearch.tsx`, `apps/desktop/src/components/search/SearchFilterChips.tsx`
- Modify: `apps/desktop/src/lib/commandBarMode.ts`, `apps/desktop/tests/commandBarMode.test.mjs`
- Modify: `apps/desktop/src/components/shared/CommandBar.tsx` (opener capture, handoff in `handleChange`)
- Modify: `apps/desktop/src/hooks/useTaskNavigation.ts` (export `rememberRowFocus`)
- Modify: `apps/desktop/src/components/layout/Dashboard.tsx:382` (mount `<TaskSearch />`)
- Modify: `apps/desktop/src/lib/shortcuts.ts`, `apps/desktop/tests/shortcuts.test.mjs`

**Interfaces:**
- Consumes: Task 4 `dp.tasks.search`, `TaskSearchFilters`, `TaskSearchHit`, `searchTokens`, `splitMarked`, `markTitle`, `Segment`; Task 6 `LabelPickerList` (`mode="filter"`), `useLabelTaxonomy`; existing `useProjects`, `useDetailStore.openTask/close`, `useTasksNavStore.requestProject`, `navigateTo` (`@/stores/settingsNavStore`), `hasOpenOverlay` (`@/lib/rowNav`), cmdk, base-ui `Dialog` (`finalFocus`).
- Produces:
  - `lib/taskSearch.ts`: `SEARCH_DEBOUNCE_MS = 80`; `groupHits(hits): { open: TaskSearchHit[]; completed: TaskSearchHit[] }`; `createLatestGuard(): { next(): number; isLatest(id: number): boolean }`; `formatDoneDate(completedAt: string | null, now?: Date): string`; `EMPTY_SEARCH_FILTERS: TaskSearchFilters`; `STATUS_LABEL: Record<TaskSearchStatus, string>`; `hasActiveFilters(f): boolean`; `activeFilterLabels(f, labels: {id,name}[], projects: {id,name}[]): string[]`.
  - `lib/recentSearches.ts`: `RECENT_KEY`, `RECENT_MAX = 8`, `interface StorageLike { getItem; setItem }`, `loadRecent(storage: StorageLike | null): string[]`, `pushRecent(storage: StorageLike | null, query: string): string[]`, `safeStorage(): StorageLike | null`.
  - `lib/commandBarMode.ts`: `searchHandoff(raw: string): string | null`.
  - `stores/taskSearchStore.ts`: `useTaskSearchStore` `{ open: boolean; session: number; initialQuery: string; returnFocus: HTMLElement | null; openSearch(query?: string, returnFocus?: HTMLElement | null): void; close(): void }`.
  - `hooks/useTaskNavigation.ts`: `rememberRowFocus(memoryKey: string, id: string): void`.
  - DOM contract (e2e): dialog named "Search tasks"; input `role=combobox` named "Search tasks" with `data-task-search-input`; groups headed "Recent", "Open", "Completed"; chips named `Status: …`, `Label filter: …`, `Project filter: …`; matched terms render as `<mark>`.

- [ ] **Step 1: Write the failing helper tests**

Append to `apps/desktop/tests/taskSearch.test.mjs`:

```js
import {
  groupHits, createLatestGuard, formatDoneDate, EMPTY_SEARCH_FILTERS, hasActiveFilters, activeFilterLabels,
} from '../src/lib/taskSearch.ts'

const hit = (id, status) => ({ task: { id, status, content: id }, snippet: null, matched_in: 'title' })

test('groupHits: open then completed, ranked order kept inside each', () => {
  const { open, completed } = groupHits([hit('a', 'todo'), hit('b', 'complete'), hit('c', 'blocked'), hit('d', 'complete')])
  assert.deepEqual(open.map((h) => h.task.id), ['a', 'c'])
  assert.deepEqual(completed.map((h) => h.task.id), ['b', 'd'])
})

test('latest guard drops stale responses', () => {
  const guard = createLatestGuard()
  const first = guard.next()
  const second = guard.next()
  assert.equal(guard.isLatest(first), false, 'an older query never replaces a newer one')
  assert.equal(guard.isLatest(second), true)
  guard.next() // clearing the input invalidates whatever is in flight
  assert.equal(guard.isLatest(second), false)
})

test('formatDoneDate: short date, year only outside the current year', () => {
  const now = new Date(2026, 8, 25)
  assert.equal(formatDoneDate('2026-09-12 14:03:00', now), 'Sep 12')
  assert.equal(formatDoneDate('2025-12-01T09:00:00', now), 'Dec 1, 2025')
  assert.equal(formatDoneDate(null, now), 'Done')
  assert.equal(formatDoneDate('garbage', now), 'Done')
})

test('filters: active check and plain-language list for the empty state', () => {
  assert.equal(hasActiveFilters(EMPTY_SEARCH_FILTERS), false)
  const f = { status: 'completed', label_ids: ['l1', 'gone'], project_id: 'p1' }
  assert.equal(hasActiveFilters(f), true)
  assert.deepEqual(activeFilterLabels(f, [{ id: 'l1', name: 'deep' }], [{ id: 'p1', name: 'Portfolio' }]), ['Completed', 'deep', 'Portfolio'])
})
```

Create `apps/desktop/tests/recentSearches.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadRecent, pushRecent, RECENT_KEY, RECENT_MAX } from '../src/lib/recentSearches.ts'

function memory(initial = {}) {
  const data = { ...initial }
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) } }
}

test('newest first, case-insensitive dedupe, capped at 8, blanks ignored', () => {
  const s = memory()
  for (let i = 0; i < 10; i++) pushRecent(s, `q${i}`)
  assert.equal(loadRecent(s).length, RECENT_MAX)
  assert.equal(loadRecent(s)[0], 'q9')
  pushRecent(s, 'Q5')
  assert.deepEqual(loadRecent(s).slice(0, 2), ['Q5', 'q9'])
  assert.equal(loadRecent(s).filter((q) => q.toLowerCase() === 'q5').length, 1)
  assert.deepEqual(pushRecent(s, '   '), loadRecent(s))
})

test('storage that throws or holds junk never breaks search', () => {
  const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.deepEqual(loadRecent(throwing), [])
  assert.deepEqual(pushRecent(throwing, 'portfolio'), ['portfolio'])
  assert.deepEqual(loadRecent(null), [])
  assert.deepEqual(loadRecent(memory({ [RECENT_KEY]: '{not json' })), [])
  assert.deepEqual(loadRecent(memory({ [RECENT_KEY]: JSON.stringify(['ok', 3, null]) })), ['ok'])
})
```

Append to `apps/desktop/tests/commandBarMode.test.mjs`:

```js
import { searchHandoff } from '../src/lib/commandBarMode.ts'

test('/search hands its text to ⌘F; other input stays in ⌘K', () => {
  assert.equal(searchHandoff('/search '), '')
  assert.equal(searchHandoff('  /search portfolio deck'), 'portfolio deck')
  assert.equal(searchHandoff('/search'), null, 'not until the space')
  assert.equal(searchHandoff('portfolio'), null)
  assert.equal(searchHandoff('/searching'), null)
})
```

Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs tests/recentSearches.test.mjs tests/commandBarMode.test.mjs`
Expected: FAIL — missing exports / module.

- [ ] **Step 2: Implement the helpers**

Append to `apps/desktop/src/lib/taskSearch.ts` (and add `import type { TaskSearchFilters, TaskSearchHit, TaskSearchStatus } from '@nimble/types'` at the top):

```ts
export const SEARCH_DEBOUNCE_MS = 80

/** Open results, then completed; each keeps its ranked order. */
export function groupHits(hits: readonly TaskSearchHit[]): { open: TaskSearchHit[]; completed: TaskSearchHit[] } {
  return {
    open: hits.filter((h) => h.task.status !== 'complete'),
    completed: hits.filter((h) => h.task.status === 'complete'),
  }
}

/** As-you-type request ids: only the latest response may render. */
export function createLatestGuard(): { next(): number; isLatest(id: number): boolean } {
  let latest = 0
  return { next: () => ++latest, isLatest: (id) => id === latest }
}

/** "Sep 12", or "Dec 1, 2025" outside the current year. Rust stamps local
 *  "YYYY-MM-DD HH:MM:SS"; the mock stamps "YYYY-MM-DDTHH:MM:SS". */
export function formatDoneDate(completedAt: string | null, now: Date = new Date()): string {
  const match = completedAt?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return 'Done'
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', year === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export const EMPTY_SEARCH_FILTERS: TaskSearchFilters = { status: 'all', label_ids: [], project_id: null }

export const STATUS_LABEL: Record<TaskSearchStatus, string> = { all: 'Any status', open: 'Open', completed: 'Completed' }

export function hasActiveFilters(f: TaskSearchFilters): boolean {
  return (f.status ?? 'all') !== 'all' || (f.label_ids?.length ?? 0) > 0 || !!f.project_id
}

/** Active filters in plain words, for the no-results state. */
export function activeFilterLabels(
  f: TaskSearchFilters,
  labels: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
): string[] {
  const out: string[] = []
  const status = f.status ?? 'all'
  if (status !== 'all') out.push(STATUS_LABEL[status])
  for (const id of f.label_ids ?? []) {
    const label = labels.find((l) => l.id === id)
    if (label) out.push(label.name)
  }
  const project = projects.find((p) => p.id === f.project_id)
  if (project) out.push(project.name)
  return out
}
```

Create `apps/desktop/src/lib/recentSearches.ts`:

```ts
/* Recent ⌘F queries, per device (C4). Browser storage can be missing or
   throw (private window, cleared site data), so every access is guarded and
   search works without it. Pure over a Storage-like object; node-tested. */

export const RECENT_KEY = 'nimble.taskSearch.recent'
export const RECENT_MAX = 8

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadRecent(storage: StorageLike | null): string[] {
  try {
    const raw = storage?.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Newest first, case-insensitive dedupe, capped. Returns the new list. */
export function pushRecent(storage: StorageLike | null, query: string): string[] {
  const q = query.trim()
  const current = loadRecent(storage)
  if (!q) return current
  const next = [q, ...current.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX)
  try {
    storage?.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Not persisted this time; the list still works for this session.
  }
  return next
}
```

Append to `apps/desktop/src/lib/commandBarMode.ts`:

```ts
/** ⌘K `/search ` hands its text to the ⌘F overlay (C4). Returns the text to
 *  hand over (possibly empty), or null when the input is not a search handoff. */
export function searchHandoff(raw: string): string | null {
  const trimmed = raw.trimStart()
  return trimmed.startsWith('/search ') ? trimmed.slice('/search '.length) : null
}
```

Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs tests/recentSearches.test.mjs tests/commandBarMode.test.mjs`
Expected: PASS.

- [ ] **Step 3: Store + row pre-selection hook**

Create `apps/desktop/src/stores/taskSearchStore.ts`:

```ts
import { create } from 'zustand'

interface TaskSearchState {
  open: boolean
  /** Bumps on every open so the dialog remounts with fresh state. */
  session: number
  initialQuery: string
  /** Where focus returns on Escape: the ⌘F opener, or ⌘K's opener on a handoff. */
  returnFocus: HTMLElement | null
  openSearch: (query?: string, returnFocus?: HTMLElement | null) => void
  close: () => void
}

export const useTaskSearchStore = create<TaskSearchState>((set) => ({
  open: false,
  session: 0,
  initialQuery: '',
  returnFocus: null,
  openSearch: (query = '', returnFocus = null) =>
    set((s) => ({ open: true, session: s.session + 1, initialQuery: query, returnFocus })),
  close: () => set({ open: false }),
}))
```

In `apps/desktop/src/hooks/useTaskNavigation.ts`, after `const rememberedFocus = new Map<string, RowFocus>()`:

```ts
/** Pre-select a row for the next mount of a list (⌘F ⌘↵ "open in its project"). */
export function rememberRowFocus(memoryKey: string, id: string) {
  rememberedFocus.set(memoryKey, { id, index: 0 })
}
```

- [ ] **Step 4: Filter chips**

Create `apps/desktop/src/components/search/SearchFilterChips.tsx`:

```tsx
import { ChevronDown } from 'lucide-react'
import type { Project, TaskSearchFilters, TaskSearchStatus } from '@nimble/types'
import { cn } from '@/lib/utils'
import { STATUS_LABEL } from '@/lib/taskSearch'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { LabelPickerList } from '@/components/tasks/LabelPicker'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const chip = (active: boolean) =>
  cn(
    'inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-meta outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'border-transparent bg-secondary text-secondary-foreground' : 'border-border/60 text-muted-foreground hover:bg-hover hover:text-foreground',
  )

const STATUSES: TaskSearchStatus[] = ['all', 'open', 'completed']

export function SearchFilterChips({
  filters,
  onChange,
  projects,
}: {
  filters: TaskSearchFilters
  onChange: (next: TaskSearchFilters) => void
  projects: Project[]
}) {
  const { labels } = useLabelTaxonomy()
  const status = filters.status ?? 'all'
  const labelIds = filters.label_ids ?? []
  const project = projects.find((p) => p.id === filters.project_id) ?? null
  const labelText =
    labelIds.length === 0 ? 'Label'
    : labelIds.length === 1 ? labels.find((l) => l.id === labelIds[0])?.name ?? '1 label'
    : `${labelIds.length} labels`

  return (
    // Menus and the label list are portaled but still bubble through React:
    // keep their Enter/arrows from also driving the results list (cmdk).
    <div
      role="group"
      aria-label="Filters"
      className="flex shrink-0 items-center gap-1"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.stopPropagation()
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className={chip(status !== 'all')} aria-label={`Status: ${STATUS_LABEL[status]}`}>
          {status === 'all' ? 'Status' : STATUS_LABEL[status]}
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup value={status} onValueChange={(v) => onChange({ ...filters, status: v as TaskSearchStatus })}>
            {STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>{STATUS_LABEL[s]}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger className={chip(labelIds.length > 0)} aria-label={`Label filter: ${labelIds.length === 0 ? 'any' : labelText}`}>
          {labelText}
          <ChevronDown className="size-3" aria-hidden />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" sideOffset={6} className="w-60 p-1.5">
          <LabelPickerList mode="filter" value={labelIds} onChange={(ids) => onChange({ ...filters, label_ids: ids })} />
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger className={chip(!!project)} aria-label={`Project filter: ${project?.name ?? 'any'}`}>
          <span className="max-w-28 truncate">{project?.name ?? 'Project'}</span>
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-52 overflow-y-auto">
          <DropdownMenuRadioGroup value={filters.project_id ?? ''} onValueChange={(v) => onChange({ ...filters, project_id: (v as string) || null })}>
            <DropdownMenuRadioItem value="">Any project</DropdownMenuRadioItem>
            {projects.filter((p) => !p.archived_at).map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>{p.name}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
```

> **UX checkpoint:** Spec §4.3 puts the three chips on the right of the input. At ⌘K's `max-w-lg` (512px) that leaves ~250px for the query. Options: (a) chips inline on the right and the dialog widened to `max-w-xl` (576px) — the default above; (b) chips on a second row under the input (full-width query, taller bar); (c) one "Filters" chip opening a menu with all three. **Recommended: (a)** — matches the spec and keeps ⌘F the same height as ⌘K. Ask Marco before styling polish.

- [ ] **Step 5: The overlay**

Create `apps/desktop/src/components/search/TaskSearch.tsx`:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Check, Circle, History, Search } from 'lucide-react'
import type { TaskSearchFilters, TaskSearchHit } from '@nimble/types'
import { cn } from '@/lib/utils'
import { Command, CommandGroup, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/EmptyState'
import { Icon } from '@/components/shared/Icon'
import { Meta } from '@/components/shared/typography'
import { useDataProvider } from '@/services/provider-context'
import { useProjects } from '@/hooks/useLocalTasks'
import { useLabelTaxonomy } from '@/hooks/useLabelTaxonomy'
import { rememberRowFocus } from '@/hooks/useTaskNavigation'
import { useTaskSearchStore } from '@/stores/taskSearchStore'
import { useDetailStore } from '@/stores/detailStore'
import { useTasksNavStore } from '@/stores/tasksNavStore'
import { navigateTo } from '@/stores/settingsNavStore'
import { hasOpenOverlay } from '@/lib/rowNav'
import {
  EMPTY_SEARCH_FILTERS, SEARCH_DEBOUNCE_MS, activeFilterLabels, createLatestGuard, formatDoneDate,
  groupHits, hasActiveFilters, markTitle, searchTokens, splitMarked, type Segment,
} from '@/lib/taskSearch'
import { loadRecent, pushRecent, safeStorage } from '@/lib/recentSearches'
import { SearchFilterChips } from './SearchFilterChips'

/** ⌘F — search every task, open or done (C4). Mounted once in Dashboard. */
export function TaskSearch() {
  const open = useTaskSearchStore((s) => s.open)
  const session = useTaskSearchStore((s) => s.session)
  const openSearch = useTaskSearchStore((s) => s.openSearch)

  // ⌘F from anywhere, including text fields — except while another overlay
  // (dialog, menu, popover, listbox) is up. A second ⌘F re-selects the query.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (useTaskSearchStore.getState().open) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-task-search-input]')?.select()
        return
      }
      if (hasOpenOverlay()) return
      e.preventDefault()
      openSearch('', document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openSearch])

  // `session` remounts the dialog per open: fresh query, filters, results.
  // Nothing mounts (or fetches) until the first open.
  return session > 0 ? <TaskSearchDialog key={session} open={open} /> : null
}

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.mark
          ? <mark key={i} className="rounded-[3px] bg-primary/15 px-px text-inherit">{s.text}</mark>
          : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  )
}

function TaskSearchDialog({ open }: { open: boolean }) {
  const dp = useDataProvider()
  const close = useTaskSearchStore((s) => s.close)
  const initialQuery = useTaskSearchStore((s) => s.initialQuery)
  const returnFocus = useTaskSearchStore((s) => s.returnFocus)
  const { projects } = useProjects()
  const { labels } = useLabelTaxonomy()
  const [query, setQuery] = useState(initialQuery)
  const [filters, setFilters] = useState<TaskSearchFilters>(EMPTY_SEARCH_FILTERS)
  const [result, setResult] = useState<{ key: string; hits: TaskSearchHit[] } | null>(null)
  const [recent, setRecent] = useState<string[]>(() => loadRecent(safeStorage()))
  const [selected, setSelected] = useState('')
  const guard = useRef(createLatestGuard())
  // Escape returns focus to the opener; opening a task hands focus onward.
  const restoreFocus = useRef(true)

  const trimmed = query.trim()
  const requestKey = JSON.stringify([trimmed, filters])
  const tokens = useMemo(() => searchTokens(trimmed), [trimmed])

  // Debounced; responses to anything but the latest request are dropped.
  useEffect(() => {
    if (!open || !trimmed) {
      guard.current.next()
      return
    }
    const timer = window.setTimeout(() => {
      const id = guard.current.next()
      dp.tasks.search(trimmed, filters).then(
        (hits) => { if (guard.current.isLatest(id)) setResult({ key: requestKey, hits }) },
        () => { if (guard.current.isLatest(id)) setResult({ key: requestKey, hits: [] }) },
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, trimmed, filters, requestKey, dp])

  // The previous results stay up while the next query runs (no flicker).
  const hits = trimmed && result ? result.hits : []
  const settled = !trimmed || result?.key === requestKey
  const { open: openHits, completed } = groupHits(hits)
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const filtersOn = hasActiveFilters(filters)

  const remember = () => {
    if (trimmed) setRecent(pushRecent(safeStorage(), trimmed))
  }
  const openTask = (hit: TaskSearchHit) => {
    remember()
    restoreFocus.current = false
    close()
    useDetailStore.getState().openTask(hit.task.id)
  }
  const openInProject = (hit: TaskSearchHit) => {
    remember()
    restoreFocus.current = false
    close()
    const { id, project_id: projectId } = hit.task
    rememberRowFocus(`tasks:project:${projectId}`, id)
    useDetailStore.getState().close()
    useTasksNavStore.getState().requestProject(projectId)
    navigateTo('tasks')
    // Already showing that project? Its list is mounted: focus the row now.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-nav-row="${window.CSS.escape(id)}"]`)?.focus()
    })
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    const hit = hits.find((h) => h.task.id === selected) ?? hits[0]
    if (hit) openInProject(hit)
  }

  const renderHit = (hit: TaskSearchHit) => {
    const done = hit.task.status === 'complete'
    return (
      <CommandPrimitive.Item
        key={hit.task.id}
        value={hit.task.id}
        onSelect={() => openTask(hit)}
        className="flex cursor-default select-none items-start gap-2 rounded-lg px-2 py-1.5 outline-none data-[selected=true]:bg-hover"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          {done ? <Check className="size-3.5" /> : <Circle className="size-3" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-body', done && 'text-muted-foreground line-through')}>
              <Marked segments={markTitle(hit.task.content, tokens)} />
            </span>
            <Meta className="shrink-0">
              {done ? formatDoneDate(hit.task.completed_at) : projectName.get(hit.task.project_id) ?? ''}
            </Meta>
          </span>
          {hit.snippet && (
            <Meta className="truncate">
              <Marked segments={splitMarked(hit.snippet)} />
            </Meta>
          )}
        </span>
      </CommandPrimitive.Item>
    )
  }

  const showRecent = !trimmed && recent.length > 0
  const showList = showRecent || hits.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => (restoreFocus.current && returnFocus?.isConnected ? returnFocus : false)}
        className="top-[28%] w-full max-w-xl translate-y-0 gap-0 bg-transparent p-0 ring-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search tasks</DialogTitle>
        <DialogDescription className="sr-only">
          Every task, open or done. Enter opens a task; Command-Enter opens it in its project.
        </DialogDescription>
        <Command shouldFilter={false} loop value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} className="gap-1 overflow-visible bg-transparent p-0">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-border/50 bg-popover px-4 shadow-lg shadow-black/10">
            <Icon icon={Search} className="text-muted-foreground" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              data-task-search-input=""
              aria-label="Search tasks"
              placeholder="Search tasks…"
              className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
            />
            <SearchFilterChips filters={filters} onChange={setFilters} projects={projects} />
          </div>

          {(showList || (trimmed && (!settled || hits.length === 0))) && (
            <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
              {showList && (
                <CommandList className="max-h-[min(60vh,28rem)] p-1">
                  {showRecent && (
                    <CommandGroup heading="Recent">
                      {recent.map((q) => (
                        <CommandPrimitive.Item
                          key={q}
                          value={`recent:${q}`}
                          onSelect={() => setQuery(q)}
                          className="flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-body outline-none data-[selected=true]:bg-hover"
                        >
                          <History className="size-3.5 text-muted-foreground" aria-hidden />
                          {q}
                        </CommandPrimitive.Item>
                      ))}
                    </CommandGroup>
                  )}
                  {openHits.length > 0 && <CommandGroup heading="Open">{openHits.map(renderHit)}</CommandGroup>}
                  {completed.length > 0 && <CommandGroup heading="Completed">{completed.map(renderHit)}</CommandGroup>}
                </CommandList>
              )}
              {trimmed && !settled && hits.length === 0 && (
                <div className="space-y-2 p-3" aria-hidden>
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              )}
              {trimmed && settled && hits.length === 0 && (
                <EmptyState
                  size="compact"
                  action={filtersOn ? (
                    <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_SEARCH_FILTERS)}>Clear filters</Button>
                  ) : undefined}
                >
                  No tasks match "{trimmed}".
                  {filtersOn && <> Filters: {activeFilterLabels(filters, labels, projects).join(' · ')}.</>}
                </EmptyState>
              )}
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
```

(Empty and loading states render **outside** `CommandList` on purpose: a `role=listbox` with no options fails axe `aria-required-children`.)

- [ ] **Step 6: ⌘K `/search` handoff**

In `apps/desktop/src/components/shared/CommandBar.tsx`:
- imports: `import { parseMode, searchHandoff } from '@/lib/commandBarMode'` and `import { useTaskSearchStore } from '@/stores/taskSearchStore'`.
- after `const inputRef = useRef<HTMLInputElement>(null)`: `const openerRef = useRef<HTMLElement | null>(null)`.
- first line of `openBar`: `openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null`.
- after `closeBar`, add:

```tsx
  // `/search ` belongs to ⌘F now (C4): close at once (no fade — two dialogs
  // must never overlap) and open search with the text, focus returning to
  // whatever ⌘K was opened from.
  const handOffToSearch = useCallback((q: string) => {
    setOpen(false)
    setClosing(false)
    setRawQuery('')
    setSelectedIndex(0)
    setBreakdownTask(null)
    setBreakdownItems([])
    useTaskSearchStore.getState().openSearch(q, openerRef.current)
  }, [])
```

- first lines of `handleChange`:

```tsx
    const handoff = searchHandoff(e.target.value)
    if (handoff !== null) {
      handOffToSearch(handoff)
      return
    }
```

  and add `handOffToSearch` to its dependency array.

> **UX checkpoint:** When does ⌘K hand `/search` to ⌘F? (a) the moment `/search ` (with the space) is typed — the default above, Raycast-style "switch to extension"; (b) only on Enter, so ⌘K briefly shows its own open-task results first; (c) drop `/search` from ⌘K and just point to ⌘F in the hint row. **Recommended: (a)** — one search surface, no two result lists that disagree about completed tasks.

- [ ] **Step 7: Mount + shortcut rows**

`Dashboard.tsx`: `import { TaskSearch } from '@/components/search/TaskSearch'` and render `<TaskSearch />` right after `<CommandBar />`.

`lib/shortcuts.ts`: add `| 'Search'` to `ShortcutSection`, append `'Search'` after `'Labels'` in `SHORTCUT_SECTIONS`, change the existing `/search` row's label to `'Search every task (switches to ⌘F)'`, and append to `SHORTCUTS`:

```ts
  // ── C4: task search (components/search/TaskSearch.tsx) ──
  { section: 'Navigation', keys: '⌘F', label: 'Search tasks, open and done' },
  { section: 'Search', keys: '↑ / ↓', label: 'Move through results' },
  { section: 'Search', keys: 'Enter', label: 'Open the task' },
  { section: 'Search', keys: '⌘Enter', label: 'Open the task in its project' },
  { section: 'Search', keys: 'Tab', label: 'Move to the filters' },
  { section: 'Search', keys: 'Escape', label: 'Close search; focus goes back' },
```

`tests/shortcuts.test.mjs`: the `SHORTCUT_SECTIONS` list now ends `…, 'Capture', 'Labels', 'Search']`; append:

```js
test('⌘F and the Search section (C4)', () => {
  assert.ok(SHORTCUTS.some((s) => s.section === 'Navigation' && s.keys === '⌘F'))
  const keys = SHORTCUTS.filter((s) => s.section === 'Search').map((s) => s.keys)
  for (const k of ['↑ / ↓', 'Enter', '⌘Enter', 'Tab', 'Escape']) assert.ok(keys.includes(k), `missing Search ${k}`)
})
```

- [ ] **Step 8: Verify**

Run: `cd apps/desktop && node --test tests/taskSearch.test.mjs tests/recentSearches.test.mjs tests/commandBarMode.test.mjs tests/shortcuts.test.mjs tests/shellShortcuts.test.mjs tests/keyGuard.test.mjs && npm run build && npm run build:web && npx eslint src 2>&1 | tail -2`
Expected: all pass; builds succeed; lint count not above the baseline.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src apps/desktop/tests
git commit -m "feat(c4): ⌘F task search overlay with filters, recents and ⌘K handoff

cmdk results in Open / Completed groups with highlighted titles and
description snippets, Status / Label / Project chips, Recent (per device,
storage-safe), debounced with stale responses dropped, Enter opens detail,
⌘Enter opens the project with the row selected, Esc restores focus.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 9: Browser QA (Playwright + axe) and whole-lane verification

**Files:**
- Create: `apps/desktop/e2e/c4-labels.spec.ts`, `apps/desktop/e2e/c4-search.spec.ts`

**Interfaces:**
- Consumes: every mock command from Tasks 1–4 (seeded through `window.__TAURI_INTERNALS__.invoke`, so the shared fixture stays untouched and existing specs see the same data); the DOM contracts listed in Tasks 6–8; `e2e/fixtures.ts` (`test`, `expect`, `expectNoNewAxeViolations`, `expectFocusRing`); DEV hatch `window.__stores` (`useAppStore`, `useDetailStore`).
- Produces: two specs. New axe keys `c4-picker`, `task-search` (and `:dark`) have **no** baseline rows, so they must be violation-free; `settings` reuses its existing baseline.

- [ ] **Step 1: Labels spec**

Create `apps/desktop/e2e/c4-labels.spec.ts`:

```ts
/*
 * C4 — grouped labels. Spec: docs/superpowers/specs/2026-09-25-c4-labels-search-design.md §3.
 * Each test seeds its taxonomy through the mock's own commands after boot:
 *   Effort (Pick one): deep-work, quick-win · Type: design, bug · Integrations (system): from-instinct
 *   errand archived · stale-idea unused · task-01 carries deep-work, design, from-instinct.
 */
import { test, expect, expectNoNewAxeViolations, expectFocusRing } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>, io?: unknown) => Promise<unknown>
type Recorded = { cmd: string; args: Record<string, unknown> | null }
type HarnessWindow = Window & { __TAURI_INTERNALS__: { invoke: Invoke }; __invokes: Recorded[] }

test.beforeEach(async ({ app, page }) => {
  void app // its init script installs the mock this wraps
  await page.addInitScript(() => {
    const w = window as unknown as HarnessWindow
    w.__invokes = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, io) => {
      w.__invokes.push({ cmd, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) })
      return orig(cmd, args, io)
    }
  })
})

const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as HarnessWindow).__invokes.filter((i) => i.cmd === c).map((i) => i.args), cmd)

async function seedTaxonomy(page: Page) {
  return page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    const effort = (await inv('create_label_group', { name: 'Effort', exclusive: true })) as { id: string }
    const type = (await inv('create_label_group', { name: 'Type', exclusive: false })) as { id: string }
    const sys = (await inv('create_label_group', { name: 'Integrations', exclusive: false })) as { id: string }
    await inv('update_label_group', { id: sys.id, patch: { system: true } })
    await inv('set_label_group', { labelId: 'label-deep-work', groupId: effort.id })
    await inv('set_label_group', { labelId: 'label-quick-win', groupId: effort.id })
    await inv('set_label_group', { labelId: 'label-design', groupId: type.id })
    await inv('set_label_group', { labelId: 'label-bug', groupId: type.id })
    const bot = (await inv('create_label', { name: 'from-instinct', color: 'gray' })) as { id: string }
    await inv('set_label_group', { labelId: bot.id, groupId: sys.id })
    const stale = (await inv('create_label', { name: 'stale-idea', color: 'gray' })) as { id: string }
    await inv('set_task_labels', { taskId: 'task-01', labelIds: ['label-deep-work', 'label-design', bot.id] })
    await inv('archive_labels', { ids: ['label-errand'] })
    window.dispatchEvent(new Event('tasks-changed'))
    return { effort: effort.id, type: type.id, stale: stale.id, bot: bot.id }
  })
}

test('picker: group sections, Pick-one radios, archived and system hidden, arrows cross sections', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedTaxonomy(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await expect(row).toBeVisible()
  await row.focus()
  await page.keyboard.press('l')
  const add = page.getByRole('button', { name: 'Add label' }).last()
  if (await add.isVisible()) await add.click()

  const effort = page.getByRole('radiogroup', { name: 'Effort' })
  const type = page.getByRole('group', { name: 'Type' })
  await expect(effort).toBeVisible()
  await expect(type).toBeVisible()
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toHaveAttribute('aria-checked', 'true')
  await effort.getByRole('radio', { name: 'quick-win' }).click()
  await expect(effort.getByRole('radio', { name: 'quick-win' })).toHaveAttribute('aria-checked', 'true')
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toHaveAttribute('aria-checked', 'false')
  // Row pickers save through dp.tasks.update → `update_local_task` with `labelIds`.
  const last = (await calls(page, 'update_local_task')).at(-1) as { labelIds: string[] }
  expect(last.labelIds).toContain('label-quick-win')
  expect(last.labelIds).not.toContain('label-deep-work')
  expect(last.labelIds).toContain(ids.bot) // the hidden system label is kept

  const list = page.locator('[role=dialog]').last()
  await expect(list.getByText('errand', { exact: true })).toHaveCount(0)
  await expect(list.getByText('from-instinct', { exact: true })).toHaveCount(0)

  const field = page.getByRole('textbox', { name: 'Search or create a label' })
  await field.focus()
  await page.keyboard.press('ArrowDown')
  await expect(effort.getByRole('radio', { name: 'deep-work' })).toBeFocused()
  await expectFocusRing(page)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(type.getByRole('checkbox', { name: 'design' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(type.getByRole('checkbox', { name: 'design' })).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(field).toBeFocused()

  await field.fill('ERRAND')
  await expect(page.getByRole('button', { name: 'Restore "errand"' })).toBeVisible()
  await expectNoNewAxeViolations(page, 'c4-picker')
})

test('row chips hide system labels; the detail shows them muted', async ({ app, page }) => {
  await app.open('tasks')
  await seedTaxonomy(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await expect(row.getByText('deep-work')).toBeVisible()
  await expect(row.getByText('from-instinct')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __stores: { useDetailStore: { getState(): { openTask(id: string): void } } } }).__stores.useDetailStore.getState().openTask('task-01'))
  await expect(page.locator('main').getByText('from-instinct')).toBeVisible()
})

test('label filter: grouped sections, system last, archived absent', async ({ app, page }) => {
  await app.open('tasks')
  await seedTaxonomy(page)
  await page.getByTestId('task-list-header').getByRole('button', { name: /^(All|\d+ filters?)$/ }).click()
  const menu = page.getByRole('menu')
  const headings = await menu.locator('[data-slot="dropdown-menu-label"]').allInnerTexts()
  const order = headings.map((h) => h.trim()).filter((h) => ['Effort', 'Type', 'Ungrouped', 'Integrations'].includes(h))
  expect(order.at(-1)).toBe('Integrations')
  expect(order.indexOf('Effort')).toBeLessThan(order.indexOf('Type'))
  await expect(menu.getByRole('menuitem', { name: 'errand' })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'from-instinct' })).toBeVisible()
})

test('Label Manager: ⌥↑ moves a label into the group above, Pick one, archive unused + Undo, restore, group delete Undo', async ({ app, page }) => {
  await app.open('settings', 'settings=tasks')
  const ids = await seedTaxonomy(page)
  const section = page.locator('#labels')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByRole('textbox', { name: 'Group name Effort' })).toBeVisible()

  // bug sits under design in Type: ⌥↑ reorders inside Type, a second ⌥↑ crosses into Effort.
  const grip = section.getByRole('button', { name: 'Drag label bug' })
  await grip.focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(grip).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(async () => (await calls(page, 'set_label_group')).at(-1)).toEqual({ labelId: 'label-bug', groupId: ids.effort })
  expect((await calls(page, 'reorder_labels')).length).toBeGreaterThan(0)

  await section.getByRole('switch', { name: 'Pick one in Type' }).click()
  await expect.poll(async () => (await calls(page, 'update_label_group')).at(-1)).toEqual({ id: ids.type, patch: { exclusive: true } })

  await section.getByRole('button', { name: 'Archive unused' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Archive 1 label with no open tasks?')
  await expect(confirm).toContainText('They stay on completed tasks and you can restore them.')
  await confirm.getByRole('button', { name: 'Archive 1' }).click()
  await expect.poll(async () => (await calls(page, 'archive_labels')).at(-1)).toEqual({ ids: [ids.stale] })
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Archived 1 label' }).getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await calls(page, 'restore_labels')).at(-1)).toEqual({ ids: [ids.stale] })

  await section.getByRole('button', { name: /^Archived/ }).click()
  await section.getByRole('button', { name: 'Restore errand' }).click()
  await expect.poll(async () => (await calls(page, 'restore_labels')).at(-1)).toEqual({ ids: ['label-errand'] })

  await section.getByRole('button', { name: 'More for group Type' }).click()
  await page.getByRole('menuitem', { name: 'Delete group' }).click()
  await expect(section.getByRole('textbox', { name: 'Group name Type' })).toHaveCount(0)
  await expect(section.getByRole('textbox', { name: 'Rename design' })).toBeVisible() // now under Ungrouped
  await page.locator('[data-sonner-toast]').filter({ hasText: /Group "Type" deleted/ }).getByRole('button', { name: 'Undo' }).click()
  await expect(section.getByRole('textbox', { name: 'Group name Type' })).toBeVisible()
  expect(await calls(page, 'delete_label_group')).toEqual([])

  await expectNoNewAxeViolations(page, 'settings')
})
```

- [ ] **Step 2: Search spec**

Create `apps/desktop/e2e/c4-search.spec.ts`:

```ts
/*
 * C4 — ⌘F task search. Spec §4.3. Seeds three "zephyr" tasks through the mock:
 * an open title match, an open description match, a completed title match.
 */
import { test, expect, expectNoNewAxeViolations, expectFocusRing } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
type Win = Window & {
  __TAURI_INTERNALS__: { invoke: Invoke }
  __stores: {
    useDetailStore: { getState(): { target: { type: string; id: string } | null } }
    useAppStore: { getState(): { currentPage: string } }
  }
}

async function seedSearch(page: Page) {
  return page.evaluate(async () => {
    const inv = (window as unknown as Win).__TAURI_INTERNALS__.invoke
    const title = (await inv('create_local_task', { content: 'Zephyr deck review', projectId: 'proj-portfolio' })) as { id: string }
    const desc = (await inv('create_local_task', {
      content: 'Email Jo', description: 'Ask about the zephyr deck before Friday', projectId: 'proj-life',
    })) as { id: string }
    const done = (await inv('create_local_task', { content: 'Old zephyr draft', projectId: 'proj-portfolio' })) as { id: string }
    await inv('update_task_status', { id: done.id, status: 'complete' })
    window.dispatchEvent(new Event('tasks-changed'))
    return { title: title.id, desc: desc.id, done: done.id }
  })
}

const search = (page: Page) => page.getByRole('dialog', { name: 'Search tasks' })
const input = (page: Page) => search(page).getByRole('combobox', { name: 'Search tasks' })

async function openAndType(page: Page, q: string) {
  await page.keyboard.press('Meta+f')
  await expect(search(page)).toBeVisible()
  await input(page).fill(q)
}

test('open results first, completed after, highlights and a description snippet', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  const open = search(page).getByRole('group', { name: 'Open' })
  const completed = search(page).getByRole('group', { name: 'Completed' })
  await expect(open.getByRole('option')).toHaveCount(2)
  await expect(open.getByRole('option').first()).toContainText('Zephyr deck review')
  await expect(open.getByRole('option').nth(1)).toContainText('about the zephyr deck')
  await expect(open.getByRole('option').nth(1).locator('mark')).toHaveText('zephyr')
  await expect(completed.getByRole('option')).toHaveCount(1)
  await expect(completed.getByRole('option').first()).toContainText(/Old zephyr draft\s*[A-Z][a-z]{2} \d{1,2}/)
  await expectNoNewAxeViolations(page, 'task-search')
})

test('↓ then Enter opens the task in detail and closes search', async ({ app, page }) => {
  await app.open('tasks')
  const ids = await seedSearch(page)
  await openAndType(page, 'zeph')
  await expect(search(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(search(page)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__stores.useDetailStore.getState().target?.id)).toBe(ids.desc)
})

test('⌘Enter opens the project with the row selected', async ({ app, page }) => {
  await app.open('today')
  const ids = await seedSearch(page)
  await openAndType(page, 'zephyr deck review')
  await expect(search(page).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Meta+Enter')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__stores.useAppStore.getState().currentPage)).toBe('tasks')
  await expect(page.locator(`main [data-nav-row="${ids.title}"]`)).toBeFocused()
})

test('Escape closes and returns focus to where ⌘F was pressed', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  const row = page.locator('main [data-nav-row="task-01"]')
  await row.focus()
  await page.keyboard.press('Meta+f')
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search(page)).toHaveCount(0)
  await expect(row).toBeFocused()
})

test('filters: Tab reaches the chips; Completed narrows; no results lists filters and clears them', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  await page.keyboard.press('Tab')
  const status = search(page).getByRole('button', { name: /^Status:/ })
  await expect(status).toBeFocused()
  await expectFocusRing(page)
  await page.keyboard.press('Enter')
  await page.getByRole('menuitemradio', { name: 'Completed' }).click()
  await expect(search(page).getByRole('group', { name: 'Open' })).toHaveCount(0)
  await expect(search(page).getByRole('group', { name: 'Completed' }).getByRole('option')).toHaveCount(1)

  await input(page).fill('qqqzzz')
  await expect(search(page)).toContainText('No tasks match "qqqzzz". Filters: Completed.')
  await search(page).getByRole('button', { name: 'Clear filters' }).click()
  await expect(status).toHaveAccessibleName('Status: Any status')
})

test('⌘K "/search " hands over to ⌘F; ⌘F stays shut while another overlay is open', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await page.keyboard.press('Meta+k')
  const bar = page.getByRole('dialog', { name: 'Command bar' })
  await expect(bar).toBeVisible()
  await page.keyboard.press('Meta+f')
  await expect(search(page)).toHaveCount(0)
  await page.keyboard.type('/search ')
  await expect(bar).toHaveCount(0)
  await expect(input(page)).toBeFocused()
  await page.keyboard.type('zeph')
  await expect(search(page).getByRole('option').first()).toContainText('Zephyr deck review')
})

test('recent searches show on an empty query', async ({ app, page }) => {
  await app.open('tasks')
  await seedSearch(page)
  await openAndType(page, 'zeph')
  await expect(search(page).getByRole('option').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(search(page)).toHaveCount(0)
  await page.keyboard.press('Meta+f')
  const recent = search(page).getByRole('group', { name: 'Recent' })
  await expect(recent.getByRole('option', { name: 'zeph' })).toBeVisible()
})
```

(If `getByRole('group', { name: 'Open' })` does not resolve because cmdk labels its item container with the hidden heading's id, use `search(page).locator('[cmdk-group]').filter({ hasText: 'Open' })` — the assertion intent is "results are split into an Open and a Completed group, in that order".)

- [ ] **Step 3: Run the new specs against a frozen build**

```bash
git add apps/desktop/e2e/c4-labels.spec.ts apps/desktop/e2e/c4-search.spec.ts
git commit -m "test(c4): e2e for grouped labels and ⌘F search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
tools/qa-frozen.sh "$(git rev-parse HEAD)" "$TMPDIR/nimble-qa-c4" 4624
cd "$TMPDIR/nimble-qa-c4/apps/desktop" && BASE_URL=http://localhost:4624 npx playwright test -c e2e c4-
```

Expected: every `c4-` test passes in light theme. Then run both themes for axe: `BASE_URL=http://localhost:4624 npx playwright test -c e2e c4- --project webkit` (the fixture's `theme` option defaults to light; if a dark pass is wanted, add `test.use({ theme: 'dark' })` in a `for (const theme of ['light','dark'])` wrapper like `harness.spec.ts`, with keys `c4-picker:dark` / `task-search:dark` — also baseline-free). A failing spec is fixed in the owning task's code, then re-frozen at the new commit (the frozen copy is read-only by design).

- [ ] **Step 4: Whole-lane regression pass**

Run, from the worktree root unless noted:
1. `cargo test --workspace --offline` → PASS.
2. `cd apps/desktop && node --test tests/*.test.mjs src/lib/*.test.mjs src/services/turso/*.test.mjs` → PASS.
3. `cd apps/desktop && npm run build && npm run build:web` → both succeed.
4. `cd apps/desktop && npx eslint src 2>&1 | tail -2` → problem count ≤ the baseline recorded before Task 6.
5. Full e2e against the frozen build: `cd "$TMPDIR/nimble-qa-c4/apps/desktop" && BASE_URL=http://localhost:4624 npx playwright test -c e2e` → every existing spec (t1 picker selectors, t2 `l` key, t4 label delete Undo, harness axe baselines) still passes.
6. Stop the preview: `kill "$(cat "$TMPDIR/nimble-qa-c4/preview.pid")"`.

Expected: all green. Record the counts (Rust tests, node tests, e2e) in the final report.

- [ ] **Step 5: Commit any fixes, then stop**

Only commits for fixes found in Steps 3–4 (same message style). Do **not** merge, install, run `tools/seed-label-groups.sh`, or rebuild `~/.local/bin/dt` — the controller does that with Marco.

---

## Handoff: real-app exit test (Marco, after install)

From spec §5, run after install, the `dt` rebuild and the seed script (with the Task 5 UX checkpoint answered):
1. The picker shows EFFORT / TYPE / STATE / ASSIST, EFFORT as radios (pick one).
2. `from-instinct` and `nimble` chips are gone from task rows; the detail shows them muted.
3. ⌘F "portfolio" returns open tasks first and at least one completed task, with description snippets; results appear in well under 50 ms.
4. `dt task search edd --status completed --json` returns completed EDD tasks.
5. Dev log after launch shows either nothing or one "Task search index rebuilt" line (never an index warning).

## Spec deviations (decided in this plan; flag in review)

- **Hook point:** the index is maintained in `db/task_tx.rs` (the real funnel `db/tasks.rs` delegates to, also used by the focus engine and import) and in `TaskWrite::commit` (every incoming apply), not in `tasks.rs` itself. Status changes need no hook — the index holds text only. Raw bulk writers (`migrate_tasks_to_markdown`, the legacy Todoist importer) rebuild after they run.
- **Web label writes stay `ni()`** (spec §3.3 says TursoProvider implements all). The web write path requires full-row `sync_log` snapshots per table (`services/turso/mutations.ts`), and the existing web `labels.create/update/delete` are already `ni()`. Web gets the reads (`labels.list` with `archived_at`, `groups.list`, `unusedIds`) and `tasks.search`.
- **Additions the UI needs:** `labels.reorder(ids)` / `reorder_labels` (drag ordering within and across groups), `restore_labels(ids)` plural (exact Undo of "Archive unused"), `dt label unused` and `dt label group list` (seed script before/after counts).
- **`matched_in = "title"`** means the title alone contains every query token; otherwise the hit is a description match and carries a snippet.
- **FTS syntax characters become spaces inside a token** (so `follow-up` stays a phrase) instead of being deleted, and tokens with no letter or digit are dropped (so `portfolio &` still matches).
