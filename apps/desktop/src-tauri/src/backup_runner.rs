//! Desktop-only orchestration. No live restore or automatic remote setup.
use crate::{
    backup_git,
    backup_state::{self, BackupState, StageError},
};
use chrono::{DateTime, FixedOffset, NaiveDate, Timelike, Utc};
use nimble_core::{
    db::backup::{self, BackupPaths, VerifiedGeneration},
    Error, Result,
};
use serde::Serialize;
use sqlx::SqlitePool;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Manager};

pub struct BackupRuntime {
    paths: BackupPaths,
    disabled_reason: Option<String>,
    test_mode: bool,
    job: tokio::sync::Mutex<()>,
    running: AtomicBool,
}
#[derive(Serialize)]
pub struct BackupStatus {
    running: bool,
    disabled_reason: Option<String>,
    last_local_success_at: Option<String>,
    last_push_at: Option<String>,
    export_commit: Option<String>,
    backup_directory: String,
    retained_count: Option<u64>,
    remote_configured: bool,
    remote_name: Option<String>,
    turso_pending: Option<i64>,
    todoist_pending: Option<i64>,
    todoist_failed: Option<i64>,
    /// A restored profile stays inert until explicitly activated.
    restore_activation_required: bool,
    error: Option<StageError>,
}
/// Stable allowlisted codes only. Never return process output or database error details.
pub fn public_error_code(error: &Error) -> &'static str {
    match error.to_string().as_str() {
        "backup_recovery_restore_activation_required" => "restore_activation_required",
        "restore_activation_refused" => "restore_activation_refused",
        "backup_busy" => "backup_busy",
        "backup_disabled" => "backup_disabled",
        "backup_tool_unavailable" => "backup_tool_unavailable",
        "remote_privacy_unverified" => "remote_privacy_unverified",
        "remote_must_be_private" => "remote_must_be_private",
        "remote_identity_changed" => "remote_identity_changed",
        "invalid_repository_name" => "invalid_repository_name",
        "backup_repository_dirty" | "backup_journal_conflict" => "backup_repository_dirty",
        "backup_branch_must_be_main" => "backup_branch_must_be_main",
        "unrelated_backup_repository"
        | "unexpected_backup_files"
        | "unexpected_backup_remote"
        | "unexpected_backup_history" => "unrelated_backup_repository",
        "unexpected_backup_transport" | "git_url_rewrite_refused" => "unexpected_backup_transport",
        "backup_push_failed" | "backup_push_not_acknowledged" => "backup_push_failed",
        "backup_process_timeout" => "backup_process_timeout",
        "backup_generation_missing" | "backup_no_verified_backup" => "backup_no_verified_backup",
        "backup_test_profile_upload_disabled" => "backup_test_profile_upload_disabled",
        "backup_lock_replaced" => "backup_lock_replaced",
        _ => "backup_action_failed",
    }
}
fn err(code: &str) -> Error {
    Error::Other(format!("backup_{code}"))
}
impl BackupRuntime {
    pub fn new(app_data: PathBuf, database: PathBuf, demo: bool, test_mode: bool) -> Self {
        let disabled_reason = if demo {
            Some("Backups are disabled in demo mode.".into())
        } else if cfg!(debug_assertions) && !test_mode {
            Some("Backups are disabled in development. Use an isolated backup test profile.".into())
        } else {
            None
        };
        Self {
            paths: BackupPaths {
                generations: app_data.join("backups"),
                app_data,
                database,
            },
            disabled_reason,
            test_mode,
            job: tokio::sync::Mutex::new(()),
            running: AtomicBool::new(false),
        }
    }
    pub fn is_test_profile(&self) -> bool {
        self.test_mode
    }
    fn enabled(&self) -> Result<()> {
        // Recheck marker so a switch to demo cannot slip past initialization.
        if self.disabled_reason.is_some() || self.paths.app_data.join("demo-mode").exists() {
            return Err(err("disabled"));
        }
        Ok(())
    }
}
/// Debug-only test profile. Must be a fresh app-owned temp directory, never production.
pub fn test_root() -> Result<Option<PathBuf>> {
    if !cfg!(debug_assertions) {
        return Ok(None);
    }
    let Some(root) = std::env::var_os("NIMBLE_BACKUP_TEST_ROOT") else {
        return Ok(None);
    };
    validate_test_root(&PathBuf::from(root)).map(Some)
}
fn validate_test_root(path: &std::path::Path) -> Result<PathBuf> {
    use std::os::unix::fs::MetadataExt;
    let temp = std::fs::canonicalize(std::env::temp_dir())?;
    let resolved = std::fs::canonicalize(&path)?;
    if (!resolved.starts_with(&temp) && !resolved.starts_with("/private/tmp"))
        || resolved == temp
        || resolved == std::path::Path::new("/private/tmp")
        || std::fs::symlink_metadata(&path)?.file_type().is_symlink()
        || !resolved
            .file_name()
            .is_some_and(|v| v.to_string_lossy().starts_with("nimble-backup-test-"))
    {
        return Err(err("unsafe_test_root"));
    }
    for name in [
        "synthetic-profile",
        "nimble.db",
        "nimble.db-wal",
        "nimble.db-shm",
        "nimble.db-journal",
        "daily-triage.db",
        "daily-triage.db-wal",
        "daily-triage.db-shm",
        "demo.db",
        "demo.db-wal",
        "demo.db-shm",
    ] {
        match std::fs::symlink_metadata(resolved.join(name)) {
            Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() || meta.nlink() != 1 => {
                return Err(err("linked_test_file"))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    // Test profiles must be explicitly marked; never point this at real restored data.
    if std::fs::read(resolved.join("synthetic-profile"))? != b"nimble-synthetic-only\n" {
        return Err(err("invalid_test_profile"));
    }
    Ok(resolved)
}
pub fn due_slot(now: DateTime<FixedOffset>, last: Option<NaiveDate>) -> Option<NaiveDate> {
    let date = now.date_naive();
    if last.is_none() {
        return Some(date);
    }
    let due = if now.hour() >= 2 {
        date
    } else {
        date.pred_opt()?
    };
    (last? < due).then_some(due)
}
fn deadline_elapsed(value: Option<&str>, now: DateTime<Utc>) -> bool {
    value
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|v| v <= now)
        .unwrap_or(value.is_none())
}
fn last_slot(state: &BackupState) -> Result<Option<NaiveDate>> {
    state
        .last_local_slot
        .as_deref()
        .map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| err("invalid_slot")))
        .transpose()
}
fn publish_delay(failures: u32) -> chrono::Duration {
    chrono::Duration::minutes(15_i64 * (1_i64 << failures.saturating_sub(1).min(4)))
}
fn local_success(state: &mut BackupState, generation: &VerifiedGeneration, slot: NaiveDate) {
    state.last_local_success_at = Some(generation.manifest().created_at.clone());
    state.last_local_slot = Some(slot.to_string());
    state.generation_id = Some(generation.manifest().id.clone());
    state.pending_generation_id = state
        .remote
        .as_ref()
        .map(|_| generation.manifest().id.clone());
    state.cleanup_generation_id = Some(generation.manifest().id.clone());
    state.next_local_attempt_at = None;
    clear_error(state, "snapshot");
}
fn clear_error(state: &mut BackupState, stage: &str) {
    if state.stage_error.as_ref().is_some_and(|e| e.stage == stage) {
        state.stage_error = None;
    }
}
fn failure(state: &mut BackupState, stage: &str, now: DateTime<Utc>) {
    state.stage_error = Some(StageError {
        stage: stage.into(),
        code: format!("{stage}_failed"),
        at: now.to_rfc3339(),
    });
}
async fn generation(paths: &BackupPaths, id: &str) -> Result<VerifiedGeneration> {
    backup::list_verified(paths)
        .await?
        .into_iter()
        .find(|g| g.manifest().id == id)
        .ok_or_else(|| err("generation_missing"))
}
fn verified_count(paths: &BackupPaths) -> Option<u64> {
    if !paths.generations.exists() {
        return Some(0);
    }
    let entries = std::fs::read_dir(&paths.generations).ok()?;
    let mut count = 0;
    for entry in entries {
        let entry = entry.ok()?;
        if !entry.file_type().ok()?.is_dir() || entry.file_name().to_string_lossy().starts_with('.')
        {
            continue;
        }
        let manifest = entry.path().join("manifest.json");
        if manifest.is_file()
            && !std::fs::symlink_metadata(manifest)
                .ok()?
                .file_type()
                .is_symlink()
        {
            count += 1;
        }
    }
    Some(count)
}
pub async fn read_status(app: &AppHandle) -> Result<BackupStatus> {
    let runtime = app.state::<BackupRuntime>();
    let pool = app.state::<SqlitePool>();
    let (state, state_error) = match backup_state::load_state(&runtime.paths.app_data) {
        Ok(state) => (state, None),
        Err(_) => (
            BackupState::default(),
            Some(StageError {
                stage: "state".into(),
                code: "state_unavailable".into(),
                at: Utc::now().to_rfc3339(),
            }),
        ),
    };
    let turso_pending = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE synced = 0")
        .fetch_one(pool.inner())
        .await
        .ok();
    let todoist_pending = sqlx::query_scalar(
        "SELECT COUNT(*) FROM todoist_outbox WHERE status IN ('pending','sending')",
    )
    .fetch_one(pool.inner())
    .await
    .ok();
    let todoist_failed = sqlx::query_scalar(
        "SELECT COUNT(*) FROM todoist_outbox WHERE status IN ('error','failed')",
    )
    .fetch_one(pool.inner())
    .await
    .ok();
    Ok(BackupStatus {
        running: runtime.running.load(Ordering::SeqCst),
        disabled_reason: runtime.disabled_reason.clone(),
        last_local_success_at: state.last_local_success_at,
        last_push_at: state.last_push_at,
        export_commit: state.export_commit,
        backup_directory: runtime.paths.generations.to_string_lossy().into_owned(),
        retained_count: verified_count(&runtime.paths),
        remote_configured: state.remote.is_some(),
        remote_name: state.remote.map(|r| r.owner_repo),
        turso_pending,
        todoist_pending,
        todoist_failed,
        restore_activation_required: nimble_core::db::recovery::require_activation_clear(pool.inner())
            .await
            .is_err(),
        error: state_error.or(state.stage_error),
    })
}
struct Running<'a>(&'a AtomicBool);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn execute(app: &AppHandle, manual: bool) -> Result<()> {
    let runtime = app.state::<BackupRuntime>();
    let pool = app.state::<SqlitePool>();
    execute_job(
        &runtime,
        pool.inner(),
        manual,
        chrono::Local::now().fixed_offset(),
    )
    .await
}
async fn execute_job(
    runtime: &BackupRuntime,
    pool: &SqlitePool,
    manual: bool,
    local: DateTime<FixedOffset>,
) -> Result<()> {
    runtime.enabled()?;
    nimble_core::db::recovery::require_activation_clear(pool).await?;
    let Ok(_mutex) = runtime.job.try_lock() else {
        return if manual { Err(err("busy")) } else { Ok(()) };
    };
    let Some(guard) = backup::try_lock(&runtime.paths)? else {
        return if manual { Err(err("busy")) } else { Ok(()) };
    };
    runtime.running.store(true, Ordering::SeqCst);
    let _running = Running(&runtime.running);
    let mut state = backup_state::load_state(&runtime.paths.app_data)?;
    let now = local.with_timezone(&Utc);
    // Reconcile a generation that was published before status persistence crashed.
    let mut all = backup::list_verified(&runtime.paths).await?;
    all.sort_by(|a, b| {
        a.manifest()
            .created_at
            .cmp(&b.manifest().created_at)
            .then(a.manifest().id.cmp(&b.manifest().id))
    });
    if let Some(latest) = all.last() {
        if state
            .last_local_success_at
            .as_deref()
            .is_none_or(|at| at < latest.manifest().created_at.as_str())
        {
            let day = NaiveDate::parse_from_str(&latest.manifest().local_date, "%Y-%m-%d")
                .map_err(|_| err("invalid_manifest_date"))?;
            local_success(&mut state, latest, day);
            backup_state::save_state(&runtime.paths.app_data, &state)?;
        }
    }
    let slot = if manual {
        Some(local.date_naive())
    } else {
        due_slot(local, last_slot(&state)?)
    };
    if let Some(slot) =
        slot.filter(|_| manual || deadline_elapsed(state.next_local_attempt_at.as_deref(), now))
    {
        state.next_local_attempt_at = Some((now + chrono::Duration::minutes(15)).to_rfc3339());
        backup_state::save_state(&runtime.paths.app_data, &state)?;
        match backup::create_generation(&runtime.paths, local, env!("CARGO_PKG_VERSION"), &guard)
            .await
        {
            Ok(generation) => {
                local_success(&mut state, &generation, slot);
                backup_state::save_state(&runtime.paths.app_data, &state)?;
            }
            Err(_) => {
                failure(&mut state, "snapshot", now);
                backup_state::save_state(&runtime.paths.app_data, &state)?;
                return Err(err("snapshot_failed"));
            }
        }
    }
    if let (Some(remote), Some(id)) = (state.remote.clone(), state.pending_generation_id.clone()) {
        if !manual && !deadline_elapsed(state.next_publish_attempt_at.as_deref(), now) {
            return Ok(());
        }
        // Network publication is forbidden in the synthetic native profile.

        state.next_publish_attempt_at = Some((now + chrono::Duration::minutes(15)).to_rfc3339());
        backup_state::save_state(&runtime.paths.app_data, &state)?;
        let saved = generation(&runtime.paths, &id).await?;
        let published = if runtime.test_mode {
            Err(err("test_profile_upload_disabled"))
        } else {
            backup_git::publish(&remote, &saved.directory().join("export")).await
        };
        match published {
            Ok(result) => {
                state.export_commit = Some(result.commit.clone());
                state.pushed_commit = Some(result.commit);
                state.last_push_at = Some(result.acknowledged_at);
                state.publish_failures = 0;
                state.next_publish_attempt_at = None;
                state.pending_generation_id = None;
                clear_error(&mut state, "publish");
                backup_state::save_state(&runtime.paths.app_data, &state)?;
            }
            Err(error) => {
                if !runtime.test_mode {
                    state.export_commit = backup_git::current_commit(&remote).await.ok().flatten();
                }
                state.publish_failures = state.publish_failures.saturating_add(1);
                state.next_publish_attempt_at =
                    Some((now + publish_delay(state.publish_failures)).to_rfc3339());
                failure(&mut state, "publish", now);
                state.stage_error.as_mut().unwrap().code = public_error_code(&error).into();
                backup_state::save_state(&runtime.paths.app_data, &state)?;
                return Err(err("publish_failed"));
            }
        }
    }
    if let Some(id) = state.cleanup_generation_id.clone() {
        let result: Result<()> = async {
            let saved = generation(&runtime.paths, &id).await?;
            nimble_core::db::sync::prune_backed_up_log(pool, &saved, now, &runtime.paths, &guard)
                .await?;
            let generations = backup::list_verified(&runtime.paths).await?;
            let manifests = generations
                .iter()
                .map(|g| g.manifest().clone())
                .collect::<Vec<_>>();
            backup::apply_retention(
                &runtime.paths,
                &backup::retention_candidates(&manifests),
                &guard,
            )?;
            Ok(())
        }
        .await;
        match result {
            Ok(()) => {
                state.cleanup_generation_id = None;
                clear_error(&mut state, "cleanup");
            }
            Err(_) => {
                failure(&mut state, "cleanup", now);
                backup_state::save_state(&runtime.paths.app_data, &state)?;
                return Err(err("cleanup_failed"));
            }
        }
        backup_state::save_state(&runtime.paths.app_data, &state)?;
    }
    Ok(())
}
pub async fn run_if_due(app: &AppHandle) -> Result<()> {
    if app.state::<BackupRuntime>().disabled_reason.is_some() {
        return Ok(());
    }
    execute(app, false).await
}
pub async fn run_now(app: &AppHandle) -> Result<BackupStatus> {
    execute(app, true).await?;
    read_status(app).await
}
pub async fn configure_remote(app: &AppHandle, owner_repo: &str) -> Result<BackupStatus> {
    let runtime = app.state::<BackupRuntime>();
    runtime.enabled()?;
    nimble_core::db::recovery::require_activation_clear(app.state::<SqlitePool>().inner()).await?;
    if runtime.test_mode {
        return Err(err("test_profile_upload_disabled"));
    }
    let _mutex = runtime.job.try_lock().map_err(|_| err("busy"))?;
    let _guard = backup::try_lock(&runtime.paths)?.ok_or_else(|| err("busy"))?;
    let mut state = backup_state::load_state(&runtime.paths.app_data)?;
    if state.remote.is_some() {
        return Err(err("already_configured"));
    }
    let root = dirs::home_dir()
        .ok_or_else(|| err("home_unavailable"))?
        .join("Nimble-backups");
    match backup_git::configure_remote(owner_repo, &root).await {
        Ok(remote) => {
            state.remote = Some(remote);
            clear_error(&mut state, "setup");
        }
        Err(error) => {
            failure(&mut state, "setup", Utc::now());
            state.stage_error.as_mut().unwrap().code = public_error_code(&error).into();
            backup_state::save_state(&runtime.paths.app_data, &state)?;
            return Err(error);
        }
    }
    state.pending_generation_id = state.generation_id.clone();
    state.next_publish_attempt_at = None;
    backup_state::save_state(&runtime.paths.app_data, &state)?;
    drop(_guard);
    drop(_mutex);
    read_status(app).await
}
pub async fn open_folder(app: &AppHandle) -> Result<()> {
    let runtime = app.state::<BackupRuntime>();
    runtime.enabled()?;
    let _guard = backup::try_lock(&runtime.paths)?.ok_or_else(|| err("busy"))?;
    let mut command = tokio::process::Command::new("/usr/bin/open");
    command.arg(&runtime.paths.generations).kill_on_drop(true);
    let status = tokio::time::timeout(std::time::Duration::from_secs(15), command.status())
        .await
        .map_err(|_| err("open_timeout"))??;
    if !status.success() {
        return Err(err("open_failed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, NaiveDate};
    fn time(s: &str) -> DateTime<chrono::FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap()
    }
    #[test]
    fn due_slot_catches_up_once_and_handles_clock_changes() {
        let early = time("2026-09-21T00:30:00-07:00");
        assert_eq!(due_slot(early, None), Some(early.date_naive()));
        assert_eq!(due_slot(early, Some(early.date_naive())), None);
        let older = NaiveDate::from_ymd_opt(2026, 9, 19).unwrap();
        assert_eq!(
            due_slot(early, Some(older)),
            NaiveDate::from_ymd_opt(2026, 9, 20)
        );
        assert_eq!(
            due_slot(time("2026-09-21T02:00:00-07:00"), Some(older)),
            Some(early.date_naive())
        );
        assert_eq!(
            due_slot(time("2026-09-20T03:00:00-07:00"), Some(early.date_naive())),
            None
        );
    }
    #[test]
    fn skipped_and_repeated_dst_hours_do_not_duplicate_jobs() {
        let before = time("2026-03-08T01:59:00-08:00");
        let last = NaiveDate::from_ymd_opt(2026, 3, 7).unwrap();
        assert_eq!(due_slot(before, Some(last)), None);
        let after = time("2026-03-08T03:00:00-07:00");
        assert_eq!(due_slot(after, Some(last)), Some(after.date_naive()));
        assert_eq!(due_slot(after, Some(after.date_naive())), None);
        let fall = NaiveDate::from_ymd_opt(2026, 11, 1).unwrap();
        for at in [
            "2026-11-01T01:30:00-07:00",
            "2026-11-01T01:30:00-08:00",
            "2026-11-01T02:00:00-08:00",
        ] {
            assert_eq!(due_slot(time(at), Some(fall)), None);
        }
    }
}

pub async fn verify_latest(app: &AppHandle) -> Result<()> {
    let runtime = app.state::<BackupRuntime>();
    runtime.enabled()?;
    let _mutex = runtime.job.try_lock().map_err(|_| err("busy"))?;
    let _guard = backup::try_lock(&runtime.paths)?.ok_or_else(|| err("busy"))?;
    runtime.running.store(true, Ordering::SeqCst);
    let _running = Running(&runtime.running);
    let state = backup_state::load_state(&runtime.paths.app_data)?;
    let id = state
        .generation_id
        .as_deref()
        .ok_or_else(|| err("no_verified_backup"))?;
    let saved = generation(&runtime.paths, id).await?;
    let root = std::fs::canonicalize(std::env::temp_dir())?
        .join(format!("nimble-verify-{}", uuid::Uuid::new_v4()));
    // This newly generated destination is never the live app-data path.
    let result = nimble_core::db::recovery::restore_snapshot(saved.directory(), &root).await;
    if root.exists() && !std::fs::symlink_metadata(&root)?.file_type().is_symlink() {
        // Remove only our own uniquely named verification directory after its DB pools close.
        std::fs::remove_dir_all(&root)?;
    }
    let report = result?;
    if !report.verified {
        return Err(err("verification_failed"));
    }
    Ok(())
}

#[cfg(test)]
mod orchestration_tests {
    use super::*;
    async fn fixture() -> (BackupRuntime, SqlitePool, PathBuf) {
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("nimble-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let db = root.join("nimble.db");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&db)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        nimble_core::db::migrations::run_migrations(&pool)
            .await
            .unwrap();
        (
            BackupRuntime::new(root.clone(), db, false, true),
            pool,
            root,
        )
    }
    fn at() -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339("2026-09-21T02:00:00-07:00").unwrap()
    }
    #[tokio::test]
    async fn offline_publish_does_not_flood_snapshots_or_cleanup() {
        let (runtime, pool, root) = fixture().await;
        let mut state = BackupState::default();
        state.remote = Some(crate::backup_state::RemoteConfig {
            owner_repo: "test/private".into(),
            repository_id: "synthetic".into(),
            root: root.join("unused-remote"),
        });
        backup_state::save_state(&root, &state).unwrap();
        assert!(execute_job(&runtime, &pool, false, at()).await.is_err());
        let failed = backup_state::load_state(&root).unwrap();
        assert!(failed.last_local_success_at.is_some());
        assert!(failed.last_push_at.is_none());
        assert!(failed.cleanup_generation_id.is_some());
        assert_eq!(failed.publish_failures, 1);
        execute_job(&runtime, &pool, false, at() + chrono::Duration::minutes(5))
            .await
            .unwrap();
        let later = backup_state::load_state(&root).unwrap();
        assert_eq!(later.generation_id, failed.generation_id);
        assert_eq!(later.publish_failures, 1);
        assert!(
            execute_job(&runtime, &pool, false, at() + chrono::Duration::minutes(15))
                .await
                .is_err()
        );
        assert_eq!(backup_state::load_state(&root).unwrap().publish_failures, 2);
        assert_eq!(
            backup::list_verified(&runtime.paths).await.unwrap().len(),
            1
        );
        pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn local_only_job_completes_and_disabled_runtime_does_nothing() {
        let (runtime, pool, root) = fixture().await;
        execute_job(&runtime, &pool, false, at()).await.unwrap();
        let state = backup_state::load_state(&root).unwrap();
        assert!(state.last_local_success_at.is_some());
        assert!(state.cleanup_generation_id.is_none());
        execute_job(&runtime, &pool, false, at() + chrono::Duration::minutes(5))
            .await
            .unwrap();
        assert_eq!(
            backup::list_verified(&runtime.paths).await.unwrap().len(),
            1
        );
        let disabled = BackupRuntime::new(root.clone(), root.join("nimble.db"), true, true);
        assert!(execute_job(&disabled, &pool, true, at()).await.is_err());
        assert_eq!(
            backup::list_verified(&runtime.paths).await.unwrap().len(),
            1
        );
        pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn corrupted_state_blocks_job_and_existing_lock_returns_busy() {
        let (runtime, pool, root) = fixture().await;
        let guard = backup::try_lock(&runtime.paths).unwrap().unwrap();
        assert!(execute_job(&runtime, &pool, true, at()).await.is_err());
        drop(guard);
        std::fs::write(root.join("backup-state.json"), b"bad-json").unwrap();
        assert!(execute_job(&runtime, &pool, true, at()).await.is_err());
        assert_eq!(
            backup::list_verified(&runtime.paths).await.unwrap().len(),
            0
        );
        assert!(!runtime.running.load(Ordering::SeqCst));
        pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod isolation_regressions {
    use super::*;
    #[test]
    fn profile_rejects_linked_database_before_opening_it() {
        use std::os::unix::fs::symlink;
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("nimble-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("synthetic-profile"), b"nimble-synthetic-only\n").unwrap();
        let unrelated = root.join("unrelated.db");
        std::fs::write(&unrelated, b"must stay unchanged").unwrap();
        symlink(&unrelated, root.join("nimble.db")).unwrap();
        assert!(validate_test_root(&root).is_err());
        std::fs::remove_file(root.join("nimble.db")).unwrap();
        std::fs::hard_link(&unrelated, root.join("nimble.db")).unwrap();
        assert!(validate_test_root(&root).is_err());
        assert_eq!(std::fs::read(unrelated).unwrap(), b"must stay unchanged");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn new_snapshot_preserves_pending_publish_error() {
        let root = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("nimble-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("nimble.db");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        nimble_core::db::migrations::run_migrations(&pool)
            .await
            .unwrap();
        let runtime = BackupRuntime::new(root.clone(), path, false, true);
        let now = DateTime::parse_from_rfc3339("2026-09-22T02:00:00-07:00").unwrap();
        let mut state = BackupState::default();
        state.remote = Some(crate::backup_state::RemoteConfig {
            owner_repo: "test/private".into(),
            repository_id: "test".into(),
            root: root.join("unused"),
        });
        state.last_local_slot = Some("2026-09-21".into());
        state.next_publish_attempt_at = Some((now + chrono::Duration::hours(2)).to_rfc3339());
        failure(&mut state, "publish", now.with_timezone(&Utc));
        backup_state::save_state(&root, &state).unwrap();
        execute_job(&runtime, &pool, false, now).await.unwrap();
        assert_eq!(
            backup_state::load_state(&root)
                .unwrap()
                .stage_error
                .unwrap()
                .stage,
            "publish"
        );
        pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
