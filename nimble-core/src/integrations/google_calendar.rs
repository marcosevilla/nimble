//! Only explicitly opted-in, timed tasks are projected to Nimble's own calendar.
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use crate::types::LocalTask;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarProjection {
    pub task_id: String,
    pub content: String,
    pub description: String,
    pub start_rfc3339: String,
    pub end_rfc3339: String,
    pub timezone: String,
    pub reminder_offset_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEvent {
    pub event_id: String,
    pub etag: Option<String>,
    pub projection: Option<CalendarProjection>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeDecision {
    Unchanged,
    Push(CalendarProjection),
    Pull(CalendarProjection),
    Merged(CalendarProjection),
    Conflict,
}

pub fn project(task: &LocalTask, timezone: &str) -> crate::Result<Option<CalendarProjection>> {
    if !task.google_calendar_enabled || task.completed { return Ok(None) }
    let Some(offset) = task.reminder_offset_minutes else { return Err(crate::Error::Parse("Phone alert needs a reminder offset".into())) };
    let Some(reminder) = crate::reminders::candidate(task, timezone)? else { return Ok(None) };
    let start = reminder.scheduled_at + Duration::minutes(offset);
    let end = start + Duration::minutes(task.duration_minutes.unwrap_or(30));
    Ok(Some(CalendarProjection {
        task_id: task.id.clone(), content: task.content.clone(),
        description: task.description.clone().unwrap_or_default(),
        start_rfc3339: start.to_rfc3339(), end_rfc3339: end.to_rfc3339(),
        timezone: timezone.to_owned(), reminder_offset_minutes: offset,
    }))
}

/// Three-way merge on supported fields. Disjoint edits commute; divergent
/// edits to the same field must be reviewed by a person.
pub fn merge(base: &CalendarProjection, local: &CalendarProjection, remote: &CalendarProjection) -> MergeDecision {
    fn field<T: PartialEq + Clone>(base: &T, local: &T, remote: &T) -> Option<T> {
        if local == remote { Some(local.clone()) }
        else if local == base { Some(remote.clone()) }
        else if remote == base { Some(local.clone()) }
        else { None }
    }
    if local.task_id != base.task_id || remote.task_id != base.task_id { return MergeDecision::Conflict }
    let Some(content) = field(&base.content, &local.content, &remote.content) else { return MergeDecision::Conflict };
    let Some(description) = field(&base.description, &local.description, &remote.description) else { return MergeDecision::Conflict };
    let Some(start_rfc3339) = field(&base.start_rfc3339, &local.start_rfc3339, &remote.start_rfc3339) else { return MergeDecision::Conflict };
    let Some(end_rfc3339) = field(&base.end_rfc3339, &local.end_rfc3339, &remote.end_rfc3339) else { return MergeDecision::Conflict };
    let Some(timezone) = field(&base.timezone, &local.timezone, &remote.timezone) else { return MergeDecision::Conflict };
    let Some(reminder_offset_minutes) = field(&base.reminder_offset_minutes, &local.reminder_offset_minutes, &remote.reminder_offset_minutes) else { return MergeDecision::Conflict };
    let merged = CalendarProjection { task_id:base.task_id.clone(), content, description, start_rfc3339, end_rfc3339, timezone, reminder_offset_minutes };
    if &merged == base { MergeDecision::Unchanged }
    else if &merged == local && remote == base { MergeDecision::Push(merged) }
    else if &merged == remote && local == base { MergeDecision::Pull(merged) }
    else if &merged == local && local == remote { MergeDecision::Unchanged }
    else { MergeDecision::Merged(merged) }
}

pub fn event_id(task_id: &str) -> String {
    // Google accepts lower-case base32hex, but UUID hex is its subset.
    format!("nimble{}", task_id.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase())
}

pub fn projection_start(projection: &CalendarProjection) -> crate::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&projection.start_rfc3339)
        .map(|d| d.with_timezone(&Utc)).map_err(|_| crate::Error::Parse("Invalid calendar start".into()))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileResult { pub changed_task_ids: Vec<String>, pub error_code: Option<String> }

/// A cycle stages local intent before any HTTP mutation. An incremental sync
/// token is acknowledged only after every page and mapped event is handled.
pub async fn run_once<T: crate::api::google_calendar::CalendarApi>(pool: &sqlx::SqlitePool, transport: &T, _now: DateTime<Utc>) -> crate::Result<ReconcileResult> {
    use crate::api::google_calendar::{parse_event, CalendarApiError};
    use crate::db::google_calendar as db;
    use std::collections::HashMap;
    let state=db::state(pool).await?;
    let Some(calendar_id)=state.calendar_id else { return Ok(ReconcileResult { changed_task_ids:vec![], error_code:Some("google_connection_needed".into()) }) };
    let mut page_token=None;
    let mut next_sync_token=None;
    let mut remote:HashMap<String,serde_json::Value>=HashMap::new();
    loop {
        match transport.list_page(&calendar_id,state.sync_token.as_deref(),page_token.as_deref()).await {
            Ok((items,next_page,next_sync)) => {
                for value in items {
                    if let Some(id)=value.get("id").and_then(|v|v.as_str()) { remote.insert(id.into(),value); }
                }
                if let Some(next)=next_page { page_token=Some(next); continue }
                next_sync_token=next_sync;
                break;
            }
            Err(CalendarApiError::Gone) => {
                db::set_sync_token(pool,None).await?;
                db::set_error(pool,Some("google_full_resync_needed"),None).await?;
                return Ok(ReconcileResult { changed_task_ids:vec![], error_code:Some("google_full_resync_needed".into()) });
            }
            Err(error) => {
                return fail_cycle(pool,&error).await;
            }
        }
    }
    let tasks=crate::db::tasks::get_local_tasks(pool,None,None,false).await?;
    let mut local=HashMap::new();
    for task in tasks {
        if let Some(p)=project(&task,&state.timezone)? { local.insert(task.id.clone(),p); }
    }
    let existing=db::links(pool).await?;
    let mut links:HashMap<_,_>=existing.into_iter().map(|l|(l.task_id.clone(),l)).collect();
    for (task_id,p) in &local {
        if !links.contains_key(task_id) {
            let id=event_id(task_id);
            db::queue_upsert(pool,task_id,&id,p).await?;
        }
    }
    for (task_id,link) in &links {
        if !local.contains_key(task_id) && link.state!="pending_delete" {
            db::queue_delete(pool,task_id).await?;
        }
    }
    links=db::links(pool).await?.into_iter().map(|l|(l.task_id.clone(),l)).collect();
    let mut changed=Vec::new();
    for (task_id,link) in links {
        if link.state=="conflict" { continue }
        if link.state=="pending_delete" {
            match transport.delete(&calendar_id,&link.event_id,link.etag.as_deref()).await {
                Ok(()) => db::acknowledge_delete(pool,&task_id).await?,
                Err(e) => return fail_cycle(pool,&e).await,
            }
            continue;
        }
        let Some(local_p)=local.get(&task_id) else { continue };
        let raw=match remote.remove(&link.event_id) {
            Some(v)=>Some(v),
            None=>match transport.get_raw(&calendar_id,&link.event_id).await {
                Ok(v)=>Some(v), Err(CalendarApiError::NotFound)=>None,
                Err(e)=>return fail_cycle(pool,&e).await,
            },
        };
        if link.state=="pending_upsert" && link.base.is_some() && link.desired.as_ref()==Some(local_p) {
            let forced=if let Some(raw)=raw.as_ref() {
                let marker=raw.pointer("/extendedProperties/private/nimbleTaskId").and_then(|v|v.as_str());
                if marker.is_some_and(|m|m!=task_id) {
                    db::conflict(pool,&task_id,"event_id_collision",local_p,None).await?; continue;
                }
                if raw.get("status").and_then(|v|v.as_str())==Some("cancelled") {
                    transport.insert(&calendar_id,&link.event_id,local_p).await
                } else {
                    let etag=raw.get("etag").and_then(|v|v.as_str()).unwrap_or("");
                    transport.update(&calendar_id,&link.event_id,local_p,etag,raw).await
                }
            } else { transport.insert(&calendar_id,&link.event_id,local_p).await };
            match forced {
                Ok(event) if event.projection.as_ref()==Some(local_p) => db::acknowledge_upsert(pool,&task_id,event.etag.as_deref(),local_p).await?,
                Ok(event) => db::conflict(pool,&task_id,"forced_event_mismatch",local_p,event.projection.as_ref()).await?,
                Err(e) => return fail_cycle(pool,&e).await,
            }
            continue;
        }
        match (link.base.as_ref(),raw.as_ref()) {
            (None,None) => {
                // A deterministic ID makes retry after an ambiguous POST safe.
                match transport.insert(&calendar_id,&link.event_id,local_p).await {
                    Ok(event)=> {
                        if event.projection.as_ref()!=Some(local_p) { db::conflict(pool,&task_id,"created_event_mismatch",local_p,event.projection.as_ref()).await?; continue }
                        db::acknowledge_upsert(pool,&task_id,event.etag.as_deref(),local_p).await?;
                    }
                    Err(CalendarApiError::Conflict)=> {
                        let event=transport.get(&calendar_id,&link.event_id).await.map_err(|e|crate::Error::Api(api_error_code(&e).into()))?;
                        if event.projection.as_ref()==Some(local_p) { db::acknowledge_upsert(pool,&task_id,event.etag.as_deref(),local_p).await?; }
                        else { db::conflict(pool,&task_id,"event_id_collision",local_p,event.projection.as_ref()).await?; }
                    }
                    Err(e)=>return fail_cycle(pool,&e).await,
                }
            }
            (Some(_),None) => { db::conflict(pool,&task_id,"remote_deleted",local_p,None).await?; }
            (_,Some(raw)) => {
                let event=match parse_event(raw) { Ok(e)=>e, Err(_)=> { db::conflict(pool,&task_id,"remote_invalid",local_p,None).await?; continue } };
                if event.cancelled || event.projection.is_none() || event.projection.as_ref().is_some_and(|p|p.task_id!=task_id) {
                    db::conflict(pool,&task_id,"remote_unsupported",local_p,event.projection.as_ref()).await?; continue;
                }
                let remote_p=event.projection.as_ref().unwrap();
                let decision=if let Some(base)=link.base.as_ref() { merge(base,local_p,remote_p) }
                    else if local_p==remote_p { MergeDecision::Unchanged } else { MergeDecision::Conflict };
                match decision {
                    MergeDecision::Unchanged => db::acknowledge_upsert(pool,&task_id,event.etag.as_deref(),local_p).await?,
                    MergeDecision::Conflict => db::conflict(pool,&task_id,"divergent_edit",local_p,Some(remote_p)).await?,
                    MergeDecision::Pull(p) => {
                        if apply_remote_if_unchanged(pool,local_p,&p).await? {
                            db::acknowledge_upsert(pool,&task_id,event.etag.as_deref(),&p).await?; changed.push(task_id.clone());
                        } else { db::conflict(pool,&task_id,"local_changed_during_sync",local_p,Some(&p)).await?; }
                    }
                    MergeDecision::Push(p) | MergeDecision::Merged(p) => {
                        if p!=*local_p && !apply_remote_if_unchanged(pool,local_p,&p).await? {
                            db::conflict(pool,&task_id,"local_changed_during_sync",local_p,Some(remote_p)).await?; continue;
                        }
                        match transport.update(&calendar_id,&link.event_id,&p,event.etag.as_deref().unwrap_or(""),raw).await {
                            Ok(updated)=> { db::acknowledge_upsert(pool,&task_id,updated.etag.as_deref(),&p).await?; if p!=*local_p { changed.push(task_id.clone()); } }
                            Err(CalendarApiError::Precondition)=> {
                                let fresh=transport.get_raw(&calendar_id,&link.event_id).await.map_err(|e|crate::Error::Api(api_error_code(&e).into()))?;
                                let fresh_event=parse_event(&fresh).map_err(|_|crate::Error::Parse("Invalid changed calendar event".into()))?;
                                if let (Some(base),Some(fresh_p))=(link.base.as_ref(),fresh_event.projection.as_ref()) {
                                    if matches!(merge(base,&p,fresh_p),MergeDecision::Conflict) {
                                        db::conflict(pool,&task_id,"divergent_edit",&p,Some(fresh_p)).await?;
                                    }
                                } else { db::conflict(pool,&task_id,"remote_unsupported",&p,fresh_event.projection.as_ref()).await?; }
                                db::set_error(pool,Some("google_event_changed"),None).await?;
                                return Ok(ReconcileResult { changed_task_ids:changed, error_code:Some("google_event_changed".into()) });
                            }
                            Err(e)=>return fail_cycle(pool,&e).await,
                        }
                    }
                }
            }
        }
    }
    if let Some(token)=next_sync_token { db::set_sync_token(pool,Some(&token)).await?; }
    db::set_error(pool,None,None).await?;
    crate::db::settings::set_setting(pool,"google_calendar_retry_attempt","0").await?;
    Ok(ReconcileResult { changed_task_ids:changed, error_code:None })
}

fn api_error_code(e:&crate::api::google_calendar::CalendarApiError)->&'static str {
    use crate::api::google_calendar::CalendarApiError::*;
    match e { Unauthorized=>"google_reconnect_required", Forbidden=>"google_permission_denied", NotFound=>"google_event_missing", Gone=>"google_full_resync_needed", Conflict=>"google_event_conflict", Precondition=>"google_event_changed", Retryable(_)=>"google_retry_later", InvalidResponse=>"google_invalid_response" }
}

