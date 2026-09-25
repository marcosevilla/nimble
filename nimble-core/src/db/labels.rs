use std::collections::HashSet;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::db::tasks::SELECT_COLS;
use crate::types::{Label, LabelGroup, LabelGroupPatch, LocalTask};

pub(crate) const LABEL_COLS: &str = "id, name, color, position, created_at, \"group\", archived_at";

const GROUP_COLS: &str = "id, name, position, exclusive, system, created_at, updated_at";

fn not_found(kind: &str, id: &str) -> crate::Error {
    crate::Error::Other(format!("no such {kind} '{id}'"))
}

pub async fn get_label(pool: &SqlitePool, id: &str) -> crate::Result<Label> {
    sqlx::query_as::<_, Label>(&format!("SELECT {LABEL_COLS} FROM labels WHERE id = ?"))
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| not_found("label", id))
}

async fn get_group(pool: &SqlitePool, id: &str) -> crate::Result<LabelGroup> {
    sqlx::query_as::<_, LabelGroup>(&format!("SELECT {GROUP_COLS} FROM label_groups WHERE id = ?"))
        .bind(id).fetch_optional(pool).await?
        .ok_or_else(|| not_found("label group", id))
}

/// Best-effort like every other sync_log append: the row is already written.
async fn log_group(pool: &SqlitePool, group: &LabelGroup, operation: &str, changed: Option<&[&str]>) {
    let snapshot = serde_json::to_string(group).unwrap_or_default();
    let changed = changed.map(|c| serde_json::json!(c).to_string());
    if let Err(e) = sync::append_sync_log(pool, "label_groups", &group.id, operation, changed.as_deref(), Some(&snapshot)).await {
        log::warn!("label_groups sync_log append failed for {}: {e}", group.id);
    }
}

async fn log_label(pool: &SqlitePool, label: &Label, changed: &[&str]) {
    let snapshot = serde_json::to_string(label).unwrap_or_default();
    let changed = serde_json::json!(changed).to_string();
    if let Err(e) = sync::append_sync_log(pool, "labels", &label.id, "UPDATE", Some(&changed), Some(&snapshot)).await {
        log::warn!("labels sync_log append failed for {}: {e}", label.id);
    }
}

fn clean_group_name(name: &str) -> crate::Result<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(crate::Error::Other("label group name must not be empty".into()));
    }
    Ok(trimmed.to_string())
}

async fn group_name_taken(pool: &SqlitePool, name: &str, except: Option<&str>) -> crate::Result<bool> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM label_groups WHERE name = ? COLLATE NOCASE AND id != COALESCE(?, '')")
        .bind(name).bind(except).fetch_one(pool).await?;
    Ok(n > 0)
}

pub async fn list_label_groups(pool: &SqlitePool) -> crate::Result<Vec<LabelGroup>> {
    Ok(sqlx::query_as::<_, LabelGroup>(&format!("SELECT {GROUP_COLS} FROM label_groups ORDER BY position, created_at"))
        .fetch_all(pool).await?)
}

pub async fn create_label_group(pool: &SqlitePool, name: &str, exclusive: bool) -> crate::Result<LabelGroup> {
    let name = clean_group_name(name)?;
    if group_name_taken(pool, &name, None).await? {
        return Err(crate::Error::Other(format!("a label group named '{name}' already exists")));
    }
    let id = Uuid::new_v4().to_string();
    let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) + 1 FROM label_groups")
        .fetch_one(pool).await?;
    sqlx::query("INSERT INTO label_groups (id, name, position, exclusive, system, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 0, datetime('now','localtime'), datetime('now','localtime'))")
        .bind(&id).bind(&name).bind(position).bind(exclusive).execute(pool).await?;
    let group = get_group(pool, &id).await?;
    log_group(pool, &group, "INSERT", None).await;
    Ok(group)
}

