//! One-time Todoist reconcile (`dt sync reconcile [--apply]`).
//!
//! Todoist sync failed for three weeks and the local mirror drifted: open
//! tasks finished or deleted in Todoist, tasks created there that never
//! arrived, pre-v22 fake "Parent / Section" projects (`external_id =
//! "section:{id}"`), a duplicate linked Inbox row and projects that no longer
//! exist remotely. This module plans the repair read-only (`build_plan`), then
//! applies it all-or-nothing (`apply`): one transaction for the structural
//! fix-up, then the ordinary full pull (`apply_pull`) on top of it.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use sqlx::{SqliteConnection, SqlitePool};

use super::client;
use super::sync_loop::{self, PulledRows, SyncReport};

/// A task's state in Todoist, from `GET /api/v1/tasks/{id}`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum RemoteStatus {
    /// Done in Todoist; `at` is its `completed_at` (RFC 3339) when reported.
    Completed { at: Option<String> },
    Deleted,
    /// Still open. When the full sync didn't return it, its project is
    /// archived (full sync omits archived projects' items).
    Active { project_id: String },
}

/// Classify a task body the way the probed API reports it. Deleted wins over
/// checked: a deleted task is gone whatever its last state was.
pub fn classify_task_json(v: &serde_json::Value) -> RemoteStatus {
    if v["is_deleted"].as_bool().unwrap_or(false) {
        return RemoteStatus::Deleted;
    }
    if v["checked"].as_bool().unwrap_or(false) {
        return RemoteStatus::Completed { at: v["completed_at"].as_str().map(str::to_owned) };
    }
    RemoteStatus::Active {
        project_id: v["project_id"].as_str().unwrap_or_default().to_string(),
    }
}

#[derive(Debug, Default, serde::Serialize)]
pub struct ReconcilePlan {
    /// (local fake project id, Todoist section id, tasks moved)
    pub fake_sections_converted: Vec<(String, String, usize)>,
    /// (local fake project id, name): the section is gone in Todoist; the row
    /// is archived so its (completed) history keeps a home.
    pub fake_sections_archived: Vec<(String, String)>,
    /// (duplicate linked Inbox row id, tasks moved into the native Inbox)
    pub inbox_merge: Option<(String, usize)>,
    /// (local project id, name): linked, but not an active Todoist project.
    pub projects_archived: Vec<(String, String)>,
    /// (local task id, content)
    pub to_complete: Vec<(String, String)>,
    /// Local task id -> Todoist's `completed_at` (RFC 3339), when reported.
    /// Only these completions are credited to momentum (db::karma); the rest
    /// would all land on the reconcile's own second.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub completed_at: HashMap<String, String>,
    pub to_delete: Vec<(String, String)>,
    pub kept_in_archived_project: Vec<(String, String)>,
    pub missing_to_create: usize,
    /// (local task id, detail): no remote status could be read. `--apply`
    /// refuses while any remain.
    pub lookup_errors: Vec<(String, String)>,
}

/// What `apply` did after the structural transaction committed.
#[derive(Debug, Default, serde::Serialize)]
pub struct ApplyOutcome {
    /// The full pull run on top of the reconciled structure.
    pub pull: SyncReport,
    /// Unlinked tasks newly given the `nimble` origin label.
    pub origin_labeled: usize,
}

/// Sort open linked tasks the full sync didn't return by their remote
/// status: (complete, delete, keep). Tasks without a status are left out of
/// all three; `build_plan` reports them as lookup errors. Input order is kept.
pub fn plan_stale(
    open_linked: &[(String, String, String)],
    active_ids: &HashSet<String>,
    statuses: &HashMap<String, RemoteStatus>,
) -> (Vec<(String, String)>, Vec<(String, String)>, Vec<(String, String)>) {
    let (mut complete, mut delete, mut keep) = (Vec::new(), Vec::new(), Vec::new());
    for (local_id, external_id, content) in open_linked {
        if active_ids.contains(external_id) {
            continue;
        }
        let entry = (local_id.clone(), content.clone());
        match statuses.get(external_id) {
            Some(RemoteStatus::Completed { .. }) => complete.push(entry),
            Some(RemoteStatus::Deleted) => delete.push(entry),
            Some(RemoteStatus::Active { .. }) => keep.push(entry),
            None => {}
        }
    }
    (complete, delete, keep)
}

fn active_item_ids(full: &client::SyncResponse) -> HashSet<String> {
    full.items
        .iter()
        .filter(|i| !i.checked.unwrap_or(false) && !i.is_deleted.unwrap_or(false))
        .map(|i| i.id.clone())
        .collect()
}

fn todoist_inbox_id(full: &client::SyncResponse) -> Option<&str> {
    full.projects
        .iter()
        .find(|p| p.inbox_project.unwrap_or(false) && !p.is_deleted.unwrap_or(false))
        .map(|p| p.id.as_str())
}

/// Open tasks linked to Todoist: (local id, external id, content).
async fn open_linked(pool: &SqlitePool) -> crate::Result<Vec<(String, String, String)>> {
    Ok(sqlx::query_as(
        "SELECT id, external_id, content FROM local_tasks
         WHERE external_source = 'todoist' AND external_id IS NOT NULL AND completed = 0
         ORDER BY rowid",
    )
    .fetch_all(pool)
    .await?)
}

async fn task_count(pool: &SqlitePool, project_id: &str) -> crate::Result<usize> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE project_id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await?;
    Ok(n as usize)
}

