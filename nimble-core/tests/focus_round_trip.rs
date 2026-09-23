//! Task 12 integration evidence: backup -> import -> repeat import -> isolated
//! restore, plus a rollback rehearsal from a pre-import generation. Synthetic
//! fixtures only (tests/fixtures/focus); no transport is constructed, so any
//! "remote write" would have to appear as an armed outbox/delivery row.
#[path = "common/focus.rs"]
mod fixture;

use nimble_core::db::backup::{self, BackupPaths};
use nimble_core::db::focus::import::{commit_import, preview_import};
use nimble_core::db::recovery;
use nimble_core::focus_types::{FocusAction, FocusSource, LegacyFocusFiles};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

fn fixture_file(name: &str) -> String {
    std::fs::read_to_string(format!("{}/tests/fixtures/focus/{name}", env!("CARGO_MANIFEST_DIR")))
        .unwrap()
}

fn files() -> LegacyFocusFiles {
    LegacyFocusFiles {
        source_namespace: "fixture".into(),
        state_json: Some(fixture_file("state.json")),
        manual_json: Some(fixture_file("manual.json")),
        pending_json: Some(fixture_file("pending.json")),
    }
}

async fn scalar(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

/// Canonical, order-stable dump of everything that defines the focus ledger,
/// the queue order and the local-only status of tasks.
async fn ledger(pool: &SqlitePool) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for (name, sql) in [
        ("queue", "SELECT entries_json FROM focus_queue_state WHERE id=1"),
        ("sessions", "SELECT json_group_array(json_array(id,occurrence_id,mode,work_ms,break_ms,started_at,ended_at)) FROM (SELECT * FROM focus_sessions ORDER BY id)"),
        ("occurrences", "SELECT json_group_array(json_array(id,task_id,original_task_id,state,completed_at)) FROM (SELECT * FROM focus_occurrences ORDER BY id)"),
        ("totals", "SELECT json_group_array(json_array(record_key,occurrence_id,unresolved_task_id,duration_ms,inclusion,source_kind)) FROM (SELECT * FROM focus_import_totals ORDER BY record_key)"),
        ("records", "SELECT json_group_array(json_array(record_key,status,fingerprint)) FROM (SELECT * FROM focus_import_records ORDER BY record_key)"),
        ("tasks", "SELECT json_group_array(json_array(id,content,sync_policy,external_id,completed)) FROM (SELECT * FROM local_tasks ORDER BY id)"),
        ("batches", "SELECT json_group_array(json_array(id,preview_hash)) FROM (SELECT * FROM focus_import_batches ORDER BY id)"),
    ] {
        let raw: String = sqlx::query_scalar(sql).fetch_one(pool).await.unwrap();
        out.insert(name.into(), serde_json::from_str(&raw).unwrap());
    }
    serde_json::Value::Object(out)
}

/// Per-occurrence exact total from the stored rows (sessions + included imports).
async fn stored_totals(pool: &SqlitePool) -> Vec<(String, i64)> {
    sqlx::query_as(
        "SELECT o.id, COALESCE((SELECT SUM(work_ms) FROM focus_sessions s WHERE s.occurrence_id=o.id),0)
                + COALESCE((SELECT SUM(duration_ms) FROM focus_import_totals t WHERE t.occurrence_id=o.id AND t.inclusion='included'),0)
         FROM focus_occurrences o ORDER BY o.id",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn generation(source: &std::path::Path, root: &std::path::Path, label: &str) -> std::path::PathBuf {
    std::fs::create_dir_all(root).unwrap();
    let database = root.join("nimble.db");
    std::fs::copy(source, &database).unwrap();
    let paths = BackupPaths { app_data: root.to_path_buf(), database, generations: root.join("backups") };
    let guard = backup::try_lock(&paths).unwrap().unwrap();
    let g = backup::create_generation(
        &paths,
        chrono::DateTime::parse_from_rfc3339("2026-09-22T12:00:00-07:00").unwrap(),
        label,
        &guard,
    )
    .await
    .unwrap();
    backup::verify_generation(g.directory()).await.unwrap();
    g.directory().to_path_buf()
}

async fn read_only(path: &std::path::Path) -> SqlitePool {
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(path).read_only(true).create_if_missing(false))
        .await
        .unwrap()
}

