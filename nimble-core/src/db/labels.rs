use std::collections::HashSet;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::db::tasks::SELECT_COLS;
use crate::types::{Label, LocalTask};

const LABEL_COLS: &str = "id, name, color, position, created_at";

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

    Ok(label)
}

pub async fn update_label(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> crate::Result<Label> {
    if let Some(name) = name {
        sqlx::query("UPDATE labels SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(color) = color {
        sqlx::query("UPDATE labels SET color = ? WHERE id = ?")
            .bind(color)
            .bind(id)
            .execute(pool)
            .await?;
    }

    let label: Label = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels WHERE id = ?",
        LABEL_COLS
    ))
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(label)
}

/// Also deletes the label's `task_labels` rows so no task keeps a dangling
/// reference to a label that no longer exists.
pub async fn delete_label(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("DELETE FROM task_labels WHERE label_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM labels WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

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

    sqlx::query(
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

    Ok(label)
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

    let label_rows: Vec<(String,)> = sqlx::query_as(
        "SELECT label_id FROM task_labels WHERE task_id = ? ORDER BY rowid",
    )
    .bind(task_id)
    .fetch_all(&mut *tx)
    .await?;
    task.labels = label_rows.into_iter().map(|(label_id,)| label_id).collect();

    tx.commit().await?;

    // Sync log: UPDATE — same shape as db::tasks::update_local_task's fields_changed path.
    // Runs after the transaction commits, so it only ever observes a fully-applied change.
    let changed = serde_json::json!(["labels"]).to_string();
    let snapshot = serde_json::to_string(&task).unwrap_or_default();
    sync::append_sync_log(pool, "local_tasks", task_id, "UPDATE", Some(&changed), Some(&snapshot))
        .await
        .ok();

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
    #[tokio::test]
    async fn get_or_create_label_by_name_is_race_safe_under_concurrent_case_variants() {
        let pool = test_pool().await;
        let (a, b) = tokio::join!(
            get_or_create_label_by_name(&pool, "Deep Work"),
            get_or_create_label_by_name(&pool, "deep work"),
        );
        let a = a.unwrap();
        let b = b.unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(list_labels(&pool).await.unwrap().len(), 1);
    }
}
