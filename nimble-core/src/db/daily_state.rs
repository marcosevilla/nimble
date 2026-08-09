use sqlx::SqlitePool;

use crate::db::activity;
use crate::db::sync;
use crate::types::{DailyStateResponse, Priority};

/// Check if today's daily review has been completed
pub async fn get_daily_state(pool: &SqlitePool) -> crate::Result<DailyStateResponse> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT date, energy_level, top_priorities FROM daily_state WHERE date = ?",
    )
    .bind(&today)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((date, energy, priorities_json)) => {
            let priorities: Option<Vec<Priority>> = priorities_json
                .and_then(|json| serde_json::from_str(&json).ok());
            let review_complete = energy.is_some() && priorities.is_some();
            Ok(DailyStateResponse {
                date,
                energy_level: energy,
                priorities,
                review_complete,
            })
        }
        None => Ok(DailyStateResponse {
            date: today,
            energy_level: None,
            priorities: None,
            review_complete: false,
        }),
    }
}

/// Cache generated priorities in daily_state
pub async fn save_priorities(
    pool: &SqlitePool,
    energy_level: &str,
    priorities: &[Priority],
) -> crate::Result<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let priorities_json = serde_json::to_string(priorities).unwrap_or_default();

    sqlx::query(
        "INSERT INTO daily_state (date, energy_level, top_priorities, first_opened_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(date) DO UPDATE SET energy_level = excluded.energy_level, top_priorities = excluded.top_priorities",
    )
    .bind(&today)
    .bind(energy_level)
    .bind(&priorities_json)
    .execute(pool)
    .await?;

    activity::log_activity(
        pool,
        "priorities_generated",
        None,
        Some(serde_json::json!({
            "energy_level": energy_level,
            "count": priorities.len(),
        })),
    )
    .await;

    // Sync log: UPSERT for daily_state
    let snapshot = serde_json::json!({
        "date": &today,
        "energy_level": energy_level,
        "top_priorities": &priorities_json,
    });
    let snap_str = serde_json::to_string(&snapshot).unwrap_or_default();
    sync::append_sync_log(pool, "daily_state", &today, "UPDATE", Some(&serde_json::json!(["energy_level", "top_priorities"]).to_string()), Some(&snap_str)).await.ok();

    Ok(())
}

/// Save progress snapshot and update daily_state
pub async fn save_progress_snapshot(
    pool: &SqlitePool,
    tasks_completed: &str,
    tasks_open: &str,
    tasks_deferred: &str,
) -> crate::Result<i64> {
    let now = chrono::Local::now();

    let result = sqlx::query(
        "INSERT INTO progress_snapshots (tasks_completed, tasks_open, tasks_deferred, created_at)
         VALUES (?, ?, ?, ?)",
    )
    .bind(tasks_completed)
    .bind(tasks_open)
    .bind(tasks_deferred)
    .bind(now.format("%Y-%m-%d %H:%M:%S").to_string())
    .execute(pool)
    .await?;

    let snapshot_id = result.last_insert_rowid();

    let today = now.format("%Y-%m-%d").to_string();
    sqlx::query(
        "INSERT INTO daily_state (date, last_saved_at)
         VALUES (?, datetime('now'))
         ON CONFLICT(date) DO UPDATE SET last_saved_at = datetime('now')",
    )
    .bind(&today)
    .execute(pool)
    .await?;

    Ok(snapshot_id)
}
