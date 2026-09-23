#[path = "common/focus.rs"]
mod fixture;
use nimble_core::db::focus::engine::{NativeTaskAction, NativeTaskCommand};
use nimble_core::focus_types::{FocusAction, FocusSource, FocusStatus};
use nimble_core::types::CreateTaskInput;

#[tokio::test]
async fn paused_time_survives_switch_and_next_requires_start() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a, b],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let first = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start {
        occurrence_id: first.clone(),
    })
    .await
    .unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Pause).await.unwrap();
    assert_eq!(h.snapshot().await.totals[&first], 20_000);
    h.send(FocusAction::Complete {
        occurrence_id: first,
    })
    .await
    .unwrap();
    assert_ne!(
        h.snapshot().await.session.map(|s| s.status),
        Some(FocusStatus::Running)
    );
    assert_eq!(h.snapshot().await.queue.len(), 1);
}

#[tokio::test]
async fn direct_upcoming_completion_does_not_stop_active_work() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a, b],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    h.send(FocusAction::Start {
        occurrence_id: q[0].occurrence_id.clone(),
    })
    .await
    .unwrap();
    h.advance(7_000).await;
    h.send(FocusAction::Complete {
        occurrence_id: q[1].occurrence_id.clone(),
    })
    .await
    .unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.queue.len(), 1);
    assert_eq!(s.session.unwrap().status, FocusStatus::Running);
    assert_eq!(s.totals[&q[0].occurrence_id], 7_000);
}

#[tokio::test]
async fn native_delete_undo_restores_parent_and_child_behind_running_entry() {
    let h = fixture::Harness::new().await;
    let parent = h.task("parent").await;
    let child = nimble_core::db::tasks::create_local_task(
        &h.pool,
        CreateTaskInput {
            content: "child".into(),
            parent_id: Some(parent.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![parent.clone(), child.id.clone(), b.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    h.send(FocusAction::Start {
        occurrence_id: q[2].occurrence_id.clone(),
    })
    .await
    .unwrap();
    let reply = h
        .service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::Delete { id: parent.clone() },
        })
        .await
        .unwrap();
    assert_eq!(reply.snapshot.queue.len(), 1);
    let token = reply.undo_token.unwrap();
    h.send(FocusAction::UndoDelete { token }).await.unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.queue.len(), 3);
    assert_eq!(s.queue[0].task_id, b);
    assert_eq!(s.session.unwrap().status, FocusStatus::Running);
    let restored: Option<String> =
        sqlx::query_scalar("SELECT parent_id FROM local_tasks WHERE id=?")
            .bind(child.id)
            .fetch_optional(&h.pool)
            .await
            .unwrap();
    assert_eq!(restored, Some(parent));
}

#[tokio::test]
async fn undo_restores_paused_first_before_next_and_expires_after_ten_seconds() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone(), b],
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
    h.send(FocusAction::Pause).await.unwrap();
    let deleted = h
        .service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::Delete { id: a.clone() },
        })
        .await
        .unwrap();
    let token = deleted.undo_token.unwrap();
    let (issued, expires): (String, String) =
        sqlx::query_as("SELECT issued_at,expires_at FROM focus_undo WHERE token=?")
            .bind(&token)
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(
        (chrono::DateTime::parse_from_rfc3339(&expires).unwrap()
            - chrono::DateTime::parse_from_rfc3339(&issued).unwrap())
        .num_seconds(),
        10
    );
    h.send(FocusAction::UndoDelete { token }).await.unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.queue[0].task_id, a);
    assert_eq!(s.selected_occurrence_id, Some(oid));
    assert_ne!(
        s.session.map(|session| session.status),
        Some(FocusStatus::Running)
    );

    let deleted = h
        .service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::Delete { id: a },
        })
        .await
        .unwrap();
    let token = deleted.undo_token.unwrap();
    sqlx::query("UPDATE focus_undo SET expires_at=? WHERE token=?")
        .bind((chrono::Utc::now() - chrono::Duration::seconds(1)).to_rfc3339())
        .bind(&token)
        .execute(&h.pool)
        .await
        .unwrap();
    assert!(h
        .send(FocusAction::UndoDelete { token })
        .await
        .unwrap_err()
        .to_string()
        .contains("expired"));
}

