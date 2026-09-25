//! Momentum summary + backfill (addendum 2026-09-25 §6). Today is Wednesday
//! 2026-09-23 (the week starts Mon 09-21); days off default to Sat + Sun.

use chrono::NaiveDate;
use nimble_core::db::karma::{self, BackfillReport, GoalTargets};
use nimble_core::test_util::test_pool;
use nimble_core::types::CreateTaskInput;
use sqlx::SqlitePool;

fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

async fn task(pool: &SqlitePool, content: &str, priority: i64) -> String {
    nimble_core::db::tasks::create_local_task(pool, CreateTaskInput { content: content.into(), priority: Some(priority), ..Default::default() })
        .await.unwrap().id
}

async fn insert_task(pool: &SqlitePool, id: &str) {
    sqlx::query("INSERT INTO local_tasks (id, content, project_id, priority) VALUES (?, ?, 'inbox', 1)")
        .bind(id).bind(id).execute(pool).await.unwrap();
}

async fn event(pool: &SqlitePool, id: &str, date: &str, kind: &str, points: i64, task_id: Option<&str>, at: &str) {
    sqlx::query("INSERT INTO karma_events (id, date, kind, points, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id).bind(date).bind(kind).bind(points).bind(task_id).bind(at).execute(pool).await.unwrap();
}

async fn done(pool: &SqlitePool, task_id: &str, at: &str, points: i64) {
    event(pool, &format!("task:{task_id}:{at}"), &at[..10], "task", points, Some(task_id), at).await;
}

async fn goal_rows(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM karma_events WHERE kind IN ('goal_day','goal_week')").fetch_one(pool).await.unwrap()
}

#[tokio::test]
async fn the_box_and_tiles_read_the_ledger() {
    let pool = test_pool().await;
    let draft = task(&pool, "Draft case study", 4).await;
    let call = task(&pool, "Call pharmacy", 1).await;
    let pay = task(&pool, "Pay Muni ticket", 3).await;
    let stretch = task(&pool, "Stretch", 1).await;
    let old = task(&pool, "Old win", 2).await;
    done(&pool, &draft, "2026-09-23 10:05:00", 2).await;
    done(&pool, &call, "2026-09-22 10:30:00", 1).await;
    done(&pool, &pay, "2026-09-21 16:40:00", 2).await;
    event(&pool, &format!("untask:{pay}:2026-09-21 16:40:00"), "2026-09-21", "untask", -2, Some(&pay), "2026-09-21 17:00:00").await;
    event(&pool, &format!("recur:{stretch}:2026-09-20"), "2026-09-20", "recur", 1, Some(&stretch), "2026-09-20 08:00:00").await;
    done(&pool, &old, "2026-09-10 23:58:00", 1).await;

    let s = karma::read_summary_at(&pool, "7d", d("2026-09-23")).await.unwrap();
    assert_eq!((s.today_done, s.week_done, s.week_start.as_str(), s.is_day_off), (1, 2, "2026-09-21", false));
    let trend: Vec<(&str, i64, bool)> = s.trend.iter().map(|t| (t.date.as_str(), t.done, t.day_off)).collect();
    assert_eq!(trend, [("2026-09-17", 0, false), ("2026-09-18", 0, false), ("2026-09-19", 0, true), ("2026-09-20", 1, true),
        ("2026-09-21", 0, false), ("2026-09-22", 1, false), ("2026-09-23", 1, false)]);
    let wins: Vec<&str> = s.wins.iter().map(|w| w.content.as_str()).collect();
    assert_eq!(wins, ["Draft case study", "Call pharmacy"], "a reversed task is no win; Stretch was last week");
    assert_eq!((s.stats.completed, s.stats.active_days, s.stats.peak_hour), (3, 3, Some(10)));
    assert_eq!(s.stats.from.as_deref(), Some("2026-09-17"));
    assert!(s.karma.is_none());
    let month = karma::read_summary_at(&pool, "30d", d("2026-09-23")).await.unwrap();
    assert_eq!(month.stats.completed, 4, "the 23:58 completion counts on its own local day");
    assert!(karma::read_summary_at(&pool, "90d", d("2026-09-23")).await.is_err());
}

#[tokio::test]
async fn missing_a_goal_changes_nothing_the_next_day() {
    // Yesterday (Tue 09-22) had 3 done. In the first profile the daily goal was
    // 5 all along (missed). In the second it was 3 when yesterday was evaluated
    // (met, bonus persisted), then set back to 5.
    let today = d("2026-09-23");
    let mut out = Vec::new();
    for met in [false, true] {
        let pool = test_pool().await;
        for i in 0..3 {
            let id = format!("t{i}");
            insert_task(&pool, &id).await;
            done(&pool, &id, &format!("2026-09-22 0{i}:00:00"), 1).await;
        }
        if met {
            let targets = |daily| GoalTargets { daily, weekly: 25, days_off: vec!["sat".into(), "sun".into()], karma_enabled: false };
            karma::save_goals_on(&pool, targets(3), d("2026-09-22")).await.unwrap();
            karma::evaluate_at(&pool, d("2026-09-22"), d("2026-09-22")).await.unwrap();
            karma::save_goals_on(&pool, targets(5), today).await.unwrap();
            assert_eq!(goal_rows(&pool).await, 1, "precondition: yesterday's goal was met and persisted");
        }
        out.push(serde_json::to_value(karma::read_summary_at(&pool, "7d", today).await.unwrap()).unwrap());
    }
    assert_eq!(out[0], out[1], "karma off: a met or missed yesterday leaves no trace in today's summary");
    let text = out[0].to_string();
    for word in ["streak", "penalt", "missed", "overdue", "goal_day"] {
        assert!(!text.contains(word), "{word} in {text}");
    }
}

#[tokio::test]
async fn pause_shows_paused_and_evaluates_no_goal() {
    let pool = test_pool().await;
    let today = d("2026-09-23");
    for i in 0..5 {
        let id = format!("t{i}");
        insert_task(&pool, &id).await;
        done(&pool, &id, &format!("2026-09-23 1{i}:00:00"), 1).await;
    }
    karma::set_paused_at(&pool, true, today.and_hms_opt(8, 0, 0).unwrap()).await.unwrap();
    let s = karma::momentum_summary_at(&pool, "7d", today).await.unwrap();
    assert!(s.settings.paused);
    assert!(s.trend.last().unwrap().paused);
    assert_eq!(goal_rows(&pool).await, 0);
    // Resume tomorrow: today stays a paused day and never earns a bonus later.
    karma::set_paused_at(&pool, false, d("2026-09-24").and_hms_opt(9, 0, 0).unwrap()).await.unwrap();
    karma::momentum_summary_at(&pool, "7d", d("2026-09-24")).await.unwrap();
    assert_eq!(goal_rows(&pool).await, 0);
}

#[tokio::test]
async fn reading_the_summary_persists_an_earned_goal_once() {
    let pool = test_pool().await;
    for i in 0..5 {
        let id = format!("t{i}");
        insert_task(&pool, &id).await;
        done(&pool, &id, &format!("2026-09-23 1{i}:00:00"), 1).await;
    }
    for _ in 0..2 {
        karma::momentum_summary_at(&pool, "7d", d("2026-09-23")).await.unwrap();
    }
    let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM karma_events WHERE kind = 'goal_day'").fetch_all(&pool).await.unwrap();
    assert_eq!(rows, ["goal:day:2026-09-23"]);
}

#[tokio::test]
async fn parity_mode_adds_total_level_and_streaks() {
    let pool = test_pool().await;
    karma::save_goals_on(&pool, GoalTargets { daily: 1, weekly: 25, days_off: vec!["sat".into(), "sun".into()], karma_enabled: true }, d("2026-09-01")).await.unwrap();
    for (i, day) in ["2026-09-21", "2026-09-22"].iter().enumerate() {
        let id = format!("t{i}");
        insert_task(&pool, &id).await;
        done(&pool, &id, &format!("{day} 09:00:00"), 1).await;
    }
    event(&pool, "seed", "2026-09-01", "task", 510, None, "2026-09-01 09:00:00").await; // older history
    let k = karma::momentum_summary_at(&pool, "7d", d("2026-09-23")).await.unwrap().karma.expect("parity on");
    // 510 + 2 completions + 2 daily bonuses (Mon, Tue at goal 1) = 518.
    assert_eq!((k.total, k.level.as_str(), k.next_level_at), (518, "Novice", Some(2_500)));
    assert_eq!((k.daily_streak, k.weekly_streak), (2, 0));
}

#[tokio::test]
async fn focused_time_counts_sessions_by_their_local_start_day() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO focus_occurrences (id, task_id, original_task_id, title_snapshot, generation, state, created_at) VALUES ('o1', NULL, 't1', 'Deep work', 1, 'open', '2026-09-20T00:00:00Z')")
        .execute(&pool).await.unwrap();
    // 2026-09-23T05:30Z at UTC-7 is 22:30 on the 22nd (inside 7d); the August session only counts in "all".
    for (id, start, ms) in [("s1", "2026-09-23T05:30:00+00:00", 3_600_000i64), ("s2", "2026-08-01T17:00:00+00:00", 1_200_000)] {
        sqlx::query("INSERT INTO focus_sessions (id, occurrence_id, owner_device_id, owner_epoch, status, mode, config_json, timezone_offset_minutes, work_ms, started_at) VALUES (?, 'o1', 'dev', 'e', 'ended', 'count_up', '{}', -420, ?, ?)")
            .bind(id).bind(ms).bind(start).execute(&pool).await.unwrap();
    }
    let week = karma::read_summary_at(&pool, "7d", d("2026-09-23")).await.unwrap();
    let all = karma::read_summary_at(&pool, "all", d("2026-09-23")).await.unwrap();
    assert_eq!((week.stats.focused_ms, all.stats.focused_ms), (3_600_000, 4_800_000));
    assert_eq!((week.stats.peak_hour, all.stats.from), (None, None));
}

