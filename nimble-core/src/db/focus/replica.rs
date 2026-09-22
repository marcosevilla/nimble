//! A single ordered, settled focus projection for remote readers.
use std::collections::BTreeMap;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Column, Row, SqliteConnection, TypeInfo, ValueRef};

use crate::focus_types::{FocusEntry, MAX_SAFE_INTEGER};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusReplica {
    pub version: u32,
    pub writer_device_id: String,
    pub owner_epoch: String,
    pub revision: u64,
    pub queue_revision: u64,
    pub queue: Vec<FocusEntry>,
    pub selected_occurrence_id: Option<String>,
    pub occurrences: Vec<Value>,
    pub sessions: Vec<Value>,
    pub import_totals: Vec<Value>,
    pub totals: BTreeMap<String, u64>,
    pub as_of: String,
}

pub fn accept_revision(
    writer: &str, epoch: &str, revision: u64,
    incoming_writer: &str, incoming_epoch: &str, incoming_revision: u64,
) -> bool {
    !writer.is_empty() && !epoch.is_empty()
        && writer == incoming_writer && epoch == incoming_epoch
        && incoming_revision <= MAX_SAFE_INTEGER && incoming_revision > revision
}

fn invalid(message: &str) -> crate::Error {
    crate::Error::Other(format!("focus_replica_{message}"))
}

fn safe(v: i64) -> crate::Result<u64> {
    if v < 0 || v as u64 > MAX_SAFE_INTEGER { return Err(invalid("unsafe_integer")); }
    Ok(v as u64)
}

fn row_value(row: &sqlx::sqlite::SqliteRow) -> crate::Result<Value> {
    let mut map = Map::new();
    for column in row.columns() {
        let name = column.name();
        let raw = row.try_get_raw(name)?;
        let value = if raw.is_null() { Value::Null } else {
            match raw.type_info().name() {
                "INTEGER" => Value::from(row.try_get::<i64, _>(name)?),
                "REAL" => Value::from(row.try_get::<f64, _>(name)?),
                "TEXT" => Value::from(row.try_get::<String, _>(name)?),
                _ => return Err(invalid("unsupported_cell")),
            }
        };
        map.insert(name.to_owned(), value);
    }
    Ok(Value::Object(map))
}

pub async fn build_focus_replica_tx(conn: &mut SqliteConnection) -> crate::Result<Option<FocusReplica>> {
    let q = sqlx::query("SELECT writer_device_id,owner_epoch,revision,entries_json,selected_occurrence_id FROM focus_queue_state WHERE id=1")
        .fetch_optional(&mut *conn).await?;
    let Some(q) = q else { return Ok(None); };
    let writer_device_id: String = q.try_get("writer_device_id")?;
    if writer_device_id.is_empty() { return Ok(None); } // restored profile is inert
    let owner_epoch: String = q.try_get("owner_epoch")?;
    let revision: i64 = sqlx::query_scalar("SELECT engine_revision FROM focus_runtime WHERE id=1")
        .fetch_one(&mut *conn).await?;
    let queue_revision = safe(q.try_get("revision")?)?;
    let queue: Vec<FocusEntry> = serde_json::from_str(q.try_get("entries_json")?)
        .map_err(|_| invalid("queue"))?;
    super::queue::validate(&queue, q.try_get::<Option<String>, _>("selected_occurrence_id")?.as_deref())?;
    let occurrences = sqlx::query("SELECT * FROM focus_occurrences ORDER BY id")
        .fetch_all(&mut *conn).await?.iter().map(row_value).collect::<crate::Result<Vec<_>>>()?;
    let mut sessions = sqlx::query("SELECT * FROM focus_sessions ORDER BY id")
        .fetch_all(&mut *conn).await?.iter().map(row_value).collect::<crate::Result<Vec<_>>>()?;
    let import_totals = sqlx::query(
        "SELECT id,source_namespace,record_key,occurrence_id,unresolved_task_id,duration_ms,completed_at,source_kind,inclusion FROM focus_import_totals WHERE inclusion='included' ORDER BY id")
        .fetch_all(&mut *conn).await?.iter().map(row_value).collect::<crate::Result<Vec<_>>>()?;
    for session in &mut sessions {
        if session["status"] == "running" {
            session["status"] = Value::from("paused");
        }
    }
    let mut totals = BTreeMap::<String, u64>::new();
    for session in &sessions {
        let oid = session["occurrence_id"].as_str().ok_or_else(|| invalid("session_occurrence"))?;
        let work = safe(session["work_ms"].as_i64().ok_or_else(|| invalid("session_work"))?)?;
        let entry = totals.entry(oid.to_owned()).or_default();
        *entry = entry.checked_add(work).filter(|v| *v <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("total_overflow"))?;
    }
    let imported: Vec<(String, i64)> = sqlx::query_as(
        "SELECT occurrence_id,duration_ms FROM focus_import_totals WHERE inclusion='included' AND occurrence_id IS NOT NULL")
        .fetch_all(&mut *conn).await?;
    for (oid, ms) in imported {
        let entry = totals.entry(oid).or_default();
        *entry = entry.checked_add(safe(ms)?).filter(|v| *v <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("total_overflow"))?;
    }
    Ok(Some(FocusReplica {
        version: 1, writer_device_id, owner_epoch, revision: safe(revision)?,
        queue_revision, queue,
        selected_occurrence_id: q.try_get("selected_occurrence_id")?,
        occurrences, sessions, import_totals, totals, as_of: Utc::now().to_rfc3339(),
    }))
}

