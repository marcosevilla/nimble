# Morning Brief Phase 1 (Brief Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Today's two-step review with an always-expanded brief made of fixed containers (Schedule, Top priorities, Due today, Still open, From your vault). Add a manual compact toggle, a frozen per-day snapshot in a new synced `briefs` table (v23), and past-date browsing. Wire the page to `useLocalToday` so a new day refreshes everything (loop-2 decision 6).

**Architecture:** Rust owns the snapshot. `nimble-core/src/db/briefs.rs` gathers the day's cached events, open tasks and cached priorities into one JSON snapshot, which is written once per day at first open and synced through `sync_log` like `daily_state` (keyed by `date`). When priorities are generated later, they are patched into that day's snapshot. The frontend renders live data for today and the frozen snapshot for past dates. Pure helpers live in `lib/todayBrief.ts` (tested), and each container is its own small component under `components/today/`.

**Tech Stack:** Rust (nimble-core, sqlx, tokio tests), Tauri 2 commands, React 19 + TS, `node:test`, `tools/mock-tauri.js`, Turso HTTP reads for the web.

**Spec:** `docs/superpowers/specs/2026-09-23-morning-brief-design.md`. **§0 overrides §3–§5**: no review mode, no "Start my day" button, no `review_completed_at`, no energy anywhere, and the compact toggle is manual and persisted. NEXT.md decision (6) is in scope.

**Branch/worktree:** `feat/brief-phase-1` in `.claude/worktrees/brief-phase-1`, from `main` (`bb6ac53`).

## Scope decisions (for Marco's review)

| Topic | Decision | Why |
|---|---|---|
| Containers in phase 1 | Schedule, Top priorities, Due today, Still open, From your vault, in that fixed order (`TODAY_LAYOUT`). Weather, header summary, Quick wins, Momentum and Needs attention come in later phases. | Spec §5 phase 1 row. |
| No review mode | `ReviewMode`, `ReviewStep` and `reviewEnterAction` (plus their tests) are deleted. Today always opens on the brief. | §0 Q3 |
| Compact toggle | `b` or the chevron collapses **Schedule + Top priorities** into a one-row strip (next event · the 3 priorities). Due today, Still open and Vault stay. The toggle persists per device in `localStorage` (`nimble.todayCompact`) and never resets on a new day. | §0 Q3; the persistence convention is `layoutStore`'s. It is per device because it's a view preference. |
| Energy | Removed from the UI, the prompt and the DataProvider signature. `generate_priorities` no longer takes or writes energy. The `daily_state.energy_level` column stays, unwritten. The prompt now infers load from the calendar. | §0 Q4 |
| Priorities | Auto-generate once per day on first open if there are no cached priorities for today. With no AI key, a calm line replaces the list, with no toast and no retry loop. On any other failure: "Try again". Rows stay read-only cards. **No checkboxes in phase 1**, because a `Priority` is free text with no task id. Linked, checkable items arrive with `brief_items` in phase 3. | Keeps phase 1 honest about the data. |
| Snapshot timing | Written for **today only**, once the calendar and task list have both loaded (so a first open after launch stores fresh events, not an empty cache). It is never back-filled for past dates, and never written for the future. Priorities patch into it when they are generated. | §4.5; exit test "yesterday renders from its snapshot after its tasks change". |
| Still open | 5 oldest open tasks due before today (top level only), with grey age tags (`3d`, `2w`, `4mo`) and a total count. The "move 60+ day items to Someday" line is **deferred**: no Someday action exists yet. | Avoids a suggestion with no button behind it. |
| Schedule | Today's events plus a "Tomorrow" peek (first 2 timed events, from the calendar cache) and the largest free block between 09:00 and 18:00 (for today only, from now on). | §3.2 #2. The free block is computed in the frontend for both live and snapshot, so there's one implementation. |
| Past dates | The date control moves to the page header, and `[` / `]` step through days. A past date shows its snapshot read-only if one exists. Otherwise it shows the vault brief (`BriefDisplay`, "From your vault"). Otherwise: "No brief for this day." | §3.7 |
| Web | `brief.get` / `brief.listDates` read Turso. `ensureSnapshot` resolves `null` (the web never writes briefs). The rest of the web Today page is unchanged (dailyState is still unsupported there). | §3.7 last bullet |
| Settings | None in phase 1. `TodayBriefSettings.tsx` arrives with phase 2. | Lane rule |

**Lane boundaries:** touches only Rust, the v23 migration, TodayPage and `components/today/*`, `components/priorities/PrioritiesSection.tsx` (deleted; Today is its only user), `lib/keyGuard.ts` (removes `reviewEnterAction`, adds `todayKey`), `lib/shortcuts.ts` (**append-only**: a new `Today` section at the end), `packages/types`, `services/tauri*.ts`, `services/turso*`, and `tools/mock-tauri.js`. SettingsPage, InboxPage, CommandBar*, NavSidebar, ProjectSidebar, FolderTree, useTaskNavigation and NEXT.md are not touched.

## Global Constraints

- Migration v23 is one statement per `;` (the runner splits on `;`). Mobile mirror skipped (dormant).
- `CURRENT_SCHEMA_VERSION` 22 → 23 breaks exact pins. Known pins: `tests/schema22_origin_label.rs:30`, `tests/focus_schema.rs:72`, `tests/schema20_compatibility.rs:371`, `tests/backup_export.rs:35`, `tests/focus_backup.rs:31`, `src/db/backup.rs:298`, `export_policy.rs:58,96`. The installed `dt` needs a rebuild after the app update (`tools/dt/src/profile.rs:43` pins the version exactly). Note this in the wrap.
- API calls happen only in Rust. The frontend never touches SQLite. New commands follow the 6-step "Adding a Rust Command" recipe in `nimble/CLAUDE.md`.
- No spinners: skeletons shaped like the content. No guilt copy: "Still open", never "overdue"; empty states are calm single lines.
- `cn()` for classes. Typography via `components/shared/typography` tokens. No new npm or Cargo dependencies.
- The `components/**` ESLint rule bans `@/services/tauri` imports. Go through `useDataProvider()`.
- Tests: `cargo test --workspace --offline`, `node --test apps/desktop/tests/*.test.mjs` (from `nimble/`), `cd apps/desktop && npm run build && npm run build:web`.

## Review Focus

1. **Midnight with Today open** (or the Mac waking the next morning): the page must switch to the new date. That means a new snapshot, the new day's cached priorities (or a new generation), the greeting, and a calendar that follows. Not yesterday's lists under today's title. Pinned by `useLocalToday` dependencies in Task 7 plus the real-app check in Task 9.
2. **First open with the network down:** the calendar falls back to its cache, the snapshot still gets written, and nothing shows a spinner. Pinned in Task 2 (the snapshot reads only the cache) and Task 9.
3. **No Anthropic key:** Top priorities shows a calm line, fires no toast, and doesn't re-call on every render or navigation. Pinned in Task 6 (`shouldAutoGenerate`).
4. **A past date with no snapshot and no vault file:** "No brief for this day.", never an error or an endless skeleton. Pinned in Task 8.
5. **`b`, `[` or `]` typed in the quick-add field, a dialog or the command bar:** must not toggle or navigate. Pinned in Task 6 (`todayKey` tests).

