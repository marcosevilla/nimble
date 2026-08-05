use crate::integrations::todoist::{client, mappers, outbox};
use sqlx::SqlitePool;
use std::collections::HashMap;

/// Push-side context: resolves local ids referenced by outbox rows to the
/// Todoist-facing identifiers a command needs (external id, in-batch temp_id,
/// or a "section:{id}" pseudo-project), plus enough snapshot state to build
/// due-date args and detect no-op moves.
pub struct PushCtx {
    /// local task id → external_id (None = exists locally, unsynced)
    task_external: HashMap<String, Option<String>>,
    /// local project id → external_id ("section:{id}" possible)
    project_external: HashMap<String, String>,
    /// local task id → stored snapshot due object
    base_due: HashMap<String, serde_json::Value>,
    /// local id → temp_id of an in-batch pending create
    temp_ids: HashMap<String, String>,
    /// local task id → current remote project_external_id from synced_snapshot
    /// (used to detect a `move` op that would be a no-op on Todoist's side)
    current_project: HashMap<String, String>,
}

impl PushCtx {
    #[cfg(test)]
    pub fn for_tests(
        task_external: HashMap<String, Option<String>>,
        project_external: HashMap<String, String>,
    ) -> Self {
        Self {
            task_external,
            project_external,
            base_due: HashMap::new(),
            temp_ids: HashMap::new(),
            current_project: HashMap::new(),
        }
    }
    #[cfg(test)]
    pub fn set_base_due_for_tests(&mut self, local_id: &str, due: serde_json::Value) {
        self.base_due.insert(local_id.into(), due);
    }
    #[cfg(test)]
    pub fn set_current_project_for_tests(&mut self, local_id: &str, external_project: &str) {
        self.current_project
            .insert(local_id.into(), external_project.into());
    }

    /// Resolves a local task id to the identifier a command should address it
    /// by: its external_id if already synced, else an in-batch temp_id (from
    /// `temp_ids`, or from `extra_temp_ids` — rows in the current batch that
    /// haven't been folded into `temp_ids` yet, e.g. when `PushCtx` was built
    /// without going through `load_push_ctx`).
    fn resolve_task_id(&self, local_id: &str, extra_temp_ids: &HashMap<String, String>) -> Option<String> {
        self.task_external
            .get(local_id)
            .cloned()
            .flatten()
            .or_else(|| self.temp_ids.get(local_id).cloned())
            .or_else(|| extra_temp_ids.get(local_id).cloned())
    }
    fn resolve_project_ref(&self, local_id: &str, extra_temp_ids: &HashMap<String, String>) -> Option<String> {
        self.project_external
            .get(local_id)
            .cloned()
            .or_else(|| self.temp_ids.get(local_id).cloned())
            .or_else(|| extra_temp_ids.get(local_id).cloned())
    }
}

/// Every row in the current batch that carries a `temp_id` (only pending
/// `create` rows do) contributes a local_id → temp_id mapping other rows in
/// the *same* batch can reference (e.g. a `close` enqueued right after a
/// still-pending `create` for the same task). `load_push_ctx` already folds
/// this into `PushCtx::temp_ids` for real batches; `build_commands` re-derives
/// it from `rows` directly so it also works against a `PushCtx` assembled by
/// hand (as the unit tests below do, via `PushCtx::for_tests`).
fn batch_temp_ids(rows: &[outbox::OutboxRow]) -> HashMap<String, String> {
    rows.iter()
        .filter_map(|r| r.temp_id.clone().map(|t| (r.local_id.clone(), t)))
        .collect()
}

pub async fn load_push_ctx(pool: &SqlitePool, rows: &[outbox::OutboxRow]) -> crate::Result<PushCtx> {
    let mut ctx = PushCtx {
        task_external: HashMap::new(),
        project_external: HashMap::new(),
        base_due: HashMap::new(),
        temp_ids: HashMap::new(),
        current_project: HashMap::new(),
    };
    for row in rows {
        if let Some(t) = &row.temp_id {
            ctx.temp_ids.insert(row.local_id.clone(), t.clone());
        }
    }
    // load referenced tasks (their external_id + snapshot due + snapshot project)
    for row in rows.iter().filter(|r| r.object_type == "task") {
        let rec: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT external_id, synced_snapshot FROM local_tasks WHERE id = ?",
        )
        .bind(&row.local_id)
        .fetch_optional(pool)
        .await?;
        if let Some((ext, snap)) = rec {
            let parsed_snapshot = snap.and_then(|s| serde_json::from_str::<mappers::TaskSnapshot>(&s).ok());
            if let Some(due) = parsed_snapshot.as_ref().and_then(|s| s.due.clone()) {
                ctx.base_due.insert(row.local_id.clone(), due);
            }
            if let Some(project_ext) = parsed_snapshot.as_ref().and_then(|s| s.project_external_id.clone()) {
                ctx.current_project.insert(row.local_id.clone(), project_ext);
            }
            ctx.task_external.insert(row.local_id.clone(), ext);
        }
        // referenced target projects for create/move payloads
        for key in ["project_local_id", "parent_local_id"] {
            if let Some(pid) = row.payload.get(key).and_then(|v| v.as_str()) {
                if !ctx.project_external.contains_key(pid) {
                    let ext: Option<(Option<String>,)> =
                        sqlx::query_as("SELECT external_id FROM projects WHERE id = ?")
                            .bind(pid)
                            .fetch_optional(pool)
                            .await?;
                    if let Some((Some(e),)) = ext {
                        ctx.project_external.insert(pid.to_string(), e);
                    }
                }
                if key == "parent_local_id" {
                    // parent is a task, not a project — record its external id too
                    let ext: Option<(Option<String>,)> =
                        sqlx::query_as("SELECT external_id FROM local_tasks WHERE id = ?")
                            .bind(pid)
                            .fetch_optional(pool)
                            .await?;
                    if let Some((e,)) = ext {
                        ctx.task_external.entry(pid.to_string()).or_insert(e);
                    }
                }
            }
        }
    }
    Ok(ctx)
}

