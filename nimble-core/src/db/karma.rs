//! Momentum ledger (spec 2026-09-23 §3.5, addendum 2026-09-25 §6, Lane C).
//!
//! `karma_events` is append-only and every id is deterministic, so each path
//! that observes a completion (the local status funnel, a Turso pull, a
//! Todoist pull or reconcile, the backfill) can write "its" row and exactly
//! one survives (`INSERT OR IGNORE`):
//!   task:<task_id>:<completed_at>     +1, +1 more at priority >= 3
//!   untask:<task_id>:<completed_at>   minus the original, on the original's day
//!   recur:<task_id>:<occurrence due>  a recurring occurrence
//!   goal:day:<date> +3 · goal:week:<YYYY-Www> +10
//!   penalty:<task_id>:<due_date> -1   (parity mode only)
//!   pause:<date> 0                    a whole paused day (streak history)
//!
//! Writes are fire-and-forget like `activity::log_activity`: each insert runs
//! in its own SAVEPOINT on the caller's connection; a failure rolls back that
//! savepoint only and is logged, never returned, except when SQLite has
//! already rolled back the caller's whole transaction (see `record_tx`). `_tx` helpers never touch the
//! pool (test pools have one connection; the desktop pull holds a write guard).
//!
//! Days are LOCAL calendar dates. `created_at` is the local moment the event
//! happened (a completion's `completed_at`), which is what Peak hour reads.
//! Known limits: complete → reopen → complete inside one wall-clock second
//! reuses the `completed_at` key, so the second completion isn't counted.
//! Pause is day-granular (a mid-day pause pauses the whole day). A Todoist
//! reconcile's completions all land on the day it runs. A Todoist recurring
//! completion counts only once the activity log confirms it
//! (`sync_loop::confirm_recurrences`); two completions of one item between
//! syncs count once, and an unavailable log counts none.
//! Goal bonus rows are recorded whether or not parity mode is on; only parity
//! mode renders them (total, streaks).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveDateTime, Weekday};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};

use crate::db::settings::{get_setting, set_setting};
use crate::db::sync;

/// Nimble stores Todoist's API priority scale verbatim: 1 Normal, 2 Medium,
/// 3 High, 4 Urgent (`apps/desktop/src/lib/priorities.ts`). "Priority >= 3"
/// is High or Urgent, Todoist's p2 and p1.
pub const BONUS_PRIORITY: i64 = 3;

const COLS: &str = "id, date, kind, points, task_id, created_at";
const STAMP: &str = "%Y-%m-%d %H:%M:%S";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, sqlx::FromRow)]
pub struct KarmaEvent {
    pub id: String,
    /// Local `YYYY-MM-DD` the event counts toward.
    pub date: String,
    /// task | untask | recur | goal_day | goal_week | penalty | pause
    pub kind: String,
    pub points: i64,
    pub task_id: Option<String>,
    /// Local `YYYY-MM-DD HH:MM:SS` when it happened.
    pub created_at: String,
}

pub fn now_local() -> String {
    Local::now().format(STAMP).to_string()
}

pub fn day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn points_for(priority: i64) -> i64 {
    if priority >= BONUS_PRIORITY { 2 } else { 1 }
}

/// A stored timestamp → (local date, local `YYYY-MM-DD HH:MM:SS`). Accepts the
/// local SQLite shape every Nimble writer uses (with or without fractional
/// seconds, with a space or a `T`), RFC 3339 (converted to local time), and a
/// bare date (midnight).
pub fn local_stamp(raw: &str) -> Option<(NaiveDate, String)> {
    let raw = raw.trim();
    for fmt in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f"] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(raw, fmt) {
            return Some((dt.date(), dt.format(STAMP).to_string()));
        }
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        let local = dt.with_timezone(&Local).naive_local();
        return Some((local.date(), local.format(STAMP).to_string()));
    }
    let d = NaiveDate::parse_from_str(raw.get(..10)?, "%Y-%m-%d").ok()?;
    Some((d, format!("{} 00:00:00", day(d))))
}

/// `task:<id>:<completed_at>`, keyed on the raw stored stamp so every path
/// that reads the same row builds the same id.
pub fn completion_event(task_id: &str, priority: i64, completed_at: &str) -> Option<KarmaEvent> {
    let (date, at) = local_stamp(completed_at)?;
    Some(KarmaEvent {
        id: format!("task:{task_id}:{completed_at}"),
        date: day(date),
        kind: "task".into(),
        points: points_for(priority),
        task_id: Some(task_id.into()),
        created_at: at,
    })
}

/// `recur:<id>:<occurrence due>`, dated on the day it was completed (`at`).
pub fn recur_event(task_id: &str, occurrence_due: &str, priority: i64, at: &str) -> Option<KarmaEvent> {
    NaiveDate::parse_from_str(occurrence_due, "%Y-%m-%d").ok()?;
    let (date, at) = local_stamp(at)?;
    Some(KarmaEvent {
        id: format!("recur:{task_id}:{occurrence_due}"),
        date: day(date),
        kind: "recur".into(),
        points: points_for(priority),
        task_id: Some(task_id.into()),
        created_at: at,
    })
}

/// Insert one event (and its sync_log row) inside a savepoint on the caller's
/// connection. Returns `Ok(true)` when the row is new.
///
/// A statement error (missing table, constraint, bad snapshot) is logged and
/// swallowed: the savepoint is rolled back and `Ok(false)` returned, so the
/// caller's mutation carries on. The one hard error is when the savepoint
/// itself can't be unwound: SQLite has already rolled back the caller's whole
/// transaction (SQLITE_FULL / IOERR / NOMEM), and carrying on would run the
/// caller's remaining writes in autocommit for a mutation that was lost.
pub(crate) async fn record_tx(conn: &mut SqliteConnection, e: &KarmaEvent) -> crate::Result<bool> {
    if let Err(err) = sqlx::query("SAVEPOINT karma_event").execute(&mut *conn).await {
        log::warn!("karma: {} not recorded (savepoint): {err}", e.id);
        return Ok(false);
    }
    let wrote: crate::Result<bool> = async {
        let n = sqlx::query(&format!("INSERT OR IGNORE INTO karma_events ({COLS}) VALUES (?, ?, ?, ?, ?, ?)"))
            .bind(&e.id).bind(&e.date).bind(&e.kind).bind(e.points).bind(&e.task_id).bind(&e.created_at)
            .execute(&mut *conn).await?.rows_affected();
        if n == 1 {
            let snapshot = serde_json::to_string(e).map_err(|x| crate::Error::Other(x.to_string()))?;
            sync::append_sync_log_tx(&mut *conn, "karma_events", &e.id, "INSERT", None, Some(&snapshot)).await?;
        }
        Ok(n == 1)
    }
    .await;
    match wrote {
        Ok(inserted) => {
            sqlx::query("RELEASE karma_event").execute(&mut *conn).await?;
            Ok(inserted)
        }
        Err(err) => {
            log::warn!("karma: {} not recorded: {err}", e.id);
            sqlx::query("ROLLBACK TO karma_event").execute(&mut *conn).await?;
            sqlx::query("RELEASE karma_event").execute(&mut *conn).await?;
            Ok(false)
        }
    }
}

/// A task row just became complete on `conn` (any writer). Records
/// `task:<id>:<completed_at>` from the row as stored. Errors only when the
/// caller's transaction is gone (see `record_tx`).
pub(crate) async fn on_completed_tx(conn: &mut SqliteConnection, task_id: &str) -> crate::Result<()> {
    let row: Result<Option<(i64, Option<String>)>, sqlx::Error> =
        sqlx::query_as("SELECT priority, completed_at FROM local_tasks WHERE id = ?")
            .bind(task_id).fetch_optional(&mut *conn).await;
    match row {
        Ok(Some((priority, Some(completed_at)))) => {
            if let Some(e) = completion_event(task_id, priority, &completed_at) {
                record_tx(conn, &e).await?;
            }
        }
        Ok(_) => {}
        Err(err) => log::warn!("karma: completion of {task_id} not read: {err}"),
    }
    Ok(())
}

