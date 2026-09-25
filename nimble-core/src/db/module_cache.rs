//! Device-local cache for brief modules (v24 `module_cache`). Never synced
//! (not in sync's allow-list) and never exported (export policy excludes it).

use sqlx::SqlitePool;

/// `(payload_json, fetched_at)` for one cached entry.
pub async fn get(pool: &SqlitePool, module_id: &str, cache_key: &str) -> crate::Result<Option<(String, String)>> {
    Ok(sqlx::query_as("SELECT payload_json, fetched_at FROM module_cache WHERE module_id = ? AND cache_key = ?")
        .bind(module_id)
        .bind(cache_key)
        .fetch_optional(pool)
        .await?)
}

pub async fn put(pool: &SqlitePool, module_id: &str, cache_key: &str, payload_json: &str, fetched_at: &str) -> crate::Result<()> {
    sqlx::query(
        "INSERT INTO module_cache (module_id, cache_key, payload_json, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(module_id, cache_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at",
    )
    .bind(module_id)
    .bind(cache_key)
    .bind(payload_json)
    .bind(fetched_at)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn put_overwrites_and_keys_are_per_module() {
        let pool = test_pool().await;
        super::put(&pool, "weather", "37.775,-122.419", "{\"a\":1}", "2026-09-25T13:30:00Z").await.unwrap();
        super::put(&pool, "weather", "37.775,-122.419", "{\"a\":2}", "2026-09-25T14:30:00Z").await.unwrap();
        assert_eq!(super::get(&pool, "weather", "37.775,-122.419").await.unwrap(),
            Some(("{\"a\":2}".to_string(), "2026-09-25T14:30:00Z".to_string())));
        assert!(super::get(&pool, "other", "37.775,-122.419").await.unwrap().is_none());
    }
}
