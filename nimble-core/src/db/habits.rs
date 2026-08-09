use chrono::Local;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::{Habit, HabitHeatmapEntry, HabitLog, HabitWithStats};

fn row_to_habit(
    row: (String, String, Option<String>, String, String, i64, i64, String),
) -> Habit {
    Habit {
        id: row.0,
        name: row.1,
        category: row.2,
        icon: row.3,
        color: row.4,
        active: row.5 != 0,
        position: row.6,
        created_at: row.7,
    }
}

/// Calculate momentum: weighted score over last 30 days.
pub async fn compute_momentum(pool: &SqlitePool, habit_id: &str) -> f64 {
    let today = Local::now().format("%Y-%m-%d").to_string();

    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT date, intensity FROM habit_logs WHERE habit_id = ? AND date >= date(?, '-30 days') AND date <= ?",
    )
    .bind(habit_id)
    .bind(&today)
    .bind(&today)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return 0.0;
    }

    let today_date = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").unwrap();
    let max_intensity: f64 = 5.0;

    let mut weighted_sum: f64 = 0.0;
    let mut max_possible: f64 = 0.0;

    for days_ago in 0..30 {
        let decay: f64 = 0.95_f64.powi(days_ago);
        max_possible += max_intensity * decay;
    }

    for (date_str, intensity) in &rows {
        if let Ok(log_date) = chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            let days_ago = (today_date - log_date).num_days();
            if days_ago >= 0 && days_ago < 30 {
                let decay: f64 = 0.95_f64.powi(days_ago as i32);
                weighted_sum += *intensity as f64 * decay;
            }
        }
    }

    if max_possible > 0.0 {
        (weighted_sum / max_possible * 100.0).min(100.0)
    } else {
        0.0
    }
}

pub async fn get_habits(pool: &SqlitePool) -> crate::Result<Vec<HabitWithStats>> {
    let today = Local::now().format("%Y-%m-%d").to_string();

    let rows: Vec<(String, String, Option<String>, String, String, i64, i64, String)> =
        sqlx::query_as(
            "SELECT id, name, category, icon, color, active, position, created_at FROM habits ORDER BY position, created_at",
        )
        .fetch_all(pool)
        .await?;

    let mut results = Vec::new();
    for row in rows {
        let habit = row_to_habit(row);

        let today_log: Option<(i64,)> = sqlx::query_as(
            "SELECT intensity FROM habit_logs WHERE habit_id = ? AND date = ?",
        )
        .bind(&habit.id)
        .bind(&today)
        .fetch_optional(pool)
        .await?;

        let today_completed = today_log.is_some();
        let today_intensity = today_log.map(|r| r.0).unwrap_or(0);

        let momentum = compute_momentum(pool, &habit.id).await;

        results.push(HabitWithStats {
            id: habit.id,
            name: habit.name,
            category: habit.category,
            icon: habit.icon,
            color: habit.color,
            active: habit.active,
            position: habit.position,
            created_at: habit.created_at,
            current_momentum: momentum,
            today_completed,
            today_intensity,
        });
    }

    Ok(results)
}

