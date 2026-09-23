#[path = "common/focus.rs"]
mod fixture;

use nimble_core::db::{backup::{self, BackupPaths}, recovery};
use nimble_core::focus_types::{FocusAction, FocusSource};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

async fn file_harness() -> (fixture::Harness, std::path::PathBuf) {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    let clock = std::sync::Arc::new(nimble_core::db::focus::clock::ManualClock::default());
    let service = nimble_core::db::focus::engine::FocusService::with_clock(
        pool.clone(), "test-device".into(), clock.clone(),
    );
    service.initialize().await.unwrap();
    (fixture::Harness { pool, service, clock }, path)
}

async fn archive(source: &std::path::Path, root: &std::path::Path) -> std::path::PathBuf {
    std::fs::create_dir(root).unwrap();
    let database = root.join("nimble.db");
    std::fs::copy(source, &database).unwrap();
    let paths = BackupPaths {
        app_data: root.to_path_buf(), database, generations: root.join("backups"),
    };
    let guard = backup::try_lock(&paths).unwrap().unwrap();
    let generation = backup::create_generation(
        &paths,
        chrono::DateTime::parse_from_rfc3339("2026-09-22T12:00:00-07:00").unwrap(),
        "focus-test", &guard,
    ).await.unwrap();
    assert_eq!(backup::verify_generation(generation.directory()).await.unwrap().manifest().schema_version, 23);
    generation.directory().to_path_buf()
}

async fn restored_pool(path: &std::path::Path) -> sqlx::SqlitePool {
    SqlitePoolOptions::new().max_connections(1).connect_with(
        SqliteConnectOptions::new().filename(path).read_only(true).create_if_missing(false)
    ).await.unwrap()
}

#[tokio::test]
async fn paused_20_second_ledger_round_trips_both_archive_routes() {
    let (h, source_path) = file_harness().await;
    let a = h.task("Timed work").await;
    h.send(FocusAction::Enqueue { task_ids: vec![a.clone()], source: FocusSource::Today,
        explicit_still_open: false }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Pause).await.unwrap();
    sqlx::query("INSERT INTO focus_delivery(id,occurrence_id,purpose,payload_json,state,created_at) VALUES('pending-delivery',?,'close','{}','pending','2026-09-22T00:00:00Z')")
        .bind(&oid).execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_batches(id,source_namespace,file_hashes_json,preview_hash,mappings_json,created_at) VALUES('batch-a','legacy','{}','preview-a','{}','2026-09-22T00:00:00Z')")
        .execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO focus_import_records(id,batch_id,source_namespace,record_key,fingerprint,status) VALUES('record-a','batch-a','legacy','opaque-key','fingerprint','unresolved')")
        .execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO reminder_deliveries(occurrence_key,task_id,scheduled_at,state) VALUES('pending-reminder',?,'2026-09-22T00:00:00Z','pending')")
        .bind(&a).execute(&h.pool).await.unwrap();
    sqlx::query("INSERT INTO google_calendar_state(id,calendar_id,timezone,error_code) VALUES(1,'synthetic-calendar','America/Los_Angeles',NULL) ON CONFLICT(id) DO UPDATE SET calendar_id='synthetic-calendar'")
        .execute(&h.pool).await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool,"turso_url","https://example.invalid").await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool,"turso_token","synthetic-token").await.unwrap();
    let source = h.snapshot().await;
    let root = std::env::temp_dir().canonicalize().unwrap()
        .join(format!("focus-backup-{}", uuid::Uuid::new_v4()));
    let generation = archive(&source_path, &root).await;
    let source_export = nimble_core::db::export::export_portable(&h.pool).await.unwrap();
    assert_eq!(std::fs::read(generation.join("export/data.json")).unwrap(), source_export.data);
    for route in ["snapshot", "portable"] {
        let dest = root.join(route);
        let result = if route == "snapshot" {
            recovery::restore_snapshot(&generation, &dest).await
        } else {
            recovery::restore_export(&generation.join("export"), &dest).await
        }.unwrap();
        let restored = restored_pool(&result.output).await;
        assert!(recovery::require_activation_clear(&restored).await.is_err());
        let activation: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='restored_activation_required'")
            .fetch_one(&restored).await.unwrap();
        assert_eq!(activation, "1");
        // The gate wins before any transport or adapter can inspect saved credentials.
        assert!(nimble_core::db::sync::push(&restored, "https://example.invalid", "synthetic-token")
            .await.unwrap_err().to_string().contains("restore_activation_required"));
        assert!(nimble_core::db::sync::pull(&restored, "https://example.invalid", "synthetic-token")
            .await.unwrap_err().to_string().contains("restore_activation_required"));
        assert!(nimble_core::integrations::todoist::sync_loop::run_sync(&restored)
            .await.unwrap_err().to_string().contains("restore_activation_required"));
        if route == "snapshot" {
            let reminder: String = sqlx::query_scalar("SELECT state FROM reminder_deliveries WHERE occurrence_key='pending-reminder'")
                .fetch_one(&restored).await.unwrap();
            assert_eq!(reminder, "pending");
            let calendar: String = sqlx::query_scalar("SELECT calendar_id FROM google_calendar_state WHERE id=1")
                .fetch_one(&restored).await.unwrap();
            assert_eq!(calendar, "synthetic-calendar");
            let url: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='turso_url'")
                .fetch_one(&restored).await.unwrap();
            assert_eq!(url, "https://example.invalid");
        }
        let queue: String = sqlx::query_scalar("SELECT entries_json FROM focus_queue_state WHERE id=1")
            .fetch_one(&restored).await.unwrap();
        let entries: Vec<serde_json::Value> = serde_json::from_str(&queue).unwrap();
        assert_eq!(entries[0]["occurrence_id"], oid);
        assert_eq!(entries.len(), source.queue.len());
        let work: i64 = sqlx::query_scalar("SELECT work_ms FROM focus_sessions WHERE occurrence_id=?")
            .bind(&oid).fetch_one(&restored).await.unwrap();
        assert_eq!(work, 20_000);
        let status: String = sqlx::query_scalar("SELECT status FROM focus_sessions WHERE occurrence_id=?")
            .bind(&oid).fetch_one(&restored).await.unwrap();
        assert_eq!(status, "paused");
        let writer: String = sqlx::query_scalar("SELECT writer_device_id FROM focus_queue_state WHERE id=1")
            .fetch_one(&restored).await.unwrap();
        assert!(writer.is_empty());
        let delivery: String = sqlx::query_scalar("SELECT state FROM focus_delivery WHERE id='pending-delivery'")
            .fetch_one(&restored).await.unwrap();
        assert_eq!(delivery, "needs-review");
        let receipt_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM focus_command_receipts")
            .fetch_one(&restored).await.unwrap();
        assert!(receipt_count > 0);
        let record_key: String = sqlx::query_scalar("SELECT record_key FROM focus_import_records WHERE id='record-a'")
            .fetch_one(&restored).await.unwrap();
        assert_eq!(record_key, "opaque-key");
        restored.close().await;
    }
    std::fs::remove_dir_all(root).unwrap();
    h.pool.close().await;
    std::fs::remove_file(source_path).unwrap();
}

