use nimble_core::db::focus::engine::NativeTaskAction;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::LocalTask;

/// Task writes go through the one focus service (`focus_service::execute_task`)
/// so queue, ledger and live clock stay consistent. `command_id` is optional:
/// omitted, the service mints one for this single in-process call.
async fn write(
    app: &AppHandle,
    action: NativeTaskAction,
    command_id: Option<String>,
) -> Result<crate::focus_service::TaskWriteOutcome, String> {
    crate::focus_service::execute_task(app, action, command_id)
        .await
        .map_err(|e| e.message)
}

fn returned(outcome: crate::focus_service::TaskWriteOutcome) -> Result<LocalTask, String> {
    outcome.task.ok_or_else(|| "task write returned no task".to_string())
}

#[tauri::command]
pub async fn reorder_local_tasks(app: AppHandle, task_ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::reorder_local_tasks(pool.inner(), &task_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_local_tasks(
    app: AppHandle,
    project_id: Option<String>,
    due_date: Option<String>,
    include_completed: Option<bool>,
) -> Result<Vec<LocalTask>, String> {
    let pool = app.state::<SqlitePool>();
    let include_completed = include_completed.unwrap_or(false);
    nimble_core::db::tasks::get_local_tasks(
        pool.inner(),
        project_id.as_deref(),
        due_date.as_deref(),
        include_completed,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_local_task(
    app: AppHandle,
    content: String,
    project_id: Option<String>,
    parent_id: Option<String>,
    description: Option<String>,
    priority: Option<i64>,
    due_date: Option<String>,
    due_time: Option<String>,
    reminder_offset_minutes: Option<i64>,
    google_calendar_enabled: Option<bool>,
    duration_minutes: Option<i64>,
    recurrence_rule: Option<String>,
    section_id: Option<String>,
    label_ids: Option<Vec<String>>,
    command_id: Option<String>,
) -> Result<LocalTask, String> {
    let action = NativeTaskAction::Create {
        input: nimble_core::types::CreateTaskInput {
            sync_policy: None,
            content,
            project_id,
            parent_id,
            description,
            priority,
            due_date,
            due_time,
            reminder_offset_minutes,
            google_calendar_enabled,
            duration_minutes,
            recurrence_rule,
            section_id,
            label_ids,
        },
    };
    returned(write(&app, action, command_id).await?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_local_task(
    app: AppHandle,
    id: String,
    content: Option<String>,
    description: Option<String>,
    project_id: Option<String>,
    priority: Option<i64>,
    due_date: Option<String>,
    clear_due_date: Option<bool>,
    linked_doc_id: Option<String>,
    due_time: Option<String>,
    reminder_offset_minutes: Option<i64>,
    google_calendar_enabled: Option<bool>,
    duration_minutes: Option<i64>,
    recurrence_rule: Option<String>,
    section_id: Option<String>,
    label_ids: Option<Vec<String>>,
    clear_due_time: Option<bool>,
    clear_reminder: Option<bool>,
    clear_recurrence: Option<bool>,
    clear_section: Option<bool>,
    clear_duration: Option<bool>,
    command_id: Option<String>,
) -> Result<LocalTask, String> {
    let action = NativeTaskAction::Update {
        id,
        input: nimble_core::types::UpdateTaskInput {
            sync_policy: None,
            content,
            description,
            project_id,
            priority,
            due_date,
            clear_due_date: clear_due_date.unwrap_or(false),
            linked_doc_id,
            due_time,
            reminder_offset_minutes,
            google_calendar_enabled,
            duration_minutes,
            recurrence_rule,
            section_id,
            label_ids,
            clear_due_time: clear_due_time.unwrap_or(false),
            clear_reminder: clear_reminder.unwrap_or(false),
            clear_recurrence: clear_recurrence.unwrap_or(false),
            clear_section: clear_section.unwrap_or(false),
            clear_duration: clear_duration.unwrap_or(false),
        },
    };
    returned(write(&app, action, command_id).await?)
}

/// `expected_due_date` is the due date the UI displayed (None = no date). A
/// recurring completion whose date has since moved fails `stale_occurrence`.
#[tauri::command]
pub async fn update_task_status(
    app: AppHandle,
    id: String,
    status: String,
    note: Option<String>,
    expected_due_date: Option<String>,
    command_id: Option<String>,
) -> Result<(), String> {
    let action = NativeTaskAction::SetStatus { id, status, note, expected_due_date };
    write(&app, action, command_id).await.map(|_| ())
}

#[tauri::command]
pub async fn complete_local_task(
    app: AppHandle,
    id: String,
    expected_due_date: Option<String>,
    command_id: Option<String>,
) -> Result<(), String> {
    update_task_status(app, id, "complete".to_string(), None, expected_due_date, command_id).await
}

#[tauri::command]
pub async fn uncomplete_local_task(
    app: AppHandle,
    id: String,
    command_id: Option<String>,
) -> Result<(), String> {
    update_task_status(app, id, "todo".to_string(), None, None, command_id).await
}

#[tauri::command]
pub async fn delete_local_task(
    app: AppHandle,
    id: String,
    command_id: Option<String>,
) -> Result<(), String> {
    write(&app, NativeTaskAction::Delete { id }, command_id).await.map(|_| ())
}

#[tauri::command]
pub async fn preview_tasks_markdown_migration(
    app: AppHandle,
) -> Result<nimble_core::db::tasks::TasksMdPreview, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::preview_tasks_markdown_migration(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrate_tasks_to_markdown(
    app: AppHandle,
) -> Result<nimble_core::db::tasks::TasksMdResult, String> {
    let pool = app.state::<SqlitePool>();
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = app_dir.join(format!("nimble-backup-pre-task-markdown-{stamp}.db"));
    nimble_core::db::tasks::migrate_tasks_to_markdown(
        pool.inner(),
        backup.to_str().ok_or("backup path not utf-8")?,
    )
    .await
    .map_err(|e| e.to_string())
}