/// Publish inside the same transaction that changed the queue or ledger.
pub async fn publish_focus_replica_tx(conn: &mut SqliteConnection) -> crate::Result<()> {
    let Some(replica) = build_focus_replica_tx(conn).await? else { return Ok(()); };
    let last: Option<String> = sqlx::query_scalar(
        "SELECT snapshot FROM sync_log WHERE table_name='focus_replica' AND row_id='current' ORDER BY rowid DESC LIMIT 1")
        .fetch_optional(&mut *conn).await?;
    if let Some(last) = last {
        let row: Value = serde_json::from_str(&last).map_err(|_| invalid("last_snapshot"))?;
        if row["writer_device_id"] == replica.writer_device_id
            && row["owner_epoch"] == replica.owner_epoch
            && row["revision"].as_u64().is_some_and(|revision| revision >= replica.revision)
        {
            return Ok(());
        }
    }
    let payload_json = serde_json::to_string(&replica).map_err(|_| invalid("serialize"))?;
    let row = serde_json::json!({
        "id": "current", "writer_device_id": replica.writer_device_id,
        "owner_epoch": replica.owner_epoch, "revision": replica.revision,
        "queue_revision": replica.queue_revision, "payload_json": payload_json,
        "as_of": replica.as_of,
    });
    crate::db::sync::append_sync_log_tx(conn, "focus_replica", "current", "UPDATE", None, Some(&row.to_string())).await
}

/// Store a remote read replica only when its writer and epoch were already recognized.
/// It cannot modify focus_queue_state, focus_runtime, or any executable session.
pub async fn apply_focus_replica_tx(conn: &mut SqliteConnection, payload: FocusReplica) -> crate::Result<bool> {
    if payload.version != 1 || payload.revision > MAX_SAFE_INTEGER
        || payload.queue_revision > payload.revision
        || payload.sessions.iter().any(|session| session["status"] == "running")
        || payload.totals.values().any(|total| *total > MAX_SAFE_INTEGER)
        || super::queue::validate(&payload.queue, payload.selected_occurrence_id.as_deref()).is_err()
    {
        return Err(invalid("version_or_revision"));
    }
    let pinned_writer: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key='focus_replica_writer_device_id'")
        .fetch_optional(&mut *conn).await?;
    let pinned_epoch: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key='focus_replica_owner_epoch'")
        .fetch_optional(&mut *conn).await?;
    let (Some(writer), Some(epoch)) = (pinned_writer, pinned_epoch) else { return Ok(false); };
    if writer != payload.writer_device_id || epoch != payload.owner_epoch { return Ok(false); }
    // A local focus authority never consumes a pulled replica, even if a
    // misconfigured profile pins its own writer.
    let local_writer: Option<String> = sqlx::query_scalar(
        "SELECT writer_device_id FROM focus_queue_state WHERE id=1")
        .fetch_optional(&mut *conn).await?;
    if local_writer.as_deref() == Some(writer.as_str()) { return Ok(false); }
    let current: Option<i64> = sqlx::query_scalar("SELECT revision FROM focus_replica WHERE id='current'")
        .fetch_optional(&mut *conn).await?;
    if !accept_revision(&writer, &epoch, current.map(safe).transpose()?.unwrap_or(0),
        &payload.writer_device_id, &payload.owner_epoch, payload.revision) { return Ok(false); }
    let json = serde_json::to_string(&payload).map_err(|_| invalid("serialize"))?;
    sqlx::query("INSERT INTO focus_replica(id,writer_device_id,owner_epoch,revision,queue_revision,payload_json,as_of) VALUES('current',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET writer_device_id=excluded.writer_device_id,owner_epoch=excluded.owner_epoch,revision=excluded.revision,queue_revision=excluded.queue_revision,payload_json=excluded.payload_json,as_of=excluded.as_of")
        .bind(&payload.writer_device_id).bind(&payload.owner_epoch).bind(payload.revision as i64)
        .bind(payload.queue_revision as i64).bind(json).bind(&payload.as_of)
        .execute(&mut *conn).await?;
    Ok(true)
}
