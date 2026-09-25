//! One file per brief module (addendum §1). Each gathers from local data
//! only, never the network, so an offline first open still snapshots.

pub mod due_today;
pub mod habits;
pub mod notes;
pub mod priorities;
pub mod quick_wins;
pub mod schedule;
pub mod still_open;
pub mod vault;
pub mod weather;

use serde_json::{json, Value};

use crate::brief::BriefCtx;
use crate::types::LocalTask;

/// A task as a snapshot freezes it: `{id, content, due_date, priority, project_id}`.
pub(crate) fn task_ref(t: &LocalTask) -> Value {
    json!({"id": t.id, "content": t.content, "due_date": t.due_date, "priority": t.priority, "project_id": t.project_id})
}

/// Open top-level tasks due on or before the brief's date.
pub(crate) async fn open_top_level(ctx: &BriefCtx<'_>) -> crate::Result<Vec<LocalTask>> {
    Ok(crate::db::tasks::get_local_tasks(ctx.pool, None, Some(ctx.date), false)
        .await?
        .into_iter()
        .filter(|t| t.parent_id.is_none())
        .collect())
}