---

### Task 1: v23 migration, the `briefs` table and the version pins

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append v23, bump the constant, add a test module)
- Modify: `nimble-core/src/db/export_policy.rs` (v23 policy with `briefs`)
- Modify: `nimble-core/src/db/backup.rs:298`
- Modify: `nimble-core/tests/{schema22_origin_label,focus_schema,schema20_compatibility,backup_export,focus_backup}.rs` (pins 22 → 23)

**Interfaces:**
- Produces: table `briefs(date TEXT PK, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK(...), source TEXT NOT NULL DEFAULT 'nimble', layout_json TEXT NOT NULL, snapshot_json TEXT NOT NULL, snapshot_schema INTEGER NOT NULL, energy_level TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, error_code TEXT, notes TEXT, generated_at TEXT NOT NULL, updated_at TEXT NOT NULL)`; `CURRENT_SCHEMA_VERSION = 23`.

- [ ] **Step 1: Write the failing test** (append to `migrations.rs`)

```rust
#[cfg(test)]
mod v23_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v23_creates_the_briefs_table() {
        let pool = test_pool().await;
        let cols: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('briefs') ORDER BY cid")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(cols, ["date","version","status","source","layout_json","snapshot_json","snapshot_schema",
            "energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]);
        assert_eq!(super::CURRENT_SCHEMA_VERSION, 23);
    }
}
```

- [ ] **Step 2:** `cargo test --offline -p nimble-core --lib v23_tests`. Expected: FAIL (no columns; the constant is 22).

- [ ] **Step 3: Append the migration**, after the v22 entry, and bump the constant to `23`:

```rust
    Migration {
        version: 23,
        description: "Morning brief snapshots",
        sql: "CREATE TABLE IF NOT EXISTS briefs (
            date TEXT PRIMARY KEY,
            version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL CHECK(status IN ('ready','partial','fallback','failed')),
            source TEXT NOT NULL DEFAULT 'nimble',
            layout_json TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            snapshot_schema INTEGER NOT NULL,
            energy_level TEXT,
            model TEXT,
            input_tokens INTEGER,
            output_tokens INTEGER,
            error_code TEXT,
            notes TEXT,
            generated_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
    },
```

- [ ] **Step 4:** Run `cargo test --offline -p nimble-core --lib v23_tests` → PASS. Then `cargo test --workspace --offline 2>&1 | grep -E "panicked|FAILED" -A3`. Expected failures: the version pins and the export `table_drift` check.

- [ ] **Step 5: Update the pins and the policy.**
  - `22` → `23` at the five test lines listed in Global Constraints.
  - `backup.rs:298`: `19 | 20 | 21 | 22 | 23`.
  - `export_policy.rs`:
    - Update the doc comment above `tables_for_version` with the line `/// V23 adds the reviewed, included `briefs` table (per-day brief snapshots).`
    - `if version != 20 && version != 21 && version != 22 && version != 23 { return None; }`
    - `if version == 22 {` → `if version >= 22 {`
    - Before `tables.sort_by_key`, add:

```rust
    if version >= 23 {
        tables.push(table!("briefs"; ["date","version","status","source","layout_json","snapshot_json","snapshot_schema","energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]; ["date","version","status","source","layout_json","snapshot_json","snapshot_schema","energy_level","model","input_tokens","output_tokens","error_code","notes","generated_at","updated_at"]; ["date"]));
    }
```

  Any **other** pin the suite reveals is the same kind of edit. List each one in the ledger.

- [ ] **Step 6:** `cargo test --workspace --offline` → all PASS. Commit: `feat(brief): v23 briefs table + export policy`.

---

### Task 2: `db/briefs.rs`: snapshot gather, get, list, priorities patch

**Files:**
- Create: `nimble-core/src/db/briefs.rs` (and `pub mod briefs;` in `db/mod.rs`)
- Modify: `nimble-core/src/types.rs` (add `Brief`)

**Interfaces:**
- Consumes: `api::calendar::read_cached_events(pool, date) -> Result<Vec<CalendarEventWithFeed>>`; `db::tasks::get_local_tasks(pool, None, Some(date), false)` (due on or before, open; pinned by the Rust batch); `sync::append_sync_log`.
- Produces:

```rust
// types.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Brief {
    pub date: String,
    pub version: i64,
    pub status: String,
    pub source: String,
    pub layout: serde_json::Value,     // ["schedule","priorities","due_today","still_open","vault"]
    pub snapshot: serde_json::Value,   // BriefSnapshotV1 (see below)
    pub snapshot_schema: i64,          // 1
    pub generated_at: String,
    pub updated_at: String,
}
// briefs.rs
pub const LAYOUT_V1: [&str; 5] = ["schedule", "priorities", "due_today", "still_open", "vault"];
pub async fn get_brief(pool: &SqlitePool, date: &str) -> crate::Result<Option<Brief>>;
pub async fn list_brief_dates(pool: &SqlitePool) -> crate::Result<Vec<String>>; // newest first
pub async fn ensure_snapshot(pool: &SqlitePool, date: &str, today: &str) -> crate::Result<Option<Brief>>;
pub async fn set_priorities(pool: &SqlitePool, date: &str, priorities: &[Priority]) -> crate::Result<()>;
```

Snapshot v1 shape (task refs are `{id, content, due_date, priority, project_id}`):

```json
{"schedule":{"events":[CalendarEventWithFeed…],"tomorrow":[≤2 timed events]},
 "priorities":[Priority…] | null,
 "due_today":[TaskRef…],
 "still_open":{"total":N,"oldest":[≤5 TaskRef, oldest due first]}}
```

- [ ] **Step 1: Write the failing tests** (in `briefs.rs`, `#[cfg(test)] mod tests`)

```rust
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
```

If the `calendar_events` insert fails on a NOT NULL column that `read_cached_events` expects (`feed_label`, `feed_color`, `fetched_at`), add the missing columns to the test insert. Don't change `read_cached_events`.

- [ ] **Step 2:** `cargo test --offline -p nimble-core --lib briefs::tests`. Expected: a compile error (module missing).

- [ ] **Step 3: Implement.** Add `Brief` to `types.rs` as in Interfaces. Create `briefs.rs`:

```rust
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
```

Check `CalendarEventWithFeed.event.all_day`'s field path against `parsers::ical::CalendarEvent`. If it differs, follow the struct.

