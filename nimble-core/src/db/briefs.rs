//! Per-day morning-brief snapshots (spec 2026-09-23 §4.1/§4.5, phase 1).
//! Written once for today at first open, frozen afterwards except for the
//! priorities patch; synced through sync_log keyed by `date` like daily_state.

use sqlx::SqlitePool;

use crate::db::sync;
use crate::types::{Brief, Priority};

pub const LAYOUT_V1: [&str; 5] = ["schedule", "priorities", "due_today", "still_open", "vault"];
const SNAPSHOT_SCHEMA: i64 = 1;
const STILL_OPEN_SHOWN: usize = 5;
const TOMORROW_SHOWN: usize = 2;

type Row = (String, i64, String, String, String, String, i64, String, String);
const COLS: &str = "date, version, status, source, layout_json, snapshot_json, snapshot_schema, generated_at, updated_at";

fn to_brief(r: Row) -> Brief {
    Brief {
        date: r.0, version: r.1, status: r.2, source: r.3,
        layout: serde_json::from_str(&r.4).unwrap_or(serde_json::Value::Null),
        snapshot: serde_json::from_str(&r.5).unwrap_or(serde_json::Value::Null),
        snapshot_schema: r.6, generated_at: r.7, updated_at: r.8,
    }
}

pub async fn get_brief(pool: &SqlitePool, date: &str) -> crate::Result<Option<Brief>> {
    let row: Option<Row> = sqlx::query_as(&format!("SELECT {COLS} FROM briefs WHERE date = ?"))
        .bind(date).fetch_optional(pool).await?;
    Ok(row.map(to_brief))
}

pub async fn list_brief_dates(pool: &SqlitePool) -> crate::Result<Vec<String>> {
    Ok(sqlx::query_scalar("SELECT date FROM briefs ORDER BY date DESC").fetch_all(pool).await?)
}

/// The row as sync sees it: DB column names, JSON columns as text.
fn sync_snapshot(b: &Brief) -> String {
    serde_json::json!({
        "date": b.date, "version": b.version, "status": b.status, "source": b.source,
        "layout_json": b.layout.to_string(), "snapshot_json": b.snapshot.to_string(),
        "snapshot_schema": b.snapshot_schema, "generated_at": b.generated_at, "updated_at": b.updated_at,
    }).to_string()
}

fn task_ref(t: &crate::types::LocalTask) -> serde_json::Value {
    serde_json::json!({"id": t.id, "content": t.content, "due_date": t.due_date,
        "priority": t.priority, "project_id": t.project_id})
}

async fn priorities_for(pool: &SqlitePool, date: &str) -> Option<Vec<Priority>> {
    let json: Option<Option<String>> = sqlx::query_scalar("SELECT top_priorities FROM daily_state WHERE date = ?")
        .bind(date).fetch_optional(pool).await.ok()?;
    json.flatten().and_then(|j| serde_json::from_str(&j).ok())
}

async fn gather(pool: &SqlitePool, date: &str) -> crate::Result<serde_json::Value> {
    let events = crate::api::calendar::read_cached_events(pool, date).await.unwrap_or_default();
    let tomorrow_date = (chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| crate::Error::Other(e.to_string()))? + chrono::Duration::days(1))
        .format("%Y-%m-%d").to_string();
    let tomorrow: Vec<_> = crate::api::calendar::read_cached_events(pool, &tomorrow_date).await
        .unwrap_or_default().into_iter().filter(|e| !e.event.all_day).take(TOMORROW_SHOWN).collect();
    let tasks = crate::db::tasks::get_local_tasks(pool, None, Some(date), false).await?;
    let top: Vec<_> = tasks.iter().filter(|t| t.parent_id.is_none()).collect();
    let due_today: Vec<_> = top.iter().filter(|t| t.due_date.as_deref() == Some(date)).map(|t| task_ref(t)).collect();
    let mut still: Vec<_> = top.iter().filter(|t| t.due_date.as_deref().is_some_and(|d| d < date)).collect();
    still.sort_by(|a, b| a.due_date.cmp(&b.due_date));
    Ok(serde_json::json!({
        "schedule": {"events": events, "tomorrow": tomorrow},
        "priorities": priorities_for(pool, date).await,
        "due_today": due_today,
        "still_open": {"total": still.len(), "oldest": still.iter().take(STILL_OPEN_SHOWN).map(|t| task_ref(t)).collect::<Vec<_>>()},
    }))
}

/// Today's snapshot, written on first call. Past and future dates are only
/// ever read: a missing past brief stays missing (never fabricated from
/// today's data).
pub async fn ensure_snapshot(pool: &SqlitePool, date: &str, today: &str) -> crate::Result<Option<Brief>> {
    if let Some(b) = get_brief(pool, date).await? { return Ok(Some(b)); }
    if date != today { return Ok(None); }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let brief = Brief {
        date: date.into(), version: 1, status: "ready".into(), source: "nimble".into(),
        layout: serde_json::json!(LAYOUT_V1), snapshot: gather(pool, date).await?,
        snapshot_schema: SNAPSHOT_SCHEMA, generated_at: now.clone(), updated_at: now,
    };
    let inserted = sqlx::query(&format!("INSERT OR IGNORE INTO briefs ({COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"))
        .bind(&brief.date).bind(brief.version).bind(&brief.status).bind(&brief.source)
        .bind(brief.layout.to_string()).bind(brief.snapshot.to_string()).bind(brief.snapshot_schema)
        .bind(&brief.generated_at).bind(&brief.updated_at)
        .execute(pool).await?.rows_affected();
    if inserted == 1 {
        sync::append_sync_log(pool, "briefs", date, "INSERT", None, Some(&sync_snapshot(&brief))).await.ok();
    }
    get_brief(pool, date).await
}

