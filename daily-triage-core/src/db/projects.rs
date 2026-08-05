use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row, SqlitePool};
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::Project;

impl FromRow<'_, SqliteRow> for Project {
    fn from_row(row: &SqliteRow) -> Result<Self, sqlx::Error> {
        Ok(Project {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            color: row.try_get("color")?,
            position: row.try_get("position")?,
            external_id: row.try_get("external_id")?,
            external_source: row.try_get("external_source")?,
            remote_updated_at: row.try_get("remote_updated_at")?,
            synced_snapshot: row.try_get("synced_snapshot")?,
        })
    }
}

pub async fn get_projects(pool: &SqlitePool) -> crate::Result<Vec<Project>> {
    let rows: Vec<Project> = sqlx::query_as::<_, Project>(
        "SELECT id, name, color, position, external_id, external_source, remote_updated_at, synced_snapshot FROM projects ORDER BY position, created_at",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn create_project(
    pool: &SqlitePool,
    name: &str,
    color: &str,
) -> crate::Result<Project> {
    let id = Uuid::new_v4().to_string();

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM projects")
            .fetch_one(pool)
            .await?;

    sqlx::query("INSERT INTO projects (id, name, color, position) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(color)
        .bind(max_pos + 1)
        .execute(pool)
        .await?;

    activity::log_activity(
        pool,
        "project_created",
        Some(&id),
        Some(serde_json::json!({ "name": name })),
    )
    .await;

    let project = Project {
        id,
        name: name.to_string(),
        color: color.to_string(),
        position: max_pos + 1,
        external_id: None,
        external_source: None,
        remote_updated_at: None,
        synced_snapshot: None,
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&project).unwrap_or_default();
    sync::append_sync_log(pool, "projects", &project.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(project)
}

pub async fn update_project(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> crate::Result<()> {
    let mut fields_changed = Vec::new();
    if let Some(name) = name {
        sqlx::query("UPDATE projects SET name = ? WHERE id = ?")
            .bind(name)
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("name");
    }
    if let Some(color) = color {
        sqlx::query("UPDATE projects SET color = ? WHERE id = ?")
            .bind(color)
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("color");
    }

    // Sync log: UPDATE
    if !fields_changed.is_empty() {
        let row: Option<Project> = sqlx::query_as::<_, Project>(
            "SELECT id, name, color, position, external_id, external_source, remote_updated_at, synced_snapshot FROM projects WHERE id = ?"
        ).bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some(project) = row {
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&project).unwrap_or_default();
            sync::append_sync_log(pool, "projects", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    Ok(())
}

pub async fn delete_project(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    if id == "inbox" {
        return Err(crate::Error::Other("Cannot delete the Inbox project".to_string()));
    }

    // Move tasks to Inbox before deleting
    sqlx::query("UPDATE local_tasks SET project_id = 'inbox' WHERE project_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM projects WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "projects", id, "DELETE", None, None).await.ok();

    activity::log_activity(
        pool,
        "project_deleted",
        Some(id),
        None,
    )
    .await;

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn projects_expose_external_columns() {
        let pool = test_pool().await;
        let p = super::create_project(&pool, "Errands", "#ff0000").await.unwrap();
        assert_eq!(p.external_id, None);

        sqlx::query("UPDATE projects SET external_id = 'abc123', external_source = 'todoist' WHERE id = ?")
            .bind(&p.id)
            .execute(&pool)
            .await
            .unwrap();

        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|x| x.id == p.id).unwrap();
        assert_eq!(fetched.external_id.as_deref(), Some("abc123"));
        assert_eq!(fetched.external_source.as_deref(), Some("todoist"));
    }
}
