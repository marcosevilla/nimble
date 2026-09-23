//! Optional Todoist time comments for completed focus occurrences, and the
//! explicit reconciliation of uncertain or imported legacy sends.
//!
//! - The bridge is OFF unless the `focus_time_delivery_enabled` setting is
//!   exactly "1"; while off it neither persists new intents nor sends anything.
//! - An intent is only a comment (Sync `note_add`); native completion keeps its
//!   own close or recurring due update through the task outbox. The one
//!   exception is a legacy close the user explicitly adopts after verifying it
//!   never arrived — refused for repeating tasks.
//! - Each operation keeps one stable command `uuid` (+ `temp_id`), which the
//!   Todoist Sync API deduplicates on. A possible-success failure (timeout
//!   after send, unreadable success, gateway error, crash mid-send) becomes
//!   `uncertain` and is never retried automatically; only an explicit
//!   `AdoptVerifiedUndelivered` re-arms it, with the same keys.
//! - Imported legacy pending operations stay evidence in
//!   `focus_import_records` until a user resolution materializes them here.
use crate::integrations::todoist::client::{SyncResponse, SyncTransport, TransportError};
use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, SqliteConnection, SqlitePool};

pub const ENABLED_SETTING: &str = "focus_time_delivery_enabled";
const AUTH_PAUSE_SETTING: &str = "focus_delivery_auth_paused";
pub const MIN_RECORDED_MS: u64 = 60_000;
pub const BASE_BACKOFF_SECS: u64 = 30;
pub const MAX_BACKOFF_SECS: u64 = 3_600;
/// Upper bound on a server-requested wait, so a bad header can't park a row forever.
const MAX_RETRY_AFTER_SECS: u64 = 86_400;
const BATCH: usize = 50;
const REVIEW_LIMIT: i64 = 200;

pub const TIME_COMMENT: &str = "time_comment";
pub const LEGACY_CLOSE: &str = "legacy_close";
pub const LEGACY_COMMENT: &str = "legacy_comment";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeliveryState { Pending, Sending, Acknowledged, Uncertain, RetryableError, NeedsReview, Archived }

