# Deadline field (schema v28)

**Status:** draft for Marco's review, 2026-09-25. Decisions in §0 are Marco's; everything marked *(proposed)* is Claude's call and open to change. No product code yet.

## Goal

A task can carry a **deadline**, the date it must be done by, separate from its **due date**, the day Marco plans to work on it. The deadline shows on rows, drives the morning brief, alerts ahead of time, filters and groups lists, and round-trips with Todoist, `dt`, the web client and the skills. It never shames: a passed deadline reads as a neutral fact.

Success looks like:
- `dt task create "File COBRA election" --due 2026-10-27 --deadline 2026-10-31` shows "due by Oct 31" on the row, and the same deadline appears in Todoist and on the web within one sync.
- On Oct 29 the row reads "due by Sat" in the stronger style, the brief ranks the task near the top, and a Mac alert fired at 09:00 that morning.
- On Oct 31 the task sits in **Due today** even though its due date was Oct 27. On Nov 1, if it is still open, the row reads "was due Oct 31", in the muted style with no red.
- Typing `deadline this week` in the Omnibar and pressing Tab filters to those tasks.

## 0. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Meaning | Deadline = "must be done by". Due = "work on it". Independent fields; either can exist alone. (Marco) |
| 2 | Precision | **Date only**, `YYYY-MM-DD`, no time. Todoist's deadline is date-only too (§3.2), so a time would not round-trip. (Marco; confirmed by the API) |
| 3 | Row chip | "due by Oct 6". Stronger inside the last 3 days. No red. A passed deadline reads "was due Oct 6" in the muted style. (Marco) |
| 4 | Brief | Deadlines weigh in candidate selection, the AI prompt and the fallback. **Due today** includes tasks whose deadline is today. (Marco) |
| 5 | Alerts | Reuse the C2 reminder ledger. *(proposed)* Default **2 days before, at 09:00**, on for every deadline. A global setting plus a per-task override. Mac only. |
| 6 | Filter/sort | Omnibar `deadline:` pill. List **Group by → Deadline**. Pill names stay neutral (`passed`, never `overdue`). (Marco) |
| 7 | Todoist | Two-way through `deadline {date}`: pull, outbox push, reconcile, both importers. (Marco) |
| 8 | Old text | A one-time conversion of `**Deadline: YYYY-MM-DD**` description lines into the field that keeps the text. `dt` gains `--deadline` / `--clear-deadline`, and the shared skill protocol switches to them. (Marco) |
| 9 | Recurring | *(proposed)* When a recurrence advances the due date, the deadline moves by the same number of days. |
| 10 | Subtasks | *(proposed)* Subtasks can have their own deadline. The brief ranks a parent by the earliest open deadline among the parent and its subtasks. |

## 1. Data model: schema v28

One statement per `;`, because the migration runner splits on it.

```sql
ALTER TABLE local_tasks ADD COLUMN deadline_date TEXT;          -- YYYY-MM-DD or NULL
ALTER TABLE local_tasks ADD COLUMN deadline_alert_days INTEGER  -- NULL = global default, -1 = off, 0..14 = days before
```

- `LocalTask` (Rust `types.rs`, `@nimble/types`) gains `deadline_date: Option<String>` and `deadline_alert_days: Option<i64>`, both `#[serde(default)]`. `SELECT_COLS`, `CreateTaskInput` and `UpdateTaskInput` gain `deadline_date`, `deadline_alert_days`, `clear_deadline` and `clear_deadline_alert`. `clear_deadline` also nulls `deadline_alert_days`, the same way `clear_due_date` clears the reminder. Validation: the date must parse as a real date, and the alert value must be -1..=14.
- Writes go only through `db/tasks.rs`, which feeds `sync_log` and the Todoist observer. `tools/mock-tauri.js` `update_local_task` mirrors the field order (all sets before all clears).
- **No new SQL index.** About 1.4k rows, and every query is already a table scan by status/project. `tasks_fts` is unchanged: it indexes title and description, and the converted text stays in the description, so FTS still finds "Deadline".
- **Turso:** `ensure_remote_v28_schema` runs both ALTERs, tolerates "duplicate column name", and latches `turso_schema_v28_upgraded` only on success. The call goes at **all three** existing sites in `db/sync.rs`, alongside v27: the already-initialized branch of init (~l.459), the fresh-init tail (~l.695) and the push path (~l.1441). The columns are also added to the fresh-init `CREATE TABLE local_tasks`.
- **Backup/export:** `export_policy::tables_for_version` accepts 28, and both columns are *reviewed, included* in the `local_tasks` full and portable lists. Restoring a v27 backup into v28 leaves both columns NULL.
- **Mobile mirror:** skipped (dormant).

