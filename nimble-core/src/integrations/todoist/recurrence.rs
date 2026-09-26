//! Todoist-linked recurrence: how a Todoist `due` maps onto the local
//! `recurrence_rule`, who advances a linked recurring task, and the repair
//! for rows the pull linked before it carried recurrence.
//!
//! Ownership rule: while Todoist sync is on, a task Todoist says is recurring
//! (its `synced_snapshot.due.is_recurring`) is advanced by Todoist, not by
//! Nimble's engine. Completing it here closes it locally and pushes
//! `item_close`; Todoist rolls its own due date forward, and the pull reopens
//! the row on that new date. `recurrence_rule` mirrors Todoist's string so it
//! is visible, and is the native fallback if sync is ever turned off.

use sqlx::SqliteConnection;

use crate::types::LocalTask;

/// Todoist's recurrence string mapped onto Nimble's grammar
/// (`crate::recurrence`) where the meaning is identical; any other string is
/// kept verbatim (visible, and inert for the native engine).
pub fn rule_from_todoist_string(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if crate::recurrence::parse_rule(s).is_some() {
        return Some(s.to_string());
    }
    let lower = s.to_lowercase();
    let candidate = if let Some(rest) = lower.strip_prefix("every other ") {
        // "every other week [at 9am]" == "every 2 weeks [at 9am]"
        let (unit, tail) = rest.split_once(' ').unwrap_or((rest, ""));
        let tail = if tail.is_empty() { String::new() } else { format!(" {tail}") };
        Some(format!("every 2 {unit}s{tail}"))
    } else {
        let (first, tail) = lower.split_once(' ').unwrap_or((lower.as_str(), ""));
        let unit = match first {
            "daily" => Some("day"),
            "weekly" => Some("week"),
            "monthly" => Some("month"),
            "yearly" | "annually" => Some("year"),
            _ => None,
        };
        unit.map(|u| if tail.is_empty() { format!("every {u}") } else { format!("every {u} {tail}") })
    };
    match candidate {
        Some(c) if crate::recurrence::parse_rule(&c).is_some() => Some(c),
        _ => Some(s.to_string()),
    }
}

/// The local `recurrence_rule` a Todoist `due` object implies: `None` unless
/// the due is recurring with a non-empty string.
pub fn rule_from_due(due: Option<&serde_json::Value>) -> Option<String> {
    let due = due?;
    if !due.get("is_recurring").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    due.get("string").and_then(|v| v.as_str()).and_then(rule_from_todoist_string)
}

/// Whether the task's last synced Todoist state says it recurs.
pub fn snapshot_is_recurring(task: &LocalTask) -> bool {
    task.synced_snapshot
        .as_deref()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.pointer("/due/is_recurring").and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

/// Todoist advances this task (see the module doc): linked, pushed to
/// Todoist, recurring there, and the Todoist integration is on.
pub async fn todoist_owns_recurrence_tx(conn: &mut SqliteConnection, task: &LocalTask) -> crate::Result<bool> {
    if task.external_source.as_deref() != Some("todoist")
        || task.external_id.is_none()
        || task.sync_policy == "local_only"
        || !snapshot_is_recurring(task)
    {
        return Ok(false);
    }
    let active: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM integration_sync_state WHERE provider='todoist' AND enabled=1 AND EXISTS (SELECT 1 FROM settings WHERE key='todoist_api_token')",
    )
    .fetch_optional(&mut *conn)
    .await?;
    Ok(active.is_some())
}

/// Error prefix for a refused rule edit (`dt` reports it as `validation`).
pub const RECURRENCE_LOCKED: &str = "recurrence_locked: This task repeats in Todoist. Edit its repeat rule in Todoist.";

/// Whether `input` would change the rule of a task Todoist owns (see the
/// module doc). While Todoist sync is on, that rule is read-only in Nimble:
/// edits don't push to Todoist, so allowing one would only make the two
/// disagree. An unchanged rule (e.g. a full due value echoed back) is fine.
/// Revisit at the C5 cutover.
pub async fn recurrence_change_locked_tx(
    conn: &mut SqliteConnection,
    task: &LocalTask,
    input: &crate::types::UpdateTaskInput,
) -> crate::Result<bool> {
    let norm = |r: Option<&str>| r.map(str::trim).filter(|r| !r.is_empty()).map(str::to_string);
    let current = norm(task.recurrence_rule.as_deref());
    // Same order as `update_task_tx`: set, then clear.
    let next = if input.clear_recurrence {
        None
    } else if input.recurrence_rule.is_some() {
        norm(input.recurrence_rule.as_deref())
    } else {
        current.clone()
    };
    if next == current {
        return Ok(false);
    }
    todoist_owns_recurrence_tx(conn, task).await
}

/// Pool wrapper for callers that validate before writing (`dt`).
pub async fn recurrence_change_locked(
    pool: &sqlx::SqlitePool,
    task: &LocalTask,
    input: &crate::types::UpdateTaskInput,
) -> crate::Result<bool> {
    let mut conn = pool.acquire().await?;
    recurrence_change_locked_tx(&mut conn, task, input).await
}

