use crate::integrations::todoist::{client, mappers, merge, outbox};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::OnceLock;

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
                    let t = row.payload.get("due_time").and_then(|v| v.as_str());
                    let due = mappers::due_args(Some(d), t, None);
                    args.insert("due".into(), due["due"].clone());
                }
                if let Some(minutes) = row.payload.get("duration_minutes").and_then(|v| v.as_i64()) {
                    args.insert("duration".into(), minutes.into());
                    args.insert("duration_unit".into(), "minute".into());
                }
                // Labels assigned at creation time (`CreateTaskInput::label_ids`)
                // fire a separate `set_task_labels` call right after the task
                // row is inserted, which enqueues its own "update" op — but
                // that "update" merges into this still-pending "create" row
                // (see outbox::enqueue's merge-into-pending-create behavior)
                // rather than staying a separate row. Without reading `labels`
                // here, a create+labels row would silently drop the labels on
                // push, and the next pull (finding no remote labels, base =
                // None on first contact) would then delete them locally too.
                if let Some(v) = row.payload.get("labels") {
                    args.insert("labels".into(), v.clone());
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
                    if row.payload.get("due_date").is_some() || row.payload.get("due_time").is_some() {
                        let due = mappers::due_args(
                            row.payload.get("due_date").and_then(|v| v.as_str()),
                            row.payload.get("due_time").and_then(|v| v.as_str()),
                            ctx.base_due.get(&row.local_id),
                        );
                        args.insert("due".into(), due["due"].clone());
                    }
                    if let Some(v) = row.payload.get("duration_minutes") {
                        match v.as_i64() {
                            Some(minutes) => {
                                args.insert("duration".into(), minutes.into());
                                args.insert("duration_unit".into(), "minute".into());
                            }
                            None => {
                                args.insert("duration".into(), serde_json::Value::Null);
                                args.insert("duration_unit".into(), serde_json::Value::Null);
                            }
                        }
                    }
                    if let Some(v) = row.payload.get("labels") {
                        args.insert("labels".into(), v.clone());
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

/// Pure helper for the I3 progress guard: given the command_uuids of the rows
/// sent in a batch and the `sync_status` map from the response, returns the
/// number that resolved (present in the map, regardless of ok/error). If a
/// response omits every uuid — e.g. a malformed or empty `sync_status` — this
/// returns 0, which `push_outbox` uses to break out of its loop instead of
/// re-fetching and re-sending the same unchanged batch forever.
fn count_resolved(sent_command_uuids: &[&str], sync_status: &HashMap<String, serde_json::Value>) -> usize {
    sent_command_uuids
        .iter()
        .filter(|uuid| sync_status.contains_key(**uuid))
        .count()
}

/// Drains the outbox in batches of up to 100 rows, sending each batch as a
/// single `/sync` request. Returns the number of outbox rows confirmed done.
pub async fn push_outbox(pool: &SqlitePool, token: &str) -> crate::Result<usize> {
    // Crash/startup recovery: rows stuck 'sending' from a previous run that
    // never got a response get a chance to be retried (idempotent via the
    // command_uuid persisted at enqueue time).
    outbox::reset_stuck_sending(pool).await?;

    let mut confirmed = 0usize;
    loop {
        let rows = outbox::pending_batch(pool, 100).await?;
        if rows.is_empty() {
            break;
        }
        let ctx = load_push_ctx(pool, &rows).await?;
        let (cmds, unbuildable) = build_commands(&rows, &ctx);
        let unbuildable_ids: std::collections::HashSet<&str> =
            unbuildable.iter().map(|(id, _)| id.as_str()).collect();
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

        // Mark the rows about to be sent as 'sending' *before* the HTTP call
        // (I1): a local edit that arrives while this batch is in flight can no
        // longer coalesce into it (enqueue's coalescer only targets 'pending'
        // rows) — it creates a fresh pending op instead, so it can never be
        // silently discarded when this batch's response retires the sent row.
        let sending_ids: Vec<String> = rows
            .iter()
            .filter(|r| !unbuildable_ids.contains(r.id.as_str()))
            .map(|r| r.id.clone())
            .collect();
        outbox::mark_sending(pool, &sending_ids).await?;

        let resp = match client::sync(token, &serde_json::json!({"commands": cmds})).await {
            Ok(resp) => resp,
            Err(e) => {
                // Request never completed — revert to 'pending' so the next
                // sync cycle retries these rows instead of leaving them stuck.
                outbox::mark_pending(pool, &sending_ids).await?;
                return Err(e);
            }
        };

        let sent_command_uuids: Vec<&str> = rows
            .iter()
            .filter(|r| !unbuildable_ids.contains(r.id.as_str()))
            .map(|r| r.command_uuid.as_str())
            .collect();
        let resolved = count_resolved(&sent_command_uuids, &resp.sync_status);

        for row in &rows {
            if unbuildable_ids.contains(row.id.as_str()) {
                continue;
            }
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

        // I3 progress guard: if the response resolved none of the rows we sent
        // (e.g. it omitted every persisted command_uuid), stop instead of
        // re-fetching and re-sending the same unchanged batch forever while
        // holding the sync lock. Leave the unresolved rows — reverted to
        // 'pending' — for the next sync cycle to retry.
        if resolved == 0 {
            outbox::mark_pending(pool, &sending_ids).await?;
            break;
        }
    }
    Ok(confirmed)
}

#[derive(Debug, Default, serde::Serialize)]
pub struct SyncReport {
    pub skipped: Option<String>, // "disabled" | "already running"
    pub pushed: usize,
    pub created: usize, // native tasks created from pull
    pub updated: usize,
    pub deleted: usize,
    pub projects_upserted: usize,
}

impl SyncReport {
    pub fn changed_anything(&self) -> bool {
        self.created + self.updated + self.deleted + self.projects_upserted > 0
    }
}

static SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

async fn find_task_by_external(
    ex: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    external_id: &str,
) -> Result<Option<crate::types::LocalTask>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {} FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?",
        crate::db::tasks::SELECT_COLS
    ))
    .bind(external_id)
    .fetch_optional(ex)
    .await
}

