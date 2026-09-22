use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use crate::reminders::{candidate, decide, DeliveryDecision, ReminderCandidate};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatchUpItem {
    pub occurrence_key: String,
    pub task_id: String,
    pub title: String,
    pub scheduled_at: String,
    pub error_code: Option<String>,
}

/// Reconciles every open task against the local ledger before returning due
/// occurrences. Superseded entries remain as history but cannot be claimed.
pub async fn collect_due(pool: &SqlitePool, now: DateTime<Utc>, timezone: &str) -> crate::Result<Vec<ReminderCandidate>> {
    let tasks = super::tasks::get_local_tasks(pool, None, None, false).await?;
    let mut active = Vec::new();
    let mut invalid = Vec::new();
    for task in tasks {
        match candidate(&task, timezone) {
            Ok(Some(item)) => active.push(item),
            Ok(None) => (),
            Err(error) => {
                log::warn!("Reminder schedule needs attention for task {}: {}", task.id, error);
                invalid.push((format!("{}|needs_attention|{}|{}|{}",task.id,task.due_date.as_deref().unwrap_or(""),task.due_time.as_deref().unwrap_or(""),timezone),task.id));
            }
        }
    }
    let mut tx = pool.begin().await?;
    for item in &active {
        sqlx::query("INSERT OR IGNORE INTO reminder_deliveries (occurrence_key,task_id,scheduled_at,state) VALUES (?,?,?,'pending')")
            .bind(&item.occurrence_key).bind(&item.task_id).bind(item.scheduled_at.to_rfc3339())
            .execute(&mut *tx).await?;
    }
    for (key,task_id) in &invalid {
        sqlx::query("INSERT OR IGNORE INTO reminder_deliveries (occurrence_key,task_id,scheduled_at,state,error_code) VALUES (?,?,?,'catch_up','schedule_needs_attention')")
            .bind(key).bind(task_id).bind(now.to_rfc3339()).execute(&mut *tx).await?;
    }
    // A restart after an interrupted native call cannot know whether the OS
    // displayed it. Keep a review item rather than possibly firing twice.
    sqlx::query("UPDATE reminder_deliveries SET state='catch_up' WHERE state='dispatching' AND scheduled_at < ?")
        .bind((now-chrono::Duration::seconds(90)).to_rfc3339()).execute(&mut *tx).await?;
    let rows = sqlx::query("SELECT occurrence_key FROM reminder_deliveries WHERE state IN ('pending','catch_up','notified')")
        .fetch_all(&mut *tx).await?;
    for row in rows {
        let key: String = row.get(0);
        if !active.iter().any(|item| item.occurrence_key == key) && !invalid.iter().any(|(item,_)| item == &key) {
            sqlx::query("UPDATE reminder_deliveries SET state='superseded' WHERE occurrence_key=?")
                .bind(key).execute(&mut *tx).await?;
        }
    }
    let due = active.into_iter().filter(|item| decide(now, item.scheduled_at) != DeliveryDecision::Future).collect();
    tx.commit().await?;
    Ok(due)
}

pub async fn claim_notification(pool: &SqlitePool, key: &str) -> crate::Result<bool> {
    let result = sqlx::query("UPDATE reminder_deliveries SET state='dispatching' WHERE occurrence_key=? AND state='pending'")
        .bind(key).execute(pool).await?;
    Ok(result.rows_affected() == 1)
}

pub async fn mark_notified(pool: &SqlitePool, key: &str, at: DateTime<Utc>) -> crate::Result<()> {
    sqlx::query("UPDATE reminder_deliveries SET state='notified',last_fired_at=? WHERE occurrence_key=? AND state='dispatching'")
        .bind(at.to_rfc3339()).bind(key).execute(pool).await?;
    Ok(())
}

pub async fn mark_catch_up(pool: &SqlitePool, key: &str, error_code: Option<&str>) -> crate::Result<()> {
    sqlx::query("UPDATE reminder_deliveries SET state='catch_up',error_code=? WHERE occurrence_key=? AND state IN ('pending','dispatching')")
        .bind(error_code).bind(key).execute(pool).await?;
    Ok(())
}

pub async fn acknowledge(pool: &SqlitePool, key: &str) -> crate::Result<()> {
    sqlx::query("UPDATE reminder_deliveries SET state='acknowledged',acknowledged_at=? WHERE occurrence_key=? AND state='catch_up'")
        .bind(Utc::now().to_rfc3339()).bind(key).execute(pool).await?;
    Ok(())
}

pub async fn list_catch_up(pool: &SqlitePool) -> crate::Result<Vec<CatchUpItem>> {
    let rows = sqlx::query("SELECT d.occurrence_key,d.task_id,t.content,d.scheduled_at,d.error_code FROM reminder_deliveries d JOIN local_tasks t ON t.id=d.task_id WHERE d.state='catch_up' AND t.completed=0 ORDER BY d.scheduled_at DESC")
        .fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| CatchUpItem { occurrence_key:r.get(0), task_id:r.get(1), title:r.get(2), scheduled_at:r.get(3), error_code:r.get(4) }).collect())
}