## 2. Converting old description lines (one-time)

`dt task deadline backfill [--apply] [--json]` previews by default, is idempotent, and is run once after install with Marco's OK, following the C4 seed-script pattern.
- The parser matches only lines of the form `^\s*\*\*Deadline:\s*(\d{4}-\d{2}-\d{2})\*\*` on **open** tasks. It sets `deadline_date` through `update_local_task`, so the change syncs to Turso and pushes to Todoist. **The description is never edited.**
- It skips and reports: an invalid date; two or more different dates in one description; a task whose existing `deadline_date` differs.
- **Live count (read-only, 2026-09-25): 0 exact matches.** The protocol line only started with C3. There are 24 free-text mentions ("deadline 11/01", "COBRA election by 10/31"). `--report-loose` lists them for Marco or an agent to set by hand. They are never auto-converted.

## 3. Sync

### 3.1 Turso / web
- Both columns ride the normal `local_tasks` snapshot (LWW). The gate from §1 must be latched on the Mac **before** the web build that selects `deadline_date` is deployed. Otherwise the web's explicit column list fails with "no such column". Deploy order: install on the Mac → one push → deploy the web.

### 3.2 Todoist (API v1, checked against developer.todoist.com/api/v1 on 2026-09-25)
- Task object: `"deadline": {"date": "YYYY-MM-DD", "lang": "en"}` or `null`. `lang` is output-only and unused. There is no time component. Sync `item_add` / `item_update` take `"deadline": {"date": "…"}`. REST uses `deadline_date` (string, or `null` to clear). Completed-task payloads carry the same object.
- **Pull:** `TodoistItem.deadline: Option<{date}>` → `TaskSnapshot.deadline_date` (`#[serde(default)]`, so stored bases without the field read as `None`). `merge_task` gains a `deadline_date` pick (three-way, same LWW rule), and `apply_pull` writes it.
- **Push:** the observer adds `"deadline_date"` to create payloads and to update payloads when the field changes. `sync_loop` maps that key to `"deadline": {"date": d}` or `"deadline": null`. The clear-with-`null` form in the Sync API is inferred from the `due: null` pattern, so a **live probe on a disposable task** confirms set, change and clear in both directions before activation.
- **Backfill of existing Todoist deadlines:** the pull is incremental, so tasks unchanged since the last sync would never bring their deadline. Once after v28, the sync token resets to `*`, gated by the setting `todoist_deadline_backfill_v28`. The three-way merge then fills deadlines from Todoist without touching other fields. Stored bases read `deadline_date: None`, so a remote deadline counts as a remote-only change and applies. Every other field still equals its base, so nothing else changes.
- **Reconcile** (`reconcile.rs`) and **importers** (`api/todoist_migration.rs` insert and update compare; C5 `history.rs` `apply_tx` insert, which reads `snapshot.deadline_date`) map the field. Whichever branch merges second (C5 or this one) adds the column to the other's INSERT.
- Refusals: Todoist gates some features by plan and may refuse deadlines on recurring tasks. If the probe or a later outbox error shows a refusal, the push drops the `deadline` arg for that case, logs `dt gap`, and keeps the deadline Nimble-only. A missing deadline is the base value, so the merge keeps the local one. One refused field never blocks the rest of the update.