async fn fail_cycle(pool:&sqlx::SqlitePool,e:&crate::api::google_calendar::CalendarApiError)->crate::Result<ReconcileResult> {
    let code=api_error_code(e);
    let retry_after=if let crate::api::google_calendar::CalendarApiError::Retryable(server_seconds)=e {
        let previous=crate::db::settings::get_setting(pool,"google_calendar_retry_attempt").await?.and_then(|v|v.parse::<u32>().ok()).unwrap_or(0);
        let attempt=previous.saturating_add(1).min(8);
        crate::db::settings::set_setting(pool,"google_calendar_retry_attempt",&attempt.to_string()).await?;
        let backoff=(30u64.saturating_mul(1u64<<attempt)).min(3600).max(server_seconds.unwrap_or(0));
        Some((chrono::Utc::now()+chrono::Duration::seconds(backoff as i64)).to_rfc3339())
    } else { None };
    crate::db::google_calendar::set_error(pool,Some(code),retry_after.as_deref()).await?;
    Ok(ReconcileResult { changed_task_ids:vec![], error_code:Some(code.into()) })
}

pub async fn apply_remote_if_unchanged(pool:&sqlx::SqlitePool,expected:&CalendarProjection,new:&CalendarProjection)->crate::Result<bool> {
    let tasks=crate::db::tasks::get_local_tasks(pool,None,None,false).await?;
    let Some(task)=tasks.into_iter().find(|t|t.id==expected.task_id) else { return Ok(false) };
    if project(&task,&expected.timezone)?.as_ref()!=Some(expected) { return Ok(false) }
    let start=projection_start(new)?;
    let zone:chrono_tz::Tz=new.timezone.parse().map_err(|_|crate::Error::Parse("Invalid calendar timezone".into()))?;
    let wall=start.with_timezone(&zone);
    let end=DateTime::parse_from_rfc3339(&new.end_rfc3339).map_err(|_|crate::Error::Parse("Invalid calendar end".into()))?;
    let duration=(end.with_timezone(&Utc)-start).num_minutes();
    if duration<=0 || duration>1440 { return Ok(false) }
    let update=crate::types::UpdateTaskInput {
        content:Some(new.content.clone()), description:Some(new.description.clone()),
        due_date:Some(wall.format("%Y-%m-%d").to_string()), due_time:Some(wall.format("%H:%M").to_string()),
        duration_minutes:Some(duration), reminder_offset_minutes:Some(new.reminder_offset_minutes),
        ..Default::default()
    };
    Ok(crate::db::tasks::update_local_task_if_unchanged(pool,&expected.task_id,&task,update).await?.is_some())
}
