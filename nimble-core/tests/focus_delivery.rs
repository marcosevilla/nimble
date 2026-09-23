//! Task 11: optional Todoist time comments and pending reconciliation.
//! Every transport here is an in-process mock or a loopback listener; no
//! test reaches Todoist.
#[path = "common/focus.rs"]
mod fixture;

use fixture::Harness;
use nimble_core::focus_types::{FocusAction, FocusConfig, FocusMode, FocusSource, LegacyFocusFiles};
use nimble_core::integrations::todoist::client::{SyncResponse, SyncTransport, TransportError};
use nimble_core::integrations::todoist::focus_delivery::{
    self as delivery, comment_text, delivery_for_completion, DeliveryResolution, DeliveryState,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::VecDeque;
use std::sync::Mutex;

#[test]
fn historical_or_unmapped_time_never_becomes_comment() {
 use nimble_core::integrations::todoist::focus_delivery::delivery_for_completion;
 assert!(delivery_for_completion("occ",59_999,None,Some("remote"),true).is_none());
 assert!(delivery_for_completion("occ",60_000,None,None,true).is_none());
 assert!(delivery_for_completion("occ",60_000,None,Some("remote"),false).is_none());
 assert!(delivery_for_completion("occ",60_000,None,Some("remote"),true).is_some());
}

#[test]
fn comment_rounds_like_the_old_formatter_and_keeps_exact_ms() {
    assert_eq!(comment_text(59_999, None), None);
    assert_eq!(comment_text(60_000, None).as_deref(), Some("⏱ 1m spent"));
    assert_eq!(comment_text(89_999, None).as_deref(), Some("⏱ 1m spent"));
    // JS Math.round rounds a half minute up.
    assert_eq!(comment_text(90_000, None).as_deref(), Some("⏱ 2m spent"));
    assert_eq!(comment_text(1_530_000, Some(1_500_000)).as_deref(), Some("⏱ 26m spent (timebox 25m)"));
    let intent = delivery_for_completion("occ", 61_234, Some(1_500_000), Some("remote"), true).unwrap();
    assert_eq!(intent.recorded_ms, 61_234);
    assert_eq!(intent.content, "⏱ 1m spent (timebox 25m)");
    assert_eq!(intent.external_id, "remote");
    assert_eq!(intent.occurrence_id, "occ");
    assert_eq!(intent.state, DeliveryState::Pending);
    assert!(!intent.operation_id.is_empty() && !intent.temp_id.is_empty());
    assert!(delivery_for_completion("occ", 60_000, None, Some(""), true).is_none(), "blank remote id is unmapped");
}

// ── helpers ────────────────────────────────────────────────────────────────

async fn enable(pool: &SqlitePool) {
    nimble_core::db::settings::set_setting(pool, delivery::ENABLED_SETTING, "1").await.unwrap();
}

async fn map(pool: &SqlitePool, task_id: &str, remote: &str) {
    sqlx::query("UPDATE local_tasks SET external_id=?,external_source='todoist' WHERE id=?")
        .bind(remote).bind(task_id).execute(pool).await.unwrap();
}

async fn queue(h: &Harness, task_id: &str) -> String {
    h.send(FocusAction::Enqueue { task_ids: vec![task_id.into()], source: FocusSource::Today, explicit_still_open: false })
        .await.unwrap();
    h.snapshot().await.queue.iter().find(|e| e.task_id == task_id).unwrap().occurrence_id.clone()
}

/// Work in heartbeat-sized steps (a single delta over 40 s is a gap, not work).
async fn work(h: &Harness, oid: &str, ms: u64) {
    h.send(FocusAction::Start { occurrence_id: oid.into() }).await.unwrap();
    let mut left = ms;
    while left > 0 {
        let step = left.min(20_000);
        h.advance(step).await;
        left -= step;
    }
    h.send(FocusAction::Pause).await.unwrap();
}

async fn complete(h: &Harness, oid: &str) {
    h.send(FocusAction::Complete { occurrence_id: oid.into() }).await.unwrap();
}

async fn rows(pool: &SqlitePool) -> Vec<(String, String, String, Value, Option<String>, Option<String>)> {
    sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>)>(
        "SELECT id,purpose,state,payload_json,idempotency_key,temp_id FROM focus_delivery ORDER BY created_at,id")
        .fetch_all(pool).await.unwrap()
        .into_iter().map(|(a, b, c, d, e, f)| (a, b, c, serde_json::from_str(&d).unwrap(), e, f)).collect()
}

async fn state_of(pool: &SqlitePool, id: &str) -> String {
    sqlx::query_scalar("SELECT state FROM focus_delivery WHERE id=?").bind(id).fetch_one(pool).await.unwrap()
}

fn resp(v: Value) -> SyncResponse {
    serde_json::from_value(v).unwrap()
}

type Reply = Box<dyn Fn(&[Value]) -> Result<SyncResponse, TransportError> + Send>;

