use nimble_core::db::migrations::{current_schema_version, run_migrations, run_migrations_to_version};
use nimble_core::test_util::test_pool;
use sqlx::sqlite::SqlitePoolOptions;
use nimble_core::db::focus::schema::validate_config;
use nimble_core::focus_types::{FocusConfig, FocusMode};
use nimble_core::types::{CreateTaskInput, UpdateTaskInput};

#[tokio::test]
async fn focus_schema_is_present() {
    let pool = test_pool().await;
    for name in [
        "focus_queue_state", "focus_occurrences", "focus_sessions", "focus_segments",
        "focus_runtime", "focus_import_totals", "focus_command_receipts",
        "focus_import_batches", "focus_import_records", "focus_delivery", "focus_undo",
    ] {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?")
            .bind(name).fetch_one(&pool).await.unwrap();
        assert_eq!(count, 1, "{name}");
    }
}

#[test]
fn config_validation_enforces_mode_specific_budgets() {
    let mut config = FocusConfig { mode: FocusMode::CountUp, budget_ms: None, work_ms: 0, break_ms: 0, rounds: 1 };
    assert!(validate_config(&config).is_ok());
    config.budget_ms = Some(60_000);
    assert!(validate_config(&config).is_err());
    config.mode = FocusMode::Timebox;
    assert!(validate_config(&config).is_ok());
    for invalid in [0, 1, 60_001, 1_441 * 60_000, 9_007_199_254_740_992] {
        config.budget_ms = Some(invalid);
        assert!(validate_config(&config).is_err(), "invalid budget {invalid}");
    }
    config.mode = FocusMode::Pomodoro;
    config.budget_ms = None;
    config.work_ms = 25 * 60_000;
    config.break_ms = 5 * 60_000;
    assert!(validate_config(&config).is_ok());
    config.rounds = 101;
    assert!(validate_config(&config).is_err());
    config.rounds = 1;
    config.break_ms = 999;
    assert!(validate_config(&config).is_err());
}

#[tokio::test]
async fn ordinary_task_crud_retains_local_only_policy() {
    let pool = test_pool().await;
    let task = nimble_core::db::tasks::create_local_task(&pool, CreateTaskInput {
        content: "Imported".into(), sync_policy: Some("local_only".into()), ..Default::default()
    }).await.unwrap();
    assert_eq!(task.sync_policy, "local_only");
    let task = nimble_core::db::tasks::update_local_task(&pool, &task.id, UpdateTaskInput {
        content: Some("Renamed".into()), ..Default::default()
    }).await.unwrap();
    assert_eq!(task.sync_policy, "local_only");
    let snapshot = nimble_core::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap().remove(0);
    assert_eq!(snapshot.sync_policy, "local_only");
}

#[tokio::test]
async fn v20_upgrade_preserves_task_and_is_idempotent() {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    run_migrations_to_version(&pool, 20).await.unwrap();
    sqlx::query("INSERT INTO local_tasks (id, content) VALUES ('old-task', 'Keep me')")
        .execute(&pool).await.unwrap();
    run_migrations(&pool).await.unwrap();
    run_migrations(&pool).await.unwrap();
    let row: (String, String) = sqlx::query_as("SELECT content, sync_policy FROM local_tasks WHERE id='old-task'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(row, ("Keep me".into(), "default".into()));
    assert_eq!(current_schema_version(&pool).await.unwrap(), 24); // schema-v24
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM schema_version WHERE version=21")
        .fetch_one(&pool).await.unwrap(), 1);
}

