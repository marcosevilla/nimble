//! Momentum ledger exit tests (addendum 2026-09-25 §6): a completion counts
//! exactly once whichever path saw it; un-completing reverses it once.

#[path = "common/focus.rs"]
mod fixture;

use fixture::Harness;
use nimble_core::db::focus::engine::{NativeTaskAction, NativeTaskCommand};
use nimble_core::db::karma::{self, KarmaEvent};
use nimble_core::db::tasks::{create_local_task, update_task_status, update_task_status_at};
use nimble_core::test_util::test_pool;
use nimble_core::types::CreateTaskInput;
use sqlx::SqlitePool;
use nimble_core::db::sync::{apply_remote_rows_with_focus, task_sync_snapshot, RemoteRow};
use serde_json::{json, Value};

async fn events(pool: &SqlitePool) -> Vec<KarmaEvent> {
    karma::list_events(pool).await.unwrap()
}

async fn task(pool: &SqlitePool, content: &str, priority: i64) -> String {
    create_local_task(pool, CreateTaskInput { content: content.into(), priority: Some(priority), ..Default::default() })
        .await.unwrap().id
}

async fn completed_at(pool: &SqlitePool, id: &str) -> Option<String> {
    sqlx::query_scalar("SELECT completed_at FROM local_tasks WHERE id = ?").bind(id).fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn complete_then_uncomplete_is_plus_one_then_minus_one_exactly_once() {
    let pool = test_pool().await;
    let id = task(&pool, "Send the draft", 1).await;
    update_task_status(&pool, &id, "complete", None).await.unwrap();
    let stamp = completed_at(&pool, &id).await.unwrap();
    update_task_status(&pool, &id, "complete", None).await.unwrap(); // already complete: no-op
    let e = events(&pool).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!(e[0].id, format!("task:{id}:{stamp}"));
    assert_eq!((e[0].kind.as_str(), e[0].points, e[0].date.as_str()), ("task", 1, &stamp[..10]));

    update_task_status(&pool, &id, "todo", None).await.unwrap();
    update_task_status(&pool, &id, "in_progress", None).await.unwrap(); // open -> open: nothing
    let e = events(&pool).await;
    assert_eq!(e.len(), 2, "{e:?}");
    let rev = e.iter().find(|x| x.kind == "untask").unwrap();
    assert_eq!((rev.id.clone(), rev.points), (format!("untask:{id}:{stamp}"), -1));
    assert_eq!(rev.date, stamp[..10], "the reversal lands on the original day");
    assert_eq!(e.iter().map(|x| x.points).sum::<i64>(), 0);
}

#[tokio::test]
async fn high_and_urgent_earn_the_priority_bonus() {
    let pool = test_pool().await;
    for (p, want) in [(1, 1), (2, 1), (3, 2), (4, 2)] {
        let id = task(&pool, &format!("p{p}"), p).await;
        update_task_status(&pool, &id, "complete", None).await.unwrap();
        let e = events(&pool).await.into_iter().find(|x| x.task_id.as_deref() == Some(id.as_str())).unwrap();
        assert_eq!(e.points, want, "priority {p}");
    }
}

#[tokio::test]
async fn a_recurring_occurrence_counts_once_per_due_date() {
    let pool = test_pool().await;
    let id = create_local_task(&pool, CreateTaskInput {
        content: "Stretch".into(), due_date: Some("2026-08-16".into()),
        recurrence_rule: Some("every day".into()), priority: Some(3), ..Default::default()
    }).await.unwrap().id;
    let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 16).unwrap();
    update_task_status_at(&pool, &id, "complete", None, today).await.unwrap();
    let e = events(&pool).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!(e[0].id, format!("recur:{id}:2026-08-16"));
    assert_eq!((e[0].kind.as_str(), e[0].points, e[0].date.as_str()), ("recur", 2, "2026-08-16"));
    // The same occurrence never repeats: put its due date back and complete it again.
    sqlx::query("UPDATE local_tasks SET due_date='2026-08-16' WHERE id=?").bind(&id).execute(&pool).await.unwrap();
    update_task_status_at(&pool, &id, "complete", None, today).await.unwrap();
    assert_eq!(events(&pool).await.len(), 1);
    // The next occurrence (now due 2026-08-17) is a new event.
    update_task_status_at(&pool, &id, "complete", None, today).await.unwrap();
    let ids: Vec<String> = events(&pool).await.into_iter().map(|x| x.id).collect();
    assert_eq!(ids.len(), 2, "{ids:?}");
    assert!(ids.contains(&format!("recur:{id}:2026-08-17")), "{ids:?}");
}