/// Scripted transport: each call pops the next reply; records every command.
struct Mock {
    fingerprint: Mutex<String>,
    script: Mutex<VecDeque<Reply>>,
    sent: Mutex<Vec<Vec<Value>>>,
}

impl Mock {
    fn new() -> Self {
        Self { fingerprint: Mutex::new("cred-a".into()), script: Mutex::new(VecDeque::new()), sent: Mutex::new(Vec::new()) }
    }
    fn then(&self, reply: impl Fn(&[Value]) -> Result<SyncResponse, TransportError> + Send + 'static) -> &Self {
        self.script.lock().unwrap().push_back(Box::new(reply));
        self
    }
    fn calls(&self) -> usize {
        self.sent.lock().unwrap().len()
    }
    fn last(&self) -> Vec<Value> {
        self.sent.lock().unwrap().last().cloned().unwrap_or_default()
    }
}

impl SyncTransport for Mock {
    fn credential_fingerprint(&self) -> String {
        self.fingerprint.lock().unwrap().clone()
    }
    async fn send_commands(&self, commands: &[Value]) -> Result<SyncResponse, TransportError> {
        self.sent.lock().unwrap().push(commands.to_vec());
        let reply = self.script.lock().unwrap().pop_front().expect("unexpected send");
        reply(commands)
    }
}

/// Every command succeeds; comments get a created note id.
fn all_ok(commands: &[Value]) -> Result<SyncResponse, TransportError> {
    let mut status = serde_json::Map::new();
    let mut mapping = serde_json::Map::new();
    for c in commands {
        status.insert(c["uuid"].as_str().unwrap().into(), json!("ok"));
        if let Some(t) = c.get("temp_id").and_then(Value::as_str) {
            mapping.insert(t.into(), json!(format!("note-{}", &t[..8])));
        }
    }
    Ok(resp(json!({"sync_status": status, "temp_id_mapping": mapping})))
}

fn now() -> chrono::DateTime<chrono::Utc> {
    chrono::Utc::now()
}

/// A mapped task completed with `ms` of new work while the bridge is on.
async fn completed_mapped(h: &Harness, title: &str, remote: &str, ms: u64) -> String {
    let task = h.task(title).await;
    map(&h.pool, &task, remote).await;
    let oid = queue(h, &task).await;
    work(h, &oid, ms).await;
    complete(h, &oid).await;
    oid
}

// ── completion transaction ────────────────────────────────────────────────

#[tokio::test]
async fn bridge_off_by_default_persists_nothing_and_sends_nothing() {
    let h = Harness::new().await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    assert!(rows(&h.pool).await.is_empty(), "default-off bridge writes no intent");
    let mock = Mock::new();
    let report = delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 0);
    assert_eq!(report.sent, 0);
}

#[tokio::test]
async fn completion_persists_one_comment_intent_with_exact_new_time() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    let task = h.task("Timeboxed").await;
    map(&h.pool, &task, "R1").await;
    let oid = queue(&h, &task).await;
    h.send(FocusAction::Configure { occurrence_id: oid.clone(), config: FocusConfig {
        mode: FocusMode::Timebox, budget_ms: Some(1_500_000), work_ms: 1_500_000, break_ms: 300_000, rounds: 1 } })
        .await.unwrap();
    // Imported historical time on the same occurrence is never reported.
    sqlx::query("INSERT INTO focus_import_batches(id,source_namespace,file_hashes_json,preview_hash,mappings_json,created_at) VALUES('b','legacy','{}','p','{}','2026-09-22T00:00:00Z')")
        .execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_totals(id,source_namespace,record_key,occurrence_id,duration_ms,source_kind,batch_id,inclusion) VALUES('t','legacy','timer:x',?,600000,'timer','b','included')")
        .bind(&oid).execute(&h.pool).await.unwrap();
    work(&h, &oid, 40_000).await;
    work(&h, &oid, 21_000).await; // accumulates across sessions
    complete(&h, &oid).await;

    let all = rows(&h.pool).await;
    assert_eq!(all.len(), 1);
    let (_, purpose, state, payload, key, temp) = &all[0];
    assert_eq!((purpose.as_str(), state.as_str()), ("time_comment", "pending"));
    assert_eq!(payload["recorded_ms"], 61_000);
    assert_eq!(payload["budget_ms"], 1_500_000);
    assert_eq!(payload["content"], "⏱ 1m spent (timebox 25m)");
    assert!(key.as_deref().is_some_and(|k| !k.is_empty()) && temp.as_deref().is_some_and(|t| !t.is_empty()));
    // The local ledger keeps the full total (imported + new).
    let history = h.service.history(None, Some(task.clone())).await.unwrap();
    assert_eq!(history.rows[0].total_ms, 661_000);
}

