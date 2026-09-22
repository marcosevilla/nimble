use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
    pub permission: String,
    pub timezone: String,
    pub error_code: Option<String>,
}

pub async fn reminder_timezone(pool: &SqlitePool) -> Result<String, String> {
    if let Some(zone) = nimble_core::db::settings::get_setting(pool, "reminder_timezone")
        .await.map_err(|_| "reminder_settings_failed")? { return Ok(zone) }
    let zone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    nimble_core::db::settings::set_setting(pool, "reminder_timezone", &zone)
        .await.map_err(|_| "reminder_settings_failed")?;
    Ok(zone)
}

#[tauri::command]
pub async fn reminder_get_status(app: AppHandle) -> Result<ReminderStatus, String> {
    let pool = app.state::<SqlitePool>();
    let timezone = reminder_timezone(pool.inner()).await?;
    let permission = match app.notification().permission_state() {
        Ok(tauri_plugin_notification::PermissionState::Granted) => "granted",
        Ok(tauri_plugin_notification::PermissionState::Denied) => "denied",
        _ => "unknown",
    }.to_owned();
    Ok(ReminderStatus { permission, timezone, error_code: None })
}

#[tauri::command]
pub async fn reminder_request_permission(app: AppHandle) -> Result<ReminderStatus, String> {
    nimble_core::db::recovery::require_activation_clear(app.state::<SqlitePool>().inner())
        .await.map_err(|_| "restore_activation_required")?;
    app.notification().request_permission().map_err(|_| "notification_permission_failed")?;
    reminder_get_status(app).await
}

#[tauri::command]
pub async fn reminder_list_catch_up(app: AppHandle) -> Result<Vec<nimble_core::db::reminders::CatchUpItem>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::reminders::list_catch_up(pool.inner()).await.map_err(|_| "reminder_list_failed".into())
}

#[tauri::command]
pub async fn reminder_acknowledge(app: AppHandle, occurrence_key: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::reminders::acknowledge(pool.inner(), &occurrence_key).await.map_err(|_| "reminder_acknowledge_failed".into())
}