- [ ] **Step 4:** `cargo test --offline -p nimble-core --lib briefs::tests` → 5 PASS.
- [ ] **Step 5:** Commit: `feat(brief): per-day snapshot gather, read and priorities patch`.

---

### Task 3: Priorities without energy, patched into the brief

**Files:**
- Modify: `nimble-core/src/api/anthropic.rs` (extract `priorities_prompt`, drop energy)
- Modify: `nimble-core/src/db/daily_state.rs` (`save_priorities` without energy; patch the brief)
- Modify: `apps/desktop/src-tauri/src/commands/priorities.rs`
- Modify: `apps/desktop/src/services/tauri.ts:228-240`, `packages/types/src/data-provider.ts:313`, `tools/mock-tauri.js:1082` (the args are ignored there; no change is needed, but check)

**Interfaces:**
- Produces:
  - `pub fn priorities_prompt(calendar_summary: &str, tasks_summary: &str, obsidian_summary: &str) -> String`
  - `generate_priorities(api_key, calendar, tasks, obsidian)`
  - `save_priorities(pool, &[Priority])`
  - TS: `generatePriorities(calendarSummary, tasksSummary, obsidianSummary): Promise<Priority[]>`

- [ ] **Step 1: Failing tests.** In `anthropic.rs`:

```rust
#[cfg(test)]
mod prompt_tests {
    #[test]
    fn priorities_prompt_infers_load_from_the_calendar_not_energy() {
        let p = super::priorities_prompt("10:00–11:00: Call", "- Ship", "none");
        assert!(!p.to_lowercase().contains("energy"), "{p}");
        assert!(p.contains("packed calendar"));
        assert!(p.contains("10:00–11:00: Call") && p.contains("- Ship"));
    }
}
```

In `daily_state.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::types::Priority;

    #[tokio::test]
    async fn saving_priorities_patches_todays_brief_and_leaves_energy_alone() {
        let pool = crate::test_util::test_pool().await;
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        crate::db::briefs::ensure_snapshot(&pool, &today, &today).await.unwrap();
        let p = vec![Priority { title: "One".into(), source: "General".into(), reasoning: "r".into() }];
        super::save_priorities(&pool, &p).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, &today).await.unwrap().unwrap();
        assert_eq!(b.snapshot["priorities"][0]["title"], "One");
        assert_eq!(super::get_daily_state(&pool).await.unwrap().priorities.unwrap()[0].title, "One");
    }
}
```

(Nothing asserts the energy column: after this change nothing binds it, and the compiler enforces that through the new signature.)

- [ ] **Step 2:** `cargo test --offline -p nimble-core --lib prompt_tests daily_state::tests` → compile FAIL (signatures).

- [ ] **Step 3: Implement.**
  - In `anthropic.rs`, move the `format!` body into `pub fn priorities_prompt(...)` and replace the three energy lines with:

```text
Infer how much today can hold from the calendar: a packed calendar means lighter, smaller priorities; an open day can take deeper, harder work.
```

  - `generate_priorities(api_key, calendar_summary, tasks_summary, obsidian_summary)` calls `priorities_prompt(...)`.
  - `save_priorities(pool, priorities)`: `INSERT INTO daily_state (date, top_priorities, first_opened_at) VALUES (?, ?, datetime('now')) ON CONFLICT(date) DO UPDATE SET top_priorities = excluded.top_priorities`.
  - Activity metadata becomes `{"count": n}`. The sync snapshot becomes `{"date", "top_priorities"}` with changed columns `["top_priorities"]`.
  - Then `crate::db::briefs::set_priorities(pool, &today, priorities).await.ok();` (fire-and-forget: priorities are saved even if the patch fails).
  - The Tauri command drops the `energy_level` param. `tauri.ts`: `generatePriorities(calendarSummary, tasksSummary, obsidianSummary)` invokes with those three keys. `data-provider.ts`: same signature. `turso-provider.ts` stays `ni`.

- [ ] **Step 4:** `cargo test --workspace --offline` → PASS.

- [ ] **Step 5:** Commit: `feat(brief): priorities drop energy and patch into the day's brief`. The frontend caller changes in Task 7; the TS build may fail until then. Run `npm run build` only at the end of Task 7.

---

### Task 4: Sync for `briefs`

**Files:** `nimble-core/src/db/sync.rs` (allowlist, `conflict_target`, remote DDL, v23 gate and its call sites, tests)

- [ ] **Step 1: Failing tests** (in the existing sync test module that holds `v19_tables_are_allowed_for_sync`)

```rust
    #[test]
    fn briefs_sync_by_date() {
        assert!(super::sanitize_table_name("briefs").is_ok());
        let sql = super::build_snapshot_upsert_sql("briefs", &["date", "snapshot_json"]);
        assert!(sql.contains("ON CONFLICT(date) DO UPDATE SET snapshot_json = excluded.snapshot_json"), "got {sql}");
    }

    #[tokio::test]
    async fn a_pulled_brief_lands_and_reads_back() {
        let pool = test_pool().await;
        let snap = serde_json::json!({"date":"2026-09-22","version":1,"status":"ready","source":"nimble",
            "layout_json":"[\"schedule\"]","snapshot_json":"{\"priorities\":null}","snapshot_schema":1,
            "generated_at":"2026-09-22 07:00:00","updated_at":"2026-09-22 07:00:00"}).to_string();
        super::apply_remote_change(&pool, "briefs", "2026-09-22", "INSERT", Some(&snap)).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, "2026-09-22").await.unwrap().unwrap();
        assert_eq!(b.layout, serde_json::json!(["schedule"]));
    }
```

- [ ] **Step 2:** `cargo test --offline -p nimble-core --lib briefs_sync_by_date a_pulled_brief` → FAIL ("not allowed for sync").

- [ ] **Step 3: Implement.**
  - Add `"briefs",` to `ALLOWED`.
  - `conflict_target`: `"daily_state" | "briefs" => "date",`.
  - In `initialize_remote`'s `create_statements`, after daily_state, add the same `CREATE TABLE IF NOT EXISTS briefs (...)` DDL as Task 1, without the CHECK constraint (remote tables stay permissive, like the others).
  - Add a gate:

```rust
async fn ensure_remote_v23_schema(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let done: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='turso_schema_v23_upgraded'")
        .fetch_optional(pool).await?;
    if done.is_some() { return Ok(()); }
    let requests = [
        turso_execute(REMOTE_BRIEFS_DDL, vec![]),
        serde_json::json!({"type":"close"}),
    ];
    let body = turso_pipeline(turso_url, turso_token, requests.to_vec()).await?;
    check_pipeline_statement_errors(&body, "Turso v23 schema upgrade", true)?;
    sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('turso_schema_v23_upgraded','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')")
        .execute(pool).await?;
    Ok(())
}
```

  - Define `const REMOTE_BRIEFS_DDL: &str = "CREATE TABLE IF NOT EXISTS briefs (...)";` once and use it in both the fresh DDL list and the gate.
  - Call the gate after every `ensure_remote_v22_schema` call: the already-initialized branch and the push preamble, where it warns and continues exactly like v22. Also call it after `ensure_remote_v21_schema` at the end of the fresh-init path (the fresh DDL already has the table; the gate just latches the setting).
  - Seeding (`seed_existing_data`): **not extended**. Every `briefs` row is written after v23 and logs itself, so there's nothing pre-existing to backfill.

