use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{TodoistMigrationPreview, TodoistMigrationResult};

/// Get the API token from settings
async fn get_api_token(app: &AppHandle) -> Result<String, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::settings::get_setting(pool.inner(), "todoist_api_token")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Todoist API token not configured".to_string())
}

#[tauri::command]
pub async fn preview_todoist_migration(
    app: AppHandle,
) -> Result<TodoistMigrationPreview, String> {
    let pool = app.state::<SqlitePool>();
    let token = get_api_token(&app).await?;
    nimble_core::api::todoist_migration::preview_migration(pool.inner(), &token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrate_todoist(app: AppHandle) -> Result<TodoistMigrationResult, String> {
    let pool = app.state::<SqlitePool>();
    let token = get_api_token(&app).await?;
    nimble_core::api::todoist_migration::migrate(pool.inner(), &token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrated_todoist_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::todoist_migration::migrated_todoist_ids(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
