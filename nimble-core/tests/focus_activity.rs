#[path = "common/focus.rs"]
mod fixture;
use nimble_core::focus_types::{FocusAction, FocusSource};

async fn rows(pool: &sqlx::SqlitePool, task: &str) -> Vec<(String, serde_json::Value)> {
    let raw: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT action_type, metadata FROM activity_log WHERE target_id=? AND action_type!='task_created' ORDER BY rowid")
        .bind(task).fetch_all(pool).await.unwrap();
    raw.into_iter()
        .map(|(a, m)| (a, m.map(|s| serde_json::from_str(&s).unwrap()).unwrap_or(serde_json::Value::Null)))
        .collect()
}

async fn queued(h: &fixture::Harness, task: &str) -> String {
    h.send(FocusAction::Enqueue { task_ids: vec![task.into()], source: FocusSource::Today, explicit_still_open: false })
        .await.unwrap();
    h.snapshot().await.queue.iter().find(|e| e.task_id == task).unwrap().occurrence_id.clone()
}

#[tokio::test]
async fn start_then_complete_logs_focus_and_a_named_completion() {
    let h = fixture::Harness::new().await;
    let t = h.task("Write plan").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Start { occurrence_id: occ.clone() }).await.unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let r = rows(&h.pool, &t).await;
    let actions: Vec<&str> = r.iter().map(|(a, _)| a.as_str()).collect();
    assert_eq!(actions, ["focus_started", "focus_completed", "task_completed"], "{r:?}");
    assert_eq!(r[0].1["task_content"], "Write plan");
    assert_eq!(r[1].1["duration_secs"], 20);
    assert_eq!(r[2].1["content"], "Write plan");
}

#[tokio::test]
async fn completing_without_a_session_logs_only_the_completion() {
    let h = fixture::Harness::new().await;
    let t = h.task("Quick one").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let actions: Vec<String> = rows(&h.pool, &t).await.into_iter().map(|(a, _)| a).collect();
    assert_eq!(actions, ["task_completed"]);
}

#[tokio::test]
async fn stop_and_skip_log_their_duration() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    let occ_a = queued(&h, &a).await;
    let occ_b = queued(&h, &b).await;
    h.send(FocusAction::Start { occurrence_id: occ_a }).await.unwrap();
    // Two ticks: one checkpoint over 40 s is a suspension gap and credits nothing.
    h.advance(30_000).await;
    h.advance(31_000).await;
    h.send(FocusAction::Stop).await.unwrap();
    h.send(FocusAction::Start { occurrence_id: occ_b }).await.unwrap();
    h.advance(5_000).await;
    h.send(FocusAction::Skip).await.unwrap();
    let ra = rows(&h.pool, &a).await;
    assert_eq!(ra.last().unwrap().0, "focus_abandoned", "{ra:?}");
    assert_eq!(ra.last().unwrap().1["duration_secs"], 61);
    let rb = rows(&h.pool, &b).await;
    assert_eq!(rb.last().unwrap().0, "focus_skipped", "{rb:?}");
    assert_eq!(rb.last().unwrap().1["duration_secs"], 5);
}

#[tokio::test]
async fn focus_complete_of_a_repeat_logs_task_recurred() {
    let h = fixture::Harness::new().await;
    let t = nimble_core::db::tasks::create_local_task(&h.pool, nimble_core::types::CreateTaskInput {
        content: "Stretch".into(), due_date: Some(chrono::Local::now().format("%Y-%m-%d").to_string()),
        recurrence_rule: Some("every day".into()), ..Default::default()
    }).await.unwrap().id;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let r = rows(&h.pool, &t).await;
    assert_eq!(r.last().unwrap().0, "task_recurred", "{r:?}");
    assert_eq!(r.last().unwrap().1["content"], "Stretch");
}

#[tokio::test]
async fn pause_resume_and_replay_log_nothing_extra() {
    let h = fixture::Harness::new().await;
    let t = h.task("Steady").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Start { occurrence_id: occ }).await.unwrap();
    h.send(FocusAction::Pause).await.unwrap();
    h.send(FocusAction::Resume).await.unwrap();
    // Replay: same command id twice → one receipt, one row.
    let snap = h.snapshot().await;
    let cmd = nimble_core::focus_types::FocusCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        expected_engine_revision: snap.engine_revision, expected_queue_revision: snap.queue_revision,
        owner_epoch: snap.owner_epoch, process_generation: snap.process_generation,
        session_id: snap.session.map(|s| s.id), action: FocusAction::Stop,
    };
    h.service.execute(cmd.clone()).await.unwrap();
    assert!(h.service.execute(cmd).await.unwrap().replayed);
    let actions: Vec<String> = rows(&h.pool, &t).await.into_iter().map(|(a, _)| a).collect();
    assert_eq!(actions, ["focus_started", "focus_abandoned"]);
}