#[tokio::test]
async fn threshold_imported_only_and_local_only_never_create_intents() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Short", "R1", 59_999).await;

    // Imported-only time: no new sessions at all.
    let imported = h.task("Imported only").await;
    map(&h.pool, &imported, "R2").await;
    let oid = queue(&h, &imported).await;
    sqlx::query("INSERT INTO focus_import_batches(id,source_namespace,file_hashes_json,preview_hash,mappings_json,created_at) VALUES('b','legacy','{}','p','{}','2026-09-22T00:00:00Z')")
        .execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_totals(id,source_namespace,record_key,occurrence_id,duration_ms,source_kind,batch_id,inclusion) VALUES('t','legacy','timer:y',?,900000,'timer','b','included')")
        .bind(&oid).execute(&h.pool).await.unwrap();
    complete(&h, &oid).await;

    // Local-only task with a stale remote id never writes to Todoist.
    let local = h.task("Nimble only").await;
    map(&h.pool, &local, "R3").await;
    sqlx::query("UPDATE local_tasks SET sync_policy='local_only' WHERE id=?").bind(&local).execute(&h.pool).await.unwrap();
    let oid = queue(&h, &local).await;
    work(&h, &oid, 120_000).await;
    complete(&h, &oid).await;

    // Unmapped native task.
    let unmapped = h.task("Unmapped").await;
    let oid = queue(&h, &unmapped).await;
    work(&h, &oid, 120_000).await;
    complete(&h, &oid).await;

    assert!(rows(&h.pool).await.is_empty());
}

#[tokio::test]
async fn exactly_sixty_seconds_is_enough() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Minute", "R1", 60_000).await;
    let all = rows(&h.pool).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].3["content"], "⏱ 1m spent");
}

#[tokio::test]
async fn duplicate_occurrence_intent_is_ignored() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    let oid = completed_mapped(&h, "Once", "R1", 61_000).await;
    let task: String = sqlx::query_scalar("SELECT original_task_id FROM focus_occurrences WHERE id=?")
        .bind(&oid).fetch_one(&h.pool).await.unwrap();
    let mut conn = h.pool.acquire().await.unwrap();
    let again = delivery::enqueue_completion_tx(&mut conn, &oid, &task, None).await.unwrap();
    assert!(again.is_none(), "one summary per occurrence");
    drop(conn);
    assert_eq!(rows(&h.pool).await.len(), 1);
}

#[tokio::test]
async fn recurring_completion_keeps_one_due_update_and_only_adds_a_comment() {
    let h = Harness::new().await;
    nimble_core::integrations::ensure_state(&h.pool, "todoist").await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool, "todoist_api_token", "synthetic").await.unwrap();
    enable(&h.pool).await;
    let task = nimble_core::db::tasks::create_local_task(&h.pool, nimble_core::types::CreateTaskInput {
        content: "Daily".into(), due_date: Some("2026-09-22".into()), recurrence_rule: Some("every day".into()),
        ..Default::default() }).await.unwrap().id;
    map(&h.pool, &task, "R9").await;
    sqlx::query("DELETE FROM todoist_outbox").execute(&h.pool).await.unwrap();
    let oid = queue(&h, &task).await;
    work(&h, &oid, 61_000).await;
    sqlx::query("DELETE FROM todoist_outbox").execute(&h.pool).await.unwrap();
    complete(&h, &oid).await;
    let ops: Vec<String> = sqlx::query_scalar("SELECT op FROM todoist_outbox WHERE local_id=?")
        .bind(&task).fetch_all(&h.pool).await.unwrap();
    assert!(!ops.contains(&"close".to_string()), "{ops:?}");
    assert_eq!(ops.iter().filter(|o| *o == "update").count(), 1, "{ops:?}");
    let all = rows(&h.pool).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].1, "time_comment");
}

// ── dispatch ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn success_sends_note_add_once_with_stable_keys() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, _, _, _, key, temp) = rows(&h.pool).await.remove(0);
    let mock = Mock::new();
    mock.then(all_ok);
    let report = delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!((report.sent, report.acknowledged), (1, 1));
    let cmd = &mock.last()[0];
    assert_eq!(cmd["type"], "note_add");
    assert_eq!(cmd["uuid"].as_str(), key.as_deref());
    assert_eq!(cmd["temp_id"].as_str(), temp.as_deref());
    assert_eq!(cmd["args"], json!({"item_id": "R1", "content": "⏱ 1m spent"}));
    assert_eq!(state_of(&h.pool, &id).await, "acknowledged");
    let receipt: String = sqlx::query_scalar("SELECT remote_receipt FROM focus_delivery WHERE id=?")
        .bind(&id).fetch_one(&h.pool).await.unwrap();
    assert!(receipt.starts_with("note-"));
    // Repeated dispatch never resends an acknowledged comment.
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 1);
}

