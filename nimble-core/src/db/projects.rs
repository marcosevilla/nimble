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
            parent_id: row.try_get("parent_id")?,
            external_id: row.try_get("external_id")?,
            external_source: row.try_get("external_source")?,
            remote_updated_at: row.try_get("remote_updated_at")?,
            synced_snapshot: row.try_get("synced_snapshot")?,
            goal_id: row.try_get("goal_id")?,
            milestone_id: row.try_get("milestone_id")?,
        })
    }
}

/// The one `projects` column list — every single-row/list SELECT that maps to
/// `Project` uses this, mirroring `db::tasks::SELECT_COLS`. A literal copied
/// per call site is how a new column gets missed at one of them and silently
/// left stale on other devices (upserts only update snapshot columns).
pub(crate) const SELECT_COLS: &str = "id, name, color, position, parent_id, external_id, external_source, remote_updated_at, synced_snapshot, goal_id, milestone_id";

/// Re-read a project row and append a full-snapshot sync_log entry for it.
/// The single definition of "project snapshot" for the Todoist import/pull
/// paths, which mutate projects with raw SQL outside this module's CRUD fns
/// (deliberately — the CRUD fns fire the Todoist observer, which would echo
/// imported rows straight back to Todoist). Hand-rolling the
/// SELECT-serialize-append block at each site is how a future projects
/// column gets missed at one copy and silently blanked on every other device
/// (a column absent from every snapshot never replicates). Fire-and-forget like
/// every sync_log append, but warns on failure: sync_log IS the retry
/// mechanism, so a swallowed failure here can leave the row permanently
/// absent from Turso with nothing to count as "unsynced".
pub(crate) async fn log_project_sync(pool: &SqlitePool, project_id: &str, operation: &str) {
    let row: Result<Option<Project>, _> = sqlx::query_as::<_, Project>(
        &format!("SELECT {SELECT_COLS} FROM projects WHERE id = ?"),
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await;
    match row {
        Ok(Some(project)) => {
            let snapshot = serde_json::to_string(&project).unwrap_or_default();
            if let Err(e) =
                sync::append_sync_log(pool, "projects", project_id, operation, None, Some(&snapshot)).await
            {
                log::warn!("log_project_sync: sync_log append failed for project {project_id}: {e}");
            }
        }
        Ok(None) => {
            log::warn!("log_project_sync: project {project_id} not found for {operation}");
        }
        Err(e) => {
            log::warn!("log_project_sync: snapshot read failed for project {project_id}: {e}");
        }
    }
}

pub async fn get_projects(pool: &SqlitePool) -> crate::Result<Vec<Project>> {
    let rows: Vec<Project> = sqlx::query_as::<_, Project>(
        &format!("SELECT {SELECT_COLS} FROM projects ORDER BY position, created_at"),
    )
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

/// Max hops walked when checking a candidate `parent_id` for cycles. One
/// level of nesting is the design intent, but walking further makes any
/// depth safe rather than silently accepting a cycle beyond hop 1.
const MAX_ANCESTOR_WALK: u8 = 5;

/// True if setting `id`'s parent to `new_parent_id` would make `id` its own
/// ancestor. Walks up `new_parent_id`'s parent chain (including
/// `new_parent_id` itself) up to `MAX_ANCESTOR_WALK` hops, looking for `id`.
///
/// `projects.parent_id` has no foreign key (v19 migration adds the column
/// with a plain `ALTER TABLE`), so nothing at the SQLite layer stops a cycle
/// from being written directly — this is the only guard.
async fn would_create_cycle(
    pool: &SqlitePool,
    id: &str,
    new_parent_id: &str,
) -> crate::Result<bool> {
    let mut current = new_parent_id.to_string();
    for _ in 0..MAX_ANCESTOR_WALK {
        if current == id {
            return Ok(true);
        }
        let parent: Option<Option<String>> =
            sqlx::query_scalar("SELECT parent_id FROM projects WHERE id = ?")
                .bind(&current)
                .fetch_optional(pool)
                .await?;
        match parent {
            Some(Some(next)) => current = next,
            // Reached a root (no parent) or the chain points at an unknown
            // id — either way there's nowhere left to walk, so no cycle.
            Some(None) | None => return Ok(false),
        }
    }
    Ok(current == id)
}

pub async fn create_project(
    pool: &SqlitePool,
    name: &str,
    color: &str,
    parent_id: Option<&str>,
) -> crate::Result<Project> {
    if let Some(pid) = parent_id {
        let parent_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE id = ?")
            .bind(pid)
            .fetch_optional(pool)
            .await?;
        if parent_exists.is_none() {
            return Err(crate::Error::Other(format!(
                "create_project: no such parent project '{pid}'"
            )));
        }
    }

    let id = Uuid::new_v4().to_string();

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM projects")
            .fetch_one(pool)
            .await?;

    sqlx::query("INSERT INTO projects (id, name, color, position, parent_id) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(color)
        .bind(max_pos + 1)
        .bind(parent_id)
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
        parent_id: parent_id.map(|s| s.to_string()),
        external_id: None,
        external_source: None,
        remote_updated_at: None,
        synced_snapshot: None,
        goal_id: None,
        milestone_id: None,
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&project).unwrap_or_default();
    sync::append_sync_log(pool, "projects", &project.id, "INSERT", None, Some(&snapshot)).await.ok();

    // Todoist mutation observer: best-effort
    crate::integrations::todoist::observer::on_project_mutation(
        pool,
        crate::integrations::todoist::observer::ProjectMutation::Created(&project),
    )
    .await;

    Ok(project)
}

pub async fn update_project(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
    parent_id: Option<&str>,
    clear_parent: bool,
) -> crate::Result<()> {
    if clear_parent && parent_id.is_some() {
        return Err(crate::Error::Other(
            "update_project: cannot pass both clear_parent=true and a parent_id".to_string(),
        ));
    }

    // Validate parent_id (existence + cycle) BEFORE any field UPDATE runs.
    // Otherwise a name/color UPDATE below would persist even though the
    // overall call fails on an invalid parent_id — a partial write on the
    // exact failure path this fn introduces.
    if let Some(pid) = parent_id {
        let parent_exists: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE id = ?")
            .bind(pid)
            .fetch_optional(pool)
            .await?;
        if parent_exists.is_none() {
            return Err(crate::Error::Other(format!(
                "update_project: no such parent project '{pid}'"
            )));
        }
        if would_create_cycle(pool, id, pid).await? {
            return Err(crate::Error::Other(format!(
                "update_project: setting parent to '{pid}' would make '{id}' its own ancestor"
            )));
        }
    }

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
    if let Some(pid) = parent_id {
        sqlx::query("UPDATE projects SET parent_id = ? WHERE id = ?")
            .bind(pid)
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("parent_id");
    } else if clear_parent {
        sqlx::query("UPDATE projects SET parent_id = NULL WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        fields_changed.push("parent_id");
    }

    // Sync log: UPDATE
    if !fields_changed.is_empty() {
        let row: Option<Project> = sqlx::query_as::<_, Project>(
            &format!("SELECT {SELECT_COLS} FROM projects WHERE id = ?")
        ).bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some(project) = row {
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&project).unwrap_or_default();
            sync::append_sync_log(pool, "projects", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();

            // Todoist mutation observer: best-effort, only when the name itself changed
            if fields_changed.contains(&"name") {
                crate::integrations::todoist::observer::on_project_mutation(
                    pool,
                    crate::integrations::todoist::observer::ProjectMutation::Renamed(&project),
                )
                .await;
            }
        }
    }

    Ok(())
}

pub async fn delete_project(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    if id == "inbox" {
        return Err(crate::Error::Other("Cannot delete the Inbox project".to_string()));
    }

    // Fetch the full project before deleting, so the observer can enqueue a
    // delete op (and read external_id) after the row is gone.
    let pre_delete_project: Option<Project> = sqlx::query_as::<_, Project>(
        &format!("SELECT {SELECT_COLS} FROM projects WHERE id = ?")
    ).bind(id).fetch_optional(pool).await.ok().flatten();

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

    // Todoist mutation observer: best-effort
    if let Some(project) = &pre_delete_project {
        crate::integrations::todoist::observer::on_project_mutation(
            pool,
            crate::integrations::todoist::observer::ProjectMutation::Deleted { project },
        )
        .await;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn projects_expose_external_columns() {
        let pool = test_pool().await;
        let p = super::create_project(&pool, "Errands", "#ff0000", None).await.unwrap();
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

    #[tokio::test]
    async fn parent_id_persists_on_create_and_update() {
        let pool = test_pool().await;
        let parent = super::create_project(&pool, "Work", "blue", None).await.unwrap();
        let child = super::create_project(&pool, "Client A", "green", Some(&parent.id))
            .await
            .unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));

        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|p| p.id == child.id).unwrap();
        assert_eq!(fetched.parent_id.as_deref(), Some(parent.id.as_str()));

        // re-parent via update_project
        let other = super::create_project(&pool, "Client B", "red", None).await.unwrap();
        super::update_project(&pool, &child.id, None, None, Some(&other.id), false)
            .await
            .unwrap();
        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|p| p.id == child.id).unwrap();
        assert_eq!(fetched.parent_id.as_deref(), Some(other.id.as_str()));
    }

    #[tokio::test]
    async fn update_project_rejects_self_parent() {
        let pool = test_pool().await;
        let a = super::create_project(&pool, "A", "blue", None).await.unwrap();
        let err = super::update_project(&pool, &a.id, None, None, Some(&a.id), false).await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn update_project_rejects_two_hop_cycle() {
        let pool = test_pool().await;
        let a = super::create_project(&pool, "A", "blue", None).await.unwrap();
        let b = super::create_project(&pool, "B", "green", None).await.unwrap();

        // A.parent = B is fine (B has no parent yet)
        super::update_project(&pool, &a.id, None, None, Some(&b.id), false).await.unwrap();

        // B.parent = A would make A its own ancestor (A -> B -> A) — must error
        let err = super::update_project(&pool, &b.id, None, None, Some(&a.id), false).await;
        assert!(err.is_err());

        // and must not have partially applied
        let all = super::get_projects(&pool).await.unwrap();
        let fetched_b = all.iter().find(|p| p.id == b.id).unwrap();
        assert_eq!(fetched_b.parent_id, None);
    }

    #[tokio::test]
    async fn create_project_rejects_unknown_parent() {
        let pool = test_pool().await;
        let err = super::create_project(&pool, "Orphan", "blue", Some("nonexistent")).await;
        assert!(err.is_err());
    }

    /// Review finding 1 regression: an invalid parent_id must be rejected
    /// BEFORE any other field UPDATE runs, so a valid `name` change in the
    /// same call never partially persists when the call as a whole errors.
    #[tokio::test]
    async fn update_project_does_not_persist_valid_fields_when_parent_id_is_invalid() {
        let pool = test_pool().await;
        let p = super::create_project(&pool, "Original Name", "blue", None).await.unwrap();

        let err = super::update_project(
            &pool,
            &p.id,
            Some("New Name"),
            None,
            Some("nonexistent-parent"),
            false,
        )
        .await;
        assert!(err.is_err());

        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|x| x.id == p.id).unwrap();
        assert_eq!(
            fetched.name, "Original Name",
            "name must NOT have been persisted when the same call's parent_id was rejected"
        );
    }

    /// Review finding 3 regression: `clear_parent: true` moves a nested
    /// project back to top level (parent_id = NULL), the only way to reverse
    /// nesting through this API (`parent_id: None` means "leave unchanged").
    #[tokio::test]
    async fn clear_parent_moves_project_back_to_top_level() {
        let pool = test_pool().await;
        let parent = super::create_project(&pool, "Work", "blue", None).await.unwrap();
        let child = super::create_project(&pool, "Client A", "green", Some(&parent.id))
            .await
            .unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));

        super::update_project(&pool, &child.id, None, None, None, true)
            .await
            .unwrap();

        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|p| p.id == child.id).unwrap();
        assert_eq!(fetched.parent_id, None);
    }

    /// Review finding 3: passing both `clear_parent: true` and a `parent_id`
    /// is contradictory and must error rather than silently picking one.
    #[tokio::test]
    async fn clear_parent_and_parent_id_together_is_rejected() {
        let pool = test_pool().await;
        let a = super::create_project(&pool, "A", "blue", None).await.unwrap();
        let b = super::create_project(&pool, "B", "green", None).await.unwrap();

        let err = super::update_project(&pool, &a.id, None, None, Some(&b.id), true).await;
        assert!(err.is_err());
    }
}
