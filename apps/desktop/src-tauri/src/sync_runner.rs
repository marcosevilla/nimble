use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

/// Runs a full push-then-pull sync and, if it changed anything locally,
/// emits `todoist-sync-applied` so the frontend refreshes its task lists.
pub async fn run_and_emit(
    app: &AppHandle,
) -> nimble_core::Result<nimble_core::integrations::todoist::sync_loop::SyncReport> {
    let pool = app.state::<SqlitePool>();
    let focus = crate::focus_service::apply_service(app)
        .await
        .map_err(|e| nimble_core::Error::Other(format!("wrong_owner: {}", e.message)))?;
    let report = nimble_core::integrations::todoist::sync_loop::run_sync_with_focus(
        pool.inner(),
        focus.as_deref(),
    )
    .await?;
    if report.changed_anything() {
        let _ = app.emit("todoist-sync-applied", ());
        crate::focus_service::broadcast(app).await;
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
    // A non-owner process never syncs: the owner may be timing live.
    let Ok(focus) = crate::focus_service::apply_service(app).await else { return };
    match nimble_core::integrations::todoist::sync_loop::run_sync_if_due_with_focus(
        pool.inner(),
        min_interval_secs,
        focus.as_deref(),
    )
    .await
    {
        Ok(report) if report.changed_anything() => {
            let _ = app.emit("todoist-sync-applied", ());
            crate::focus_service::broadcast(app).await;
        }
        Ok(_) => {}
        Err(e) => log::warn!("todoist sync failed (will retry on next trigger): {e}"),
    }
}

/// Settings key holding the last time a Turso sync was *attempted* (RFC 3339, UTC).
///
/// Deliberately not `last_push_timestamp`: that one is a watermark describing how
/// far the data got, and reusing it as a rate-limiter would let a failed run reset
/// how much gets pushed next time.
const TURSO_LAST_SYNC_KEY: &str = "turso_last_sync_at";

/// All desktop Turso pipelines (background, Settings and agent) share this lock.
static TURSO_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, serde::Serialize)]
pub struct TursoRunReport {
    pub state: &'static str,
    pub pushed: Option<u64>,
    pub pulled: Option<u64>,
    pub push_error: Option<&'static str>,
    pub pull_error: Option<&'static str>,
}
impl TursoRunReport {
    fn skipped(state: &'static str) -> Self {
        Self {
            state,
            pushed: None,
            pulled: None,
            push_error: None,
            pull_error: None,
        }
    }
}

