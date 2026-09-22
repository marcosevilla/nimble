use chrono::Utc;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use nimble_core::reminders::{decide, DeliveryDecision};
static TICK_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A single tick is safe to call after wake, focus and task changes. The
/// ledger's conditional claim is the final duplicate-delivery guard.
pub async fn tick(app: &AppHandle) -> Result<(), String> {
    let _guard=TICK_LOCK.lock().await;
    if cfg!(debug_assertions) && !app.try_state::<crate::backup_runner::BackupRuntime>().is_some_and(|r|r.is_test_profile()) {
        return Err("reminder_debug_profile_disabled".into());
    }
    let pool = app.state::<SqlitePool>();
    nimble_core::db::recovery::require_activation_clear(pool.inner()).await
        .map_err(|_| "restore_activation_required")?;
    let timezone = crate::commands::reminders::reminder_timezone(pool.inner()).await?;
    let now = Utc::now();
    let due = nimble_core::db::reminders::collect_due(pool.inner(), now, &timezone)
        .await.map_err(|_| "reminder_reconciliation_failed")?;
    for item in due {
        match decide(now, item.scheduled_at) {
            DeliveryDecision::Future => (),
            DeliveryDecision::CatchUp => {
                nimble_core::db::reminders::mark_catch_up(pool.inner(), &item.occurrence_key, None)
                    .await.map_err(|_| "reminder_ledger_failed")?;
            }
            DeliveryDecision::Notify => {
                if !nimble_core::db::reminders::claim_notification(pool.inner(), &item.occurrence_key)
                    .await.map_err(|_| "reminder_ledger_failed")? { continue }
                let permission = app.notification().permission_state().ok();
                let title: Option<(String,)> = sqlx::query_as("SELECT content FROM local_tasks WHERE id=? AND completed=0")
                    .bind(&item.task_id).fetch_optional(pool.inner()).await.map_err(|_| "reminder_task_failed")?;
                let delivered = if let Some((title,)) = title {
                    if matches!(permission, Some(tauri_plugin_notification::PermissionState::Granted)) {
                        app.notification().builder().title("Nimble reminder").body(&title).show().is_ok()
                    } else { false }
                } else { false };
                if delivered {
                    nimble_core::db::reminders::mark_notified(pool.inner(), &item.occurrence_key, now)
                        .await.map_err(|_| "reminder_ledger_failed")?;
                } else {
                    nimble_core::db::reminders::mark_catch_up(pool.inner(), &item.occurrence_key, Some("notification_unavailable"))
                        .await.map_err(|_| "reminder_ledger_failed")?;
                }
            }
        }
    }
    Ok(())
}
