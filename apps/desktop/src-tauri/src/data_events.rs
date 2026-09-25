//! Cross-window invalidation for app-handled writes.
//!
//! Every webview (main window, capture strip, focus companion) keeps its own
//! task lists, and the frontend `tasks-changed` bus is window-local. A write
//! committed here is announced once as `nimble-data-changed` — the same
//! shape `agent_server.rs` and the Google Calendar paths already emit — so
//! `provider-events.ts` re-reads in every window. Payloads carry ids only,
//! never task bodies. Nothing listening to this event writes data back, so
//! there is no emit loop (lib.rs only runs a reminder tick per event).
use nimble_core::agent_protocol::{DataChanged, Domain, VERSION};
use nimble_core::focus_types::FocusAction;
use tauri::{AppHandle, Emitter};

pub const DATA_CHANGED_EVENT: &str = "nimble-data-changed";

pub const TASKS: &[Domain] = &[Domain::Tasks];
pub const LABELS: &[Domain] = &[Domain::Labels];
pub const TASKS_AND_LABELS: &[Domain] = &[Domain::Tasks, Domain::Labels];
pub const SECTIONS: &[Domain] = &[Domain::Sections];
pub const TASKS_AND_SECTIONS: &[Domain] = &[Domain::Tasks, Domain::Sections];
pub const PROJECTS: &[Domain] = &[Domain::Projects];
pub const TASKS_AND_PROJECTS: &[Domain] = &[Domain::Tasks, Domain::Projects];
pub const BRIEF: &[Domain] = &[Domain::Brief];

pub fn payload(domains: &[Domain], ids: Vec<String>) -> DataChanged {
    DataChanged { version: VERSION, domains: domains.to_vec(), ids }
}

/// Passes `result` through, calling `emit` once with the payload only when
/// the write succeeded. Pure so the success-only rule is testable without a
/// Tauri runtime.
pub fn on_success<T, E>(
    result: Result<T, E>,
    domains: &[Domain],
    ids: impl FnOnce(&T) -> Vec<String>,
    emit: impl FnOnce(DataChanged),
) -> Result<T, E> {
    if let Ok(value) = &result {
        emit(payload(domains, ids(value)));
    }
    result
}

/// Announce an already-committed write to every window (emit errors ignored).
pub fn broadcast(app: &AppHandle, domains: &[Domain], ids: Vec<String>) {
    let _ = app.emit(DATA_CHANGED_EVENT, payload(domains, ids));
}

/// Announce a committed write to every window. Call with the command's
/// result: failures emit nothing. An emit error is ignored — the write has
/// already committed and each window re-reads on visibility anyway.
pub fn after_commit<T, E>(
    app: &AppHandle,
    result: Result<T, E>,
    domains: &[Domain],
    ids: impl FnOnce(&T) -> Vec<String>,
) -> Result<T, E> {
    on_success(result, domains, ids, |p| {
        let _ = app.emit(DATA_CHANGED_EVENT, p);
    })
}

/// Focus actions whose commit also changes native task rows (status on
/// start, completion, restore after delete). Mirrors `TOUCHES_TASKS` in
/// `useFocusTrayData.ts`.
pub fn focus_action_touches_tasks(action: &FocusAction) -> bool {
    matches!(
        action,
        FocusAction::Start { .. } | FocusAction::Complete { .. } | FocusAction::UndoDelete { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn payload_matches_the_agent_server_shape() {
        let value = serde_json::to_value(payload(TASKS, vec!["t1".into()])).unwrap();
        assert_eq!(value, json!({"version":1,"domains":["tasks"],"ids":["t1"]}));
        let value = serde_json::to_value(payload(TASKS_AND_SECTIONS, vec![])).unwrap();
        assert_eq!(value, json!({"version":1,"domains":["tasks","sections"],"ids":[]}));
    }

    #[test]
    fn emits_once_on_success_with_ids_from_the_result() {
        let mut seen = Vec::new();
        let out: Result<&str, String> =
            on_success(Ok("task-9"), TASKS, |id| vec![id.to_string()], |p| seen.push(p));
        assert_eq!(out, Ok("task-9"));
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].ids, vec!["task-9".to_string()]);
        assert_eq!(seen[0].domains, vec![Domain::Tasks]);
    }

    #[test]
    fn failed_writes_emit_nothing_and_keep_the_error() {
        let mut calls = 0;
        let out: Result<(), String> =
            on_success(Err("nope".into()), TASKS, |_| vec![], |_| calls += 1);
        assert_eq!(out, Err("nope".to_string()));
        assert_eq!(calls, 0);
    }

    #[test]
    fn only_task_touching_focus_actions_broadcast() {
        assert!(focus_action_touches_tasks(&FocusAction::Start { occurrence_id: "o".into() }));
        assert!(focus_action_touches_tasks(&FocusAction::Complete { occurrence_id: "o".into() }));
        assert!(focus_action_touches_tasks(&FocusAction::UndoDelete { token: "t".into() }));
        assert!(!focus_action_touches_tasks(&FocusAction::Pause));
        assert!(!focus_action_touches_tasks(&FocusAction::Reorder { entry_ids: vec![] }));
        assert!(!focus_action_touches_tasks(&FocusAction::Remove { occurrence_id: "o".into() }));
    }
}
