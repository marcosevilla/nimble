#[path = "common/focus.rs"]
mod fixture;
use nimble_core::db::focus::engine::{NativeTaskAction, NativeTaskCommand};
use nimble_core::db::focus::{clock::ManualClock, engine::FocusService};
use nimble_core::focus_types::{
    FocusAction, FocusCommand, FocusConfig, FocusMode, FocusPhase, FocusSource, FocusStatus,
};
use nimble_core::types::CreateTaskInput;

#[tokio::test]
async fn receipt_replays_after_restart_before_generation_checks() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let before = h.snapshot().await;
    let command = FocusCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        expected_engine_revision: before.engine_revision,
        expected_queue_revision: before.queue_revision,
        owner_epoch: before.owner_epoch,
        process_generation: before.process_generation,
        session_id: None,
        action: FocusAction::Enqueue {
            task_ids: vec![a],
            source: FocusSource::Today,
            explicit_still_open: false,
        },
    };
    let first = h.service.execute(command.clone()).await.unwrap();
    let second = FocusService::with_clock(
        h.pool.clone(),
        "test-device".into(),
        std::sync::Arc::new(ManualClock::default()),
    );
    second.initialize().await.unwrap();
    let replay = second.execute(command.clone()).await.unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.committed_revision, first.committed_revision);
    assert_eq!(replay.snapshot.queue.len(), 1);
    let mut mismatched = command;
    mismatched.action = FocusAction::Pause;
    assert!(second
        .execute(mismatched)
        .await
        .unwrap_err()
        .to_string()
        .contains("invalid"));
    assert!(h
        .service
        .checkpoint(1_000, chrono::Utc::now().to_rfc3339())
        .await
        .unwrap_err()
        .to_string()
        .contains("wrong_owner"));
}

#[tokio::test]
async fn restart_normalizes_running_marker_without_fabricating_wall_time() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let before = h.snapshot().await;
    let oid = before.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(12_000).await;
    let restarted = FocusService::with_clock(
        h.pool.clone(),
        "test-device".into(),
        std::sync::Arc::new(ManualClock::default()),
    );
    restarted.initialize().await.unwrap();
    let after = restarted.snapshot().await.unwrap();
    assert_eq!(after.owner_epoch, before.owner_epoch);
    assert_eq!(after.process_generation, before.process_generation + 1);
    assert_eq!(after.totals[&oid], 12_000);
    assert_eq!(after.session.unwrap().status, FocusStatus::Paused);
    assert!(after.recovery_reason.is_some());
}

#[tokio::test]
async fn headless_status_change_pauses_at_last_checkpoint() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(9_000).await;
    nimble_core::db::tasks::update_task_status(&h.pool, &a, "blocked", Some("external edit"))
        .await
        .unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 9_000);
    assert_eq!(s.session.unwrap().status, FocusStatus::Paused);
}

