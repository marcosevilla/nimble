# Small Rust Batch (NEXT.md items 3 + 1c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-run setup skippable for the calendar, pin the Today "due on or before" task query, and make the Activity log name completed tasks and record focus sessions again.

**Architecture:** Every change is either a nimble-core Rust change with a unit/integration test, or the one-line frontend mirror a Rust change forces (the setup-gate mirror, the mock, one activity label). One new pure function in `db/activity.rs` decides which activity row a task status change becomes. Both status paths (the `dt`/headless path in `db/tasks.rs` and the desktop path through the focus engine) call it. The focus engine logs session rows only after its transaction commits, the same way `execute_native_task_inner` already does.

**Tech Stack:** Rust (nimble-core, sqlx/SQLite, tokio tests), TypeScript node:test (`apps/desktop/tests/*.test.mjs`), `tools/mock-tauri.js`.

**Spec:** `NEXT.md` items **3** and **1c**. Audit sources: `docs/audit-findings/settings/2026-09-23-loop1-rescore.md` (P1-4), `docs/audit-findings/today/2026-09-22-loop1.md` (P2-2), `docs/audit-findings/session/2026-09-23-loop1-rescore.md` (activity findings, lines ~50-65).

**Branch/worktree:** `fix/rust-batch` in `.claude/worktrees/rust-batch`, based on `main` (`6921835`; that is `ca1a939` plus a NEXT.md-only commit).

## Scope decisions (read first — this is what Marco reviews)

Research changed three of the five item-3 bullets. What this plan does **not** build, and why:

| NEXT.md bullet | Finding | This plan |
|---|---|---|
| Drop `ical_feed_url` from `REQUIRED_SETTINGS` | Real Rust change. | **Task 1** |
| `dueOnOrBefore` filter → Today "Still open" group | **Already exists.** `get_local_tasks(due_date=Some(d))` is `due_date <= ?` in Rust (`nimble-core/src/db/tasks.rs:121,126`) and in the web client (`services/turso/tasks.ts:66-67`). The real app already shows still-open tasks on Today, mixed into "Tasks". Only `tools/mock-tauri.js:1165` uses `===`, which is why the audit saw none. The "Still open" *UI* is container #7 of brief phase 1 (spec §3.2), so it is built once, there. | **Task 2** pins the semantics with a Rust test and fixes the mock. No Today UI change. |
| Habit `log()` intensity (hold-to-complete) | **No Rust needed.** `log_habit(pool, id, date, intensity)` → Tauri `log_habit` → `tauri.logHabit(habitId, date, intensity)` → `DataProvider.habits.log(habitId, date?, intensity?)` all exist. Only `stores/goalsStore.ts:74` drops the argument, and `HabitsSection.tsx` hold and click both call the same `onToggle`. Rust already defaults to 5, so a hold at 5 is the same as a click. | **Out.** It's a frontend change in Lane A's files and needs a product call (what intensity a click writes versus a hold). Question 2 below. |
| Soft-delete/restore → Undo for label, route, doc delete | True soft-delete needs `deleted_at` on 3 tables, a filter on ~50 read queries (labels 17, capture_routes 6, docs 9, task_tx 7, origin_label 5, todoist migration/observer/sync_loop, web `turso/labels.ts` + `turso/tasks.ts`), relaxing `UNIQUE(labels.name)` and `UNIQUE(capture_routes.prefix)`, and a Turso v23 schema gate. `lib/undoable.ts` (`createUndoable`) already implements **deferred commit**: hide the row, show a 5 s Undo toast, and call the real delete only on commit (used by `ReminderCatchUp.tsx:51-80`). All three callers (`LabelManager.tsx`, `SettingsPage.tsx:719`, `FolderTree.tsx:115`) are Lane A files. | **Out.** I recommend deferred commit, which is frontend-only and belongs to Lane A. Question 1 below. |
| ~~Review escape hatch~~ | Dropped 2026-09-23. | — |

Consequence: **this batch uses no migration.** v23 stays reserved for brief phase 1 (`briefs` table, spec §4.1).

**Lane boundaries respected:** no edits to SettingsPage, InboxPage, CommandBar*, NavSidebar, ProjectSidebar, FolderTree, useTaskNavigation, `lib/shortcuts.ts` or NEXT.md. Frontend touches are limited to what the Rust changes force: `lib/setupGate.ts` + its test, `components/setup/SetupDialog.tsx` (the field label only), one row in `lib/activityMeta.ts` + its test, and `tools/mock-tauri.js`. Heads-up for Lane A: the activityMeta row and the mock activity rows.

## Global Constraints