## 4. UI

### 4.1 Row chip (`DeadlineMark` in `RowMarks.tsx`, placed right after the due mark)
The label comes from a pure `lib/deadlineLabel.ts`, which uses local calendar days (`parseISO`, no UTC conversion). **Strong** means deadline day minus today is 0, 1 or 2 (the last 3 calendar days). Strong uses `text-foreground font-medium` and a filled lucide `Flag`. Normal uses `text-muted-foreground` and an outline `Flag`. There is no colour in any state.

| State (open task) | Copy | Style |
|---|---|---|
| 3+ days away, same year | `due by Oct 6` | normal |
| 3+ days away, other year | `due by Jan 6, 2027` | normal |
| 2 days away | `due by Sat` | strong |
| tomorrow | `due tomorrow` | strong |
| today | `due today` | strong |
| passed | `was due Oct 6` (`, 2025` if another year) | normal |
| completed task | chip hidden in lists; the detail page shows the date | — |

- Accessible name: "Deadline October 6, in 12 days", "Deadline October 6, today", "Deadline was October 6". The tooltip text matches.
- Clicking the chip opens the deadline picker. **Row key ⇧B** ("due **B**y") is added to `ROW_PICKER_KEYS` as `deadline`, and `?` lists it.
- The chip recomputes on the existing day-rollover tick.

### 4.2 Picker, task detail, create modal
- **Picker:** reuse `DueDatePopover` with a new `mode="deadline"`. It keeps the calendar and presets and hides time, duration and repeat. In their place is one **Alert** row: `Default (2 days before)` · `Off` · `On the day` · `1 day before` · `2 days before` · `3 days before` · `1 week before`. There is also a **Remove deadline** action.
- **Task detail / `MetadataChips`:** a Deadline chip right after Due. It is empty as `⚑ Deadline`, and filled as `⚑ Deadline Oct 6` with a clear ×. When a due date falls after the deadline, a muted one-line hint shows under the chips: "Due Oct 8 is after the Oct 6 deadline." It is informational and never blocks.
- **Create modal (`QuickCreateDialog`)** gets the same chip through `MetadataChips`. Natural-language parsing of "by Friday" is out of scope.

### 4.3 Omnibar pill (`lib/omnibarQuery.ts`)
- New `PillKind` `deadline`, one pill at a time (a new one replaces the old), ranked after project. Values and the typed runs that suggest them:
  - `any` ← "deadline", "deadlines"
  - `today` ← "deadline today"
  - `this week` (today through +6 days) ← "deadline this week", "deadlines this week"
  - `passed` (open tasks only) ← "deadline passed", "past deadline", "overdue", "late", "missed". The pill always reads `deadline: passed`, whatever word was typed.
- The pill filters Tasks only and hides non-task groups, like the other pills. It passes to `search_tasks` as `deadline: 'any'|'today'|'this_week'|'passed'`. Pill-only queries filter `tasks.list` client-side, and the web's LIKE path applies the same predicate. Create carry-over ignores the pill (a window is not a date).

### 4.4 List grouping (`lib/task-view.ts`)
- `GroupBy` gains `deadline` ("Deadline" in the header menu). Buckets: **Earlier** · **Today** · **Tomorrow** · **This week** · **Later** · **No deadline**, with empty buckets dropped. Inside a bucket, tasks sort by deadline ascending, then priority descending, then position. The bucket is "Earlier", not "Overdue" or "Passed": it is a place in time, not a verdict.

## 5. Morning brief