impl DeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Sending => "sending",
            Self::Acknowledged => "acknowledged",
            Self::Uncertain => "uncertain",
            Self::RetryableError => "retryable-error",
            Self::NeedsReview => "needs-review",
            Self::Archived => "archived",
        }
    }
    fn parse(s: &str) -> crate::Result<Self> {
        Ok(match s {
            "pending" => Self::Pending,
            "sending" => Self::Sending,
            "acknowledged" => Self::Acknowledged,
            "uncertain" => Self::Uncertain,
            "retryable-error" => Self::RetryableError,
            "needs-review" => Self::NeedsReview,
            "archived" => Self::Archived,
            other => return Err(err("storage", &format!("unknown delivery state {other}"))),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryResolution { Acknowledged, AdoptVerifiedUndelivered, ArchiveWithReason }

/// One new-time summary for a completed occurrence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusDeliveryIntent {
    pub id: String,
    /// Sync command `uuid`; stable for the life of the operation.
    pub operation_id: String,
    pub temp_id: String,
    pub occurrence_id: String,
    pub external_id: String,
    /// Exact newly recorded work (sessions only; no breaks, no imported time).
    pub recorded_ms: u64,
    pub budget_ms: Option<u64>,
    pub content: String,
    pub state: DeliveryState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusDeliveryReviewItem {
    pub id: String,
    /// "focus" (a Nimble time comment) or "legacy_import" (old Focus Queue pending.json).
    pub origin: String,
    pub purpose: String,
    pub state: DeliveryState,
    pub native_task_id: Option<String>,
    pub task_title: Option<String>,
    pub external_id: Option<String>,
    pub occurrence_id: Option<String>,
    pub occurrence_title: Option<String>,
    pub content: Option<String>,
    pub recorded_ms: Option<u64>,
    pub budget_ms: Option<u64>,
    pub attempts: u64,
    pub last_error: Option<String>,
    pub next_attempt_at: Option<String>,
    pub remote_receipt: Option<String>,
    pub evidence: Value,
    pub created_at: String,
    pub resolution: Option<Value>,
    pub recurring_task: bool,
    pub adoptable: bool,
    pub adopt_blocked_reason: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct DispatchReport {
    pub skipped: Option<String>,
    pub sent: usize,
    pub acknowledged: usize,
    pub uncertain: usize,
    pub retrying: usize,
    pub needs_review: usize,
    pub auth_paused: bool,
}

fn err(code: &str, detail: &str) -> crate::Error {
    crate::Error::Other(format!("{code}: {detail}"))
}

fn stamp(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Legacy formatter parity: whole minutes rounded half up (JS `Math.round`),
/// nothing under one minute, timebox mentioned only when set.
pub fn comment_text(recorded_ms: u64, budget_ms: Option<u64>) -> Option<String> {
    if recorded_ms < MIN_RECORDED_MS {
        return None;
    }
    let minutes = |ms: u64| ms.saturating_add(30_000) / 60_000;
    Some(match budget_ms {
        Some(budget) => format!("⏱ {}m spent (timebox {}m)", minutes(recorded_ms), minutes(budget)),
        None => format!("⏱ {}m spent", minutes(recorded_ms)),
    })
}

/// Pure eligibility: bridge on, a mapped remote task, and at least a minute of
/// newly recorded work. Returns fresh keys; persistence makes them stable.
pub fn delivery_for_completion(
    occurrence_id: &str,
    recorded_ms: u64,
    budget_ms: Option<u64>,
    external_id: Option<&str>,
    enabled: bool,
) -> Option<FocusDeliveryIntent> {
    let external_id = external_id.map(str::trim).filter(|e| !e.is_empty())?;
    if !enabled {
        return None;
    }
    let content = comment_text(recorded_ms, budget_ms)?;
    Some(FocusDeliveryIntent {
        id: uuid::Uuid::new_v4().to_string(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        temp_id: uuid::Uuid::new_v4().to_string(),
        occurrence_id: occurrence_id.into(),
        external_id: external_id.into(),
        recorded_ms,
        budget_ms,
        content,
        state: DeliveryState::Pending,
    })
}

async fn enabled(conn: &mut SqliteConnection) -> crate::Result<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(ENABLED_SETTING).fetch_optional(&mut *conn).await?;
    Ok(value.as_deref() == Some("1"))
}

/// Called inside the focus completion transaction, after the occurrence's
/// sessions are settled. At most one intent per occurrence; a repeat is a no-op.
pub async fn enqueue_completion_tx(
    conn: &mut SqliteConnection,
    occurrence_id: &str,
    task_id: &str,
    budget_ms: Option<u64>,
) -> crate::Result<Option<FocusDeliveryIntent>> {
    if !enabled(conn).await? {
        return Ok(None);
    }
    let task: Option<(Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT external_id,external_source,sync_policy FROM local_tasks WHERE id=?")
        .bind(task_id).fetch_optional(&mut *conn).await?;
    let external = match task {
        Some((Some(ext), Some(source), policy)) if source == "todoist" && policy != "local_only" => ext,
        _ => return Ok(None), // unmapped or Nimble-only: never a Todoist write
    };
    let recorded: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(work_ms),0) FROM focus_sessions WHERE occurrence_id=?")
        .bind(occurrence_id).fetch_one(&mut *conn).await?;
    let Some(intent) = delivery_for_completion(occurrence_id, recorded.max(0) as u64, budget_ms, Some(&external), true)
    else {
        return Ok(None);
    };
    let now = stamp(Utc::now());
    let payload = json!({"content": intent.content, "recorded_ms": intent.recorded_ms, "budget_ms": intent.budget_ms});
    let inserted = sqlx::query(
        "INSERT INTO focus_delivery(id,occurrence_id,purpose,native_task_id,external_id,payload_json,idempotency_key,temp_id,state,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(occurrence_id,purpose) DO NOTHING")
        .bind(&intent.id).bind(occurrence_id).bind(TIME_COMMENT).bind(task_id).bind(&intent.external_id)
        .bind(payload.to_string()).bind(&intent.operation_id).bind(&intent.temp_id).bind(&now).bind(&now)
        .execute(&mut *conn).await?;
    Ok((inserted.rows_affected() == 1).then_some(intent))
}

// ── review / reconciliation ───────────────────────────────────────────────

struct TaskInfo {
    id: String,
    title: String,
    local_only: bool,
    completed: bool,
    recurring: bool,
}

const TASK_COLS: &str = "id,content,sync_policy,completed,status,recurrence_rule IS NOT NULL OR COALESCE(json_extract(synced_snapshot,'$.due.is_recurring'),0)=1 AS recurring";

fn task_info(row: &sqlx::sqlite::SqliteRow) -> TaskInfo {
    let status: String = row.get("status");
    TaskInfo {
        id: row.get("id"),
        title: row.get("content"),
        local_only: row.get::<String, _>("sync_policy") == "local_only",
        completed: row.get::<i64, _>("completed") != 0 || status == "complete",
        recurring: row.get::<i64, _>("recurring") != 0,
    }
}

async fn task_by_id(conn: &mut SqliteConnection, id: &str) -> crate::Result<Option<TaskInfo>> {
    let row = sqlx::query(&format!("SELECT {TASK_COLS} FROM local_tasks WHERE id=?"))
        .bind(id).fetch_optional(&mut *conn).await?;
    Ok(row.as_ref().map(task_info))
}

async fn tasks_by_remote(conn: &mut SqliteConnection, remote: &str) -> crate::Result<Vec<TaskInfo>> {
    let rows = sqlx::query(&format!(
        "SELECT {TASK_COLS} FROM local_tasks WHERE external_source='todoist' AND external_id=?"))
        .bind(remote).fetch_all(&mut *conn).await?;
    Ok(rows.iter().map(task_info).collect())
}

/// The Nimble task an operation targets: the recorded native id for Nimble
/// intents, or the single task mapped to the legacy remote id.
async fn target_task(
    conn: &mut SqliteConnection,
    native_task_id: Option<&str>,
    external_id: Option<&str>,
    legacy: bool,
) -> crate::Result<Result<TaskInfo, String>> {
    if !legacy {
        return Ok(match native_task_id {
            Some(id) => task_by_id(conn, id).await?.ok_or_else(|| "The Nimble task no longer exists.".to_string()),
            None => Err("No Nimble task is recorded for this send.".into()),
        });
    }
    let Some(remote) = external_id.filter(|r| !r.is_empty() && !r.starts_with("manual:")) else {
        return Ok(Err("The old operation targets a task that never lived in Todoist.".into()));
    };
    let mut found = tasks_by_remote(conn, remote).await?;
    Ok(match found.len() {
        0 => Err("No Nimble task is linked to this Todoist task.".into()),
        1 => Ok(found.remove(0)),
        _ => Err("Several Nimble tasks are linked to this Todoist task.".into()),
    })
}

/// Why an operation may not be re-armed, or `None` when adoption is allowed.
fn adopt_blocker(purpose: &str, state: DeliveryState, target: &Result<TaskInfo, String>, content: Option<&str>) -> Option<String> {
    match state {
        DeliveryState::Acknowledged | DeliveryState::Archived => return Some("Already resolved.".into()),
        DeliveryState::Sending => return Some("A send is in flight.".into()),
        DeliveryState::Pending => return Some("Already queued to send.".into()),
        _ => {}
    }
    let task = match target {
        Ok(task) => task,
        Err(reason) => return Some(reason.clone()),
    };
    if task.local_only {
        return Some("The task is Nimble-only now; nothing is sent to Todoist.".into());
    }
    match purpose {
        TIME_COMMENT | LEGACY_COMMENT if content.is_none_or(|c| c.trim().is_empty()) => Some("There is no comment text to send.".into()),
        TIME_COMMENT | LEGACY_COMMENT => None,
        LEGACY_CLOSE if task.recurring => Some("This task repeats; an old close could complete a later occurrence.".into()),
        LEGACY_CLOSE if task.completed => Some("Already completed in Nimble; acknowledge it instead.".into()),
        LEGACY_CLOSE => None,
        _ => Some("Unknown operation kind; keep it as evidence.".into()),
    }
}

fn legacy_purpose(evidence: &Value) -> &'static str {
    match evidence.get("kind").and_then(Value::as_str) {
        Some("close") => LEGACY_CLOSE,
        Some("comment") => LEGACY_COMMENT,
        _ => "legacy_unknown",
    }
}

fn legacy_created_at(evidence: &Value) -> Option<String> {
    let ms = evidence.get("createdAt").and_then(Value::as_i64)?;
    Utc.timestamp_millis_opt(ms).single().map(stamp)
}

async fn item_from_row(conn: &mut SqliteConnection, row: &sqlx::sqlite::SqliteRow) -> crate::Result<FocusDeliveryReviewItem> {
    let purpose: String = row.get("purpose");
    let state = DeliveryState::parse(&row.get::<String, _>("state"))?;
    let payload: Value = serde_json::from_str(&row.get::<String, _>("payload_json")).unwrap_or(Value::Null);
    let native: Option<String> = row.get("native_task_id");
    let external: Option<String> = row.get("external_id");
    let legacy = row.get::<Option<String>, _>("import_record_id").is_some();
    let target = target_task(conn, native.as_deref(), external.as_deref(), legacy).await?;
    let content = payload.get("content").and_then(Value::as_str).map(str::to_owned);
    let blocker = adopt_blocker(&purpose, state, &target, content.as_deref());
    let (task_title, recurring) = match &target {
        Ok(t) => (Some(t.title.clone()), t.recurring),
        Err(_) => (None, false),
    };
    Ok(FocusDeliveryReviewItem {
        id: row.get("id"),
        origin: if legacy { "legacy_import" } else { "focus" }.into(),
        purpose,
        state,
        native_task_id: native.or_else(|| target.as_ref().ok().map(|t| t.id.clone())),
        task_title,
        external_id: external,
        occurrence_id: row.get("occurrence_id"),
        occurrence_title: row.get("title_snapshot"),
        recorded_ms: payload.get("recorded_ms").and_then(Value::as_u64),
        budget_ms: payload.get("budget_ms").and_then(Value::as_u64),
        content,
        attempts: row.get::<i64, _>("attempts").max(0) as u64,
        last_error: row.get("last_error"),
        next_attempt_at: row.get("next_attempt_at"),
        remote_receipt: row.get("remote_receipt"),
        evidence: payload,
        created_at: row.get("created_at"),
        resolution: row.get::<Option<String>, _>("resolution_json").and_then(|r| serde_json::from_str(&r).ok()),
        recurring_task: recurring,
        adoptable: blocker.is_none(),
        adopt_blocked_reason: blocker,
    })
}

async fn legacy_item(conn: &mut SqliteConnection, id: &str, evidence: Value) -> crate::Result<FocusDeliveryReviewItem> {
    let purpose = legacy_purpose(&evidence);
    let external = evidence.get("taskId").and_then(Value::as_str).map(str::to_owned);
    let target = target_task(conn, None, external.as_deref(), true).await?;
    let content = evidence.get("content").and_then(Value::as_str).map(str::to_owned);
    let blocker = adopt_blocker(purpose, DeliveryState::NeedsReview, &target, content.as_deref());
    Ok(FocusDeliveryReviewItem {
        id: id.into(),
        origin: "legacy_import".into(),
        purpose: purpose.into(),
        state: DeliveryState::NeedsReview,
        native_task_id: target.as_ref().ok().map(|t| t.id.clone()),
        task_title: target.as_ref().ok().map(|t| t.title.clone()),
        external_id: external,
        occurrence_id: None,
        occurrence_title: None,
        content,
        recorded_ms: None,
        budget_ms: None,
        attempts: evidence.get("attempts").and_then(Value::as_u64).unwrap_or(0),
        last_error: None,
        next_attempt_at: None,
        remote_receipt: None,
        created_at: legacy_created_at(&evidence).unwrap_or_default(),
        evidence,
        resolution: None,
        recurring_task: target.as_ref().is_ok_and(|t| t.recurring),
        adoptable: blocker.is_none(),
        adopt_blocked_reason: blocker,
    })
}

const ROW_SQL: &str = "SELECT d.*,o.title_snapshot FROM focus_delivery d LEFT JOIN focus_occurrences o ON o.id=d.occurrence_id";
const LEGACY_SQL: &str = "SELECT r.id,r.raw_evidence_json FROM focus_import_records r
    WHERE r.record_key LIKE 'pending:%' AND r.status='quarantined'
      AND NOT EXISTS (SELECT 1 FROM focus_delivery d WHERE d.import_record_id=r.id)";

/// Everything a person may need to see: unresolved legacy evidence first,
/// then every Nimble/adopted send (newest first) with its own state.
pub async fn review(pool: &SqlitePool) -> crate::Result<Vec<FocusDeliveryReviewItem>> {
    let mut conn = pool.acquire().await?;
    let mut items = Vec::new();
    let legacy: Vec<(String, Option<String>)> = sqlx::query_as(&format!("{LEGACY_SQL} ORDER BY r.record_key"))
        .fetch_all(&mut *conn).await?;
    for (id, evidence) in legacy {
        let evidence = evidence.and_then(|e| serde_json::from_str(&e).ok()).unwrap_or(Value::Null);
        items.push(legacy_item(&mut conn, &id, evidence).await?);
    }
    let rows = sqlx::query(&format!("{ROW_SQL} ORDER BY d.created_at DESC,d.id LIMIT ?"))
        .bind(REVIEW_LIMIT).fetch_all(&mut *conn).await?;
    for row in &rows {
        items.push(item_from_row(&mut conn, row).await?);
    }
    Ok(items)
}

async fn load_item(conn: &mut SqliteConnection, id: &str) -> crate::Result<Option<FocusDeliveryReviewItem>> {
    let row = sqlx::query(&format!("{ROW_SQL} WHERE d.id=? OR d.import_record_id=?"))
        .bind(id).bind(id).fetch_optional(&mut *conn).await?;
    Ok(match row {
        Some(row) => Some(item_from_row(conn, &row).await?),
        None => None,
    })
}

/// Explicit, durable decision on one send. Acknowledge (verified delivered)
/// and archive (reason recorded) never send; adopt re-arms a verified
/// undelivered operation with its existing keys (or, for a legacy operation
/// that never had one, a first key). Nothing here performs I/O.
pub async fn resolve_delivery(
    pool: &SqlitePool,
    id: &str,
    resolution: DeliveryResolution,
    evidence: String,
) -> crate::Result<FocusDeliveryReviewItem> {
    let evidence = evidence.trim().to_owned();
    if evidence.is_empty() {
        return Err(err("invalid", "describe what you verified before resolving"));
    }
    if evidence.chars().count() > 2_000 {
        return Err(err("invalid", "evidence is limited to 2,000 characters"));
    }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let item = match load_item(&mut tx, id).await? {
        Some(item) => item,
        None => {
            // First decision on imported evidence: materialize it, unarmed.
            let record: Option<Option<String>> = sqlx::query_scalar(
                "SELECT raw_evidence_json FROM focus_import_records WHERE id=? AND record_key LIKE 'pending:%' AND status='quarantined'")
                .bind(id).fetch_optional(&mut *tx).await?;
            let Some(raw) = record else {
                return Err(err("not_found", "no such delivery or pending evidence"));
            };
            let evidence_json = raw.and_then(|e| serde_json::from_str::<Value>(&e).ok()).unwrap_or(Value::Null);
            let now = stamp(Utc::now());
            let created = legacy_created_at(&evidence_json).unwrap_or_else(|| now.clone());
            sqlx::query(
                "INSERT INTO focus_delivery(id,occurrence_id,purpose,native_task_id,external_id,payload_json,state,created_at,updated_at,import_record_id)
                 VALUES(?,NULL,?,NULL,?,?,'needs-review',?,?,?)")
                .bind(id).bind(legacy_purpose(&evidence_json))
                .bind(evidence_json.get("taskId").and_then(Value::as_str))
                .bind(evidence_json.to_string()).bind(&created).bind(&now).bind(id)
                .execute(&mut *tx).await?;
            load_item(&mut tx, id).await?.ok_or_else(|| err("storage", "materialized evidence vanished"))?
        }
    };
    let now = stamp(Utc::now());
    let previous: Option<String> = sqlx::query_scalar("SELECT resolution_json FROM focus_delivery WHERE id=?")
        .bind(&item.id).fetch_one(&mut *tx).await?;
    let decision = json!({
        "resolution": resolution,
        "evidence": evidence,
        "resolved_at": now,
        "previous_state": item.state,
        "previous": previous.and_then(|p| serde_json::from_str::<Value>(&p).ok()),
    });
    match resolution {
        DeliveryResolution::Acknowledged | DeliveryResolution::ArchiveWithReason => {
            if matches!(item.state, DeliveryState::Acknowledged | DeliveryState::Archived | DeliveryState::Sending) {
                return Err(err("conflict", "this send is already resolved or in flight"));
            }
            let state = if resolution == DeliveryResolution::Acknowledged { DeliveryState::Acknowledged } else { DeliveryState::Archived };
            sqlx::query("UPDATE focus_delivery SET state=?,next_attempt_at=NULL,resolution_json=?,updated_at=? WHERE id=?")
                .bind(state.as_str()).bind(decision.to_string()).bind(&now).bind(&item.id)
                .execute(&mut *tx).await?;
        }
        DeliveryResolution::AdoptVerifiedUndelivered => {
            if let Some(reason) = &item.adopt_blocked_reason {
                return Err(err("invalid", reason));
            }
            let comment = item.purpose != LEGACY_CLOSE;
            sqlx::query(
                "UPDATE focus_delivery SET state='pending',next_attempt_at=NULL,last_error=NULL,resolution_json=?,updated_at=?,
                    native_task_id=COALESCE(native_task_id,?),
                    idempotency_key=COALESCE(idempotency_key,?),
                    temp_id=CASE WHEN ? THEN COALESCE(temp_id,?) ELSE temp_id END
                 WHERE id=?")
                .bind(decision.to_string()).bind(&now).bind(&item.native_task_id)
                .bind(uuid::Uuid::new_v4().to_string())
                .bind(comment).bind(uuid::Uuid::new_v4().to_string())
                .bind(&item.id)
                .execute(&mut *tx).await?;
        }
    }
    let updated = load_item(&mut tx, &item.id).await?.ok_or_else(|| err("storage", "delivery vanished"))?;
    tx.commit().await?;
    Ok(updated)
}

// ── dispatch ──────────────────────────────────────────────────────────────

static DISPATCH_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

struct Claimed {
    id: String,
    command_uuid: String,
    temp_id: Option<String>,
    attempts: i64,
    command: Value,
}

fn backoff_secs(attempts: i64, retry_after: Option<u64>) -> u64 {
    let shift = (attempts.max(1) - 1).min(20) as u32;
    let exponential = BASE_BACKOFF_SECS.saturating_mul(1u64 << shift).min(MAX_BACKOFF_SECS);
    exponential.max(retry_after.unwrap_or(0).min(MAX_RETRY_AFTER_SECS))
}

/// A row still `sending` when no dispatch is running was interrupted (crash,
/// quit, dropped future) after it may have reached Todoist: uncertain.
async fn recover_interrupted(pool: &SqlitePool) -> crate::Result<()> {
    sqlx::query("UPDATE focus_delivery SET state='uncertain',last_error='interrupted while sending; delivery unknown',updated_at=? WHERE state='sending'")
        .bind(stamp(Utc::now())).execute(pool).await?;
    Ok(())
}

async fn set_state(
    conn: &mut SqliteConnection,
    id: &str,
    state: DeliveryState,
    next_attempt_at: Option<String>,
    last_error: Option<&str>,
    receipt: Option<&str>,
) -> crate::Result<()> {
    sqlx::query("UPDATE focus_delivery SET state=?,next_attempt_at=?,last_error=?,remote_receipt=COALESCE(?,remote_receipt),updated_at=? WHERE id=?")
        .bind(state.as_str()).bind(next_attempt_at).bind(last_error).bind(receipt)
        .bind(stamp(Utc::now())).bind(id).execute(&mut *conn).await?;
    Ok(())
}

async fn claim_due(pool: &SqlitePool, now: DateTime<Utc>) -> crate::Result<Vec<Claimed>> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let rows = sqlx::query(
        "SELECT id,purpose,native_task_id,external_id,payload_json,idempotency_key,temp_id,attempts,state,next_attempt_at,import_record_id
         FROM focus_delivery WHERE state IN ('pending','retryable-error') ORDER BY created_at,id")
        .fetch_all(&mut *tx).await?;
    let mut claimed = Vec::new();
    for row in rows {
        if claimed.len() >= BATCH {
            break;
        }
        let id: String = row.get("id");
        let due = match row.get::<Option<String>, _>("next_attempt_at") {
            None => true,
            Some(at) => DateTime::parse_from_rfc3339(&at).map(|at| at.with_timezone(&Utc) <= now).unwrap_or(true),
        };
        if !due {
            continue;
        }
        let purpose: String = row.get("purpose");
        let payload: Value = serde_json::from_str(&row.get::<String, _>("payload_json")).unwrap_or(Value::Null);
        let native: Option<String> = row.get("native_task_id");
        let external: Option<String> = row.get("external_id");
        let key: Option<String> = row.get("idempotency_key");
        let temp: Option<String> = row.get("temp_id");
        let legacy = row.get::<Option<String>, _>("import_record_id").is_some();
        // Re-check the target under the writer lock: a task that became
        // Nimble-only or started repeating since adoption is never written.
        let target = target_task(&mut tx, native.as_deref(), external.as_deref(), legacy).await?;
        let content = payload.get("content").and_then(Value::as_str);
        let blocked = match &target {
            Ok(task) if task.local_only => Some("task is Nimble-only now".to_string()),
            Ok(task) if purpose == LEGACY_CLOSE && task.recurring => Some("task repeats; old close refused".into()),
            Ok(_) => None,
            Err(reason) => Some(reason.clone()),
        };
        let command = match (&external, &key, blocked) {
            (_, _, Some(reason)) => Err(reason),
            (None, _, _) | (_, None, _) => Err("missing remote id or operation key".to_string()),
            (Some(ext), Some(key), None) => match purpose.as_str() {
                TIME_COMMENT | LEGACY_COMMENT => match (content, &temp) {
                    (Some(text), Some(temp)) => Ok(json!({"type": "note_add", "uuid": key, "temp_id": temp,
                        "args": {"item_id": ext, "content": text}})),
                    _ => Err("missing comment text or temp id".to_string()),
                },
                LEGACY_CLOSE => Ok(json!({"type": "item_close", "uuid": key, "args": {"id": ext}})),
                other => Err(format!("unknown operation {other}")),
            },
        };
        match command {
            Err(reason) => set_state(&mut tx, &id, DeliveryState::NeedsReview, None, Some(&reason), None).await?,
            Ok(command) => {
                sqlx::query("UPDATE focus_delivery SET state='sending',attempts=attempts+1,updated_at=? WHERE id=?")
                    .bind(stamp(Utc::now())).bind(&id).execute(&mut *tx).await?;
                claimed.push(Claimed {
                    id,
                    command_uuid: key.unwrap_or_default(),
                    temp_id: temp,
                    attempts: row.get::<i64, _>("attempts") + 1,
                    command,
                });
            }
        }
    }
    tx.commit().await?;
    Ok(claimed)
}

enum Outcome {
    Acknowledged(String),
    Retry(Option<u64>, String),
    Auth,
    Uncertain(String),
    Review(String),
}

fn command_outcome(c: &Claimed, resp: &SyncResponse) -> Outcome {
    let Some(status) = resp.sync_status.get(&c.command_uuid) else {
        return Outcome::Uncertain("accepted response had no status for this command".into());
    };
    if crate::integrations::todoist::client::command_ok(status) {
        let receipt = c.temp_id.as_ref().and_then(|t| resp.temp_id_mapping.get(t)).cloned().unwrap_or_else(|| "ok".into());
        return Outcome::Acknowledged(receipt);
    }
    let detail = status.to_string();
    let tag = status.get("error_tag").and_then(Value::as_str).unwrap_or("");
    match status.get("http_code").and_then(Value::as_u64) {
        Some(401 | 403) => Outcome::Auth,
        Some(429) => Outcome::Retry(status.pointer("/error_extra/retry_after").and_then(Value::as_u64), detail),
        Some(code) if code >= 500 => Outcome::Retry(None, detail),
        Some(404 | 410) => Outcome::Review(format!("gone: {detail}")),
        _ if tag.contains("NOT_FOUND") => Outcome::Review(format!("gone: {detail}")),
        _ => Outcome::Review(format!("rejected: {detail}")),
    }
}

async fn apply_outcomes(
    pool: &SqlitePool,
    claimed: &[Claimed],
    result: Result<SyncResponse, TransportError>,
    now: DateTime<Utc>,
    fingerprint: &str,
    report: &mut DispatchReport,
) -> crate::Result<()> {
    let outcomes: Vec<Outcome> = match &result {
        Ok(resp) => claimed.iter().map(|c| command_outcome(c, resp)).collect(),
        Err(e) => claimed.iter().map(|_| match e {
            TransportError::NotSent(m) => Outcome::Retry(None, format!("not sent: {m}")),
            TransportError::Transient(ra) => Outcome::Retry(*ra, "service unavailable".into()),
            TransportError::RateLimited(ra) => Outcome::Retry(*ra, "rate limited".into()),
            TransportError::Auth => Outcome::Auth,
            TransportError::Uncertain(m) => Outcome::Uncertain(m.clone()),
            TransportError::Gone => Outcome::Review("gone: Todoist answered 404/410".into()),
            TransportError::Rejected(m) => Outcome::Review(format!("rejected: {m}")),
        }).collect(),
    };
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    for (c, outcome) in claimed.iter().zip(outcomes) {
        match outcome {
            Outcome::Acknowledged(receipt) => {
                report.acknowledged += 1;
                set_state(&mut tx, &c.id, DeliveryState::Acknowledged, None, None, Some(&receipt)).await?;
            }
            Outcome::Retry(retry_after, detail) => {
                report.retrying += 1;
                let next = now + chrono::Duration::seconds(backoff_secs(c.attempts, retry_after) as i64);
                set_state(&mut tx, &c.id, DeliveryState::RetryableError, Some(stamp(next)), Some(&detail), None).await?;
            }
            Outcome::Auth => {
                report.retrying += 1;
                report.auth_paused = true;
                set_state(&mut tx, &c.id, DeliveryState::RetryableError, None, Some("auth: reconnect Todoist to resume"), None).await?;
            }
            Outcome::Uncertain(detail) => {
                report.uncertain += 1;
                set_state(&mut tx, &c.id, DeliveryState::Uncertain, None, Some(&detail), None).await?;
            }
            Outcome::Review(detail) => {
                report.needs_review += 1;
                set_state(&mut tx, &c.id, DeliveryState::NeedsReview, None, Some(&detail), None).await?;
            }
        }
    }
    if report.auth_paused {
        sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
            .bind(AUTH_PAUSE_SETTING).bind(fingerprint).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Send due operations through the existing Todoist sync cycle (never its own
/// poller). Sends nothing while the bridge is off or auth is paused for the
/// current credential. Local completion state is never touched here.
pub async fn dispatch_due<T: SyncTransport>(
    pool: &SqlitePool,
    transport: &T,
    now: DateTime<Utc>,
) -> crate::Result<DispatchReport> {
    let _guard = DISPATCH_LOCK.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let mut report = DispatchReport::default();
    recover_interrupted(pool).await?;
    let mut conn = pool.acquire().await?;
    if !enabled(&mut conn).await? {
        report.skipped = Some("disabled".into());
        return Ok(report);
    }
    let fingerprint = transport.credential_fingerprint();
    let paused: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(AUTH_PAUSE_SETTING).fetch_optional(&mut *conn).await?;
    match paused {
        Some(p) if p == fingerprint => {
            report.auth_paused = true;
            report.skipped = Some("auth paused until Todoist is reconnected".into());
            return Ok(report);
        }
        Some(_) => {
            sqlx::query("DELETE FROM settings WHERE key=?").bind(AUTH_PAUSE_SETTING).execute(&mut *conn).await?;
        }
        None => {}
    }
    drop(conn);
    let claimed = claim_due(pool, now).await?;
    if claimed.is_empty() {
        return Ok(report);
    }
    let commands: Vec<Value> = claimed.iter().map(|c| c.command.clone()).collect();
    report.sent = claimed.len();
    let result = transport.send_commands(&commands).await;
    apply_outcomes(pool, &claimed, result, now, &fingerprint, &mut report).await?;
    Ok(report)
}
