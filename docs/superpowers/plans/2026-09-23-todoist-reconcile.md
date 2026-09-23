# Todoist Reconcile + Task Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Nimble's tasks back into exact agreement with Todoist, store Todoist's sections and project nesting as real structure instead of fake projects, tag every Nimble-born task with a filterable `nimble` label (temporary; deleted at cutover), and make a failing sync visible.

**Architecture:** The ongoing Todoist pull/push (`nimble-core/src/integrations/todoist/`) learns real sections (`sections` table + `local_tasks.section_id`), project nesting (`projects.parent_id`) and archiving (`projects.archived_at`, new). A one-time `reconcile` module fetches a full Todoist snapshot, then:
- converts the legacy fake section projects (`external_id = 'section:…'`)
- merges the duplicate Inbox
- closes, deletes or archives the tasks Todoist no longer has active, using a per-task status lookup

It runs as a dry run first. The "apply" step comes behind a backup. The UI hides archived projects, gains a label filter and shows sync health.

**Tech Stack:** Rust (sqlx/SQLite, tokio, reqwest via `client.rs`), Tauri 2, React + TypeScript (Vite), `dt` CLI (clap), Turso replication (`db/sync.rs`).

**Spec:** `docs/2026-09-23-task-cleanup-proposal.md` (approved 2026-09-23. Decisions: stale tasks → **match Todoist** (completed→completed, deleted→deleted); new Nimble tasks **keep pushing to Todoist** until cutover).

## Global Constraints

- Schema goes 21 → **22** and adds only `projects.archived_at TEXT` (NULL = active). The new column must ride sync snapshots and the Turso remote schema, following the path `sync_policy` took (commit `9fd6d88`). Otherwise another device blanks it: receivers apply snapshots with `INSERT OR REPLACE`.
- **Origin is a label, not a column** (Marco, 2026-09-23). It's a normal label named `nimble`, auto-applied to tasks created in Nimble **only while Todoist sync is enabled**. It syncs to Todoist like any label. At cutover the auto-apply stops by itself, and Marco deletes the label. Todoist-born tasks get **no** label: tagging 935 tasks would push 935 updates and clutter both apps. "From Todoist" = open linked tasks without `nimble`.
- Pull writes never enqueue outbox ops (no echo). Local CRUD writes do, unless `sync_policy = 'local_only'`.
- The snapshot key format stays `"section:{id}"` in `TaskSnapshot.project_external_id`. Existing `synced_snapshot` rows keep comparing equal. Do not migrate snapshots.
- Never `DELETE` a project row that still owns tasks: `local_tasks.project_id` is `ON DELETE CASCADE`. Move tasks first, or archive instead.
- Todoist per-task status: `GET https://api.todoist.com/api/v1/tasks/{id}` returns `checked`, `is_deleted`, `project_id`. It is probed and confirmed for completed, deleted and archived-project tasks. HTTP 404 is treated as deleted.
- No-guilt copy (project CLAUDE.md): no "overdue"/"failed" shaming. Sync errors read as neutral status ("Todoist sync paused — token was rejected").
- Todoist stays the source of truth until cutover. Nothing in this plan disables push.

## Review Focus

1. **A task inside a Todoist section that the user edits in Nimble** (content only) must not generate an `item_move`, and on the next pull must not bounce projects. Expected: the snapshot's `project_external_id` is still `section:X` and the merge sees no project change. Pinned by a test in Task 2.
2. **A fake section project holding completed tasks whose Todoist section was since deleted.** Expected: its tasks are not lost. The row is archived, not deleted. Pinned in Task 4.
3. **A stale task in a project archived in Todoist** (like "Work Tasks ARCHIVE"). Expected: it stays open and its project is archived and hidden. It is not closed. Pinned in Task 4.
4. **Todoist Inbox has a separate linked row (`de55e58f…`) besides native `inbox`.** Expected: after reconcile there is exactly one Inbox, with id `inbox` and external_id = Todoist inbox id, holding all tasks from both. Pinned in Task 4.
5. **A reconcile apply interrupted halfway** (network drop during status lookups). Expected: no writes happen until every lookup has finished. The apply is a single transaction, so a failure leaves the DB untouched. Pinned in Task 4.

---

## File map

| File | Responsibility | Tasks |
|---|---|---|
| `nimble-core/src/db/migrations.rs` | v22: `archived_at` | 1 |
| `nimble-core/src/types.rs`, `db/projects.rs`, `db/sync.rs`, `db/export_policy.rs` | carry `archived_at` everywhere project `parent_id` already goes | 1 |
| `packages/types/src/index.ts`, `apps/desktop/src/services/turso/*.ts` | TS type + web replica column | 1 |
| `nimble-core/src/db/tasks.rs`, `nimble-core/src/db/origin_label.rs` (new) | auto-apply + backfill the `nimble` label | 1 |
| `nimble-core/src/integrations/todoist/sync_loop.rs` | pull: nesting, rename, archive, real sections, section-aware items | 2 |
| `nimble-core/src/integrations/todoist/mappers.rs` | `project_ref_for_task()` helper (section-aware external ref) | 2 |
| `nimble-core/src/integrations/todoist/observer.rs`, `sync_loop.rs` (push half) | push: `section_local_id` in create/move payloads | 3 |
| `nimble-core/src/integrations/todoist/reconcile.rs` (new), `client.rs` | full snapshot + status lookup + plan + apply | 4 |
| `tools/dt/src/args.rs`, `tools/dt/src/commands/mod.rs` | `dt sync reconcile [--apply]` | 4 |
| `apps/desktop/src/components/settings/TodoistSyncSection.tsx`, new `components/shared/SyncHealthBanner.tsx` | sync health | 5 |
| `apps/desktop/src/components/tasks/ProjectSidebar.tsx`, `hooks/useLocalTasks.ts`, `components/tasks/TaskListHeader.tsx`, task-list filtering | hide archived, label filter | 6 |
| `NEXT.md`, `docs/2026-09-23-task-cleanup-proposal.md` | evidence | 7 |

---