#[tokio::test]
async fn completing_a_parent_counts_each_child_it_closes() {
    let pool = test_pool().await;
    let parent = task(&pool, "Trip", 1).await;
    for c in ["Book", "Pack"] {
        create_local_task(&pool, CreateTaskInput { content: c.into(), parent_id: Some(parent.clone()), ..Default::default() })
            .await.unwrap();
    }
    update_task_status(&pool, &parent, "complete", None).await.unwrap();
    assert_eq!(events(&pool).await.iter().filter(|x| x.kind == "task").count(), 3);
}

#[tokio::test]
async fn the_focus_service_status_path_counts_once() {
    let h = Harness::new().await;
    let id = h.task("Write the brief").await;
    for _ in 0..2 {
        h.service.execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::SetStatus { id: id.clone(), status: "complete".into(), note: None, expected_due_date: None },
        }).await.unwrap();
    }
    let e = events(&h.pool).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!(e[0].kind, "task");
}

#[tokio::test]
async fn reopening_a_completion_the_ledger_never_saw_writes_nothing() {
    let pool = test_pool().await;
    let id = task(&pool, "Old win", 1).await;
    sqlx::query("UPDATE local_tasks SET status='complete', completed=1, completed_at='2026-01-05 09:00:00' WHERE id=?")
        .bind(&id).execute(&pool).await.unwrap();
    update_task_status(&pool, &id, "todo", None).await.unwrap();
    assert!(events(&pool).await.is_empty());
}

#[tokio::test]
async fn a_broken_ledger_never_fails_the_completion() {
    let pool = test_pool().await;
    let id = task(&pool, "Still completes", 1).await;
    sqlx::query("DROP TABLE karma_events").execute(&pool).await.unwrap();
    update_task_status(&pool, &id, "complete", None).await.unwrap();
    update_task_status(&pool, &id, "todo", None).await.unwrap();
    update_task_status(&pool, &id, "complete", None).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
    assert_eq!(status, "complete");
}

