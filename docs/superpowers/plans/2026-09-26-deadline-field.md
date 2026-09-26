# Deadline Field (schema v28) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task can carry a **deadline** (`deadline_date`, "must be done by"), separate from its due date ("work on it"). The deadline shows on rows, drives the morning brief, alerts ahead of time on the Mac, filters (Omnibar) and groups (list header) tasks, and round-trips with Todoist, `dt`, the web client and the skills, without ever shaming.

**Architecture:** Two nullable `local_tasks` columns (schema v28) ride every existing path. Writes go through `db/task_tx.rs` (sync_log + Todoist observer). The Turso snapshot carries them behind the `turso_schema_v28_upgraded` gate. The Todoist three-way merge maps them, and the outbox sends the deadline as its own `item_update`, so a refusal never blocks the rest. The C2 reminder ledger gets a second candidate kind, and the brief's candidates, prompt, fallback and Due-today code read the field. Pure date logic lives in one small module per side: `nimble-core/src/deadline.rs` and `apps/desktop/src/lib/deadline.ts`. Both count calendar days (no clock), so DST never shifts a count. The UI is one row mark, one popover, one metadata chip, one Omnibar pill kind and one group-by, each built from existing patterns.

**Tech Stack:** Rust (nimble-core, sqlx SQLite, chrono/chrono-tz, tokio tests), Tauri 2 commands, `dt` CLI (clap), React 19 + TS, `@base-ui/react` via `components/ui/*`, lucide `Flag`, `node:test`, Playwright (WebKit) + axe against `tools/mock-tauri.js`.

**Spec:** `docs/superpowers/specs/2026-09-25-deadline-field-design.md`, including its "Approval (2026-09-26)" section. Where the approval and the spec body differ, the approval wins (see Plan decision 1).

**Branch / worktree / base:** branch `deadline/v28` in `/Users/marcosevilla/Developer/marco-task-app/.nimble-wt/deadline`, cut from `main` **after** the 2026-09-26 merges of `fix/todoist-recurrence`, `c5/import-history`, `cleanup/review-followups` and `design/loop4-e` (`main` at `1de056f` or later). Every path and anchor below is post-merge. Line numbers drift, so each step names the function or a unique string to anchor on. Frozen QA server port: **5308**.

**Design chunks A–D run after this lane.** Keep the deadline UI minimal and composable. Chunk B's shared picker absorbs `DeadlinePopover`, which copies `DueDatePopover`'s prop contract on purpose. Chunk C's `Chip`/`ListRow` primitives absorb `DeadlineMark`'s button and MetadataChips' `DeadlineChip` (both marked `// chunk C: Chip` in code). Chunk D's copy pass owns the strings in `lib/deadline.ts`. This plan adds no new visual primitive.