/// Transactional pull apply: projects -> sections (pseudo-projects) -> items
/// (two-pass, so a child that arrives before its parent still links up), then
/// persists the new sync_token in the SAME transaction as the applied deltas.
/// All writes here are direct SQL against `local_tasks`/`projects` — never the
/// `db::tasks`/`db::projects` CRUD helpers — because those helpers fire the
/// Todoist mutation observer, which would re-enqueue outbox ops for changes
/// that originated from Todoist itself (an echo/infinite-loop risk). Direct
/// SQL sidesteps the observer entirely.
pub async fn apply_pull(pool: &SqlitePool, resp: &client::SyncResponse) -> crate::Result<SyncReport> {
    let mut report = SyncReport::default();

    // Resolve/create every distinct remote label name to a local label id
    // BEFORE opening the transaction below: `get_or_create_label_by_name`
    // opens its own transaction, and the pool has as few as one connection
    // (test pools always do) — doing this while apply_pull's own transaction
    // holds that connection would deadlock.
    let mut label_id_by_name: HashMap<String, String> = HashMap::new();
    for item in &resp.items {
        if item.is_deleted.unwrap_or(false) {
            continue;
        }
        for name in &item.labels {
            if !label_id_by_name.contains_key(name) {
                let label = crate::db::labels::get_or_create_label_by_name(pool, name).await?;
                label_id_by_name.insert(name.clone(), label.id);
            }
        }
    }
    // id -> name for every label, used to resolve an existing local task's
    // current `task_labels` ids into the sorted names `TaskSnapshot` compares
    // by (Todoist labels are compared/pushed by name, never by Nimble's
    // local-only label id).
    let label_name_by_id: HashMap<String, String> = crate::db::labels::list_labels(pool)
        .await?
        .into_iter()
        .map(|l| (l.id, l.name))
        .collect();

    let mut tx = pool.begin().await?;
    // (local_task_id, snapshot) pairs to sync_log AFTER commit
    let mut logged: Vec<(String, &'static str)> = Vec::new();
    // (task_id, label_id, op) pairs for `task_labels` rows to sync_log AFTER
    // commit — mirrors `logged` above but for the composite-key table.
    let mut label_sync_ops: Vec<(String, String, &'static str)> = Vec::new();

    // 1. projects
    for p in &resp.projects {
        if p.is_deleted.unwrap_or(false) || p.is_archived.unwrap_or(false) {
            continue; // keep local project; tasks were reassigned/removed via item deltas
        }
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&p.id)
        .fetch_optional(&mut *tx)
        .await?;
        match existing {
            Some((local_id,)) => {
                sqlx::query("UPDATE projects SET name = ? WHERE id = ? AND name != ?")
                    .bind(&p.name).bind(&local_id).bind(&p.name)
                    .execute(&mut *tx).await?;
            }
            None if p.inbox_project.unwrap_or(false) => {
                sqlx::query("UPDATE projects SET external_id = ?, external_source = 'todoist' WHERE id = 'inbox'")
                    .bind(&p.id).execute(&mut *tx).await?;
            }
            None => {
                let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM projects")
                    .fetch_one(&mut *tx).await?;
                sqlx::query("INSERT INTO projects (id, name, color, position, external_id, external_source) VALUES (?, ?, '#8b8b8b', ?, ?, 'todoist')")
                    .bind(uuid::Uuid::new_v4().to_string())
                    .bind(&p.name)
                    .bind(max.0)
                    .bind(&p.id)
                    .execute(&mut *tx).await?;
                report.projects_upserted += 1;
            }
        }
    }

    // 2. sections -> pseudo-projects "Parent / Section"
    for s in &resp.sections {
        if s.is_deleted.unwrap_or(false) { continue; }
        let pseudo_ext = format!("section:{}", s.id);
        let exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        ).bind(&pseudo_ext).fetch_optional(&mut *tx).await?;
        if exists.is_none() {
            let parent_name: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM projects WHERE external_source = 'todoist' AND external_id = ?",
            ).bind(&s.project_id).fetch_optional(&mut *tx).await?;
            let name = match parent_name {
                Some((p,)) => format!("{p} / {}", s.name),
                None => s.name.clone(),
            };
            let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM projects")
                .fetch_one(&mut *tx).await?;
            sqlx::query("INSERT INTO projects (id, name, color, position, external_id, external_source) VALUES (?, ?, '#8b8b8b', ?, ?, 'todoist')")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&name).bind(max.0).bind(&pseudo_ext)
                .execute(&mut *tx).await?;
            report.projects_upserted += 1;
        }
    }

    // 3. items -- pass 1
    let mut parent_links: Vec<(String, String)> = Vec::new(); // (child_external, parent_external)
    for item in &resp.items {
        // Test-only failure-injection hook: lets a regression test force a
        // mid-transaction error deterministically (without HTTP mocking or
        // relying on a real DB constraint violation) to prove the whole
        // transaction — deltas AND the new sync_token — rolls back together.
        // Compiled out entirely in non-test builds.
        #[cfg(test)]
        if item.content == "__FORCE_TEST_APPLY_FAILURE__" {
            return Err(crate::Error::Other("test-injected apply_pull failure".into()));
        }
        let local = find_task_by_external(&mut *tx, &item.id).await?;
        if item.is_deleted.unwrap_or(false) {
            if let Some(t) = local {
                // Defensive cascade mirroring db::tasks::delete_local_task's
                // semantics: Todoist's sync API is expected to emit explicit
                // per-item deletes for descendants too, but if that
                // assumption is ever violated, don't leave local children
                // orphaned with a parent_id pointing at a now-deleted row.
                let child_ids: Vec<(String,)> =
                    sqlx::query_as("SELECT id FROM local_tasks WHERE parent_id = ?")
                        .bind(&t.id)
                        .fetch_all(&mut *tx)
                        .await?;
                for (child_id,) in &child_ids {
                    sqlx::query("DELETE FROM local_tasks WHERE id = ?").bind(child_id).execute(&mut *tx).await?;
                    logged.push((child_id.clone(), "DELETE"));
                    report.deleted += 1;
                }
                sqlx::query("DELETE FROM local_tasks WHERE id = ?").bind(&t.id).execute(&mut *tx).await?;
                logged.push((t.id, "DELETE"));
                report.deleted += 1;
            }
            continue;
        }
        let remote = mappers::item_to_snapshot(item);
        match local {
            None => {
                if remote.checked { continue; } // don't resurrect completed history
                let project_local: Option<(String,)> = match &remote.project_external_id {
                    Some(ext) => sqlx::query_as("SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?")
                        .bind(ext).fetch_optional(&mut *tx).await?,
                    None => None,
                };
                let project_id = project_local.map(|(id,)| id).unwrap_or_else(|| "inbox".to_string());
                let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM local_tasks WHERE project_id = ?")
                    .bind(&project_id).fetch_one(&mut *tx).await?;
                let new_id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO local_tasks (id, content, description, project_id, priority, due_date, due_time, duration_minutes, completed, status, position, external_id, external_source, remote_updated_at, synced_snapshot)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'todo', ?, ?, 'todoist', ?, ?)",
                )
                .bind(&new_id)
                .bind(&remote.content)
                .bind(if remote.description.is_empty() { None } else { Some(remote.description.clone()) })
                .bind(&project_id)
                .bind(remote.priority)
                .bind(&remote.due_date)
                .bind(&remote.due_time)
                .bind(remote.duration_minutes)
                .bind(max.0)
                .bind(&item.id)
                .bind(&item.updated_at)
                .bind(serde_json::to_string(&remote).unwrap_or_default())
                .execute(&mut *tx)
                .await?;
                if let Some(parent_ext) = &remote.parent_external_id {
                    parent_links.push((item.id.clone(), parent_ext.clone()));
                }
                for name in &remote.labels {
                    if let Some(label_id) = label_id_by_name.get(name) {
                        sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
                            .bind(&new_id)
                            .bind(label_id)
                            .execute(&mut *tx)
                            .await?;
                        label_sync_ops.push((new_id.clone(), label_id.clone(), "INSERT"));
                    }
                }
                logged.push((new_id, "INSERT"));
                report.created += 1;
            }
            Some(local_task) => {
                let base: Option<mappers::TaskSnapshot> = local_task
                    .synced_snapshot
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());
                if base.as_ref() == Some(&remote) { continue; } // echo
                let project_ext_of_local: Option<String> = sqlx::query_as::<_, (Option<String>,)>(
                    "SELECT external_id FROM projects WHERE id = ?",
                )
                .bind(&local_task.project_id)
                .fetch_optional(&mut *tx)
                .await?
                .and_then(|(e,)| e);
                let local_label_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
                    "SELECT label_id FROM task_labels WHERE task_id = ?",
                )
                .bind(&local_task.id)
                .fetch_all(&mut *tx)
                .await?
                .into_iter()
                .map(|(id,)| id)
                .collect();
                let local_label_names: Vec<String> = local_label_ids
                    .iter()
                    .filter_map(|id| label_name_by_id.get(id).cloned())
                    .collect();
                let local_snap = mappers::local_to_snapshot(
                    &local_task,
                    project_ext_of_local,
                    None,
                    base.as_ref(),
                    local_label_names,
                );
                let plan = merge::merge_task(
                    &local_snap,
                    base.as_ref(),
                    &remote,
                    mappers::local_ts_to_utc(&local_task.updated_at),
                    item.updated_at.as_deref().and_then(mappers::rfc3339_to_utc),
                );
                if let Some(c) = &plan.content {
                    sqlx::query("UPDATE local_tasks SET content = ? WHERE id = ?").bind(c).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(d) = &plan.description {
                    sqlx::query("UPDATE local_tasks SET description = ? WHERE id = ?")
                        .bind(if d.is_empty() { None::<String> } else { Some(d.clone()) }).bind(&local_task.id).execute(&mut *tx).await?;
                }
                // Scope line (Task 9 ledger): recurrence does NOT round-trip.
                // A local `recurrence_rule` computes its own next `due_date`
                // on completion (see `update_task_status_at`'s recurrence
                // branch); Todoist's own recurring `due` object represents a
                // *different* recurrence engine's idea of the next date, so
                // letting a pulled recurring due overwrite `due_date` here
                // would fight with Nimble's own recurrence math. Guard: only
                // for tasks that already carry a local recurrence_rule AND
                // whose remote due is itself recurring.
                let skip_due_date_for_recurrence_guard = local_task.recurrence_rule.is_some()
                    && item.due.as_ref().and_then(|d| d.is_recurring).unwrap_or(false);
                if let Some(due) = &plan.due_date {
                    if !skip_due_date_for_recurrence_guard {
                        sqlx::query("UPDATE local_tasks SET due_date = ? WHERE id = ?").bind(due).bind(&local_task.id).execute(&mut *tx).await?;
                    }
                }
                if let Some(t) = &plan.due_time {
                    sqlx::query("UPDATE local_tasks SET due_time = ? WHERE id = ?").bind(t).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(d) = plan.duration_minutes {
                    sqlx::query("UPDATE local_tasks SET duration_minutes = ? WHERE id = ?").bind(d).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(p) = plan.priority {
                    sqlx::query("UPDATE local_tasks SET priority = ? WHERE id = ?").bind(p).bind(&local_task.id).execute(&mut *tx).await?;
                }
                // Labels: direct SQL against `task_labels`, never
                // `db::labels::set_task_labels` — that fires the Todoist
                // mutation observer, which would enqueue an outbox `update`
                // op and echo the labels we just pulled straight back to
                // Todoist (the same echo `apply_pull`'s doc comment already
                // guards against for every other field). Mirrors
                // `set_task_labels`'s delete-then-insert + diff-based
                // sync_log semantics minus the observer call.
                if let Some(names) = &plan.labels {
                    let target_ids: std::collections::HashSet<String> = names
                        .iter()
                        .filter_map(|n| label_id_by_name.get(n).cloned())
                        .collect();
                    let current_ids: std::collections::HashSet<String> =
                        local_label_ids.iter().cloned().collect();
                    if target_ids != current_ids {
                        sqlx::query("DELETE FROM task_labels WHERE task_id = ?")
                            .bind(&local_task.id)
                            .execute(&mut *tx)
                            .await?;
                        for id in &target_ids {
                            sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
                                .bind(&local_task.id)
                                .bind(id)
                                .execute(&mut *tx)
                                .await?;
                        }
                        for removed in current_ids.difference(&target_ids) {
                            label_sync_ops.push((local_task.id.clone(), removed.clone(), "DELETE"));
                        }
                        for added in target_ids.difference(&current_ids) {
                            label_sync_ops.push((local_task.id.clone(), added.clone(), "INSERT"));
                        }
                    }
                }
                if let Some(ext) = &plan.project_external_id {
                    let target: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?")
                        .bind(ext).fetch_optional(&mut *tx).await?;
                    if let Some((pid,)) = target {
                        sqlx::query("UPDATE local_tasks SET project_id = ? WHERE id = ?").bind(&pid).bind(&local_task.id).execute(&mut *tx).await?;
                    }
                }
                // Reparenting isn't part of MergePlan (parent linking is
                // otherwise two-pass-at-creation only) — handled here
                // directly, analogous to how project changes are applied
                // above. Only act on a genuine remote change (compare
                // against the synced_snapshot base, not the current local
                // parent_id, so a local-only reparent that hasn't pushed yet
                // isn't clobbered). If the new parent is set, defer
                // resolution to the same pass-2 mechanism used at creation
                // time — it now leaves parent_id untouched (via COALESCE)
                // rather than nulling it out if the parent can't be
                // resolved yet, so this is safe to reuse here too.
                let base_parent_ext = base.as_ref().and_then(|b| b.parent_external_id.clone());
                let parent_changed = remote.parent_external_id != base_parent_ext;
                if parent_changed {
                    match &remote.parent_external_id {
                        Some(parent_ext) => parent_links.push((item.id.clone(), parent_ext.clone())),
                        None => {
                            sqlx::query("UPDATE local_tasks SET parent_id = NULL WHERE id = ?")
                                .bind(&local_task.id)
                                .execute(&mut *tx)
                                .await?;
                        }
                    }
                }
                if let Some(completed) = plan.completed {
                    if completed {
                        sqlx::query("UPDATE local_tasks SET completed = 1, status = 'complete', completed_at = datetime('now','localtime') WHERE id = ?")
                            .bind(&local_task.id).execute(&mut *tx).await?;
                    } else {
                        sqlx::query("UPDATE local_tasks SET completed = 0, status = 'todo', completed_at = NULL WHERE id = ?")
                            .bind(&local_task.id).execute(&mut *tx).await?;
                    }
                }
                sqlx::query("UPDATE local_tasks SET synced_snapshot = ?, remote_updated_at = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                    .bind(serde_json::to_string(&remote).unwrap_or_default())
                    .bind(&item.updated_at)
                    .bind(&local_task.id)
                    .execute(&mut *tx)
                    .await?;
                if !plan.is_empty() || parent_changed {
                    logged.push((local_task.id.clone(), "UPDATE"));
                    report.updated += 1;
                }
            }
        }
    }

    // 4. items -- pass 2: resolve parents. COALESCE onto the existing
    // parent_id (rather than overwriting with NULL) so an unresolved parent
    // — either at creation (parent not in this delta at all) or on an
    // update-time reparent (new parent not found locally, e.g. parent not
    // found → leave parent unchanged per the pull's don't-error contract) —
    // never clobbers a previously-linked parent_id.
    for (child_ext, parent_ext) in parent_links {
        sqlx::query(
            "UPDATE local_tasks SET parent_id = COALESCE(
                (SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?),
                parent_id
             )
             WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&parent_ext)
        .bind(&child_ext)
        .execute(&mut *tx)
        .await?;
    }

    // 5. token -- same transaction as the applied deltas
    if let Some(token) = &resp.sync_token {
        sqlx::query("INSERT OR IGNORE INTO integration_sync_state (provider) VALUES ('todoist')")
            .execute(&mut *tx).await?;
        sqlx::query("UPDATE integration_sync_state SET sync_token = ?, last_sync_at = datetime('now','localtime'), last_error = NULL WHERE provider = 'todoist'")
            .bind(token).execute(&mut *tx).await?;
        if resp.full_sync.unwrap_or(false) {
            sqlx::query("UPDATE integration_sync_state SET last_full_sync_at = datetime('now','localtime') WHERE provider = 'todoist'")
                .execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;

    // 6. after commit: sync_log so Turso propagates (fire-and-forget, matches codebase pattern)
    for (row_id, op) in logged {
        let snapshot = if op == "DELETE" {
            None
        } else {
            match sqlx::query_as::<_, crate::types::LocalTask>(&format!(
                "SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS
            )).bind(&row_id).fetch_optional(pool).await {
                // `task_sync_snapshot` (not a plain serde_json::to_string) —
                // `LocalTask::labels` isn't a `local_tasks` column, and a
                // snapshot carrying it fails every apply with "no such
                // column: labels" (see nimble-core/src/db/sync.rs).
                Ok(Some(t)) => Some(crate::db::sync::task_sync_snapshot(&t)),
                _ => None,
            }
        };
        crate::db::sync::append_sync_log(pool, "local_tasks", &row_id, op, None, snapshot.as_deref())
            .await
            .ok();
    }

    // 7. after commit: task_labels sync_log, same fire-and-forget contract —
    // `task_labels` has no `id` column, so row_id is the composite
    // "task_id::label_id" encoding (`task_labels_row_id`), same as
    // `set_task_labels` uses for its own replication.
    for (task_id, label_id, op) in label_sync_ops {
        let snapshot = if op == "DELETE" {
            None
        } else {
            let created_at: Option<(String,)> = sqlx::query_as(
                "SELECT created_at FROM task_labels WHERE task_id = ? AND label_id = ?",
            )
            .bind(&task_id)
            .bind(&label_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            created_at.map(|(created_at,)| {
                serde_json::json!({
                    "task_id": task_id,
                    "label_id": label_id,
                    "created_at": created_at,
                })
                .to_string()
            })
        };
        crate::db::sync::append_sync_log(
            pool,
            "task_labels",
            &crate::db::sync::task_labels_row_id(&task_id, &label_id),
            op,
            None,
            snapshot.as_deref(),
        )
        .await
        .ok();
    }
    Ok(report)
}

pub async fn run_sync(pool: &SqlitePool) -> crate::Result<SyncReport> {
    let lock = SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let Ok(_guard) = lock.try_lock() else {
        return Ok(SyncReport { skipped: Some("already running".into()), ..Default::default() });
    };
    let Some(token) = crate::integrations::adapter_token_if_active(pool).await? else {
        return Ok(SyncReport { skipped: Some("disabled".into()), ..Default::default() });
    };
    outbox::prune_done(pool).await.ok();

    let result: crate::Result<SyncReport> = async {
        let pushed = push_outbox(pool, &token).await?;
        let state = crate::integrations::ensure_state(pool, "todoist").await?;
        let sync_token = state.sync_token.unwrap_or_else(|| "*".to_string());
        let resp = client::sync(&token, &serde_json::json!({
            "sync_token": sync_token,
            "resource_types": ["items", "projects", "sections", "completed_info"],
        })).await?;
        let mut report = apply_pull(pool, &resp).await?;
        report.pushed = pushed;
        Ok(report)
    }.await;

    if let Err(e) = &result {
        sqlx::query("UPDATE integration_sync_state SET last_error = ? WHERE provider = 'todoist'")
            .bind(e.to_string())
            .execute(pool)
            .await
            .ok();
    }
    result
}

pub async fn run_sync_if_due(pool: &SqlitePool, min_interval_secs: i64) -> crate::Result<SyncReport> {
    let (pending, _) = outbox::counts(pool).await?;
    if pending == 0 {
        if let Some(state) = crate::integrations::get_state(pool, "todoist").await? {
            if let Some(last) = state.last_sync_at.as_deref().and_then(mappers::local_ts_to_utc) {
                if (chrono::Utc::now() - last).num_seconds() < min_interval_secs {
                    return Ok(SyncReport { skipped: Some("recently synced".into()), ..Default::default() });
                }
            }
        }
    }
    run_sync(pool).await
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
    fn create_with_merged_labels_surfaces_labels_in_item_add() {
        // Regression: labels assigned at creation time enqueue a follow-up
        // "update" op (from `set_task_labels`) that merges into the
        // still-pending "create" row (outbox::enqueue's merge-into-pending
        // behavior) rather than staying separate — so a merged create row's
        // payload carries a top-level "labels" key that the create builder
        // must read, or labels silently never reach Todoist.
        let rows = vec![row(
            "create",
            "t1",
            json!({"content": "c", "project_local_id": "p1", "labels": ["alpha", "zeta"]}),
            Some("tmp-t1"),
        )];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[0]["type"], "item_add");
        assert_eq!(cmds[0]["args"]["labels"], json!(["alpha", "zeta"]));
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
    fn update_with_due_time_adds_datetime_to_due_args() {
        let rows = vec![row("update", "t1", json!({"due_date": "2026-08-10", "due_time": "09:30"}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["args"]["due"]["date"], "2026-08-10");
        assert_eq!(cmds[0]["args"]["due"]["datetime"], "2026-08-10T09:30:00");
    }

    #[test]
    fn update_with_duration_sends_minute_unit() {
        let rows = vec![row("update", "t1", json!({"duration_minutes": 45}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["args"]["duration"], 45);
        assert_eq!(cmds[0]["args"]["duration_unit"], "minute");
    }

    #[test]
    fn update_clearing_duration_sends_null() {
        let rows = vec![row("update", "t1", json!({"duration_minutes": null}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert!(cmds[0]["args"]["duration"].is_null());
        assert!(cmds[0]["args"]["duration_unit"].is_null());
    }

    #[test]
    fn update_with_labels_passes_names_through_untouched() {
        let rows = vec![row("update", "t1", json!({"labels": ["alpha", "zeta"]}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["args"]["labels"], json!(["alpha", "zeta"]));
    }

    #[test]
    fn create_with_due_time_and_duration_builds_full_args() {
        let rows = vec![row(
            "create",
            "t1",
            json!({
                "content": "c", "due_date": "2026-08-10", "due_time": "14:00",
                "duration_minutes": 30, "project_local_id": "p1"
            }),
            Some("tmp-t1"),
        )];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["args"]["due"]["date"], "2026-08-10");
        assert_eq!(cmds[0]["args"]["due"]["datetime"], "2026-08-10T14:00:00");
        assert_eq!(cmds[0]["args"]["duration"], 30);
        assert_eq!(cmds[0]["args"]["duration_unit"], "minute");
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

    // I3 regression: push_outbox's progress guard relies on count_resolved to
    // detect a response that resolved nothing, so it can break instead of
    // looping forever re-sending the same batch. This can't easily be
    // exercised end-to-end without a mock Todoist HTTP server (client::sync
    // hits a hardcoded URL with no test seam), so we test the pure counting
    // logic that decides the guard directly.
    #[test]
    fn count_resolved_is_zero_when_response_omits_every_uuid() {
        let sent = vec!["uuid-a", "uuid-b"];
        let sync_status: HashMap<String, serde_json::Value> = HashMap::new();
        assert_eq!(count_resolved(&sent, &sync_status), 0);
    }

    #[test]
    fn count_resolved_counts_present_uuids_regardless_of_ok_or_error() {
        let sent = vec!["uuid-a", "uuid-b", "uuid-c"];
        let mut sync_status: HashMap<String, serde_json::Value> = HashMap::new();
        sync_status.insert("uuid-a".to_string(), json!("ok"));
        sync_status.insert("uuid-b".to_string(), json!({"error": "Item not found"}));
        // uuid-c is absent — e.g. Todoist silently dropped it from the response
        assert_eq!(count_resolved(&sent, &sync_status), 2);
    }
}

#[cfg(test)]
mod pull_tests {
    use super::*;
    use crate::integrations::todoist::client::SyncResponse;
    use crate::test_util::test_pool;
    use serde_json::json;

    fn resp(v: serde_json::Value) -> SyncResponse {
        serde_json::from_value(v).unwrap()
    }

    #[tokio::test]
    async fn new_remote_item_creates_native_task() {
        let pool = test_pool().await;
        let r = resp(json!({
            "sync_token": "T1",
            "projects": [{"id": "P1", "name": "Errands"}],
            "items": [{
                "id": "R1", "content": "Buy milk", "description": "2%",
                "project_id": "P1", "priority": 2, "checked": false, "is_deleted": false,
                "updated_at": "2026-08-04T10:00:00Z",
                "due": {"date": "2026-08-06", "string": "Aug 6", "is_recurring": false}
            }]
        }));
        let report = apply_pull(&pool, &r).await.unwrap();
        assert_eq!(report.created, 1);
        assert_eq!(report.projects_upserted, 1);

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(t.content, "Buy milk");
        assert_eq!(t.due_date.as_deref(), Some("2026-08-06"));
        assert!(t.synced_snapshot.is_some());

        // project created + linked
        let projects = crate::db::projects::get_projects(&pool).await.unwrap();
        let p = projects.iter().find(|p| p.external_id.as_deref() == Some("P1")).unwrap();
        assert_eq!(t.project_id, p.id);

        // token persisted
        let state = crate::integrations::get_state(&pool, "todoist").await.unwrap().unwrap();
        assert_eq!(state.sync_token.as_deref(), Some("T1"));
    }

    #[tokio::test]
    async fn pull_creates_task_with_due_time_duration_and_labels() {
        let pool = test_pool().await;
        let r = resp(json!({
            "sync_token": "T1",
            "items": [{
                "id": "R1", "content": "Standup", "checked": false, "is_deleted": false,
                "due": {"date": "2026-08-10", "datetime": "2026-08-10T09:00:00", "string": "Aug 10", "is_recurring": false},
                "duration": {"amount": 30, "unit": "minute"},
                "labels": ["work", "urgent"]
            }]
        }));
        apply_pull(&pool, &r).await.unwrap();

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(t.due_time.as_deref(), Some("09:00"));
        assert_eq!(t.duration_minutes, Some(30));
        let names = crate::db::labels::names_for_ids(&pool, &t.labels).await.unwrap();
        assert_eq!(names, vec!["urgent".to_string(), "work".to_string()]);
    }

    #[tokio::test]
    async fn pull_applies_remote_label_change_without_echo() {
        // Echo-prevention (same invariant as `pull_apply_never_enqueues_outbox_ops`,
        // extended to labels): applying a pulled label change must go through
        // direct SQL, never `db::labels::set_task_labels` — that fires the
        // Todoist observer and would enqueue an outbox update carrying the
        // very labels we just pulled, echoing them straight back.
        let pool = test_pool().await;
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();

        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false, "labels": ["work"]}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(crate::db::labels::names_for_ids(&pool, &t.labels).await.unwrap(), vec!["work".to_string()]);

        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false, "labels": ["urgent", "work"],
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(
            crate::db::labels::names_for_ids(&pool, &t.labels).await.unwrap(),
            vec!["urgent".to_string(), "work".to_string()]
        );

        assert!(
            outbox::pending_batch(&pool, 100).await.unwrap().is_empty(),
            "label changes applied from a pull must never enqueue an outbox op"
        );
    }

    #[tokio::test]
    async fn recurring_local_task_due_date_is_not_overwritten_by_recurring_remote_due() {
        // Scope line (Task 9 ledger): recurrence does not round-trip. A task
        // with a local `recurrence_rule` manages its own `due_date` on
        // completion; a pulled recurring `due` object must not clobber it.
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "Water plants", "checked": false, "is_deleted": false,
             "due": {"date": "2026-08-04", "string": "Aug 4", "is_recurring": false}}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        sqlx::query("UPDATE local_tasks SET recurrence_rule = ? WHERE id = ?")
            .bind("every week")
            .bind(&t.id)
            .execute(&pool)
            .await
            .unwrap();

        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "Water plants", "checked": false, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z",
             "due": {"date": "2026-08-11", "string": "every week", "is_recurring": true}}
        ]}))).await.unwrap();

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(t.due_date.as_deref(), Some("2026-08-04"), "recurrence guard must keep the local due_date");
    }

    #[tokio::test]
    async fn echo_of_stored_snapshot_is_skipped() {
        let pool = test_pool().await;
        let item = json!({"id": "R1", "content": "same", "priority": 1, "checked": false, "is_deleted": false});
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [item.clone()]}))).await.unwrap();
        let second = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [item]}))).await.unwrap();
        assert_eq!(second.created, 0);
        assert_eq!(second.updated, 0);
    }

    #[tokio::test]
    async fn remote_deletion_removes_local_row() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let report = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": true}
        ]}))).await.unwrap();
        assert_eq!(report.deleted, 1);
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        assert!(!tasks.iter().any(|t| t.external_id.as_deref() == Some("R1")));
    }

    #[tokio::test]
    async fn remote_completion_completes_local_task() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": true, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert!(t.completed);
        assert_eq!(t.status, "complete");
    }

    #[tokio::test]
    async fn subtask_parent_resolved_in_second_pass() {
        let pool = test_pool().await;
        // child arrives BEFORE parent in the same delta
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "C1", "content": "child", "parent_id": "PA1", "checked": false, "is_deleted": false},
            {"id": "PA1", "content": "parent", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let parent = tasks.iter().find(|t| t.external_id.as_deref() == Some("PA1")).unwrap();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
    }

    #[tokio::test]
    async fn remote_reparent_of_already_synced_task_propagates() {
        // Review finding: reparenting a task to a different parent on
        // Todoist after its initial local sync must be applied locally, not
        // just at creation time via the two-pass linking.
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "PA1", "content": "parent A", "checked": false, "is_deleted": false},
            {"id": "PB1", "content": "parent B", "checked": false, "is_deleted": false},
            {"id": "C1", "content": "child", "parent_id": "PA1", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let parent_a = tasks.iter().find(|t| t.external_id.as_deref() == Some("PA1")).unwrap().id.clone();
        let parent_b = tasks.iter().find(|t| t.external_id.as_deref() == Some("PB1")).unwrap().id.clone();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent_a.as_str()));

        // Remote moves C1 from parent A to parent B.
        let report = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "C1", "content": "child", "parent_id": "PB1", "checked": false, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();
        assert_eq!(report.updated, 1, "reparent-only change must still count as an update");

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent_b.as_str()), "reparent must propagate locally");
    }

    #[tokio::test]
    async fn reparent_to_unresolvable_parent_leaves_parent_unchanged() {
        // Controller ruling: parent not found locally -> leave parent
        // unchanged, don't error the pull.
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "PA1", "content": "parent A", "checked": false, "is_deleted": false},
            {"id": "C1", "content": "child", "parent_id": "PA1", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let parent_a = tasks.iter().find(|t| t.external_id.as_deref() == Some("PA1")).unwrap().id.clone();

        // Remote reparents C1 to a parent Todoist id we've never seen locally.
        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "C1", "content": "child", "parent_id": "GHOST1", "checked": false, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent_a.as_str()), "unresolvable parent must not clobber the existing parent_id");
    }

    #[tokio::test]
    async fn remote_delete_of_parent_cascades_to_local_children() {
        // Review finding: a remote deletion of a parent task with local
        // children must cascade-delete them locally (mirroring
        // db::tasks::delete_local_task), rather than relying on Todoist
        // always sending explicit per-item deletes for descendants.
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "PA1", "content": "parent", "checked": false, "is_deleted": false},
            {"id": "C1", "content": "child", "parent_id": "PA1", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let parent_id = tasks.iter().find(|t| t.external_id.as_deref() == Some("PA1")).unwrap().id.clone();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent_id.as_str()));

        // Remote deletes ONLY the parent — no explicit delete entry for the child.
        let report = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "PA1", "content": "parent", "checked": false, "is_deleted": true}
        ]}))).await.unwrap();
        assert_eq!(report.deleted, 2, "parent + cascaded child");

        let tasks_after = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        assert!(!tasks_after.iter().any(|t| t.id == parent_id));
        assert!(
            !tasks_after.iter().any(|t| t.external_id.as_deref() == Some("C1")),
            "child must be cascade-deleted, not orphaned with a dangling parent_id"
        );
    }

    #[tokio::test]
    async fn mid_apply_failure_rolls_back_and_retains_old_sync_token() {
        // Review finding: no test forced a mid-apply_pull failure to prove
        // the transaction rolls back and the old sync_token is retained.
        // Uses the #[cfg(test)] failure-injection hook (see apply_pull's
        // items loop) since there's no way to trigger a genuine DB
        // constraint violation deterministically from crafted SyncResponse
        // input in this schema (no FK enforcement, no unique constraints on
        // external_id, content is a required non-nullable String).
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "OLD_TOKEN", "items": []})))
            .await
            .unwrap();

        let result = apply_pull(&pool, &resp(json!({
            "sync_token": "NEW_TOKEN_SHOULD_NOT_STICK",
            "items": [
                {"id": "R1", "content": "should not persist", "checked": false, "is_deleted": false},
                {"id": "R2", "content": "__FORCE_TEST_APPLY_FAILURE__", "checked": false, "is_deleted": false}
            ]
        }))).await;
        assert!(result.is_err(), "mid-apply failure must propagate as Err");

        // No partial writes: R1 (applied before the injected failure) must not be visible.
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        assert!(
            !tasks.iter().any(|t| t.external_id.as_deref() == Some("R1")),
            "transaction must roll back — no partial writes from the failed delta"
        );

        // sync_token must still hold the OLD value, not the failed delta's token.
        let state = crate::integrations::get_state(&pool, "todoist").await.unwrap().unwrap();
        assert_eq!(state.sync_token.as_deref(), Some("OLD_TOKEN"));
    }

    #[tokio::test]
    async fn section_delta_creates_pseudo_project() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({
            "sync_token": "T1",
            "projects": [{"id": "P1", "name": "Work"}],
            "sections": [{"id": "S1", "project_id": "P1", "name": "Soon"}]
        }))).await.unwrap();
        let projects = crate::db::projects::get_projects(&pool).await.unwrap();
        let pseudo = projects.iter().find(|p| p.external_id.as_deref() == Some("section:S1")).unwrap();
        assert_eq!(pseudo.name, "Work / Soon");
    }

    #[tokio::test]
    async fn pull_apply_never_enqueues_outbox_ops() {
        // CRITICAL echo-prevention (carried from Task 9's review): applying a
        // pulled remote change must never re-enqueue an outbox op, or a
        // create -> pull -> push -> pull cycle would loop forever. Activate
        // the adapter as production would, then run a create, an update
        // (with a completion flip), and a create+delete through apply_pull —
        // the outbox must stay empty throughout because apply_pull writes
        // with direct SQL and never calls the db::tasks/db::projects helpers
        // that fire the Todoist mutation observer.
        let pool = test_pool().await;
        crate::integrations::ensure_state(&pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok").await.unwrap();

        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        assert!(outbox::pending_batch(&pool, 100).await.unwrap().is_empty());

        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "y", "checked": true, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();
        assert!(outbox::pending_batch(&pool, 100).await.unwrap().is_empty());

        apply_pull(&pool, &resp(json!({"sync_token": "T3", "items": [
            {"id": "R2", "content": "z", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "T4", "items": [
            {"id": "R2", "content": "z", "checked": false, "is_deleted": true}
        ]}))).await.unwrap();

        assert!(
            outbox::pending_batch(&pool, 100).await.unwrap().is_empty(),
            "apply_pull must never enqueue outbox ops for remote-originated changes"
        );
    }
}
