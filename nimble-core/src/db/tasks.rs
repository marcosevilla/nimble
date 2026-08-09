use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row, SqlitePool};
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::{CreateTaskInput, LocalTask, UpdateTaskInput};

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
            due_time: row.try_get("due_time")?,
            duration_minutes: row.try_get("duration_minutes")?,
            recurrence_rule: row.try_get("recurrence_rule")?,
            section_id: row.try_get("section_id")?,
            labels: Vec::new(),
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

pub(crate) const SELECT_COLS: &str = "id, parent_id, content, description, project_id, priority, due_date, due_time, duration_minutes, recurrence_rule, section_id, completed, completed_at, status, linked_doc_id, position, created_at, updated_at, external_id, external_source, remote_updated_at, synced_snapshot";

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

pub async fn create_local_task(pool: &SqlitePool, input: CreateTaskInput) -> crate::Result<LocalTask> {
    let CreateTaskInput {
        content,
        project_id,
        parent_id,
        description,
        priority,
        due_date,
    } = input;
    let content = content.as_str();
    let project_id = project_id.as_deref();
    let parent_id = parent_id.as_deref();
    let description = description.as_deref();
    let due_date = due_date.as_deref();

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

    // Todoist mutation observer: best-effort, enqueues an outbox create op if adapter active
    crate::integrations::todoist::observer::on_task_mutation(
        pool,
        crate::integrations::todoist::observer::TaskMutation::Created(&task),
    )
    .await;

    Ok(task)
}