- Activity logging is fire-and-forget and never fails a user-facing command (`nimble/CLAUDE.md` Architecture Rules). Focus logging happens **after** `tx.commit()`; reads it needs inside the transaction swallow errors.
- Task/project mutations go through `db/tasks.rs` / task_tx. This plan adds no mutation, only log rows.
- No new npm or Cargo dependencies.
- Rust tests: `cargo test --workspace --offline`. Frontend tests: `node --test apps/desktop/tests/*.test.mjs` (from the `nimble/` root). Type check: `cd apps/desktop && npm run build` and `npm run build:web` (never bare `npx tsc --noEmit`, which checks nothing).
- `cn()` for classes; no guilt copy ("optional", never "skip at your own risk").

## Review Focus

1. **Focus complete of a recurring task.** It must log `task_recurred` (with title, from and to), not `task_completed`. The recurrence path leaves `status = 'todo'`. Pinned in Task 4.
2. **Replay of an already-committed focus command** (the same `command_id` sent twice) must not log twice. The receipt path returns before any logging. Pinned in Task 4.
3. **Reopening a completed task** (complete → todo) should read "Reopened task" with the title, not "Status changed". Pinned in Task 3.
4. **A setup with only the calendar blank** must finish, and launch must not show setup again. Pinned in Task 1 (Rust and TS).
5. **Completing through focus when the task was never started** (no session) logs the completion but no `focus_completed` with a 0 s duration. Pinned in Task 4.

---

### Task 1: Setup no longer requires the iCal feed

**Files:**
- Modify: `nimble-core/src/db/settings.rs:5-11` (the const) and append a `#[cfg(test)] mod tests`
- Modify: `apps/desktop/src/lib/setupGate.ts`
- Modify: `apps/desktop/tests/setupGate.test.mjs`
- Modify: `apps/desktop/src/components/setup/SetupDialog.tsx:22-43,67-69,104-107`

**Interfaces:**
- Produces: `SETUP_REQUIRED_KEYS` = `['todoist_api_token','obsidian_vault_path','anthropic_api_key']`; `check_setup_complete` true without `ical_feed_url`.

- [ ] **Step 1: Write the failing Rust test** (append to `nimble-core/src/db/settings.rs`)

```rust
#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn setup_completes_without_a_calendar_feed() {
        let pool = test_pool().await;
        for key in ["todoist_api_token", "obsidian_vault_path", "anthropic_api_key"] {
            super::set_setting(&pool, key, "x").await.unwrap();
        }
        assert!(super::check_setup_complete(&pool).await.unwrap());
    }

    #[tokio::test]
    async fn setup_still_requires_the_other_three() {
        let pool = test_pool().await;
        super::set_setting(&pool, "todoist_api_token", "x").await.unwrap();
        super::set_setting(&pool, "obsidian_vault_path", "x").await.unwrap();
        assert!(!super::check_setup_complete(&pool).await.unwrap());
    }
}
```

- [ ] **Step 2: Run it and verify it fails**

Run: `cargo test --offline -p nimble-core settings::tests`
Expected: `setup_completes_without_a_calendar_feed` FAILS (returns false); the other passes.

- [ ] **Step 3: Drop the key in Rust**

```rust
/// Required settings keys for the app to function. The calendar is optional
/// (setup P1-4): Today and the brief work without it.
const REQUIRED_SETTINGS: &[&str] = &[
    "todoist_api_token",
    "obsidian_vault_path",
    "anthropic_api_key",
];
```

- [ ] **Step 4: Update the TS test first** (`apps/desktop/tests/setupGate.test.mjs`): the first test's last line becomes
`assert.ok(!SETUP_REQUIRED_KEYS.includes('ical_feed_url'))`, and the second test ends with:

```js
  const { ical_feed_url: _omit, ...noIcal } = full
  assert.equal(isSetupReady(noIcal), true, 'the calendar is optional')
  assert.equal(isSetupReady({ ...full, anthropic_api_key: '   ' }), false)
```

Run: `node --test apps/desktop/tests/setupGate.test.mjs`. Expected: FAIL. The key list still differs from Rust.

- [ ] **Step 5: Update the mirror** (`apps/desktop/src/lib/setupGate.ts`)

```ts
/* First-run setup gate. These must match REQUIRED_SETTINGS in
   nimble-core/src/db/settings.rs: App.tsx re-runs check_setup_complete at
   every launch, so a setup that saves less than this reappears forever.
   tests/setupGate.test.mjs pins the two lists together. The calendar feed
   is optional (setup P1-4). */
export const SETUP_REQUIRED_KEYS = [
  'todoist_api_token',
  'obsidian_vault_path',
  'anthropic_api_key',
] as const
```

(`isSetupReady` is unchanged.)

- [ ] **Step 6: Mark the field optional in `SetupDialog.tsx`.** Add `optional?: boolean` to `SetupField`. Set `optional: true` on the `ical_feed_url` entry. Replace the stale comment at `:67-68` with `// Required keys mirror the Rust launch check (lib/setupGate.ts).` Render the label as:

```tsx
              <Label htmlFor={field.key} className="text-body-strong">
                {field.label}
                {field.optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
              </Label>
```

Check first: if `font-normal` trips the token gate (`tests/tokenGates.test.mjs`), use `<Meta as="span"> (optional)</Meta>` instead.

- [ ] **Step 7: Verify**

Run: `cargo test --offline -p nimble-core settings::tests && node --test apps/desktop/tests/setupGate.test.mjs apps/desktop/tests/tokenGates.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add nimble-core/src/db/settings.rs apps/desktop/src/lib/setupGate.ts apps/desktop/tests/setupGate.test.mjs apps/desktop/src/components/setup/SetupDialog.tsx
git commit -m "fix(setup): calendar feed is optional at first run (setup P1-4)"
```

---

### Task 2: Pin "due on or before" and make the mock match

**Files:**
- Modify: `nimble-core/src/db/tasks.rs` (add a test to `mod tests`, starting at `:691`)
- Modify: `tools/mock-tauri.js:1165`

**Interfaces:**
- Consumes: `get_local_tasks(pool, project_id: Option<&str>, due_date: Option<&str>, include_completed: bool)`
- Produces: nothing new. Brief phase 1's Still open container relies on this contract.

- [ ] **Step 1: Write the test** (in `mod tests` of `tasks.rs`)

```rust
    /// Today's list is "due on or before today": still-open tasks from
    /// earlier days come back with today's (brief phase 1 splits them into
    /// a Still open group). Undated and future tasks never do.
    #[tokio::test]
    async fn due_date_filter_means_due_on_or_before() {
        let pool = test_pool().await;
        let mk = |content: &str, due: Option<&str>| CreateTaskInput {
            content: content.into(),
            due_date: due.map(Into::into),
            ..Default::default()
        };
        for (c, d) in [("old", Some("2026-09-01")), ("today", Some("2026-09-23")),
                       ("later", Some("2026-09-24")), ("undated", None)] {
            super::create_local_task(&pool, mk(c, d)).await.unwrap();
        }
        let got: Vec<String> = super::get_local_tasks(&pool, None, Some("2026-09-23"), false)
            .await.unwrap().into_iter().map(|t| t.content).collect();
        assert_eq!(got, vec!["old".to_string(), "today".to_string()]);
    }
```

- [ ] **Step 2: Run it.** It should PASS immediately, because it pins existing behavior. If it fails, stop and report; don't change the query.

Run: `cargo test --offline -p nimble-core due_date_filter_means_due_on_or_before`

- [ ] **Step 3: Fix the mock** (`tools/mock-tauri.js:1165`)

```js
        // Matches Rust/web: "due on or before" (still-open tasks included).
        if (args.dueDate) out = out.filter(function (t) { return t.due_date && t.due_date <= args.dueDate })
```

- [ ] **Step 4: Commit**

```bash
git add nimble-core/src/db/tasks.rs tools/mock-tauri.js
git commit -m "test(tasks): pin due-on-or-before; mock stops hiding still-open tasks"
```

---

### Task 3: Status changes log a named completion (1c, part 1)

**Files:**
- Modify: `nimble-core/src/db/activity.rs` (new pure fn, logger, tests)
- Modify: `nimble-core/src/db/tasks.rs:364-373` (`update_task_status_inner`)
- Modify: `nimble-core/src/db/focus/engine.rs:1089-1097` (`NativeTaskAction::SetStatus` arm)
- Modify: `apps/desktop/src/lib/activityMeta.ts` (add `task_recurred`), `apps/desktop/tests/activityMeta.test.mjs`
- Modify: `tools/mock-tauri.js:958` (status_changed row shape)
- Modify: `nimble/CLAUDE.md` "Task Status Workflow" bullets
- Test: `nimble-core/tests/focus_engine.rs` (desktop path)

**Interfaces:**
- Produces (used by Task 4):

```rust
pub struct StatusActivity<'a> {
    pub content: Option<&'a str>,
    pub old_status: Option<&'a str>,
    pub new_status: &'a str,
    pub note: Option<&'a str>,
    /// (before_due, after_due) when completing advanced a recurring task.
    pub recurrence: Option<(&'a str, &'a str)>,
}
pub fn status_activity(s: &StatusActivity) -> (&'static str, serde_json::Value);
pub async fn log_task_status(pool: &SqlitePool, task_id: &str, s: StatusActivity<'_>);
```

Row shapes. They're chosen to fit the existing renderer: `ActivityTimeline.getDescription` prints `old → new` whenever **both** keys exist, and otherwise prints `content`.

