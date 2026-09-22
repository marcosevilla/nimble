//! Native task mutations on a caller-owned SQLite connection.
//! No helper here begins a transaction or acquires a pool connection.
use std::collections::HashSet;

use chrono::NaiveDate;
use sqlx::SqliteConnection;
use uuid::Uuid;

use crate::db::{sync, tasks::SELECT_COLS};
use crate::integrations::todoist::observer::{self, TaskMutation};
use crate::types::{CreateTaskInput, LocalTask, UpdateTaskInput};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationPolicy {
    User,
    Remote,
    Import,
}

#[derive(Clone, Debug)]
pub struct RecurrenceEffect {
    pub task_id: String,
    pub before_due: String,
    pub after_due: String,
}

#[derive(Default, Debug)]
pub struct TaskEffects {
    pub changed: Vec<LocalTask>,
    pub deleted: Vec<LocalTask>,
    pub recurrence: Option<RecurrenceEffect>,
    pub previous_status: Option<String>,
}

fn validate_reminder(
    offset: Option<i64>,
    google: bool,
    date: Option<&str>,
    time: Option<&str>,
) -> crate::Result<()> {
    if offset.is_some_and(|v| !(0..=40320).contains(&v)) {
        return Err(crate::Error::Other(
            "reminder offset must be 0–40320 minutes".into(),
        ));
    }
    if (offset.is_some() || google) && (date.is_none() || time.is_none()) {
        return Err(crate::Error::Other(
            "a reminder requires a due date and time".into(),
        ));
    }
    if google && offset.is_none() {
        return Err(crate::Error::Other(
            "a phone alert requires a reminder offset".into(),
        ));
    }
    Ok(())
}

async fn fetch(conn: &mut SqliteConnection, id: &str) -> crate::Result<LocalTask> {
    let mut task: LocalTask =
        sqlx::query_as(&format!("SELECT {SELECT_COLS} FROM local_tasks WHERE id=?"))
            .bind(id)
            .fetch_one(&mut *conn)
            .await?;
    task.labels = sqlx::query_as::<_, (String,)>(
        "SELECT label_id FROM task_labels WHERE task_id=? ORDER BY rowid",
    )
    .bind(id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|r| r.0)
    .collect();
    Ok(task)
}

async fn sync_task(
    conn: &mut SqliteConnection,
    task: &LocalTask,
    op: &str,
    changed: Option<&str>,
) -> crate::Result<()> {
    sync::append_sync_log_tx(
        conn,
        "local_tasks",
        &task.id,
        op,
        changed,
        Some(&sync::task_sync_snapshot(task)),
    )
    .await
}

