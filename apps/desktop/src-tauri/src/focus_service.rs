//! The one process-wide `FocusService`, owned via `app.manage`.
//!
//! Every focus command, every app-handled task write (UI and `dt` socket RPC)
//! and every incoming local apply (Todoist, Turso, Google Calendar) goes
//! through this single instance, so there is exactly one clock and one
//! revision sequence. After each commit the app broadcasts
//! `nimble-focus-changed` to all windows with IDs/revisions only.
//!
//! Live timing is advertised only once `focus_window::wire_lifecycle` has
//! installed the 20-second heartbeat, window/quit settlement and power
//! interruption for a process that holds the profile owner lock
//! (`ProfileOwnerLock`). The heartbeat stays a private Rust hook and is never
//! exposed to the webview.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use nimble_core::db::focus::engine::{
    focus_error, FocusService, NativeTaskAction, NativeTaskCommand,
};
use nimble_core::focus_types::{
    FocusAction, FocusCapabilities, FocusError, FocusErrorCode, FocusSnapshot,
};
use nimble_core::types::LocalTask;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

/// The settings key the mute toggle writes (shared with the webview).
pub const SOUND_MUTED_KEY: &str = "focus_sound_muted";

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
    /// This process holds the profile owner lock; without it nothing here
    /// may write focus or task state (another process may be timing live).
    owns_profile: bool,
    /// Heartbeat + window/quit/power lifecycle installed (see `focus_window`).
    lifecycle_wired: AtomicBool,
    /// Poked after every commit so the heartbeat re-plans its next wake
    /// (a new timebox/Pomodoro boundary may now be sooner than 20 s).
    heartbeat_wake: Arc<tokio::sync::Notify>,
}

fn not_profile_owner() -> FocusError {
    error(
        FocusErrorCode::WrongOwner,
        "Another Nimble process holds this profile. Focus is read-only here.",
    )
}