/// Patch generated priorities into the day's snapshot. No row → no-op.
pub async fn set_priorities(pool: &SqlitePool, date: &str, priorities: &[Priority]) -> crate::Result<()> {
    let Some(mut b) = get_brief(pool, date).await? else { return Ok(()) };
    b.snapshot["priorities"] = serde_json::to_value(priorities).unwrap_or(serde_json::Value::Null);
    b.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE briefs SET snapshot_json = ?, updated_at = ? WHERE date = ?")
        .bind(b.snapshot.to_string()).bind(&b.updated_at).bind(date).execute(pool).await?;
    sync::append_sync_log(pool, "briefs", date, "UPDATE",
        Some(&serde_json::json!(["snapshot_json", "updated_at"]).to_string()), Some(&sync_snapshot(&b))).await.ok();
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, Priority};

    async fn task(pool: &sqlx::SqlitePool, content: &str, due: &str) -> String {
        crate::db::tasks::create_local_task(pool, CreateTaskInput {
            content: content.into(), due_date: Some(due.into()), ..Default::default()
        }).await.unwrap().id
    }

    async fn event(pool: &sqlx::SqlitePool, id: &str, date: &str, start: &str) {
        sqlx::query("INSERT INTO calendar_events (id, summary, start_time, end_time, all_day, date) VALUES (?, ?, ?, ?, 0, ?)")
            .bind(id).bind(format!("Event {id}")).bind(start).bind("23:59").bind(date)
            .execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn first_open_writes_one_snapshot_with_split_lists() {
        let pool = test_pool().await;
        for (c, d) in [("Oldest", "2026-08-01"), ("Older", "2026-09-10"), ("Today A", "2026-09-23")] {
            task(&pool, c, d).await;
        }
        event(&pool, "e1", "2026-09-23", "10:00").await;
        event(&pool, "e2", "2026-09-24", "09:00").await;
        let b = super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap().unwrap();
        assert_eq!(b.version, 1);
        assert_eq!(b.status, "ready");
        assert_eq!(b.layout, serde_json::json!(super::LAYOUT_V1));
        let s = &b.snapshot;
        assert_eq!(s["due_today"][0]["content"], "Today A");
        assert_eq!(s["still_open"]["total"], 2);
        assert_eq!(s["still_open"]["oldest"][0]["content"], "Oldest");
        assert_eq!(s["schedule"]["events"][0]["summary"], "Event e1");
        assert_eq!(s["schedule"]["tomorrow"][0]["summary"], "Event e2");
        assert!(s["priorities"].is_null());
        // Second open: same row, no second sync entry.
        super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap();
        let logs: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log WHERE table_name='briefs'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(logs, 1);
    }

    #[tokio::test]
    async fn past_and_future_dates_are_never_fabricated() {
        let pool = test_pool().await;
        assert!(super::ensure_snapshot(&pool, "2026-09-22", "2026-09-23").await.unwrap().is_none());
        assert!(super::ensure_snapshot(&pool, "2026-09-24", "2026-09-23").await.unwrap().is_none());
        assert!(super::list_brief_dates(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn snapshot_stays_frozen_when_tasks_change_later() {
        let pool = test_pool().await;
        let id = task(&pool, "Frozen", "2026-09-23").await;
        super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap();
        crate::db::tasks::update_task_status(&pool, &id, "complete", None).await.unwrap();
        let b = super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap();
        assert_eq!(b.snapshot["due_today"][0]["content"], "Frozen");
    }

    #[tokio::test]
    async fn priorities_patch_into_the_days_snapshot() {
        let pool = test_pool().await;
        super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap();
        let p = vec![Priority { title: "Ship".into(), source: "General".into(), reasoning: "Because".into() }];
        super::set_priorities(&pool, "2026-09-23", &p).await.unwrap();
        let b = super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap();
        assert_eq!(b.snapshot["priorities"][0]["title"], "Ship");
        let ops: Vec<String> = sqlx::query_scalar("SELECT operation FROM sync_log WHERE table_name='briefs' ORDER BY rowid")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(ops, ["INSERT", "UPDATE"]);
        // No row for the day → patch is a quiet no-op.
        super::set_priorities(&pool, "2026-09-20", &p).await.unwrap();
    }

    #[tokio::test]
    async fn dates_list_newest_first() {
        let pool = test_pool().await;
        super::ensure_snapshot(&pool, "2026-09-22", "2026-09-22").await.unwrap();
        super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap();
        assert_eq!(super::list_brief_dates(&pool).await.unwrap(), ["2026-09-23", "2026-09-22"]);
    }
}
