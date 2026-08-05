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
        let mut tx = pool.begin().await?;
        let had_create: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op = 'create'",
        )
        .bind(local_id)
        .fetch_optional(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id = ? AND status = 'pending'")
            .bind(local_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        if had_create.is_some() {
            return Ok(()); // row never existed remotely — nothing to delete there
        }
    } else if op == "update" {
        let mut tx = pool.begin().await?;
        let existing: Option<(String, String)> = sqlx::query_as(
            "SELECT id, payload_json FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op IN ('create','update') ORDER BY rowid DESC LIMIT 1",
        )
        .bind(local_id)
        .fetch_optional(&mut *tx)
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
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(());
        }
        tx.commit().await?;
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

/// Mark rows as 'sending' immediately before they go out over HTTP. While a row
/// is 'sending' (not 'pending'), `enqueue`'s coalescer can no longer merge a
/// concurrent local edit into it — the edit lands in a fresh 'pending' row
/// instead, so it can't be silently discarded when this batch's response
/// retires the sent row (I1).
pub async fn mark_sending(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    for id in ids {
        sqlx::query("UPDATE todoist_outbox SET status = 'sending', updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Revert rows from 'sending' back to 'pending' — used when the HTTP request
/// for a batch fails outright (never resolved) or on startup recovery from a
/// crash mid-push. Idempotent: re-sending is safe because `command_uuid` was
/// already persisted at enqueue time.
pub async fn mark_pending(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    for id in ids {
        sqlx::query("UPDATE todoist_outbox SET status = 'pending', updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Startup/crash recovery: any row left in 'sending' from a previous run (the
/// app quit or crashed mid-push) gets reset to 'pending' so it's retried.
pub async fn reset_stuck_sending(pool: &SqlitePool) -> crate::Result<()> {
    sqlx::query("UPDATE todoist_outbox SET status = 'pending', updated_at = datetime('now','localtime') WHERE status = 'sending'")
        .execute(pool)
        .await?;
    Ok(())
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
    sqlx::query("DELETE FROM todoist_outbox WHERE status = 'done' AND updated_at < datetime('now', '-7 days', 'localtime')")
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

    // I1 regression: while a row is 'sending' (batch in flight), a concurrent
    // edit must NOT coalesce into it — the coalescer only targets 'pending'
    // rows, so the edit should create a fresh pending row that survives even
    // after the in-flight row is retired by mark_done.
    #[tokio::test]
    async fn update_during_sending_creates_new_pending_row_instead_of_coalescing() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        let in_flight_id = batch[0].id.clone();

        // Simulate push_outbox marking the row 'sending' right before the HTTP call.
        mark_sending(&pool, &[in_flight_id.clone()]).await.unwrap();

        // A local edit arrives while the batch is in flight.
        enqueue(&pool, "task", "t1", "update", json!({"content": "b"})).await.unwrap();

        // The edit must NOT have merged into the in-flight (now 'sending') row.
        let in_flight_payload: (String,) =
            sqlx::query_as("SELECT payload_json FROM todoist_outbox WHERE id = ?")
                .bind(&in_flight_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(in_flight_payload.0, json!({"content": "a"}).to_string());

        // The response lands and retires the in-flight row...
        mark_done(&pool, &[in_flight_id]).await.unwrap();

        // ...but the concurrent edit survives as a new pending op, not discarded.
        let remaining = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(remaining.len(), 1, "the in-flight edit must survive as its own pending op");
        assert_eq!(remaining[0].payload["content"], "b");
    }

    #[tokio::test]
    async fn mark_pending_reverts_sending_row_and_is_visible_to_coalescing_again() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        let id = batch[0].id.clone();

        mark_sending(&pool, &[id.clone()]).await.unwrap();
        assert!(pending_batch(&pool, 100).await.unwrap().is_empty());

        // Request failed outright — push_outbox reverts to 'pending'.
        mark_pending(&pool, &[id]).await.unwrap();
        assert_eq!(pending_batch(&pool, 100).await.unwrap().len(), 1);

        // Now back to 'pending', coalescing works normally again.
        enqueue(&pool, "task", "t1", "update", json!({"content": "c"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].payload["content"], "c");
    }

    #[tokio::test]
    async fn reset_stuck_sending_recovers_rows_after_a_simulated_crash() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t2", "create", json!({"content": "b"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        let ids: Vec<String> = batch.iter().map(|r| r.id.clone()).collect();

        // Simulate a crash mid-push: rows stuck 'sending', app restarts.
        mark_sending(&pool, &ids).await.unwrap();
        assert!(pending_batch(&pool, 100).await.unwrap().is_empty());

        reset_stuck_sending(&pool).await.unwrap();
        assert_eq!(pending_batch(&pool, 100).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn prune_done_respects_7_day_audit_window_on_updated_at() {
        let pool = test_pool().await;
        // Insert a done row with created_at 10 days ago but updated_at now
        sqlx::query(
            "INSERT INTO todoist_outbox (id, local_id, object_type, op, payload_json, command_uuid, status, created_at, updated_at)
             VALUES (?, ?, 'task', 'update', '{}', ?, 'done', datetime('now', '-10 days', 'localtime'), datetime('now', 'localtime'))"
        )
        .bind("old-created-recent-updated")
        .bind("t1")
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&pool)
        .await
        .unwrap();

        // Insert a done row with both timestamps 10 days ago
        sqlx::query(
            "INSERT INTO todoist_outbox (id, local_id, object_type, op, payload_json, command_uuid, status, created_at, updated_at)
             VALUES (?, ?, 'task', 'update', '{}', ?, 'done', datetime('now', '-10 days', 'localtime'), datetime('now', '-10 days', 'localtime'))"
        )
        .bind("old-created-old-updated")
        .bind("t2")
        .bind(uuid::Uuid::new_v4().to_string())
        .execute(&pool)
        .await
        .unwrap();

        prune_done(&pool).await.unwrap();

        // Row with recent updated_at should survive
        let survived: Option<(String,)> = sqlx::query_as("SELECT id FROM todoist_outbox WHERE id = 'old-created-recent-updated'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(survived.is_some(), "Row with recent updated_at should survive pruning");

        // Row with old updated_at should be deleted
        let deleted: Option<(String,)> = sqlx::query_as("SELECT id FROM todoist_outbox WHERE id = 'old-created-old-updated'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(deleted.is_none(), "Row with old updated_at should be deleted");
    }
}
