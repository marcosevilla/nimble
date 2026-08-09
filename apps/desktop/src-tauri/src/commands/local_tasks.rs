use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::LocalTask;

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
    duration_minutes: Option<i64>,
    recurrence_rule: Option<String>,
    section_id: Option<String>,
    label_ids: Option<Vec<String>>,
) -> Result<LocalTask, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::create_local_task(
        pool.inner(),
        nimble_core::types::CreateTaskInput {
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
        },
    )
    .await
    .map_err(|e| e.to_string())
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
    duration_minutes: Option<i64>,
    recurrence_rule: Option<String>,
    section_id: Option<String>,
    label_ids: Option<Vec<String>>,
    clear_due_time: Option<bool>,
    clear_recurrence: Option<bool>,
    clear_section: Option<bool>,
) -> Result<LocalTask, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::update_local_task(
        pool.inner(),
        &id,
        nimble_core::types::UpdateTaskInput {
            content,
            description,
            project_id,
            priority,
            due_date,
            clear_due_date: clear_due_date.unwrap_or(false),
            linked_doc_id,
            due_time,
            duration_minutes,
            recurrence_rule,
            section_id,
            label_ids,
            clear_due_time: clear_due_time.unwrap_or(false),
            clear_recurrence: clear_recurrence.unwrap_or(false),
            clear_section: clear_section.unwrap_or(false),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_task_status(
    app: AppHandle,
    id: String,
    status: String,
    note: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::update_task_status(
        pool.inner(),
        &id,
        &status,
        note.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn complete_local_task(app: AppHandle, id: String) -> Result<(), String> {
    update_task_status(app, id, "complete".to_string(), None).await
}

#[tauri::command]
pub async fn uncomplete_local_task(app: AppHandle, id: String) -> Result<(), String> {
    update_task_status(app, id, "todo".to_string(), None).await
}

#[tauri::command]
pub async fn delete_local_task(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::tasks::delete_local_task(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}
