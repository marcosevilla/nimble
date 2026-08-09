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
    #[serde(default)]
    pub due_time: Option<String>, // "HH:MM" 24h, None = all-day
    #[serde(default)]
    pub duration_minutes: Option<i64>,
    #[serde(default)]
    pub labels: Vec<String>, // Todoist label NAMES, sorted
}

/// Extracts "HH:MM" out of a Todoist `due.datetime` value. Treated as a local
/// wall-clock string (mirroring `local_ts_to_utc`'s "no offset" contract) —
/// this deliberately does NOT do timezone math, it just lifts the time
/// component out of whatever `YYYY-MM-DDTHH:MM:SS[...]` string Todoist sent.
fn parse_due_time(datetime: &str) -> Option<String> {
    let time_part = datetime.split('T').nth(1)?;
    if time_part.len() < 5 {
        return None;
    }
    Some(time_part[..5].to_string())
}

/// Todoist's duration unit is "minute" or "day" — normalize both to minutes
/// so `TaskSnapshot::duration_minutes` is a single comparable scalar.
fn duration_to_minutes(duration: &crate::integrations::todoist::client::TodoistDuration) -> Option<i64> {
    match (duration.amount, duration.unit.as_deref()) {
        (Some(amount), Some("minute")) => Some(amount),
        (Some(amount), Some("day")) => Some(amount * 24 * 60),
        _ => None,
    }
}

pub fn item_to_snapshot(item: &TodoistItem) -> TaskSnapshot {
    let mut labels = item.labels.clone();
    labels.sort();
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
        due_time: item
            .due
            .as_ref()
            .and_then(|d| d.datetime.as_deref())
            .and_then(parse_due_time),
        duration_minutes: item.duration.as_ref().and_then(duration_to_minutes),
        priority: item.priority.unwrap_or(1),
        project_external_id: item
            .section_id
            .as_ref()
            .map(|s| format!("section:{s}"))
            .or_else(|| item.project_id.clone()),
        parent_external_id: item.parent_id.clone(),
        checked: item.checked.unwrap_or(false),
        labels,
    }
}

/// Project the local task into snapshot space so merge compares like with like.
/// `base` supplies the remote due object (local rows can't produce recurrence info).
/// `label_names` is the task's current label set resolved to Todoist-facing
/// names (sorted) — the caller resolves ids -> names since local labels are
/// Nimble-local ids that never round-trip to Todoist.
pub fn local_to_snapshot(
    task: &LocalTask,
    project_external_id: Option<String>,
    parent_external_id: Option<String>,
    base: Option<&TaskSnapshot>,
    mut label_names: Vec<String>,
) -> TaskSnapshot {
    label_names.sort();
    TaskSnapshot {
        content: task.content.clone(),
        description: task.description.clone().unwrap_or_default(),
        due_date: task.due_date.clone(),
        due: base.and_then(|b| b.due.clone()),
        due_time: task.due_time.clone(),
        duration_minutes: task.duration_minutes,
        priority: task.priority,
        project_external_id,
        parent_external_id,
        checked: task.completed,
        labels: label_names,
    }
}

/// Builds the `due` args for an `item_update`/`item_add` command. `new_due_time`
/// ("HH:MM") is combined with `new_due_date` into a local
/// `YYYY-MM-DDTHH:MM:SS` `datetime` string when present — mirrors the same
/// "no offset, local wall clock" contract as `local_ts_to_utc`/`due_time`.
pub fn due_args(
    new_due_date: Option<&str>,
    new_due_time: Option<&str>,
    base_due: Option<&serde_json::Value>,
) -> serde_json::Value {
    fn with_datetime(mut due: serde_json::Value, date: &str, time: Option<&str>) -> serde_json::Value {
        if let Some(t) = time {
            due["datetime"] = serde_json::Value::String(format!("{date}T{t}:00"));
        }
        due
    }

    match (new_due_date, base_due) {
        (None, _) => serde_json::json!({ "due": serde_json::Value::Null }),
        (Some(d), Some(base))
            if base.get("is_recurring").and_then(|v| v.as_bool()).unwrap_or(false) =>
        {
            // Recurrence lives entirely in the `string` field (e.g. "every day").
            // If the base's string is missing/null/empty we have nothing to
            // preserve — fall through to the plain-date branch rather than
            // sending an empty string that could corrupt the remote recurrence.
            match base.get("string").and_then(|v| v.as_str()) {
                Some(string) if !string.is_empty() => {
                    let due = with_datetime(serde_json::json!({ "string": string, "date": d }), d, new_due_time);
                    serde_json::json!({ "due": due })
                }
                _ => {
                    let due = with_datetime(serde_json::json!({ "date": d }), d, new_due_time);
                    serde_json::json!({ "due": due })
                }
            }
        }
        (Some(d), _) => {
            let due = with_datetime(serde_json::json!({ "date": d }), d, new_due_time);
            serde_json::json!({ "due": due })
        }
    }
}