/// Read-only: what `apply` would change.
pub async fn build_plan(
    pool: &SqlitePool,
    full: &client::SyncResponse,
    statuses: &HashMap<String, RemoteStatus>,
) -> crate::Result<ReconcilePlan> {
    let mut plan = ReconcilePlan::default();
    let active_ids = active_item_ids(full);
    let active_projects: HashSet<&str> = full
        .projects
        .iter()
        .filter(|p| !p.is_deleted.unwrap_or(false) && !p.is_archived.unwrap_or(false))
        .map(|p| p.id.as_str())
        .collect();
    let active_sections: HashSet<&str> = full
        .sections
        .iter()
        .filter(|s| !s.is_deleted.unwrap_or(false))
        .map(|s| s.id.as_str())
        .collect();

    // Fake "Parent / Section" projects.
    let fakes: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, name, external_id, archived_at FROM projects
         WHERE external_source = 'todoist' AND external_id LIKE 'section:%'
         ORDER BY position, created_at",
    )
    .fetch_all(pool)
    .await?;
    for (id, name, ext, archived_at) in fakes {
        let section = ext.trim_start_matches("section:");
        if active_sections.contains(section) {
            let moved = task_count(pool, &id).await?;
            plan.fake_sections_converted.push((id, section.to_string(), moved));
        } else if archived_at.is_none() {
            plan.fake_sections_archived.push((id, name));
        }
    }

    // A second linked Inbox row next to the native `inbox`.
    if let Some(inbox_ext) = todoist_inbox_id(full) {
        let dup: Option<String> = sqlx::query_scalar(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ? AND id != 'inbox'
             ORDER BY created_at LIMIT 1",
        )
        .bind(inbox_ext)
        .fetch_optional(pool)
        .await?;
        if let Some(dup) = dup {
            let moved = task_count(pool, &dup).await?;
            plan.inbox_merge = Some((dup, moved));
        }
    }

    // Linked projects Todoist no longer has as active. Never the native Inbox.
    let linked: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT id, name, external_id FROM projects
         WHERE external_source = 'todoist' AND external_id IS NOT NULL
           AND external_id NOT LIKE 'section:%' AND archived_at IS NULL AND id != 'inbox'
         ORDER BY position, created_at",
    )
    .fetch_all(pool)
    .await?;
    let dup_id = plan.inbox_merge.as_ref().map(|(id, _)| id.clone());
    for (id, name, ext) in linked {
        if Some(&id) == dup_id.as_ref() || active_projects.contains(ext.as_str()) {
            continue;
        }
        plan.projects_archived.push((id, name));
    }

    // Open linked tasks the full sync didn't return.
    let open = open_linked(pool).await?;
    let (complete, delete, keep) = plan_stale(&open, &active_ids, statuses);
    plan.to_complete = complete;
    for (local_id, ext, _) in &open {
        if let Some(RemoteStatus::Completed { at: Some(at) }) = statuses.get(ext) {
            plan.completed_at.insert(local_id.clone(), at.clone());
        }
    }
    plan.to_delete = delete;
    plan.kept_in_archived_project = keep;
    plan.lookup_errors = open
        .iter()
        .filter(|(_, ext, _)| !active_ids.contains(ext) && !statuses.contains_key(ext))
        .map(|(id, _, content)| (id.clone(), content.clone()))
        .collect();

    // Active remote tasks with no local row: the pull creates them.
    let known: HashSet<String> = sqlx::query_scalar(
        "SELECT external_id FROM local_tasks WHERE external_source = 'todoist' AND external_id IS NOT NULL",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    plan.missing_to_create = active_ids.iter().filter(|id| !known.contains(*id)).count();
    Ok(plan)
}

/// The plan no longer matches the database (something changed between plan
/// and apply). Fails the whole transaction.
fn stale(what: String) -> crate::Error {
    crate::Error::Other(format!(
        "reconcile plan is out of date ({what}); nothing was applied. Run the dry run again."
    ))
}

fn expect_one(res: sqlx::sqlite::SqliteQueryResult, what: impl FnOnce() -> String) -> crate::Result<()> {
    if res.rows_affected() == 1 {
        Ok(())
    } else {
        Err(stale(what()))
    }
}

async fn task_ids_in(conn: &mut SqliteConnection, project_id: &str) -> crate::Result<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT id FROM local_tasks WHERE project_id = ? ORDER BY rowid")
        .bind(project_id)
        .fetch_all(&mut *conn)
        .await?)
}

/// Move every task of `from` to `to` (optionally into a section), asserting
/// the planned count, then delete the now-empty `from` row. Sections and
/// child projects under `from` follow it, so nothing is cascaded away.
async fn fold_project_tx(
    conn: &mut SqliteConnection,
    from: &str,
    to: &str,
    to_section: Option<&str>,
    planned: usize,
    rows: &mut PulledRows,
) -> crate::Result<()> {
    let ids = task_ids_in(conn, from).await?;
    let res = sqlx::query("UPDATE local_tasks SET project_id = ?, section_id = COALESCE(?, section_id) WHERE project_id = ?")
        .bind(to)
        .bind(to_section)
        .bind(from)
        .execute(&mut *conn)
        .await?;
    if res.rows_affected() as usize != planned || ids.len() != planned {
        return Err(stale(format!(
            "project {from} holds {} tasks, plan moved {planned}",
            res.rows_affected()
        )));
    }
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE project_id = ?")
        .bind(from)
        .fetch_one(&mut *conn)
        .await?;
    if remaining != 0 {
        return Err(stale(format!("project {from} still holds {remaining} tasks")));
    }
    let sections: Vec<String> = sqlx::query_scalar("SELECT id FROM sections WHERE project_id = ?")
        .bind(from)
        .fetch_all(&mut *conn)
        .await?;
    sqlx::query("UPDATE sections SET project_id = ? WHERE project_id = ?")
        .bind(to)
        .bind(from)
        .execute(&mut *conn)
        .await?;
    let children: Vec<String> = sqlx::query_scalar("SELECT id FROM projects WHERE parent_id = ?")
        .bind(from)
        .fetch_all(&mut *conn)
        .await?;
    sqlx::query("UPDATE projects SET parent_id = ? WHERE parent_id = ?")
        .bind(to)
        .bind(from)
        .execute(&mut *conn)
        .await?;
    let res = sqlx::query("DELETE FROM projects WHERE id = ?").bind(from).execute(&mut *conn).await?;
    expect_one(res, || format!("project {from} is already gone"))?;

    rows.logged.extend(ids.into_iter().map(|id| (id, "UPDATE")));
    rows.section_sync_ops.extend(
        sections
            .into_iter()
            .map(|id| (id, "UPDATE", Some(serde_json::json!(["project_id"]).to_string()))),
    );
    rows.project_sync_ops.extend(children.into_iter().map(|id| (id, "UPDATE")));
    rows.project_sync_ops.push((from.to_string(), "DELETE"));
    Ok(())
}

