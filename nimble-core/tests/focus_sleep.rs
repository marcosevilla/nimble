//! System sleep keeps a running focus session going, credited up to 30
//! minutes (Marco's decision, 2026-09-23; spec §7 amendment). Only a wake
//! observed by the same live process credits sleep time; a crash, kill or
//! relaunch across the sleep follows the crash rule (paused at the last
//! durable checkpoint, downtime not credited).
#[path = "common/focus.rs"]
mod fixture;
use chrono::DateTime;
use nimble_core::db::focus::engine::{FocusService, SLEEP_CREDIT_CAP_MS, SLEEP_WAKE_GRACE_MS};
use nimble_core::db::focus::clock::ManualClock;
use nimble_core::focus_types::{FocusAction, FocusConfig, FocusMode, FocusSource, FocusStatus};

const MIN: u64 = 60_000;

async fn started(h: &fixture::Harness) -> String {
    let t = h.task("Sleepy task").await;
    h.send(FocusAction::Enqueue { task_ids: vec![t], source: FocusSource::Today, explicit_still_open: false })
        .await
        .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    oid
}

async fn session_checkpoint(h: &fixture::Harness) -> String {
    sqlx::query_scalar("SELECT checkpoint_at FROM focus_sessions ORDER BY rowid DESC LIMIT 1")
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

async fn last_segment_close(h: &fixture::Harness) -> (Option<String>, Option<String>) {
    sqlx::query_as("SELECT closed_at, close_reason FROM focus_segments ORDER BY rowid DESC LIMIT 1")
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

fn ms_between(a: &str, b: &str) -> i64 {
    (DateTime::parse_from_rfc3339(b).unwrap() - DateTime::parse_from_rfc3339(a).unwrap()).num_milliseconds()
}

#[test]
fn the_sleep_cap_is_thirty_minutes() {
    assert_eq!(SLEEP_CREDIT_CAP_MS, 1_800_000);
}

#[tokio::test]
async fn sleep_of_ten_minutes_keeps_running_and_credits_it() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    let at_sleep = h.service.sleep_began().await.unwrap();
    assert_eq!(at_sleep.totals[&oid], 5_000, "sleep notice settles a durable checkpoint");
    assert_eq!(at_sleep.session.as_ref().unwrap().status, FocusStatus::Running, "sleep does not pause");
    h.clock.advance(10 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 5_000 + 10 * MIN);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
    assert!(woke.recovery_reason.is_none());
    // Timing simply continues after wake.
    h.clock.advance(10_000);
    assert_eq!(h.service.heartbeat().await.unwrap().totals[&oid], 5_000 + 10 * MIN + 10_000);
}

#[tokio::test]
async fn sleep_of_forty_five_minutes_credits_exactly_thirty_and_pauses_at_the_cap() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    let sleep_start = session_checkpoint(&h).await;
    h.clock.advance(45 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 5_000 + SLEEP_CREDIT_CAP_MS);
    assert_eq!(woke.session.as_ref().unwrap().status, FocusStatus::Paused);
    assert_eq!(woke.recovery_reason.as_deref(), Some("the Mac slept for more than 30 minutes"));
    let (closed_at, reason) = last_segment_close(&h).await;
    assert_eq!(ms_between(&sleep_start, &closed_at.unwrap()), SLEEP_CREDIT_CAP_MS as i64, "paused at sleep start + 30 min");
    assert_eq!(reason.as_deref(), Some("sleep_cap"));
    assert_eq!(ms_between(&sleep_start, &session_checkpoint(&h).await), SLEEP_CREDIT_CAP_MS as i64);
    assert!(h.service.claim_sound().await.unwrap().is_none(), "the cap pause plays no sound");
    // Nothing resumes by itself afterwards.
    h.clock.advance(20_000);
    assert_eq!(h.service.heartbeat().await.unwrap().totals[&oid], 5_000 + SLEEP_CREDIT_CAP_MS);
}

