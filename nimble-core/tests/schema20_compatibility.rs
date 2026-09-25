use nimble_core::{
    db::{
        export::export_portable,
        migrations,
        tasks::{create_local_task, update_local_task},
    },
    types::{CreateTaskInput, UpdateTaskInput},
};

#[tokio::test]
async fn v20_intent_exports_and_local_ledgers_stay_private() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
        .connect("sqlite::memory:").await.unwrap();
    migrations::run_migrations_to_version(&pool, 20).await.unwrap();
    assert_eq!(migrations::current_schema_version(&pool).await.unwrap(), 20);
    sqlx::query("INSERT INTO local_tasks(id,content,due_date,due_time,reminder_offset_minutes,google_calendar_enabled) VALUES('v20-task','Review','2026-09-22','09:00',15,1)")
        .execute(&pool).await.unwrap();
    let export = export_portable(&pool).await.unwrap();
    let data: serde_json::Value = serde_json::from_slice(&export.data).unwrap();
    let format: serde_json::Value = serde_json::from_slice(&export.format).unwrap();
    assert_eq!(format["schema_version"], 20);
    assert_eq!(data["local_tasks"][0]["reminder_offset_minutes"], 15);
    let root = std::env::temp_dir().canonicalize().unwrap()
        .join(format!("nimble-v20-compat-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let source = root.join("portable");
    std::fs::create_dir(&source).unwrap();
    std::fs::write(source.join("data.json"), &export.data).unwrap();
    std::fs::write(source.join("format.json"), &export.format).unwrap();
    let restored = nimble_core::db::recovery::restore_export(&source, &root.join("restored"))
        .await.unwrap();
    let copy = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(restored.output).read_only(true)
    ).await.unwrap();
    let round_trip = export_portable(&copy).await.unwrap();
    assert_eq!(round_trip.data, export.data);
    assert_eq!(round_trip.format, export.format);
    copy.close().await;
    std::fs::remove_dir_all(root).unwrap();
    for private in [
        "reminder_deliveries",
        "google_calendar_state",
        "google_calendar_links",
        "google_calendar_conflicts",
    ] {
        assert!(data.get(private).is_none());
        assert!(format["excluded"].get(private).is_some());
    }
    sqlx::query("UPDATE local_tasks SET due_time=NULL,reminder_offset_minutes=NULL,google_calendar_enabled=0 WHERE id='v20-task'")
        .execute(&pool).await.unwrap();
    let cleared: (Option<i64>, i64) = sqlx::query_as("SELECT reminder_offset_minutes,google_calendar_enabled FROM local_tasks WHERE id='v20-task'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(cleared, (None, 0));
    pool.close().await;
}

#[tokio::test]
async fn populated_v19_migrates_without_changing_existing_task_or_label() {
    let path =
        std::env::temp_dir().join(format!("nimble-v19-migration-{}.db", uuid::Uuid::new_v4()));
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true),
        )
        .await
        .unwrap();
    migrations::run_migrations_to_version(&pool, 19)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO local_tasks (id,content,project_id) VALUES ('legacy-task','Legacy','inbox')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO labels (id,name) VALUES ('legacy-label','Legacy')")
        .execute(&pool)
        .await
        .unwrap();
    migrations::run_migrations(&pool).await.unwrap();
    let task: (String, Option<i64>, i64) = sqlx::query_as("SELECT content,reminder_offset_minutes,google_calendar_enabled FROM local_tasks WHERE id='legacy-task'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(task, ("Legacy".into(), None, 0));
    let label: (String, Option<String>) =
        sqlx::query_as("SELECT name,\"group\" FROM labels WHERE id='legacy-label'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(label, ("Legacy".into(), None));
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn invalid_reminder_intent_never_creates_task() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    for offset in [-1, 40321] {
        assert!(create_local_task(
            &pool,
            CreateTaskInput {
                content: "Invalid".into(),
                due_date: Some("2026-09-22".into()),
                due_time: Some("09:00".into()),
                reminder_offset_minutes: Some(offset),
                ..Default::default()
            }
        )
        .await
        .is_err());
    }
    assert!(create_local_task(
        &pool,
        CreateTaskInput {
            content: "No time".into(),
            reminder_offset_minutes: Some(5),
            ..Default::default()
        }
    )
    .await
    .is_err());
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM local_tasks WHERE content IN ('Invalid','No time')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn calendar_pull_rejects_a_stale_task_snapshot() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    let initial = create_local_task(
        &pool,
        CreateTaskInput {
            content: "First".into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let edited = update_local_task(
        &pool,
        &initial.id,
        UpdateTaskInput {
            content: Some("CLI edit".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let stale = nimble_core::db::tasks::update_local_task_if_unchanged(
        &pool,
        &initial.id,
        &initial,
        UpdateTaskInput {
            content: Some("Google edit".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(stale.is_none());
    let current = nimble_core::db::tasks::update_local_task_if_unchanged(
        &pool,
        &initial.id,
        &edited,
        UpdateTaskInput {
            content: Some("Google edit".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(current.unwrap().content, "Google edit");
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn concurrent_due_time_clear_prevents_untimed_reminder() {
    use std::time::Duration;
    let path = std::env::temp_dir().join(format!(
        "nimble-concurrent-task-{}.db",
        uuid::Uuid::new_v4()
    ));
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await
        .unwrap();
    migrations::run_migrations(&pool).await.unwrap();
    let task = create_local_task(
        &pool,
        CreateTaskInput {
            content: "Timed".into(),
            due_date: Some("2026-09-22".into()),
            due_time: Some("09:00".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut blocker = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query("UPDATE local_tasks SET due_time=NULL WHERE id=?")
        .bind(&task.id)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let worker_pool = pool.clone();
    let task_id = task.id.clone();
    let handle = tokio::spawn(async move {
        update_local_task(
            &worker_pool,
            &task_id,
            UpdateTaskInput {
                reminder_offset_minutes: Some(15),
                ..Default::default()
            },
        )
        .await
    });
    tokio::task::yield_now().await;
    blocker.commit().await.unwrap();
    assert!(handle.await.unwrap().is_err());
    let row: (Option<String>, Option<i64>) =
        sqlx::query_as("SELECT due_time,reminder_offset_minutes FROM local_tasks WHERE id=?")
            .bind(&task.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, (None, None));
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn cancelled_immediate_transaction_releases_writer_lock() {
    use std::time::Duration;
    let path = std::env::temp_dir().join(format!("nimble-cancel-task-{}.db", uuid::Uuid::new_v4()));
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .busy_timeout(Duration::from_secs(2)),
        )
        .await
        .unwrap();
    migrations::run_migrations(&pool).await.unwrap();
    let (acquired_tx, acquired_rx) = tokio::sync::oneshot::channel();
    let worker_pool = pool.clone();
    let handle = tokio::spawn(async move {
        let mut tx = worker_pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        sqlx::query("INSERT INTO local_tasks(id,content,project_id) VALUES('uncommitted','Discard','inbox')")
            .execute(&mut *tx).await.unwrap();
        acquired_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    acquired_rx.await.unwrap();
    handle.abort();
    let _ = handle.await;
    tokio::time::timeout(Duration::from_secs(3), async {
        let task = create_local_task(
            &pool,
            CreateTaskInput {
                content: "After cancel".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(task.content, "After cancel");
    })
    .await
    .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE id='uncommitted'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn project_move_clears_retained_section_but_accepts_explicit_destination_section() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    let first = nimble_core::db::projects::create_project(&pool, "First", "gray", None)
        .await.unwrap();
    let second = nimble_core::db::projects::create_project(&pool, "Second", "gray", None)
        .await.unwrap();
    let first_section = nimble_core::db::sections::create_section(&pool, &first.id, "First section")
        .await.unwrap();
    let second_section = nimble_core::db::sections::create_section(&pool, &second.id, "Second section")
        .await.unwrap();
    let task = create_local_task(&pool, CreateTaskInput {
        content: "Move me".into(), project_id: Some(first.id.clone()),
        section_id: Some(first_section.id.clone()), ..Default::default()
    }).await.unwrap();
    let same_project = update_local_task(&pool, &task.id, UpdateTaskInput {
        content: Some("Edited".into()), ..Default::default()
    }).await.unwrap();
    assert_eq!(same_project.section_id.as_deref(), Some(first_section.id.as_str()));
    let moved = update_local_task(&pool, &task.id, UpdateTaskInput {
        project_id: Some(second.id.clone()), ..Default::default()
    }).await.unwrap();
    assert_eq!(moved.project_id, second.id);
    assert!(moved.section_id.is_none());
    let changed: Option<String> = sqlx::query_scalar("SELECT changed_columns FROM sync_log WHERE table_name='local_tasks' AND row_id=? AND operation='UPDATE' ORDER BY rowid DESC LIMIT 1")
        .bind(&task.id).fetch_one(&pool).await.unwrap();
    assert!(changed.unwrap().contains("section_id"));
    assert!(update_local_task(&pool, &task.id, UpdateTaskInput {
        project_id: Some(first.id.clone()), section_id: Some(second_section.id.clone()), ..Default::default()
    }).await.is_err());
    let explicit = update_local_task(&pool, &task.id, UpdateTaskInput {
        project_id: Some(first.id.clone()), section_id: Some(first_section.id.clone()), ..Default::default()
    }).await.unwrap();
    assert_eq!(explicit.section_id.as_deref(), Some(first_section.id.as_str()));
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

/// Final review I3: a failure part-way through v21 must leave a populated
/// v20 database exactly v20 (no partial columns/tables), and a rerun succeeds.
#[tokio::test]
async fn failed_v21_migration_rolls_back_to_exact_v20_and_rerun_succeeds() {
    let root = std::env::temp_dir().canonicalize().unwrap()
        .join(format!("nimble-v21-atomic-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(root.join("nimble.db")).create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
        .connect_with(options).await.unwrap();
    migrations::run_migrations_to_version(&pool, 20).await.unwrap();
    sqlx::query("INSERT INTO local_tasks(id,content,due_date) VALUES('v20-task','Review','2026-09-22')")
        .execute(&pool).await.unwrap();
    // Injected failure: v21's LAST table already exists, so the migration
    // fails after its ALTER TABLE and earlier CREATEs have run.
    sqlx::query("CREATE TABLE focus_replica(x)").execute(&pool).await.unwrap();
    let schema_before: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT name, sql FROM sqlite_master ORDER BY name")
            .fetch_all(&pool).await.unwrap();

    let failed = migrations::run_migrations(&pool).await;
    assert!(failed.is_err(), "injected failure must surface");
    assert_eq!(migrations::current_schema_version(&pool).await.unwrap(), 20);
    let schema_after: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT name, sql FROM sqlite_master ORDER BY name")
            .fetch_all(&pool).await.unwrap();
    assert_eq!(schema_after, schema_before, "no partial v21 objects or columns");
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('local_tasks')")
        .fetch_all(&pool).await.unwrap();
    assert!(!columns.iter().any(|c| c == "sync_policy"));

    // Clear the injected obstacle; the rerun applies v21 (and, since
    // `run_migrations` always builds to `CURRENT_SCHEMA_VERSION`, later versions too).
    sqlx::query("DROP TABLE focus_replica").execute(&pool).await.unwrap();
    migrations::run_migrations(&pool).await.unwrap();
    assert_eq!(migrations::current_schema_version(&pool).await.unwrap(), 24); // schema-v24
    let policy: String = sqlx::query_scalar("SELECT sync_policy FROM local_tasks WHERE id='v20-task'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(policy, "default");
    pool.close().await;
    std::fs::remove_dir_all(root).unwrap();
}
