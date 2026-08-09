use crate::integrations::todoist::outbox;
use crate::types::{LocalTask, Project};
use sqlx::SqlitePool;

pub enum TaskMutation<'a> {
    Created(&'a LocalTask),
    Updated { task: &'a LocalTask, fields_changed: &'a [String] },
    StatusChanged { task: &'a LocalTask, was_completed: bool },
    Deleted { task: &'a LocalTask },
}

pub enum ProjectMutation<'a> {
    Created(&'a Project),
    Renamed(&'a Project),
    Deleted { project: &'a Project },
}

fn task_create_payload(task: &LocalTask) -> serde_json::Value {
    serde_json::json!({
        "content": task.content,
        "description": task.description,
        "due_date": task.due_date,
        "priority": task.priority,
        "project_local_id": task.project_id,
        "parent_local_id": task.parent_id,
    })
}

async fn active(pool: &SqlitePool) -> bool {
    matches!(crate::integrations::adapter_token_if_active(pool).await, Ok(Some(_)))
}

/// Best-effort: logs and swallows errors, never fails the caller.
pub async fn on_task_mutation(pool: &SqlitePool, m: TaskMutation<'_>) {
    if !active(pool).await {
        return;
    }
    let result = match m {
        TaskMutation::Created(task) => {
            // rows the Todoist pull itself creates carry external_id already — never re-create
            if task.external_id.is_some() {
                return;
            }
            outbox::enqueue(pool, "task", &task.id, "create", task_create_payload(task)).await
        }
        TaskMutation::Updated { task, fields_changed } => {
            let mut payload = serde_json::Map::new();
            for field in fields_changed {
                match field.as_str() {
                    "content" => { payload.insert("content".into(), task.content.clone().into()); }
                    "description" => { payload.insert("description".into(), task.description.clone().into()); }
                    "due_date" => { payload.insert("due_date".into(), task.due_date.clone().into()); }
                    "priority" => { payload.insert("priority".into(), task.priority.into()); }
                    _ => {}
                }
            }
            let mut r = Ok(());
            if !payload.is_empty() {
                r = outbox::enqueue(pool, "task", &task.id, "update", payload.into()).await;
            }
            if r.is_ok() && fields_changed.iter().any(|f| f == "project_id") {
                r = outbox::enqueue(pool, "task", &task.id, "move",
                    serde_json::json!({"project_local_id": task.project_id})).await;
            }
            r
        }
        TaskMutation::StatusChanged { task, was_completed } => {
            match (was_completed, task.completed) {
                (false, true) => outbox::enqueue(pool, "task", &task.id, "close", serde_json::json!({})).await,
                (true, false) => outbox::enqueue(pool, "task", &task.id, "reopen", serde_json::json!({})).await,
                _ => Ok(()), // in_progress/blocked etc. are local-only
            }
        }
        TaskMutation::Deleted { task } => {
            outbox::enqueue(pool, "task", &task.id, "delete",
                serde_json::json!({"external_id": task.external_id})).await
        }
    };
    if let Err(e) = result {
        log::warn!("todoist observer enqueue failed: {e}");
    }
}

pub async fn on_project_mutation(pool: &SqlitePool, m: ProjectMutation<'_>) {
    if !active(pool).await {
        return;
    }
    let result = match m {
        ProjectMutation::Created(p) => {
            if p.external_id.is_some() || p.id == "inbox" {
                return;
            }
            outbox::enqueue(pool, "project", &p.id, "create", serde_json::json!({"name": p.name})).await
        }
        ProjectMutation::Renamed(p) => {
            // section pseudo-projects and inbox are never renamed remotely from here
            if p.id == "inbox" || p.external_id.as_deref().is_some_and(|e| e.starts_with("section:")) {
                return;
            }
            outbox::enqueue(pool, "project", &p.id, "update", serde_json::json!({"name": p.name})).await
        }
        ProjectMutation::Deleted { project } => {
            if project.external_id.as_deref().is_some_and(|e| e.starts_with("section:")) {
                return;
            }
            outbox::enqueue(pool, "project", &project.id, "delete",
                serde_json::json!({"external_id": project.external_id})).await
        }
    };
    if let Err(e) = result {
        log::warn!("todoist observer enqueue failed: {e}");
    }
}

/// Called by db/sync.rs after applying a Turso-pulled row (phone-originated change).
/// No field diff is available, so linked rows get a full update; unlinked rows get a create.
pub async fn on_turso_row_applied(
    pool: &SqlitePool,
    table: &str,
    row_id: &str,
    pre_delete_external_id: Option<String>,
    deleted: bool,
) {
    if !active(pool).await {
        return;
    }
    if table == "local_tasks" {
        if deleted {
            let _ = outbox::enqueue(pool, "task", row_id, "delete",
                serde_json::json!({"external_id": pre_delete_external_id})).await;
            return;
        }
        let task: Option<LocalTask> = sqlx::query_as(
            &format!("SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS),
        )
        .bind(row_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        let Some(task) = task else { return };
        if task.external_id.is_none() {
            on_task_mutation(pool, TaskMutation::Created(&task)).await;
        } else {
            let fields: Vec<String> = ["content", "description", "due_date", "priority", "project_id"]
                .iter().map(|s| s.to_string()).collect();
            on_task_mutation(pool, TaskMutation::Updated { task: &task, fields_changed: &fields }).await;
            // completion state may have flipped on the phone; close/reopen is
            // resolved by the push builder comparing task.completed to the
            // stored snapshot's checked (Task 10), not enqueued blindly here.
        }
    }
}

pub async fn seed_outbox_for_unlinked(pool: &SqlitePool) -> crate::Result<(usize, usize)> {
    let mut tasks_seeded = 0usize;
    let mut projects_seeded = 0usize;
    let projects = crate::db::projects::get_projects(pool).await?;
    for p in projects {
        if p.external_id.is_none() && p.id != "inbox"
            && outbox::pending_create_temp_id(pool, &p.id).await?.is_none()
        {
            outbox::enqueue(pool, "project", &p.id, "create", serde_json::json!({"name": p.name})).await?;
            projects_seeded += 1;
        }
    }
    let tasks: Vec<LocalTask> = sqlx::query_as(
        &format!("SELECT {} FROM local_tasks WHERE completed = 0 AND external_id IS NULL", crate::db::tasks::SELECT_COLS),
    )
    .fetch_all(pool)
    .await?;
    for t in tasks {
        if outbox::pending_create_temp_id(pool, &t.id).await?.is_none() {
            outbox::enqueue(pool, "task", &t.id, "create", task_create_payload(&t)).await?;
            tasks_seeded += 1;
        }
    }
    Ok((tasks_seeded, projects_seeded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::todoist::outbox;
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, UpdateTaskInput};

    async fn activate(pool: &sqlx::SqlitePool) {
        crate::integrations::ensure_state(pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(pool, "todoist_api_token", "tok").await.unwrap();
    }

    #[tokio::test]
    async fn disabled_adapter_enqueues_nothing() {
        let pool = test_pool().await;
        let t = crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        on_task_mutation(&pool, TaskMutation::Created(&t)).await;
        assert!(outbox::pending_batch(&pool, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn create_enqueues_item_create_payload() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput {
                content: "Call vet".to_string(),
                priority: Some(3),
                due_date: Some("2026-08-06".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // create_local_task itself calls the observer (wired in step 4), so the op is already there
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "create");
        assert_eq!(batch[0].payload["content"], "Call vet");
        assert_eq!(batch[0].payload["due_date"], "2026-08-06");
        assert_eq!(batch[0].payload["priority"], 3);
        assert_eq!(batch[0].local_id, t.id);
    }

    #[tokio::test]
    async fn completion_toggle_enqueues_close_then_reopen() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "complete", None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "todo", None).await.unwrap();
        let ops: Vec<String> = outbox::pending_batch(&pool, 10).await.unwrap().into_iter().map(|r| r.op).collect();
        assert_eq!(ops, vec!["create", "close", "reopen"]);
    }

    #[tokio::test]
    async fn local_only_status_change_enqueues_nothing_extra() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "in_progress", None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "blocked", Some("waiting")).await.unwrap();
        let ops: Vec<String> = outbox::pending_batch(&pool, 10).await.unwrap().into_iter().map(|r| r.op).collect();
        assert_eq!(ops, vec!["create"]); // only the creation op
    }

    #[tokio::test]
    async fn project_change_enqueues_move() {
        let pool = test_pool().await;
        activate(&pool).await;
        let p = crate::db::projects::create_project(&pool, "Errands", "#fff").await.unwrap();
        let t = crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput { content: "x".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        crate::db::tasks::update_local_task(
            &pool,
            &t.id,
            UpdateTaskInput { project_id: Some(p.id.clone()), ..Default::default() },
        )
        .await
        .unwrap();
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        // project create + task create + move
        let moves: Vec<_> = batch.iter().filter(|r| r.op == "move").collect();
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].payload["project_local_id"], p.id);
    }

    #[tokio::test]
    async fn seed_backfills_unlinked_open_tasks_once() {
        let pool = test_pool().await;
        // create BEFORE activation → no ops enqueued yet
        crate::db::tasks::create_local_task(
            &pool,
            CreateTaskInput { content: "old task".to_string(), ..Default::default() },
        )
        .await
        .unwrap();
        activate(&pool).await;
        let (tasks_seeded, _projects_seeded) = seed_outbox_for_unlinked(&pool).await.unwrap();
        assert_eq!(tasks_seeded, 1);
        // idempotent
        let (again, _) = seed_outbox_for_unlinked(&pool).await.unwrap();
        assert_eq!(again, 0);
    }
}