| Case | action_type | metadata |
|---|---|---|
| recurrence | `task_recurred` | `{content, from, to}` |
| new = complete | `task_completed` | `{content, old_status}` (no `new_status`, so the title renders) |
| old = complete, new ≠ complete | `task_uncompleted` | `{content, new_status}` |
| otherwise | `status_changed` | `{content, old_status, new_status, note?}` |

`content` is omitted when unknown. `note` is included in any row when it's `Some`.

- [ ] **Step 1: Write failing unit tests** (append to `nimble-core/src/db/activity.rs`)

```rust
#[cfg(test)]
mod status_tests {
    use super::{status_activity, StatusActivity};
    use serde_json::json;

    fn s<'a>(old: Option<&'a str>, new: &'a str) -> StatusActivity<'a> {
        StatusActivity { content: Some("Pay taxes"), old_status: old, new_status: new, note: None, recurrence: None }
    }

    #[test]
    fn completion_is_a_named_task_completed() {
        let (a, m) = status_activity(&s(Some("in_progress"), "complete"));
        assert_eq!(a, "task_completed");
        assert_eq!(m, json!({"content": "Pay taxes", "old_status": "in_progress"}));
    }

    #[test]
    fn reopening_is_task_uncompleted() {
        let (a, m) = status_activity(&s(Some("complete"), "todo"));
        assert_eq!(a, "task_uncompleted");
        assert_eq!(m, json!({"content": "Pay taxes", "new_status": "todo"}));
    }

    #[test]
    fn recurrence_wins_over_completion() {
        let mut x = s(Some("todo"), "complete");
        x.recurrence = Some(("2026-09-01", "2026-09-02"));
        let (a, m) = status_activity(&x);
        assert_eq!(a, "task_recurred");
        assert_eq!(m, json!({"content": "Pay taxes", "from": "2026-09-01", "to": "2026-09-02"}));
    }

    #[test]
    fn other_moves_stay_status_changed_with_note() {
        let mut x = s(Some("todo"), "blocked");
        x.note = Some("waiting on Sara");
        let (a, m) = status_activity(&x);
        assert_eq!(a, "status_changed");
        assert_eq!(m, json!({"content": "Pay taxes", "old_status": "todo", "new_status": "blocked", "note": "waiting on Sara"}));
    }

    #[test]
    fn unknown_title_and_old_status_are_tolerated() {
        let x = StatusActivity { content: None, old_status: None, new_status: "in_progress", note: None, recurrence: None };
        let (a, m) = status_activity(&x);
        assert_eq!(a, "status_changed");
        assert_eq!(m, json!({"old_status": "", "new_status": "in_progress"}));
    }
}
```

