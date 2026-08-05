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

#[derive(Debug, serde::Serialize)]
pub struct TodoistSyncStatus {
    pub enabled: bool,
    pub connected: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub pending_ops: i64,
    pub error_ops: i64,
    pub errors: Vec<(String, String, String)>,
}

/// Status surfaced to the frontend (Settings panel, sync indicator): whether
/// the integration is enabled, whether a token is configured, last sync
/// timing/error, and outbox backlog counts + recent error detail.
pub async fn todoist_sync_status(pool: &SqlitePool) -> crate::Result<TodoistSyncStatus> {
    let state = get_state(pool, "todoist").await?;
    let token = crate::db::settings::get_setting(pool, "todoist_api_token").await?;
    let (pending_ops, error_ops) = todoist::outbox::counts(pool).await?;
    let errors = todoist::outbox::error_list(pool).await?;
    Ok(TodoistSyncStatus {
        enabled: state.as_ref().map(|s| s.enabled).unwrap_or(false),
        connected: token.is_some(),
        last_sync_at: state.as_ref().and_then(|s| s.last_sync_at.clone()),
        last_error: state.and_then(|s| s.last_error),
        pending_ops,
        error_ops,
        errors,
    })
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

    #[tokio::test]
    async fn sync_status_reflects_enabled_connected_and_outbox_backlog() {
        let pool = test_pool().await;

        // Before anything is configured: disabled, disconnected, empty backlog.
        let status = todoist_sync_status(&pool).await.unwrap();
        assert!(!status.enabled);
        assert!(!status.connected);
        assert_eq!(status.last_sync_at, None);
        assert_eq!(status.pending_ops, 0);
        assert_eq!(status.error_ops, 0);
        assert!(status.errors.is_empty());

        ensure_state(&pool, "todoist").await.unwrap();
        set_enabled(&pool, "todoist", true).await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok_123").await.unwrap();

        // One pending create + one errored row.
        todoist::outbox::enqueue(&pool, "task", "t1", "create", serde_json::json!({"content": "a"}))
            .await
            .unwrap();
        todoist::outbox::enqueue(&pool, "task", "t2", "create", serde_json::json!({"content": "b"}))
            .await
            .unwrap();
        let rows = todoist::outbox::pending_batch(&pool, 10).await.unwrap();
        todoist::outbox::mark_error(&pool, &rows[1].id, "boom").await.unwrap();

        let status = todoist_sync_status(&pool).await.unwrap();
        assert!(status.enabled);
        assert!(status.connected);
        assert_eq!(status.pending_ops, 1);
        assert_eq!(status.error_ops, 1);
        assert_eq!(status.errors.len(), 1);
        assert_eq!(status.errors[0].2, "boom");
    }
}
