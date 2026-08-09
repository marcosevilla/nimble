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
pub async fn get_or_create_label_by_name(pool: &SqlitePool, name: &str) -> crate::Result<Label> {
    let existing: Option<Label> = sqlx::query_as::<_, Label>(&format!(
        "SELECT {} FROM labels WHERE name = ?1 COLLATE NOCASE",
        LABEL_COLS
    ))
    .bind(name)
    .fetch_optional(pool)
    .await?;

    if let Some(label) = existing {
        return Ok(label);
    }

    create_label(pool, name, "gray").await
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
pub async fn set_task_labels(
    pool: &SqlitePool,
    task_id: &str,
    label_ids: &[String],
) -> crate::Result<LocalTask> {
    sqlx::query("DELETE FROM task_labels WHERE task_id = ?")
        .bind(task_id)
        .execute(pool)
        .await?;

    for label_id in label_ids {
        sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(label_id)
            .execute(pool)
            .await?;
    }

    let mut task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!(
        "SELECT {} FROM local_tasks WHERE id = ?",
        SELECT_COLS
    ))
    .bind(task_id)
    .fetch_one(pool)
    .await?;

    task.labels = labels_for_task(pool, task_id).await?;

    // Sync log: UPDATE — same shape as db::tasks::update_local_task's fields_changed path.
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
}
