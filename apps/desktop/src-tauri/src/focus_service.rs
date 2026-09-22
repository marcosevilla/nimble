//! The one process-wide `FocusService`, owned via `app.manage`.
//!
//! Every focus command, every app-handled task write (UI and `dt` socket RPC)
//! and every incoming local apply (Todoist, Turso, Google Calendar) goes
//! through this single instance, so there is exactly one clock and one
//! revision sequence. After each commit the app broadcasts
//! `nimble-focus-changed` to all windows with IDs/revisions only.
//!
//! Not here (Task 9): process/profile lock, the 20-second heartbeat, window
//! lifecycle and power interruption. `checkpoint(elapsed_ms, …)` stays a
//! private Rust hook and is never exposed to the webview.
use std::sync::Arc;

use nimble_core::db::focus::engine::{
    focus_error, FocusService, NativeTaskAction, NativeTaskCommand,
};
use nimble_core::focus_types::{FocusCapabilities, FocusError, FocusErrorCode, FocusSnapshot};
use nimble_core::types::LocalTask;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

/// Flipped by Task 9 once the heartbeat and lifecycle interruption exist.
/// Until then a running session would be gap-paused after 40 s without a
/// checkpoint, so live timing is not advertised as available.
const LIVE_TIMING_WIRED: bool = false;

pub const FOCUS_CHANGED_EVENT: &str = "nimble-focus-changed";

/// Event payload: IDs and revisions only — never task content.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct FocusChanged {
    pub version: u32,
    pub engine_revision: u64,
    pub queue_revision: u64,
    pub owner_epoch: String,
    pub process_generation: u64,
    pub command_id: Option<String>,
}
impl FocusChanged {
    pub fn from_snapshot(snapshot: &FocusSnapshot, command_id: Option<String>) -> Self {
        Self {
            version: 1,
            engine_revision: snapshot.engine_revision,
            queue_revision: snapshot.queue_revision,
            owner_epoch: snapshot.owner_epoch.clone(),
            process_generation: snapshot.process_generation,
            command_id,
        }
    }
    fn key(&self) -> (String, u64, u64) {
        (self.owner_epoch.clone(), self.process_generation, self.engine_revision)
    }
}

fn error(code: FocusErrorCode, message: &str) -> FocusError {
    FocusError { code, message: message.to_owned() }
}

struct State {
    service: Option<Arc<FocusService>>,
    /// `None` = this process owns the queue and may write.
    blocked: Option<FocusError>,
}

pub struct FocusRuntime {
    pool: SqlitePool,
    state: tokio::sync::Mutex<State>,
    last_emitted: std::sync::Mutex<Option<(String, u64, u64)>>,
}

async fn open(pool: &SqlitePool) -> State {
    let device = match nimble_core::db::sync::get_or_create_device_id(pool).await {
        Ok(device) => device,
        Err(e) => return State { service: None, blocked: Some(focus_error(&e)) },
    };
    let service = Arc::new(FocusService::new(pool.clone(), device));
    let blocked = match service.initialize().await {
        Ok(()) => None,
        Err(e) => {
            let e = focus_error(&e);
            // A restored profile reports wrong_owner here; it stays readable
            // and never reclaims the writer automatically.
            log::warn!("Focus service not writable at startup: {:?}", e.code);
            Some(e)
        }
    };
    State { service: Some(service), blocked }
}

impl FocusRuntime {
    /// Never fails app startup: an initialization error becomes a typed,
    /// surfaced capability reason.
    pub async fn start(pool: SqlitePool) -> Self {
        let state = open(&pool).await;
        Self { pool, state: tokio::sync::Mutex::new(state), last_emitted: std::sync::Mutex::new(None) }
    }

    async fn resolve(&self, write: bool) -> Result<Arc<FocusService>, FocusError> {
        let mut state = self.state.lock().await;
        // Transient storage failures retry initialization; ownership errors
        // (wrong_owner) wait for an explicit activation procedure.
        if state.service.is_none()
            || state.blocked.as_ref().is_some_and(|e| matches!(e.code, FocusErrorCode::Storage))
        {
            *state = open(&self.pool).await;
        }
        let service = state
            .service
            .clone()
            .ok_or_else(|| error(FocusErrorCode::Storage, "focus storage unavailable"))?;
        match (&state.blocked, write) {
            (Some(e), true) => Err(e.clone()),
            _ => Ok(service),
        }
    }