### Task 1: Schema v22 (`archived_at`) + the `nimble` origin label

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append v22, bump `CURRENT_SCHEMA_VERSION` to 22, and update the `run_migrations_to_version` range guard if it hard-codes 21)
- Modify: every file listed by `grep -rln "parent_id" nimble-core/src/types.rs nimble-core/src/db/projects.rs nimble-core/src/db/sync.rs nimble-core/src/db/export_policy.rs packages/types/src apps/desktop/src/services/turso` that handles **project** rows. Add `archived_at` beside project `parent_id`.
- Create: `nimble-core/src/db/origin_label.rs` (+ `pub mod origin_label;` in `db/mod.rs`)
- Modify: `nimble-core/src/db/task_tx.rs` `create_task_with_id_tx` (auto-apply hook)
- Test: `nimble-core/tests/schema22_origin_label.rs` (new; if `test_util` isn't visible to integration tests, put the tests in `origin_label.rs` `#[cfg(test)]` with `crate::` paths. See how `schema20_compatibility.rs` gets its pool.)

**Interfaces:**
- Produces: `Project.archived_at: Option<String>` (Rust) / `archived_at: string | null` (TS).
- Produces: `pub const ORIGIN_LABEL: &str = "nimble";` and `pub async fn backfill_origin_label(pool: &SqlitePool) -> crate::Result<usize>` in `db::origin_label`.
- Behaviour: `create_task_with_id_tx` with `MutationPolicy::User` (the Nimble UI, `dt`, capture routing) adds `ORIGIN_LABEL` to the task's labels **iff** `integration_sync_state.enabled = 1` for `todoist` **and** `settings.todoist_api_token` is non-empty. Pull-created tasks never get it: they don't go through `create_task_tx`, since the pull inserts rows directly.

- [ ] **Step 1: Write the failing tests**

```rust
use nimble_core::test_util::test_pool;
use nimble_core::db::{origin_label, tasks, labels};

async fn enable_todoist(pool: &sqlx::SqlitePool) {
    nimble_core::integrations::ensure_state(pool, "todoist").await.unwrap();
    sqlx::query("UPDATE integration_sync_state SET enabled = 1 WHERE provider='todoist'").execute(pool).await.unwrap();
    nimble_core::db::settings::set_setting(pool, "todoist_api_token", "tok").await.unwrap();
}

#[tokio::test]
async fn v22_adds_archived_at() {
    let pool = test_pool().await;
    let v: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version").fetch_one(&pool).await.unwrap();
    assert_eq!(v, 22);
    let p = nimble_core::db::projects::get_projects(&pool).await.unwrap();
    assert!(p.iter().find(|p| p.id == "inbox").unwrap().archived_at.is_none());
}

#[tokio::test]
async fn nimble_created_task_gets_origin_label_while_todoist_sync_is_on() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    let t = tasks::create_local_task(&pool, serde_json::from_value(serde_json::json!({"content": "made here"})).unwrap()).await.unwrap();
    let names = labels::labels_for_task(&pool, &t.id).await.unwrap();
    assert!(names.contains(&origin_label::ORIGIN_LABEL.to_string()), "got {names:?}");
}

#[tokio::test]
async fn no_origin_label_when_todoist_sync_is_off() {
    // After cutover (sync off / no token) the auto-label stops by itself.
    let pool = test_pool().await;
    let t = tasks::create_local_task(&pool, serde_json::from_value(serde_json::json!({"content": "post cutover"})).unwrap()).await.unwrap();
    assert!(labels::labels_for_task(&pool, &t.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn origin_label_merges_with_user_labels() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    let admin = labels::create_label(&pool, "admin", "#888888").await.unwrap();
    let t = tasks::create_local_task(&pool, serde_json::from_value(serde_json::json!({"content": "x", "label_ids": [admin.id]})).unwrap()).await.unwrap();
    let mut names = labels::labels_for_task(&pool, &t.id).await.unwrap();
    names.sort();
    assert_eq!(names, vec!["admin".to_string(), "nimble".to_string()]);
}

#[tokio::test]
async fn backfill_labels_only_unlinked_tasks_and_is_idempotent() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO local_tasks (id, content, project_id) VALUES ('n1','native','inbox')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO local_tasks (id, content, project_id, completed, status) VALUES ('n2','native done','inbox',1,'complete')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO local_tasks (id, content, project_id, external_id, external_source) VALUES ('t1','from todoist','inbox','R1','todoist')").execute(&pool).await.unwrap();
    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 2);
    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 0);
    assert!(labels::labels_for_task(&pool, "t1").await.unwrap().is_empty());
    assert_eq!(labels::labels_for_task(&pool, "n2").await.unwrap(), vec!["nimble".to_string()]);
}
```

`CreateTaskInput` may not deserialize from JSON. If it doesn't, build it with the struct literal and `..Default::default()` if it derives `Default`, else set the needed fields explicitly. Copy how existing `tasks.rs` tests construct it.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p nimble-core --test schema22_origin_label`
Expected: FAIL (version 21, and there's no `origin_label` module).

- [ ] **Step 3: Add migration v22**

```rust
Migration {
    version: 22,
    description: "Project archiving",
    sql: "ALTER TABLE projects ADD COLUMN archived_at TEXT",
},
```

Carry `archived_at` through `types.rs` `Project` (serde default None), the `db/projects.rs` select list and row mapping (not the create/update inputs), the `db/sync.rs` remote `projects` DDL, and a gated remote ALTER. Mirror the `turso_schema_v<N>_upgraded` pattern the `sync_policy` ALTER uses near line 795: `ALTER TABLE projects ADD COLUMN archived_at TEXT` behind a `turso_schema_v22_upgraded` setting. Also carry it through the project sync snapshot, `export_policy.rs`, TS `Project`, and the turso web project mapping.

- [ ] **Step 4: Implement `origin_label.rs` and the hook**

```rust
//! Temporary provenance marker for the Todoist → Nimble migration (2026-09-23).
//! While Todoist sync is on, every task created in Nimble carries the `nimble`
//! label so it can be filtered (and seen in Todoist too). After cutover the
//! hook goes quiet on its own; delete the label to remove every trace.
use sqlx::{SqliteConnection, SqlitePool};

pub const ORIGIN_LABEL: &str = "nimble";
const ORIGIN_LABEL_COLOR: &str = "#8b8b8b";

pub(crate) async fn todoist_sync_on_tx(conn: &mut SqliteConnection) -> crate::Result<bool> {
    let enabled: Option<i64> = sqlx::query_scalar("SELECT enabled FROM integration_sync_state WHERE provider = 'todoist'")
        .fetch_optional(&mut *conn).await?;
    let token: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'todoist_api_token'")
        .fetch_optional(&mut *conn).await?;
    Ok(enabled == Some(1) && token.map(|t| !t.trim().is_empty()).unwrap_or(false))
}

/// Returns the label id, creating the label on first use.
pub(crate) async fn origin_label_id_tx(conn: &mut SqliteConnection) -> crate::Result<String> {
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT id FROM labels WHERE name = ?")
        .bind(ORIGIN_LABEL).fetch_optional(&mut *conn).await? {
        return Ok(id);
    }
    create_label_tx(conn, ORIGIN_LABEL, ORIGIN_LABEL_COLOR).await
}

pub async fn backfill_origin_label(pool: &SqlitePool) -> crate::Result<usize> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let label_id = origin_label_id_tx(&mut tx).await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM local_tasks t WHERE t.external_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)",
    ).bind(&label_id).fetch_all(&mut *tx).await?;
    for id in &ids {
        sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
            .bind(id).bind(&label_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    for id in &ids {
        // sync_log so the web replica sees it; composite row id helper lives in db::sync
        crate::db::sync::append_sync_log(pool, "task_labels", &crate::db::sync::task_labels_row_id(id, &label_id), "INSERT", None).await.ok();
    }
    Ok(ids.len())
}
```

Also write the private fn `create_label_tx(conn: &mut SqliteConnection, name: &str, color: &str) -> crate::Result<String>` in `origin_label.rs`. It runs the exact INSERT that `db::labels::create_label` runs (read it: id, name, color, position) plus the matching `append_sync_log_tx`. Check `append_sync_log`'s real signature in `db/sync.rs` (~line 44) and adapt the call above to it.

Backfill touches only **unlinked** tasks. They have never been pushed, so there is no remote label to fight. The two queued creates are unlinked: their pending outbox `create` must carry the label too. After inserting the label for a task that has a pending `create` row in `todoist_outbox`, set `payload_json = json_set(payload_json, '$.labels', json_array('nimble'))` on that row, merging with any existing `labels` array. Tasks the 2026-04-17 import linked, and tasks with a completed push, stay unlabeled. That's a known, accepted gap: sync_log provenance was pruned.

Hook in `task_tx::create_task_with_id_tx`, right where it applies `input.label_ids` (read the function; labels are set inside the same tx): if `policy` is `MutationPolicy::User` and `origin_label::todoist_sync_on_tx(conn).await?`, append `origin_label_id_tx(conn).await?` to the label id set before writing `task_labels`. The existing observer create payload reads `labels` from the task, so the label also reaches Todoist. Confirm that by extending the observer test: the create payload `labels` contains `"nimble"`.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p nimble-core` then `cd apps/desktop && npm run build` (the real type check; `tsc --noEmit` checks nothing here).
Expected: PASS. Update `schema20_compatibility.rs` only where it asserts the latest version.

- [ ] **Step 6: Commit**

```bash
git add -A nimble-core packages/types apps/desktop/src/services
git commit -m "feat: v22 project archived_at + temporary 'nimble' origin label"
```

---

### Task 2: Pull — nesting, archiving, real sections, section-aware tasks

**Files:**
- Modify: `nimble-core/src/integrations/todoist/client.rs` (add `parent_id: Option<String>` to `TodoistProject`, `#[serde(default)]`)
- Modify: `nimble-core/src/integrations/todoist/mappers.rs` (new helper)
- Modify: `nimble-core/src/integrations/todoist/sync_loop.rs` `apply_pull_tx` §1 projects, §2 sections, §3 items
- Test: `sync_loop.rs` `#[cfg(test)]` pull test module (same style as `new_remote_item_creates_native_task`)

**Interfaces:**
- Produces: `mappers::project_ref_for_task(project_ext: Option<String>, section_ext: Option<String>) -> Option<String>` returns `Some(format!("section:{s}"))` when `section_ext` is `Some(s)`, else `project_ext`.
- Produces: `sync_loop::resolve_remote_ref_tx(tx, ext: &str) -> Result<Option<(String /*project_id*/, Option<String> /*section_id*/)>>`. `"section:{id}"` → `(sections.project_id, Some(sections.id))`. A plain id → `(projects.id, None)`.
- Produces: `sync_loop::local_project_ref_tx(tx, task: &LocalTask) -> Result<Option<String>>`, the task's current remote ref (section-aware), used by both pull merge and push ctx.

- [ ] **Step 1: Write the failing tests**

```rust
#[tokio::test]
async fn pull_nests_projects_and_stores_sections_as_sections() {
    let pool = test_pool().await;
    apply_pull(&pool, &resp(json!({
        "sync_token": "T1",
        "projects": [
            {"id": "P", "name": "Personal"},
            {"id": "C", "name": "Finance", "parent_id": "P"}
        ],
        "sections": [{"id": "S", "project_id": "C", "name": "Receivables"}],
        "items": [{"id": "R1", "content": "Invoice", "project_id": "C", "section_id": "S", "checked": false, "is_deleted": false}]
    }))).await.unwrap();

    let projects = crate::db::projects::get_projects(&pool).await.unwrap();
    let p = projects.iter().find(|p| p.external_id.as_deref() == Some("P")).unwrap();
    let c = projects.iter().find(|p| p.external_id.as_deref() == Some("C")).unwrap();
    assert_eq!(c.parent_id.as_deref(), Some(p.id.as_str()));
    assert!(projects.iter().all(|p| !p.external_id.as_deref().unwrap_or("").starts_with("section:")),
        "no fake section projects");

    let sections = crate::db::sections::list_sections(&pool, &c.id).await.unwrap();
    assert_eq!(sections.len(), 1);
    assert_eq!(sections[0].external_id.as_deref(), Some("S"));

    let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
    let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
    assert_eq!(t.project_id, c.id);
    assert_eq!(t.section_id.as_deref(), Some(sections[0].id.as_str()));
}

#[tokio::test]
async fn pull_renames_and_archives_projects_and_renames_sections() {
    let pool = test_pool().await;
    apply_pull(&pool, &resp(json!({"sync_token": "T1",
        "projects": [{"id": "P", "name": "Old"}],
        "sections": [{"id": "S", "project_id": "P", "name": "Lane"}]}))).await.unwrap();
    apply_pull(&pool, &resp(json!({"sync_token": "T2",
        "projects": [{"id": "P", "name": "New", "is_archived": true}],
        "sections": [{"id": "S", "project_id": "P", "name": "Lane 2"}]}))).await.unwrap();
    let p = crate::db::projects::get_projects(&pool).await.unwrap().into_iter().find(|p| p.external_id.as_deref() == Some("P")).unwrap();
    assert_eq!(p.name, "New");
    assert!(p.archived_at.is_some());
    let s = crate::db::sections::list_sections(&pool, &p.id).await.unwrap();
    assert_eq!(s[0].name, "Lane 2");
    // unarchive
    apply_pull(&pool, &resp(json!({"sync_token": "T3", "projects": [{"id": "P", "name": "New", "is_archived": false}]}))).await.unwrap();
    let p = crate::db::projects::get_projects(&pool).await.unwrap().into_iter().find(|p| p.external_id.as_deref() == Some("P")).unwrap();
    assert!(p.archived_at.is_none());
}

#[tokio::test]
async fn section_task_local_content_edit_does_not_look_like_a_move() {
    // Review Focus #1
    let pool = test_pool().await;
    let first = json!({"sync_token": "T1",
        "projects": [{"id": "P", "name": "Work"}],
        "sections": [{"id": "S", "project_id": "P", "name": "Lane"}],
        "items": [{"id": "R1", "content": "A", "project_id": "P", "section_id": "S", "checked": false, "is_deleted": false, "updated_at": "2026-09-01T00:00:00Z"}]});
    apply_pull(&pool, &resp(first)).await.unwrap();
    let before = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap().into_iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
    // Remote-only content change, same section:
    apply_pull(&pool, &resp(json!({"sync_token": "T2",
        "items": [{"id": "R1", "content": "B", "project_id": "P", "section_id": "S", "checked": false, "is_deleted": false, "updated_at": "2026-09-02T00:00:00Z"}]}))).await.unwrap();
    let after = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap().into_iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
    assert_eq!(after.content, "B");
    assert_eq!(after.project_id, before.project_id);
    assert_eq!(after.section_id, before.section_id);
    let snap: crate::integrations::todoist::mappers::TaskSnapshot = serde_json::from_str(after.synced_snapshot.as_deref().unwrap()).unwrap();
    assert_eq!(snap.project_external_id.as_deref(), Some("section:S"));
}

#[tokio::test]
async fn remote_section_move_updates_project_and_section() {
    let pool = test_pool().await;
    apply_pull(&pool, &resp(json!({"sync_token": "T1",
        "projects": [{"id": "P", "name": "Work"}, {"id": "Q", "name": "Home"}],
        "sections": [{"id": "S", "project_id": "Q", "name": "Chores"}],
        "items": [{"id": "R1", "content": "A", "project_id": "P", "checked": false, "is_deleted": false, "updated_at": "2026-09-01T00:00:00Z"}]}))).await.unwrap();
    apply_pull(&pool, &resp(json!({"sync_token": "T2",
        "items": [{"id": "R1", "content": "A", "project_id": "Q", "section_id": "S", "checked": false, "is_deleted": false, "updated_at": "2026-09-02T00:00:00Z"}]}))).await.unwrap();
    let projects = crate::db::projects::get_projects(&pool).await.unwrap();
    let q = projects.iter().find(|p| p.external_id.as_deref() == Some("Q")).unwrap();
    let t = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap().into_iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
    assert_eq!(t.project_id, q.id);
    assert!(t.section_id.is_some());
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cargo test -p nimble-core pull_nests_projects pull_renames section_task_local remote_section_move`
Expected: FAIL (fake section projects are created, and there's no `parent_id` or `archived_at`).

- [ ] **Step 3: Implement**

`mappers.rs`:

```rust
/// The Todoist-side location key for a task: "section:{id}" when the task sits
/// in a synced section, else the project's external id. Kept identical to the
/// pre-v22 snapshot format so stored `synced_snapshot`s still compare equal.
pub fn project_ref_for_task(project_ext: Option<String>, section_ext: Option<String>) -> Option<String> {
    match section_ext {
        Some(s) => Some(format!("section:{s}")),
        None => project_ext,
    }
}
```

`sync_loop.rs`, add near `find_task_by_external`:

```rust
pub(crate) async fn resolve_remote_ref_tx(
    tx: &mut sqlx::SqliteConnection, ext: &str,
) -> crate::Result<Option<(String, Option<String>)>> {
    if let Some(section_ext) = ext.strip_prefix("section:") {
        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT project_id, id FROM sections WHERE external_source = 'todoist' AND external_id = ?",
        ).bind(section_ext).fetch_optional(&mut *tx).await?;
        return Ok(row.map(|(p, s)| (p, Some(s))));
    }
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
    ).bind(ext).fetch_optional(&mut *tx).await?;
    Ok(row.map(|(p,)| (p, None)))
}

pub(crate) async fn local_project_ref_tx(
    tx: &mut sqlx::SqliteConnection, task: &crate::types::LocalTask,
) -> crate::Result<Option<String>> {
    let project_ext: Option<String> = sqlx::query_scalar("SELECT external_id FROM projects WHERE id = ?")
        .bind(&task.project_id).fetch_optional(&mut *tx).await?.flatten();
    let section_ext: Option<String> = match &task.section_id {
        Some(sid) => sqlx::query_scalar("SELECT external_id FROM sections WHERE id = ?")
            .bind(sid).fetch_optional(&mut *tx).await?.flatten(),
        None => None,
    };
    Ok(mappers::project_ref_for_task(project_ext, section_ext))
}
```

`apply_pull_tx` §1 projects:
- Deleted → skip, as today.
- Archived → do **not** `continue`. Upsert the row as below, then `UPDATE projects SET archived_at = COALESCE(archived_at, datetime('now','localtime')) WHERE id = ?`.
- Not archived → `SET archived_at = NULL`.
- Replace the name-only update with `UPDATE projects SET name = ?, archived_at = ? WHERE id = ? AND (name != ? OR archived_at IS NOT ?)`, and push `(local_id,"UPDATE")` when rows change.
- After the loop, run a second pass that sets `parent_id` for every project in `resp.projects` with a `parent_id`: `UPDATE projects SET parent_id = (SELECT id FROM projects WHERE external_source='todoist' AND external_id = ?) WHERE external_source='todoist' AND external_id = ? AND parent_id IS NOT (SELECT id FROM projects WHERE external_source='todoist' AND external_id = ?)`. Push `(id,"UPDATE")` on change.
- For projects whose `parent_id` is null in the payload, set `parent_id = NULL`. The payload is authoritative for projects it contains.

§2 sections, replacing the pseudo-project block entirely:
- Resolve the parent project local id. Skip the section if the parent is unknown.
- If `s.is_deleted`: delete the `sections` row only if no `local_tasks` reference it. Otherwise leave it for the item deltas to empty.
- Otherwise upsert into `sections (id, project_id, name, position, external_id, external_source)` keyed by `(external_source='todoist', external_id=s.id)`, updating `name` and `project_id` when they differ.
- Record the sync_log op the same way `db::sections::create_section` / `rename_section` do. Read those functions and call the same `append_sync_log_tx` with a section snapshot. Do **not** call the observer.

§3 items:
- On insert, replace the project lookup with `resolve_remote_ref_tx(tx, ext)`. If it fails, fall back to `("inbox", None)`. Bind `section_id` in the INSERT (add it to the column list).
- On merge, replace `project_ext_of_local` with `local_project_ref_tx(tx, &local_task).await?`.
- When `plan.project_external_id` is `Some(ext)`: `resolve_remote_ref_tx` → `UPDATE local_tasks SET project_id = ?, section_id = ? WHERE id = ?`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p nimble-core`
Expected: all pass, including every pre-existing pull test. Some old tests may assert fake `section:` projects exist. Update those assertions to the new model and note each one in the commit body.

- [ ] **Step 5: Commit**

```bash
git add nimble-core/src/integrations/todoist
git commit -m "feat(todoist): pull real sections, project nesting, rename and archive"
```

---

### Task 3: Push — section-aware creates and moves

**Files:**
- Modify: `nimble-core/src/integrations/todoist/observer.rs` (`task_create_payload`, the move enqueue at ~line 149, and the `Updated` branch when `section_id` is in `fields_changed`)
- Modify: `nimble-core/src/integrations/todoist/sync_loop.rs` (`load_push_ctx`, `build_commands` create + move arms)
- Test: `sync_loop.rs` `push_tests` module, `observer.rs` tests

**Interfaces:**
- Consumes: `sections.external_id` from Task 2.
- Produces: outbox payload key `section_local_id` (nullable) on `task/create` and `task/move`. The ctx map `section_external: HashMap<String /*local section id*/, String /*todoist section id*/>`.

- [ ] **Step 1: Write the failing tests**

```rust
// push_tests
#[test]
fn create_in_section_sends_section_id() {
    let mut ctx = ctx_with(&[], &[("p1", "P1")]);
    ctx.section_external.insert("s1".into(), "S1".into());
    let rows = vec![row("create", "t1", json!({"content": "c", "project_local_id": "p1", "section_local_id": "s1"}), Some("tmp-t1"))];
    let (cmds, bad) = build_commands(&rows, &ctx);
    assert!(bad.is_empty());
    assert_eq!(cmds[0]["args"]["section_id"], "S1");
    assert!(cmds[0]["args"].get("project_id").is_none(), "section_id implies project");
}

#[test]
fn move_into_section_sends_section_id_and_skips_noop() {
    let mut ctx = ctx_with(&[("t1", Some("R1"))], &[("p1", "P1")]);
    ctx.section_external.insert("s1".into(), "S1".into());
    ctx.set_current_project_for_tests("t1", "section:S1");
    let rows = vec![row("move", "t1", json!({"project_local_id": "p1", "section_local_id": "s1"}), None)];
    let (cmds, bad) = build_commands(&rows, &ctx);
    assert!(cmds.is_empty());
    assert!(bad[0].1.contains("no-op move"));
}
```

Plus an observer test: create a local task with `section_id` set while the integration is active (copy the setup from the existing observer tests: `ensure_state` + `todoist_api_token` setting). Assert that the outbox create payload has `section_local_id`. Updating only `section_id` enqueues a `move` whose payload has `project_local_id` and `section_local_id`.

- [ ] **Step 2: Run and confirm they fail**

Run: `cargo test -p nimble-core create_in_section move_into_section`
Expected: FAIL to compile (`section_external` missing).

- [ ] **Step 3: Implement**

- `task_create_payload`: add `"section_local_id": task.section_id`.
- Move enqueue(s): payload becomes `json!({"project_local_id": task.project_id, "section_local_id": task.section_id})`.
- In the `Updated` branch: if `fields_changed` contains `"section_id"` and not `"project_id"`, enqueue that same `move`. Find how `project_id` changes enqueue a move today and mirror it.
- `PushCtx`: add `pub section_external: HashMap<String, String>` (+ `Default`).
- In `load_push_ctx`, for each row with `section_local_id`, run `SELECT external_id FROM sections WHERE id = ?` and insert it if `Some`.
- Add a resolver:

```rust
fn resolve_location(&self, row: &outbox::OutboxRow, extra: &HashMap<String, String>) -> Option<String> {
    if let Some(sid) = row.payload.get("section_local_id").and_then(|v| v.as_str()) {
        if let Some(ext) = self.section_external.get(sid) {
            return Some(format!("section:{ext}"));
        }
    }
    row.payload.get("project_local_id").and_then(|v| v.as_str())
        .and_then(|p| self.resolve_project_ref(p, extra))
}
```

  Use it in both the create arm (replacing the `project_local_id` block) and the move arm (replacing `resolved_project`). `project_ref_args` already maps `section:` → `section_id`.
- A Nimble-created section with no `external_id` falls back to the project, so the task lands in the right project with no section in Todoist. This is acceptable until cutover. Write it down in the commit body.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p nimble-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(todoist): push section placement on create and move"
```

---

### Task 4: One-time reconcile (`dt sync reconcile`)

**Files:**
- Create: `nimble-core/src/integrations/todoist/reconcile.rs` (+ `pub mod reconcile;` in `todoist/mod.rs`)
- Modify: `nimble-core/src/integrations/todoist/client.rs` (add `get_task_status`)
- Modify: `tools/dt/src/args.rs` (`Sync::Reconcile { #[arg(long)] apply: bool }`), `tools/dt/src/commands/mod.rs` (handler)
- Test: `reconcile.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: `apply_pull_tx`-level behaviour from Task 2 (via the public `apply_pull`/`apply_pull_with_focus`), `resolve_remote_ref_tx`.
- Produces:

```rust
pub enum RemoteStatus { Completed, Deleted, Active { project_id: String } }

#[derive(Debug, Default, serde::Serialize)]
pub struct ReconcilePlan {
    pub fake_sections_converted: Vec<(String /*local project id*/, String /*section ext*/, usize /*tasks moved*/)>,
    pub fake_sections_archived: Vec<(String, String /*name*/)>,  // section gone in Todoist
    pub inbox_merge: Option<(String /*duplicate local id*/, usize /*tasks moved*/)>,
    pub projects_archived: Vec<(String, String)>,              // linked, not active in Todoist
    pub to_complete: Vec<(String /*local id*/, String /*content*/)>,
    pub to_delete: Vec<(String, String)>,
    pub kept_in_archived_project: Vec<(String, String)>,
    pub missing_to_create: usize,
    pub lookup_errors: Vec<(String, String)>,
}

pub fn plan_stale(open_linked: &[(String, String, String)] /*(local_id, external_id, content)*/,
                  active_ids: &std::collections::HashSet<String>,
                  statuses: &std::collections::HashMap<String, RemoteStatus>) -> (Vec<(String,String)>, Vec<(String,String)>, Vec<(String,String)>);

pub async fn build_plan(pool: &SqlitePool, full: &client::SyncResponse, statuses: &HashMap<String, RemoteStatus>) -> crate::Result<ReconcilePlan>;
pub async fn apply(pool: &SqlitePool, full: &client::SyncResponse, plan: &ReconcilePlan) -> crate::Result<()>;
pub async fn run(pool: &SqlitePool, apply: bool) -> crate::Result<ReconcilePlan>; // fetch + lookups + plan (+ apply)
```

- [ ] **Step 1: Write the failing tests** (pure `plan_stale` + DB-level `build_plan`/`apply` with a hand-built full-sync response)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

    #[test]
    fn stale_open_tasks_follow_remote_status() {
        let open = vec![
            ("a".into(), "RA".into(), "done there".into()),
            ("b".into(), "RB".into(), "deleted there".into()),
            ("c".into(), "RC".into(), "in archived project".into()),
            ("d".into(), "RD".into(), "still active".into()),
        ];
        let active: HashSet<String> = ["RD".to_string()].into();
        let mut st = HashMap::new();
        st.insert("RA".into(), RemoteStatus::Completed);
        st.insert("RB".into(), RemoteStatus::Deleted);
        st.insert("RC".into(), RemoteStatus::Active { project_id: "ARCH".into() });
        let (complete, delete, keep) = plan_stale(&open, &active, &st);
        assert_eq!(complete, vec![("a".into(), "done there".into())]);
        assert_eq!(delete, vec![("b".into(), "deleted there".into())]);
        assert_eq!(keep, vec![("c".into(), "in archived project".into())]);
    }

    async fn seed_legacy(pool: &SqlitePool) {
        // Legacy shape: real project P, fake section project "P / Lane" (section:S),
        // fake project for a section Todoist deleted (section:GONE) holding a completed task,
        // duplicate linked Inbox row, one stale open task.
        for q in [
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lp','Work','P','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lfs','Work / Lane','section:S','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lgone','Work / Old','section:GONE','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('linbox','Inbox','INBOX','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('ldead','Dead','DEAD','todoist')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t1','in lane','lfs','R1','todoist')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source,completed,status) VALUES ('t2','old done','lgone','R2','todoist',1,'complete')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t3','inbox item','linbox','R3','todoist')",
            "INSERT INTO local_tasks (id,content,project_id) VALUES ('t4','native','inbox')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t5','stale','ldead','R5','todoist')",
        ] { sqlx::query(q).execute(pool).await.unwrap(); }
    }

    fn full() -> client::SyncResponse {
        serde_json::from_value(json!({
            "sync_token": "FULL", "full_sync": true,
            "projects": [{"id": "INBOX", "name": "Inbox", "inbox_project": true}, {"id": "P", "name": "Work"}],
            "sections": [{"id": "S", "project_id": "P", "name": "Lane"}],
            "items": [
                {"id": "R1", "content": "in lane", "project_id": "P", "section_id": "S", "checked": false, "is_deleted": false},
                {"id": "R3", "content": "inbox item", "project_id": "INBOX", "checked": false, "is_deleted": false},
                {"id": "R9", "content": "new since aug", "project_id": "P", "checked": false, "is_deleted": false}
            ]
        })).unwrap()
    }

    #[tokio::test]
    async fn plan_then_apply_converts_legacy_shape() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed);
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        assert_eq!(plan.fake_sections_converted.len(), 1);
        assert_eq!(plan.fake_sections_archived.len(), 1);          // Review Focus #2
        assert_eq!(plan.inbox_merge.as_ref().map(|m| m.1), Some(1)); // Review Focus #4
        assert_eq!(plan.to_complete.len(), 1);
        assert_eq!(plan.missing_to_create, 1);
        assert!(plan.projects_archived.iter().any(|(id, _)| id == "ldead"));

        // dry run wrote nothing
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE external_id LIKE 'section:%'").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 2);

        apply(&pool, &full(), &plan).await.unwrap();
        let t1: (String, Option<String>) = sqlx::query_as("SELECT project_id, section_id FROM local_tasks WHERE id='t1'").fetch_one(&pool).await.unwrap();
        assert_eq!(t1.0, "lp");
        assert!(t1.1.is_some());
        let t2_project: String = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id='t2'").fetch_one(&pool).await.unwrap();
        assert_eq!(t2_project, "lgone", "history kept under archived row");
        let gone_archived: Option<String> = sqlx::query_scalar("SELECT archived_at FROM projects WHERE id='lgone'").fetch_one(&pool).await.unwrap();
        assert!(gone_archived.is_some());
        let inbox_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE name='Inbox'").fetch_one(&pool).await.unwrap();
        assert_eq!(inbox_rows, 1);
        let t3_project: String = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id='t3'").fetch_one(&pool).await.unwrap();
        assert_eq!(t3_project, "inbox");
        let t5: i64 = sqlx::query_scalar("SELECT completed FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(t5, 1);
        let r9: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE external_id='R9'").fetch_one(&pool).await.unwrap();
        assert_eq!(r9, 1);
        let token: String = sqlx::query_scalar("SELECT sync_token FROM integration_sync_state WHERE provider='todoist'").fetch_one(&pool).await.unwrap();
        assert_eq!(token, "FULL");
        let native: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE id='t4'").fetch_one(&pool).await.unwrap();
        assert_eq!(native, 1, "native task untouched");
    }

    #[tokio::test]
    async fn apply_is_all_or_nothing() {
        // Review Focus #5: a plan that references a task deleted between plan and apply
        // must roll back every change.
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut plan = build_plan(&pool, &full(), &HashMap::new()).await.unwrap();
        plan.to_complete.push(("does-not-exist".into(), "x".into()));
        assert!(apply(&pool, &full(), &plan).await.is_err());
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE external_id LIKE 'section:%'").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 2, "nothing applied");
    }
}
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cargo test -p nimble-core reconcile`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `client::get_task_status`**

```rust
pub async fn get_task_status(token: &str, id: &str) -> crate::Result<crate::integrations::todoist::reconcile::RemoteStatus> {
    use crate::integrations::todoist::reconcile::RemoteStatus;
    let url = format!("https://api.todoist.com/api/v1/tasks/{id}");
    let resp = reqwest::Client::new().get(url).bearer_auth(token).send().await
        .map_err(|e| crate::Error::Other(format!("todoist task lookup: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND { return Ok(RemoteStatus::Deleted); }
    if !resp.status().is_success() {
        return Err(crate::Error::Other(format!("todoist task lookup HTTP {}", resp.status())));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| crate::Error::Other(e.to_string()))?;
    if v["is_deleted"].as_bool().unwrap_or(false) { return Ok(RemoteStatus::Deleted); }
    if v["checked"].as_bool().unwrap_or(false) { return Ok(RemoteStatus::Completed); }
    Ok(RemoteStatus::Active { project_id: v["project_id"].as_str().unwrap_or_default().to_string() })
}
```

Match whatever HTTP client and error style `client.rs` already uses: if it builds a `reqwest::Client` once or maps errors differently, follow that.

- [ ] **Step 4: Implement `reconcile.rs`**

- `plan_stale`: for each open linked task whose external id is **not** in `active_ids`, apply this mapping:
  - `Completed` → complete
  - `Deleted` → delete
  - `Active{..}` → keep. It's in an archived project, or the full sync missed it.
  - A status missing from the map → keep. Report it under `lookup_errors` in `build_plan`.

  Return the three lists in input order.
- `build_plan` (read-only; use `pool` queries, no writes):
  1. `active_ids` = ids of `full.items` with `checked != true && is_deleted != true`. `active_projects` = `full.projects` minus deleted and archived. `active_sections` = `full.sections` minus deleted.
  2. Fake sections are rows with `external_id LIKE 'section:%'`. If the id after the prefix is in `active_sections`, add it to `fake_sections_converted`, counting its tasks with `SELECT COUNT(*) FROM local_tasks WHERE project_id = ?`. Otherwise add it to `fake_sections_archived`.
  3. Inbox: the Todoist inbox id is the `full.projects` entry with `inbox_project == true`. If a linked row with that external id exists and its id != `'inbox'`, set `inbox_merge = Some((that id, its task count))`.
  4. `projects_archived` = linked projects (not `section:`, not the inbox duplicate) whose external id is not in `active_projects` and whose `archived_at IS NULL`.
  5. Collect open linked tasks, run `plan_stale`, and fill `to_complete` / `to_delete` / `kept_in_archived_project`. Put linked open tasks with no status entry in `lookup_errors`.
  6. `missing_to_create` = active item ids with no local row (`SELECT 1 FROM local_tasks WHERE external_source='todoist' AND external_id=?`).
- `apply`, as **one transaction** on `pool.begin()`. Every statement errors on zero rows affected where a row is expected. That is how the `apply_is_all_or_nothing` test trips.
  1. Mark `integration_sync_state` token as `'*'`: `UPDATE integration_sync_state SET sync_token = NULL WHERE provider='todoist'`.
  2. Upsert sections from `full.sections`. For each converted fake project, move its tasks: `UPDATE local_tasks SET project_id = <section's local project>, section_id = <section local id> WHERE project_id = <fake id>`. Then `DELETE FROM projects WHERE id = <fake id>`. Assert first that the row count moved equals the planned count, and that no tasks remain before deleting.
  3. Archive the fake sections that are gone: `UPDATE projects SET archived_at = datetime('now','localtime') WHERE id = ?`.
  4. Inbox merge: `UPDATE local_tasks SET project_id='inbox' WHERE project_id=<dup>`, then `UPDATE projects SET external_id=<todoist inbox id>, external_source='todoist' WHERE id='inbox'`, then `DELETE FROM projects WHERE id=<dup>`.
  5. Archive the dead projects.
  6. `to_complete`: `UPDATE local_tasks SET completed=1, status='complete', completed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=? AND completed=0`. It must affect 1 row.
  7. `to_delete`: collect the subtree with `crate::db::task_tx::collect_subtree_tx`, then delete it, as the pull does.
  8. Commit, then run `apply_pull(pool, full)`, then `crate::db::origin_label::backfill_origin_label(pool)` (labels every unlinked task, including the two queued creates). This creates missing tasks, nests projects, archives, updates sections and persists `FULL` as the token, using the Task 2 code. It is idempotent over the structure step 2 already wrote.
  9. Emit sync_log for every row touched in steps 2–7. Mirror how `apply_pull_with_focus` emits `logged`/`project_sync_ops` after commit, and run focus effects for completed or deleted tasks through the same `TaskEffects` path. Read `apply_pull_with_focus` (sync_loop.rs ~919–1035) and reuse its post-commit block rather than re-implementing it.
- `run(pool, apply)`:
  1. Read the token (`crate::integrations::adapter_token_if_active` returns None while sync is disabled, so read `settings.todoist_api_token` directly via `db::settings`).
  2. Fetch `client::sync(&token, json!({"sync_token": "*", "resource_types": ["items","projects","sections"]}))`.
  3. Compute the open linked tasks that are not in the active set, and look up each status with `get_task_status`: sequential, 50 ms sleep between calls, 1 retry on error. On a second failure, record it in `lookup_errors`.
  4. `build_plan`. If `apply` is set, require `plan.lookup_errors.is_empty()` (otherwise return an error listing them), then call `apply`.

  Write the plan JSON to `<app data dir>/reconcile-<YYYYMMDD-HHMMSS>.json` (use the same data-dir helper `dt backup` uses) for both dry run and apply.
- `dt sync reconcile [--apply]`: print a summary table of each `ReconcilePlan` count, plus the first 10 titles of `to_complete`, `to_delete` and `kept_in_archived_project`, and the report path. `--apply` must first run the same code path as `dt backup now` and abort if it fails. `--json` prints the full plan.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p nimble-core && cargo build --release -p nimble-cli`
Expected: PASS, and dt builds.

- [ ] **Step 6: Commit**

```bash
git add nimble-core tools/dt
git commit -m "feat(todoist): one-time reconcile with dry run (dt sync reconcile)"
```

---

### Task 5: Sync health indicator

**Files:**
- Create: `apps/desktop/src/components/shared/SyncHealthBanner.tsx`
- Modify: `apps/desktop/src/components/settings/TodoistSyncSection.tsx` (status line)
- Modify: the app shell that renders page content (find where `PageFrame` or `Dashboard.tsx` renders the current page) to mount the banner once
- Test: `apps/desktop/src/lib/syncHealth.test.ts` (new) using the repo's existing frontend test runner (check `apps/desktop/package.json` / sibling `*.test.ts` files for the runner and copy their import style)

**Interfaces:**
- Consumes: the existing `todoistSync` status call used by `TodoistSyncSection.tsx` (`get_todoist_sync_status`: `{enabled, last_sync_at, last_error, pending, …}`. Read the component for the exact shape).
- Produces: `export function syncHealth(s: {enabled: boolean; last_sync_at: string | null; last_error: string | null}, now: Date): 'ok' | 'off' | 'stale' | 'error'` in `apps/desktop/src/lib/syncHealth.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { syncHealth } from './syncHealth'
const now = new Date('2026-09-23T12:00:00')
test('off when disabled', () => expect(syncHealth({ enabled: false, last_sync_at: null, last_error: null }, now)).toBe('off'))
test('error wins', () => expect(syncHealth({ enabled: true, last_sync_at: '2026-09-23 11:59:00', last_error: '401' }, now)).toBe('error'))
test('stale after an hour', () => expect(syncHealth({ enabled: true, last_sync_at: '2026-09-23 10:30:00', last_error: null }, now)).toBe('stale'))
test('ok when recent', () => expect(syncHealth({ enabled: true, last_sync_at: '2026-09-23 11:30:00', last_error: null }, now)).toBe('ok'))
```

- [ ] **Step 2: Run and confirm it fails.** Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/lib/syncHealth.ts
export type SyncHealth = 'ok' | 'off' | 'stale' | 'error'
const STALE_MS = 60 * 60 * 1000
/** last_sync_at is SQLite localtime "YYYY-MM-DD HH:MM:SS". */
export function syncHealth(s: { enabled: boolean; last_sync_at: string | null; last_error: string | null }, now: Date): SyncHealth {
  if (!s.enabled) return 'off'
  if (s.last_error) return 'error'
  if (!s.last_sync_at) return 'stale'
  const last = new Date(s.last_sync_at.replace(' ', 'T'))
  return now.getTime() - last.getTime() > STALE_MS ? 'stale' : 'ok'
}
```

`SyncHealthBanner` polls the status every 60 s (plus on window focus). It renders nothing for `ok`/`off`. For `error` it shows "Todoist sync paused. Todoist didn't accept the last sync." and a **Open settings** button that navigates to Settings → `#todoist-sync`. For `stale` it shows "Todoist hasn't synced in over an hour." with **Sync now**. Use the existing surface/banner tokens: look at `ReminderCatchUp.tsx` for the house banner style. In `TodoistSyncSection`, show `Last synced <relative time>` and, on error, the error text in `text-muted-foreground`.

- [ ] **Step 4: Run the tests and typecheck**

Run: the frontend test command, then `cd apps/desktop && npx tsc -b`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ui): Todoist sync health banner and settings status"
```

---

### Task 6: Sidebar hides archived projects; filter task lists by label

**Files:**
- Create: `apps/desktop/src/lib/projectTree.ts`, `apps/desktop/src/lib/labelFilter.ts` (+ tests beside them in the repo's frontend test style: check sibling `*.test.ts` for the runner and imports)
- Modify: `apps/desktop/src/components/tasks/ProjectSidebar.tsx`, `apps/desktop/src/hooks/useLocalTasks.ts`
- Modify: `apps/desktop/src/components/tasks/TaskListHeader.tsx` (Labels menu) and the task-list containers that already apply the header's priority/status filters (`TasksPage.tsx`, `ProjectDetailPage.tsx`; find where `PRIORITY_OPTIONS` selections are applied and add the label predicate beside it)
- Modify: `apps/desktop/src/stores/tasksNavStore.ts` (persist `labelFilter`)

**Interfaces:**
- Produces: `buildProjectTree(projects: Project[]): { roots: Project[]; childrenByParent: Record<string, Project[]> }`. Excludes `archived_at` rows, and a child of an archived or missing parent becomes a root.
- Produces: `type LabelFilter = { include: string[]; exclude: string[] }` (label ids) and `matchesLabelFilter(taskLabelIds: string[], f: LabelFilter): boolean`. **Include** means the task has all of them; **exclude** means it has none of them.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildProjectTree } from './projectTree'
import { matchesLabelFilter } from './labelFilter'
const p = (id: string, parent_id: string | null = null, archived_at: string | null = null) =>
  ({ id, name: id, color: '', position: 0, parent_id, archived_at } as any)

test('hides archived and nests children', () => {
  const t = buildProjectTree([p('inbox'), p('personal'), p('finance', 'personal'), p('dead', null, '2026-09-23')])
  expect(t.roots.map((r) => r.id)).toEqual(['inbox', 'personal'])
  expect(t.childrenByParent.personal.map((c) => c.id)).toEqual(['finance'])
})
test('orphan child of archived parent becomes a root', () => {
  expect(buildProjectTree([p('old', null, '2026-09-23'), p('kid', 'old')]).roots.map((r) => r.id)).toEqual(['kid'])
})
test('label filter: include requires all, exclude forbids any', () => {
  expect(matchesLabelFilter(['nimble', 'admin'], { include: ['nimble'], exclude: [] })).toBe(true)
  expect(matchesLabelFilter(['admin'], { include: ['nimble'], exclude: [] })).toBe(false)
  expect(matchesLabelFilter(['admin'], { include: [], exclude: ['nimble'] })).toBe(true)   // "from Todoist"
  expect(matchesLabelFilter(['nimble'], { include: [], exclude: ['nimble'] })).toBe(false)
  expect(matchesLabelFilter([], { include: [], exclude: [] })).toBe(true)
})
```

- [ ] **Step 2: Run and confirm they fail.**

- [ ] **Step 3: Implement**

```ts
// apps/desktop/src/lib/projectTree.ts
import type { Project } from '@nimble/types'
export function buildProjectTree(projects: Project[]) {
  const active = projects.filter((p) => !p.archived_at)
  const ids = new Set(active.map((p) => p.id))
  const roots: Project[] = []
  const childrenByParent: Record<string, Project[]> = {}
  for (const p of active) {
    if (p.parent_id && ids.has(p.parent_id)) (childrenByParent[p.parent_id] ??= []).push(p)
    else roots.push(p)
  }
  return { roots, childrenByParent }
}

// apps/desktop/src/lib/labelFilter.ts
export type LabelFilter = { include: string[]; exclude: string[] }
export const EMPTY_LABEL_FILTER: LabelFilter = { include: [], exclude: [] }
export function matchesLabelFilter(taskLabelIds: string[], f: LabelFilter): boolean {
  const has = new Set(taskLabelIds)
  return f.include.every((id) => has.has(id)) && !f.exclude.some((id) => has.has(id))
}
```

- **Sidebar:** replace the inline `rootProjects` / `childrenByParent` in `ProjectSidebar.tsx` with `buildProjectTree(projects)`. Initialise `collapsedParents` with every parent that has more than 5 children, so 🏡 Personal (12) opens collapsed. `useProjects` keeps returning every project as `allProjects` (for names of tasks in archived projects) and returns active-only as `projects`, so move-to-project pickers stop offering archived ones.
- **Label filter:** add a "Labels" dropdown in `TaskListHeader.tsx` next to the existing filter controls, using the same `DropdownMenu` primitives and `labelColor()`. Each label row cycles through three states on click: off → **only** (include) → **hide** (exclude) → off. Show a small count badge on the trigger when any are active, and a "Clear" item. At the top of the menu, when a label named `nimble` exists, add two shortcuts: **"Made in Nimble"** = `{include:[nimbleId]}` and **"From Todoist"** = `{exclude:[nimbleId]}`. Store `labelFilter` in `tasksNavStore` (session-persistent like `selectedProjectId`). Apply `matchesLabelFilter(task.labels, labelFilter)` wherever the header's other filters are applied. Tasks carry label ids in `task.labels`. Check the `LocalTask` type in `@nimble/types`.
- No separate origin glyph on rows. The `nimble` label chip already shows wherever labels render.

- [ ] **Step 4: Run the tests, then run the desktop and web builds**

Run: frontend tests; `cd apps/desktop && npm run build && npm run build:web`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(ui): hide archived projects, collapse big parents, filter tasks by label"
```

---

### Task 7: Live run (with Marco)

- [ ] **Step 1:** Merge the branch to main after the whole-branch review. Run `npm run update-app` and build/install `dt` (`cargo build --release -p nimble-cli && cp target/release/dt ~/.local/bin/dt`). Confirm the schema is at 22 with `sqlite3 -readonly … "select max(version) from schema_version"`. Todoist sync must still be **off**.
- [ ] **Step 2:** Run `dt sync reconcile` (dry run). Show Marco the summary. Expected ballpark from the 2026-09-23 measurement:
  - about 380 to create
  - about 390 across complete/delete/keep
  - about 33 fake sections converted
  - one inbox merge
  - some dead projects archived

  Explain any number far off before continuing.
- [ ] **Step 3:** With Marco's explicit go, run `dt sync reconcile --apply`. It takes a backup first. Record the backup path and report path. Then run the one-off label backfill (`dt` has no command for it, so add a hidden `dt label backfill-origin` in Task 1 or call `backfill_origin_label` from the reconcile apply's post-commit step. **Prefer the latter**: one command, and it runs after the inbox merge). Expected: about 17 native tasks labelled `nimble`.
- [ ] **Step 4:** Verify the result:
  - `select count(*) from projects where external_id like 'section:%' and archived_at is null` = 0
  - open linked task count ≈ live Todoist active count (re-run the MCP count), within the archived-project keeps
  - `select count(*) from projects where name='Inbox'` = 1
- [ ] **Step 5:** Marco turns Todoist sync back on in Settings. Watch one cycle: `dt sync status` shows no error, and the 2 queued tasks appear in Todoist under 👑 Queen Out — Website and Inbox.
- [ ] **Step 6:** Update `NEXT.md` (tick phases 1–3, with evidence: counts, backup path, report path, commit shas) and commit.
