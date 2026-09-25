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

/// One device-local index write. Each runs inside its own savepoint (see
/// `best_effort`), so a DELETE+INSERT pair is atomic.
enum IndexOp<'a> {
    Upsert { id: &'a str, content: &'a str, description: Option<&'a str> },
    Remove(&'a str),
    /// Drop rows whose task is gone (a remote project DELETE cascades task
    /// deletes in SQLite, bypassing every hook).
    PruneOrphans,
}

async fn run_op(conn: &mut SqliteConnection, op: &IndexOp<'_>) -> sqlx::Result<()> {
    match op {
        IndexOp::Upsert { id, content, description } => {
            sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?").bind(*id).execute(&mut *conn).await?;
            sqlx::query("INSERT INTO tasks_fts (task_id, content, description) VALUES (?, ?, ?)")
                .bind(*id).bind(*content).bind(description.unwrap_or("")).execute(&mut *conn).await?;
        }
        IndexOp::Remove(id) => {
            sqlx::query("DELETE FROM tasks_fts WHERE task_id = ?").bind(*id).execute(&mut *conn).await?;
        }
        IndexOp::PruneOrphans => {
            sqlx::query("DELETE FROM tasks_fts WHERE task_id NOT IN (SELECT id FROM local_tasks)")
                .execute(&mut *conn).await?;
        }
    }
    Ok(())
}

/// SQLite primary result codes after which the enclosing transaction may
/// already be rolled back: BUSY (5), NOMEM (7), IOERR (10), FULL (13).
/// `code` may be an extended code (e.g. 266 = IOERR_READ); its low byte is
/// the primary code.
fn is_fatal_code(code: Option<&str>) -> bool {
    code.and_then(|c| c.parse::<i32>().ok())
        .is_some_and(|c| matches!(c & 0xff, 5 | 7 | 10 | 13))
}

fn is_fatal(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => is_fatal_code(db.code().as_deref()),
        // Anything that is not a statement error (I/O, a dead worker) means
        // the connection itself is in doubt.
        _ => true,
    }
}

/// Run one index write inside a savepoint on the caller's transaction.
/// A statement error (missing table, constraint, corrupt index row) rolls
/// back to the savepoint and is logged: the index is best-effort and heals on
/// the next launch. An error that may have killed the caller's transaction
/// (BUSY/NOMEM/IOERR/FULL), or a savepoint that cannot be set or rolled back,
/// is returned, so the mutation fails cleanly instead of carrying on in
/// autocommit and leaving orphan sync_log / outbox rows.
async fn best_effort(conn: &mut SqliteConnection, op: IndexOp<'_>) -> crate::Result<()> {
    sqlx::query("SAVEPOINT tasks_fts_write").execute(&mut *conn).await?;
    match run_op(conn, &op).await {
        Ok(()) => {
            sqlx::query("RELEASE tasks_fts_write").execute(&mut *conn).await?;
            Ok(())
        }
        Err(e) if is_fatal(&e) => {
            log::error!("tasks_fts: index write failed and the transaction may be gone: {e}");
            Err(e.into())
        }
        Err(e) => {
            log::warn!("tasks_fts: index write skipped: {e}");
            sqlx::query("ROLLBACK TO tasks_fts_write").execute(&mut *conn).await?;
            sqlx::query("RELEASE tasks_fts_write").execute(&mut *conn).await?;
            Ok(())
        }
    }
}

/// Refresh one task's row inside the caller's transaction (best-effort; see
/// `best_effort` for the only errors it returns).
pub(crate) async fn index_task_conn(conn: &mut SqliteConnection, id: &str, content: &str, description: Option<&str>) -> crate::Result<()> {
    best_effort(conn, IndexOp::Upsert { id, content, description }).await
}

pub(crate) async fn unindex_task_conn(conn: &mut SqliteConnection, id: &str) -> crate::Result<()> {
    best_effort(conn, IndexOp::Remove(id)).await
}

/// Remove index rows whose task no longer exists (best-effort).
pub(crate) async fn prune_orphans_conn(conn: &mut SqliteConnection) -> crate::Result<()> {
    best_effort(conn, IndexOp::PruneOrphans).await
}

/// Mirror an incoming apply (Turso pull, Todoist pull, reconcile, calendar
/// edit) in the same transaction that applied it.
pub(crate) async fn apply_effects_conn(conn: &mut SqliteConnection, effects: &TaskEffects) -> crate::Result<()> {
    for task in &effects.deleted {
        unindex_task_conn(conn, &task.id).await?;
    }
    for task in &effects.changed {
        index_task_conn(conn, &task.id, &task.content, task.description.as_deref()).await?;
    }
    Ok(())
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

    #[test]
    fn only_transaction_killing_codes_are_fatal() {
        for code in ["5", "7", "10", "13", "266", "517", "3850"] {
            assert!(is_fatal_code(Some(code)), "{code} is BUSY/NOMEM/IOERR/FULL (primary or extended)");
        }
        for code in ["1", "19", "2067", "11"] {
            assert!(!is_fatal_code(Some(code)), "{code} is a statement error: skip and continue");
        }
        assert!(!is_fatal_code(None));
    }

    #[tokio::test]
    async fn a_broken_index_never_fails_a_task_write() {
        let pool = test_pool().await;
        sqlx::query("DROP TABLE tasks_fts").execute(&pool).await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "Still saved".into(), ..Default::default() }).await.unwrap();
        update_local_task(&pool, &t.id, UpdateTaskInput { content: Some("Still edited".into()), ..Default::default() }).await.unwrap();
        let mut snap: serde_json::Value = serde_json::from_str(&sync::task_sync_snapshot(&t)).unwrap();
        snap["content"] = "From the phone".into();
        assert_eq!(
            sync::apply_remote_rows_with_focus(&pool, None, &[remote(&t.id, "UPDATE", Some(snap.to_string()))]).await.unwrap(),
            1
        );
        let content: String = sqlx::query_scalar("SELECT content FROM local_tasks WHERE id = ?").bind(&t.id).fetch_one(&pool).await.unwrap();
        assert_eq!(content, "From the phone");
        delete_local_task(&pool, &t.id).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks").fetch_one(&pool).await.unwrap();
        assert_eq!(left, 0);
        // Every write replicated: the savepoint rollback never took sync_log rows with it.
        let ops: Vec<String> = sqlx::query_scalar("SELECT DISTINCT operation FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ? ORDER BY operation")
            .bind(&t.id).fetch_all(&pool).await.unwrap();
        assert_eq!(ops, ["DELETE", "INSERT", "UPDATE"]);
    }

    #[tokio::test]
    async fn a_remote_project_delete_drops_its_cascaded_tasks_from_the_index() {
        let pool = test_pool().await;
        let project = crate::db::projects::create_project(&pool, "Gone soon", "gray", None).await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput {
            content: "Cascade victim".into(), project_id: Some(project.id.clone()), ..Default::default()
        }).await.unwrap();
        assert_eq!(hits(&pool, "victim").await, vec![t.id.clone()]);
        let mut row = remote(&project.id, "DELETE", None);
        row.table_name = "projects".into();
        sync::apply_remote_rows_with_focus(&pool, None, &[row]).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE id = ?").bind(&t.id).fetch_one(&pool).await.unwrap();
        assert_eq!(left, 0, "FK cascade removed the task");
        assert!(hits(&pool, "victim").await.is_empty());
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
