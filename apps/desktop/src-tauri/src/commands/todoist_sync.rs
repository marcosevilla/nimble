use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn todoist_sync_now(
    app: AppHandle,
) -> Result<daily_triage_core::integrations::todoist::sync_loop::SyncReport, String> {
    crate::sync_runner::run_and_emit(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_todoist_sync_status(
    app: AppHandle,
) -> Result<daily_triage_core::integrations::TodoistSyncStatus, String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::integrations::todoist_sync_status(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_todoist_sync_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    daily_triage_core::integrations::set_enabled(pool.inner(), "todoist", enabled)
        .await
        .map_err(|e| e.to_string())?;
    if enabled {
        // first-enable backfill: mirror pre-existing native tasks/projects out to Todoist
        daily_triage_core::integrations::todoist::observer::seed_outbox_for_unlinked(pool.inner())
            .await
            .map_err(|e| e.to_string())?;
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::sync_runner::run_and_emit(&app2).await;
        });
    }
    Ok(())
}