#[tokio::test]
async fn backup_import_repeat_restore_and_rollback_keep_exact_local_only_time() {
    let (pool, source_path) = nimble_core::test_util::file_pool().await;
    let clock = std::sync::Arc::new(nimble_core::db::focus::clock::ManualClock::default());
    let service = nimble_core::db::focus::engine::FocusService::with_clock(
        pool.clone(),
        "test-device".into(),
        clock.clone(),
    );
    service.initialize().await.unwrap();
    let h = fixture::Harness { pool, service, clock };
    // Todoist looks connected so an accidental observer/outbox path would show up.
    nimble_core::integrations::ensure_state(&h.pool, "todoist").await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool, "todoist_api_token", "synthetic").await.unwrap();

    // Existing Nimble work: exactly 20,000 ms, paused.
    let existing = h.task("Existing Nimble task").await;
    h.send(FocusAction::Enqueue { task_ids: vec![existing.clone()], source: FocusSource::Local, explicit_still_open: false })
        .await
        .unwrap();
    let existing_occ = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: existing_occ.clone() }).await.unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Pause).await.unwrap();
    let outbox_before = scalar(&h.pool, "SELECT count(*) FROM todoist_outbox").await;
    let pre_import = ledger(&h.pool).await;
    let pre_export = nimble_core::db::export::export_portable(&h.pool).await.unwrap();

    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("focus-round-trip-{}", uuid::Uuid::new_v4()));
    // 1. Rollback point: a verified pre-import generation.
    let g0 = generation(&source_path, &root.join("pre"), "pre-import").await;
    assert_eq!(std::fs::read(g0.join("export/data.json")).unwrap(), pre_export.data);

    // 2. Import synthetic legacy files.
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    assert!(!preview.blocked, "{:?}", preview.issues);
    let result = commit_import(&h.pool, &files(), &preview.preview_token, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    assert_eq!(result.created_task_ids.len(), 2);

    let snap = h.snapshot().await;
    let order: Vec<_> = snap.queue.iter().map(|e| e.task_id.clone()).collect();
    assert_eq!(order.len(), 2);
    assert_eq!(order[0], existing, "existing queue first");
    assert_eq!(snap.totals[&existing_occ], 20_000);
    assert_eq!(snap.totals[&snap.queue[1].occurrence_id], 7_000);
    assert!(snap.session.as_ref().map_or(true, |s| s.occurrence_id == existing_occ), "import starts nothing");
    let history = h.service.history(None, None).await.unwrap();
    let m1 = history.rows.iter().find(|r| r.title == "Synthetic finished manual task").unwrap();
    assert_eq!((m1.imported_ms, m1.recorded_ms, m1.total_ms), (12_345, 0, 12_345));
    // No invented session spans: the only session is the real 20 s one.
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_sessions").await, 1);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_segments WHERE session_id NOT IN (SELECT id FROM focus_sessions)").await, 0);
    // Local-only and zero remote intent.
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM local_tasks WHERE content LIKE 'Synthetic%' AND sync_policy='local_only'").await, 2);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM local_tasks WHERE content LIKE 'Synthetic%' AND external_id IS NOT NULL").await, 0);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM todoist_outbox").await, outbox_before);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_delivery").await, 0);
    // Unresolved remote reference and pending ops are retained evidence, not lost.
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_import_totals WHERE inclusion='unresolved' AND unresolved_task_id='90071992547409931234'").await, 1);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_import_records WHERE record_key LIKE 'pending:%' AND status='quarantined'").await, 2);
    let after_first = ledger(&h.pool).await;
    let totals_first = stored_totals(&h.pool).await;
    let grand: i64 = totals_first.iter().map(|t| t.1).sum();
    assert_eq!(grand, 20_000 + 7_000 + 12_345, "{totals_first:?}");

    // 3. Repeat import: exact no-op.
    let repeat = preview_import(&h.pool, &files()).await.unwrap();
    assert!(repeat.noop);
    let again = commit_import(&h.pool, &files(), &repeat.preview_token, &uuid::Uuid::new_v4().to_string())
        .await
        .unwrap();
    assert!(again.noop && again.created_task_ids.is_empty());
    assert_eq!(ledger(&h.pool).await, after_first);
    assert_eq!(stored_totals(&h.pool).await, totals_first);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM todoist_outbox").await, outbox_before);
    assert_eq!(scalar(&h.pool, "SELECT count(*) FROM focus_delivery").await, 0);

    // 4. Back up the imported profile and restore both routes into isolation.
    let g1 = generation(&source_path, &root.join("post"), "post-import").await;
    for route in ["snapshot", "portable"] {
        let dest = root.join(format!("restore-{route}"));
        let report = if route == "snapshot" {
            recovery::restore_snapshot(&g1, &dest).await
        } else {
            recovery::restore_export(&g1.join("export"), &dest).await
        }
        .unwrap();
        let restored = read_only(&report.output).await;
        assert!(recovery::require_activation_clear(&restored).await.is_err(), "{route}: owners must stay disabled");
        assert_eq!(ledger(&restored).await, after_first, "{route}: ledger/order/local-only differ");
        assert_eq!(stored_totals(&restored).await, totals_first, "{route}: ms totals differ");
        // The snapshot keeps the pre-existing (pre-import) outbox row verbatim;
        // the portable export excludes device-local outbox state by policy.
        let expected_outbox = if route == "snapshot" { outbox_before } else { 0 };
        assert_eq!(scalar(&restored, "SELECT count(*) FROM todoist_outbox").await, expected_outbox, "{route}");
        assert_eq!(scalar(&restored, "SELECT count(*) FROM todoist_outbox WHERE local_id IN (SELECT id FROM local_tasks WHERE content LIKE 'Synthetic%')").await, 0);
        assert_eq!(scalar(&restored, "SELECT count(*) FROM focus_delivery").await, 0);
        restored.close().await;
    }

    // 5. Rollback rehearsal: recover the pre-import generation into an isolated
    //    profile. It must equal the pre-import state exactly, and the live
    //    (post-import) profile must be untouched by the rehearsal.
    let rollback = recovery::restore_snapshot(&g0, &root.join("rollback")).await.unwrap();
    let rolled = read_only(&rollback.output).await;
    assert!(recovery::require_activation_clear(&rolled).await.is_err());
    assert_eq!(ledger(&rolled).await, pre_import);
    assert_eq!(scalar(&rolled, "SELECT count(*) FROM focus_import_batches").await, 0);
    assert_eq!(stored_totals(&rolled).await, vec![(existing_occ.clone(), 20_000)]);
    rolled.close().await;
    assert_eq!(ledger(&h.pool).await, after_first, "rehearsal must not touch the live profile");

    std::fs::remove_dir_all(root).unwrap();
    h.pool.close().await;
    std::fs::remove_file(source_path).unwrap();
}