#[tokio::test]
async fn timeout_after_accept_is_uncertain_and_never_auto_retried() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, _, _, _, key, temp) = rows(&h.pool).await.remove(0);
    let mock = Mock::new();
    mock.then(|_| Err(TransportError::Uncertain("timed out after the request was sent".into())));
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(state_of(&h.pool, &id).await, "uncertain");
    // Later cycles, the outbox's own crash recovery and a restart leave it alone.
    nimble_core::integrations::todoist::outbox::reset_stuck_sending(&h.pool).await.unwrap();
    delivery::dispatch_due(&h.pool, &mock, now() + chrono::Duration::days(30)).await.unwrap();
    assert_eq!(mock.calls(), 1);
    assert_eq!(state_of(&h.pool, &id).await, "uncertain");

    // Explicit adoption after verifying it did not arrive re-arms the SAME keys
    // (Todoist deduplicates by command uuid).
    let item = delivery::resolve_delivery(&h.pool, &id, DeliveryResolution::AdoptVerifiedUndelivered,
        "Checked the task in Todoist: no ⏱ comment".into()).await.unwrap();
    assert_eq!(item.state, DeliveryState::Pending);
    mock.then(all_ok);
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    let cmd = &mock.last()[0];
    assert_eq!(cmd["uuid"].as_str(), key.as_deref());
    assert_eq!(cmd["temp_id"].as_str(), temp.as_deref());
    assert_eq!(state_of(&h.pool, &id).await, "acknowledged");
}

#[tokio::test]
async fn restart_mid_send_becomes_uncertain_not_a_resend() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, ..) = rows(&h.pool).await.remove(0);
    // A crash between claim and response leaves the row 'sending'.
    sqlx::query("UPDATE focus_delivery SET state='sending',attempts=1 WHERE id=?").bind(&id).execute(&h.pool).await.unwrap();
    nimble_core::integrations::todoist::outbox::reset_stuck_sending(&h.pool).await.unwrap();
    assert_eq!(state_of(&h.pool, &id).await, "sending", "the task outbox recovery never touches focus deliveries");
    let mock = Mock::new();
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 0);
    assert_eq!(state_of(&h.pool, &id).await, "uncertain");
}

#[tokio::test]
async fn auth_pauses_until_reconnected() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, ..) = rows(&h.pool).await.remove(0);
    let mock = Mock::new();
    mock.then(|_| Err(TransportError::Auth));
    let report = delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert!(report.auth_paused);
    assert_eq!(state_of(&h.pool, &id).await, "retryable-error");
    // Same credential: paused, nothing sent, however long it waits.
    let report = delivery::dispatch_due(&h.pool, &mock, now() + chrono::Duration::days(3)).await.unwrap();
    assert!(report.auth_paused);
    assert_eq!(mock.calls(), 1);
    // Reconnected (a different credential): resumes with the same key.
    *mock.fingerprint.lock().unwrap() = "cred-b".into();
    mock.then(all_ok);
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 2);
    assert_eq!(state_of(&h.pool, &id).await, "acknowledged");
}

#[tokio::test]
async fn rate_limit_honors_retry_after_and_backoff_is_bounded_without_expiry() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, _, _, _, key, _) = rows(&h.pool).await.remove(0);
    let mock = Mock::new();
    let t0 = now();
    mock.then(|_| Err(TransportError::RateLimited(Some(120))));
    delivery::dispatch_due(&h.pool, &mock, t0).await.unwrap();
    assert_eq!(state_of(&h.pool, &id).await, "retryable-error");
    delivery::dispatch_due(&h.pool, &mock, t0 + chrono::Duration::seconds(119)).await.unwrap();
    assert_eq!(mock.calls(), 1, "Retry-After is honored");
    // Many transient failures: the delay never exceeds the cap, the row never expires.
    let mut at = t0 + chrono::Duration::seconds(121);
    for _ in 0..12 {
        mock.then(|_| Err(TransportError::Transient(None)));
        delivery::dispatch_due(&h.pool, &mock, at).await.unwrap();
        let next: String = sqlx::query_scalar("SELECT next_attempt_at FROM focus_delivery WHERE id=?")
            .bind(&id).fetch_one(&h.pool).await.unwrap();
        let next = chrono::DateTime::parse_from_rfc3339(&next).unwrap().with_timezone(&chrono::Utc);
        assert!(next - at <= chrono::Duration::seconds(delivery::MAX_BACKOFF_SECS as i64));
        at = next;
    }
    assert_eq!(mock.calls(), 13);
    assert_eq!(state_of(&h.pool, &id).await, "retryable-error");
    for call in mock.sent.lock().unwrap().iter() {
        assert_eq!(call[0]["uuid"].as_str(), key.as_deref(), "every retry reuses one operation key");
    }
}

