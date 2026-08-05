use crate::integrations::todoist::mappers::TaskSnapshot;
use chrono::{DateTime, Utc};

#[derive(Debug, Default, PartialEq)]
pub struct MergePlan {
    pub content: Option<String>,
    pub description: Option<String>,
    pub due_date: Option<Option<String>>, // Some(None) = clear the due date
    pub priority: Option<i64>,
    pub project_external_id: Option<String>,
    pub completed: Option<bool>,
}

impl MergePlan {
    pub fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.description.is_none()
            && self.due_date.is_none()
            && self.priority.is_none()
            && self.project_external_id.is_none()
            && self.completed.is_none()
    }
}

/// Three-way per-field merge.
/// - field unchanged remotely → keep local (None in plan)
/// - field changed remotely only → apply remote
/// - field changed on both sides → last-write-wins by timestamp (ties → remote,
///   since Todoist was the visible copy)
/// - no base (first contact) → remote is authoritative for every field
pub fn merge_task(
    local: &TaskSnapshot,
    base: Option<&TaskSnapshot>,
    remote: &TaskSnapshot,
    local_updated_utc: Option<DateTime<Utc>>,
    remote_updated_utc: Option<DateTime<Utc>>,
) -> MergePlan {
    let remote_wins_conflicts = match (local_updated_utc, remote_updated_utc) {
        (Some(l), Some(r)) => r >= l,
        _ => true,
    };

    fn pick<T: PartialEq + Clone>(
        local: &T,
        base: Option<&T>,
        remote: &T,
        remote_wins_conflicts: bool,
    ) -> Option<T> {
        match base {
            None => (local != remote).then(|| remote.clone()),
            Some(b) => {
                let remote_changed = b != remote;
                let local_changed = b != local;
                match (local_changed, remote_changed) {
                    (_, false) => None,
                    (false, true) => Some(remote.clone()),
                    (true, true) => remote_wins_conflicts.then(|| remote.clone()),
                }
            }
        }
    }

    MergePlan {
        content: pick(&local.content, base.map(|b| &b.content), &remote.content, remote_wins_conflicts),
        description: pick(&local.description, base.map(|b| &b.description), &remote.description, remote_wins_conflicts),
        due_date: pick(&local.due_date, base.map(|b| &b.due_date), &remote.due_date, remote_wins_conflicts),
        priority: pick(&local.priority, base.map(|b| &b.priority), &remote.priority, remote_wins_conflicts),
        project_external_id: pick(
            &local.project_external_id,
            base.map(|b| &b.project_external_id),
            &remote.project_external_id,
            remote_wins_conflicts,
        )
        .flatten(),
        completed: pick(&local.checked, base.map(|b| &b.checked), &remote.checked, remote_wins_conflicts),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::todoist::mappers::TaskSnapshot;

    fn snap(content: &str, due: Option<&str>, priority: i64) -> TaskSnapshot {
        TaskSnapshot {
            content: content.into(),
            due_date: due.map(String::from),
            priority,
            ..Default::default()
        }
    }

    #[test]
    fn echo_produces_empty_plan() {
        let base = snap("a", Some("2026-08-05"), 1);
        let plan = merge_task(&base.clone(), Some(&base), &base.clone(), None, None);
        assert!(plan.is_empty());
    }

    #[test]
    fn remote_only_change_applies_remotely_changed_field_only() {
        let base = snap("a", Some("2026-08-05"), 1);
        let local = base.clone();
        let remote = snap("b", Some("2026-08-05"), 1);
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("b"));
        assert_eq!(plan.due_date, None);
        assert_eq!(plan.priority, None);
    }

    #[test]
    fn independent_field_changes_merge_without_clobbering() {
        // local rescheduled, remote renamed — both survive
        let base = snap("a", Some("2026-08-05"), 1);
        let local = snap("a", Some("2026-08-09"), 1);
        let remote = snap("b", Some("2026-08-05"), 1);
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("b")); // remote rename applied
        assert_eq!(plan.due_date, None);                // local reschedule kept (outbox will push it)
    }

    #[test]
    fn same_field_conflict_uses_lww_remote_newer() {
        let base = snap("a", None, 1);
        let local = snap("local-edit", None, 1);
        let remote = snap("remote-edit", None, 1);
        let older = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T09:00:00Z");
        let newer = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T11:00:00Z");
        let plan = merge_task(&local, Some(&base), &remote, older, newer);
        assert_eq!(plan.content.as_deref(), Some("remote-edit"));
        let plan2 = merge_task(&local, Some(&base), &remote, newer, older);
        assert_eq!(plan2.content, None); // local newer → local wins, keep local
    }

    #[test]
    fn no_base_means_remote_is_authoritative() {
        let local = snap("local", None, 1);
        let remote = snap("remote", Some("2026-08-06"), 3);
        let plan = merge_task(&local, None, &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("remote"));
        assert_eq!(plan.due_date, Some(Some("2026-08-06".into())));
        assert_eq!(plan.priority, Some(3));
    }

    #[test]
    fn remote_completion_applies() {
        let base = snap("a", None, 1);
        let mut remote = base.clone();
        remote.checked = true;
        let plan = merge_task(&base.clone(), Some(&base), &remote, None, None);
        assert_eq!(plan.completed, Some(true));
    }
}
