//! Daily composition (addendum §5): candidates → one structured LLM call →
//! validated picks → one transaction. Rule-based picks whenever the AI can't
//! answer. The brief suggests; nothing here completes, reschedules, deletes or
//! sends (tests/brief_guardrail.rs). Callers serialize runs (one job lock in
//! the desktop runner).

use std::collections::HashSet;

use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::api::llm::{self, LlmClient, LlmError};
use crate::brief::candidates::{self, QuickLabels};
use crate::brief::fallback;
use crate::brief::prompt::{self, DayContext, EventLine};
use crate::brief::validate::{self, Composition};
use crate::db::brief_items::NewBriefItem;
use crate::db::briefs::{self, CompositionRecord};
use crate::types::Brief;

pub const MAX_AUTO_ATTEMPTS: i64 = 3;

/// Device-local start time ("YYYY-MM-DD HH:MM:SS") of the last automatic
/// attempt, for retry spacing. Settings are never synced.
pub const KEY_LAST_ATTEMPT_AT: &str = "brief.last_attempt_at";

/// How long after attempt `n` (1-based) the next automatic attempt may start:
/// retry 2 waits 15 minutes, retry 3 waits 45, so a flaky morning doesn't
/// burn the day's three calls in ten minutes of 5-minute ticks.
pub fn retry_spacing(attempts_so_far: i64) -> chrono::Duration {
    match attempts_so_far {
        1 => chrono::Duration::minutes(15),
        2 => chrono::Duration::minutes(45),
        _ => chrono::Duration::zero(),
    }
}

/// Automatic composition only runs once Today's setup is done and a box
/// that shows its picks (Top priorities or Quick wins) is on. Regenerate is
/// the user's and skips this.
pub async fn automatic_compose_wanted(pool: &SqlitePool) -> crate::Result<bool> {
    if crate::db::settings::get_setting(pool, crate::brief::settings::KEY_SETUP_COMPLETED_AT).await?.is_none() {
        return Ok(false);
    }
    let layout = crate::brief::settings::load_layout(pool).await?;
    Ok(layout.iter().any(|e| e.enabled && (e.id == "priorities" || e.id == "quick_wins")))
}

/// Whether an automatic retry may start at `now`, measured from the last
/// attempt's start. A missing or unreadable stamp never blocks.
async fn retry_spaced_out(pool: &SqlitePool, brief: &Brief, now: chrono::NaiveDateTime) -> crate::Result<bool> {
    if brief.compose_attempts <= 0 {
        return Ok(true);
    }
    let last = crate::db::settings::get_setting(pool, KEY_LAST_ATTEMPT_AT).await?
        .and_then(|v| chrono::NaiveDateTime::parse_from_str(&v, "%Y-%m-%d %H:%M:%S").ok());
    Ok(match last {
        Some(last) if last.date() == now.date() => now >= last + retry_spacing(brief.compose_attempts),
        _ => true,
    })
}

/// Due until an AI composition landed (`composed_at` set and not the
/// rule-based `fallback`; an AI success on a `partial` snapshot keeps
/// `partial`) or today's attempts ran out. The phase-1 shell is written with
/// `status='ready'` but no `composed_at`, so it is still due.
pub fn compose_due(brief: &Brief) -> bool {
    !has_ai_picks(brief) && brief.compose_attempts < MAX_AUTO_ATTEMPTS
}

/// The day's rows came from the AI (not the rule-based fallback).
pub fn has_ai_picks(brief: &Brief) -> bool {
    brief.composed_at.is_some() && brief.status != "fallback"
}

pub fn parse_brief_time(value: Option<&str>) -> chrono::NaiveTime {
    value
        .and_then(|s| chrono::NaiveTime::parse_from_str(s.trim(), "%H:%M").ok())
        .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(6, 30, 0).expect("valid default brief time"))
}

/// `{help_label, self_label}` from the quick_wins module config; blanks keep the defaults.
pub fn quick_labels_from_config(config: &Value) -> QuickLabels {
    let mut labels = QuickLabels::default();
    let read = |key: &str| config.get(key).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(String::from);
    if let Some(v) = read("help_label") { labels.help_label = v; }
    if let Some(v) = read("self_label") { labels.self_label = v; }
    labels
}

/// Reads the quick_wins entry of the `brief.modules` setting.
pub fn quick_labels_from_modules(modules_json: Option<&str>) -> QuickLabels {
    modules_json
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|v| v.as_array().cloned())
        .and_then(|entries| entries.into_iter().find(|e| e.get("id").and_then(Value::as_str) == Some("quick_wins")))
        .and_then(|e| e.get("config").cloned())
        .map(|config| quick_labels_from_config(&config))
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq)]
pub struct ComposeSettings {
    pub model: String,
    pub effort: String,
    pub labels: QuickLabels,
    /// The Top priorities box's `count` (1–3) from the resolved layout.
    pub priorities_count: usize,
}

