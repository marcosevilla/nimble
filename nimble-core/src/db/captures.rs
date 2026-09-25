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

/// `%word%` LIKE patterns, one per whitespace-separated word of `query`, with
/// `\`, `%` and `_` escaped (bind them with `ESCAPE '\'`). Empty for a blank
/// query. Shared by the Omnibar searches here and in `goals::search_goals`.
pub(crate) fn like_patterns(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(|word| {
            let escaped = word.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            format!("%{escaped}%")
        })
        .collect()
}

/// Omnibar Notes group: captures holding every word of `query` (LIKE, ASCII
/// case-insensitive), newest first. Converted captures stay out, like the
/// Inbox. A blank query returns nothing. `limit` is clamped to 1..=200.
pub async fn search_captures(pool: &SqlitePool, query: &str, limit: i64) -> crate::Result<Vec<Capture>> {
    let patterns = like_patterns(query);
    if patterns.is_empty() {
        return Ok(Vec::new());
    }
    let mut sql = String::from(
        "SELECT id, content, source, converted_to_task_id, routed_to, context, created_at FROM captures WHERE converted_to_task_id IS NULL",
    );
    for _ in &patterns {
        sql.push_str(" AND content LIKE ? ESCAPE '\\'");
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    let mut q = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, Option<String>, String)>(&sql);
    for p in &patterns {
        q = q.bind(p.as_str());
    }
    let rows = q.bind(limit.clamp(1, 200)).fetch_all(pool).await?;
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

#[cfg(test)]
mod omnibar_search_tests {
    use super::*;
    use crate::test_util::test_pool;

    async fn insert(pool: &SqlitePool, id: &str, content: &str, created_at: &str) {
        sqlx::query("INSERT INTO captures (id, content, source, created_at) VALUES (?, ?, 'manual', ?)")
            .bind(id)
            .bind(content)
            .bind(created_at)
            .execute(pool)
            .await
            .unwrap();
    }

    fn ids(caps: &[Capture]) -> Vec<&str> {
        caps.iter().map(|c| c.id.as_str()).collect()
    }

    #[tokio::test]
    async fn search_captures_needs_every_word_and_lists_newest_first() {
        let pool = test_pool().await;
        insert(&pool, "old", "Portola recap for Sara", "2026-09-01 09:00:00").await;
        insert(&pool, "new", "portola RECAP draft", "2026-09-20 09:00:00").await;
        insert(&pool, "other", "Portola credentials", "2026-09-21 09:00:00").await;
        let hits = search_captures(&pool, "  portola   recap ", 20).await.unwrap();
        assert_eq!(ids(&hits), vec!["new", "old"]);
    }

    #[tokio::test]
    async fn search_captures_leaves_out_converted_captures() {
        let pool = test_pool().await;
        insert(&pool, "kept", "portola shot list", "2026-09-01 09:00:00").await;
        insert(&pool, "done", "portola will call", "2026-09-02 09:00:00").await;
        sqlx::query("UPDATE captures SET converted_to_task_id = 'task-1' WHERE id = 'done'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(ids(&search_captures(&pool, "portola", 20).await.unwrap()), vec!["kept"]);
    }

    #[tokio::test]
    async fn search_captures_caps_at_the_limit() {
        let pool = test_pool().await;
        insert(&pool, "a", "run 1", "2026-09-01 09:00:00").await;
        insert(&pool, "b", "run 2", "2026-09-02 09:00:00").await;
        insert(&pool, "c", "run 3", "2026-09-03 09:00:00").await;
        assert_eq!(ids(&search_captures(&pool, "run", 2).await.unwrap()), vec!["c", "b"]);
    }

    #[tokio::test]
    async fn search_captures_blank_query_returns_nothing() {
        let pool = test_pool().await;
        insert(&pool, "a", "anything", "2026-09-01 09:00:00").await;
        assert!(search_captures(&pool, "", 20).await.unwrap().is_empty());
        assert!(search_captures(&pool, "   ", 20).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn search_captures_treats_like_wildcards_as_text() {
        let pool = test_pool().await;
        insert(&pool, "pct", "100% done", "2026-09-01 09:00:00").await;
        insert(&pool, "plain", "100 done", "2026-09-02 09:00:00").await;
        insert(&pool, "snake", "snake_case name", "2026-09-03 09:00:00").await;
        assert_eq!(ids(&search_captures(&pool, "100%", 20).await.unwrap()), vec!["pct"]);
        assert_eq!(ids(&search_captures(&pool, "_", 20).await.unwrap()), vec!["snake"]);
    }
}