pub async fn update_label_group(pool: &SqlitePool, id: &str, patch: LabelGroupPatch) -> crate::Result<LabelGroup> {
    let current = get_group(pool, id).await?;
    let mut changed: Vec<&str> = Vec::new();
    let name = match patch.name {
        Some(raw) => {
            let name = clean_group_name(&raw)?;
            if name != current.name {
                if group_name_taken(pool, &name, Some(id)).await? {
                    return Err(crate::Error::Other(format!("a label group named '{name}' already exists")));
                }
                changed.push("name");
            }
            name
        }
        None => current.name.clone(),
    };
    let exclusive = patch.exclusive.unwrap_or(current.exclusive);
    if exclusive != current.exclusive { changed.push("exclusive"); }
    let system = patch.system.unwrap_or(current.system);
    if system != current.system { changed.push("system"); }
    let position = patch.position.unwrap_or(current.position);
    if position != current.position { changed.push("position"); }
    if changed.is_empty() {
        return Ok(current);
    }
    sqlx::query("UPDATE label_groups SET name = ?, exclusive = ?, system = ?, position = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .bind(&name).bind(exclusive).bind(system).bind(position).bind(id).execute(pool).await?;
    changed.push("updated_at");
    let group = get_group(pool, id).await?;
    log_group(pool, &group, "UPDATE", Some(changed.as_slice())).await;
    Ok(group)
}

/// Deletes the group and ungroups its labels in one transaction. Returns the
/// ungrouped label ids (their `labels` UPDATEs replicate after commit).
pub async fn delete_label_group(pool: &SqlitePool, id: &str) -> crate::Result<Vec<String>> {
    get_group(pool, id).await?;
    let mut tx = pool.begin().await?;
    let members: Vec<String> = sqlx::query_scalar("SELECT id FROM labels WHERE \"group\" = ? ORDER BY position, created_at")
        .bind(id).fetch_all(&mut *tx).await?;
    sqlx::query("UPDATE labels SET \"group\" = NULL WHERE \"group\" = ?").bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM label_groups WHERE id = ?").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    for member in &members {
        if let Ok(label) = get_label(pool, member).await {
            log_label(pool, &label, &["group"]).await;
        }
    }
    if let Err(e) = sync::append_sync_log(pool, "label_groups", id, "DELETE", None, None).await {
        log::warn!("label_groups sync_log DELETE failed for {id}: {e}");
    }
    Ok(members)
}

pub async fn reorder_label_groups(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    let mut tx = pool.begin().await?;
    for (index, id) in ids.iter().enumerate() {
        let done = sqlx::query("UPDATE label_groups SET position = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(index as i64).bind(id).execute(&mut *tx).await?;
        if done.rows_affected() == 0 {
            return Err(not_found("label group", id));
        }
    }
    tx.commit().await?;
    for id in ids {
        if let Ok(group) = get_group(pool, id).await {
            log_group(pool, &group, "UPDATE", Some(&["position", "updated_at"][..])).await;
        }
    }
    Ok(())
}

/// Move a label into a group (or out of every group with `None`).
pub async fn set_label_group(pool: &SqlitePool, id: &str, group: Option<&str>) -> crate::Result<Label> {
    let current = get_label(pool, id).await?;
    if let Some(group_id) = group {
        get_group(pool, group_id).await?;
    }
    // Unchanged: no write, no sync_log row (keeps seed re-runs quiet).
    if current.group.as_deref() == group {
        return Ok(current);
    }
    sqlx::query("UPDATE labels SET \"group\" = ? WHERE id = ?").bind(group).bind(id).execute(pool).await?;
    let label = get_label(pool, id).await?;
    log_label(pool, &label, &["group"]).await;
    Ok(label)
}

pub async fn reorder_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    let mut tx = pool.begin().await?;
    for (index, id) in ids.iter().enumerate() {
        let done = sqlx::query("UPDATE labels SET position = ? WHERE id = ?")
            .bind(index as i64).bind(id).execute(&mut *tx).await?;
        if done.rows_affected() == 0 {
            return Err(not_found("label", id));
        }
    }
    tx.commit().await?;
    for id in ids {
        if let Ok(label) = get_label(pool, id).await {
            log_label(pool, &label, &["position"]).await;
        }
    }
    Ok(())
}

/// `archived = true` archives, `false` restores. Validates every id first;
/// returns only the labels whose state this call changed, so an Undo can
/// reverse exactly this call.
async fn set_archived(pool: &SqlitePool, ids: &[String], archived: bool) -> crate::Result<Vec<Label>> {
    for id in ids {
        get_label(pool, id).await?;
    }
    let sql = if archived {
        "UPDATE labels SET archived_at = datetime('now','localtime') WHERE id = ? AND archived_at IS NULL"
    } else {
        "UPDATE labels SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL"
    };
    let mut tx = pool.begin().await?;
    let mut changed_ids = Vec::new();
    for id in ids {
        if sqlx::query(sql).bind(id).execute(&mut *tx).await?.rows_affected() == 1 {
            changed_ids.push(id.clone());
        }
    }
    tx.commit().await?;
    let mut changed = Vec::with_capacity(changed_ids.len());
    for id in &changed_ids {
        let label = get_label(pool, id).await?;
        log_label(pool, &label, &["archived_at"]).await;
        changed.push(label);
    }
    Ok(changed)
}