/// Parses a local-clock timestamp ("YYYY-MM-DD HH:MM:SS", no offset) and
/// converts it to UTC using the system's local timezone.
///
/// `.single()` deliberately returns `None` when the naive time is ambiguous
/// (fall-back DST transition, two matching UTC instants) or nonexistent
/// (spring-forward DST transition, no matching UTC instant) — we don't guess.
/// Callers (see `merge::merge_task`) treat a missing local timestamp as "no
/// reliable local time to compare," which — combined with `remote_wins_conflicts`
/// defaulting to `true` whenever either side's timestamp is absent — means
/// remote wins by default in that edge case. That's the accepted design for
/// this single-user LWW app: an unresolvable local clock reading should not
/// block remote data from applying.
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
        let args = due_args(Some("2026-08-10"), None, Some(&base_due));
        assert_eq!(args["due"]["string"], "every day");
        assert_eq!(args["due"]["date"], "2026-08-10");
    }

    #[test]
    fn non_recurring_reschedule_sends_plain_date() {
        let base_due = json!({"date": "2026-08-04", "string": "Aug 4", "is_recurring": false});
        let args = due_args(Some("2026-08-10"), None, Some(&base_due));
        assert_eq!(args["due"]["date"], "2026-08-10");
        assert!(args["due"].get("string").is_none());
    }

    #[test]
    fn recurring_with_missing_string_falls_back_to_plain_date() {
        let base_due = json!({"date": "2026-08-04", "string": null, "is_recurring": true});
        let args = due_args(Some("2026-08-10"), None, Some(&base_due));
        assert_eq!(args["due"]["date"], "2026-08-10");
        assert!(args["due"].get("string").is_none());
    }

    #[test]
    fn clearing_due_sends_null() {
        let args = due_args(None, None, None);
        assert!(args["due"].is_null());
    }

    #[test]
    fn due_time_adds_local_datetime_string() {
        let args = due_args(Some("2026-08-10"), Some("09:30"), None);
        assert_eq!(args["due"]["date"], "2026-08-10");
        assert_eq!(args["due"]["datetime"], "2026-08-10T09:30:00");
    }

    #[test]
    fn due_time_survives_recurrence_preservation() {
        let base_due = json!({"date": "2026-08-04", "string": "every day", "is_recurring": true});
        let args = due_args(Some("2026-08-10"), Some("09:30"), Some(&base_due));
        assert_eq!(args["due"]["string"], "every day");
        assert_eq!(args["due"]["datetime"], "2026-08-10T09:30:00");
    }

    #[test]
    fn item_to_snapshot_parses_datetime_duration_and_sorts_labels() {
        let mut it = serde_json::from_value::<crate::integrations::todoist::client::TodoistItem>(json!({
            "id": "R1", "content": "c", "checked": false, "is_deleted": false,
            "due": {"date": "2026-08-10", "datetime": "2026-08-10T14:30:00", "string": "Aug 10", "is_recurring": false},
            "duration": {"amount": 45, "unit": "minute"},
            "labels": ["zeta", "alpha"]
        }))
        .unwrap();
        let snap = item_to_snapshot(&it);
        assert_eq!(snap.due_time.as_deref(), Some("14:30"));
        assert_eq!(snap.duration_minutes, Some(45));
        assert_eq!(snap.labels, vec!["alpha".to_string(), "zeta".to_string()]);

        // day-unit duration normalizes to minutes
        it.duration = Some(crate::integrations::todoist::client::TodoistDuration {
            amount: Some(2),
            unit: Some("day".to_string()),
        });
        let snap2 = item_to_snapshot(&it);
        assert_eq!(snap2.duration_minutes, Some(2 * 24 * 60));
    }

    #[test]
    fn item_to_snapshot_no_due_time_when_datetime_absent() {
        let snap = item_to_snapshot(&item(Some(crate::integrations::todoist::client::TodoistDue {
            date: Some("2026-08-10".into()),
            datetime: None,
            string: Some("Aug 10".into()),
            is_recurring: Some(false),
        })));
        assert_eq!(snap.due_time, None);
    }

    #[test]
    fn timestamp_parsers() {
        assert!(local_ts_to_utc("2026-08-04 10:30:00").is_some());
        assert!(local_ts_to_utc("garbage").is_none());
        assert!(rfc3339_to_utc("2026-08-04T10:00:00.000000Z").is_some());
    }
}
