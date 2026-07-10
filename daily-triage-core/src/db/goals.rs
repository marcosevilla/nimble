use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::{Goal, GoalWithProgress, LifeArea, Milestone};

// --- Helper conversions ---

fn row_to_goal(
    row: (
        String,
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        String,
        String,
    ),
) -> Goal {
    Goal {
        id: row.0,
        name: row.1,
        description: row.2,
        status: row.3,
        life_area_id: row.4,
        start_date: row.5,
        target_date: row.6,
        color: row.7,
        position: row.8,
        created_at: row.9,
        updated_at: row.10,
    }
}

fn row_to_milestone(
    row: (
        String,
        String,
        String,
        Option<String>,
        i64,
        Option<String>,
        i64,
        String,
    ),
) -> Milestone {
    Milestone {
        id: row.0,
        goal_id: row.1,
        name: row.2,
        target_date: row.3,
        completed: row.4 != 0,
        completed_at: row.5,
        position: row.6,
        created_at: row.7,
    }
}

const GOAL_SELECT: &str = "id, name, description, status, life_area_id, start_date, target_date, color, position, created_at, updated_at";

pub async fn compute_progress(pool: &SqlitePool, goal_id: &str) -> (f64, i64, i64, i64, i64) {
    let milestone_row: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*) as total, COALESCE(SUM(completed), 0) as done FROM milestones WHERE goal_id = ?",
    )
    .bind(goal_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0, 0));

    let milestone_count = milestone_row.0;
    let milestone_completed = milestone_row.1;

    let task_row: (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as done FROM local_tasks WHERE project_id IN (SELECT id FROM projects WHERE goal_id = ?)",
    )
    .bind(goal_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0, 0));

    let task_count = task_row.0;
    let task_completed = task_row.1;

    let progress = if milestone_count > 0 {
        milestone_completed as f64 / milestone_count as f64
    } else if task_count > 0 {
        task_completed as f64 / task_count as f64
    } else {
        0.0
    };

    (progress, milestone_count, milestone_completed, task_count, task_completed)
}

fn goal_with_progress(goal: Goal, progress: f64, mc: i64, md: i64, tc: i64, td: i64) -> GoalWithProgress {
    GoalWithProgress {
        id: goal.id,
        name: goal.name,
        description: goal.description,
        status: goal.status,
        life_area_id: goal.life_area_id,
        start_date: goal.start_date,
        target_date: goal.target_date,
        color: goal.color,
        position: goal.position,
        created_at: goal.created_at,
        updated_at: goal.updated_at,
        progress,
        milestone_count: mc,
        milestone_completed: md,
        task_count: tc,
        task_completed: td,
    }
}

// --- Goal operations ---

pub async fn get_goals(pool: &SqlitePool) -> crate::Result<Vec<GoalWithProgress>> {
    let rows: Vec<(
        String, String, Option<String>, String, Option<String>,
        Option<String>, Option<String>, Option<String>, i64, String, String,
    )> = sqlx::query_as(&format!(
        "SELECT {} FROM goals ORDER BY position, created_at",
        GOAL_SELECT
    ))
    .fetch_all(pool)
    .await?;

    let mut results = Vec::new();
    for row in rows {
        let goal = row_to_goal(row);
        let (progress, mc, md, tc, td) = compute_progress(pool, &goal.id).await;
        results.push(goal_with_progress(goal, progress, mc, md, tc, td));
    }

    Ok(results)
}

pub async fn get_goal(pool: &SqlitePool, id: &str) -> crate::Result<GoalWithProgress> {
    let row: (
        String, String, Option<String>, String, Option<String>,
        Option<String>, Option<String>, Option<String>, i64, String, String,
    ) = sqlx::query_as(&format!(
        "SELECT {} FROM goals WHERE id = ?",
        GOAL_SELECT
    ))
    .bind(id)
    .fetch_one(pool)
    .await?;

    let goal = row_to_goal(row);
    let (progress, mc, md, tc, td) = compute_progress(pool, &goal.id).await;

    Ok(goal_with_progress(goal, progress, mc, md, tc, td))
}