- [ ] **Step 2: Run the tests and verify they fail to compile** (`status_activity` isn't defined yet).

Run: `cargo test --offline -p nimble-core status_tests`

- [ ] **Step 3: Implement** (in `activity.rs`, below `record_activity`)

```rust
/// One task status change, as the activity log sees it.
pub struct StatusActivity<'a> {
    pub content: Option<&'a str>,
    pub old_status: Option<&'a str>,
    pub new_status: &'a str,
    pub note: Option<&'a str>,
    /// (before_due, after_due) when completing advanced a recurring task.
    pub recurrence: Option<(&'a str, &'a str)>,
}

/// Which row a status change becomes. Completion and reopening get their own
/// actions carrying the title, so the timeline names the task and counts it
/// (re-score 1c: every completion read "Status changed" with no name). The
/// completed row deliberately has no `new_status`: the timeline prints
/// `old → new` whenever both keys exist, which would hide the title.
pub fn status_activity(s: &StatusActivity) -> (&'static str, serde_json::Value) {
    let mut meta = serde_json::Map::new();
    if let Some(c) = s.content {
        meta.insert("content".into(), c.into());
    }
    let action = if let Some((from, to)) = s.recurrence {
        meta.insert("from".into(), from.into());
        meta.insert("to".into(), to.into());
        "task_recurred"
    } else if s.new_status == "complete" {
        meta.insert("old_status".into(), s.old_status.unwrap_or_default().into());
        "task_completed"
    } else if s.old_status == Some("complete") {
        meta.insert("new_status".into(), s.new_status.into());
        "task_uncompleted"
    } else {
        meta.insert("old_status".into(), s.old_status.unwrap_or_default().into());
        meta.insert("new_status".into(), s.new_status.into());
        "status_changed"
    };
    if let Some(n) = s.note {
        meta.insert("note".into(), n.into());
    }
    (action, serde_json::Value::Object(meta))
}

/// Fire-and-forget, like `log_activity`.
pub async fn log_task_status(pool: &SqlitePool, task_id: &str, s: StatusActivity<'_>) {
    let (action, meta) = status_activity(&s);
    log_activity(pool, action, Some(task_id), Some(meta)).await;
}
```

- [ ] **Step 4: Run the unit tests and verify they PASS**

Run: `cargo test --offline -p nimble-core status_tests`

- [ ] **Step 5: Write failing path tests.** Add the headless path to `mod tests` in `tasks.rs`:

```rust
    async fn last_activity(pool: &sqlx::SqlitePool, id: &str) -> (String, serde_json::Value) {
        let (a, m): (String, Option<String>) = sqlx::query_as(
            "SELECT action_type, metadata FROM activity_log WHERE target_id=? ORDER BY rowid DESC LIMIT 1")
            .bind(id).fetch_one(pool).await.unwrap();
        (a, serde_json::from_str(&m.unwrap()).unwrap())
    }

    #[tokio::test]
    async fn completing_logs_task_completed_with_the_title() {
        let pool = test_pool().await;
        let t = super::create_local_task(&pool, CreateTaskInput { content: "Pay taxes".into(), ..Default::default() }).await.unwrap();
        super::update_task_status(&pool, &t.id, "complete", None).await.unwrap();
        let (a, m) = last_activity(&pool, &t.id).await;
        assert_eq!(a, "task_completed");
        assert_eq!(m["content"], "Pay taxes");
        super::update_task_status(&pool, &t.id, "todo", None).await.unwrap();
        assert_eq!(last_activity(&pool, &t.id).await.0, "task_uncompleted");
    }

    #[tokio::test]
    async fn completing_a_repeat_logs_task_recurred_with_the_title() {
        let pool = test_pool().await;
        let t = super::create_local_task(&pool, CreateTaskInput {
            content: "Water plants".into(), due_date: Some("2026-09-01".into()),
            recurrence_rule: Some("every day".into()), ..Default::default()
        }).await.unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 9, 1).unwrap();
        super::update_task_status_at(&pool, &t.id, "complete", None, today).await.unwrap();
        let (a, m) = last_activity(&pool, &t.id).await;
        assert_eq!(a, "task_recurred");
        assert_eq!(m["content"], "Water plants");
        assert_eq!(m["from"], "2026-09-01");
        assert_ne!(m["to"], m["from"]);
    }
```

Add the desktop path to `nimble-core/tests/focus_engine.rs`:

```rust
#[tokio::test]
async fn native_completion_logs_a_named_task_completed() {
    let h = fixture::Harness::new().await;
    let id = h.task("Ship batch").await;
    h.service.execute_native_task(NativeTaskCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        action: NativeTaskAction::SetStatus { id: id.clone(), status: "complete".into(), note: None, expected_due_date: None },
    }).await.unwrap();
    let (a, m): (String, Option<String>) = sqlx::query_as(
        "SELECT action_type, metadata FROM activity_log WHERE target_id=? ORDER BY rowid DESC LIMIT 1")
        .bind(&id).fetch_one(&h.pool).await.unwrap();
    let m: serde_json::Value = serde_json::from_str(&m.unwrap()).unwrap();
    assert_eq!(a, "task_completed");
    assert_eq!(m["content"], "Ship batch");
}
```

Run: `cargo test --offline -p nimble-core completing_ native_completion_logs`. Expected: FAIL (`status_changed`).

- [ ] **Step 6: Switch both call sites.** In `tasks.rs` `update_task_status_inner`, replace the `if let Some(recurrence) … else if …` block (`:364-373`) with:

```rust
    if effects.recurrence.is_some() || !effects.changed.is_empty() {
        let content = effects.changed.iter().find(|t| t.id == id).map(|t| t.content.as_str());
        activity::log_task_status(pool, id, activity::StatusActivity {
            content,
            old_status: effects.previous_status.as_deref(),
            new_status: status,
            note,
            recurrence: effects.recurrence.as_ref().map(|r| (r.before_due.as_str(), r.after_due.as_str())),
        }).await;
    }
```

In `engine.rs` `NativeTaskAction::SetStatus { id, status, note, .. }`, replace the arm body with the same block, using `&id`, `&status` and `note.as_deref()`, and `activity::log_task_status(&self.pool, &id, …)`.

- [ ] **Step 7: Run the path tests and verify they PASS.** Run the whole crate to catch any test that pinned the old `status_changed` row.

Run: `cargo test --workspace --offline`
Expected: all PASS. If an existing test asserts `status_changed` for a completion, update it to `task_completed`. It pinned the bug.

- [ ] **Step 8: Frontend label + mock + docs**
  - `lib/activityMeta.ts`, after `task_completed`: `task_recurred: { label: 'Completed (repeats)', shortLabel: 'Completed', icon: Check, color: done },`
  - `tests/activityMeta.test.mjs`: add `'task_recurred'` to the short-label list in the last test, plus `assert.equal(ACTION_META.task_recurred.color, 'text-success')` in the colors test.
  - `tools/mock-tauri.js:958` metadata becomes `{ content: 'Draft Nimble v2 brief', old_status: 'todo', new_status: 'in_progress' }` (Rust's real keys).
  - `nimble/CLAUDE.md` Task Status Workflow: replace "Status changes logged as `status_changed` activity events" with "Status changes log `task_completed` / `task_uncompleted` / `status_changed` (via `activity::log_task_status`), each carrying the task title as `content`".

Run: `node --test apps/desktop/tests/activityMeta.test.mjs`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add nimble-core/src/db/activity.rs nimble-core/src/db/tasks.rs nimble-core/src/db/focus/engine.rs nimble-core/tests/focus_engine.rs apps/desktop/src/lib/activityMeta.ts apps/desktop/tests/activityMeta.test.mjs tools/mock-tauri.js CLAUDE.md
git commit -m "fix(activity): completions log a named task_completed on both status paths (1c)"
```

---

### Task 4: The focus engine logs sessions and focus completions again (1c, part 2)

`b48ee12` (and `a0f0272` before it) removed `start_focus_session` / `end_focus_session`. Those were the only writers of `focus_*` rows. The engine's `execute_inner` logs nothing, so a completion made through focus writes no row at all. This task restores the legacy row shapes, which the timeline already renders:
- `focus_started {task_content}`
- `focus_completed` / `focus_abandoned` / `focus_skipped` `{duration_secs}`

A task completion row is added through Task 3's `log_task_status`. All rows target the **task id**.

**Files:**
- Modify: `nimble-core/src/db/focus/engine.rs` (`execute_inner` `:400-530`, plus two private helpers near `recorded_total_tx` `:1190`)
- Create: `nimble-core/tests/focus_activity.rs`

**Interfaces:**
- Consumes: `activity::status_activity`, `activity::StatusActivity` (Task 3); `FocusSnapshot { queue: Vec<FocusEntry{task_id, occurrence_id}>, session: Option<FocusSession{id, occurrence_id}> }`.
- Produces: nothing public.

Mapping (Pause, Resume, breaks, queue edits and replays log nothing):

| Action | Rows (target = task id) |
|---|---|
| `Start{occ}` | `focus_started {task_content}` |
| `Complete{occ}` | `focus_completed {duration_secs}` if a session for `occ` existed before, then `task_completed {content, old_status}` or `task_recurred {content, from, to}` |
| `Stop` | `focus_abandoned {duration_secs}` if a session existed |
| `Skip` | `focus_skipped {duration_secs}` if a session existed |

`duration_secs` = the ending session's `focus_sessions.work_ms / 1000`, read inside the transaction after the action applies.

- [ ] **Step 1: Write failing integration tests** (`nimble-core/tests/focus_activity.rs`)

```rust
#[path = "common/focus.rs"]
mod fixture;
use nimble_core::focus_types::{FocusAction, FocusSource};

async fn rows(pool: &sqlx::SqlitePool, task: &str) -> Vec<(String, serde_json::Value)> {
    let raw: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT action_type, metadata FROM activity_log WHERE target_id=? AND action_type!='task_created' ORDER BY rowid")
        .bind(task).fetch_all(pool).await.unwrap();
    raw.into_iter()
        .map(|(a, m)| (a, m.map(|s| serde_json::from_str(&s).unwrap()).unwrap_or(serde_json::Value::Null)))
        .collect()
}

async fn queued(h: &fixture::Harness, task: &str) -> String {
    h.send(FocusAction::Enqueue { task_ids: vec![task.into()], source: FocusSource::Today, explicit_still_open: false })
        .await.unwrap();
    h.snapshot().await.queue.iter().find(|e| e.task_id == task).unwrap().occurrence_id.clone()
}

#[tokio::test]
async fn start_then_complete_logs_focus_and_a_named_completion() {
    let h = fixture::Harness::new().await;
    let t = h.task("Write plan").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Start { occurrence_id: occ.clone() }).await.unwrap();
    h.advance(20_000).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let r = rows(&h.pool, &t).await;
    let actions: Vec<&str> = r.iter().map(|(a, _)| a.as_str()).collect();
    assert_eq!(actions, ["focus_started", "focus_completed", "task_completed"], "{r:?}");
    assert_eq!(r[0].1["task_content"], "Write plan");
    assert_eq!(r[1].1["duration_secs"], 20);
    assert_eq!(r[2].1["content"], "Write plan");
}

#[tokio::test]
async fn completing_without_a_session_logs_only_the_completion() {
    let h = fixture::Harness::new().await;
    let t = h.task("Quick one").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let actions: Vec<String> = rows(&h.pool, &t).await.into_iter().map(|(a, _)| a).collect();
    assert_eq!(actions, ["task_completed"]);
}

#[tokio::test]
async fn stop_and_skip_log_their_duration() {
    let h = fixture::Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    let occ_a = queued(&h, &a).await;
    let occ_b = queued(&h, &b).await;
    h.send(FocusAction::Start { occurrence_id: occ_a }).await.unwrap();
    h.advance(61_000).await;
    h.send(FocusAction::Stop).await.unwrap();
    h.send(FocusAction::Start { occurrence_id: occ_b }).await.unwrap();
    h.advance(5_000).await;
    h.send(FocusAction::Skip).await.unwrap();
    let ra = rows(&h.pool, &a).await;
    assert_eq!(ra.last().unwrap().0, "focus_abandoned");
    assert_eq!(ra.last().unwrap().1["duration_secs"], 61);
    let rb = rows(&h.pool, &b).await;
    assert_eq!(rb.last().unwrap().0, "focus_skipped");
    assert_eq!(rb.last().unwrap().1["duration_secs"], 5);
}

#[tokio::test]
async fn focus_complete_of_a_repeat_logs_task_recurred() {
    let h = fixture::Harness::new().await;
    let t = nimble_core::db::tasks::create_local_task(&h.pool, nimble_core::types::CreateTaskInput {
        content: "Stretch".into(), due_date: Some(chrono::Local::now().format("%Y-%m-%d").to_string()),
        recurrence_rule: Some("every day".into()), ..Default::default()
    }).await.unwrap().id;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Complete { occurrence_id: occ }).await.unwrap();
    let r = rows(&h.pool, &t).await;
    assert_eq!(r.last().unwrap().0, "task_recurred", "{r:?}");
    assert_eq!(r.last().unwrap().1["content"], "Stretch");
}

