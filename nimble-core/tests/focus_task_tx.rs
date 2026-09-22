use nimble_core::db::task_tx::{create_task_tx, set_status_tx, MutationPolicy};
use nimble_core::types::CreateTaskInput;

#[tokio::test]
async fn task_and_delivery_intent_rollback_together() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    let input = CreateTaskInput {
        content: "Rollback task".into(),
        ..Default::default()
    };
    let task = create_task_tx(&mut tx, input, MutationPolicy::User)
        .await
        .unwrap();
    let inserted: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks WHERE id=?")
        .bind(&task.id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(inserted, 1);
    let intents: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
        .bind(&task.id)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(intents, 1);
    tx.rollback().await.unwrap();
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, before);
    let intents_after: i64 =
        sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
            .bind(&task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(intents_after, 0);
}

#[tokio::test]
async fn local_only_create_update_and_seed_never_export() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let task = nimble_core::db::tasks::create_local_task(
        &pool,
        CreateTaskInput {
            content: "Private".into(),
            sync_policy: Some("local_only".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    nimble_core::db::tasks::update_local_task(
        &pool,
        &task.id,
        nimble_core::types::UpdateTaskInput {
            content: Some("Still private".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let (seeded, _) = nimble_core::integrations::todoist::observer::seed_outbox_for_unlinked(&pool)
        .await
        .unwrap();
    assert_eq!(seeded, 0);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
        .bind(&task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn remote_and_import_mutations_do_not_echo_todoist() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let remote = create_task_tx(
        &mut tx,
        CreateTaskInput {
            content: "Remote".into(),
            ..Default::default()
        },
        MutationPolicy::Remote,
    )
    .await
    .unwrap();
    let imported = create_task_tx(
        &mut tx,
        CreateTaskInput {
            content: "Imported".into(),
            ..Default::default()
        },
        MutationPolicy::Import,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    for id in [&remote.id, &imported.id] {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[tokio::test]
async fn local_only_pull_delete_does_not_enqueue() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let task = nimble_core::db::tasks::create_local_task(
        &pool,
        CreateTaskInput {
            content: "Private".into(),
            sync_policy: Some("local_only".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    nimble_core::integrations::todoist::observer::on_turso_row_applied(
        &pool,
        "local_tasks",
        &task.id,
        None,
        Some("local_only".into()),
        true,
    )
    .await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
        .bind(&task.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn failed_delivery_intent_rolls_back_native_completion() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let task = nimble_core::db::tasks::create_local_task(
        &pool,
        CreateTaskInput {
            content: "Must stay open".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    sqlx::query("CREATE TRIGGER reject_close_intent BEFORE INSERT ON todoist_outbox WHEN NEW.op='close' BEGIN SELECT RAISE(ABORT, 'synthetic delivery failure'); END")
        .execute(&pool).await.unwrap();
    let result = nimble_core::db::tasks::update_task_status_at(
        &pool,
        &task.id,
        "complete",
        None,
        chrono::NaiveDate::from_ymd_opt(2026, 9, 22).unwrap(),
    )
    .await;
    assert!(result.is_err());
    let state: (String, i64) =
        sqlx::query_as("SELECT status, completed FROM local_tasks WHERE id=?")
            .bind(&task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(state, ("todo".into(), 0));
}

#[tokio::test]
async fn switching_to_local_only_cancels_unsent_intents() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let task = nimble_core::db::tasks::create_local_task(
        &pool,
        CreateTaskInput {
            content: "Initially exportable".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    nimble_core::db::tasks::update_local_task(
        &pool,
        &task.id,
        nimble_core::types::UpdateTaskInput {
            sync_policy: Some("local_only".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM todoist_outbox WHERE local_id=? AND status='pending'",
    )
    .bind(&task.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn switching_back_to_default_restores_create_intent() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let task = nimble_core::db::tasks::create_local_task(
        &pool,
        CreateTaskInput {
            content: "Local".into(),
            sync_policy: Some("local_only".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    nimble_core::db::tasks::update_local_task(
        &pool,
        &task.id,
        nimble_core::types::UpdateTaskInput {
            sync_policy: Some("default".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let ops: Vec<(String,)> =
        sqlx::query_as("SELECT op FROM todoist_outbox WHERE local_id=? AND status='pending'")
            .bind(&task.id)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(ops, vec![("create".into(),)]);
}

#[tokio::test]
async fn recurring_completion_emits_due_update_without_close() {
    let pool = nimble_core::test_util::test_pool().await;
    nimble_core::integrations::ensure_state(&pool, "todoist")
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&pool, "todoist_api_token", "synthetic")
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let task = create_task_tx(
        &mut tx,
        CreateTaskInput {
            content: "Recurring".into(),
            due_date: Some("2026-09-22".into()),
            recurrence_rule: Some("every day".into()),
            ..Default::default()
        },
        MutationPolicy::User,
    )
    .await
    .unwrap();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 22).unwrap();
    let effects = set_status_tx(&mut tx, &task.id, "complete", today, MutationPolicy::User)
        .await
        .unwrap();
    assert!(effects.recurrence.is_some());
    let ops: Vec<(String,)> =
        sqlx::query_as("SELECT op FROM todoist_outbox WHERE local_id=? ORDER BY rowid")
            .bind(&task.id)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
    assert_eq!(ops.iter().filter(|(op,)| op == "close").count(), 0);
    tx.rollback().await.unwrap();
}