#[tokio::test]
async fn gone_task_needs_review_and_rejected_request_is_not_retried() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Gone", "R1", 61_000).await;
    completed_mapped(&h, "Kept", "R2", 61_000).await;
    let all = rows(&h.pool).await;
    let mock = Mock::new();
    mock.then(|cmds| {
        let mut status = serde_json::Map::new();
        for c in cmds {
            let v = if c["args"]["item_id"] == "R1" {
                json!({"error": "Item not found", "error_code": 22, "http_code": 404, "error_tag": "ITEM_NOT_FOUND"})
            } else {
                json!({"error": "Invalid argument", "error_code": 19, "http_code": 400})
            };
            status.insert(c["uuid"].as_str().unwrap().into(), v);
        }
        Ok(resp(json!({"sync_status": status})))
    });
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    for (id, ..) in &all {
        assert_eq!(state_of(&h.pool, id).await, "needs-review");
    }
    mock.then(|_| Err(TransportError::Gone));
    delivery::dispatch_due(&h.pool, &mock, now() + chrono::Duration::days(1)).await.unwrap();
    assert_eq!(mock.calls(), 1);
}

#[tokio::test]
async fn missing_command_status_is_uncertain() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, ..) = rows(&h.pool).await.remove(0);
    let mock = Mock::new();
    mock.then(|_| Ok(resp(json!({"sync_status": {}}))));
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(state_of(&h.pool, &id).await, "uncertain");
}

// ── reconciliation of imported pending operations ───────────────────────────

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/focus/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
}

const LEGACY_REMOTE: &str = "90071992547409931234";

async fn import_pending(h: &Harness) {
    let files = LegacyFocusFiles {
        source_namespace: "focus-queue".into(),
        state_json: None,
        manual_json: None,
        pending_json: Some(fixture("pending.json")),
    };
    let preview = nimble_core::db::focus::import::preview_import(&h.pool, &files).await.unwrap();
    h.service.commit_import(&files, &preview.preview_token, &uuid::Uuid::new_v4().to_string()).await.unwrap();
}

async fn legacy_task(h: &Harness, recurring: bool) -> String {
    let task = nimble_core::db::tasks::create_local_task(&h.pool, nimble_core::types::CreateTaskInput {
        content: "Legacy target".into(),
        due_date: recurring.then(|| "2026-09-22".into()),
        recurrence_rule: recurring.then(|| "every day".into()),
        ..Default::default() }).await.unwrap().id;
    map(&h.pool, &task, LEGACY_REMOTE).await;
    task
}

#[tokio::test]
async fn imported_pending_operations_are_listed_as_evidence_and_never_replayed() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    legacy_task(&h, false).await;
    import_pending(&h).await;
    let items = delivery::review(&h.pool).await.unwrap();
    let legacy: Vec<_> = items.iter().filter(|i| i.origin == "legacy_import").collect();
    assert_eq!(legacy.len(), 2);
    assert!(legacy.iter().all(|i| i.state == DeliveryState::NeedsReview));
    let comment = legacy.iter().find(|i| i.purpose == "legacy_comment").unwrap();
    assert_eq!(comment.content.as_deref(), Some("Synthetic tracked-time comment"));
    assert_eq!(comment.evidence["attempts"], 7, "raw evidence is shown");
    assert_eq!(comment.task_title.as_deref(), Some("Legacy target"));
    // Even with the bridge on, nothing is armed or sent.
    let mock = Mock::new();
    delivery::dispatch_due(&h.pool, &mock, now() + chrono::Duration::days(365)).await.unwrap();
    assert_eq!(mock.calls(), 0);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM focus_delivery").fetch_one(&h.pool).await.unwrap(), 0);

    // Acknowledging a verified-delivered operation is durable and sends nothing.
    let close = legacy.iter().find(|i| i.purpose == "legacy_close").unwrap();
    let done = delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::Acknowledged,
        "Task shows completed in Todoist on 2025-09-22".into()).await.unwrap();
    assert_eq!(done.state, DeliveryState::Acknowledged);
    assert_eq!(done.resolution.as_ref().unwrap()["evidence"], "Task shows completed in Todoist on 2025-09-22");
    let again = delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::Acknowledged, "twice".into()).await;
    assert!(again.is_err(), "a resolved item cannot be resolved again");
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 0);
    // Blank evidence is refused.
    assert!(delivery::resolve_delivery(&h.pool, &comment.id, DeliveryResolution::ArchiveWithReason, "  ".into()).await.is_err());
}

#[tokio::test]
async fn old_close_cannot_close_a_recurring_task() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    legacy_task(&h, true).await;
    import_pending(&h).await;
    let items = delivery::review(&h.pool).await.unwrap();
    let close = items.iter().find(|i| i.purpose == "legacy_close").unwrap();
    assert!(close.recurring_task);
    assert!(!close.adoptable);
    let refused = delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::AdoptVerifiedUndelivered,
        "not closed in Todoist".into()).await;
    assert!(refused.is_err());
    let still = delivery::review(&h.pool).await.unwrap();
    assert_eq!(still.iter().find(|i| i.id == close.id).unwrap().state, DeliveryState::NeedsReview);
    // Archiving with a reason is the way out.
    let archived = delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::ArchiveWithReason,
        "Repeating task already moved on".into()).await.unwrap();
    assert_eq!(archived.state, DeliveryState::Archived);
}