pub async fn create_goal(
    pool: &SqlitePool,
    name: &str,
    description: Option<&str>,
    status: Option<&str>,
    life_area_id: Option<&str>,
    start_date: Option<&str>,
    target_date: Option<&str>,
    color: Option<&str>,
) -> crate::Result<Goal> {
    let id = Uuid::new_v4().to_string();
    let status = status.unwrap_or("active");

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM goals")
            .fetch_one(pool)
            .await?;

    sqlx::query(
        "INSERT INTO goals (id, name, description, status, life_area_id, start_date, target_date, color, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(description)
    .bind(status)
    .bind(life_area_id)
    .bind(start_date)
    .bind(target_date)
    .bind(color)
    .bind(max_pos + 1)
    .execute(pool)
    .await?;

    activity::log_activity(
        pool,
        "goal_created",
        Some(&id),
        Some(serde_json::json!({ "name": name })),
    )
    .await;

    let goal = Goal {
        id,
        name: name.to_string(),
        description: description.map(|s| s.to_string()),
        status: status.to_string(),
        life_area_id: life_area_id.map(|s| s.to_string()),
        start_date: start_date.map(|s| s.to_string()),
        target_date: target_date.map(|s| s.to_string()),
        color: color.map(|s| s.to_string()),
        position: max_pos + 1,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        updated_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&goal).unwrap_or_default();
    sync::append_sync_log(pool, "goals", &goal.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(goal)
}

pub async fn update_goal(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    status: Option<&str>,
    life_area_id: Option<&str>,
    start_date: Option<&str>,
    target_date: Option<&str>,
    color: Option<&str>,
) -> crate::Result<()> {
    if let Some(val) = name {
        sqlx::query("UPDATE goals SET name = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(val).bind(id).execute(pool).await?;
    }
    if let Some(val) = description {
        sqlx::query("UPDATE goals SET description = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(val).bind(id).execute(pool).await?;
    }
    if let Some(val) = status {
        sqlx::query("UPDATE goals SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(val).bind(id).execute(pool).await?;
    }
    // Empty string clears the nullable fields below (None = leave unchanged)
    if let Some(val) = life_area_id {
        sqlx::query("UPDATE goals SET life_area_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(if val.is_empty() { None } else { Some(val) }).bind(id).execute(pool).await?;
    }
    if let Some(val) = start_date {
        sqlx::query("UPDATE goals SET start_date = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(if val.is_empty() { None } else { Some(val) }).bind(id).execute(pool).await?;
    }
    if let Some(val) = target_date {
        sqlx::query("UPDATE goals SET target_date = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(if val.is_empty() { None } else { Some(val) }).bind(id).execute(pool).await?;
    }
    if let Some(val) = color {
        sqlx::query("UPDATE goals SET color = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(val).bind(id).execute(pool).await?;
    }

    let mut fields_changed = Vec::new();
    if name.is_some() { fields_changed.push("name"); }
    if description.is_some() { fields_changed.push("description"); }
    if status.is_some() { fields_changed.push("status"); }
    if life_area_id.is_some() { fields_changed.push("life_area_id"); }
    if start_date.is_some() { fields_changed.push("start_date"); }
    if target_date.is_some() { fields_changed.push("target_date"); }
    if color.is_some() { fields_changed.push("color"); }

    if !fields_changed.is_empty() {
        activity::log_activity(pool, "goal_updated", Some(id), Some(serde_json::json!({ "fields_changed": fields_changed }))).await;

        // Sync log: UPDATE
        let row: Option<(String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, String, String)> =
            sqlx::query_as(&format!("SELECT {} FROM goals WHERE id = ?", GOAL_SELECT))
                .bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some(r) = row {
            let goal = row_to_goal(r);
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&goal).unwrap_or_default();
            sync::append_sync_log(pool, "goals", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    Ok(())
}

pub async fn delete_goal(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    // Sync log for milestone deletes
    let milestone_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM milestones WHERE goal_id = ?")
        .bind(id).fetch_all(pool).await.unwrap_or_default();
    for (mid,) in &milestone_ids {
        sync::append_sync_log(pool, "milestones", mid, "DELETE", None, None).await.ok();
    }

    sqlx::query("DELETE FROM milestones WHERE goal_id = ?").bind(id).execute(pool).await?;
    sqlx::query("UPDATE projects SET goal_id = NULL, milestone_id = NULL WHERE goal_id = ?").bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM goals WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "goals", id, "DELETE", None, None).await.ok();

    activity::log_activity(pool, "goal_deleted", Some(id), None).await;
    Ok(())
}

// --- Milestone operations ---

pub async fn get_milestones(pool: &SqlitePool, goal_id: &str) -> crate::Result<Vec<Milestone>> {
    let rows: Vec<(String, String, String, Option<String>, i64, Option<String>, i64, String)> = sqlx::query_as(
        "SELECT id, goal_id, name, target_date, completed, completed_at, position, created_at FROM milestones WHERE goal_id = ? ORDER BY position, created_at",
    )
    .bind(goal_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(row_to_milestone).collect())
}

pub async fn create_milestone(pool: &SqlitePool, goal_id: &str, name: &str, target_date: Option<&str>) -> crate::Result<Milestone> {
    let id = Uuid::new_v4().to_string();

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM milestones WHERE goal_id = ?")
            .bind(goal_id)
            .fetch_one(pool)
            .await?;

    sqlx::query(
        "INSERT INTO milestones (id, goal_id, name, target_date, position) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(goal_id)
    .bind(name)
    .bind(target_date)
    .bind(max_pos + 1)
    .execute(pool)
    .await?;

    activity::log_activity(pool, "milestone_created", Some(&id), Some(serde_json::json!({ "goal_id": goal_id, "name": name }))).await;

    let milestone = Milestone {
        id,
        goal_id: goal_id.to_string(),
        name: name.to_string(),
        target_date: target_date.map(|s| s.to_string()),
        completed: false,
        completed_at: None,
        position: max_pos + 1,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&milestone).unwrap_or_default();
    sync::append_sync_log(pool, "milestones", &milestone.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(milestone)
}

pub async fn update_milestone(pool: &SqlitePool, id: &str, name: Option<&str>, target_date: Option<&str>, completed: Option<bool>) -> crate::Result<()> {
    let mut fields_changed = Vec::new();
    if let Some(val) = name {
        sqlx::query("UPDATE milestones SET name = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("name");
    }
    if let Some(val) = target_date {
        sqlx::query("UPDATE milestones SET target_date = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("target_date");
    }
    if let Some(done) = completed {
        if done {
            sqlx::query("UPDATE milestones SET completed = 1, completed_at = datetime('now', 'localtime') WHERE id = ?")
                .bind(id).execute(pool).await?;
            activity::log_activity(pool, "milestone_completed", Some(id), None).await;
        } else {
            sqlx::query("UPDATE milestones SET completed = 0, completed_at = NULL WHERE id = ?")
                .bind(id).execute(pool).await?;
        }
        fields_changed.push("completed");
        fields_changed.push("completed_at");
    }

    // Sync log: UPDATE
    if !fields_changed.is_empty() {
        let row: Option<(String, String, String, Option<String>, i64, Option<String>, i64, String)> =
            sqlx::query_as("SELECT id, goal_id, name, target_date, completed, completed_at, position, created_at FROM milestones WHERE id = ?")
                .bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some(r) = row {
            let milestone = row_to_milestone(r);
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&milestone).unwrap_or_default();
            sync::append_sync_log(pool, "milestones", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    Ok(())
}

pub async fn delete_milestone(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("UPDATE projects SET milestone_id = NULL WHERE milestone_id = ?").bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM milestones WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "milestones", id, "DELETE", None, None).await.ok();

    activity::log_activity(pool, "milestone_deleted", Some(id), None).await;
    Ok(())
}

// --- Life Area operations ---

pub async fn get_life_areas(pool: &SqlitePool) -> crate::Result<Vec<LifeArea>> {
    let rows: Vec<(String, String, String, String, i64, String)> = sqlx::query_as(
        "SELECT id, name, color, icon, position, created_at FROM life_areas ORDER BY position",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, name, color, icon, position, created_at)| LifeArea { id, name, color, icon, position, created_at }).collect())
}

pub async fn create_life_area(pool: &SqlitePool, name: &str, color: &str, icon: &str) -> crate::Result<LifeArea> {
    let id = Uuid::new_v4().to_string();

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM life_areas")
            .fetch_one(pool)
            .await?;

    sqlx::query("INSERT INTO life_areas (id, name, color, icon, position) VALUES (?, ?, ?, ?, ?)")
        .bind(&id).bind(name).bind(color).bind(icon).bind(max_pos + 1)
        .execute(pool).await?;

    let life_area = LifeArea {
        id,
        name: name.to_string(),
        color: color.to_string(),
        icon: icon.to_string(),
        position: max_pos + 1,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&life_area).unwrap_or_default();
    sync::append_sync_log(pool, "life_areas", &life_area.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(life_area)
}

pub async fn update_life_area(pool: &SqlitePool, id: &str, name: Option<&str>, color: Option<&str>, icon: Option<&str>) -> crate::Result<()> {
    let mut fields_changed = Vec::new();
    if let Some(val) = name {
        sqlx::query("UPDATE life_areas SET name = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("name");
    }
    if let Some(val) = color {
        sqlx::query("UPDATE life_areas SET color = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("color");
    }
    if let Some(val) = icon {
        sqlx::query("UPDATE life_areas SET icon = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("icon");
    }

    // Sync log: UPDATE
    if !fields_changed.is_empty() {
        let row: Option<(String, String, String, String, i64, String)> = sqlx::query_as(
            "SELECT id, name, color, icon, position, created_at FROM life_areas WHERE id = ?"
        ).bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some((lid, lname, lcolor, licon, lposition, lcreated_at)) = row {
            let la = LifeArea { id: lid, name: lname, color: lcolor, icon: licon, position: lposition, created_at: lcreated_at };
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&la).unwrap_or_default();
            sync::append_sync_log(pool, "life_areas", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    Ok(())
}

pub async fn delete_life_area(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("UPDATE goals SET life_area_id = NULL WHERE life_area_id = ?").bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM life_areas WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "life_areas", id, "DELETE", None, None).await.ok();

    Ok(())
}
