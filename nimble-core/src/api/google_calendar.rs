//! Restricted Google Calendar transport. Callers supply the bearer token;
//! only the dedicated calendar ID is accepted by the runner.
use reqwest::{Client, Method, StatusCode, Url};
use serde_json::{json, Value};
use crate::integrations::google_calendar::{CalendarProjection, RemoteEvent};

pub const GOOGLE_API_BASE: &str = "https://www.googleapis.com/calendar/v3/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CalendarApiError { Unauthorized, Forbidden, NotFound, Gone, Conflict, Precondition, Retryable(Option<u64>), InvalidResponse }

#[derive(Clone)]
pub struct CalendarTransport { client: Client, base: Url, token: String }

#[allow(async_fn_in_trait)]
pub trait CalendarApi {
    async fn list_page(&self, calendar_id:&str, sync_token:Option<&str>, page_token:Option<&str>) -> Result<(Vec<Value>,Option<String>,Option<String>),CalendarApiError>;
    async fn get_raw(&self, calendar_id:&str, event_id:&str) -> Result<Value,CalendarApiError>;
    async fn get(&self, calendar_id:&str, event_id:&str) -> Result<RemoteEvent,CalendarApiError>;
    async fn insert(&self, calendar_id:&str, event_id:&str, p:&CalendarProjection) -> Result<RemoteEvent,CalendarApiError>;
    async fn update(&self, calendar_id:&str, event_id:&str, p:&CalendarProjection, etag:&str, existing:&Value) -> Result<RemoteEvent,CalendarApiError>;
    async fn delete(&self, calendar_id:&str, event_id:&str, etag:Option<&str>) -> Result<(),CalendarApiError>;
}

impl CalendarApi for CalendarTransport {
    async fn list_page(&self,c:&str,s:Option<&str>,p:Option<&str>)->Result<(Vec<Value>,Option<String>,Option<String>),CalendarApiError>{CalendarTransport::list_page(self,c,s,p).await}
    async fn get_raw(&self,c:&str,e:&str)->Result<Value,CalendarApiError>{CalendarTransport::get_raw(self,c,e).await}
    async fn get(&self,c:&str,e:&str)->Result<RemoteEvent,CalendarApiError>{CalendarTransport::get(self,c,e).await}
    async fn insert(&self,c:&str,e:&str,p:&CalendarProjection)->Result<RemoteEvent,CalendarApiError>{CalendarTransport::insert(self,c,e,p).await}
    async fn update(&self,c:&str,e:&str,p:&CalendarProjection,t:&str,v:&Value)->Result<RemoteEvent,CalendarApiError>{CalendarTransport::update(self,c,e,p,t,v).await}
    async fn delete(&self,c:&str,e:&str,t:Option<&str>)->Result<(),CalendarApiError>{CalendarTransport::delete(self,c,e,t).await}
}

impl CalendarTransport {
    pub fn new(client: Client, base_url: &str, bearer_token: String) -> Result<Self, CalendarApiError> {
        let base = Url::parse(base_url).map_err(|_| CalendarApiError::InvalidResponse)?;
        if base.scheme() != "https" && !matches!(base.host_str(), Some("127.0.0.1" | "localhost")) {
            return Err(CalendarApiError::InvalidResponse);
        }
        Ok(Self { client, base, token:bearer_token })
    }

    fn url(&self, calendar_id: &str, tail: &str) -> Result<Url, CalendarApiError> {
        if calendar_id.is_empty() || calendar_id.contains('/') || calendar_id.contains("..") { return Err(CalendarApiError::InvalidResponse) }
        let mut url = self.base.join("calendars/").map_err(|_| CalendarApiError::InvalidResponse)?;
        url.path_segments_mut().map_err(|_| CalendarApiError::InvalidResponse)?.pop_if_empty().push(calendar_id).push("events");
        if !tail.is_empty() { url.path_segments_mut().map_err(|_| CalendarApiError::InvalidResponse)?.push(tail); }
        Ok(url)
    }