#[tokio::test]
async fn recurring_completion_freezes_old_occurrence_and_does_not_autoqueue_next() {
    let h = fixture::Harness::new().await;
    let task = nimble_core::db::tasks::create_local_task(
        &h.pool,
        CreateTaskInput {
            content: "recurring".into(),
            due_date: Some("2026-09-22".into()),
            recurrence_rule: Some("every day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    h.send(FocusAction::Enqueue {
        task_ids: vec![task.id.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Complete {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    assert!(h.snapshot().await.queue.is_empty());
    let state: String = sqlx::query_scalar("SELECT state FROM focus_occurrences WHERE id=?")
        .bind(&oid)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(state, "completed");
    let stale = h
        .send(FocusAction::Complete { occurrence_id: oid })
        .await
        .unwrap_err();
    assert!(stale.to_string().contains("stale_occurrence"));
    let due: String = sqlx::query_scalar("SELECT due_date FROM local_tasks WHERE id=?")
        .bind(task.id)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_ne!(due, "2026-09-22");
}

#[tokio::test]
async fn distinct_native_completion_ids_cannot_advance_same_recurring_due_twice() {
    let h = fixture::Harness::new().await;
    let task = nimble_core::db::tasks::create_local_task(
        &h.pool,
        CreateTaskInput {
            content: "repeat".into(),
            due_date: Some("2026-09-22".into()),
            recurrence_rule: Some("every day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let action = || NativeTaskAction::SetStatus {
        id: task.id.clone(),
        status: "complete".into(),
        note: None,
        expected_due_date: Some("2026-09-22".into()),
    };
    h.service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: action(),
        })
        .await
        .unwrap();
    let after_first: String = sqlx::query_scalar("SELECT due_date FROM local_tasks WHERE id=?")
        .bind(&task.id)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_ne!(after_first, "2026-09-22");
    let second = h
        .service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: action(),
        })
        .await
        .unwrap_err();
    assert!(second.to_string().contains("stale_occurrence"));
    let after_second: String = sqlx::query_scalar("SELECT due_date FROM local_tasks WHERE id=?")
        .bind(&task.id)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(after_second, after_first);
}

#[tokio::test]
async fn receipt_write_failure_rolls_back_task_completion_and_time() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(10_000).await;
    sqlx::query("CREATE TRIGGER fail_focus_receipt BEFORE INSERT ON focus_command_receipts BEGIN SELECT RAISE(ABORT, 'synthetic disk error'); END")
        .execute(&h.pool).await.unwrap();
    assert!(h
        .send(FocusAction::Complete {
            occurrence_id: oid.clone()
        })
        .await
        .is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id=?")
        .bind(a)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(status, "in_progress");
    assert_eq!(h.snapshot().await.totals[&oid], 10_000);
    assert_eq!(h.snapshot().await.queue.len(), 1);
}

#[tokio::test]
async fn suspension_gap_keeps_last_checkpoint_and_pauses() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(20_000).await;
    h.advance(60_000).await;
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 20_000);
    assert_eq!(s.session.unwrap().status, FocusStatus::Paused);
    assert!(s.recovery_reason.is_some());
}

#[tokio::test]
async fn command_after_sixty_second_gap_commits_pause_and_rejects_old_start() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(8_000).await;
    h.clock.advance(60_000);
    let error = h
        .send(FocusAction::Start {
            occurrence_id: oid.clone(),
        })
        .await
        .unwrap_err();
    assert!(error.to_string().contains("needs_review"));
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 8_000);
    assert_eq!(s.session.unwrap().status, FocusStatus::Paused);
    assert!(s.recovery_reason.is_some());
}

#[tokio::test]
async fn failed_queue_write_discards_sampled_delta_and_recovers_paused() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(10_000).await;
    h.clock.advance(5_000);
    sqlx::query("CREATE TRIGGER fail_queue_update BEFORE UPDATE ON focus_queue_state BEGIN SELECT RAISE(ABORT, 'synthetic queue disk error'); END")
        .execute(&h.pool).await.unwrap();
    assert!(h
        .send(FocusAction::Configure {
            occurrence_id: oid.clone(),
            config: FocusConfig {
                mode: FocusMode::Timebox,
                budget_ms: Some(60_000),
                work_ms: 1_500_000,
                break_ms: 300_000,
                rounds: 4
            }
        })
        .await
        .is_err());
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 10_000);
    assert_eq!(s.session.unwrap().status, FocusStatus::Paused);
    assert!(s.recovery_reason.unwrap().contains("storage failure"));
    h.advance(20_000).await;
    assert_eq!(h.snapshot().await.totals[&oid], 10_000);
}

#[tokio::test]
async fn pomodoro_caps_round_and_break_time_is_separate() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Pomodoro,
            budget_ms: None,
            work_ms: 60_000,
            break_ms: 60_000,
            rounds: 3,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(40_000).await;
    h.advance(30_000).await;
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 60_000);
    assert_eq!(s.session.as_ref().unwrap().phase, FocusPhase::RoundReady);
    h.send(FocusAction::StartBreak).await.unwrap();
    h.advance(40_000).await;
    h.advance(30_000).await;
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 60_000);
    assert_eq!(s.session.as_ref().unwrap().break_ms, 60_000);
    assert_eq!(s.session.as_ref().unwrap().phase, FocusPhase::WorkReady);
}