#[tokio::test]
async fn pause_resume_and_replay_log_nothing_extra() {
    let h = fixture::Harness::new().await;
    let t = h.task("Steady").await;
    let occ = queued(&h, &t).await;
    h.send(FocusAction::Start { occurrence_id: occ }).await.unwrap();
    h.send(FocusAction::Pause).await.unwrap();
    h.send(FocusAction::Resume).await.unwrap();
    // Replay: same command id twice → one receipt, one row.
    let snap = h.snapshot().await;
    let cmd = nimble_core::focus_types::FocusCommand {
        command_id: uuid::Uuid::new_v4().to_string(),
        expected_engine_revision: snap.engine_revision, expected_queue_revision: snap.queue_revision,
        owner_epoch: snap.owner_epoch, process_generation: snap.process_generation,
        session_id: snap.session.map(|s| s.id), action: FocusAction::Stop,
    };
    h.service.execute(cmd.clone()).await.unwrap();
    assert!(h.service.execute(cmd).await.unwrap().replayed);
    let actions: Vec<String> = rows(&h.pool, &t).await.into_iter().map(|(a, _)| a).collect();
    assert_eq!(actions, ["focus_started", "focus_abandoned"]);
}
```

If an engine rule rejects a sequence here (for example, Start → Complete on a recurring task that needs a due identity), fix the test setup to match the engine, **not** the engine. Note the change in the task report.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cargo test --offline -p nimble-core --test focus_activity`
Expected: FAIL. No `focus_*` or `task_completed` rows exist.