#[tokio::test]
async fn focus_constraints_preserve_history_and_unique_sources() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO local_tasks (id, content) VALUES ('original', 'Task')").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_occurrences (id, task_id, original_task_id, title_snapshot, generation, state, created_at) VALUES ('o1', 'original', 'original', 'Task', 1, 'open', '2026-09-22T00:00:00Z')")
        .execute(&pool).await.unwrap();
    assert!(sqlx::query("INSERT INTO focus_occurrences (id, original_task_id, title_snapshot, generation, state, created_at) VALUES ('o2', 'original', 'Task', 1, 'open', '2026-09-22T00:00:00Z')")
        .execute(&pool).await.is_err());
    sqlx::query("DELETE FROM local_tasks WHERE id='original'").execute(&pool).await.unwrap();
    let row: (Option<String>, String) = sqlx::query_as("SELECT task_id, original_task_id FROM focus_occurrences WHERE id='o1'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(row, (None, "original".into()));
    assert!(sqlx::query("INSERT INTO focus_sessions (id, occurrence_id, owner_device_id, owner_epoch, status, mode, config_json, work_ms, break_ms, round_work_ms, round, session_revision) VALUES ('s1','o1','d','e','paused','count_up','{}',-1,0,0,1,0)")
        .execute(&pool).await.is_err());
    sqlx::query("INSERT INTO local_tasks (id, content) VALUES ('remaining', 'Task')").execute(&pool).await.unwrap();
    assert!(sqlx::query("UPDATE local_tasks SET sync_policy='bogus' WHERE id='remaining'").execute(&pool).await.is_err());
}

#[tokio::test]
async fn persisted_focus_numbers_stay_within_javascript_safe_integer_range() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO focus_queue_state (id, queue_id, writer_device_id, owner_epoch, updated_at) VALUES (1,'q','d','e','now')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_occurrences (id, original_task_id, title_snapshot, generation, state, created_at) VALUES ('o','t','T',1,'open','now')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_sessions (id, occurrence_id, owner_device_id, owner_epoch, status, mode, config_json) VALUES ('s','o','d','e','paused','count_up','{}')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_segments (id, session_id, kind, started_at, checkpoint_at, closed_at) VALUES ('g','s','work','now','now','now')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_runtime (id, owner_epoch) VALUES (1,'e')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_batches (id, source_namespace, file_hashes_json, preview_hash, mappings_json, created_at) VALUES ('b','source','{}','hash','{}','now')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_totals (id, source_namespace, record_key, duration_ms, source_kind, batch_id, inclusion) VALUES ('i','source','record',0,'timer','b','included')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_command_receipts (command_id, request_hash, result_json, committed_revision, committed_at) VALUES ('c','hash','{}',0,'now')")
        .execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO focus_delivery (id, occurrence_id, purpose, payload_json, state, created_at) VALUES ('d','o','complete','{}','pending','now')")
        .execute(&pool).await.unwrap();

    for (table, column, id) in [
        ("focus_queue_state", "revision", "1"),
        ("focus_occurrences", "generation", "'o'"),
        ("focus_sessions", "work_ms", "'s'"),
        ("focus_sessions", "break_ms", "'s'"),
        ("focus_sessions", "round_work_ms", "'s'"),
        ("focus_sessions", "session_revision", "'s'"),
        ("focus_segments", "duration_ms", "'g'"),
        ("focus_runtime", "process_generation", "1"),
        ("focus_runtime", "engine_revision", "1"),
        ("focus_runtime", "heartbeat_sequence", "1"),
        ("focus_import_totals", "duration_ms", "'i'"),
        ("focus_command_receipts", "committed_revision", "'c'"),
        ("focus_delivery", "attempts", "'d'"),
    ] {
        let key = if id == "1" { "id" } else if table == "focus_command_receipts" { "command_id" } else { "id" };
        let sql = format!("UPDATE {table} SET {column}=? WHERE {key}={id}");
        assert!(sqlx::query(&sql).bind(9_007_199_254_740_991_i64).execute(&pool).await.is_ok(), "max rejected: {table}.{column}");
        assert!(sqlx::query(&sql).bind(9_007_199_254_740_992_i64).execute(&pool).await.is_err(), "unsafe integer accepted: {table}.{column}");
    }
    assert!(sqlx::query("UPDATE focus_sessions SET round=100 WHERE id='s'").execute(&pool).await.is_ok());
    assert!(sqlx::query("UPDATE focus_sessions SET round=101 WHERE id='s'").execute(&pool).await.is_err());
}
