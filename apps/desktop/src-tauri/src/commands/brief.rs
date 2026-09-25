use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::Brief;

#[tauri::command]
pub async fn brief_get(app: AppHandle, date: String) -> Result<Option<Brief>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::briefs::get_brief(pool.inner(), &date)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_list_dates(app: AppHandle) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::briefs::list_brief_dates(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_ensure_snapshot(app: AppHandle, date: String) -> Result<Option<Brief>, String> {
    let pool = app.state::<SqlitePool>();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::db::briefs::ensure_snapshot(pool.inner(), &date, &today)
        .await
        .map_err(|e| e.to_string())
}

pub use nimble_core::brief::settings::{BriefSettingsPatch, BriefSettingsView};

#[tauri::command]
pub async fn brief_settings_get(app: AppHandle) -> Result<BriefSettingsView, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::brief::settings::load_view(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_settings_save(app: AppHandle, patch: BriefSettingsPatch) -> Result<BriefSettingsView, String> {
    let pool = app.state::<SqlitePool>();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    nimble_core::brief::settings::save_patch(pool.inner(), patch, &now).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_set_notes(app: AppHandle, date: String, notes: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::db::briefs::set_notes(pool.inner(), &date, &today, &notes).await.map_err(|e| e.to_string())
}
