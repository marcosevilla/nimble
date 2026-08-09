use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::sync;
use crate::db::tasks::SELECT_COLS;
use crate::types::{LocalTask, Section};

const SECTION_COLS: &str = "id, project_id, name, position, external_id, external_source, created_at";

pub async fn list_sections(pool: &SqlitePool, project_id: &str) -> crate::Result<Vec<Section>> {
    let rows: Vec<Section> = sqlx::query_as::<_, Section>(&format!(
        "SELECT {} FROM sections WHERE project_id = ? ORDER BY position, created_at",
        SECTION_COLS
    ))
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn create_section(pool: &SqlitePool, project_id: &str, name: &str) -> crate::Result<Section> {
    let project_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_optional(pool)
        .await?;
    if project_exists.is_none() {
        return Err(crate::Error::Other(format!(
            "create_section: no such project '{project_id}'"
        )));
    }

    let id = Uuid::new_v4().to_string();

    let max_pos: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) FROM sections WHERE project_id = ?",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    let position = max_pos + 1;

    sqlx::query("INSERT INTO sections (id, project_id, name, position) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(position)
        .execute(pool)
        .await?;

    let section: Section = sqlx::query_as::<_, Section>(&format!(
        "SELECT {} FROM sections WHERE id = ?",
        SECTION_COLS
    ))
    .bind(&id)
    .fetch_one(pool)
    .await?;

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&section).unwrap_or_default();
    sync::append_sync_log(pool, "sections", &section.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(section)
}

pub async fn rename_section(pool: &SqlitePool, id: &str, name: &str) -> crate::Result<Section> {
    let section_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM sections WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    if section_exists.is_none() {
        return Err(crate::Error::Other(format!("rename_section: no such section '{id}'")));
    }

    sqlx::query("UPDATE sections SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await?;

    let section: Section = sqlx::query_as::<_, Section>(&format!(
        "SELECT {} FROM sections WHERE id = ?",
        SECTION_COLS
    ))
    .bind(id)
    .fetch_one(pool)
    .await?;

    // Sync log: UPDATE
    let changed = serde_json::json!(["name"]).to_string();
    let snapshot = serde_json::to_string(&section).unwrap_or_default();
    sync::append_sync_log(pool, "sections", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();

    Ok(section)
}

/// Tasks in the section get `section_id = NULL` (fall back to project root).
/// Fires `sync_log` + the Todoist mutation observer per affected task, mirroring
/// `db::labels::set_task_labels`'s UPDATE mechanism so the change replicates the
/// same way any other `local_tasks` field edit does.
///
/// The task lookup, the `UPDATE ... SET section_id = NULL`, and the section
/// delete itself all run inside one transaction: `local_tasks.section_id` has
/// no foreign key (v19 migration), so nothing at the SQLite layer enforces
/// this cleanup, and without a transaction a mid-sequence failure could leave
/// tasks pointing at a section row that no longer exists. `sync_log` writes
/// and the observer calls happen strictly after `tx.commit()` succeeds, so
/// they only ever observe a fully-applied change (same ordering as
/// `set_task_labels`).
pub async fn delete_section(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    let mut tx = pool.begin().await?;

    let section_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM sections WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if section_exists.is_none() {
        return Err(crate::Error::Other(format!("delete_section: no such section '{id}'")));
    }

    let affected_ids: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM local_tasks WHERE section_id = ?")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;

    sqlx::query(
        "UPDATE local_tasks SET section_id = NULL, updated_at = datetime('now') WHERE section_id = ?",
    )
    .bind(id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM sections WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Snapshot each affected task post-update, still inside the transaction,
    // so the sync_log/observer calls below reflect the committed state.
    let mut affected_tasks: Vec<LocalTask> = Vec::with_capacity(affected_ids.len());
    for (task_id,) in &affected_ids {
        let task: LocalTask = sqlx::query_as::<_, LocalTask>(&format!(
            "SELECT {} FROM local_tasks WHERE id = ?",
            SELECT_COLS
        ))
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        affected_tasks.push(task);
    }

    tx.commit().await?;

    // Sync log: DELETE for the section row itself.
    sync::append_sync_log(pool, "sections", id, "DELETE", None, None).await.ok();

    let changed = serde_json::json!(["section_id"]).to_string();
    let fields_changed_owned = vec!["section_id".to_string()];
    for task in &affected_tasks {
        let snapshot = sync::task_sync_snapshot(task);
        sync::append_sync_log(
            pool,
            "local_tasks",
            &task.id,
            "UPDATE",
            Some(&changed),
            Some(&snapshot),
        )
        .await
        .ok();

        crate::integrations::todoist::observer::on_task_mutation(
            pool,
            crate::integrations::todoist::observer::TaskMutation::Updated {
                task,
                fields_changed: &fields_changed_owned,
            },
        )
        .await;
    }

    Ok(())
}

/// Reorders sections by the given id list. Runs inside a transaction: every
/// id is checked to exist BEFORE any `UPDATE` runs, so a bogus id errors the
/// whole call instead of silently no-opping (a stray id would otherwise just
/// match zero rows) or leaving a partially-reordered set from a mid-loop
/// failure.
pub async fn reorder_sections(pool: &SqlitePool, section_ids: &[String]) -> crate::Result<()> {
    let mut tx = pool.begin().await?;

    for id in section_ids {
        let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM sections WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
        if exists.is_none() {
            return Err(crate::Error::Other(format!(
                "reorder_sections: no such section '{id}'"
            )));
        }
    }

    for (i, id) in section_ids.iter().enumerate() {
        sqlx::query("UPDATE sections SET position = ? WHERE id = ?")
            .bind(i as i64)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }

    // Snapshot each reordered section post-update, still inside the
    // transaction, so the sync_log calls below reflect the committed state.
    let mut reordered_sections: Vec<Section> = Vec::with_capacity(section_ids.len());
    for id in section_ids {
        let section: Section = sqlx::query_as::<_, Section>(&format!(
            "SELECT {} FROM sections WHERE id = ?",
            SECTION_COLS
        ))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        reordered_sections.push(section);
    }

    tx.commit().await?;

    let changed = serde_json::json!(["position"]).to_string();
    for section in &reordered_sections {
        let snapshot = serde_json::to_string(section).unwrap_or_default();
        sync::append_sync_log(
            pool,
            "sections",
            &section.id,
            "UPDATE",
            Some(&changed),
            Some(&snapshot),
        )
        .await
        .ok();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::projects::create_project;
    use crate::db::tasks::create_local_task;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    #[tokio::test]
    async fn section_crud_roundtrip() {
        let pool = test_pool().await;
        let p = create_project(&pool, "Errands", "blue", None).await.unwrap();

        let s1 = create_section(&pool, &p.id, "Groceries").await.unwrap();
        let s2 = create_section(&pool, &p.id, "Chores").await.unwrap();
        assert_eq!(list_sections(&pool, &p.id).await.unwrap().len(), 2);

        let renamed = rename_section(&pool, &s1.id, "Shopping").await.unwrap();
        assert_eq!(renamed.name, "Shopping");

        reorder_sections(&pool, &[s2.id.clone(), s1.id.clone()]).await.unwrap();
        let ordered = list_sections(&pool, &p.id).await.unwrap();
        assert_eq!(ordered[0].id, s2.id);
        assert_eq!(ordered[1].id, s1.id);

        delete_section(&pool, &s1.id).await.unwrap();
        assert_eq!(list_sections(&pool, &p.id).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn delete_section_nulls_section_id_on_its_tasks_and_fires_sync_log() {
        let pool = test_pool().await;
        let p = create_project(&pool, "Errands", "blue", None).await.unwrap();
        let s = create_section(&pool, &p.id, "Groceries").await.unwrap();

        let t = create_local_task(
            &pool,
            CreateTaskInput { content: "Buy milk".into(), project_id: Some(p.id.clone()), ..Default::default() },
        )
        .await
        .unwrap();

        // Assign the section directly (no `set_section` fn in this task's
        // scope yet), mirroring the brief's "assign section via raw update".
        sqlx::query("UPDATE local_tasks SET section_id = ? WHERE id = ?")
            .bind(&s.id)
            .bind(&t.id)
            .execute(&pool)
            .await
            .unwrap();

        delete_section(&pool, &s.id).await.unwrap();

        let row: (Option<String>,) =
            sqlx::query_as("SELECT section_id FROM local_tasks WHERE id = ?")
                .bind(&t.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row.0, None, "task's section_id must fall back to project root (NULL)");

        let logged: Vec<(String, String)> =
            sqlx::query_as("SELECT row_id, changed_columns FROM sync_log WHERE table_name = 'local_tasks' AND row_id = ?")
                .bind(&t.id)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(
            logged.iter().any(|(_, changed)| changed.contains("section_id")),
            "delete_section must append a sync_log UPDATE entry with section_id in changed_columns for each affected task"
        );
    }

    /// Review finding 2 regression: a bogus id in the reorder list must
    /// error the whole call (not silently no-op that one entry), and must
    /// leave every section's position untouched — not partially reordered.
    #[tokio::test]
    async fn reorder_sections_rejects_unknown_id_and_leaves_positions_untouched() {
        let pool = test_pool().await;
        let p = create_project(&pool, "Errands", "blue", None).await.unwrap();
        let s1 = create_section(&pool, &p.id, "Groceries").await.unwrap();
        let s2 = create_section(&pool, &p.id, "Chores").await.unwrap();

        let before = list_sections(&pool, &p.id).await.unwrap();
        assert_eq!(before[0].id, s1.id);
        assert_eq!(before[1].id, s2.id);

        let err = reorder_sections(&pool, &[s2.id.clone(), "nonexistent-section".to_string()]).await;
        assert!(err.is_err());

        let after = list_sections(&pool, &p.id).await.unwrap();
        assert_eq!(after[0].id, s1.id, "positions must be untouched after a rejected reorder");
        assert_eq!(after[1].id, s2.id);
    }

    #[tokio::test]
    async fn create_section_rejects_unknown_project() {
        let pool = test_pool().await;
        let err = create_section(&pool, "nonexistent-project", "Groceries").await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn rename_and_delete_reject_unknown_section() {
        let pool = test_pool().await;
        assert!(rename_section(&pool, "nonexistent-section", "x").await.is_err());
        assert!(delete_section(&pool, "nonexistent-section").await.is_err());
    }
}
