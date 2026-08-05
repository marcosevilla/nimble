use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// Fresh in-memory DB with all migrations applied.
/// max_connections(1) is required: each new connection to `sqlite::memory:`
/// would otherwise get its own empty database.
pub async fn test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite pool");
    crate::db::migrations::run_migrations(&pool)
        .await
        .expect("migrations on test pool");
    pool
}

/// Fresh on-disk DB (in the OS temp dir) with all migrations applied.
/// Use this instead of `test_pool()` for anything that needs a *real* SQLite
/// file underneath — e.g. `VACUUM INTO`, which SQLite treats as a no-op
/// against `:memory:` databases (confirmed: sqlx returns Ok with zero rows
/// written, no error). Caller is responsible for deleting the returned path
/// when done.
pub async fn file_pool() -> (SqlitePool, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("dt-test-{}.db", uuid::Uuid::new_v4()));
    let url = format!("sqlite://{}?mode=rwc", path.to_str().expect("temp path is utf-8"));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("file-backed sqlite pool");
    crate::db::migrations::run_migrations(&pool)
        .await
        .expect("migrations on file pool");
    (pool, path)
}
