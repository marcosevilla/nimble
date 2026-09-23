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
