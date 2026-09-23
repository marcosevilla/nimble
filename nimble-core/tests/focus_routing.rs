//! Task 5: incoming local applies (Todoist pull, Turso pull, conditional
//! Google Calendar edit) run under the live FocusService guard after their
//! network fetch, so a running session is settled with the service clock
//! instead of pausing at the last durable checkpoint.
#[path = "common/focus.rs"]
mod fixture;
use nimble_core::focus_types::{FocusAction, FocusSource, FocusStatus};
use serde_json::json;

async fn start_running(h: &fixture::Harness, task_id: &str) -> String {
    h.send(FocusAction::Enqueue {
        task_ids: vec![task_id.to_owned()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let occurrence = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: occurrence.clone() })
        .await
        .unwrap();
    occurrence
}

async fn history_total(h: &fixture::Harness, occurrence: &str) -> u64 {
    h.service
        .history(None, None)
        .await
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.occurrence_id == occurrence)
        .unwrap()
        .total_ms
}

fn remote_row(table: &str, row_id: &str, op: &str, snapshot: Option<String>) -> nimble_core::db::sync::RemoteRow {
    nimble_core::db::sync::RemoteRow {
        entry_id: uuid::Uuid::new_v4().to_string(),
        table_name: table.into(),
        row_id: row_id.into(),
        operation: op.into(),
        changed_columns: None,
        snapshot,
        device_id: "remote-device".into(),
        timestamp: "2099-01-01T00:00:00Z".into(),
    }
}