pub async fn create_habit(
    pool: &SqlitePool,
    name: &str,
    category: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
) -> crate::Result<Habit> {
    let id = Uuid::new_v4().to_string();
    let icon = icon.unwrap_or("Circle");
    let color = color.unwrap_or("#f59e0b");

    let max_pos: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM habits")
            .fetch_one(pool)
            .await?;

    sqlx::query(
        "INSERT INTO habits (id, name, category, icon, color, position) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(category)
    .bind(icon)
    .bind(color)
    .bind(max_pos + 1)
    .execute(pool)
    .await?;

    activity::log_activity(pool, "habit_created", Some(&id), Some(serde_json::json!({ "name": name }))).await;

    let habit = Habit {
        id,
        name: name.to_string(),
        category: category.map(|s| s.to_string()),
        icon: icon.to_string(),
        color: color.to_string(),
        active: true,
        position: max_pos + 1,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&habit).unwrap_or_default();
    sync::append_sync_log(pool, "habits", &habit.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(habit)
}

pub async fn update_habit(
    pool: &SqlitePool,
    id: &str,
    name: Option<&str>,
    category: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
    active: Option<bool>,
) -> crate::Result<()> {
    let mut fields_changed = Vec::new();
    if let Some(val) = name {
        sqlx::query("UPDATE habits SET name = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("name");
    }
    if let Some(val) = category {
        sqlx::query("UPDATE habits SET category = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("category");
    }
    if let Some(val) = icon {
        sqlx::query("UPDATE habits SET icon = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("icon");
    }
    if let Some(val) = color {
        sqlx::query("UPDATE habits SET color = ? WHERE id = ?").bind(val).bind(id).execute(pool).await?;
        fields_changed.push("color");
    }
    if let Some(val) = active {
        sqlx::query("UPDATE habits SET active = ? WHERE id = ?").bind(val as i64).bind(id).execute(pool).await?;
        fields_changed.push("active");
    }

    // Sync log: UPDATE
    if !fields_changed.is_empty() {
        let row: Option<(String, String, Option<String>, String, String, i64, i64, String)> =
            sqlx::query_as("SELECT id, name, category, icon, color, active, position, created_at FROM habits WHERE id = ?")
                .bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some(r) = row {
            let habit = row_to_habit(r);
            let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
            let snapshot = serde_json::to_string(&habit).unwrap_or_default();
            sync::append_sync_log(pool, "habits", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }

    Ok(())
}

pub async fn delete_habit(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    // Sync log for habit_logs deletes
    let log_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM habit_logs WHERE habit_id = ?")
        .bind(id).fetch_all(pool).await.unwrap_or_default();
    for (lid,) in &log_ids {
        sync::append_sync_log(pool, "habit_logs", lid, "DELETE", None, None).await.ok();
    }

    sqlx::query("DELETE FROM habit_logs WHERE habit_id = ?").bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM habits WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "habits", id, "DELETE", None, None).await.ok();

    activity::log_activity(pool, "habit_deleted", Some(id), None).await;
    Ok(())
}

pub async fn log_habit(pool: &SqlitePool, habit_id: &str, date: Option<&str>, intensity: Option<i64>) -> crate::Result<HabitLog> {
    let date = date.map(|s| s.to_string()).unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let intensity = intensity.unwrap_or(5);
    let id = Uuid::new_v4().to_string();

    sqlx::query("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?")
        .bind(habit_id).bind(&date).execute(pool).await?;

    sqlx::query("INSERT INTO habit_logs (id, habit_id, date, intensity) VALUES (?, ?, ?, ?)")
        .bind(&id).bind(habit_id).bind(&date).bind(intensity).execute(pool).await?;

    activity::log_activity(pool, "habit_logged", Some(habit_id), Some(serde_json::json!({ "date": &date, "intensity": intensity }))).await;

    let habit_log = HabitLog {
        id,
        habit_id: habit_id.to_string(),
        date,
        intensity,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    // Sync log: INSERT (the delete+insert is effectively a replace)
    let snapshot = serde_json::to_string(&habit_log).unwrap_or_default();
    sync::append_sync_log(pool, "habit_logs", &habit_log.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(habit_log)
}

pub async fn unlog_habit(pool: &SqlitePool, habit_id: &str, date: Option<&str>) -> crate::Result<()> {
    let date = date.map(|s| s.to_string()).unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());

    // Get the log ID before deleting for sync
    let log_id: Option<(String,)> = sqlx::query_as("SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?")
        .bind(habit_id).bind(&date).fetch_optional(pool).await.ok().flatten();

    sqlx::query("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?")
        .bind(habit_id).bind(&date).execute(pool).await?;

    // Sync log: DELETE
    if let Some((lid,)) = log_id {
        sync::append_sync_log(pool, "habit_logs", &lid, "DELETE", None, None).await.ok();
    }

    Ok(())
}

pub async fn get_habit_logs(pool: &SqlitePool, habit_id: Option<&str>, days: i64) -> crate::Result<Vec<HabitLog>> {
    let from_date = (Local::now() - chrono::Duration::days(days)).format("%Y-%m-%d").to_string();

    let rows: Vec<(String, String, String, i64, String)> = if let Some(hid) = habit_id {
        sqlx::query_as(
            "SELECT id, habit_id, date, intensity, created_at FROM habit_logs WHERE habit_id = ? AND date >= ? ORDER BY date DESC",
        )
        .bind(hid).bind(&from_date).fetch_all(pool).await?
    } else {
        sqlx::query_as(
            "SELECT id, habit_id, date, intensity, created_at FROM habit_logs WHERE date >= ? ORDER BY date DESC",
        )
        .bind(&from_date).fetch_all(pool).await?
    };

    Ok(rows.into_iter().map(|(id, habit_id, date, intensity, created_at)| HabitLog { id, habit_id, date, intensity, created_at }).collect())
}

pub async fn get_habit_heatmap(pool: &SqlitePool, habit_id: Option<&str>, days: i64) -> crate::Result<Vec<HabitHeatmapEntry>> {
    let from_date = (Local::now() - chrono::Duration::days(days)).format("%Y-%m-%d").to_string();

    let rows: Vec<(String, i64)> = if let Some(hid) = habit_id {
        sqlx::query_as(
            "SELECT date, MAX(intensity) as intensity FROM habit_logs WHERE habit_id = ? AND date >= ? GROUP BY date ORDER BY date",
        )
        .bind(hid).bind(&from_date).fetch_all(pool).await?
    } else {
        sqlx::query_as(
            "SELECT date, MAX(intensity) as intensity FROM habit_logs WHERE date >= ? GROUP BY date ORDER BY date",
        )
        .bind(&from_date).fetch_all(pool).await?
    };

    Ok(rows.into_iter().map(|(date, intensity)| HabitHeatmapEntry { date, intensity }).collect())
}