pub async fn archive_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<Vec<Label>> {
    set_archived(pool, ids, true).await
}

pub async fn restore_labels(pool: &SqlitePool, ids: &[String]) -> crate::Result<Vec<Label>> {
    set_archived(pool, ids, false).await
}

/// Candidates for "Archive unused": not archived, **ungrouped** (no group, or
/// a dangling group id — which reads as ungrouped), and on no task whose
/// status is not `complete`. Grouped labels are never auto-archived, and a
/// system label is always grouped, so it is never listed (Marco, 2026-09-25).
pub async fn unused_label_ids(pool: &SqlitePool) -> crate::Result<Vec<String>> {
    Ok(sqlx::query_scalar(
        "SELECT l.id FROM labels l
         LEFT JOIN label_groups g ON g.id = l.\"group\"
         WHERE l.archived_at IS NULL
           AND g.id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM task_labels tl JOIN local_tasks t ON t.id = tl.task_id
             WHERE tl.label_id = l.id AND t.status != 'complete')
         ORDER BY l.position, l.created_at",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_labels(pool: &SqlitePool) -> crate::Result<Vec<Label>> {
    let rows: Vec<Label> = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels ORDER BY position, created_at",
        LABEL_COLS
    ))
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn create_label(pool: &SqlitePool, name: &str, color: &str) -> crate::Result<Label> {
    let id = Uuid::new_v4().to_string();

    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM labels")
        .fetch_one(pool)
        .await?;
    let position = max_pos + 1;

    sqlx::query("INSERT INTO labels (id, name, color, position) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(color)
        .bind(position)
        .execute(pool)
        .await?;

    let label: Label = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels WHERE id = ?",
        LABEL_COLS
    ))
    .bind(&id)
    .fetch_one(pool)
    .await?;

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&label).unwrap_or_default();
    sync::append_sync_log(pool, "labels", &label.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(label)
}

pub async fn update_label(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> crate::Result<Label> {
    let mut fields_changed = Vec::new();
    if let Some(name) = name {
        sqlx::query("UPDATE labels SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("name");
    }
    if let Some(color) = color {
        sqlx::query("UPDATE labels SET color = ? WHERE id = ?")
            .bind(color)
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("color");
    }

    let label: Label = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels WHERE id = ?",
        LABEL_COLS
    ))
    .bind(id)
    .fetch_one(pool)
    .await?;

    // Sync log: UPDATE with changed columns
    if !fields_changed.is_empty() {
        let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
        let snapshot = serde_json::to_string(&label).unwrap_or_default();
        sync::append_sync_log(pool, "labels", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    Ok(label)
}

/// Also deletes the label's `task_labels` rows so no task keeps a dangling
/// reference to a label that no longer exists. Fires a `sync_log` DELETE for
/// the `labels` row itself, plus one per detached `task_labels` row (using
/// `sync::task_labels_row_id`'s composite encoding — that table has no `id`
/// column) so both halves of the deletion replicate.
pub async fn delete_label(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    let detached_task_ids: Vec<(String,)> =
        sqlx::query_as("SELECT task_id FROM task_labels WHERE label_id = ?")
            .bind(id)
            .fetch_all(pool)
            .await?;

    sqlx::query("DELETE FROM task_labels WHERE label_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM labels WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    for (task_id,) in &detached_task_ids {
        sync::append_sync_log(
            pool,
            "task_labels",
            &sync::task_labels_row_id(task_id, id),
            "DELETE",
            None,
            None,
        )
        .await
        .ok();
    }

    sync::append_sync_log(pool, "labels", id, "DELETE", None, None).await.ok();

    Ok(())
}

/// Idempotent, case-insensitive on `name` — used by Todoist sync and the
/// one-time importer so re-running either never creates duplicate labels.
///
/// The check (does a case-insensitive match already exist?) and the insert
/// are combined into a single `INSERT ... WHERE NOT EXISTS` statement inside
/// a transaction, rather than a SELECT followed by a separate INSERT — two
/// concurrent callers (the sync loop and the importer can both call this)
/// racing a plain SELECT-then-INSERT could each see "no match" and both
/// insert, defeating idempotency, since `labels.name`'s UNIQUE constraint is
/// case-sensitive and won't catch a differently-cased duplicate. SQLite
/// serializes writers, so the second transaction's `WHERE NOT EXISTS` check
/// only runs after the first has committed (or not run at all yet), making
/// this atomic.
pub async fn get_or_create_label_by_name(pool: &SqlitePool, name: &str) -> crate::Result<Label> {
    let mut tx = pool.begin().await?;

    let id = Uuid::new_v4().to_string();
    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM labels")
        .fetch_one(&mut *tx)
        .await?;

    let insert_result = sqlx::query(
        "INSERT INTO labels (id, name, color, position)
         SELECT ?, ?, 'gray', ?
         WHERE NOT EXISTS (SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE)",
    )
    .bind(&id)
    .bind(name)
    .bind(max_pos + 1)
    .bind(name)
    .execute(&mut *tx)
    .await?;
    // Only a genuine INSERT needs a sync_log entry — a no-op (existing
    // case-different match) has no new row to replicate.
    let inserted = insert_result.rows_affected() > 0;

    // Re-select rather than trust `id`: if the INSERT no-opped because a
    // case-insensitive match already existed, this returns that row instead.
    let label: Label = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels WHERE name = ? COLLATE NOCASE",
        LABEL_COLS
    ))
    .bind(name)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    if inserted {
        let snapshot = serde_json::to_string(&label).unwrap_or_default();
        sync::append_sync_log(pool, "labels", &label.id, "INSERT", None, Some(&snapshot)).await.ok();
    }

    Ok(label)
}