    async fn send(&self, method: Method, url: Url, body: Option<Value>, etag: Option<&str>) -> Result<Value, CalendarApiError> {
        let mut req = self.client.request(method, url).bearer_auth(&self.token);
        if let Some(body) = body { req = req.json(&body); }
        if let Some(etag) = etag { req = req.header("If-Match", etag); }
        let response = req.send().await.map_err(|_| CalendarApiError::Retryable(None))?;
        let status = response.status();
        if !status.is_success() {
            let retry_after=response.headers().get("Retry-After").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).map(|v|v.min(3600));
            let body=response.json::<Value>().await.unwrap_or(Value::Null);
            let quota=body.pointer("/error/errors/0/reason").and_then(Value::as_str).is_some_and(|v|matches!(v,"rateLimitExceeded"|"userRateLimitExceeded"|"quotaExceeded"));
            return Err(match status {
                StatusCode::UNAUTHORIZED => CalendarApiError::Unauthorized,
                StatusCode::FORBIDDEN if quota => CalendarApiError::Retryable(retry_after),
                StatusCode::FORBIDDEN => CalendarApiError::Forbidden,
                StatusCode::NOT_FOUND => CalendarApiError::NotFound,
                StatusCode::GONE => CalendarApiError::Gone,
                StatusCode::CONFLICT => CalendarApiError::Conflict,
                StatusCode::PRECONDITION_FAILED => CalendarApiError::Precondition,
                s if s == StatusCode::TOO_MANY_REQUESTS || s.is_server_error() => CalendarApiError::Retryable(retry_after),
                _ => CalendarApiError::InvalidResponse,
            });
        }
        if status == StatusCode::NO_CONTENT { return Ok(Value::Null) }
        response.json().await.map_err(|_| CalendarApiError::InvalidResponse)
    }

    pub async fn get(&self, calendar_id: &str, event_id: &str) -> Result<RemoteEvent, CalendarApiError> {
        let value = self.send(Method::GET, self.url(calendar_id, event_id)?, None, None).await?;
        parse_event(&value)
    }

    pub async fn get_raw(&self, calendar_id: &str, event_id: &str) -> Result<Value, CalendarApiError> {
        self.send(Method::GET, self.url(calendar_id, event_id)?, None, None).await
    }

    pub async fn insert(&self, calendar_id: &str, event_id: &str, p: &CalendarProjection) -> Result<RemoteEvent, CalendarApiError> {
        let value = self.send(Method::POST, self.url(calendar_id, "")?, Some(event_body(event_id,p)), None).await?;
        parse_event(&value)
    }

    pub async fn update(&self, calendar_id: &str, event_id: &str, p: &CalendarProjection, etag: &str, existing: &Value) -> Result<RemoteEvent, CalendarApiError> {
        let mut body = existing.clone();
        let fields = event_body(event_id,p);
        for key in ["summary","description","start","end","reminders"] {
            body[key] = fields[key].clone();
        }
        if !body.get("extendedProperties").is_some_and(Value::is_object) { body["extendedProperties"] = json!({}); }
        if !body["extendedProperties"].get("private").is_some_and(Value::is_object) { body["extendedProperties"]["private"] = json!({}); }
        body["extendedProperties"]["private"]["nimbleTaskId"] = fields["extendedProperties"]["private"]["nimbleTaskId"].clone();
        if let Some(object)=body.as_object_mut() { object.remove("recurrence"); }
        let value = self.send(Method::PUT, self.url(calendar_id,event_id)?,Some(body),Some(etag)).await?;
        parse_event(&value)
    }

    pub async fn delete(&self, calendar_id: &str, event_id: &str, etag: Option<&str>) -> Result<(), CalendarApiError> {
        match self.send(Method::DELETE,self.url(calendar_id,event_id)?,None,etag).await {
            Ok(_) | Err(CalendarApiError::NotFound | CalendarApiError::Gone) => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub async fn list_page(&self, calendar_id: &str, sync_token: Option<&str>, page_token: Option<&str>) -> Result<(Vec<Value>, Option<String>, Option<String>), CalendarApiError> {
        let mut url = self.url(calendar_id, "")?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("singleEvents", "false").append_pair("showDeleted", "true").append_pair("maxResults", "250");
            if let Some(token) = sync_token { q.append_pair("syncToken", token); }
            if let Some(token) = page_token { q.append_pair("pageToken", token); }
        }
        let v = self.send(Method::GET,url,None,None).await?;
        let items = v.get("items").and_then(Value::as_array).cloned().ok_or(CalendarApiError::InvalidResponse)?;
        Ok((items, v.get("nextPageToken").and_then(Value::as_str).map(str::to_owned), v.get("nextSyncToken").and_then(Value::as_str).map(str::to_owned)))
    }
}

