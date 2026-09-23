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

async fn unsynced_replica_rows(h: &fixture::Harness) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_log WHERE table_name='focus_replica' AND row_id='current' AND synced=0")
        .fetch_one(&h.pool).await.unwrap()
}

/// Simulate a completed Turso push of everything logged so far.
async fn mark_pushed(h: &fixture::Harness) {
    sqlx::query("UPDATE sync_log SET synced=1").execute(&h.pool).await.unwrap();
}

#[tokio::test]
async fn heartbeats_alone_publish_nothing_and_the_next_transition_publishes_settled_state() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    let before = latest(&h).await;
    mark_pushed(&h).await;
    // Production heartbeat and explicit checkpoints: 5 x 20 s while running.
    for _ in 0..3 {
        h.clock.advance(20_000);
        h.service.heartbeat().await.unwrap();
    }
    h.advance(20_000).await;
    h.advance(20_000).await;
    assert_eq!(unsynced_replica_rows(&h).await, 0, "heartbeats must not publish");
    assert_eq!(h.snapshot().await.totals[&oid], 100_000, "time is still credited locally");
    // A state transition publishes exactly one row carrying the settled total.
    h.send(FocusAction::Pause).await.unwrap();
    assert_eq!(unsynced_replica_rows(&h).await, 1);
    let after = latest(&h).await;
    assert_eq!(after.queue_revision, before.queue_revision);
    assert_eq!(after.queue[0].occurrence_id, before.queue[0].occurrence_id);
    assert!(after.revision > before.revision);
    assert_eq!(after.totals[&oid], 100_000);
    assert_eq!(after.sessions.last().unwrap()["status"], "paused");
    let raw = serde_json::to_value(&after).unwrap();
    assert!(raw.get("live_session_id").is_none());
    assert!(raw.get("process_generation").is_none());
}

#[tokio::test]
async fn a_new_replica_row_supersedes_older_unsynced_rows_and_still_converges() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    mark_pushed(&h).await;
    let pushed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_log WHERE table_name='focus_replica' AND synced=1")
        .fetch_one(&h.pool).await.unwrap();
    assert!(pushed >= 1);
    // Several transitions while offline.
    h.send(FocusAction::Enqueue {
        task_ids: vec![b], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.advance(7_000).await;
    h.send(FocusAction::Pause).await.unwrap();
    h.send(FocusAction::Skip).await.unwrap();
    assert_eq!(unsynced_replica_rows(&h).await, 1, "at most one unsynced replica row");
    let still_pushed: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_log WHERE table_name='focus_replica' AND synced=1")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(still_pushed, pushed, "already-pushed rows are left alone");
    let latest_replica = latest(&h).await;
    assert_eq!(latest_replica.revision, h.snapshot().await.engine_revision);

    // A reader pinned to this writer converges on the one remaining row.
    let reader = nimble_core::test_util::test_pool().await;
    for (key, value) in [
        ("focus_replica_writer_device_id", latest_replica.writer_device_id.clone()),
        ("focus_replica_owner_epoch", latest_replica.owner_epoch.clone()),
    ] {
        sqlx::query("INSERT INTO settings(key,value) VALUES(?,?)")
            .bind(key).bind(value).execute(&reader).await.unwrap();
    }
    let mut tx = reader.begin().await.unwrap();
    assert!(apply_focus_replica_tx(&mut tx, latest_replica.clone()).await.unwrap());
    tx.commit().await.unwrap();
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM focus_replica WHERE id='current'")
        .fetch_one(&reader).await.unwrap();
    assert_eq!(revision as u64, latest_replica.revision);
    assert_eq!(latest_replica.totals[&oid], 7_000);
    assert_eq!(latest_replica.queue.len(), 2);
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

#[tokio::test]
async fn periodic_pull_with_no_focus_change_publishes_nothing_while_running() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a], source: FocusSource::Today, explicit_still_open: false,
    }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    mark_pushed(&h).await;
    for _ in 0..3 {
        h.clock.advance(20_000);
        let write = nimble_core::db::focus::task_write::TaskWrite::begin(&h.pool, Some(&h.service))
            .await.unwrap();
        write.commit(&Default::default()).await.unwrap();
    }
    assert_eq!(unsynced_replica_rows(&h).await, 0, "an empty pull is not a transition");
    assert_eq!(h.snapshot().await.totals[&oid], 60_000);
}
