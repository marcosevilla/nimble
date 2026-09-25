//! Which open tasks the daily composition may see (base spec §4.6, addendum
//! §5). Bounded to 80 rows so a 1,000+ task list never reaches the prompt.
//! Read-only: selection never changes a task.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use crate::types::LocalTask;

pub const MAX_CANDIDATES: usize = 80;
pub const OLDEST_OPEN: usize = 20;
pub const MAX_COMPLETIONS: i64 = 30;
pub const DUE_WINDOW_DAYS: i64 = 7;
/// The labelled tier comes last and takes at most this many per configured
/// label, so a big `quick` backlog can never crowd out what's due.
pub const LABELLED_PER_LABEL: usize = 15;
pub const DEFAULT_HELP_LABEL: &str = "needs-claude";
pub const DEFAULT_SELF_LABEL: &str = "quick";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuickLabels {
    pub help_label: String,
    pub self_label: String,
}

impl Default for QuickLabels {
    fn default() -> Self {
        Self { help_label: DEFAULT_HELP_LABEL.into(), self_label: DEFAULT_SELF_LABEL.into() }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    /// Short id shown to the model: "t1"…"t80".
    pub alias: String,
    pub task_id: String,
    pub title: String,
    pub project: Option<String>,
    pub priority: i64,
    pub status: String,
    pub due_date: Option<String>,
    /// Label names (for the prompt and name matching).
    pub labels: Vec<String>,
    /// Label ids, so a configured label stored by id still matches.
    pub label_ids: Vec<String>,
    pub duration_minutes: Option<i64>,
    pub created_at: String,
}

impl Candidate {
    pub fn has_label(&self, wanted: &str) -> bool {
        let wanted = wanted.trim();
        !wanted.is_empty()
            && (self.labels.iter().any(|n| n.eq_ignore_ascii_case(wanted)) || self.label_ids.iter().any(|id| id == wanted))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Completion {
    /// "c1"…"c30".
    pub alias: String,
    pub task_id: String,
    pub title: String,
    pub priority: i64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CandidateSet {
    pub open: Vec<Candidate>,
    pub completed: Vec<Completion>,
    pub labels: QuickLabels,
}

impl CandidateSet {
    /// Resolves the short alias ("t3") or, defensively, the real task id.
    pub fn open_ref(&self, id: &str) -> Option<&Candidate> {
        let id = id.trim();
        self.open.iter().find(|c| c.alias == id || c.task_id == id)
    }
    pub fn completed_ref(&self, id: &str) -> Option<&Completion> {
        let id = id.trim();
        self.completed.iter().find(|c| c.alias == id || c.task_id == id)
    }
    pub fn alias_of(&self, task_id: &str) -> Option<&str> {
        self.open.iter().find(|c| c.task_id == task_id).map(|c| c.alias.as_str())
            .or_else(|| self.completed.iter().find(|c| c.task_id == task_id).map(|c| c.alias.as_str()))
    }
}

pub struct SelectInput<'a> {
    pub tasks: &'a [LocalTask],
    /// label id → name
    pub label_names: &'a HashMap<String, String>,
    /// project id → name
    pub project_names: &'a HashMap<String, String>,
    pub archived_projects: &'a HashSet<String>,
    /// Local "YYYY-MM-DD".
    pub today: &'a str,
    pub labels: &'a QuickLabels,
}

pub fn shift_date(date: &str, days: i64) -> String {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| (d + chrono::Duration::days(days)).format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| date.to_string())
}

fn urgency(a: &LocalTask, b: &LocalTask) -> Ordering {
    let due = |t: &LocalTask| t.due_date.clone().unwrap_or_else(|| "9999-12-31".into());
    due(a).cmp(&due(b))
        .then(b.priority.cmp(&a.priority))
        .then(a.created_at.cmp(&b.created_at))
        .then(a.id.cmp(&b.id))
}

/// Tiers, in order (base spec §4.6), each sorted by urgency: in progress →
/// due within 7 days or before today → priority ≥ 3 → the 20 oldest open
/// tasks → then tasks carrying the help or self label, at most
/// `LABELLED_PER_LABEL` per label. Capped at 80, top-level, open and in a
/// non-archived project only. `blocked` tasks are never candidates (they're
/// waiting on something else); `backlog` tasks only enter through the oldest
/// tier (parked on purpose, so never picked as due or important).
pub fn select_open(input: &SelectInput) -> Vec<Candidate> {
    let horizon = shift_date(input.today, DUE_WINDOW_DAYS);
    let names_of = |t: &LocalTask| -> Vec<String> {
        t.labels.iter().filter_map(|id| input.label_names.get(id).cloned()).collect()
    };
    let mut eligible: Vec<&LocalTask> = input
        .tasks
        .iter()
        .filter(|t| {
            t.parent_id.is_none()
                && !t.completed
                && t.status != "complete"
                && t.status != "blocked"
                && !input.archived_projects.contains(&t.project_id)
        })
        .collect();
    eligible.sort_by(|a, b| urgency(a, b));

    let active = |t: &LocalTask| t.status != "backlog";
    let in_progress = |t: &LocalTask| -> bool { t.status == "in_progress" };
    let due_soon = |t: &LocalTask| -> bool { active(t) && t.due_date.as_deref().is_some_and(|d| d <= horizon.as_str()) };
    let important = |t: &LocalTask| -> bool { active(t) && t.priority >= 3 };
    let tiers: [&dyn Fn(&LocalTask) -> bool; 3] = [&in_progress, &due_soon, &important];

    let mut picked: Vec<&LocalTask> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for tier in tiers {
        for &t in &eligible {
            if picked.len() == MAX_CANDIDATES { break; }
            if tier(t) && seen.insert(t.id.as_str()) { picked.push(t); }
        }
    }
    let mut oldest = eligible.clone();
    oldest.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    for t in oldest.into_iter().take(OLDEST_OPEN) {
        if picked.len() == MAX_CANDIDATES { break; }
        if seen.insert(t.id.as_str()) { picked.push(t); }
    }
    // Labelled last, each configured label with its own sub-cap.
    let mut wanted: Vec<&str> = [input.labels.help_label.as_str(), input.labels.self_label.as_str()]
        .into_iter()
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .collect();
    wanted.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    for label in wanted {
        let carries = |t: &LocalTask| -> bool {
            names_of(t).iter().any(|n| n.eq_ignore_ascii_case(label)) || t.labels.iter().any(|id| id == label)
        };
        let mut taken = 0;
        for &t in &eligible {
            if picked.len() == MAX_CANDIDATES || taken == LABELLED_PER_LABEL { break; }
            if active(t) && carries(t) && seen.insert(t.id.as_str()) {
                picked.push(t);
                taken += 1;
            }
        }
    }

    picked
        .into_iter()
        .enumerate()
        .map(|(i, t)| Candidate {
            alias: format!("t{}", i + 1),
            task_id: t.id.clone(),
            title: t.content.clone(),
            project: input.project_names.get(&t.project_id).cloned(),
            priority: t.priority,
            status: t.status.clone(),
            due_date: t.due_date.clone(),
            labels: names_of(t),
            label_ids: t.labels.clone(),
            duration_minutes: t.duration_minutes,
            created_at: t.created_at.clone(),
        })
        .collect()
}

/// Open candidates plus this week's completions (for `wins`, read by phase 4).
pub async fn load_candidates(pool: &SqlitePool, today: &str, labels: &QuickLabels) -> crate::Result<CandidateSet> {
    let tasks = crate::db::tasks::get_local_tasks(pool, None, None, false).await?;
    let label_names: HashMap<String, String> = crate::db::labels::list_labels(pool).await?
        .into_iter().map(|l| (l.id, l.name)).collect();
    let projects = crate::db::projects::get_projects(pool).await?;
    let project_names: HashMap<String, String> = projects.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
    let archived: HashSet<String> = projects.iter().filter(|p| p.archived_at.is_some()).map(|p| p.id.clone()).collect();
    let open = select_open(&SelectInput {
        tasks: &tasks,
        label_names: &label_names,
        project_names: &project_names,
        archived_projects: &archived,
        today,
        labels,
    });
    let since = shift_date(today, -6);
    let rows: Vec<(String, String, i64)> = sqlx::query_as(
        // Archived projects' completions are not wins. TODO(phase 4): a
        // recurring task's completion resets it to `todo` (no completed_at
        // row here); wins should also read `task_recurred` activity or the
        // karma ledger once it exists.
        "SELECT t.id, t.content, t.priority FROM local_tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.completed = 1 AND t.parent_id IS NULL AND t.completed_at >= ? AND p.archived_at IS NULL
         ORDER BY t.priority DESC, t.completed_at DESC LIMIT ?",
    )
    .bind(&since)
    .bind(MAX_COMPLETIONS)
    .fetch_all(pool)
    .await?;
    let completed = rows
        .into_iter()
        .enumerate()
        .map(|(i, (task_id, title, priority))| Completion { alias: format!("c{}", i + 1), task_id, title, priority })
        .collect();
    Ok(CandidateSet { open, completed, labels: labels.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, LocalTask};

    fn t(id: &str) -> LocalTask {
        LocalTask {
            id: id.into(),
            content: format!("Task {id}"),
            project_id: "inbox".into(),
            priority: 1,
            status: "todo".into(),
            created_at: "2026-09-01 10:00:00".into(),
            updated_at: "2026-09-01 10:00:00".into(),
            ..Default::default()
        }
    }

    fn select(tasks: &[LocalTask], labels: &[(&str, &str)], archived: &[&str]) -> Vec<Candidate> {
        let label_names: HashMap<String, String> = labels.iter().map(|(id, n)| (id.to_string(), n.to_string())).collect();
        let project_names: HashMap<String, String> = [("inbox".to_string(), "Inbox".to_string())].into();
        let archived: HashSet<String> = archived.iter().map(|s| s.to_string()).collect();
        select_open(&SelectInput {
            tasks,
            label_names: &label_names,
            project_names: &project_names,
            archived_projects: &archived,
            today: "2026-09-25",
            labels: &QuickLabels::default(),
        })
    }

    #[test]
    fn tiers_in_progress_then_due_then_priority_then_oldest_then_labelled() {
        let mut far = t("far"); far.due_date = Some("2026-12-01".into());
        let mut urgent = t("urgent"); urgent.priority = 4;
        let mut due = t("due"); due.due_date = Some("2026-09-30".into());
        let mut labelled = t("labelled"); labelled.labels = vec!["l-help".into()];
        let mut doing = t("doing"); doing.status = "in_progress".into();
        let mut ancient = t("ancient"); ancient.created_at = "2025-01-01 09:00:00".into();
        let out = select(&[far, urgent, due, labelled, doing, ancient], &[("l-help", "Needs-Claude")], &[]);
        let ids: Vec<&str> = out.iter().map(|c| c.task_id.as_str()).collect();
        assert_eq!(ids[..3], ["doing", "due", "urgent"]);
        assert!(ids.contains(&"ancient") && ids.contains(&"far"), "the 20 oldest open tasks are always candidates: {ids:?}");
        assert_eq!(out[0].alias, "t1");
        let l = out.iter().find(|c| c.task_id == "labelled").unwrap();
        assert_eq!(l.labels, ["Needs-Claude"]);
        assert!(l.has_label("needs-claude"), "label match ignores case");
        assert!(l.has_label("l-help"), "a configured label id matches too");
        assert_eq!(out[0].project.as_deref(), Some("Inbox"));
    }

    #[test]
    fn a_hundred_labelled_tasks_never_crowd_out_what_is_due() {
        // Newer than the 20 oldest, so only the labelled tier can add them.
        let mut tasks: Vec<LocalTask> = (0..100).map(|i| {
            let mut x = t(&format!("q{i:03}"));
            x.labels = vec![if i % 2 == 0 { "l-quick".into() } else { "l-help".into() }];
            x.created_at = format!("2026-09-{:02} 10:00:00", 2 + i % 20);
            x
        }).collect();
        let mut due = t("due-today");
        due.due_date = Some("2026-09-25".into());
        due.created_at = "2026-09-24 10:00:00".into();
        tasks.push(due);
        let out = select(&tasks, &[("l-help", "needs-claude"), ("l-quick", "quick")], &[]);
        assert_eq!(out[0].task_id, "due-today", "the due task is always first in line");
        let labelled = out.iter().filter(|c| c.task_id.starts_with('q')).count();
        assert_eq!(labelled, OLDEST_OPEN + 2 * LABELLED_PER_LABEL, "20 via the oldest tier, then ≤15 per label");
        assert_eq!(out.len(), 1 + OLDEST_OPEN + 2 * LABELLED_PER_LABEL);
    }

    #[test]
    fn blocked_is_never_a_candidate_and_backlog_only_through_the_oldest_tier() {
        let mut blocked = t("blocked"); blocked.status = "blocked".into(); blocked.priority = 4;
        let mut parked = t("parked"); parked.status = "backlog".into(); parked.priority = 4;
        parked.due_date = Some("2026-09-25".into()); parked.created_at = "2026-09-20 10:00:00".into();
        let mut newer: Vec<LocalTask> = (0..20).map(|i| { let mut x = t(&format!("n{i:02}")); x.created_at = "2026-09-01 09:00:00".into(); x }).collect();
        newer.push(blocked);
        newer.push(parked.clone());
        let ids: Vec<String> = select(&newer, &[], &[]).into_iter().map(|c| c.task_id).collect();
        assert!(!ids.contains(&"blocked".to_string()));
        assert!(!ids.contains(&"parked".to_string()), "a backlog task is neither due nor important, and 20 older tasks fill the oldest tier");
        let ids: Vec<String> = select(&[parked], &[], &[]).into_iter().map(|c| c.task_id).collect();
        assert_eq!(ids, ["parked"], "it still reaches the prompt as one of the oldest open tasks");
    }

    #[test]
    fn archived_subtasks_and_completed_are_never_candidates() {
        let mut archived = t("archived"); archived.project_id = "old".into(); archived.status = "in_progress".into();
        let mut sub = t("sub"); sub.parent_id = Some("parent".into()); sub.status = "in_progress".into();
        let mut done = t("done"); done.completed = true; done.status = "complete".into();
        let mut status_done = t("status-done"); status_done.status = "complete".into();
        let out = select(&[archived, sub, done, status_done, t("parent")], &[], &["old"]);
        assert_eq!(out.iter().map(|c| c.task_id.as_str()).collect::<Vec<_>>(), ["parent"]);
    }

    #[test]
    fn a_thousand_open_tasks_send_at_most_80_rows() {
        let tasks: Vec<LocalTask> = (0..1000).map(|i| {
            let mut x = t(&format!("x{i:04}"));
            x.due_date = Some("2026-09-25".into());
            x
        }).collect();
        let out = select(&tasks, &[], &[]);
        assert_eq!(out.len(), MAX_CANDIDATES);
        let aliases: HashSet<&str> = out.iter().map(|c| c.alias.as_str()).collect();
        assert_eq!(aliases.len(), 80);
        assert!(aliases.contains("t80") && !aliases.contains("t81"));
    }

    #[test]
    fn ids_resolve_by_alias_or_real_id() {
        let out = select(&[t("a"), t("b")], &[], &[]);
        let set = CandidateSet { open: out, completed: vec![Completion { alias: "c1".into(), task_id: "w".into(), title: "Won".into(), priority: 3 }], labels: QuickLabels::default() };
        assert_eq!(set.open_ref(" t2 ").unwrap().task_id, "b");
        assert_eq!(set.open_ref("a").unwrap().alias, "t1");
        assert!(set.open_ref("t9").is_none());
        assert_eq!(set.completed_ref("c1").unwrap().task_id, "w");
        assert_eq!(set.alias_of("w"), Some("c1"));
        assert_eq!(shift_date("2026-09-25", 7), "2026-10-02");
        assert_eq!(shift_date("2026-09-25", -6), "2026-09-19");
    }

    #[tokio::test]
    async fn loader_reads_open_tasks_and_this_weeks_completions() {
        let pool = test_pool().await;
        let open = crate::db::tasks::create_local_task(&pool, CreateTaskInput { content: "Open one".into(), due_date: Some("2026-09-25".into()), ..Default::default() }).await.unwrap().id;
        let recent = crate::db::tasks::create_local_task(&pool, CreateTaskInput { content: "Shipped".into(), priority: Some(3), ..Default::default() }).await.unwrap().id;
        let old = crate::db::tasks::create_local_task(&pool, CreateTaskInput { content: "Long ago".into(), ..Default::default() }).await.unwrap().id;
        for (id, at) in [(&recent, "2026-09-24 18:00:00"), (&old, "2026-09-01 09:00:00")] {
            sqlx::query("UPDATE local_tasks SET completed = 1, status = 'complete', completed_at = ? WHERE id = ?")
                .bind(at).bind(id).execute(&pool).await.unwrap();
        }
        // A completion in an archived project is not a win.
        sqlx::query("INSERT INTO projects (id, name, color, position, archived_at) VALUES ('old', 'Old', '#999', 9, '2026-09-20')")
            .execute(&pool).await.unwrap();
        let gone = crate::db::tasks::create_local_task(&pool, CreateTaskInput { content: "Archived win".into(), ..Default::default() }).await.unwrap().id;
        sqlx::query("UPDATE local_tasks SET project_id = 'old', completed = 1, status = 'complete', completed_at = '2026-09-24 19:00:00' WHERE id = ?")
            .bind(&gone).execute(&pool).await.unwrap();
        let set = load_candidates(&pool, "2026-09-25", &QuickLabels::default()).await.unwrap();
        assert_eq!(set.open.iter().map(|c| c.task_id.clone()).collect::<Vec<_>>(), [open]);
        assert_eq!(set.completed.len(), 1);
        assert_eq!(set.completed[0].task_id, recent);
        assert_eq!(set.completed[0].alias, "c1");
    }
}
