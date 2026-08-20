use std::collections::HashMap;

use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row, SqlitePool};
use uuid::Uuid;

use crate::db::activity;
use crate::db::labels;
use crate::db::sync;
use crate::parsers::html_to_md::{html_to_markdown, scan_unknown_tags};
use crate::types::{CreateTaskInput, LocalTask, UpdateTaskInput};

/// True if `section_id` names a real section belonging to `project_id`.
/// `local_tasks.section_id` carries no foreign key (v19 migration), so this
/// app-level check is what stops a task from pointing at a section in a
/// different project or one that doesn't exist at all — same pattern as
/// `db::sections::create_section`'s project-existence check.
async fn section_belongs_to_project(
    pool: &SqlitePool,
    section_id: &str,
    project_id: &str,
) -> crate::Result<bool> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM sections WHERE id = ? AND project_id = ?")
            .bind(section_id)
            .bind(project_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

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

/// Snapshot a task row and append its sync_log entry, warning on failure —
/// sync_log IS the retry mechanism, so a silently swallowed append can leave
/// the row permanently absent from Turso with nothing counted as "unsynced".
/// Mirrors `db::projects::log_project_sync`; takes the already-loaded row
/// because most callers have it in hand (e.g. from `RETURNING {SELECT_COLS}`).
pub(crate) async fn log_task_sync(
    pool: &SqlitePool,
    task: &LocalTask,
    operation: &str,
    changed_columns: Option<&str>,
) {
    let snapshot = sync::task_sync_snapshot(task);
    if let Err(e) =
        sync::append_sync_log(pool, "local_tasks", &task.id, operation, changed_columns, Some(&snapshot)).await
    {
        log::warn!("log_task_sync: sync_log append failed for task {}: {e}", task.id);
    }
}

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
            let snapshot = sync::task_sync_snapshot(&task);
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

    let mut rows: Vec<LocalTask> = if let Some(val) = bind_val {
        sqlx::query_as::<_, LocalTask>(&query)
            .bind(val)
            .fetch_all(pool)
            .await?
    } else {
        sqlx::query_as::<_, LocalTask>(&query)
            .fetch_all(pool)
            .await?
    };

    // Batch-load labels for every returned task with one aggregate query,
    // rather than one `labels_for_task` query per row — this list can hold
    // hundreds of tasks, and N+1 queries here would be the dominant cost of
    // loading the Today/project view.
    let label_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT task_id, label_id FROM task_labels ORDER BY rowid")
            .fetch_all(pool)
            .await?;
    let mut labels_by_task: HashMap<String, Vec<String>> = HashMap::new();
    for (task_id, label_id) in label_rows {
        labels_by_task.entry(task_id).or_default().push(label_id);
    }
    for task in rows.iter_mut() {
        if let Some(ids) = labels_by_task.remove(&task.id) {
            task.labels = ids;
        }
    }

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
        due_time,
        duration_minutes,
        recurrence_rule,
        section_id,
        label_ids,
    } = input;
    let content = content.as_str();
    let project_id = project_id.as_deref();
    let parent_id = parent_id.as_deref();
    let description = description.as_deref();
    let due_date = due_date.as_deref();
    let due_time = due_time.as_deref();
    let recurrence_rule = recurrence_rule.as_deref();
    let section_id = section_id.as_deref();

    let id = Uuid::new_v4().to_string();
    let project_id = project_id.unwrap_or("inbox");
    let priority = priority.unwrap_or(1);

    // No FK on local_tasks.section_id — validate app-side that the section
    // actually belongs to this task's project before writing it.
    if let Some(sec_id) = section_id {
        if !section_belongs_to_project(pool, sec_id, project_id).await? {
            return Err(crate::Error::Other(format!(
                "create_local_task: section '{sec_id}' does not belong to project '{project_id}'"
            )));
        }
    }

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
        "INSERT INTO local_tasks (id, parent_id, content, description, project_id, priority, due_date, due_time, duration_minutes, recurrence_rule, section_id, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(parent_id)
    .bind(content)
    .bind(description)
    .bind(project_id)
    .bind(priority)
    .bind(due_date)
    .bind(due_time)
    .bind(duration_minutes)
    .bind(recurrence_rule)
    .bind(section_id)
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
    let snapshot = sync::task_sync_snapshot(&task);
    sync::append_sync_log(pool, "local_tasks", &task.id, "INSERT", None, Some(&snapshot)).await.ok();

    // Todoist mutation observer: best-effort, enqueues an outbox create op if adapter active
    crate::integrations::todoist::observer::on_task_mutation(
        pool,
        crate::integrations::todoist::observer::TaskMutation::Created(&task),
    )
    .await;

    // `label_ids` delegates to `set_task_labels`, which does its own
    // transactional assignment + sync_log/observer firing (fields_changed =
    // ["labels"]) and returns the task with `labels` populated — a brand new
    // task otherwise has no `task_labels` rows, so there's nothing to query
    // for when this is absent.
    if let Some(ids) = label_ids {
        return labels::set_task_labels(pool, &task.id, &ids).await;
    }

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
        due_time,
        duration_minutes,
        recurrence_rule,
        section_id,
        label_ids,
        clear_due_time,
        clear_recurrence,
        clear_section,
        clear_duration,
    } = input;
    let content = content.as_deref();
    let description = description.as_deref();
    let project_id = project_id.as_deref();
    let due_date = due_date.as_deref();
    let linked_doc_id = linked_doc_id.as_deref();
    let due_time = due_time.as_deref();
    let recurrence_rule = recurrence_rule.as_deref();
    let section_id = section_id.as_deref();

    // No FK on local_tasks.section_id — validate app-side that the section
    // belongs to this task's *final* project (the one supplied in this same
    // call, if any, else the task's current one) before writing it.
    if let Some(sec_id) = section_id {
        let target_project_id: String = match project_id {
            Some(pid) => pid.to_string(),
            None => sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id = ?")
                .bind(id)
                .fetch_optional(pool)
                .await?
                .ok_or_else(|| crate::Error::Other(format!("update_local_task: no such task '{id}'")))?,
        };
        if !section_belongs_to_project(pool, sec_id, &target_project_id).await? {
            return Err(crate::Error::Other(format!(
                "update_local_task: section '{sec_id}' does not belong to project '{target_project_id}'"
            )));
        }
    }

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
    if let Some(time) = due_time {
        sqlx::query("UPDATE local_tasks SET due_time = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(time)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(minutes) = duration_minutes {
        sqlx::query("UPDATE local_tasks SET duration_minutes = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(minutes)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(rule) = recurrence_rule {
        sqlx::query("UPDATE local_tasks SET recurrence_rule = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(rule)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(sec_id) = section_id {
        sqlx::query("UPDATE local_tasks SET section_id = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(sec_id)
            .bind(id)
            .execute(pool)
            .await?;
    }
    // `clear_due_time` also nulls `duration_minutes`: a block length with no
    // start time is meaningless, so the two clear together rather than
    // leaving a dangling duration on an all-day task.
    if clear_due_time {
        sqlx::query(
            "UPDATE local_tasks SET due_time = NULL, duration_minutes = NULL, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(id)
        .execute(pool)
        .await?;
    }
    if clear_recurrence {
        sqlx::query("UPDATE local_tasks SET recurrence_rule = NULL, updated_at = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    if clear_section {
        sqlx::query("UPDATE local_tasks SET section_id = NULL, updated_at = datetime('now') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    // Independent of `clear_due_time` (which also nulls duration_minutes,
    // see above) — this is the "duration only" clear path, e.g. the
    // TaskEditor's duration select "clear" action on a task that keeps its
    // due time.
    if clear_duration {
        sqlx::query("UPDATE local_tasks SET duration_minutes = NULL, updated_at = datetime('now') WHERE id = ?")
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
    if due_time.is_some() || clear_due_time { fields_changed.push("due_time"); }
    if duration_minutes.is_some() || clear_due_time || clear_duration { fields_changed.push("duration_minutes"); }
    if recurrence_rule.is_some() || clear_recurrence { fields_changed.push("recurrence_rule"); }
    if section_id.is_some() || clear_section { fields_changed.push("section_id"); }
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

    let mut task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
        .bind(id)
        .fetch_one(pool)
        .await?;
    // Every task-returning fn carries `labels` — populate it here even when
    // this update didn't touch them, so a plain content/date edit doesn't
    // silently report the task as label-less.
    task.labels = labels::labels_for_task(pool, id).await.unwrap_or_default();

    // Sync log: UPDATE with changed columns
    if !fields_changed.is_empty() {
        let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
        let snapshot = sync::task_sync_snapshot(&task);
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

    // `label_ids` delegates to `set_task_labels`, which does its own
    // transactional replace + sync_log/observer firing (fields_changed =
    // ["labels"]) and returns the task with `labels` populated — runs last so
    // its re-fetch reflects every other field update above.
    if let Some(ids) = label_ids {
        return labels::set_task_labels(pool, id, &ids).await;
    }

    Ok(task)
}

/// Update task status (backlog, todo, in_progress, blocked, complete).
/// Delegates to `update_task_status_at` with the real local date.
pub async fn update_task_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    note: Option<&str>,
) -> crate::Result<()> {
    update_task_status_at(pool, id, status, note, chrono::Local::now().date_naive()).await
}

/// Same as `update_task_status`, but takes `today` explicitly instead of
/// reading the wall clock. This is what makes the recurrence-on-complete
/// branch below testable with fixed dates instead of ones that go stale as
/// real time passes; `update_task_status` is the production entry point.
pub async fn update_task_status_at(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    note: Option<&str>,
    today: chrono::NaiveDate,
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

    // Re-completing an already-complete task is a no-op. Without this, a
    // bulk-complete over a selection containing a completed task re-stamps
    // its completed_at AND emits a fresh-timestamped sync_log snapshot —
    // which LWW-outranks (and silently reverts) a reopen made on another
    // device that hasn't pulled here yet. The `old == "complete"` half keeps
    // the repair path open for rows stuck at completed=1/status!='complete'.
    if is_complete && was_completed && old == "complete" {
        return Ok(());
    }

    // Subtasks the completion cascade below actually changes — captured so the
    // sync_log write at the bottom can log each one. Logging only the parent
    // left subtask completions invisible to Turso: the Mac showed them
    // complete, every other device still showed them open.
    let mut cascaded_subtasks: Vec<LocalTask> = Vec::new();
    if is_complete {
        // Recurrence check, ahead of the normal completion path: a recurring
        // task (rule parses AND has a due date) reschedules instead of
        // completing. An unparseable rule or a missing due date falls
        // through below and completes normally (rule is inert).
        let recur_row: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT recurrence_rule, due_date, due_time FROM local_tasks WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        if let Some((Some(rule_str), Some(due_date_str), existing_due_time)) = recur_row {
            if let Some(rule) = crate::recurrence::parse_rule(&rule_str) {
                if let Ok(current_due) =
                    chrono::NaiveDate::parse_from_str(&due_date_str, "%Y-%m-%d")
                {
                    let next_due = crate::recurrence::next_occurrence(&rule, current_due, today);
                    let next_due_str = next_due.format("%Y-%m-%d").to_string();
                    let new_due_time = rule.time.clone().or(existing_due_time);

                    // `completed = 0, completed_at = NULL` matters for the
                    // zombie state completed=1/status='todo' (reachable when
                    // the completion cascade marks a RECURRING subtask
                    // complete and it is later re-completed): without the
                    // reset, the row would claim to be open while every
                    // open-task list (all filter completed = 0) hides it.
                    sqlx::query(
                        "UPDATE local_tasks SET due_date = ?, due_time = ?, status = 'todo', completed = 0, completed_at = NULL, updated_at = datetime('now', 'localtime') WHERE id = ?",
                    )
                    .bind(&next_due_str)
                    .bind(&new_due_time)
                    .bind(id)
                    .execute(pool)
                    .await?;

                    activity::log_activity(
                        pool,
                        "task_recurred",
                        Some(id),
                        Some(serde_json::json!({ "from": due_date_str, "to": &next_due_str })),
                    )
                    .await;

                    let row: Option<LocalTask> = sqlx::query_as::<_, LocalTask>(&format!(
                        "SELECT {} FROM local_tasks WHERE id = ?",
                        SELECT_COLS
                    ))
                    .bind(id)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten();

                    if let Some(task) = &row {
                        let fields_changed: Vec<String> = vec![
                            "due_date".to_string(),
                            "due_time".to_string(),
                            "status".to_string(),
                            "completed".to_string(),
                            "completed_at".to_string(),
                        ];
                        let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
                        let snapshot = sync::task_sync_snapshot(task);
                        sync::append_sync_log(
                            pool,
                            "local_tasks",
                            id,
                            "UPDATE",
                            Some(&changed),
                            Some(&snapshot),
                        )
                        .await
                        .ok();

                        crate::integrations::todoist::observer::on_task_mutation(
                            pool,
                            crate::integrations::todoist::observer::TaskMutation::Updated {
                                task,
                                fields_changed: &fields_changed,
                            },
                        )
                        .await;
                    }

                    return Ok(());
                }
            }
        }

        sqlx::query(
            "UPDATE local_tasks SET status = ?, completed = 1, completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE id = ?",
        )
        .bind(status)
        .bind(id)
        .execute(pool)
        .await?;

        // Also complete all still-open subtasks. `completed = 0` matches the
        // web client's cascade (turso/tasks.ts `setTaskStatus`): re-completing
        // a parent must not re-stamp `completed_at` on already-complete
        // children, and it keeps the sync_log entries below scoped to rows
        // that actually changed. RETURNING the full row makes capture and
        // mutation one statement — a subtask inserted between a separate
        // SELECT and this UPDATE would be completed without ever being
        // logged — and it returns the post-update state, so no re-read.
        cascaded_subtasks = sqlx::query_as::<_, LocalTask>(&format!(
            "UPDATE local_tasks SET status = 'complete', completed = 1, completed_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime') WHERE parent_id = ? AND completed = 0 RETURNING {}",
            SELECT_COLS
        ))
        .bind(id)
        .fetch_all(pool)
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
        let snapshot = sync::task_sync_snapshot(task);
        sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    // Sync log: one UPDATE per subtask the completion cascade changed, with a
    // full post-update snapshot each (receivers upsert whole rows, so a
    // partial snapshot would blank the other columns). Mirrors the web
    // client's `setTaskStatus`, which was doing this before desktop did. The
    // Todoist observer is deliberately NOT fired per subtask — Todoist
    // cascades a parent completion to its subtasks server-side, so per-child
    // ops would be redundant echoes.
    let changed = serde_json::json!(["status", "completed", "completed_at"]).to_string();
    for sub in &cascaded_subtasks {
        log_task_sync(pool, sub, "UPDATE", Some(&changed)).await;
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

// ── Markdown migration ──
//
// Task 12 (2026-08-09): local_tasks.description is markdown-canonical from
// here forward — the TaskDetailPage editor now loads/saves through
// tiptap-markdown unconditionally (no per-row format toggle like docs has,
// since there's no legacy HTML consumer left to support). This is a
// one-time backfill for rows written before that switch. Mirrors
// db::docs::{preview,migrate}_docs_markdown_migration's detection (the
// `<`-prefix heuristic) and backup pattern; reuses the same shared
// `html_to_markdown`/`scan_unknown_tags` parser used there — Todoist-pulled
// descriptions are already markdown stored raw and must pass through
// untouched, which the `<`-prefix check guarantees.

#[derive(Debug, serde::Serialize)]
pub struct FlaggedTask {
    pub id: String,
    pub content: String,
    pub unknown_tags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct TasksMdPreview {
    pub total: i64,
    pub convertible: usize,
    pub already_plain: usize,
    pub flagged: Vec<FlaggedTask>,
}

#[derive(Debug, serde::Serialize)]
pub struct TasksMdResult {
    pub converted: usize,
    pub skipped_plain: usize,
    pub backup_path: String,
}

/// Dry-run report over every non-null `local_tasks.description`: how many
/// look like HTML (would be converted), how many are already plain/markdown
/// (left untouched — this is where verbatim Todoist-synced descriptions
/// land), and which contain tags outside the known Tiptap allowlist (risk of
/// lossy conversion). Read-only — never writes.
pub async fn preview_tasks_markdown_migration(pool: &SqlitePool) -> crate::Result<TasksMdPreview> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, content, description FROM local_tasks WHERE description IS NOT NULL AND description != ''",
    )
    .fetch_all(pool)
    .await?;
    let total = rows.len() as i64;
    let mut convertible = 0;
    let mut already_plain = 0;
    let mut flagged = Vec::new();
    for (id, content, description) in rows {
        if !description.trim_start().starts_with('<') {
            already_plain += 1;
            continue;
        }
        convertible += 1;
        let unknown = scan_unknown_tags(&description);
        if !unknown.is_empty() {
            flagged.push(FlaggedTask { id, content, unknown_tags: unknown });
        }
    }
    Ok(TasksMdPreview { total, convertible, already_plain, flagged })
}

/// Back up the live DB (via `VACUUM INTO`, safe while open), then convert
/// every HTML `local_tasks.description` to markdown in a single transaction.
/// Unlike docs, there's no format setting to flip afterward — the editor
/// reads/writes markdown unconditionally as of Task 12.
///
/// Idempotent: rows that no longer start with '<' are skipped, so re-running
/// after a successful migration converts nothing.
pub async fn migrate_tasks_to_markdown(
    pool: &SqlitePool,
    backup_path: &str,
) -> crate::Result<TasksMdResult> {
    // 1. Online backup (safe while the DB is open)
    sqlx::query("VACUUM INTO ?").bind(backup_path).execute(pool).await?;

    // 2. Convert everything in one transaction
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, description FROM local_tasks WHERE description IS NOT NULL AND description != ''",
    )
    .fetch_all(pool)
    .await?;
    let mut converted = 0usize;
    let mut skipped_plain = 0usize;
    let mut tx = pool.begin().await?;
    let mut touched: Vec<String> = Vec::new();
    for (id, description) in rows {
        if !description.trim_start().starts_with('<') {
            skipped_plain += 1;
            continue;
        }
        let md = html_to_markdown(&description);
        sqlx::query("UPDATE local_tasks SET description = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(&md)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        converted += 1;
        touched.push(id);
    }
    tx.commit().await?;

    // 3. Sync-log the converted tasks so Turso propagates the new content.
    //
    // Also fire the Todoist mutation observer for tasks Todoist owns
    // (`external_source == "todoist"`). The raw `UPDATE` above (like the
    // sync_log append) bypasses `update_local_task`'s normal path, which is
    // the only other place that calls `on_task_mutation` for a description
    // edit — without this, a converted description on a Todoist-linked task
    // would diverge from Todoist forever, silently, since nothing would ever
    // enqueue the push. This is a deliberate, explicit choice (not the
    // implicit gap it started as): gate on `external_source` here rather
    // than firing for every touched row, since only Todoist-linked tasks
    // have anywhere to push to, and the volume is bounded by rows this
    // migration actually converts (locally-HTML descriptions only) — no
    // flood risk even on a large task list. `on_task_mutation` is
    // best-effort (logs and swallows errors), matching every other call site
    // in this file.
    for id in &touched {
        let row: Option<LocalTask> =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten();
        if let Some(task) = row {
            let changed = serde_json::json!(["description"]).to_string();
            let snapshot = sync::task_sync_snapshot(&task);
            sync::append_sync_log(pool, "local_tasks", id, "UPDATE", Some(&changed), Some(&snapshot))
                .await
                .ok();

            if task.external_source.as_deref() == Some("todoist") {
                let fields_changed = vec!["description".to_string()];
                crate::integrations::todoist::observer::on_task_mutation(
                    pool,
                    crate::integrations::todoist::observer::TaskMutation::Updated {
                        task: &task,
                        fields_changed: &fields_changed,
                    },
                )
                .await;
            }
        }
    }
    Ok(TasksMdResult { converted, skipped_plain, backup_path: backup_path.to_string() })
}

#[cfg(test)]
mod md_migration_tests {
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, LocalTask};
    use sqlx::SqlitePool;
    use super::SELECT_COLS;

    /// No standalone single-row getter exists on this module (every other
    /// caller inlines the same `SELECT {SELECT_COLS} ... WHERE id = ?`) — a
    /// tiny local helper beats repeating that four times in these tests.
    async fn fetch(pool: &SqlitePool, id: &str) -> LocalTask {
        sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn preview_reports_flagged_tasks_without_writing() {
        let pool = test_pool().await;
        let clean = super::create_local_task(&pool, CreateTaskInput {
            content: "Clean".into(),
            description: Some("<p>hello <strong>world</strong></p>".into()),
            ..Default::default()
        }).await.unwrap();
        let risky = super::create_local_task(&pool, CreateTaskInput {
            content: "Risky".into(),
            description: Some("<table><tr><td>x</td></tr></table>".into()),
            ..Default::default()
        }).await.unwrap();
        let already_md = super::create_local_task(&pool, CreateTaskInput {
            content: "Already markdown".into(),
            description: Some("**already** markdown, e.g. from Todoist".into()),
            ..Default::default()
        }).await.unwrap();

        let preview = super::preview_tasks_markdown_migration(&pool).await.unwrap();
        assert_eq!(preview.total, 3);
        assert_eq!(preview.convertible, 2);
        assert_eq!(preview.already_plain, 1);
        assert_eq!(preview.flagged.len(), 1);
        assert_eq!(preview.flagged[0].id, risky.id);

        // Read-only: nothing changed.
        let reloaded_clean = fetch(&pool, &clean.id).await;
        assert_eq!(reloaded_clean.description.as_deref(), Some("<p>hello <strong>world</strong></p>"));
        let reloaded_md = fetch(&pool, &already_md.id).await;
        assert_eq!(reloaded_md.description.as_deref(), Some("**already** markdown, e.g. from Todoist"));
    }

    #[tokio::test]
    async fn migrate_converts_html_and_leaves_markdown_untouched() {
        let pool = test_pool().await;
        let html_task = super::create_local_task(&pool, CreateTaskInput {
            content: "HTML".into(),
            description: Some("<p>hello <strong>world</strong></p>".into()),
            ..Default::default()
        }).await.unwrap();
        let md_task = super::create_local_task(&pool, CreateTaskInput {
            content: "Markdown".into(),
            description: Some("already **markdown** from Todoist".into()),
            ..Default::default()
        }).await.unwrap();

        let tmp = std::env::temp_dir().join(format!("nimble-test-backup-{}.db", uuid::Uuid::new_v4()));
        let result = super::migrate_tasks_to_markdown(&pool, tmp.to_str().unwrap()).await.unwrap();
        assert_eq!(result.converted, 1);
        assert_eq!(result.skipped_plain, 1);
        std::fs::remove_file(&tmp).ok();

        let converted = fetch(&pool, &html_task.id).await;
        let desc = converted.description.unwrap();
        assert!(desc.contains("**world**"), "expected bold markdown, got: {desc}");
        assert!(!desc.contains('<'), "no HTML tags may survive: {desc}");

        let untouched = fetch(&pool, &md_task.id).await;
        assert_eq!(untouched.description.as_deref(), Some("already **markdown** from Todoist"));

        // Regression: the backfill's sync_log snapshot must go through
        // `task_sync_snapshot`, not a plain `serde_json::to_string(&task)`,
        // or it carries a `labels` key that has no matching `local_tasks`
        // column and breaks the Turso push (see `sync::task_sync_snapshot`'s
        // doc comment).
        let snapshot: String = sqlx::query_scalar(
            "SELECT snapshot FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ? AND operation = 'UPDATE' ORDER BY timestamp DESC LIMIT 1"
        )
        .bind(&html_task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(!snapshot.contains("\"labels\""), "backfill snapshot must not carry the derived labels field: {snapshot}");

        // Idempotent: running again converts nothing further.
        let tmp2 = std::env::temp_dir().join(format!("nimble-test-backup2-{}.db", uuid::Uuid::new_v4()));
        let second = super::migrate_tasks_to_markdown(&pool, tmp2.to_str().unwrap()).await.unwrap();
        assert_eq!(second.converted, 0);
        std::fs::remove_file(&tmp2).ok();
    }

    /// Fix for review finding 2: the backfill's raw UPDATE bypasses
    /// `update_local_task`'s normal path, which is the only other place a
    /// description edit fires the Todoist observer. Without an explicit
    /// fire here, a converted description on a Todoist-linked task would
    /// silently diverge from Todoist forever (nothing would ever enqueue the
    /// push). Verifies the fix enqueues an update op for a converted,
    /// Todoist-linked task and does NOT enqueue anything for a converted
    /// purely-local task (bounding volume to rows that both converted AND
    /// have somewhere to push to).
    #[tokio::test]
    async fn migrate_enqueues_todoist_update_for_linked_tasks_only() {
        let pool = test_pool().await;
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();

        let linked = super::create_local_task(&pool, CreateTaskInput {
            content: "Linked".into(),
            description: Some("<p>hello <strong>world</strong></p>".into()),
            ..Default::default()
        }).await.unwrap();
        // Simulate a task already synced to Todoist in a previous cycle:
        // external_source/external_id set, and clear the 'create' op the
        // observer enqueued on create_local_task above so only the
        // migration's own enqueue is visible below.
        sqlx::query("UPDATE local_tasks SET external_id = 'ext-1', external_source = 'todoist' WHERE id = ?")
            .bind(&linked.id).execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id = ?")
            .bind(&linked.id).execute(&pool).await.unwrap();

        let local_only = super::create_local_task(&pool, CreateTaskInput {
            content: "Local only".into(),
            description: Some("<p>plain local</p>".into()),
            ..Default::default()
        }).await.unwrap();
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id = ?")
            .bind(&local_only.id).execute(&pool).await.unwrap();

        let tmp = std::env::temp_dir().join(format!("nimble-test-backup-{}.db", uuid::Uuid::new_v4()));
        let result = super::migrate_tasks_to_markdown(&pool, tmp.to_str().unwrap()).await.unwrap();
        assert_eq!(result.converted, 2);
        std::fs::remove_file(&tmp).ok();

        let batch = crate::integrations::todoist::outbox::pending_batch(&pool, 100).await.unwrap();
        let linked_op = batch.iter().find(|r| r.local_id == linked.id);
        assert!(linked_op.is_some(), "expected an enqueued op for the Todoist-linked task, got: {:?}",
            batch.iter().map(|r| (&r.local_id, &r.op)).collect::<Vec<_>>());
        let linked_op = linked_op.unwrap();
        assert_eq!(linked_op.op, "update");
        assert!(linked_op.payload.get("description").is_some(), "expected description in push payload, got: {:?}", linked_op.payload);
        assert!(!batch.iter().any(|r| r.local_id == local_only.id),
            "expected no enqueued op for the purely-local task, got: {:?}",
            batch.iter().map(|r| (&r.local_id, &r.op)).collect::<Vec<_>>());
    }
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, LocalTask, UpdateTaskInput};
    use super::SELECT_COLS;

    /// Task 7 Step 1: create with all new fields, read back intact (incl.
    /// `labels` populated via `get_local_tasks`'s aggregate join, not a
    /// per-task query).
    #[tokio::test]
    async fn create_task_with_new_fields_roundtrips_through_get_local_tasks() {
        let pool = test_pool().await;
        let project = crate::db::projects::create_project(&pool, "Errands", "blue", None).await.unwrap();
        let section = crate::db::sections::create_section(&pool, &project.id, "Groceries").await.unwrap();
        let label = crate::db::labels::create_label(&pool, "deep work", "orange").await.unwrap();

        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "Buy milk".to_string(),
                project_id: Some(project.id.clone()),
                due_time: Some("09:30".to_string()),
                duration_minutes: Some(45),
                recurrence_rule: Some("every day".to_string()),
                section_id: Some(section.id.clone()),
                label_ids: Some(vec![label.id.clone()]),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(task.due_time.as_deref(), Some("09:30"));
        assert_eq!(task.duration_minutes, Some(45));
        assert_eq!(task.recurrence_rule.as_deref(), Some("every day"));
        assert_eq!(task.section_id.as_deref(), Some(section.id.as_str()));
        assert_eq!(task.labels, vec![label.id.clone()]);

        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let fetched = all.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(fetched.due_time.as_deref(), Some("09:30"));
        assert_eq!(fetched.duration_minutes, Some(45));
        assert_eq!(fetched.recurrence_rule.as_deref(), Some("every day"));
        assert_eq!(fetched.section_id.as_deref(), Some(section.id.as_str()));
        assert_eq!(fetched.labels, vec![label.id]);
    }

    /// Completing a parent cascades to its open subtasks — and each cascaded
    /// subtask must get its OWN sync_log UPDATE entry with a full snapshot.
    /// Logging only the parent (the pre-fix behavior) left subtask
    /// completions invisible to Turso: the Mac showed them complete, every
    /// other device still showed them open.
    #[tokio::test]
    async fn completing_a_parent_writes_a_sync_log_entry_per_cascaded_subtask() {
        let pool = test_pool().await;
        let parent = super::create_local_task(
            &pool,
            CreateTaskInput { content: "parent".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        let sub_open = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "open sub".to_string(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let sub_done = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "already done".to_string(),
                parent_id: Some(parent.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        // Pre-complete one subtask, then clear sync_log so the assertions
        // below see only what the parent completion writes.
        super::update_task_status(&pool, &sub_done.id, "complete", None).await.unwrap();
        sqlx::query("DELETE FROM sync_log").execute(&pool).await.unwrap();

        super::update_task_status(&pool, &parent.id, "complete", None).await.unwrap();

        let logged_ids: Vec<String> = sqlx::query_scalar(
            "SELECT row_id FROM sync_log WHERE table_name = 'local_tasks' AND operation = 'UPDATE'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(logged_ids.contains(&parent.id), "parent completion must be logged");
        assert!(
            logged_ids.contains(&sub_open.id),
            "cascaded subtask completion must be logged — this is the cross-device bug"
        );
        assert!(
            !logged_ids.contains(&sub_done.id),
            "an already-complete subtask didn't change and must not be re-logged"
        );

        // Full-row snapshot: receivers upsert whole rows, so a partial
        // snapshot would blank every omitted column on other devices. And it
        // must go through `task_sync_snapshot` (no `labels` pseudo-column).
        let snapshot: String = sqlx::query_scalar(
            "SELECT snapshot FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ?",
        )
        .bind(&sub_open.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
        assert_eq!(v["status"], "complete");
        assert_eq!(v["completed"], serde_json::json!(true));
        assert_eq!(v["content"], "open sub");
        assert!(v.get("id").is_some() && v.get("project_id").is_some());
        assert!(v.get("labels").is_none(), "snapshot must not carry the labels pseudo-column");

        // The DB rows themselves: both subtasks complete, the pre-completed
        // one keeps its original completed_at (no re-stamp on re-complete).
        let sub_rows: Vec<(String, i64)> = sqlx::query_as(
            "SELECT id, completed FROM local_tasks WHERE parent_id = ?",
        )
        .bind(&parent.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(sub_rows.iter().all(|(_, c)| *c == 1));
    }

    /// Re-completing an already-complete task must be a full no-op: no
    /// completed_at re-stamp and no fresh-timestamped sync_log entry, which
    /// would LWW-outrank (and silently revert) a reopen made on another
    /// device that hasn't been pulled yet.
    #[tokio::test]
    async fn recompleting_a_complete_task_is_a_noop() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "t".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        super::update_task_status(&pool, &task.id, "complete", None).await.unwrap();
        let stamp1: Option<String> =
            sqlx::query_scalar("SELECT completed_at FROM local_tasks WHERE id = ?")
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        sqlx::query("DELETE FROM sync_log").execute(&pool).await.unwrap();

        super::update_task_status(&pool, &task.id, "complete", None).await.unwrap();

        let stamp2: Option<String> =
            sqlx::query_scalar("SELECT completed_at FROM local_tasks WHERE id = ?")
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stamp1, stamp2, "completed_at must not be re-stamped");
        let log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(log_count, 0, "a no-op re-complete must not emit sync_log entries");
    }

    /// Completing a zombie row (completed=1 but status!='complete' — reachable
    /// when the cascade completes a RECURRING subtask that is later
    /// re-completed) must repair it: the recurrence branch resets
    /// completed/completed_at alongside status='todo', so the row never
    /// claims to be open while hidden from every open-task list.
    #[tokio::test]
    async fn completing_a_recurring_zombie_resets_completed_flag() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "recurring".to_string(),
                due_date: Some("2026-08-10".to_string()),
                recurrence_rule: Some("every day".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // Force the zombie state a cascade over a recurring subtask creates.
        sqlx::query("UPDATE local_tasks SET completed = 1, completed_at = datetime('now'), status = 'todo' WHERE id = ?")
            .bind(&task.id)
            .execute(&pool)
            .await
            .unwrap();

        super::update_task_status_at(
            &pool,
            &task.id,
            "complete",
            None,
            chrono::NaiveDate::from_ymd_opt(2026, 8, 19).unwrap(),
        )
        .await
        .unwrap();

        let (completed, completed_at, status, due): (i64, Option<String>, String, Option<String>) =
            sqlx::query_as(
                "SELECT completed, completed_at, status, due_date FROM local_tasks WHERE id = ?",
            )
            .bind(&task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(completed, 0, "recurrence must clear the completed flag");
        assert_eq!(completed_at, None);
        assert_eq!(status, "todo");
        assert_eq!(due.as_deref(), Some("2026-08-20"), "due date advances past today");
    }

    /// `create_local_task` must reject a `section_id` that doesn't belong to
    /// the task's project — no FK exists to catch this at the SQLite layer.
    #[tokio::test]
    async fn create_task_rejects_section_from_a_different_project() {
        let pool = test_pool().await;
        let p1 = crate::db::projects::create_project(&pool, "P1", "blue", None).await.unwrap();
        let p2 = crate::db::projects::create_project(&pool, "P2", "red", None).await.unwrap();
        let section = crate::db::sections::create_section(&pool, &p1.id, "Section").await.unwrap();

        let err = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "x".to_string(),
                project_id: Some(p2.id.clone()),
                section_id: Some(section.id.clone()),
                ..Default::default()
            },
        )
        .await;
        assert!(err.is_err());
    }

    /// Each new field updates independently, and `fields_changed` (surfaced
    /// via `sync_log.changed_columns`) carries the exact column names so
    /// sync_log/the Todoist observer fire per field.
    #[tokio::test]
    async fn update_local_task_updates_new_fields_independently_with_exact_field_names() {
        let pool = test_pool().await;
        let project = crate::db::projects::create_project(&pool, "Errands", "blue", None).await.unwrap();
        let section = crate::db::sections::create_section(&pool, &project.id, "Groceries").await.unwrap();
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "Buy milk".to_string(), project_id: Some(project.id.clone()), ..Default::default() },
        )
        .await
        .unwrap();

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { due_time: Some("14:00".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.due_time.as_deref(), Some("14:00"));

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { duration_minutes: Some(30), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.duration_minutes, Some(30));

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { recurrence_rule: Some("every week".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.recurrence_rule.as_deref(), Some("every week"));

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { section_id: Some(section.id.clone()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.section_id.as_deref(), Some(section.id.as_str()));

        let logged: Vec<(String,)> = sqlx::query_as(
            "SELECT changed_columns FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ? ORDER BY timestamp",
        )
        .bind(&task.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        let all_changed: Vec<String> = logged.into_iter().map(|(c,)| c).collect();
        assert!(all_changed.iter().any(|c| c.contains("due_time")));
        assert!(all_changed.iter().any(|c| c.contains("duration_minutes")));
        assert!(all_changed.iter().any(|c| c.contains("recurrence_rule")));
        assert!(all_changed.iter().any(|c| c.contains("section_id")));
    }

    /// `update_local_task` must reject a `section_id` that doesn't belong to
    /// the task's current project.
    #[tokio::test]
    async fn update_task_rejects_section_from_a_different_project() {
        let pool = test_pool().await;
        let p1 = crate::db::projects::create_project(&pool, "P1", "blue", None).await.unwrap();
        let p2 = crate::db::projects::create_project(&pool, "P2", "red", None).await.unwrap();
        let section = crate::db::sections::create_section(&pool, &p1.id, "Section").await.unwrap();
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), project_id: Some(p2.id.clone()), ..Default::default() },
        )
        .await
        .unwrap();

        let err = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { section_id: Some(section.id.clone()), ..Default::default() },
        )
        .await;
        assert!(err.is_err());
    }

    /// `label_ids` on update delegates to `set_task_labels` and the returned
    /// task carries the new label set.
    #[tokio::test]
    async fn update_local_task_label_ids_delegates_to_set_task_labels() {
        let pool = test_pool().await;
        let label = crate::db::labels::create_label(&pool, "deep work", "orange").await.unwrap();
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        assert!(task.labels.is_empty());

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { label_ids: Some(vec![label.id.clone()]), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.labels, vec![label.id]);
    }

    /// A plain update that doesn't touch labels must still return the task's
    /// existing labels, not an empty vec — every task-returning fn carries
    /// `labels`, not just the ones that just changed them.
    #[tokio::test]
    async fn update_local_task_preserves_existing_labels_when_not_touched() {
        let pool = test_pool().await;
        let label = crate::db::labels::create_label(&pool, "deep work", "orange").await.unwrap();
        let task = super::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), label_ids: Some(vec![label.id.clone()]), ..Default::default() },
        )
        .await
        .unwrap();

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { content: Some("y".to_string()), ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.labels, vec![label.id]);
    }

    /// `clear_due_time` nulls `due_time` (and the duration that hangs off
    /// it — a block length with no start time is meaningless); `clear_recurrence`
    /// and `clear_section` null their respective columns.
    #[tokio::test]
    async fn clear_flags_null_their_columns() {
        let pool = test_pool().await;
        let project = crate::db::projects::create_project(&pool, "Errands", "blue", None).await.unwrap();
        let section = crate::db::sections::create_section(&pool, &project.id, "Groceries").await.unwrap();
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "x".to_string(),
                project_id: Some(project.id.clone()),
                due_time: Some("09:00".to_string()),
                duration_minutes: Some(60),
                recurrence_rule: Some("every day".to_string()),
                section_id: Some(section.id.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { clear_due_time: true, clear_recurrence: true, clear_section: true, ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.due_time, None);
        assert_eq!(updated.duration_minutes, None);
        assert_eq!(updated.recurrence_rule, None);
        assert_eq!(updated.section_id, None);
    }

    /// `clear_duration` (Task 13's TaskEditor "clear" action on the duration
    /// select) is the standalone counterpart to `clear_due_time` above —
    /// it must null duration_minutes WITHOUT touching due_time, so a task
    /// can keep a start time while dropping its block length.
    #[tokio::test]
    async fn clear_duration_nulls_duration_without_touching_due_time() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "x".to_string(),
                due_time: Some("09:00".to_string()),
                duration_minutes: Some(60),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        let updated = super::update_local_task(
            &pool,
            &task.id,
            UpdateTaskInput { clear_duration: true, ..Default::default() },
        )
        .await
        .unwrap();
        assert_eq!(updated.duration_minutes, None);
        assert_eq!(updated.due_time, Some("09:00".to_string()));
    }

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

    // --- Task 8: recurrence-on-complete wiring ---
    //
    // `today` is injected via `update_task_status_at` rather than read from
    // the wall clock, so these date assertions (mirroring the EDD fixture
    // in recurrence.rs's own tests: due 2026-08-16, "every 2 weeks @ 09:00"
    // -> 2026-08-30 -> 2026-09-13) never rot as real time passes.
    fn d(s: &str) -> chrono::NaiveDate {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Completing a recurring task with a due date reschedules instead of
    /// completing: due_date advances via `next_occurrence`, due_time takes
    /// the rule's time, status resets to "todo", completed stays false, and
    /// a `task_recurred` activity row is logged with the old/new due dates.
    #[tokio::test]
    async fn completing_recurring_task_with_due_date_reschedules_instead_of_completing() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "🔴 Certify for EDD benefits (UI Online)".to_string(),
                due_date: Some("2026-08-16".to_string()),
                due_time: Some("09:00".to_string()),
                recurrence_rule: Some("every 2 weeks @ 09:00".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status_at(&pool, &task.id, "complete", None, d("2026-08-10"))
            .await
            .unwrap();

        let updated: LocalTask =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!updated.completed);
        assert_eq!(updated.completed_at, None);
        assert_eq!(updated.status, "todo");
        assert_eq!(updated.due_date.as_deref(), Some("2026-08-30"));
        assert_eq!(updated.due_time.as_deref(), Some("09:00"));

        let logged: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT action_type, metadata FROM activity_log WHERE target_id = ? AND action_type = 'task_recurred'",
        )
        .bind(&task.id)
        .fetch_optional(&pool)
        .await
        .unwrap();
        let (action, metadata) = logged.expect("expected a task_recurred activity row");
        assert_eq!(action, "task_recurred");
        let metadata: serde_json::Value = serde_json::from_str(&metadata.unwrap()).unwrap();
        assert_eq!(metadata["from"], "2026-08-16");
        assert_eq!(metadata["to"], "2026-08-30");
    }

    /// Completing the same recurring task a second time in a row advances
    /// again from the new due date — the "twice in a row" exit test in
    /// miniature that Task 16's end-to-end test scales up.
    #[tokio::test]
    async fn completing_recurring_task_twice_in_a_row_advances_each_time() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "🔴 Certify for EDD benefits (UI Online)".to_string(),
                due_date: Some("2026-08-16".to_string()),
                due_time: Some("09:00".to_string()),
                recurrence_rule: Some("every 2 weeks @ 09:00".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status_at(&pool, &task.id, "complete", None, d("2026-08-10"))
            .await
            .unwrap();
        super::update_task_status_at(&pool, &task.id, "complete", None, d("2026-08-10"))
            .await
            .unwrap();

        let updated: LocalTask =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(updated.due_date.as_deref(), Some("2026-09-13"));
        assert_eq!(updated.status, "todo");
        assert!(!updated.completed);
    }

    /// A recurring task with no due date has nothing to advance from — the
    /// rule is inert and the task completes normally.
    #[tokio::test]
    async fn recurring_task_without_due_date_completes_normally() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "No due date".to_string(),
                recurrence_rule: Some("every 2 weeks @ 09:00".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status(&pool, &task.id, "complete", None).await.unwrap();

        let updated: LocalTask =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(updated.completed);
        assert!(updated.completed_at.is_some());
        assert_eq!(updated.status, "complete");
    }

    /// An unparseable recurrence rule is inert too — the task completes
    /// normally rather than silently getting stuck unable to recur.
    #[tokio::test]
    async fn unparseable_recurrence_rule_completes_normally() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "Weird rule".to_string(),
                due_date: Some("2026-08-16".to_string()),
                recurrence_rule: Some("every 3rd tuesday".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status(&pool, &task.id, "complete", None).await.unwrap();

        let updated: LocalTask =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(updated.completed);
        assert_eq!(updated.status, "complete");
        assert_eq!(updated.due_date.as_deref(), Some("2026-08-16")); // untouched
    }

    /// Recurrence only branches off the "complete" arm — every other status
    /// transition on a recurring task leaves the due date alone.
    #[tokio::test]
    async fn non_complete_status_on_recurring_task_leaves_due_date_untouched() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "🔴 Certify for EDD benefits (UI Online)".to_string(),
                due_date: Some("2026-08-16".to_string()),
                recurrence_rule: Some("every 2 weeks @ 09:00".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status(&pool, &task.id, "blocked", Some("waiting")).await.unwrap();

        let updated: LocalTask =
            sqlx::query_as::<_, LocalTask>(&format!("SELECT {} FROM local_tasks WHERE id = ?", SELECT_COLS))
                .bind(&task.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(updated.status, "blocked");
        assert_eq!(updated.due_date.as_deref(), Some("2026-08-16"));
        assert!(!updated.completed);
    }

    /// Sync log + Todoist observer fire with the exact `fields_changed` the
    /// brief specifies for a recurrence reschedule, distinct from the
    /// ["status", "completed", "completed_at"] set used by a normal
    /// completion.
    #[tokio::test]
    async fn recurrence_reschedule_logs_sync_with_exact_fields_changed() {
        let pool = test_pool().await;
        let task = super::create_local_task(
            &pool,
            CreateTaskInput {
                content: "🔴 Certify for EDD benefits (UI Online)".to_string(),
                due_date: Some("2026-08-16".to_string()),
                recurrence_rule: Some("every 2 weeks @ 09:00".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        super::update_task_status_at(&pool, &task.id, "complete", None, d("2026-08-10"))
            .await
            .unwrap();

        let logged: Vec<(String,)> = sqlx::query_as(
            "SELECT changed_columns FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ? ORDER BY timestamp DESC LIMIT 1",
        )
        .bind(&task.id)
        .fetch_all(&pool)
        .await
        .unwrap();
        let changed: Vec<String> = serde_json::from_str(&logged[0].0).unwrap();
        // completed/completed_at joined the list when the recurrence branch
        // started resetting them (zombie-row repair) — the Todoist observer
        // ignores both names, so this stays distinct from a normal completion
        // in effect as well as in shape.
        assert_eq!(
            changed,
            vec!["due_date", "due_time", "status", "completed", "completed_at"]
        );
    }
}