#[tokio::test]
async fn three_rounds_preserve_paused_break_and_only_credit_work() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Pomodoro,
            budget_ms: None,
            work_ms: 60_000,
            break_ms: 60_000,
            rounds: 3,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    for round in 1..=3 {
        h.advance(40_000).await;
        h.advance(20_000).await;
        assert_eq!(h.snapshot().await.totals[&oid], round * 60_000);
        if round < 3 {
            h.send(FocusAction::StartBreak).await.unwrap();
            h.advance(20_000).await;
            h.send(FocusAction::Pause).await.unwrap();
            assert_eq!(
                h.snapshot().await.session.as_ref().unwrap().phase,
                FocusPhase::Break
            );
            h.send(FocusAction::Resume).await.unwrap();
            h.advance(40_000).await;
            assert_eq!(
                h.snapshot().await.session.as_ref().unwrap().phase,
                FocusPhase::WorkReady
            );
            h.send(FocusAction::Start {
                occurrence_id: oid.clone(),
            })
            .await
            .unwrap();
        }
    }
    let s = h.snapshot().await;
    assert_eq!(s.session.as_ref().unwrap().break_ms, 120_000);
    assert_eq!(s.session.as_ref().unwrap().round, 3);
    assert_eq!(s.session.as_ref().unwrap().phase, FocusPhase::RoundReady);
}

#[tokio::test]
async fn mode_switch_during_break_ends_old_session_and_preserves_work_total() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Pomodoro,
            budget_ms: None,
            work_ms: 60_000,
            break_ms: 60_000,
            rounds: 3,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(40_000).await;
    h.advance(20_000).await;
    h.send(FocusAction::StartBreak).await.unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::CountUp,
            budget_ms: None,
            work_ms: 1_500_000,
            break_ms: 300_000,
            rounds: 4,
        },
    })
    .await
    .unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.totals[&oid], 60_000);
    assert!(s.session.is_none());
    h.advance(20_000).await;
    assert_eq!(h.snapshot().await.totals[&oid], 60_000);
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    let session = h.snapshot().await.session.unwrap();
    assert_eq!(session.round, 1);
    assert_eq!(session.phase, FocusPhase::Work);
}

#[tokio::test]
async fn natural_break_boundary_cannot_advance_round_twice_or_start_final_break() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Pomodoro,
            budget_ms: None,
            work_ms: 60_000,
            break_ms: 60_000,
            rounds: 2,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(40_000).await;
    h.advance(20_000).await;
    h.send(FocusAction::StartBreak).await.unwrap();
    h.advance(40_000).await;
    h.advance(20_000).await;
    assert_eq!(h.snapshot().await.session.as_ref().unwrap().round, 2);
    assert!(h.send(FocusAction::EndBreak).await.is_err());
    assert_eq!(h.snapshot().await.session.as_ref().unwrap().round, 2);
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(40_000).await;
    h.advance(20_000).await;
    assert!(h.send(FocusAction::StartBreak).await.is_err());
    assert_eq!(
        h.snapshot().await.session.unwrap().phase,
        FocusPhase::RoundReady
    );
}

#[tokio::test]
async fn timebox_overtime_continues_and_claims_one_boundary() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Timebox,
            budget_ms: Some(60_000),
            work_ms: 1_500_000,
            break_ms: 300_000,
            rounds: 4,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(40_000).await;
    h.advance(30_000).await;
    let token: String = sqlx::query_scalar("SELECT boundary_token FROM focus_runtime WHERE id=1")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    h.advance(20_000).await;
    let token_after: String =
        sqlx::query_scalar("SELECT boundary_token FROM focus_runtime WHERE id=1")
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(token, token_after);
    assert_eq!(h.snapshot().await.totals[&oid], 90_000);
    assert_eq!(
        h.snapshot().await.session.unwrap().status,
        FocusStatus::Running
    );
}

#[tokio::test]
async fn aggregate_overflow_is_rejected_before_checkpoint_commit() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    sqlx::query("UPDATE focus_sessions SET work_ms=? WHERE occurrence_id=?")
        .bind(nimble_core::focus_types::MAX_SAFE_INTEGER as i64)
        .bind(&oid)
        .execute(&h.pool)
        .await
        .unwrap();
    assert!(h
        .service
        .checkpoint(1, chrono::Utc::now().to_rfc3339())
        .await
        .unwrap_err()
        .to_string()
        .contains("safe integer"));
    assert_eq!(
        h.snapshot().await.totals[&oid],
        nimble_core::focus_types::MAX_SAFE_INTEGER
    );
}

