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
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn at() -> chrono::DateTime<chrono::FixedOffset> {
    DateTime::parse_from_rfc3339("2026-09-21T02:00:00-07:00").unwrap()
}

#[tokio::test]
async fn complete_generation_is_private_verified_and_snapshot_consistent() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    assert!(backup::try_lock(&f.paths).unwrap().is_none());
    let generation = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    let verified = backup::verify_generation(generation.directory())
        .await
        .unwrap();
    assert_eq!(
        verified.manifest().snapshot_hash,
        generation.manifest().snapshot_hash
    );
    let before = std::fs::read(generation.directory().join("export/data.json")).unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(&f.paths.database))
        .await
        .unwrap();
    sqlx::query("UPDATE local_tasks SET content='after snapshot'")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    assert_eq!(
        before,
        std::fs::read(generation.directory().join("export/data.json")).unwrap()
    );
    backup::verify_generation(generation.directory())
        .await
        .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for (path, mode) in [
            (generation.directory().to_path_buf(), 0o700),
            (generation.directory().join("snapshot.db"), 0o600),
            (generation.directory().join("manifest.json"), 0o600),
            (generation.directory().join("export"), 0o700),
            (generation.directory().join("export/data.json"), 0o600),
        ] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                mode
            );
        }
    }
}

#[tokio::test]
async fn failures_preserve_last_success_and_incomplete_sets_are_hidden() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let good = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    for failure in ["write", "publish"] {
        assert!(
            backup::create_generation_with_failure(&f.paths, at(), "test", &guard, failure)
                .await
                .is_err()
        );
        let list = backup::list_verified(&f.paths).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].manifest().id, good.manifest().id);
    }
    assert!(backup::apply_retention(&f.paths, &[good.manifest().id.clone()], &guard).is_err());
    backup::verify_generation(good.directory()).await.unwrap();
}

#[tokio::test]
async fn corrupt_snapshot_export_manifest_and_unknown_files_are_rejected() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    for name in [
        "snapshot.db",
        "export/data.json",
        "export/format.json",
        "manifest.json",
    ] {
        let g = backup::create_generation(&f.paths, at(), "test", &guard)
            .await
            .unwrap();
        std::fs::write(g.directory().join(name), b"corrupted").unwrap();
        assert!(backup::verify_generation(g.directory()).await.is_err());
    }
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    std::fs::write(g.directory().join("unexpected"), "do not remove").unwrap();
    assert!(backup::verify_generation(g.directory()).await.is_err());
    assert!(backup::list_verified(&f.paths).await.unwrap().is_empty());
}

#[tokio::test]
async fn invalid_fk_and_unreviewed_schema_never_publish() {
    for query in [
        "UPDATE local_tasks SET project_id='missing-parent'",
        "CREATE TABLE unreviewed_secret(id TEXT PRIMARY KEY)",
    ] {
        let f = Fixture::new().await;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&f.paths.database)
                    .foreign_keys(false),
            )
            .await
            .unwrap();
        sqlx::query(query).execute(&pool).await.unwrap();
        pool.close().await;
        let guard = backup::try_lock(&f.paths).unwrap().unwrap();
        assert!(backup::create_generation(&f.paths, at(), "test", &guard)
            .await
            .is_err());
        assert!(backup::list_verified(&f.paths).await.unwrap().is_empty());
    }
}

#[tokio::test]
async fn wrong_root_guard_and_replaced_lock_are_rejected() {
    let a = Fixture::new().await;
    let b = Fixture::new().await;
    let guard = backup::try_lock(&a.paths).unwrap().unwrap();
    assert!(backup::create_generation(&b.paths, at(), "test", &guard)
        .await
        .is_err());
    std::fs::remove_file(a.paths.generations.join(".job.lock")).unwrap();
    std::fs::write(a.paths.generations.join(".job.lock"), b"").unwrap();
    assert!(backup::create_generation(&a.paths, at(), "test", &guard)
        .await
        .is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn symlink_roots_files_and_ancestors_are_rejected() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new().await;
    let other = f.root.join("elsewhere");
    std::fs::create_dir(&other).unwrap();
    symlink(&other, &f.paths.generations).unwrap();
    assert!(backup::try_lock(&f.paths).is_err());
    std::fs::remove_file(&f.paths.generations).unwrap();
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    std::fs::remove_file(g.directory().join("export/data.json")).unwrap();
    symlink(&f.paths.database, g.directory().join("export/data.json")).unwrap();
    assert!(backup::verify_generation(g.directory()).await.is_err());
    let alias = f.root.join("alias");
    symlink(&f.paths.generations, &alias).unwrap();
    assert!(
        backup::verify_generation(&alias.join(g.manifest().id.clone()))
            .await
            .is_err()
    );
}

// Same test executable in a child process proves kernel ownership rather than
// an in-process mutex or persistent-file-existence convention.
#[test]
fn lock_probe_child() {
    let Some(root) = std::env::var_os("NIMBLE_SYNTHETIC_LOCK_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let paths = BackupPaths {
        database: root.join("nimble.db"),
        generations: root.join("backups"),
        app_data: root,
    };
    assert!(backup::try_lock(&paths).unwrap().is_none());
}
#[tokio::test]
async fn lock_is_cross_process_and_released_on_drop() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "lock_probe_child", "--nocapture"])
        .env("NIMBLE_SYNTHETIC_LOCK_TEST_ROOT", &f.root)
        .output()
        .unwrap();
    assert!(result.status.success());
    drop(guard);
    assert!(backup::try_lock(&f.paths).unwrap().is_some());
}