#[tokio::test]
async fn undo_uses_surviving_neighbors_after_intervening_reorder() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    let c = h.task("C").await;
    let d = h.task("D").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone(), b.clone(), c.clone(), d.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    let deleted = h
        .service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::Delete { id: b.clone() },
        })
        .await
        .unwrap();
    let token = deleted.undo_token.unwrap();
    h.send(FocusAction::Reorder {
        entry_ids: vec![q[3].id.clone(), q[0].id.clone(), q[2].id.clone()],
    })
    .await
    .unwrap();
    h.send(FocusAction::UndoDelete { token }).await.unwrap();
    let tasks: Vec<String> = h
        .snapshot()
        .await
        .queue
        .iter()
        .map(|e| e.task_id.clone())
        .collect();
    assert_eq!(tasks, vec![d, a, b, c]);
}

#[tokio::test]
async fn parent_completion_cascades_queue_and_preserves_child_history() {
    let h = fixture::Harness::new().await;
    let parent = h.task("parent").await;
    let child = nimble_core::db::tasks::create_local_task(
        &h.pool,
        CreateTaskInput {
            content: "child".into(),
            parent_id: Some(parent.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    h.send(FocusAction::Enqueue {
        task_ids: vec![parent, child.id],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    h.send(FocusAction::Start {
        occurrence_id: q[1].occurrence_id.clone(),
    })
    .await
    .unwrap();
    h.advance(3_000).await;
    h.send(FocusAction::Complete {
        occurrence_id: q[0].occurrence_id.clone(),
    })
    .await
    .unwrap();
    assert!(h.snapshot().await.queue.is_empty());
    let history = h.service.history(None, None).await.unwrap();
    let child_row = history
        .rows
        .iter()
        .find(|r| r.occurrence_id == q[1].occurrence_id)
        .unwrap();
    assert_eq!(child_row.total_ms, 3_000);
}

#[tokio::test]
async fn simultaneous_start_and_reorder_do_not_lose_an_entry() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a, b],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let snap = h.snapshot().await;
    let envelope = |action| nimble_core::focus_types::FocusCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        expected_engine_revision: snap.engine_revision,
        expected_queue_revision: snap.queue_revision,
        owner_epoch: snap.owner_epoch.clone(),
        process_generation: snap.process_generation,
        session_id: None,
        action,
    };
    let start = envelope(FocusAction::Start {
        occurrence_id: snap.queue[0].occurrence_id.clone(),
    });
    let reorder = envelope(FocusAction::Reorder {
        entry_ids: snap.queue.iter().rev().map(|e| e.id.clone()).collect(),
    });
    let (a, b) = tokio::join!(h.service.execute(start), h.service.execute(reorder));
    assert_eq!(a.is_ok() as u8 + b.is_ok() as u8, 1);
    assert_eq!(h.snapshot().await.queue.len(), 2);
}

#[tokio::test]
async fn reorder_below_running_keeps_clock_but_new_first_pauses_old() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    let c = h.task("C").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a, b, c],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    h.send(FocusAction::Start {
        occurrence_id: q[0].occurrence_id.clone(),
    })
    .await
    .unwrap();
    h.advance(3_000).await;
    h.send(FocusAction::Reorder {
        entry_ids: vec![q[0].id.clone(), q[2].id.clone(), q[1].id.clone()],
    })
    .await
    .unwrap();
    assert_eq!(
        h.snapshot().await.session.unwrap().status,
        FocusStatus::Running
    );
    h.send(FocusAction::Reorder {
        entry_ids: vec![q[1].id.clone(), q[0].id.clone(), q[2].id.clone()],
    })
    .await
    .unwrap();
    let s = h.snapshot().await;
    assert_eq!(s.selected_occurrence_id, Some(q[1].occurrence_id.clone()));
    assert_ne!(
        s.session.map(|session| session.status),
        Some(FocusStatus::Running)
    );
    assert_eq!(s.totals[&q[0].occurrence_id], 3_000);
}

#[tokio::test]
async fn switching_tasks_banks_a_and_runs_only_b() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a, b],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let q = h.snapshot().await.queue;
    h.send(FocusAction::Start {
        occurrence_id: q[0].occurrence_id.clone(),
    })
    .await
    .unwrap();
    h.advance(11_000).await;
    h.send(FocusAction::Start {
        occurrence_id: q[1].occurrence_id.clone(),
    })
    .await
    .unwrap();
    h.advance(5_000).await;
    let s = h.snapshot().await;
    assert_eq!(s.totals[&q[0].occurrence_id], 11_000);
    assert_eq!(s.totals[&q[1].occurrence_id], 5_000);
    assert_eq!(s.selected_occurrence_id, Some(q[1].occurrence_id.clone()));
    assert_eq!(s.session.unwrap().status, FocusStatus::Running);
}