/// What `repair_linked_recurrence_tx` changed.
#[derive(Debug, Default, PartialEq)]
pub struct RecurrenceRepair {
    /// Rows whose empty `recurrence_rule` was filled from Todoist.
    pub rules_filled: Vec<String>,
    /// Rows complete here while Todoist has the same recurring occurrence
    /// open (a Nimble completion Todoist rolled forward, which older pulls
    /// never reopened), reopened on Todoist's date.
    pub reopened: Vec<String>,
}

/// Repairs linked rows from their stored Todoist snapshot (no network), so it
/// reaches rows no future delta will touch. Runs at the end of every pull
/// (and so the reconcile's final pull). Idempotent.
pub async fn repair_linked_recurrence_tx(conn: &mut SqliteConnection) -> crate::Result<RecurrenceRepair> {
    let mut out = RecurrenceRepair::default();
    // Complete here, open and recurring in Todoist on the date we already
    // hold, with no close still on its way: Todoist already took the
    // completion. (An errored close is not "on its way" — Todoist still has
    // the occurrence open, so it is open here too.)
    let stuck: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM local_tasks t
         WHERE external_source = 'todoist' AND external_id IS NOT NULL AND sync_policy != 'local_only'
           AND (completed = 1 OR status = 'complete')
           AND json_valid(synced_snapshot)
           AND json_extract(synced_snapshot, '$.due.is_recurring') = 1
           AND json_extract(synced_snapshot, '$.checked') = 0
           AND due_date IS json_extract(synced_snapshot, '$.due_date')
           AND NOT EXISTS (SELECT 1 FROM todoist_outbox o
                           WHERE o.local_id = t.id AND o.op = 'close' AND o.status IN ('pending', 'sending'))",
    )
    .fetch_all(&mut *conn)
    .await?;
    for (id,) in stuck {
        sqlx::query(
            "UPDATE local_tasks SET completed = 0, status = 'todo', completed_at = NULL,
                updated_at = datetime('now','localtime') WHERE id = ?",
        )
        .bind(&id)
        .execute(&mut *conn)
        .await?;
        out.reopened.push(id);
    }
    // Open rows only: completed history keeps its rule untouched (and out of
    // sync_log). Runs after the reopen so a reopened row gets its rule.
    let empty: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, synced_snapshot FROM local_tasks
         WHERE external_source = 'todoist' AND external_id IS NOT NULL AND sync_policy != 'local_only'
           AND completed = 0 AND status != 'complete'
           AND json_valid(synced_snapshot) AND json_extract(synced_snapshot, '$.due.is_recurring') = 1
           AND json_extract(synced_snapshot, '$.checked') = 0
           AND (recurrence_rule IS NULL OR trim(recurrence_rule) = '')",
    )
    .fetch_all(&mut *conn)
    .await?;
    for (id, snapshot) in empty {
        let due = serde_json::from_str::<serde_json::Value>(&snapshot).ok().and_then(|v| v.get("due").cloned());
        if let Some(rule) = rule_from_due(due.as_ref()) {
            sqlx::query("UPDATE local_tasks SET recurrence_rule = ? WHERE id = ?")
                .bind(&rule)
                .bind(&id)
                .execute(&mut *conn)
                .await?;
            out.rules_filled.push(id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn grammar_strings_pass_through() {
        for s in ["every day", "every month", "every 2 weeks @ 09:00", "every week at 9am"] {
            assert_eq!(rule_from_todoist_string(s).as_deref(), Some(s));
        }
    }

    #[test]
    fn exact_synonyms_translate() {
        assert_eq!(rule_from_todoist_string("every other week").as_deref(), Some("every 2 weeks"));
        assert_eq!(rule_from_todoist_string("Every other day at 9am").as_deref(), Some("every 2 days at 9am"));
        assert_eq!(rule_from_todoist_string("daily").as_deref(), Some("every day"));
        assert_eq!(rule_from_todoist_string("monthly").as_deref(), Some("every month"));
    }

    #[test]
    fn other_strings_are_kept_verbatim() {
        for s in ["every mon", "every 2nd friday", "every weekday", "every month on the 6th", "every 25th",
                  "every tuesday at 9pm", "every! 3 days"] {
            assert_eq!(rule_from_todoist_string(s).as_deref(), Some(s));
            assert!(crate::recurrence::parse_rule(s).is_none(), "{s} must stay inert natively");
        }
    }

    #[test]
    fn only_recurring_dues_imply_a_rule() {
        assert_eq!(rule_from_due(Some(&json!({"date": "2026-10-06", "string": "every month", "is_recurring": true}))).as_deref(), Some("every month"));
        assert_eq!(rule_from_due(Some(&json!({"date": "2026-10-06", "string": "Oct 6", "is_recurring": false}))), None);
        assert_eq!(rule_from_due(Some(&json!({"date": "2026-10-06", "string": null, "is_recurring": true}))), None);
        assert_eq!(rule_from_due(None), None);
    }
}