/// Steps 1–7 on the caller's transaction. Any error rolls all of it back.
async fn apply_structure_tx(
    conn: &mut SqliteConnection,
    full: &client::SyncResponse,
    plan: &ReconcilePlan,
) -> crate::Result<PulledRows> {
    let mut rows = PulledRows::default();

    // 0. Same guards as the preflight, now under the write lock, so a sync
    // or focus timer switched on since the preflight can't slip in.
    check_guards(&mut *conn).await?;

    // 1. Forget the incremental token: if anything after this commit fails,
    // the next sync is a full one. A missing state row is created paused
    // (the column defaults to enabled), so the reconcile never turns sync on;
    // the user does that in Settings afterwards.
    sqlx::query("INSERT OR IGNORE INTO integration_sync_state (provider, enabled) VALUES ('todoist', 0)")
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE integration_sync_state SET sync_token = NULL WHERE provider = 'todoist'")
        .execute(&mut *conn)
        .await?;

    // 2. Inbox merge first, so the structure upsert below finds the Todoist
    // inbox already on the native row.
    if let Some((dup, planned)) = &plan.inbox_merge {
        let inbox_ext = todoist_inbox_id(full)
            .ok_or_else(|| stale("the full sync has no Todoist inbox".into()))?;
        if dup == "inbox" {
            return Err(stale("the native Inbox can't be its own duplicate".into()));
        }
        fold_project_tx(conn, dup, "inbox", None, *planned, &mut rows).await?;
        let res = sqlx::query("UPDATE projects SET external_id = ?, external_source = 'todoist' WHERE id = 'inbox'")
            .bind(inbox_ext)
            .execute(&mut *conn)
            .await?;
        expect_one(res, || "the native Inbox row is missing".into())?;
        rows.project_sync_ops.push(("inbox".to_string(), "UPDATE"));
    }

    // 3. Projects (renames, nesting) and real sections, through the pull's
    // own upsert so both paths write identical rows.
    let structure = client::SyncResponse {
        sync_token: None,
        full_sync: None,
        items: Vec::new(),
        projects: full.projects.clone(),
        sections: full.sections.clone(),
        temp_id_mapping: HashMap::new(),
        sync_status: HashMap::new(),
    };
    let mut ignored = SyncReport::default();
    let upserted = sync_loop::apply_pull_tx(&mut *conn, &structure, &HashMap::new(), &HashMap::new(), &mut ignored).await?;
    rows.logged.extend(upserted.logged);
    rows.project_sync_ops.extend(upserted.project_sync_ops);
    rows.section_sync_ops.extend(upserted.section_sync_ops);

    // 4. Fake section projects whose section is live: fold into the real one.
    for (fake, section_ext, planned) in &plan.fake_sections_converted {
        let target = sync_loop::resolve_remote_ref_tx(&mut *conn, &format!("section:{section_ext}")).await?;
        let Some((project_id, Some(section_id))) = target else {
            return Err(stale(format!("section {section_ext} has no local parent project")));
        };
        if project_id == *fake {
            return Err(stale(format!("section {section_ext} resolves to its own fake project")));
        }
        fold_project_tx(conn, fake, &project_id, Some(&section_id), *planned, &mut rows).await?;
    }

    // 5 + 6. Archive fake sections Todoist deleted, and dead projects. A
    // project the payload lists as archived was already archived by step 3's
    // upsert; COALESCE keeps that stamp, and only a missing row fails.
    for (id, _) in plan.fake_sections_archived.iter().chain(&plan.projects_archived) {
        let res = sqlx::query(
            "UPDATE projects SET archived_at = COALESCE(archived_at, datetime('now','localtime')) WHERE id = ?",
        )
        .bind(id)
        .execute(&mut *conn)
        .await?;
        expect_one(res, || format!("project {id} is missing"))?;
        rows.project_sync_ops.push((id.clone(), "UPDATE"));
    }

    // 7. Tasks finished in Todoist. The base snapshot records `checked` too,
    // so a later reopen in Todoist merges as a remote change.
    for (id, _) in &plan.to_complete {
        // Todoist's own completion time (local) when it reported one.
        let done_at = plan.completed_at.get(id).and_then(|at| crate::db::karma::local_stamp(at)).map(|(_, s)| s);
        let res = sqlx::query(
            "UPDATE local_tasks SET completed = 1, status = 'complete',
                completed_at = COALESCE(?, datetime('now','localtime')), updated_at = datetime('now','localtime'),
                synced_snapshot = CASE WHEN json_valid(synced_snapshot)
                    THEN json_set(synced_snapshot, '$.checked', json('true')) ELSE synced_snapshot END
             WHERE id = ? AND completed = 0",
        )
        .bind(&done_at)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        expect_one(res, || format!("task {id} is missing or already complete"))?;
        // Momentum: only a completion Todoist dated counts; an undated one
        // would credit every stale task to the reconcile's second.
        if done_at.is_some() {
            crate::db::karma::on_completed_tx(&mut *conn, id).await?;
        }
        rows.logged.push((id.clone(), "UPDATE"));
    }

    // 8. Tasks deleted in Todoist, with their subtree (as the pull does).
    let mut deleted: HashSet<String> = HashSet::new();
    for (id, _) in &plan.to_delete {
        if deleted.contains(id) {
            continue; // already removed with an ancestor
        }
        let subtree = crate::db::task_tx::collect_subtree_tx(&mut *conn, id).await?;
        if subtree.is_empty() {
            return Err(stale(format!("task {id} is already gone")));
        }
        for task in subtree {
            sqlx::query("DELETE FROM local_tasks WHERE id = ?").bind(&task.id).execute(&mut *conn).await?;
            deleted.insert(task.id.clone());
            rows.logged.push((task.id.clone(), "DELETE"));
            rows.effects.deleted.push(task);
        }
    }

    // One sync_log row per (row, op); nothing but the DELETE for removed rows.
    let mut seen = HashSet::new();
    rows.logged.retain(|(id, op)| (*op == "DELETE" || !deleted.contains(id)) && seen.insert((id.clone(), *op)));
    // Focus effects: every surviving task this touched.
    let mut changed_seen = HashSet::new();
    for (id, op) in &rows.logged {
        if *op == "DELETE" || !changed_seen.insert(id.clone()) {
            continue;
        }
        if let Some(task) = sqlx::query_as::<_, crate::types::LocalTask>(&format!(
            "SELECT {} FROM local_tasks WHERE id = ?",
            crate::db::tasks::SELECT_COLS
        ))
        .bind(id)
        .fetch_optional(&mut *conn)
        .await?
        {
            rows.effects.changed.push(task);
        }
    }
    Ok(rows)
}