#[tokio::test]
async fn backfill_rebuilds_history_once() {
    let pool = test_pool().await;
    let local = task(&pool, "Local stamp", 3).await;
    let utc = task(&pool, "Imported stamp", 1).await;
    let repeat = task(&pool, "Water plants", 1).await;
    task(&pool, "Still open", 1).await;
    for (id, at) in [(&local, "2026-09-22 09:15:00"), (&utc, "2026-09-21T16:00:00Z")] {
        sqlx::query("UPDATE local_tasks SET status='complete', completed=1, completed_at=? WHERE id=?")
            .bind(at).bind(id).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO activity_log (id, action_type, target_id, metadata, created_at) VALUES ('a1', 'task_recurred', ?, ?, '2026-09-20 07:45:00')")
        .bind(&repeat).bind(r#"{"content":"Water plants","from":"2026-09-20","to":"2026-09-21"}"#)
        .execute(&pool).await.unwrap();
    let first = karma::backfill_at(&pool, d("2026-09-23")).await.unwrap();
    assert_eq!((first.tasks, first.recurrences), (2, 1));
    let e = karma::list_events(&pool).await.unwrap();
    let row = e.iter().find(|x| x.task_id.as_deref() == Some(local.as_str())).unwrap();
    assert_eq!((row.id.clone(), row.points), (format!("task:{local}:2026-09-22 09:15:00"), 2));
    assert!(e.iter().any(|x| x.id == format!("recur:{repeat}:2026-09-20") && x.date == "2026-09-20"));
    assert_eq!(karma::backfill_at(&pool, d("2026-09-23")).await.unwrap(), BackfillReport::default(), "a rerun adds nothing");
}
