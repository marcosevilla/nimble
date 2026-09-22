#[path = "common/focus.rs"]
mod fixture;

use nimble_core::db::focus::replica::{accept_revision, apply_focus_replica_tx, FocusReplica};
use nimble_core::focus_types::{FocusAction, FocusSource};

async fn latest(h: &fixture::Harness) -> FocusReplica {
    let row: String = sqlx::query_scalar(
        "SELECT snapshot FROM sync_log WHERE table_name='focus_replica' ORDER BY rowid DESC LIMIT 1")
        .fetch_one(&h.pool).await.unwrap();
    let value: serde_json::Value = serde_json::from_str(&row).unwrap();
    serde_json::from_str(value["payload_json"].as_str().unwrap()).unwrap()
}

#[test]
fn stale_replica_revision_is_rejected() {
    assert!(!accept_revision("mac-a", "epoch-1", 9, "mac-a", "epoch-1", 8));
    assert!(!accept_revision("mac-a", "epoch-1", 9, "mac-b", "epoch-1", 10));
    assert!(!accept_revision("mac-a", "epoch-1", 9, "mac-a", "epoch-2", 10));
    assert!(accept_revision("mac-a", "epoch-1", 9, "mac-a", "epoch-1", 10));
}

#[tokio::test]
async fn checkpoint_advances_replica_without_changing_queue_order() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    let before = latest(&h).await;
    h.advance(20_000).await;
    let after = latest(&h).await;
    assert_eq!(after.queue_revision, before.queue_revision);
    assert_eq!(after.queue[0].occurrence_id, before.queue[0].occurrence_id);
    assert!(after.revision > before.revision);
    assert_eq!(after.totals[&oid], 20_000);
    assert_eq!(after.sessions.last().unwrap()["status"], "paused");
    let raw = serde_json::to_value(&after).unwrap();
    assert!(raw.get("live_session_id").is_none());
    assert!(raw.get("process_generation").is_none());
}

#[tokio::test]
async fn offline_native_task_reconciliation_publishes_paused_replica() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.advance(9_000).await;
    let before = latest(&h).await;
    nimble_core::db::tasks::update_task_status(&h.pool, &a, "blocked", Some("external edit"))
        .await.unwrap();
    let after = latest(&h).await;
    assert!(after.revision > before.revision);
    assert_eq!(after.totals[&oid], 9_000);
    assert_eq!(after.sessions.last().unwrap()["status"], "paused");
}

#[tokio::test]
async fn seed_republishes_one_aggregate_after_missing_focus_log() {
    let h = fixture::Harness::new().await;
    let a = h.task("Seeded").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    sqlx::query("DELETE FROM sync_log WHERE table_name='focus_replica'")
        .execute(&h.pool).await.unwrap();
    nimble_core::db::sync::seed_existing_data(&h.pool).await.unwrap();
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_log WHERE table_name='focus_replica' AND row_id='current'")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(count, 1);
    assert_eq!(latest(&h).await.queue.len(), 1);
}

#[tokio::test]
async fn native_apply_rejects_unsafe_record_durations_and_accepts_safe_boundary() {
    let h = fixture::Harness::new().await;
    let task = h.task("A").await;
    h.send(FocusAction::Enqueue { task_ids: vec![task], source: FocusSource::Today,
        explicit_still_open: false }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.send(FocusAction::Pause).await.unwrap();
    let base = latest(&h).await;
    for bad in [serde_json::json!(-1), serde_json::json!(1.5),
        serde_json::json!(9_007_199_254_740_992_u64)] {
        for field in ["work_ms", "break_ms", "round_work_ms", "round_break_ms", "session_revision"] {
            let mut replica = base.clone();
            replica.sessions[0][field] = bad.clone();
            let mut tx = h.pool.begin().await.unwrap();
            assert!(apply_focus_replica_tx(&mut tx, replica).await.is_err(), "{field}: {bad}");
        }
        let mut replica = base.clone();
        replica.import_totals.push(serde_json::json!({"duration_ms":bad,"occurrence_id":oid}));
        let mut tx = h.pool.begin().await.unwrap();
        assert!(apply_focus_replica_tx(&mut tx, replica).await.is_err(), "import: {bad}");
    }
    let mut boundary = base;
    boundary.sessions[0]["work_ms"] = serde_json::json!(9_007_199_254_740_991_u64);
    boundary.sessions[0]["break_ms"] = serde_json::json!(9_007_199_254_740_991_u64);
    boundary.totals.insert(oid, 9_007_199_254_740_991_u64);
    let mut tx = h.pool.begin().await.unwrap();
    assert_eq!(apply_focus_replica_tx(&mut tx, boundary).await.unwrap(), false);
}
