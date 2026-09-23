use nimble_core::db::export::{compare_snapshot_tables, export_portable};

async fn close(pool: sqlx::SqlitePool, path: std::path::PathBuf) {
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn export_is_repeatable_typed_and_excludes_integration_state() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::raw_sql(include_str!("fixtures/backup-v19.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let first = export_portable(&pool).await.unwrap();
    let second = export_portable(&pool).await.unwrap();
    assert_eq!(first.data, second.data);
    assert_eq!(first.format, second.format);
    let text = String::from_utf8(first.data.clone()).unwrap();
    assert!(!text.contains("TEST_SECRET_DO_NOT_EXPORT"));
    let data: serde_json::Value = serde_json::from_slice(&first.data).unwrap();
    let task = data["local_tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "task-a")
        .unwrap();
    assert_eq!(task["priority"].as_i64(), Some(2));
    assert!(task["description"].is_null());
    assert_eq!(data["progress_snapshots"][0]["id"].as_i64(), Some(77));
    assert!(text.contains("café"));
    assert!(data.get("settings").is_none());
    assert!(data.get("vault_notes").is_some());
    let format: serde_json::Value = serde_json::from_slice(&first.format).unwrap();
    assert_eq!(format["schema_version"], 22);
    assert_eq!(format["export_version"], 1);
    close(pool, path).await;
}

#[tokio::test]
async fn schema_drift_fails_closed() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("ALTER TABLE local_tasks ADD COLUMN unexpected_secret TEXT")
        .execute(&pool)
        .await
        .unwrap();
    assert!(export_portable(&pool).await.is_err());
    close(pool, path).await;

    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("CREATE TABLE surprise (id TEXT PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    assert!(export_portable(&pool).await.is_err());
    close(pool, path).await;

    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("INSERT INTO schema_version(version,description,applied_at) VALUES (23,'future','2026-09-21')")
        .execute(&pool).await.unwrap();
    assert!(export_portable(&pool).await.is_err());
    close(pool, path).await;

    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::raw_sql("DROP TABLE settings; CREATE TABLE settings (key TEXT, value TEXT PRIMARY KEY, updated_at TEXT)")
        .execute(&pool).await.unwrap();
    assert!(export_portable(&pool).await.is_err());
    close(pool, path).await;
}

#[tokio::test]
async fn full_snapshot_comparison_includes_private_tables() {
    let (a, pa) = nimble_core::test_util::file_pool().await;
    let pb = std::env::temp_dir().join(format!("dt-export-copy-{}.db", uuid::Uuid::new_v4()));
    sqlx::query("VACUUM INTO ?")
        .bind(pb.to_str().unwrap())
        .execute(&a)
        .await
        .unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&pb)
        .create_if_missing(false);
    let b = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    assert!(compare_snapshot_tables(&a, &b).await.unwrap());
    sqlx::query("INSERT INTO settings(key,value) VALUES ('secret','difference')")
        .execute(&b)
        .await
        .unwrap();
    assert!(!compare_snapshot_tables(&a, &b).await.unwrap());
    sqlx::query("INSERT INTO settings(key,value) VALUES ('blob',X'00FF')")
        .execute(&a)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings(key,value) VALUES ('blob',X'00FF')")
        .execute(&b)
        .await
        .unwrap();
    assert!(!compare_snapshot_tables(&a, &b).await.unwrap());
    sqlx::query("DELETE FROM settings WHERE key = 'secret'")
        .execute(&b)
        .await
        .unwrap();
    assert!(compare_snapshot_tables(&a, &b).await.unwrap());
    close(a, pa).await;
    close(b, pb).await;
}

#[tokio::test]
async fn row_order_uses_composite_primary_key_and_storage_types() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::raw_sql(
        "INSERT INTO labels(id,name) VALUES ('z','Z'),('a','A');
        INSERT INTO task_labels(task_id,label_id,created_at) VALUES
        ('z','z','2026-09-21'),('a','z','2026-09-21'),('a','a','2026-09-21');
        INSERT INTO local_tasks(id,content,priority) VALUES ('real','Real',2.5);",
    )
    .execute(&pool)
    .await
    .unwrap();
    let export = export_portable(&pool).await.unwrap();
    let data: serde_json::Value = serde_json::from_slice(&export.data).unwrap();
    let keys: Vec<_> = data["task_labels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["task_id"].as_str().unwrap(),
                row["label_id"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(keys, [("a", "a"), ("a", "z"), ("z", "z")]);
    let real = data["local_tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "real")
        .unwrap();
    assert_eq!(real["priority"].as_f64(), Some(2.5));
    close(pool, path).await;
}

#[tokio::test]
async fn unreviewed_binary_cell_is_rejected() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("INSERT INTO documents(id,title,content) VALUES ('binary','Bad',X'00FF')")
        .execute(&pool)
        .await
        .unwrap();
    assert!(export_portable(&pool).await.is_err());
    close(pool, path).await;
}

#[tokio::test]
async fn reverse_insertion_order_has_identical_export_bytes() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::raw_sql(
        "INSERT INTO labels(id,name,created_at) VALUES
        ('z','Zulu','2026-09-21'),('a','Alpha','2026-09-21')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let first = export_portable(&pool).await.unwrap();
    sqlx::raw_sql(
        "DELETE FROM labels; INSERT INTO labels(id,name,created_at) VALUES
        ('a','Alpha','2026-09-21'),('z','Zulu','2026-09-21')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let second = export_portable(&pool).await.unwrap();
    assert_eq!(first.data, second.data);
    close(pool, path).await;
}
