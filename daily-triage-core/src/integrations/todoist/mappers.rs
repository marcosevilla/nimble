use crate::integrations::todoist::client::TodoistItem;
use crate::types::LocalTask;
use chrono::TimeZone;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct TaskSnapshot {
    pub content: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub due_date: Option<String>, // YYYY-MM-DD
    #[serde(default)]
    pub due: Option<serde_json::Value>, // full remote due object (recurrence lives here)
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub project_external_id: Option<String>, // "section:{id}" for sections
    #[serde(default)]
    pub parent_external_id: Option<String>,
    #[serde(default)]
    pub checked: bool,
}

pub fn item_to_snapshot(item: &TodoistItem) -> TaskSnapshot {
    TaskSnapshot {
        content: item.content.clone(),
        description: item.description.clone().unwrap_or_default(),
        due_date: item
            .due
            .as_ref()
            .and_then(|d| d.date.as_ref())
            .map(|d| d.chars().take(10).collect()),
        due: item.due.as_ref().map(|d| {
            serde_json::json!({"date": d.date, "string": d.string, "is_recurring": d.is_recurring})
        }),
        priority: item.priority.unwrap_or(1),
        project_external_id: item
            .section_id
            .as_ref()
            .map(|s| format!("section:{s}"))
            .or_else(|| item.project_id.clone()),
        parent_external_id: item.parent_id.clone(),
        checked: item.checked.unwrap_or(false),
    }
}

/// Project the local task into snapshot space so merge compares like with like.
/// `base` supplies the remote due object (local rows can't produce recurrence info).
pub fn local_to_snapshot(
    task: &LocalTask,
    project_external_id: Option<String>,
    parent_external_id: Option<String>,
    base: Option<&TaskSnapshot>,
) -> TaskSnapshot {
    TaskSnapshot {
        content: task.content.clone(),
        description: task.description.clone().unwrap_or_default(),
        due_date: task.due_date.clone(),
        due: base.and_then(|b| b.due.clone()),
        priority: task.priority,
        project_external_id,
        parent_external_id,
        checked: task.completed,
    }
}

pub fn due_args(new_due_date: Option<&str>, base_due: Option<&serde_json::Value>) -> serde_json::Value {
    match (new_due_date, base_due) {
        (None, _) => serde_json::json!({ "due": serde_json::Value::Null }),
        (Some(d), Some(base))
            if base.get("is_recurring").and_then(|v| v.as_bool()).unwrap_or(false) =>
        {
            let string = base.get("string").and_then(|v| v.as_str()).unwrap_or_default();
            serde_json::json!({ "due": { "string": string, "date": d } })
        }
        (Some(d), _) => serde_json::json!({ "due": { "date": d } }),
    }
}

pub fn local_ts_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()?;
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

pub fn rfc3339_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(due: Option<crate::integrations::todoist::client::TodoistDue>) -> crate::integrations::todoist::client::TodoistItem {
        serde_json::from_value(json!({
            "id": "R1", "content": "c", "description": "d",
            "project_id": "P1", "section_id": null, "parent_id": null,
            "priority": 3, "checked": false, "is_deleted": false,
            "updated_at": "2026-08-04T10:00:00Z",
            "due": due.map(|d| json!({"date": d.date, "string": d.string, "is_recurring": d.is_recurring}))
        }))
        .unwrap()
    }

    #[test]
    fn section_becomes_pseudo_project_external_id() {
        let mut it = item(None);
        it.section_id = Some("S9".into());
        let snap = item_to_snapshot(&it);
        assert_eq!(snap.project_external_id.as_deref(), Some("section:S9"));
    }

    #[test]
    fn plain_project_when_no_section() {
        let snap = item_to_snapshot(&item(None));
        assert_eq!(snap.project_external_id.as_deref(), Some("P1"));
        assert_eq!(snap.priority, 3);
        assert_eq!(snap.due_date, None);
    }

    #[test]
    fn recurring_reschedule_preserves_due_string() {
        let base_due = json!({"date": "2026-08-04", "string": "every day", "is_recurring": true});
        let args = due_args(Some("2026-08-10"), Some(&base_due));
        assert_eq!(args["due"]["string"], "every day");
        assert_eq!(args["due"]["date"], "2026-08-10");
    }

    #[test]
    fn non_recurring_reschedule_sends_plain_date() {
        let base_due = json!({"date": "2026-08-04", "string": "Aug 4", "is_recurring": false});
        let args = due_args(Some("2026-08-10"), Some(&base_due));
        assert_eq!(args["due"]["date"], "2026-08-10");
        assert!(args["due"].get("string").is_none());
    }

    #[test]
    fn clearing_due_sends_null() {
        let args = due_args(None, None);
        assert!(args["due"].is_null());
    }

    #[test]
    fn timestamp_parsers() {
        assert!(local_ts_to_utc("2026-08-04 10:30:00").is_some());
        assert!(local_ts_to_utc("garbage").is_none());
        assert!(rfc3339_to_utc("2026-08-04T10:00:00.000000Z").is_some());
    }
}