/// Apply a plan built by `build_plan` against the same `full` response.
/// Steps 1–7 run in ONE transaction: any row that no longer matches the plan
/// rolls every one of them back. After commit, the regular full pull runs on
/// top (creates missing tasks, stores the new sync token), then the `nimble`
/// origin label is backfilled. The caller takes a backup first. A failure
/// after the commit comes back as `finish_failed_message` (re-run to finish).
pub async fn apply(
    pool: &SqlitePool,
    full: &client::SyncResponse,
    plan: &ReconcilePlan,
) -> crate::Result<ApplyOutcome> {
    apply_structure(pool, full, plan).await?;
    finish_apply(pool, full).await.map_err(|e| crate::Error::Other(finish_failed_message(&e)))
}

/// What to tell the user when the structural transaction committed but the
/// final pull or label backfill didn't.
pub fn finish_failed_message(e: &crate::Error) -> String {
    format!(
        "Structure applied; the final pull failed: {e}. Run `dt sync reconcile --apply` again to finish (safe to re-run)."
    )
}

/// Steps 1–7 in one transaction, then their sync_log. On error nothing was
/// written.
pub async fn apply_structure(
    pool: &SqlitePool,
    full: &client::SyncResponse,
    plan: &ReconcilePlan,
) -> crate::Result<()> {
    let mut write = crate::db::focus::task_write::TaskWrite::begin(pool, None).await?;
    let rows = match apply_structure_tx(write.conn(), full, plan).await {
        Ok(rows) => rows,
        Err(e) => {
            if let Err(undo) = write.abandon().await {
                log::warn!("reconcile: rollback reported {undo}");
            }
            return Err(e);
        }
    };
    write.commit(&rows.effects).await?;
    let PulledRows { logged, label_sync_ops, project_sync_ops, section_sync_ops, .. } = rows;
    sync_loop::log_pulled_rows(pool, logged, label_sync_ops, project_sync_ops, section_sync_ops).await;
    Ok(())
}

/// After `apply_structure` committed: the regular full pull (creates missing
/// tasks, stores the new token), then the `nimble` origin-label backfill.
/// Idempotent, so a failure here is fixed by running the reconcile again.
pub async fn finish_apply(pool: &SqlitePool, full: &client::SyncResponse) -> crate::Result<ApplyOutcome> {
    let pull = sync_loop::apply_pull(pool, full).await?;
    let origin_labeled = crate::db::origin_label::backfill_origin_label(pool).await?;
    Ok(ApplyOutcome { pull, origin_labeled })
}

/// The Todoist token straight from settings. Sync is deliberately disabled
/// during the reconcile, so the adapter helper would report no token.
pub(crate) async fn read_token(pool: &SqlitePool) -> crate::Result<String> {
    match crate::db::settings::get_setting(pool, "todoist_api_token").await? {
        Some(t) if !t.trim().is_empty() => Ok(t.trim().to_string()),
        _ => Err(crate::Error::Other(
            "No Todoist API token is saved (settings.todoist_api_token). Nothing was fetched.".into(),
        )),
    }
}

/// Everything a reconcile needs: the full sync it was planned against, and
/// the plan.
pub struct Prepared {
    pub full: client::SyncResponse,
    pub plan: ReconcilePlan,
}

/// Fetch a full sync, look up every open linked task it didn't return
/// (sequential, 50 ms apart, one retry), and build the plan. Writes nothing.
/// `progress(done, total)` fires after each lookup.
pub async fn prepare(pool: &SqlitePool, mut progress: impl FnMut(usize, usize)) -> crate::Result<Prepared> {
    let token = read_token(pool).await?;
    let full = client::sync(
        &token,
        &serde_json::json!({"sync_token": "*", "resource_types": ["items", "projects", "sections"]}),
    )
    .await?;
    let active = active_item_ids(&full);
    let stale_open: Vec<(String, String, String)> = open_linked(pool)
        .await?
        .into_iter()
        .filter(|(_, ext, _)| !active.contains(ext))
        .collect();

    // Positive control: before trusting "deleted"/404 answers, a task the
    // full sync says is open must come back Active from the same endpoint.
    if !stale_open.is_empty() {
        let control = positive_control_id(&full).ok_or_else(|| {
            crate::Error::Other(
                "Todoist returned no open tasks, so task lookups can't be checked. Nothing was planned.".into(),
            )
        })?;
        let status = match client::get_task_status(&token, control).await {
            Ok(s) => s,
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                client::get_task_status(&token, control).await.map_err(|e| {
                    crate::Error::Other(format!(
                        "Checking a known open task ({control}) failed: {e}. Nothing was planned."
                    ))
                })?
            }
        };
        verify_positive_control(control, &status)?;
    }

    let mut statuses: HashMap<String, RemoteStatus> = HashMap::new();
    let mut failures: HashMap<String, String> = HashMap::new();
    for (i, (local_id, ext, _)) in stale_open.iter().enumerate() {
        if statuses.contains_key(ext) {
            progress(i + 1, stale_open.len());
            continue;
        }
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        let status = match client::get_task_status(&token, ext).await {
            Ok(s) => Ok(s),
            Err(_) => {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                client::get_task_status(&token, ext).await
            }
        };
        match status {
            Ok(s) => {
                statuses.insert(ext.clone(), s);
            }
            Err(e) => {
                failures.insert(local_id.clone(), e.to_string());
            }
        }
        progress(i + 1, stale_open.len());
    }

    let mut plan = build_plan(pool, &full, &statuses).await?;
    for (local_id, detail) in plan.lookup_errors.iter_mut() {
        if let Some(err) = failures.get(local_id) {
            *detail = format!("{detail} ({err})");
        }
    }
    Ok(Prepared { full, plan })
}

/// The open task used to check the lookup endpoint: the first active item.
pub fn positive_control_id(full: &client::SyncResponse) -> Option<&str> {
    full.items
        .iter()
        .find(|i| !i.checked.unwrap_or(false) && !i.is_deleted.unwrap_or(false))
        .map(|i| i.id.as_str())
}

