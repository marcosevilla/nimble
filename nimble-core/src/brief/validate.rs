//! Output validation (addendum §5): every id must resolve against the set the
//! model was shown; unknown ids are dropped, each list is capped at 3, and a
//! task appears in one list at most. Malformed output degrades to empty lists.

use std::collections::HashSet;

use serde_json::Value;

use crate::brief::candidates::{Candidate, CandidateSet};

pub const MAX_PER_LIST: usize = 3;

/// The Top priorities box's configured `count` (1–3), clamped.
pub fn priorities_cap(count: usize) -> usize {
    count.clamp(1, MAX_PER_LIST)
}
pub const SUMMARY_MAX_CHARS: usize = 240;
pub const REASON_MAX_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pick {
    pub task_id: String,
    /// The task title as it was when composed (frozen into `brief_items.title`).
    pub title: String,
    /// Empty when the list has no reasons or the rule-based ranker picked it.
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Composition {
    pub summary: String,
    pub priorities: Vec<Pick>,
    pub quick_help: Vec<Pick>,
    pub quick_self: Vec<Pick>,
    /// Real ids of this week's completions (read by phase 4).
    pub wins: Vec<String>,
}

fn one_line(s: &str, max_chars: usize) -> String {
    let first = s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let collapsed = first.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max_chars).collect()
}

fn entries<'a>(raw: &'a Value, key: &str) -> Vec<(&'a str, &'a str)> {
    raw.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|e| Some((e.get("task_id")?.as_str()?, e.get("reason").and_then(Value::as_str).unwrap_or(""))))
                .collect()
        })
        .unwrap_or_default()
}

fn take(
    raw: &Value,
    key: &str,
    set: &CandidateSet,
    used: &mut HashSet<String>,
    cap: usize,
    with_reason: bool,
    keep: impl Fn(&Candidate, &str) -> bool,
) -> Vec<Pick> {
    let mut out = Vec::new();
    for (id, reason) in entries(raw, key) {
        if out.len() == cap { break; }
        let Some(c) = set.open_ref(id) else { continue };
        let reason = one_line(reason, REASON_MAX_CHARS);
        if used.contains(&c.task_id) || !keep(c, &reason) { continue; }
        used.insert(c.task_id.clone());
        out.push(Pick { task_id: c.task_id.clone(), title: c.title.clone(), reason: if with_reason { reason } else { String::new() } });
    }
    out
}

