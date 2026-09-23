//! Temporary provenance marker for the Todoist → Nimble migration (2026-09-23).
//! While Todoist sync is on, every task created in Nimble carries the `nimble`
//! label so it can be filtered (and seen in Todoist too). After cutover the
//! hook goes quiet on its own; delete the label to remove every trace.
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::db::sync;
use crate::types::Label;

pub const ORIGIN_LABEL: &str = "nimble";
const ORIGIN_LABEL_COLOR: &str = "#8b8b8b";

const LABEL_COLS: &str = "id, name, color, position, created_at, \"group\"";

pub(crate) async fn todoist_sync_on_tx(conn: &mut SqliteConnection) -> crate::Result<bool> {
    let enabled: Option<i64> = sqlx::query_scalar(
        "SELECT enabled FROM integration_sync_state WHERE provider = 'todoist'",
    )
    .fetch_optional(&mut *conn)
    .await?;
    let token: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'todoist_api_token'")
            .fetch_optional(&mut *conn)
            .await?;
    Ok(enabled == Some(1) && token.map(|t| !t.trim().is_empty()).unwrap_or(false))
}

/// Runs the exact INSERT `db::labels::create_label` runs, plus the matching
/// `append_sync_log_tx`, on a caller-owned connection/transaction. Returns
/// the new label's id.
async fn create_label_tx(
    conn: &mut SqliteConnection,
    name: &str,
    color: &str,
) -> crate::Result<String> {
    let id = Uuid::new_v4().to_string();

    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM labels")
        .fetch_one(&mut *conn)
        .await?;
    let position = max_pos + 1;

    sqlx::query("INSERT INTO labels (id, name, color, position) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(color)
        .bind(position)
        .execute(&mut *conn)
        .await?;

    let label: Label = sqlx::query_as::<_, Label>(&format!("SELECT {LABEL_COLS} FROM labels WHERE id = ?"))
        .bind(&id)
        .fetch_one(&mut *conn)
        .await?;

    let snapshot = serde_json::to_string(&label).unwrap_or_default();
    sync::append_sync_log_tx(conn, "labels", &id, "INSERT", None, Some(&snapshot)).await?;

    Ok(id)
}

/// Returns the label id, creating the label on first use.
pub(crate) async fn origin_label_id_tx(conn: &mut SqliteConnection) -> crate::Result<String> {
    if let Some(id) = sqlx::query_scalar::<_, String>("SELECT id FROM labels WHERE name = ?")
        .bind(ORIGIN_LABEL)
        .fetch_optional(&mut *conn)
        .await?
    {
        return Ok(id);
    }
    create_label_tx(conn, ORIGIN_LABEL, ORIGIN_LABEL_COLOR).await
}

/// Attach the `nimble` label to every unlinked (never pushed to Todoist)
/// task that doesn't already carry it, and merge it into any pending outbox
/// `create` row for that task so the label reaches Todoist on first push.
/// Idempotent: a second run touches nothing.
///
/// Only unlinked tasks are touched. They have never been pushed, so there is
/// no remote label to fight. Tasks the 2026-04-17 import linked, and tasks
/// with a completed push, stay unlabeled — a known, accepted gap since
/// sync_log provenance for those rows was pruned.
pub async fn backfill_origin_label(pool: &SqlitePool) -> crate::Result<usize> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let label_id = origin_label_id_tx(&mut tx).await?;
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM local_tasks t WHERE t.external_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)",
    )
    .bind(&label_id)
    .fetch_all(&mut *tx)
    .await?;
    // (task_id, created_at) for every `task_labels` row just written, so the
    // post-commit sync_log entry can carry a real snapshot — see below.
    let mut created_ats: Vec<(String, String)> = Vec::with_capacity(ids.len());
    for id in &ids {
        sqlx::query("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)")
            .bind(id)
            .bind(&label_id)
            .execute(&mut *tx)
            .await?;
        let created_at: String =
            sqlx::query_scalar("SELECT created_at FROM task_labels WHERE task_id = ? AND label_id = ?")
                .bind(id)
                .bind(&label_id)
                .fetch_one(&mut *tx)
                .await?;
        created_ats.push((id.clone(), created_at));
        // The two queued creates are unlinked, so their pending outbox
        // `create` row must carry the label too, or the first push would
        // omit it. Read-merge-write in Rust rather than a clever nested
        // JSON1 expression, so the merge is easy to verify by inspection.
        let pending: Option<(String, String)> = sqlx::query_as(
            "SELECT id, payload_json FROM todoist_outbox WHERE local_id = ? AND op = 'create' AND status = 'pending'",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((row_id, payload_json)) = pending {
            let mut payload: serde_json::Value =
                serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({}));
            let mut labels: Vec<String> = payload
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            if !labels.iter().any(|l| l == ORIGIN_LABEL) {
                labels.push(ORIGIN_LABEL.to_string());
            }
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("labels".into(), serde_json::json!(labels));
            }
            sqlx::query(
                "UPDATE todoist_outbox SET payload_json = ?, updated_at = datetime('now','localtime') WHERE id = ?",
            )
            .bind(payload.to_string())
            .bind(row_id)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    for (id, created_at) in &created_ats {
        // sync_log so the web replica sees it; composite row id helper lives
        // in db::sync. A snapshot is required here, not optional: a `None`
        // snapshot makes `build_data_mutation_requests` (db/sync.rs) return
        // no statements for this INSERT, and `push` then marks the entry
        // synced anyway — the label association would silently never reach
        // Turso. Mirrors the snapshot shape every other `task_labels` INSERT
        // site uses (`task_tx::set_labels_tx`, `labels::set_task_labels`).
        let snapshot = serde_json::json!({
            "task_id": id,
            "label_id": label_id,
            "created_at": created_at,
        })
        .to_string();
        crate::db::sync::append_sync_log(
            pool,
            "task_labels",
            &crate::db::sync::task_labels_row_id(id, &label_id),
            "INSERT",
            None,
            Some(&snapshot),
        )
        .await
        .ok();
    }
    Ok(ids.len())
}
