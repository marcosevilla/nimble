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