/// A task the full sync lists as open must look up as Active; anything else
/// means the lookup (id format, endpoint) is wrong and its answers can't be
/// used to complete or delete tasks.
pub fn verify_positive_control(id: &str, status: &RemoteStatus) -> crate::Result<()> {
    match status {
        RemoteStatus::Active { .. } => Ok(()),
        other => Err(crate::Error::Other(format!(
            "Todoist reported open task {id} as {other:?}, so task lookups can't be trusted \
             (wrong id format or endpoint). Nothing was planned or applied."
        ))),
    }
}

/// `--apply` refuses a plan with unread statuses: guessing would complete or
/// keep the wrong tasks.
pub fn require_complete(plan: &ReconcilePlan) -> crate::Result<()> {
    if plan.lookup_errors.is_empty() {
        return Ok(());
    }
    let listed: Vec<String> = plan
        .lookup_errors
        .iter()
        .take(10)
        .map(|(id, detail)| format!("{id}: {detail}"))
        .collect();
    Err(crate::Error::Other(format!(
        "{} task status lookups failed, so nothing was applied. Run the dry run again. {}",
        plan.lookup_errors.len(),
        listed.join("; ")
    )))
}

/// Guards before any reconcile write: a restored profile must be activated,
/// Todoist sync must be paused (so the app's periodic sync can't interleave
/// a pull or push), and no focus timer may be running (the write happens
/// outside the app's focus service). Checked up front by `preflight_apply`
/// and again inside the apply transaction.
async fn check_guards(conn: &mut SqliteConnection) -> crate::Result<()> {
    let restored: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'restored_activation_required'")
            .fetch_optional(&mut *conn)
            .await?;
    if restored.as_deref() == Some("1") {
        return Err(crate::Error::Other(
            "This restored profile hasn't been activated yet (dt backup activate). Nothing was written.".into(),
        ));
    }
    let enabled: Option<i64> =
        sqlx::query_scalar("SELECT enabled FROM integration_sync_state WHERE provider = 'todoist'")
            .fetch_optional(&mut *conn)
            .await?;
    if enabled.unwrap_or(0) != 0 {
        return Err(crate::Error::Other(
            "Todoist sync is on. Pause it in Settings, then apply again. Nothing was written.".into(),
        ));
    }
    let running: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM focus_segments WHERE closed_at IS NULL")
        .fetch_one(&mut *conn)
        .await?;
    if running > 0 {
        return Err(crate::Error::Other(
            "A focus session is running. Stop it, then apply again. Nothing was written.".into(),
        ));
    }
    Ok(())
}

pub async fn preflight_apply(pool: &SqlitePool) -> crate::Result<()> {
    crate::db::recovery::require_activation_clear(pool).await?;
    let mut conn = pool.acquire().await?;
    check_guards(&mut conn).await
}

/// `<dir>/reconcile-<YYYYMMDD-HHMMSS>.json`
pub fn report_path(dir: &Path, at: chrono::NaiveDateTime) -> PathBuf {
    dir.join(format!("reconcile-{}.json", at.format("%Y%m%d-%H%M%S")))
}

/// Write the plan (and, once applied, the outcome) as JSON. The file holds
/// task titles, so it is created owner-only.
pub fn write_report(
    path: &Path,
    mode: &str,
    plan: &ReconcilePlan,
    applied: Option<&ApplyOutcome>,
    error: Option<&str>,
) -> crate::Result<()> {
    use std::io::Write;
    let body = serde_json::json!({
        "generated_at": chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "mode": mode,
        "plan": plan,
        "applied": applied,
        "error": error,
    });
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(serde_json::to_string_pretty(&body).unwrap_or_default().as_bytes())?;
    Ok(())
}

/// Directory holding the pool's database file (`None` for in-memory).
async fn database_dir(pool: &SqlitePool) -> crate::Result<Option<PathBuf>> {
    let rows: Vec<(i64, String, String)> = sqlx::query_as("PRAGMA database_list").fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .find(|(_, name, file)| name == "main" && !file.is_empty())
        .and_then(|(_, _, file)| PathBuf::from(file).parent().map(Path::to_path_buf)))
}

