use std::collections::HashMap;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistDue {
    pub date: Option<String>,
    #[serde(default)]
    pub datetime: Option<String>,
    pub string: Option<String>,
    pub is_recurring: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistDuration {
    pub amount: Option<i64>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistItem {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub section_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub child_order: Option<i64>,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub is_deleted: Option<bool>,
    #[serde(default)]
    pub updated_at: Option<String>,
    /// When a checked item was completed (RFC 3339), if Todoist sent it.
    #[serde(default)]
    pub completed_at: Option<String>,
    /// When the task was created (RFC 3339), if Todoist sent it.
    #[serde(default)]
    pub added_at: Option<String>,
    #[serde(default)]
    pub due: Option<TodoistDue>,
    #[serde(default)]
    pub duration: Option<TodoistDuration>,
    #[serde(default)]
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub is_deleted: Option<bool>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub inbox_project: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistSection {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub is_deleted: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SyncResponse {
    #[serde(default)]
    pub sync_token: Option<String>,
    #[serde(default)]
    pub full_sync: Option<bool>,
    #[serde(default)]
    pub items: Vec<TodoistItem>,
    #[serde(default)]
    pub projects: Vec<TodoistProject>,
    #[serde(default)]
    pub sections: Vec<TodoistSection>,
    #[serde(default)]
    pub temp_id_mapping: HashMap<String, String>,
    #[serde(default)]
    pub sync_status: HashMap<String, serde_json::Value>,
}

/// A per-command sync_status value is the literal string "ok" on success,
/// or an error object on failure.
pub fn command_ok(status: &serde_json::Value) -> bool {
    status.as_str() == Some("ok")
}

pub async fn sync(token: &str, body: &serde_json::Value) -> crate::Result<SyncResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.todoist.com/api/v1/sync")
        .bearer_auth(token)
        .json(body)
        .send()
        .await
        .map_err(|e| crate::Error::Api(format!("Todoist sync request error: {}", e)))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(crate::Error::Api(format!("todoist sync HTTP {status}: {text}")));
    }
    resp.json::<SyncResponse>()
        .await
        .map_err(|e| crate::Error::Api(format!("Todoist sync parse error: {}", e)))
}

/// One task's remote state, for the one-time reconcile. 404 means deleted
/// (probed live: completed → `checked: true`, deleted → `is_deleted: true`,
/// task in an archived project → both false plus its `project_id`).
pub async fn get_task_status(
    token: &str,
    id: &str,
) -> crate::Result<crate::integrations::todoist::reconcile::RemoteStatus> {
    use crate::integrations::todoist::reconcile::{classify_task_json, RemoteStatus};
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default()
    });
    let mut url = reqwest::Url::parse("https://api.todoist.com/api/v1/tasks/")
        .map_err(|e| crate::Error::Api(format!("todoist task lookup url: {e}")))?;
    url.path_segments_mut()
        .map_err(|_| crate::Error::Api("todoist task lookup url".into()))?
        .pop_if_empty()
        .push(id);
    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| crate::Error::Api(format!("todoist task lookup: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(RemoteStatus::Deleted);
    }
    if !resp.status().is_success() {
        return Err(crate::Error::Api(format!("todoist task lookup HTTP {}", resp.status())));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| crate::Error::Api(format!("todoist task lookup parse: {e}")))?;
    Ok(classify_task_json(&v))
}

pub const TODOIST_SYNC_URL: &str = "https://api.todoist.com/api/v1/sync";
pub const TODOIST_ACTIVITIES_URL: &str = "https://api.todoist.com/api/v1/activities";

/// One Todoist activity-log event (`GET /api/v1/activities`, the shape the
/// official SDK reads: `results[]` + `next_cursor`).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct ActivityEvent {
    pub object_id: String,
    pub event_type: String,
    /// RFC 3339, UTC.
    pub event_date: String,
}

#[derive(Debug, serde::Deserialize)]
struct ActivityPage {
    #[serde(default)]
    results: Vec<ActivityEvent>,
    #[serde(default)]
    next_cursor: Option<String>,
}

/// Todoist's activity log, as the momentum ledger needs it: item completions
/// since a moment. Production is `HttpActivitySource`; tests use fakes.
#[allow(async_fn_in_trait)]
pub trait ActivitySource {
    /// Item completion events around `since` (RFC 3339), optionally narrowed
    /// to one item. The window is coarse (day precision on the wire); the
    /// caller applies the exact boundary.
    async fn completed_items_since(&self, since: &str, object_id: Option<&str>) -> crate::Result<Vec<ActivityEvent>>;
}