fn project_ref_args(external: &str) -> (String, serde_json::Value) {
    match external.strip_prefix("section:") {
        Some(section) => ("section_id".into(), section.into()),
        None => ("project_id".into(), external.into()),
    }
}

/// Builds `/sync` commands from outbox rows. Returns the buildable commands plus
/// a list of `(outbox_row_id, reason)` for rows that could not be turned into a
/// command. Two reason families are handled specially by `push_outbox`:
/// - reasons mentioning "never-synced" (delete of a row with no external_id and
///   no pending create) — nothing to do remotely, dropped as a success.
/// - reasons mentioning "no-op move" (target project already matches the task's
///   current remote project per its synced_snapshot) — dropped as a success,
///   per the Task 9 ledger ruling: Turso-pulled updates to linked tasks always
///   enqueue a `move` alongside `update` even when the project didn't change.
/// All other reasons are genuine failures and get marked `error`.
pub fn build_commands(
    rows: &[outbox::OutboxRow],
    ctx: &PushCtx,
) -> (Vec<serde_json::Value>, Vec<(String, String)>) {
    let extra_temp_ids = batch_temp_ids(rows);
    let mut cmds = Vec::new();
    let mut unbuildable = Vec::new();
    for row in rows {
        let cmd = match (row.object_type.as_str(), row.op.as_str()) {
            ("task", "create") => {
                let mut args = serde_json::Map::new();
                args.insert("content".into(), row.payload["content"].clone());
                if let Some(d) = row.payload.get("description").filter(|v| !v.is_null()) {
                    args.insert("description".into(), d.clone());
                }
                if let Some(p) = row.payload.get("priority").filter(|v| !v.is_null()) {
                    args.insert("priority".into(), p.clone());
                }
                if let Some(d) = row.payload.get("due_date").and_then(|v| v.as_str()) {
                    args.insert("due".into(), serde_json::json!({"date": d}));
                }
                if let Some(p) = row.payload.get("project_local_id").and_then(|v| v.as_str()) {
                    if let Some(ext) = ctx.resolve_project_ref(p, &extra_temp_ids) {
                        let (k, v) = project_ref_args(&ext);
                        args.insert(k, v);
                    } // unresolvable project → task lands in Todoist inbox; fine
                }
                if let Some(par) = row.payload.get("parent_local_id").and_then(|v| v.as_str()) {
                    if let Some(ext) = ctx.resolve_task_id(par, &extra_temp_ids) {
                        args.insert("parent_id".into(), ext.into());
                    }
                }
                Some(serde_json::json!({
                    "type": "item_add", "uuid": row.command_uuid,
                    "temp_id": row.temp_id, "args": args,
                }))
            }
            ("task", "update") => match ctx.resolve_task_id(&row.local_id, &extra_temp_ids) {
                None => {
                    unbuildable.push((row.id.clone(), "no remote id for update".into()));
                    None
                }
                Some(id) => {
                    let mut args = serde_json::Map::new();
                    args.insert("id".into(), id.into());
                    for key in ["content", "description", "priority"] {
                        if let Some(v) = row.payload.get(key) {
                            args.insert(key.into(), v.clone());
                        }
                    }
                    if row.payload.get("due_date").is_some() {
                        let due = mappers::due_args(
                            row.payload["due_date"].as_str(),
                            ctx.base_due.get(&row.local_id),
                        );
                        args.insert("due".into(), due["due"].clone());
                    }
                    Some(serde_json::json!({"type": "item_update", "uuid": row.command_uuid, "args": args}))
                }
            },
            ("task", "close") | ("task", "reopen") => match ctx.resolve_task_id(&row.local_id, &extra_temp_ids) {
                None => {
                    unbuildable.push((row.id.clone(), "no remote id".into()));
                    None
                }
                Some(id) => {
                    let cmd_type = if row.op == "close" { "item_close" } else { "item_uncomplete" };
                    Some(serde_json::json!({"type": cmd_type, "uuid": row.command_uuid, "args": {"id": id}}))
                }
            },
            ("task", "move") => {
                let resolved_id = ctx.resolve_task_id(&row.local_id, &extra_temp_ids);
                let resolved_project = row
                    .payload
                    .get("project_local_id")
                    .and_then(|v| v.as_str())
                    .and_then(|p| ctx.resolve_project_ref(p, &extra_temp_ids));
                match (resolved_id, resolved_project) {
                    (Some(id), Some(ext)) => {
                        if ctx.current_project.get(&row.local_id) == Some(&ext) {
                            // Target project already matches the task's current remote
                            // project (per synced_snapshot) — sending this would be a
                            // no-op item_move. Drop it rather than wasting a round trip.
                            unbuildable.push((
                                row.id.clone(),
                                "no-op move (target already current remote project)".into(),
                            ));
                            None
                        } else {
                            let (k, v) = project_ref_args(&ext);
                            let mut args = serde_json::Map::new();
                            args.insert("id".into(), id.into());
                            args.insert(k, v);
                            Some(serde_json::json!({"type": "item_move", "uuid": row.command_uuid, "args": args}))
                        }
                    }
                    _ => {
                        unbuildable.push((row.id.clone(), "unresolvable move".into()));
                        None
                    }
                }
            }
            ("task", "delete") => match row.payload.get("external_id").and_then(|v| v.as_str()) {
                None => {
                    unbuildable.push((row.id.clone(), "delete of never-synced row".into()));
                    None
                }
                Some(ext) => Some(serde_json::json!({"type": "item_delete", "uuid": row.command_uuid, "args": {"id": ext}})),
            },
            ("project", "create") => Some(serde_json::json!({
                "type": "project_add", "uuid": row.command_uuid, "temp_id": row.temp_id,
                "args": {"name": row.payload["name"]},
            })),
            ("project", "update") => match ctx.resolve_project_ref(&row.local_id, &extra_temp_ids) {
                None => {
                    unbuildable.push((row.id.clone(), "no remote id for project".into()));
                    None
                }
                Some(ext) => Some(serde_json::json!({"type": "project_update", "uuid": row.command_uuid, "args": {"id": ext, "name": row.payload["name"]}})),
            },
            ("project", "delete") => match row.payload.get("external_id").and_then(|v| v.as_str()) {
                None => {
                    unbuildable.push((row.id.clone(), "delete of never-synced project".into()));
                    None
                }
                Some(ext) => Some(serde_json::json!({"type": "project_delete", "uuid": row.command_uuid, "args": {"id": ext}})),
            },
            _ => {
                unbuildable.push((row.id.clone(), format!("unknown op {}/{}", row.object_type, row.op)));
                None
            }
        };
        if let Some(c) = cmd {
            cmds.push(c);
        }
    }
    (cmds, unbuildable)
}

