use nimble_core::{db::{export::export_portable, migrations, tasks::{create_local_task, update_local_task}}, types::{CreateTaskInput, UpdateTaskInput}};

#[tokio::test]
async fn v20_intent_exports_and_local_ledgers_stay_private() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    assert_eq!(migrations::current_schema_version(&pool).await.unwrap(), 20);
    let task = create_local_task(&pool, CreateTaskInput { content: "Review".into(), due_date: Some("2026-09-22".into()), due_time: Some("09:00".into()), reminder_offset_minutes: Some(15), google_calendar_enabled: Some(true), ..Default::default() }).await.unwrap();
    assert_eq!(task.reminder_offset_minutes, Some(15));
    assert!(task.google_calendar_enabled);
    let export = export_portable(&pool).await.unwrap();
    let data: serde_json::Value = serde_json::from_slice(&export.data).unwrap();
    let format: serde_json::Value = serde_json::from_slice(&export.format).unwrap();
    assert_eq!(format["schema_version"], 20);
    assert_eq!(data["local_tasks"][0]["reminder_offset_minutes"], 15);
    for private in ["reminder_deliveries", "google_calendar_state", "google_calendar_links", "google_calendar_conflicts"] {
        assert!(data.get(private).is_none());
        assert!(format["excluded"].get(private).is_some());
    }
    let cleared = update_local_task(&pool, &task.id, UpdateTaskInput { clear_due_time: true, ..Default::default() }).await.unwrap();
    assert_eq!(cleared.reminder_offset_minutes, None);
    assert!(!cleared.google_calendar_enabled);
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn populated_v19_migrates_without_changing_existing_task_or_label() {
    let path = std::env::temp_dir().join(format!("nimble-v19-migration-{}.db", uuid::Uuid::new_v4()));
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&path).create_if_missing(true))
        .await.unwrap();
    migrations::run_migrations_to_version(&pool, 19).await.unwrap();
    sqlx::query("INSERT INTO local_tasks (id,content,project_id) VALUES ('legacy-task','Legacy','inbox')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO labels (id,name) VALUES ('legacy-label','Legacy')")
        .execute(&pool).await.unwrap();
    migrations::run_migrations(&pool).await.unwrap();
    let task: (String, Option<i64>, i64) = sqlx::query_as("SELECT content,reminder_offset_minutes,google_calendar_enabled FROM local_tasks WHERE id='legacy-task'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(task, ("Legacy".into(), None, 0));
    let label: (String, Option<String>) = sqlx::query_as("SELECT name,\"group\" FROM labels WHERE id='legacy-label'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(label, ("Legacy".into(), None));
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn invalid_reminder_intent_never_creates_task() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    for offset in [-1, 40321] {
        assert!(create_local_task(&pool, CreateTaskInput { content: "Invalid".into(), due_date: Some("2026-09-22".into()), due_time: Some("09:00".into()), reminder_offset_minutes: Some(offset), ..Default::default() }).await.is_err());
    }
    assert!(create_local_task(&pool, CreateTaskInput { content: "No time".into(), reminder_offset_minutes: Some(5), ..Default::default() }).await.is_err());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE content IN ('Invalid','No time')").fetch_one(&pool).await.unwrap();
    assert_eq!(count, 0);
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn calendar_pull_rejects_a_stale_task_snapshot() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    let initial = create_local_task(&pool, CreateTaskInput { content: "First".into(), ..Default::default() }).await.unwrap();
    let edited = update_local_task(&pool, &initial.id, UpdateTaskInput { content: Some("CLI edit".into()), ..Default::default() }).await.unwrap();
    let stale = nimble_core::db::tasks::update_local_task_if_unchanged(&pool, &initial.id, &initial,
        UpdateTaskInput { content: Some("Google edit".into()), ..Default::default() }).await.unwrap();
    assert!(stale.is_none());
    let current = nimble_core::db::tasks::update_local_task_if_unchanged(&pool, &initial.id, &edited,
        UpdateTaskInput { content: Some("Google edit".into()), ..Default::default() }).await.unwrap();
    assert_eq!(current.unwrap().content, "Google edit");
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}