#[tokio::test]
async fn adopting_a_legacy_close_is_refused_and_no_item_close_is_ever_built() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    legacy_task(&h, false).await; // open, nonrecurring, mapped: the most permissive case
    import_pending(&h).await;
    let items = delivery::review(&h.pool).await.unwrap();
    let close = items.iter().find(|i| i.purpose == "legacy_close").unwrap();
    assert!(!close.adoptable);
    assert!(close.adopt_blocked_reason.as_deref().unwrap().contains("Complete the task in Nimble"));
    let refused = delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::AdoptVerifiedUndelivered,
        "not closed in Todoist".into()).await;
    assert!(refused.unwrap_err().to_string().contains("never replayed"));

    // Even a close row armed by hand (e.g. an older build) is never sent.
    delivery::resolve_delivery(&h.pool, &close.id, DeliveryResolution::ArchiveWithReason, "testing".into()).await.unwrap();
    sqlx::query("UPDATE focus_delivery SET state='pending',idempotency_key='forced-key' WHERE id=?")
        .bind(&close.id).execute(&h.pool).await.unwrap();
    let mock = Mock::new();
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert_eq!(mock.calls(), 0);
    assert_eq!(state_of(&h.pool, &close.id).await, "needs-review");
    let src = include_str!("../src/integrations/todoist/focus_delivery.rs");
    assert!(!src.contains("\"item_close\""), "focus_delivery must never build an item_close command");
}

#[tokio::test]
async fn adopted_legacy_comment_sends_once_and_retries_only_itself() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    legacy_task(&h, false).await;
    import_pending(&h).await;
    let items = delivery::review(&h.pool).await.unwrap();
    let comment = items.iter().find(|i| i.purpose == "legacy_comment").unwrap().id.clone();
    delivery::resolve_delivery(&h.pool, &comment, DeliveryResolution::AdoptVerifiedUndelivered,
        "Verified absent in Todoist; old app stopped".into()).await.unwrap();
    let mock = Mock::new();
    mock.then(|cmds| {
        let mut status = serde_json::Map::new();
        for c in cmds {
            status.insert(c["uuid"].as_str().unwrap().into(), json!({"error": "Service unavailable", "http_code": 503}));
        }
        Ok(resp(json!({"sync_status": status})))
    });
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    let sent = mock.last();
    assert_eq!(sent.len(), 1, "the quarantined close is not sent alongside");
    assert_eq!(sent[0]["type"], "note_add");
    assert_eq!(sent[0]["args"]["content"], "Synthetic tracked-time comment");
    assert_eq!(state_of(&h.pool, &comment).await, "retryable-error");
    mock.then(all_ok);
    delivery::dispatch_due(&h.pool, &mock, now() + chrono::Duration::hours(2)).await.unwrap();
    assert_eq!(mock.last()[0]["uuid"], sent[0]["uuid"]);
    assert_eq!(state_of(&h.pool, &comment).await, "acknowledged");
}

#[tokio::test]
async fn native_close_and_time_comment_are_acknowledged_separately() {
    let h = Harness::new().await;
    nimble_core::integrations::ensure_state(&h.pool, "todoist").await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool, "todoist_api_token", "synthetic").await.unwrap();
    enable(&h.pool).await;
    let task = h.task("One-off").await;
    map(&h.pool, &task, "R1").await;
    sqlx::query("DELETE FROM todoist_outbox").execute(&h.pool).await.unwrap();
    let oid = queue(&h, &task).await;
    work(&h, &oid, 61_000).await;
    complete(&h, &oid).await;
    let close: (String, String) = sqlx::query_as("SELECT id,status FROM todoist_outbox WHERE local_id=? AND op='close'")
        .bind(&task).fetch_one(&h.pool).await.unwrap();
    assert_eq!(close.1, "pending");
    let mock = Mock::new();
    mock.then(|_| Err(TransportError::Uncertain("timed out".into())));
    delivery::dispatch_due(&h.pool, &mock, now()).await.unwrap();
    assert!(mock.last().iter().all(|c| c["type"] == "note_add"));
    // The comment's failure never touches (or resends) the task's own close.
    let after: String = sqlx::query_scalar("SELECT status FROM todoist_outbox WHERE id=?")
        .bind(&close.0).fetch_one(&h.pool).await.unwrap();
    assert_eq!(after, "pending");
    assert_eq!(rows(&h.pool).await[0].2, "uncertain");
}

// ── completion paths beyond the focus Complete action ───────────────────────

async fn queued_with_work(h: &Harness, title: &str, remote: &str, ms: u64) -> (String, String) {
    let task = h.task(title).await;
    map(&h.pool, &task, remote).await;
    let oid = queue(h, &task).await;
    work(h, &oid, ms).await;
    (task, oid)
}