/// Drains the outbox in batches of up to 100 rows, sending each batch as a
/// single `/sync` request. Returns the number of outbox rows confirmed done.
pub async fn push_outbox(pool: &SqlitePool, token: &str) -> crate::Result<usize> {
    let mut confirmed = 0usize;
    loop {
        let rows = outbox::pending_batch(pool, 100).await?;
        if rows.is_empty() {
            break;
        }
        let ctx = load_push_ctx(pool, &rows).await?;
        let (cmds, unbuildable) = build_commands(&rows, &ctx);
        for (row_id, reason) in &unbuildable {
            // Never-synced deletes and no-op moves are successes (nothing to do
            // remotely), not errors — drop them rather than erroring forever.
            if reason.contains("never-synced") || reason.contains("no-op") {
                outbox::mark_done(pool, &[row_id.clone()]).await?;
            } else {
                outbox::mark_error(pool, row_id, reason).await?;
            }
        }
        if cmds.is_empty() {
            continue;
        }
        let resp = client::sync(token, &serde_json::json!({"commands": cmds})).await?;
        for row in &rows {
            let Some(status) = resp.sync_status.get(&row.command_uuid) else { continue };
            if client::command_ok(status) {
                if row.op == "create" {
                    if let Some(temp) = &row.temp_id {
                        if let Some(real_id) = resp.temp_id_mapping.get(temp) {
                            let table = if row.object_type == "project" { "projects" } else { "local_tasks" };
                            sqlx::query(&format!(
                                "UPDATE {table} SET external_id = ?, external_source = 'todoist' WHERE id = ?"
                            ))
                            .bind(real_id)
                            .bind(&row.local_id)
                            .execute(pool)
                            .await?;
                        }
                    }
                }
                outbox::mark_done(pool, &[row.id.clone()]).await?;
                confirmed += 1;
            } else {
                outbox::mark_error(pool, &row.id, &status.to_string()).await?;
            }
        }
    }
    Ok(confirmed)
}

