//! R1 exit test: the EDD (Employment Development Department) benefits
//! certification task is the plan's motivating example for native recurrence
//! (see the schema-v19 plan doc) — a biweekly task that must live entirely in
//! `local_tasks` and reschedule itself correctly, twice in a row, without any
//! Todoist round-trip.
//!
//! Dates are injected via `update_task_status_at` rather than read from the
//! wall clock: `next_occurrence` only ever returns a date strictly after
//! `today`, so a test pinned to `chrono::Local::now()` would silently start
//! failing the day real time caught up with the fixture dates. See the note
//! in the Task 16 brief — "wall-clock-dependent assertions are how
//! recurrence bugs hide."

use nimble_core::db::tasks::{create_local_task, get_local_tasks, update_task_status_at};
use nimble_core::test_util::test_pool;
use nimble_core::types::CreateTaskInput;

#[tokio::test]
async fn edd_task_recurs_natively_twice() {
    let pool = test_pool().await;

    let created = create_local_task(
        &pool,
        CreateTaskInput {
            content: "Certify for EDD benefits (UI Online)".into(),
            due_date: Some("2026-08-16".into()),
            due_time: Some("09:00".into()),
            duration_minutes: Some(10),
            recurrence_rule: Some("every 2 weeks @ 09:00".into()),
            priority: Some(4),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // First completion: today is well before the next occurrence, so
    // `next_occurrence` walks exactly one interval forward from the
    // existing due date (2026-08-16 + 14 days).
    let today_1 = chrono::NaiveDate::from_ymd_opt(2026, 8, 10).unwrap();
    update_task_status_at(&pool, &created.id, "complete", None, today_1)
        .await
        .unwrap();
    let t = fetch(&pool, &created.id).await;
    assert_eq!(t.due_date.as_deref(), Some("2026-08-30"));
    assert_eq!(t.status, "todo");
    assert!(!t.completed);

    // Second completion: today is the date the task became due (a user
    // certifying right on time), still before the next occurrence
    // (2026-08-30 + 14 days = 2026-09-13), so the reschedule again lands
    // exactly one interval out rather than skipping ahead.
    let today_2 = chrono::NaiveDate::from_ymd_opt(2026, 8, 30).unwrap();
    update_task_status_at(&pool, &created.id, "complete", None, today_2)
        .await
        .unwrap();
    let t = fetch(&pool, &created.id).await;
    assert_eq!(t.due_date.as_deref(), Some("2026-09-13"));
    assert_eq!(t.status, "todo");
    assert!(!t.completed);
}

/// `update_task_status_at` returns `()` (it logs + notifies internally
/// rather than handing back the row), so re-fetch the task via the public
/// listing API to inspect post-recurrence state.
async fn fetch(pool: &sqlx::SqlitePool, id: &str) -> nimble_core::types::LocalTask {
    get_local_tasks(pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .expect("task still exists after status update")
}
