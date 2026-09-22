use chrono::DateTime;
use nimble_core::db::backup::{self, BackupPaths};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    paths: BackupPaths,
}
impl Fixture {
    async fn new() -> Self {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nimble-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let (pool, original) = nimble_core::test_util::file_pool().await;
        sqlx::raw_sql(include_str!("fixtures/backup-v19.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let database = root.join("nimble.db");
        std::fs::rename(original, &database).unwrap();
        let paths = BackupPaths {
            app_data: root.clone(),
            database,
            generations: root.join("backups"),
        };
        Self { root, paths }
    }
}

#[tokio::test]
async fn frozen_c1_v19_archive_restores_both_routes_without_upgrading() {
    // These bytes were emitted by the unmodified C1 exporter at commit 254bcf1.
    // Never regenerate them from the current exporter inside this test.
    const ID: &str = "22a15675-9a61-40f3-840e-47bb23f279e2";
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nimble-v19-frozen-{}", uuid::Uuid::new_v4()));
    let archive = root.join(ID);
    std::fs::create_dir_all(archive.join("export")).unwrap();
    for (name, bytes) in [
        ("snapshot.db", include_bytes!("fixtures/historical-v19/archive/22a15675-9a61-40f3-840e-47bb23f279e2/snapshot.db").as_slice()),
        ("manifest.json", include_bytes!("fixtures/historical-v19/archive/22a15675-9a61-40f3-840e-47bb23f279e2/manifest.json").as_slice()),
        ("export/data.json", include_bytes!("fixtures/historical-v19/archive/22a15675-9a61-40f3-840e-47bb23f279e2/export/data.json").as_slice()),
        ("export/format.json", include_bytes!("fixtures/historical-v19/archive/22a15675-9a61-40f3-840e-47bb23f279e2/export/format.json").as_slice()),
    ] {
        std::fs::write(archive.join(name), bytes).unwrap();
    }
    let verified = backup::verify_generation(&archive).await.unwrap();
    assert_eq!(verified.manifest().schema_version, 19);
    for route in ["snapshot", "portable"] {
        let dest = root.join(route);
        let recovered = if route == "snapshot" {
            nimble_core::db::recovery::restore_snapshot(&archive, &dest).await
        } else {
            nimble_core::db::recovery::restore_export(&archive.join("export"), &dest).await
        }
        .unwrap();
        let restored = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&recovered.output)
                    .read_only(true),
            )
            .await
            .unwrap();
        assert_eq!(
            nimble_core::db::migrations::current_schema_version(&restored)
                .await
                .unwrap(),
            19
        );
        let portable = nimble_core::db::export::export_portable(&restored)
            .await
            .unwrap();
        assert_eq!(
            portable.data,
            std::fs::read(archive.join("export/data.json")).unwrap()
        );
        assert_eq!(
            portable.format,
            std::fs::read(archive.join("export/format.json")).unwrap()
        );
        restored.close().await;
    }
    std::fs::remove_dir_all(root).unwrap();
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn at() -> chrono::DateTime<chrono::FixedOffset> {
    DateTime::parse_from_rfc3339("2026-09-21T02:00:00-07:00").unwrap()
}

#[tokio::test]
async fn both_routes_round_trip_without_changing_source() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let generation = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    let snapshot = generation.directory().join("snapshot.db");
    let before = std::fs::read(&snapshot).unwrap();
    for route in ["snapshot", "export"] {
        let dest = f.root.join(route);
        let report = if route == "snapshot" {
            nimble_core::db::recovery::restore_snapshot(generation.directory(), &dest).await
        } else {
            nimble_core::db::recovery::restore_export(&generation.directory().join("export"), &dest)
                .await
        }
        .unwrap();
        assert!(report.verified);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(report.output)
                    .read_only(true),
            )
            .await
            .unwrap();
        let actual = nimble_core::db::export::export_portable(&pool)
            .await
            .unwrap();
        assert_eq!(
            actual.data,
            std::fs::read(generation.directory().join("export/data.json")).unwrap()
        );
        assert_eq!(
            actual.format,
            std::fs::read(generation.directory().join("export/format.json")).unwrap()
        );
        // Both routes leave the restored copy inert: the v21 activation
        // marker (Task 4) is the only reason settings is non-empty on export.
        let marker: Vec<(String, String)> =
            sqlx::query_as("SELECT key,value FROM settings WHERE key='restored_activation_required'")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(marker, vec![("restored_activation_required".to_string(), "1".to_string())], "{route}");
        if route == "export" {
            let settings: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings")
                .fetch_all(&pool)
                .await
                .unwrap();
            assert_eq!(settings, marker, "portable export restores no other settings");
            for table in [
                "todoist_outbox",
                "integration_sync_state",
                "sync_log",
                "action_log",
                "calendar_events",
                "calendar_feeds",
                "todoist_tasks",
            ] {
                let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(count, 0);
            }
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE remote_updated_at IS NOT NULL OR synced_snapshot IS NOT NULL").fetch_one(&pool).await.unwrap();
            assert_eq!(count, 0);
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM vault_fts WHERE vault_fts MATCH 'body'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1);
        }
        pool.close().await;
    }
    assert_eq!(before, std::fs::read(snapshot).unwrap());
}

