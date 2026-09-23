use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqliteConnection, SqlitePool};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::{
    clock::{MonotonicClock, SystemClock},
    queue, replica, schema,
};
use crate::{
    db::{
        activity,
        task_tx::{self, MutationPolicy, TaskEffects},
    },
    focus_types::*,
    types::{CreateTaskInput, LocalTask, UpdateTaskInput},
};

fn err(code: &str, detail: &str) -> crate::Error {
    crate::Error::Other(format!("{code}: {detail}"))
}
fn is_storage_error(error: &crate::Error) -> bool {
    matches!(error, crate::Error::Database(_) | crate::Error::Io(_))
        || matches!(error,crate::Error::Other(message) if message.starts_with("storage: "))
}
/// Stable wire classification for Tauri and agent RPC wrappers.
pub fn focus_error(error: &crate::Error) -> FocusError {
    let raw = error.to_string();
    let (code, message) = match error {
        crate::Error::Database(_) | crate::Error::Io(_) => (FocusErrorCode::Storage, raw),
        crate::Error::Api(_) => (FocusErrorCode::Unsupported, raw),
        crate::Error::Parse(_) => (FocusErrorCode::Invalid, raw),
        crate::Error::Other(message) => {
            let mapped = message.split_once(": ");
            let code = match mapped.map(|(prefix, _)| prefix) {
                Some("conflict") => FocusErrorCode::Conflict,
                Some("wrong_owner") => FocusErrorCode::WrongOwner,
                Some("stale_occurrence") => FocusErrorCode::StaleOccurrence,
                Some("not_found") => FocusErrorCode::NotFound,
                Some("invalid") => FocusErrorCode::Invalid,
                Some("unsupported") => FocusErrorCode::Unsupported,
                Some("needs_review") => FocusErrorCode::NeedsReview,
                Some("storage") => FocusErrorCode::Storage,
                _ => FocusErrorCode::Invalid,
            };
            (
                code,
                mapped
                    .map(|(_, detail)| detail.to_string())
                    .unwrap_or_else(|| message.clone()),
            )
        }
    };
    FocusError { code, message }
}
fn now() -> String {
    Utc::now().to_rfc3339()
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn checked(v: u64, add: u64) -> crate::Result<u64> {
    v.checked_add(add)
        .filter(|n| *n <= MAX_SAFE_INTEGER)
        .ok_or_else(|| err("invalid", "focus duration exceeds safe integer range"))
}
fn i(v: u64) -> crate::Result<i64> {
    if v <= MAX_SAFE_INTEGER {
        Ok(v as i64)
    } else {
        Err(err("invalid", "unsafe focus integer"))
    }
}
fn u(v: i64) -> crate::Result<u64> {
    if v >= 0 && v as u64 <= MAX_SAFE_INTEGER {
        Ok(v as u64)
    } else {
        Err(err("storage", "invalid persisted focus integer"))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NativeTaskAction {
    Create {
        input: CreateTaskInput,
    },
    Update {
        id: String,
        input: UpdateTaskInput,
    },
    SetStatus {
        id: String,
        status: String,
        note: Option<String>,
        expected_due_date: Option<String>,
    },
    Delete {
        id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeTaskCommand {
    pub command_id: String,
    pub action: NativeTaskAction,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeTaskReply {
    pub task: Option<LocalTask>,
    pub snapshot: FocusSnapshot,
    pub replayed: bool,
    pub undo_token: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct UndoEntry {
    position: usize,
    entry: FocusEntry,
    previous_entry_id: Option<String>,
    next_entry_id: Option<String>,
}

struct Anchor {
    sampled_ms: u64,
    frozen: bool,
    process_generation: u64,
}
pub struct FocusService {
    pool: SqlitePool,
    device_id: String,
    clock: Arc<dyn MonotonicClock>,
    lock: Mutex<Anchor>,
}

/// A desktop-owned task write. The caller performs only local SQL while this
/// guard exists, then passes exact TaskEffects to commit. Network fetches must
/// finish before acquiring it. Dropping it rolls back without moving the clock.
pub struct FocusTaskWriteGuard<'a> {
    tx: Option<sqlx::Transaction<'a, sqlx::Sqlite>>,
    anchor: tokio::sync::MutexGuard<'a, Anchor>,
    sampled_ms: u64,
    committed: bool,
    /// Engine revision right after the clock settle; a higher revision at
    /// commit means the applied effects touched focused work.
    settled_revision: i64,
    /// The settle itself stopped the live session (gap pause).
    settle_transitioned: bool,
}
impl FocusTaskWriteGuard<'_> {
    pub fn connection(&mut self) -> &mut SqliteConnection {
        self.tx
            .as_mut()
            .expect("uncommitted focus task transaction")
    }
    pub async fn commit(mut self, effects: &TaskEffects) -> crate::Result<FocusSnapshot> {
        let tx = self
            .tx
            .as_mut()
            .expect("uncommitted focus task transaction");
        // Only remote applies (`TaskWrite`) use this guard.
        reconcile_task_effects_owned_tx(tx, effects, EffectOrigin::Remote).await?;
        let revision: i64 =
            sqlx::query_scalar("SELECT engine_revision FROM focus_runtime WHERE id=1")
                .fetch_one(&mut **tx)
                .await?;
        // A periodic pull that changed nothing focused only settled a running
        // clock: not a transition, so nothing is published.
        if self.settle_transitioned || revision > self.settled_revision {
            replica::publish_focus_replica_tx(tx).await?;
        }
        let snapshot = snapshot_tx(tx).await?;
        self.tx
            .take()
            .expect("uncommitted focus task transaction")
            .commit()
            .await?;
        self.anchor.sampled_ms = self.sampled_ms;
        self.committed = true;
        Ok(snapshot)
    }
}
impl Drop for FocusTaskWriteGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.anchor.frozen = true;
        }
    }
}

impl FocusService {
    pub fn new(pool: SqlitePool, device_id: String) -> Self {
        Self::with_clock(pool, device_id, Arc::new(SystemClock::default()))
    }
    pub fn with_clock(pool: SqlitePool, device_id: String, clock: Arc<dyn MonotonicClock>) -> Self {
        let sampled_ms = clock.elapsed_ms();
        Self {
            pool,
            device_id,
            clock,
            lock: Mutex::new(Anchor {
                sampled_ms,
                frozen: false,
                process_generation: 0,
            }),
        }
    }
    pub async fn initialize(&self) -> crate::Result<()> {
        let mut guard = self.lock.lock().await;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT owner_epoch FROM focus_runtime WHERE id=1")
                .fetch_optional(&mut *tx)
                .await?;
        let first_initialize = existing.is_none();
        let mut recovered = false;
        if first_initialize {
            let epoch = id();
            sqlx::query("INSERT INTO focus_queue_state(id,queue_id,writer_device_id,owner_epoch,revision,entries_json,updated_at) VALUES(1,?,?,?,0,'[]',?)")
                .bind(id()).bind(&self.device_id).bind(&epoch).bind(now()).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO focus_runtime(id,owner_epoch,process_generation,engine_revision) VALUES(1,?,1,0)")
                .bind(epoch).execute(&mut *tx).await?;
        } else {
            let writer: String =
                sqlx::query_scalar("SELECT writer_device_id FROM focus_queue_state WHERE id=1")
                    .fetch_one(&mut *tx)
                    .await?;
            if writer != self.device_id {
                return Err(err("wrong_owner", "another device owns this focus queue"));
            }
            // A persisted running marker is never trusted after process restart.
            let live: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *tx)
                    .await?;
            if let Some(sid) = live {
                recovered = true;
                sqlx::query("UPDATE focus_segments SET closed_at=checkpoint_at,close_reason='recovered' WHERE session_id=? AND closed_at IS NULL")
                    .bind(&sid).execute(&mut *tx).await?;
                sqlx::query("UPDATE focus_sessions SET status='paused',session_revision=session_revision+1 WHERE id=?")
                    .bind(&sid).execute(&mut *tx).await?;
                sqlx::query("UPDATE focus_runtime SET live_session_id=NULL,recovery_reason='recovered at last durable checkpoint',engine_revision=engine_revision+1 WHERE id=1")
                    .execute(&mut *tx).await?;
            }
            sqlx::query(
                "UPDATE focus_runtime SET process_generation=process_generation+1 WHERE id=1",
            )
            .execute(&mut *tx)
            .await?;
        }
        if first_initialize || recovered {
            replica::publish_focus_replica_tx(&mut tx).await?;
        }
        tx.commit().await?;
        guard.sampled_ms = self.clock.elapsed_ms();
        guard.frozen = false;
        guard.process_generation =
            sqlx::query_scalar::<_, i64>("SELECT process_generation FROM focus_runtime WHERE id=1")
                .fetch_one(&self.pool)
                .await? as u64;
        Ok(())
    }
    pub async fn snapshot(&self) -> crate::Result<FocusSnapshot> {
        let _guard = self.lock.lock().await;
        let mut conn = self.pool.acquire().await?;
        snapshot_tx(&mut conn).await
    }
    async fn recover_storage_failure(&self, guard: &mut Anchor) {
        guard.frozen = true;
        if let Ok(mut tx) = self.pool.begin_with("BEGIN IMMEDIATE").await {
            let result = async {
                ensure_process_tx(&mut tx, guard.process_generation).await?;
                pause_at_checkpoint_tx(
                    &mut tx,
                    "storage failure; paused at last durable checkpoint",
                )
                .await?;
                replica::publish_focus_replica_tx(&mut tx).await?;
                tx.commit().await?;
                Ok::<(), crate::Error>(())
            }
            .await;
            if result.is_ok() {
                guard.sampled_ms = self.clock.elapsed_ms();
                guard.frozen = false;
            }
        }
    }
    pub async fn begin_task_write(&self) -> crate::Result<FocusTaskWriteGuard<'_>> {
        let mut anchor = self.lock.lock().await;
        if anchor.frozen {
            self.recover_storage_failure(&mut anchor).await;
            return Err(err(
                "storage",
                "focus clock recovered at checkpoint; refresh before task write",
            ));
        }
        let sampled_ms = self.clock.elapsed_ms();
        let mut tx = match self.pool.begin_with("BEGIN IMMEDIATE").await {
            Ok(tx) => tx,
            Err(e) => {
                self.recover_storage_failure(&mut anchor).await;
                return Err(e.into());
            }
        };
        let result = async {
            ensure_process_tx(&mut tx, anchor.process_generation).await?;
            let live_before: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *tx)
                    .await?;
            settle_tx(
                &mut tx,
                sampled_ms.saturating_sub(anchor.sampled_ms),
                &now(),
            )
            .await?;
            let (live_after, revision): (Option<String>, i64) = sqlx::query_as(
                "SELECT live_session_id,engine_revision FROM focus_runtime WHERE id=1",
            )
            .fetch_one(&mut *tx)
            .await?;
            Ok::<_, crate::Error>((live_before != live_after, revision))
        }
        .await;
        let (settle_transitioned, settled_revision) = match result {
            Ok(v) => v,
            Err(e) => {
                drop(tx);
                if is_storage_error(&e) {
                    self.recover_storage_failure(&mut anchor).await;
                }
                return Err(e);
            }
        };
        Ok(FocusTaskWriteGuard {
            tx: Some(tx),
            anchor,
            sampled_ms,
            committed: false,
            settled_revision,
            settle_transitioned,
        })
    }
    pub async fn execute(&self, command: FocusCommand) -> crate::Result<FocusReply> {
        let mut guard = self.lock.lock().await;
        let result = self.execute_inner(&mut guard, command).await;
        if result.as_ref().err().is_some_and(is_storage_error) {
            self.recover_storage_failure(&mut guard).await;
        }
        result
    }
    async fn execute_inner(
        &self,
        guard: &mut Anchor,
        command: FocusCommand,
    ) -> crate::Result<FocusReply> {
        if command.command_id.is_empty() {
            return Err(err("invalid", "empty command id"));
        }
        let request = serde_json::to_vec(&command).map_err(|e| err("invalid", &e.to_string()))?;
        let hash = blake3::hash(&request).to_hex().to_string();
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        // Receipts precede all owner, generation and revision checks.
        let receipt: Option<(String, String)> = sqlx::query_as(
            "SELECT request_hash,result_json FROM focus_command_receipts WHERE command_id=?",
        )
        .bind(&command.command_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((stored_hash, result)) = receipt {
            if stored_hash != hash {
                return Err(err("invalid", "command id reused with different body"));
            }
            let old: FocusReply =
                serde_json::from_str(&result).map_err(|e| err("storage", &e.to_string()))?;
            let snap = snapshot_tx(&mut tx).await?;
            return Ok(FocusReply {
                snapshot: snap,
                replayed: true,
                committed_revision: old.committed_revision,
            });
        }
        if Uuid::parse_str(&command.command_id).is_err()
            || [
                command.expected_engine_revision,
                command.expected_queue_revision,
                command.process_generation,
            ]
            .iter()
            .any(|v| *v > MAX_SAFE_INTEGER)
        {
            return Err(err("invalid", "malformed command id or unsafe revision"));
        }
        if guard.frozen {
            return Err(err("storage", "focus clock frozen after storage failure"));
        }
        let before = snapshot_tx(&mut tx).await?;
        if before.process_generation != guard.process_generation {
            return Err(err("wrong_owner", "service process generation superseded"));
        }
        if command.owner_epoch != before.owner_epoch
            || command.process_generation != before.process_generation
        {
            return Err(err(
                "wrong_owner",
                "focus owner or process generation changed",
            ));
        }
        if command.expected_engine_revision != before.engine_revision
            || command.expected_queue_revision != before.queue_revision
        {
            return Err(err("conflict", "focus revision changed"));
        }
        if command.session_id != before.session.as_ref().map(|s| s.id.clone()) {
            return Err(err("conflict", "focus session changed"));
        }
        let sampled = self.clock.elapsed_ms();
        let delta = sampled.saturating_sub(guard.sampled_ms);
        let stamp = now();
        if let Err(e) = settle_tx(&mut tx, delta, &stamp).await {
            guard.frozen = true;
            return Err(e);
        }
        if delta > 40_000
            && before
                .session
                .as_ref()
                .is_some_and(|s| s.status == FocusStatus::Running)
        {
            replica::publish_focus_replica_tx(&mut tx).await?;
            tx.commit().await?;
            guard.sampled_ms = sampled;
            return Err(err(
                "needs_review",
                "suspension gap paused focus; refresh before a new action",
            ));
        }
        let mut entries = before.queue.clone();
        let mut selected = before.selected_occurrence_id.clone();
        let mut changed_queue = false;
        let result = apply_action_tx(
            &mut tx,
            &command.action,
            &mut entries,
            &mut selected,
            &mut changed_queue,
            &self.device_id,
            &before.owner_epoch,
            &stamp,
        )
        .await;
        if let Err(e) = result {
            if matches!(e, crate::Error::Database(_)) {
                guard.frozen = true;
            }
            return Err(e);
        }
        queue::validate(&entries, selected.as_deref())?;
        if changed_queue {
            save_queue_tx(&mut tx, &entries, selected.as_deref(), &stamp).await?;
        }
        sqlx::query("UPDATE focus_runtime SET engine_revision=engine_revision+1 WHERE id=1")
            .execute(&mut *tx)
            .await?;
        replica::publish_focus_replica_tx(&mut tx).await?;
        let snapshot = snapshot_tx(&mut tx).await?;
        let reply = FocusReply {
            committed_revision: snapshot.engine_revision,
            snapshot,
            replayed: false,
        };
        let affected_ids = affected_ids(&command.action, &before.queue, &reply.snapshot.queue);
        let receipt_write=sqlx::query("INSERT INTO focus_command_receipts(command_id,request_hash,result_json,committed_revision,affected_ids_json,committed_at) VALUES(?,?,?,?,?,?)")
            .bind(&command.command_id).bind(hash).bind(serde_json::to_string(&reply).map_err(|e| err("invalid", &e.to_string()))?)
            .bind(i(reply.committed_revision)?).bind(serde_json::to_string(&affected_ids).unwrap()).bind(&stamp).execute(&mut *tx).await;
        if let Err(e) = receipt_write {
            guard.frozen = true;
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            guard.frozen = true;
            return Err(e.into());
        }
        guard.sampled_ms = sampled;
        Ok(reply)
    }
    pub async fn checkpoint(
        &self,
        elapsed_ms: u64,
        wall_time: String,
    ) -> crate::Result<FocusSnapshot> {
        let mut guard = self.lock.lock().await;
        let result = self
            .checkpoint_inner(&mut guard, elapsed_ms, wall_time, None)
            .await;
        if result.as_ref().err().is_some_and(is_storage_error) {
            self.recover_storage_failure(&mut guard).await;
        }
        result
    }
    /// The production 20-second heartbeat. Samples this service's own
    /// monotonic (sleep-inclusive) clock under the lock, so the credited
    /// delta is exactly the time since the last settle by ANY path (command,
    /// task write, checkpoint) — never double-counted with a command that ran
    /// between ticks. A delta over 40 s (sleep without a notice, a stalled
    /// process) pauses at the last durable checkpoint instead of crediting.
    pub async fn heartbeat(&self) -> crate::Result<FocusSnapshot> {
        let mut guard = self.lock.lock().await;
        let sampled = self.clock.elapsed_ms();
        let delta = sampled.saturating_sub(guard.sampled_ms);
        let result = self
            .checkpoint_inner(&mut guard, delta, now(), Some(sampled))
            .await;
        if result.as_ref().err().is_some_and(is_storage_error) {
            self.recover_storage_failure(&mut guard).await;
        }
        result
    }
    /// Milliseconds until the running segment reaches its next boundary
    /// (timebox zero, Pomodoro round end, break end), net of time already
    /// elapsed since the last settle; `None` when nothing live has one. The
    /// owner's heartbeat wakes at min(20 s, this) so a crossing is settled,
    /// persisted and chimed on time instead of up to one heartbeat late.
    pub async fn ms_until_boundary(&self) -> crate::Result<Option<u64>> {
        let guard = self.lock.lock().await;
        let pending = self.clock.elapsed_ms().saturating_sub(guard.sampled_ms);
        let mut conn = self.pool.acquire().await?;
        let live: Option<String> =
            sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                .fetch_optional(&mut *conn)
                .await?
                .flatten();
        let Some(sid) = live else { return Ok(None) };
        let row = sqlx::query(
            "SELECT phase,round_work_ms,round_break_ms,config_json,occurrence_id FROM focus_sessions WHERE id=?",
        )
        .bind(&sid)
        .fetch_one(&mut *conn)
        .await?;
        let config: FocusConfig = serde_json::from_str(row.get("config_json"))
            .map_err(|e| err("storage", &e.to_string()))?;
        let phase: String = row.get("phase");
        let oid: String = row.get("occurrence_id");
        let prior = checked(
            recorded_total_tx(&mut conn, &oid).await?,
            imported_total_tx(&mut conn, &oid).await?,
        )?;
        Ok(boundary_remaining_ms(
            &config,
            &phase,
            prior,
            u(row.get("round_work_ms"))?,
            u(row.get("round_break_ms"))?,
        )
        .map(|remaining| remaining.saturating_sub(pending)))
    }
    /// Take the pending sound token, if any. The claim is a durable
    /// compare-and-swap (clear only if still equal to the token read), so
    /// exactly one caller wins a given token even when several race; it is
    /// committed BEFORE any native sound request and two windows/subscribers
    /// can never both play it. Losing the sound after a claim (mute, audio
    /// failure, crash) never touches accounting.
    pub async fn claim_sound(&self) -> crate::Result<Option<String>> {
        let pending: Option<String> =
            sqlx::query_scalar("SELECT sound_token FROM focus_runtime WHERE id=1")
                .fetch_optional(&self.pool)
                .await?
                .flatten();
        let Some(token) = pending else { return Ok(None) };
        let won = sqlx::query("UPDATE focus_runtime SET sound_token=NULL WHERE id=1 AND sound_token=?")
            .bind(&token)
            .execute(&self.pool)
            .await?
            .rows_affected()
            == 1;
        Ok(won.then_some(token))
    }
    async fn checkpoint_inner(
        &self,
        guard: &mut Anchor,
        elapsed_ms: u64,
        wall_time: String,
        anchor_after: Option<u64>,
    ) -> crate::Result<FocusSnapshot> {
        if guard.frozen {
            self.recover_storage_failure(guard).await;
            if guard.frozen {
                return Err(err("storage", "focus recovery persistence unavailable"));
            }
            let mut conn = self.pool.acquire().await?;
            return snapshot_tx(&mut conn).await;
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        ensure_process_tx(&mut tx, guard.process_generation).await?;
        let live_before: Option<String> =
            sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                .fetch_one(&mut *tx)
                .await?;
        if let Err(e) = settle_tx(&mut tx, elapsed_ms, &wall_time).await {
            guard.frozen = true;
            return Err(e);
        }
        let live_after: Option<String> =
            sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                .fetch_one(&mut *tx)
                .await?;
        // A plain running checkpoint is not a state transition: it stays
        // local (the next transition publishes the settled totals). Only a
        // settle that stopped the live session (Pomodoro boundary, gap
        // pause) publishes, so remote readers stop seeing it as live.
        if live_before != live_after {
            replica::publish_focus_replica_tx(&mut tx).await?;
        }
        let snap = snapshot_tx(&mut tx).await?;
        if let Err(e) = tx.commit().await {
            guard.frozen = true;
            return Err(e.into());
        }
        guard.sampled_ms = anchor_after.unwrap_or_else(|| self.clock.elapsed_ms());
        guard.frozen = false;
        Ok(snap)
    }
    pub async fn interrupt(&self, reason: &str) -> crate::Result<FocusSnapshot> {
        let mut guard = self.lock.lock().await;
        let result = self.interrupt_inner(&mut guard, reason).await;
        if result.as_ref().err().is_some_and(is_storage_error) {
            self.recover_storage_failure(&mut guard).await;
        }
        result
    }
    async fn interrupt_inner(
        &self,
        guard: &mut Anchor,
        reason: &str,
    ) -> crate::Result<FocusSnapshot> {
        if guard.frozen {
            self.recover_storage_failure(guard).await;
            if guard.frozen {
                return Err(err("storage", "focus recovery persistence unavailable"));
            }
            let mut conn = self.pool.acquire().await?;
            return snapshot_tx(&mut conn).await;
        }
        let sampled = self.clock.elapsed_ms();
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        ensure_process_tx(&mut tx, guard.process_generation).await?;
        // Nothing live: nothing to settle, and no recovery notice for a
        // window close/quit/sleep that interrupted no timing.
        let live: Option<String> =
            sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                .fetch_one(&mut *tx)
                .await?;
        if live.is_none() {
            return snapshot_tx(&mut tx).await;
        }
        settle_tx(&mut tx, sampled.saturating_sub(guard.sampled_ms), &now()).await?;
        pause_live_tx(&mut tx, reason, &now()).await?;
        sqlx::query("UPDATE focus_runtime SET recovery_reason=?,engine_revision=engine_revision+1 WHERE id=1")
            .bind(reason).execute(&mut *tx).await?;
        replica::publish_focus_replica_tx(&mut tx).await?;
        let snap = snapshot_tx(&mut tx).await?;
        tx.commit().await?;
        guard.sampled_ms = sampled;
        Ok(snap)
    }
    pub async fn history(
        &self,
        cursor: Option<String>,
        task_id: Option<String>,
    ) -> crate::Result<FocusHistoryPage> {
        let _guard = self.lock.lock().await;
        let mut conn = self.pool.acquire().await?;
        let cursor_date: Option<String> = if let Some(ref id) = cursor {
            Some(
                sqlx::query_scalar(
                    "SELECT COALESCE(completed_at,created_at) FROM focus_occurrences WHERE id=?",
                )
                .bind(id)
                .fetch_optional(&mut *conn)
                .await?
                .ok_or_else(|| err("invalid", "history cursor missing"))?,
            )
        } else {
            None
        };
        let rows = sqlx::query("SELECT id,task_id,title_snapshot,completed_at,archived FROM focus_occurrences WHERE (? IS NULL OR original_task_id=?) AND (? IS NULL OR COALESCE(completed_at,created_at)<? OR (COALESCE(completed_at,created_at)=? AND id<?)) ORDER BY COALESCE(completed_at,created_at) DESC,id DESC LIMIT 51")
            .bind(&task_id).bind(&task_id).bind(&cursor).bind(&cursor_date).bind(&cursor_date).bind(&cursor).fetch_all(&mut *conn).await?;
        let next_cursor = if rows.len() > 50 {
            Some(rows[49].get::<String, _>("id"))
        } else {
            None
        };
        let mut out = Vec::new();
        for row in rows.into_iter().take(50) {
            let oid: String = row.get("id");
            let recorded = recorded_total_tx(&mut conn, &oid).await?;
            let imported = imported_total_tx(&mut conn, &oid).await?;
            out.push(FocusHistoryRow {
                occurrence_id: oid,
                task_id: row.get("task_id"),
                title: row.get("title_snapshot"),
                total_ms: checked(recorded, imported)?,
                recorded_ms: recorded,
                imported_ms: imported,
                completed_at: row.get("completed_at"),
                archived: row.get::<i64, _>("archived") != 0,
            });
        }
        Ok(FocusHistoryPage {
            rows: out,
            next_cursor,
        })
    }
    /// Commit a previewed frozen-file import under the service lock, so no
    /// command or checkpoint interleaves. The import itself refuses while a
    /// session is running, so there is no live clock to settle here.
    pub async fn commit_import(
        &self,
        files: &LegacyFocusFiles,
        preview_token: &str,
        command_id: &str,
    ) -> crate::Result<(FocusImportResult, FocusSnapshot)> {
        let guard = self.lock.lock().await;
        if guard.frozen {
            return Err(err("storage", "focus clock frozen after storage failure"));
        }
        let result = super::import::commit_import(&self.pool, files, preview_token, command_id).await?;
        let mut conn = self.pool.acquire().await?;
        Ok((result, snapshot_tx(&mut conn).await?))
    }
    /// Desktop/agent/CLI RPC task writes use this method while the app owns the clock.
    /// The command ID is durable for uncertain-response retries.
    pub async fn execute_native_task(
        &self,
        command: NativeTaskCommand,
    ) -> crate::Result<NativeTaskReply> {
        let mut guard = self.lock.lock().await;
        let result = self.execute_native_task_inner(&mut guard, command).await;
        if result.as_ref().err().is_some_and(is_storage_error) {
            self.recover_storage_failure(&mut guard).await;
        }
        result
    }
    async fn execute_native_task_inner(
        &self,
        guard: &mut Anchor,
        command: NativeTaskCommand,
    ) -> crate::Result<NativeTaskReply> {
        let request = serde_json::to_vec(&command).map_err(|e| err("invalid", &e.to_string()))?;
        let hash = blake3::hash(&request).to_hex().to_string();
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let receipt: Option<(String, String)> = sqlx::query_as(
            "SELECT request_hash,result_json FROM focus_command_receipts WHERE command_id=?",
        )
        .bind(&command.command_id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((old_hash, result)) = receipt {
            if old_hash != hash {
                return Err(err("invalid", "command id reused with different body"));
            }
            let mut reply: NativeTaskReply =
                serde_json::from_str(&result).map_err(|e| err("storage", &e.to_string()))?;
            reply.snapshot = snapshot_tx(&mut tx).await?;
            reply.replayed = true;
            return Ok(reply);
        }
        if Uuid::parse_str(&command.command_id).is_err() {
            return Err(err("invalid", "malformed native task command id"));
        }
        if guard.frozen {
            return Err(err("storage", "focus clock frozen after storage failure"));
        }
        ensure_process_tx(&mut tx, guard.process_generation).await?;
        let sampled = self.clock.elapsed_ms();
        settle_tx(&mut tx, sampled.saturating_sub(guard.sampled_ms), &now()).await?;
        let action_for_log = command.action.clone();
        // Same activity detail as the pool CRUD path (fields_changed / task_moved).
        let mut update_fields: Vec<&'static str> = Vec::new();
        let (task, effects) = match command.action {
            NativeTaskAction::Create { input } => (
                Some(task_tx::create_task_tx(&mut tx, input, MutationPolicy::User).await?),
                TaskEffects::default(),
            ),
            NativeTaskAction::Update { id, input } => {
                let old: Option<LocalTask> = sqlx::query_as(&format!(
                    "SELECT {} FROM local_tasks WHERE id=?",
                    crate::db::tasks::SELECT_COLS
                ))
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
                if let Some(old) = &old {
                    update_fields = crate::db::tasks::activity_fields(&input, old);
                }
                let task =
                    task_tx::update_task_tx(&mut tx, &id, input, MutationPolicy::User).await?;
                let rescheduled = if old.as_ref().is_some_and(|o| o.due_date != task.due_date) {
                    vec![task.id.clone()]
                } else {
                    Vec::new()
                };
                let effects = TaskEffects {
                    changed: vec![task.clone()],
                    rescheduled,
                    ..Default::default()
                };
                (Some(task), effects)
            }
            NativeTaskAction::SetStatus {
                id,
                status,
                note: _,
                expected_due_date,
            } => {
                task_tx::ensure_expected_due_tx(&mut tx, &id, &status, expected_due_date.as_deref())
                    .await?;
                let effects = task_tx::set_status_tx(
                    &mut tx,
                    &id,
                    &status,
                    chrono::Local::now().date_naive(),
                    MutationPolicy::User,
                )
                .await?;
                (effects.changed.first().cloned(), effects)
            }
            NativeTaskAction::Delete { id } => (
                None,
                task_tx::delete_task_tx(&mut tx, &id, MutationPolicy::User).await?,
            ),
        };
        let undo_token = if !effects.deleted.is_empty() {
            Some(capture_undo_tx(&mut tx, &effects).await?)
        } else {
            None
        };
        reconcile_task_effects_owned_tx(&mut tx, &effects, EffectOrigin::Local).await?;
        replica::publish_focus_replica_tx(&mut tx).await?;
        let snapshot = snapshot_tx(&mut tx).await?;
        let reply = NativeTaskReply {
            task,
            snapshot,
            replayed: false,
            undo_token,
        };
        let affected_ids: Vec<String> = effects
            .changed
            .iter()
            .chain(effects.deleted.iter())
            .map(|t| t.id.clone())
            .collect();
        let receipt_write=sqlx::query("INSERT INTO focus_command_receipts(command_id,request_hash,result_json,committed_revision,affected_ids_json,committed_at) VALUES(?,?,?,?,?,?)")
            .bind(&command.command_id).bind(hash).bind(serde_json::to_string(&reply).map_err(|e| err("invalid",&e.to_string()))?)
            .bind(i(reply.snapshot.engine_revision)?).bind(serde_json::to_string(&affected_ids).unwrap()).bind(now()).execute(&mut *tx).await;
        if let Err(e) = receipt_write {
            guard.frozen = true;
            return Err(e.into());
        }
        if let Err(e) = tx.commit().await {
            guard.frozen = true;
            return Err(e.into());
        }
        guard.sampled_ms = sampled;
        match action_for_log {
            NativeTaskAction::Create { .. } => {
                if let Some(task) = &reply.task {
                    activity::log_activity(&self.pool,"task_created",Some(&task.id),Some(serde_json::json!({"content":task.content,"project_id":task.project_id}))).await;
                }
            }
            NativeTaskAction::Update { id, .. } => {
                if !update_fields.is_empty() {
                    let action = if update_fields == ["project_id"] { "task_moved" } else { "task_updated" };
                    activity::log_activity(&self.pool, action, Some(&id),
                        Some(serde_json::json!({"fields_changed": update_fields}))).await
                }
            }
            NativeTaskAction::SetStatus {
                id, status, note, ..
            } => {
                if let Some(recurrence) = &effects.recurrence {
                    activity::log_activity(&self.pool,"task_recurred",Some(&id),Some(serde_json::json!({"from":recurrence.before_due,"to":recurrence.after_due}))).await;
                } else if !effects.changed.is_empty() {
                    activity::log_activity(&self.pool,"status_changed",Some(&id),Some(serde_json::json!({"old_status":effects.previous_status,"new_status":status,"note":note}))).await;
                }
            }
            NativeTaskAction::Delete { id } => {
                activity::log_activity(&self.pool, "task_deleted", Some(&id), None).await
            }
        }
        Ok(reply)
    }
}

async fn ensure_process_tx(conn: &mut SqliteConnection, expected: u64) -> crate::Result<()> {
    let current: i64 =
        sqlx::query_scalar("SELECT process_generation FROM focus_runtime WHERE id=1")
            .fetch_one(&mut *conn)
            .await?;
    if u(current)? != expected {
        Err(err("wrong_owner", "service process generation superseded"))
    } else {
        Ok(())
    }
}

fn affected_ids(action: &FocusAction, before: &[FocusEntry], after: &[FocusEntry]) -> Vec<String> {
    match action {
        FocusAction::Enqueue { .. } => after
            .iter()
            .filter(|e| !before.iter().any(|b| b.occurrence_id == e.occurrence_id))
            .map(|e| e.occurrence_id.clone())
            .collect(),
        FocusAction::Reorder { entry_ids } => entry_ids.clone(),
        FocusAction::Promote { occurrence_id }
        | FocusAction::Remove { occurrence_id }
        | FocusAction::Start { occurrence_id }
        | FocusAction::Complete { occurrence_id }
        | FocusAction::Configure { occurrence_id, .. } => vec![occurrence_id.clone()],
        FocusAction::ArchiveHistory { occurrence_ids } => occurrence_ids.clone(),
        _ => Vec::new(),
    }
}

async fn snapshot_tx(conn: &mut SqliteConnection) -> crate::Result<FocusSnapshot> {
    let q=sqlx::query("SELECT writer_device_id,owner_epoch,revision,entries_json,selected_occurrence_id FROM focus_queue_state WHERE id=1").fetch_one(&mut *conn).await?;
    let entries: Vec<FocusEntry> =
        serde_json::from_str(q.get("entries_json")).map_err(|e| err("storage", &e.to_string()))?;
    let selected: Option<String> = q.get("selected_occurrence_id");
    queue::validate(&entries, selected.as_deref())?;
    let r=sqlx::query("SELECT process_generation,engine_revision,checkpoint_at,recovery_reason,live_session_id FROM focus_runtime WHERE id=1").fetch_one(&mut *conn).await?;
    let live: Option<String> = r.get("live_session_id");
    if let Some(sid) = live {
        let occurrence: Option<String> = sqlx::query_scalar(
            "SELECT occurrence_id FROM focus_sessions WHERE id=? AND status='running'",
        )
        .bind(sid)
        .fetch_optional(&mut *conn)
        .await?;
        if occurrence.as_ref() != selected.as_ref() {
            return Err(err(
                "storage",
                "live session and selected queue entry disagree",
            ));
        }
    }
    let mut totals = HashMap::new();
    for entry in &entries {
        totals.insert(
            entry.occurrence_id.clone(),
            checked(
                recorded_total_tx(conn, &entry.occurrence_id).await?,
                imported_total_tx(conn, &entry.occurrence_id).await?,
            )?,
        );
    }
    let session = if let Some(ref oid) = selected {
        read_session_tx(conn, oid).await?
    } else {
        None
    };
    Ok(FocusSnapshot {
        queue_revision: u(q.get("revision"))?,
        engine_revision: u(r.get("engine_revision"))?,
        owner_epoch: q.get("owner_epoch"),
        process_generation: u(r.get("process_generation"))?,
        writer_device_id: q.get("writer_device_id"),
        queue: entries,
        selected_occurrence_id: selected,
        session,
        totals,
        as_of: now(),
        checkpoint_at: r.get("checkpoint_at"),
        recovery_reason: r.get("recovery_reason"),
        replica: false,
    })
}

async fn recorded_total_tx(conn: &mut SqliteConnection, oid: &str) -> crate::Result<u64> {
    let values: Vec<i64> =
        sqlx::query_scalar("SELECT work_ms FROM focus_sessions WHERE occurrence_id=?")
            .bind(oid)
            .fetch_all(&mut *conn)
            .await?;
    values
        .into_iter()
        .try_fold(0u64, |sum, v| checked(sum, u(v)?))
}
async fn imported_total_tx(conn: &mut SqliteConnection, oid: &str) -> crate::Result<u64> {
    let values:Vec<i64>=sqlx::query_scalar("SELECT duration_ms FROM focus_import_totals WHERE occurrence_id=? AND inclusion='included'").bind(oid).fetch_all(&mut *conn).await?;
    values
        .into_iter()
        .try_fold(0u64, |sum, v| checked(sum, u(v)?))
}
async fn read_session_tx(
    conn: &mut SqliteConnection,
    oid: &str,
) -> crate::Result<Option<FocusSession>> {
    let row=sqlx::query("SELECT id,status,phase,work_ms,break_ms,round_work_ms,round,config_json FROM focus_sessions WHERE occurrence_id=? AND status!='ended' ORDER BY rowid DESC LIMIT 1")
        .bind(oid).fetch_optional(&mut *conn).await?;
    row.map(|r| {
        Ok(FocusSession {
            id: r.get("id"),
            occurrence_id: oid.into(),
            status: serde_json::from_value(serde_json::Value::String(r.get("status")))
                .map_err(|e| err("storage", &e.to_string()))?,
            phase: serde_json::from_value(serde_json::Value::String(r.get("phase")))
                .map_err(|e| err("storage", &e.to_string()))?,
            work_ms: u(r.get("work_ms"))?,
            break_ms: u(r.get("break_ms"))?,
            round_work_ms: u(r.get("round_work_ms"))?,
            round: u(r.get("round"))? as u32,
            config: serde_json::from_str(r.get("config_json"))
                .map_err(|e| err("storage", &e.to_string()))?,
        })
    })
    .transpose()
}
async fn save_queue_tx(
    conn: &mut SqliteConnection,
    entries: &[FocusEntry],
    selected: Option<&str>,
    stamp: &str,
) -> crate::Result<()> {
    queue::validate(entries, selected)?;
    sqlx::query("UPDATE focus_queue_state SET entries_json=?,selected_occurrence_id=?,revision=revision+1,updated_at=? WHERE id=1")
        .bind(serde_json::to_string(entries).map_err(|e|err("invalid",&e.to_string()))?).bind(selected).bind(stamp).execute(&mut *conn).await?;
    Ok(())
}

/// Settled milliseconds left before the running phase's next boundary.
/// Timebox: until the budget (none once in overtime: zero chimes once).
/// Pomodoro: until the round's work target or the break's length.
/// Count-up has no boundary.
pub fn boundary_remaining_ms(
    config: &FocusConfig,
    phase: &str,
    prior_total_ms: u64,
    round_work_ms: u64,
    round_break_ms: u64,
) -> Option<u64> {
    match (config.mode, phase) {
        (FocusMode::Timebox, "work") => config
            .budget_ms
            .filter(|budget| prior_total_ms < *budget)
            .map(|budget| budget - prior_total_ms),
        (FocusMode::Pomodoro, "work") => Some(config.work_ms.saturating_sub(round_work_ms)),
        (FocusMode::Pomodoro, "break") => Some(config.break_ms.saturating_sub(round_break_ms)),
        _ => None,
    }
}

async fn settle_tx(conn: &mut SqliteConnection, delta: u64, stamp: &str) -> crate::Result<()> {
    let live: Option<String> =
        sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
            .fetch_one(&mut *conn)
            .await?;
    let Some(sid) = live else { return Ok(()) };
    if delta > 40_000 {
        pause_live_tx(conn, "suspension_gap", stamp).await?;
        sqlx::query("UPDATE focus_runtime SET recovery_reason='gap exceeded 40 seconds; paused at checkpoint',engine_revision=engine_revision+1 WHERE id=1").execute(&mut *conn).await?;
        return Ok(());
    }
    let row=sqlx::query("SELECT phase,work_ms,break_ms,round_break_ms,round_work_ms,round,config_json,occurrence_id FROM focus_sessions WHERE id=?")
        .bind(&sid).fetch_one(&mut *conn).await?;
    let phase: String = row.get("phase");
    let config: FocusConfig =
        serde_json::from_str(row.get("config_json")).map_err(|e| err("storage", &e.to_string()))?;
    let current_work = u(row.get("work_ms"))?;
    let current_break = u(row.get("break_ms"))?;
    let round_break = u(row.get("round_break_ms"))?;
    let round_work = u(row.get("round_work_ms"))?;
    let actual = if phase == "work" && config.mode == FocusMode::Pomodoro {
        delta.min(config.work_ms.saturating_sub(round_work))
    } else if phase == "break" && config.mode == FocusMode::Pomodoro {
        delta.min(config.break_ms.saturating_sub(round_break))
    } else {
        delta
    };
    if phase == "work" {
        let oid: String = row.get("occurrence_id");
        let imported = imported_total_tx(conn, &oid).await?;
        let recorded = recorded_total_tx(conn, &oid).await?;
        let prior = checked(recorded, imported)?;
        let after = checked(prior, actual)?;
        if config.mode == FocusMode::Timebox
            && config
                .budget_ms
                .is_some_and(|budget| prior < budget && after >= budget)
        {
            sqlx::query("UPDATE focus_runtime SET boundary_token=?,sound_token=? WHERE id=1")
                .bind(format!("{oid}:timebox"))
                .bind(format!("chime:{}", id()))
                .execute(&mut *conn)
                .await?;
        }
        sqlx::query("UPDATE focus_sessions SET work_ms=?,round_work_ms=?,checkpoint_at=?,session_revision=session_revision+1 WHERE id=?")
            .bind(i(checked(current_work,actual)?)?).bind(i(checked(round_work,actual)?)?).bind(stamp).bind(&sid).execute(&mut *conn).await?;
    } else if phase == "break" {
        sqlx::query("UPDATE focus_sessions SET break_ms=?,round_break_ms=?,checkpoint_at=?,session_revision=session_revision+1 WHERE id=?")
            .bind(i(checked(current_break,actual)?)?).bind(i(checked(round_break,actual)?)?).bind(stamp).bind(&sid).execute(&mut *conn).await?;
    }
    sqlx::query("UPDATE focus_segments SET duration_ms=duration_ms+?,checkpoint_at=? WHERE session_id=? AND closed_at IS NULL")
        .bind(i(actual)?).bind(stamp).bind(&sid).execute(&mut *conn).await?;
    sqlx::query("UPDATE focus_runtime SET checkpoint_at=?,heartbeat_sequence=heartbeat_sequence+1,engine_revision=engine_revision+1 WHERE id=1")
        .bind(stamp).execute(&mut *conn).await?;
    let boundary = (phase == "work"
        && config.mode == FocusMode::Pomodoro
        && round_work + actual >= config.work_ms)
        || (phase == "break"
            && config.mode == FocusMode::Pomodoro
            && round_break + actual >= config.break_ms);
    if boundary {
        pause_live_tx(conn, "boundary", stamp).await?;
        let next = if phase == "work" {
            "round_ready"
        } else {
            "work_ready"
        };
        sqlx::query("UPDATE focus_sessions SET phase=? WHERE id=?")
            .bind(next)
            .bind(&sid)
            .execute(&mut *conn)
            .await?;
        if phase == "break" {
            sqlx::query(
                "UPDATE focus_sessions SET round=round+1,round_work_ms=0 WHERE id=? AND round<?",
            )
            .bind(&sid)
            .bind(config.rounds)
            .execute(&mut *conn)
            .await?;
        }
        // Signal the round/break boundary once, like the timebox chime.
        sqlx::query("UPDATE focus_runtime SET boundary_token=?,sound_token=? WHERE id=1")
            .bind(id())
            .bind(format!("chime:{}", id()))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}
async fn pause_live_tx(
    conn: &mut SqliteConnection,
    reason: &str,
    stamp: &str,
) -> crate::Result<()> {
    let live: Option<String> =
        sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
            .fetch_one(&mut *conn)
            .await?;
    if let Some(sid) = live {
        sqlx::query("UPDATE focus_segments SET closed_at=?,close_reason=? WHERE session_id=? AND closed_at IS NULL")
            .bind(stamp).bind(reason).bind(&sid).execute(&mut *conn).await?;
        sqlx::query("UPDATE focus_sessions SET status='paused',session_revision=session_revision+1 WHERE id=?")
            .bind(&sid).execute(&mut *conn).await?;
        sqlx::query("UPDATE focus_runtime SET live_session_id=NULL WHERE id=1")
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn pause_at_checkpoint_tx(conn: &mut SqliteConnection, reason: &str) -> crate::Result<()> {
    let live: Option<String> =
        sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
            .fetch_one(&mut *conn)
            .await?;
    if let Some(sid) = live {
        sqlx::query("UPDATE focus_segments SET closed_at=checkpoint_at,close_reason=? WHERE session_id=? AND closed_at IS NULL")
            .bind(reason).bind(&sid).execute(&mut *conn).await?;
        sqlx::query("UPDATE focus_sessions SET status='paused',session_revision=session_revision+1 WHERE id=?")
            .bind(&sid).execute(&mut *conn).await?;
        sqlx::query("UPDATE focus_runtime SET live_session_id=NULL,recovery_reason=?,engine_revision=engine_revision+1 WHERE id=1")
            .bind(reason).execute(&mut *conn).await?;
    }
    Ok(())
}
async fn open_segment_tx(
    conn: &mut SqliteConnection,
    sid: &str,
    phase: &str,
    stamp: &str,
) -> crate::Result<()> {
    sqlx::query(
        "INSERT INTO focus_segments(id,session_id,kind,started_at,checkpoint_at) VALUES(?,?,?,?,?)",
    )
    .bind(id())
    .bind(sid)
    .bind(phase)
    .bind(stamp)
    .bind(stamp)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE focus_sessions SET status='running',session_revision=session_revision+1 WHERE id=?",
    )
    .bind(sid)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE focus_runtime SET live_session_id=?,checkpoint_at=?,recovery_reason=NULL WHERE id=1")
        .bind(sid).bind(stamp).execute(&mut *conn).await?;
    Ok(())
}

async fn apply_action_tx(
    conn: &mut SqliteConnection,
    action: &FocusAction,
    entries: &mut Vec<FocusEntry>,
    selected: &mut Option<String>,
    changed: &mut bool,
    device: &str,
    epoch: &str,
    stamp: &str,
) -> crate::Result<()> {
    match action {
        FocusAction::Enqueue {
            task_ids,
            source,
            explicit_still_open,
        } => {
            let mut seen = HashSet::new();
            for task_id in task_ids {
                if !seen.insert(task_id) {
                    continue;
                }
                if entries.iter().any(|e| &e.task_id == task_id) {
                    continue;
                }
                let task: Option<(String, String, String, i64, Option<String>)> = sqlx::query_as(
                    "SELECT content,project_id,status,completed,due_date FROM local_tasks WHERE id=?",
                )
                .bind(task_id)
                .fetch_optional(&mut *conn)
                .await?;
                let Some((title, project, status, completed, due)) = task else {
                    return Err(err("not_found", "task missing"));
                };
                if (completed != 0 || status == "complete") && !explicit_still_open {
                    return Err(err(
                        "stale_occurrence",
                        "completed task requires explicit still-open choice",
                    ));
                }
                let generation:i64=sqlx::query_scalar("SELECT COALESCE(MAX(generation),0)+1 FROM focus_occurrences WHERE original_task_id=?").bind(task_id).fetch_one(&mut *conn).await?;
                let oid = id();
                // The due date seen at enqueue is this occurrence's scheduling
                // identity; Complete must still find it (see Complete).
                sqlx::query("INSERT INTO focus_occurrences(id,task_id,original_task_id,title_snapshot,project_snapshot,scheduling_identity,generation,state,created_at) VALUES(?,?,?,?,?,?,?,'open',?)")
                    .bind(&oid).bind(task_id).bind(task_id).bind(title).bind(project).bind(due).bind(generation).bind(stamp).execute(&mut *conn).await?;
                entries.push(FocusEntry {
                    id: id(),
                    task_id: task_id.clone(),
                    occurrence_id: oid,
                    added_at: stamp.into(),
                    source: source.clone(),
                    explicit_still_open: *explicit_still_open,
                    config: FocusConfig {
                        mode: FocusMode::CountUp,
                        budget_ms: None,
                        work_ms: 1_500_000,
                        break_ms: 300_000,
                        rounds: 4,
                    },
                });
                *changed = true;
            }
            if selected.is_none() && !entries.is_empty() {
                *selected = Some(entries[0].occurrence_id.clone());
                *changed = true;
            }
        }
        FocusAction::Reorder { entry_ids } => {
            let current: HashSet<&str> = entries.iter().map(|e| e.id.as_str()).collect();
            let incoming: HashSet<&str> = entry_ids.iter().map(String::as_str).collect();
            if entry_ids.len() != entries.len() || incoming != current {
                return Err(err(
                    "conflict",
                    "reorder must contain complete current entry set",
                ));
            }
            entries.sort_by_key(|e| entry_ids.iter().position(|v| v == &e.id).unwrap());
            *changed = true;
            let live: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *conn)
                    .await?;
            let first = entries.first().map(|e| e.occurrence_id.clone());
            if live.is_some() && *selected != first {
                pause_live_tx(conn, "reordered", stamp).await?;
            }
            *selected = first;
        }
        FocusAction::Promote { occurrence_id } => {
            if !entries.iter().any(|e| &e.occurrence_id == occurrence_id) {
                return Err(err("stale_occurrence", "not queued"));
            }
            let live: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *conn)
                    .await?;
            if live.is_some() {
                pause_live_tx(conn, "promoted", stamp).await?;
            }
            if queue::move_to_front(entries, occurrence_id) {
                *changed = true;
            }
            if selected.as_ref() != Some(occurrence_id) {
                *selected = Some(occurrence_id.clone());
                *changed = true;
            }
        }
        FocusAction::Remove { occurrence_id } => {
            let index = entries
                .iter()
                .position(|e| &e.occurrence_id == occurrence_id)
                .ok_or_else(|| err("stale_occurrence", "not queued"))?;
            if selected.as_ref() == Some(occurrence_id) {
                pause_live_tx(conn, "removed", stamp).await?;
            }
            entries.remove(index);
            *changed = true;
            sqlx::query("UPDATE focus_occurrences SET state='removed' WHERE id=? AND state='open'")
                .bind(occurrence_id)
                .execute(&mut *conn)
                .await?;
            sqlx::query("UPDATE focus_sessions SET status='ended',ended_at=?,end_reason='removed' WHERE occurrence_id=? AND status!='ended'")
                .bind(stamp).bind(occurrence_id).execute(&mut *conn).await?;
            if selected.as_ref() == Some(occurrence_id) {
                *selected = entries.first().map(|e| e.occurrence_id.clone());
            }
        }
        FocusAction::Start { occurrence_id } => {
            let entry = entries
                .iter()
                .find(|e| &e.occurrence_id == occurrence_id)
                .ok_or_else(|| err("stale_occurrence", "not queued"))?
                .clone();
            ensure_open_task_tx(conn, &entry).await?;
            pause_live_tx(conn, "switched", stamp).await?;
            if queue::move_to_front(entries, occurrence_id) {
                *changed = true;
            }
            if selected.as_ref() != Some(occurrence_id) {
                *selected = Some(occurrence_id.clone());
                *changed = true;
            }
            if let Some(session) = read_session_tx(conn, occurrence_id).await? {
                match session.phase {
                    FocusPhase::Work => open_segment_tx(conn, &session.id, "work", stamp).await?,
                    FocusPhase::WorkReady => {
                        sqlx::query("UPDATE focus_sessions SET phase='work' WHERE id=?")
                            .bind(&session.id)
                            .execute(&mut *conn)
                            .await?;
                        open_segment_tx(conn, &session.id, "work", stamp).await?;
                    }
                    _ => {
                        return Err(err(
                            "invalid",
                            "use break controls for paused Pomodoro phase",
                        ))
                    }
                }
            } else {
                let sid = id();
                sqlx::query("INSERT INTO focus_sessions(id,occurrence_id,owner_device_id,owner_epoch,status,phase,mode,config_json,timezone_offset_minutes,started_at,checkpoint_at) VALUES(?,?,?,?, 'paused','work',?,?,?,?,?)")
                    .bind(&sid).bind(occurrence_id).bind(device).bind(epoch)
                    .bind(serde_json::to_string(&entry.config.mode).map_err(|e|err("invalid",&e.to_string()))?.trim_matches('"').to_string())
                    .bind(serde_json::to_string(&entry.config).map_err(|e|err("invalid",&e.to_string()))?)
                    .bind(chrono::Local::now().offset().local_minus_utc()/60).bind(stamp).bind(stamp).execute(&mut *conn).await?;
                open_segment_tx(conn, &sid, "work", stamp).await?;
            }
            task_tx::set_status_tx(
                conn,
                &entry.task_id,
                "in_progress",
                chrono::Local::now().date_naive(),
                MutationPolicy::User,
            )
            .await?;
        }
        FocusAction::Pause => {
            pause_live_tx(conn, "paused", stamp).await?;
        }
        FocusAction::Resume => {
            let oid = selected
                .as_ref()
                .ok_or_else(|| err("not_found", "no selection"))?;
            let entry = entries
                .iter()
                .find(|e| &e.occurrence_id == oid)
                .ok_or_else(|| err("stale_occurrence", "not queued"))?;
            ensure_open_task_tx(conn, entry).await?;
            let live: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *conn)
                    .await?;
            if live.is_some() {
                return Err(err("invalid", "already running"));
            }
            let session = read_session_tx(conn, oid)
                .await?
                .ok_or_else(|| err("not_found", "no paused session"))?;
            let phase = match session.phase {
                FocusPhase::Work => "work",
                FocusPhase::Break => "break",
                _ => return Err(err("invalid", "phase requires explicit control")),
            };
            open_segment_tx(conn, &session.id, phase, stamp).await?;
        }
        FocusAction::Stop | FocusAction::Skip => {
            pause_live_tx(conn, "stopped", stamp).await?;
            if let Some(oid) = selected.as_ref() {
                sqlx::query("UPDATE focus_sessions SET status='ended',ended_at=?,end_reason='stopped' WHERE occurrence_id=? AND status='paused'")
                    .bind(stamp).bind(oid).execute(&mut *conn).await?;
                if matches!(action, FocusAction::Skip) {
                    if let Some(index) = entries.iter().position(|e| &e.occurrence_id == oid) {
                        let item = entries.remove(index);
                        entries.push(item);
                        *changed = true;
                        *selected = entries.first().map(|e| e.occurrence_id.clone());
                    }
                }
            }
        }
        FocusAction::Complete { occurrence_id } => {
            let entry = entries
                .iter()
                .find(|e| &e.occurrence_id == occurrence_id)
                .ok_or_else(|| err("stale_occurrence", "not queued"))?
                .clone();
            ensure_open_task_tx(conn, &entry).await?;
            // Name the due identity this occurrence was queued for. A remote
            // pull that already advanced a recurring task (completed on the
            // phone) leaves the occurrence open but stale; completing it here
            // would advance it again and push the skipped date to Todoist.
            let identity: Option<String> = sqlx::query_scalar(
                "SELECT scheduling_identity FROM focus_occurrences WHERE id=?",
            )
            .bind(occurrence_id)
            .fetch_one(&mut *conn)
            .await?;
            task_tx::ensure_expected_due_tx(conn, &entry.task_id, "complete", identity.as_deref())
                .await?;
            let effects = task_tx::set_status_tx(
                conn,
                &entry.task_id,
                "complete",
                chrono::Local::now().date_naive(),
                MutationPolicy::User,
            )
            .await?;
            let mut target_ids: HashSet<String> = effects
                .changed
                .iter()
                .filter(|t| t.completed)
                .map(|t| t.id.clone())
                .collect();
            target_ids.insert(entry.task_id.clone());
            let affected: Vec<String> = entries
                .iter()
                .filter(|e| target_ids.contains(&e.task_id))
                .map(|e| e.occurrence_id.clone())
                .collect();
            if selected.as_ref().is_some_and(|oid| affected.contains(oid)) {
                pause_live_tx(conn, "completed", stamp).await?;
            }
            for oid in &affected {
                sqlx::query("UPDATE focus_sessions SET status='ended',ended_at=?,end_reason='completed' WHERE occurrence_id=? AND status!='ended'")
                    .bind(stamp).bind(oid).execute(&mut *conn).await?;
                sqlx::query("UPDATE focus_occurrences SET state='completed',completed_at=?,completion_reason='native' WHERE id=?")
                    .bind(stamp).bind(oid).execute(&mut *conn).await?;
                // Optional time comment, committed with the completion. It is
                // only ever a comment: the task's own close or recurring due
                // update was already enqueued by set_status_tx above.
                if let Some(e) = entries.iter().find(|e| &e.occurrence_id == oid) {
                    let budget = (e.config.mode == FocusMode::Timebox).then_some(e.config.budget_ms).flatten();
                    crate::integrations::todoist::focus_delivery::enqueue_completion_tx(conn, oid, &e.task_id, budget).await?;
                }
            }
            entries.retain(|e| !affected.contains(&e.occurrence_id));
            *changed = true;
            if selected.as_ref().is_some_and(|oid| affected.contains(oid)) {
                *selected = entries.first().map(|e| e.occurrence_id.clone());
            }
            // Committed with the completion; the owner claims and plays it once.
            sqlx::query("UPDATE focus_runtime SET sound_token=? WHERE id=1")
                .bind(format!("complete:{}", id()))
                .execute(&mut *conn)
                .await?;
        }
        FocusAction::Configure {
            occurrence_id,
            config,
        } => {
            schema::validate_config(config)?;
            let entry = entries
                .iter_mut()
                .find(|e| &e.occurrence_id == occurrence_id)
                .ok_or_else(|| err("stale_occurrence", "not queued"))?;
            let mode_changed = entry.config.mode != config.mode;
            if mode_changed && selected.as_ref() == Some(occurrence_id) {
                pause_live_tx(conn, "mode_changed", stamp).await?;
            }
            entry.config = config.clone();
            *changed = true;
            if let Some(session) = read_session_tx(conn, occurrence_id).await? {
                if mode_changed {
                    sqlx::query("UPDATE focus_sessions SET status='ended',ended_at=?,end_reason='mode_changed' WHERE id=?")
                        .bind(stamp).bind(session.id).execute(&mut *conn).await?;
                } else {
                    sqlx::query("UPDATE focus_sessions SET config_json=? WHERE id=?")
                        .bind(
                            serde_json::to_string(config)
                                .map_err(|e| err("invalid", &e.to_string()))?,
                        )
                        .bind(session.id)
                        .execute(&mut *conn)
                        .await?;
                }
            }
        }
        FocusAction::StartBreak => {
            let oid = selected
                .as_ref()
                .ok_or_else(|| err("not_found", "no selection"))?;
            let session = read_session_tx(conn, oid)
                .await?
                .ok_or_else(|| err("not_found", "no session"))?;
            if session.phase != FocusPhase::RoundReady {
                return Err(err("invalid", "break not ready"));
            }
            if session.round >= session.config.rounds {
                return Err(err("invalid", "final round has no next break"));
            }
            sqlx::query("UPDATE focus_sessions SET phase='break',round_break_ms=0 WHERE id=?")
                .bind(&session.id)
                .execute(&mut *conn)
                .await?;
            open_segment_tx(conn, &session.id, "break", stamp).await?;
        }
        FocusAction::EndBreak => {
            let oid = selected
                .as_ref()
                .ok_or_else(|| err("not_found", "no selection"))?;
            let session = read_session_tx(conn, oid)
                .await?
                .ok_or_else(|| err("not_found", "no session"))?;
            if session.phase != FocusPhase::Break {
                return Err(err("invalid", "not in break"));
            }
            pause_live_tx(conn, "break_ended", stamp).await?;
            sqlx::query("UPDATE focus_sessions SET phase='work_ready',round=round+1,round_work_ms=0 WHERE id=? AND round<?")
                .bind(&session.id).bind(session.config.rounds).execute(&mut *conn).await?;
        }
        FocusAction::ArchiveHistory { occurrence_ids } => {
            for oid in occurrence_ids {
                let changed = sqlx::query(
                    "UPDATE focus_occurrences SET archived=1 WHERE id=? AND state!='open'",
                )
                .bind(oid)
                .execute(&mut *conn)
                .await?
                .rows_affected();
                if changed == 0 {
                    return Err(err("not_found", "history occurrence missing or open"));
                }
            }
        }
        FocusAction::UndoDelete { token } => {
            let row=sqlx::query("SELECT task_snapshot_json,queue_entry_json,occurrence_ids_json,expires_at,consumed FROM focus_undo WHERE token=?")
                .bind(token).fetch_optional(&mut *conn).await?.ok_or_else(||err("not_found","undo token missing"))?;
            let expires = chrono::DateTime::parse_from_rfc3339(&row.get::<String, _>("expires_at"))
                .map_err(|e| err("storage", &e.to_string()))?;
            if row.get::<i64, _>("consumed") != 0
                || expires
                    < chrono::DateTime::parse_from_rfc3339(stamp)
                        .map_err(|e| err("storage", &e.to_string()))?
            {
                return Err(err("stale_occurrence", "undo token expired or used"));
            }
            let tasks: Vec<LocalTask> = serde_json::from_str(row.get("task_snapshot_json"))
                .map_err(|e| err("storage", &e.to_string()))?;
            let saved: Vec<UndoEntry> = serde_json::from_str(row.get("queue_entry_json"))
                .map_err(|e| err("storage", &e.to_string()))?;
            let ids: Vec<String> = serde_json::from_str(row.get("occurrence_ids_json"))
                .map_err(|e| err("storage", &e.to_string()))?;
            task_tx::restore_deleted_tasks_tx(conn, &tasks).await?;
            for oid in &ids {
                let task_id: Option<String> =
                    sqlx::query_scalar("SELECT original_task_id FROM focus_occurrences WHERE id=?")
                        .bind(oid)
                        .fetch_optional(&mut *conn)
                        .await?;
                if let Some(task_id) = task_id {
                    sqlx::query("UPDATE focus_occurrences SET task_id=?,state='open',completed_at=NULL,completion_reason=NULL WHERE id=?")
                        .bind(task_id).bind(oid).execute(&mut *conn).await?;
                }
            }
            // Only a running slot pins first place. Paused work can yield its
            // original position; neighbor IDs survive an intervening reorder.
            let live: Option<String> =
                sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
                    .fetch_one(&mut *conn)
                    .await?;
            let mut last_at = None::<usize>;
            for item in saved {
                let entry = item.entry;
                if entries
                    .iter()
                    .any(|e| e.occurrence_id == entry.occurrence_id)
                {
                    continue;
                }
                let mut at = if let Some(ref prev) = item.previous_entry_id {
                    entries
                        .iter()
                        .position(|e| &e.id == prev)
                        .map(|index| index + 1)
                } else {
                    None
                }
                .or_else(|| {
                    item.next_entry_id
                        .as_ref()
                        .and_then(|next| entries.iter().position(|e| &e.id == next))
                })
                .unwrap_or(item.position.min(entries.len()));
                if let Some(previous) = last_at {
                    at = at.max(previous + 1);
                }
                if live.is_some() {
                    at = at.max(1);
                }
                at = at.min(entries.len());
                entries.insert(at, entry);
                last_at = Some(at);
                *changed = true;
            }
            if live.is_none() {
                *selected = entries.first().map(|e| e.occurrence_id.clone());
            }
            sqlx::query("UPDATE focus_undo SET consumed=1 WHERE token=?")
                .bind(token)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

async fn ensure_open_task_tx(conn: &mut SqliteConnection, entry: &FocusEntry) -> crate::Result<()> {
    let state: Option<(String, i64)> =
        sqlx::query_as("SELECT status,completed FROM local_tasks WHERE id=?")
            .bind(&entry.task_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some((status, completed)) = state else {
        return Err(err("not_found", "task missing"));
    };
    let occurrence: Option<String> =
        sqlx::query_scalar("SELECT state FROM focus_occurrences WHERE id=?")
            .bind(&entry.occurrence_id)
            .fetch_optional(&mut *conn)
            .await?;
    if occurrence.as_deref() != Some("open")
        || ((status == "complete" || completed != 0) && !entry.explicit_still_open)
    {
        return Err(err("stale_occurrence", "occurrence no longer open"));
    }
    Ok(())
}

/// Reconcile native CRUD effects in the caller's transaction. Callers without the
/// desktop service may only use the durable checkpoint; affected live work pauses.
/// Where a task write came from. Only a LOCAL native completion (task
/// list/detail, focus, `dt`/agent) may create an optional time comment; a
/// remote apply (Todoist/Turso pull, Calendar edit) never echoes one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum EffectOrigin {
    Local,
    Remote,
}

/// Headless reconcile for a LOCAL pool CRUD write (`db::tasks`).
pub async fn reconcile_task_effects_tx(
    conn: &mut SqliteConnection,
    effects: &TaskEffects,
) -> crate::Result<()> {
    reconcile_task_effects_inner_tx(conn, effects, true, EffectOrigin::Local).await?;
    replica::publish_focus_replica_tx(conn).await
}
/// Headless reconcile for a REMOTE apply (`TaskWrite` without a live service).
pub async fn reconcile_remote_task_effects_tx(
    conn: &mut SqliteConnection,
    effects: &TaskEffects,
) -> crate::Result<()> {
    reconcile_task_effects_inner_tx(conn, effects, true, EffectOrigin::Remote).await?;
    replica::publish_focus_replica_tx(conn).await
}
async fn reconcile_task_effects_owned_tx(
    conn: &mut SqliteConnection,
    effects: &TaskEffects,
    origin: EffectOrigin,
) -> crate::Result<()> {
    reconcile_task_effects_inner_tx(conn, effects, false, origin).await
}
async fn reconcile_task_effects_inner_tx(
    conn: &mut SqliteConnection,
    effects: &TaskEffects,
    pause_affected_live: bool,
    origin: EffectOrigin,
) -> crate::Result<()> {
    let q: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT entries_json,selected_occurrence_id FROM focus_queue_state WHERE id=1",
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some((json, mut selected)) = q else {
        return Ok(());
    };
    let mut entries: Vec<FocusEntry> =
        serde_json::from_str(&json).map_err(|e| err("storage", &e.to_string()))?;
    let deleted: HashSet<&str> = effects.deleted.iter().map(|t| t.id.as_str()).collect();
    let completed: HashSet<&str> = effects
        .changed
        .iter()
        .filter(|t| t.completed || t.status == "complete")
        .map(|t| t.id.as_str())
        .collect();
    let mut remove = HashSet::new();
    for e in &entries {
        if deleted.contains(e.task_id.as_str())
            || completed.contains(e.task_id.as_str())
            || effects
                .recurrence
                .as_ref()
                .is_some_and(|r| r.task_id == e.task_id)
        {
            remove.insert(e.occurrence_id.clone());
        }
    }
    let stamp = now();
    let affected: HashSet<&str> = effects
        .changed
        .iter()
        .chain(effects.deleted.iter())
        .map(|t| t.id.as_str())
        .collect();
    let mut touched = !remove.is_empty();
    if selected.as_ref().is_some_and(|oid| {
        remove.contains(oid)
            || (pause_affected_live
                && entries
                    .iter()
                    .any(|e| &e.occurrence_id == oid && affected.contains(e.task_id.as_str())))
    }) {
        pause_live_tx(conn, "task_changed", &stamp).await?;
        touched = true;
    }
    for oid in &remove {
        let state = if deleted.iter().any(|tid| {
            entries
                .iter()
                .any(|e| &e.occurrence_id == oid && e.task_id == *tid)
        }) {
            "removed"
        } else {
            "completed"
        };
        let closed = sqlx::query("UPDATE focus_occurrences SET state=?,completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END,completion_reason='task_effect' WHERE id=? AND state='open'")
            .bind(state).bind(state).bind(&stamp).bind(oid).execute(&mut *conn).await?;
        sqlx::query("UPDATE focus_sessions SET status='ended',ended_at=?,end_reason='task_effect' WHERE occurrence_id=? AND status!='ended'")
            .bind(&stamp).bind(oid).execute(&mut *conn).await?;
        // A local native completion of an open occurrence (settled above)
        // gets the same optional comment as focus Complete, in this same
        // transaction; at most one per occurrence.
        if origin == EffectOrigin::Local && state == "completed" && closed.rows_affected() == 1 {
            if let Some(e) = entries.iter().find(|e| &e.occurrence_id == oid) {
                let budget = (e.config.mode == FocusMode::Timebox).then_some(e.config.budget_ms).flatten();
                crate::integrations::todoist::focus_delivery::enqueue_completion_tx(conn, oid, &e.task_id, budget).await?;
            }
        }
    }
    entries.retain(|e| !remove.contains(&e.occurrence_id));
    if selected.as_ref().is_some_and(|oid| remove.contains(oid)) {
        selected = entries.first().map(|e| e.occurrence_id.clone());
    }
    // Only a LOCAL user due edit re-binds an open occurrence to the new due;
    // a remote due change leaves it stale for Complete to refuse.
    if origin == EffectOrigin::Local {
        for task in effects.changed.iter().filter(|t| effects.rescheduled.contains(&t.id)) {
            sqlx::query("UPDATE focus_occurrences SET scheduling_identity=? WHERE task_id=? AND state='open'")
                .bind(&task.due_date).bind(&task.id).execute(&mut *conn).await?;
        }
    }
    for task in &effects.changed {
        let snapshots = sqlx::query("UPDATE focus_occurrences SET title_snapshot=?,project_snapshot=? WHERE task_id=? AND state='open' AND (title_snapshot IS NOT ? OR project_snapshot IS NOT ?)")
            .bind(&task.content).bind(&task.project_id).bind(&task.id)
            .bind(&task.content).bind(&task.project_id).execute(&mut *conn).await?;
        touched |= snapshots.rows_affected() > 0;
    }
    // Queued/open tasks also count when nothing visible changed, so a focused
    // task's edit still invalidates its surfaces; unrelated tasks never do.
    touched |= entries.iter().any(|e| affected.contains(e.task_id.as_str()));
    if !remove.is_empty() {
        save_queue_tx(conn, &entries, selected.as_deref(), &stamp).await?;
    }
    // Only a change to focused work advances the engine revision (and hence
    // a replica publication); unrelated task writes must not invalidate
    // in-flight focus commands or re-publish the whole ledger.
    if touched {
        sqlx::query("UPDATE focus_runtime SET engine_revision=engine_revision+1 WHERE id=1")
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn capture_undo_tx(
    conn: &mut SqliteConnection,
    effects: &TaskEffects,
) -> crate::Result<String> {
    let rows: Option<String> =
        sqlx::query_scalar("SELECT entries_json FROM focus_queue_state WHERE id=1")
            .fetch_optional(&mut *conn)
            .await?;
    let entries: Vec<FocusEntry> = rows
        .as_deref()
        .map(|s| serde_json::from_str(s).map_err(|e| err("storage", &e.to_string())))
        .transpose()?
        .unwrap_or_default();
    let ids: HashSet<&str> = effects.deleted.iter().map(|t| t.id.as_str()).collect();
    let saved: Vec<UndoEntry> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| ids.contains(e.task_id.as_str()))
        .map(|(position, entry)| UndoEntry {
            position,
            entry: entry.clone(),
            previous_entry_id: entries[..position]
                .iter()
                .rev()
                .find(|e| !ids.contains(e.task_id.as_str()))
                .map(|e| e.id.clone()),
            next_entry_id: entries[position + 1..]
                .iter()
                .find(|e| !ids.contains(e.task_id.as_str()))
                .map(|e| e.id.clone()),
        })
        .collect();
    let oids: Vec<String> = saved
        .iter()
        .map(|item| item.entry.occurrence_id.clone())
        .collect();
    let token = id();
    let issued = Utc::now();
    sqlx::query("INSERT INTO focus_undo(token,original_task_id,task_snapshot_json,queue_entry_json,occurrence_ids_json,issued_at,expires_at) VALUES(?,?,?,?,?,?,?)")
        .bind(&token).bind(effects.deleted.last().map(|t|t.id.as_str()).unwrap_or(""))
        .bind(serde_json::to_string(&effects.deleted).map_err(|e|err("storage",&e.to_string()))?)
        .bind(serde_json::to_string(&saved).map_err(|e|err("storage",&e.to_string()))?)
        .bind(serde_json::to_string(&oids).map_err(|e|err("storage",&e.to_string()))?)
        .bind(issued.to_rfc3339()).bind((issued+chrono::Duration::seconds(10)).to_rfc3339())
        .execute(&mut *conn).await?;
    Ok(token)
}
