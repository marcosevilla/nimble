use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{CalendarEventWithFeed, CalendarFeed};

#[tauri::command]
pub async fn get_calendar_feeds(app: AppHandle) -> Result<Vec<CalendarFeed>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::calendar::get_calendar_feeds(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_calendar_feed(
    app: AppHandle,
    label: String,
    url: String,
    color: String,
) -> Result<CalendarFeed, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::calendar::add_calendar_feed(pool.inner(), &label, &url, &color)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_calendar_feed(app: AppHandle, feed_id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::calendar::remove_calendar_feed(pool.inner(), &feed_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_calendar_events(
    app: AppHandle,
    date: Option<String>,
) -> Result<Vec<CalendarEventWithFeed>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::calendar::fetch_calendar_events(pool.inner(), date.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Get cached calendar events for a date (no network).
#[tauri::command]
pub async fn get_cached_calendar_events(
    app: AppHandle,
    date: String,
) -> Result<Vec<CalendarEventWithFeed>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::api::calendar::read_cached_events(pool.inner(), &date)
        .await
        .map_err(|e| e.to_string())
}
