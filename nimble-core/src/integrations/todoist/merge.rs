use crate::integrations::todoist::mappers::TaskSnapshot;
use chrono::{DateTime, Utc};

#[derive(Debug, Default, PartialEq)]
pub struct MergePlan {
    pub content: Option<String>,
    pub description: Option<String>,
    pub due_date: Option<Option<String>>, // Some(None) = clear the due date
    pub due_time: Option<Option<String>>, // Some(None) = clear the due time
    pub duration_minutes: Option<Option<i64>>, // Some(None) = clear the duration
    pub priority: Option<i64>,
    pub project_external_id: Option<String>,
    pub completed: Option<bool>,
    pub labels: Option<Vec<String>>,
}

impl MergePlan {
    pub fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.description.is_none()
            && self.due_date.is_none()
            && self.due_time.is_none()
            && self.duration_minutes.is_none()
            && self.priority.is_none()
            && self.project_external_id.is_none()
            && self.completed.is_none()
            && self.labels.is_none()
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
        due_time: pick(&local.due_time, base.map(|b| &b.due_time), &remote.due_time, remote_wins_conflicts),
        duration_minutes: pick(
            &local.duration_minutes,
            base.map(|b| &b.duration_minutes),
            &remote.duration_minutes,
            remote_wins_conflicts,
        ),
        priority: pick(&local.priority, base.map(|b| &b.priority), &remote.priority, remote_wins_conflicts),
        project_external_id: pick(
            &local.project_external_id,
            base.map(|b| &b.project_external_id),
            &remote.project_external_id,
            remote_wins_conflicts,
        )
        .flatten(),
        completed: pick(&local.checked, base.map(|b| &b.checked), &remote.checked, remote_wins_conflicts),
        labels: pick(&local.labels, base.map(|b| &b.labels), &remote.labels, remote_wins_conflicts),
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
    fn missing_local_timestamp_cedes_conflict_to_remote() {
        // Pins the observable contract behind local_ts_to_utc's DST-ambiguous /
        // nonexistent-time None (see its doc comment): when we have no reliable
        // local timestamp to compare, a same-field conflict resolves to remote
        // rather than blocking the sync. The test environment's TZ isn't
        // controlled, so we pin this structurally via merge_task's inputs
        // instead of forcing an actual DST transition through the parser.
        let base = snap("a", None, 1);
        let local = snap("local-edit", None, 1);
        let remote = snap("remote-edit", None, 1);
        let some_remote_ts = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T11:00:00Z");
        let plan = merge_task(&local, Some(&base), &remote, None, some_remote_ts);
        assert_eq!(plan.content.as_deref(), Some("remote-edit"));
    }

    #[test]
    fn convergent_edit_applies_remote_as_data_preserving_no_op() {
        // Both sides changed the same field to the same value (e.g. two
        // clients independently made the identical edit). local == remote but
        // both differ from base — pick's (true, true) arm still resolves via
        // remote_wins_conflicts and applies remote, which is a no-op in
        // content but confirms the conflict arm doesn't special-case equality.
        let base = snap("a", None, 1);
        let local = snap("same-edit", None, 1);
        let remote = snap("same-edit", None, 1);
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("same-edit"));
    }

    // ── Task 9: labels / due_time / duration_minutes ──

    #[test]
    fn labels_remote_only_change_applies() {
        let base = TaskSnapshot { content: "a".into(), labels: vec!["work".into()], ..Default::default() };
        let local = base.clone();
        let remote = TaskSnapshot { labels: vec!["urgent".into(), "work".into()], ..base.clone() };
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.labels, Some(vec!["urgent".to_string(), "work".to_string()]));
    }

    #[test]
    fn labels_both_changed_uses_lww() {
        let base = TaskSnapshot { content: "a".into(), labels: vec!["work".into()], ..Default::default() };
        let local = TaskSnapshot { labels: vec!["local-only".into(), "work".into()], ..base.clone() };
        let remote = TaskSnapshot { labels: vec!["remote-only".into(), "work".into()], ..base.clone() };
        let older = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T09:00:00Z");
        let newer = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T11:00:00Z");
        let plan = merge_task(&local, Some(&base), &remote, older, newer);
        assert_eq!(plan.labels, Some(vec!["remote-only".to_string(), "work".to_string()]));
        let plan2 = merge_task(&local, Some(&base), &remote, newer, older);
        assert_eq!(plan2.labels, None); // local newer -> keep local
    }

    #[test]
    fn due_time_independent_of_due_date() {
        let base = TaskSnapshot { due_date: Some("2026-08-05".into()), due_time: None, ..Default::default() };
        let local = TaskSnapshot { due_date: Some("2026-08-09".into()), ..base.clone() }; // local reschedules date
        let remote = TaskSnapshot { due_time: Some("09:00".into()), ..base.clone() }; // remote sets time
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.due_time, Some(Some("09:00".to_string()))); // remote-only time change applies
        assert_eq!(plan.due_date, None); // local reschedule kept (outbox will push it)
    }

    #[test]
    fn duration_behaves_like_priority() {
        let base = TaskSnapshot { duration_minutes: Some(30), ..Default::default() };
        let local = base.clone();
        let remote = TaskSnapshot { duration_minutes: Some(60), ..base.clone() };
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.duration_minutes, Some(Some(60)));

        // conflict -> LWW, same shape as priority
        let local2 = TaskSnapshot { duration_minutes: Some(15), ..base.clone() };
        let older = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T09:00:00Z");
        let newer = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T11:00:00Z");
        let plan_local_wins = merge_task(&local2, Some(&base), &remote, newer, older);
        assert_eq!(plan_local_wins.duration_minutes, None);
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