#[tokio::test]
async fn budget_change_preserves_recorded_time() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(25_000).await;
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Timebox,
            budget_ms: Some(60_000),
            work_ms: 1_500_000,
            break_ms: 300_000,
            rounds: 4,
        },
    })
    .await
    .unwrap();
    assert_eq!(h.snapshot().await.totals[&oid], 25_000);
    assert!(h.snapshot().await.session.is_none());
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(30_000).await;
    assert_eq!(h.snapshot().await.totals[&oid], 55_000);
}

#[tokio::test]
async fn native_task_receipt_replay_and_failure_are_atomic() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    let cmd = NativeTaskCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        action: NativeTaskAction::SetStatus {
            id: a.clone(),
            status: "complete".into(),
            note: None,
            expected_due_date: None,
        },
    };
    let first = h.service.execute_native_task(cmd.clone()).await.unwrap();
    let second = h.service.execute_native_task(cmd).await.unwrap();
    assert!(second.replayed);
    assert!(first.snapshot.queue.is_empty());
    assert!(second.snapshot.queue.is_empty());
    assert_eq!(
        h.service
            .history(None, None)
            .await
            .unwrap()
            .rows
            .iter()
            .find(|r| r.occurrence_id == oid)
            .unwrap()
            .total_ms,
        0
    );

    let b = h.task("B").await;
    let fail = NativeTaskCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        action: NativeTaskAction::SetStatus {
            id: b.clone(),
            status: "complete".into(),
            note: None,
            expected_due_date: None,
        },
    };
    sqlx::query("CREATE TRIGGER fail_native_receipt BEFORE INSERT ON focus_command_receipts BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END")
        .execute(&h.pool).await.unwrap();
    assert!(h.service.execute_native_task(fail).await.is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id=?")
        .bind(b)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(status, "todo");
}

#[tokio::test]
async fn remote_guard_reconciles_atomically_after_checkpoint() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(4_000).await;
    let mut guard = h.service.begin_task_write().await.unwrap();
    let effects = nimble_core::db::task_tx::set_status_tx(
        guard.connection(),
        &a,
        "complete",
        chrono::Local::now().date_naive(),
        nimble_core::db::task_tx::MutationPolicy::Remote,
    )
    .await
    .unwrap();
    let snap = guard.commit(&effects).await.unwrap();
    assert!(snap.queue.is_empty());
    let history = h.service.history(None, None).await.unwrap();
    assert_eq!(
        history
            .rows
            .iter()
            .find(|r| r.occurrence_id == oid)
            .unwrap()
            .total_ms,
        4_000
    );
}

#[tokio::test]
async fn abandoned_task_write_guard_freezes_uncommitted_time() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(10_000).await;
    h.clock.advance(5_000);
    drop(h.service.begin_task_write().await.unwrap());
    let recovered = h
        .service
        .checkpoint(20_000, chrono::Utc::now().to_rfc3339())
        .await
        .unwrap();
    assert_eq!(recovered.totals[&oid], 10_000);
    assert_eq!(recovered.session.unwrap().status, FocusStatus::Paused);
}

#[tokio::test]
async fn interrupt_after_abandoned_task_write_keeps_last_checkpoint() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(10_000).await;
    h.clock.advance(5_000);
    drop(h.service.begin_task_write().await.unwrap());
    let recovered = h.service.interrupt("sleep").await.unwrap();
    assert_eq!(recovered.totals[&oid], 10_000);
    assert_eq!(recovered.session.unwrap().status, FocusStatus::Paused);
}

#[tokio::test]
async fn failed_task_write_open_recovers_without_crediting_sample() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    h.advance(10_000).await;
    h.clock.advance(5_000);
    sqlx::query("CREATE TRIGGER fail_task_write_settle BEFORE UPDATE OF work_ms ON focus_sessions BEGIN SELECT RAISE(ABORT, 'synthetic task write disk error'); END")
        .execute(&h.pool)
        .await
        .unwrap();
    assert!(h.service.begin_task_write().await.is_err());
    let recovered = h.snapshot().await;
    assert_eq!(recovered.totals[&oid], 10_000);
    assert_eq!(recovered.session.unwrap().status, FocusStatus::Paused);
    assert!(recovered
        .recovery_reason
        .unwrap()
        .contains("storage failure"));
    h.advance(20_000).await;
    assert_eq!(h.snapshot().await.totals[&oid], 10_000);
}