- [ ] **Step 3: Add the helpers** (in `engine.rs`, next to `recorded_total_tx`)

```rust
/// What focus logging needs to know about the task before the action applies.
struct FocusLogCtx {
    task_id: String,
    content: String,
    status: String,
    due_date: Option<String>,
    /// The session this action ends, if one exists for this occurrence.
    session_id: Option<String>,
}

/// Reads for activity logging only: any failure means "log nothing", never
/// a failed command (activity is fire-and-forget).
async fn focus_log_ctx_tx(
    conn: &mut SqliteConnection,
    action: &FocusAction,
    before: &FocusSnapshot,
) -> Option<FocusLogCtx> {
    let occ = match action {
        FocusAction::Start { occurrence_id } | FocusAction::Complete { occurrence_id } => occurrence_id.clone(),
        FocusAction::Stop | FocusAction::Skip => before.session.as_ref()?.occurrence_id.clone(),
        _ => return None,
    };
    let task_id = before.queue.iter().find(|e| e.occurrence_id == occ)?.task_id.clone();
    let (content, status, due_date): (String, String, Option<String>) =
        sqlx::query_as("SELECT content, status, due_date FROM local_tasks WHERE id=?")
            .bind(&task_id).fetch_optional(&mut *conn).await.ok()??;
    let session_id = before.session.as_ref().filter(|s| s.occurrence_id == occ).map(|s| s.id.clone());
    Some(FocusLogCtx { task_id, content, status, due_date, session_id })
}

/// The rows to write once the transaction commits: (action_type, metadata).
async fn focus_log_rows_tx(
    conn: &mut SqliteConnection,
    action: &FocusAction,
    ctx: &FocusLogCtx,
) -> Vec<(&'static str, serde_json::Value)> {
    let mut out = Vec::new();
    let duration = match &ctx.session_id {
        Some(id) => sqlx::query_scalar::<_, i64>("SELECT work_ms FROM focus_sessions WHERE id=?")
            .bind(id).fetch_optional(&mut *conn).await.ok().flatten()
            .map(|ms| serde_json::json!({"duration_secs": ms / 1000})),
        None => None,
    };
    match action {
        FocusAction::Start { .. } => out.push(("focus_started", serde_json::json!({"task_content": ctx.content}))),
        FocusAction::Stop => out.extend(duration.map(|m| ("focus_abandoned", m))),
        FocusAction::Skip => out.extend(duration.map(|m| ("focus_skipped", m))),
        FocusAction::Complete { .. } => {
            out.extend(duration.map(|m| ("focus_completed", m)));
            let after: Option<(String, Option<String>)> =
                sqlx::query_as("SELECT status, due_date FROM local_tasks WHERE id=?")
                    .bind(&ctx.task_id).fetch_optional(&mut *conn).await.ok().flatten();
            if let Some((status, due)) = after {
                let recurred = status != "complete" && due != ctx.due_date;
                if status == "complete" || recurred {
                    let from = ctx.due_date.clone().unwrap_or_default();
                    let to = due.clone().unwrap_or_default();
                    out.push(activity::status_activity(&activity::StatusActivity {
                        content: Some(&ctx.content),
                        old_status: Some(&ctx.status),
                        new_status: "complete",
                        note: None,
                        recurrence: recurred.then_some((from.as_str(), to.as_str())),
                    }));
                }
            }
        }
        _ => {}
    }
    out
}
```

