use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row, SqlitePool};
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::LocalTask;

impl FromRow<'_, SqliteRow> for LocalTask {
    fn from_row(row: &SqliteRow) -> Result<Self, sqlx::Error> {
        Ok(LocalTask {
            id: row.try_get("id")?,
            parent_id: row.try_get("parent_id")?,
            content: row.try_get("content")?,
            description: row.try_get("description")?,
            project_id: row.try_get("project_id")?,
            priority: row.try_get("priority")?,
            due_date: row.try_get("due_date")?,
            completed: row.try_get::<i64, _>("completed")? != 0,
            completed_at: row.try_get("completed_at")?,
            status: row.try_get("status")?,
            linked_doc_id: row.try_get("linked_doc_id")?,
            position: row.try_get("position")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            external_id: row.try_get("external_id")?,
            external_source: row.try_get("external_source")?,
            remote_updated_at: row.try_get("remote_updated_at")?,
            synced_snapshot: row.try_get("synced_snapshot")?,
        })
    }
}

const SELECT_COLS: &str = "id, parent_id, content, description, project_id, priority, due_date, completed, completed_at, status, linked_doc_id, position, created_at, updated_at, external_id, external_source, remote_updated_at, synced_snapshot";

/// Reorder tasks within a project -- receives ordered list of task IDs
pub async fn reorder_local_tasks(pool: &SqlitePool, task_ids: &[String]) -> crate::Result<()> {
    for (i, id) in task_ids.iter().enumerate() {
        sqlx::query("UPDATE local_tasks SET position = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(i as i64)
            .bind(id)
            .execute(pool)
            .await?;

        // Sync log: each reordered task is an UPDATE
        let changed = serde_json::json!(["position"]).to_string();
        let row: Option<LocalTask> =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
        if let Some(task) = row {
            let snapshot = serde_json::to_string(&task).unwrap_or_default();
            sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    activity::log_activity(
        pool,
        "task_reordered",
        None,
        Some(serde_json::json!({ "count": task_ids.len() })),
    )
    .await;

    Ok(())
}

pub async fn get_local_tasks(
    pool: &SqlitePool,
    project_id: Option<&str>,
    due_date: Option<&str>,
    include_completed: bool,
) -> crate::Result<Vec<LocalTask>> {
    let query = if let Some(_pid) = &project_id {
        if include_completed {
            format!(
                "SELECT {} FROM local_tasks WHERE project_id = ? ORDER BY completed, position, created_at",
                SELECT_COLS
            )
        } else {
            format!(
                "SELECT {} FROM local_tasks WHERE project_id = ? AND completed = 0 ORDER BY position, created_at",
                SELECT_COLS
            )
        }
    } else if let Some(_date) = &due_date {
        if include_completed {
            format!(
                "SELECT {} FROM local_tasks WHERE due_date IS NOT NULL AND due_date <= ? ORDER BY due_date, priority DESC, position",
                SELECT_COLS
            )
        } else {
            format!(
                "SELECT {} FROM local_tasks WHERE due_date IS NOT NULL AND due_date <= ? AND completed = 0 ORDER BY due_date, priority DESC, position",
                SELECT_COLS
            )
        }
    } else {
        if include_completed {
            format!(
                "SELECT {} FROM local_tasks ORDER BY project_id, completed, position, created_at",
                SELECT_COLS
            )
        } else {
            format!(
                "SELECT {} FROM local_tasks WHERE completed = 0 ORDER BY project_id, position, created_at",
                SELECT_COLS
            )
        }
    };

    let bind_val: Option<&str> = project_id.or(due_date);

    let rows: Vec<LocalTask> = if let Some(val) = bind_val {
        sqlx::query_as::<_, LocalTask>(&query)
            .bind(val)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query_as::<_, LocalTask>(&query)
            .fetch_all(pool)
            .await?
    };

    Ok(rows)
}

pub async fn create_local_task(
    pool: &SqlitePool,
    content: &str,
    project_id: Option<&str>,
    parent_id: Option<&str>,
    description: Option<&str>,
    priority: Option<i64>,
    due_date: Option<&str>,
) -> crate::Result<LocalTask> {
    let id = Uuid::new_v4().to_string();
    let project_id = project_id.unwrap_or("inbox");
    let priority = priority.unwrap_or(1);

    // Get next position within the parent/project scope
    let max_pos: i64 = if let Some(pid) = parent_id {
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM local_tasks WHERE parent_id = ?")
            .bind(pid)
            .fetch_one(pool)
            .await?
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(MAX(position), -1) FROM local_tasks WHERE project_id = ? AND parent_id IS NULL",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?
    };

    sqlx::query(
        "INSERT INTO local_tasks (id, parent_id, content, description, project_id, priority, due_date, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(parent_id)
    .bind(content)
    .bind(description)
    .bind(project_id)
    .bind(priority)
    .bind(due_date)
    .bind(max_pos + 1)
    .execute(pool)
    .await?;

    // Log activity
    activity::log_activity(
        pool,
        "task_created",
        Some(&id),
        Some(serde_json::json!({
            "content": content,
            "project_id": project_id,
        })),
    )
    .await;

    // Fetch and return the created task
    let task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
        .bind(&id)
        .fetch_one(pool)
        .await?;

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&task).unwrap_or_default();
    sync::append_sync_log(pool, "local_tasks", &task.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(task)
}

pub async fn update_local_task(
    pool: &SqlitePool,
    id: &str,
    content: Option<&str>,
    description: Option<&str>,
    project_id: Option<&str>,
    priority: Option<i64>,
    due_date: Option<&str>,
    clear_due_date: bool,
    linked_doc_id: Option<&str>,
) -> crate::Result<LocalTask> {
    if let Some(content) = content {
        sqlx::query("UPDATE local_tasks SET content = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(content)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(desc) = description {
        sqlx::query("UPDATE local_tasks SET description = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(desc)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(pid) = project_id {
        sqlx::query("UPDATE local_tasks SET project_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(pid)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(pri) = priority {
        sqlx::query("UPDATE local_tasks SET priority = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(pri)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(date) = due_date {
        sqlx::query("UPDATE local_tasks SET due_date = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(date)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if clear_due_date {
        sqlx::query("UPDATE local_tasks SET due_date = NULL, updated_at = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(doc_id) = linked_doc_id {
        sqlx::query("UPDATE local_tasks SET linked_doc_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(doc_id)
            .bind(id)
            .execute(pool)
            .await?;
    }

    // Log activity with changed fields
    let mut fields_changed = Vec::new();
    if content.is_some() { fields_changed.push("content"); }
    if description.is_some() { fields_changed.push("description"); }
    if project_id.is_some() { fields_changed.push("project_id"); }
    if priority.is_some() { fields_changed.push("priority"); }
    if linked_doc_id.is_some() { fields_changed.push("linked_doc_id"); }
    if due_date.is_some() || clear_due_date { fields_changed.push("due_date"); }
    if !fields_changed.is_empty() {
        let action = if fields_changed == vec!["project_id"] { "task_moved" } else { "task_updated" };
        activity::log_activity(
            pool,
            action,
            Some(id),
            Some(serde_json::json!({ "fields_changed": fields_changed })),
        )
        .await;
    }

    let task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
        .bind(id)
        .fetch_one(pool)
        .await?;

    // Sync log: UPDATE with changed columns
    if !fields_changed.is_empty() {
        let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
        let snapshot = serde_json::to_string(&task).unwrap_or_default();
        sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    Ok(task)
}

/// Update task status (backlog, todo, in_progress, blocked, complete)
pub async fn update_task_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    note: Option<&str>,
) -> crate::Result<()> {
    // Get old status for logging
    let old_status: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM local_tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let old = old_status.map(|r| r.0).unwrap_or_default();

    // Update status + completed flag
    let is_complete = status == "complete";
    if is_complete {
        sqlx::query(
            "UPDATE local_tasks SET status = ?, completed = 1, completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?",
        )
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;

        // Also complete all subtasks
        sqlx::query(
            "UPDATE local_tasks SET status = 'complete', completed = 1, completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE parent_id = ?",
        )
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE local_tasks SET status = ?, completed = 0, completed_at = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?",
        )
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;
    }

    // Build metadata
    let mut meta = serde_json::json!({ "old_status": &old, "new_status": status });
    if let Some(n) = note {
        meta["note"] = serde_json::Value::String(n.to_string());
    }

    activity::log_activity(
        pool,
        "status_changed",
        Some(id),
        Some(meta),
    )
    .await;

    // Sync log: UPDATE for status change
    let row: Option<LocalTask> =
        sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    if let Some(task) = row {
        let changed = serde_json::json!(["status", "completed", "completed_at"]).to_string();
        let snapshot = serde_json::to_string(&task).unwrap_or_default();
        sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    Ok(())
}

pub async fn delete_local_task(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    // Log sync for subtask deletes
    let subtask_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM local_tasks WHERE parent_id = ?")
        .bind(id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for (sub_id,) in &subtask_ids {
        sync::append_sync_log(pool, "local_tasks", sub_id, "DELETE", None, None).await.ok();
    }

    // Delete subtasks first
    sqlx::query("DELETE FROM local_tasks WHERE parent_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM local_tasks WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "local_tasks", id, "DELETE", None, None).await.ok();

    activity::log_activity(
        pool,
        "task_deleted",
        Some(id),
        None,
    )
    .await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn external_link_survives_task_edits() {
        let pool = test_pool().await;
        let task = super::create_local_task(&pool, "Buy milk", None, None, None, None, None)
            .await
            .unwrap();
        assert_eq!(task.external_id, None);
        assert_eq!(task.external_source, None);

        sqlx::query("UPDATE local_tasks SET external_id = ?, external_source = 'todoist' WHERE id = ?")
            .bind("6X7rM8997g3RQmvh")
            .bind(&task.id)
            .execute(&pool)
            .await
            .unwrap();

        let updated = super::update_local_task(
            &pool, &task.id, Some("Buy oat milk"), None, None, None, None, false, None,
        )
        .await
        .unwrap();
        assert_eq!(updated.external_id.as_deref(), Some("6X7rM8997g3RQmvh"));
        assert_eq!(updated.external_source.as_deref(), Some("todoist"));

        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let fetched = all.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(fetched.external_id.as_deref(), Some("6X7rM8997g3RQmvh"));
    }

    #[tokio::test]
    async fn v17_sync_metadata_roundtrips() {
        let pool = test_pool().await;
        // tables exist
        sqlx::query("SELECT id, local_id, object_type, op, payload_json, command_uuid, temp_id, status, error FROM todoist_outbox")
            .fetch_all(&pool).await.unwrap();
        sqlx::query("SELECT provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled FROM integration_sync_state")
            .fetch_all(&pool).await.unwrap();
        // columns visible through the struct
        let task = super::create_local_task(&pool, "t", None, None, None, None, None).await.unwrap();
        sqlx::query("UPDATE local_tasks SET synced_snapshot = '{}', remote_updated_at = '2026-08-04T00:00:00Z' WHERE id = ?")
            .bind(&task.id).execute(&pool).await.unwrap();
        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = all.iter().find(|x| x.id == task.id).unwrap();
        assert_eq!(t.synced_snapshot.as_deref(), Some("{}"));
        assert_eq!(t.remote_updated_at.as_deref(), Some("2026-08-04T00:00:00Z"));
    }
}