fn manifest(date: &str, hour: u32, id: &str) -> backup::BackupManifest {
    use chrono::Datelike;
    let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
    let week = date.iso_week();
    backup::BackupManifest {
        id: id.into(),
        created_at: date.and_hms_opt(hour, 0, 0).unwrap().and_utc().to_rfc3339(),
        local_date: date.to_string(),
        local_iso_week: format!("{:04}-W{:02}", week.year(), week.week()),
        app_version: "test".into(),
        schema_version: 19,
        export_version: 1,
        snapshot_hash: String::new(),
        data_hash: String::new(),
        format_hash: String::new(),
        row_counts: Default::default(),
    }
}
#[test]
fn retention_uses_represented_buckets_iso_years_and_deterministic_ties() {
    let start = chrono::NaiveDate::from_ymd_opt(2025, 12, 20).unwrap();
    let mut all = Vec::new();
    for day in 0..75 {
        let date = (start + chrono::Duration::days(day)).to_string();
        all.push(manifest(&date, 1, &format!("{day}-a")));
        all.push(manifest(&date, 2, &format!("{day}-b")));
    }
    let candidates: std::collections::BTreeSet<_> =
        backup::retention_candidates(&all).into_iter().collect();
    let retained: Vec<_> = all.iter().filter(|g| !candidates.contains(&g.id)).collect();
    assert!(retained.len() >= 14 && retained.len() <= 22);
    for day in 61..75 {
        assert!(!candidates.contains(&format!("{day}-b")));
    }
    assert!(all
        .iter()
        .filter(|g| g.id.ends_with("-a"))
        .all(|g| candidates.contains(&g.id)));
    assert!(all
        .iter()
        .any(|g| g.local_date == "2025-12-29" && g.local_iso_week == "2026-W01"));
    // Years of absence do not cause represented historical dates to expire.
    let old = vec![
        manifest("2019-12-30", 1, "old"),
        manifest("2026-09-21", 1, "latest"),
    ];
    assert!(backup::retention_candidates(&old).is_empty());
    let tied = vec![
        manifest("2026-09-21", 1, "a"),
        manifest("2026-09-21", 1, "b"),
    ];
    assert_eq!(backup::retention_candidates(&tied), vec!["a"]);
}

#[tokio::test]
async fn retention_removes_only_verified_eligible_sets() {
    let f = Fixture::new().await;
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let first = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    let latest =
        backup::create_generation(&f.paths, at() + chrono::Duration::hours(1), "test", &guard)
            .await
            .unwrap();
    let partial = f.paths.generations.join(".partial-unknown");
    std::fs::create_dir(&partial).unwrap();
    std::fs::write(partial.join("unrelated"), "keep").unwrap();
    backup::apply_retention(&f.paths, &[first.manifest().id.clone()], &guard).unwrap();
    assert!(!first.directory().exists());
    assert!(partial.join("unrelated").exists());
    backup::verify_generation(latest.directory()).await.unwrap();
    assert!(backup::apply_retention(&f.paths, &["../nimble.db".into()], &guard).is_err());
}

#[tokio::test]
async fn source_bytes_are_unchanged_and_fts_search_survives_vacuum() {
    let f = Fixture::new().await;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(&f.paths.database))
        .await
        .unwrap();
    sqlx::query("INSERT INTO vault_fts(note_id,title,content) VALUES('note-a','A','searchable concert archive')").execute(&pool).await.unwrap();
    pool.close().await;
    let before = blake3::hash(&std::fs::read(&f.paths.database).unwrap());
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    assert_eq!(
        before,
        blake3::hash(&std::fs::read(&f.paths.database).unwrap())
    );
    let copied = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(g.directory().join("snapshot.db"))
                .read_only(true),
        )
        .await
        .unwrap();
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT note_id FROM vault_fts WHERE vault_fts MATCH 'concert'")
            .fetch_all(&copied)
            .await
            .unwrap();
    assert_eq!(ids, vec!["note-a"]);
    copied.close().await;
}

#[tokio::test]
async fn concurrent_source_writes_cannot_contaminate_snapshot_export() {
    let f = Fixture::new().await;
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&f.paths.database)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal),
        )
        .await
        .unwrap();
    let writer = pool.clone();
    let writes = tokio::spawn(async move {
        for index in 0..30 {
            sqlx::query("UPDATE local_tasks SET content=? WHERE id='task-a'")
                .bind(format!("revision {index}"))
                .execute(&writer)
                .await
                .unwrap();
            tokio::task::yield_now().await;
        }
    });
    let guard = backup::try_lock(&f.paths).unwrap().unwrap();
    let g = backup::create_generation(&f.paths, at(), "test", &guard)
        .await
        .unwrap();
    writes.await.unwrap();
    // Verification independently re-exports the snapshot, comparing byte-for-byte.
    backup::verify_generation(g.directory()).await.unwrap();
    pool.close().await;
}
