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
//! Known limit: complete → reopen → complete inside one wall-clock second
//! reuses the `completed_at` key, so the second completion isn't counted.

use chrono::{Local, NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};

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

/// A row that was complete (stamped `prior_completed_at`) is open again.
/// Reverses the original once, on the original's day. Nothing when there is
/// no original (e.g. completed before the ledger existed and never backfilled).
pub(crate) async fn on_reopened_tx(conn: &mut SqliteConnection, task_id: &str, prior_completed_at: Option<&str>) -> crate::Result<()> {
    let Some(stamp) = prior_completed_at else { return Ok(()) };
    let original_id = format!("task:{task_id}:{stamp}");
    let original: Result<Option<KarmaEvent>, sqlx::Error> =
        sqlx::query_as(&format!("SELECT {COLS} FROM karma_events WHERE id = ?"))
            .bind(&original_id).fetch_optional(&mut *conn).await;
    let original = match original {
        Ok(Some(o)) => o,
        Ok(None) => return Ok(()),
        Err(err) => {
            log::warn!("karma: reversal of {original_id} not read: {err}");
            return Ok(());
        }
    };
    let reversal = KarmaEvent {
        id: format!("un{original_id}"),
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

/// Every event, oldest day first (tests, `dt`, debugging).
pub async fn list_events(pool: &SqlitePool) -> crate::Result<Vec<KarmaEvent>> {
    Ok(sqlx::query_as(&format!("SELECT {COLS} FROM karma_events ORDER BY date, id")).fetch_all(pool).await?)
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
}