/// Resolves label ids to their current names, sorted. Used to translate
/// Nimble-local label ids (`LocalTask::labels`) into the Todoist-facing
/// names that `TaskSnapshot::labels` and Todoist's `item_update`/`item_add`
/// `labels` arg both compare/carry by — label ids never round-trip to
/// Todoist. Unknown/stale ids are silently dropped rather than erroring.
pub async fn names_for_ids(pool: &SqlitePool, ids: &[String]) -> crate::Result<Vec<String>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(", ");
    let query = format!("SELECT name FROM labels WHERE id IN ({placeholders})");
    let mut q = sqlx::query_as::<_, (String,)>(&query);
    for id in ids {
        q = q.bind(id);
    }
    let mut names: Vec<String> = q.fetch_all(pool).await?.into_iter().map(|(n,)| n).collect();
    names.sort();
    Ok(names)
}

pub async fn labels_for_task(pool: &SqlitePool, task_id: &str) -> crate::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT label_id FROM task_labels WHERE task_id = ? ORDER BY rowid",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(label_id,)| label_id).collect())
}

/// Replaces the task's full label set (delete-then-insert, not append).
/// Fires `sync_log` + the Todoist outbox observer with `fields_changed = ["labels"]`,
/// mirroring `db::tasks::update_local_task`'s UPDATE mechanism so the change
/// replicates the same way any other task field edit does.
///
/// The delete+insert (plus the existence checks below) run inside one
/// transaction: `task_labels` has no foreign keys (v19 migration), so
/// nothing at the SQLite layer stops a phantom `task_id`/`label_id` from
/// being written, and without a transaction a mid-sequence failure (a
/// dropped connection, a bad id) would leave the task with a
/// partially-applied label set that never reaches `append_sync_log`/the
/// observer — local state silently diverged from what syncs.
pub async fn set_task_labels(
    pool: &SqlitePool,
    task_id: &str,
    label_ids: &[String],
) -> crate::Result<LocalTask> {
    // De-dup while preserving first-seen order, so a repeated id in the
    // input can't matter either way — `INSERT OR IGNORE` below is a second,
    // belt-and-suspenders guard against the same thing hitting the
    // composite PK and aborting the transaction.
    let mut seen = HashSet::new();
    let mut unique_ids: Vec<&String> = Vec::with_capacity(label_ids.len());
    for id in label_ids {
        if seen.insert(id.as_str()) {
            unique_ids.push(id);
        }
    }

    let mut tx = pool.begin().await?;

    let task_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM local_tasks WHERE id = ?")
        .bind(task_id)
        .fetch_optional(&mut *tx)
        .await?;
    if task_exists.is_none() {
        return Err(crate::Error::Other(format!("set_task_labels: no such task '{task_id}'")));
    }

    // Capture the pre-mutation assignment set so removed ids can get their
    // own `task_labels` sync_log DELETE after commit (see below) — the
    // `local_tasks` UPDATE this function already fires signals "this task's
    // labels changed" for the UI/observer, but never touches the
    // `task_labels` table itself, so removed rows would otherwise never
    // replicate to other devices.
    let old_label_ids: Vec<String> = sqlx::query_as::<_, (String,)>(
        "SELECT label_id FROM task_labels WHERE task_id = ?",
    )
    .bind(task_id)
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|(label_id,)| label_id)
    .collect();

    if !unique_ids.is_empty() {
        let placeholders = vec!["?"; unique_ids.len()].join(", ");
        let query = format!("SELECT id FROM labels WHERE id IN ({placeholders})");
        let mut q = sqlx::query_as::<_, (String,)>(&query);
        for id in &unique_ids {
            q = q.bind(id.as_str());
        }
        let found: HashSet<String> = q
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .map(|(id,)| id)
            .collect();
        let missing: Vec<&str> = unique_ids
            .iter()
            .map(|id| id.as_str())
            .filter(|id| !found.contains(*id))
            .collect();
        if !missing.is_empty() {
            return Err(crate::Error::Other(format!(
                "set_task_labels: unknown label id(s): {}",
                missing.join(", ")
            )));
        }
    }

    sqlx::query("DELETE FROM task_labels WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    for label_id in &unique_ids {
        sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(label_id.as_str())
            .execute(&mut *tx)
            .await?;
    }

    let mut task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!(
        "SELECT {} FROM local_tasks WHERE id = ?",
        SELECT_COLS
    ))
    .bind(task_id)
    .fetch_one(&mut *tx)
    .await?;

    // (label_id, created_at) for every row in the now-current assignment set —
    // used both to populate `task.labels` and, after commit, to build each
    // `task_labels` row's own sync_log snapshot.
    let label_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT label_id, created_at FROM task_labels WHERE task_id = ? ORDER BY rowid",
    )
    .bind(task_id)
    .fetch_all(&mut *tx)
    .await?;
    task.labels = label_rows.iter().map(|(label_id, _)| label_id.clone()).collect();

    tx.commit().await?;

    // Sync log: UPDATE — same shape as db::tasks::update_local_task's fields_changed path.
    // Runs after the transaction commits, so it only ever observes a fully-applied change.
    let changed = serde_json::json!(["labels"]).to_string();
    let snapshot = sync::task_sync_snapshot(&task);
    sync::append_sync_log(pool, "local_tasks", task_id, "UPDATE", Some(&changed), Some(&snapshot))
        .await
        .ok();

    // Sync log: the `local_tasks` UPDATE above signals the change to the UI/
    // Todoist observer, but it never touches the `task_labels` table itself —
    // the assignment rows need their own entries to actually replicate to
    // other devices. `task_labels` has no `id` column, so each entry's
    // row_id is the composite "task_id::label_id" encoding.
    let new_label_ids: HashSet<&str> = label_rows.iter().map(|(id, _)| id.as_str()).collect();
    for old_label_id in &old_label_ids {
        if !new_label_ids.contains(old_label_id.as_str()) {
            sync::append_sync_log(
                pool,
                "task_labels",
                &sync::task_labels_row_id(task_id, old_label_id),
                "DELETE",
                None,
                None,
            )
            .await
            .ok();
        }
    }
    for (label_id, created_at) in &label_rows {
        let tl_snapshot = serde_json::json!({
            "task_id": task_id,
            "label_id": label_id,
            "created_at": created_at,
        })
        .to_string();
        sync::append_sync_log(
            pool,
            "task_labels",
            &sync::task_labels_row_id(task_id, label_id),
            "INSERT",
            None,
            Some(&tl_snapshot),
        )
        .await
        .ok();
    }

    // Todoist mutation observer: best-effort. No field mapping exists yet for
    // "labels" in observer::on_task_mutation's Updated payload builder, so
    // this is currently a no-op enqueue — kept for parity with every other
    // task field update and to be ready once Task 9 teaches the observer
    // about label names.
    let fields_changed_owned: Vec<String> = vec!["labels".to_string()];
    crate::integrations::todoist::observer::on_task_mutation(
        pool,
        crate::integrations::todoist::observer::TaskMutation::Updated {
            task: &task,
            fields_changed: &fields_changed_owned,
        },
    )
    .await;

    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tasks::create_local_task;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    #[tokio::test]
    async fn label_crud_and_assignment_roundtrip() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let l2 = create_label(&pool, "quick win", "yellow").await.unwrap();
        assert_eq!(list_labels(&pool).await.unwrap().len(), 2);

        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() }).await.unwrap();
        let t = set_task_labels(&pool, &t.id, &[l1.id.clone(), l2.id.clone()]).await.unwrap();
        assert_eq!(t.labels.len(), 2);

        // replace semantics, not append
        let t = set_task_labels(&pool, &t.id, &[l2.id.clone()]).await.unwrap();
        assert_eq!(t.labels, vec![l2.id.clone()]);

        // deleting a label detaches it from tasks
        delete_label(&pool, &l2.id).await.unwrap();
        assert!(labels_for_task(&pool, &t.id).await.unwrap().is_empty());

        // get_or_create is idempotent and case-insensitive on name
        let a = get_or_create_label_by_name(&pool, "Deep Work").await.unwrap();
        assert_eq!(a.id, l1.id);
    }

    /// Regression for review finding 1: a duplicate id in the input slice
    /// must not abort the transaction (composite PK on `task_labels`) and
    /// must not produce duplicate entries in the result.
    #[tokio::test]
    async fn duplicate_label_ids_in_input_do_not_corrupt_state() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();

        let t = set_task_labels(&pool, &t.id, &[l1.id.clone(), l1.id.clone()]).await.unwrap();
        assert_eq!(t.labels, vec![l1.id.clone()]);
        assert_eq!(labels_for_task(&pool, &t.id).await.unwrap(), vec![l1.id.clone()]);
    }

    /// Regression for review finding 2: `task_labels` has no FK on `label_id`,
    /// so a phantom id must be rejected explicitly rather than silently
    /// attached. Also covers finding 1's transactionality: the failure must
    /// leave the task's previously-committed label set untouched, not
    /// deleted or partially replaced.
    #[tokio::test]
    async fn phantom_label_id_errors_without_mutating_existing_assignment() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();
        let t = set_task_labels(&pool, &t.id, &[l1.id.clone()]).await.unwrap();
        assert_eq!(t.labels, vec![l1.id.clone()]);

        let err = set_task_labels(&pool, &t.id, &["nonexistent-label".to_string()]).await;
        assert!(err.is_err());
        assert_eq!(labels_for_task(&pool, &t.id).await.unwrap(), vec![l1.id.clone()]);
    }

    /// Regression for review finding 2: a nonexistent `task_id` must error
    /// before any `task_labels` row is written — no orphaned rows for a task
    /// that doesn't exist.
    #[tokio::test]
    async fn bad_task_id_errors_without_orphaning_task_labels_rows() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();

        let err = set_task_labels(&pool, "nonexistent-task", &[l1.id.clone()]).await;
        assert!(err.is_err());
        assert!(labels_for_task(&pool, "nonexistent-task").await.unwrap().is_empty());
    }

    /// Regression for review finding 3: two callers racing to
    /// get-or-create differently-cased names for the same label must
    /// converge on one row, not two.
    ///
    /// `test_pool()` is `max_connections(1)`, so two `tokio::join!`'d calls
    /// against it never hold two live SQLite connections — the connection
    /// pool itself serializes them regardless of whether the INSERT is
    /// atomic, which would let this test pass even against the old, racy
    /// SELECT-then-INSERT implementation (caught in review). To actually
    /// exercise the race, this spins up its own file-backed pool with
    /// `max_connections(2)` (separate `:memory:` connections don't share a
    /// database, so a temp file is required) and a `busy_timeout` so a
    /// blocked writer waits for the lock instead of failing immediately —
    /// SQLite still serializes the two writers under the hood, but now via
    /// its own real locking, which is the mechanism under test.
    #[tokio::test]
    async fn get_or_create_label_by_name_is_race_safe_under_concurrent_case_variants() {
        use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
        use std::str::FromStr;

        let path = std::env::temp_dir().join(format!("nimble-labels-race-{}.db", Uuid::new_v4()));
        let url = format!("sqlite://{}?mode=rwc", path.to_str().expect("temp path is utf-8"));
        let options = SqliteConnectOptions::from_str(&url)
            .expect("valid sqlite url")
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .expect("file-backed sqlite pool with 2 real connections");
        crate::db::migrations::run_migrations(&pool)
            .await
            .expect("migrations on race-test pool");

        let (a, b) = tokio::join!(
            get_or_create_label_by_name(&pool, "Deep Work"),
            get_or_create_label_by_name(&pool, "deep work"),
        );

        // A blocked writer may still surface a busy/locked error despite the
        // timeout under unlucky scheduling — that's an acceptable outcome.
        // What must never happen, and what this test actually guards, is
        // two successful calls resolving to two different label rows.
        let ids: Vec<String> = [a, b].into_iter().filter_map(|r| r.ok()).map(|l| l.id).collect();
        assert!(!ids.is_empty(), "at least one concurrent call must succeed");
        assert!(
            ids.windows(2).all(|w| w[0] == w[1]),
            "concurrent case-variant calls must never resolve to different label ids: {ids:?}"
        );
        assert_eq!(
            list_labels(&pool).await.unwrap().len(),
            1,
            "exactly one label row must exist, never two"
        );

        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }

    use crate::types::{LabelGroupPatch, UpdateTaskInput};

    #[tokio::test]
    async fn group_crud_orders_and_rejects_duplicate_names() {
        let pool = test_pool().await;
        let effort = create_label_group(&pool, "  EFFORT ", true).await.unwrap();
        assert_eq!((effort.name.as_str(), effort.exclusive, effort.system, effort.position), ("EFFORT", true, false, 0));
        let ty = create_label_group(&pool, "TYPE", false).await.unwrap();
        assert!(create_label_group(&pool, "effort", false).await.is_err(), "case-insensitive duplicate");
        assert!(create_label_group(&pool, "   ", false).await.is_err(), "empty name");

        let ty = update_label_group(&pool, &ty.id, LabelGroupPatch { name: Some("Kind".into()), system: Some(true), ..Default::default() })
            .await.unwrap();
        assert_eq!((ty.name.as_str(), ty.system), ("Kind", true));
        assert!(update_label_group(&pool, &ty.id, LabelGroupPatch { name: Some("EFFORT".into()), ..Default::default() }).await.is_err());

        reorder_label_groups(&pool, &[ty.id.clone(), effort.id.clone()]).await.unwrap();
        let names: Vec<String> = list_label_groups(&pool).await.unwrap().into_iter().map(|g| g.name).collect();
        assert_eq!(names, ["Kind", "EFFORT"]);
        assert!(reorder_label_groups(&pool, &["nope".to_string()]).await.is_err());

        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name = 'label_groups'")
            .fetch_one(&pool).await.unwrap();
        assert!(n >= 5, "create×2, update, reorder×2 all replicate (got {n})");
    }

    #[tokio::test]
    async fn delete_group_ungroups_members_in_one_step() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        let quick = create_label(&pool, "quick", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        set_label_group(&pool, &quick.id, Some(&g.id)).await.unwrap();
        assert!(set_label_group(&pool, &deep.id, Some("missing-group")).await.is_err());
        assert!(set_label_group(&pool, "missing-label", Some(&g.id)).await.is_err());

        let mut ungrouped = delete_label_group(&pool, &g.id).await.unwrap();
        ungrouped.sort();
        let mut expected = vec![deep.id.clone(), quick.id.clone()];
        expected.sort();
        assert_eq!(ungrouped, expected);
        assert!(list_label_groups(&pool).await.unwrap().is_empty());
        assert!(list_labels(&pool).await.unwrap().iter().all(|l| l.group.is_none()));
        let deletes: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE table_name='label_groups' AND operation='DELETE'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(deletes, 1);
    }

    #[tokio::test]
    async fn archive_restore_and_unused() {
        let pool = test_pool().await;
        let used = create_label(&pool, "deep", "gray").await.unwrap();
        let idle = create_label(&pool, "old", "gray").await.unwrap();
        let done_only = create_label(&pool, "shipped", "gray").await.unwrap();
        let sys = create_label(&pool, "from-instinct", "gray").await.unwrap();
        let system = create_label_group(&pool, "SYSTEM", false).await.unwrap();
        update_label_group(&pool, &system.id, LabelGroupPatch { system: Some(true), ..Default::default() }).await.unwrap();
        set_label_group(&pool, &sys.id, Some(&system.id)).await.unwrap();
        // Marco 2026-09-25: grouped labels are never "unused", even with no open task.
        let ty = create_label_group(&pool, "TYPE", false).await.unwrap();
        let grouped_idle = create_label(&pool, "health", "gray").await.unwrap();
        set_label_group(&pool, &grouped_idle.id, Some(&ty.id)).await.unwrap();
        // A dangling group id reads as ungrouped.
        let dangling = create_label(&pool, "orphan", "gray").await.unwrap();
        sqlx::query("UPDATE labels SET \"group\" = 'deleted-elsewhere' WHERE id = ?")
            .bind(&dangling.id).execute(&pool).await.unwrap();

        let open = create_local_task(&pool, CreateTaskInput { content: "open".into(), ..Default::default() }).await.unwrap();
        set_task_labels(&pool, &open.id, &[used.id.clone()]).await.unwrap();
        let done = create_local_task(&pool, CreateTaskInput { content: "done".into(), ..Default::default() }).await.unwrap();
        set_task_labels(&pool, &done.id, &[done_only.id.clone()]).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &done.id, "complete", None).await.unwrap();

        let mut unused = unused_label_ids(&pool).await.unwrap();
        unused.sort();
        let mut expected = vec![idle.id.clone(), done_only.id.clone(), dangling.id.clone()];
        expected.sort();
        assert_eq!(unused, expected, "grouped/system labels and labels on open tasks are never 'unused'");

        let first = archive_labels(&pool, &[idle.id.clone()]).await.unwrap();
        assert_eq!(first.len(), 1);
        // Undo of a later "archive unused" must restore only what THAT call archived.
        let second = archive_labels(&pool, &[idle.id.clone(), done_only.id.clone(), dangling.id.clone()]).await.unwrap();
        assert_eq!(second.iter().map(|l| l.id.clone()).collect::<Vec<_>>(), vec![done_only.id.clone(), dangling.id.clone()]);
        assert!(second[0].archived_at.is_some());
        assert!(unused_label_ids(&pool).await.unwrap().is_empty(), "archived labels are not listed as unused");
        assert!(archive_labels(&pool, &["ghost".to_string()]).await.is_err());

        // Archived labels still render on the tasks that have them.
        assert_eq!(labels_for_task(&pool, &done.id).await.unwrap(), vec![done_only.id.clone()]);

        let restored = restore_labels(&pool, &[done_only.id.clone(), used.id.clone()]).await.unwrap();
        assert_eq!(restored.iter().map(|l| l.id.clone()).collect::<Vec<_>>(), vec![done_only.id.clone()]);
        assert!(get_label(&pool, &done_only.id).await.unwrap().archived_at.is_none());
    }

    #[tokio::test]
    async fn todoist_name_match_never_unarchives_or_regroups() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        archive_labels(&pool, &[deep.id.clone()]).await.unwrap();
        let pulled = get_or_create_label_by_name(&pool, "Deep").await.unwrap();
        assert_eq!(pulled.id, deep.id);
        assert!(pulled.archived_at.is_some());
        assert_eq!(pulled.group.as_deref(), Some(g.id.as_str()));
        let fresh = get_or_create_label_by_name(&pool, "brand-new").await.unwrap();
        assert!(fresh.group.is_none() && fresh.archived_at.is_none());
    }

    #[tokio::test]
    async fn creating_an_archived_name_is_refused_so_the_ui_must_restore() {
        let pool = test_pool().await;
        let old = create_label(&pool, "old", "gray").await.unwrap();
        archive_labels(&pool, &[old.id.clone()]).await.unwrap();
        assert!(create_label(&pool, "old", "gray").await.is_err(), "labels.name is UNIQUE");
    }

    #[tokio::test]
    async fn set_task_labels_never_enforces_pick_one() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        let quick = create_label(&pool, "quick", "gray").await.unwrap();
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        set_label_group(&pool, &quick.id, Some(&g.id)).await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() }).await.unwrap();
        let t = set_task_labels(&pool, &t.id, &[deep.id.clone(), quick.id.clone()]).await.unwrap();
        assert_eq!(t.labels.len(), 2, "sync may deliver two; Rust keeps both");
        let t = crate::db::tasks::update_local_task(&pool, &t.id, UpdateTaskInput { label_ids: Some(vec![deep.id.clone(), quick.id.clone()]), ..Default::default() }).await.unwrap();
        assert_eq!(t.labels.len(), 2);
    }

    #[tokio::test]
    async fn set_label_group_is_a_no_op_when_unchanged() {
        let pool = test_pool().await;
        let g = create_label_group(&pool, "EFFORT", true).await.unwrap();
        let deep = create_label(&pool, "deep", "gray").await.unwrap();
        let count = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sync_log WHERE table_name = 'labels' AND row_id = ?")
                .bind(&deep.id).fetch_one(&pool).await.unwrap()
        };
        set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        let after_first = count().await;
        let again = set_label_group(&pool, &deep.id, Some(&g.id)).await.unwrap();
        assert_eq!(again.group.as_deref(), Some(g.id.as_str()));
        assert_eq!(count().await, after_first, "re-assigning the same group writes nothing");
        assert!(set_label_group(&pool, &deep.id, Some("missing")).await.is_err(), "still validates");
    }

    #[tokio::test]
    async fn reorder_labels_sets_positions() {
        let pool = test_pool().await;
        let a = create_label(&pool, "a", "gray").await.unwrap();
        let b = create_label(&pool, "b", "gray").await.unwrap();
        reorder_labels(&pool, &[b.id.clone(), a.id.clone()]).await.unwrap();
        let names: Vec<String> = list_labels(&pool).await.unwrap().into_iter().map(|l| l.name).collect();
        assert_eq!(names, ["b", "a"]);
        assert!(reorder_labels(&pool, &["ghost".to_string()]).await.is_err());
    }
}