#[tokio::test]
async fn task_list_completion_creates_one_intent_and_a_repeat_adds_none() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    let (task, oid) = queued_with_work(&h, "List", "R1", 60_000).await;
    nimble_core::db::tasks::update_task_status(&h.pool, &task, "complete", None).await.unwrap();
    let all = rows(&h.pool).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].3["recorded_ms"], 60_000);
    let occurrence: String = sqlx::query_scalar("SELECT state FROM focus_occurrences WHERE id=?")
        .bind(&oid).fetch_one(&h.pool).await.unwrap();
    assert_eq!(occurrence, "completed");
    // Completing again, or asking the hook again, never adds a second summary.
    nimble_core::db::tasks::update_task_status(&h.pool, &task, "complete", None).await.unwrap();
    let mut conn = h.pool.acquire().await.unwrap();
    assert!(delivery::enqueue_completion_tx(&mut conn, &oid, &task, None).await.unwrap().is_none());
    drop(conn);
    assert_eq!(rows(&h.pool).await.len(), 1);
}

#[tokio::test]
async fn agent_or_dt_native_completion_creates_one_intent() {
    use nimble_core::db::focus::engine::{NativeTaskAction, NativeTaskCommand};
    let h = Harness::new().await;
    enable(&h.pool).await;
    let (task, _) = queued_with_work(&h, "Agent", "R1", 61_000).await;
    let command = NativeTaskCommand { command_id: uuid::Uuid::new_v4().to_string(),
        action: NativeTaskAction::SetStatus { id: task.clone(), status: "complete".into(), note: None, expected_due_date: None } };
    h.service.execute_native_task(command.clone()).await.unwrap();
    h.service.execute_native_task(command).await.unwrap(); // replayed receipt
    let all = rows(&h.pool).await;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].3["content"], "⏱ 1m spent");
}

#[tokio::test]
async fn native_completion_under_a_minute_or_unmapped_creates_none() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    let (short, _) = queued_with_work(&h, "Short", "R1", 59_999).await;
    nimble_core::db::tasks::update_task_status(&h.pool, &short, "complete", None).await.unwrap();
    let local = h.task("Local").await;
    let oid = queue(&h, &local).await;
    work(&h, &oid, 90_000).await;
    nimble_core::db::tasks::update_task_status(&h.pool, &local, "complete", None).await.unwrap();
    assert!(rows(&h.pool).await.is_empty());
}

#[tokio::test]
async fn remote_apply_completion_creates_no_comment() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    let (_, headless_oid) = queued_with_work(&h, "Remote headless", "RH", 90_000).await;
    let (_, owned_oid) = queued_with_work(&h, "Remote owned", "RO", 90_000).await;
    let pulled = |id: &str| resp(json!({"sync_token": format!("T-{id}"), "items": [
        {"id": id, "content": "done remotely", "checked": true, "is_deleted": false}]}));
    nimble_core::integrations::todoist::sync_loop::apply_pull(&h.pool, &pulled("RH")).await.unwrap();
    nimble_core::integrations::todoist::sync_loop::apply_pull_with_focus(&h.pool, &pulled("RO"), Some(&h.service)).await.unwrap();
    for oid in [&headless_oid, &owned_oid] {
        let state: String = sqlx::query_scalar("SELECT state FROM focus_occurrences WHERE id=?")
            .bind(oid).fetch_one(&h.pool).await.unwrap();
        assert_eq!(state, "completed", "the remote completion did reach focus");
    }
    assert!(rows(&h.pool).await.is_empty(), "remote completions never echo a comment");
}

#[tokio::test]
async fn unmapped_legacy_operation_cannot_be_adopted() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    import_pending(&h).await; // no Nimble task carries the legacy remote id
    let items = delivery::review(&h.pool).await.unwrap();
    let comment = items.iter().find(|i| i.purpose == "legacy_comment").unwrap();
    assert!(!comment.adoptable);
    assert!(delivery::resolve_delivery(&h.pool, &comment.id, DeliveryResolution::AdoptVerifiedUndelivered,
        "verified".into()).await.is_err());
}

#[tokio::test]
async fn restored_profile_quarantines_armed_deliveries() {
    let h = Harness::new().await;
    enable(&h.pool).await;
    completed_mapped(&h, "Mapped", "R1", 61_000).await;
    let (id, ..) = rows(&h.pool).await.remove(0);
    nimble_core::db::recovery::normalize_focus_restore(&h.pool).await.unwrap();
    assert_eq!(state_of(&h.pool, &id).await, "needs-review");
}

// ── HTTP transport classification (loopback only) ───────────────────────────

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

async fn listener() -> Option<TcpListener> {
    match TcpListener::bind("127.0.0.1:0").await {
        Ok(v) => Some(v),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            eprintln!("local socket denied by sandbox; run this test with loopback permission");
            None
        }
        Err(e) => panic!("loopback bind failed: {e}"),
    }
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await.unwrap();
        if n == 0 { break; }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&bytes[..end + 4]).to_ascii_lowercase();
            let len = header.lines().find_map(|l| l.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
            if bytes.len() >= end + 4 + len { break; }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn respond(stream: &mut tokio::net::TcpStream, status: &str, extra: &str, body: &str) {
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}", body.len());
    stream.write_all(response.as_bytes()).await.unwrap();
}