- [ ] **Step 4: Wire the helpers into `execute_inner`.**

Just before `let result = apply_action_tx(` (around `:490`):

```rust
        let log_ctx = focus_log_ctx_tx(&mut tx, &command.action, &before).await;
```

Just after the `if let Err(e) = result { … }` block, before `queue::validate`:

```rust
        let log_rows = match &log_ctx {
            Some(ctx) => focus_log_rows_tx(&mut tx, &command.action, ctx).await,
            None => Vec::new(),
        };
```

After `guard.sampled_ms = sampled;`, before `Ok(reply)`:

```rust
        if let Some(ctx) = &log_ctx {
            for (action, meta) in log_rows {
                activity::log_activity(&self.pool, action, Some(&ctx.task_id), Some(meta)).await;
            }
        }
```

The receipt-replay and suspension-gap early returns happen before this, so they log nothing. That's the intent.

- [ ] **Step 5: Run the tests and verify they PASS**

Run: `cargo test --offline -p nimble-core --test focus_activity`
Expected: 5 PASS. If `duration_secs` is off by the settle rule (for example 0 because `advance` credits at a checkpoint the session hasn't reached yet), print `h.snapshot().await.totals` in the test to see what the engine credited. Match the assertion to the engine's credited work, and say so in the report.

- [ ] **Step 6: Full suite, then commit**

Run: `cargo test --workspace --offline`
Expected: all PASS (the baseline was 331 plus this batch's new tests).

```bash
git add nimble-core/src/db/focus/engine.rs nimble-core/tests/focus_activity.rs
git commit -m "fix(focus): log focus sessions and focus completions to activity again (1c)"
```

---

### Task 5: Branch verification

- [ ] `cargo test --workspace --offline`: all pass. Record the count.
- [ ] `node --test apps/desktop/tests/*.test.mjs`: all pass. Record the count.
- [ ] `cd apps/desktop && npm run build && npm run build:web`: both green.
- [ ] `cd apps/desktop && npx eslint src`: no new problems versus main (59 at the time of writing).
- [ ] Real-app check (dev build, not the installed app): complete a task from Tasks, start and complete one in Focus. Activity shows "Completed task · <title>", "Started focus · <title>" and "Completed focus · Focused for Nm".
- [ ] Then use superpowers:finishing-a-development-branch. The merge is Marco's call. Record the results for NEXT.md at wrap, not before.

## Questions for Marco (needed before or alongside the build)

1. **Undo for label/route/doc delete.** I recommend **deferred commit** (frontend-only, the existing `createUndoable` pattern, owned by Lane A) over Rust soft-delete (3 tables, ~50 queries, UNIQUE conflicts, a Turso schema gate) or restore-with-id. OK to hand it to Lane A and drop it from the Rust queue?
2. **Habit hold-to-complete.** No Rust is needed. What should a click write versus a hold? Rust's default is 5 = max, so today a hold adds nothing. The options are (a) click = 3 and hold = 5, or (b) drop the hold ring entirely. Whichever you pick goes to Lane A.
