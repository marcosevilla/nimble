use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::SyncStatus;

#[tauri::command]
pub async fn sync_push(app: AppHandle) -> Result<u64, String> {
    let pool = app.state::<SqlitePool>();

    // Get Turso credentials from settings
    let turso_url = nimble_core::db::settings::get_setting(pool.inner(), "turso_url")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso URL not configured. Go to Settings > Sync to set it up.".to_string())?;

    let turso_token = nimble_core::db::settings::get_setting(pool.inner(), "turso_token")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso token not configured. Go to Settings > Sync to set it up.".to_string())?;

    nimble_core::db::sync::push(pool.inner(), &turso_url, &turso_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_pull(app: AppHandle) -> Result<u64, String> {
    let pool = app.state::<SqlitePool>();

    let turso_url = nimble_core::db::settings::get_setting(pool.inner(), "turso_url")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso URL not configured. Go to Settings > Sync to set it up.".to_string())?;

    let turso_token = nimble_core::db::settings::get_setting(pool.inner(), "turso_token")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso token not configured. Go to Settings > Sync to set it up.".to_string())?;

    nimble_core::db::sync::pull(pool.inner(), &turso_url, &turso_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_get_status(app: AppHandle) -> Result<SyncStatus, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sync::get_sync_status(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_configure(
    app: AppHandle,
    turso_url: String,
    turso_token: String,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::settings::set_setting(pool.inner(), "turso_url", &turso_url)
        .await
        .map_err(|e| e.to_string())?;
    nimble_core::db::settings::set_setting(pool.inner(), "turso_token", &turso_token)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sync_test_connection(
    _app: AppHandle,
    turso_url: String,
    turso_token: String,
) -> Result<(), String> {
    // Test connection without needing saved settings
    nimble_core::db::sync::test_connection(&turso_url, &turso_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_initialize_remote(app: AppHandle) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();

    let turso_url = nimble_core::db::settings::get_setting(pool.inner(), "turso_url")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso URL not configured. Go to Settings > Sync to set it up.".to_string())?;

    let turso_token = nimble_core::db::settings::get_setting(pool.inner(), "turso_token")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Turso token not configured. Go to Settings > Sync to set it up.".to_string())?;

    nimble_core::db::sync::initialize_remote(pool.inner(), &turso_url, &turso_token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_seed_existing(app: AppHandle) -> Result<u64, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::sync::seed_existing_data(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
