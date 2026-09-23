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
    if record_activity(pool, action_type, target_id, metadata)
        .await
        .is_err()
    {
        log::warn!("Failed to record activity");
    }
}

/// Fallible activity recording for callers (such as dt gap) that promise persistence.
pub async fn record_activity(
    pool: &SqlitePool,
    action_type: &str,
    target_id: Option<&str>,
    metadata: Option<serde_json::Value>,
) -> crate::Result<ActivityEntry> {
    let id = Uuid::new_v4().to_string();
    let created_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let metadata_str = metadata.as_ref().map(|m| m.to_string());
    sqlx::query("INSERT INTO activity_log (id, action_type, target_id, metadata, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id).bind(action_type).bind(target_id).bind(&metadata_str).bind(&created_at)
        .execute(pool).await?;
    let snapshot = serde_json::json!({"id": &id, "action_type": action_type,
        "target_id": target_id, "metadata": &metadata_str, "created_at": &created_at});
    // Preserve the existing observer contract: local persistence succeeds even if sync logging fails.
    if sync::append_sync_log(
        pool,
        "activity_log",
        &id,
        "INSERT",
        None,
        Some(&snapshot.to_string()),
    )
    .await
    .is_err()
    {
        log::warn!("Activity persisted, but sync logging failed");
    }
    Ok(ActivityEntry {
        id,
        action_type: action_type.to_owned(),
        target_id: target_id.map(str::to_owned),
        metadata,
        created_at,
    })
}

/// One task status change, as the activity log sees it.
pub struct StatusActivity<'a> {
    pub content: Option<&'a str>,
    pub old_status: Option<&'a str>,
    pub new_status: &'a str,
    pub note: Option<&'a str>,
    /// (before_due, after_due) when completing advanced a recurring task.
    pub recurrence: Option<(&'a str, &'a str)>,
}

/// Which row a status change becomes. Completion and reopening get their own
/// actions carrying the title, so the timeline names the task and counts it
/// (re-score 1c: every completion read "Status changed" with no name). The
/// completed row deliberately has no `new_status`: the timeline prints
/// `old → new` whenever both keys exist, which would hide the title.
pub fn status_activity(s: &StatusActivity) -> (&'static str, serde_json::Value) {
    let mut meta = serde_json::Map::new();
    if let Some(c) = s.content {
        meta.insert("content".into(), c.into());
    }
    let action = if let Some((from, to)) = s.recurrence {
        meta.insert("from".into(), from.into());
        meta.insert("to".into(), to.into());
        "task_recurred"
    } else if s.new_status == "complete" {
        meta.insert("old_status".into(), s.old_status.unwrap_or_default().into());
        "task_completed"
    } else if s.old_status == Some("complete") {
        meta.insert("new_status".into(), s.new_status.into());
        "task_uncompleted"
    } else {
        meta.insert("old_status".into(), s.old_status.unwrap_or_default().into());
        meta.insert("new_status".into(), s.new_status.into());
        "status_changed"
    };
    if let Some(n) = s.note {
        meta.insert("note".into(), n.into());
    }
    (action, serde_json::Value::Object(meta))
}

/// Fire-and-forget, like `log_activity`.
pub async fn log_task_status(pool: &SqlitePool, task_id: &str, s: StatusActivity<'_>) {
    let (action, meta) = status_activity(&s);
    log_activity(pool, action, Some(task_id), Some(meta)).await;
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
    if action_type.is_some() {
        conditions.push("action_type = ?");
    }
    if target_id.is_some() {
        conditions.push("target_id = ?");
    }

    let sql = format!(
        "SELECT id, action_type, target_id, metadata, created_at FROM activity_log WHERE {} ORDER BY created_at DESC LIMIT ?",
        conditions.join(" AND ")
    );

    let mut query =
        sqlx::query_as::<_, (String, String, Option<String>, Option<String>, String)>(&sql)
            .bind(from_date)
            .bind(to_date);
    if let Some(action) = action_type {
        query = query.bind(action);
    }
    if let Some(tid) = target_id {
        query = query.bind(tid);
    }
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

#[cfg(test)]
mod status_tests {
    use super::{status_activity, StatusActivity};
    use serde_json::json;

    fn s<'a>(old: Option<&'a str>, new: &'a str) -> StatusActivity<'a> {
        StatusActivity { content: Some("Pay taxes"), old_status: old, new_status: new, note: None, recurrence: None }
    }

    #[test]
    fn completion_is_a_named_task_completed() {
        let (a, m) = status_activity(&s(Some("in_progress"), "complete"));
        assert_eq!(a, "task_completed");
        assert_eq!(m, json!({"content": "Pay taxes", "old_status": "in_progress"}));
    }

    #[test]
    fn reopening_is_task_uncompleted() {
        let (a, m) = status_activity(&s(Some("complete"), "todo"));
        assert_eq!(a, "task_uncompleted");
        assert_eq!(m, json!({"content": "Pay taxes", "new_status": "todo"}));
    }

    #[test]
    fn recurrence_wins_over_completion() {
        let mut x = s(Some("todo"), "complete");
        x.recurrence = Some(("2026-09-01", "2026-09-02"));
        let (a, m) = status_activity(&x);
        assert_eq!(a, "task_recurred");
        assert_eq!(m, json!({"content": "Pay taxes", "from": "2026-09-01", "to": "2026-09-02"}));
    }

    #[test]
    fn other_moves_stay_status_changed_with_note() {
        let mut x = s(Some("todo"), "blocked");
        x.note = Some("waiting on Sara");
        let (a, m) = status_activity(&x);
        assert_eq!(a, "status_changed");
        assert_eq!(m, json!({"content": "Pay taxes", "old_status": "todo", "new_status": "blocked", "note": "waiting on Sara"}));
    }

    #[test]
    fn unknown_title_and_old_status_are_tolerated() {
        let x = StatusActivity { content: None, old_status: None, new_status: "in_progress", note: None, recurrence: None };
        let (a, m) = status_activity(&x);
        assert_eq!(a, "status_changed");
        assert_eq!(m, json!({"old_status": "", "new_status": "in_progress"}));
    }
}
