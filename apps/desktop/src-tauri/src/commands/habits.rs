use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{Habit, HabitHeatmapEntry, HabitLog, HabitWithStats};

#[tauri::command]
pub async fn get_habits(app: AppHandle) -> Result<Vec<HabitWithStats>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::get_habits(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_habit(
    app: AppHandle,
    name: String,
    category: Option<String>,
    icon: Option<String>,
    color: Option<String>,
) -> Result<Habit, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::create_habit(pool.inner(), &name, category.as_deref(), icon.as_deref(), color.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_habit(
    app: AppHandle,
    id: String,
    name: Option<String>,
    category: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    active: Option<bool>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::update_habit(pool.inner(), &id, name.as_deref(), category.as_deref(), icon.as_deref(), color.as_deref(), active).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_habit(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::delete_habit(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn log_habit(
    app: AppHandle,
    habit_id: String,
    date: Option<String>,
    intensity: Option<i64>,
) -> Result<HabitLog, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::log_habit(pool.inner(), &habit_id, date.as_deref(), intensity).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unlog_habit(
    app: AppHandle,
    habit_id: String,
    date: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::habits::unlog_habit(pool.inner(), &habit_id, date.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_habit_logs(
    app: AppHandle,
    habit_id: Option<String>,
    days: Option<i64>,
) -> Result<Vec<HabitLog>, String> {
    let pool = app.state::<SqlitePool>();
    let days = days.unwrap_or(365);
    nimble_core::db::habits::get_habit_logs(pool.inner(), habit_id.as_deref(), days).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_habit_heatmap(
    app: AppHandle,
    habit_id: Option<String>,
    days: Option<i64>,
) -> Result<Vec<HabitHeatmapEntry>, String> {
    let pool = app.state::<SqlitePool>();
    let days = days.unwrap_or(365);
    nimble_core::db::habits::get_habit_heatmap(pool.inner(), habit_id.as_deref(), days).await.map_err(|e| e.to_string())
}
