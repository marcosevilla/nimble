use nimble_core::db::karma::{self, BackfillReport, GoalTargets, MomentumSettings, MomentumSummary};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn momentum_summary(app: AppHandle, range: String) -> Result<MomentumSummary, String> {
    let pool = app.state::<SqlitePool>();
    karma::momentum_summary(pool.inner(), &range).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn momentum_settings_get(app: AppHandle) -> Result<MomentumSettings, String> {
    let pool = app.state::<SqlitePool>();
    karma::load_settings(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn goals_save(app: AppHandle, targets: GoalTargets) -> Result<MomentumSettings, String> {
    let pool = app.state::<SqlitePool>();
    karma::save_goals(pool.inner(), targets).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn momentum_set_paused(app: AppHandle, paused: bool) -> Result<MomentumSettings, String> {
    let pool = app.state::<SqlitePool>();
    karma::set_paused(pool.inner(), paused).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn momentum_backfill(app: AppHandle) -> Result<BackfillReport, String> {
    let pool = app.state::<SqlitePool>();
    karma::backfill(pool.inner()).await.map_err(|e| e.to_string())
}
