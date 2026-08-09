use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{DailyStateResponse, Priority};

#[tauri::command]
pub async fn get_daily_state(app: AppHandle) -> Result<DailyStateResponse, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::daily_state::get_daily_state(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_priorities(
    app: AppHandle,
    energy_level: String,
    calendar_summary: String,
    tasks_summary: String,
    obsidian_summary: String,
) -> Result<Vec<Priority>, String> {
    let pool = app.state::<SqlitePool>();

    // Get API key
    let api_key = nimble_core::db::settings::get_setting(pool.inner(), "anthropic_api_key")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Anthropic API key not configured".to_string())?;

    let priorities = nimble_core::api::anthropic::generate_priorities(
        &api_key,
        &energy_level,
        &calendar_summary,
        &tasks_summary,
        &obsidian_summary,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Cache in daily_state
    nimble_core::db::daily_state::save_priorities(pool.inner(), &energy_level, &priorities)
        .await
        .map_err(|e| e.to_string())?;

    Ok(priorities)
}
