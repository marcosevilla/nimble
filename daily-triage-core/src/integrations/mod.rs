use sqlx::SqlitePool;

pub mod todoist;

#[derive(Debug, Clone, serde::Serialize)]
pub struct IntegrationState {
    pub provider: String,
    pub sync_token: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_full_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub enabled: bool,
}

pub async fn get_state(pool: &SqlitePool, provider: &str) -> crate::Result<Option<IntegrationState>> {
    let row: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>, i64)> =
        sqlx::query_as("SELECT provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled FROM integration_sync_state WHERE provider = ?")
            .bind(provider)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled)| IntegrationState {
        provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled: enabled != 0,
    }))
}

pub async fn ensure_state(pool: &SqlitePool, provider: &str) -> crate::Result<IntegrationState> {
    sqlx::query("INSERT OR IGNORE INTO integration_sync_state (provider) VALUES (?)")
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(get_state(pool, provider).await?.expect("state row just ensured"))
}

pub async fn set_enabled(pool: &SqlitePool, provider: &str, enabled: bool) -> crate::Result<()> {
    ensure_state(pool, provider).await?;
    sqlx::query("UPDATE integration_sync_state SET enabled = ? WHERE provider = ?")
        .bind(enabled as i64)
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn adapter_token_if_active(pool: &SqlitePool) -> crate::Result<Option<String>> {
    let Some(state) = get_state(pool, "todoist").await? else { return Ok(None) };
    if !state.enabled {
        return Ok(None);
    }
    crate::db::settings::get_setting(pool, "todoist_api_token").await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn adapter_active_requires_state_and_token() {
        let pool = test_pool().await;
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none());
        ensure_state(&pool, "todoist").await.unwrap();
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none()); // no token yet
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok_123").await.unwrap();
        assert_eq!(adapter_token_if_active(&pool).await.unwrap().as_deref(), Some("tok_123"));
        set_enabled(&pool, "todoist", false).await.unwrap();
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none());
    }
}
