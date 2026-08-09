use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::types::{ActivityEntry, ActivitySummary};

/// Log an activity entry. Called internally by other modules.
/// Fire-and-forget: errors are logged but never propagated.
pub async fn log_activity(
    pool: &SqlitePool,
    action_type: &str,
    target_id: Option<&str>,
    metadata: Option<serde_json::Value>,
) {
    let id = Uuid::new_v4().to_string();
    let metadata_str = metadata.map(|m| m.to_string());

    if let Err(e) = sqlx::query(
        "INSERT INTO activity_log (id, action_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))",
    )
    .bind(&id)
    .bind(action_type)
    .bind(target_id)
    .bind(&metadata_str)
    .execute(pool)
    .await
    {
        log::warn!("Failed to log activity '{}': {}", action_type, e);
        return;
    }

    // Sync log: INSERT for activity_log
    let snapshot = serde_json::json!({
        "id": &id,
        "action_type": action_type,
        "target_id": target_id,
        "metadata": &metadata_str,
        "created_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    });
    let snap_str = serde_json::to_string(&snapshot).unwrap_or_default();
    sync::append_sync_log(pool, "activity_log", &id, "INSERT", None, Some(&snap_str)).await.ok();
}

/// Get activity log entries for a date range with optional filters
pub async fn get_activity_log(
    pool: &SqlitePool,
    from_date: &str,
    to_date: &str,
    action_type: Option<&str>,
    target_id: Option<&str>,
    limit: i64,
) -> crate::Result<Vec<ActivityEntry>> {
    // Build query dynamically based on filters
    let mut conditions = vec!["created_at >= ?", "created_at < date(?, '+1 day')"];
    if action_type.is_some() { conditions.push("action_type = ?"); }
    if target_id.is_some() { conditions.push("target_id = ?"); }

    let sql = format!(
        "SELECT id, action_type, target_id, metadata, created_at FROM activity_log WHERE {} ORDER BY created_at DESC LIMIT ?",
        conditions.join(" AND ")
    );

    let mut query = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(&sql)
        .bind(from_date)
        .bind(to_date);
    if let Some(action) = action_type { query = query.bind(action); }
    if let Some(tid) = target_id { query = query.bind(tid); }
    query = query.bind(limit);

    let rows = query.fetch_all(pool).await?;

    Ok(rows
        .into_iter()
        .map(|(id, action_type, target_id, metadata_str, created_at)| {
            let metadata = metadata_str.and_then(|s| serde_json::from_str(&s).ok());
            ActivityEntry {
                id,
                action_type,
                target_id,
                metadata,
                created_at,
            }
        })
        .collect())
}

/// Get activity counts grouped by action type for a specific date
pub async fn get_activity_summary(
    pool: &SqlitePool,
    date: &str,
) -> crate::Result<Vec<ActivitySummary>> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT action_type, COUNT(*) as count FROM activity_log
         WHERE date(created_at) = ? GROUP BY action_type ORDER BY count DESC",
    )
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(action_type, count)| ActivitySummary { action_type, count })
        .collect())
}