/// Fetch, look up and plan; with `apply`, also apply. The report JSON goes
/// next to the database. Takes NO backup: `dt sync reconcile --apply` backs
/// up through the running app first and then calls the pieces directly.
pub async fn run(pool: &SqlitePool, apply: bool) -> crate::Result<ReconcilePlan> {
    let Prepared { full, plan } = prepare(pool, |_, _| {}).await?;
    let report = database_dir(pool)
        .await?
        .map(|dir| report_path(&dir, chrono::Local::now().naive_local()));
    if let Some(path) = &report {
        write_report(path, if apply { "apply_planned" } else { "dry_run" }, &plan, None, None)?;
    }
    if apply {
        require_complete(&plan)?;
        preflight_apply(pool).await?;
        apply_structure(pool, &full, &plan).await?;
        match finish_apply(pool, &full).await {
            Ok(outcome) => {
                if let Some(path) = &report {
                    write_report(path, "applied", &plan, Some(&outcome), None)?;
                }
            }
            Err(e) => {
                let message = finish_failed_message(&e);
                if let Some(path) = &report {
                    write_report(path, "structure_applied_pull_failed", &plan, None, Some(&message)).ok();
                }
                return Err(crate::Error::Other(message));
            }
        }
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use serde_json::json;
    use std::collections::{HashMap, HashSet};

    #[test]
    fn stale_open_tasks_follow_remote_status() {
        let open = vec![
            ("a".into(), "RA".into(), "done there".into()),
            ("b".into(), "RB".into(), "deleted there".into()),
            ("c".into(), "RC".into(), "in archived project".into()),
            ("d".into(), "RD".into(), "still active".into()),
        ];
        let active: HashSet<String> = ["RD".to_string()].into();
        let mut st = HashMap::new();
        st.insert("RA".into(), RemoteStatus::Completed { at: None });
        st.insert("RB".into(), RemoteStatus::Deleted);
        st.insert("RC".into(), RemoteStatus::Active { project_id: "ARCH".into() });
        let (complete, delete, keep) = plan_stale(&open, &active, &st);
        assert_eq!(complete, vec![("a".into(), "done there".into())]);
        assert_eq!(delete, vec![("b".into(), "deleted there".into())]);
        assert_eq!(keep, vec![("c".into(), "in archived project".into())]);
    }

    async fn seed_legacy(pool: &SqlitePool) {
        // Legacy shape: real project P, fake section project "P / Lane" (section:S),
        // fake project for a section Todoist deleted (section:GONE) holding a completed task,
        // duplicate linked Inbox row, one stale open task.
        for q in [
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lp','Work','P','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lfs','Work / Lane','section:S','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('lgone','Work / Old','section:GONE','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('linbox','Inbox','INBOX','todoist')",
            "INSERT INTO projects (id,name,external_id,external_source) VALUES ('ldead','Dead','DEAD','todoist')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t1','in lane','lfs','R1','todoist')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source,completed,status) VALUES ('t2','old done','lgone','R2','todoist',1,'complete')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t3','inbox item','linbox','R3','todoist')",
            "INSERT INTO local_tasks (id,content,project_id) VALUES ('t4','native','inbox')",
            "INSERT INTO local_tasks (id,content,project_id,external_id,external_source) VALUES ('t5','stale','ldead','R5','todoist')",
        ] { sqlx::query(q).execute(pool).await.unwrap(); }
    }

    fn full() -> client::SyncResponse {
        serde_json::from_value(json!({
            "sync_token": "FULL", "full_sync": true,
            "projects": [{"id": "INBOX", "name": "Inbox", "inbox_project": true}, {"id": "P", "name": "Work"}],
            "sections": [{"id": "S", "project_id": "P", "name": "Lane"}],
            "items": [
                {"id": "R1", "content": "in lane", "project_id": "P", "section_id": "S", "checked": false, "is_deleted": false},
                {"id": "R3", "content": "inbox item", "project_id": "INBOX", "checked": false, "is_deleted": false},
                {"id": "R9", "content": "new since aug", "project_id": "P", "checked": false, "is_deleted": false}
            ]
        })).unwrap()
    }

    #[tokio::test]
    async fn plan_then_apply_converts_legacy_shape() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        assert_eq!(plan.fake_sections_converted.len(), 1);
        assert_eq!(plan.fake_sections_archived.len(), 1);          // Review Focus #2
        assert_eq!(plan.inbox_merge.as_ref().map(|m| m.1), Some(1)); // Review Focus #4
        assert_eq!(plan.to_complete.len(), 1);
        assert_eq!(plan.missing_to_create, 1);
        assert!(plan.projects_archived.iter().any(|(id, _)| id == "ldead"));

        // dry run wrote nothing
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE external_id LIKE 'section:%'").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 2);

        apply(&pool, &full(), &plan).await.unwrap();
        let t1: (String, Option<String>) = sqlx::query_as("SELECT project_id, section_id FROM local_tasks WHERE id='t1'").fetch_one(&pool).await.unwrap();
        assert_eq!(t1.0, "lp");
        assert!(t1.1.is_some());
        let t2_project: String = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id='t2'").fetch_one(&pool).await.unwrap();
        assert_eq!(t2_project, "lgone", "history kept under archived row");
        let gone_archived: Option<String> = sqlx::query_scalar("SELECT archived_at FROM projects WHERE id='lgone'").fetch_one(&pool).await.unwrap();
        assert!(gone_archived.is_some());
        let inbox_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE name='Inbox'").fetch_one(&pool).await.unwrap();
        assert_eq!(inbox_rows, 1);
        let t3_project: String = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id='t3'").fetch_one(&pool).await.unwrap();
        assert_eq!(t3_project, "inbox");
        let t5: i64 = sqlx::query_scalar("SELECT completed FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(t5, 1);
        let r9: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE external_id='R9'").fetch_one(&pool).await.unwrap();
        assert_eq!(r9, 1);
        let token: String = sqlx::query_scalar("SELECT sync_token FROM integration_sync_state WHERE provider='todoist'").fetch_one(&pool).await.unwrap();
        assert_eq!(token, "FULL");
        let native: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE id='t4'").fetch_one(&pool).await.unwrap();
        assert_eq!(native, 1, "native task untouched");
    }

    #[tokio::test]
    async fn apply_is_all_or_nothing() {
        // Review Focus #5: a plan that references a task deleted between plan and apply
        // must roll back every change.
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut plan = build_plan(&pool, &full(), &HashMap::new()).await.unwrap();
        plan.to_complete.push(("does-not-exist".into(), "x".into()));
        assert!(apply(&pool, &full(), &plan).await.is_err());
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE external_id LIKE 'section:%'").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 2, "nothing applied");
    }

    // ---- additional coverage beyond the brief ----

    #[tokio::test]
    async fn rollback_is_caused_by_the_stale_row_and_leaves_every_step_unapplied() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let mut plan = build_plan(&pool, &full(), &st).await.unwrap();
        assert!(plan.lookup_errors.is_empty());
        plan.to_complete.push(("does-not-exist".into(), "x".into()));
        let err = apply(&pool, &full(), &plan).await.unwrap_err().to_string();
        assert!(err.contains("does-not-exist"), "error names the stale row: {err}");
        let dup: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id='linbox'").fetch_one(&pool).await.unwrap();
        assert_eq!(dup, 1, "inbox merge rolled back");
        let t1: String = sqlx::query_scalar("SELECT project_id FROM local_tasks WHERE id='t1'").fetch_one(&pool).await.unwrap();
        assert_eq!(t1, "lfs", "task move rolled back");
        let t5: i64 = sqlx::query_scalar("SELECT completed FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(t5, 0, "completion rolled back");
        let dead: Option<String> = sqlx::query_scalar("SELECT archived_at FROM projects WHERE id='ldead'").fetch_one(&pool).await.unwrap();
        assert!(dead.is_none(), "archive rolled back");
        let sections: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sections").fetch_one(&pool).await.unwrap();
        assert_eq!(sections, 0, "section upsert rolled back");
        let r9: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE external_id='R9'").fetch_one(&pool).await.unwrap();
        assert_eq!(r9, 0, "pull never ran");
    }

    #[tokio::test]
    async fn remote_deletes_remove_the_subtree_and_everything_reaches_sync_log() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        sqlx::query("INSERT INTO local_tasks (id,content,project_id,parent_id) VALUES ('t5c','child','ldead','t5')")
            .execute(&pool).await.unwrap();
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Deleted);
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        assert_eq!(plan.to_delete, vec![("t5".to_string(), "stale".to_string())]);
        assert!(plan.to_complete.is_empty());
        let outcome = apply(&pool, &full(), &plan).await.unwrap();
        assert_eq!(outcome.pull.created, 1, "R9 created by the pull");

        let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE id IN ('t5','t5c')").fetch_one(&pool).await.unwrap();
        assert_eq!(left, 0, "subtree removed");

        async fn logged(pool: &SqlitePool, table: &str, row: &str, op: &str) -> bool {
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sync_log WHERE table_name = ? AND row_id = ? AND operation = ?",
            )
            .bind(table).bind(row).bind(op)
            .fetch_one(pool).await.unwrap() > 0
        }
        assert!(logged(&pool, "local_tasks", "t1", "UPDATE").await, "moved task");
        assert!(logged(&pool, "local_tasks", "t3", "UPDATE").await, "inbox-merged task");
        assert!(logged(&pool, "local_tasks", "t5", "DELETE").await, "deleted task");
        assert!(logged(&pool, "local_tasks", "t5c", "DELETE").await, "deleted subtask");
        assert!(logged(&pool, "projects", "lfs", "DELETE").await, "converted fake project");
        assert!(logged(&pool, "projects", "linbox", "DELETE").await, "duplicate inbox");
        assert!(logged(&pool, "projects", "inbox", "UPDATE").await, "relinked inbox");
        assert!(logged(&pool, "projects", "lgone", "UPDATE").await, "archived fake");
        assert!(logged(&pool, "projects", "ldead", "UPDATE").await, "archived dead project");
        let section_id: String = sqlx::query_scalar("SELECT id FROM sections WHERE external_id='S'").fetch_one(&pool).await.unwrap();
        assert!(logged(&pool, "sections", &section_id, "INSERT").await, "section");
    }

    #[tokio::test]
    async fn completing_records_the_remote_checked_state_in_the_base_snapshot() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        sqlx::query("UPDATE local_tasks SET synced_snapshot = ? WHERE id = 't5'")
            .bind(json!({"content": "stale", "project_external_id": "DEAD", "checked": false}).to_string())
            .execute(&pool).await.unwrap();
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        apply(&pool, &full(), &plan).await.unwrap();
        let snap: String = sqlx::query_scalar("SELECT synced_snapshot FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        let snap: crate::integrations::todoist::mappers::TaskSnapshot = serde_json::from_str(&snap).unwrap();
        assert!(snap.checked, "base now matches Todoist, so a later reopen there merges cleanly");
        let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(status, "complete");
    }

    #[tokio::test]
    async fn a_reconciled_completion_counts_once_dated_by_todoist() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: Some("2026-09-01T17:00:00Z".into()) });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        apply(&pool, &full(), &plan).await.unwrap();
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT id, date FROM karma_events WHERE task_id = 't5'")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(rows.len(), 1, "{rows:?}");
        let (day, at) = crate::db::karma::local_stamp("2026-09-01T17:00:00Z").unwrap();
        assert_eq!(rows[0], (format!("task:t5:{at}"), crate::db::karma::day(day)), "when it was done in Todoist, not the reconcile");
    }

    #[tokio::test]
    async fn a_reconciled_completion_without_todoist_s_date_is_not_credited() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        apply(&pool, &full(), &plan).await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM karma_events").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "a bulk reconcile stamp is not a day's work");
        let status: String = sqlx::query_scalar("SELECT status FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(status, "complete");
    }

    #[tokio::test]
    async fn missing_statuses_are_lookup_errors_not_kept_tasks() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let plan = build_plan(&pool, &full(), &HashMap::new()).await.unwrap();
        assert_eq!(plan.lookup_errors, vec![("t5".to_string(), "stale".to_string())]);
        assert!(plan.kept_in_archived_project.is_empty());
        assert!(plan.to_complete.is_empty() && plan.to_delete.is_empty());
    }

    #[tokio::test]
    async fn second_plan_after_apply_is_empty() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        apply(&pool, &full(), &plan).await.unwrap();
        let again = build_plan(&pool, &full(), &st).await.unwrap();
        assert!(again.fake_sections_converted.is_empty());
        assert!(again.fake_sections_archived.is_empty(), "already archived");
        assert!(again.inbox_merge.is_none());
        assert!(again.projects_archived.is_empty(), "already archived");
        assert!(again.to_complete.is_empty());
        assert_eq!(again.missing_to_create, 0);
    }

    #[tokio::test]
    async fn apply_preflight_refuses_while_todoist_sync_is_on() {
        let pool = test_pool().await;
        preflight_apply(&pool).await.unwrap();
        sqlx::query("INSERT INTO integration_sync_state (provider, enabled) VALUES ('todoist', 1)")
            .execute(&pool).await.unwrap();
        let err = preflight_apply(&pool).await.unwrap_err().to_string();
        assert!(err.contains("Pause it"), "{err}");
        sqlx::query("UPDATE integration_sync_state SET enabled = 0 WHERE provider = 'todoist'")
            .execute(&pool).await.unwrap();
        preflight_apply(&pool).await.unwrap();
    }

    // ---- review fixes ----

    fn full_with(extra_projects: serde_json::Value, extra_items: serde_json::Value) -> client::SyncResponse {
        let mut v = json!({
            "sync_token": "FULL", "full_sync": true,
            "projects": [{"id": "INBOX", "name": "Inbox", "inbox_project": true}, {"id": "P", "name": "Work"}],
            "sections": [{"id": "S", "project_id": "P", "name": "Lane"}],
            "items": [
                {"id": "R1", "content": "in lane", "project_id": "P", "section_id": "S", "checked": false, "is_deleted": false},
                {"id": "R3", "content": "inbox item", "project_id": "INBOX", "checked": false, "is_deleted": false},
                {"id": "R9", "content": "new since aug", "project_id": "P", "checked": false, "is_deleted": false}
            ]
        });
        v["projects"].as_array_mut().unwrap().extend(extra_projects.as_array().unwrap().iter().cloned());
        v["items"].as_array_mut().unwrap().extend(extra_items.as_array().unwrap().iter().cloned());
        serde_json::from_value(v).unwrap()
    }

    #[tokio::test]
    async fn project_listed_as_archived_in_the_payload_applies_without_rollback() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let payload = full_with(json!([{"id": "DEAD", "name": "Dead", "is_archived": true}]), json!([]));
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &payload, &st).await.unwrap();
        assert!(plan.projects_archived.iter().any(|(id, _)| id == "ldead"));
        apply(&pool, &payload, &plan).await.unwrap();
        let archived: Option<String> = sqlx::query_scalar("SELECT archived_at FROM projects WHERE id='ldead'").fetch_one(&pool).await.unwrap();
        assert!(archived.is_some());
        let t5: i64 = sqlx::query_scalar("SELECT completed FROM local_tasks WHERE id='t5'").fetch_one(&pool).await.unwrap();
        assert_eq!(t5, 1, "the rest of the plan applied");
    }

    #[tokio::test]
    async fn archiving_a_missing_project_still_fails() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut plan = build_plan(&pool, &full(), &HashMap::new()).await.unwrap();
        plan.lookup_errors.clear();
        plan.projects_archived.push(("no-such-project".into(), "x".into()));
        let err = apply(&pool, &full(), &plan).await.unwrap_err().to_string();
        assert!(err.contains("no-such-project"), "{err}");
    }

    #[tokio::test]
    async fn failed_final_pull_says_structure_applied_and_a_rerun_finishes() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let bad = full_with(json!([]), json!([{"id": "RX", "content": "__FORCE_TEST_APPLY_FAILURE__", "project_id": "P", "checked": false, "is_deleted": false}]));
        let plan = build_plan(&pool, &bad, &st).await.unwrap();
        let err = apply(&pool, &bad, &plan).await.unwrap_err().to_string();
        assert!(err.contains("Structure applied; the final pull failed"), "{err}");
        assert!(err.contains("safe to re-run"), "{err}");
        let fakes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id='lfs'").fetch_one(&pool).await.unwrap();
        assert_eq!(fakes, 0, "structure stayed committed");
        let token: Option<String> = sqlx::query_scalar("SELECT sync_token FROM integration_sync_state WHERE provider='todoist'").fetch_optional(&pool).await.unwrap().flatten();
        assert!(token.is_none(), "next sync would be a full one");

        // Re-run against a good payload finishes the job.
        let again = build_plan(&pool, &full(), &st).await.unwrap();
        assert!(again.fake_sections_converted.is_empty() && again.inbox_merge.is_none() && again.to_complete.is_empty());
        apply(&pool, &full(), &again).await.unwrap();
        let r9: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks WHERE external_id='R9'").fetch_one(&pool).await.unwrap();
        assert_eq!(r9, 1);
    }

    #[tokio::test]
    async fn reapplying_after_a_completed_apply_is_a_clean_no_op() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        apply(&pool, &full(), &plan).await.unwrap();
        let again = build_plan(&pool, &full(), &st).await.unwrap();
        assert!(again.lookup_errors.is_empty());
        let outcome = apply(&pool, &full(), &again).await.unwrap();
        assert_eq!(outcome.pull.created, 0);
        let tasks: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks").fetch_one(&pool).await.unwrap();
        assert_eq!(tasks, 6, "t1..t5 plus R9, nothing duplicated");
        let enabled: i64 = sqlx::query_scalar("SELECT enabled FROM integration_sync_state WHERE provider='todoist'").fetch_one(&pool).await.unwrap();
        assert_eq!(enabled, 0, "the reconcile never switches sync on");
    }

    #[test]
    fn positive_control_requires_an_active_answer() {
        assert!(verify_positive_control("A", &RemoteStatus::Active { project_id: "P".into() }).is_ok());
        for wrong in [RemoteStatus::Deleted, RemoteStatus::Completed { at: None }] {
            let err = verify_positive_control("A", &wrong).unwrap_err().to_string();
            assert!(err.contains("can't be trusted"), "{err}");
        }
    }

    #[test]
    fn positive_control_picks_an_active_item_only() {
        let resp: client::SyncResponse = serde_json::from_value(json!({
            "items": [
                {"id": "C", "content": "c", "checked": true},
                {"id": "D", "content": "d", "is_deleted": true},
                {"id": "A", "content": "a", "checked": false, "is_deleted": false}
            ]
        })).unwrap();
        assert_eq!(positive_control_id(&resp), Some("A"));
        let none: client::SyncResponse = serde_json::from_value(json!({"items": []})).unwrap();
        assert_eq!(positive_control_id(&none), None);
    }

    #[tokio::test]
    async fn guards_are_rechecked_inside_the_transaction() {
        let pool = test_pool().await;
        seed_legacy(&pool).await;
        let mut st = HashMap::new();
        st.insert("R5".to_string(), RemoteStatus::Completed { at: None });
        let plan = build_plan(&pool, &full(), &st).await.unwrap();
        preflight_apply(&pool).await.unwrap();
        // Sync switched on between preflight and apply.
        sqlx::query("INSERT INTO integration_sync_state (provider, enabled) VALUES ('todoist', 1)")
            .execute(&pool).await.unwrap();
        let err = apply(&pool, &full(), &plan).await.unwrap_err().to_string();
        assert!(err.contains("Todoist sync is on"), "{err}");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE external_id LIKE 'section:%'").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 2, "nothing applied");
    }

    #[test]
    fn task_json_classifies_like_the_probed_api() {
        assert_eq!(classify_task_json(&json!({"checked": true, "is_deleted": false, "project_id": "P"})), RemoteStatus::Completed { at: None });
        assert_eq!(classify_task_json(&json!({"checked": true, "is_deleted": false, "completed_at": "2026-09-01T17:00:00Z"})),
            RemoteStatus::Completed { at: Some("2026-09-01T17:00:00Z".into()) });
        assert_eq!(classify_task_json(&json!({"checked": false, "is_deleted": true, "project_id": "P"})), RemoteStatus::Deleted);
        assert_eq!(classify_task_json(&json!({"checked": true, "is_deleted": true})), RemoteStatus::Deleted);
        assert_eq!(
            classify_task_json(&json!({"checked": false, "is_deleted": false, "project_id": "ARCH"})),
            RemoteStatus::Active { project_id: "ARCH".into() }
        );
    }

    #[test]
    fn report_file_name_is_timestamped_in_the_given_dir() {
        let dir = std::path::Path::new("/some/data");
        let at = chrono::NaiveDate::from_ymd_opt(2026, 9, 23).unwrap().and_hms_opt(14, 5, 9).unwrap();
        assert_eq!(report_path(dir, at), dir.join("reconcile-20260923-140509.json"));
    }
}