#[tokio::test]
async fn live_source_is_equal_before_activation_copy_is_disabled() {
    let (h, source_path) = file_harness().await;
    let a = h.task("Still running").await;
    h.send(FocusAction::Enqueue { task_ids: vec![a], source: FocusSource::Today,
        explicit_still_open: false }).await.unwrap();
    let oid = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: oid.clone() }).await.unwrap();
    h.advance(20_000).await;
    let root = std::env::temp_dir().canonicalize().unwrap()
        .join(format!("focus-live-backup-{}", uuid::Uuid::new_v4()));
    let generation = archive(&source_path, &root).await;
    let original = restored_pool(&generation.join("snapshot.db")).await;
    let original_status: String = sqlx::query_scalar("SELECT status FROM focus_sessions WHERE occurrence_id=?")
        .bind(&oid).fetch_one(&original).await.unwrap();
    assert_eq!(original_status, "running");
    original.close().await;
    let result = recovery::restore_snapshot(&generation, &root.join("activation")).await.unwrap();
    let restored = restored_pool(&result.output).await;
    let status: String = sqlx::query_scalar("SELECT status FROM focus_sessions WHERE occurrence_id=?")
        .bind(&oid).fetch_one(&restored).await.unwrap();
    assert_eq!(status, "paused");
    let live: Option<String> = sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
        .fetch_one(&restored).await.unwrap();
    assert!(live.is_none());
    let writer: String = sqlx::query_scalar("SELECT writer_device_id FROM focus_queue_state WHERE id=1")
        .fetch_one(&restored).await.unwrap();
    assert!(writer.is_empty());
    restored.close().await;
    let activation = SqlitePoolOptions::new().max_connections(1).connect_with(
        SqliteConnectOptions::new().filename(&result.output).create_if_missing(false)
    ).await.unwrap();
    let service = nimble_core::db::focus::engine::FocusService::new(
        activation.clone(), "test-device".into());
    let denied = service.initialize().await.unwrap_err();
    assert!(denied.to_string().contains("wrong_owner"));
    activation.close().await;
    std::fs::remove_dir_all(root).unwrap();
    h.pool.close().await;
    std::fs::remove_file(source_path).unwrap();
}

#[tokio::test]
async fn legacy_focus_marker_becomes_unknown_elapsed_note_only() {
    let pool = SqlitePoolOptions::new().max_connections(1)
        .connect("sqlite::memory:").await.unwrap();
    nimble_core::db::migrations::run_migrations_to_version(&pool, 20).await.unwrap();
    sqlx::query("INSERT INTO daily_state(date,focus_task_id,focus_started_at) VALUES('2026-09-22','legacy-task','2026-09-22 09:00:00')")
        .execute(&pool).await.unwrap();
    nimble_core::db::migrations::run_migrations(&pool).await.unwrap();
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT focus_task_id FROM daily_state WHERE date='2026-09-22'")
        .fetch_one(&pool).await.unwrap();
    assert!(marker.is_none());
    let note: String = sqlx::query_scalar(
        "SELECT metadata FROM activity_log WHERE action_type='focus_legacy_recovery'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&note).unwrap()["elapsed"], "unknown");
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM focus_sessions")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(sessions, 0);
    pool.close().await;
}