- **Candidates (`brief/candidates.rs`):** `Candidate.deadline_date` holds the *effective* deadline, the earliest of the task's own and its open subtasks' deadlines. The `due_soon` tier also admits tasks with an effective deadline ≤ today+7, including passed ones. `urgency` sorts by `min(due, deadline)` first.
- **Prompt (`prompt.rs`):** each candidate line gains `deadline: 2026-10-06 (in 11 days)`, `(today)`, `(passed 2 days ago)` or `none`. A rule is added: "deadline is the date a task must be done by; due is when Marco planned to work on it. Weigh deadlines within 7 days heavily and treat one within 3 days as a strong reason to pick the task." The existing summary rule ("never mention anything late, missed or overdue") stands and also covers deadlines. The prompt test asserts both.
- **Fallback (`fallback.rs`):** in progress → deadline within 3 days (ascending) → priority → due → age.
- **Due today:** `modules/due_today.rs` gathers `due_date = date OR deadline_date = date`, deduped. `open_top_level` filters on due date, so this needs its own query for the deadline half. The live `briefLive.dueToday` (desktop and web) applies the same OR. The row's "due today" chip explains why the task is there. `task_ref` gains `deadline_date` so snapshots render the chip.
- **Still open:** it keeps its due-date rule and additionally lists open tasks whose deadline has passed. There is no new copy, and the row chip says "was due …".
- `brief_items`: no schema change.

## 6. Alerts (C2 reuse)

- `reminders::deadline_candidate(task, tz, defaults)` produces nothing for completed tasks, tasks without a deadline, or `deadline_alert_days = -1`. Otherwise `scheduled_at` = (deadline − N days) at the global alert time in the configured C2 timezone. DST handling matches the existing candidate. The occurrence key is `deadline|{id}|{date}|{N}|{HH:MM}|{tz}`, so any change supersedes the old alert. `collect_due` adds these candidates to `active`; left out, the sweep would mark them superseded.
- **Arriving late:** if an occurrence key is *first inserted* more than 90 s after its `scheduled_at`, it gets `state = 'skipped'` and never notifies or becomes a catch-up. That happens when a deadline is set or synced inside its alert window, and the row and brief already show it. A key already pending before sleep still becomes a normal catch-up card. `reminder_deliveries.state` has no CHECK constraint, so no migration is needed.
- **Copy:** the title is the task title. The body is "Due today", "Due tomorrow", or "Due by Thu, Oct 6". Catch-up uses the existing "Reminders to review" card.
- **Settings → Tasks & capture → Deadline alerts:** "Alert me [2 days before ▾] at [09:00]", with the day values from §4.2 minus Default. These are device-local `settings` keys `deadline_alert_days` (default 2) and `deadline_alert_time` (default `09:00`), because alerts are Mac-only. The per-task override syncs. Google Calendar phone publishing of deadlines is out of scope.

## 7. `dt` and skills

- `task create|update --deadline YYYY-MM-DD` · `--clear-deadline` · `--deadline-alert <off|default|0-14>`. `task list --deadline YYYY-MM-DD` returns open tasks with a deadline on or before the date. `task get` / `list` JSON includes both fields. The backfill command is in §2. `dt` contract tests cover each flag and the conflicts between them.
- `~/.claude/skills/references/nimble-dt.md`: the "No deadline field" rule is replaced with: "Set the hard date with `--deadline YYYY-MM-DD`. Keep `--due` for when to work on it. Put the consequence on the first description line as `**Why this date:** <consequence>`. Use priority 4 only when it blocks something." The row "Open tasks due on/before a date" gets a sibling row for `--deadline`. `docs/agent-access.md` and `lib/focusPrompt.ts` (adds a `**Deadline:** YYYY-MM-DD` line to the task block) are updated to match.

## 8. Web

- `TursoProvider` (`services/turso/tasks.ts`): both columns go in its `SELECT_COLS` (a mirror of the Rust constant), in create and update SQL, in the snapshot and in `changedColumns`. The web recurrence advance shifts the deadline (§9) the same way the Rust code does. Chip, picker, detail chip, Omnibar pill, group-by and Due today all work. Alerts and the global alert setting are desktop-only and hidden on the web through `dp` capability, never `if (web)`.

## 9. Edge cases

