use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::FocusState;

#[tauri::command]
pub async fn start_focus_session(
    app: AppHandle,
    task_id: String,
    task_content: String,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::focus::start_focus_session(pool.inner(), &task_id, &task_content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn end_focus_session(
    app: AppHandle,
    task_id: String,
    outcome: String,
    duration_secs: i64,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::focus::end_focus_session(pool.inner(), &task_id, &outcome, duration_secs)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_focus(app: AppHandle) -> Result<FocusState, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::focus::get_active_focus(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