pub async fn load_settings(pool: &SqlitePool) -> crate::Result<ComposeSettings> {
    let model = crate::db::settings::get_setting(pool, "brief.model").await?;
    let effort = crate::db::settings::get_setting(pool, "brief.effort").await?;
    let modules = crate::db::settings::get_setting(pool, "brief.modules").await?;
    let layout = crate::brief::settings::load_layout(pool).await?;
    let priorities_count = layout
        .iter()
        .find(|e| e.id == "priorities")
        .map(|e| crate::brief::config_u64(&e.config, "count", validate::MAX_PER_LIST as u64) as usize)
        .unwrap_or(validate::MAX_PER_LIST);
    Ok(ComposeSettings {
        model: llm::normalize_model(model.as_deref()),
        effort: llm::normalize_effort(effort.as_deref()),
        labels: quick_labels_from_modules(modules.as_deref()),
        priorities_count: validate::priorities_cap(priorities_count),
    })
}

/// Today's and tomorrow's cached events and active habit names. Read errors
/// degrade to empty lists; the calendar cache is never refreshed from here.
pub async fn load_day_context(pool: &SqlitePool, date: &str, now: chrono::NaiveDateTime) -> DayContext {
    let lines = |events: Vec<crate::types::CalendarEventWithFeed>| -> Vec<EventLine> {
        events
            .into_iter()
            .map(|e| EventLine { start: e.event.start_time, end: e.event.end_time, all_day: e.event.all_day, summary: e.event.summary })
            .collect()
    };
    let today = crate::api::calendar::read_cached_events(pool, date).await.unwrap_or_default();
    let tomorrow = crate::api::calendar::read_cached_events(pool, &candidates::shift_date(date, 1)).await.unwrap_or_default();
    let habits = crate::db::habits::get_habits(pool).await.unwrap_or_default().into_iter().filter(|h| h.active).map(|h| h.name).collect();
    let weekday = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").map(|d| d.format("%A").to_string()).unwrap_or_default();
    DayContext {
        weekday,
        local_time: now.format("%H:%M").to_string(),
        events_today: lines(today),
        events_tomorrow: lines(tomorrow.into_iter().filter(|e| !e.event.all_day).take(3).collect()),
        habits,
    }
}

pub fn items_from(comp: &Composition, origin: &str) -> Vec<NewBriefItem> {
    let rows = |kind: &str, module_id: &str, picks: &[validate::Pick]| -> Vec<NewBriefItem> {
        picks
            .iter()
            .enumerate()
            .map(|(i, p)| NewBriefItem {
                kind: kind.into(),
                module_id: module_id.into(),
                title: p.title.clone(),
                body: (!p.reason.is_empty()).then(|| p.reason.clone()),
                task_id: p.task_id.clone(),
                origin: origin.into(),
                position: i as i64,
            })
            .collect()
    };
    let mut out = rows("priority", "priorities", &comp.priorities);
    out.extend(rows("quick_help", "quick_wins", &comp.quick_help));
    out.extend(rows("quick_self", "quick_wins", &comp.quick_self));
    out
}

pub fn compose_json(comp: &Composition, origin: &str) -> Value {
    json!({ "summary": comp.summary, "origin": origin, "wins": comp.wins })
}

pub struct ComposeRun<'a> {
    pub date: &'a str,
    /// Local wall-clock time of this run.
    pub now: chrono::NaiveDateTime,
    /// Regenerate: run even when not due, and bump `version`.
    pub force: bool,
    /// Regenerate: freshly gathered `(layout_json, snapshot_json, partial)`.
    pub regathered: Option<(Value, Value, bool)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ComposeOutcome {
    NotDue,
    Composed { status: String, error_code: Option<String> },
    /// Regenerate failed while AI picks were on screen: nothing was written
    /// (no fallback replacement, no version bump).
    Kept { error_code: String },
}