#[cfg(test)]
mod push_tests {
    use super::*;
    use crate::integrations::todoist::outbox::OutboxRow;
    use serde_json::json;

    fn row(op: &str, local_id: &str, payload: serde_json::Value, temp_id: Option<&str>) -> OutboxRow {
        OutboxRow {
            id: format!("ob-{op}-{local_id}"),
            local_id: local_id.into(),
            object_type: if op.starts_with("project") { "project".into() } else { "task".into() },
            op: op.into(),
            payload,
            command_uuid: format!("uuid-{op}-{local_id}"),
            temp_id: temp_id.map(String::from),
        }
    }

    fn ctx_with(task_external: &[(&str, Option<&str>)], project_external: &[(&str, &str)]) -> PushCtx {
        PushCtx::for_tests(
            task_external.iter().map(|(l, e)| ((*l).into(), e.map(String::from))).collect(),
            project_external.iter().map(|(l, e)| ((*l).into(), (*e).into())).collect(),
        )
    }

    #[test]
    fn create_becomes_item_add_with_temp_id() {
        let rows = vec![row("create", "t1",
            json!({"content": "c", "priority": 2, "project_local_id": "p1", "due_date": null, "description": null, "parent_local_id": null}),
            Some("tmp-t1"))];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[0]["type"], "item_add");
        assert_eq!(cmds[0]["temp_id"], "tmp-t1");
        assert_eq!(cmds[0]["uuid"], "uuid-create-t1");
        assert_eq!(cmds[0]["args"]["content"], "c");
        assert_eq!(cmds[0]["args"]["project_id"], "EXT-P1");
    }

    #[test]
    fn ops_on_unsynced_task_reference_in_batch_temp_id() {
        let rows = vec![
            row("create", "t1", json!({"content": "c", "project_local_id": "p1"}), Some("tmp-t1")),
            row("close", "t1", json!({}), None),
        ];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[1]["type"], "item_close");
        assert_eq!(cmds[1]["args"]["id"], "tmp-t1");
    }

    #[test]
    fn move_to_section_pseudo_project_uses_section_id() {
        let rows = vec![row("move", "t1", json!({"project_local_id": "p2"}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[("p2", "section:S77")]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["type"], "item_move");
        assert_eq!(cmds[0]["args"]["id"], "EXT-T1");
        assert_eq!(cmds[0]["args"]["section_id"], "S77");
        assert!(cmds[0]["args"].get("project_id").is_none());
    }

    #[test]
    fn delete_without_external_id_is_unbuildable_not_a_command() {
        let rows = vec![row("delete", "t9", json!({"external_id": null}), None)];
        let ctx = ctx_with(&[], &[]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(cmds.is_empty());
        assert_eq!(bad.len(), 1);
    }

    #[test]
    fn update_with_due_date_uses_due_args_against_snapshot() {
        // ctx carries the task's stored snapshot due (recurring) — reschedule must preserve the string
        let rows = vec![row("update", "t1", json!({"due_date": "2026-08-10"}), None)];
        let mut ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        ctx.set_base_due_for_tests("t1", json!({"date": "2026-08-04", "string": "every day", "is_recurring": true}));
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["type"], "item_update");
        assert_eq!(cmds[0]["args"]["due"]["string"], "every day");
        assert_eq!(cmds[0]["args"]["due"]["date"], "2026-08-10");
    }

    #[test]
    fn move_to_already_current_project_is_dropped_as_no_op() {
        // Task 9 ledger ruling: Turso-pulled updates to linked tasks always enqueue a
        // `move` alongside `update`, even when the project didn't change. The push
        // builder must recognize target == current remote project and drop the
        // command rather than sending a wasted (though harmless) item_move.
        let rows = vec![row("move", "t1", json!({"project_local_id": "p1"}), None)];
        let mut ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[("p1", "EXT-P1")]);
        ctx.set_current_project_for_tests("t1", "EXT-P1");
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(cmds.is_empty(), "no-op move should not produce a command");
        assert_eq!(bad.len(), 1);
        assert!(bad[0].1.contains("no-op"));
    }

    #[test]
    fn move_to_different_project_still_builds_command_even_with_current_project_set() {
        let rows = vec![row("move", "t1", json!({"project_local_id": "p2"}), None)];
        let mut ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[("p2", "EXT-P2")]);
        ctx.set_current_project_for_tests("t1", "EXT-P1");
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[0]["type"], "item_move");
        assert_eq!(cmds[0]["args"]["project_id"], "EXT-P2");
    }
}
