use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{Label, LocalTask};

#[tauri::command]
pub async fn list_labels(app: AppHandle) -> Result<Vec<Label>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::list_labels(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_label(app: AppHandle, name: String, color: String) -> Result<Label, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::create_label(pool.inner(), &name, &color)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_label(
    app: AppHandle,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Label, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::update_label(pool.inner(), &id, name.as_deref(), color.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_label(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::delete_label(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_task_labels(
    app: AppHandle,
    task_id: String,
    label_ids: Vec<String>,
) -> Result<LocalTask, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::set_task_labels(pool.inner(), &task_id, &label_ids)
        .await
        .map_err(|e| e.to_string())
}