pub async fn compose<L: LlmClient>(pool: &SqlitePool, llm: Option<&L>, run: ComposeRun<'_>) -> crate::Result<ComposeOutcome> {
    let brief = briefs::get_brief(pool, run.date).await?.ok_or_else(|| crate::Error::Other("brief_missing".into()))?;
    if !run.force && (!compose_due(&brief) || !automatic_compose_wanted(pool).await?) {
        return Ok(ComposeOutcome::NotDue);
    }
    // No client (no key, or a process that doesn't own the profile): the
    // rule-based brief is written once and the day's AI attempts stay
    // untouched, so the owner's tick — or a key added later — still upgrades
    // it. Once a composition exists, a clientless run has nothing better to
    // write and never re-sorts rows under the user.
    if !run.force && llm.is_none() && brief.composed_at.is_some() {
        return Ok(ComposeOutcome::NotDue);
    }
    if !run.force && llm.is_some() && !retry_spaced_out(pool, &brief, run.now).await? {
        return Ok(ComposeOutcome::NotDue);
    }
    let settings = load_settings(pool).await?;
    let kept: HashSet<String> = crate::db::brief_items::acted_task_ids(pool, run.date).await?;
    let set = candidates::load_candidates(pool, run.date, &settings.labels).await?;
    let day = load_day_context(pool, run.date, run.now).await;
    // An automatic attempt is counted before the call, so a crash or a failed
    // write can't retry forever. Regenerate is the user's and never counts;
    // neither does a run with no client (no call is made).
    let attempts = if run.force || llm.is_none() {
        brief.compose_attempts
    } else {
        let n = briefs::begin_attempt(pool, run.date).await?;
        crate::db::settings::set_setting(pool, KEY_LAST_ATTEMPT_AT, &run.now.format("%Y-%m-%d %H:%M:%S").to_string()).await?;
        n
    };
    let partial = match &run.regathered {
        Some((_, _, partial)) => *partial,
        None => brief.status == "partial",
    };
    let regathered = run.regathered.map(|(layout, snapshot, _)| (layout, snapshot));
    let now = run.now.format("%Y-%m-%d %H:%M:%S").to_string();

    let result = match llm {
        Some(client) => client.structured(&prompt::build_request(&set, run.date, &day, &settings.model, &settings.effort, settings.priorities_count)).await,
        None => Err(LlmError::NoKey),
    };

    match result {
        Ok(response) => {
            let comp = validate::validate(&response.json, &set, &kept, settings.priorities_count);
            let model = if response.model.is_empty() { settings.model.clone() } else { response.model.clone() };
            briefs::record_composition(pool, &CompositionRecord {
                date: run.date.into(),
                status: "ready".into(),
                model: Some(model),
                input_tokens: Some(response.usage.input_tokens),
                output_tokens: Some(response.usage.output_tokens),
                error_code: None,
                compose: compose_json(&comp, "ai"),
                items: items_from(&comp, "ai"),
                attempts,
                bump_version: run.force,
                regathered,
                partial,
                now,
            })
            .await?;
            Ok(ComposeOutcome::Composed { status: "ready".into(), error_code: None })
        }
        Err(error) => {
            // A terminal answer (auth, bad request, refusal) ends today's
            // retries; a missing client never does.
            let attempts = if llm.is_none() || error.retryable() { attempts } else { attempts.max(MAX_AUTO_ATTEMPTS) };
            let code = error.code().to_string();
            if run.force && has_ai_picks(&brief) {
                // Regenerate failed: the AI picks on screen stay as they are.
                return Ok(ComposeOutcome::Kept { error_code: code });
            }
            if !run.force && brief.composed_at.is_some() && brief.status == "fallback" {
                briefs::record_failed_retry(pool, run.date, attempts, &code, &now).await?;
            } else {
                let comp = fallback::rank_fallback(&set, &kept, settings.priorities_count);
                let usage = error.usage();
                briefs::record_composition(pool, &CompositionRecord {
                    date: run.date.into(),
                    status: "fallback".into(),
                    model: llm.map(|_| settings.model.clone()),
                    input_tokens: usage.map(|u| u.input_tokens),
                    output_tokens: usage.map(|u| u.output_tokens),
                    error_code: Some(code.clone()),
                    compose: compose_json(&comp, "rule"),
                    items: items_from(&comp, "rule"),
                    attempts,
                    bump_version: run.force,
                    regathered,
                    partial,
                    now,
                })
                .await?;
            }
            Ok(ComposeOutcome::Composed { status: "fallback".into(), error_code: Some(code) })
        }
    }
}

/// The same gather `db::briefs::ensure_snapshot` runs for a new day:
/// `(layout_json = enabled entries, snapshot_json = payloads by module id)`.
pub async fn regather(pool: &SqlitePool, date: &str) -> crate::Result<(Value, Value, bool)> {
    let layout = crate::brief::settings::load_layout(pool).await?;
    let (snapshot, partial) = crate::brief::gather_snapshot(&crate::brief::BriefCtx { pool, date }, &layout).await;
    let used: Vec<crate::brief::LayoutEntry> = layout.into_iter().filter(|e| e.enabled).collect();
    Ok((json!(used), snapshot, partial))
}

