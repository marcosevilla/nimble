//! Per-day morning-brief snapshots (phase 1 storage; phase 2 gathers through crate::brief).
//! Written once for today at first open, frozen afterwards except for the
//! priorities patch; synced through sync_log keyed by `date` like daily_state.

use sqlx::SqlitePool;

use crate::db::sync;
use crate::types::{Brief, Priority};

const SNAPSHOT_SCHEMA: i64 = 1;

type Row = (String, i64, String, String, String, String, i64, Option<String>, String, String);
const COLS: &str = "date, version, status, source, layout_json, snapshot_json, snapshot_schema, notes, generated_at, updated_at";
const NOTES_MAX: usize = 20_000;

fn to_brief(r: Row) -> Brief {
    Brief {
        date: r.0, version: r.1, status: r.2, source: r.3,
        layout: serde_json::from_str(&r.4).unwrap_or(serde_json::Value::Null),
        snapshot: serde_json::from_str(&r.5).unwrap_or(serde_json::Value::Null),
        snapshot_schema: r.6, notes: r.7, generated_at: r.8, updated_at: r.9,
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

/// The row as sync sees it: DB column names, JSON columns as text. Every
/// synced column is present — receivers upsert what they are sent.
fn sync_snapshot(b: &Brief) -> String {
    serde_json::json!({
        "date": b.date, "version": b.version, "status": b.status, "source": b.source,
        "layout_json": b.layout.to_string(), "snapshot_json": b.snapshot.to_string(),
        "snapshot_schema": b.snapshot_schema, "notes": b.notes,
        "generated_at": b.generated_at, "updated_at": b.updated_at,
    }).to_string()
}

/// Today's scratchpad (the `notes` module). Past days are read-only; the
/// first write of the day also writes the day's snapshot. Blank clears.
pub async fn set_notes(pool: &SqlitePool, date: &str, today: &str, notes: &str) -> crate::Result<()> {
    if date != today { return Err(crate::Error::Other("notes_read_only".into())); }
    if notes.chars().count() > NOTES_MAX { return Err(crate::Error::Other("notes_too_long".into())); }
    let Some(mut b) = ensure_snapshot(pool, date, today).await? else { return Err(crate::Error::Other("no_brief".into())) };
    b.notes = if notes.trim().is_empty() { None } else { Some(notes.to_string()) };
    b.updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE briefs SET notes = ?, updated_at = ? WHERE date = ?")
        .bind(&b.notes).bind(&b.updated_at).bind(date).execute(pool).await?;
    sync::append_sync_log(pool, "briefs", date, "UPDATE",
        Some(&serde_json::json!(["notes", "updated_at"]).to_string()), Some(&sync_snapshot(&b))).await.ok();
    Ok(())
}

/// Today's snapshot, written on first call from the enabled modules in
/// `brief.modules` order. Past and future dates are only ever read: a
/// missing past brief stays missing (never fabricated from today's data).
pub async fn ensure_snapshot(pool: &SqlitePool, date: &str, today: &str) -> crate::Result<Option<Brief>> {
    if let Some(b) = get_brief(pool, date).await? { return Ok(Some(b)); }
    if date != today { return Ok(None); }
    let layout = crate::brief::settings::load_layout(pool).await?;
    let (snapshot, partial) = crate::brief::gather_snapshot(&crate::brief::BriefCtx { pool, date }, &layout).await;
    let used: Vec<_> = layout.into_iter().filter(|e| e.enabled).collect();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let brief = Brief {
        date: date.into(), version: 1, status: if partial { "partial" } else { "ready" }.into(), source: "nimble".into(),
        layout: serde_json::json!(used), snapshot,
        snapshot_schema: SNAPSHOT_SCHEMA, notes: None, generated_at: now.clone(), updated_at: now,
    };
    let inserted = sqlx::query(&format!("INSERT OR IGNORE INTO briefs ({COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"))
        .bind(&brief.date).bind(brief.version).bind(&brief.status).bind(&brief.source)
        .bind(brief.layout.to_string()).bind(brief.snapshot.to_string()).bind(brief.snapshot_schema)
        .bind(&brief.notes).bind(&brief.generated_at).bind(&brief.updated_at)
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

/// Fill one module's payload if that morning recorded it empty (key
/// present, value JSON null). An absent key means the module was off; a
/// filled one stays frozen. Atomic in SQL. Returns whether it wrote.
pub async fn patch_snapshot_if_null(pool: &SqlitePool, date: &str, key: &str, value: serde_json::Value) -> crate::Result<bool> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(crate::Error::Other(format!("invalid snapshot key: {key}")));
    }
    let path = format!("$.{key}");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let changed = sqlx::query(
        "UPDATE briefs SET snapshot_json = json_set(snapshot_json, ?, json(?)), updated_at = ?
         WHERE date = ? AND json_type(snapshot_json, ?) = 'null'",
    )
    .bind(&path).bind(value.to_string()).bind(&now).bind(date).bind(&path)
    .execute(pool).await?
    .rows_affected();
    if changed == 0 { return Ok(false); }
    if let Some(b) = get_brief(pool, date).await? {
        sync::append_sync_log(pool, "briefs", date, "UPDATE",
            Some(&serde_json::json!(["snapshot_json", "updated_at"]).to_string()), Some(&sync_snapshot(&b))).await.ok();
    }
    Ok(true)
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
        // (replaces the LAYOUT_V1 assertion)
        let ids: Vec<&str> = b.layout.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["weather", "schedule", "priorities", "due_today", "still_open", "vault"]);
        let mut keys: Vec<&String> = b.snapshot.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["due_today", "priorities", "schedule", "still_open", "vault", "weather"]);
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

    #[tokio::test]
    async fn snapshot_follows_brief_modules() {
        let pool = test_pool().await;
        for (c, d) in [("A", "2026-06-01"), ("B", "2026-07-01"), ("C", "2026-08-01"), ("D", "2026-09-01"), ("Today", "2026-09-23")] {
            task(&pool, c, d).await;
        }
        crate::db::settings::set_setting(&pool, "brief.modules",
            r#"[{"id":"due_today","enabled":true,"config":{}},{"id":"schedule","enabled":false,"config":{}},
                {"id":"still_open","enabled":true,"config":{"count":3}}]"#).await.unwrap();
        let b = super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap().unwrap();
        let ids: Vec<&str> = b.layout.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["due_today", "still_open", "weather", "priorities", "vault"], "stored order, then enabled defaults");
        assert_eq!(b.layout[1]["config"]["count"], 3, "the layout records the config used");
        assert!(b.snapshot.get("schedule").is_none(), "a hidden module is not gathered");
        assert_eq!(b.snapshot["still_open"]["total"], 4);
        assert_eq!(b.snapshot["still_open"]["oldest"].as_array().unwrap().len(), 3);
        assert_eq!(b.snapshot["due_today"][0]["content"], "Today");
    }

    #[tokio::test]
    async fn habits_payload_marks_the_days_check_ins() {
        let pool = test_pool().await;
        for (id, name, active, pos) in [("h1", "Stretch", 1, 0), ("h2", "Read", 1, 1), ("h3", "Old", 0, 2)] {
            sqlx::query("INSERT INTO habits (id, name, active, position) VALUES (?, ?, ?, ?)")
                .bind(id).bind(name).bind(active).bind(pos).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO habit_logs (id, habit_id, date) VALUES ('l1', 'h1', '2026-09-23')").execute(&pool).await.unwrap();
        crate::db::settings::set_setting(&pool, "brief.modules", r#"[{"id":"habits","enabled":true,"config":{}}]"#).await.unwrap();
        let b = super::ensure_snapshot(&pool, "2026-09-23", "2026-09-23").await.unwrap().unwrap();
        let h = b.snapshot["habits"].as_array().unwrap();
        assert_eq!(h.len(), 2, "inactive habits are left out");
        assert_eq!((h[0]["name"].as_str(), h[0]["done"].as_bool()), (Some("Stretch"), Some(true)));
        assert_eq!((h[1]["name"].as_str(), h[1]["done"].as_bool()), (Some("Read"), Some(false)));
    }

    #[tokio::test]
    async fn notes_save_for_today_and_sync() {
        let pool = test_pool().await;
        super::set_notes(&pool, "2026-09-23", "2026-09-23", "Call the venue").await.unwrap();
        let b = super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap();
        assert_eq!(b.notes.as_deref(), Some("Call the venue"), "the first write also creates the day's snapshot");
        let snap: String = sqlx::query_scalar("SELECT snapshot FROM sync_log WHERE table_name='briefs' AND operation='UPDATE'")
            .fetch_one(&pool).await.unwrap();
        assert!(snap.contains("Call the venue"), "the sync snapshot carries notes (receivers would null an omitted column)");
        super::set_notes(&pool, "2026-09-23", "2026-09-23", "   ").await.unwrap();
        assert!(super::get_brief(&pool, "2026-09-23").await.unwrap().unwrap().notes.is_none(), "blank clears");
    }

    #[tokio::test]
    async fn notes_are_read_only_on_other_days() {
        let pool = test_pool().await;
        super::ensure_snapshot(&pool, "2026-09-22", "2026-09-22").await.unwrap();
        assert!(super::set_notes(&pool, "2026-09-22", "2026-09-23", "late").await.is_err());
        assert!(super::set_notes(&pool, "2026-09-23", "2026-09-23", &"x".repeat(20_001)).await.is_err());
    }
}