pub async fn update_local_task(pool: &SqlitePool, id: &str, input: UpdateTaskInput) -> crate::Result<LocalTask> {
    let UpdateTaskInput {
        content,
        description,
        project_id,
        priority,
        due_date,
        clear_due_date,
        linked_doc_id,
    } = input;
    let content = content.as_deref();
    let description = description.as_deref();
    let project_id = project_id.as_deref();
    let due_date = due_date.as_deref();
    let linked_doc_id = linked_doc_id.as_deref();

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

        // Todoist mutation observer: best-effort
        let fields_changed_owned: Vec<String> = fields_changed.iter().map(|f| f.to_string()).collect();
        crate::integrations::todoist::observer::on_task_mutation(
            pool,
            crate::integrations::todoist::observer::TaskMutation::Updated {
                task: &task,
                fields_changed: &fields_changed_owned,
            },
        )
        .await;
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

    // Capture completed flag before mutation, for the observer's close/reopen decision
    let was_completed: bool = sqlx::query_scalar::<_, i64>(
        "SELECT completed FROM local_tasks WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .map(|c| c != 0)
    .unwrap_or(false);

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
    if let Some(task) = &row {
        let changed = serde_json::json!(["status", "completed", "completed_at"]).to_string();
        let snapshot = serde_json::to_string(&task).unwrap_or_default();
        sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    // Todoist mutation observer: best-effort
    if let Some(task) = &row {
        crate::integrations::todoist::observer::on_task_mutation(
            pool,
            crate::integrations::todoist::observer::TaskMutation::StatusChanged { task, was_completed },
        )
        .await;
    }

    Ok(())
}

pub async fn delete_local_task(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    // Fetch the full task before deleting, so the observer can enqueue a delete op
    // (and read external_id) after the row is gone.
    let pre_delete_task: Option<LocalTask> =
        sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();

    // Fetch full subtask rows (not just ids) before the cascade, so the
    // Todoist observer can fire for each child exactly as it does for the
    // parent — otherwise a child's pending 'create' op survives the cascade
    // and resurrects the deleted subtask remotely, then locally on the next
    // pull (I2).
    let subtasks: Vec<LocalTask> =
        sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE parent_id = ?", SELECT_COLS))
            .bind(id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    // Log sync for subtask deletes
    for task in &subtasks {
        sync::append_sync_log(pool, "local_tasks", &task.id, "DELETE", None, None).await.ok();
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

    // Todoist mutation observer: best-effort — fire for the parent and every
    // cascaded child so each gets its outbox cleanup (pending creates
    // cancelled, pending updates replaced with a delete op).
    if let Some(task) = &pre_delete_task {
        crate::integrations::todoist::observer::on_task_mutation(
            pool,
            crate::integrations::todoist::observer::TaskMutation::Deleted { task },
        )
        .await;
    }
    for task in &subtasks {
        crate::integrations::todoist::observer::on_task_mutation(
            pool,
            crate::integrations::todoist::observer::TaskMutation::Deleted { task },
        )
        .await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, UpdateTaskInput};

    #[tokio::test]
    async fn external_link_survives_task_edits() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "Buy milk".to_string(), ..Default::default() },
        )
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
            &pool,
            &task.id,
            UpdateTaskInput { content: Some("Buy oat milk".to_string()), ..Default::default() },
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
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "t".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        sqlx::query("UPDATE local_tasks SET synced_snapshot = '{}', remote_updated_at = '2026-08-04T00:00:00Z' WHERE id = ?")
            .bind(&task.id).execute(&pool).await.unwrap();
        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = all.iter().find(|x| x.id == task.id).unwrap();
        assert_eq!(t.synced_snapshot.as_deref(), Some("{}"));
        assert_eq!(t.remote_updated_at.as_deref(), Some("2026-08-04T00:00:00Z"));
    }

    /// I2 regression: deleting a parent must fire the Todoist observer for
    /// each cascaded child too, not just the parent — otherwise a child's
    /// pending 'create' op survives the cascade and resurrects the deleted
    /// subtask remotely (then locally, via the next pull).
    #[tokio::test]
    async fn cascade_delete_cancels_child_pending_create() {
        let pool = test_pool().await;
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();

        let parent = super::create_local_task(
            &pool,
            CreateTaskInput { content: "Parent".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        let child = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "Child".to_string(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Both parent and child got pending 'create' ops from the observer.
        let batch = crate::integrations::todoist::outbox::pending_batch(&pool, 100)
            .await
            .unwrap();
        assert_eq!(batch.len(), 2);
        assert!(batch.iter().any(|r| r.local_id == parent.id));
        assert!(batch.iter().any(|r| r.local_id == child.id));

        super::delete_local_task(&pool, &parent.id).await.unwrap();

        // Neither task was ever synced, so both pending creates should be
        // cancelled outright — no op survives to resurrect the child.
        let batch = crate::integrations::todoist::outbox::pending_batch(&pool, 100)
            .await
            .unwrap();
        assert!(
            batch.is_empty(),
            "expected no surviving outbox ops after cascade delete, got: {:?}",
            batch.iter().map(|r| (&r.local_id, &r.op)).collect::<Vec<_>>()
        );

        // The child row itself is gone.
        let remaining: Option<(String,)> = sqlx::query_as("SELECT id FROM local_tasks WHERE id = ?")
            .bind(&child.id)
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(remaining.is_none());
    }

    /// I2 regression, synced case: a child that was already linked to Todoist
    /// (has external_id) gets a delete op enqueued when its parent cascades,
    /// instead of silently disappearing from the outbox with no remote cleanup.
    #[tokio::test]
    async fn cascade_delete_enqueues_delete_for_synced_child() {
        let pool = test_pool().await;
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();

        let parent = super::create_local_task(
            &pool,
            CreateTaskInput { content: "Parent".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        let child = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "Child".to_string(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Simulate the child having already been synced to Todoist in a
        // previous cycle: it has an external_id and its prior create/update
        // ops are done, not pending.
        sqlx::query("UPDATE local_tasks SET external_id = 'ext-child-1', external_source = 'todoist' WHERE id = ?")
            .bind(&child.id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE todoist_outbox SET status = 'done' WHERE local_id = ?")
            .bind(&child.id)
            .execute(&pool)
            .await
            .unwrap();

        super::delete_local_task(&pool, &parent.id).await.unwrap();

        let batch = crate::integrations::todoist::outbox::pending_batch(&pool, 100)
            .await
            .unwrap();
        let child_delete = batch.iter().find(|r| r.local_id == child.id && r.op == "delete");
        assert!(
            child_delete.is_some(),
            "expected a delete op enqueued for the synced child, got: {:?}",
            batch.iter().map(|r| (&r.local_id, &r.op)).collect::<Vec<_>>()
        );
        assert_eq!(child_delete.unwrap().payload["external_id"], "ext-child-1");
    }
}