/// Native-run support (Task 12, not part of the normal suite): leaves a
/// synthetic profile in the exact on-disk state of a process that crashed
/// mid-session — one queued task, a running session with exactly 20,000 ms
/// checkpointed, and a persisted live marker — so the real app's restart
/// recovery can be observed. Refuses anything but a marked synthetic profile.
///   NIMBLE_FOCUS_SEED_DB=/private/tmp/nimble-backup-test-<name>/nimble.db \
///   cargo test -p nimble-core --offline --test focus_round_trip -- --ignored
#[tokio::test]
#[ignore]
async fn seed_crashed_running_session_into_synthetic_profile() {
    let Ok(db) = std::env::var("NIMBLE_FOCUS_SEED_DB") else { return };
    let db = std::path::PathBuf::from(db);
    let root = db.parent().unwrap();
    let name = root.file_name().unwrap().to_string_lossy().to_string();
    assert!(root.starts_with("/private/tmp") && name.starts_with("nimble-backup-test-"), "not a synthetic profile");
    assert!(root.join("synthetic-profile").is_file(), "missing synthetic-profile marker");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(&db).create_if_missing(false))
        .await
        .unwrap();
    let device = nimble_core::db::sync::get_or_create_device_id(&pool).await.unwrap();
    let clock = std::sync::Arc::new(nimble_core::db::focus::clock::ManualClock::default());
    let service = nimble_core::db::focus::engine::FocusService::with_clock(pool.clone(), device, clock.clone());
    service.initialize().await.unwrap();
    let h = fixture::Harness { pool, service, clock };
    let a = h.task("Synthetic crash-recovery task").await;
    let b = h.task("Synthetic second task").await;
    h.send(FocusAction::Enqueue { task_ids: vec![a, b], source: FocusSource::Local, explicit_still_open: false })
        .await
        .unwrap();
    let occ = h.snapshot().await.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: occ }).await.unwrap();
    h.advance(20_000).await;
    let snap = h.snapshot().await;
    assert_eq!(snap.session.as_ref().unwrap().status, nimble_core::focus_types::FocusStatus::Running);
    // Drop without Pause: the persisted running marker is the crash state.
    h.pool.close().await;
}