async fn task_row(h: &fixture::Harness, id: &str) -> serde_json::Value {
    let task = nimble_core::db::tasks::get_local_tasks(&h.pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .unwrap();
    serde_json::from_str(&nimble_core::db::sync::task_sync_snapshot(&task)).unwrap()
}

/// Revision of the latest published replica row. Older unsynced rows are
/// superseded (deleted) on publish, so a row count is no longer a counter.
async fn replica_rows(h: &fixture::Harness) -> i64 {
    sqlx::query_scalar("SELECT json_extract(snapshot,'$.revision') FROM sync_log WHERE table_name='focus_replica' ORDER BY rowid DESC LIMIT 1")
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

async fn subtask(h: &fixture::Harness, title: &str, parent: &str) -> String {
    nimble_core::db::tasks::create_local_task(
        &h.pool,
        nimble_core::types::CreateTaskInput {
            content: title.into(),
            parent_id: Some(parent.into()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id
}

async fn mark_todoist(h: &fixture::Harness, task_id: &str, external: &str) {
    sqlx::query("UPDATE local_tasks SET external_source='todoist', external_id=? WHERE id=?")
        .bind(external)
        .bind(task_id)
        .execute(&h.pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn todoist_remote_delete_settles_live_clock_under_service_guard() {
    let h = fixture::Harness::new().await;
    let task = h.task("Remote owned").await;
    mark_todoist(&h, &task, "R1").await;
    let occurrence = start_running(&h, &task).await;
    h.advance(5_000).await;
    h.clock.advance(3_000); // unsampled live time only the service clock knows
    let resp: nimble_core::integrations::todoist::client::SyncResponse =
        serde_json::from_value(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "Remote owned", "checked": false, "is_deleted": true}
        ]}))
        .unwrap();
    let before = h.snapshot().await.engine_revision;
    let report = nimble_core::integrations::todoist::sync_loop::apply_pull_with_focus(
        &h.pool,
        &resp,
        Some(&h.service),
    )
    .await
    .unwrap();
    assert_eq!(report.deleted, 1);
    let after = h.snapshot().await;
    assert!(after.queue.is_empty(), "deleted task leaves the queue");
    assert!(after.session.is_none());
    assert!(after.engine_revision > before);
    // Owned path credits the live 3s; headless would stop at the 5s checkpoint.
    assert_eq!(history_total(&h, &occurrence).await, 8_000);
    // The service is not frozen: a fresh command still commits.
    let next = h.task("Next").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![next],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn todoist_pull_without_service_reconciles_headlessly() {
    let h = fixture::Harness::new().await;
    let task = h.task("Headless").await;
    mark_todoist(&h, &task, "R2").await;
    let occurrence = start_running(&h, &task).await;
    h.advance(5_000).await;
    let resp: nimble_core::integrations::todoist::client::SyncResponse =
        serde_json::from_value(json!({"sync_token": "T2", "items": [
            {"id": "R2", "content": "Headless", "checked": false, "is_deleted": true}
        ]}))
        .unwrap();
    nimble_core::integrations::todoist::sync_loop::apply_pull(&h.pool, &resp)
        .await
        .unwrap();
    let after = h.snapshot().await;
    assert!(after.queue.is_empty(), "headless apply still reconciles the queue");
    assert_eq!(history_total(&h, &occurrence).await, 5_000);
}

#[tokio::test]
async fn turso_remote_task_edit_keeps_owned_session_running() {
    let h = fixture::Harness::new().await;
    let task_id = h.task("Old title").await;
    let occurrence = start_running(&h, &task_id).await;
    h.clock.advance(4_000);
    let task = nimble_core::db::tasks::get_local_tasks(&h.pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == task_id)
        .unwrap();
    let mut row: serde_json::Value =
        serde_json::from_str(&nimble_core::db::sync::task_sync_snapshot(&task)).unwrap();
    row["content"] = json!("New title");
    nimble_core::db::sync::apply_remote_rows_with_focus(
        &h.pool,
        Some(&h.service),
        &[remote_row("local_tasks", &task_id, "UPDATE", Some(row.to_string()))],
    )
    .await
    .unwrap();
    let after = h.snapshot().await;
    assert_eq!(after.session.unwrap().status, FocusStatus::Running);
    let title: String = sqlx::query_scalar("SELECT title_snapshot FROM focus_occurrences WHERE id=?")
        .bind(&occurrence)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(title, "New title");
    assert_eq!(after.totals[&occurrence], 4_000);
}

#[tokio::test]
async fn turso_remote_completion_removes_queue_entry_under_guard() {
    let h = fixture::Harness::new().await;
    let task_id = h.task("Done elsewhere").await;
    start_running(&h, &task_id).await;
    let task = nimble_core::db::tasks::get_local_tasks(&h.pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == task_id)
        .unwrap();
    let mut row: serde_json::Value =
        serde_json::from_str(&nimble_core::db::sync::task_sync_snapshot(&task)).unwrap();
    row["completed"] = json!(1);
    row["status"] = json!("complete");
    nimble_core::db::sync::apply_remote_rows_with_focus(
        &h.pool,
        Some(&h.service),
        &[remote_row("local_tasks", &task_id, "UPDATE", Some(row.to_string()))],
    )
    .await
    .unwrap();
    let after = h.snapshot().await;
    assert!(after.queue.is_empty());
    assert!(after.session.is_none());
}

#[tokio::test]
async fn calendar_conditional_edit_runs_under_guard_without_pausing() {
    let h = fixture::Harness::new().await;
    let task_id = h.task("Calendar").await;
    let occurrence = start_running(&h, &task_id).await;
    h.clock.advance(2_000);
    let expected = nimble_core::db::tasks::get_local_tasks(&h.pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == task_id)
        .unwrap();
    let updated = nimble_core::db::tasks::update_local_task_if_unchanged_with_focus(
        &h.pool,
        Some(&h.service),
        &task_id,
        &expected,
        nimble_core::types::UpdateTaskInput {
            content: Some("Calendar moved".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(updated.is_some());
    let after = h.snapshot().await;
    assert_eq!(after.session.unwrap().status, FocusStatus::Running);
    assert_eq!(after.totals[&occurrence], 2_000);
    // A stale expectation is refused without touching the queue.
    let stale = nimble_core::db::tasks::update_local_task_if_unchanged_with_focus(
        &h.pool,
        Some(&h.service),
        &task_id,
        &expected,
        nimble_core::types::UpdateTaskInput {
            content: Some("Lost race".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(stale.is_none());
    assert_eq!(h.snapshot().await.session.unwrap().status, FocusStatus::Running);
}

#[tokio::test]
async fn failed_incoming_row_rolls_back_without_freezing_the_live_clock() {
    let h = fixture::Harness::new().await;
    let task_id = h.task("Poison target").await;
    let occurrence = start_running(&h, &task_id).await;
    h.clock.advance(6_000);
    let poison = json!({"id": task_id, "no_such_column": 1}).to_string();
    let result = nimble_core::db::sync::apply_remote_rows_with_focus(
        &h.pool,
        Some(&h.service),
        &[remote_row("local_tasks", &task_id, "UPDATE", Some(poison))],
    )
    .await;
    // A poison row is skipped (logged), exactly as before batching.
    assert_eq!(result.unwrap(), 0);
    // The row failed, the settle survived: still running, 6s credited, and
    // the next command commits without a recovery pause.
    let after = h.snapshot().await;
    assert_eq!(after.session.unwrap().status, FocusStatus::Running);
    assert_eq!(after.totals[&occurrence], 6_000);
    assert!(after.recovery_reason.is_none());
    h.send(FocusAction::Pause).await.unwrap();
    assert_eq!(h.snapshot().await.totals[&occurrence], 6_000);
}

#[tokio::test]
async fn pulled_chunk_of_unrelated_rows_neither_bumps_nor_publishes() {
    let h = fixture::Harness::new().await;
    let focused = h.task("Focused").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![focused.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let mut rows = vec![];
    for n in 0..5 {
        let id = h.task(&format!("Other {n}")).await;
        let mut row = task_row(&h, &id).await;
        row["content"] = json!(format!("Other {n} edited"));
        rows.push(remote_row("local_tasks", &id, "UPDATE", Some(row.to_string())));
    }
    let (revision, published) = (h.snapshot().await.engine_revision, replica_rows(&h).await);
    let applied = nimble_core::db::sync::apply_remote_rows_with_focus(&h.pool, Some(&h.service), &rows)
        .await
        .unwrap();
    assert_eq!(applied, 5);
    assert_eq!(h.snapshot().await.engine_revision, revision);
    assert_eq!(replica_rows(&h).await, published);
    // The same holds for a Todoist pull touching only unfocused tasks.
    let other = h.task("Todoist other").await;
    mark_todoist(&h, &other, "R9").await;
    let resp: nimble_core::integrations::todoist::client::SyncResponse =
        serde_json::from_value(json!({"sync_token": "T9", "items": [
            {"id": "R9", "content": "Todoist other", "checked": false, "is_deleted": true}
        ]}))
        .unwrap();
    nimble_core::integrations::todoist::sync_loop::apply_pull_with_focus(&h.pool, &resp, Some(&h.service))
        .await
        .unwrap();
    assert_eq!(h.snapshot().await.engine_revision, revision);
    assert_eq!(replica_rows(&h).await, published);
}

#[tokio::test]
async fn pulled_chunk_touching_focus_advances_once_and_publishes_once() {
    let h = fixture::Harness::new().await;
    let focused = h.task("Focused").await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![focused.clone()],
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
    let mut rows = vec![];
    for n in 0..3 {
        let id = h.task(&format!("Other {n}")).await;
        let mut row = task_row(&h, &id).await;
        row["priority"] = json!(3);
        rows.push(remote_row("local_tasks", &id, "UPDATE", Some(row.to_string())));
    }
    for title in ["Renamed once", "Renamed twice"] {
        let mut row = task_row(&h, &focused).await;
        row["content"] = json!(title);
        rows.push(remote_row("local_tasks", &focused, "UPDATE", Some(row.to_string())));
    }
    let (revision, published) = (h.snapshot().await.engine_revision, replica_rows(&h).await);
    nimble_core::db::sync::apply_remote_rows_with_focus(&h.pool, Some(&h.service), &rows)
        .await
        .unwrap();
    assert_eq!(h.snapshot().await.engine_revision, revision + 1);
    assert_eq!(replica_rows(&h).await, published + 1);
    let title: String = sqlx::query_scalar("SELECT title_snapshot FROM focus_occurrences WHERE task_id=?")
        .bind(&focused)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(title, "Renamed twice");
}

async fn live_grandchild(h: &fixture::Harness) -> (String, String, String, String) {
    let grandparent = h.task("Grandparent").await;
    let parent = subtask(h, "Parent", &grandparent).await;
    let child = subtask(h, "Child", &parent).await;
    let occurrence = start_running(h, &child).await;
    (grandparent, parent, child, occurrence)
}

async fn assert_subtree_left_focus(h: &fixture::Harness, occurrence: &str) {
    let after = h.snapshot().await;
    assert!(after.queue.is_empty(), "cascaded subtask leaves the queue");
    assert!(after.session.is_none(), "live session on the subtask ends");
    let state: String = sqlx::query_scalar("SELECT state FROM focus_occurrences WHERE id=?")
        .bind(occurrence)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(state, "removed");
}

#[tokio::test]
async fn turso_delete_of_ancestor_reconciles_the_cascaded_live_subtask() {
    for depth in ["parent", "grandparent"] {
        let h = fixture::Harness::new().await;
        let (grandparent, parent, _child, occurrence) = live_grandchild(&h).await;
        let target = if depth == "parent" { parent } else { grandparent };
        nimble_core::db::sync::apply_remote_rows_with_focus(
            &h.pool,
            Some(&h.service),
            &[remote_row("local_tasks", &target, "DELETE", None)],
        )
        .await
        .unwrap();
        assert_subtree_left_focus(&h, &occurrence).await;
    }
}

#[tokio::test]
async fn todoist_delete_of_ancestor_reconciles_the_cascaded_live_subtask() {
    for depth in ["parent", "grandparent"] {
        let h = fixture::Harness::new().await;
        let (grandparent, parent, _child, occurrence) = live_grandchild(&h).await;
        let target = if depth == "parent" { parent } else { grandparent };
        mark_todoist(&h, &target, "RD").await;
        let resp: nimble_core::integrations::todoist::client::SyncResponse =
            serde_json::from_value(json!({"sync_token": "TD", "items": [
                {"id": "RD", "content": "x", "checked": false, "is_deleted": true}
            ]}))
            .unwrap();
        let report = nimble_core::integrations::todoist::sync_loop::apply_pull_with_focus(
            &h.pool,
            &resp,
            Some(&h.service),
        )
        .await
        .unwrap();
        assert_eq!(report.deleted, if depth == "parent" { 2 } else { 3 });
        assert_subtree_left_focus(&h, &occurrence).await;
    }
}
