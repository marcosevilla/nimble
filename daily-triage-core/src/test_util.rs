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
