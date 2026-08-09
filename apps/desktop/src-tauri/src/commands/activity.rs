use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{ActivityEntry, ActivitySummary};

/// Frontend escape hatch for session-level events (page_viewed, app_opened, etc.)
#[tauri::command]
pub async fn log_activity(
    app: AppHandle,
    action_type: String,
    target_id: Option<String>,
    metadata: Option<serde_json::Value>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::activity::log_activity(
        pool.inner(),
        &action_type,
        target_id.as_deref(),
        metadata,
    )
    .await;
    Ok(())
}

/// Get activity log entries for a date range with optional filters
#[tauri::command]
pub async fn get_activity_log(
    app: AppHandle,
    from_date: String,
    to_date: String,
    action_type: Option<String>,
    target_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ActivityEntry>, String> {
    let pool = app.state::<SqlitePool>();
    let limit = limit.unwrap_or(200);
    nimble_core::db::activity::get_activity_log(
        pool.inner(),
        &from_date,
        &to_date,
        action_type.as_deref(),
        target_id.as_deref(),
        limit,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Get activity counts grouped by action type for a specific date
#[tauri::command]
pub async fn get_activity_summary(
    app: AppHandle,
    date: String,
) -> Result<Vec<ActivitySummary>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::activity::get_activity_summary(pool.inner(), &date)
        .await
        .map_err(|e| e.to_string())
}
