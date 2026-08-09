use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::activity;
use crate::db::sync;
use crate::types::Capture;

/// Get captures from SQLite, newest first
pub async fn get_captures(
    pool: &SqlitePool,
    limit: i64,
    include_converted: bool,
) -> crate::Result<Vec<Capture>> {
    let rows: Vec<(String, String, String, Option<String>, Option<String>, Option<String>, String)> = if include_converted {
        sqlx::query_as(
            "SELECT id, content, source, converted_to_task_id, routed_to, context, created_at FROM captures ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, content, source, converted_to_task_id, routed_to, context, created_at FROM captures WHERE converted_to_task_id IS NULL ORDER BY created_at DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|(id, content, source, converted_to_task_id, routed_to, context, created_at)| Capture {
            id,
            content,
            source,
            converted_to_task_id,
            routed_to,
            context,
            created_at,
        })
        .collect())
}

/// Create a new capture in SQLite
pub async fn create_capture(
    pool: &SqlitePool,
    content: &str,
    source: &str,
    context: Option<&str>,
) -> crate::Result<Capture> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO captures (id, content, source, context, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(content)
    .bind(source)
    .bind(context)
    .bind(&now)
    .execute(pool)
    .await?;

    activity::log_activity(
        pool,
        "item_captured",
        Some(&id),
        Some(serde_json::json!({ "content": content, "source": source })),
    )
    .await;

    let capture = Capture {
        id,
        content: content.to_string(),
        source: source.to_string(),
        converted_to_task_id: None,
        routed_to: None,
        context: context.map(|s| s.to_string()),
        created_at: now,
    };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&capture).unwrap_or_default();
    sync::append_sync_log(pool, "captures", &capture.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(capture)
}

/// Get a capture by ID (content only)
pub async fn get_capture_content(pool: &SqlitePool, capture_id: &str) -> crate::Result<Option<(String, String)>> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT id, content FROM captures WHERE id = ?",
    )
    .bind(capture_id)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Mark capture as converted to a task
pub async fn mark_capture_converted(pool: &SqlitePool, capture_id: &str, task_id: &str) -> crate::Result<()> {
    sqlx::query(
        "UPDATE captures SET converted_to_task_id = ? WHERE id = ?",
    )
    .bind(task_id)
    .bind(capture_id)
    .execute(pool)
    .await?;

    activity::log_activity(
        pool,
        "capture_converted",
        Some(capture_id),
        Some(serde_json::json!({ "task_id": task_id })),
    )
    .await;

    // Sync log: UPDATE
    let changed = serde_json::json!(["converted_to_task_id"]).to_string();
    let row: Option<(String, String, String, Option<String>, Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT id, content, source, converted_to_task_id, routed_to, context, created_at FROM captures WHERE id = ?"
    ).bind(capture_id).fetch_optional(pool).await.ok().flatten();
    if let Some((id, content, source, converted_to_task_id, routed_to, context, created_at)) = row {
        let capture = Capture { id, content, source, converted_to_task_id, routed_to, context, created_at };
        let snapshot = serde_json::to_string(&capture).unwrap_or_default();
        sync::append_sync_log(pool, "captures", capture_id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    Ok(())
}

/// Delete a capture
pub async fn delete_capture(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("DELETE FROM captures WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "captures", id, "DELETE", None, None).await.ok();

    Ok(())
}

/// Insert a capture if no existing capture has the same content
pub async fn insert_capture_if_new(pool: &SqlitePool, content: &str) -> bool {
    let exists: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM captures WHERE content = ?",
    )
    .bind(content)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    if exists.map(|r| r.0).unwrap_or(0) > 0 {
        return false;
    }

    // Strip timestamp line if present
    let lines: Vec<&str> = content.lines().collect();
    let (actual_content, _timestamp) = if !lines.is_empty() {
        let first = lines[0].trim();
        if first.contains("202") && (first.contains("AM") || first.contains("PM")) {
            (lines[1..].join("\n").trim().to_string(), Some(first.to_string()))
        } else {
            (content.to_string(), None)
        }
    } else {
        (content.to_string(), None)
    };

    if actual_content.is_empty() {
        return false;
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO captures (id, content, source, created_at) VALUES (?, ?, 'obsidian_import', datetime('now', 'localtime'))",
    )
    .bind(&id)
    .bind(&actual_content)
    .execute(pool)
    .await
    .is_ok()
}

/// Save a capture with routed_to for history
pub async fn save_routed_capture(
    pool: &SqlitePool,
    content: &str,
    label: &str,
) -> crate::Result<String> {
    let capture_id = Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO captures (id, content, source, routed_to, created_at) VALUES (?, ?, 'route', ?, ?)",
    )
    .bind(&capture_id)
    .bind(content)
    .bind(label)
    .bind(&now)
    .execute(pool)
    .await?;

    // Sync log: INSERT
    let capture = Capture {
        id: capture_id.clone(),
        content: content.to_string(),
        source: "route".to_string(),
        converted_to_task_id: None,
        routed_to: Some(label.to_string()),
        context: None,
        created_at: now,
    };
    let snapshot = serde_json::to_string(&capture).unwrap_or_default();
    sync::append_sync_log(pool, "captures", &capture_id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(capture_id)
}