#[tokio::test]
async fn a_ledger_write_that_aborts_the_transaction_fails_the_completion() {
    // SQLite rolled the whole transaction back (FULL/IOERR/NOMEM); carrying on
    // would run the sync/outbox writes in autocommit for a lost mutation.
    let pool = test_pool().await;
    let id = task(&pool, "Lost write", 1).await;
    sqlx::raw_sql("CREATE TRIGGER karma_boom BEFORE INSERT ON karma_events BEGIN SELECT RAISE(ROLLBACK, 'boom'); END")
        .execute(&pool).await.unwrap();
    assert!(update_task_status(&pool, &id, "complete", None).await.is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
    assert_eq!(status, "todo");
    let outbox: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE row_id=? AND operation='UPDATE'")
        .bind(&id).fetch_one(&pool).await.unwrap();
    assert_eq!(outbox, 0, "no half-applied sync rows");
}


fn remote(table: &str, row_id: &str, op: &str, changed: Option<&str>, snapshot: String) -> RemoteRow {
    RemoteRow {
        entry_id: uuid::Uuid::new_v4().to_string(), table_name: table.into(), row_id: row_id.into(),
        operation: op.into(), changed_columns: changed.map(str::to_owned), snapshot: Some(snapshot),
        device_id: "web".into(), timestamp: "2099-01-01T00:00:00Z".into(),
    }
}

async fn row_json(pool: &SqlitePool, id: &str) -> Value {
    let t = nimble_core::db::tasks::get_local_tasks(pool, None, None, true).await.unwrap()
        .into_iter().find(|t| t.id == id).unwrap();
    serde_json::from_str(&task_sync_snapshot(&t)).unwrap()
}

const STATUS_COLS: &str = r#"["status","completed","completed_at"]"#;

#[tokio::test]
async fn a_turso_completion_counts_once_under_the_remote_stamp_and_a_reopen_reverses_it() {
    let pool = test_pool().await;
    let id = task(&pool, "Phone win", 1).await;
    let mut row = row_json(&pool, &id).await;
    row["status"] = json!("complete");
    row["completed"] = json!(1);
    row["completed_at"] = json!("2026-09-24 21:15:00");
    for _ in 0..2 { // the same change delivered twice
        apply_remote_rows_with_focus(&pool, None, &[remote("local_tasks", &id, "UPDATE", Some(STATUS_COLS), row.to_string())]).await.unwrap();
    }
    let e = events(&pool).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!((e[0].id.clone(), e[0].date.as_str()), (format!("task:{id}:2026-09-24 21:15:00"), "2026-09-24"));

    row["status"] = json!("todo");
    row["completed"] = json!(0);
    row["completed_at"] = Value::Null;
    apply_remote_rows_with_focus(&pool, None, &[remote("local_tasks", &id, "UPDATE", Some(STATUS_COLS), row.to_string())]).await.unwrap();
    assert_eq!(events(&pool).await.iter().map(|x| x.points).sum::<i64>(), 0);
}

#[tokio::test]
async fn a_turso_recurring_roll_forward_counts_the_occurrence_and_a_reschedule_does_not() {
    let pool = test_pool().await;
    let id = create_local_task(&pool, CreateTaskInput {
        content: "Water plants".into(), due_date: Some("2026-09-24".into()),
        recurrence_rule: Some("every day".into()), ..Default::default()
    }).await.unwrap().id;
    let mut row = row_json(&pool, &id).await;
    row["due_date"] = json!("2026-09-25");
    row["updated_at"] = json!("2026-09-24 23:50:00"); // the web's local stamp for the completion
    apply_remote_rows_with_focus(&pool, None, &[remote("local_tasks", &id, "UPDATE", Some(r#"["due_date","due_time","status"]"#), row.to_string())]).await.unwrap();
    let e = events(&pool).await;
    assert_eq!(e.len(), 1, "{e:?}");
    assert_eq!(e[0].id, format!("recur:{id}:2026-09-24"));
    assert_eq!((e[0].date.as_str(), e[0].created_at.as_str()), ("2026-09-24", "2026-09-24 23:50:00"), "dated when it happened, not when pulled");
    row["due_date"] = json!("2026-09-30");
    apply_remote_rows_with_focus(&pool, None, &[remote("local_tasks", &id, "UPDATE", Some(r#"["due_date"]"#), row.to_string())]).await.unwrap();
    assert_eq!(events(&pool).await.len(), 1);
}

#[tokio::test]
async fn a_pulled_ledger_row_and_the_local_hook_agree_on_one_row() {
    let pool = test_pool().await;
    let id = task(&pool, "Seen twice", 1).await;
    let stamp = "2026-09-24 08:00:00";
    let key = format!("task:{id}:{stamp}");
    let ledger = json!({"id": key, "date": "2026-09-24", "kind": "task", "points": 1, "task_id": id, "created_at": stamp});
    let mut row = row_json(&pool, &id).await;
    row["status"] = json!("complete");
    row["completed"] = json!(1);
    row["completed_at"] = json!(stamp);
    apply_remote_rows_with_focus(&pool, None, &[
        remote("karma_events", &key, "INSERT", None, ledger.to_string()),
        remote("local_tasks", &id, "UPDATE", Some(STATUS_COLS), row.to_string()),
    ]).await.unwrap();
    assert_eq!(events(&pool).await.len(), 1);
}