    /// Reads (snapshot/history) are allowed on a blocked restored profile.
    pub async fn reader(&self) -> Result<Arc<FocusService>, FocusError> {
        self.resolve(false).await
    }

    /// Commands and owned task writes require this process to own the queue.
    pub async fn writer(&self) -> Result<Arc<FocusService>, FocusError> {
        self.resolve(true).await
    }

    /// The live service for incoming applies, or `None` to use the headless
    /// checkpoint path (nothing can be running when this process isn't the writer).
    pub async fn live(&self) -> Option<Arc<FocusService>> {
        self.writer().await.ok()
    }

    pub async fn capabilities(&self) -> FocusCapabilities {
        match self.writer().await {
            Ok(_) => FocusCapabilities {
                queue_read: true,
                queue_write: true,
                history_read: true,
                live_timing: LIVE_TIMING_WIRED,
                companion: false,
                import: false,
                reason: Some(
                    "Live timing, the companion window and import are not connected yet."
                        .into(),
                ),
            },
            Err(e) => {
                let readable = self.reader().await.is_ok();
                FocusCapabilities {
                    queue_read: readable,
                    queue_write: false,
                    history_read: readable,
                    live_timing: false,
                    companion: false,
                    import: false,
                    reason: Some(match e.code {
                        FocusErrorCode::WrongOwner => "This profile was restored. Focus stays read-only until it is activated on this Mac.".into(),
                        _ => format!("Focus is unavailable: {}", e.message),
                    }),
                }
            }
        }
    }

    /// Emit once per (epoch, generation, revision); duplicates are harmless
    /// but noisy, since every window re-reads its snapshot.
    pub fn emit(&self, app: &AppHandle, snapshot: &FocusSnapshot, command_id: Option<String>) {
        let payload = FocusChanged::from_snapshot(snapshot, command_id);
        let key = payload.key();
        {
            let mut last = self.last_emitted.lock().unwrap_or_else(|p| p.into_inner());
            if last.as_ref() == Some(&key) {
                return;
            }
            *last = Some(key);
        }
        let _ = app.emit(FOCUS_CHANGED_EVENT, payload);
    }
}

fn runtime(app: &AppHandle) -> Option<tauri::State<'_, FocusRuntime>> {
    app.try_state::<FocusRuntime>()
}

/// Read the committed state and broadcast it if its revision moved. Used
/// after sync applies and failed commands (which may commit a recovery pause).
pub async fn broadcast(app: &AppHandle) {
    let Some(rt) = runtime(app) else { return };
    let Ok(service) = rt.reader().await else { return };
    if let Ok(snapshot) = service.snapshot().await {
        rt.emit(app, &snapshot, None);
    }
}

/// The live service for sync/calendar applies (see `FocusRuntime::live`).
pub async fn live(app: &AppHandle) -> Option<Arc<FocusService>> {
    match runtime(app) {
        Some(rt) => rt.live().await,
        None => None,
    }
}

pub struct TaskWriteOutcome {
    pub task: Option<LocalTask>,
    pub undo_token: Option<String>,
    pub replayed: bool,
}

fn stale_due() -> FocusError {
    error(
        FocusErrorCode::StaleOccurrence,
        "This task's date changed since it was shown. Refresh and try again.",
    )
}

/// One entry point for app-handled task writes (UI commands and `dt` RPC).
///
/// With a writable service the write runs through `execute_native_task`,
/// sharing its lock, clock and receipt table; `command_id` is the caller's
/// retry identity and is never re-minted for a retry. When this process
/// does not own the queue, nothing can be timing live, so the headless CRUD
/// path (checkpoint reconcile) is deterministic — not an uncertain fallback.
pub async fn execute_task(
    app: &AppHandle,
    action: NativeTaskAction,
    command_id: Option<String>,
) -> Result<TaskWriteOutcome, FocusError> {
    let service = match runtime(app) {
        Some(rt) => rt.writer().await.ok(),
        None => None,
    };
    let Some(service) = service else {
        return execute_headless(app, action).await;
    };
    let command_id = command_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let result = service
        .execute_native_task(NativeTaskCommand { command_id: command_id.clone(), action })
        .await;
    match result {
        Ok(reply) => {
            if let Some(rt) = runtime(app) {
                rt.emit(app, &reply.snapshot, Some(command_id));
            }
            Ok(TaskWriteOutcome { task: reply.task, undo_token: reply.undo_token, replayed: reply.replayed })
        }
        Err(e) => {
            broadcast(app).await;
            let e = focus_error(&e);
            Err(if matches!(e.code, FocusErrorCode::StaleOccurrence) { stale_due() } else { e })
        }
    }
}