#[tokio::test]
async fn a_capped_sleep_that_crosses_a_timebox_plays_no_sound() {
    let h = fixture::Harness::new().await;
    let t = h.task("Boxed").await;
    h.send(FocusAction::Enqueue { task_ids: vec![t], source: FocusSource::Today, explicit_still_open: false })
        .await
        .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig { mode: FocusMode::Timebox, budget_ms: Some(20 * MIN), work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.service.sleep_began().await.unwrap();
    h.clock.advance(60 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], SLEEP_CREDIT_CAP_MS);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Paused);
    assert!(h.service.claim_sound().await.unwrap().is_none());
}

#[tokio::test]
async fn exactly_thirty_minutes_keeps_running() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.service.sleep_began().await.unwrap();
    h.clock.advance(SLEEP_CREDIT_CAP_MS);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], SLEEP_CREDIT_CAP_MS);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn crash_during_sleep_credits_nothing_on_relaunch() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    // The process dies while the Mac sleeps: no wake is ever observed.
    let relaunched = FocusService::with_clock(h.pool.clone(), "test-device".into(), std::sync::Arc::new(ManualClock::default()));
    relaunched.initialize().await.unwrap();
    let snap = relaunched.snapshot().await.unwrap();
    assert_eq!(snap.totals[&oid], 5_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
    assert_eq!(snap.recovery_reason.as_deref(), Some("recovered at last durable checkpoint"));
}

#[tokio::test]
async fn sleep_without_a_wake_notice_then_relaunch_credits_nothing() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    h.clock.advance(45 * MIN);
    // The live process ticks after the gap but never sees the wake notice.
    for _ in 0..3 {
        let deferred = h.service.heartbeat().await.unwrap();
        assert_eq!(deferred.totals[&oid], 5_000, "a heartbeat never credits sleep");
        h.clock.advance(15_000);
    }
    let relaunched = FocusService::with_clock(h.pool.clone(), "test-device".into(), std::sync::Arc::new(ManualClock::default()));
    relaunched.initialize().await.unwrap();
    let snap = relaunched.snapshot().await.unwrap();
    assert_eq!(snap.totals[&oid], 5_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
}

#[tokio::test]
async fn a_heartbeat_before_the_wake_notice_waits_for_it() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    // The Rust heartbeat can fire just before NSWorkspaceDidWake arrives.
    let early = h.service.heartbeat().await.unwrap();
    assert_eq!(early.totals[&oid], 0);
    assert_eq!(early.session.unwrap().status, FocusStatus::Running);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 10 * MIN);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn heartbeats_between_the_notice_and_the_actual_sleep_credit_normally() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.service.sleep_began().await.unwrap();
    h.clock.advance(3_000);
    assert_eq!(h.service.heartbeat().await.unwrap().totals[&oid], 3_000);
    h.clock.advance(10 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 3_000 + 10 * MIN);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn a_lost_wake_notice_falls_back_to_the_gap_rule_after_the_grace_period() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    let first = h.service.heartbeat().await.unwrap();
    assert_eq!(first.session.unwrap().status, FocusStatus::Running, "first gap heartbeat waits");
    // The live process keeps its 20 s cadence; the wake notice never comes.
    for _ in 0..(SLEEP_WAKE_GRACE_MS / 20_000) - 1 {
        h.clock.advance(20_000);
        let waiting = h.service.heartbeat().await.unwrap();
        assert_eq!(waiting.session.unwrap().status, FocusStatus::Running, "still within grace");
    }
    h.clock.advance(20_000);
    let snap = h.service.heartbeat().await.unwrap();
    assert_eq!(snap.totals[&oid], 5_000, "no wake observed: not credited");
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
    assert!(snap.recovery_reason.unwrap().contains("40 seconds"));
    // A late wake notice changes nothing.
    let late = h.service.woke().await.unwrap();
    assert_eq!(late.totals[&oid], 5_000);
}