async fn set_labels_tx(
    conn: &mut SqliteConnection,
    task_id: &str,
    ids: &[String],
    policy: MutationPolicy,
) -> crate::Result<()> {
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for id in ids {
        if seen.insert(id.as_str()) {
            unique.push(id);
        }
    }
    for id in &unique {
        let found: Option<String> = sqlx::query_scalar("SELECT id FROM labels WHERE id=?")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
        if found.is_none() {
            return Err(crate::Error::Other(format!(
                "set_task_labels: unknown label id(s): {id}"
            )));
        }
    }
    let old: Vec<String> =
        sqlx::query_as::<_, (String,)>("SELECT label_id FROM task_labels WHERE task_id=?")
            .bind(task_id)
            .fetch_all(&mut *conn)
            .await?
            .into_iter()
            .map(|r| r.0)
            .collect();
    sqlx::query("DELETE FROM task_labels WHERE task_id=?")
        .bind(task_id)
        .execute(&mut *conn)
        .await?;
    for id in &unique {
        sqlx::query("INSERT INTO task_labels (task_id,label_id) VALUES (?,?)")
            .bind(task_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    let new: HashSet<&str> = unique.iter().map(|s| s.as_str()).collect();
    if policy == MutationPolicy::Remote {
        return Ok(());
    }
    for id in old {
        if !new.contains(id.as_str()) {
            sync::append_sync_log_tx(
                conn,
                "task_labels",
                &sync::task_labels_row_id(task_id, &id),
                "DELETE",
                None,
                None,
            )
            .await?;
        }
    }
    for id in unique {
        let created: String =
            sqlx::query_scalar("SELECT created_at FROM task_labels WHERE task_id=? AND label_id=?")
                .bind(task_id)
                .bind(id)
                .fetch_one(&mut *conn)
                .await?;
        let snapshot =
            serde_json::json!({"task_id":task_id,"label_id":id,"created_at":created}).to_string();
        sync::append_sync_log_tx(
            conn,
            "task_labels",
            &sync::task_labels_row_id(task_id, id),
            "INSERT",
            None,
            Some(&snapshot),
        )
        .await?;
    }
    Ok(())
}

pub async fn create_task_tx(
    conn: &mut SqliteConnection,
    input: CreateTaskInput,
    policy: MutationPolicy,
) -> crate::Result<LocalTask> {
    let project = input.project_id.as_deref().unwrap_or("inbox");
    let sync_policy = input.sync_policy.as_deref().unwrap_or("default");
    if !matches!(sync_policy, "default" | "local_only") {
        return Err(crate::Error::Other("invalid task sync policy".into()));
    }
    validate_reminder(
        input.reminder_offset_minutes,
        input.google_calendar_enabled.unwrap_or(false),
        input.due_date.as_deref(),
        input.due_time.as_deref(),
    )?;
    if let Some(section) = &input.section_id {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM sections WHERE id=? AND project_id=?")
                .bind(section)
                .bind(project)
                .fetch_optional(&mut *conn)
                .await?;
        if exists.is_none() {
            return Err(crate::Error::Other(format!(
                "create_local_task: section '{section}' does not belong to project '{project}'"
            )));
        }
    }
    let pos: i64 = if let Some(parent) = &input.parent_id {
        sqlx::query_scalar("SELECT COALESCE(MAX(position),-1)+1 FROM local_tasks WHERE parent_id=?")
            .bind(parent)
            .fetch_one(&mut *conn)
            .await?
    } else {
        sqlx::query_scalar("SELECT COALESCE(MAX(position),-1)+1 FROM local_tasks WHERE project_id=? AND parent_id IS NULL")
            .bind(project).fetch_one(&mut *conn).await?
    };
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO local_tasks (id,parent_id,content,description,project_id,priority,due_date,due_time,duration_minutes,recurrence_rule,section_id,reminder_offset_minutes,google_calendar_enabled,position,sync_policy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&input.parent_id).bind(&input.content).bind(&input.description).bind(project)
        .bind(input.priority.unwrap_or(1)).bind(&input.due_date).bind(&input.due_time).bind(input.duration_minutes)
        .bind(&input.recurrence_rule).bind(&input.section_id).bind(input.reminder_offset_minutes)
        .bind(input.google_calendar_enabled.unwrap_or(false)).bind(pos).bind(sync_policy)
        .execute(&mut *conn).await?;
    if let Some(ids) = &input.label_ids {
        set_labels_tx(conn, &id, ids, policy).await?;
    }
    let task = fetch(conn, &id).await?;
    if policy != MutationPolicy::Remote {
        sync_task(conn, &task, "INSERT", None).await?;
    }
    if policy == MutationPolicy::User {
        observer::on_task_mutation_tx(conn, TaskMutation::Created(&task)).await?;
        if input.label_ids.is_some() {
            let fields = vec!["labels".to_string()];
            observer::on_task_mutation_tx(
                conn,
                TaskMutation::Updated {
                    task: &task,
                    fields_changed: &fields,
                },
            )
            .await?;
        }
    }
    Ok(task)
}

pub async fn update_task_tx(
    conn: &mut SqliteConnection,
    id: &str,
    input: UpdateTaskInput,
    policy: MutationPolicy,
) -> crate::Result<LocalTask> {
    let mut next = fetch(conn, id).await?;
    let was_local_only = next.sync_policy == "local_only";
    let implicit_section_clear = input
        .project_id
        .as_deref()
        .is_some_and(|p| p != next.project_id)
        && input.section_id.is_none()
        && next.section_id.is_some();
    let mut fields: Vec<String> = Vec::new();
    macro_rules! set_field {
        ($field:ident) => {
            if let Some(value) = &input.$field {
                next.$field = value.clone();
                fields.push(stringify!($field).into());
            }
        };
    }
    if let Some(value) = &input.sync_policy {
        if !matches!(value.as_str(), "default" | "local_only") {
            return Err(crate::Error::Other("invalid task sync policy".into()));
        }
        next.sync_policy = value.clone();
        fields.push("sync_policy".into());
    }
    set_field!(content);
    if let Some(v) = &input.description {
        next.description = Some(v.clone());
        fields.push("description".into());
    }
    set_field!(project_id);
    set_field!(priority);
    if let Some(v) = &input.linked_doc_id {
        next.linked_doc_id = Some(v.clone());
        fields.push("linked_doc_id".into());
    }
    if let Some(v) = &input.due_date {
        next.due_date = Some(v.clone());
        fields.push("due_date".into());
    }
    if let Some(v) = &input.due_time {
        next.due_time = Some(v.clone());
        fields.push("due_time".into());
    }
    if let Some(v) = input.duration_minutes {
        next.duration_minutes = Some(v);
        fields.push("duration_minutes".into());
    }
    if let Some(v) = &input.recurrence_rule {
        next.recurrence_rule = Some(v.clone());
        fields.push("recurrence_rule".into());
    }
    if let Some(v) = &input.section_id {
        next.section_id = Some(v.clone());
        fields.push("section_id".into());
    }
    if let Some(v) = input.reminder_offset_minutes {
        next.reminder_offset_minutes = Some(v);
        fields.push("reminder_offset_minutes".into());
    }
    if let Some(v) = input.google_calendar_enabled {
        next.google_calendar_enabled = v;
        fields.push("google_calendar_enabled".into());
    }
    if implicit_section_clear || input.clear_section {
        next.section_id = None;
        fields.push("section_id".into());
    }
    if input.clear_due_date {
        next.due_date = None;
        fields.push("due_date".into());
    }
    if input.clear_due_time {
        next.due_time = None;
        next.duration_minutes = None;
        fields.extend(["due_time".into(), "duration_minutes".into()]);
    }
    if input.clear_duration {
        next.duration_minutes = None;
        fields.push("duration_minutes".into());
    }
    if input.clear_recurrence {
        next.recurrence_rule = None;
        fields.push("recurrence_rule".into());
    }
    if input.clear_reminder || input.clear_due_date || input.clear_due_time {
        next.reminder_offset_minutes = None;
        next.google_calendar_enabled = false;
        fields.extend([
            "reminder_offset_minutes".into(),
            "google_calendar_enabled".into(),
        ]);
    }
    if let Some(section) = &next.section_id {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT id FROM sections WHERE id=? AND project_id=?")
                .bind(section)
                .bind(&next.project_id)
                .fetch_optional(&mut *conn)
                .await?;
        if exists.is_none() {
            return Err(crate::Error::Other(format!(
                "update_local_task: section '{section}' does not belong to project '{}'",
                next.project_id
            )));
        }
    }
    validate_reminder(
        next.reminder_offset_minutes,
        next.google_calendar_enabled,
        next.due_date.as_deref(),
        next.due_time.as_deref(),
    )?;
    sqlx::query("UPDATE local_tasks SET content=?,description=?,project_id=?,priority=?,due_date=?,due_time=?,duration_minutes=?,recurrence_rule=?,section_id=?,linked_doc_id=?,reminder_offset_minutes=?,google_calendar_enabled=?,sync_policy=?,updated_at=datetime('now') WHERE id=?")
        .bind(&next.content).bind(&next.description).bind(&next.project_id).bind(next.priority)
        .bind(&next.due_date).bind(&next.due_time).bind(next.duration_minutes).bind(&next.recurrence_rule)
        .bind(&next.section_id).bind(&next.linked_doc_id).bind(next.reminder_offset_minutes)
        .bind(next.google_calendar_enabled).bind(&next.sync_policy).bind(id).execute(&mut *conn).await?;
    if let Some(ids) = &input.label_ids {
        set_labels_tx(conn, id, ids, policy).await?;
        fields.push("labels".into());
    }
    if next.sync_policy == "local_only" {
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id=? AND status='pending'")
            .bind(id)
            .execute(&mut *conn)
            .await?;
    }
    let task = fetch(conn, id).await?;
    if policy != MutationPolicy::Remote && !fields.is_empty() {
        fields.dedup();
        let changed =
            serde_json::to_string(&fields).map_err(|e| crate::Error::Other(e.to_string()))?;
        sync_task(conn, &task, "UPDATE", Some(&changed)).await?;
    }
    if policy == MutationPolicy::User && !fields.is_empty() {
        if was_local_only && task.sync_policy == "default" {
            observer::on_task_mutation_tx(conn, TaskMutation::Created(&task)).await?;
        }
        observer::on_task_mutation_tx(
            conn,
            TaskMutation::Updated {
                task: &task,
                fields_changed: &fields,
            },
        )
        .await?;
    }
    Ok(task)
}

pub async fn set_status_tx(
    conn: &mut SqliteConnection,
    id: &str,
    status: &str,
    today: NaiveDate,
    policy: MutationPolicy,
) -> crate::Result<TaskEffects> {
    let before = fetch(conn, id).await?;
    let mut effects = TaskEffects::default();
    effects.previous_status = Some(before.status.clone());
    if status == "complete" && before.completed && before.status == "complete" {
        return Ok(effects);
    }
    if status == "complete" {
        if let (Some(rule_str), Some(due_str)) = (&before.recurrence_rule, &before.due_date) {
            if let (Some(rule), Ok(due)) = (
                crate::recurrence::parse_rule(rule_str),
                NaiveDate::parse_from_str(due_str, "%Y-%m-%d"),
            ) {
                let next = crate::recurrence::next_occurrence(&rule, due, today);
                let next_str = next.format("%Y-%m-%d").to_string();
                let due_time = rule.time.or(before.due_time.clone());
                sqlx::query("UPDATE local_tasks SET due_date=?,due_time=?,status='todo',completed=0,completed_at=NULL,updated_at=datetime('now','localtime') WHERE id=?")
                    .bind(&next_str).bind(due_time).bind(id).execute(&mut *conn).await?;
                let task = fetch(conn, id).await?;
                if policy != MutationPolicy::Remote {
                    let fields = vec![
                        "due_date".into(),
                        "due_time".into(),
                        "status".into(),
                        "completed".into(),
                        "completed_at".into(),
                    ];
                    sync_task(
                        conn,
                        &task,
                        "UPDATE",
                        Some(&serde_json::to_string(&fields).unwrap()),
                    )
                    .await?;
                    if policy == MutationPolicy::User {
                        observer::on_task_mutation_tx(
                            conn,
                            TaskMutation::Updated {
                                task: &task,
                                fields_changed: &fields,
                            },
                        )
                        .await?;
                    }
                }
                effects.recurrence = Some(RecurrenceEffect {
                    task_id: id.into(),
                    before_due: due_str.clone(),
                    after_due: next_str,
                });
                effects.changed.push(task);
                return Ok(effects);
            }
        }
        sqlx::query("UPDATE local_tasks SET status=?,completed=1,completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
            .bind(status).bind(id).execute(&mut *conn).await?;
        let children: Vec<LocalTask>=sqlx::query_as(&format!("UPDATE local_tasks SET status='complete',completed=1,completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE parent_id=? AND completed=0 RETURNING {SELECT_COLS}"))
            .bind(id).fetch_all(&mut *conn).await?;
        effects.changed.extend(children);
    } else {
        sqlx::query("UPDATE local_tasks SET status=?,completed=0,completed_at=NULL,updated_at=datetime('now','localtime') WHERE id=?")
            .bind(status).bind(id).execute(&mut *conn).await?;
    }
    let task = fetch(conn, id).await?;
    if policy != MutationPolicy::Remote {
        let changed = serde_json::json!(["status", "completed", "completed_at"]).to_string();
        sync_task(conn, &task, "UPDATE", Some(&changed)).await?;
        for child in &effects.changed {
            sync_task(conn, child, "UPDATE", Some(&changed)).await?;
        }
    }
    if policy == MutationPolicy::User {
        observer::on_task_mutation_tx(
            conn,
            TaskMutation::StatusChanged {
                task: &task,
                was_completed: before.completed,
            },
        )
        .await?;
    }
    effects.changed.insert(0, task);
    Ok(effects)
}

pub async fn delete_task_tx(
    conn: &mut SqliteConnection,
    id: &str,
    policy: MutationPolicy,
) -> crate::Result<TaskEffects> {
    let mut effects = TaskEffects::default();
    let parent: Option<LocalTask> =
        sqlx::query_as(&format!("SELECT {SELECT_COLS} FROM local_tasks WHERE id=?"))
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
    let children: Vec<LocalTask> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLS} FROM local_tasks WHERE parent_id=?"
    ))
    .bind(id)
    .fetch_all(&mut *conn)
    .await?;
    effects.deleted.extend(children);
    if let Some(parent) = parent {
        effects.deleted.push(parent);
    }
    for task in &mut effects.deleted {
        task.labels = sqlx::query_scalar("SELECT label_id FROM task_labels WHERE task_id=?")
            .bind(&task.id).fetch_all(&mut *conn).await?;
    }
    sqlx::query("DELETE FROM local_tasks WHERE parent_id=?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    sqlx::query("DELETE FROM local_tasks WHERE id=?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    if policy != MutationPolicy::Remote {
        for task in &effects.deleted {
            sync::append_sync_log_tx(conn, "local_tasks", &task.id, "DELETE", None, None).await?;
        }
    }
    if policy == MutationPolicy::User {
        for task in &effects.deleted {
            observer::on_task_mutation_tx(conn, TaskMutation::Deleted { task }).await?;
        }
    }
    Ok(effects)
}

/// Restore an exact local deletion snapshot, preserving IDs and parent links.
/// The caller owns the transaction and resolves focus history/queue separately.
pub async fn restore_deleted_tasks_tx(conn: &mut SqliteConnection, tasks: &[LocalTask]) -> crate::Result<()> {
    // Parent was captured after children by delete_task_tx.
    for task in tasks.iter().rev() {
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM local_tasks WHERE id=?")
            .bind(&task.id).fetch_optional(&mut *conn).await?;
        if exists.is_some() { return Err(crate::Error::Other("conflict: task ID already exists during undo".into())); }
        sqlx::query("INSERT INTO local_tasks(id,parent_id,content,description,project_id,priority,due_date,due_time,duration_minutes,recurrence_rule,section_id,reminder_offset_minutes,google_calendar_enabled,completed,completed_at,status,linked_doc_id,position,created_at,updated_at,external_id,external_source,remote_updated_at,synced_snapshot,sync_policy) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&task.id).bind(&task.parent_id).bind(&task.content).bind(&task.description)
            .bind(&task.project_id).bind(task.priority).bind(&task.due_date).bind(&task.due_time)
            .bind(task.duration_minutes).bind(&task.recurrence_rule).bind(&task.section_id)
            .bind(task.reminder_offset_minutes).bind(task.google_calendar_enabled).bind(task.completed)
            .bind(&task.completed_at).bind(&task.status).bind(&task.linked_doc_id).bind(task.position)
            .bind(&task.created_at).bind(&task.updated_at).bind(&task.external_id).bind(&task.external_source)
            .bind(&task.remote_updated_at).bind(&task.synced_snapshot).bind(&task.sync_policy)
            .execute(&mut *conn).await?;
        for label in &task.labels {
            sqlx::query("INSERT OR IGNORE INTO task_labels(task_id,label_id) VALUES(?,?)")
                .bind(&task.id).bind(label).execute(&mut *conn).await?;
        }
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id=? AND object_type='task' AND op='delete' AND status='pending'")
            .bind(&task.id).execute(&mut *conn).await?;
        sync_task(conn, task, "INSERT", None).await?;
        observer::on_task_mutation_tx(conn, TaskMutation::Created(task)).await?;
    }
    Ok(())
}
