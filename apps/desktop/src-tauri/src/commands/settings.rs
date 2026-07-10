use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use daily_triage_core::types::SettingRow;

#[tauri::command]
pub async fn check_setup_complete(app: AppHandle) -> Result<bool, String> {
    // Demo mode runs against a blank throwaway db — never show onboarding.
    if let Ok(dir) = app.path().app_data_dir() {
        if dir.join("demo-mode").exists() {
            return Ok(true);
        }
    }
    let pool = app.state::<SqlitePool>();
    daily_triage_core::db::settings::check_setup_complete(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::db::settings::get_setting(pool.inner(), &key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::db::settings::set_setting(pool.inner(), &key, &value)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_settings(app: AppHandle) -> Result<Vec<SettingRow>, String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::db::settings::get_all_settings(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_all_settings(app: AppHandle) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::db::settings::clear_all_settings(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