/// ⋯ → Regenerate: gather the modules again, recompose, `version + 1`, keep
/// acted-on items (base spec §4.5).
pub async fn regenerate<L: LlmClient>(pool: &SqlitePool, llm: Option<&L>, date: &str, now: chrono::NaiveDateTime) -> crate::Result<ComposeOutcome> {
    let regathered = regather(pool, date).await?;
    compose(pool, llm, ComposeRun { date, now, force: true, regathered: Some(regathered) }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::llm::{FakeLlm, LlmError, Usage};
    use crate::brief::candidates::load_candidates;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;
    use serde_json::json;

    const D: &str = "2026-09-25";

    fn at(h: u32, m: u32) -> chrono::NaiveDateTime {
        chrono::NaiveDate::from_ymd_opt(2026, 9, 25).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    fn run(force: bool) -> ComposeRun<'static> {
        ComposeRun { date: D, now: at(6, 30), force, regathered: None }
    }

    struct Day { pool: SqlitePool, due: String, help: String, errand: String }

    async fn day() -> Day {
        let pool = test_pool().await;
        let mk = |content: &'static str, due: Option<&'static str>, priority: i64| CreateTaskInput {
            content: content.into(), due_date: due.map(Into::into), priority: Some(priority), ..Default::default()
        };
        let due = crate::db::tasks::create_local_task(&pool, mk("Send Dana the draft", Some(D), 4)).await.unwrap().id;
        let help = crate::db::tasks::create_local_task(&pool, mk("Outline the job-post reply", None, 1)).await.unwrap().id;
        let errand = crate::db::tasks::create_local_task(&pool, mk("Call the pharmacy", None, 1)).await.unwrap().id;
        let claude = crate::db::labels::create_label(&pool, "needs-claude", "blue").await.unwrap();
        let quick = crate::db::labels::create_label(&pool, "quick", "green").await.unwrap();
        crate::db::labels::set_task_labels(&pool, &help, &[claude.id]).await.unwrap();
        crate::db::labels::set_task_labels(&pool, &errand, &[quick.id]).await.unwrap();
        crate::db::settings::set_setting(&pool, crate::brief::settings::KEY_SETUP_COMPLETED_AT, "2026-09-01 07:00:00").await.unwrap();
        crate::db::briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        Day { pool, due, help, errand }
    }

    async fn alias(pool: &SqlitePool, task_id: &str) -> String {
        load_candidates(pool, D, &QuickLabels::default()).await.unwrap().alias_of(task_id).unwrap().to_string()
    }

    async fn brief(pool: &SqlitePool) -> Brief {
        crate::db::briefs::get_brief(pool, D).await.unwrap().unwrap()
    }

    async fn kinds(pool: &SqlitePool) -> Vec<(String, String, String)> {
        crate::db::brief_items::list_items(pool, D).await.unwrap().into_iter()
            .map(|i| (i.kind, i.task_id.unwrap(), i.origin)).collect()
    }

    #[tokio::test]
    async fn first_compose_patches_the_shell_and_keeps_version() {
        let d = day().await;
        let (a, h, e) = (alias(&d.pool, &d.due).await, alias(&d.pool, &d.help).await, alias(&d.pool, &d.errand).await);
        let fake = FakeLlm::json(json!({"summary": "A lighter day: one call, then open time.",
            "priorities": [{"task_id": a, "reason": "Review is at 11:30."}],
            "quick_help": [{"task_id": h, "reason": ""}], "quick_self": [{"task_id": e}], "wins": []}));
        let out = compose(&d.pool, Some(&fake), run(false)).await.unwrap();
        assert_eq!(out, ComposeOutcome::Composed { status: "ready".into(), error_code: None });
        let b = brief(&d.pool).await;
        assert_eq!((b.version, b.status.as_str(), b.compose_attempts), (1, "ready", 1));
        assert_eq!(b.composed_at.as_deref(), Some("2026-09-25 06:30:00"));
        assert_eq!((b.input_tokens, b.output_tokens), (Some(9000), Some(600)));
        assert_eq!(b.snapshot["compose"], json!({"summary": "A lighter day: one call, then open time.", "origin": "ai", "wins": []}));
        assert_eq!(kinds(&d.pool).await, [
            ("priority".to_string(), d.due.clone(), "ai".to_string()),
            ("quick_help".to_string(), d.help.clone(), "ai".to_string()),
            ("quick_self".to_string(), d.errand.clone(), "ai".to_string()),
        ]);
        assert!(!compose_due(&b));
        assert_eq!(compose(&d.pool, Some(&FakeLlm::json(json!({}))), run(false)).await.unwrap(), ComposeOutcome::NotDue);
    }

    #[tokio::test]
    async fn unknown_ids_from_the_model_are_dropped() {
        let d = day().await;
        let a = alias(&d.pool, &d.due).await;
        let fake = FakeLlm::json(json!({"summary": "", "priorities": [{"task_id": "t99", "reason": "x"},
            {"task_id": "3f1c0000-made-up", "reason": "x"}, {"task_id": a, "reason": "Due today."}],
            "quick_help": [], "quick_self": [], "wins": [{"task_id": "c7"}]}));
        compose(&d.pool, Some(&fake), run(false)).await.unwrap();
        assert_eq!(kinds(&d.pool).await, [("priority".to_string(), d.due.clone(), "ai".to_string())]);
        assert_eq!(brief(&d.pool).await.snapshot["compose"]["wins"], json!([]));
    }

    #[tokio::test]
    async fn no_client_writes_the_rule_based_brief_without_using_attempts() {
        let d = day().await;
        // Two more urgent tasks, so the three priority slots don't swallow the labelled ones.
        for content in ["Renew passport", "Pay estimated taxes"] {
            crate::db::tasks::create_local_task(&d.pool, CreateTaskInput { content: content.into(), priority: Some(4), ..Default::default() }).await.unwrap();
        }
        let out = compose::<FakeLlm>(&d.pool, None, run(false)).await.unwrap();
        assert_eq!(out, ComposeOutcome::Composed { status: "fallback".into(), error_code: Some("no_key".into()) });
        let b = brief(&d.pool).await;
        assert_eq!((b.status.as_str(), b.error_code.as_deref(), b.compose_attempts), ("fallback", Some("no_key"), 0));
        assert_eq!(b.model, None);
        assert_eq!(b.snapshot["compose"]["origin"], "rule");
        assert!(compose_due(&b), "no client: the day's AI attempts are untouched");
        let rows = kinds(&d.pool).await;
        assert_eq!(rows[0], ("priority".to_string(), d.due.clone(), "rule".to_string()));
        assert!(rows.contains(&("quick_help".to_string(), d.help.clone(), "rule".to_string())));
        assert!(rows.contains(&("quick_self".to_string(), d.errand.clone(), "rule".to_string())));
    }

    #[tokio::test]
    async fn a_missing_client_never_rewrites_and_a_key_added_later_upgrades() {
        let d = day().await;
        // A second process (or a profile with no key) opens Today first.
        compose::<FakeLlm>(&d.pool, None, run(false)).await.unwrap();
        let first = (brief(&d.pool).await, crate::db::brief_items::list_items(&d.pool, D).await.unwrap());
        let logged: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log").fetch_one(&d.pool).await.unwrap();
        // The owner's tick with no client: nothing written, nothing counted.
        let again = compose::<FakeLlm>(&d.pool, None, ComposeRun { date: D, now: at(9, 0), force: false, regathered: None }).await.unwrap();
        assert_eq!(again, ComposeOutcome::NotDue);
        assert_eq!(serde_json::to_value(brief(&d.pool).await).unwrap(), serde_json::to_value(&first.0).unwrap());
        assert_eq!(crate::db::brief_items::list_items(&d.pool, D).await.unwrap(), first.1);
        let after: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log").fetch_one(&d.pool).await.unwrap();
        assert_eq!(after, logged);
        // A Regenerate without a client doesn't cap the day either.
        regenerate::<FakeLlm>(&d.pool, None, D, at(9, 30)).await.unwrap();
        assert_eq!(brief(&d.pool).await.compose_attempts, 0);
        // A key added mid-day: the next due run upgrades to AI picks.
        let a = alias(&d.pool, &d.due).await;
        let ok = FakeLlm::json(json!({"summary": "Calm.", "priorities": [{"task_id": a, "reason": "r"}], "quick_help": [], "quick_self": [], "wins": []}));
        compose(&d.pool, Some(&ok), ComposeRun { date: D, now: at(10, 0), force: false, regathered: None }).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!((b.status.as_str(), b.compose_attempts, ok.calls()), ("ready", 1, 1));
    }

    #[tokio::test]
    async fn offline_falls_back_then_a_retry_upgrades_to_ai() {
        let d = day().await;
        compose(&d.pool, Some(&FakeLlm::failing(LlmError::Offline("dns".into()))), run(false)).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!((b.status.as_str(), b.error_code.as_deref(), b.compose_attempts), ("fallback", Some("offline"), 1));
        assert_eq!(b.model.as_deref(), Some("claude-opus-5-5"), "the model we tried is recorded");
        assert!(compose_due(&b));
        let a = alias(&d.pool, &d.due).await;
        let ok = FakeLlm::json(json!({"summary": "Calm.", "priorities": [{"task_id": a, "reason": "r"}], "quick_help": [], "quick_self": [], "wins": []}));
        compose(&d.pool, Some(&ok), ComposeRun { date: D, now: at(6, 45), force: false, regathered: None }).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!((b.status.as_str(), b.error_code, b.compose_attempts, b.version), ("ready", None, 2, 1));
        assert_eq!(kinds(&d.pool).await, [("priority".to_string(), d.due.clone(), "ai".to_string())]);
    }

    #[tokio::test]
    async fn a_failed_retry_keeps_the_rows_and_the_third_attempt_is_the_last() {
        let d = day().await;
        compose(&d.pool, Some(&FakeLlm::failing(LlmError::Server(503))), run(false)).await.unwrap();
        let rows = crate::db::brief_items::list_items(&d.pool, D).await.unwrap();
        let logged: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log WHERE table_name='brief_items'").fetch_one(&d.pool).await.unwrap();
        compose(&d.pool, Some(&FakeLlm::failing(LlmError::RateLimited)), ComposeRun { date: D, now: at(6, 45), force: false, regathered: None }).await.unwrap();
        assert_eq!(crate::db::brief_items::list_items(&d.pool, D).await.unwrap(), rows);
        let after: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log WHERE table_name='brief_items'").fetch_one(&d.pool).await.unwrap();
        assert_eq!(after, logged, "a failed retry writes no item rows");
        assert_eq!(brief(&d.pool).await.error_code.as_deref(), Some("rate_limited"));
        compose(&d.pool, Some(&FakeLlm::failing(LlmError::Server(500))), ComposeRun { date: D, now: at(7, 30), force: false, regathered: None }).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!(b.compose_attempts, 3);
        assert!(!compose_due(&b));
        let untouched = FakeLlm::json(json!({}));
        assert_eq!(compose(&d.pool, Some(&untouched), run(false)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!(untouched.calls(), 0);
    }

    #[tokio::test]
    async fn a_refusal_is_terminal_and_logs_its_tokens() {
        let d = day().await;
        let refusal = LlmError::Refusal { category: Some("cyber".into()), usage: Usage { input_tokens: 8000, output_tokens: 0 } };
        compose(&d.pool, Some(&FakeLlm::failing(refusal)), run(false)).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!((b.status.as_str(), b.error_code.as_deref(), b.compose_attempts), ("fallback", Some("refusal"), 3));
        assert_eq!((b.input_tokens, b.output_tokens), (Some(8000), Some(0)));
    }

    #[tokio::test]
    async fn forced_recompose_keeps_acted_items_and_bumps_version() {
        let d = day().await;
        let h = alias(&d.pool, &d.help).await;
        compose(&d.pool, Some(&FakeLlm::json(json!({"summary": "", "priorities": [], "quick_help": [{"task_id": h, "reason": ""}], "quick_self": [], "wins": []}))), run(false)).await.unwrap();
        let id = crate::db::brief_items::item_id(D, "quick_help", &d.help);
        crate::db::brief_items::set_item_state(&d.pool, &id, "produced", Some("break_down"), Some("[\"s1\"]")).await.unwrap();
        let (a, h) = (alias(&d.pool, &d.due).await, alias(&d.pool, &d.help).await);
        let again = FakeLlm::json(json!({"summary": "Fresh.", "priorities": [{"task_id": h, "reason": "now a priority"}, {"task_id": a, "reason": "r"}],
            "quick_help": [], "quick_self": [], "wins": []}));
        compose(&d.pool, Some(&again), ComposeRun { date: D, now: at(12, 0), force: true, regathered: None }).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!((b.version, b.status.as_str()), (2, "ready"));
        let rows = crate::db::brief_items::list_items(&d.pool, D).await.unwrap();
        assert_eq!(rows.iter().filter(|i| i.task_id.as_deref() == Some(d.help.as_str())).count(), 1, "the acted-on task is not added again");
        let kept = rows.iter().find(|i| i.id == id).unwrap();
        assert_eq!((kept.action_state.as_str(), kept.produced_ref.as_deref()), ("produced", Some("[\"s1\"]")));
        assert!(rows.iter().any(|i| i.kind == "priority" && i.task_id.as_deref() == Some(d.due.as_str())));
    }

    #[tokio::test]
    async fn regenerate_regathers_the_snapshot() {
        let d = day().await;
        compose::<FakeLlm>(&d.pool, None, run(false)).await.unwrap();
        crate::db::tasks::create_local_task(&d.pool, CreateTaskInput { content: "Added at noon".into(), due_date: Some(D.into()), ..Default::default() }).await.unwrap();
        let before = brief(&d.pool).await;
        regenerate::<FakeLlm>(&d.pool, None, D, at(12, 0)).await.unwrap();
        let after = brief(&d.pool).await;
        assert_eq!(after.version, before.version + 1);
        assert_ne!(after.snapshot, before.snapshot, "module payloads were gathered again");
        assert!(after.snapshot.get("compose").is_some());
    }

    #[tokio::test]
    async fn settings_drive_the_request() {
        let d = day().await;
        crate::db::settings::set_setting(&d.pool, "brief.model", "claude-sonnet-5").await.unwrap();
        crate::db::settings::set_setting(&d.pool, "brief.effort", "turbo").await.unwrap();
        crate::db::settings::set_setting(&d.pool, "brief.modules",
            r#"[{"id":"quick_wins","enabled":true,"config":{"help_label":"claude","self_label":"errand"}}]"#).await.unwrap();
        let fake = FakeLlm::json(json!({"summary": "", "priorities": [], "quick_help": [], "quick_self": [], "wins": []}));
        compose(&d.pool, Some(&fake), run(false)).await.unwrap();
        let req = fake.last_request().unwrap();
        assert_eq!((req.model.as_str(), req.effort.as_str()), ("claude-sonnet-5", "low"));
        assert!(req.system.contains("\"claude\"") && req.system.contains("\"errand\""));
        assert!(req.user.contains("Send Dana the draft"));
    }

    #[test]
    fn due_rule_time_and_labels() {
        let mut b = Brief {
            date: D.into(), version: 1, status: "ready".into(), source: "nimble".into(), layout: json!([]),
            snapshot: json!({}), snapshot_schema: 1, model: None, input_tokens: None, output_tokens: None,
            error_code: None, composed_at: None, compose_attempts: 0, notes: None, generated_at: "g".into(), updated_at: "u".into(),
        };
        assert!(compose_due(&b), "a shell written with status 'ready' is not composed yet");
        b.composed_at = Some("x".into());
        assert!(!compose_due(&b));
        b.status = "fallback".into();
        b.compose_attempts = 2;
        assert!(compose_due(&b));
        b.compose_attempts = 3;
        assert!(!compose_due(&b));
        assert_eq!(parse_brief_time(None), chrono::NaiveTime::from_hms_opt(6, 30, 0).unwrap());
        assert_eq!(parse_brief_time(Some("07:05")), chrono::NaiveTime::from_hms_opt(7, 5, 0).unwrap());
        assert_eq!(parse_brief_time(Some("late")), chrono::NaiveTime::from_hms_opt(6, 30, 0).unwrap());
        assert_eq!(quick_labels_from_modules(None), QuickLabels::default());
        assert_eq!(quick_labels_from_modules(Some("not json")), QuickLabels::default());
        assert_eq!(quick_labels_from_config(&json!({"help_label": "  ", "self_label": "errand"})),
            QuickLabels { help_label: "needs-claude".into(), self_label: "errand".into() });
    }

    #[tokio::test]
    async fn the_priorities_box_count_caps_what_is_composed() {
        let d = day().await;
        crate::db::settings::set_setting(&d.pool, "brief.modules", r#"[{"id":"priorities","enabled":true,"config":{"count":1}}]"#).await.unwrap();
        let (a, h) = (alias(&d.pool, &d.due).await, alias(&d.pool, &d.help).await);
        let fake = FakeLlm::json(json!({"summary": "", "priorities": [{"task_id": a, "reason": "r"}, {"task_id": h, "reason": "r"}],
            "quick_help": [{"task_id": h, "reason": ""}], "quick_self": [], "wins": []}));
        compose(&d.pool, Some(&fake), run(false)).await.unwrap();
        assert!(fake.last_request().unwrap().system.contains("priorities: up to 1 open tasks"));
        assert_eq!(kinds(&d.pool).await, [
            ("priority".to_string(), d.due.clone(), "ai".to_string()),
            ("quick_help".to_string(), d.help.clone(), "ai".to_string()),
        ], "the hidden second priority is neither written nor used up");
    }

    #[tokio::test]
    async fn retries_are_spaced_from_the_last_attempt() {
        let d = day().await;
        let offline = || FakeLlm::failing(LlmError::Offline("dns".into()));
        let at_run = |h, m| ComposeRun { date: D, now: at(h, m), force: false, regathered: None };
        compose(&d.pool, Some(&offline()), at_run(6, 30)).await.unwrap();
        // Retry 2 waits 15 minutes after attempt 1.
        let early = offline();
        assert_eq!(compose(&d.pool, Some(&early), at_run(6, 40)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!((early.calls(), brief(&d.pool).await.compose_attempts), (0, 1));
        compose(&d.pool, Some(&offline()), at_run(6, 45)).await.unwrap();
        assert_eq!(brief(&d.pool).await.compose_attempts, 2);
        // Retry 3 waits 45 minutes after attempt 2.
        let early = offline();
        assert_eq!(compose(&d.pool, Some(&early), at_run(7, 25)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!(early.calls(), 0);
        // Regenerate is the user's: never spaced, never counted.
        let manual = offline();
        regenerate(&d.pool, Some(&manual), D, at(7, 26)).await.unwrap();
        assert_eq!((manual.calls(), brief(&d.pool).await.compose_attempts), (1, 2));
        let third = offline();
        compose(&d.pool, Some(&third), at_run(7, 30)).await.unwrap();
        assert_eq!((third.calls(), brief(&d.pool).await.compose_attempts), (1, 3));
    }

    #[tokio::test]
    async fn no_automatic_call_before_setup_or_with_both_ai_boxes_hidden() {
        let d = day().await;
        let untouched = || FakeLlm::json(json!({"summary": "", "priorities": [], "quick_help": [], "quick_self": [], "wins": []}));
        sqlx::query("DELETE FROM settings WHERE key = ?").bind(crate::brief::settings::KEY_SETUP_COMPLETED_AT).execute(&d.pool).await.unwrap();
        let fake = untouched();
        assert_eq!(compose(&d.pool, Some(&fake), run(false)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!(compose::<FakeLlm>(&d.pool, None, run(false)).await.unwrap(), ComposeOutcome::NotDue);
        let b = brief(&d.pool).await;
        assert_eq!((fake.calls(), b.compose_attempts, b.composed_at.is_none()), (0, 0, true), "setup not done: nothing called or written");

        crate::db::settings::set_setting(&d.pool, crate::brief::settings::KEY_SETUP_COMPLETED_AT, "2026-09-25 06:00:00").await.unwrap();
        crate::db::settings::set_setting(&d.pool, "brief.modules",
            r#"[{"id":"priorities","enabled":false,"config":{}},{"id":"quick_wins","enabled":false,"config":{}}]"#).await.unwrap();
        let fake = untouched();
        assert_eq!(compose(&d.pool, Some(&fake), run(false)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!((fake.calls(), brief(&d.pool).await.compose_attempts), (0, 0), "no box shows the picks");
        // Regenerate is the user's choice and still runs.
        let manual = untouched();
        regenerate(&d.pool, Some(&manual), D, at(9, 0)).await.unwrap();
        assert_eq!(manual.calls(), 1);

        // One AI box back on: the next automatic run composes.
        crate::db::settings::set_setting(&d.pool, "brief.modules",
            r#"[{"id":"priorities","enabled":false,"config":{}},{"id":"quick_wins","enabled":true,"config":{}}]"#).await.unwrap();
        sqlx::query("UPDATE briefs SET composed_at = NULL, status = 'ready' WHERE date = ?").bind(D).execute(&d.pool).await.unwrap();
        let fake = untouched();
        compose(&d.pool, Some(&fake), run(false)).await.unwrap();
        assert_eq!(fake.calls(), 1);
    }

    /// A call that never answers: the run is abandoned mid-flight (app quit,
    /// crash, a write that never happens).
    struct Hanging;
    impl LlmClient for Hanging {
        async fn structured(&self, _req: &crate::api::llm::LlmRequest) -> Result<crate::api::llm::LlmResponse, LlmError> {
            std::future::pending().await
        }
    }

    #[tokio::test]
    async fn an_abandoned_call_still_uses_an_attempt_and_three_is_the_cap() {
        let d = day().await;
        for (n, now) in [(1, at(6, 30)), (2, at(6, 45)), (3, at(7, 30))] {
            let run = ComposeRun { date: D, now, force: false, regathered: None };
            let abandoned = tokio::time::timeout(std::time::Duration::from_millis(50), compose(&d.pool, Some(&Hanging), run)).await;
            assert!(abandoned.is_err(), "the call was still in flight");
            assert_eq!(brief(&d.pool).await.compose_attempts, n, "counted before the call");
        }
        assert!(!compose_due(&brief(&d.pool).await));
        let untouched = FakeLlm::json(json!({}));
        assert_eq!(compose(&d.pool, Some(&untouched), run(false)).await.unwrap(), ComposeOutcome::NotDue);
        assert_eq!(untouched.calls(), 0, "no fourth call today");
    }

    #[tokio::test]
    async fn a_failed_regenerate_keeps_the_ai_picks_as_they_are() {
        let d = day().await;
        let a = alias(&d.pool, &d.due).await;
        compose(&d.pool, Some(&FakeLlm::json(json!({"summary": "Calm.", "priorities": [{"task_id": a, "reason": "r"}], "quick_help": [], "quick_self": [], "wins": []}))), run(false)).await.unwrap();
        let before = (brief(&d.pool).await, crate::db::brief_items::list_items(&d.pool, D).await.unwrap());
        let out = regenerate(&d.pool, Some(&FakeLlm::failing(LlmError::Server(503))), D, at(12, 0)).await.unwrap();
        assert_eq!(out, ComposeOutcome::Kept { error_code: "server_error".into() });
        let after = brief(&d.pool).await;
        assert_eq!((after.version, after.status.as_str(), after.snapshot.clone()), (before.0.version, "ready", before.0.snapshot.clone()));
        assert_eq!(crate::db::brief_items::list_items(&d.pool, D).await.unwrap(), before.1, "no fallback replacement");
    }

    #[tokio::test]
    async fn an_ai_success_on_a_partial_snapshot_keeps_partial_and_is_done() {
        let d = day().await;
        sqlx::query("UPDATE briefs SET status = 'partial' WHERE date = ?").bind(D).execute(&d.pool).await.unwrap();
        let a = alias(&d.pool, &d.due).await;
        compose(&d.pool, Some(&FakeLlm::json(json!({"summary": "", "priorities": [{"task_id": a, "reason": "r"}], "quick_help": [], "quick_self": [], "wins": []}))), run(false)).await.unwrap();
        let b = brief(&d.pool).await;
        assert_eq!(b.status, "partial", "the gather failure stays visible");
        assert!(has_ai_picks(&b) && !compose_due(&b));
    }
}
