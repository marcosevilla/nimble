use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::data_events::{after_commit, LABELS, TASKS, TASKS_AND_LABELS};

pub use nimble_core::types::{Label, LabelGroup, LabelGroupPatch, LocalTask};

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
    let result = nimble_core::db::labels::create_label(pool.inner(), &name, &color)
        .await
        .map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |label| vec![label.id.clone()])
}

#[tauri::command]
pub async fn update_label(
    app: AppHandle,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Label, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::update_label(pool.inner(), &id, name.as_deref(), color.as_deref())
        .await
        .map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |label| vec![label.id.clone()])
}

#[tauri::command]
pub async fn delete_label(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::delete_label(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string());
    after_commit(&app, result, TASKS_AND_LABELS, |_| vec![id.clone()])
}

#[tauri::command]
pub async fn set_task_labels(
    app: AppHandle,
    task_id: String,
    label_ids: Vec<String>,
) -> Result<LocalTask, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::set_task_labels(pool.inner(), &task_id, &label_ids)
        .await
        .map_err(|e| e.to_string());
    after_commit(&app, result, TASKS, |task| vec![task.id.clone()])
}

#[tauri::command]
pub async fn list_label_groups(app: AppHandle) -> Result<Vec<LabelGroup>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::list_label_groups(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_label_group(app: AppHandle, name: String, exclusive: bool) -> Result<LabelGroup, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::create_label_group(pool.inner(), &name, exclusive)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |g| vec![g.id.clone()])
}

#[tauri::command]
pub async fn update_label_group(app: AppHandle, id: String, patch: LabelGroupPatch) -> Result<LabelGroup, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::update_label_group(pool.inner(), &id, patch)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |g| vec![g.id.clone()])
}

#[tauri::command]
pub async fn delete_label_group(app: AppHandle, id: String) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::delete_label_group(pool.inner(), &id)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ids| ids.clone())
}

#[tauri::command]
pub async fn reorder_label_groups(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::reorder_label_groups(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |_| ids.clone())
}

#[tauri::command]
pub async fn set_label_group(app: AppHandle, label_id: String, group_id: Option<String>) -> Result<Label, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::set_label_group(pool.inner(), &label_id, group_id.as_deref())
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |l| vec![l.id.clone()])
}

#[tauri::command]
pub async fn reorder_labels(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::reorder_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |_| ids.clone())
}

#[tauri::command]
pub async fn archive_labels(app: AppHandle, ids: Vec<String>) -> Result<Vec<Label>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::archive_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ls| ls.iter().map(|l| l.id.clone()).collect())
}

#[tauri::command]
pub async fn restore_labels(app: AppHandle, ids: Vec<String>) -> Result<Vec<Label>, String> {
    let pool = app.state::<SqlitePool>();
    let result = nimble_core::db::labels::restore_labels(pool.inner(), &ids)
        .await.map_err(|e| e.to_string());
    after_commit(&app, result, LABELS, |ls| ls.iter().map(|l| l.id.clone()).collect())
}

#[tauri::command]
pub async fn unused_label_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::labels::unused_label_ids(pool.inner()).await.map_err(|e| e.to_string())
}