- **Deadline before due:** allowed and saved. The detail page shows the hint from §4.2, and nothing moves on its own.
- **Recurring:** in `task_tx`'s recurrence advance, the deadline shifts by the due date's delta, recorded in the same `task_recurred` transaction. A recurring task with a deadline but no due date has an inert rule, so the deadline stays. For a Todoist-linked recurring task, whatever the pull brings wins.
- **Completed:** no chip in lists, no alerts, not counted as a brief candidate or in `passed`. Reopening restores all of it. Completing never clears the deadline.
- **Subtasks:** each subtask has its own chip and alert. The parent shows no rollup chip. Only the brief uses the effective (earliest) deadline.
- **Dates and time zones:** deadlines are floating calendar dates, like all-day due dates. "Today" is the Mac's local date in Rust and the browser's local date on the web. Alerts use the C2 configured timezone. Travel never moves the date, only the alert's wall-clock time.
- **Invalid input** (`2026-02-30`, a time part): rejected by `dt` (exit 2) and by `db/tasks.rs`. A Todoist value with a time part is truncated to 10 characters, the same as due dates.

## 10. Testing

- **Rust:**
  - v28 migration and `CURRENT_SCHEMA_VERSION`; CRUD set, clear and clear-ordering; snapshot contains the fields
  - v28 gate at all three sites and in the fresh-init DDL; export policy for v28
  - mappers, merge, observer payload, and `sync_loop` args for set and clear; the one-time full-pull backfill; both importers and the reconcile
  - `deadline_candidate`: default, off, 0 days, DST, key change supersedes, late-first-seen skip
  - brief: tier, effective subtask deadline, prompt line and rule, fallback order, Due-today OR, still-open
  - backfill parser: valid, invalid, two dates, conflicting existing value, idempotent rerun
  - recurrence delta shift
- **Frontend (`node --test`):** `deadlineLabel` over the whole §4.1 table, including year boundaries and the 0/1/2/3-day edges; the omnibar deadline pills (aliases, replace-one, `passed` naming); the `task-view` deadline buckets and order; mock order.
- **e2e (Playwright + axe):** chip states on frozen dates; ⇧B opens the picker; set, clear and the alert option; the create-modal chip; the Omnibar Tab → `deadline: this week`; Group by Deadline; the Due today box shows a deadline-today task; the axe baseline holds. `tools/mock-tauri.js` gains every new field and command.
- **Live acceptance (Marco, real app):**
  1. Todoist probe on one disposable task: set, change and clear, both directions.
  2. Web read and write after deploy.
  3. A synthetic-profile alert fires at the set time, and a quit-then-reopen produces a catch-up card.
  4. The backfill preview reports 0 exact matches and lists the loose ones.

## 11. Out of scope

- Deadline times, and more than one deadline per task
- Natural-language "by Friday" in capture
- Rollup chips on parents
- Google Calendar or phone publishing of deadlines
- Auto-parsing free-text deadlines
- A saved "Deadlines" view or a page of its own
- Changing due-date semantics or the due chip's copy

## 12. Open questions (each with a recommended answer)

1. **Alert default:** is "2 days before at 09:00, on for every deadline" right, or should alerts be opt-in per task the way C2 reminders are? *Recommend on by default.* A deadline is the one date where a missed alert costs real money (EDD, COBRA, Carta).
2. **Recurring tasks:** shift the deadline with the due date, or clear it on each advance? *Recommend shift.* It keeps "certify by Sunday" attached to each biweekly occurrence.
3. **Skills after the field exists:** should skills stop writing `**Deadline: YYYY-MM-DD**` in favour of `--deadline` plus a `**Why this date:**` line? *Recommend yes.* Two copies of a date drift apart.
4. **"overdue" as an alias:** typing `overdue` suggests `deadline: passed`, but Marco might mean past *due dates*. *Recommend keeping the alias for now* (there is no due-date pill yet), and revisiting it if a due pill is added.

## Approval (2026-09-26)

Marco approved the spec and accepted all four open-question recommendations: alerts on by default (2 days before, 09:00); recurring tasks move the deadline with the due date; skills switch to `--deadline` + a "Why this date" line; typing "overdue" does not suggest a deadline filter for now.