- [ ] **Step 4:** `cargo test --workspace --offline` → PASS.
- [ ] **Step 5:** Commit: `feat(brief): sync briefs by date with a v23 remote gate`.

---

### Task 5: Commands, types, providers and mock

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/brief.rs`. Modify `commands/mod.rs`, and `lib.rs` (the `use` list and `generate_handler!`).
- Modify: `packages/types/src/index.ts` (types), `packages/types/src/data-provider.ts` (the `brief` domain)
- Modify: `apps/desktop/src/services/tauri.ts`, `tauri-provider.ts`, `turso-provider.ts`
- Create: `apps/desktop/src/services/turso/briefs.ts`
- Modify: `tools/mock-tauri.js`

**Interfaces:**
- Produces (TS):

```ts
// packages/types/src/index.ts
export interface BriefTaskRef { id: string; content: string; due_date: string | null; priority: number; project_id: string }
export interface BriefSnapshotV1 {
  schedule: { events: CalendarEvent[]; tomorrow: CalendarEvent[] }
  priorities: Priority[] | null
  due_today: BriefTaskRef[]
  still_open: { total: number; oldest: BriefTaskRef[] }
}
export interface Brief {
  date: string
  version: number
  status: 'ready' | 'partial' | 'fallback' | 'failed'
  source: 'nimble' | 'legacy_vault'
  layout: string[]
  snapshot: BriefSnapshotV1
  snapshot_schema: number
  generated_at: string
  updated_at: string
}
// data-provider.ts — new domain after dailyState
  brief: {
    /** The stored brief for `date`, or null. */
    get(date: string): Promise<Brief | null>
    /** Dates that have a stored brief, newest first. */
    listDates(): Promise<string[]>
    /** Today's snapshot, written on first call (desktop). Past/future dates are
     *  read-only; the web never writes and resolves null. */
    ensureSnapshot(date: string): Promise<Brief | null>
  }
```

- [ ] **Step 1: Rust command file**

```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::Brief;

