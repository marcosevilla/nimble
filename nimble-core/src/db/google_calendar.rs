use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use crate::integrations::google_calendar::CalendarProjection;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarState {
    pub calendar_id: Option<String>,
    pub timezone: String,
    pub sync_token: Option<String>,
    pub last_synced_at: Option<String>,
    pub retry_after: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CalendarLink {
    pub task_id: String,
    pub event_id: String,
    pub etag: Option<String>,
    pub base: Option<CalendarProjection>,
    pub desired: Option<CalendarProjection>,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarConflict {
    pub task_id: String,
    pub reason: String,
    pub local: CalendarProjection,
    pub remote: Option<CalendarProjection>,
    pub created_at: String,
}

pub async fn state(pool: &SqlitePool) -> crate::Result<CalendarState> {
    let row = sqlx::query("SELECT calendar_id,timezone,sync_token,last_synced_at,retry_after,error_code FROM google_calendar_state WHERE id=1")
        .fetch_optional(pool).await?;
    match row {
        Some(r) => Ok(CalendarState { calendar_id:r.get(0), timezone:r.get(1), sync_token:r.get(2), last_synced_at:r.get(3), retry_after:r.get(4), error_code:r.get(5) }),
        None => Ok(CalendarState { calendar_id:None, timezone:"UTC".into(), sync_token:None, last_synced_at:None, retry_after:None, error_code:None }),
    }
}

pub async fn set_calendar(pool: &SqlitePool, calendar_id: &str, timezone: &str) -> crate::Result<()> {
    sqlx::query("INSERT INTO google_calendar_state(id,calendar_id,timezone) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET calendar_id=excluded.calendar_id,timezone=excluded.timezone")
        .bind(calendar_id).bind(timezone).execute(pool).await?;
    Ok(())
}

pub async fn set_sync_token(pool: &SqlitePool, token: Option<&str>) -> crate::Result<()> {
    sqlx::query("UPDATE google_calendar_state SET sync_token=?,last_synced_at=? WHERE id=1")
        .bind(token).bind(chrono::Utc::now().to_rfc3339()).execute(pool).await?;
    Ok(())
}

pub async fn set_error(pool: &SqlitePool, code: Option<&str>, retry_after: Option<&str>) -> crate::Result<()> {
    sqlx::query("INSERT INTO google_calendar_state(id,timezone,error_code,retry_after) VALUES (1,'UTC',?,?) ON CONFLICT(id) DO UPDATE SET error_code=excluded.error_code,retry_after=excluded.retry_after")
        .bind(code).bind(retry_after).execute(pool).await?;
    Ok(())
}

pub async fn links(pool: &SqlitePool) -> crate::Result<Vec<CalendarLink>> {
    let rows = sqlx::query("SELECT task_id,event_id,etag,base_json,desired_json,state FROM google_calendar_links")
        .fetch_all(pool).await?;
    rows.into_iter().map(|r| {
        let base: Option<String> = r.get(3);
        let desired: Option<String> = r.get(4);
        Ok(CalendarLink {
            task_id:r.get(0), event_id:r.get(1), etag:r.get(2),
            base:base.map(|v|serde_json::from_str(&v)).transpose().map_err(|_|crate::Error::Parse("Invalid calendar base".into()))?,
            desired:desired.map(|v|serde_json::from_str(&v)).transpose().map_err(|_|crate::Error::Parse("Invalid calendar desired".into()))?,
            state:r.get(5),
        })
    }).collect()
}

pub async fn queue_upsert(pool: &SqlitePool, task_id: &str, event_id: &str, desired: &CalendarProjection) -> crate::Result<()> {
    let serialized = serde_json::to_string(desired).map_err(|_|crate::Error::Parse("Invalid calendar projection".into()))?;
    sqlx::query("INSERT INTO google_calendar_links(task_id,event_id,operation_id,desired_json,state) VALUES (?,?,?,?,'pending_upsert') ON CONFLICT(task_id) DO UPDATE SET desired_json=excluded.desired_json,state='pending_upsert'")
        .bind(task_id).bind(event_id).bind(uuid::Uuid::new_v4().to_string()).bind(serialized).execute(pool).await?;
    Ok(())
}

pub async fn queue_delete(pool: &SqlitePool, task_id: &str) -> crate::Result<()> {
    sqlx::query("UPDATE google_calendar_links SET state='pending_delete',desired_json=NULL WHERE task_id=? AND state!='pending_delete'")
        .bind(task_id).execute(pool).await?;
    Ok(())
}

pub async fn acknowledge_upsert(pool: &SqlitePool, task_id: &str, etag: Option<&str>, projection: &CalendarProjection) -> crate::Result<()> {
    let base = serde_json::to_string(projection).map_err(|_|crate::Error::Parse("Invalid calendar projection".into()))?;
    sqlx::query("UPDATE google_calendar_links SET etag=?,base_json=?,desired_json=NULL,state='linked',retry_after=NULL WHERE task_id=?")
        .bind(etag).bind(base).bind(task_id).execute(pool).await?;
    Ok(())
}

pub async fn acknowledge_delete(pool: &SqlitePool, task_id: &str) -> crate::Result<()> {
    sqlx::query("DELETE FROM google_calendar_links WHERE task_id=? AND state='pending_delete'")
        .bind(task_id).execute(pool).await?;
    Ok(())
}

pub async fn conflict(pool: &SqlitePool, task_id: &str, reason: &str, local: &CalendarProjection, remote: Option<&CalendarProjection>) -> crate::Result<()> {
    let local_json = serde_json::to_string(local).map_err(|_|crate::Error::Parse("Invalid calendar projection".into()))?;
    let remote_json = remote.map(serde_json::to_string).transpose().map_err(|_|crate::Error::Parse("Invalid calendar projection".into()))?;
    sqlx::query("INSERT INTO google_calendar_conflicts(task_id,reason,local_json,remote_json,created_at) VALUES (?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET reason=excluded.reason,local_json=excluded.local_json,remote_json=excluded.remote_json,created_at=excluded.created_at")
        .bind(task_id).bind(reason).bind(local_json).bind(remote_json).bind(chrono::Utc::now().to_rfc3339()).execute(pool).await?;
    sqlx::query("UPDATE google_calendar_links SET state='conflict' WHERE task_id=?").bind(task_id).execute(pool).await?;
    Ok(())
}

pub async fn list_conflicts(pool: &SqlitePool) -> crate::Result<Vec<CalendarConflict>> {
    let rows = sqlx::query("SELECT task_id,reason,local_json,remote_json,created_at FROM google_calendar_conflicts ORDER BY created_at DESC").fetch_all(pool).await?;
    rows.into_iter().map(|r| {
        let local_json:String=r.get(2); let remote_json:Option<String>=r.get(3);
        Ok(CalendarConflict { task_id:r.get(0), reason:r.get(1),
            local:serde_json::from_str(&local_json).map_err(|_|crate::Error::Parse("Invalid calendar conflict".into()))?,
            remote:remote_json.map(|v|serde_json::from_str(&v)).transpose().map_err(|_|crate::Error::Parse("Invalid calendar conflict".into()))?,
            created_at:r.get(4) })
    }).collect()
}