/// Actions that open a live work/break segment and so need the heartbeat.
pub fn opens_live_segment(action: &FocusAction) -> bool {
    matches!(
        action,
        FocusAction::Start { .. } | FocusAction::Resume | FocusAction::StartBreak
    )
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
    ///
    /// `owns_profile` is whether this process acquired the profile owner
    /// lock. A non-owner never initializes the engine (initialization
    /// recovers running markers and bumps the process generation, which
    /// would disturb the real owner) and stays read-only.
    pub async fn start(pool: SqlitePool, owns_profile: bool) -> Self {
        let state = if owns_profile {
            open(&pool).await
        } else {
            match nimble_core::db::sync::get_or_create_device_id(&pool).await {
                Ok(device) => State {
                    service: Some(Arc::new(FocusService::new(pool.clone(), device))),
                    blocked: Some(not_profile_owner()),
                },
                Err(e) => State { service: None, blocked: Some(focus_error(&e)) },
            }
        };
        Self {
            pool,
            state: tokio::sync::Mutex::new(state),
            last_emitted: std::sync::Mutex::new(None),
            owns_profile,
            lifecycle_wired: AtomicBool::new(false),
            heartbeat_wake: Arc::new(tokio::sync::Notify::new()),
        }
    }

    pub fn heartbeat_wake(&self) -> Arc<tokio::sync::Notify> {
        self.heartbeat_wake.clone()
    }

    pub fn owns_profile(&self) -> bool {
        self.owns_profile
    }

    /// Called once the heartbeat, window/quit settlement and power observers
    /// are installed. Only an owner process can wire live timing.
    pub fn mark_lifecycle_wired(&self) {
        if self.owns_profile {
            self.lifecycle_wired.store(true, Ordering::SeqCst);
        }
    }

    pub fn lifecycle_wired(&self) -> bool {
        self.lifecycle_wired.load(Ordering::SeqCst)
    }

    /// Service-side gate (not UI gating): Start/Resume/Start break are
    /// rejected unless the lifecycle that settles them is wired.
    pub fn check_live_timing(&self, action: &FocusAction) -> Result<(), FocusError> {
        if opens_live_segment(action) && !self.lifecycle_wired() {
            return Err(error(
                FocusErrorCode::Unsupported,
                "Live timing isn't connected in this window process. Nothing was started.",
            ));
        }
        Ok(())
    }

    async fn resolve(&self, write: bool) -> Result<Arc<FocusService>, FocusError> {
        if write && !self.owns_profile {
            return Err(not_profile_owner());
        }
        let mut state = self.state.lock().await;
        // Transient storage failures retry initialization; ownership errors
        // (wrong_owner) wait for an explicit activation procedure.
        if self.owns_profile
            && (state.service.is_none()
                || state.blocked.as_ref().is_some_and(|e| matches!(e.code, FocusErrorCode::Storage)))
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

    /// The explicit activation of a restored profile (Settings → Backups or
    /// `dt backup activate`). Only the process holding the profile owner lock
    /// may run it; it clears the restore marker, makes this device the focus
    /// writer and re-initializes the service. Nothing starts. `Ok(false)`
    /// means the profile was already active and nothing was re-initialized.
    pub async fn activate_restored(&self) -> Result<bool, FocusError> {
        if !self.owns_profile {
            return Err(not_profile_owner());
        }
        let mut state = self.state.lock().await;
        let device = nimble_core::db::sync::get_or_create_device_id(&self.pool)
            .await
            .map_err(|e| focus_error(&e))?;
        let activated = nimble_core::db::recovery::activate_restored_profile(&self.pool, &device)
            .await
            .map_err(|e| focus_error(&e))?;
        if activated || state.blocked.is_some() || state.service.is_none() {
            *state = open(&self.pool).await;
        }
        match &state.blocked {
            Some(e) => Err(e.clone()),
            None => Ok(activated),
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

    /// Gate for incoming applies (Todoist, Turso, Google Calendar).
    ///
    /// - Profile owner and writer: `Ok(Some(service))`; applies join its lock
    ///   and clock.
    /// - Profile owner but not the queue writer (a restored profile):
    ///   `Ok(None)`, the headless checkpoint path. Nothing can be timing live,
    ///   because this process holds the owner lock.
    /// - Not the profile owner: `Err`. Another process owns the profile and
    ///   may be timing live, so this process must not apply anything to the
    ///   shared database at all, not even headlessly.
    pub async fn apply_service(&self) -> Result<Option<Arc<FocusService>>, FocusError> {
        if !self.owns_profile {
            return Err(not_profile_owner());
        }
        Ok(self.writer().await.ok())
    }

    pub async fn capabilities(&self) -> FocusCapabilities {
        match self.writer().await {
            Ok(_) => {
                let wired = self.lifecycle_wired();
                FocusCapabilities {
                    queue_read: true,
                    queue_write: true,
                    history_read: true,
                    live_timing: wired,
                    companion: wired,
                    // Import is a local, owner-only transaction; it does not
                    // need the live-timing lifecycle.
                    import: true,
                    reason: (!wired).then(|| {
                        "Live timing and the companion window are not connected in this process."
                            .into()
                    }),
                }
            }
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
                        FocusErrorCode::WrongOwner if !self.owns_profile => e.message.clone(),
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

/// After any committed focus change in the owner process: broadcast it, then
/// claim and play a pending sound. The claim is durable and exclusive, so
/// no second window or process can play the same sound; mute still consumes
/// the claim. Sound can never affect accounting.
pub async fn committed(app: &AppHandle, snapshot: &FocusSnapshot, command_id: Option<String>) {
    let Some(rt) = runtime(app) else { return };
    rt.emit(app, snapshot, command_id);
    rt.heartbeat_wake.notify_one();
    let Ok(service) = rt.writer().await else { return };
    let token = match service.claim_sound().await {
        Ok(Some(token)) => token,
        Ok(None) => return,
        Err(_) => return,
    };
    let Some(sound) = crate::focus_sound::FocusSound::from_token(&token) else { return };
    let muted = nimble_core::db::settings::get_setting(&rt.pool, SOUND_MUTED_KEY)
        .await
        .ok()
        .flatten()
        .is_some_and(|v| v == "true");
    if !muted {
        crate::focus_sound::play(app, sound);
    }
}

/// Settle and pause live timing for a lifecycle reason (last surface
/// closed, sleep, quit). A no-op when nothing is running.
pub async fn interrupt(app: &AppHandle, reason: &str) {
    let Some(rt) = runtime(app) else { return };
    let Ok(service) = rt.writer().await else { return };
    match service.interrupt(reason).await {
        Ok(snapshot) => committed(app, &snapshot, None).await,
        Err(e) => {
            log::warn!("Focus interrupt ({reason}) failed: {:?}", focus_error(&e).code);
            broadcast(app).await;
        }
    }
}

/// Milliseconds until the owner's running segment reaches its next boundary.
pub async fn ms_until_boundary(app: &AppHandle) -> Option<u64> {
    let rt = runtime(app)?;
    let service = rt.writer().await.ok()?;
    service.ms_until_boundary().await.ok().flatten()
}

/// One heartbeat tick: checkpoint the live session from the service's own
/// monotonic clock. Idle ticks commit nothing and emit nothing new.
pub async fn heartbeat(app: &AppHandle) {
    let Some(rt) = runtime(app) else { return };
    let Ok(service) = rt.writer().await else { return };
    match service.heartbeat().await {
        Ok(snapshot) => committed(app, &snapshot, None).await,
        Err(e) => {
            log::warn!("Focus heartbeat failed: {:?}", focus_error(&e).code);
            broadcast(app).await;
        }
    }
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

/// Activate a restored profile in this (owner) process and broadcast the
/// re-initialized focus state. See `FocusRuntime::activate_restored`.
pub async fn activate_restored(app: &AppHandle) -> Result<bool, FocusError> {
    let Some(rt) = runtime(app) else {
        return Err(error(FocusErrorCode::Unsupported, "Focus is not running in this process."));
    };
    let activated = rt.activate_restored().await?;
    broadcast(app).await;
    Ok(activated)
}

/// The apply gate for sync/calendar runners (see `FocusRuntime::apply_service`).
/// `Err` means skip the run entirely: another process owns this profile.
pub async fn apply_service(app: &AppHandle) -> Result<Option<Arc<FocusService>>, FocusError> {
    match runtime(app) {
        Some(rt) => rt.apply_service().await,
        None => Ok(None),
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
        // Another process owns this profile and may be timing live: never
        // write around it through the headless path.
        Some(rt) if !rt.owns_profile() => return Err(not_profile_owner()),
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
            committed(app, &reply.snapshot, Some(command_id)).await;
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
            // Same occurrence identity rule as the service, in one transaction.
            nimble_core::db::tasks::update_task_status_expected(
                pool, &id, &status, note.as_deref(), expected_due_date.as_deref(),
            )
            .await
            .map_err(|e| {
                let e = map(e);
                if matches!(e.code, FocusErrorCode::StaleOccurrence) { stale_due() } else { e }
            })?;
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
        let rt = FocusRuntime::start(pool, true).await;
        let e = rt.writer().await.err().unwrap();
        assert!(matches!(e.code, FocusErrorCode::WrongOwner));
        assert!(rt.reader().await.is_ok());
        let caps = rt.capabilities().await;
        assert!(caps.queue_read && !caps.queue_write && !caps.live_timing && !caps.import);
        assert!(caps.reason.unwrap().contains("restored"));
    }

    #[tokio::test]
    async fn owner_profile_is_writable_without_advertising_unwired_timing() {
        let pool = memory_pool().await;
        let rt = FocusRuntime::start(pool, true).await;
        assert!(rt.writer().await.is_ok());
        let caps = rt.capabilities().await;
        assert!(caps.queue_write && caps.queue_read && caps.history_read && caps.import);
        assert!(!caps.live_timing && !caps.companion);
    }

    #[tokio::test]
    async fn start_and_resume_are_rejected_by_the_service_until_lifecycle_is_wired() {
        let pool = memory_pool().await;
        let rt = FocusRuntime::start(pool, true).await;
        let start = FocusAction::Start { occurrence_id: "o".into() };
        for action in [start.clone(), FocusAction::Resume, FocusAction::StartBreak] {
            let e = rt.check_live_timing(&action).unwrap_err();
            assert!(matches!(e.code, FocusErrorCode::Unsupported));
        }
        // Actions that open no live segment stay allowed.
        assert!(rt.check_live_timing(&FocusAction::Pause).is_ok());
        rt.mark_lifecycle_wired();
        assert!(rt.check_live_timing(&start).is_ok());
        let caps = rt.capabilities().await;
        assert!(caps.live_timing && caps.companion && caps.import);
        assert!(caps.reason.is_none());
    }

    #[tokio::test]
    async fn second_process_without_the_profile_lock_is_read_only_and_never_wires_timing() {
        let pool = memory_pool().await;
        let owner = FocusService::new(pool.clone(), "this-device".into());
        owner.initialize().await.unwrap();
        let generation = owner.snapshot().await.unwrap().process_generation;
        let rt = FocusRuntime::start(pool, false).await;
        let e = rt.writer().await.err().unwrap();
        assert!(matches!(e.code, FocusErrorCode::WrongOwner));
        assert!(rt.reader().await.is_ok());
        // Starting as a non-owner must not bump the owner's generation.
        assert_eq!(rt.reader().await.unwrap().snapshot().await.unwrap().process_generation, generation);
        rt.mark_lifecycle_wired();
        assert!(!rt.lifecycle_wired());
        let caps = rt.capabilities().await;
        assert!(caps.queue_read && !caps.queue_write && !caps.live_timing && !caps.companion);
        assert!(caps.reason.unwrap().contains("Another Nimble process"));
    }

    #[tokio::test]
    async fn non_owner_sync_applies_are_refused_instead_of_going_headless() {
        // Non-owner: the owner may be timing live, so no apply path at all
        // (not even the headless checkpoint path) may run.
        let non_owner = FocusRuntime::start(memory_pool().await, false).await;
        let e = non_owner.apply_service().await.err().expect("refused");
        assert!(matches!(e.code, FocusErrorCode::WrongOwner));

        // Owner and writer: applies join the live service.
        let owner = FocusRuntime::start(memory_pool().await, true).await;
        assert!(owner.apply_service().await.unwrap().is_some());

        // Owner of a restored (other-device) profile: headless is safe,
        // because this process holds the lock and nothing is timing.
        let restored_pool = memory_pool().await;
        FocusService::new(restored_pool.clone(), "other-device".into()).initialize().await.unwrap();
        let restored = FocusRuntime::start(restored_pool, true).await;
        assert!(restored.apply_service().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn restored_profile_activation_reinitializes_ownership_once_and_refuses_non_owners() {
        let pool = memory_pool().await;
        FocusService::new(pool.clone(), "old-mac".into()).initialize().await.unwrap();
        nimble_core::db::recovery::normalize_focus_restore(&pool).await.unwrap();

        // A second process without the profile lock may never activate.
        let non_owner = FocusRuntime::start(pool.clone(), false).await;
        let e = non_owner.activate_restored().await.unwrap_err();
        assert!(matches!(e.code, FocusErrorCode::WrongOwner));
        assert!(nimble_core::db::recovery::require_activation_clear(&pool).await.is_err());

        let rt = FocusRuntime::start(pool.clone(), true).await;
        assert!(rt.writer().await.is_err(), "restored profile starts blocked");
        assert!(rt.activate_restored().await.unwrap(), "activated");
        nimble_core::db::recovery::require_activation_clear(&pool).await.unwrap();
        let writer = rt.writer().await.expect("writable after activation");
        let snap = writer.snapshot().await.unwrap();
        assert!(snap.session.is_none() && snap.recovery_reason.is_none());
        let caps = rt.capabilities().await;
        assert!(caps.queue_write && caps.import);

        // Idempotent: nothing re-initializes (the generation stays put).
        let generation = snap.process_generation;
        assert!(!rt.activate_restored().await.unwrap());
        assert_eq!(rt.writer().await.unwrap().snapshot().await.unwrap().process_generation, generation);
    }
}