/// A row that was complete is open again. Reverses its completion once, on
/// the original's day: the row keyed on `prior_completed_at` when it is still
/// unreversed, else the most recent unreversed `task:<id>:…` row (last-write-
/// wins can replace `completed_at`, e.g. the Mac's stamp with the web's).
/// Nothing when the ledger never saw an unreversed completion (e.g. one from
/// before the ledger existed and never backfilled).
pub(crate) async fn on_reopened_tx(conn: &mut SqliteConnection, task_id: &str, prior_completed_at: Option<&str>) -> crate::Result<()> {
    let exact = prior_completed_at.map(|stamp| format!("task:{task_id}:{stamp}")).unwrap_or_default();
    let original: Result<Option<KarmaEvent>, sqlx::Error> = sqlx::query_as(&format!(
        "SELECT {COLS} FROM karma_events e WHERE e.kind = 'task' AND e.task_id = ? \
           AND NOT EXISTS (SELECT 1 FROM karma_events u WHERE u.id = 'un' || e.id) \
         ORDER BY (e.id = ?) DESC, e.created_at DESC, e.id DESC LIMIT 1"))
        .bind(task_id).bind(&exact).fetch_optional(&mut *conn).await;
    let original = match original {
        Ok(Some(o)) => o,
        Ok(None) => return Ok(()),
        Err(err) => {
            log::warn!("karma: reversal for {task_id} not read: {err}");
            return Ok(());
        }
    };
    let reversal = KarmaEvent {
        id: format!("un{}", original.id),
        date: original.date,
        kind: "untask".into(),
        points: -original.points,
        task_id: Some(task_id.into()),
        created_at: now_local(),
    };
    record_tx(conn, &reversal).await?;
    Ok(())
}

/// A recurring occurrence due `occurrence_due` was completed at `at` (local).
pub(crate) async fn on_recurred_tx(conn: &mut SqliteConnection, task_id: &str, occurrence_due: &str, priority: i64, at: &str) -> crate::Result<()> {
    if let Some(e) = recur_event(task_id, occurrence_due, priority, at) {
        record_tx(conn, &e).await?;
    }
    Ok(())
}

/// The local funnel's variant: the occurrence counts on the caller's `today`
/// (which may be fixed in tests, or a second before midnight), while
/// `created_at` is the real local moment.
pub(crate) async fn on_recurred_on_tx(conn: &mut SqliteConnection, task_id: &str, occurrence_due: &str, priority: i64, today: NaiveDate) -> crate::Result<()> {
    if let Some(mut e) = recur_event(task_id, occurrence_due, priority, &now_local()) {
        e.date = day(today);
        record_tx(conn, &e).await?;
    }
    Ok(())
}

/// A synced task UPDATE whose changed columns name both `due_date` and
/// `status` is a recurring completion: desktop `set_status_tx` and the web's
/// `setTaskStatus` write exactly that pair; a reschedule never touches status.
pub fn is_roll_forward(changed_columns: Option<&str>) -> bool {
    changed_columns
        .and_then(|c| serde_json::from_str::<Vec<String>>(c).ok())
        .is_some_and(|cols| cols.iter().any(|c| c == "due_date") && cols.iter().any(|c| c == "status"))
}

/// Every event, oldest day first (tests, `dt`, debugging).
pub async fn list_events(pool: &SqlitePool) -> crate::Result<Vec<KarmaEvent>> {
    Ok(sqlx::query_as(&format!("SELECT {COLS} FROM karma_events ORDER BY date, id")).fetch_all(pool).await?)
}

// ── Goals, days off, pause, parity (addendum §2, §6) ───────────────────────

pub const DAY_GOAL_BONUS: i64 = 3;
pub const WEEK_GOAL_BONUS: i64 = 10;
/// Parity only: an open task earns its one -1 when it is this many days past due.
pub const PENALTY_AFTER_DAYS: i64 = 5;
/// How far back a read looks for goals earned but not yet persisted (the
/// goal was hit late last night and Nimble wasn't opened since).
pub const EVALUATE_DAYS: i64 = 14;

pub const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

pub const LEVELS: [(&str, i64); 8] = [
    ("Beginner", 0), ("Novice", 500), ("Intermediate", 2_500), ("Professional", 5_000),
    ("Expert", 7_500), ("Master", 10_000), ("Grand Master", 20_000), ("Enlightened", 50_000),
];

const K_DAILY: &str = "goals.daily";
const K_WEEKLY: &str = "goals.weekly";
const K_DAYS_OFF: &str = "goals.days_off";
const K_PAUSED: &str = "momentum.paused";
const K_PAUSED_AT: &str = "momentum.paused_at";
const K_KARMA: &str = "karma.enabled";
/// UX checkpoint 3 (B): the local date parity was first switched on.
const K_KARMA_AT: &str = "karma.enabled_at";

/// Net completions per row set: repeats count, reversals subtract.
const NET: &str = "COALESCE(SUM(CASE kind WHEN 'task' THEN 1 WHEN 'recur' THEN 1 WHEN 'untask' THEN -1 ELSE 0 END), 0)";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MomentumSettings {
    pub daily_goal: i64,
    pub weekly_goal: i64,
    /// Weekday keys ("mon".."sun") in week order.
    pub days_off: Vec<String>,
    pub paused: bool,
    pub paused_at: Option<String>,
    pub karma_enabled: bool,
    pub karma_enabled_at: Option<String>,
}

impl Default for MomentumSettings {
    fn default() -> Self {
        Self {
            daily_goal: 5, weekly_goal: 25, days_off: vec!["sat".into(), "sun".into()],
            paused: false, paused_at: None, karma_enabled: false, karma_enabled_at: None,
        }
    }
}

