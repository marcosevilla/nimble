use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::Section;

#[tauri::command]
pub async fn list_sections(app: AppHandle, project_id: String) -> Result<Vec<Section>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sections::list_sections(pool.inner(), &project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_section(
    app: AppHandle,
    project_id: String,
    name: String,
) -> Result<Section, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sections::create_section(pool.inner(), &project_id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_section(app: AppHandle, id: String, name: String) -> Result<Section, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sections::rename_section(pool.inner(), &id, &name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_section(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sections::delete_section(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_sections(app: AppHandle, section_ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sections::reorder_sections(pool.inner(), &section_ids)
        .await
        .map_err(|e| e.to_string())
}
