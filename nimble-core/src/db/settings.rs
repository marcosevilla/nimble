use sqlx::SqlitePool;

use crate::types::SettingRow;

// No first-run gate: since brief phase 2 (addendum §3) nothing is required
// before the app runs. Every integration is optional and degrades on its own
// (no Todoist token, no sync; no vault, no vault box; no AI key, a rule-based
// brief); the Today setup (`today.setup_completed_at`) is the onboarding.
// Pinned by apps/desktop/tests/setupGate.test.mjs.

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