fn transport(port: u16) -> nimble_core::integrations::todoist::client::HttpSyncTransport {
    let client = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_millis(400)).build().unwrap();
    nimble_core::integrations::todoist::client::HttpSyncTransport::new(client, &format!("http://127.0.0.1:{port}/api/v1/sync"), "fake-token".into()).unwrap()
}

#[tokio::test]
async fn http_transport_classifies_accept_then_timeout_as_uncertain() {
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        tokio::time::sleep(std::time::Duration::from_secs(2)).await; // accepted, never answers in time
        request
    });
    let cmd = json!({"type": "note_add", "uuid": "u-1", "temp_id": "t-1", "args": {"item_id": "R1", "content": "⏱ 1m spent"}});
    let result = transport(port).send_commands(&[cmd]).await;
    assert!(matches!(result, Err(TransportError::Uncertain(_))), "{result:?}");
    let request = server.await.unwrap();
    assert!(request.starts_with("POST /api/v1/sync "), "{request}");
    assert!(request.to_ascii_lowercase().contains("authorization: bearer fake-token"));
    assert!(request.contains("\"uuid\":\"u-1\"") && request.contains("\"temp_id\":\"t-1\""));
}

#[tokio::test]
async fn http_transport_classifies_status_codes() {
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        for (status, extra, body) in [
            ("429 Too Many Requests", "Retry-After: 17\r\n", "{}"),
            ("401 Unauthorized", "", "{}"),
            ("503 Service Unavailable", "", "{}"),
            ("504 Gateway Timeout", "", "{}"),
            ("410 Gone", "", "{}"),
            ("400 Bad Request", "", "{\"error\":\"bad\"}"),
            ("200 OK", "", "{\"sync_status\":{\"u-1\":\"ok\"},\"temp_id_mapping\":{\"t-1\":\"N1\"}}"),
            ("200 OK", "", "not json"),
        ] {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request(&mut stream).await;
            respond(&mut stream, status, extra, body).await;
        }
    });
    let t = transport(port);
    let cmd = [json!({"type": "note_add", "uuid": "u-1", "temp_id": "t-1", "args": {}})];
    assert_eq!(t.send_commands(&cmd).await.unwrap_err(), TransportError::RateLimited(Some(17)));
    assert_eq!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Auth);
    assert_eq!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Transient(None));
    assert!(matches!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Uncertain(_)), "504 may have been processed");
    assert_eq!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Gone);
    assert!(matches!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Rejected(_)));
    let ok = t.send_commands(&cmd).await.unwrap();
    assert_eq!(ok.temp_id_mapping["t-1"], "N1");
    assert!(matches!(t.send_commands(&cmd).await.unwrap_err(), TransportError::Uncertain(_)), "accepted but unreadable");
    server.await.unwrap();
}

#[tokio::test]
async fn http_transport_refused_connection_was_not_sent() {
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let cmd = [json!({"type": "note_add", "uuid": "u-1", "args": {}})];
    assert!(matches!(transport(port).send_commands(&cmd).await.unwrap_err(), TransportError::NotSent(_)));
}

#[tokio::test]
async fn review_never_drops_an_unresolved_row_behind_resolved_history() {
    let h = Harness::new().await;
    // One old uncertain comment, one old auth-paused retry, then 250 newer acknowledged rows.
    for (id, state, created) in [("old-uncertain", "uncertain", "2020-01-01T00:00:00.000Z"),
                                 ("old-retry", "retryable-error", "2020-01-02T00:00:00.000Z")] {
        sqlx::query("INSERT INTO focus_delivery(id,purpose,native_task_id,external_id,payload_json,idempotency_key,temp_id,state,created_at) VALUES(?,'time_comment',NULL,'R1','{}','k','t',?,?)")
            .bind(id).bind(state).bind(created).execute(&h.pool).await.unwrap();
    }
    for n in 0..250 {
        sqlx::query("INSERT INTO focus_delivery(id,purpose,external_id,payload_json,state,created_at) VALUES(?,'time_comment','R1','{}','acknowledged',?)")
            .bind(format!("ack-{n:03}")).bind(format!("2026-09-22T00:{:02}:{:02}.000Z", n / 60, n % 60))
            .execute(&h.pool).await.unwrap();
    }
    let items = delivery::review(&h.pool).await.unwrap();
    let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
    assert!(ids.contains(&"old-uncertain"), "an uncertain send stays visible");
    assert!(ids.contains(&"old-retry"), "an auth-paused retry stays visible");
    // Resolved history is still bounded.
    assert_eq!(items.iter().filter(|i| i.state == DeliveryState::Acknowledged).count(), 200);
}
