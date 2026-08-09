use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::Project;

#[tauri::command]
pub async fn get_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::projects::get_projects(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    name: String,
    color: String,
) -> Result<Project, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::projects::create_project(pool.inner(), &name, &color)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_project(
    app: AppHandle,
    id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::projects::update_project(
        pool.inner(),
        &id,
        name.as_deref(),
        color.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::projects::delete_project(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}