pub struct HttpActivitySource {
    client: reqwest::Client,
    url: reqwest::Url,
    token: String,
}

impl HttpActivitySource {
    /// Pages followed per call. A normal sync has at most a handful of
    /// recurring completions; anything past this is simply not counted.
    const MAX_PAGES: usize = 5;

    pub fn todoist(token: String) -> crate::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| crate::Error::Api(format!("Todoist client: {e}")))?;
        let url = reqwest::Url::parse(TODOIST_ACTIVITIES_URL)
            .map_err(|e| crate::Error::Api(format!("todoist activities url: {e}")))?;
        Ok(Self { client, url, token })
    }
}

/// One page's URL, with the parameter names the official Todoist SDK (5.9.0)
/// sends for `getActivityLogs({objectType, eventType, objectId, since, until,
/// cursor, limit})`: snake_case, `task` normalized to `item`, and `since` /
/// `until` as `YYYY-MM-DD` dates. `since` is the day before the instant's UTC
/// date so any zone's local date is covered; the caller filters precisely.
/// Built with `query_pairs_mut`: cursors carry `+ / =`.
pub fn activity_url(
    base: &reqwest::Url,
    since: chrono::DateTime<chrono::Utc>,
    until: chrono::NaiveDate,
    object_id: Option<&str>,
    cursor: Option<&str>,
) -> reqwest::Url {
    let mut url = base.clone();
    {
        let since_day = since.date_naive().pred_opt().unwrap_or(since.date_naive());
        let mut q = url.query_pairs_mut();
        q.append_pair("object_type", "item");
        q.append_pair("event_type", "completed");
        q.append_pair("since", &since_day.format("%Y-%m-%d").to_string());
        q.append_pair("until", &until.format("%Y-%m-%d").to_string());
        q.append_pair("limit", "100");
        if let Some(id) = object_id { q.append_pair("object_id", id); }
        if let Some(c) = cursor { q.append_pair("cursor", c); }
    }
    url
}

impl ActivitySource for HttpActivitySource {
    async fn completed_items_since(&self, since: &str, object_id: Option<&str>) -> crate::Result<Vec<ActivityEvent>> {
        let since = chrono::DateTime::parse_from_rfc3339(since)
            .map_err(|e| crate::Error::Api(format!("todoist activities since: {e}")))?
            .with_timezone(&chrono::Utc);
        let until = chrono::Utc::now().date_naive().succ_opt().unwrap_or(chrono::Utc::now().date_naive());
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..Self::MAX_PAGES {
            let url = activity_url(&self.url, since, until, object_id, cursor.as_deref());
            let resp = self.client.get(url).bearer_auth(&self.token).send().await
                .map_err(|e| crate::Error::Api(format!("todoist activities: {e}")))?;
            if !resp.status().is_success() {
                return Err(crate::Error::Api(format!("todoist activities HTTP {}", resp.status())));
            }
            let page: ActivityPage = resp.json().await
                .map_err(|e| crate::Error::Api(format!("todoist activities parse: {e}")))?;
            out.extend(page.results);
            match page.next_cursor {
                Some(c) if !c.is_empty() => cursor = Some(c),
                _ => break,
            }
        }
        Ok(out)
    }
}

/// Outcome of one `/sync` command request, classified by what it proves about
/// delivery. `NotSent` means the request never left (safe to retry);
/// `Uncertain` means the server may have processed it (timeout after send,
/// unreadable success body, a gateway error) and must not be retried blindly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    NotSent(String),
    Uncertain(String),
    Auth,
    RateLimited(Option<u64>),
    /// Server explicitly declined before processing (503); retry later.
    Transient(Option<u64>),
    Gone,
    Rejected(String),
}

/// Command transport seam for the focus delivery dispatcher. Production uses
/// `HttpSyncTransport`; tests use scripted mocks or a loopback server.
#[allow(async_fn_in_trait)]
pub trait SyncTransport {
    /// Stable, non-secret identity of the credential in use, so an auth pause
    /// lasts until the user reconnects with a different token.
    fn credential_fingerprint(&self) -> String;
    async fn send_commands(&self, commands: &[serde_json::Value]) -> Result<SyncResponse, TransportError>;
}

#[derive(Clone)]
pub struct HttpSyncTransport {
    client: reqwest::Client,
    url: reqwest::Url,
    token: String,
}

impl HttpSyncTransport {
    /// `url` must be https, or loopback for tests.
    pub fn new(client: reqwest::Client, url: &str, token: String) -> crate::Result<Self> {
        let url = reqwest::Url::parse(url).map_err(|e| crate::Error::Other(format!("invalid: sync url {e}")))?;
        if url.scheme() != "https" && !matches!(url.host_str(), Some("127.0.0.1" | "localhost")) {
            return Err(crate::Error::Other("invalid: sync url must be https".into()));
        }
        Ok(Self { client, url, token })
    }

