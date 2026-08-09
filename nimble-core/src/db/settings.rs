use sqlx::SqlitePool;

use crate::types::SettingRow;

/// Required settings keys for the app to function
const REQUIRED_SETTINGS: &[&str] = &[
    "todoist_api_token",
    "ical_feed_url",
    "obsidian_vault_path",
    "anthropic_api_key",
];

/// Check if all required settings are configured
pub async fn check_setup_complete(pool: &SqlitePool) -> crate::Result<bool> {
    for key in REQUIRED_SETTINGS {
        let row: Option<SettingRow> = sqlx::query_as(
            "SELECT key, value FROM settings WHERE key = ? AND value != ''",
        )
        .bind(key)
        .fetch_optional(pool)
        .await?;

        if row.is_none() {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Get a single setting by key
pub async fn get_setting(pool: &SqlitePool, key: &str) -> crate::Result<Option<String>> {
    let row: Option<SettingRow> =
        sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(pool)
            .await?;

    Ok(row.map(|r| r.value))
}

/// Set a setting (upsert)
pub async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> crate::Result<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get all settings as a list
pub async fn get_all_settings(pool: &SqlitePool) -> crate::Result<Vec<SettingRow>> {
    let rows: Vec<SettingRow> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;

    Ok(rows)
}

/// Delete all settings (used for reset)
pub async fn clear_all_settings(pool: &SqlitePool) -> crate::Result<()> {
    sqlx::query("DELETE FROM settings")
        .execute(pool)
        .await?;

    Ok(())
}