/// `exclude`: tasks already on the page as acted-on items (kept by Regenerate).
/// `priorities_count`: the Top priorities box's configured count (1–3), so a
/// pick the box would hide is never written or marked used.
pub fn validate(raw: &Value, set: &CandidateSet, exclude: &HashSet<String>, priorities_count: usize) -> Composition {
    let mut used = exclude.clone();
    let help = set.labels.help_label.clone();
    let solo = set.labels.self_label.clone();
    let priorities = take(raw, "priorities", set, &mut used, priorities_cap(priorities_count), true, |_, _| true);
    let quick_help = take(raw, "quick_help", set, &mut used, MAX_PER_LIST, true, |c, reason| c.has_label(&help) || !reason.is_empty());
    let quick_self = take(raw, "quick_self", set, &mut used, MAX_PER_LIST, false, |c, _| c.has_label(&solo));
    let mut wins: Vec<String> = Vec::new();
    for (id, _) in entries(raw, "wins") {
        if wins.len() == MAX_PER_LIST { break; }
        if let Some(c) = set.completed_ref(id) {
            if !wins.contains(&c.task_id) { wins.push(c.task_id.clone()); }
        }
    }
    Composition {
        summary: one_line(raw.get("summary").and_then(Value::as_str).unwrap_or(""), SUMMARY_MAX_CHARS),
        priorities,
        quick_help,
        quick_self,
        wins,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::candidates::{Candidate, Completion, QuickLabels};
    use serde_json::json;

    fn c(alias: &str, id: &str, labels: &[&str]) -> Candidate {
        Candidate {
            alias: alias.into(), task_id: id.into(), title: format!("Title {id}"), project: None, priority: 1,
            status: "todo".into(), due_date: None, labels: labels.iter().map(|s| s.to_string()).collect(),
            label_ids: vec![], duration_minutes: None, created_at: "2026-09-01".into(),
        }
    }

    fn set() -> CandidateSet {
        CandidateSet {
            open: vec![c("t1", "a", &[]), c("t2", "b", &["needs-claude"]), c("t3", "c", &["quick"]), c("t4", "d", &[]), c("t5", "e", &[])],
            completed: vec![Completion { alias: "c1".into(), task_id: "w".into(), title: "Won".into(), priority: 3 }],
            labels: QuickLabels::default(),
        }
    }

    fn ids(p: &[Pick]) -> Vec<&str> { p.iter().map(|x| x.task_id.as_str()).collect() }

    #[test]
    fn unknown_ids_are_dropped() {
        let raw = json!({"summary": "", "priorities": [{"task_id": "t99", "reason": "x"}, {"task_id": "0c1d-made-up", "reason": "x"}, {"task_id": "t1", "reason": "Due today."}],
            "quick_help": [], "quick_self": [{"task_id": "t77"}], "wins": [{"task_id": "c9"}, {"task_id": "c1"}]});
        let out = validate(&raw, &set(), &HashSet::new(), 3);
        assert_eq!(ids(&out.priorities), ["a"]);
        assert_eq!(out.priorities[0].title, "Title a");
        assert_eq!(out.priorities[0].reason, "Due today.");
        assert!(out.quick_self.is_empty());
        assert_eq!(out.wins, ["w"]);
    }

    #[test]
    fn quick_self_needs_the_self_label() {
        let raw = json!({"summary": "", "priorities": [], "quick_help": [], "quick_self": [{"task_id": "t1"}, {"task_id": "t3"}], "wins": []});
        assert_eq!(ids(&validate(&raw, &set(), &HashSet::new(), 3).quick_self), ["c"]);
    }

    #[test]
    fn quick_help_needs_the_help_label_or_a_reason() {
        let raw = json!({"summary": "", "priorities": [], "quick_self": [], "wins": [],
            "quick_help": [{"task_id": "t2", "reason": ""}, {"task_id": "t4", "reason": "Claude can draft the outline."}, {"task_id": "t5", "reason": "   "}]});
        let out = validate(&raw, &set(), &HashSet::new(), 3);
        assert_eq!(ids(&out.quick_help), ["b", "d"]);
        assert_eq!(out.quick_help[1].reason, "Claude can draft the outline.");
    }

    #[test]
    fn lists_are_capped_deduped_and_disjoint() {
        let raw = json!({"summary": "", "quick_self": [], "wins": [],
            "priorities": [{"task_id": "t1", "reason": ""}, {"task_id": "t1", "reason": ""}, {"task_id": "t4", "reason": ""}, {"task_id": "t5", "reason": ""}, {"task_id": "t2", "reason": ""}],
            "quick_help": [{"task_id": "t1", "reason": "again"}, {"task_id": "t2", "reason": ""}]});
        let out = validate(&raw, &set(), &HashSet::new(), 3);
        assert_eq!(ids(&out.priorities), ["a", "d", "e"]);
        assert_eq!(ids(&out.quick_help), ["b"]);
    }

    #[test]
    fn excluded_tasks_are_never_returned() {
        let raw = json!({"summary": "", "priorities": [{"task_id": "t1", "reason": ""}, {"task_id": "t4", "reason": ""}], "quick_help": [], "quick_self": [], "wins": []});
        let exclude: HashSet<String> = ["a".to_string()].into();
        assert_eq!(ids(&validate(&raw, &set(), &exclude, 3).priorities), ["d"]);
    }

    #[test]
    fn summary_is_one_trimmed_capped_line() {
        let raw = json!({"summary": "  A calm day:\ttwo calls.\nSecond line  ", "priorities": [], "quick_help": [], "quick_self": [], "wins": []});
        assert_eq!(validate(&raw, &set(), &HashSet::new(), 3).summary, "A calm day: two calls.");
        let long = json!({"summary": "x".repeat(500), "priorities": [], "quick_help": [], "quick_self": [], "wins": []});
        assert_eq!(validate(&long, &set(), &HashSet::new(), 3).summary.chars().count(), SUMMARY_MAX_CHARS);
    }

    #[test]
    fn wrong_shapes_become_an_empty_composition() {
        let raw = json!({"summary": 5, "priorities": "nope", "quick_help": [1, 2], "quick_self": null});
        assert_eq!(validate(&raw, &set(), &HashSet::new(), 3), Composition::default());
        assert_eq!(validate(&json!("not an object"), &set(), &HashSet::new(), 3), Composition::default());
    }

    #[test]
    fn a_real_task_id_is_accepted_too() {
        let raw = json!({"summary": "", "priorities": [{"task_id": "d", "reason": "r"}], "quick_help": [], "quick_self": [], "wins": []});
        assert_eq!(ids(&validate(&raw, &set(), &HashSet::new(), 3).priorities), ["d"]);
    }

    #[test]
    fn a_priorities_count_of_one_keeps_one_and_frees_the_rest() {
        let raw = json!({"summary": "", "quick_self": [], "wins": [],
            "priorities": [{"task_id": "t1", "reason": ""}, {"task_id": "t4", "reason": ""}],
            "quick_help": [{"task_id": "t4", "reason": "Claude can draft it."}]});
        let out = validate(&raw, &set(), &HashSet::new(), 1);
        assert_eq!(ids(&out.priorities), ["a"]);
        assert_eq!(ids(&out.quick_help), ["d"], "t4 was never shown as a priority, so it is free for Quick wins");
        assert_eq!(priorities_cap(0), 1);
        assert_eq!(priorities_cap(9), 3);
    }
}
