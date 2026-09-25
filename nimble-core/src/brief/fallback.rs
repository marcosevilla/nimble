//! Rule-based composition for when the AI can't answer (no key, offline,
//! refusal, repeated failures): in progress first, then priority, then due
//! date, then age (addendum §5). Quick wins come from labels only. No reasons,
//! no summary — the header says "Sorted by priority. AI unavailable."

use std::cmp::Ordering;
use std::collections::HashSet;

use crate::brief::candidates::{Candidate, CandidateSet};
use crate::brief::validate::{priorities_cap, Composition, Pick, MAX_PER_LIST};

pub fn fallback_order(a: &Candidate, b: &Candidate) -> Ordering {
    let in_progress = |c: &Candidate| c.status == "in_progress";
    let due = |c: &Candidate| c.due_date.clone().unwrap_or_else(|| "9999-12-31".into());
    in_progress(b).cmp(&in_progress(a))
        .then(b.priority.cmp(&a.priority))
        .then(due(a).cmp(&due(b)))
        .then(a.created_at.cmp(&b.created_at))
        .then(a.task_id.cmp(&b.task_id))
}

fn pick(ranked: &[&Candidate], used: &mut HashSet<String>, cap: usize, keep: impl Fn(&Candidate) -> bool) -> Vec<Pick> {
    let mut out = Vec::new();
    for &c in ranked {
        if out.len() == cap { break; }
        if used.contains(&c.task_id) || !keep(c) { continue; }
        used.insert(c.task_id.clone());
        out.push(Pick { task_id: c.task_id.clone(), title: c.title.clone(), reason: String::new() });
    }
    out
}

/// `priorities_count`: the Top priorities box's configured count (1–3).
pub fn rank_fallback(set: &CandidateSet, exclude: &HashSet<String>, priorities_count: usize) -> Composition {
    let mut ranked: Vec<&Candidate> = set.open.iter().collect();
    ranked.sort_by(|a, b| fallback_order(a, b));
    let mut used = exclude.clone();
    let priorities = pick(&ranked, &mut used, priorities_cap(priorities_count), |_| true);
    let quick_help = pick(&ranked, &mut used, MAX_PER_LIST, |c| c.has_label(&set.labels.help_label));
    let quick_self = pick(&ranked, &mut used, MAX_PER_LIST, |c| c.has_label(&set.labels.self_label));
    Composition { summary: String::new(), priorities, quick_help, quick_self, wins: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::candidates::{Candidate, CandidateSet, QuickLabels};

    fn c(id: &str, status: &str, priority: i64, due: Option<&str>, created: &str, labels: &[&str]) -> Candidate {
        Candidate {
            alias: id.into(), task_id: id.into(), title: format!("Title {id}"), project: None, priority,
            status: status.into(), due_date: due.map(Into::into), labels: labels.iter().map(|s| s.to_string()).collect(),
            label_ids: vec![], duration_minutes: None, created_at: created.into(),
        }
    }

    fn set(open: Vec<Candidate>) -> CandidateSet {
        CandidateSet { open, completed: vec![], labels: QuickLabels::default() }
    }

    fn ids(p: &[Pick]) -> Vec<&str> { p.iter().map(|x| x.task_id.as_str()).collect() }

    #[test]
    fn in_progress_then_priority_then_due_then_age() {
        let out = rank_fallback(&set(vec![
            c("urgent", "todo", 4, None, "2026-09-01", &[]),
            c("doing-low", "in_progress", 1, None, "2026-09-10", &[]),
            c("high-due-late", "todo", 3, Some("2026-10-01"), "2026-09-01", &[]),
            c("high-due-soon", "todo", 3, Some("2026-09-26"), "2026-09-05", &[]),
            c("high-no-due-old", "todo", 3, None, "2025-01-01", &[]),
        ]), &HashSet::new(), 3);
        assert_eq!(ids(&out.priorities), ["doing-low", "urgent", "high-due-soon"]);
        assert!(out.priorities.iter().all(|p| p.reason.is_empty()));
        assert!(out.summary.is_empty() && out.wins.is_empty());
    }

    #[test]
    fn quick_wins_come_from_labels_only_and_lists_stay_disjoint() {
        let out = rank_fallback(&set(vec![
            c("p1", "todo", 4, None, "2026-09-01", &[]),
            c("p2", "todo", 4, None, "2026-09-02", &[]),
            c("p3", "todo", 4, None, "2026-09-03", &["quick"]),
            c("help", "todo", 1, None, "2026-09-04", &["needs-claude"]),
            c("errand", "todo", 1, None, "2026-09-05", &["quick"]),
            c("plain", "todo", 1, None, "2026-09-06", &[]),
        ]), &HashSet::new(), 3);
        assert_eq!(ids(&out.priorities), ["p1", "p2", "p3"]);
        assert_eq!(ids(&out.quick_help), ["help"]);
        assert_eq!(ids(&out.quick_self), ["errand"], "p3 is already a priority");
    }

    #[test]
    fn excluded_tasks_and_an_empty_set() {
        let exclude: HashSet<String> = ["a".to_string()].into();
        let out = rank_fallback(&set(vec![c("a", "in_progress", 4, None, "2026-09-01", &[]), c("b", "todo", 1, None, "2026-09-02", &[])]), &exclude, 3);
        assert_eq!(ids(&out.priorities), ["b"]);
        assert_eq!(rank_fallback(&set(vec![]), &HashSet::new(), 3), Composition::default());
    }

    #[test]
    fn a_priorities_count_of_one_leaves_the_rest_for_quick_wins() {
        let out = rank_fallback(&set(vec![
            c("p1", "todo", 4, None, "2026-09-01", &[]),
            c("p2", "todo", 4, None, "2026-09-02", &["quick"]),
        ]), &HashSet::new(), 1);
        assert_eq!(ids(&out.priorities), ["p1"]);
        assert_eq!(ids(&out.quick_self), ["p2"], "not hidden behind a priority the box doesn't show");
    }
}
