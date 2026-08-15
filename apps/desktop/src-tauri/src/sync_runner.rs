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

/// Settings key holding the last time a Turso sync was *attempted* (RFC 3339, UTC).
///
/// Deliberately not `last_push_timestamp`: that one is a watermark describing how
/// far the data got, and reusing it as a rate-limiter would let a failed run reset
/// how much gets pushed next time.
const TURSO_LAST_SYNC_KEY: &str = "turso_last_sync_at";

/// Device sync with Turso — push local changes, then pull remote ones.
///
/// This exists because until it did, `sync::push`/`sync::pull` had exactly one
/// caller each in the whole app: the button on the Settings page. Nothing ran
/// them on a schedule, so a capture made on the Mac reached the cloud only if you
/// happened to open Settings and click, and changes made anywhere else never came
/// back at all. The Todoist sync has had a background loop the whole time, which
/// is what made the gap easy to miss.
///
/// Gated the same way the Todoist loop is, because the callers (a 5-minute
/// interval and every window focus) fire far more often than a sync is needed.
///
/// Never propagates an error. Push and pull are independent — a failing push must
/// not prevent the pull, or a single bad local entry would also cut off everything
/// arriving from other devices. Both retry on the next trigger, which is safe:
/// push only sends entries still marked unsynced, and pull is driven by a
/// watermark it advances per chunk.
pub async fn run_turso_sync_if_due(app: &AppHandle, min_interval_secs: i64) {
    let state = app.state::<SqlitePool>();
    let pool = state.inner();

    // Turso being unconfigured is the normal state before setup, not a fault —
    // log nothing, or every 5 minutes produces a warning forever.
    let url = match nimble_core::db::settings::get_setting(pool, "turso_url").await {
        Ok(Some(v)) => v,
        _ => return,
    };
    let token = match nimble_core::db::settings::get_setting(pool, "turso_token").await {
        Ok(Some(v)) => v,
        _ => return,
    };

    if let Ok(Some(last)) = nimble_core::db::settings::get_setting(pool, TURSO_LAST_SYNC_KEY).await {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&last) {
            let age = chrono::Utc::now() - parsed.with_timezone(&chrono::Utc);
            if age.num_seconds() < min_interval_secs {
                return;
            }
        }
    }

    // Stamped before the work rather than after. If a sync fails, the next window
    // focus would otherwise retry immediately and keep retrying — turning a Turso
    // outage into a request loop. Waiting out the interval is the correct response
    // to failure here.
    let now = chrono::Utc::now().to_rfc3339();
    let _ = nimble_core::db::settings::set_setting(pool, TURSO_LAST_SYNC_KEY, &now).await;

    match nimble_core::db::sync::push(pool, &url, &token).await {
        Ok(count) if count > 0 => log::info!("Turso push: {count} entries pushed"),
        Ok(_) => {}
        Err(e) => log::warn!("Turso push failed (will retry on next trigger): {e}"),
    }

    match nimble_core::db::sync::pull(pool, &url, &token).await {
        Ok(count) if count > 0 => {
            log::info!("Turso pull: {count} remote changes applied");
            // Rows changed underneath the UI, so the frontend has to re-read.
            let _ = app.emit("remote-sync-applied", ());
        }
        Ok(_) => {}
        Err(e) => log::warn!("Turso pull failed (will retry on next trigger): {e}"),
    }
}
