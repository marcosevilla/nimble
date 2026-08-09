use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{Goal, GoalWithProgress, LifeArea, Milestone};

#[tauri::command]
pub async fn get_goals(app: AppHandle) -> Result<Vec<GoalWithProgress>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::get_goals(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_goal(app: AppHandle, id: String) -> Result<GoalWithProgress, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::get_goal(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_goal(
    app: AppHandle,
    name: String,
    description: Option<String>,
    status: Option<String>,
    life_area_id: Option<String>,
    start_date: Option<String>,
    target_date: Option<String>,
    color: Option<String>,
) -> Result<Goal, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::create_goal(
        pool.inner(), &name, description.as_deref(), status.as_deref(),
        life_area_id.as_deref(), start_date.as_deref(), target_date.as_deref(), color.as_deref(),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_goal(
    app: AppHandle,
    id: String,
    name: Option<String>,
    description: Option<String>,
    status: Option<String>,
    life_area_id: Option<String>,
    start_date: Option<String>,
    target_date: Option<String>,
    color: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::update_goal(
        pool.inner(), &id, name.as_deref(), description.as_deref(), status.as_deref(),
        life_area_id.as_deref(), start_date.as_deref(), target_date.as_deref(), color.as_deref(),
    ).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_goal(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::delete_goal(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_milestones(app: AppHandle, goal_id: String) -> Result<Vec<Milestone>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::get_milestones(pool.inner(), &goal_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_milestone(
    app: AppHandle,
    goal_id: String,
    name: String,
    target_date: Option<String>,
) -> Result<Milestone, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::create_milestone(pool.inner(), &goal_id, &name, target_date.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_milestone(
    app: AppHandle,
    id: String,
    name: Option<String>,
    target_date: Option<String>,
    completed: Option<bool>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::update_milestone(pool.inner(), &id, name.as_deref(), target_date.as_deref(), completed).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_milestone(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::delete_milestone(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_life_areas(app: AppHandle) -> Result<Vec<LifeArea>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::get_life_areas(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_life_area(app: AppHandle, name: String, color: String, icon: String) -> Result<LifeArea, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::create_life_area(pool.inner(), &name, &color, &icon).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_life_area(app: AppHandle, id: String, name: Option<String>, color: Option<String>, icon: Option<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::update_life_area(pool.inner(), &id, name.as_deref(), color.as_deref(), icon.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_life_area(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::goals::delete_life_area(pool.inner(), &id).await.map_err(|e| e.to_string())
}