#[tauri::command]
pub async fn brief_get(app: AppHandle, date: String) -> Result<Option<Brief>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::briefs::get_brief(pool.inner(), &date).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_list_dates(app: AppHandle) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::briefs::list_brief_dates(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn brief_ensure_snapshot(app: AppHandle, date: String) -> Result<Option<Brief>, String> {
    let pool = app.state::<SqlitePool>();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::db::briefs::ensure_snapshot(pool.inner(), &date, &today).await.map_err(|e| e.to_string())
}
```

Register `pub mod brief;`, add `brief` to the `use commands::{…}` list, and add `brief::brief_get, brief::brief_list_dates, brief::brief_ensure_snapshot,` in `generate_handler!` next to the priorities entries. If `chrono` isn't a src-tauri dependency, compute `today` in nimble-core instead: add `pub fn local_today() -> String` to `briefs.rs`. **No new Cargo dependencies.**

- [ ] **Step 2: TS wrappers.** In `tauri.ts`:
  - `getBrief(date)` → `invoke<Brief | null>('brief_get', { date })`
  - `listBriefSnapshots()` → `invoke<string[]>('brief_list_dates')`
  - `ensureBriefSnapshot(date)` → `invoke<Brief | null>('brief_ensure_snapshot', { date })`

  In `tauri-provider.ts`: `brief: { get: tauri.getBrief, listDates: tauri.listBriefSnapshots, ensureSnapshot: tauri.ensureBriefSnapshot }`.

- [ ] **Step 3: Web read path** (`services/turso/briefs.ts`)

```ts
/**
 * Briefs — read path for the web build. Mirrors nimble-core/src/db/briefs.rs
 * (`get_brief`, `list_brief_dates`); the web never writes briefs.
 */
import type { Brief } from '@nimble/types'
import { query, str, num, text, type Row } from './client'

const COLS = 'date, version, status, source, layout_json, snapshot_json, snapshot_schema, generated_at, updated_at'

function toBrief(row: Row): Brief {
  return {
    date: str(row, 'date'),
    version: num(row, 'version'),
    status: str(row, 'status') as Brief['status'],
    source: str(row, 'source') as Brief['source'],
    layout: JSON.parse(str(row, 'layout_json')),
    snapshot: JSON.parse(str(row, 'snapshot_json')),
    snapshot_schema: num(row, 'snapshot_schema'),
    generated_at: str(row, 'generated_at'),
    updated_at: str(row, 'updated_at'),
  }
}

export async function getBrief(date: string): Promise<Brief | null> {
  const rows = await query(`SELECT ${COLS} FROM briefs WHERE date = ?`, [text(date)])
  return rows.length ? toBrief(rows[0]) : null
}

export async function listBriefDates(): Promise<string[]> {
  const rows = await query('SELECT date FROM briefs ORDER BY date DESC')
  return rows.map((r) => str(r, 'date'))
}
```

Check `query`'s signature and `text` in `turso/client.ts` and match them. `tasks.ts` uses `text(...)` for args. In `turso-provider.ts`:

```ts
    // Read-only on the web: snapshots are written by the Mac at first open.
    brief: {
      get: getBrief,
      listDates: listBriefDates,
      ensureSnapshot: () => Promise.resolve(null),
    },
```

- [ ] **Step 4: Mock.** In `tools/mock-tauri.js`, near `DAILY_STATE`, add a `BRIEFS` object. It holds one past snapshot for `'2026-07-31'` (2 events, 3 priorities, 2 due-today refs, `still_open {total: 4, oldest: [...3 refs]}`). Add handlers:
  - `brief_get: function (a) { return BRIEFS[a && a.date] || null }`
  - `brief_list_dates: function () { return Object.keys(BRIEFS).sort().reverse() }`
  - `brief_ensure_snapshot`: when `a.date === TODAY` and there's no entry, build today's entry from `EVENTS` (the mock's today events array; use whatever name the file uses), `DAILY_STATE.priorities`, and `TASKS` split by `due_date === TODAY` / `< TODAY` (top level, open). Store it and return it. Other dates return `BRIEFS[a.date] || null`.

- [ ] **Step 5: Verify.** `cargo build --offline -p nimble` (or the src-tauri crate name from `apps/desktop/src-tauri/Cargo.toml`) → OK. `node --check tools/mock-tauri.js` → OK. The TS build waits for Task 7. Commit: `feat(brief): brief commands, DataProvider domain, web read path, mock`.

---

### Task 6: Pure helpers: `lib/todayBrief.ts`, `todayKey`, the shortcut rows

**Files:**
- Create: `apps/desktop/src/lib/todayBrief.ts`, `apps/desktop/tests/todayBrief.test.mjs`
- Modify: `apps/desktop/src/lib/keyGuard.ts` (add `todayKey`; delete `reviewEnterAction` and `ReviewEnterEvent`), `apps/desktop/tests/keyGuard.test.mjs` (delete the reviewEnterAction tests at ~92-112, add todayKey tests)
- Modify: `apps/desktop/src/lib/shortcuts.ts` (append the `'Today'` section and 3 rows)

**Interfaces:**
- Produces:

```ts
export const TODAY_LAYOUT = ['schedule', 'priorities', 'due_today', 'still_open', 'vault'] as const
export function hhmm(time: string): string                        // "10:00" from "10:00" or "2026-08-01T10:00:00"
export function splitDueTasks<T extends { due_date: string | null; parent_id: string | null }>(
  tasks: T[], today: string): { dueToday: T[]; stillOpen: T[] }   // top level only; stillOpen oldest due first
export function ageLabel(due: string, today: string): string       // "1d".."13d", "2w".."8w", "3mo".., "1y"
export function largestFreeBlock(events: { start_time: string; end_time: string; all_day: boolean }[],
  opts?: { from?: string; to?: string }): { start: string; end: string; minutes: number } | null // min 30 min
export function formatFreeBlock(b: { start: string; end: string; minutes: number }): string // "2h 30m open, 13:00–15:30"
export function nextEvent<E extends { start_time: string; all_day: boolean }>(events: E[], now: string): E | null
export function greetingFor(hour: number): string                 // Good morning / afternoon / evening
export function shouldAutoGenerate(s: { cached: boolean; tried: boolean; noKey: boolean }): boolean
export function loadTodayCompact(): boolean; export function saveTodayCompact(v: boolean): void
// keyGuard.ts
export function todayKey(e: CalendarKeyEvent): 'toggle' | 'prev' | 'next' | null
```

- [ ] **Step 1: Failing tests** (`tests/todayBrief.test.mjs`)

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { hhmm, splitDueTasks, ageLabel, largestFreeBlock, formatFreeBlock, nextEvent, greetingFor, shouldAutoGenerate } from '../src/lib/todayBrief.ts'

test('hhmm reads both the real "HH:MM" and the mock ISO shape', () => {
  assert.equal(hhmm('10:05'), '10:05')
  assert.equal(hhmm('2026-08-01T08:30:00'), '08:30')
})

test('splitDueTasks: today vs still open, top level only, oldest first', () => {
  const t = (id, due, parent = null) => ({ id, due_date: due, parent_id: parent })
  const { dueToday, stillOpen } = splitDueTasks(
    [t('a', '2026-09-23'), t('b', '2026-09-20'), t('c', '2026-08-01'), t('d', '2026-09-23', 'a'), t('e', null)],
    '2026-09-23')
  assert.deepEqual(dueToday.map((x) => x.id), ['a'])
  assert.deepEqual(stillOpen.map((x) => x.id), ['c', 'b'])
})

test('ageLabel is short and neutral', () => {
  assert.equal(ageLabel('2026-09-22', '2026-09-23'), '1d')
  assert.equal(ageLabel('2026-09-09', '2026-09-23'), '2w')
  assert.equal(ageLabel('2026-06-01', '2026-09-23'), '3mo')
  assert.equal(ageLabel('2025-09-01', '2026-09-23'), '1y')
})

test('largestFreeBlock finds the widest gap in the working window', () => {
  const ev = (s, e) => ({ start_time: s, end_time: e, all_day: false })
  const b = largestFreeBlock([ev('09:00', '10:00'), ev('11:30', '13:00'), ev('15:30', '16:00')])
  assert.deepEqual(b, { start: '13:00', end: '15:30', minutes: 150 })
  assert.equal(formatFreeBlock(b), '2h 30m open, 13:00–15:30')
  assert.equal(largestFreeBlock([ev('09:00', '18:00')]), null)
  assert.deepEqual(largestFreeBlock([], { from: '16:00' }), { start: '16:00', end: '18:00', minutes: 120 })
  assert.equal(largestFreeBlock([{ start_time: '', end_time: '', all_day: true }], { from: '17:45' }), null)
})

test('nextEvent skips all-day and past events', () => {
  const ev = (id, s, all_day = false) => ({ id, start_time: s, all_day })
  assert.equal(nextEvent([ev('x', '', true), ev('a', '09:00'), ev('b', '14:00')], '10:15').id, 'b')
  assert.equal(nextEvent([ev('a', '09:00')], '10:15'), null)
})

test('greetingFor splits the day at 12 and 17', () => {
  assert.equal(greetingFor(8), 'Good morning')
  assert.equal(greetingFor(12), 'Good afternoon')
  assert.equal(greetingFor(17), 'Good evening')
})

test('auto-generate at most once a day, never without a key', () => {
  assert.equal(shouldAutoGenerate({ cached: false, tried: false, noKey: false }), true)
  assert.equal(shouldAutoGenerate({ cached: true, tried: false, noKey: false }), false)
  assert.equal(shouldAutoGenerate({ cached: false, tried: true, noKey: false }), false)
  assert.equal(shouldAutoGenerate({ cached: false, tried: false, noKey: true }), false)
})
```

Append to `tests/keyGuard.test.mjs` (and delete the `reviewEnterAction` tests and its import):

```js
test('todayKey: b toggles, [ and ] step days, never from fields, overlays or chords', () => {
  const ev = (key, extra = {}) => ({ key, target: { tagName: 'DIV', closest: () => null }, ...extra })
  assert.equal(todayKey(ev('b')), 'toggle')
  assert.equal(todayKey(ev('[')), 'prev')
  assert.equal(todayKey(ev(']')), 'next')
  assert.equal(todayKey(ev('b', { metaKey: true })), null)
  assert.equal(todayKey(ev('b', { defaultPrevented: true })), null)
  assert.equal(todayKey(ev('B', { shiftKey: true })), null)
  assert.equal(todayKey({ key: 'b', target: { tagName: 'INPUT', closest: () => null } }), null)
})
```

Adapt the fake `target` to whatever shape the existing `calendarKey` tests in that file use, since `shouldIgnoreKey` reads specific properties. Copy their fixture helper.

- [ ] **Step 2:** `node --test apps/desktop/tests/todayBrief.test.mjs apps/desktop/tests/keyGuard.test.mjs` → FAIL (module and export missing).

- [ ] **Step 3: Implement** `lib/todayBrief.ts`:

```ts
// Pure helpers for the Today brief (spec 2026-09-23, phase 1). Plain TS so
// node tests import it directly. Times are local "HH:MM".

export const TODAY_LAYOUT = ['schedule', 'priorities', 'due_today', 'still_open', 'vault'] as const

/** Real events carry "HH:MM"; the browser mock carries ISO datetimes. */
export function hhmm(time: string): string {
  return time.includes('T') ? time.slice(11, 16) : time.slice(0, 5)
}

const toMin = (t: string) => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m }
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

export function splitDueTasks<T extends { due_date: string | null; parent_id: string | null }>(tasks: T[], today: string) {
  const top = tasks.filter((t) => !t.parent_id && t.due_date)
  return {
    dueToday: top.filter((t) => t.due_date === today),
    stillOpen: top.filter((t) => (t.due_date as string) < today)
      .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string)),
  }
}

const DAY = 86_400_000
export function ageLabel(due: string, today: string): string {
  const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / DAY))
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

export function largestFreeBlock(
  events: { start_time: string; end_time: string; all_day: boolean }[],
  opts: { from?: string; to?: string } = {},
): { start: string; end: string; minutes: number } | null {
  const lo = Math.max(toMin('09:00'), opts.from ? toMin(opts.from) : 0)
  const hi = toMin(opts.to ?? '18:00')
  const busy = events.filter((e) => !e.all_day && e.start_time && e.end_time)
    .map((e) => [toMin(e.start_time), toMin(e.end_time)] as const)
    .sort((a, b) => a[0] - b[0])
  let best: { start: number; end: number } | null = null
  let cursor = lo
  for (const [s, e] of [...busy, [hi, hi] as const]) {
    const gapEnd = Math.min(s, hi)
    if (gapEnd - cursor >= 30 && (!best || gapEnd - cursor > best.end - best.start)) best = { start: cursor, end: gapEnd }
    cursor = Math.max(cursor, e)
    if (cursor >= hi) break
  }
  return best && { start: fromMin(best.start), end: fromMin(best.end), minutes: best.end - best.start }
}

export function formatFreeBlock(b: { start: string; end: string; minutes: number }): string {
  const h = Math.floor(b.minutes / 60), m = b.minutes % 60
  const len = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
  return `${len} open, ${b.start}–${b.end}`
}

export function nextEvent<E extends { start_time: string; all_day: boolean }>(events: E[], now: string): E | null {
  return events.find((e) => !e.all_day && e.start_time && toMin(e.start_time) >= toMin(now)) ?? null
}

export function greetingFor(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

/** Priorities auto-generate once per day: never over a cached set, never
 *  twice after a try, never without a key (Review Focus 3). */
export function shouldAutoGenerate(s: { cached: boolean; tried: boolean; noKey: boolean }): boolean {
  return !s.cached && !s.tried && !s.noKey
}

// Compact brief: a per-device view preference, never reset by a new day (§0 Q3).
const COMPACT_KEY = 'nimble.todayCompact'
export function loadTodayCompact(): boolean {
  try { return localStorage.getItem(COMPACT_KEY) === '1' } catch { return false }
}
export function saveTodayCompact(v: boolean): void {
  try { localStorage.setItem(COMPACT_KEY, v ? '1' : '0') } catch { /* session-only */ }
}
```

In `keyGuard.ts`, replace `ReviewEnterEvent`/`reviewEnterAction` with:

```ts
/**
 * Today's page keys: `b` expands / compacts the brief, `[` / `]` step the
 * brief date. Plain keys only; text entry, overlays and chords keep them.
 */
export function todayKey(e: CalendarKeyEvent): 'toggle' | 'prev' | 'next' | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  if (shouldIgnoreKey(e.target)) return null
  if (e.key === 'b') return 'toggle'
  if (e.key === '[') return 'prev'
  if (e.key === ']') return 'next'
  return null
}
```

In `shortcuts.ts`, add `| 'Today'` at the end of the union and `'Today',` at the end of `SHORTCUT_SECTIONS`, and append these rows at the end of `SHORTCUTS`:

```ts
  // ── Today: brief (TodayPage.tsx → lib/keyGuard.ts todayKey) ──
  { section: 'Today', keys: 'B', label: 'Expand / compact the brief' },
  { section: 'Today', keys: '[', label: "Previous day's brief" },
  { section: 'Today', keys: ']', label: "Next day's brief" },
```

- [ ] **Step 4:** `node --test apps/desktop/tests/*.test.mjs` → all PASS. `shortcuts.test.mjs` and `helpPanel.test.mjs` must stay green. If one pins the exact section list, append `'Today'` there too; the order is append-only.
- [ ] **Step 5:** Commit: `feat(brief): today helpers, todayKey, Today shortcut rows`.

---

### Task 7: The live Today page: containers, compact strip, `useLocalToday` wiring

**Files:**
- Create in `apps/desktop/src/components/today/`: `BriefBox.tsx`, `ScheduleBox.tsx`, `PrioritiesBox.tsx`, `StillOpenBox.tsx`, `VaultBox.tsx`, `BriefStrip.tsx`
- Create: `apps/desktop/src/hooks/useGreeting.ts`
- Rewrite: `apps/desktop/src/components/pages/TodayPage.tsx`
- Delete: `apps/desktop/src/components/priorities/PrioritiesSection.tsx` (first confirm with `grep -rn PrioritiesSection apps/desktop/src` that Today is its only importer)

**Interfaces:**
- Consumes: Task 5's `dp.brief`, Task 6's helpers, `useCalendar()` → `{events, loading, goToToday}`, `useLocalTasks({dueDate})`, `dp.dailyState.get()` → `{priorities}`, `dp.dailyState.generatePriorities(cal, tasks, obsidian)`.
- Produces:
  - `BriefBox({title, count?, action?, children})`: the shared container frame: a `SectionTitle` row and a body.
  - `ScheduleBox({events, loading, tomorrow, today, live})`
  - `PrioritiesBox({priorities, onGenerated?, readOnly?})`
  - `StillOpenBox({tasks, total, today})`
  - `VaultBox({date})`
  - `BriefStrip({events, priorities, onExpand})`

Container rules for every box:
- Title in `SectionTitle`.
- One calm `Meta` line for the empty state.
- A skeleton shaped like the content while loading.
- It never disappears; the only exception is `VaultBox` when no file exists.

- [ ] **Step 1: `useGreeting`**

```ts
import { useEffect, useState } from 'react'
import { greetingFor } from '@/lib/todayBrief'

/** The header greeting, re-read on the hour and whenever the window regains
 *  focus or visibility (decision 6: a morning greeting must not survive into
 *  the afternoon or the next day). */
export function useGreeting(): string {
  const [hour, setHour] = useState(() => new Date().getHours())
  useEffect(() => {
    const refresh = () => setHour(new Date().getHours())
    const now = new Date()
    const msToHour = (60 - now.getMinutes()) * 60_000 - now.getSeconds() * 1000 + 1000
    const timer = setTimeout(refresh, msToHour)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', onVis) }
  }, [hour])
  return greetingFor(hour)
}
```

- [ ] **Step 2: The boxes.**
  - `ScheduleBox` reuses today's `CalendarGlance` row markup (time column `hhmm(start_time)`, feed dot, summary, max 5 plus "+N more").
  - Empty state: `No events. Wide open.`
  - Below the rows, when `live` and `largestFreeBlock(events, {from: nowHHMM})` isn't null: `<Meta as="p">{formatFreeBlock(block)}</Meta>`. For snapshots, compute it without `from`.
  - The title's `action` slot shows `Tomorrow: 09:00 Standup` for the first `tomorrow` event (as `Meta`), or nothing.

  `PrioritiesBox` is `PrioritiesSection` with every energy piece removed:
  - Removed: `ENERGY_OPTIONS`, `energy` state, the selector, the "Energy: x · Change" line.
  - It keeps `SOURCE_DOT`, `PriorityCard` and the `build*Summary` helpers, moved into this file.
  - Generation logic:

```ts
  const [tried, setTried] = useState(false)
  const [noKey, setNoKey] = useState(false)
  const generate = useCallback(async () => {
    setTried(true); setLoading(true); setError(null)
    try {
      const result = await dp.dailyState.generatePriorities(
        buildCalendarSummary(calendarEvents), buildTasksSummary(tasks, projectNames), buildObsidianSummary(obsidianToday))
      setPriorities(result); onGenerated?.(result)
    } catch (e) {
      if (String(e).includes('not configured')) setNoKey(true)
      else setError('Couldn’t reach the AI just now.')
    } finally { setLoading(false) }
  }, [/* same deps as today, minus energy */])
  useEffect(() => {
    if (!readOnly && shouldAutoGenerate({ cached: priorities !== null, tried, noKey })) void generate()
  }, [readOnly, priorities, tried, noKey, generate])
```

  - The `tried` state lives in the component, which TodayPage keys by `today` (`<PrioritiesBox key={today} …/>`), so a new day starts fresh (Review Focus 1 and 3).
  - Empty or no-key state: `Nothing pressing today. Pick something you want to do.`, plus `<Meta>Add an Anthropic key in Settings for AI priorities.</Meta>` when `noKey`.
  - Error: the message plus an outline "Try again" button calling `generate`.
  - `readOnly` (snapshots) hides regenerate and never generates.
  - There are no toasts.

  `StillOpenBox`:
  - Title `Still open`, with `count={total}`.
  - Rows show the title (truncate) and a right-aligned grey `ageLabel(due, today)` in `Meta tone="muted"`.
  - At most 5 rows. When `total > 5`: `<Meta>+{total - 5} more in Tasks</Meta>`.
  - Empty: `Everything's current.`
  - Live rows are clickable buttons that open the task in the detail sidebar. Use the same action `LocalTaskRow` uses to open detail: find it with `grep -n "openTask\|setSelectedTask\|detailStore" apps/desktop/src/components/tasks/LocalTaskRow.tsx`. Snapshot rows are the same markup, non-interactive.

  `VaultBox`:
  - Loads `dp.dailyState.readDailyBrief(date)` (catch → null) and renders nothing when the result is null.
  - Otherwise renders the current `BriefCard` collapsible titled `From your vault`, default closed, with no `DateStrip`.

  `BriefStrip`:
  - One row: `Next: {hhmm} {summary}` (or `No more events today`), then a `·` separator, then up to 3 priority titles as `1 Title` chips (truncate, max-w 14rem each).
  - Then an `IconButton` chevron-down (`aria-label="Expand the brief"`, `onExpand`).
  - The container is `surface-panel` and a single line (`flex items-center gap-3 min-w-0`).

- [ ] **Step 3: Rewrite `TodayPage.tsx`** (live day; Task 8 adds past dates):

```tsx
export function TodayPage() {
  const dp = useDataProvider()
  const today = useLocalToday()
  const greeting = useGreeting()
  const [compact, setCompact] = useState(loadTodayCompact)
  const toggleCompact = useCallback(() => setCompact((c) => { saveTodayCompact(!c); return !c }), [])

  const { events, loading: calLoading, goToToday } = useCalendar()
  // Calendar follows the new day. If `goToToday` isn't a stable useCallback in
  // hooks/useCalendar.ts, hold it in a ref so this runs only when `today` changes.
  useEffect(() => { goToToday() }, [today, goToToday])
  const [tomorrow, setTomorrow] = useState<CalendarEvent[]>([])
  useEffect(() => {
    let live = true
    dp.calendar.getCachedEvents(shiftIsoDate(today, 1))
      .then((ev) => { if (live) setTomorrow(ev.filter((e) => !e.all_day).slice(0, 2)) })
      .catch(() => { if (live) setTomorrow([]) })
    return () => { live = false }
  }, [dp, today])

  const { tasks, loading: tasksLoading, remove, addTask, refresh } = useLocalTasks({ dueDate: today, includeCompleted: false })
  const { dueToday, stillOpen } = useMemo(() => splitDueTasks(tasks, today), [tasks, today])

  const [cached, setCached] = useState<{ date: string; priorities: Priority[] | null } | null>(null)
  useEffect(() => {
    let live = true
    dp.dailyState.get().then((s) => { if (live) setCached({ date: today, priorities: s.priorities }) })
      .catch(() => { if (live) setCached({ date: today, priorities: null }) })
    return () => { live = false }
  }, [dp, today]) // decision 6: re-read on a new day
  const priorities = cached?.date === today ? cached.priorities : undefined // undefined = loading

  // Snapshot once the live data has landed (Review Focus 2).
  const snappedFor = useRef<string | null>(null)
  useEffect(() => {
    if (calLoading || tasksLoading || snappedFor.current === today) return
    snappedFor.current = today
    dp.brief.ensureSnapshot(today).catch(() => {})
  }, [dp, today, calLoading, tasksLoading])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (todayKey(e) === 'toggle') { e.preventDefault(); toggleCompact() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleCompact])
  // …render (below)
}
```

  Render inside `PageFrame title="Today" meta={…} actions={…}`:
  - `meta`: `greeting` plus the existing remaining-count suffix, computed as today (`greetingMeta` now takes the greeting string as an argument).
  - `actions`: `ProgressBar` (when anything is completed), then a chevron `IconButton` (`aria-label={compact ? 'Expand the brief' : 'Compact the brief'}`, `aria-expanded={!compact}`, `onClick={toggleCompact}`).

  Body, in `TODAY_LAYOUT` order:
  1. `ReminderCatchUp`.
  2. When `compact`: `BriefStrip` (the `onExpand` prop is `toggleCompact`). Otherwise: `ScheduleBox` (`live`), then `PrioritiesBox key={today}` with its priorities prop set to `priorities ?? null`. While `priorities === undefined`, render the priorities skeleton instead of mounting the box, so it never auto-generates before the cache read.
  3. The "Due today" section: today's existing `CollapsibleSection` block, retitled `Due today`, rendering `dueToday` with the same `LocalTaskRow` props and subtask map (built from `tasks`). Keep the existing `EmptyState` with `kbd="Q"` (copy: `Nothing due today. Add a task with`).
  4. `StillOpenBox` with the rows set to `stillOpen.slice(0, 5)`, `total={stillOpen.length}` and `today={today}`.
  5. `VaultBox date={today}`.

  `ReviewMode`, `ReviewStep`, `DashboardMode`, `CalendarGlance` and the `reviewComplete` routing are deleted.

- [ ] **Step 4: Build and lint.** `cd apps/desktop && npm run build && npm run build:web` → green (this also type-checks Tasks 3 and 5's TS). `npx eslint src/components/today src/components/pages/TodayPage.tsx src/hooks/useGreeting.ts` → no new problems. `node --test apps/desktop/tests/*.test.mjs` → PASS.

- [ ] **Step 5: Browser check through the mock.** Load the web harness (use the `run` skill or the project's existing mock-harness command in `nimble/CLAUDE.md`/`tools/`). Confirm:
  - The Today order is Schedule → Top priorities → Due today → Still open → Vault.
  - `b` toggles the strip, and the setting survives a reload.
  - No spinners.

  Take a screenshot of each state into the worktree's scratch area (not committed). Commit: `feat(brief): Today is the brief — fixed containers, compact strip, new-day wiring`.

---

### Task 8: Past dates

**Files:**
- Create: `apps/desktop/src/components/today/PastBrief.tsx`
- Modify: `TodayPage.tsx` (date state, header control, `[` / `]`)

**Interfaces:**
- Consumes: `dp.brief.get/listDates`, `dp.dailyState.readDailyBrief/listBriefDates`, `DateStrip`, `pickBriefDate`/`resolveBriefDate`/`shiftIsoDate`, the Task 7 boxes in snapshot mode.

- [ ] **Step 1: A failing test for the view choice.** Add to `lib/todayBrief.ts` and its test file:

```ts
export type PastView = 'loading' | 'snapshot' | 'vault' | 'none'
export function pastBriefView(brief: unknown | undefined, vault: string | null | undefined): PastView {
  if (brief === undefined || (brief === null && vault === undefined)) return 'loading'
  if (brief) return 'snapshot'
  return vault ? 'vault' : 'none'
}
```

```js
test('pastBriefView: snapshot beats vault; neither is a calm none (Review Focus 4)', () => {
  assert.equal(pastBriefView(undefined, undefined), 'loading')
  assert.equal(pastBriefView({ date: 'x' }, null), 'snapshot')
  assert.equal(pastBriefView(null, undefined), 'loading')
  assert.equal(pastBriefView(null, '# Brief'), 'vault')
  assert.equal(pastBriefView(null, null), 'none')
})
```

Run it → FAIL. Implement → PASS.

- [ ] **Step 2: `PastBrief({date, today})`**
  - Fetch `dp.brief.get(date)`. If that resolves null, fetch `dp.dailyState.readDailyBrief(date)`. Every `.catch` settles to `null`, so nothing loops.
  - Pick the view with `pastBriefView`:
    - `loading` → skeletons shaped like the boxes.
    - `snapshot`, rendered from `brief.snapshot`:
      - `ScheduleBox` (not `live`; from the snapshot's `events`/`tomorrow`)
      - `PrioritiesBox readOnly` (from `snapshot.priorities`; `null` → its empty line)
      - Due today as read-only rows, same markup as `StillOpenBox` without age tags, titled `Due today`
      - `StillOpenBox` (from `oldest`/`total`, with `today={date}`)
      - `VaultBox date={date}`
    - `vault` → `BriefBox title="From your vault"` wrapping `<BriefDisplay markdown={vault} />`.
    - `none` → `<Meta as="p">No brief for this day.</Meta>`.
  - Guard every async setter with a `live` flag keyed by `date`.

- [ ] **Step 3: `TodayPage` date state**

```tsx
  const [picked, setPicked] = useState<string | null>(null)
  const selected = resolveBriefDate(picked, today)
  const select = useCallback((d: string) => setPicked(pickBriefDate(d, today)), [today])
  const [briefDates, setBriefDates] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    Promise.all([dp.brief.listDates().catch(() => []), dp.dailyState.listBriefDates().catch(() => [])])
      .then(([a, b]) => { if (live) setBriefDates(new Set([...a, ...b])) })
    return () => { live = false }
  }, [dp, today])
```

  - `todayKey` also handles `'prev'` → `select(shiftIsoDate(selected, -1))` and `'next'` → `select(shiftIsoDate(selected, 1))`, but only when `selected < today`.
  - Put `<DateStrip briefDates={briefDates} selected={selected} today={today} onSelect={select} />` in the `PageHeader` `secondary` slot. If `secondary` isn't rendered beside the title, put it before the chevron in `actions`.
  - When `selected !== today`, render `<PastBrief date={selected} today={today} />` in place of the live body, and hide the compact chevron.
  - Also add the brief date to `briefDates` once `ensureSnapshot` resolves.

- [ ] **Step 4: Verify.** Run `node --test …`, `npm run build`, `npm run build:web`. Browser check with the mock:
  - `[` from today shows 2026-07-31 as a snapshot.
  - Another `[` shows the vault fallback or "No brief for this day."
  - `]` returns to today.

  Commit: `feat(brief): past briefs from snapshots, vault fallback, [ and ]`.

---

### Task 9: Branch verification and docs

- [ ] `cargo test --workspace --offline` → all pass (record the count).
- [ ] `node --test apps/desktop/tests/*.test.mjs` → all pass (record the count).
- [ ] `cd apps/desktop && npm run build && npm run build:web` → green. `npx eslint src` → no more problems than main (59).
- [ ] `nimble/CLAUDE.md`:
  - Bump "Current version" to **23** and add a `v23: briefs (per-day brief snapshots, synced by date)` clause.
  - Add `briefs` to Key Tables: `per-day morning brief snapshot (date PK, layout_json, snapshot_json), written once for today at first open, priorities patched in; synced by date, gated by turso_schema_v23_upgraded`.
- [ ] Real-app checks for Marco (dev build against the real profile, after merge and install):
  1. Today opens straight onto the brief, in container order.
  2. `b` compacts; after a relaunch it is still compact.
  3. Tomorrow morning, yesterday's `[` view shows yesterday's snapshot even though its tasks changed.
  4. With the Mac offline at first open: no spinner, cached events shown.
  5. Leave Today open across midnight (or sleep and wake): the new date, greeting and lists update.
  6. After install, rebuild `dt` (schema 23).
- [ ] Use superpowers:finishing-a-development-branch.
