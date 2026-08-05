use std::collections::HashMap;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistDue {
    pub date: Option<String>,
    pub string: Option<String>,
    pub is_recurring: Option<bool>,
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
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistProject {
    pub id: String,
    pub name: String,
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
