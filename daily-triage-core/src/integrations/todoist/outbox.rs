use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct OutboxRow {
    pub id: String,
    pub local_id: String,
    pub object_type: String,
    pub op: String,
    pub payload: serde_json::Value,
    pub command_uuid: String,
    pub temp_id: Option<String>,
}

pub async fn enqueue(
    pool: &SqlitePool,
    object_type: &str,
    local_id: &str,
    op: &str,
    payload: serde_json::Value,
) -> crate::Result<()> {
    if op == "delete" {
        let had_create: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op = 'create'",
        )
        .bind(local_id)
        .fetch_optional(pool)
        .await?;
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id = ? AND status = 'pending'")
            .bind(local_id)
            .execute(pool)
            .await?;
        if had_create.is_some() {
            return Ok(()); // row never existed remotely — nothing to delete there
        }
    } else if op == "update" {
        let existing: Option<(String, String)> = sqlx::query_as(
            "SELECT id, payload_json FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op IN ('create','update') ORDER BY rowid DESC LIMIT 1",
        )
        .bind(local_id)
        .fetch_optional(pool)
        .await?;
        if let Some((row_id, payload_json)) = existing {
            let mut merged: serde_json::Value =
                serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({}));
            if let (Some(m), Some(new)) = (merged.as_object_mut(), payload.as_object()) {
                for (k, v) in new {
                    m.insert(k.clone(), v.clone());
                }
            }
            sqlx::query("UPDATE todoist_outbox SET payload_json = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                .bind(merged.to_string())
                .bind(row_id)
                .execute(pool)
                .await?;
            return Ok(());
        }
    }
    let temp_id = if op == "create" { Some(uuid::Uuid::new_v4().to_string()) } else { None };
    sqlx::query(
        "INSERT INTO todoist_outbox (id, local_id, object_type, op, payload_json, command_uuid, temp_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(local_id)
    .bind(object_type)
    .bind(op)
    .bind(payload.to_string())
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(temp_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn pending_batch(pool: &SqlitePool, limit: i64) -> crate::Result<Vec<OutboxRow>> {
    let rows: Vec<(String, String, String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, local_id, object_type, op, payload_json, command_uuid, temp_id FROM todoist_outbox WHERE status = 'pending' ORDER BY rowid LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, local_id, object_type, op, payload_json, command_uuid, temp_id)| OutboxRow {
            id, local_id, object_type, op,
            payload: serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
            command_uuid, temp_id,
        })
        .collect())
}

pub async fn pending_create_temp_id(pool: &SqlitePool, local_id: &str) -> crate::Result<Option<String>> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT temp_id FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op = 'create'",
    )
    .bind(local_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(t,)| t))
}

pub async fn mark_done(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    for id in ids {
        sqlx::query("UPDATE todoist_outbox SET status = 'done', updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn mark_error(pool: &SqlitePool, id: &str, error: &str) -> crate::Result<()> {
    sqlx::query("UPDATE todoist_outbox SET status = 'error', error = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .bind(error)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn counts(pool: &SqlitePool) -> crate::Result<(i64, i64)> {
    let pending: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM todoist_outbox WHERE status = 'pending'")
        .fetch_one(pool)
        .await?;
    let errors: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM todoist_outbox WHERE status = 'error'")
        .fetch_one(pool)
        .await?;
    Ok((pending.0, errors.0))
}

pub async fn error_list(pool: &SqlitePool) -> crate::Result<Vec<(String, String, String)>> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, op, error FROM todoist_outbox WHERE status = 'error' ORDER BY rowid DESC LIMIT 50",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, op, e)| (id, op, e.unwrap_or_default())).collect())
}

pub async fn prune_done(pool: &SqlitePool) -> crate::Result<()> {
    sqlx::query("DELETE FROM todoist_outbox WHERE status = 'done' AND created_at < datetime('now', '-7 days', 'localtime')")
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use serde_json::json;

    #[tokio::test]
    async fn update_merges_into_pending_create() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a", "priority": 1})).await.unwrap();
        enqueue(&pool, "task", "t1", "update", json!({"content": "b"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "create");
        assert_eq!(batch[0].payload["content"], "b");
        assert_eq!(batch[0].payload["priority"], 1);
        assert!(batch[0].temp_id.is_some());
    }

    #[tokio::test]
    async fn update_merges_into_pending_update() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "update", json!({"due_date": "2026-08-05"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].payload["content"], "a");
        assert_eq!(batch[0].payload["due_date"], "2026-08-05");
    }

    #[tokio::test]
    async fn delete_cancels_pending_create_entirely() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "delete", json!({"external_id": null})).await.unwrap();
        assert!(pending_batch(&pool, 100).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_of_synced_row_replaces_pending_ops() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "delete", json!({"external_id": "X9"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "delete");
        assert_eq!(batch[0].payload["external_id"], "X9");
    }

    #[tokio::test]
    async fn close_and_move_append_without_merging() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "close", json!({})).await.unwrap();
        enqueue(&pool, "task", "t1", "move", json!({"project_local_id": "p2"})).await.unwrap();
        assert_eq!(pending_batch(&pool, 100).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn command_uuid_persisted_at_enqueue() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "close", json!({})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert!(!batch[0].command_uuid.is_empty());
    }
}