#[tokio::test]
async fn a_second_sleep_while_already_paused_does_nothing() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.send(FocusAction::Pause).await.unwrap();
    let paused = h.snapshot().await;
    let slept = h.service.sleep_began().await.unwrap();
    assert_eq!(slept.engine_revision, paused.engine_revision, "sleep while paused writes nothing");
    h.clock.advance(45 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.engine_revision, paused.engine_revision);
    assert_eq!(woke.totals[&oid], 5_000);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Paused);
    assert!(woke.recovery_reason.is_none());
}

#[tokio::test]
async fn a_command_after_an_unannounced_wake_still_follows_the_gap_rule() {
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    // A command settles before any wake notice: no credit without a wake.
    assert!(h.send(FocusAction::Pause).await.unwrap_err().to_string().contains("needs_review"));
    let snap = h.snapshot().await;
    assert_eq!(snap.totals[&oid], 5_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
    let late = h.service.woke().await.unwrap();
    assert_eq!(late.totals[&oid], 5_000);
}

#[tokio::test]
async fn rapid_heartbeats_after_wake_still_wait_for_the_notice() {
    // Review 2026-09-23: boundary wakes can run heartbeats ~100 ms apart; a
    // tick-count grace expired before the wake notice and dropped the credit.
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.clock.advance(5_000);
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    for _ in 0..20 {
        let early = h.service.heartbeat().await.unwrap();
        assert_eq!(early.totals[&oid], 5_000);
        assert_eq!(early.session.unwrap().status, FocusStatus::Running);
        h.clock.advance(100);
    }
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 5_000 + 10 * MIN + 2_000);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn no_boundary_wake_while_a_sleep_gap_awaits_its_notice() {
    let h = fixture::Harness::new().await;
    let t = h.task("Boxed").await;
    h.send(FocusAction::Enqueue { task_ids: vec![t], source: FocusSource::Today, explicit_still_open: false })
        .await
        .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig { mode: FocusMode::Timebox, budget_ms: Some(20 * MIN), work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    assert_eq!(h.service.ms_until_boundary().await.unwrap(), Some(20 * MIN));
    h.service.sleep_began().await.unwrap();
    h.clock.advance(25 * MIN);
    assert_eq!(h.service.ms_until_boundary().await.unwrap(), None, "wake decides the credit");
}

#[tokio::test]
async fn an_uncapped_sleep_that_crosses_a_timebox_chimes_on_wake() {
    // Marco's decision 2026-09-23: a credited sleep (≤ 30 min) that crosses
    // a boundary plays that boundary's chime when the Mac wakes.
    let h = fixture::Harness::new().await;
    let t = h.task("Boxed").await;
    h.send(FocusAction::Enqueue { task_ids: vec![t], source: FocusSource::Today, explicit_still_open: false })
        .await
        .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig { mode: FocusMode::Timebox, budget_ms: Some(20 * MIN), work_ms: 25 * MIN, break_ms: 5 * MIN, rounds: 4 },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.service.sleep_began().await.unwrap();
    h.clock.advance(25 * MIN);
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 25 * MIN);
    assert!(h.service.claim_sound().await.unwrap().is_some(), "the crossed boundary chimes on wake");
}

#[tokio::test]
async fn a_dark_wake_heartbeat_does_not_use_up_the_grace() {
    // Review minor 2026-09-23: a heartbeat during a DarkWake, then more sleep
    // with no notice; the full wake must still find its grace.
    let h = fixture::Harness::new().await;
    let oid = started(&h).await;
    h.service.sleep_began().await.unwrap();
    h.clock.advance(10 * MIN);
    h.service.heartbeat().await.unwrap(); // DarkWake tick, deferred
    h.clock.advance(15 * MIN);
    let after = h.service.heartbeat().await.unwrap();
    assert_eq!(after.session.unwrap().status, FocusStatus::Running, "grace restarts after re-sleep");
    let woke = h.service.woke().await.unwrap();
    assert_eq!(woke.totals[&oid], 25 * MIN);
    assert_eq!(woke.session.unwrap().status, FocusStatus::Running);
    assert!(h.service.ms_until_boundary().await.unwrap().is_none(), "open-ended session has no boundary");
}