// ── Task 9: production heartbeat, lifecycle interrupt and sound claims ──

async fn started(h: &fixture::Harness, title: &str) -> String {
    let t = h.task(title).await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![t],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    oid
}

#[tokio::test]
async fn heartbeat_credits_only_time_since_the_last_settle_by_any_path() {
    let h = fixture::Harness::new().await;
    let oid = started(&h, "A").await;
    h.clock.advance(10_000);
    assert_eq!(h.service.heartbeat().await.unwrap().totals[&oid], 10_000);
    // A command between ticks settles its own 5 s; the next tick must not
    // re-credit them.
    h.clock.advance(5_000);
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![b],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    h.clock.advance(15_000);
    let snap = h.service.heartbeat().await.unwrap();
    assert_eq!(snap.totals[&oid], 30_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn heartbeat_after_an_unnoticed_sleep_pauses_at_the_last_checkpoint() {
    let h = fixture::Harness::new().await;
    let oid = started(&h, "A").await;
    h.clock.advance(20_000);
    h.service.heartbeat().await.unwrap();
    // No sleep notice arrived; the sleep-inclusive clock shows an hour gap.
    h.clock.advance(3_600_000);
    let snap = h.service.heartbeat().await.unwrap();
    assert_eq!(snap.totals[&oid], 20_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
    assert!(snap.recovery_reason.unwrap().contains("40 seconds"));
    // Wake never resumes by itself: later ticks credit nothing.
    h.clock.advance(20_000);
    assert_eq!(h.service.heartbeat().await.unwrap().totals[&oid], 20_000);
}

#[tokio::test]
async fn interrupt_settles_a_running_session_and_is_silent_when_idle() {
    let h = fixture::Harness::new().await;
    let idle = h.snapshot().await;
    let after = h.service.interrupt("last focus surface closed").await.unwrap();
    assert_eq!(after.engine_revision, idle.engine_revision);
    assert!(after.recovery_reason.is_none());

    let oid = started(&h, "A").await;
    h.clock.advance(12_000);
    let snap = h.service.interrupt("system sleep").await.unwrap();
    assert_eq!(snap.totals[&oid], 12_000);
    assert_eq!(snap.session.unwrap().status, FocusStatus::Paused);
    assert_eq!(snap.recovery_reason.as_deref(), Some("system sleep"));
}

#[tokio::test]
async fn two_subscribers_cannot_both_claim_one_sound() {
    let h = fixture::Harness::new().await;
    let t = h.task("A").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![t],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Configure {
        occurrence_id: oid.clone(),
        config: FocusConfig {
            mode: FocusMode::Timebox,
            budget_ms: Some(60_000),
            work_ms: 1_500_000,
            break_ms: 300_000,
            rounds: 4,
        },
    })
    .await
    .unwrap();
    h.send(FocusAction::Start {
        occurrence_id: oid.clone(),
    })
    .await
    .unwrap();
    assert_eq!(h.service.claim_sound().await.unwrap(), None);
    h.clock.advance(30_000);
    h.service.heartbeat().await.unwrap();
    assert_eq!(h.service.claim_sound().await.unwrap(), None, "no chime before zero");
    h.clock.advance(30_000);
    h.service.heartbeat().await.unwrap();
    // Two windows/subscribers race for the zero-crossing chime.
    let (a, b) = tokio::join!(h.service.claim_sound(), h.service.claim_sound());
    let winners: Vec<String> = [a.unwrap(), b.unwrap()].into_iter().flatten().collect();
    assert_eq!(winners.len(), 1, "exactly one claim wins");
    assert!(winners[0].starts_with("chime:"));
    // Overtime keeps counting without another chime.
    h.clock.advance(20_000);
    let snap = h.service.heartbeat().await.unwrap();
    assert_eq!(snap.totals[&oid], 80_000);
    assert_eq!(h.service.claim_sound().await.unwrap(), None, "timebox zero chimes once");
    // Completion commits its own sound token with the completion.
    h.send(FocusAction::Complete {
        occurrence_id: oid,
    })
    .await
    .unwrap();
    let first = h.service.claim_sound().await.unwrap();
    assert!(first.is_some_and(|t| t.starts_with("complete:")));
    assert_eq!(h.service.claim_sound().await.unwrap(), None);
}
