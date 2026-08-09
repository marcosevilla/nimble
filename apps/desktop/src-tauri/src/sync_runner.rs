use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

/// Runs a full push-then-pull sync and, if it changed anything locally,
/// emits `todoist-sync-applied` so the frontend refreshes its task lists.
pub async fn run_and_emit(
    app: &AppHandle,
) -> nimble_core::Result<nimble_core::integrations::todoist::sync_loop::SyncReport> {
    let pool = app.state::<SqlitePool>();
    let report = nimble_core::integrations::todoist::sync_loop::run_sync(pool.inner()).await?;
    if report.changed_anything() {
        let _ = app.emit("todoist-sync-applied", ());
    }
    Ok(report)
}

/// Same as `run_and_emit`, gated by `run_sync_if_due`'s min-interval check —
/// used by the background interval and the window-focus trigger, both of
/// which fire far more often than a sync is actually needed. Never
/// propagates an error to the caller: on failure it just logs and waits for
/// the next trigger to retry (the outbox and sync_token make this safe).
pub async fn run_if_due_and_emit(app: &AppHandle, min_interval_secs: i64) {
    let pool = app.state::<SqlitePool>();
    match nimble_core::integrations::todoist::sync_loop::run_sync_if_due(pool.inner(), min_interval_secs).await {
        Ok(report) if report.changed_anything() => {
            let _ = app.emit("todoist-sync-applied", ());
        }
        Ok(_) => {}
        Err(e) => log::warn!("todoist sync failed (will retry on next trigger): {e}"),
    }
}