async fn execute_headless(
    app: &AppHandle,
    action: NativeTaskAction,
) -> Result<TaskWriteOutcome, FocusError> {
    let pool = app.state::<SqlitePool>();
    let pool = pool.inner();
    let map = |e: nimble_core::Error| focus_error(&e);
    let task = match action {
        NativeTaskAction::Create { input } => {
            Some(nimble_core::db::tasks::create_local_task(pool, input).await.map_err(map)?)
        }
        NativeTaskAction::Update { id, input } => {
            Some(nimble_core::db::tasks::update_local_task(pool, &id, input).await.map_err(map)?)
        }
        NativeTaskAction::SetStatus { id, status, note, expected_due_date } => {
            if status == "complete" {
                // Same occurrence identity rule as the service, best effort
                // without its lock (no live timing exists on this path).
                let row: Option<(Option<String>, Option<String>)> =
                    sqlx::query_as("SELECT due_date,recurrence_rule FROM local_tasks WHERE id=?")
                        .bind(&id)
                        .fetch_optional(pool)
                        .await
                        .map_err(|e| map(e.into()))?;
                let Some((due, rule)) = row else {
                    return Err(error(FocusErrorCode::NotFound, "task missing"));
                };
                if due.is_some()
                    && rule.as_deref().and_then(nimble_core::recurrence::parse_rule).is_some()
                    && expected_due_date != due
                {
                    return Err(stale_due());
                }
            }
            nimble_core::db::tasks::update_task_status(pool, &id, &status, note.as_deref())
                .await
                .map_err(map)?;
            None
        }
        NativeTaskAction::Delete { id } => {
            nimble_core::db::tasks::delete_local_task(pool, &id).await.map_err(map)?;
            None
        }
    };
    Ok(TaskWriteOutcome { task, undo_token: None, replayed: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn memory_pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        nimble_core::db::migrations::run_migrations(&pool).await.unwrap();
        pool
    }

    #[test]
    fn change_payload_carries_only_ids_and_revisions() {
        let snapshot = FocusSnapshot {
            queue_revision: 2,
            engine_revision: 7,
            owner_epoch: "epoch".into(),
            process_generation: 3,
            writer_device_id: "device".into(),
            queue: vec![],
            selected_occurrence_id: None,
            session: None,
            totals: Default::default(),
            as_of: "2026-09-22T00:00:00Z".into(),
            checkpoint_at: None,
            recovery_reason: None,
            replica: false,
        };
        let value = serde_json::to_value(FocusChanged::from_snapshot(&snapshot, Some("c".into()))).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["command_id", "engine_revision", "owner_epoch", "process_generation", "queue_revision", "version"]
        );
        assert_eq!(value["engine_revision"], 7);
    }

    #[tokio::test]
    async fn restored_profile_starts_blocked_but_readable() {
        let pool = memory_pool().await;
        let first = FocusService::new(pool.clone(), "other-device".into());
        first.initialize().await.unwrap();
        let rt = FocusRuntime::start(pool).await;
        let e = rt.writer().await.err().unwrap();
        assert!(matches!(e.code, FocusErrorCode::WrongOwner));
        assert!(rt.reader().await.is_ok());
        let caps = rt.capabilities().await;
        assert!(caps.queue_read && !caps.queue_write && !caps.live_timing);
        assert!(caps.reason.unwrap().contains("restored"));
    }

    #[tokio::test]
    async fn owner_profile_is_writable_without_advertising_unwired_timing() {
        let pool = memory_pool().await;
        let rt = FocusRuntime::start(pool).await;
        assert!(rt.writer().await.is_ok());
        let caps = rt.capabilities().await;
        assert!(caps.queue_write && caps.queue_read && caps.history_read);
        assert!(!caps.live_timing && !caps.companion && !caps.import);
    }
}