## Plan decisions (spec gaps and corrections, for Marco's review)

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | "overdue" alias | **Not** an alias. `deadline: passed` is suggested by "deadline passed", "past deadline", "late" and "missed" only. A test asserts that "overdue" suggests no deadline pill. | The approval says "typing 'overdue' does not suggest a deadline filter for now". §4.3 and Q4's recommendation say the opposite; the approval is later and explicit. |
| 2 | Picker | New `DeadlinePopover.tsx` with `DueDatePopover`'s exact prop contract (`value/onChange/open/onOpenChange/triggerProps/contentProps`), not a `mode="deadline"` branch inside the 415-line due popover. | The value shapes differ (date + alert vs date/time/duration/rule). Chunk B merges pickers anyway. |
| 3 | Todoist push | The deadline goes in a separate `item_update` with a derived command uuid. A create adds a follow-up `item_update` on its `temp_id`. If that command is refused, a `nimble_gap` activity is logged, the rest of the update still lands, and the deadline stays Nimble-only. | This is the spec §3.2 outcome ("one refused field never blocks the rest") without a retry loop. |
| 4 | Today's live list | `tasks.list({ dueDate, includeDeadlines: true })` → new core `get_local_tasks_due_or_deadline`. The brief modules' `open_top_level` uses the same query. `dt task list --due` keeps its meaning. | A deadline-today task with a later (or no) due date is not in the due list today. |
| 5 | Validation | Only the values a write brings in are validated, so a bad value already stored never blocks editing other fields. A Todoist value is cut to 10 characters, and dropped if it still isn't a real date. | §9 "Invalid input" plus the Review Focus 5 failure mode. |
| 6 | Alert without a deadline | Rejected in core, web and `dt` ("a deadline alert needs a deadline"). | Mirrors the reminder rule ("a reminder requires a due date and time"). |
| 7 | Fallback "within 3 days" | 0–2 days away (the chip's strong window). A passed deadline does not jump the fallback order. | §5 leaves "within 3 days" undefined for passed dates. No-guilt. |
| 8 | Group "This week" | 2–6 days away, the same window as the Omnibar's `this week` (today…+6). | One definition of "this week" per feature. |
| 9 | Prompt wording | The rule says "the person", not "Marco". | The brief is productized (BYO key), and the existing prompt already says "the person". |
| 10 | Settings placement | "Deadline alerts" is a block inside the existing **Reminders** section (same `reminders` capability, same page), not a new section id. | Keeps `settingsSections` untouched. The web already hides it. |
| 11 | Backfill `--apply` | With the app open: back up through the app, then write each match through the app's native task path. With the app closed: write directly. Preview never writes. | The same routing as every `dt task` write (one focus writer). |
| 12 | Row "today" | `DeadlineMark` uses `useLocalToday()`. Only rows that carry a deadline mount it. | §4.1 "recomputes on the existing day-rollover tick". |

## Global Constraints

- **Schema v28, append-only.** `ALTER TABLE local_tasks ADD COLUMN deadline_date TEXT` and `... ADD COLUMN deadline_alert_days INTEGER`. One statement per `;`, with no SQL comments inside migration strings (the runner splits on `;`). `deadline_date` is `YYYY-MM-DD` or NULL. `deadline_alert_days` is NULL (global default), -1 (off) or 0..=14 (days before). No new index. `tasks_fts` is unchanged. Mobile mirror: skipped (dormant).
- **Date only, floating.** "Today" is the Mac's local date in Rust and the browser's local date on the web. Alerts use the C2 `reminder_timezone` setting.
- **Copy, verbatim.** Row chip: `due by Oct 6` · `due by Jan 6, 2027` · `due by Sat` (2 days) · `due tomorrow` · `due today` · `was due Oct 6` (`, 2025` in another year). Strong (0/1/2 days away) = `text-foreground font-medium` with a filled `Flag`. Otherwise `text-muted-foreground` with an outline `Flag`. No colour in any state, never red, never "overdue". Accessible name = tooltip: `Deadline October 6, in 12 days` · `Deadline October 6, tomorrow` · `Deadline October 6, today` · `Deadline was October 6`. Picker alert options: `Default (2 days before)` · `Off` · `On the day` · `1 day before` · `2 days before` · `3 days before` · `1 week before`, plus the action `Remove deadline`. Detail chip: `Deadline` (empty) / `Deadline Oct 6` (filled, ✕ `Clear deadline`). Detail hint: `Due Oct 8 is after the Oct 6 deadline.` Alert: title = task title, body `Due today` / `Due tomorrow` / `Due by Thu, Oct 8`. Group buckets: `Earlier` · `Today` · `Tomorrow` · `This week` · `Later` · `No deadline`. Pill text: `deadline: any|today|this week|passed`. Header menu: `Deadline`. Shortcut row: `⇧B` "Set deadline of focused task".
- **Alerts.** Default 2 days before at 09:00, on for every deadline. Device-local settings keys `deadline_alert_days` (default `2`, range -1..=14) and `deadline_alert_time` (default `09:00`). Occurrence key `deadline|{id}|{date}|{N}|{HH:MM}|{tz}`. A key first inserted more than 90 s after its `scheduled_at` gets `state='skipped'`. Mac only. The web hides every alert control through `dp.reminders.supported`, never `if (web)`.
- **Turso.** `ensure_remote_v28_schema` runs at **all three** `db/sync.rs` sites (latched-init branch, fresh-init tail, push), right after v27. The columns are also in the fresh-init `CREATE TABLE local_tasks`. Deploy order: install on the Mac → one push → deploy the web.
- **Todoist API v1.** Pull: `"deadline": {"date": "YYYY-MM-DD", "lang": "en"}` or `null` (`lang` ignored). Push: `"deadline": {"date": d}` or `"deadline": null`. A one-time full pull is gated by the setting `todoist_deadline_backfill_v28`.
- **Backup/export.** `export_policy::tables_for_version` and `backup::verify_generation` accept 28. Both columns are reviewed and **included** in `local_tasks` (full and portable).
- **Architecture rules (CLAUDE.md).** Task writes go only through `db/tasks.rs` → `db/task_tx.rs`. `components/**` never import `@/services/tauri` (ESLint). Platform differences go through `dp` capabilities. Use `cn()` for class merging. Use skeletons, never spinners. `tools/mock-tauri.js` `update_local_task` applies all sets before all clears, and `clearDeadline` nulls both fields.
- **Commands** (from the worktree root unless a step says `cd apps/desktop`):
  - Rust: `cargo test --workspace --offline` (focused: `cargo test -p nimble-core --offline <filter>`, `cargo test -p nimble-cli --offline --test contracts <filter>`)
  - Node: `cd apps/desktop && node --test tests/<file>.test.mjs`
  - Type check: `cd apps/desktop && npm run build && npm run build:web`. This is the real check; bare `npx tsc --noEmit` checks nothing.
  - Lint: `cd apps/desktop && npx eslint src` must report no more problems than the baseline recorded in Task 1 Step 1.
  - Browser QA, against a frozen build only: `tools/qa-frozen.sh $(git rev-parse HEAD) /private/tmp/claude-501/deadline-qa 5308`, then `cd apps/desktop && BASE_URL=http://localhost:5308 npx playwright test -c e2e <spec>`
- **Commits.** Use `feat(deadline): …`, `test(deadline): …` or `docs(deadline): …`. Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb
  ```
  Never commit to `main`. `NEXT.md` is edited only at wrap.
- `CURRENT_SCHEMA_VERSION` 27 → 28. `tools/dt/src/profile.rs` pins the version exactly, so the installed `dt` must be rebuilt after the app update.

## Review Focus

1. **Calendar math across DST and New Year.** 2026-10-31 → 2026-11-02 is 2 days (the US DST change is 2026-11-01), and 2026-12-30 → 2027-01-01 reads `due by Fri` while 2027-01-06 reads `due by Jan 6, 2027`. The chip, the group bucket, the prompt and the alert must all agree. Pinned in Task 7 (`deadlineLabel: DST and New Year`) and Task 4 (`deadline alert lands at 09:00 local across DST`).
2. **Rows written before v28 must never clear a deadline.** This covers a Turso row from a pre-v28 web tab (no deadline keys) and a stored Todoist base without `deadline_date`. The expected result: the deadline survives, and the one-time full pull fills Todoist deadlines without touching any other field. Pinned in Task 1 (`v27_snapshot_does_not_clear_the_v28_deadline`) and Task 3 (`the_backfill_pull_fills_deadlines_and_nothing_else`).
3. **Todoist refuses a deadline** (plan limit, recurring task). The rest of the update applies, the outbox row doesn't sit in `error`, a gap is logged, and the next pull keeps the local deadline. Pinned in Task 3 (`deadline_refusal_is_reported_per_row`, `a_local_deadline_todoist_never_took_survives_the_pull`).
4. **Setting or moving a deadline inside its own alert window** (e.g. at 23:00 for tomorrow's deadline) must not fire a stale banner or create a catch-up card. Clearing or moving a deadline supersedes its pending alert. A key that was already pending before sleep still becomes a normal catch-up. Pinned in Task 4 (`deadline_alerts_fire_supersede_and_skip_late_first_sight`).
5. **Malformed dates from every entry point**: `2026-02-30`, `2026-10-31T09:00`, `""`, `10/31/2026`, and a bad value already stored. The expected result: rejected by core/web/mock/`dt` (exit 2), cut or dropped from Todoist, and never blocking an unrelated edit. Pinned in Task 2 (`invalid_deadline_input_is_rejected_and_nothing_changes`), Task 3 (`item_to_snapshot_maps_and_cuts_the_deadline`), Task 6 (`deadline_flags_round_trip_and_invalid_input_exits_2`) and Task 7 (`applyDeadlineIntent mirrors core validation`).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `nimble-core/src/db/migrations.rs` | 1 | v28 migration, `CURRENT_SCHEMA_VERSION = 28` |
| `nimble-core/src/types.rs` | 1, 2 | `LocalTask` fields (1); input + search-filter fields (2) |
| `nimble-core/src/db/tasks.rs` | 1, 2 | `FromRow`, `SELECT_COLS` (1); activity fields, list queries, tests (2) |
| `nimble-core/src/db/sync.rs` | 1 | remote DDL, `ensure_remote_v28_schema` ×3, tests |
| `nimble-core/src/db/export_policy.rs`, `db/backup.rs` | 1 | accept v28, reviewed columns |
| `nimble-core/src/deadline.rs` (new), `lib.rs` | 2 | pure date helpers (parse, validate, shift, Todoist cut, alert body) |
| `nimble-core/src/db/task_tx.rs` | 2 | create/update/clear/validate, recurrence shift, undo restore |
| `nimble-core/src/db/task_search.rs` | 2 | `deadline` filter |
| `apps/desktop/src-tauri/src/commands/local_tasks.rs` | 2 | command params (`deadline_*`, `include_deadlines`) |
| `nimble-core/src/integrations/todoist/{client,mappers,merge,observer,sync_loop,reconcile,history}.rs`, `api/todoist_migration.rs` | 3 | pull, merge, push, backfill pull, importers |
| `nimble-core/src/reminders.rs`, `db/reminders.rs`, `nimble-core/tests/reminders.rs`, `src-tauri/src/reminder_runner.rs` | 4 | deadline alerts |
| `nimble-core/src/brief/{candidates,prompt,fallback,validate}.rs`, `brief/modules/{mod,due_today,still_open}.rs` | 5 | brief |
| `nimble-core/src/db/deadline_backfill.rs` (new), `db/mod.rs` | 6 | description-line conversion |
| `tools/dt/src/{args.rs,main.rs,commands/mod.rs}`, `tools/dt/tests/contracts.rs` | 6 | `dt` flags, list, backfill |
| `docs/agent-access.md`, `CLAUDE.md`, `~/.claude/skills/references/nimble-dt.md` | 6 | docs and the shared skill protocol |
| `packages/types/src/{index,data-provider}.ts` | 7 | TS types, DataProvider options |
| `apps/desktop/src/lib/deadline.ts` (new) + `tests/deadline.test.mjs` (new) | 7 | pure label/filter/bucket/shift/intent/alert copy |
| `apps/desktop/src/services/{tauri.ts,turso-provider.ts}`, `services/turso/{tasks,search}.ts` | 7 | desktop + web data paths |
| `apps/desktop/src/lib/{taskPatch,focusPrompt}.ts`, `tools/mock-tauri.js` | 7 | patch mapping, prompt line, mock |
| `apps/desktop/src/components/tasks/DeadlinePopover.tsx` (new) | 8 | the picker |
| `apps/desktop/src/components/tasks/{RowMarks,TaskItem,LocalTaskRow,MetadataChips,TaskComposerCard}.tsx`, `components/detail/TaskDetailPage.tsx` | 8 | row chip, ⇧B, detail/create chip, hint |
| `apps/desktop/src/lib/{rowMarks,rowPickerKeys,shortcuts}.ts` | 8 | mark name, row key, `?` list |
| `apps/desktop/src/components/settings/ReminderSection.tsx`, `components/today/modules/DueTodayBox.tsx` | 8 | alert settings, snapshot chip |
| `apps/desktop/src/lib/{omnibarQuery,omnibarSearch,task-view,todayBrief}.ts`, `components/omnibar/Omnibar.tsx`, `components/tasks/TaskListHeader.tsx`, `components/pages/{TasksPage,TodayPage}.tsx`, `hooks/useLocalTasks.ts` | 9 | pill, group-by, Today split |
| `apps/desktop/e2e/d1-deadline.spec.ts` (new), `e2e/axe-baseline.json` | 10 | browser QA |

---

### Task 1: Schema v28, `LocalTask` fields, Turso gate, backup/export policy

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append v28 after the `version: 27` entry; the constant; the `v27_tests` pin; new `v28_tests`)
- Modify: `nimble-core/src/types.rs` (`LocalTask`)
- Modify: `nimble-core/src/db/tasks.rs` (`impl FromRow for LocalTask`, `SELECT_COLS`)
- Modify: `nimble-core/src/db/sync.rs` (fresh-init `CREATE TABLE IF NOT EXISTS local_tasks`, `REMOTE_V28_ALTERS`, `ensure_remote_v28_schema`, three call sites, tests)
- Modify: `nimble-core/src/db/export_policy.rs` (`tables_for_version`, test), `nimble-core/src/db/backup.rs` (`verify_generation` version list)

**Interfaces:**
- Consumes: nothing.
- Produces: columns `local_tasks.deadline_date TEXT`, `local_tasks.deadline_alert_days INTEGER`; `LocalTask { deadline_date: Option<String>, deadline_alert_days: Option<i64> }` (both `#[serde(default)]`), included in `SELECT_COLS` and in every `sync_log` task snapshot; `CURRENT_SCHEMA_VERSION == 28`; the setting `turso_schema_v28_upgraded`.

- [ ] **Step 1: Create the worktree, link node_modules, record the lint baseline**

```bash
cd /Users/marcosevilla/Developer/marco-task-app/nimble
git log --oneline -1 main   # expect 1de056f or later (all four 2026-09-26 merges)
git worktree add ../.nimble-wt/deadline -b deadline/v28 main
ln -s /Users/marcosevilla/Developer/marco-task-app/nimble/node_modules ../.nimble-wt/deadline/node_modules
ln -s /Users/marcosevilla/Developer/marco-task-app/nimble/apps/desktop/node_modules ../.nimble-wt/deadline/apps/desktop/node_modules
cd ../.nimble-wt/deadline/apps/desktop && npx eslint src 2>&1 | tail -2 > /private/tmp/claude-501/deadline-eslint-baseline.txt; cat /private/tmp/claude-501/deadline-eslint-baseline.txt
cd ../.. && grep -n "version: 2[89]," nimble-core/src/db/migrations.rs || echo "v28 is free"
```

Expected: the worktree is on `deadline/v28`, the baseline line reads like `✖ N problems (…)` (or is empty when clean), and `v28 is free` is printed. If another branch already took v28, stop and ask Marco. `run_migrations` never runs a version at or below the DB's current one, so numbers must not collide.

- [ ] **Step 2: Write the failing tests**

In `nimble-core/src/db/migrations.rs`, inside `mod v27_tests`, change `assert_eq!(super::CURRENT_SCHEMA_VERSION, 27);` to:

```rust
        assert!(super::CURRENT_SCHEMA_VERSION >= 27);
```

Append at the end of the file:

```rust
#[cfg(test)]
mod v28_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v28_adds_the_deadline_columns() {
        let pool = test_pool().await;
        let cols: Vec<(String, String, i64)> =
            sqlx::query_as("SELECT name, type, \"notnull\" FROM pragma_table_info('local_tasks') ORDER BY cid")
                .fetch_all(&pool).await.unwrap();
        let tail = cols[cols.len() - 2..].to_vec();
        assert_eq!(tail, vec![
            ("deadline_date".to_string(), "TEXT".to_string(), 0),
            ("deadline_alert_days".to_string(), "INTEGER".to_string(), 0),
        ]);
        assert_eq!(super::CURRENT_SCHEMA_VERSION, 28);
    }
}
```

In `nimble-core/src/db/export_policy.rs`, inside `mod tests`, append:

```rust
    #[test]
    fn v28_policy_includes_the_deadline_columns() {
        let tables = super::tables_for_version(28).expect("v28 is a reviewed version");
        let tasks = tables.iter().find(|p| p.name == "local_tasks").unwrap();
        let n = tasks.columns.len();
        assert_eq!(&tasks.columns[n - 2..], &["deadline_date", "deadline_alert_days"]);
        let m = tasks.included.len();
        assert_eq!(&tasks.included[m - 2..], &["deadline_date", "deadline_alert_days"], "user intent: portable");
        let v27 = super::tables_for_version(27).unwrap();
        assert!(!v27.iter().find(|p| p.name == "local_tasks").unwrap().columns.contains(&"deadline_date"));
        assert!(super::tables_for_version(29).is_none());
    }
```

In `nimble-core/src/db/sync.rs`, inside `mod snapshot_apply_tests` (after `v19_snapshot_does_not_clear_v20_intent`), append (Review Focus 2):

```rust
    /// A row written by a pre-v28 client (an old web tab, another Mac on v27)
    /// carries no deadline keys. The upsert sets only the snapshot's columns,
    /// so the deadline must survive.
    #[tokio::test]
    async fn v27_snapshot_does_not_clear_the_v28_deadline() {
        let pool = crate::test_util::test_pool().await;
        let task = crate::db::tasks::create_local_task(&pool, crate::types::CreateTaskInput {
            content: "File COBRA election".into(), ..Default::default()
        }).await.unwrap();
        sqlx::query("UPDATE local_tasks SET deadline_date = '2026-10-31', deadline_alert_days = -1 WHERE id = ?")
            .bind(&task.id).execute(&pool).await.unwrap();
        let old = serde_json::json!({"id": task.id, "content": "Old peer edit", "project_id": "inbox"}).to_string();
        super::apply_remote_change(&pool, "local_tasks", &task.id, "UPDATE", Some(&old)).await.unwrap();
        let (content, date, alert): (String, Option<String>, Option<i64>) =
            sqlx::query_as("SELECT content, deadline_date, deadline_alert_days FROM local_tasks WHERE id = ?")
                .bind(&task.id).fetch_one(&pool).await.unwrap();
        assert_eq!((content.as_str(), date.as_deref(), alert), ("Old peer edit", Some("2026-10-31"), Some(-1)));
    }

    #[test]
    fn v28_gate_runs_at_all_three_sites_and_fresh_init_has_the_columns() {
        let src = include_str!("sync.rs");
        // Split literals so this test's own text never matches.
        let call = concat!("ensure_remote_v28", "_schema(pool, turso_url, turso_token)");
        assert_eq!(src.matches(call).count(), 3, "latched init, fresh init and push");
        let create = concat!("CREATE TABLE IF NOT EXISTS ", "local_tasks (");
        let ddl = &src[src.find(create).unwrap()..];
        let ddl = &ddl[..ddl.find(")\",").unwrap()];
        assert!(ddl.contains("deadline_date TEXT") && ddl.contains("deadline_alert_days INTEGER"), "{ddl}");
        assert_eq!(super::REMOTE_V28_ALTERS, [
            "ALTER TABLE local_tasks ADD COLUMN deadline_date TEXT",
            "ALTER TABLE local_tasks ADD COLUMN deadline_alert_days INTEGER",
        ]);
    }

    #[tokio::test]
    async fn task_snapshots_carry_both_deadline_keys() {
        let pool = crate::test_util::test_pool().await;
        let task = crate::db::tasks::create_local_task(&pool, crate::types::CreateTaskInput {
            content: "x".into(), ..Default::default()
        }).await.unwrap();
        let snap: serde_json::Value = serde_json::from_str(&super::task_sync_snapshot(&task)).unwrap();
        assert!(snap["deadline_date"].is_null() && snap.get("deadline_date").is_some());
        assert!(snap.get("deadline_alert_days").is_some());
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline v28 2>&1 | tail -20`
Expected: compile errors (`REMOTE_V28_ALTERS` not found, no field `deadline_date`), or FAIL on the column/version asserts.

- [ ] **Step 4: Add the migration and the constant**

In `nimble-core/src/db/migrations.rs`, append after the `version: 27` `Migration { … },` entry (inside `MIGRATIONS`):

```rust
    // deadline field (spec 2026-09-25-deadline-field-design.md §1)
    Migration {
        version: 28,
        description: "Deadline field on local_tasks",
        sql: "ALTER TABLE local_tasks ADD COLUMN deadline_date TEXT;
        ALTER TABLE local_tasks ADD COLUMN deadline_alert_days INTEGER",
    },
```

Replace the two lines `// Momentum is v27: C4 (v25) and brief phase 3 (v26) merge before it.` and `pub const CURRENT_SCHEMA_VERSION: i64 = 27;` with:

```rust
// Deadline field is v28 (after momentum v27).
pub const CURRENT_SCHEMA_VERSION: i64 = 28;
```

- [ ] **Step 5: Add the `LocalTask` fields, `FromRow` and `SELECT_COLS`**

In `nimble-core/src/types.rs`, inside `pub struct LocalTask`, directly after `pub google_calendar_enabled: bool,`:

```rust
    /// Must be done by (`YYYY-MM-DD`), separate from the due date. Schema v28.
    #[serde(default)]
    pub deadline_date: Option<String>,
    /// Alert N days before the deadline: None = the Mac's global default,
    /// -1 = off, 0..=14.
    #[serde(default)]
    pub deadline_alert_days: Option<i64>,
```

In `nimble-core/src/db/tasks.rs`, inside `impl FromRow<'_, SqliteRow> for LocalTask`, after the `google_calendar_enabled:` line:

```rust
            deadline_date: row.try_get("deadline_date")?,
            deadline_alert_days: row.try_get("deadline_alert_days")?,
```

Replace `SELECT_COLS` with:

```rust
pub(crate) const SELECT_COLS: &str = "id, parent_id, content, description, project_id, priority, due_date, due_time, duration_minutes, recurrence_rule, section_id, reminder_offset_minutes, google_calendar_enabled, completed, completed_at, status, linked_doc_id, position, created_at, updated_at, external_id, external_source, remote_updated_at, synced_snapshot, sync_policy, deadline_date, deadline_alert_days";
```

- [ ] **Step 6: Add the Turso gate at all three sites and the fresh-init columns**

In `nimble-core/src/db/sync.rs`, in `initialize_remote`'s `CREATE TABLE IF NOT EXISTS local_tasks (` statement, add two lines directly after `sync_policy TEXT NOT NULL DEFAULT 'default',`:

```sql
            deadline_date TEXT,
            deadline_alert_days INTEGER,
```

Directly after `const REMOTE_KARMA_EVENTS_DDL: &str = …;`, add:

```rust
/// v28 (deadline field): the two `local_tasks` columns. The fresh-init DDL
/// above already has them; the gate's "duplicate column" tolerance covers that.
const REMOTE_V28_ALTERS: [&str; 2] = [
    "ALTER TABLE local_tasks ADD COLUMN deadline_date TEXT",
    "ALTER TABLE local_tasks ADD COLUMN deadline_alert_days INTEGER",
];
```

Directly after `async fn ensure_remote_v27_schema(…) { … }`, add:

```rust
/// Latches only when both ALTERs landed (or already existed). Must succeed
/// before a web build that selects `deadline_date` is deployed (spec §3.1).
async fn ensure_remote_v28_schema(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let done: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='turso_schema_v28_upgraded'")
        .fetch_optional(pool).await?;
    if done.is_some() { return Ok(()); }
    let requests: Vec<serde_json::Value> = REMOTE_V28_ALTERS
        .iter()
        .map(|sql| turso_execute(sql, vec![]))
        .chain(std::iter::once(serde_json::json!({"type":"close"})))
        .collect();
    let body = turso_pipeline(turso_url, turso_token, requests).await?;
    // "duplicate column name" = already added (fresh init or an earlier run);
    // anything else must not latch the gate.
    check_pipeline_statement_errors(&body, "Turso v28 schema upgrade", true)?;
    sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('turso_schema_v28_upgraded','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')")
        .execute(pool).await?;
    Ok(())
}
```

Add the three calls, each right after the matching v27 line:
1. In `initialize_remote`'s latched branch, after `ensure_remote_v27_schema(pool, turso_url, turso_token).await?;` (inside `other => { … }`):
   ```rust
                   ensure_remote_v28_schema(pool, turso_url, turso_token).await?;
   ```
2. At `initialize_remote`'s fresh-init tail, after the second `ensure_remote_v27_schema(pool, turso_url, turso_token).await?;`:
   ```rust
       ensure_remote_v28_schema(pool, turso_url, turso_token).await?;
   ```
3. In `push`, after the `if let Err(e) = ensure_remote_v27_schema(…) { … }` block:
   ```rust
       if let Err(e) = ensure_remote_v28_schema(pool, turso_url, turso_token).await {
           log::warn!("Turso v28 schema gate failed, pushing anyway (gate retries next push): {e}");
       }
   ```

- [ ] **Step 7: Accept v28 in the export policy and the backup manifest**

In `nimble-core/src/db/export_policy.rs`, add to the doc comment above `tables_for_version`:

```rust
/// V28 adds the reviewed, included `local_tasks.deadline_date` / `deadline_alert_days` (user intent).
```

Change `if !(20..=27).contains(&version) { return None; } // schema-v25, schema-v26, momentum v27` to:

```rust
    if !(20..=28).contains(&version) { return None; } // schema-v25, schema-v26, momentum v27, deadline v28
```

Directly before `tables.sort_by_key(|policy| policy.name);`, add:

```rust
    if version >= 28 {
        for policy in &mut tables {
            if policy.name == "local_tasks" {
                *policy = table!("local_tasks"; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","remote_updated_at","synced_snapshot","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled","sync_policy","deadline_date","deadline_alert_days"]; ["id","parent_id","content","description","project_id","priority","due_date","completed","completed_at","position","created_at","updated_at","status","linked_doc_id","external_id","external_source","due_time","duration_minutes","recurrence_rule","section_id","reminder_offset_minutes","google_calendar_enabled","sync_policy","deadline_date","deadline_alert_days"]);
            }
        }
    }
```

In `nimble-core/src/db/backup.rs` (`verify_generation`), change `!matches!(manifest.schema_version, 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27) // schema-v25, schema-v26, momentum v27` to:

```rust
        || !matches!(manifest.schema_version, 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28) // schema-v25, schema-v26, momentum v27, deadline v28
```

(A v27 backup restored into v28 keeps both columns NULL: they are nullable, and the v27 policy never lists them.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline v28 && cargo test -p nimble-core --offline snapshot_apply_tests && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: every `test result: ok`, no `FAILED`. `tests/backup_export.rs` (`schema_drift_fails_closed`, `export_is_repeatable_typed…`) passes with 28 because the policy matches the table.

- [ ] **Step 9: Commit**

```bash
git add nimble-core/src/db/migrations.rs nimble-core/src/types.rs nimble-core/src/db/tasks.rs nimble-core/src/db/sync.rs nimble-core/src/db/export_policy.rs nimble-core/src/db/backup.rs
git commit -m "feat(deadline): v28 deadline columns, Turso gate at all three sites, export policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 2: Task writes — create, update, clear, validation, recurrence shift, list and search queries

**Files:**
- Create: `nimble-core/src/deadline.rs`
- Modify: `nimble-core/src/lib.rs` (`pub mod deadline;`)
- Modify: `nimble-core/src/types.rs` (`CreateTaskInput`, `UpdateTaskInput`, `TaskSearchFilters`)
- Modify: `nimble-core/src/db/task_tx.rs` (`create_task_with_id_tx`, `update_task_tx`, `set_status_tx`, `restore_deleted_tasks_tx`)
- Modify: `nimble-core/src/db/tasks.rs` (`activity_fields`, `with_labels`, `get_local_tasks_due_or_deadline`, `get_tasks_with_deadline_by`, `mod deadline_tests`)
- Modify: `nimble-core/src/db/task_search.rs` (`search_tasks_on`, `deadline_clause`, test)
- Modify: `apps/desktop/src-tauri/src/commands/local_tasks.rs` (`create_local_task`, `update_local_task`, `get_local_tasks` params)
- Modify: `tools/dt/src/commands/mod.rs` (compile only: new fields in `create_input` and in the `Task::Search` filter literal; Task 6 wires the flags)

**Interfaces:**
- Consumes: Task 1's columns and `LocalTask` fields.
- Produces:
  - `nimble_core::deadline::{parse(&str) -> Option<NaiveDate>, validate_input(Option<&str>, Option<i64>) -> Result<()>, validate_row(Option<&str>, Option<i64>) -> Result<()>, shift(Option<&str>, NaiveDate, NaiveDate) -> Option<String>, days_until(&str, NaiveDate) -> Option<i64>, from_todoist(&str) -> Option<String>, alert_body(NaiveDate, NaiveDate) -> String, ALERT_OFF: i64 = -1, MAX_ALERT_DAYS: i64 = 14}`
  - `CreateTaskInput { deadline_date: Option<String>, deadline_alert_days: Option<i64> }`
  - `UpdateTaskInput { deadline_date: Option<String>, deadline_alert_days: Option<i64>, clear_deadline: bool, clear_deadline_alert: bool }`. Sets apply before clears, and `clear_deadline` also nulls the alert.
  - `TaskSearchFilters { deadline: Option<String> }` (`"any" | "today" | "this_week" | "passed"`)
  - `db::tasks::get_local_tasks_due_or_deadline(pool, date: &str, include_completed: bool) -> Result<Vec<LocalTask>>`
  - `db::tasks::get_tasks_with_deadline_by(pool, date: &str) -> Result<Vec<LocalTask>>` (open only)
  - `db::task_search::search_tasks_on(pool, query, filters, limit, today: NaiveDate)`
  - Tauri: `create_local_task(…, deadline_date, deadline_alert_days)`, `update_local_task(…, deadline_date, deadline_alert_days, clear_deadline, clear_deadline_alert)`, `get_local_tasks(…, include_deadlines)`
  - Recurrence: completing a recurring task shifts `deadline_date` by the due-date delta, in the same write, with `"deadline_date"` in `changed_columns` and the observer fields.

- [ ] **Step 1: Write the pure module with its tests**

Create `nimble-core/src/deadline.rs`:

```rust
//! Deadline field (schema v28, spec 2026-09-25-deadline-field-design.md):
//! "must be done by", a floating calendar date (`YYYY-MM-DD`, no time, no
//! zone). Pure helpers shared by task writes, the Todoist mapping, the brief
//! and alerts. Day counts use `NaiveDate`, so DST never shifts them.

use chrono::NaiveDate;

pub const ALERT_OFF: i64 = -1;
pub const MAX_ALERT_DAYS: i64 = 14;

/// A real `YYYY-MM-DD` date and nothing else ("2026-02-30",
/// "2026-10-31T09:00", "2026-1-5" and "" are all None).
pub fn parse(date: &str) -> Option<NaiveDate> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    (d.format("%Y-%m-%d").to_string() == date).then_some(d)
}

/// Checks the values a write brings in, never the stored row, so a bad value
/// already on disk (an old import) can't block editing other fields.
pub fn validate_input(date: Option<&str>, alert_days: Option<i64>) -> crate::Result<()> {
    if date.is_some_and(|d| parse(d).is_none()) {
        return Err(crate::Error::Other("invalid_deadline: a deadline must be a real YYYY-MM-DD date".into()));
    }
    if alert_days.is_some_and(|n| !(ALERT_OFF..=MAX_ALERT_DAYS).contains(&n)) {
        return Err(crate::Error::Other(
            "invalid_deadline_alert: a deadline alert is -1 (off) or 0–14 days before".into(),
        ));
    }
    Ok(())
}

/// The row a write would leave: an alert override needs a deadline.
pub fn validate_row(date: Option<&str>, alert_days: Option<i64>) -> crate::Result<()> {
    if alert_days.is_some() && date.is_none() {
        return Err(crate::Error::Other("invalid_deadline_alert: a deadline alert needs a deadline".into()));
    }
    Ok(())
}

/// Recurrence (spec §9): the deadline moves by the due date's delta. A value
/// that doesn't parse is left as it is.
pub fn shift(deadline: Option<&str>, before_due: NaiveDate, after_due: NaiveDate) -> Option<String> {
    let raw = deadline?;
    Some(match parse(raw) {
        Some(d) => (d + (after_due - before_due)).format("%Y-%m-%d").to_string(),
        None => raw.to_string(),
    })
}

/// Deadline day minus today (negative = passed); None when it doesn't parse.
pub fn days_until(deadline: &str, today: NaiveDate) -> Option<i64> {
    parse(deadline).map(|d| (d - today).num_days())
}

/// Todoist's `deadline.date`, cut to its date part like due dates. A value
/// that still isn't a real date is dropped, never stored.
pub fn from_todoist(raw: &str) -> Option<String> {
    let cut: String = raw.chars().take(10).collect();
    parse(&cut).map(|_| cut)
}

/// Mac alert body (spec §6): "Due today", "Due tomorrow", "Due by Thu, Oct 8".
pub fn alert_body(deadline: NaiveDate, today: NaiveDate) -> String {
    match (deadline - today).num_days() {
        0 => "Due today".into(),
        1 => "Due tomorrow".into(),
        _ => format!("Due by {}", deadline.format("%a, %b %-d")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn only_real_iso_dates_parse() {
        assert_eq!(parse("2026-10-31"), Some(d("2026-10-31")));
        assert_eq!(parse("2028-02-29"), Some(d("2028-02-29")));
        for bad in ["2026-02-30", "2026-10-31T09:00", "2026-1-5", "", " 2026-10-31", "10/31/2026", "soon"] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn input_and_row_validation() {
        for ok in [-1, 0, 2, 14] { assert!(validate_input(Some("2026-10-31"), Some(ok)).is_ok(), "{ok}"); }
        for bad in [-2, 15] { assert!(validate_input(Some("2026-10-31"), Some(bad)).is_err(), "{bad}"); }
        assert!(validate_input(Some("2026-02-30"), None).is_err());
        assert!(validate_input(None, None).is_ok());
        assert!(validate_row(None, Some(2)).is_err(), "an alert needs a deadline");
        assert!(validate_row(Some("2026-10-31"), Some(2)).is_ok());
        assert!(validate_row(None, None).is_ok());
    }

    #[test]
    fn shift_moves_by_the_due_delta_across_dst() {
        assert_eq!(shift(Some("2026-10-24"), d("2026-10-18"), d("2026-11-01")).as_deref(), Some("2026-11-07"));
        assert_eq!(shift(Some("2026-10-31"), d("2026-10-30"), d("2026-11-02")).as_deref(), Some("2026-11-03"));
        assert_eq!(shift(None, d("2026-10-18"), d("2026-11-01")), None);
        assert_eq!(shift(Some("soon"), d("2026-10-18"), d("2026-11-01")).as_deref(), Some("soon"));
    }

    #[test]
    fn todoist_values_are_cut_to_the_date() {
        assert_eq!(from_todoist("2026-10-31").as_deref(), Some("2026-10-31"));
        assert_eq!(from_todoist("2026-10-31T09:00:00Z").as_deref(), Some("2026-10-31"));
        assert_eq!(from_todoist("2026-02-30"), None);
        assert_eq!(from_todoist("soon"), None);
    }

    #[test]
    fn days_and_alert_copy() {
        assert_eq!(days_until("2026-11-02", d("2026-10-31")), Some(2), "DST weekend is still 2 days");
        assert_eq!(days_until("2026-10-29", d("2026-10-31")), Some(-2));
        assert_eq!(alert_body(d("2026-10-06"), d("2026-10-06")), "Due today");
        assert_eq!(alert_body(d("2026-10-07"), d("2026-10-06")), "Due tomorrow");
        assert_eq!(alert_body(d("2026-10-08"), d("2026-10-06")), "Due by Thu, Oct 8");
    }
}
```

In `nimble-core/src/lib.rs`, add `pub mod deadline;` after `pub mod db;`.

- [ ] **Step 2: Write the failing write/query tests**

Append to `nimble-core/src/db/tasks.rs`:

```rust
#[cfg(test)]
mod deadline_tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::types::{CreateTaskInput, UpdateTaskInput};

    fn d(s: &str) -> chrono::NaiveDate { chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    async fn row(pool: &SqlitePool, id: &str) -> LocalTask {
        sqlx::query_as::<_, LocalTask>(&format!("SELECT {SELECT_COLS} FROM local_tasks WHERE id = ?"))
            .bind(id).fetch_one(pool).await.unwrap()
    }

    async fn last_changed(pool: &SqlitePool, id: &str) -> Vec<String> {
        let raw: String = sqlx::query_scalar(
            "SELECT changed_columns FROM sync_log WHERE row_id = ? AND operation = 'UPDATE' ORDER BY rowid DESC LIMIT 1",
        ).bind(id).fetch_one(pool).await.unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[tokio::test]
    async fn create_update_and_clear_a_deadline() {
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput {
            content: "File COBRA election".into(),
            due_date: Some("2026-10-27".into()),
            deadline_date: Some("2026-10-31".into()),
            deadline_alert_days: Some(3),
            ..Default::default()
        }).await.unwrap();
        assert_eq!((t.deadline_date.as_deref(), t.deadline_alert_days), (Some("2026-10-31"), Some(3)));

        // Sets before clears: a new date plus clear_deadline_alert keeps the date.
        let t = update_local_task(&pool, &t.id, UpdateTaskInput {
            deadline_date: Some("2026-11-02".into()), clear_deadline_alert: true, ..Default::default()
        }).await.unwrap();
        assert_eq!((t.deadline_date.as_deref(), t.deadline_alert_days), (Some("2026-11-02"), None));
        assert!(last_changed(&pool, &t.id).await.iter().any(|c| c == "deadline_date"));

        let t = update_local_task(&pool, &t.id, UpdateTaskInput { deadline_alert_days: Some(-1), ..Default::default() })
            .await.unwrap();
        assert_eq!(t.deadline_alert_days, Some(-1));

        // clear_deadline also clears the alert override (like clear_due_date and the reminder).
        let t = update_local_task(&pool, &t.id, UpdateTaskInput { clear_deadline: true, ..Default::default() })
            .await.unwrap();
        assert_eq!((t.deadline_date.clone(), t.deadline_alert_days), (None, None));
        let changed = last_changed(&pool, &t.id).await;
        assert!(changed.contains(&"deadline_date".to_string()) && changed.contains(&"deadline_alert_days".to_string()));
        assert_eq!(t.due_date.as_deref(), Some("2026-10-27"), "the due date is independent");

        let fields = activity_fields(&UpdateTaskInput { clear_deadline: true, ..Default::default() }, &t);
        assert_eq!(fields, ["deadline_date", "deadline_alert_days"]);
    }

    /// Review Focus 5.
    #[tokio::test]
    async fn invalid_deadline_input_is_rejected_and_nothing_changes() {
        let pool = test_pool().await;
        for bad in ["2026-02-30", "2026-10-31T09:00", "", "10/31/2026"] {
            let r = create_local_task(&pool, CreateTaskInput {
                content: "x".into(), deadline_date: Some(bad.into()), ..Default::default()
            }).await;
            assert!(r.is_err(), "{bad:?}");
        }
        let r = create_local_task(&pool, CreateTaskInput {
            content: "x".into(), deadline_alert_days: Some(2), ..Default::default()
        }).await;
        assert!(r.is_err(), "an alert needs a deadline");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_tasks").fetch_one(&pool).await.unwrap();
        assert_eq!(n, 0, "nothing was written");

        let t = create_local_task(&pool, CreateTaskInput {
            content: "ok".into(), deadline_date: Some("2026-10-31".into()), ..Default::default()
        }).await.unwrap();
        for bad in [-2, 15] {
            assert!(update_local_task(&pool, &t.id, UpdateTaskInput { deadline_alert_days: Some(bad), ..Default::default() }).await.is_err());
        }
        assert!(update_local_task(&pool, &t.id, UpdateTaskInput { deadline_date: Some("2026-13-01".into()), ..Default::default() }).await.is_err());
        assert_eq!(row(&pool, &t.id).await.deadline_date.as_deref(), Some("2026-10-31"));

        // A bad value already on disk never blocks an unrelated edit.
        sqlx::query("UPDATE local_tasks SET deadline_date = 'soon' WHERE id = ?").bind(&t.id).execute(&pool).await.unwrap();
        let t = update_local_task(&pool, &t.id, UpdateTaskInput { content: Some("renamed".into()), ..Default::default() })
            .await.unwrap();
        assert_eq!((t.content.as_str(), t.deadline_date.as_deref()), ("renamed", Some("soon")));
    }

    #[tokio::test]
    async fn completing_a_recurring_task_moves_its_deadline_with_the_due_date() {
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput {
            content: "Certify EDD".into(),
            due_date: Some("2026-10-18".into()),
            recurrence_rule: Some("every 2 weeks".into()),
            deadline_date: Some("2026-10-24".into()),
            ..Default::default()
        }).await.unwrap();
        update_task_status_at(&pool, &t.id, "complete", None, d("2026-10-18")).await.unwrap();
        let after = row(&pool, &t.id).await;
        assert_eq!((after.due_date.as_deref(), after.deadline_date.as_deref()), (Some("2026-11-01"), Some("2026-11-07")));
        assert!(last_changed(&pool, &t.id).await.contains(&"deadline_date".to_string()));

        // No due date: the rule is inert, the task completes and keeps its deadline.
        let u = create_local_task(&pool, CreateTaskInput {
            content: "Undated".into(), recurrence_rule: Some("every week".into()),
            deadline_date: Some("2026-10-24".into()), ..Default::default()
        }).await.unwrap();
        update_task_status_at(&pool, &u.id, "complete", None, d("2026-10-18")).await.unwrap();
        let after = row(&pool, &u.id).await;
        assert!(after.completed);
        assert_eq!(after.deadline_date.as_deref(), Some("2026-10-24"), "completing never clears the deadline");
    }

    #[tokio::test]
    async fn due_or_deadline_and_deadline_by_lists() {
        let pool = test_pool().await;
        let mk = |c: &str, due: Option<&str>, dl: Option<&str>| CreateTaskInput {
            content: c.into(), due_date: due.map(Into::into), deadline_date: dl.map(Into::into), ..Default::default()
        };
        for input in [
            mk("due today", Some("2026-10-31"), None),
            mk("deadline today, due later", Some("2026-11-05"), Some("2026-10-31")),
            mk("deadline only, passed", None, Some("2026-10-20")),
            mk("both later", Some("2026-11-01"), Some("2026-11-02")),
            mk("undated", None, None),
        ] {
            create_local_task(&pool, input).await.unwrap();
        }
        let titles = |v: Vec<LocalTask>| v.into_iter().map(|t| t.content).collect::<Vec<_>>();
        assert_eq!(
            titles(get_local_tasks_due_or_deadline(&pool, "2026-10-31", false).await.unwrap()),
            ["deadline only, passed", "due today", "deadline today, due later"],
            "ordered by the earlier of the two dates"
        );
        assert_eq!(
            titles(get_tasks_with_deadline_by(&pool, "2026-10-31").await.unwrap()),
            ["deadline only, passed", "deadline today, due later"]
        );
        // The due list keeps its meaning.
        assert_eq!(titles(get_local_tasks(&pool, None, Some("2026-10-31"), false).await.unwrap()), ["due today"]);
    }

    #[tokio::test]
    async fn undo_restore_keeps_the_deadline() {
        let pool = test_pool().await;
        let t = create_local_task(&pool, CreateTaskInput {
            content: "x".into(), deadline_date: Some("2026-10-31".into()), deadline_alert_days: Some(0), ..Default::default()
        }).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let effects = crate::db::task_tx::delete_task_tx(&mut tx, &t.id, crate::db::task_tx::MutationPolicy::User).await.unwrap();
        crate::db::task_tx::restore_deleted_tasks_tx(&mut tx, &effects.deleted).await.unwrap();
        tx.commit().await.unwrap();
        let back = row(&pool, &t.id).await;
        assert_eq!((back.deadline_date.as_deref(), back.deadline_alert_days), (Some("2026-10-31"), Some(0)));
    }
}
```

Append inside `nimble-core/src/db/task_search.rs`'s `mod tests`:

```rust
    #[tokio::test]
    async fn filters_by_deadline_window() {
        let pool = test_pool().await;
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 25).unwrap();
        for (title, dl) in [
            ("Form today", Some("2026-10-25")),
            ("Form sixth day", Some("2026-10-31")),
            ("Form next week", Some("2026-11-01")),
            ("Form passed", Some("2026-10-20")),
            ("Form none", None),
        ] {
            create_local_task(&pool, crate::types::CreateTaskInput {
                content: title.into(), deadline_date: dl.map(Into::into), ..Default::default()
            }).await.unwrap();
        }
        let done = create_local_task(&pool, crate::types::CreateTaskInput {
            content: "Form passed done".into(), deadline_date: Some("2026-10-19".into()), ..Default::default()
        }).await.unwrap();
        update_task_status(&pool, &done.id, "complete", None).await.unwrap();

        async fn hits(pool: &SqlitePool, f: &str, today: chrono::NaiveDate) -> Vec<String> {
            let filters = TaskSearchFilters { deadline: Some(f.into()), ..Default::default() };
            let mut t: Vec<String> = search_tasks_on(pool, "form", &filters, DEFAULT_LIMIT, today).await.unwrap()
                .into_iter().map(|h| h.task.content).collect();
            t.sort();
            t
        }
        assert_eq!(hits(&pool, "any", today).await, ["Form next week", "Form passed", "Form passed done", "Form sixth day", "Form today"]);
        assert_eq!(hits(&pool, "today", today).await, ["Form today"]);
        assert_eq!(hits(&pool, "this_week", today).await, ["Form sixth day", "Form today"]);
        assert_eq!(hits(&pool, "passed", today).await, ["Form passed"], "open only");
        let bad = TaskSearchFilters { deadline: Some("soon".into()), ..Default::default() };
        assert!(search_tasks_on(&pool, "form", &bad, DEFAULT_LIMIT, today).await.is_err());
    }
```

(`create_local_task`, `update_task_status`, `SqlitePool`, `TaskSearchFilters` and `DEFAULT_LIMIT` are already imported in that test module; if the compiler says otherwise, add `use crate::db::tasks::{create_local_task, update_task_status};` to match the neighbours.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline deadline 2>&1 | tail -20`
Expected: compile errors (no field `deadline_date` on `CreateTaskInput`, no `get_local_tasks_due_or_deadline`, no `search_tasks_on`). The pure `deadline::tests` compile once the input types exist.

- [ ] **Step 4: Add the input and filter fields**

In `nimble-core/src/types.rs`:

`CreateTaskInput`, after `pub google_calendar_enabled: Option<bool>,`:

```rust
    #[serde(default)]
    pub deadline_date: Option<String>,
    #[serde(default)]
    pub deadline_alert_days: Option<i64>,
```

`UpdateTaskInput`, after `pub clear_reminder: bool,`:

```rust
    #[serde(default)]
    pub deadline_date: Option<String>,
    #[serde(default)]
    pub deadline_alert_days: Option<i64>,
    /// Also clears `deadline_alert_days` (as `clear_due_date` clears the reminder).
    #[serde(default)]
    pub clear_deadline: bool,
    #[serde(default)]
    pub clear_deadline_alert: bool,
```

`TaskSearchFilters`, after `pub project_id: Option<String>,`:

```rust
    /// "any" | "today" | "this_week" (today…+6) | "passed" (open tasks only).
    #[serde(default)]
    pub deadline: Option<String>,
```

- [ ] **Step 5: Wire create, update, recurrence and restore in `task_tx.rs`**

In `create_task_with_id_tx`, directly after the `validate_reminder(…)?;` call:

```rust
    crate::deadline::validate_input(input.deadline_date.as_deref(), input.deadline_alert_days)?;
    crate::deadline::validate_row(input.deadline_date.as_deref(), input.deadline_alert_days)?;
```

Replace its INSERT with:

```rust
    sqlx::query("INSERT INTO local_tasks (id,parent_id,content,description,project_id,priority,due_date,due_time,duration_minutes,recurrence_rule,section_id,reminder_offset_minutes,google_calendar_enabled,position,sync_policy,deadline_date,deadline_alert_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&id).bind(&input.parent_id).bind(&input.content).bind(&input.description).bind(project)
        .bind(input.priority.unwrap_or(1)).bind(&input.due_date).bind(&input.due_time).bind(input.duration_minutes)
        .bind(&input.recurrence_rule).bind(&input.section_id).bind(input.reminder_offset_minutes)
        .bind(input.google_calendar_enabled.unwrap_or(false)).bind(pos).bind(sync_policy)
        .bind(&input.deadline_date).bind(input.deadline_alert_days)
        .execute(&mut *conn).await?;
```

In `update_task_tx`, directly after the `recurrence_locked` early return:

```rust
    crate::deadline::validate_input(input.deadline_date.as_deref(), input.deadline_alert_days)?;
```

After the `if let Some(v) = input.google_calendar_enabled { … }` block (the last *set*):

```rust
    if let Some(v) = &input.deadline_date {
        next.deadline_date = Some(v.clone());
        fields.push("deadline_date".into());
    }
    if let Some(v) = input.deadline_alert_days {
        next.deadline_alert_days = Some(v);
        fields.push("deadline_alert_days".into());
    }
```

After the `if input.clear_reminder || input.clear_due_date || input.clear_due_time { … }` block (the last *clear*):

```rust
    if input.clear_deadline {
        next.deadline_date = None;
        next.deadline_alert_days = None;
        fields.extend(["deadline_date".into(), "deadline_alert_days".into()]);
    }
    if input.clear_deadline_alert {
        next.deadline_alert_days = None;
        fields.push("deadline_alert_days".into());
    }
```

Directly after the `validate_reminder(next.reminder_offset_minutes, …)?;` call:

```rust
    crate::deadline::validate_row(next.deadline_date.as_deref(), next.deadline_alert_days)?;
```

Replace its UPDATE with:

```rust
    sqlx::query("UPDATE local_tasks SET content=?,description=?,project_id=?,priority=?,due_date=?,due_time=?,duration_minutes=?,recurrence_rule=?,section_id=?,linked_doc_id=?,reminder_offset_minutes=?,google_calendar_enabled=?,sync_policy=?,deadline_date=?,deadline_alert_days=?,updated_at=datetime('now') WHERE id=?")
        .bind(&next.content).bind(&next.description).bind(&next.project_id).bind(next.priority)
        .bind(&next.due_date).bind(&next.due_time).bind(next.duration_minutes).bind(&next.recurrence_rule)
        .bind(&next.section_id).bind(&next.linked_doc_id).bind(next.reminder_offset_minutes)
        .bind(next.google_calendar_enabled).bind(&next.sync_policy)
        .bind(&next.deadline_date).bind(next.deadline_alert_days)
        .bind(id).execute(&mut *conn).await?;
```

In `set_status_tx`'s recurrence branch, replace from `let due_time = rule.time.or(before.due_time.clone());` through the `let fields = vec![ … ];` literal with:

```rust
                let due_time = rule.time.or(before.due_time.clone());
                // Spec §9: the deadline moves by the same number of days.
                let deadline = crate::deadline::shift(before.deadline_date.as_deref(), due, next);
                sqlx::query("UPDATE local_tasks SET due_date=?,due_time=?,deadline_date=?,status='todo',completed=0,completed_at=NULL,updated_at=datetime('now','localtime') WHERE id=?")
                    .bind(&next_str).bind(due_time).bind(&deadline).bind(id).execute(&mut *conn).await?;
                let task = fetch(conn, id).await?;
                if policy != MutationPolicy::Remote {
                    let mut fields: Vec<String> = vec![
                        "due_date".into(),
                        "due_time".into(),
                        "status".into(),
                        "completed".into(),
                        "completed_at".into(),
                    ];
                    if deadline != before.deadline_date {
                        fields.push("deadline_date".into());
                    }
```

(The rest of that branch — the `sync_task(…)`, observer call, karma hook and `RecurrenceEffect` — is unchanged.)

In `restore_deleted_tasks_tx`, replace the INSERT with:

```rust
        sqlx::query("INSERT INTO local_tasks(id,parent_id,content,description,project_id,priority,due_date,due_time,duration_minutes,recurrence_rule,section_id,reminder_offset_minutes,google_calendar_enabled,completed,completed_at,status,linked_doc_id,position,created_at,updated_at,external_id,external_source,remote_updated_at,synced_snapshot,sync_policy,deadline_date,deadline_alert_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&task.id).bind(&task.parent_id).bind(&task.content).bind(&task.description)
            .bind(&task.project_id).bind(task.priority).bind(&task.due_date).bind(&task.due_time)
            .bind(task.duration_minutes).bind(&task.recurrence_rule).bind(&task.section_id)
            .bind(task.reminder_offset_minutes).bind(task.google_calendar_enabled).bind(task.completed)
            .bind(&task.completed_at).bind(&task.status).bind(&task.linked_doc_id).bind(task.position)
            .bind(&task.created_at).bind(&task.updated_at).bind(&task.external_id).bind(&task.external_source)
            .bind(&task.remote_updated_at).bind(&task.synced_snapshot).bind(&task.sync_policy)
            .bind(&task.deadline_date).bind(task.deadline_alert_days)
            .execute(&mut *conn).await?;
```

- [ ] **Step 6: Activity fields and the two list queries in `tasks.rs`**

In `activity_fields`, before `if input.label_ids.is_some() { fields.push("labels"); }`:

```rust
    if input.deadline_date.is_some() || input.clear_deadline { fields.push("deadline_date"); }
    if input.deadline_alert_days.is_some() || input.clear_deadline_alert || input.clear_deadline { fields.push("deadline_alert_days"); }
```

Replace the label-loading tail of `get_local_tasks` (from `// Batch-load labels for every returned task …` to `Ok(rows)`) with `with_labels(pool, rows).await`, change `let mut rows` to `let rows`, and add below the function:

```rust
/// Attach each task's label ids with one aggregate query, never one per row:
/// these lists hold hundreds of tasks.
async fn with_labels(pool: &SqlitePool, mut rows: Vec<LocalTask>) -> crate::Result<Vec<LocalTask>> {
    let label_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT task_id, label_id FROM task_labels ORDER BY rowid")
            .fetch_all(pool)
            .await?;
    let mut labels_by_task: HashMap<String, Vec<String>> = HashMap::new();
    for (task_id, label_id) in label_rows {
        labels_by_task.entry(task_id).or_default().push(label_id);
    }
    for task in rows.iter_mut() {
        if let Some(ids) = labels_by_task.remove(&task.id) {
            task.labels = ids;
        }
    }
    Ok(rows)
}

/// Tasks due OR with a deadline on or before `date`: Today's Due today and
/// Still open (spec §5). Ordered by the earlier of the two dates. The web
/// mirrors this statement exactly (`services/turso/tasks.ts`).
pub async fn get_local_tasks_due_or_deadline(
    pool: &SqlitePool,
    date: &str,
    include_completed: bool,
) -> crate::Result<Vec<LocalTask>> {
    let open = if include_completed { "" } else { " AND completed = 0" };
    let sql = format!(
        "SELECT {SELECT_COLS} FROM local_tasks WHERE ((due_date IS NOT NULL AND due_date <= ?) OR (deadline_date IS NOT NULL AND deadline_date <= ?)){open} ORDER BY MIN(COALESCE(due_date, deadline_date), COALESCE(deadline_date, due_date)), priority DESC, position"
    );
    let rows = sqlx::query_as::<_, LocalTask>(&sql).bind(date).bind(date).fetch_all(pool).await?;
    with_labels(pool, rows).await
}

/// Open tasks whose deadline is on or before `date` (`dt task list --deadline`).
pub async fn get_tasks_with_deadline_by(pool: &SqlitePool, date: &str) -> crate::Result<Vec<LocalTask>> {
    let sql = format!(
        "SELECT {SELECT_COLS} FROM local_tasks WHERE deadline_date IS NOT NULL AND deadline_date <= ? AND completed = 0 ORDER BY deadline_date, priority DESC, position"
    );
    let rows = sqlx::query_as::<_, LocalTask>(&sql).bind(date).fetch_all(pool).await?;
    with_labels(pool, rows).await
}
```

- [ ] **Step 7: The search filter**

In `nimble-core/src/db/task_search.rs`, rename `pub async fn search_tasks(` to `pub async fn search_tasks_on(`, add a trailing parameter `today: chrono::NaiveDate`, and add above it:

```rust
/// Ranked search on the Mac's local date (see `search_tasks_on`).
pub async fn search_tasks(
    pool: &SqlitePool,
    query: &str,
    filters: &TaskSearchFilters,
    limit: i64,
) -> crate::Result<Vec<TaskSearchHit>> {
    search_tasks_on(pool, query, filters, limit, chrono::Local::now().date_naive()).await
}

/// The Omnibar deadline pill: `any`, `today`, `this_week` (today…+6), `passed`
/// (open tasks only). Same predicate as `lib/deadline.ts` `matchesDeadline`
/// and the web's LIKE path.
fn deadline_clause(filter: Option<&str>, today: chrono::NaiveDate) -> crate::Result<(&'static str, Vec<String>)> {
    let day = |n: i64| (today + chrono::Duration::days(n)).format("%Y-%m-%d").to_string();
    Ok(match filter {
        None => ("", vec![]),
        Some("any") => (" AND t.deadline_date IS NOT NULL", vec![]),
        Some("today") => (" AND t.deadline_date = ?", vec![day(0)]),
        Some("this_week") => (" AND t.deadline_date >= ? AND t.deadline_date <= ?", vec![day(0), day(6)]),
        Some("passed") => (" AND t.deadline_date < ? AND t.status != 'complete'", vec![day(0)]),
        Some(other) => return Err(crate::Error::Other(format!("unknown deadline filter '{other}'"))),
    })
}
```

Inside `search_tasks_on`, directly after the `let status_clause = match … ;` statement:

```rust
    let (deadline_sql, deadline_args) = deadline_clause(filters.deadline.as_deref(), today)?;
```

After the `if !filters.label_ids.is_empty() { … }` block that appends the label SQL, add `sql.push_str(deadline_sql);`. After the `for id in &filters.label_ids { q = q.bind(id); }` loop, add:

```rust
    for arg in &deadline_args {
        q = q.bind(arg);
    }
```

- [ ] **Step 8: Keep the workspace compiling (Tauri commands, `dt` literals)**

In `apps/desktop/src-tauri/src/commands/local_tasks.rs`:

`get_local_tasks` gains `include_deadlines: Option<bool>,` after `include_completed`. Its body becomes:

```rust
    let pool = app.state::<SqlitePool>();
    let include_completed = include_completed.unwrap_or(false);
    if include_deadlines.unwrap_or(false) {
        if let Some(date) = due_date.as_deref() {
            return nimble_core::db::tasks::get_local_tasks_due_or_deadline(pool.inner(), date, include_completed)
                .await
                .map_err(|e| e.to_string());
        }
    }
    nimble_core::db::tasks::get_local_tasks(
        pool.inner(),
        project_id.as_deref(),
        due_date.as_deref(),
        include_completed,
    )
    .await
    .map_err(|e| e.to_string())
```

`create_local_task` gains `deadline_date: Option<String>, deadline_alert_days: Option<i64>,` before `command_id`, and its `CreateTaskInput { … }` literal gains `deadline_date, deadline_alert_days,`.

`update_local_task` gains `deadline_date: Option<String>, deadline_alert_days: Option<i64>, clear_deadline: Option<bool>, clear_deadline_alert: Option<bool>,` before `command_id`, and its `UpdateTaskInput { … }` literal gains:

```rust
            deadline_date,
            deadline_alert_days,
            clear_deadline: clear_deadline.unwrap_or(false),
            clear_deadline_alert: clear_deadline_alert.unwrap_or(false),
```

In `tools/dt/src/commands/mod.rs`, add `deadline_date: None, deadline_alert_days: None,` to the `CreateTaskInput { … }` literal in `create_input` (Task 6 replaces them with the flags), and `deadline: None,` to the `TaskSearchFilters { … }` literal in `Task::Search`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline deadline && cargo test -p nimble-core --offline task_search && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: all `ok`, including the existing recurrence tests in `db::tasks` (`recurrence_reschedule_logs_sync_with_exact_fields_changed` must still pass; a task without a deadline never gets `deadline_date` in its changed columns).

- [ ] **Step 10: Commit**

```bash
git add nimble-core/src/deadline.rs nimble-core/src/lib.rs nimble-core/src/types.rs nimble-core/src/db/task_tx.rs nimble-core/src/db/tasks.rs nimble-core/src/db/task_search.rs apps/desktop/src-tauri/src/commands/local_tasks.rs tools/dt/src/commands/mod.rs
git commit -m "feat(deadline): task writes, validation, recurrence shift, due-or-deadline list, search filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 3: Todoist round-trip — pull, merge, push, one-time backfill pull, importers

**Files:**
- Modify: `nimble-core/src/integrations/todoist/client.rs` (`TodoistDeadline`, `TodoistItem.deadline`)
- Modify: `nimble-core/src/integrations/todoist/mappers.rs` (`TaskSnapshot.deadline_date`, `item_to_snapshot`, `local_to_snapshot`, tests)
- Modify: `nimble-core/src/integrations/todoist/merge.rs` (`MergePlan.deadline_date`, `merge_task`, test)
- Modify: `nimble-core/src/integrations/todoist/observer.rs` (`task_create_payload`, both `Updated` mappers, `on_turso_row_applied_with_status` field list, test)
- Modify: `nimble-core/src/integrations/todoist/sync_loop.rs` (`build_commands`, deadline helpers, `push_outbox`, `apply_pull_tx` insert + update, `pull_token`, `run_sync_with_focus`, tests)
- Modify: `nimble-core/src/integrations/todoist/reconcile.rs` (test only: the reconcile's final pull is `apply_pull`)
- Modify: `nimble-core/src/integrations/todoist/history.rs` (`apply_tx` INSERT, fixture, assertion)
- Modify: `nimble-core/src/api/todoist_migration.rs` (`TdDeadline`, `TdTask.deadline`, UPDATE/INSERT, tests)

**Interfaces:**
- Consumes: `LocalTask.deadline_date` (Task 1); `crate::deadline::from_todoist` (Task 2).
- Produces:
  - `client::TodoistDeadline { date: Option<String> }`; `TodoistItem.deadline: Option<TodoistDeadline>`
  - `mappers::TaskSnapshot.deadline_date: Option<String>` (`#[serde(default)]`: stored bases read as None)
  - `merge::MergePlan.deadline_date: Option<Option<String>>`
  - Outbox payload key `"deadline_date"` (string or null) on `create` and `update`
  - `sync_loop::deadline_command_uuid(&str) -> String`, `sync_loop::deadline_refusals(&[OutboxRow], &HashMap<String, Value>) -> Vec<(&OutboxRow, bool)>`, `sync_loop::pull_token(pool, Option<String>) -> Result<(String, bool)>`, `sync_loop::DEADLINE_BACKFILL_SETTING = "todoist_deadline_backfill_v28"`
  - Activity `nimble_gap` with `{"reason": "Todoist refused this task's deadline; it stays in Nimble only.", "source": "todoist_sync"}` when Todoist refuses

- [ ] **Step 1: Write the failing tests**

In `mappers.rs` `mod tests`, append:

```rust
    /// Review Focus 5 (Todoist side).
    #[test]
    fn item_to_snapshot_maps_and_cuts_the_deadline() {
        let with = |v: serde_json::Value| -> crate::integrations::todoist::client::TodoistItem {
            serde_json::from_value(json!({"id": "R1", "content": "x", "deadline": v})).unwrap()
        };
        assert_eq!(item_to_snapshot(&with(json!({"date": "2026-10-31", "lang": "en"}))).deadline_date.as_deref(), Some("2026-10-31"));
        assert_eq!(item_to_snapshot(&with(json!({"date": "2026-10-31T09:00:00Z"}))).deadline_date.as_deref(), Some("2026-10-31"));
        assert_eq!(item_to_snapshot(&with(json!({"date": "soon"}))).deadline_date, None);
        assert_eq!(item_to_snapshot(&with(serde_json::Value::Null)).deadline_date, None);
        let bare: crate::integrations::todoist::client::TodoistItem =
            serde_json::from_value(json!({"id": "R1", "content": "x"})).unwrap();
        assert_eq!(item_to_snapshot(&bare).deadline_date, None);
        // A base stored before v28 has no key and reads as None.
        let old: TaskSnapshot = serde_json::from_value(json!({"content": "x"})).unwrap();
        assert_eq!(old.deadline_date, None);
    }
```

In `merge.rs` `mod tests`, append:

```rust
    #[test]
    fn deadline_merges_three_ways() {
        let base = TaskSnapshot { content: "a".into(), ..Default::default() };
        // Remote-only (the one-time backfill pull: the base predates v28).
        let remote = TaskSnapshot { deadline_date: Some("2026-10-31".into()), ..base.clone() };
        assert_eq!(merge_task(&base.clone(), Some(&base), &remote, None, None).deadline_date, Some(Some("2026-10-31".into())));
        // Local-only (Nimble set it, Todoist refused or hasn't seen it): keep local.
        let local = TaskSnapshot { deadline_date: Some("2026-11-01".into()), ..base.clone() };
        assert_eq!(merge_task(&local, Some(&base), &base.clone(), None, None).deadline_date, None);
        // Remote clear applies.
        let set = TaskSnapshot { deadline_date: Some("2026-10-31".into()), ..base.clone() };
        let cleared = merge_task(&set.clone(), Some(&set), &base.clone(), None, None);
        assert_eq!(cleared.deadline_date, Some(None));
        assert!(!cleared.is_empty());
    }
```

In `observer.rs` `mod tests`, append:

```rust
    #[tokio::test]
    async fn deadline_rides_create_update_and_turso_payloads() {
        let pool = test_pool().await;
        let t = crate::db::tasks::create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await.unwrap();
        activate(&pool).await;
        let created = crate::db::tasks::create_local_task(&pool, CreateTaskInput {
            content: "COBRA".into(), deadline_date: Some("2026-10-31".into()), ..Default::default()
        }).await.unwrap();
        crate::db::tasks::update_local_task(&pool, &t.id, UpdateTaskInput {
            deadline_date: Some("2026-10-31".into()), deadline_alert_days: Some(1), ..Default::default()
        }).await.unwrap();
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        let create = batch.iter().find(|r| r.local_id == created.id && r.op == "create").unwrap();
        assert_eq!(create.payload["deadline_date"], "2026-10-31");
        let update = batch.iter().find(|r| r.local_id == t.id && r.op == "update").unwrap();
        assert_eq!(update.payload["deadline_date"], "2026-10-31");
        assert!(update.payload.get("deadline_alert_days").is_none(), "the alert is Nimble-only");
        crate::db::tasks::update_local_task(&pool, &t.id, UpdateTaskInput { clear_deadline: true, ..Default::default() })
            .await.unwrap();
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        let update = batch.iter().find(|r| r.local_id == t.id && r.op == "update").unwrap();
        assert!(update.payload["deadline_date"].is_null(), "a clear pushes null");

        // A web edit (Turso apply) of a linked task sends its deadline too.
        sqlx::query("DELETE FROM todoist_outbox").execute(&pool).await.unwrap();
        sqlx::query("UPDATE local_tasks SET external_id = 'R9', external_source = 'todoist', deadline_date = '2026-11-02' WHERE id = ?")
            .bind(&t.id).execute(&pool).await.unwrap();
        on_turso_row_applied(&pool, "local_tasks", &t.id, None, None, false).await;
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        assert_eq!(batch.iter().find(|r| r.local_id == t.id).unwrap().payload["deadline_date"], "2026-11-02");
    }
```

In `sync_loop.rs`'s test module with `fn row(…)` / `ctx_with(…)` (the `build_commands` tests), append:

```rust
    #[test]
    fn deadline_travels_as_its_own_item_update() {
        // Mixed update: the main command never carries the deadline.
        let rows = vec![row("update", "t1", json!({"content": "c", "deadline_date": "2026-10-31"}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds.len(), 2);
        assert_eq!((cmds[0]["uuid"].as_str(), cmds[0]["args"]["content"].as_str()), (Some("uuid-update-t1"), Some("c")));
        assert!(cmds[0]["args"].get("deadline").is_none());
        assert_eq!(cmds[1]["type"], "item_update");
        assert_eq!(cmds[1]["uuid"], deadline_command_uuid("uuid-update-t1"));
        assert_eq!(cmds[1]["args"], json!({"id": "EXT-T1", "deadline": {"date": "2026-10-31"}}));

        // Deadline-only update (a clear): one command, the row's own uuid, null.
        let rows = vec![row("update", "t1", json!({"deadline_date": null}), None)];
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0]["uuid"], "uuid-update-t1");
        assert_eq!(cmds[0]["args"], json!({"id": "EXT-T1", "deadline": null}));

        // Create: item_add without it, then an item_update on the temp id.
        let rows = vec![row("create", "t2", json!({"content": "c", "project_local_id": "p1", "deadline_date": "2026-10-31"}), Some("tmp-t2"))];
        let ctx = ctx_with(&[("t2", None)], &[("p1", "EXT-P1")]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0]["type"], "item_add");
        assert!(cmds[0]["args"].get("deadline").is_none());
        assert_eq!(cmds[1]["args"], json!({"id": "tmp-t2", "deadline": {"date": "2026-10-31"}}));
        // No deadline: nothing extra.
        let rows = vec![row("create", "t3", json!({"content": "c", "deadline_date": null}), Some("tmp-t3"))];
        assert_eq!(build_commands(&rows, &ctx_with(&[("t3", None)], &[])).0.len(), 1);
    }

    #[test]
    fn deadline_command_uuid_is_stable_distinct_and_valid() {
        let base = "5b6f3c1e-2a4d-4e8f-9c0b-1d2e3f4a5b6c";
        let derived = deadline_command_uuid(base);
        assert_ne!(derived, base);
        assert_eq!(derived, deadline_command_uuid(base), "a resend reuses it");
        assert!(uuid::Uuid::parse_str(&derived).is_ok());
        assert_eq!(deadline_command_uuid("uuid-update-t1"), "uuid-update-t1-deadline");
    }

    /// Review Focus 3.
    #[test]
    fn deadline_refusal_is_reported_per_row() {
        let mixed = row("update", "a", json!({"content": "c", "deadline_date": "2026-10-31"}), None);
        let only = row("update", "b", json!({"deadline_date": "2026-10-31"}), None);
        let failed = row("update", "c", json!({"content": "c", "deadline_date": "2026-10-31"}), None);
        let fine = row("update", "d", json!({"content": "c", "deadline_date": "2026-10-31"}), None);
        let refused = json!({"error": "Premium only", "error_code": 43});
        let status: HashMap<String, serde_json::Value> = [
            (mixed.command_uuid.clone(), json!("ok")),
            (deadline_command_uuid(&mixed.command_uuid), refused.clone()),
            (only.command_uuid.clone(), refused.clone()),
            (failed.command_uuid.clone(), refused.clone()),
            (deadline_command_uuid(&failed.command_uuid), refused.clone()),
            (fine.command_uuid.clone(), json!("ok")),
            (deadline_command_uuid(&fine.command_uuid), json!("ok")),
        ].into_iter().collect();
        let rows = vec![mixed, only, failed, fine];
        let got: Vec<(&str, bool)> = deadline_refusals(&rows, &status).into_iter().map(|(r, own)| (r.local_id.as_str(), own)).collect();
        assert_eq!(got, vec![("a", false), ("b", true)], "c's main command failed on its own; d went through");
    }
```

In the `sync_loop.rs` test module holding the async pull tests (the one with `fn resp(v)` and `pull_applies_remote_label_change_without_echo`), append:

```rust
    async fn linked(pool: &sqlx::SqlitePool, ext: &str) -> crate::types::LocalTask {
        crate::db::tasks::get_local_tasks(pool, None, None, true).await.unwrap()
            .into_iter().find(|t| t.external_id.as_deref() == Some(ext)).unwrap()
    }

    #[tokio::test]
    async fn pull_maps_the_deadline_on_create_change_and_clear() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false,
             "deadline": {"date": "2026-10-31", "lang": "en"}}
        ]}))).await.unwrap();
        assert_eq!(linked(&pool, "R1").await.deadline_date.as_deref(), Some("2026-10-31"));
        sqlx::query("UPDATE local_tasks SET deadline_alert_days = 1 WHERE external_id = 'R1'").execute(&pool).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false, "deadline": null,
             "updated_at": "2026-10-01T12:00:00Z"}
        ]}))).await.unwrap();
        let t = linked(&pool, "R1").await;
        assert_eq!((t.deadline_date, t.deadline_alert_days), (None, None), "a remote clear also drops the alert override");
        assert!(outbox::pending_batch(&pool, 10).await.unwrap().is_empty(), "never echoed");
    }

    /// Review Focus 2: the base predates v28, the remote now has a deadline.
    #[tokio::test]
    async fn the_backfill_pull_fills_deadlines_and_nothing_else() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "priority": 2, "checked": false, "is_deleted": false,
             "updated_at": "2026-09-01T12:00:00Z"}
        ]}))).await.unwrap();
        sqlx::query("UPDATE local_tasks SET synced_snapshot = json_remove(synced_snapshot, '$.deadline_date'), content = 'local edit', updated_at = '2026-09-02 10:00:00' WHERE external_id = 'R1'")
            .execute(&pool).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "*FULL", "items": [
            {"id": "R1", "content": "x", "priority": 2, "checked": false, "is_deleted": false,
             "updated_at": "2026-09-01T12:00:00Z", "deadline": {"date": "2026-10-31", "lang": "en"}}
        ]}))).await.unwrap();
        let t = linked(&pool, "R1").await;
        assert_eq!(t.deadline_date.as_deref(), Some("2026-10-31"));
        assert_eq!((t.content.as_str(), t.priority), ("local edit", 2), "every other field is untouched");
    }

    /// Review Focus 3: Todoist refused (or never got) a Nimble deadline.
    #[tokio::test]
    async fn a_local_deadline_todoist_never_took_survives_the_pull() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false, "updated_at": "2026-09-01T12:00:00Z"}
        ]}))).await.unwrap();
        sqlx::query("UPDATE local_tasks SET deadline_date = '2026-10-31' WHERE external_id = 'R1'").execute(&pool).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "renamed in Todoist", "checked": false, "is_deleted": false, "updated_at": "2026-09-03T12:00:00Z"}
        ]}))).await.unwrap();
        let t = linked(&pool, "R1").await;
        assert_eq!((t.content.as_str(), t.deadline_date.as_deref()), ("renamed in Todoist", Some("2026-10-31")));
    }

    #[tokio::test]
    async fn first_sync_after_v28_is_one_full_pull() {
        let pool = test_pool().await;
        assert_eq!(pull_token(&pool, Some("T9".into())).await.unwrap(), ("*".to_string(), true));
        mark_deadline_backfill_done(&pool).await.unwrap();
        assert_eq!(pull_token(&pool, Some("T9".into())).await.unwrap(), ("T9".to_string(), false));
        assert_eq!(pull_token(&pool, None).await.unwrap(), ("*".to_string(), false));
    }
```

In `reconcile.rs` `mod tests`, append:

```rust
    #[tokio::test]
    async fn the_reconcile_pull_carries_deadlines() {
        let pool = test_pool().await;
        let full = full_with(json!([]), json!([
            {"id": "R8", "content": "has a deadline", "project_id": "P", "checked": false, "is_deleted": false,
             "deadline": {"date": "2026-10-31", "lang": "en"}}
        ]));
        finish_apply(&pool, &full).await.unwrap();
        let d: Option<String> = sqlx::query_scalar("SELECT deadline_date FROM local_tasks WHERE external_id = 'R8'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(d.as_deref(), Some("2026-10-31"));
    }
```

(Use the module's existing `test_pool` import; add `use crate::test_util::test_pool;` if it isn't there.)

In `history.rs` `mod tests`, inside `fn remote()`, after `a["due"] = json!(…);` add:

```rust
        a["deadline"] = json!({"date": "2026-09-05", "lang": "en"});
```

and in `apply_imports_once_with_mapping_and_no_outbox`, right after `let snap: mappers::TaskSnapshot = …; assert!(snap.checked);` add:

```rust
        let deadline: Option<String> = sqlx::query_scalar("SELECT deadline_date FROM local_tasks WHERE external_id = 'A'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(deadline.as_deref(), Some("2026-09-05"));
        assert_eq!(snap.deadline_date.as_deref(), Some("2026-09-05"));
```

In `api/todoist_migration.rs` `mod tests`, inside `import_maps_labels_recurrence_section_and_nesting_to_first_class_fields`, give the first `TdTask` (`id: "td-task"`) `deadline: Some(TdDeadline { date: Some("2026-08-20".into()) }),` and every other `TdTask { … }` literal in the test module `deadline: None,` (7 literals: `grep -n "TdTask {" nimble-core/src/api/todoist_migration.rs`). After the import in that test, add:

```rust
        let dl: Option<String> = sqlx::query_scalar("SELECT deadline_date FROM local_tasks WHERE external_id = 'td-task'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(dl.as_deref(), Some("2026-08-20"));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline integrations::todoist 2>&1 | tail -20; cargo test -p nimble-core --offline api::todoist_migration 2>&1 | tail -5`
Expected: compile errors (no `deadline` on `TodoistItem`/`TdTask`, no `deadline_command_uuid`/`deadline_refusals`/`pull_token`).

- [ ] **Step 3: Pull side — client, mapper, merge**

`client.rs`, after `pub struct TodoistDuration { … }`:

```rust
/// API v1 `deadline` (date only; `lang` is output-only and ignored).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistDeadline {
    #[serde(default)]
    pub date: Option<String>,
}
```

In `pub struct TodoistItem`, after `pub duration: Option<TodoistDuration>,`:

```rust
    #[serde(default)]
    pub deadline: Option<TodoistDeadline>,
```

(If `grep -rn "TodoistItem {" nimble-core --include='*.rs'` shows a struct literal besides the definition, add `deadline: None,` to it.)

`mappers.rs`, `TaskSnapshot`, after `pub labels: Vec<String>, // Todoist label NAMES, sorted`:

```rust
    #[serde(default)]
    pub deadline_date: Option<String>, // YYYY-MM-DD; bases stored before v28 read None
```

In `item_to_snapshot`'s literal, add `deadline_date: item.deadline.as_ref().and_then(|d| d.date.as_deref()).and_then(crate::deadline::from_todoist),`. In `local_to_snapshot`'s literal, add `deadline_date: task.deadline_date.clone(),`.

`merge.rs`: add `pub deadline_date: Option<Option<String>>, // Some(None) = clear the deadline` to `MergePlan`, `&& self.deadline_date.is_none()` to `is_empty`, and to `merge_task`'s literal:

```rust
        deadline_date: pick(&local.deadline_date, base.map(|b| &b.deadline_date), &remote.deadline_date, remote_wins_conflicts),
```

- [ ] **Step 4: Pull side — apply and the one-time full pull**

In `sync_loop.rs` `apply_pull_tx`, in the `None =>` (new remote item) branch, replace the INSERT with:

```rust
                sqlx::query(
                    "INSERT INTO local_tasks (id, content, description, project_id, section_id, priority, due_date, due_time, duration_minutes, recurrence_rule, completed, status, position, external_id, external_source, remote_updated_at, synced_snapshot, deadline_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'todo', ?, ?, 'todoist', ?, ?, ?)",
                )
                .bind(&new_id)
                .bind(&remote.content)
                .bind(if remote.description.is_empty() { None } else { Some(remote.description.clone()) })
                .bind(&project_id)
                .bind(&section_id)
                .bind(remote.priority)
                .bind(&remote.due_date)
                .bind(&remote.due_time)
                .bind(remote.duration_minutes)
                .bind(super::recurrence::rule_from_due(remote.due.as_ref()))
                .bind(max.0)
                .bind(&item.id)
                .bind(&item.updated_at)
                .bind(serde_json::to_string(&remote).unwrap_or_default())
                .bind(&remote.deadline_date)
                .execute(&mut *tx)
                .await?;
```

In the `Some(local_task) =>` branch, after the `if let Some(p) = plan.priority { … }` statement:

```rust
                // Todoist owns nothing about the alert override, but a remote
                // clear clears it with the date (as clear_deadline does).
                if let Some(d) = &plan.deadline_date {
                    sqlx::query("UPDATE local_tasks SET deadline_date = ?, deadline_alert_days = CASE WHEN ? IS NULL THEN NULL ELSE deadline_alert_days END WHERE id = ?")
                        .bind(d).bind(d).bind(&local_task.id).execute(&mut *tx).await?;
                }
```

Above `pub async fn run_sync(`, add:

```rust
/// The pull is incremental, so a task unchanged since the last sync would
/// never bring its deadline. The first sync after v28 is one full pull
/// (spec §3.2); stored bases read `deadline_date: None`, so a remote deadline
/// is a remote-only change and nothing else moves.
pub const DEADLINE_BACKFILL_SETTING: &str = "todoist_deadline_backfill_v28";

/// `(token to send, whether this pull is the one-time deadline backfill)`.
pub async fn pull_token(pool: &SqlitePool, stored: Option<String>) -> crate::Result<(String, bool)> {
    let done = crate::db::settings::get_setting(pool, DEADLINE_BACKFILL_SETTING).await?.is_some();
    Ok(if done { (stored.unwrap_or_else(|| "*".to_string()), false) } else { ("*".to_string(), true) })
}

pub async fn mark_deadline_backfill_done(pool: &SqlitePool) -> crate::Result<()> {
    crate::db::settings::set_setting(pool, DEADLINE_BACKFILL_SETTING, "1").await
}
```

In `run_sync_with_focus`, replace `let sync_token = state.sync_token.unwrap_or_else(|| "*".to_string());` with:

```rust
        let (sync_token, deadline_backfill) = pull_token(pool, state.sync_token).await?;
```

and directly after `let mut report = apply_pull_with_focus(pool, &resp, focus).await?;` add:

```rust
        if deadline_backfill {
            mark_deadline_backfill_done(pool).await?;
        }
```

(The flag is latched only after the full pull's apply commits, so a failure retries it on the next sync.)

- [ ] **Step 5: Push side — observer payloads**

In `observer.rs`, add `"deadline_date": task.deadline_date,` to `task_create_payload`'s `json!`. In **both** `TaskMutation::Updated` field matches (`on_task_mutation` and `on_task_mutation_tx`), add the arm:

```rust
                    "deadline_date" => { payload.insert("deadline_date".into(), task.deadline_date.clone().into()); }
```

In `on_turso_row_applied_with_status`, change the field list to `["content", "description", "due_date", "priority", "project_id", "deadline_date"]`. (`deadline_alert_days` is never pushed: Todoist has no alert override.)

- [ ] **Step 6: Push side — the separate deadline command and refusals**

In `sync_loop.rs`, above `pub fn build_commands(`:

```rust
/// Todoist v1 deadline arg: `{"date": d}`, or null to clear.
fn deadline_arg(v: &serde_json::Value) -> serde_json::Value {
    match v.as_str() {
        Some(d) => serde_json::json!({ "date": d }),
        None => serde_json::Value::Null,
    }
}

/// The uuid of the separate `item_update` that carries a deadline. Todoist
/// may refuse deadlines (plan, recurring tasks), and a refusal must never
/// fail the rest of the update (spec §3.2). Derived from the row's uuid, so a
/// resend stays idempotent.
pub fn deadline_command_uuid(command_uuid: &str) -> String {
    match uuid::Uuid::parse_str(command_uuid) {
        Ok(u) => uuid::Uuid::from_u128(u.as_u128() ^ 0xD0AD_11E5_0028).to_string(),
        Err(_) => format!("{command_uuid}-deadline"),
    }
}

/// An `update` whose only change is the deadline: its one command IS the
/// deadline command (sent under the row's own uuid).
fn payload_is_deadline_only(row: &outbox::OutboxRow) -> bool {
    row.op == "update"
        && row.payload.as_object().is_some_and(|o| o.len() == 1 && o.contains_key("deadline_date"))
}

/// Rows whose deadline Todoist refused, with `true` when that command was the
/// row's own. A row whose main command failed is reported by its own error.
pub fn deadline_refusals<'a>(
    rows: &'a [outbox::OutboxRow],
    status: &HashMap<String, serde_json::Value>,
) -> Vec<(&'a outbox::OutboxRow, bool)> {
    rows.iter()
        .filter_map(|row| {
            if payload_is_deadline_only(row) {
                let st = status.get(&row.command_uuid)?;
                return (!client::command_ok(st)).then_some((row, true));
            }
            row.payload.get("deadline_date")?;
            let main_ok = status.get(&row.command_uuid).is_some_and(client::command_ok);
            let st = status.get(&deadline_command_uuid(&row.command_uuid))?;
            (main_ok && !client::command_ok(st)).then_some((row, false))
        })
        .collect()
}
```

In `build_commands`, inside `for row in rows {` and right before `let cmd = match (…) {`, add `let mut extra: Option<serde_json::Value> = None;`.

In the `("task", "create")` arm, before `Some(serde_json::json!({ "type": "item_add", … }))`:

```rust
                if let (Some(d), Some(temp)) = (row.payload.get("deadline_date").filter(|v| v.is_string()), &row.temp_id) {
                    extra = Some(serde_json::json!({
                        "type": "item_update", "uuid": deadline_command_uuid(&row.command_uuid),
                        "args": {"id": temp, "deadline": deadline_arg(d)},
                    }));
                }
```

In the `("task", "update")` arm, replace the whole `Some(id) => { … }` block with (a deadline-only row sends one command under its own uuid; any other row with a deadline gets the extra command):

```rust
                Some(id) => {
                    if payload_is_deadline_only(row) {
                        let args = serde_json::json!({"id": id, "deadline": deadline_arg(&row.payload["deadline_date"])});
                        Some(serde_json::json!({"type": "item_update", "uuid": row.command_uuid, "args": args}))
                    } else {
                        if let Some(d) = row.payload.get("deadline_date") {
                            extra = Some(serde_json::json!({
                                "type": "item_update", "uuid": deadline_command_uuid(&row.command_uuid),
                                "args": {"id": id.clone(), "deadline": deadline_arg(d)},
                            }));
                        }
                        let mut args = serde_json::Map::new();
                        args.insert("id".into(), id.into());
                        for key in ["content", "description", "priority"] {
                            if let Some(v) = row.payload.get(key) {
                                args.insert(key.into(), v.clone());
                            }
                        }
                        if row.payload.get("due_date").is_some() || row.payload.get("due_time").is_some() {
                            let due = mappers::due_args(
                                row.payload.get("due_date").and_then(|v| v.as_str()),
                                row.payload.get("due_time").and_then(|v| v.as_str()),
                                ctx.base_due.get(&row.local_id),
                            );
                            args.insert("due".into(), due["due"].clone());
                        }
                        if let Some(v) = row.payload.get("duration_minutes") {
                            match v.as_i64() {
                                Some(minutes) => {
                                    args.insert("duration".into(), minutes.into());
                                    args.insert("duration_unit".into(), "minute".into());
                                }
                                None => {
                                    args.insert("duration".into(), serde_json::Value::Null);
                                    args.insert("duration_unit".into(), serde_json::Value::Null);
                                }
                            }
                        }
                        if let Some(v) = row.payload.get("labels") {
                            args.insert("labels".into(), v.clone());
                        }
                        Some(serde_json::json!({"type": "item_update", "uuid": row.command_uuid, "args": args}))
                    }
                }
```

(`id` is a `String` there, so the extra takes `id.clone()` before `id.into()` moves it.)

At the end of the loop, replace `if let Some(c) = cmd { cmds.push(c); }` with:

```rust
        if let Some(c) = cmd {
            cmds.push(c);
            if let Some(e) = extra {
                cmds.push(e);
            }
        }
```

In `push_outbox`, directly after `let resolved = count_resolved(&sent_command_uuids, &resp.sync_status);`, add:

```rust
        // A refused deadline never fails its row: the rest applied, the
        // deadline stays Nimble-only, and the gap is on the record.
        let refusals = deadline_refusals(&rows, &resp.sync_status);
        let refused_own: std::collections::HashSet<String> =
            refusals.iter().filter(|(_, own)| *own).map(|(r, _)| r.id.clone()).collect();
        for (row, _) in &refusals {
            crate::db::activity::log_activity(pool, "nimble_gap", Some(&row.local_id), Some(serde_json::json!({
                "reason": "Todoist refused this task's deadline; it stays in Nimble only.",
                "source": "todoist_sync",
            }))).await;
        }
```

and in the per-row loop change `} else { outbox::mark_error(pool, &row.id, &status.to_string()).await?; }` to:

```rust
            } else if refused_own.contains(&row.id) {
                outbox::mark_done(pool, &[row.id.clone()]).await?;
            } else {
                outbox::mark_error(pool, &row.id, &status.to_string()).await?;
            }
```

- [ ] **Step 7: Importers**

`history.rs` `apply_tx`: replace the INSERT's column list and values with the same plus `deadline_date` at the end:

```rust
            "INSERT INTO local_tasks
             (id, parent_id, content, description, project_id, section_id, priority, due_date, due_time,
              duration_minutes, completed, completed_at, status, position, external_id, external_source,
              remote_updated_at, synced_snapshot, created_at, updated_at, sync_policy, deadline_date)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'complete', ?, ?, 'todoist', ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)",
```

and append `.bind(&snapshot.deadline_date)` after the `sync_policy` bind (`.bind(if p.project_id.is_none() { "local_only" } else { "default" })`).

`api/todoist_migration.rs`: after `struct TdDuration { … }` add:

```rust
#[derive(Debug, Deserialize, Clone)]
struct TdDeadline {
    date: Option<String>,
}
```

add `deadline: Option<TdDeadline>,` to `TdTask` (after `duration`), and next to `let duration_minutes = …;` in `apply_migration`:

```rust
        let deadline_date = t
            .deadline
            .as_ref()
            .and_then(|d| d.date.as_deref())
            .and_then(crate::deadline::from_todoist);
```

Replace the value-guarded UPDATE with (a new column in SET and in the guard, and its binds after `position` in each half):

```rust
            let res = sqlx::query(
                "UPDATE local_tasks
                 SET content = ?, description = ?, project_id = ?, priority = ?, due_date = ?,
                     due_time = ?, duration_minutes = ?, recurrence_rule = ?, section_id = ?,
                     position = ?, deadline_date = ?, updated_at = datetime('now')
                 WHERE id = ? AND (content IS NOT ? OR description IS NOT ? OR project_id IS NOT ?
                    OR priority IS NOT ? OR due_date IS NOT ? OR due_time IS NOT ?
                    OR duration_minutes IS NOT ? OR recurrence_rule IS NOT ? OR section_id IS NOT ?
                    OR position IS NOT ? OR deadline_date IS NOT ?)",
            )
            .bind(&t.content)
            .bind(&description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
            .bind(&due_time)
            .bind(duration_minutes)
            .bind(&recurrence_rule)
            .bind(&local_section_id)
            .bind(t.order)
            .bind(&deadline_date)
            .bind(&id)
            .bind(&t.content)
            .bind(&description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
            .bind(&due_time)
            .bind(duration_minutes)
            .bind(&recurrence_rule)
            .bind(&local_section_id)
            .bind(t.order)
            .bind(&deadline_date)
            .execute(pool)
            .await?;
```

and the INSERT with:

```rust
            sqlx::query(
                "INSERT INTO local_tasks
                 (id, parent_id, content, description, project_id, priority, due_date, due_time,
                  duration_minutes, recurrence_rule, section_id,
                  completed, completed_at, status, linked_doc_id, position,
                  external_id, external_source, created_at, updated_at, deadline_date)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'todo', NULL, ?, ?, 'todoist', ?, ?, ?)",
            )
            .bind(&new_id)
            .bind(&t.content)
            .bind(&description)
            .bind(&target_project)
            .bind(priority)
            .bind(&due_date)
            .bind(&due_time)
            .bind(duration_minutes)
            .bind(&recurrence_rule)
            .bind(&local_section_id)
            .bind(t.order)
            .bind(&t.id)
            .bind(&now)
            .bind(&now)
            .bind(&deadline_date)
            .execute(pool)
            .await?;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline integrations::todoist && cargo test -p nimble-core --offline api::todoist_migration && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: all `ok`. In particular, `echo_of_stored_snapshot_is_skipped` still passes: a fresh base now serializes `"deadline_date": null` and still equals the remote. The existing `build_commands` tests still see one command per row.

- [ ] **Step 9: Commit**

```bash
git add nimble-core/src/integrations/todoist nimble-core/src/api/todoist_migration.rs
git commit -m "feat(deadline): Todoist pull/merge/push, separate deadline command, one-time full pull, importers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 4: Deadline alerts on the C2 reminder ledger

**Files:**
- Modify: `nimble-core/src/reminders.rs` (`ReminderCandidate.deadline_date`, `DeadlineDefaults`, `deadline_candidate`, `deadline_alert_body`)
- Modify: `nimble-core/src/db/reminders.rs` (`deadline_defaults`, `collect_due`)
- Modify: `apps/desktop/src-tauri/src/reminder_runner.rs` (title/body)
- Test: `nimble-core/tests/reminders.rs`

**Interfaces:**
- Consumes: `LocalTask.deadline_date` / `deadline_alert_days` (Task 1); `crate::deadline::{parse, alert_body, ALERT_OFF, MAX_ALERT_DAYS}` (Task 2).
- Produces:
  - `reminders::ReminderCandidate { task_id, scheduled_at, occurrence_key, deadline_date: Option<String> }` (None for due-time reminders)
  - `reminders::DeadlineDefaults { days: i64, time: chrono::NaiveTime }`, `Default` = 2 days, 09:00
  - `reminders::deadline_candidate(&LocalTask, timezone: &str, &DeadlineDefaults) -> Result<Option<ReminderCandidate>>`
  - `reminders::deadline_alert_body(deadline: &str, now: DateTime<Utc>, timezone: &str) -> String`
  - `db::reminders::deadline_defaults(pool) -> Result<DeadlineDefaults>`, reading the settings keys `deadline_alert_days` / `deadline_alert_time`
  - `reminder_deliveries.state = 'skipped'` for a deadline key first seen more than 90 s late

- [ ] **Step 1: Write the failing tests**

Append to `nimble-core/tests/reminders.rs`:

```rust
use nimble_core::reminders::{deadline_alert_body, deadline_candidate, DeadlineDefaults};
use nimble_core::types::LocalTask;

const LA: &str = "America/Los_Angeles";

fn dl(id: &str, date: &str, days: Option<i64>) -> LocalTask {
    LocalTask { id: id.into(), content: "COBRA".into(), deadline_date: Some(date.into()), deadline_alert_days: days, ..Default::default() }
}

/// Review Focus 1 (alerts): 09:00 local on both sides of the DST change.
#[test]
fn deadline_alert_lands_at_0900_local_across_dst() {
    let d = DeadlineDefaults::default();
    let c = deadline_candidate(&dl("t", "2026-10-31", None), LA, &d).unwrap().unwrap();
    assert_eq!(c.scheduled_at, at("2026-10-29T16:00:00Z"), "2 days before, 09:00 PDT");
    assert_eq!(c.occurrence_key, "deadline|t|2026-10-31|2|09:00|America/Los_Angeles");
    assert_eq!(c.deadline_date.as_deref(), Some("2026-10-31"));
    let c = deadline_candidate(&dl("t", "2026-11-03", None), LA, &d).unwrap().unwrap();
    assert_eq!(c.scheduled_at, at("2026-11-01T17:00:00Z"), "09:00 PST, after the fall-back");
    let c = deadline_candidate(&dl("t", "2026-10-31", Some(0)), LA, &d).unwrap().unwrap();
    assert_eq!((c.scheduled_at, c.occurrence_key.as_str()), (at("2026-10-31T16:00:00Z"), "deadline|t|2026-10-31|0|09:00|America/Los_Angeles"));
    assert!(deadline_candidate(&dl("t", "2026-10-31", Some(-1)), LA, &d).unwrap().is_none(), "per-task off");
    let off = DeadlineDefaults { days: -1, ..DeadlineDefaults::default() };
    assert!(deadline_candidate(&dl("t", "2026-10-31", None), LA, &off).unwrap().is_none(), "global off");
    assert!(deadline_candidate(&dl("t", "2026-10-31", Some(1)), LA, &off).unwrap().is_some(), "a per-task value beats global off");
    let mut done = dl("t", "2026-10-31", None);
    done.completed = true;
    assert!(deadline_candidate(&done, LA, &d).unwrap().is_none());
    assert!(deadline_candidate(&LocalTask { id: "t".into(), ..Default::default() }, LA, &d).unwrap().is_none());
    assert!(deadline_candidate(&dl("t", "soon", None), LA, &d).is_err(), "a bad stored value needs attention");
    let early = DeadlineDefaults { days: 2, time: chrono::NaiveTime::from_hms_opt(7, 30, 0).unwrap() };
    let c = deadline_candidate(&dl("t", "2026-10-31", None), LA, &early).unwrap().unwrap();
    assert_eq!(c.occurrence_key, "deadline|t|2026-10-31|2|07:30|America/Los_Angeles", "any change supersedes");
}

#[test]
fn deadline_alert_copy() {
    assert_eq!(deadline_alert_body("2026-10-08", at("2026-10-06T16:00:00Z"), LA), "Due by Thu, Oct 8");
    assert_eq!(deadline_alert_body("2026-10-07", at("2026-10-06T16:00:00Z"), LA), "Due tomorrow");
    assert_eq!(deadline_alert_body("2026-10-06", at("2026-10-06T16:00:00Z"), LA), "Due today");
    // 23:30 PDT on Oct 5 is already Oct 6 in UTC: "today" is the reminder zone's day.
    assert_eq!(deadline_alert_body("2026-10-06", at("2026-10-06T06:30:00Z"), LA), "Due tomorrow");
}

async fn state(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar("SELECT state FROM reminder_deliveries WHERE occurrence_key = ?").bind(key).fetch_optional(pool).await.unwrap()
}

/// Review Focus 4.
#[tokio::test]
async fn deadline_alerts_fire_supersede_and_skip_late_first_sight() {
    let pool = nimble_core::test_util::test_pool().await;
    let task = tasks::create_local_task(&pool, CreateTaskInput {
        content: "COBRA".into(), deadline_date: Some("2026-10-31".into()), ..Default::default()
    }).await.unwrap();
    let key = "deadline|".to_string() + &task.id + "|2026-10-31|2|09:00|America/Los_Angeles";
    assert!(reminders::collect_due(&pool, at("2026-10-29T15:00:00Z"), LA).await.unwrap().is_empty(), "not yet");
    assert_eq!(state(&pool, &key).await.as_deref(), Some("pending"));
    let due = reminders::collect_due(&pool, at("2026-10-29T16:00:30Z"), LA).await.unwrap();
    assert_eq!(due.iter().map(|c| c.occurrence_key.as_str()).collect::<Vec<_>>(), [key.as_str()]);
    assert!(reminders::claim_notification(&pool, &key).await.unwrap());
    reminders::mark_notified(&pool, &key, at("2026-10-29T16:00:30Z")).await.unwrap();

    // Moving the deadline supersedes nothing already fired and schedules the new day.
    tasks::update_local_task(&pool, &task.id, UpdateTaskInput { deadline_date: Some("2026-11-06".into()), ..Default::default() }).await.unwrap();
    reminders::collect_due(&pool, at("2026-10-30T12:00:00Z"), LA).await.unwrap();
    let moved = "deadline|".to_string() + &task.id + "|2026-11-06|2|09:00|America/Los_Angeles";
    assert_eq!(state(&pool, &moved).await.as_deref(), Some("pending"));
    // Clearing it supersedes the pending alert.
    tasks::update_local_task(&pool, &task.id, UpdateTaskInput { clear_deadline: true, ..Default::default() }).await.unwrap();
    reminders::collect_due(&pool, at("2026-10-30T12:00:00Z"), LA).await.unwrap();
    assert_eq!(state(&pool, &moved).await.as_deref(), Some("superseded"));

    // Set at 23:00 for tomorrow: its alert window passed a day ago. No banner, no catch-up.
    let late = tasks::create_local_task(&pool, CreateTaskInput {
        content: "Late".into(), deadline_date: Some("2026-10-31".into()), ..Default::default()
    }).await.unwrap();
    let due = reminders::collect_due(&pool, at("2026-10-31T06:00:00Z"), LA).await.unwrap();
    assert!(due.iter().all(|c| c.task_id != late.id));
    let late_key = "deadline|".to_string() + &late.id + "|2026-10-31|2|09:00|America/Los_Angeles";
    assert_eq!(state(&pool, &late_key).await.as_deref(), Some("skipped"));
    reminders::collect_due(&pool, at("2026-10-31T07:00:00Z"), LA).await.unwrap();
    assert_eq!(state(&pool, &late_key).await.as_deref(), Some("skipped"), "stays skipped");
    assert!(reminders::list_catch_up(&pool).await.unwrap().is_empty());

    // Pending before the Mac slept: a normal catch-up card.
    let slept = tasks::create_local_task(&pool, CreateTaskInput {
        content: "Slept".into(), deadline_date: Some("2026-11-05".into()), ..Default::default()
    }).await.unwrap();
    reminders::collect_due(&pool, at("2026-11-03T15:00:00Z"), LA).await.unwrap();
    let due = reminders::collect_due(&pool, at("2026-11-03T21:00:00Z"), LA).await.unwrap();
    let item = due.iter().find(|c| c.task_id == slept.id).expect("still due after sleep");
    reminders::mark_catch_up(&pool, &item.occurrence_key, None).await.unwrap();
    assert_eq!(reminders::list_catch_up(&pool).await.unwrap().iter().map(|c| c.task_id.as_str()).collect::<Vec<_>>(), [slept.id.as_str()]);
}

#[tokio::test]
async fn deadline_defaults_come_from_device_settings() {
    let pool = nimble_core::test_util::test_pool().await;
    assert_eq!(reminders::deadline_defaults(&pool).await.unwrap(), DeadlineDefaults::default());
    nimble_core::db::settings::set_setting(&pool, "deadline_alert_days", "0").await.unwrap();
    nimble_core::db::settings::set_setting(&pool, "deadline_alert_time", "08:30").await.unwrap();
    let d = reminders::deadline_defaults(&pool).await.unwrap();
    assert_eq!((d.days, d.time.format("%H:%M").to_string()), (0, "08:30".to_string()));
    nimble_core::db::settings::set_setting(&pool, "deadline_alert_days", "99").await.unwrap();
    nimble_core::db::settings::set_setting(&pool, "deadline_alert_time", "late").await.unwrap();
    assert_eq!(reminders::deadline_defaults(&pool).await.unwrap(), DeadlineDefaults::default(), "junk falls back");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline --test reminders 2>&1 | tail -15`
Expected: compile errors (`deadline_candidate`, `DeadlineDefaults`, `deadline_defaults` not found).

- [ ] **Step 3: Implement the pure candidate and copy**

In `nimble-core/src/reminders.rs`, add the field to `ReminderCandidate`:

```rust
    /// Set for deadline alerts (spec §6): the runner titles the banner with
    /// the task and writes "Due today" / "Due by Thu, Oct 8".
    pub deadline_date: Option<String>,
```

In `candidate(…)`'s `ReminderCandidate { … }`, add `deadline_date: None,`. Then append (before `#[cfg(test)]`):

```rust
/// Device-local defaults (settings `deadline_alert_days`, `deadline_alert_time`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeadlineDefaults {
    /// -1 = off, 0..=14 days before the deadline.
    pub days: i64,
    pub time: chrono::NaiveTime,
}

impl Default for DeadlineDefaults {
    fn default() -> Self {
        Self { days: 2, time: chrono::NaiveTime::from_hms_opt(9, 0, 0).expect("09:00") }
    }
}

/// A deadline's alert: N days before, at the default time, in the C2 zone.
/// None for a completed task, no deadline, or alerts off. The key carries
/// every input, so any change supersedes the old alert.
pub fn deadline_candidate(task: &LocalTask, timezone: &str, defaults: &DeadlineDefaults) -> crate::Result<Option<ReminderCandidate>> {
    if task.completed || task.status == "complete" { return Ok(None); }
    let Some(date) = task.deadline_date.as_deref() else { return Ok(None) };
    let days = task.deadline_alert_days.unwrap_or(defaults.days);
    if days == crate::deadline::ALERT_OFF { return Ok(None); }
    if !(0..=crate::deadline::MAX_ALERT_DAYS).contains(&days) {
        return Err(crate::Error::Parse("Invalid deadline alert".into()));
    }
    let deadline = crate::deadline::parse(date).ok_or_else(|| crate::Error::Parse("Invalid deadline date".into()))?;
    let zone: chrono_tz::Tz = timezone.parse().map_err(|_| crate::Error::Parse("Invalid reminder timezone".into()))?;
    let wall = (deadline - Duration::days(days)).and_time(defaults.time);
    let at = match zone.from_local_datetime(&wall) {
        LocalResult::Single(v) => v,
        LocalResult::Ambiguous(a, b) => a.min(b),
        LocalResult::None => return Err(crate::Error::Parse("Deadline alert time does not exist on that day".into())),
    };
    Ok(Some(ReminderCandidate {
        task_id: task.id.clone(),
        scheduled_at: at.with_timezone(&Utc),
        occurrence_key: format!("deadline|{}|{}|{}|{}|{}", task.id, date, days, defaults.time.format("%H:%M"), timezone),
        deadline_date: Some(date.to_string()),
    }))
}

/// Banner body, relative to the reminder zone's today.
pub fn deadline_alert_body(deadline: &str, now: DateTime<Utc>, timezone: &str) -> String {
    let today = match timezone.parse::<chrono_tz::Tz>() {
        Ok(zone) => now.with_timezone(&zone).date_naive(),
        Err(_) => now.date_naive(),
    };
    match crate::deadline::parse(deadline) {
        Some(d) => crate::deadline::alert_body(d, today),
        None => "Deadline coming up".into(),
    }
}
```

- [ ] **Step 4: Reconcile deadline candidates in the ledger**

In `nimble-core/src/db/reminders.rs`, change the import to `use crate::reminders::{candidate, deadline_candidate, decide, DeadlineDefaults, DeliveryDecision, ReminderCandidate};`, add:

```rust
/// The Mac's deadline alert defaults (settings are device-local, never synced).
/// Junk values fall back to 2 days / 09:00.
pub async fn deadline_defaults(pool: &SqlitePool) -> crate::Result<DeadlineDefaults> {
    let base = DeadlineDefaults::default();
    let days = super::settings::get_setting(pool, "deadline_alert_days").await?
        .and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|n| (crate::deadline::ALERT_OFF..=crate::deadline::MAX_ALERT_DAYS).contains(n))
        .unwrap_or(base.days);
    let time = super::settings::get_setting(pool, "deadline_alert_time").await?
        .and_then(|v| chrono::NaiveTime::parse_from_str(v.trim(), "%H:%M").ok())
        .unwrap_or(base.time);
    Ok(DeadlineDefaults { days, time })
}
```

and replace `collect_due`'s body up to (not including) `// A restart after an interrupted native call …` with:

```rust
    let tasks = super::tasks::get_local_tasks(pool, None, None, false).await?;
    let defaults = deadline_defaults(pool).await?;
    let mut active = Vec::new();
    let mut invalid = Vec::new();
    for task in &tasks {
        match candidate(task, timezone) {
            Ok(Some(item)) => active.push(item),
            Ok(None) => (),
            Err(error) => {
                log::warn!("Reminder schedule needs attention for task {}: {}", task.id, error);
                invalid.push((format!("{}|needs_attention|{}|{}|{}",task.id,task.due_date.as_deref().unwrap_or(""),task.due_time.as_deref().unwrap_or(""),timezone),task.id.clone()));
            }
        }
        // Collected here so the sweep below never supersedes them (spec §6).
        match deadline_candidate(task, timezone, &defaults) {
            Ok(Some(item)) => active.push(item),
            Ok(None) => (),
            Err(error) => {
                log::warn!("Deadline alert needs attention for task {}: {}", task.id, error);
                invalid.push((format!("deadline|{}|needs_attention|{}|{}", task.id, task.deadline_date.as_deref().unwrap_or(""), timezone), task.id.clone()));
            }
        }
    }
    let mut tx = pool.begin().await?;
    for item in &active {
        sqlx::query("UPDATE reminder_deliveries SET state='pending' WHERE occurrence_key=? AND state='superseded' AND last_fired_at IS NULL AND acknowledged_at IS NULL")
            .bind(&item.occurrence_key).execute(&mut *tx).await?;
        // A deadline alert first seen after its moment (set or synced inside
        // its window) is skipped: the row and the brief already show it.
        let late = item.deadline_date.is_some() && now - item.scheduled_at > chrono::Duration::seconds(90);
        sqlx::query("INSERT OR IGNORE INTO reminder_deliveries (occurrence_key,task_id,scheduled_at,state) VALUES (?,?,?,?)")
            .bind(&item.occurrence_key).bind(&item.task_id).bind(item.scheduled_at.to_rfc3339())
            .bind(if late { "skipped" } else { "pending" })
            .execute(&mut *tx).await?;
    }
    for (key,task_id) in &invalid {
        sqlx::query("UPDATE reminder_deliveries SET state='catch_up' WHERE occurrence_key=? AND state='superseded' AND last_fired_at IS NULL AND acknowledged_at IS NULL")
            .bind(key).execute(&mut *tx).await?;
        sqlx::query("INSERT OR IGNORE INTO reminder_deliveries (occurrence_key,task_id,scheduled_at,state,error_code) VALUES (?,?,?,'catch_up','schedule_needs_attention')")
            .bind(key).bind(task_id).bind(now.to_rfc3339()).execute(&mut *tx).await?;
    }
```

Replace the final `let due = active.into_iter()…collect();` line with:

```rust
    let skipped: Vec<String> =
        sqlx::query_scalar("SELECT occurrence_key FROM reminder_deliveries WHERE state='skipped'")
            .fetch_all(&mut *tx).await?;
    let due = active.into_iter()
        .filter(|item| !skipped.contains(&item.occurrence_key) && decide(now, item.scheduled_at) != DeliveryDecision::Future)
        .collect();
```

(`reminder_deliveries.state` has no CHECK constraint, so `'skipped'` needs no migration. The supersede sweep touches only `pending|catch_up|notified`, so skipped rows stay as history.)

- [ ] **Step 5: Banner copy in the runner**

In `apps/desktop/src-tauri/src/reminder_runner.rs`, replace the `let delivered = if let Some((title,)) = title { … } else { false };` block with:

```rust
                let delivered = if let Some((content,)) = title {
                    if matches!(permission, Some(tauri_plugin_notification::PermissionState::Granted)) {
                        // Deadline alerts: the task is the title, the date the body (spec §6).
                        let (title, body) = match &item.deadline_date {
                            Some(d) => (content.clone(), nimble_core::reminders::deadline_alert_body(d, now, &timezone)),
                            None => ("Nimble reminder".to_string(), content.clone()),
                        };
                        app.notification().builder().title(&title).body(&body).show().is_ok()
                    } else { false }
                } else { false };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline --test reminders && cargo test -p nimble-core --offline deadline && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: all `ok`. The three existing reminder tests are unchanged: tasks without a deadline add no candidates.

- [ ] **Step 7: Commit**

```bash
git add nimble-core/src/reminders.rs nimble-core/src/db/reminders.rs nimble-core/tests/reminders.rs apps/desktop/src-tauri/src/reminder_runner.rs
git commit -m "feat(deadline): Mac deadline alerts on the reminder ledger, late-first-seen skip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 5: Morning brief — candidates, prompt, fallback, Due today, Still open

**Files:**
- Modify: `nimble-core/src/brief/candidates.rs` (`Candidate` fields, effective deadline, `due_soon` tier, urgency, tests)
- Modify: `nimble-core/src/brief/prompt.rs` (`task_line`, system rule, tests)
- Modify: `nimble-core/src/brief/fallback.rs` (`fallback_order`, test helper, test)
- Modify: `nimble-core/src/brief/validate.rs` (test helper literal only)
- Modify: `nimble-core/src/brief/modules/mod.rs` (`task_ref`, `open_top_level`)
- Modify: `nimble-core/src/brief/modules/due_today.rs`, `modules/still_open.rs` (filters, tests)

**Interfaces:**
- Consumes: `get_local_tasks_due_or_deadline` (Task 2), `crate::deadline::days_until` (Task 2).
- Produces: `Candidate { deadline_date: Option<String>, deadline_days: Option<i64> }` (the *effective* deadline: the earliest of the task's own and its open subtasks'); `task_ref` JSON gains `"deadline_date"`; Due today = due on the date OR deadline on the date; Still open = not in Due today, due before the date OR deadline passed.

- [ ] **Step 1: Write the failing tests**

In `candidates.rs` `mod tests`, append:

```rust
    #[test]
    fn effective_deadline_admits_parents_to_the_due_tier_and_orders_urgency() {
        let mut parent = t("parent"); parent.created_at = "2026-09-20 10:00:00".into();
        let mut child = t("child"); child.parent_id = Some("parent".into()); child.deadline_date = Some("2026-09-28".into());
        let mut done_child = t("done-child"); done_child.parent_id = Some("parent".into());
        done_child.deadline_date = Some("2026-09-26".into()); done_child.completed = true; done_child.status = "complete".into();
        let mut own = t("own"); own.created_at = "2026-09-21 10:00:00".into(); own.deadline_date = Some("2026-10-01".into());
        let mut far = t("far"); far.created_at = "2026-09-22 10:00:00".into(); far.deadline_date = Some("2026-12-01".into());
        let mut passed = t("passed"); passed.created_at = "2026-09-23 10:00:00".into(); passed.deadline_date = Some("2026-09-20".into());
        let mut due_late_deadline_soon = t("mixed"); due_late_deadline_soon.created_at = "2026-09-24 10:00:00".into();
        due_late_deadline_soon.due_date = Some("2026-11-01".into()); due_late_deadline_soon.deadline_date = Some("2026-09-27".into());
        let out = select(&[far, own, parent, child, done_child, passed, due_late_deadline_soon], &[], &[]);
        let ids: Vec<&str> = out.iter().map(|c| c.task_id.as_str()).collect();
        // Due tier by min(due, deadline): passed 9-20, mixed 9-27, parent 9-28 (its open child), own 10-01.
        assert_eq!(ids[..4], ["passed", "mixed", "parent", "own"]);
        let p = out.iter().find(|c| c.task_id == "parent").unwrap();
        assert_eq!((p.deadline_date.as_deref(), p.deadline_days), (Some("2026-09-28"), Some(3)), "completed subtasks don't count");
        let passed = out.iter().find(|c| c.task_id == "passed").unwrap();
        assert_eq!(passed.deadline_days, Some(-5));
        assert!(!ids.contains(&"child"), "subtasks are never candidates themselves");
    }
```

In `prompt.rs` `mod tests`: in `set_with`, add `deadline_date: Some("2026-10-06".into()), deadline_days: Some(11),` to the `Candidate { … }` literal. In `user_prompt_uses_short_ids_and_carries_the_day`, change the expected line to:

```rust
        assert!(p.contains("t1 | Send Dana the draft | project: Portfolio | priority: Urgent | status: in_progress | due: 2026-09-25 | deadline: 2026-10-06 (in 11 days) | labels: needs-claude | est: 15m | open 12d"), "{p}");
```

and append:

```rust
    #[test]
    fn deadline_phrases_and_the_rule() {
        let mut set = set_with("x");
        for (days, date, want) in [
            (Some(0), "2026-09-25", "deadline: 2026-09-25 (today)"),
            (Some(1), "2026-09-26", "deadline: 2026-09-26 (in 1 day)"),
            (Some(-1), "2026-09-24", "deadline: 2026-09-24 (passed 1 day ago)"),
            (Some(-2), "2026-09-23", "deadline: 2026-09-23 (passed 2 days ago)"),
        ] {
            set.open[0].deadline_date = Some(date.into());
            set.open[0].deadline_days = days;
            let p = user_prompt(&set, "2026-09-25", &day());
            assert!(p.contains(want), "{want}: {p}");
        }
        set.open[0].deadline_date = None;
        set.open[0].deadline_days = None;
        assert!(user_prompt(&set, "2026-09-25", &day()).contains("| deadline: none |"));
        let s = system_prompt(&QuickLabels::default(), 3);
        assert!(s.contains("deadline is the date a task must be done by; due is when the person planned to work on it."));
        assert!(s.contains("Weigh deadlines within 7 days heavily and treat one within 3 days as a strong reason to pick the task."));
        assert!(s.contains("never mention anything late, missed or overdue"), "the no-guilt rule still covers deadlines");
    }
```

In `fallback.rs` `mod tests`, change the helper `c(…)` literal to end with `created_at: created.into(), deadline_date: None, deadline_days: None,` and append:

```rust
    #[test]
    fn a_deadline_within_three_days_comes_right_after_in_progress() {
        let mut soon = c("soon", "todo", 1, None, "2026-09-10", &[]);
        soon.deadline_date = Some("2026-09-27".into()); soon.deadline_days = Some(2);
        let mut today = c("today", "todo", 1, None, "2026-09-11", &[]);
        today.deadline_date = Some("2026-09-25".into()); today.deadline_days = Some(0);
        let mut passed = c("passed", "todo", 1, None, "2026-09-12", &[]);
        passed.deadline_date = Some("2026-09-20".into()); passed.deadline_days = Some(-5);
        let mut later = c("later", "todo", 1, None, "2026-09-13", &[]);
        later.deadline_date = Some("2026-10-05".into()); later.deadline_days = Some(10);
        let out = rank_fallback(&set(vec![
            c("urgent", "todo", 4, None, "2026-09-01", &[]),
            later, passed, soon, today,
            c("doing", "in_progress", 1, None, "2026-09-02", &[]),
        ]), &HashSet::new(), 3);
        assert_eq!(ids(&out.priorities), ["doing", "today", "soon"], "in progress → deadline 0–2 days (ascending) → priority");
    }
```

In `validate.rs` `mod tests`, add `deadline_date: None, deadline_days: None,` to the `Candidate { … }` literal in its `c(…)` helper.

In `due_today.rs`, append:

```rust
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    pub(crate) async fn seed(pool: &sqlx::SqlitePool) {
        let mk = |c: &str, due: Option<&str>, dl: Option<&str>| CreateTaskInput {
            content: c.into(), due_date: due.map(Into::into), deadline_date: dl.map(Into::into), ..Default::default()
        };
        for input in [
            mk("due", Some("2026-10-31"), None),
            mk("deadline today", Some("2026-11-05"), Some("2026-10-31")),
            mk("both today", Some("2026-10-31"), Some("2026-10-31")),
            mk("undated deadline", None, Some("2026-10-31")),
            mk("due earlier", Some("2026-10-20"), None),
            mk("deadline passed", Some("2026-11-09"), Some("2026-10-25")),
            mk("later", None, Some("2026-11-01")),
        ] {
            crate::db::tasks::create_local_task(pool, input).await.unwrap();
        }
    }

    #[tokio::test]
    async fn due_today_includes_a_deadline_today_once() {
        let pool = test_pool().await;
        seed(&pool).await;
        let ctx = BriefCtx { pool: &pool, date: "2026-10-31" };
        let v = DueToday.gather(&ctx, &Value::Null).await.unwrap();
        let mut titles: Vec<&str> = v.as_array().unwrap().iter().map(|t| t["content"].as_str().unwrap()).collect();
        titles.sort();
        assert_eq!(titles, ["both today", "deadline today", "due", "undated deadline"]);
        let row = v.as_array().unwrap().iter().find(|t| t["content"] == "deadline today").unwrap();
        assert_eq!(row["deadline_date"], "2026-10-31", "snapshots render the chip");
    }
}
```

In `still_open.rs`, append:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn still_open_adds_passed_deadlines_and_never_repeats_due_today() {
        let pool = test_pool().await;
        crate::brief::modules::due_today::tests::seed(&pool).await;
        let ctx = BriefCtx { pool: &pool, date: "2026-10-31" };
        let v = StillOpen.gather(&ctx, &serde_json::Value::Null).await.unwrap();
        let titles: Vec<&str> = v["oldest"].as_array().unwrap().iter().map(|t| t["content"].as_str().unwrap()).collect();
        assert_eq!(titles, ["due earlier", "deadline passed"], "oldest past date first");
        assert_eq!(v["total"], 2);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline brief 2>&1 | tail -15`
Expected: compile errors (no field `deadline_date` / `deadline_days` on `Candidate`).

- [ ] **Step 3: Candidates**

In `candidates.rs`, add to `pub struct Candidate` after `pub created_at: String,`:

```rust
    /// The effective deadline: the earliest of the task's own and its open
    /// subtasks' (spec §5), and its distance from today (negative = passed).
    pub deadline_date: Option<String>,
    pub deadline_days: Option<i64>,
```

Replace `fn urgency(a: &LocalTask, b: &LocalTask) -> Ordering { … }` with:

```rust
/// Sorts by the earlier of due date and effective deadline, then priority, age, id.
fn urgency(a: &LocalTask, b: &LocalTask, deadline_of: &dyn Fn(&LocalTask) -> Option<String>) -> Ordering {
    let key = |t: &LocalTask| -> String {
        let due = t.due_date.clone().unwrap_or_else(|| "9999-12-31".into());
        match deadline_of(t) {
            Some(d) if d < due => d,
            _ => due,
        }
    };
    key(a).cmp(&key(b))
        .then(b.priority.cmp(&a.priority))
        .then(a.created_at.cmp(&b.created_at))
        .then(a.id.cmp(&b.id))
}
```

In `select_open`, directly after `let horizon = shift_date(input.today, DUE_WINDOW_DAYS);`:

```rust
    let today = chrono::NaiveDate::parse_from_str(input.today, "%Y-%m-%d").ok();
    // Earliest open subtask deadline per parent.
    let mut child_min: HashMap<&str, &str> = HashMap::new();
    for t in input.tasks {
        if let (Some(parent), Some(d)) = (t.parent_id.as_deref(), t.deadline_date.as_deref()) {
            if !t.completed && t.status != "complete" {
                let e = child_min.entry(parent).or_insert(d);
                if d < *e { *e = d; }
            }
        }
    }
    let deadline_of = |t: &LocalTask| -> Option<String> {
        match (t.deadline_date.as_deref(), child_min.get(t.id.as_str()).copied()) {
            (Some(a), Some(b)) => Some(a.min(b).to_string()),
            (a, b) => a.or(b).map(str::to_string),
        }
    };
```

Change `eligible.sort_by(|a, b| urgency(a, b));` to `eligible.sort_by(|a, b| urgency(a, b, &deadline_of));`, and the `due_soon` closure to:

```rust
    let due_soon = |t: &LocalTask| -> bool {
        active(t)
            && (t.due_date.as_deref().is_some_and(|d| d <= horizon.as_str())
                || deadline_of(t).is_some_and(|d| d.as_str() <= horizon.as_str()))
    };
```

In the final `.map(|(i, t)| Candidate { … })`, add:

```rust
            deadline_date: deadline_of(t),
            deadline_days: match (deadline_of(t), today) {
                (Some(d), Some(today)) => crate::deadline::days_until(&d, today),
                _ => None,
            },
```

- [ ] **Step 4: Prompt**

In `prompt.rs`, add above `fn task_line`:

```rust
/// "2026-10-06 (in 11 days)", "(today)", "(passed 2 days ago)", or "none".
fn deadline_phrase(c: &Candidate) -> String {
    let Some(date) = c.deadline_date.as_deref().map(|d| clean_text(d, 20)) else { return "none".into() };
    match c.deadline_days {
        Some(0) => format!("{date} (today)"),
        Some(1) => format!("{date} (in 1 day)"),
        Some(n) if n > 1 => format!("{date} (in {n} days)"),
        Some(-1) => format!("{date} (passed 1 day ago)"),
        Some(n) => format!("{date} (passed {} days ago)", -n),
        None => date,
    }
}
```

In `task_line`, directly after the `parts.push(format!("due: {}", …));` line:

```rust
    parts.push(format!("deadline: {}", deadline_phrase(c)));
```

In `system_prompt`'s raw string, insert a new paragraph directly after the `priorities: …` paragraph (before `quick_help:`):

```text
deadline is the date a task must be done by; due is when the person planned to work on it. Weigh deadlines within 7 days heavily and treat one within 3 days as a strong reason to pick the task.

```

- [ ] **Step 5: Fallback**

Replace `fallback_order` with:

```rust
pub fn fallback_order(a: &Candidate, b: &Candidate) -> Ordering {
    let in_progress = |c: &Candidate| c.status == "in_progress";
    let due = |c: &Candidate| c.due_date.clone().unwrap_or_else(|| "9999-12-31".into());
    // A deadline 0–2 days away (the chip's strong window); passed ones don't jump the order.
    let soon = |c: &Candidate| c.deadline_days.filter(|d| (0..=2).contains(d));
    in_progress(b).cmp(&in_progress(a))
        .then_with(|| match (soon(a), soon(b)) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        })
        .then(b.priority.cmp(&a.priority))
        .then(due(a).cmp(&due(b)))
        .then(a.created_at.cmp(&b.created_at))
        .then(a.task_id.cmp(&b.task_id))
}
```

and update the module doc's first line to `//! … in progress first, then a deadline 0–2 days away, then priority, then due date, then age (addendum §5, deadline spec §5).`

- [ ] **Step 6: Due today and Still open**

`modules/mod.rs`:

```rust
pub(crate) fn task_ref(t: &LocalTask) -> Value {
    json!({"id": t.id, "content": t.content, "due_date": t.due_date, "deadline_date": t.deadline_date, "priority": t.priority, "project_id": t.project_id})
}

/// Open top-level tasks due, or with a deadline, on or before the brief's date.
pub(crate) async fn open_top_level(ctx: &BriefCtx<'_>) -> crate::Result<Vec<LocalTask>> {
    Ok(crate::db::tasks::get_local_tasks_due_or_deadline(ctx.pool, ctx.date, false)
        .await?
        .into_iter()
        .filter(|t| t.parent_id.is_none())
        .collect())
}

/// Due today (spec §5): the due date or the deadline is the brief's date.
pub(crate) fn is_due_on(t: &LocalTask, date: &str) -> bool {
    t.due_date.as_deref() == Some(date) || t.deadline_date.as_deref() == Some(date)
}
```

`due_today.rs` `gather`: change the filter to `.filter(|t| super::is_due_on(t, ctx.date))` and the doc to `/// The morning's open top-level tasks due that day, or whose deadline is that day.`

`still_open.rs` `gather`: replace the body after `let count = …;` with:

```rust
        // The earliest date that has passed: the due date's rule, plus a
        // passed deadline (spec §5). Never a task Due today already shows.
        let past = |t: &crate::types::LocalTask| -> Option<String> {
            [t.due_date.as_deref(), t.deadline_date.as_deref()]
                .into_iter()
                .flatten()
                .filter(|d| *d < ctx.date)
                .min()
                .map(str::to_string)
        };
        let mut still: Vec<_> = super::open_top_level(ctx)
            .await?
            .into_iter()
            .filter(|t| !super::is_due_on(t, ctx.date) && past(t).is_some())
            .collect();
        still.sort_by_key(|t| past(t));
        Ok(json!({
            "total": still.len(),
            "oldest": still.iter().take(count).map(super::task_ref).collect::<Vec<_>>(),
        }))
```

and its doc to `/// The \`count\` oldest open top-level tasks whose due date or deadline passed before the day, plus the total.` Make `due_today`'s test module reachable from `still_open`'s by declaring it `pub(crate) mod tests` (keep `#[cfg(test)]`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline brief && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: all `ok`. The existing `tiers_in_progress_then_due_then_priority_then_oldest_then_labelled` is unchanged (no deadlines there). `in_progress_then_priority_then_due_then_age` is unchanged (every `deadline_days` is None).

- [ ] **Step 8: Commit**

```bash
git add nimble-core/src/brief
git commit -m "feat(deadline): brief weighs effective deadlines; Due today and Still open read them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 6: `dt` flags, `task list --deadline`, the one-time description backfill, docs

**Files:**
- Create: `nimble-core/src/db/deadline_backfill.rs`
- Modify: `nimble-core/src/db/mod.rs` (`pub mod deadline_backfill;`)
- Modify: `tools/dt/src/args.rs` (`Fields`, `Task::List`, `Task::Deadline`, `TaskDeadline`)
- Modify: `tools/dt/src/commands/mod.rs` (`AlertFlag`, `deadline_alert`, `validate_fields`, `reject_clear_flags`, `create_input`, `update_input`, `Task::List`, `Task::Deadline` arm, `deadline_backfill`, `native_failure`, `backfill_text`)
- Modify: `tools/dt/src/main.rs` (route `task deadline backfill` before app operations)
- Test: `tools/dt/tests/contracts.rs`
- Modify: `docs/agent-access.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `CreateTaskInput`/`UpdateTaskInput` deadline fields and `get_tasks_with_deadline_by` (Task 2).
- Produces:
  - `dt task create|update --deadline YYYY-MM-DD`, `dt task update --clear-deadline`, `--deadline-alert <off|default|0-14>` (`default` = clear the override on update; on create it is a no-op; a number or `off` on create needs `--deadline`)
  - `dt task list --deadline YYYY-MM-DD` (open tasks with a deadline on or before; conflicts with `--project`, `--due`, `--include-completed`)
  - `dt task deadline backfill [--apply] [--report-loose]` → JSON `{matches:[{task_id,title,deadline_date}], already_set, skipped:[{task_id,title,reason,detail}], loose:[{task_id,title,text}], applied}`, where `reason ∈ invalid_date | several_dates | conflicts_with_existing`
  - `nimble_core::db::deadline_backfill::{plan(pool, report_loose) -> Result<BackfillPlan>, apply_direct(pool, &mut BackfillPlan) -> Result<()>, exact_line(&str) -> Option<&str>, is_loose(&str) -> bool}`

- [ ] **Step 1: Write the failing tests**

Create `nimble-core/src/db/deadline_backfill.rs` with only its test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    #[test]
    fn exact_lines_and_loose_mentions() {
        assert_eq!(exact_line("**Deadline: 2026-10-31** — coverage lapses"), Some("2026-10-31"));
        assert_eq!(exact_line("  **Deadline:2026-10-31**"), Some("2026-10-31"));
        assert_eq!(exact_line("**Deadline: 2026-02-30**"), Some("2026-02-30"), "shape only; the date is checked by plan()");
        for no in ["Deadline: 2026-10-31", "**Deadline: 10/31/2026**", "**Deadline: 2026-10-31", "x **Deadline: 2026-10-31**", "**deadline: 2026-10-31**"] {
            assert_eq!(exact_line(no), None, "{no:?}");
        }
        assert!(is_loose("deadline 11/01 for the forms"));
        assert!(is_loose("COBRA election by 10/31"));
        assert!(!is_loose("Call Dana by Friday"));
        assert!(!is_loose("Pay rent"));
    }

    #[tokio::test]
    async fn plan_is_read_only_and_apply_is_idempotent() {
        let pool = test_pool().await;
        let mk = |c: &str, desc: &str, dl: Option<&str>| CreateTaskInput {
            content: c.into(), description: Some(desc.into()), deadline_date: dl.map(Into::into), ..Default::default()
        };
        let cobra = crate::db::tasks::create_local_task(&pool, mk("COBRA", "**Deadline: 2026-10-31** — coverage lapses\nForms in Drive", None)).await.unwrap();
        for input in [
            mk("Bad date", "**Deadline: 2026-02-30**", None),
            mk("Two dates", "**Deadline: 2026-10-01**\n**Deadline: 2026-10-02**", None),
            mk("Conflict", "**Deadline: 2026-10-31**", Some("2026-11-01")),
            mk("Same", "**Deadline: 2026-10-31**\n**Deadline: 2026-10-31**", Some("2026-10-31")),
            mk("COBRA election by 10/31", "", None),
        ] {
            crate::db::tasks::create_local_task(&pool, input).await.unwrap();
        }
        let done = crate::db::tasks::create_local_task(&pool, mk("Done", "**Deadline: 2026-09-01**", None)).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &done.id, "complete", None).await.unwrap();

        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log").fetch_one(&pool).await.unwrap();
        let p = plan(&pool, true).await.unwrap();
        assert_eq!(p.matches, vec![BackfillMatch { task_id: cobra.id.clone(), title: "COBRA".into(), deadline_date: "2026-10-31".into() }]);
        assert_eq!(p.already_set, 1);
        let mut reasons: Vec<(&str, &str)> = p.skipped.iter().map(|s| (s.title.as_str(), s.reason.as_str())).collect();
        reasons.sort();
        assert_eq!(reasons, [("Bad date", "invalid_date"), ("Conflict", "conflicts_with_existing"), ("Two dates", "several_dates")]);
        assert!(p.loose.iter().any(|l| l.title == "COBRA election by 10/31"));
        assert!(p.loose.iter().all(|l| !l.text.starts_with("**Deadline:")), "exact lines are never loose");
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sync_log").fetch_one(&pool).await.unwrap();
        assert_eq!(before, after, "the preview writes nothing");

        let mut p = plan(&pool, false).await.unwrap();
        assert!(p.loose.is_empty());
        apply_direct(&pool, &mut p).await.unwrap();
        assert_eq!(p.applied, 1);
        let (dl, desc): (Option<String>, Option<String>) = sqlx::query_as("SELECT deadline_date, description FROM local_tasks WHERE id = ?")
            .bind(&cobra.id).fetch_one(&pool).await.unwrap();
        assert_eq!(dl.as_deref(), Some("2026-10-31"));
        assert_eq!(desc.as_deref(), Some("**Deadline: 2026-10-31** — coverage lapses\nForms in Drive"), "the description is never edited");

        let again = plan(&pool, false).await.unwrap();
        assert!(again.matches.is_empty());
        assert_eq!(again.already_set, 2, "a rerun is a no-op");
    }
}
```

Add `pub mod deadline_backfill;` to `nimble-core/src/db/mod.rs` (after `pub mod tasks;`).

Append to `tools/dt/tests/contracts.rs`:

```rust
/// Review Focus 5 (dt): every bad input exits 2 and writes nothing.
#[tokio::test]
async fn deadline_flags_round_trip_and_invalid_input_exits_2() {
    let root = fixture().await;
    let (c, t) = run(&root, &["task", "create", "File COBRA election", "--due", "2026-10-27", "--deadline", "2026-10-31"]);
    assert_eq!(c, 0, "{t}");
    assert_eq!((t["data"]["deadline_date"].as_str(), t["data"]["due_date"].as_str()), (Some("2026-10-31"), Some("2026-10-27")));
    assert!(t["data"]["deadline_alert_days"].is_null());
    let id = data_id(&t);
    let id = id.as_str();
    let (c, v) = run(&root, &["task", "update", id, "--deadline-alert", "off"]);
    assert_eq!((c, v["data"]["deadline_alert_days"].as_i64()), (0, Some(-1)), "{v}");
    let (c, v) = run(&root, &["task", "update", id, "--deadline-alert", "3"]);
    assert_eq!((c, v["data"]["deadline_alert_days"].as_i64()), (0, Some(3)), "{v}");
    let (c, v) = run(&root, &["task", "update", id, "--deadline-alert", "default"]);
    assert!(c == 0 && v["data"]["deadline_alert_days"].is_null(), "{v}");
    let (c, v) = run(&root, &["task", "list", "--deadline", "2026-10-31"]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect::<Vec<_>>(), [id]);
    let (_, v) = run(&root, &["task", "list", "--deadline", "2026-10-30"]);
    assert!(v["data"].as_array().unwrap().is_empty());
    let (c, v) = run(&root, &["task", "get", id]);
    assert!(c == 0 && v["data"]["deadline_date"] == "2026-10-31", "get carries the field: {v}");
    let (c, v) = run(&root, &["task", "update", id, "--clear-deadline"]);
    assert!(c == 0 && v["data"]["deadline_date"].is_null() && v["data"]["deadline_alert_days"].is_null(), "{v}");

    let bad: Vec<Vec<&str>> = vec![
        vec!["task", "create", "x", "--deadline", "2026-02-30"],
        vec!["task", "create", "x", "--deadline", "2026-10-31T09:00"],
        vec!["task", "create", "x", "--deadline", ""],
        vec!["task", "create", "x", "--deadline-alert", "2"],
        vec!["task", "create", "x", "--clear-deadline"],
        vec!["task", "update", id, "--deadline", "2026-11-01", "--clear-deadline"],
        vec!["task", "update", id, "--deadline-alert", "15"],
        vec!["task", "update", id, "--deadline-alert", "soon"],
        vec!["task", "update", id, "--deadline-alert", "2"],
        vec!["task", "list", "--deadline", "2026-10-31", "--due", "2026-10-31"],
    ];
    for args in &bad {
        let (c, v) = run(&root, args);
        assert_eq!(c, 2, "{args:?} {v}");
    }
    let (_, all) = run(&root, &["task", "list"]);
    assert_eq!(all["data"].as_array().unwrap().len(), 1, "nothing was created");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn deadline_backfill_previews_then_applies_once_with_the_app_closed() {
    let root = fixture().await;
    let (_, t) = run(&root, &["task", "create", "COBRA", "--description", "**Deadline: 2026-10-31** — coverage lapses"]);
    let id = data_id(&t);
    run(&root, &["task", "create", "Loose", "--description", "deadline 11/01 for the forms"]);
    let (c, p) = run(&root, &["task", "deadline", "backfill", "--report-loose"]);
    assert_eq!(c, 0, "{p}");
    assert_eq!(p["data"]["matches"][0]["task_id"], id.as_str());
    assert_eq!(p["data"]["applied"], 0);
    assert_eq!(p["data"]["loose"][0]["title"], "Loose");
    let (_, g) = run(&root, &["task", "get", id.as_str()]);
    assert!(g["data"]["deadline_date"].is_null(), "the preview wrote nothing");
    let (c, p) = run(&root, &["task", "deadline", "backfill", "--apply"]);
    assert_eq!((c, p["data"]["applied"].as_i64()), (0, Some(1)), "{p}");
    let (_, g) = run(&root, &["task", "get", id.as_str()]);
    assert_eq!(g["data"]["deadline_date"], "2026-10-31");
    let (_, p) = run(&root, &["task", "deadline", "backfill", "--apply"]);
    assert_eq!((p["data"]["applied"].as_i64(), p["data"]["already_set"].as_i64()), (Some(0), Some(1)));
    std::fs::remove_dir_all(root).unwrap();
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p nimble-core --offline deadline_backfill 2>&1 | tail -5; cargo build -p nimble-cli --offline && cargo test -p nimble-cli --offline --test contracts deadline 2>&1 | tail -10`
Expected: nimble-core fails to compile (`exact_line`, `plan` missing). The contract tests fail (`unexpected argument '--deadline'` → exit 2 on the first create, so the first `assert_eq!(c, 0)` fails).

- [ ] **Step 3: Implement the backfill module**

Put this above the test module in `nimble-core/src/db/deadline_backfill.rs`:

```rust
//! One-time conversion of `**Deadline: YYYY-MM-DD**` description lines into
//! the v28 field (spec §2). Preview by default, idempotent, open tasks only,
//! and the description is never edited. Free-text mentions ("deadline 11/01",
//! "COBRA election by 10/31") are listed for a human, never converted.

use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Default, Serialize, PartialEq)]
pub struct BackfillPlan {
    /// Would be set (preview) or were set (`applied` counts them).
    pub matches: Vec<BackfillMatch>,
    /// Already carry the line's date: nothing to do. A rerun lands here.
    pub already_set: usize,
    pub skipped: Vec<BackfillSkip>,
    /// Only with `report_loose`.
    pub loose: Vec<LooseMention>,
    pub applied: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackfillMatch {
    pub task_id: String,
    pub title: String,
    pub deadline_date: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct BackfillSkip {
    pub task_id: String,
    pub title: String,
    /// "invalid_date" | "several_dates" | "conflicts_with_existing"
    pub reason: String,
    pub detail: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct LooseMention {
    pub task_id: String,
    pub title: String,
    pub text: String,
}

/// The date in a line shaped `^\s*\*\*Deadline:\s*(\d{4}-\d{2}-\d{2})\*\*`.
pub fn exact_line(line: &str) -> Option<&str> {
    let rest = line.trim_start().strip_prefix("**Deadline:")?.trim_start();
    let date = rest.get(..10)?;
    let shaped = date.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    (shaped && rest[10..].starts_with("**")).then_some(date)
}

/// Worth a human look: "deadline" anywhere, or "by M/D".
pub fn is_loose(text: &str) -> bool {
    let lower = text.to_lowercase();
    if lower.contains("deadline") {
        return true;
    }
    let digits = |s: &str| s.chars().take_while(|c| c.is_ascii_digit()).count();
    lower.match_indices("by ").any(|(i, _)| {
        let tail = &lower[i + 3..];
        let a = digits(tail);
        (1..=2).contains(&a) && tail[a..].starts_with('/') && (1..=2).contains(&digits(&tail[a + 1..]))
    })
}

pub async fn plan(pool: &SqlitePool, report_loose: bool) -> crate::Result<BackfillPlan> {
    let tasks = crate::db::tasks::get_local_tasks(pool, None, None, false).await?;
    let mut out = BackfillPlan::default();
    for t in &tasks {
        let desc = t.description.as_deref().unwrap_or("");
        if report_loose {
            for text in std::iter::once(t.content.as_str()).chain(desc.lines()) {
                if exact_line(text).is_none() && is_loose(text) {
                    out.loose.push(LooseMention { task_id: t.id.clone(), title: t.content.clone(), text: text.trim().to_string() });
                }
            }
        }
        let mut dates: Vec<&str> = desc.lines().filter_map(exact_line).collect();
        dates.sort_unstable();
        dates.dedup();
        let skip = |reason: &str, detail: String| BackfillSkip {
            task_id: t.id.clone(), title: t.content.clone(), reason: reason.into(), detail,
        };
        match dates.as_slice() {
            [] => {}
            [one] if crate::deadline::parse(one).is_none() => out.skipped.push(skip("invalid_date", one.to_string())),
            [one] => match t.deadline_date.as_deref() {
                Some(existing) if existing == *one => out.already_set += 1,
                Some(existing) => out.skipped.push(skip("conflicts_with_existing", format!("field {existing}, line {one}"))),
                None => out.matches.push(BackfillMatch { task_id: t.id.clone(), title: t.content.clone(), deadline_date: one.to_string() }),
            },
            many => out.skipped.push(skip("several_dates", many.join(", "))),
        }
    }
    Ok(out)
}

/// The app-closed write path. Each write goes through `update_local_task`, so
/// it syncs to Turso and queues the Todoist push. `dt` routes through the
/// running app instead when it is open.
pub async fn apply_direct(pool: &SqlitePool, plan: &mut BackfillPlan) -> crate::Result<()> {
    for m in &plan.matches {
        crate::db::tasks::update_local_task(pool, &m.task_id, crate::types::UpdateTaskInput {
            deadline_date: Some(m.deadline_date.clone()),
            ..Default::default()
        }).await?;
        plan.applied += 1;
    }
    Ok(())
}
```

- [ ] **Step 4: `dt` arguments**

In `tools/dt/src/args.rs`, `Fields` (after `pub google_calendar_enabled: Option<bool>,`):

```rust
    /// Must be done by (YYYY-MM-DD). Keep --due for when to work on it.
    #[arg(long, conflicts_with = "clear_deadline")]
    pub deadline: Option<String>,
    #[arg(long)]
    pub clear_deadline: bool,
    /// Deadline alert: off, default, or 0–14 (days before).
    #[arg(long, conflicts_with = "clear_deadline")]
    pub deadline_alert: Option<String>,
```

`Task::List` gains:

```rust
        /// Open tasks with a deadline on or before this date.
        #[arg(long, conflicts_with_all = ["project", "due", "include_completed"])]
        deadline: Option<String>,
```

Add a variant to `pub enum Task` (after `Delete { id: String },`):

```rust
    #[command(subcommand)]
    Deadline(TaskDeadline),
```

and after the `Task` enum:

```rust
#[derive(Subcommand, Debug, Clone)]
pub enum TaskDeadline {
    /// One-time: turn `**Deadline: YYYY-MM-DD**` description lines into the deadline field. Preview unless --apply.
    Backfill {
        #[arg(long)]
        apply: bool,
        /// Also list free-text mentions ("deadline 11/01", "by 10/31") to set by hand.
        #[arg(long)]
        report_loose: bool,
    },
}
```

- [ ] **Step 5: `dt` behaviour**

In `tools/dt/src/commands/mod.rs`, add above `fn validate_fields`:

```rust
/// `--deadline-alert`: `off` → -1, `default` → clear the override, `0`–`14` → days.
#[derive(Clone, Copy)]
enum AlertFlag {
    Days(i64),
    Default,
}

fn deadline_alert(f: &Fields) -> Result<Option<AlertFlag>, CliError> {
    let Some(v) = f.deadline_alert.as_deref() else { return Ok(None) };
    match v.trim() {
        "off" => Ok(Some(AlertFlag::Days(-1))),
        "default" => Ok(Some(AlertFlag::Default)),
        n => n
            .parse::<i64>()
            .ok()
            .filter(|n| (0..=14).contains(n))
            .map(|n| Some(AlertFlag::Days(n)))
            .ok_or_else(|| CliError::validation("--deadline-alert takes off, default, or 0–14 (days before).")),
    }
}
```

In `validate_fields`, after the `if let Some(d) = &f.due { date(d)?; }` block:

```rust
    if let Some(d) = &f.deadline {
        date(d)?;
    }
    deadline_alert(f)?;
```

In `reject_clear_flags` (create-only validation), add `|| f.clear_deadline` to the condition, and before `Ok(())`:

```rust
    if matches!(deadline_alert(f)?, Some(AlertFlag::Days(_))) && f.deadline.is_none() {
        return Err(CliError::validation("--deadline-alert needs --deadline."));
    }
```

In `create_input`, replace the placeholders from Task 2 with:

```rust
        deadline_alert_days: match deadline_alert(&f) {
            Ok(Some(AlertFlag::Days(n))) => Some(n),
            _ => None,
        },
        deadline_date: f.deadline,
```

(Order the struct fields so the `deadline_alert(&f)` borrow happens before `f.deadline` is moved: put these two lines first in the literal, alert before date.)

In `update_input`, add as its first line `let alert = deadline_alert(&f).ok().flatten();` and to the literal:

```rust
        deadline_date: f.deadline,
        clear_deadline: f.clear_deadline,
        deadline_alert_days: match alert {
            Some(AlertFlag::Days(n)) => Some(n),
            _ => None,
        },
        clear_deadline_alert: matches!(alert, Some(AlertFlag::Default)),
```

In `execute`, change the `Task::List { project, due, include_completed }` arm to:

```rust
            Task::List {
                project,
                due,
                include_completed,
                deadline,
            } => {
                if let Some(d) = &deadline {
                    date(d)?;
                    return result(db::tasks::get_tasks_with_deadline_by(pool, d).await?, vec![]);
                }
                if let Some(d) = &due {
                    date(d)?;
                }
                result(
                    db::tasks::get_local_tasks(
                        pool,
                        project.as_deref(),
                        due.as_deref(),
                        include_completed,
                    )
                    .await?,
                    vec![],
                )
            }
```

and add the arm (next to `Task::Labels`):

```rust
            Task::Deadline(_) => Err(CliError::new("internal", "Handled before direct commands.")),
```

Append to `commands/mod.rs`:

```rust
/// `dt task deadline backfill [--apply] [--report-loose]` (spec §2). The
/// preview never writes. `--apply` with the app open backs up through it (no
/// backup, no write) and writes each match through its task service. With
/// the app closed it writes directly. A rerun counts already-set tasks and
/// writes nothing.
pub async fn deadline_backfill(
    pool: &SqlitePool,
    profile: &nimble_core::agent_protocol::AgentProfile,
    apply: bool,
    report_loose: bool,
) -> Result<(Value, String), CliError> {
    use nimble_core::db::deadline_backfill as b;
    let mut plan = b::plan(pool, report_loose).await?;
    if apply && !plan.matches.is_empty() {
        let app_open = nimble_core::agent_protocol::ProfileOwnerLock::is_held(&profile.database).unwrap_or(true);
        if app_open {
            crate::ipc::request(profile, AgentOperation::BackupNow).await?;
            for m in plan.matches.clone() {
                let command = nimble_core::db::focus::engine::NativeTaskCommand {
                    command_id: uuid::Uuid::new_v4().to_string(),
                    action: NativeTaskAction::Update {
                        id: m.task_id.clone(),
                        input: UpdateTaskInput { deadline_date: Some(m.deadline_date.clone()), ..Default::default() },
                    },
                };
                crate::ipc::native_task(profile, command).await.map_err(native_failure)?;
                plan.applied += 1;
            }
        } else {
            b::apply_direct(pool, &mut plan).await?;
        }
    }
    let text = backfill_text(&plan, apply);
    let data = serde_json::to_value(&plan).map_err(|_| CliError::new("internal", "Cannot encode result."))?;
    Ok((data, text))
}

/// A failed native write. The backfill is idempotent, so every message says to rerun.
fn native_failure(f: crate::ipc::NativeFailure) -> CliError {
    match f {
        crate::ipc::NativeFailure::AppNotRunning => CliError::new(
            "app_unreachable",
            "Nimble holds this profile but its assistant listener is unavailable. Quit and reopen Nimble, then run the backfill again; it skips what is already set.",
        ),
        crate::ipc::NativeFailure::NotSent(e) => e,
        crate::ipc::NativeFailure::Uncertain => CliError::new(
            "uncertain",
            "Nimble did not confirm a write. Run the backfill again; it skips tasks already set.",
        ),
        crate::ipc::NativeFailure::Rejected { code, message } => CliError::new(code, message),
    }
}

fn backfill_text(p: &nimble_core::db::deadline_backfill::BackfillPlan, apply: bool) -> String {
    use std::fmt::Write;
    let mut t = String::new();
    let _ = writeln!(t, "Deadline backfill: {}\n", if apply { "applied." } else { "preview, nothing written." });
    let _ = writeln!(t, "  {} {}", if apply { "Set:" } else { "Would set:" }, if apply { p.applied } else { p.matches.len() });
    for m in &p.matches {
        let _ = writeln!(t, "    {}  {}  ({})", m.deadline_date, m.title, m.task_id);
    }
    let _ = writeln!(t, "  Already set: {}", p.already_set);
    let _ = writeln!(t, "  Skipped: {}", p.skipped.len());
    for s in &p.skipped {
        let _ = writeln!(t, "    {}: {} — {} ({})", s.reason, s.title, s.detail, s.task_id);
    }
    if !p.loose.is_empty() {
        let _ = writeln!(t, "  Free-text mentions to set by hand: {}", p.loose.len());
        for l in &p.loose {
            let _ = writeln!(t, "    {} — \"{}\" ({})", l.title, l.text, l.task_id);
        }
    }
    t
}
```

(If `ipc::NativeFailure` has more variants than these four, map them the way `main.rs` does.)

In `tools/dt/src/main.rs`, directly after the `if let args::Command::Todoist(args::Todoist::ImportHistory { … }) = &cli.command { … }` block:

```rust
    if let args::Command::Task(args::Task::Deadline(args::TaskDeadline::Backfill { apply, report_loose })) = &cli.command {
        let outcome = commands::deadline_backfill(&open.pool, &open.profile, *apply, *report_loose).await;
        open.pool.close().await;
        let (data, text) = outcome?;
        return Ok((output::success(data, "not_required"), Some(text)));
    }
```

- [ ] **Step 6: Docs**

`docs/agent-access.md`:
- In the Commands table, change the task row to `| task | list, get, create, update, complete, reopen, status, delete, labels, \`deadline backfill [--apply] [--report-loose]\` |`.
- Replace the sentence that starts "Task creation supports project/parent IDs…" with: "Task creation supports project/parent IDs, description, priority (1–4), due date, due time, duration, recurrence, section, labels, reminder offset, explicit Google Calendar publishing intent, and a deadline (`--deadline YYYY-MM-DD`, `--deadline-alert off|default|0-14`). The deadline is the date a task must be done by; `--due` stays the day to work on it. Updates support these existing core fields except changing a parent, and add linked-document and explicit clear flags (including `--clear-deadline`)."
- After the recurrence paragraph, add: "`task list --deadline YYYY-MM-DD` lists open tasks whose deadline is on or before the date. `task deadline backfill` is a one-time, post-install conversion of `**Deadline: YYYY-MM-DD**` description lines into the field. It previews by default, skips invalid dates, several dates and conflicting existing values, never edits descriptions, and with `--report-loose` also lists free-text mentions to set by hand. `--apply` backs up through the running app and writes through it (directly when the app is closed); a rerun writes nothing."

`CLAUDE.md`:
- In "Commands", add after the `dt todoist import-history` bullet: `` - `dt task deadline backfill [--apply] [--report-loose]` — one-time (post-install, with Marco's OK) conversion of `**Deadline: YYYY-MM-DD**` description lines into the v28 deadline field; preview by default, idempotent, descriptions never edited. Code: `nimble-core/src/db/deadline_backfill.rs`. ``
- In "Database Migrations", change `Current version: **27**` to `Current version: **28**` and append inside the parenthesis, after the v27 item: `; v28: local_tasks.deadline_date (YYYY-MM-DD, "must be done by") + deadline_alert_days (NULL = Mac default, -1 off, 0–14), synced, remote gated by \`turso_schema_v28_upgraded\``.
- In "Key Tables", change the `local_tasks` line to end with `…status workflow, and a deadline (v28) separate from the due date`.
- In "Task Status Workflow", after the recurring-task bullet ("Completing a recurring task … the rule is inert in that case."), add: `- A recurring advance moves \`deadline_date\` by the same number of days as the due date (same write, \`deadline_date\` in the changed columns). Completing never clears a deadline.`
- In "Sync Protocol", add: `- Todoist deadlines ride the outbox as their own \`item_update\` (derived command uuid), so a refused deadline logs a \`nimble_gap\` activity and never fails the rest of the update. The first sync after v28 is one full pull (setting \`todoist_deadline_backfill_v28\`).`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test -p nimble-core --offline deadline_backfill && cargo build -p nimble-cli --offline && cargo test -p nimble-cli --offline --test contracts 2>&1 | grep -E "^test result|FAILED|panicked" && cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked|error\[" | sort | uniq -c`
Expected: all `ok`, including the existing contract `committed_task_succeeds_with_app_closed_and_preserves_fields`.

- [ ] **Step 8: Commit**

```bash
git add nimble-core/src/db/deadline_backfill.rs nimble-core/src/db/mod.rs tools/dt docs/agent-access.md CLAUDE.md
git commit -m "feat(deadline): dt --deadline flags, task list --deadline, one-time description backfill, docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

The shared skill protocol (`~/.claude/skills/references/nimble-dt.md`) is **not** edited here. It switches only once the installed `dt` has `--deadline` (Task 10, post-install step).

---

### Task 7: Frontend foundations — types, `lib/deadline.ts`, desktop + web data paths, mock

**Files:**
- Create: `apps/desktop/src/lib/deadline.ts`, `apps/desktop/tests/deadline.test.mjs`
- Modify: `packages/types/src/index.ts` (`LocalTask`, `DeadlineFilter`, `TaskSearchFilters`, `BriefTaskRef`), `packages/types/src/data-provider.ts` (`tasks.list/create/update` options)
- Modify: `apps/desktop/src/services/tauri.ts` (`getLocalTasks`, `createLocalTask`, `updateLocalTask`)
- Modify: `apps/desktop/src/services/turso/tasks.ts` (`SELECT_COLS`, `buildTaskQuery`, `toTask`, `createTask`, `setTaskStatus` advance, `updateReminderIntent` → `updateTaskIntent`), `services/turso/search.ts`, `services/turso-provider.ts`
- Modify: `apps/desktop/src/lib/taskPatch.ts`, `apps/desktop/src/lib/focusPrompt.ts`, `apps/desktop/tests/focusPrompt.test.mjs`
- Modify: `tools/mock-tauri.js` (`task()`, `create_local_task`, `update_local_task`, `get_local_tasks`, `search_tasks`)

**Interfaces:**
- Consumes: Tauri params from Task 2 (`deadlineDate`, `deadlineAlertDays`, `clearDeadline`, `clearDeadlineAlert`, `includeDeadlines`); the Turso columns from Task 1.
- Produces (all from `@/lib/deadline`, pure):
  - `type DeadlineFilter = 'any' | 'today' | 'this_week' | 'passed'` (declared in `@nimble/types`, re-exported)
  - `interface DeadlineValue { date: string | null; alertDays: number | null }`, `EMPTY_DEADLINE`
  - `deadlineLabel(deadline: string, today: string): { text, tone: 'strong' | 'normal', ariaLabel, days }`
  - `dayNumber(date): number | null`, `isDeadlineDate(date): boolean`, `daysUntil(deadline, today): number`, `addDays(date, n): string`, `shortDate(date, today): string`
  - `dueAfterDeadlineHint(due, deadline, today): string | null`
  - `matchesDeadline(task, filter, today): boolean`, `deadlineWhere(filter, today): { sql, args }`
  - `DEADLINE_BUCKETS`, `deadlineBucketKey(deadline, today)`, `groupByDeadline(tasks, today)`
  - `shiftDeadline(deadline, beforeDue, afterDue): string | null`
  - `ALERT_DAY_CHOICES`, `DEFAULT_ALERT_DAYS = 2`, `alertDaysLabel(days)`, `defaultAlertLabel(globalDays)`
  - `applyDeadlineIntent(task, { deadlineDate?, deadlineAlertDays?, clearDeadline?, clearDeadlineAlert? })` (throws on invalid)
  - `LocalTask.deadline_date: string | null`, `LocalTask.deadline_alert_days: number | null`
  - `dp.tasks.list({ …, includeDeadlines?: boolean })`, `dp.tasks.create({ …, deadlineDate?, deadlineAlertDays? })`, `dp.tasks.update({ …, deadlineDate?, deadlineAlertDays?, clearDeadline?, clearDeadlineAlert? })`, `TaskSearchFilters.deadline?: DeadlineFilter`
  - `TaskPatch.deadline?: DeadlineValue` → `taskPatchToUpdate` maps it (only what changed)

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/tests/deadline.test.mjs`:

```js
// Deadline field (spec 2026-09-25-deadline-field-design.md §4) — pure helpers.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deadlineLabel, dayNumber, isDeadlineDate, addDays, shortDate, dueAfterDeadlineHint, matchesDeadline,
  deadlineWhere, deadlineBucketKey, groupByDeadline, DEADLINE_BUCKETS, shiftDeadline, alertDaysLabel,
  defaultAlertLabel, ALERT_DAY_CHOICES, applyDeadlineIntent,
} from '../src/lib/deadline.ts'

const T = '2026-09-25' // a Friday

test('deadlineLabel: the §4.1 table', () => {
  const cases = [
    ['2026-10-06', 'due by Oct 6', 'normal', 'Deadline October 6, in 11 days'],
    ['2027-01-06', 'due by Jan 6, 2027', 'normal', 'Deadline January 6, 2027, in 103 days'],
    ['2026-09-28', 'due by Sep 28', 'normal', 'Deadline September 28, in 3 days'],
    ['2026-09-27', 'due by Sun', 'strong', 'Deadline September 27, in 2 days'],
    ['2026-09-26', 'due tomorrow', 'strong', 'Deadline September 26, tomorrow'],
    ['2026-09-25', 'due today', 'strong', 'Deadline September 25, today'],
    ['2026-09-24', 'was due Sep 24', 'normal', 'Deadline was September 24'],
    ['2025-10-06', 'was due Oct 6, 2025', 'normal', 'Deadline was October 6, 2025'],
  ]
  for (const [date, text, tone, aria] of cases) {
    const l = deadlineLabel(date, T)
    assert.deepEqual([l.text, l.tone, l.ariaLabel], [text, tone, aria], date)
  }
})

test('deadlineLabel: DST and New Year (Review Focus 1)', () => {
  assert.equal(deadlineLabel('2026-11-02', '2026-10-31').days, 2, 'the US clocks change on Nov 1')
  assert.equal(deadlineLabel('2026-11-02', '2026-10-31').text, 'due by Mon')
  assert.equal(deadlineLabel('2027-01-01', '2026-12-30').text, 'due by Fri')
  assert.equal(deadlineLabel('2027-01-06', '2026-12-30').text, 'due by Jan 6, 2027')
  assert.equal(deadlineLabel('2026-12-31', '2027-01-01').text, 'was due Dec 31, 2026')
  assert.equal(addDays('2026-10-31', 2), '2026-11-02')
  assert.equal(deadlineBucketKey('2026-11-02', '2026-10-31'), 'this_week')
})

test('dates: only real YYYY-MM-DD', () => {
  for (const ok of ['2026-10-31', '2028-02-29']) assert.ok(isDeadlineDate(ok), ok)
  for (const bad of ['2026-02-30', '2026-10-31T09:00', '', '10/31/2026', '2026-1-5']) assert.equal(dayNumber(bad), null, bad)
  assert.equal(shortDate('2027-03-01', T), 'Mar 1, 2027')
})

test('the due-after-deadline hint', () => {
  assert.equal(dueAfterDeadlineHint('2026-10-08', '2026-10-06', T), 'Due Oct 8 is after the Oct 6 deadline.')
  assert.equal(dueAfterDeadlineHint('2026-10-06', '2026-10-06', T), null)
  assert.equal(dueAfterDeadlineHint(null, '2026-10-06', T), null)
  assert.equal(dueAfterDeadlineHint('2026-10-08', null, T), null)
})

test('matchesDeadline and deadlineWhere agree on every window', () => {
  const t = (deadline_date, status = 'todo') => ({ deadline_date, status, completed: status === 'complete' })
  const rows = [t('2026-09-25'), t('2026-10-01'), t('2026-10-02'), t('2026-09-20'), t('2026-09-20', 'complete'), t(null), t('soon')]
  const pick = (f) => rows.map((r, i) => (matchesDeadline(r, f, T) ? i : -1)).filter((i) => i >= 0)
  assert.deepEqual(pick('any'), [0, 1, 2, 3, 4])
  assert.deepEqual(pick('today'), [0])
  assert.deepEqual(pick('this_week'), [0, 1])
  assert.deepEqual(pick('passed'), [3], 'open only')
  assert.deepEqual(deadlineWhere('any', T), { sql: 'deadline_date IS NOT NULL', args: [] })
  assert.deepEqual(deadlineWhere('today', T), { sql: 'deadline_date = ?', args: ['2026-09-25'] })
  assert.deepEqual(deadlineWhere('this_week', T), { sql: 'deadline_date >= ? AND deadline_date <= ?', args: ['2026-09-25', '2026-10-01'] })
  assert.deepEqual(deadlineWhere('passed', T), { sql: "deadline_date < ? AND status != 'complete'", args: ['2026-09-25'] })
})

test('groupByDeadline: fixed order, empty buckets dropped, deadline ↑ then priority ↓ then position ↑', () => {
  const t = (id, deadline_date, priority = 1, position = 0) => ({ id, deadline_date, priority, position })
  const groups = groupByDeadline([
    t('none', null), t('later', '2026-10-20'), t('wk-b', '2026-09-29', 1, 1), t('wk-a', '2026-09-29', 4, 2),
    t('wk-c', '2026-09-28'), t('tomorrow', '2026-09-26'), t('earlier', '2026-09-01'),
  ], T)
  assert.deepEqual(groups.map((g) => g.title), ['Earlier', 'Tomorrow', 'This week', 'Later', 'No deadline'])
  assert.deepEqual(groups.find((g) => g.key === 'this_week').tasks.map((x) => x.id), ['wk-c', 'wk-a', 'wk-b'])
  assert.deepEqual(DEADLINE_BUCKETS.map((b) => b.title), ['Earlier', 'Today', 'Tomorrow', 'This week', 'Later', 'No deadline'])
  assert.equal(deadlineBucketKey('2026-10-01', T), 'this_week')
  assert.equal(deadlineBucketKey('2026-10-02', T), 'later')
})

test('shiftDeadline follows the due delta and is inert without dates', () => {
  assert.equal(shiftDeadline('2026-10-24', '2026-10-18', '2026-11-01'), '2026-11-07')
  assert.equal(shiftDeadline(null, '2026-10-18', '2026-11-01'), null)
  assert.equal(shiftDeadline('2026-10-24', null, '2026-11-01'), '2026-10-24')
})

test('alert copy', () => {
  assert.deepEqual(ALERT_DAY_CHOICES.map(alertDaysLabel), ['Off', 'On the day', '1 day before', '2 days before', '3 days before', '1 week before'])
  assert.equal(defaultAlertLabel(2), 'Default (2 days before)')
})

test('applyDeadlineIntent mirrors core validation (Review Focus 5)', () => {
  const base = { id: 't', deadline_date: null, deadline_alert_days: null }
  assert.deepEqual(applyDeadlineIntent(base, { deadlineDate: '2026-10-31', deadlineAlertDays: 3 }), { ...base, deadline_date: '2026-10-31', deadline_alert_days: 3 })
  const set = { ...base, deadline_date: '2026-10-31', deadline_alert_days: 3 }
  assert.deepEqual(applyDeadlineIntent(set, { deadlineDate: '2026-11-02', clearDeadlineAlert: true }), { ...base, deadline_date: '2026-11-02' }, 'sets before clears')
  assert.deepEqual(applyDeadlineIntent(set, { clearDeadline: true }), base, 'clearing the date clears the alert')
  for (const bad of ['2026-02-30', '2026-10-31T09:00', '', '10/31/2026']) {
    assert.throws(() => applyDeadlineIntent(base, { deadlineDate: bad }), /real YYYY-MM-DD/, bad)
  }
  for (const n of [-2, 15, 1.5]) assert.throws(() => applyDeadlineIntent(set, { deadlineAlertDays: n }), /-1 \(off\) or 0–14/)
  assert.throws(() => applyDeadlineIntent(base, { deadlineAlertDays: 2 }), /needs a deadline/)
})
```

Append to `apps/desktop/tests/focusPrompt.test.mjs`:

```js
test('prompt carries the deadline line', () => {
  assert.match(buildFocusPrompt(task({ deadline_date: '2026-10-31' }), [], snapshot()), /\*\*Deadline:\*\* 2026-10-31/)
  assert.match(buildFocusPrompt(task(), [], snapshot()), /\*\*Deadline:\*\* none/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && node --test tests/deadline.test.mjs tests/focusPrompt.test.mjs 2>&1 | tail -8`
Expected: FAIL, `Cannot find module '../src/lib/deadline.ts'`, and the focusPrompt deadline test fails.

- [ ] **Step 3: Types**

`packages/types/src/index.ts`, `LocalTask` (after `google_calendar_enabled: boolean`):

```ts
  /** Must be done by (YYYY-MM-DD), separate from the due date. Schema v28. */
  deadline_date: string | null
  /** Alert N days before the deadline: null = the Mac's default, -1 = off, 0–14. */
  deadline_alert_days: number | null
```

Next to `TaskSearchFilters`:

```ts
/** The Omnibar deadline pill: `this_week` = today…+6; `passed` = open tasks only. */
export type DeadlineFilter = 'any' | 'today' | 'this_week' | 'passed'
```

and inside `TaskSearchFilters`: `deadline?: DeadlineFilter | null`. In `BriefTaskRef`: `deadline_date?: string | null`.

`packages/types/src/data-provider.ts`, `tasks.list` opts: add `/** With \`dueDate\`: also tasks whose deadline is on or before that date (Today). */ includeDeadlines?: boolean`. `tasks.create` opts: add `deadlineDate?: string` and `deadlineAlertDays?: number`. `tasks.update` opts: add `deadlineDate?: string`, `deadlineAlertDays?: number`, `clearDeadline?: boolean` and `clearDeadlineAlert?: boolean`.

- [ ] **Step 4: `lib/deadline.ts`**

Create `apps/desktop/src/lib/deadline.ts`:

```ts
/* Deadline field (schema v28, spec 2026-09-25-deadline-field-design.md):
   "must be done by", a floating calendar date. Pure — no JSX, no `@/`, no
   date-fns — so tests/deadline.test.mjs imports it directly. Day math runs
   on UTC day numbers, so DST never shifts a count. Design chunk D's copy
   pass owns the strings here. */
import type { DeadlineFilter } from '@nimble/types'

export type { DeadlineFilter }
export type DeadlineTone = 'strong' | 'normal'

export interface DeadlineLabel {
  /** Chip copy: "due by Oct 6", "due by Sat", "due tomorrow", "due today", "was due Oct 6". */
  text: string
  tone: DeadlineTone
  /** Accessible name and tooltip: "Deadline October 6, in 12 days". */
  ariaLabel: string
  /** Deadline day minus today; negative = passed. */
  days: number
}

/** The picker / chip value: the date and the per-task alert override. */
export interface DeadlineValue {
  date: string | null
  /** null = the Mac's default, -1 = off, 0–14 days before. */
  alertDays: number | null
}

export const EMPTY_DEADLINE: DeadlineValue = { date: null, alertDays: null }
/** The last three calendar days read strong (0, 1 or 2 days away). */
export const STRONG_DAYS = 2
export const DEFAULT_ALERT_DAYS = 2
/** Settings and picker choices in menu order (the picker adds "Default" first). */
export const ALERT_DAY_CHOICES: readonly number[] = [-1, 0, 1, 2, 3, 7]

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** UTC day number of a real `YYYY-MM-DD`; null for anything else ("2026-02-30", a time part, ""). */
export function dayNumber(date: string): number | null {
  const m = ISO_DATE.exec(date)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const t = Date.UTC(y, mo, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo || back.getUTCDate() !== d) return null
  return t / DAY_MS
}

export function isDeadlineDate(date: string): boolean {
  return dayNumber(date) !== null
}

function day(date: string): number {
  const n = dayNumber(date)
  if (n === null) throw new Error(`Not a YYYY-MM-DD date: ${date}`)
  return n
}

export function daysUntil(deadline: string, today: string): number {
  return day(deadline) - day(today)
}

export function addDays(date: string, n: number): string {
  return new Date((day(date) + n) * DAY_MS).toISOString().slice(0, 10)
}

function parts(date: string) {
  const d = new Date(day(date) * DAY_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() }
}

/** "Oct 6", or "Oct 6, 2027" in another year than today's. */
export function shortDate(date: string, today: string): string {
  const p = parts(date)
  const base = `${MONTHS_SHORT[p.m]} ${p.d}`
  return p.y === parts(today).y ? base : `${base}, ${p.y}`
}

function longDate(date: string, today: string): string {
  const p = parts(date)
  const base = `${MONTHS_LONG[p.m]} ${p.d}`
  return p.y === parts(today).y ? base : `${base}, ${p.y}`
}

/** §4.1: no colour in any state; a passed deadline is a neutral fact. */
export function deadlineLabel(deadline: string, today: string): DeadlineLabel {
  const days = daysUntil(deadline, today)
  const long = longDate(deadline, today)
  if (days < 0) {
    return { text: `was due ${shortDate(deadline, today)}`, tone: 'normal', ariaLabel: `Deadline was ${long}`, days }
  }
  const text =
    days === 0 ? 'due today'
      : days === 1 ? 'due tomorrow'
        : days === STRONG_DAYS ? `due by ${WEEKDAYS_SHORT[parts(deadline).w]}`
          : `due by ${shortDate(deadline, today)}`
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
  return { text, tone: days <= STRONG_DAYS ? 'strong' : 'normal', ariaLabel: `Deadline ${long}, ${when}`, days }
}

/** The detail page's one-line hint (informational, never blocks). */
export function dueAfterDeadlineHint(due: string | null, deadline: string | null, today: string): string | null {
  if (!due || !deadline || !isDeadlineDate(due) || !isDeadlineDate(deadline) || due <= deadline) return null
  return `Due ${shortDate(due, today)} is after the ${shortDate(deadline, today)} deadline.`
}

type DeadlineTask = { deadline_date: string | null; status?: string; completed?: boolean }

/** The Omnibar pill. Same windows as Rust `deadline_clause` and `deadlineWhere`. */
export function matchesDeadline(task: DeadlineTask, filter: DeadlineFilter, today: string): boolean {
  const d = task.deadline_date
  if (!d || !isDeadlineDate(d)) return false
  const days = daysUntil(d, today)
  switch (filter) {
    case 'any': return true
    case 'today': return days === 0
    case 'this_week': return days >= 0 && days <= 6
    case 'passed': return days < 0 && !(task.completed || task.status === 'complete')
  }
}

/** The web LIKE path's clause (unqualified columns, `?` placeholders). */
export function deadlineWhere(filter: DeadlineFilter, today: string): { sql: string; args: string[] } {
  switch (filter) {
    case 'any': return { sql: 'deadline_date IS NOT NULL', args: [] }
    case 'today': return { sql: 'deadline_date = ?', args: [today] }
    case 'this_week': return { sql: 'deadline_date >= ? AND deadline_date <= ?', args: [today, addDays(today, 6)] }
    case 'passed': return { sql: "deadline_date < ? AND status != 'complete'", args: [today] }
  }
}

// ── Group by Deadline (task-view.ts) ──

export type DeadlineBucketKey = 'earlier' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none'

/** "Earlier", never "Overdue" or "Passed": a place in time, not a verdict. */
export const DEADLINE_BUCKETS: readonly { key: DeadlineBucketKey; title: string }[] = [
  { key: 'earlier', title: 'Earlier' },
  { key: 'today', title: 'Today' },
  { key: 'tomorrow', title: 'Tomorrow' },
  { key: 'this_week', title: 'This week' },
  { key: 'later', title: 'Later' },
  { key: 'none', title: 'No deadline' },
]

export function deadlineBucketKey(deadline: string | null, today: string): DeadlineBucketKey {
  if (!deadline || !isDeadlineDate(deadline)) return 'none'
  const days = daysUntil(deadline, today)
  if (days < 0) return 'earlier'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days <= 6) return 'this_week'
  return 'later'
}

export function groupByDeadline<T extends { deadline_date: string | null; priority: number; position: number }>(
  tasks: readonly T[],
  today: string,
): { key: DeadlineBucketKey; title: string; tasks: T[] }[] {
  const byKey = new Map<DeadlineBucketKey, T[]>()
  for (const t of tasks) {
    const k = deadlineBucketKey(t.deadline_date, today)
    byKey.set(k, [...(byKey.get(k) ?? []), t])
  }
  const order = (a: T, b: T) =>
    (a.deadline_date ?? '').localeCompare(b.deadline_date ?? '') || b.priority - a.priority || a.position - b.position
  return DEADLINE_BUCKETS.flatMap((b) => {
    const list = byKey.get(b.key)
    return list?.length ? [{ key: b.key, title: b.title, tasks: [...list].sort(order) }] : []
  })
}

/** Recurrence (spec §9): the deadline moves by the due date's delta. */
export function shiftDeadline(deadline: string | null, beforeDue: string | null, afterDue: string | null): string | null {
  if (!deadline || !beforeDue || !afterDue) return deadline
  if (!isDeadlineDate(deadline) || !isDeadlineDate(beforeDue) || !isDeadlineDate(afterDue)) return deadline
  return addDays(deadline, day(afterDue) - day(beforeDue))
}

// ── Alerts (Mac only) ──

export function alertDaysLabel(days: number): string {
  if (days < 0) return 'Off'
  if (days === 0) return 'On the day'
  if (days === 7) return '1 week before'
  return days === 1 ? '1 day before' : `${days} days before`
}

/** The picker's first option, reflecting the Mac's setting: "Default (2 days before)". */
export function defaultAlertLabel(globalDays: number): string {
  return `Default (${alertDaysLabel(globalDays)})`
}

export interface DeadlineIntent {
  deadlineDate?: string
  deadlineAlertDays?: number
  clearDeadline?: boolean
  clearDeadlineAlert?: boolean
}

/** Web and mock writes, mirroring core (`task_tx` + `crate::deadline`):
 *  sets before clears; invalid input throws. */
export function applyDeadlineIntent<T extends { deadline_date: string | null; deadline_alert_days: number | null }>(
  task: T,
  i: DeadlineIntent,
): T {
  const next = { ...task }
  if (i.deadlineDate !== undefined) {
    if (!isDeadlineDate(i.deadlineDate)) throw new Error('A deadline must be a real YYYY-MM-DD date')
    next.deadline_date = i.deadlineDate
  }
  if (i.deadlineAlertDays !== undefined) {
    const n = i.deadlineAlertDays
    if (!Number.isInteger(n) || n < -1 || n > 14) throw new Error('A deadline alert is -1 (off) or 0–14 days before')
    next.deadline_alert_days = n
  }
  if (i.clearDeadline) {
    next.deadline_date = null
    next.deadline_alert_days = null
  }
  if (i.clearDeadlineAlert) next.deadline_alert_days = null
  if (next.deadline_alert_days !== null && next.deadline_date === null) throw new Error('A deadline alert needs a deadline')
  return next
}
```

- [ ] **Step 5: Desktop wrappers, patch mapping, prompt line**

`services/tauri.ts`:
- `getLocalTasks` opts: add `includeDeadlines?: boolean`, and pass `includeDeadlines: opts?.includeDeadlines` in the invoke args.
- `createLocalTask` opts: add `deadlineDate?: string` and `deadlineAlertDays?: number`, and pass `deadlineDate: opts.deadlineDate, deadlineAlertDays: opts.deadlineAlertDays,`.
- `updateLocalTask` opts type: add `deadlineDate?: string`, `deadlineAlertDays?: number`, `clearDeadline?: boolean` and `clearDeadlineAlert?: boolean`. It already passes `opts` through.

`lib/taskPatch.ts`: add `import type { DeadlineValue } from '@/lib/deadline'`, add `deadline?: DeadlineValue` to `TaskPatch`, add `'deadline_date' | 'deadline_alert_days'` to `PatchableTask`'s `Pick`, and before `if (patch.labelIds !== undefined)`:

```ts
  if (patch.deadline !== undefined) {
    // Same rule as due: only what changed, and a clear only for a field the task has.
    const dl = patch.deadline
    if (dl.date !== (task.deadline_date ?? null)) {
      if (dl.date === null) {
        if (task.deadline_date) {
          updates.clearDeadline = true
          touched = true
        }
      } else {
        updates.deadlineDate = dl.date
        touched = true
      }
    }
    if (dl.date !== null && dl.alertDays !== (task.deadline_alert_days ?? null)) {
      if (dl.alertDays === null) {
        if (task.deadline_alert_days != null) {
          updates.clearDeadlineAlert = true
          touched = true
        }
      } else {
        updates.deadlineAlertDays = dl.alertDays
        touched = true
      }
    }
  }
```

`lib/focusPrompt.ts`: in `buildFocusPrompt`, add after `` `**Due:** ${due}`, ``:

```ts
    `**Deadline:** ${task.deadline_date ?? 'none'}`,
```

- [ ] **Step 6: The web data path**

`services/turso/tasks.ts`:
- Append `, deadline_date, deadline_alert_days` to the end of `SELECT_COLS`.
- `ListTasksOptions`: add `includeDeadlines?: boolean`. In `buildTaskQuery`, destructure `includeDeadlines = false` and make the first statement inside `if (dueDate != null) {`:

```ts
    if (includeDeadlines) {
      // Mirrors get_local_tasks_due_or_deadline (nimble-core/src/db/tasks.rs) exactly.
      return {
        sql:
          `SELECT ${SELECT_COLS} FROM local_tasks WHERE ((due_date IS NOT NULL AND due_date <= ?) OR (deadline_date IS NOT NULL AND deadline_date <= ?))` +
          (includeCompleted ? '' : ' AND completed = 0') +
          ' ORDER BY MIN(COALESCE(due_date, deadline_date), COALESCE(deadline_date, due_date)), priority DESC, position',
        args: [text(dueDate), text(dueDate)],
      }
    }
```

- `toTask`: add `deadline_date: strOrNull(row, 'deadline_date'),` and `deadline_alert_days: numOrNull(row, 'deadline_alert_days'),`.
- `CreateTaskOptions`: add `deadlineDate?: string` and `deadlineAlertDays?: number`. In `createTask`, after the local-only refusal:

```ts
  let deadline: { deadline_date: string | null; deadline_alert_days: number | null }
  try {
    deadline = applyDeadlineIntent({ deadline_date: null, deadline_alert_days: null }, {
      deadlineDate: opts.deadlineDate, deadlineAlertDays: opts.deadlineAlertDays,
    })
  } catch (e) {
    throw new TursoError(e instanceof Error ? e.message : String(e))
  }
```

  In the `task` literal, add `deadline_date: deadline.deadline_date, deadline_alert_days: deadline.deadline_alert_days,`. Extend the INSERT to `… created_at, updated_at, deadline_date, deadline_alert_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` with the two extra args `textOrNull(task.deadline_date)` and `task.deadline_alert_days != null ? integer(task.deadline_alert_days) : textOrNull(null)`.
- `setTaskStatus`, in the `plan?.kind === 'advance'` branch: compute `const deadline = shiftDeadline(task.deadline_date, task.due_date, nextDue)`, add `deadline_date: deadline` to `rescheduled`, change the SQL to `'UPDATE local_tasks SET due_date = ?, due_time = ?, deadline_date = ?, status = ?, updated_at = ? WHERE id = ?'` with `textOrNull(deadline)` after `textOrNull(nextDueTime)`, and set `changedColumns: deadline !== task.deadline_date ? ['due_date', 'due_time', 'deadline_date', 'status'] : ['due_date', 'due_time', 'status']`.
- Replace `updateReminderIntent` with:

```ts
/** Web task editing: reminder intent and the deadline. Every other field keeps
 *  its "edited in the desktop app" boundary. */
export async function updateTaskIntent(opts: Parameters<DataProvider['tasks']['update']>[0]): Promise<LocalTask> {
  const supported = new Set([
    'id', 'reminderOffsetMinutes', 'googleCalendarEnabled', 'clearReminder',
    'deadlineDate', 'deadlineAlertDays', 'clearDeadline', 'clearDeadlineAlert',
  ])
  if (Object.entries(opts).some(([key, value]) => value !== undefined && !supported.has(key))) {
    throw new TursoError('This task field is edited in the desktop app')
  }
  const task = await fetchTask(opts.id)
  let next: LocalTask
  try {
    next = applyDeadlineIntent(applyReminderIntent(task, opts), opts)
  } catch (e) {
    throw new TursoError(e instanceof Error ? e.message : String(e))
  }
  const updated = { ...next, updated_at: rowTimestamp() }
  const changedColumns = [
    ...(opts.reminderOffsetMinutes !== undefined || opts.googleCalendarEnabled !== undefined || opts.clearReminder
      ? ['reminder_offset_minutes', 'google_calendar_enabled'] : []),
    ...(opts.deadlineDate !== undefined || opts.clearDeadline ? ['deadline_date'] : []),
    ...(opts.deadlineAlertDays !== undefined || opts.clearDeadlineAlert || opts.clearDeadline ? ['deadline_alert_days'] : []),
  ]
  await commit([{
    sql: 'UPDATE local_tasks SET reminder_offset_minutes = ?, google_calendar_enabled = ?, deadline_date = ?, deadline_alert_days = ?, updated_at = ? WHERE id = ?',
    args: [
      updated.reminder_offset_minutes === null ? textOrNull(null) : integer(updated.reminder_offset_minutes),
      integer(updated.google_calendar_enabled ? 1 : 0),
      textOrNull(updated.deadline_date),
      updated.deadline_alert_days === null ? textOrNull(null) : integer(updated.deadline_alert_days),
      text(updated.updated_at),
      text(task.id),
    ],
  }], [{ table: 'local_tasks', rowId: task.id, operation: 'UPDATE', snapshot: updated, changedColumns }])
  return updated
}
```

  Add `import { applyDeadlineIntent, shiftDeadline } from '@/lib/deadline'` at the top.
- `services/turso-provider.ts`: import `updateTaskIntent` instead of `updateReminderIntent`, and use `update: updateTaskIntent,`.
- `services/turso/search.ts`: add `import { deadlineWhere } from '@/lib/deadline'` and `import { localIsoDate } from '@/lib/briefDate'`, then directly before `const titleHasAll = …`:

```ts
  if (filters.deadline) {
    const w = deadlineWhere(filters.deadline, localIsoDate())
    where.push(w.sql)
    for (const a of w.args) args.push(text(a))
  }
```

- [ ] **Step 7: The mock**

In `tools/mock-tauri.js`:
- `task(o)` defaults: add `deadline_date: null,` and `deadline_alert_days: null,` after `section_id: null,`.
- `create_local_task`: add `deadline_date: (args && args.deadlineDate) || null,` and `deadline_alert_days: args && args.deadlineAlertDays != null ? args.deadlineAlertDays : null,`.
- `update_local_task` (sets before clears): after `if (args.sectionId) t.section_id = args.sectionId` add

```js
        if (args.deadlineDate) t.deadline_date = args.deadlineDate
        if (args.deadlineAlertDays !== undefined && args.deadlineAlertDays !== null) t.deadline_alert_days = args.deadlineAlertDays
```

  and after `if (args.clearDuration) t.duration_minutes = null` add

```js
        if (args.clearDeadline) { t.deadline_date = null; t.deadline_alert_days = null }
        if (args.clearDeadlineAlert) t.deadline_alert_days = null
```

- `get_local_tasks`: replace the `if (args.dueDate) out = out.filter(…)` line with

```js
        // includeDeadlines (Today): due OR deadline on or before the date, like Rust.
        if (args.dueDate && args.includeDeadlines) out = out.filter(function (t) {
          return (t.due_date && t.due_date <= args.dueDate) || (t.deadline_date && t.deadline_date <= args.dueDate)
        })
        else if (args.dueDate) out = out.filter(function (t) { return t.due_date && t.due_date <= args.dueDate })
```

- Above `var commands = {` (or next to `findTask`), add:

```js
  // Same windows as lib/deadline.ts matchesDeadline; "today" is the page
  // clock's local date (specs pin it with page.clock).
  function mockDeadlineMatch(t, filter) {
    var d = t.deadline_date
    if (!d) return false
    var now = new Date()
    var p = function (n) { return String(n).padStart(2, '0') }
    var today = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate())
    var days = Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
    if (filter === 'any') return true
    if (filter === 'today') return days === 0
    if (filter === 'this_week') return days >= 0 && days <= 6
    if (filter === 'passed') return days < 0 && t.status !== 'complete'
    return false
  }
```

- `search_tasks`: after the `if (labelIds.length && …) return false` line add `if (f.deadline && !mockDeadlineMatch(t, f.deadline)) return false`.

- [ ] **Step 8: Run the tests, the type check and the lint**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build 2>&1 | tail -3 && npm run build:web 2>&1 | tail -3 && npx eslint src 2>&1 | tail -1; cat /private/tmp/claude-501/deadline-eslint-baseline.txt`
Expected: `# fail 0`; both builds succeed (every `LocalTask` literal now has the two fields: `toTask` and `createTask`'s literal are the only ones); the ESLint count is no higher than the baseline.

- [ ] **Step 9: Commit**

```bash
git add packages/types apps/desktop/src/lib/deadline.ts apps/desktop/tests/deadline.test.mjs apps/desktop/tests/focusPrompt.test.mjs apps/desktop/src/services apps/desktop/src/lib/taskPatch.ts apps/desktop/src/lib/focusPrompt.ts tools/mock-tauri.js
git commit -m "feat(deadline): TS types, pure lib/deadline, desktop + web data paths, mock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 8: Row chip, ⇧B, the picker, the detail/create chip and hint, alert settings

**Files:**
- Create: `apps/desktop/src/components/tasks/DeadlinePopover.tsx`
- Modify: `apps/desktop/src/lib/rowMarks.ts`, `apps/desktop/src/lib/rowPickerKeys.ts`, `apps/desktop/src/lib/shortcuts.ts`
- Modify: `apps/desktop/src/components/tasks/RowMarks.tsx` (`RowMarkTask`, `DeadlineMark`, `RowEndPickerFor`)
- Modify: `apps/desktop/src/components/tasks/TaskItem.tsx` (`TaskItemData.deadlineDate`, `DeadlineBadge`, placement, `hasMark`)
- Modify: `apps/desktop/src/components/tasks/LocalTaskRow.tsx`, `apps/desktop/src/components/detail/TaskDetailPage.tsx` (pass the deadline; chip values)
- Modify: `apps/desktop/src/components/tasks/MetadataChips.tsx` (`ChipValues.deadline`, `DeadlineChip`, hint), `apps/desktop/src/components/tasks/TaskComposerCard.tsx` (initial value, create)
- Modify: `apps/desktop/src/components/settings/ReminderSection.tsx` (`DeadlineAlertSettings`)
- Modify: `apps/desktop/src/components/today/modules/DueTodayBox.tsx` (snapshot/preview chip)
- Test: `apps/desktop/tests/rowKeys.test.mjs`, `apps/desktop/tests/rowMarks.test.mjs`, `apps/desktop/e2e/t6-create-modal.spec.ts` (the Tab order now includes the Deadline chip)

**Interfaces:**
- Consumes: Task 7's `@/lib/deadline` (`deadlineLabel`, `isDeadlineDate`, `shortDate`, `dueAfterDeadlineHint`, `ALERT_DAY_CHOICES`, `DEFAULT_ALERT_DAYS`, `alertDaysLabel`, `defaultAlertLabel`, `DeadlineValue`, `EMPTY_DEADLINE`), `TaskPatch.deadline`, the `dp.tasks` options, and `useLocalToday` (`@/hooks/useLocalToday`).
- Produces:
  - `<DeadlinePopover value onChange open? onOpenChange? triggerProps? contentProps?>`, the same contract as `DueDatePopover`. Popup `aria-label="Deadline"`, the alert combobox `aria-label="Deadline alert"` (only when `dp.reminders.supported` and a date is set), and the button `Remove deadline`.
  - `RowMark` kind `'deadline'` (`{ kind: 'deadline'; label: string }`, name = the label); `RowPickerKind` `'deadline'`; `ROW_PICKER_KEYS.B = 'deadline'`; shortcut row `{ section: 'Tasks', keys: '⇧B', label: 'Set deadline of focused task' }`.
  - `TaskItemData.deadlineDate?: string | null`; row chip button accessible name `Deadline …` (e2e locator `getByRole('button', { name: /^Deadline / })`).
  - `ChipValues.deadline: DeadlineValue`; detail/create chip `Deadline` / `Deadline Oct 6` (✕ `Clear deadline`).

- [ ] **Step 1: Write the failing tests**

`apps/desktop/tests/rowKeys.test.mjs`:
- Change `assert.deepEqual({ ...ROW_PICKER_KEYS }, { p: 'priority', D: 'due', l: 'label', m: 'project' })` to `assert.deepEqual({ ...ROW_PICKER_KEYS }, { p: 'priority', D: 'due', l: 'label', m: 'project', B: 'deadline' })`, and rename that test to `'ROW_PICKER_KEYS maps exactly p, D, l, m and B to the five picker kinds'`.
- In `'rowPickerKind: bare p / ⇧D / l / m open their picker'`, add `assert.equal(rowPickerKind({ key: 'B' }), 'deadline')`.
- In `'rowPickerKind: ⌘ / ⌃ / ⌥ combos and auto-repeat are null'`, change the loop list to `['p', 'D', 'l', 'm', 'B']`.
- Add `{ keys: '⇧B', label: /deadline/i },` to `NEW`.
- In `'decideRowKey still skips p / D / l / m …'`, change `for (const key of ['p', 'D', 'l', 'm'])` to `for (const key of ['p', 'D', 'l', 'm', 'B'])`.

`apps/desktop/tests/rowMarks.test.mjs`, append:

```js
test('deadline mark name is the full deadline sentence (kind word first)', () => {
  assert.equal(rowMarkName({ kind: 'deadline', label: 'Deadline October 6, in 12 days' }), 'Deadline October 6, in 12 days')
  assert.match(rowMarkName({ kind: 'deadline', label: 'Deadline was July 28' }), /^Deadline\b/)
})
```

`apps/desktop/e2e/t6-create-modal.spec.ts` (runs in Task 10): the composer gains a Tab stop after Due. In `every Tab stop shows an unclipped indicator, in order`, change `for (let i = 0; i < 9; i++)` to `for (let i = 0; i < 10; i++)` and the expected order to `['Task title', 'Description', 'Priority', 'Due', 'Deadline', 'Labels', 'Inbox', 'Clear project', 'Add field', 'Cancel', 'Save']`. In the header contract, change `Priority → Due → Labels` to `Priority → Due → Deadline → Labels`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && node --test tests/rowKeys.test.mjs tests/rowMarks.test.mjs 2>&1 | tail -6`
Expected: FAIL (the mapping lacks `B`, and the shortcut row and the deadline mark name are missing).

- [ ] **Step 3: Pure mark name, row key, shortcut row**

`lib/rowMarks.ts`: add `| { kind: 'deadline'; label: string }` to `RowMark`, the case `case 'deadline': return mark.label` to `rowMarkName`, and to the header comment: `· "Deadline October 6, in 12 days" (lib/deadline.ts supplies the whole sentence)`.

`lib/rowPickerKeys.ts`: `export type RowPickerKind = 'priority' | 'due' | 'label' | 'project' | 'deadline'`, add `B: 'deadline',` to `ROW_PICKER_KEYS`, and update the header to read `p · ⇧D · l · m · ⇧B open the focused task row's priority, due-date, label, project and deadline picker (⇧B = due **B**y, deadline spec §4.1)`.

`lib/shortcuts.ts`: directly after `{ section: 'Tasks', keys: 'm', label: 'Move focused task to a project' },`:

```ts
  { section: 'Tasks', keys: '⇧B', label: 'Set deadline of focused task' },
```

- [ ] **Step 4: The picker**

Create `apps/desktop/src/components/tasks/DeadlinePopover.tsx`:

```tsx
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { format, parseISO } from 'date-fns'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useDataProvider } from '@/services/provider-context'
import {
  ALERT_DAY_CHOICES,
  DEFAULT_ALERT_DAYS,
  EMPTY_DEADLINE,
  alertDaysLabel,
  defaultAlertLabel,
  isDeadlineDate,
  type DeadlineValue,
} from '@/lib/deadline'

interface DeadlinePopoverProps {
  value: DeadlineValue
  onChange: (v: DeadlineValue) => void
  children: ReactNode /* trigger */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerProps?: ComponentProps<typeof PopoverTrigger>
  contentProps?: Partial<ComponentProps<typeof PopoverContent>>
}

const DEFAULT = 'default'

/**
 * Deadline picker (spec §4.2): DueDatePopover's calendar and its exact prop
 * contract (controlled or not, caller trigger or the div host), with one
 * Alert row in place of time/duration/repeat, and Remove deadline. Alerts
 * are Mac-only (`dp.reminders.supported`). Design chunk B's shared picker
 * absorbs this component.
 */
export function DeadlinePopover({ value, onChange, children, open: openProp, onOpenChange, triggerProps, contentProps }: DeadlinePopoverProps) {
  const dp = useDataProvider()
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const alerts = dp.reminders.supported
  const [globalDays, setGlobalDays] = useState(DEFAULT_ALERT_DAYS)

  // The Default option names the Mac's current setting.
  useEffect(() => {
    if (!open || !alerts) return
    let live = true
    dp.settings.get('deadline_alert_days').then((v) => {
      const n = v == null ? Number.NaN : Number(v)
      if (live) setGlobalDays(Number.isInteger(n) && n >= -1 && n <= 14 ? n : DEFAULT_ALERT_DAYS)
    }).catch(() => {})
    return () => { live = false }
  }, [open, alerts, dp])

  const handleOpenChange = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }

  const selected = value.date && isDeadlineDate(value.date) ? parseISO(value.date) : undefined
  const alertValue = value.alertDays == null ? DEFAULT : String(value.alertDays)

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* The div host (not a <button>) for callers whose trigger is a button:
          see DueDatePopover's note on nesting and `inline-flex`. */}
      <PopoverTrigger
        {...(triggerProps ?? {
          className: 'inline-flex items-center',
          nativeButton: false,
          render: <div className="inline-flex items-center" tabIndex={-1} />,
        })}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        aria-label="Deadline"
        {...contentProps}
        className={cn(
          'w-[228px] rounded-[10px] border border-input bg-card p-2 shadow-[0px_6px_16px_-2px_rgba(0,0,0,0.12)] ring-0',
          contentProps?.className,
        )}
      >
        <Calendar
          mode="single"
          selected={selected}
          // format/parseISO round-trip in local time, like DueDatePopover.
          onSelect={(date) => onChange(date ? { ...value, date: format(date, 'yyyy-MM-dd') } : EMPTY_DEADLINE)}
          className="p-0"
        />
        {value.date && (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
            {alerts && (
              <div className="flex items-center justify-between gap-2 px-1.5">
                <span className="text-meta text-muted-foreground">Alert</span>
                <Select
                  value={alertValue}
                  onValueChange={(v) => {
                    if (v == null) return
                    onChange({ ...value, alertDays: v === DEFAULT ? null : Number(v) })
                  }}
                >
                  <SelectTrigger size="sm" className="h-6 text-meta" aria-label="Deadline alert">
                    <SelectValue>
                      {value.alertDays == null ? defaultAlertLabel(globalDays) : alertDaysLabel(value.alertDays)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>{defaultAlertLabel(globalDays)}</SelectItem>
                    {ALERT_DAY_CHOICES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {alertDaysLabel(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <button
              type="button"
              onClick={() => onChange(EMPTY_DEADLINE)}
              className="flex h-7 w-full items-center justify-center rounded-[7px] text-body text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Remove deadline
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 5: The row mark, ⇧B at the row end, and the plain badge**

`RowMarks.tsx`:
- Add imports: `import { Flag } from 'lucide-react'`, `import { deadlineLabel, type DeadlineValue } from '@/lib/deadline'`, `import { useLocalToday } from '@/hooks/useLocalToday'`, `import { DeadlinePopover } from '@/components/tasks/DeadlinePopover'`.
- Add `'deadline_date' | 'deadline_alert_days'` to `RowMarkTask`'s first `Pick<LocalTask, …>` list.
- After `DueMark`, add:

```tsx
// ── Deadline ──

/** The deadline chip (spec §4.1), right after the due mark. Neutral in every
 * state: the last three days (0–2 away) lift to foreground + medium weight
 * with a filled flag; a passed deadline is a muted "was due …". Never red.
 * `date` is a valid YYYY-MM-DD (TaskItem checks). Chunk C: Chip. */
export function DeadlineMark({ task, rowId, date }: MarkProps & { date: string }) {
  const { open, onOpenChange } = useRowPicker(rowId, 'deadline')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const finalFocus = useRowFocus(rowId, triggerRef)
  const update = useTaskMarkUpdate(task)
  const label = deadlineLabel(date, useLocalToday())
  const strong = label.tone === 'strong'
  const value: DeadlineValue = { date, alertDays: task.deadline_alert_days ?? null }

  return (
    <DeadlinePopover
      value={value}
      // A new day (or Remove) closes the picker; an alert change keeps it open.
      onChange={(next) => {
        if (next.date !== value.date) onOpenChange(false)
        void update({ deadline: next })
      }}
      open={open}
      onOpenChange={onOpenChange}
      triggerProps={{
        ref: triggerRef,
        'aria-label': rowMarkName({ kind: 'deadline', label: label.ariaLabel }),
        title: label.ariaLabel,
        className: cn(MARK, TEXT_MARK, 'gap-1 text-meta tabular-nums', strong ? 'font-medium text-foreground' : 'text-muted-foreground'),
        onClick: stop,
      }}
      contentProps={{ align: 'end', finalFocus, onClick: stop }}
    >
      <Flag className="size-3" fill={strong ? 'currentColor' : 'none'} aria-hidden />
      {label.text}
    </DeadlinePopover>
  )
}
```

- In `RowEndPickerFor`'s `switch (kind)`, add before `case 'label':`:

```tsx
    case 'deadline': {
      const current: DeadlineValue = { date: task.deadline_date ?? null, alertDays: task.deadline_alert_days ?? null }
      return (
        <DeadlinePopover
          value={current}
          onChange={(next) => {
            if (next.date !== current.date) onOpenChange(false)
            void update({ deadline: next })
          }}
          open={open}
          onOpenChange={onOpenChange}
          triggerProps={triggerProps}
          contentProps={contentProps}
        >
          {null}
        </DeadlinePopover>
      )
    }
```

- Update the header comment's key list to `(p · ⇧D · l · m · ⇧B)`.

`TaskItem.tsx`:
- Imports: add `DeadlineMark` to the `./RowMarks` import, `import { deadlineLabel, isDeadlineDate } from '@/lib/deadline'`, `import { useLocalToday } from '@/hooks/useLocalToday'`, and `Flag` to the lucide import.
- After `function DueDateBadge …`, add:

```tsx
/* Read-only deadline chip for rows without marks (the detail page's
   subtask rows). Same copy and tone as DeadlineMark. */
function DeadlineBadge({ date }: { date: string }) {
  const label = deadlineLabel(date, useLocalToday())
  const strong = label.tone === 'strong'
  return (
    <span
      title={label.ariaLabel}
      className={cn('flex shrink-0 items-center gap-1 text-meta tabular-nums', strong ? 'font-medium text-foreground' : 'text-muted-foreground')}
    >
      <Flag className="size-3" fill={strong ? 'currentColor' : 'none'} aria-hidden />
      {label.text}
    </span>
  )
}
```

- `TaskItemData`: add `/** Hidden on completed rows (spec §4.1). */ deadlineDate?: string | null`.
- In `TaskItem`, after `const overflowCount = …`:

```tsx
  const deadline = !completed && task.deadlineDate && isDeadlineDate(task.deadlineDate) ? task.deadlineDate : null
```

  and add `deadline: !!deadline,` to `hasMark`.
- In the right cluster, directly after the due block (`{task.dueDate && markTask ? (<DueMark … />) : (task.dueDate && <DueDateBadge … />)}`) and before `{actions}`:

```tsx
          {deadline && (markTask ? <DeadlineMark task={markTask} rowId={rowId} date={deadline} /> : <DeadlineBadge date={deadline} />)}
```

- Update the `onKeyDown` comment to `p · ⇧D · l · m · ⇧B`.

`LocalTaskRow.tsx`: in the `TaskItem task={{ … }}` literal, add `deadlineDate: task.deadline_date,` after `dueDate: task.due_date,`.
`TaskDetailPage.tsx`: in `subtaskItems`' mapping, add `deadlineDate: sub.deadline_date,` after `dueDate: sub.due_date,`.

- [ ] **Step 6: The detail/create chip and the hint**

`MetadataChips.tsx`:
- Imports: add `Flag` to the lucide import; `import { DeadlinePopover } from '@/components/tasks/DeadlinePopover'`; `import { EMPTY_DEADLINE, dueAfterDeadlineHint, isDeadlineDate, shortDate, type DeadlineValue } from '@/lib/deadline'`; `import { localIsoDate } from '@/lib/briefDate'`.
- `ChipValues`: add `deadline: DeadlineValue` after `due: DueValue`.
- After `DueChip`, add:

```tsx
// ── Deadline ── (chunk C: Chip)

function DeadlineChip({ value, onChange }: { value: DeadlineValue; onChange: (v: DeadlineValue) => void }) {
  if (!value.date) {
    return (
      <DeadlinePopover value={value} onChange={onChange}>
        <button type="button" tabIndex={0} className={cn(CHIP_EMPTY, 'gap-[5px]')}>
          <Flag className="size-3" aria-hidden />
          Deadline
        </button>
      </DeadlinePopover>
    )
  }
  const when = isDeadlineDate(value.date) ? shortDate(value.date, localIsoDate()) : value.date
  return (
    <FilledChip clear={<ClearButton onClear={() => onChange(EMPTY_DEADLINE)} label="Clear deadline" />}>
      <DeadlinePopover value={value} onChange={onChange}>
        <button type="button" tabIndex={0} className={CHIP_FILLED}>
          <Flag className="size-3" aria-hidden />
          Deadline {when}
        </button>
      </DeadlinePopover>
    </FilledChip>
  )
}
```

- In `MetadataChips`, compute `const hint = dueAfterDeadlineHint(values.due.dueDate, values.deadline.date, localIsoDate())` and render `<DeadlineChip value={values.deadline} onChange={(deadline) => onChange({ deadline })} />` directly after the `<DueChip … />`. Then change the return from `return ( <div className={cn('flex flex-wrap items-center gap-1.5')}> … </div> )` to a fragment, so the chip row stays the container's first `div` child (t6 measures `[data-composer-chips] > div`) and the hint sits under it:

```tsx
  return (
    <>
      <div className={cn('flex flex-wrap items-center gap-1.5')}>
        {/* the existing chips, with DeadlineChip after DueChip (unchanged otherwise) */}
      </div>
      {/* Informational only: a due date after the deadline is allowed (spec §9). */}
      {hint && <Meta as="p" className="mt-1.5">{hint}</Meta>}
    </>
  )
```

`TaskDetailPage.tsx`, in `chipValues`: add `deadline: { date: task?.deadline_date ?? null, alertDays: task?.deadline_alert_days ?? null },` after `due: { … },`. (`handleChipChange` already routes every patch through `taskPatchToUpdate`, which maps `deadline` since Task 7.)

`TaskComposerCard.tsx`:
- Import `EMPTY_DEADLINE` from `@/lib/deadline`.
- In `buildInitialChipValues`, add `deadline: defaults?.deadline ?? EMPTY_DEADLINE,`.
- In `handleSave`'s `dp.tasks.create({ … })`, add:

```ts
        deadlineDate: chipValues.deadline.date ?? undefined,
        deadlineAlertDays: chipValues.deadline.date ? chipValues.deadline.alertDays ?? undefined : undefined,
```

- [ ] **Step 7: Alert settings and the brief's read-only rows**

`components/settings/ReminderSection.tsx`: add imports `import { useEffect, useState } from 'react'` (merge with the existing import), `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'` and `import { ALERT_DAY_CHOICES, DEFAULT_ALERT_DAYS, alertDaysLabel } from '@/lib/deadline'`. Append:

```tsx
/** "Alert me [2 days before ▾] at [09:00]" (spec §6). Device-local settings,
 *  Mac only (this whole section needs `dp.reminders.supported`). The per-task
 *  override lives in the deadline picker. */
function DeadlineAlertSettings() {
  const dp = useDataProvider()
  const [days, setDays] = useState(DEFAULT_ALERT_DAYS)
  const [time, setTime] = useState('09:00')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    Promise.all([dp.settings.get('deadline_alert_days'), dp.settings.get('deadline_alert_time')])
      .then(([d, t]) => {
        if (!live) return
        const n = d == null ? Number.NaN : Number(d)
        if (Number.isInteger(n) && n >= -1 && n <= 14) setDays(n)
        if (t && /^\d{2}:\d{2}$/.test(t)) setTime(t)
      })
      .catch(() => { if (live) setError('Deadline alert settings could not load. Try again.') })
    return () => { live = false }
  }, [dp])
  const save = async (key: string, value: string) => {
    setError('')
    try { await dp.settings.set(key, value) } catch { setError('Could not save. Try again.') }
  }
  return (
    <div className="space-y-2">
      <SectionTitle>Deadline alerts</SectionTitle>
      <div className="flex flex-wrap items-center gap-2 text-body">
        <label htmlFor="deadline-alert-days">Alert me</label>
        <Select value={String(days)} onValueChange={(v) => { if (v == null) return; setDays(Number(v)); void save('deadline_alert_days', v) }}>
          <SelectTrigger id="deadline-alert-days" size="sm">
            <SelectValue>{alertDaysLabel(days)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ALERT_DAY_CHOICES.map((n) => <SelectItem key={n} value={String(n)}>{alertDaysLabel(n)}</SelectItem>)}
          </SelectContent>
        </Select>
        <label htmlFor="deadline-alert-time">at</label>
        <Input
          id="deadline-alert-time"
          type="time"
          className="h-7 w-28"
          value={time}
          disabled={days < 0}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => { if (/^\d{2}:\d{2}$/.test(time)) void save('deadline_alert_time', time) }}
        />
      </div>
      <Meta as="p">On for every deadline. A task can change its own alert in the deadline picker.</Meta>
      {error && <p role="alert" className="text-body text-destructive">{error}</p>}
    </div>
  )
}
```

and render `<DeadlineAlertSettings />` as the last child of `ReminderSection`'s `<section>` (after the timezone `<form>`).

`components/today/modules/DueTodayBox.tsx`: add `import { deadlineLabel, isDeadlineDate } from '@/lib/deadline'`. Give `DueTodayReadOnly` a `today: string` prop and let its `tasks` element type accept `deadline_date?: string | null`. After the title `<span>`, add:

```tsx
              {task.deadline_date && isDeadlineDate(task.deadline_date) && (
                <Meta className="shrink-0 tabular-nums">{deadlineLabel(task.deadline_date, today).text}</Meta>
              )}
```

Pass `today={date}` from `DueTodayBox` in both the snapshot and the preview branches (`BriefBoxProps` already carries `date`).

- [ ] **Step 8: Run the tests, the type check and the lint**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build 2>&1 | tail -3 && npm run build:web 2>&1 | tail -3 && npx eslint src 2>&1 | tail -1; cat /private/tmp/claude-501/deadline-eslint-baseline.txt`
Expected: `# fail 0` (`rowKeys`' collision tests pass: `B` is taken nowhere else, and plain `b` stays Today's brief toggle); both builds pass; lint is no higher than the baseline.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/components apps/desktop/src/lib/rowMarks.ts apps/desktop/src/lib/rowPickerKeys.ts apps/desktop/src/lib/shortcuts.ts apps/desktop/tests/rowKeys.test.mjs apps/desktop/tests/rowMarks.test.mjs apps/desktop/e2e/t6-create-modal.spec.ts
git commit -m "feat(deadline): row chip, ⇧B picker, detail/create chip and hint, Mac alert settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 9: Omnibar `deadline:` pill, Group by → Deadline, Today's live Due today / Still open

**Files:**
- Modify: `apps/desktop/src/lib/omnibarQuery.ts`, `apps/desktop/src/lib/omnibarSearch.ts`, `apps/desktop/src/components/omnibar/Omnibar.tsx`
- Modify: `apps/desktop/src/lib/task-view.ts`, `apps/desktop/src/components/tasks/TaskListHeader.tsx`, `apps/desktop/src/components/pages/TasksPage.tsx`
- Modify: `apps/desktop/src/lib/todayBrief.ts`, `apps/desktop/src/hooks/useLocalTasks.ts`, `apps/desktop/src/components/pages/TodayPage.tsx`
- Test: `apps/desktop/tests/omnibarQuery.test.mjs`, `apps/desktop/tests/omnibarSearch.test.mjs`, `apps/desktop/tests/todayBrief.test.mjs`

**Interfaces:**
- Consumes: `matchesDeadline`, `groupByDeadline` (Task 7), `DeadlineFilter` (`@nimble/types`), `dp.tasks.list({ includeDeadlines })` (Task 7), `useLocalToday`, `localIsoDate` (`lib/briefDate.ts`).
- Produces:
  - `PillKind` gains `'deadline'` (value `any|today|this_week|passed`, name `any|today|this week|passed`, rank after project, one at a time). `PillFilters.deadline: DeadlineFilter | null`. `hasTaskFilters` counts it.
  - `planSearch({ …, today?: string })`, where `SearchPlan.today: string` defaults to the local date. `browseTasks(tasks, f, today?)`. The backend filter carries `deadline` only when set.
  - `GroupBy` gains `'deadline'` (menu label `Deadline`, offered on All Tasks and in projects).
  - `splitDueTasks` treats "due today" as due OR deadline on the day. Still open adds passed deadlines and never repeats a Due-today row. `useLocalTasks({ …, includeDeadlines })`.

- [ ] **Step 1: Write the failing tests**

`tests/omnibarQuery.test.mjs`: change the two `pillFilters` deep-equals in `'pillFilters and hasTaskFilters'` to `{ status: 'open', labelIds: ['a', 'b'], projectId: 'p', type: 'doc', deadline: null }` and `{ status: 'all', labelIds: [], projectId: null, type: null, deadline: null }`, then append:

```js
test('deadline pills: aliases, one at a time, neutral names; "overdue" is not an alias (approval 2026-09-26)', () => {
  const top = (text) => suggestFilters(text, [], catalog)[0]
  for (const [text, value] of [
    ['deadline', 'any'], ['deadlines', 'any'], ['deadline today', 'today'],
    ['deadline this week', 'this_week'], ['deadlines this week', 'this_week'],
    ['deadline passed', 'passed'], ['past deadline', 'passed'], ['late', 'passed'], ['missed', 'passed'],
  ]) {
    const s = top(text)
    assert.deepEqual([s.pill.kind, s.pill.value], ['deadline', value], text)
  }
  assert.equal(pillText(top('late').pill), 'deadline: passed', 'the pill never says late or overdue')
  assert.equal(pillText(top('deadline this week').pill), 'deadline: this week')
  assert.ok(suggestFilters('overdue', [], catalog).every((s) => s.pill.kind !== 'deadline'))
  const one = addPill(addPill([], top('deadline today').pill), top('deadline passed').pill)
  assert.deepEqual(one.map(pillText), ['deadline: passed'], 'a new deadline pill replaces the old')
  const state = acceptSuggestion({ pills: [], text: 'taxes deadline this week' }, top('taxes deadline this week'))
  assert.deepEqual([state.pills.map(pillText), state.text], [['deadline: this week'], 'taxes '])
  const f = pillFilters([{ kind: 'deadline', value: 'passed', name: 'passed' }])
  assert.equal(f.deadline, 'passed')
  assert.equal(hasTaskFilters(f), true)
})
```

`tests/omnibarSearch.test.mjs`, append:

```js
test('a deadline pill narrows tasks by its window on both paths', async () => {
  const today = '2026-08-01'
  const pill = { kind: 'deadline', value: 'this_week', name: 'this week' }
  const listed = [
    task('a', 'todo', { deadline_date: '2026-08-03' }),
    task('b', 'todo', { deadline_date: '2026-08-11' }),
    task('c', 'todo', { deadline_date: null }),
  ]
  const browse = planSearch({ text: '', pills: [pill], mode: 'search', capability: desktop, today })
  assert.deepEqual(browse.groups, ['tasks'], 'task filters hide other groups')
  const { src } = sources({ listTasks: async () => listed })
  assert.deepEqual((await runSearch(browse, src, () => {})).tasks.map((h) => h.task.id), ['a'])

  const s = sources({ searchTasks: async (q, f) => { s.calls.push(['tasks', q, f]); return listed.map(hit) } })
  const byText = planSearch({ text: 'x', pills: [pill], mode: 'search', capability: desktop, today })
  const r = await runSearch(byText, s.src, () => {})
  assert.deepEqual(s.calls.find((c) => c[0] === 'tasks')[2], { status: 'all', label_ids: [], project_id: null, deadline: 'this_week' })
  assert.deepEqual(r.tasks.map((h) => h.task.id), ['a'], 'hits are re-checked client-side')
})
```

`tests/todayBrief.test.mjs`, append:

```js
test('splitDueTasks: a deadline today joins Due today once; a passed deadline joins Still open', () => {
  const t = (id, due, deadline, completed = false) => ({ id, due_date: due, deadline_date: deadline, parent_id: null, completed })
  const { dueToday, stillOpen } = splitDueTasks([
    t('due', '2026-09-23', null),
    t('deadline', '2026-09-30', '2026-09-23'),
    t('both', '2026-09-23', '2026-09-23'),
    t('undated', null, '2026-09-23'),
    t('passed', '2026-10-01', '2026-09-20'),
    t('old due', '2026-09-21', null),
    t('passed done', null, '2026-09-19', true),
    t('due today, deadline passed', '2026-09-23', '2026-09-22'),
  ], '2026-09-23')
  assert.deepEqual(dueToday.map((x) => x.id), ['due', 'deadline', 'both', 'undated', 'due today, deadline passed'])
  assert.deepEqual(stillOpen.map((x) => x.id), ['passed', 'old due'], 'earliest passed date first; never a Due-today row')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && node --test tests/omnibarQuery.test.mjs tests/omnibarSearch.test.mjs tests/todayBrief.test.mjs 2>&1 | tail -8`
Expected: FAIL (no deadline suggestions, `deadline` missing from `pillFilters`, and `splitDueTasks` ignores deadlines).

- [ ] **Step 3: The pill**

`lib/omnibarQuery.ts`:
- `import type { DeadlineFilter } from '@nimble/types'`
- `export type PillKind = 'status' | 'type' | 'label' | 'project' | 'deadline'`
- `PillFilters`: add `deadline: DeadlineFilter | null`.
- `const KIND_RANK: Record<PillKind, number> = { status: 0, type: 1, label: 2, project: 3, deadline: 4 }`
- After `TYPE_NAMES`:

```ts
/** Deadline windows (spec §4.3). The pill always reads the value's neutral
 *  name. "overdue" is deliberately not an alias (approval 2026-09-26): it may
 *  mean past due dates, and there is no due pill yet. */
const DEADLINE_NAMES: { value: DeadlineFilter; name: string; names: string[] }[] = [
  { value: 'any', name: 'any', names: ['deadline', 'deadlines'] },
  { value: 'today', name: 'today', names: ['deadline today'] },
  { value: 'this_week', name: 'this week', names: ['deadline this week', 'deadlines this week'] },
  { value: 'passed', name: 'passed', names: ['deadline passed', 'past deadline', 'late', 'missed'] },
]
```

- In `entries`, after the `TYPE_NAMES` line:

```ts
    ...DEADLINE_NAMES.map((d): Entry => ({ pill: { kind: 'deadline', value: d.value, name: d.name }, names: d.names })),
```

- `addPill`'s doc: `/** One status, type, project and deadline (a new one replaces); labels stack. */` (the code already replaces every non-label kind).
- `pillFilters`: add `deadline: (pills.find((p) => p.kind === 'deadline')?.value as DeadlineFilter | undefined) ?? null,`.
- `hasTaskFilters`: `return f.status !== 'all' || f.labelIds.length > 0 || f.projectId !== null || f.deadline !== null` and its doc `/** Status / label / project / deadline pills narrow tasks only. */`.

`lib/omnibarSearch.ts`:
- Imports: add `import { matchesDeadline } from './deadline.ts'` and `import { localIsoDate } from './briefDate.ts'`.
- `SearchPlan`: add `/** Local date for the deadline pill's windows. */ today: string`.
- `planSearch` opts: add `today?: string`, and return `{ text: opts.text.trim(), filters, groups, today: opts.today ?? localIsoDate() }`.
- Replace `browseTasks` with:

```ts
/** Pill-only query (no text for FTS): apply the pills here, open first. */
export function browseTasks(tasks: readonly LocalTask[], f: PillFilters, today: string = localIsoDate()): TaskSearchHit[] {
  const kept = tasks.filter((t) => {
    const done = t.status === 'complete'
    if (f.status === 'open' && done) return false
    if (f.status === 'completed' && !done) return false
    if (f.projectId && t.project_id !== f.projectId) return false
    if (f.deadline && !matchesDeadline(t, f.deadline, today)) return false
    return matchesAllLabels(t, f.labelIds)
  })
  const ordered = [...kept.filter((t) => t.status !== 'complete'), ...kept.filter((t) => t.status === 'complete')]
  return ordered.map((task): TaskSearchHit => ({ task, snippet: null, matched_in: 'title' }))
}
```

- In `runSearch`, build the filter and the text-path check as:

```ts
  const taskFilter: TaskSearchFilters = {
    status: f.status, label_ids: f.labelIds.slice(0, 1), project_id: f.projectId,
    ...(f.deadline ? { deadline: f.deadline } : {}),
  }
  const keep = (t: LocalTask) => matchesAllLabels(t, f.labelIds) && (!f.deadline || matchesDeadline(t, f.deadline, plan.today))
```

  Then use `.then((hits) => hits.filter((h) => keep(h.task)))` on the text path and `.then((all) => browseTasks(all, f, plan.today))` on the browse path.

`components/omnibar/Omnibar.tsx`: `import { useLocalToday } from '@/hooks/useLocalToday'`, `const today = useLocalToday()`, and change the plan memo to `useMemo(() => planSearch({ text, pills, mode, capability, today }), [text, pills, mode, capability, today])`.

- [ ] **Step 4: Group by → Deadline**

`lib/task-view.ts`:
- `import { groupByDeadline } from './deadline'` and `import { localIsoDate } from './briefDate'`
- `export type GroupBy = 'status' | 'priority' | 'due' | 'deadline' | 'section' | 'manual'`
- `export const ALL_GROUP_BY: readonly GroupBy[] = ['section', 'manual', 'status', 'priority', 'due', 'deadline']`
- In `groupTasks`, before `case 'section':`:

```ts
    // Earlier · Today · Tomorrow · This week · Later · No deadline (spec §4.4):
    // "Earlier" is a place in time, not a verdict. Empty buckets are dropped.
    case 'deadline':
      return groupByDeadline(topLevel, localIsoDate())
```

`components/tasks/TaskListHeader.tsx`: add `deadline: 'Deadline',` to `GROUP_BY_LABELS` after `due: 'Due date',`.
`components/pages/TasksPage.tsx`: `const ALL_TASKS_GROUP_BY: readonly GroupBy[] = ['status', 'priority', 'due', 'deadline']`.

(`ProjectDetailPage` offers `ALL_GROUP_BY` and disables drag outside section/manual, so Deadline arrives there too with no change.)

- [ ] **Step 5: Today's live lists**

`lib/todayBrief.ts`, replace `splitDueTasks` with:

```ts
/** Top-level tasks due today, or whose deadline is today (spec §5), with
 *  checked-off ones kept (struck through). Still open: the open ones whose
 *  due date or deadline passed, earliest first, never a Due-today row. */
export function splitDueTasks<T extends { due_date: string | null; deadline_date?: string | null; parent_id: string | null; completed: boolean }>(tasks: T[], today: string) {
  const top = tasks.filter((t) => !t.parent_id && (t.due_date || t.deadline_date))
  const onToday = (t: T) => t.due_date === today || t.deadline_date === today
  const passed = (t: T) => [t.due_date, t.deadline_date].filter((d): d is string => !!d && d < today).sort()[0]
  return {
    dueToday: top.filter(onToday),
    stillOpen: top
      .filter((t) => !t.completed && !onToday(t) && passed(t) !== undefined)
      .sort((a, b) => (passed(a) as string).localeCompare(passed(b) as string)),
  }
}
```

`hooks/useLocalTasks.ts`: add `includeDeadlines?: boolean` to the opts type, pass `includeDeadlines: opts?.includeDeadlines,` in `dp.tasks.list({ … })`, and add `opts?.includeDeadlines` to `refresh`'s dependency list.
`components/pages/TodayPage.tsx`: `useLocalTasks({ dueDate: today, includeCompleted: true, includeDeadlines: true })`, and extend the comment above it: `…; includeDeadlines brings tasks whose deadline is today or passed (spec §5).`

- [ ] **Step 6: Run the tests, the type check and the lint**

Run: `cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build 2>&1 | tail -3 && npm run build:web 2>&1 | tail -3 && npx eslint src 2>&1 | tail -1; cat /private/tmp/claude-501/deadline-eslint-baseline.txt`
Expected: `# fail 0`. The existing omnibar tests keep passing: the backend filter gains `deadline` only when a pill sets it, and no existing test input prefix-matches a deadline name. Both builds pass, and lint is no higher than the baseline.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/lib apps/desktop/src/components/omnibar/Omnibar.tsx apps/desktop/src/components/tasks/TaskListHeader.tsx apps/desktop/src/components/pages apps/desktop/src/hooks/useLocalTasks.ts apps/desktop/tests
git commit -m "feat(deadline): Omnibar deadline pill, Group by Deadline, Today's Due today reads deadlines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
```

---

### Task 10: Browser QA (Playwright + axe), full verification, and the post-merge runbook

**Files:**
- Create: `apps/desktop/e2e/d1-deadline.spec.ts`
- (No baseline edit expected. The spec reuses the existing axe keys `tasks`, `today`, `inbox-marks` and `omnibar`, which must hold with the new chips on screen.)

**Interfaces:**
- Consumes: everything above; the mock's `update_local_task` (`deadlineDate`, `clearDeadline`, `deadlineAlertDays`), and the accessible names from Task 8 (`/^Deadline /` chip buttons, the `Deadline` popup, the `Deadline alert` combobox, `Remove deadline`, the `Deadline` / `Deadline Aug 7` chips).
- Produces: `e2e/d1-deadline.spec.ts`; a green full suite on a frozen build of the branch head.

- [ ] **Step 1: Write the spec**

Create `apps/desktop/e2e/d1-deadline.spec.ts`:

```ts
/*
 * Deadline field — spec docs/superpowers/specs/2026-09-25-deadline-field-design.md §4, §10.
 * The clock is pinned to the mock world's today (Sat Aug 1 2026). Each test
 * seeds deadlines through the mock's own update_local_task after boot:
 *   task-06 today · task-17 tomorrow · task-10 in 2 days (Mon) · task-12 in 10 days
 *   task-09 passed (Jul 30) · task-14 (Inbox) passed (Jul 28)
 */
import { test, expect, expectNoNewAxeViolations } from './fixtures'
import type { Page } from '@playwright/test'

type Invoke = (cmd: string, args?: Record<string, unknown>, io?: unknown) => Promise<unknown>
type Recorded = { cmd: string; args: Record<string, unknown> | null }
type HarnessWindow = Window & { __TAURI_INTERNALS__: { invoke: Invoke }; __invokes: Recorded[] }

const MOCK_NOW = new Date('2026-08-01T10:00:00')

test.beforeEach(async ({ app, page }) => {
  void app // its init script installs the mock this wraps
  await page.clock.setFixedTime(MOCK_NOW)
  await page.addInitScript(() => {
    const w = window as unknown as HarnessWindow
    w.__invokes = []
    const orig = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (cmd, args, io) => {
      w.__invokes.push({ cmd, args: args === undefined ? null : JSON.parse(JSON.stringify(args)) })
      return orig(cmd, args, io)
    }
  })
})

const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as HarnessWindow).__invokes.filter((i) => i.cmd === c).map((i) => i.args), cmd)

async function seedDeadlines(page: Page) {
  await page.evaluate(async () => {
    const inv = (window as unknown as HarnessWindow).__TAURI_INTERNALS__.invoke
    const seed: [string, string][] = [
      ['task-06', '2026-08-01'], ['task-17', '2026-08-02'], ['task-10', '2026-08-03'],
      ['task-12', '2026-08-11'], ['task-09', '2026-07-30'], ['task-14', '2026-07-28'],
    ]
    for (const [id, date] of seed) await inv('update_local_task', { id, deadlineDate: date })
    window.dispatchEvent(new Event('tasks-changed'))
  })
}

const row = (page: Page, navId: string) => page.locator(`main [data-nav-row="${navId}"]`)
const chip = (page: Page, navId: string) => row(page, navId).getByRole('button', { name: /^Deadline / })

test('row chips read the §4.1 states and are never coloured', async ({ app, page }) => {
  await app.open('tasks')
  await seedDeadlines(page)
  const cases: [string, string, string, boolean][] = [
    ['task-06', 'due today', 'Deadline August 1, today', true],
    ['task-17', 'due tomorrow', 'Deadline August 2, tomorrow', true],
    ['task-10', 'due by Mon', 'Deadline August 3, in 2 days', true],
    ['task-12', 'due by Aug 11', 'Deadline August 11, in 10 days', false],
    ['task-09', 'was due Jul 30', 'Deadline was July 30', false],
  ]
  for (const [id, text, name, strong] of cases) {
    const c = chip(page, id)
    await expect(c).toHaveText(text)
    await expect(c).toHaveAccessibleName(name)
    await expect(c).toHaveAttribute('title', name)
    await expect(c).not.toHaveClass(/destructive|red|amber|orange|warning/)
    const weight = Number(await c.evaluate((el) => getComputedStyle(el).fontWeight))
    expect(weight >= 500, `${id} strong`).toBe(strong)
  }
  await expectNoNewAxeViolations(page, 'tasks')
})

test('a passed deadline on the Inbox reads "was due", muted', async ({ app, page }) => {
  await app.open('inbox')
  await seedDeadlines(page)
  const c = chip(page, 'task:task-14')
  await expect(c).toHaveText('was due Jul 28')
  await expect(c).toHaveAccessibleName('Deadline was July 28')
  expect(Number(await c.evaluate((el) => getComputedStyle(el).fontWeight))).toBeLessThan(500)
  await expectNoNewAxeViolations(page, 'inbox-marks')
})

test('⇧B opens the deadline picker on the focused row; pick, alert, remove', async ({ app, page }) => {
  await app.open('tasks')
  const r = row(page, 'task-05')
  await r.focus()
  await page.keyboard.press('Shift+B')
  const picker = page.getByRole('dialog', { name: 'Deadline' })
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: /August 5th, 2026/ }).click()
  await expect(picker).toBeHidden()
  await expect(r).toBeFocused()
  expect((await calls(page, 'update_local_task')).at(-1)).toMatchObject({ id: 'task-05', deadlineDate: '2026-08-05' })
  await expect(chip(page, 'task-05')).toHaveText('due by Aug 5')

  await chip(page, 'task-05').click()
  await expect(picker).toBeVisible()
  await picker.getByRole('combobox', { name: 'Deadline alert' }).click()
  await expect(page.getByRole('option', { name: 'Default (2 days before)' })).toBeVisible()
  await page.getByRole('option', { name: '1 day before' }).click()
  expect((await calls(page, 'update_local_task')).at(-1)).toMatchObject({ id: 'task-05', deadlineAlertDays: 1 })
  await expect(picker).toBeVisible()

  await picker.getByRole('button', { name: 'Remove deadline' }).click()
  expect((await calls(page, 'update_local_task')).at(-1)).toMatchObject({ id: 'task-05', clearDeadline: true })
  await expect(chip(page, 'task-05')).toHaveCount(0)
})

test('the create modal sets a deadline through its chip', async ({ app, page }) => {
  await app.open('tasks')
  await page.keyboard.press('q')
  const modal = page.getByRole('dialog', { name: 'New task' })
  await expect(modal).toBeVisible()
  await page.keyboard.type('File COBRA election')
  // `button` elements, not role=button: the popover's div host also carries the name (t6's idiom).
  await modal.locator('button', { hasText: /^Deadline$/ }).click()
  const picker = page.getByRole('dialog', { name: 'Deadline' })
  await picker.getByRole('button', { name: /August 7th, 2026/ }).click()
  await page.keyboard.press('Escape') // closes the picker, not the modal
  await expect(picker).toBeHidden()
  await expect(modal).toBeVisible()
  await expect(modal.locator('button', { hasText: /^Deadline Aug 7$/ })).toBeVisible()
  await modal.getByRole('button', { name: 'Save' }).click()
  expect((await calls(page, 'create_local_task')).at(-1)).toMatchObject({ content: 'File COBRA election', deadlineDate: '2026-08-07' })
})

test('Omnibar: "deadline this week" + Tab becomes the deadline: this week pill', async ({ app, page }) => {
  await app.open('tasks')
  await seedDeadlines(page)
  await page.keyboard.press('Meta+k')
  const bar = page.getByRole('dialog', { name: 'Command bar' })
  await expect(bar.getByRole('combobox', { name: 'Search or create' })).toBeFocused()
  await page.keyboard.type('deadline this week')
  await page.keyboard.press('Tab')
  await expect(bar.locator('[data-omnibar-pill]')).toHaveText(['deadline: this week'])
  const tasks = bar.getByRole('group', { name: 'Tasks', exact: true })
  for (const title of ['Design empty states for Goals page', 'Test capture flow on iPhone simulator', 'Book dentist appointment']) {
    await expect(tasks).toContainText(title)
  }
  await expect(tasks).not.toContainText('Update resume with Q2 launch metrics') // 10 days out
  await expect(tasks).not.toContainText('Renew car registration') // passed
  await expectNoNewAxeViolations(page, 'omnibar', { include: '[role="dialog"][aria-label="Command bar"]' })
})

test('Group by → Deadline buckets the list', async ({ app, page }) => {
  await app.open('tasks')
  await seedDeadlines(page)
  await page.locator('main').getByRole('button', { name: /^(Status|Section|Manual|Priority|Due date)$/ }).first().click()
  await page.getByRole('menuitemradio', { name: 'Deadline' }).click()
  const main = page.locator('main')
  for (const title of ['Earlier', 'This week', 'Later', 'No deadline']) {
    await expect(main.getByText(title, { exact: true }).first()).toBeVisible()
  }
  await expect(main.getByText('Overdue', { exact: true })).toHaveCount(0)
  await expectNoNewAxeViolations(page, 'tasks')
})

test('Due today on Today includes a task whose deadline is today', async ({ app, page }) => {
  await app.open('today')
  await seedDeadlines(page)
  await expect(row(page, 'task-06')).toBeVisible() // no due date: in the box only through its deadline
  await expect(chip(page, 'task-06')).toHaveText('due today')
  await expectNoNewAxeViolations(page, 'today')
})
```

- [ ] **Step 2: Commit, freeze, run the new spec**

```bash
git add apps/desktop/e2e/d1-deadline.spec.ts
git commit -m "test(deadline): browser QA for chips, ⇧B, create chip, pill, group-by, Due today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011g7xQX9AWFQVuMUD7ivKwb"
tools/qa-frozen.sh $(git rev-parse HEAD) /private/tmp/claude-501/deadline-qa 5308
cd apps/desktop && BASE_URL=http://localhost:5308 npx playwright test -c e2e d1-deadline
```

Expected: 7 passed. If a locator's name differs from the real markup (for example the create modal's save button), fix the **spec** to the app's real accessible name. Change the app only for a genuine defect: a missing name, the picker closing on an alert pick, or red on a chip. Re-freeze after every code change (`tools/qa-frozen.sh $(git rev-parse HEAD) …`), since QA never runs against a worktree that is being edited.

- [ ] **Step 3: Full verification on the frozen head**

Run:

```bash
cargo test --workspace --offline 2>&1 | grep -E "^test result|FAILED|panicked" | sort | uniq -c
cd apps/desktop && node --test tests/*.test.mjs 2>&1 | tail -3 && npm run build 2>&1 | tail -2 && npm run build:web 2>&1 | tail -2 && npx eslint src 2>&1 | tail -1
BASE_URL=http://localhost:5308 npx playwright test -c e2e 2>&1 | tail -5
```

Expected: every Rust `test result: ok`, `# fail 0`, both builds succeed, lint no higher than `/private/tmp/claude-501/deadline-eslint-baseline.txt`, and the whole Playwright suite passes (t1's geometry specs are untouched: their rows carry no deadline). Stop the preview server afterwards (`kill $(cat /private/tmp/claude-501/deadline-qa/preview.pid)`).

- [ ] **Step 4: Hand off (branch only; merging, installing and deploying are Marco's)**

Report to Marco: the branch head sha, the verification output above, and this runbook for after merge. Every step needs his OK, in this order:

1. **Merge and install on the Mac:** merge `deadline/v28` into `main`, `npm run update-app`, and rebuild and reinstall `dt` (`cargo build -p nimble-cli --release`; `profile.rs` pins schema 28). Opening the app runs the v28 migration.
2. **Turso gate before the web:** trigger one sync (`dt sync now`), then confirm `SELECT value FROM settings WHERE key='turso_schema_v28_upgraded'` returns `1` (read-only `sqlite3` on `nimble.db`). Only then deploy the web (`npm run build:web --workspace @nimble/desktop` through the usual Vercel deploy). The web's explicit column list fails with "no such column" until the gate has run.
3. **Todoist probe on one disposable task:** create a task in Nimble with `dt task create "Deadline probe" --deadline <date>` and confirm it in Todoist. Change the deadline in Todoist and confirm it in Nimble after a sync. Clear it both ways. Check `dt activity list --from <today> --to <today> --action nimble_gap` for any refusal. Delete the task.
4. **One-time full pull:** the first sync after install is the full pull (`todoist_deadline_backfill_v28`). Spot-check one task that already had a Todoist deadline.
5. **Description backfill:** `dt task deadline backfill --report-loose` (preview). Expect 0 exact matches (live count 2026-09-25) and about 24 loose mentions for Marco to set by hand. Run `--apply` only if there are matches.
6. **Switch the shared skill protocol** (only now: the installed `dt` has the flags). In `~/.claude/skills/references/nimble-dt.md`, add after the row `| Open tasks due on/before a date (incl. overdue) | … |`:
   `| Open tasks with a deadline on/before a date | \`dt --json task list --deadline YYYY-MM-DD\` |`
   and replace the bullet that starts `- **No deadline field.**` with:
   `- **Deadlines.** Set the hard date with \`--deadline YYYY-MM-DD\`. Keep \`--due\` for when to work on it. Put the consequence on the first description line as \`**Why this date:** <consequence>\`. Use priority 4 only when it blocks something.`
7. **Live acceptance (Marco, real app):** a synthetic-profile alert fires at the set time, and quit-then-reopen produces a catch-up card. The web reads and writes a deadline after deploy. Record the evidence in `docs/c2-c3-verification.md`, and update `NEXT.md` at wrap.

---

## Self-review (done while writing)

- **Spec coverage:** §0 decisions 1–10 → Tasks 2 (meaning, date-only, recurrence, subtasks own field), 8 (chip copy), 5 (brief, Due today), 4 (alerts), 9 (filter/group), 3 (Todoist), 6 (old text + `dt`), 5 (subtask effective deadline). §1 → Tasks 1–2. §2 → Task 6. §3.1 → Task 1 + runbook step 2. §3.2 → Task 3 + runbook step 3. §4.1 → Tasks 7–8. §4.2 → Task 8. §4.3 → Task 9 (with Plan decision 1). §4.4 → Task 9. §5 → Task 5 (Rust) + Task 9 (live Today). §6 → Task 4 + Task 8 settings. §7 → Task 6 + runbook step 6 (+ `focusPrompt` in Task 7). §8 → Task 7 (web SELECT/create/update/advance/search) and Tasks 8–9 (UI shared by web; alerts hidden by capability). §9 → Tasks 2, 4, 5, 7. §10 → the tests in each task, plus Task 10's e2e and the live acceptance in the runbook. §11 out of scope: nothing here adds deadline times, natural-language capture, parent rollups, calendar publishing, auto-parsing or a saved view.
- **Placeholders:** none. Two anchored "keep the existing code" instructions (the chip row in MetadataChips, the unchanged tail of the recurrence branch) name exactly what stays.
- **Type consistency:** `deadline_date` / `deadline_alert_days` (Rust, TS rows, SQL); `deadlineDate` / `deadlineAlertDays` / `clearDeadline` / `clearDeadlineAlert` (TS options, Tauri camelCase args, mock); `DeadlineValue { date, alertDays }` (picker, chips, `TaskPatch.deadline`); `DeadlineFilter` (types, pill, search filter); `deadline_command_uuid`, `deadline_refusals`, `pull_token`, `mark_deadline_backfill_done`, `DEADLINE_BACKFILL_SETTING` (Task 3 only); `get_local_tasks_due_or_deadline` (Tasks 2, 5, 7 web mirror); `RowPickerKind 'deadline'` / `RowMark kind 'deadline'` (Task 8).
- **Review Focus:** each of the five lines has a named test in its owning task (1: Tasks 7 and 4; 2: Tasks 1 and 3; 3: Task 3; 4: Task 4; 5: Tasks 2, 3, 6 and 7).