    pub fn todoist(token: String) -> crate::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| crate::Error::Api(format!("Todoist client: {e}")))?;
        Self::new(client, TODOIST_SYNC_URL, token)
    }
}

impl SyncTransport for HttpSyncTransport {
    fn credential_fingerprint(&self) -> String {
        blake3::hash(self.token.as_bytes()).to_hex()[..16].to_string()
    }

    async fn send_commands(&self, commands: &[serde_json::Value]) -> Result<SyncResponse, TransportError> {
        let response = self
            .client
            .post(self.url.clone())
            .bearer_auth(&self.token)
            .json(&serde_json::json!({ "commands": commands }))
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() || e.is_builder() {
                    TransportError::NotSent(e.to_string())
                } else {
                    TransportError::Uncertain(e.to_string())
                }
            })?;
        let status = response.status();
        if !status.is_success() {
            let retry_after = response
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok());
            let body = response.text().await.unwrap_or_default();
            return Err(match status.as_u16() {
                401 | 403 => TransportError::Auth,
                429 => TransportError::RateLimited(retry_after),
                503 => TransportError::Transient(retry_after),
                404 | 410 => TransportError::Gone,
                s if s >= 500 => TransportError::Uncertain(format!("HTTP {s}")),
                s => TransportError::Rejected(format!("HTTP {s}: {}", body.chars().take(200).collect::<String>())),
            });
        }
        response
            .json::<SyncResponse>()
            .await
            .map_err(|e| TransportError::Uncertain(format!("unreadable success response: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_activity_request_uses_the_sdk_parameter_names() {
        let base = reqwest::Url::parse(TODOIST_ACTIVITIES_URL).unwrap();
        let since = chrono::DateTime::parse_from_rfc3339("2026-08-04T01:30:00Z").unwrap().with_timezone(&chrono::Utc);
        let until = chrono::NaiveDate::from_ymd_opt(2026, 8, 6).unwrap();
        let url = activity_url(&base, since, until, Some("R1"), Some("a+b/c="));
        let pairs: Vec<(String, String)> = url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
        let want: Vec<(String, String)> = [
            ("object_type", "item"), ("event_type", "completed"),
            ("since", "2026-08-03"), ("until", "2026-08-06"), ("limit", "100"),
            ("object_id", "R1"), ("cursor", "a+b/c="),
        ].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(pairs, want, "since is a day early so any zone's local date is covered");
        assert!(url.as_str().starts_with("https://api.todoist.com/api/v1/activities?"));
        assert!(url.as_str().contains("cursor=a%2Bb%2Fc%3D"), "{url}");
    }

    #[test]
    fn deserializes_sync_response() {
        let json = r#"{
            "sync_token": "abcTOKEN",
            "full_sync": true,
            "items": [{
                "id": "6X7rM8997g3RQmvh",
                "content": "Buy milk",
                "description": "",
                "project_id": "6Jf8VQXxpwv56VQ7",
                "section_id": null,
                "parent_id": null,
                "priority": 1,
                "child_order": 3,
                "checked": false,
                "is_deleted": false,
                "updated_at": "2026-08-04T10:00:00.000000Z",
                "due": {"date": "2026-08-05", "string": "every day", "is_recurring": true}
            }],
            "projects": [{"id": "6Jf8VQXxpwv56VQ7", "name": "Errands", "is_deleted": false}],
            "sections": [{"id": "sec1", "project_id": "6Jf8VQXxpwv56VQ7", "name": "Soon", "is_deleted": false}],
            "temp_id_mapping": {"tmp-1": "real-1"},
            "sync_status": {"uuid-1": "ok", "uuid-2": {"error": "Item not found", "error_code": 20}}
        }"#;
        let resp: SyncResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.sync_token.as_deref(), Some("abcTOKEN"));
        let item = &resp.items[0];
        assert_eq!(item.content, "Buy milk");
        assert_eq!(item.due.as_ref().unwrap().is_recurring, Some(true));
        assert_eq!(resp.temp_id_mapping.get("tmp-1").unwrap(), "real-1");
        assert!(command_ok(&resp.sync_status["uuid-1"]));
        assert!(!command_ok(&resp.sync_status["uuid-2"]));
    }

    #[test]
    fn tolerates_missing_optional_blocks() {
        let resp: SyncResponse = serde_json::from_str(r#"{"sync_token": "t"}"#).unwrap();
        assert!(resp.items.is_empty());
        assert!(resp.sync_status.is_empty());
    }
}