#[tokio::test]
async fn malformed_archives_fail_without_publishing() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    let export = g.directory().join("export");
    let original = std::fs::read(export.join("data.json")).unwrap();
    for mutation in 0..7 {
        let mut data: serde_json::Value = serde_json::from_slice(&original).unwrap();
        match mutation {
            0 => {
                data["settings"] = serde_json::json!([]);
            }
            1 => {
                data["local_tasks"][0]["priority"] = serde_json::json!("2");
            }
            2 => {
                data["local_tasks"][0]["unreviewed"] = serde_json::json!(true);
            }
            3 => {
                data["local_tasks"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("content");
            }
            4 => {
                let row = data["local_tasks"][0].clone();
                data["local_tasks"].as_array_mut().unwrap().push(row);
            }
            5 => {
                data["local_tasks"][0]["project_id"] = serde_json::json!("missing");
            }
            _ => {
                data["local_tasks"][0]["id"] = serde_json::Value::Null;
            }
        }
        let mut bytes = serde_json::to_vec_pretty(&data).unwrap();
        bytes.push(b'\n');
        std::fs::write(export.join("data.json"), bytes).unwrap();
        let dest = f.root.join(format!("bad-{mutation}"));
        assert!(nimble_core::db::recovery::restore_export(&export, &dest)
            .await
            .is_err());
        assert!(!dest.exists());
    }
    std::fs::write(export.join("data.json"), original).unwrap();
    std::fs::write(export.join("format.json"), b"{}").unwrap();
    assert!(
        nimble_core::db::recovery::restore_export(&export, &f.root.join("bad-format"))
            .await
            .is_err()
    );
    assert!(nimble_core::db::recovery::restore_snapshot(
        g.directory(),
        &f.root.join("bad-snapshot")
    )
    .await
    .is_err());
    assert!(std::fs::read_dir(&f.root).unwrap().all(|e| !e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".recovery-")));
}

#[tokio::test]
async fn existing_and_production_destinations_are_refused() {
    let f = Fixture::new().await;
    for dest in [
        f.root.clone(),
        f.root.join("com.marcosevilla.daily-triage/new"),
        f.root.join("Library/Application Support/new"),
    ] {
        assert!(nimble_core::db::recovery::restore_export(&f.root, &dest)
            .await
            .is_err());
        assert!(nimble_core::db::recovery::restore_snapshot(&f.root, &dest)
            .await
            .is_err());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn source_and_destination_symlinks_are_refused() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    let alias = f.root.join("alias");
    std::os::unix::fs::symlink(&f.root, &alias).unwrap();
    assert!(
        nimble_core::db::recovery::restore_snapshot(g.directory(), &alias.join("new"))
            .await
            .is_err()
    );
    let export = g.directory().join("export");
    let data = export.join("data.json");
    std::fs::rename(&data, f.root.join("original.json")).unwrap();
    std::os::unix::fs::symlink(f.root.join("original.json"), data).unwrap();
    assert!(
        nimble_core::db::recovery::restore_export(&export, &f.root.join("new"))
            .await
            .is_err()
    );
}