impl MomentumSettings {
    pub fn is_day_off(&self, d: NaiveDate) -> bool {
        let key = WEEKDAYS[d.weekday().num_days_from_monday() as usize];
        self.days_off.iter().any(|k| k == key)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalTargets {
    pub daily: i64,
    pub weekly: i64,
    pub days_off: Vec<String>,
    pub karma_enabled: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
pub struct EvaluateReport {
    pub goal_days: u64,
    pub goal_weeks: u64,
    pub penalties: u64,
}

fn normalize_days(keys: &[String]) -> Vec<String> {
    WEEKDAYS.iter()
        .filter(|k| keys.iter().any(|x| x.trim().eq_ignore_ascii_case(k)))
        .map(|k| k.to_string())
        .collect()
}

async fn setting(pool: &SqlitePool, key: &str) -> crate::Result<Option<String>> {
    Ok(get_setting(pool, key).await?.filter(|v| !v.trim().is_empty()))
}

fn positive_int(v: Option<String>, fallback: i64) -> i64 {
    v.and_then(|s| s.trim().parse::<i64>().ok()).filter(|n| *n >= 1).unwrap_or(fallback)
}

/// Lenient read: Lane A's setup writes `goals.*` directly, so anything missing
/// or unparseable falls back to its default instead of failing the read.
pub async fn load_settings(pool: &SqlitePool) -> crate::Result<MomentumSettings> {
    let d = MomentumSettings::default();
    let days_off = match setting(pool, K_DAYS_OFF).await? {
        None => d.days_off.clone(),
        // All seven off is never valid (save_goals refuses it): read as the default.
        Some(json) => serde_json::from_str::<Vec<String>>(&json).map(|v| normalize_days(&v))
            .ok().filter(|v| v.len() < WEEKDAYS.len()).unwrap_or(d.days_off.clone()),
    };
    Ok(MomentumSettings {
        daily_goal: positive_int(setting(pool, K_DAILY).await?, d.daily_goal),
        weekly_goal: positive_int(setting(pool, K_WEEKLY).await?, d.weekly_goal),
        days_off,
        paused: setting(pool, K_PAUSED).await?.as_deref() == Some("1"),
        paused_at: setting(pool, K_PAUSED_AT).await?,
        karma_enabled: setting(pool, K_KARMA).await?.as_deref() == Some("1"),
        karma_enabled_at: setting(pool, K_KARMA_AT).await?,
    })
}

pub async fn save_goals(pool: &SqlitePool, t: GoalTargets) -> crate::Result<MomentumSettings> {
    save_goals_on(pool, t, Local::now().date_naive()).await
}

/// Validate everything first; write only when all of it is valid.
pub async fn save_goals_on(pool: &SqlitePool, t: GoalTargets, today: NaiveDate) -> crate::Result<MomentumSettings> {
    let fail = |m: &str| Err(crate::Error::Other(m.into()));
    if !(1..=100).contains(&t.daily) { return fail("Daily goal must be a whole number from 1 to 100."); }
    if !(1..=700).contains(&t.weekly) { return fail("Weekly goal must be a whole number from 1 to 700."); }
    if t.days_off.iter().any(|k| !WEEKDAYS.contains(&k.trim().to_ascii_lowercase().as_str())) {
        return fail("Days off must be weekday names (mon to sun).");
    }
    let days = normalize_days(&t.days_off);
    if days.len() > 6 { return fail("Leave at least one day that isn't a day off."); }
    let before = load_settings(pool).await?;
    set_setting(pool, K_DAILY, &t.daily.to_string()).await?;
    set_setting(pool, K_WEEKLY, &t.weekly.to_string()).await?;
    set_setting(pool, K_DAYS_OFF, &serde_json::to_string(&days).map_err(|e| crate::Error::Other(e.to_string()))?).await?;
    set_setting(pool, K_KARMA, if t.karma_enabled { "1" } else { "0" }).await?;
    // Off -> on (first time or again) stamps today, so turning parity on
    // never penalizes backlog that crossed its mark while parity was off.
    // Re-saving while it stays on keeps the stamp.
    if t.karma_enabled && (!before.karma_enabled || before.karma_enabled_at.is_none()) {
        set_setting(pool, K_KARMA_AT, &day(today)).await?;
    }
    load_settings(pool).await
}

pub async fn set_paused(pool: &SqlitePool, paused: bool) -> crate::Result<MomentumSettings> {
    set_paused_at(pool, paused, Local::now().naive_local()).await
}

/// Pausing stamps `momentum.paused_at`. Resuming writes a 0-point
/// `pause:<date>` row for every whole paused day (its first day through
/// yesterday), so evaluation and streaks keep skipping them afterwards.
/// No confirmation, and nothing ever comments on the gap.
pub async fn set_paused_at(pool: &SqlitePool, paused: bool, now: NaiveDateTime) -> crate::Result<MomentumSettings> {
    let s = load_settings(pool).await?;
    let stamp = now.format(STAMP).to_string();
    if paused && !s.paused {
        set_setting(pool, K_PAUSED_AT, &stamp).await?;
        set_setting(pool, K_PAUSED, "1").await?;
    } else if !paused && s.paused {
        if let Some((from, _)) = s.paused_at.as_deref().and_then(local_stamp) {
            let mut tx = pool.begin().await?;
            let mut d = from;
            while d < now.date() {
                record_tx(&mut tx, &KarmaEvent {
                    id: format!("pause:{}", day(d)), date: day(d), kind: "pause".into(),
                    points: 0, task_id: None, created_at: stamp.clone(),
                }).await?;
                d = match d.succ_opt() { Some(n) => n, None => break };
            }
            tx.commit().await?;
        }
        set_setting(pool, K_PAUSED, "0").await?;
        set_setting(pool, K_PAUSED_AT, "").await?;
    }
    load_settings(pool).await
}

pub fn week_start(d: NaiveDate) -> NaiveDate {
    d - Duration::days(d.weekday().num_days_from_monday() as i64)
}

pub fn iso_week(d: NaiveDate) -> String {
    let w = d.iso_week();
    format!("{:04}-W{:02}", w.year(), w.week())
}

/// Goal bonuses earned on days in `[from, to]`. `done` holds net completions
/// per local day from the Monday of `from`'s week (weekly totals start there).
/// Days off and paused days are never evaluated for the daily goal; their
/// completions still count toward the week. A week's bonus is dated on the
/// first evaluated day its running total reached the goal.
pub fn goal_events(done: &BTreeMap<NaiveDate, i64>, s: &MomentumSettings, paused: &BTreeSet<NaiveDate>, from: NaiveDate, to: NaiveDate, at: &str) -> Vec<KarmaEvent> {
    let mut out: Vec<KarmaEvent> = Vec::new();
    let mut d = week_start(from);
    let mut week_total = 0;
    while d <= to {
        if d.weekday() == Weekday::Mon { week_total = 0; }
        let n = done.get(&d).copied().unwrap_or(0);
        week_total += n;
        let evaluated = d >= from && !paused.contains(&d);
        if evaluated && !s.is_day_off(d) && n >= s.daily_goal {
            out.push(KarmaEvent { id: format!("goal:day:{}", day(d)), date: day(d), kind: "goal_day".into(),
                points: DAY_GOAL_BONUS, task_id: None, created_at: at.into() });
        }
        let week_id = format!("goal:week:{}", iso_week(d));
        if evaluated && week_total >= s.weekly_goal && !out.iter().any(|e| e.id == week_id) {
            out.push(KarmaEvent { id: week_id, date: day(d), kind: "goal_week".into(),
                points: WEEK_GOAL_BONUS, task_id: None, created_at: at.into() });
        }
        d = match d.succ_opt() { Some(n) => n, None => break };
    }
    out
}

/// Parity only: -1 once per open task on the day it reaches
/// `PENALTY_AFTER_DAYS` past due. Only marks on or after the day parity was
/// switched on, never on a paused day, never in the future.
pub fn penalty_events(open_due: &[(String, String)], s: &MomentumSettings, paused: &BTreeSet<NaiveDate>, today: NaiveDate, at: &str) -> Vec<KarmaEvent> {
    if !s.karma_enabled { return Vec::new(); }
    let enabled_from = s.karma_enabled_at.as_deref()
        .and_then(|v| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok())
        .unwrap_or(today);
    open_due.iter().filter_map(|(id, due)| {
        let mark = NaiveDate::parse_from_str(due, "%Y-%m-%d").ok()? + Duration::days(PENALTY_AFTER_DAYS);
        (mark <= today && mark >= enabled_from && !paused.contains(&mark)).then(|| KarmaEvent {
            id: format!("penalty:{id}:{due}"), date: day(mark), kind: "penalty".into(),
            points: -1, task_id: Some(id.clone()), created_at: at.into(),
        })
    }).collect()
}

/// (level name, points where the next level starts). A negative total is Beginner.
pub fn level_for(total: i64) -> (&'static str, Option<i64>) {
    let i = LEVELS.iter().rposition(|(_, min)| total >= *min).unwrap_or(0);
    (LEVELS[i].0, LEVELS.get(i + 1).map(|(_, min)| *min))
}

fn skipped(d: NaiveDate, s: &MomentumSettings, paused: &BTreeSet<NaiveDate>) -> bool {
    s.is_day_off(d) || paused.contains(&d)
}

/// Parity mode: goal days in a row, ending today once today is earned (an
/// unearned today never breaks the run). Days off and paused days are
/// stepped over: they neither extend nor break it.
pub fn daily_streak(earned: &BTreeSet<NaiveDate>, s: &MomentumSettings, paused: &BTreeSet<NaiveDate>, today: NaiveDate) -> i64 {
    let Some(first) = earned.iter().next().copied() else { return 0 };
    let mut d = if earned.contains(&today) { today } else {
        match today.pred_opt() { Some(y) => y, None => return 0 }
    };
    let mut n = 0;
    while d >= first {
        if earned.contains(&d) { n += 1; } else if !skipped(d, s, paused) { break; }
        d = match d.pred_opt() { Some(p) => p, None => break };
    }
    n
}

/// Parity mode: goal weeks in a row (keyed by their Monday), ending this week
/// once it is earned. An unearned week that was all days off, or had any
/// paused day, is stepped over: pausing never breaks a streak.
pub fn weekly_streak(earned_mondays: &BTreeSet<NaiveDate>, s: &MomentumSettings, paused: &BTreeSet<NaiveDate>, today: NaiveDate) -> i64 {
    let Some(first) = earned_mondays.iter().next().copied() else { return 0 };
    let this = week_start(today);
    let mut w = if earned_mondays.contains(&this) { this } else { this - Duration::days(7) };
    let mut n = 0;
    while w >= first {
        let days = || (0..7).map(|i| w + Duration::days(i));
        if earned_mondays.contains(&w) {
            n += 1;
        } else if !(days().all(|d| skipped(d, s, paused)) || days().any(|d| paused.contains(&d))) {
            break;
        }
        w = w - Duration::days(7);
    }
    n
}

/// Paused days: every recorded `pause:` row plus the live pause (its first day through today).
pub(crate) async fn paused_days(pool: &SqlitePool, s: &MomentumSettings, today: NaiveDate) -> crate::Result<BTreeSet<NaiveDate>> {
    let mut out: BTreeSet<NaiveDate> = sqlx::query_scalar::<_, String>("SELECT date FROM karma_events WHERE kind = 'pause'")
        .fetch_all(pool).await?
        .iter().filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).collect();
    if s.paused {
        let mut d = s.paused_at.as_deref().and_then(local_stamp).map(|(d, _)| d).unwrap_or(today);
        while d <= today {
            out.insert(d);
            d = match d.succ_opt() { Some(n) => n, None => break };
        }
    }
    Ok(out)
}

pub async fn done_by_day(pool: &SqlitePool, from: NaiveDate, to: NaiveDate) -> crate::Result<BTreeMap<NaiveDate, i64>> {
    let rows: Vec<(String, i64)> = sqlx::query_as(&format!(
        "SELECT date, {NET} FROM karma_events WHERE date >= ? AND date <= ? GROUP BY date"))
        .bind(day(from)).bind(day(to)).fetch_all(pool).await?;
    Ok(rows.into_iter().filter_map(|(d, n)| Some((NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()?, n))).collect())
}

/// Persist what `[from, today]` has earned and, in parity mode, owes. While
/// paused, nothing is evaluated. Idempotent (ids).
pub async fn evaluate_at(pool: &SqlitePool, from: NaiveDate, today: NaiveDate) -> crate::Result<EvaluateReport> {
    let s = load_settings(pool).await?;
    let mut report = EvaluateReport::default();
    if s.paused { return Ok(report); }
    let paused = paused_days(pool, &s, today).await?;
    let done = done_by_day(pool, week_start(from), today).await?;
    let at = now_local();
    let mut events = goal_events(&done, &s, &paused, from, today, &at);
    if s.karma_enabled {
        let open: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, due_date FROM local_tasks WHERE completed = 0 AND due_date IS NOT NULL AND due_date <= ?")
            .bind(day(today - Duration::days(PENALTY_AFTER_DAYS))).fetch_all(pool).await?;
        events.extend(penalty_events(&open, &s, &paused, today, &at));
    }
    // Summary reads call this every time: skip ids already persisted, and open
    // no write transaction when nothing is new.
    let ids = serde_json::to_string(&events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>())
        .map_err(|e| crate::Error::Other(e.to_string()))?;
    let existing: std::collections::HashSet<String> = sqlx::query_scalar(
        "SELECT id FROM karma_events WHERE id IN (SELECT value FROM json_each(?))")
        .bind(ids).fetch_all(pool).await?.into_iter().collect();
    events.retain(|e| !existing.contains(&e.id));
    if events.is_empty() { return Ok(report); }
    let mut tx = pool.begin().await?;
    for e in &events {
        if record_tx(&mut tx, e).await? {
            match e.kind.as_str() {
                "goal_day" => report.goal_days += 1,
                "goal_week" => report.goal_weeks += 1,
                _ => report.penalties += 1,
            }
        }
    }
    tx.commit().await?;
    Ok(report)
}

// ── Summary (the Momentum box + Activity tiles) and backfill ───────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrendDay { pub date: String, pub done: i64, pub day_off: bool, pub paused: bool }

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Win { pub task_id: String, pub content: String, pub priority: i64, pub date: String }

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RangeStats {
    /// First local date of the range; None for "all".
    pub from: Option<String>,
    pub completed: i64,
    pub active_days: i64,
    pub peak_hour: Option<i64>,
    pub focused_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KarmaParity { pub total: i64, pub level: String, pub next_level_at: Option<i64>, pub daily_streak: i64, pub weekly_streak: i64 }

/// Everything the box and the tiles render. With karma off, `karma` is None
/// and no field describes a past day's goal, so a missed goal can't leak
/// into the next day's copy.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MomentumSummary {
    pub today: String,
    pub range: String,
    pub settings: MomentumSettings,
    pub is_day_off: bool,
    pub today_done: i64,
    pub week_done: i64,
    pub week_start: String,
    /// The last 7 local days, oldest first, ending today.
    pub trend: Vec<TrendDay>,
    /// Up to 3 of this week's completions, highest priority first.
    pub wins: Vec<Win>,
    pub stats: RangeStats,
    pub karma: Option<KarmaParity>,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct BackfillReport {
    pub tasks: u64,
    pub recurrences: u64,
    pub goal_days: u64,
    pub goal_weeks: u64,
    /// Completions skipped because their exact `completed_at` second is a
    /// bulk stamp (`BULK_STAMP_MIN`+ tasks), e.g. a Todoist reconcile.
    pub bulk_skipped: u64,
}

/// This many completions sharing one exact second is a bulk stamp (an
/// import or reconcile), not work done then. A parent closing a few
/// subtasks stays well under it.
pub const BULK_STAMP_MIN: usize = 10;

/// A completion row whose reversal exists doesn't count (for wins/peak hour).
const NOT_REVERSED: &str = "NOT EXISTS (SELECT 1 FROM karma_events u WHERE u.id = 'un' || e.id)";

fn range_from(range: &str, today: NaiveDate) -> crate::Result<Option<NaiveDate>> {
    match range {
        "7d" => Ok(Some(today - Duration::days(6))),
        "30d" => Ok(Some(today - Duration::days(29))),
        "all" => Ok(None),
        _ => Err(crate::Error::Other("range must be 7d, 30d or all".into())),
    }
}

pub async fn momentum_summary(pool: &SqlitePool, range: &str) -> crate::Result<MomentumSummary> {
    momentum_summary_at(pool, range, Local::now().date_naive()).await
}

/// Persist what the last `EVALUATE_DAYS` earned (fire-and-forget: a failure
/// is logged and the read still answers), then read.
pub async fn momentum_summary_at(pool: &SqlitePool, range: &str, today: NaiveDate) -> crate::Result<MomentumSummary> {
    range_from(range, today)?;
    if let Err(e) = evaluate_at(pool, today - Duration::days(EVALUATE_DAYS - 1), today).await {
        log::warn!("karma: evaluation skipped: {e}");
    }
    read_summary_at(pool, range, today).await
}

/// The read-only half, also what the brief module snapshots.
pub async fn read_summary_at(pool: &SqlitePool, range: &str, today: NaiveDate) -> crate::Result<MomentumSummary> {
    let from = range_from(range, today)?;
    let s = load_settings(pool).await?;
    let paused = paused_days(pool, &s, today).await?;
    let ws = week_start(today);
    let trend_from = today - Duration::days(6);
    let counts = done_by_day(pool, trend_from.min(ws), today).await?;
    let n = |d: NaiveDate| counts.get(&d).copied().unwrap_or(0);
    let trend: Vec<TrendDay> = (0..7).map(|i| {
        let d = trend_from + Duration::days(i);
        TrendDay { date: day(d), done: n(d), day_off: s.is_day_off(d), paused: paused.contains(&d) }
    }).collect();
    let week_done: i64 = (0..=(today - ws).num_days()).map(|i| n(ws + Duration::days(i))).sum();

    let lo = from.map(day).unwrap_or_else(|| "0000-01-01".into());
    let hi = day(today);
    let completed: i64 = sqlx::query_scalar(&format!("SELECT {NET} FROM karma_events WHERE date >= ? AND date <= ?"))
        .bind(&lo).bind(&hi).fetch_one(pool).await?;
    let active_days: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM (SELECT date FROM karma_events WHERE date >= ? AND date <= ? GROUP BY date HAVING {NET} > 0)"))
        .bind(&lo).bind(&hi).fetch_one(pool).await?;
    let peak_hour: Option<i64> = sqlx::query_scalar::<_, i64>(&format!(
        "SELECT CAST(substr(e.created_at, 12, 2) AS INTEGER) AS h FROM karma_events e \
         WHERE e.kind IN ('task','recur') AND e.date >= ? AND e.date <= ? AND {NOT_REVERSED} \
         GROUP BY h ORDER BY COUNT(*) DESC, h ASC LIMIT 1"))
        .bind(&lo).bind(&hi).fetch_optional(pool).await?;
    let wins: Vec<(String, String, i64, String)> = sqlx::query_as(&format!(
        "SELECT e.task_id, t.content, t.priority, MAX(e.date) FROM karma_events e JOIN local_tasks t ON t.id = e.task_id \
         WHERE e.kind IN ('task','recur') AND e.date >= ? AND e.date <= ? AND {NOT_REVERSED} \
         GROUP BY e.task_id ORDER BY t.priority DESC, MAX(e.created_at) DESC LIMIT 3"))
        .bind(day(ws)).bind(&hi).fetch_all(pool).await?;
    let focused_ms = focused_ms(pool, from, today).await?;
    let karma = if s.karma_enabled { Some(parity(pool, &s, &paused, today).await?) } else { None };

    Ok(MomentumSummary {
        today: hi.clone(),
        range: range.into(),
        is_day_off: s.is_day_off(today),
        today_done: n(today),
        week_done,
        week_start: day(ws),
        trend,
        wins: wins.into_iter().map(|(task_id, content, priority, date)| Win { task_id, content, priority, date }).collect(),
        stats: RangeStats { from: from.map(day), completed, active_days, peak_hour, focused_ms },
        karma,
        settings: s,
    })
}

/// `focus_sessions.work_ms`, by the session's LOCAL start date
/// (`started_at` is UTC RFC 3339; `timezone_offset_minutes` is the device offset then).
async fn focused_ms(pool: &SqlitePool, from: Option<NaiveDate>, to: NaiveDate) -> crate::Result<i64> {
    let rows: Vec<(Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT started_at, timezone_offset_minutes, work_ms FROM focus_sessions WHERE work_ms > 0")
        .fetch_all(pool).await?;
    Ok(rows.into_iter().filter_map(|(started, offset, ms)| {
        let utc = chrono::DateTime::parse_from_rfc3339(started.as_deref()?).ok()?.naive_utc();
        let local = (utc + Duration::minutes(offset)).date();
        (from.map_or(true, |f| local >= f) && local <= to).then_some(ms)
    }).sum())
}

async fn kind_dates(pool: &SqlitePool, kind: &str) -> crate::Result<BTreeSet<NaiveDate>> {
    Ok(sqlx::query_scalar::<_, String>("SELECT date FROM karma_events WHERE kind = ?")
        .bind(kind).fetch_all(pool).await?
        .iter().filter_map(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()).collect())
}

async fn parity(pool: &SqlitePool, s: &MomentumSettings, paused: &BTreeSet<NaiveDate>, today: NaiveDate) -> crate::Result<KarmaParity> {
    let total: i64 = sqlx::query_scalar("SELECT COALESCE(SUM(points), 0) FROM karma_events").fetch_one(pool).await?;
    let (level, next_level_at) = level_for(total);
    let days = kind_dates(pool, "goal_day").await?;
    let weeks: BTreeSet<NaiveDate> = kind_dates(pool, "goal_week").await?.into_iter().map(week_start).collect();
    Ok(KarmaParity {
        total, level: level.into(), next_level_at,
        daily_streak: daily_streak(&days, s, paused, today),
        weekly_streak: weekly_streak(&weeks, s, paused, today),
    })
}

pub async fn backfill(pool: &SqlitePool) -> crate::Result<BackfillReport> {
    backfill_at(pool, Local::now().date_naive()).await
}

/// Rebuild what history can tell: every task still marked complete (at its
/// `completed_at`), every `task_recurred` activity row, then goal bonuses over
/// the whole span with today's goals. Idempotent, so it's safe to rerun after C5.
/// Deliberately not activity-log completions (re-score 1c found them unreliable).
pub async fn backfill_at(pool: &SqlitePool, today: NaiveDate) -> crate::Result<BackfillReport> {
    let mut r = BackfillReport::default();
    let completed: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT id, priority, completed_at FROM local_tasks WHERE completed = 1 AND completed_at IS NOT NULL")
        .fetch_all(pool).await?;
    let priority: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>("SELECT id, priority FROM local_tasks")
        .fetch_all(pool).await?.into_iter().collect();
    let recurred: Vec<(Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT target_id, metadata, created_at FROM activity_log WHERE action_type = 'task_recurred'")
        .fetch_all(pool).await?;
    let mut per_stamp: HashMap<&str, usize> = HashMap::new();
    for (_, _, at) in &completed { *per_stamp.entry(at.as_str()).or_default() += 1; }
    let mut tx = pool.begin().await?;
    for (id, p, at) in &completed {
        if per_stamp.get(at.as_str()).copied().unwrap_or(0) >= BULK_STAMP_MIN {
            r.bulk_skipped += 1;
            continue;
        }
        if let Some(e) = completion_event(id, *p, at) {
            if record_tx(&mut tx, &e).await? { r.tasks += 1; }
        }
    }
    for (target, meta, at) in &recurred {
        let (Some(task_id), Some(meta)) = (target, meta) else { continue };
        let Some(from) = serde_json::from_str::<serde_json::Value>(meta).ok()
            .and_then(|m| m["from"].as_str().map(str::to_owned)) else { continue };
        let p = priority.get(task_id).copied().unwrap_or(1);
        if let Some(e) = recur_event(task_id, &from, p, at) {
            if record_tx(&mut tx, &e).await? { r.recurrences += 1; }
        }
    }
    tx.commit().await?;
    if r.bulk_skipped > 0 {
        log::info!("karma backfill: skipped {} completions sharing a bulk stamp ({}+ per second)", r.bulk_skipped, BULK_STAMP_MIN);
    }
    let first: Option<String> = sqlx::query_scalar("SELECT MIN(date) FROM karma_events WHERE kind IN ('task','recur')")
        .fetch_one(pool).await?;
    if let Some(first) = first.and_then(|v| NaiveDate::parse_from_str(&v, "%Y-%m-%d").ok()) {
        let e = evaluate_at(pool, first.min(today), today).await?;
        r.goal_days = e.goal_days;
        r.goal_weeks = e.goal_weeks;
    }
    Ok(r)
}

/// Bumped when a backfill change should rerun on every Mac at next launch.
pub const BACKFILL_VERSION: &str = "1";
const K_BACKFILL: &str = "momentum.backfill_version";

/// Launch hook: rebuild until one run succeeds for this `BACKFILL_VERSION`
/// (stamped in `momentum.backfill_version` only after a fully successful run).
/// A non-empty ledger is no signal: a live completion can land first. The
/// backfill is idempotent by id, so a retry is harmless. Fire-and-forget.
pub async fn backfill_if_needed(pool: &SqlitePool) {
    match get_setting(pool, K_BACKFILL).await {
        Ok(Some(v)) if v == BACKFILL_VERSION => return,
        Ok(_) => {}
        Err(e) => { log::warn!("karma backfill check failed: {e}"); return; }
    }
    match backfill(pool).await {
        Ok(r) => {
            log::info!("karma backfill: {r:?}");
            if let Err(e) = set_setting(pool, K_BACKFILL, BACKFILL_VERSION).await {
                log::warn!("karma backfill done but not stamped (reruns next launch): {e}");
            }
        }
        Err(e) => log::warn!("karma backfill failed (retries next launch): {e}"),
    }
}

#[cfg(test)]
mod ledger_tests {
    use super::*;
    use crate::test_util::test_pool;

    fn ev(id: &str) -> KarmaEvent {
        KarmaEvent { id: id.into(), date: "2026-09-25".into(), kind: "task".into(), points: 1,
            task_id: Some("t1".into()), created_at: "2026-09-25 10:00:00".into() }
    }

    #[test]
    fn local_stamps_normalize_to_the_local_day() {
        let d = NaiveDate::from_ymd_opt(2026, 9, 25).unwrap();
        assert_eq!(local_stamp("2026-09-25 23:58:00"), Some((d, "2026-09-25 23:58:00".into())));
        assert_eq!(local_stamp("2026-09-25 23:58:00.123").unwrap().1, "2026-09-25 23:58:00");
        assert_eq!(local_stamp("2026-09-25T08:30:00").unwrap().1, "2026-09-25 08:30:00");
        assert_eq!(local_stamp("2026-09-25").unwrap().1, "2026-09-25 00:00:00");
        assert_eq!(local_stamp("not a date"), None);
        // RFC 3339 lands on its LOCAL date (computed, so this holds in any zone).
        let utc = "2026-09-26T03:30:00Z";
        let want = chrono::DateTime::parse_from_rfc3339(utc).unwrap().with_timezone(&Local).naive_local();
        assert_eq!(local_stamp(utc), Some((want.date(), want.format(STAMP).to_string())));
    }

    #[test]
    fn high_and_urgent_earn_the_bonus() {
        assert_eq!([1i64, 2, 3, 4].map(points_for), [1, 1, 2, 2]);
        let e = completion_event("t1", 4, "2026-09-25 10:00:00").unwrap();
        assert_eq!((e.id.as_str(), e.date.as_str(), e.kind.as_str(), e.points), ("task:t1:2026-09-25 10:00:00", "2026-09-25", "task", 2));
        assert!(completion_event("t1", 1, "garbage").is_none());
        let r = recur_event("t1", "2026-09-20", 1, "2026-09-25 07:00:00").unwrap();
        assert_eq!((r.id.as_str(), r.date.as_str(), r.kind.as_str(), r.points), ("recur:t1:2026-09-20", "2026-09-25", "recur", 1));
        assert!(recur_event("t1", "someday", 1, "2026-09-25 07:00:00").is_none());
    }

    #[tokio::test]
    async fn recording_is_idempotent_and_logs_one_sync_row() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.unwrap();
        assert!(record_tx(&mut tx, &ev("task:t1:x")).await.unwrap());
        assert!(!record_tx(&mut tx, &ev("task:t1:x")).await.unwrap());
        tx.commit().await.unwrap();
        assert_eq!(list_events(&pool).await.unwrap().len(), 1);
        let logs: Vec<(String, String)> = sqlx::query_as(
            "SELECT row_id, operation FROM sync_log WHERE table_name = 'karma_events'")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(logs, [("task:t1:x".to_string(), "INSERT".to_string())]);
    }

    #[tokio::test]
    async fn a_failed_write_is_swallowed_and_the_callers_transaction_commits() {
        let pool = test_pool().await;
        sqlx::query("DROP TABLE karma_events").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES ('probe', '1', datetime('now'))")
            .execute(&mut *tx).await.unwrap();
        assert!(!record_tx(&mut tx, &ev("task:t1:x")).await.unwrap(), "a statement error is swallowed");
        tx.commit().await.unwrap();
        assert_eq!(crate::db::settings::get_setting(&pool, "probe").await.unwrap().as_deref(), Some("1"));
    }

    #[tokio::test]
    async fn a_reversal_needs_its_original_and_mirrors_it_once() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.unwrap();
        on_reopened_tx(&mut tx, "t1", Some("2026-09-24 10:00:00")).await.unwrap(); // nothing to reverse yet
        let mut original = ev("task:t1:2026-09-24 10:00:00");
        original.date = "2026-09-24".into();
        original.points = 2;
        record_tx(&mut tx, &original).await.unwrap();
        on_reopened_tx(&mut tx, "t1", Some("2026-09-24 10:00:00")).await.unwrap();
        on_reopened_tx(&mut tx, "t1", Some("2026-09-24 10:00:00")).await.unwrap();
        on_reopened_tx(&mut tx, "t1", None).await.unwrap();
        tx.commit().await.unwrap();
        let events = list_events(&pool).await.unwrap();
        let rev: Vec<&KarmaEvent> = events.iter().filter(|x| x.kind == "untask").collect();
        assert_eq!(rev.len(), 1);
        assert_eq!((rev[0].id.as_str(), rev[0].date.as_str(), rev[0].points), ("untask:t1:2026-09-24 10:00:00", "2026-09-24", -2));
    }

    #[tokio::test]
    async fn on_completed_reads_the_row_it_just_stamped() {
        let pool = test_pool().await;
        sqlx::query("INSERT INTO local_tasks (id, content, project_id, priority, status, completed, completed_at) VALUES ('t9', 'x', 'inbox', 3, 'complete', 1, '2026-09-25 18:00:00')")
            .execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        on_completed_tx(&mut tx, "t9").await.unwrap();
        on_completed_tx(&mut tx, "missing").await.unwrap(); // no row: nothing, no error
        on_recurred_tx(&mut tx, "t9", "2026-09-25", 3, "2026-09-25 18:00:00").await.unwrap();
        tx.commit().await.unwrap();
        let ids: Vec<String> = list_events(&pool).await.unwrap().into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["recur:t9:2026-09-25", "task:t9:2026-09-25 18:00:00"]);
    }

    #[tokio::test]
    async fn a_write_that_kills_the_callers_transaction_is_a_hard_error() {
        // RAISE(ROLLBACK) rolls back the whole transaction, like SQLITE_FULL /
        // IOERR / NOMEM do; the savepoint is gone, so ROLLBACK TO fails.
        let pool = test_pool().await;
        sqlx::raw_sql("CREATE TRIGGER karma_boom BEFORE INSERT ON karma_events BEGIN SELECT RAISE(ROLLBACK, 'boom'); END")
            .execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES ('probe', '1', datetime('now'))")
            .execute(&mut *tx).await.unwrap();
        assert!(record_tx(&mut tx, &ev("task:t1:x")).await.is_err());
        let _ = tx.rollback().await;
        assert_eq!(crate::db::settings::get_setting(&pool, "probe").await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_reopen_after_the_stamp_changed_reverses_the_latest_unreversed_completion() {
        // LWW replaced completed_at (Mac L, then the web's W) before the reopen.
        let pool = test_pool().await;
        let mut tx = pool.begin().await.unwrap();
        let mut old = ev("task:t8:2026-09-10 08:00:00");
        old.created_at = "2026-09-10 08:00:00".into();
        old.task_id = Some("t8".into());
        record_tx(&mut tx, &old).await.unwrap();
        on_reopened_tx(&mut tx, "t8", Some("2026-09-10 08:00:00")).await.unwrap(); // an earlier, already reversed pair
        let mut latest = ev("task:t8:2026-09-20 09:00:00");
        latest.created_at = "2026-09-20 09:00:00".into();
        latest.task_id = Some("t8".into());
        latest.date = "2026-09-20".into();
        record_tx(&mut tx, &latest).await.unwrap();
        on_reopened_tx(&mut tx, "t8", Some("2026-09-20 09:00:05")).await.unwrap(); // W: not in the ledger
        on_reopened_tx(&mut tx, "t8", Some("2026-09-20 09:00:05")).await.unwrap();
        tx.commit().await.unwrap();
        let e = list_events(&pool).await.unwrap();
        let mut rev: Vec<(&str, &str, i64)> = e.iter().filter(|x| x.kind == "untask").map(|x| (x.id.as_str(), x.date.as_str(), x.points)).collect();
        rev.sort();
        assert_eq!(rev, [("untask:t8:2026-09-10 08:00:00", "2026-09-25", -1), ("untask:t8:2026-09-20 09:00:00", "2026-09-20", -1)]);
        assert_eq!(e.iter().map(|x| x.points).sum::<i64>(), 0);
    }

    #[tokio::test]
    async fn a_read_with_nothing_new_to_persist_writes_nothing() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.unwrap();
        for i in 0..5 {
            record_tx(&mut tx, &completion_event(&format!("t{i}"), 1, &format!("2026-09-23 1{i}:00:00")).unwrap()).await.unwrap();
        }
        tx.commit().await.unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 9, 23).unwrap();
        assert_eq!(evaluate_at(&pool, today, today).await.unwrap().goal_days, 1);
        // Any further insert would abort the whole transaction.
        sqlx::raw_sql("CREATE TRIGGER karma_boom BEFORE INSERT ON karma_events BEGIN SELECT RAISE(ROLLBACK, 'boom'); END")
            .execute(&pool).await.unwrap();
        assert_eq!(evaluate_at(&pool, today, today).await.unwrap(), EvaluateReport::default());
    }

    #[tokio::test]
    async fn repeated_toggles_with_distinct_stamps_each_count_and_reverse() {
        use crate::db::tasks::update_task_status;
        let pool = test_pool().await;
        // Cycle 1 happened earlier: complete at a past stamp, as the funnel would record it.
        sqlx::query("INSERT INTO local_tasks (id, content, project_id, priority, status, completed, completed_at) VALUES ('t7', 'x', 'inbox', 1, 'complete', 1, '2026-09-20 09:00:00')")
            .execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        on_completed_tx(&mut tx, "t7").await.unwrap();
        tx.commit().await.unwrap();
        update_task_status(&pool, "t7", "todo", None).await.unwrap();
        // Cycle 2 through the funnel, with a fresh (different) stamp.
        update_task_status(&pool, "t7", "complete", None).await.unwrap();
        let s2: String = sqlx::query_scalar("SELECT completed_at FROM local_tasks WHERE id='t7'")
            .fetch_one(&pool).await.unwrap();
        assert_ne!(s2, "2026-09-20 09:00:00");
        update_task_status(&pool, "t7", "todo", None).await.unwrap();
        let mut got: Vec<(String, i64)> = list_events(&pool).await.unwrap().into_iter().map(|e| (e.id, e.points)).collect();
        got.sort();
        let mut want = vec![
            ("task:t7:2026-09-20 09:00:00".to_string(), 1),
            ("untask:t7:2026-09-20 09:00:00".to_string(), -1),
            (format!("task:t7:{s2}"), 1),
            (format!("untask:t7:{s2}"), -1),
        ];
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn only_a_due_plus_status_change_is_a_roll_forward() {
        assert!(is_roll_forward(Some(r#"["due_date","due_time","status","completed","completed_at"]"#)));
        assert!(is_roll_forward(Some(r#"["due_date","due_time","status"]"#)));
        assert!(!is_roll_forward(Some(r#"["due_date"]"#)), "a reschedule");
        assert!(!is_roll_forward(Some(r#"["status","completed","completed_at"]"#)));
        assert!(!is_roll_forward(None));
        assert!(!is_roll_forward(Some("not json")));
    }
}

#[cfg(test)]
mod goal_tests {
    use super::*;
    use crate::test_util::test_pool;

    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }
    fn done(pairs: &[(&str, i64)]) -> BTreeMap<NaiveDate, i64> { pairs.iter().map(|(k, v)| (d(k), *v)).collect() }
    fn ids(events: &[KarmaEvent]) -> Vec<&str> { events.iter().map(|e| e.id.as_str()).collect() }
    const AT: &str = "2026-09-27 20:00:00";

    // 2026-09-21 is a Monday (ISO week 2026-W39). Defaults: daily 5, weekly 25, Sat+Sun off.
    #[test]
    fn daily_goals_skip_days_off_and_paused_days() {
        let s = MomentumSettings::default();
        let counts = done(&[("2026-09-21", 5), ("2026-09-22", 4), ("2026-09-23", 6), ("2026-09-26", 7)]);
        let paused: BTreeSet<NaiveDate> = [d("2026-09-23")].into();
        let e = goal_events(&counts, &s, &paused, d("2026-09-21"), d("2026-09-27"), AT);
        assert_eq!(ids(&e), ["goal:day:2026-09-21"], "Tue under goal, Wed paused, Sat a day off");
        assert_eq!(e[0].points, DAY_GOAL_BONUS);
    }

    #[test]
    fn a_week_is_earned_once_on_the_day_its_total_crosses_the_goal() {
        let s = MomentumSettings { weekly_goal: 10, ..Default::default() };
        // Saturday is a day off, but its completions still count toward the week.
        let counts = done(&[("2026-09-21", 3), ("2026-09-22", 3), ("2026-09-26", 4), ("2026-09-27", 2)]);
        let e = goal_events(&counts, &s, &BTreeSet::new(), d("2026-09-21"), d("2026-09-27"), AT);
        let week: Vec<&KarmaEvent> = e.iter().filter(|x| x.kind == "goal_week").collect();
        assert_eq!(week.len(), 1);
        assert_eq!((week[0].id.as_str(), week[0].date.as_str(), week[0].points), ("goal:week:2026-W39", "2026-09-26", WEEK_GOAL_BONUS));
    }

    #[test]
    fn levels_follow_todoist_thresholds() {
        assert_eq!(level_for(-3), ("Beginner", Some(500)));
        assert_eq!(level_for(499), ("Beginner", Some(500)));
        assert_eq!(level_for(500), ("Novice", Some(2_500)));
        assert_eq!(level_for(7_500), ("Expert", Some(10_000)));
        assert_eq!(level_for(49_999), ("Grand Master", Some(50_000)));
        assert_eq!(level_for(50_000), ("Enlightened", None));
    }

    #[test]
    fn streaks_step_over_days_off_and_pauses_and_wait_for_today() {
        let s = MomentumSettings::default();
        // Thu 17 + Fri 18 earned; Sat/Sun off; Mon 21 paused; Tue 22 earned; today Wed 23 not yet.
        let earned: BTreeSet<NaiveDate> = ["2026-09-17", "2026-09-18", "2026-09-22"].map(d).into();
        let paused: BTreeSet<NaiveDate> = [d("2026-09-21")].into();
        assert_eq!(daily_streak(&earned, &s, &paused, d("2026-09-23")), 3);
        let mut with_today = earned.clone();
        with_today.insert(d("2026-09-23"));
        assert_eq!(daily_streak(&with_today, &s, &paused, d("2026-09-23")), 4);
        assert_eq!(daily_streak(&earned, &s, &BTreeSet::new(), d("2026-09-23")), 1, "Mon 21 missed ends it");
        assert_eq!(daily_streak(&BTreeSet::new(), &s, &paused, d("2026-09-23")), 0);
        // Weeks (keyed by Monday): W37 + W38 earned, this week not yet.
        let weeks: BTreeSet<NaiveDate> = ["2026-09-07", "2026-09-14"].map(d).into();
        assert_eq!(weekly_streak(&weeks, &s, &BTreeSet::new(), d("2026-09-23")), 2);
        // W38 unearned but with a paused day: stepped over, never breaks W37.
        let w37: BTreeSet<NaiveDate> = [d("2026-09-07")].into();
        let wed: BTreeSet<NaiveDate> = [d("2026-09-16")].into();
        assert_eq!(weekly_streak(&w37, &s, &wed, d("2026-09-23")), 1);
        assert_eq!(weekly_streak(&w37, &s, &BTreeSet::new(), d("2026-09-23")), 0);
    }

    #[test]
    fn penalties_are_parity_only_once_per_due_date_and_start_at_enable() {
        let open = vec![
            ("a".to_string(), "2026-09-10".to_string()),
            ("b".to_string(), "2026-09-18".to_string()),
            ("c".to_string(), "2026-09-20".to_string()),
        ];
        assert!(penalty_events(&open, &MomentumSettings::default(), &BTreeSet::new(), d("2026-09-23"), AT).is_empty());
        let on = MomentumSettings { karma_enabled: true, karma_enabled_at: Some("2026-09-20".into()), ..Default::default() };
        let e = penalty_events(&open, &on, &BTreeSet::new(), d("2026-09-23"), AT);
        // a: mark 09-15 predates parity; b: mark 09-23 is today; c: mark 09-25 not yet.
        assert_eq!(ids(&e), ["penalty:b:2026-09-18"]);
        assert_eq!((e[0].points, e[0].date.as_str()), (-1, "2026-09-23"));
        let paused: BTreeSet<NaiveDate> = [d("2026-09-23")].into();
        assert!(penalty_events(&open, &on, &paused, d("2026-09-23"), AT).is_empty());
    }

    #[tokio::test]
    async fn settings_read_leniently_and_validate_before_writing() {
        let pool = test_pool().await;
        assert_eq!(load_settings(&pool).await.unwrap(), MomentumSettings::default());
        // Lane A's setup writes raw values; junk falls back to the defaults.
        crate::db::settings::set_setting(&pool, "goals.daily", "seven").await.unwrap();
        crate::db::settings::set_setting(&pool, "goals.days_off", r#"["SUN","fri","someday"]"#).await.unwrap();
        let s = load_settings(&pool).await.unwrap();
        assert_eq!((s.daily_goal, s.days_off.clone()), (5, vec!["fri".to_string(), "sun".to_string()]));
        crate::db::settings::set_setting(&pool, "goals.days_off", &serde_json::to_string(&WEEKDAYS).unwrap()).await.unwrap();
        assert_eq!(load_settings(&pool).await.unwrap().days_off, ["sat", "sun"], "one rule: never all seven");
        crate::db::settings::set_setting(&pool, "goals.days_off", r#"["SUN","fri","someday"]"#).await.unwrap();

        let today = d("2026-09-23");
        let bad = [
            (GoalTargets { daily: 0, weekly: 25, days_off: vec![], karma_enabled: false }, "Daily goal must be a whole number from 1 to 100."),
            (GoalTargets { daily: 5, weekly: 701, days_off: vec![], karma_enabled: false }, "Weekly goal must be a whole number from 1 to 700."),
            (GoalTargets { daily: 5, weekly: 25, days_off: vec!["funday".into()], karma_enabled: false }, "Days off must be weekday names (mon to sun)."),
            (GoalTargets { daily: 5, weekly: 25, days_off: WEEKDAYS.map(String::from).to_vec(), karma_enabled: false }, "Leave at least one day that isn't a day off."),
        ];
        for (targets, msg) in bad {
            assert_eq!(save_goals_on(&pool, targets, today).await.unwrap_err().to_string(), msg);
        }
        assert_eq!(crate::db::settings::get_setting(&pool, "goals.weekly").await.unwrap(), None, "a bad save writes nothing");

        let s = save_goals_on(&pool, GoalTargets { daily: 3, weekly: 15, days_off: vec!["sun".into(), "sat".into()], karma_enabled: true }, today).await.unwrap();
        assert_eq!((s.daily_goal, s.weekly_goal, s.days_off.clone(), s.karma_enabled), (3, 15, vec!["sat".to_string(), "sun".to_string()], true));
        assert_eq!(s.karma_enabled_at.as_deref(), Some("2026-09-23"));
        let s = save_goals_on(&pool, GoalTargets { daily: 3, weekly: 15, days_off: vec![], karma_enabled: true }, d("2026-09-30")).await.unwrap();
        assert_eq!(s.karma_enabled_at.as_deref(), Some("2026-09-23"), "re-saving keeps the first enable date");
        // Off, then on again later: the backlog that crossed 5 days while it
        // was off is never penalized, so the enable date moves to the re-enable.
        save_goals_on(&pool, GoalTargets { daily: 3, weekly: 15, days_off: vec![], karma_enabled: false }, d("2026-10-01")).await.unwrap();
        let s = save_goals_on(&pool, GoalTargets { daily: 3, weekly: 15, days_off: vec![], karma_enabled: true }, d("2026-10-20")).await.unwrap();
        assert_eq!(s.karma_enabled_at.as_deref(), Some("2026-10-20"));
    }

    #[tokio::test]
    async fn pause_records_whole_days_and_resume_is_quiet() {
        let pool = test_pool().await;
        let at = |s: &str| NaiveDateTime::parse_from_str(s, STAMP).unwrap();
        let s = set_paused_at(&pool, true, at("2026-09-21 09:00:00")).await.unwrap();
        assert!(s.paused);
        assert_eq!(s.paused_at.as_deref(), Some("2026-09-21 09:00:00"));
        let s = set_paused_at(&pool, false, at("2026-09-23 10:00:00")).await.unwrap();
        assert!(!s.paused && s.paused_at.is_none());
        let pauses: Vec<String> = list_events(&pool).await.unwrap().into_iter().filter(|e| e.kind == "pause").map(|e| e.id).collect();
        assert_eq!(pauses, ["pause:2026-09-21", "pause:2026-09-22"]);
        set_paused_at(&pool, true, at("2026-09-24 09:00:00")).await.unwrap();
        set_paused_at(&pool, false, at("2026-09-24 17:00:00")).await.unwrap();
        assert_eq!(list_events(&pool).await.unwrap().iter().filter(|e| e.kind == "pause").count(), 2, "same-day pause leaves no row");
    }

    #[tokio::test]
    async fn evaluation_persists_once_and_does_nothing_while_paused() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.unwrap();
        for i in 0..5 {
            record_tx(&mut tx, &completion_event(&format!("t{i}"), 1, &format!("2026-09-23 1{i}:00:00")).unwrap()).await.unwrap();
        }
        tx.commit().await.unwrap();
        let today = d("2026-09-23");
        crate::db::settings::set_setting(&pool, "momentum.paused", "1").await.unwrap();
        crate::db::settings::set_setting(&pool, "momentum.paused_at", "2026-09-23 08:00:00").await.unwrap();
        assert_eq!(evaluate_at(&pool, today, today).await.unwrap(), EvaluateReport::default());
        crate::db::settings::set_setting(&pool, "momentum.paused", "0").await.unwrap();
        assert_eq!(evaluate_at(&pool, today, today).await.unwrap().goal_days, 1);
        assert_eq!(evaluate_at(&pool, today, today).await.unwrap(), EvaluateReport::default(), "idempotent");
    }
}