pub fn event_body(event_id: &str, p: &CalendarProjection) -> Value {
    json!({
        "id":event_id, "summary":p.content, "description":p.description,
        "start":{"dateTime":p.start_rfc3339,"timeZone":p.timezone},
        "end":{"dateTime":p.end_rfc3339,"timeZone":p.timezone},
        "reminders":{"useDefault":false,"overrides":[{"method":"popup","minutes":p.reminder_offset_minutes}]},
        "extendedProperties":{"private":{"nimbleTaskId":p.task_id}}
    })
}

pub fn parse_event(v: &Value) -> Result<RemoteEvent, CalendarApiError> {
    let event_id = v.get("id").and_then(Value::as_str).ok_or(CalendarApiError::InvalidResponse)?.to_owned();
    let etag = v.get("etag").and_then(Value::as_str).map(str::to_owned);
    if v.get("status").and_then(Value::as_str) == Some("cancelled") {
        return Ok(RemoteEvent { event_id, etag, projection:None, cancelled:true });
    }
    if v.get("recurrence").is_some() || v.pointer("/start/date").is_some() { return Ok(RemoteEvent { event_id, etag, projection:None, cancelled:false }); }
    let task_id = v.pointer("/extendedProperties/private/nimbleTaskId").and_then(Value::as_str).ok_or(CalendarApiError::InvalidResponse)?.to_owned();
    let start = v.pointer("/start/dateTime").and_then(Value::as_str).ok_or(CalendarApiError::InvalidResponse)?;
    let end = v.pointer("/end/dateTime").and_then(Value::as_str).ok_or(CalendarApiError::InvalidResponse)?;
    let start=chrono::DateTime::parse_from_rfc3339(start).map_err(|_|CalendarApiError::InvalidResponse)?.with_timezone(&chrono::Utc).to_rfc3339();
    let end=chrono::DateTime::parse_from_rfc3339(end).map_err(|_|CalendarApiError::InvalidResponse)?.with_timezone(&chrono::Utc).to_rfc3339();
    let timezone = v.pointer("/start/timeZone").and_then(Value::as_str).unwrap_or("UTC");
    let overrides = v.pointer("/reminders/overrides").and_then(Value::as_array).ok_or(CalendarApiError::InvalidResponse)?;
    if overrides.len()!=1 || overrides[0].get("method").and_then(Value::as_str)!=Some("popup") { return Ok(RemoteEvent { event_id, etag, projection:None, cancelled:false }); }
    let offset = overrides[0].get("minutes").and_then(Value::as_i64).ok_or(CalendarApiError::InvalidResponse)?;
    if !(0..=40320).contains(&offset) { return Ok(RemoteEvent { event_id, etag, projection:None, cancelled:false }); }
    Ok(RemoteEvent { event_id, etag, projection:Some(CalendarProjection { task_id, content:v.get("summary").and_then(Value::as_str).unwrap_or("").into(), description:v.get("description").and_then(Value::as_str).unwrap_or("").into(), start_rfc3339:start, end_rfc3339:end, timezone:timezone.into(), reminder_offset_minutes:offset }), cancelled:false })
}