pub async fn run_turso_sync_if_due(app: &AppHandle, min_interval_secs: i64) {
    let report = run_turso_report(app, min_interval_secs).await;
    if report.push_error.is_some() || report.pull_error.is_some() {
        log::warn!("Turso sync incomplete; next scheduled run will retry");
    }
}
async fn turso_credentials(pool: &SqlitePool) -> nimble_core::Result<Option<(String, String)>> {
    let url = nimble_core::db::settings::get_setting(pool, "turso_url").await?;
    let token = nimble_core::db::settings::get_setting(pool, "turso_token").await?;
    Ok(match (url, token) {
        (Some(u), Some(t)) if !u.is_empty() && !t.is_empty() => Some((u, t)),
        _ => None,
    })
}
async fn run_turso_report(app: &AppHandle, min_interval_secs: i64) -> TursoRunReport {
    let Ok(_guard) = TURSO_LOCK.try_lock() else {
        return TursoRunReport::skipped("already_running");
    };
    // A non-owner process never pushes or pulls: the owner may be timing live.
    let Ok(focus) = crate::focus_service::apply_service(app).await else {
        return TursoRunReport::skipped("not_profile_owner");
    };
    let state = app.state::<SqlitePool>();
    let pool = state.inner();
    if nimble_core::db::recovery::require_activation_clear(pool).await.is_err() {
        return TursoRunReport::skipped("restore_activation_required");
    }
    let (url, token) = match turso_credentials(pool).await {
        Ok(Some(v)) => v,
        Ok(None) => return TursoRunReport::skipped("not_configured"),
        Err(_) => return TursoRunReport::skipped("configuration_unavailable"),
    };
    if min_interval_secs > 0 {
        if let Ok(Some(last)) =
            nimble_core::db::settings::get_setting(pool, TURSO_LAST_SYNC_KEY).await
        {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&last) {
                if (chrono::Utc::now() - parsed.with_timezone(&chrono::Utc)).num_seconds()
                    < min_interval_secs
                {
                    return TursoRunReport::skipped("recently_synced");
                }
            }
        }
    }
    let _ = nimble_core::db::settings::set_setting(
        pool,
        TURSO_LAST_SYNC_KEY,
        &chrono::Utc::now().to_rfc3339(),
    )
    .await;
    // Independent outcomes preserve the existing rule: failed push must not suppress pull.
    let pushed = nimble_core::db::sync::push(pool, &url, &token).await;
    let pulled = nimble_core::db::sync::pull_with_focus(pool, &url, &token, focus.as_deref()).await;
    if pulled.as_ref().is_ok_and(|n| *n > 0) {
        let _ = app.emit("remote-sync-applied", ());
        crate::focus_service::broadcast(app).await;
    }
    if pushed.is_ok() && pulled.is_ok() {
        // What `dt sync status` / Settings report as the last sync.
        let _ = nimble_core::db::sync::record_turso_sync_completed(pool, &chrono::Utc::now().to_rfc3339()).await;
    }
    turso_outcomes(pushed, pulled)
}
fn turso_outcomes(
    pushed: nimble_core::Result<u64>,
    pulled: nimble_core::Result<u64>,
) -> TursoRunReport {
    TursoRunReport {
        state: if pushed.is_ok() && pulled.is_ok() {
            "completed"
        } else {
            "incomplete"
        },
        push_error: pushed.as_ref().err().map(|_| "push_failed"),
        pull_error: pulled.as_ref().err().map(|_| "pull_failed"),
        pushed: pushed.ok(),
        pulled: pulled.ok(),
    }
}
/// Settings' individual push and pull use the same serialization gate.
pub async fn push_turso(app: &AppHandle) -> Result<u64, String> {
    let _guard = TURSO_LOCK
        .try_lock()
        .map_err(|_| "Sync already running".to_owned())?;
    crate::focus_service::apply_service(app).await.map_err(|e| e.message)?;
    let pool = app.state::<SqlitePool>();
    let (url, token) = turso_credentials(pool.inner())
        .await
        .map_err(|_| "Cannot read sync configuration")?
        .ok_or("Turso is not configured")?;
    nimble_core::db::sync::push(pool.inner(), &url, &token)
        .await
        .map_err(|_| "Turso push failed".into())
}
pub async fn pull_turso(app: &AppHandle) -> Result<u64, String> {
    let _guard = TURSO_LOCK
        .try_lock()
        .map_err(|_| "Sync already running".to_owned())?;
    let pool = app.state::<SqlitePool>();
    let (url, token) = turso_credentials(pool.inner())
        .await
        .map_err(|_| "Cannot read sync configuration")?
        .ok_or("Turso is not configured")?;
    let focus = crate::focus_service::apply_service(app).await.map_err(|e| e.message)?;
    let count = nimble_core::db::sync::pull_with_focus(pool.inner(), &url, &token, focus.as_deref())
        .await
        .map_err(|_| "Turso pull failed")?;
    if count > 0 {
        let _ = app.emit("remote-sync-applied", ());
        crate::focus_service::broadcast(app).await;
    }
    Ok(count)
}
pub async fn run_agent_sync(app: &AppHandle) -> Result<serde_json::Value, String> {
    let todoist = match run_and_emit(app).await {
        Ok(report) => {
            serde_json::json!({"state": if report.skipped.is_some() { "skipped" } else { "completed" }, "report": report})
        }
        Err(_) => serde_json::json!({"state":"failed","error":"todoist_sync_failed"}),
    };
    let turso = run_turso_report(app, 0).await;
    Ok(serde_json::json!({"todoist":todoist,"turso":turso}))
}

#[cfg(test)]
mod agent_tests {
    use super::*;
    #[test]
    fn outcome_reports_partial_failure_without_sensitive_error_text() {
        let report = turso_outcomes(
            Err(nimble_core::Error::Api("secret-url-and-token".into())),
            Ok(4),
        );
        let json = serde_json::to_value(report).unwrap();
        assert_eq!(json["state"], "incomplete");
        assert_eq!(json["pulled"], 4);
        assert_eq!(json["push_error"], "push_failed");
        assert!(!json.to_string().contains("secret"));
    }
    #[tokio::test]
    async fn competing_turso_pipeline_cannot_acquire_gate() {
        let held = TURSO_LOCK.lock().await;
        assert!(TURSO_LOCK.try_lock().is_err());
        drop(held);
        assert!(TURSO_LOCK.try_lock().is_ok());
    }
}
