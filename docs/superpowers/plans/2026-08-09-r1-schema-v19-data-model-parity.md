# R1 — Schema v19: Data-Model Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Nimble's native task system first-class labels, sections, due times, durations, a minimal-but-reliable recurrence engine, and project nesting — closing the data-model gap with Marco's measured Todoist usage — while extending the Todoist two-way sync and the one-time importer to carry the new fields.

**Architecture:** One additive SQLite migration (v19) lands the schema on both platforms (Rust `nimble-core` + mobile TS mirror). A pure-function recurrence module handles "next occurrence" math and is wired into the complete path. Labels and sections get their own CRUD modules that feed the existing `sync_log` + Todoist-outbox observers (never raw SQL from commands). The Todoist per-field three-way merge grows three fields. The importer stops flattening labels/recurrence into description text.

**Tech Stack:** Rust (sqlx, chrono, tokio tests via `test_util::test_pool`), React 19 + TS + Tailwind v4 + shadcn/ui, expo-sqlite (mobile mirror), Turso remote schema.

## Global Constraints

- **Status workflow is untouched:** `backlog → todo → in_progress → blocked → complete` stays exactly as-is. Completing a recurring task resets it to `todo` with a new due date — it never becomes `complete`.
- Migration SQL must be **one statement per `;`** — `run_migrations` splits on semicolons (no triggers, no `BEGIN...END`).
- **All task/project mutations go through `nimble-core/src/db/tasks.rs` / `projects.rs` / the new `labels.rs`/`sections.rs`** so `sync_log` and the Todoist outbox observer fire. Never raw SQL from Tauri commands.
- The real desktop typecheck is `cd apps/desktop && npm run build` (`npx tsc --noEmit` checks zero files — solution-style tsconfig).
- Mobile mirror: `apps/mobile/services/database.ts` must add the same v19 migration. Turso remote columns are gated by a `turso_schema_v19_upgraded` setting (see `initialize_remote` in `nimble-core/src/db/sync.rs`).
- Tauri bundle identifier `com.marcosevilla.daily-triage` must never change (TCC/code-signing stability). App display name is "Nimble".
- No guilt UI: no "overdue" labels or shaming copy in any new surface — neutral "still open" framing.
- New-command checklist (from CLAUDE.md): core fn → `src-tauri/src/commands/<domain>.rs` wrapper → `commands/mod.rs` → `lib.rs` import + `invoke_handler![]` → `services/tauri.ts` wrapper.
- Recurrence scope guardrail: the grammar below is the whole grammar. No RFC 5545, no "every 3rd tuesday", no filter language. (YAGNI — measured usage is 2 patterns.)
- **Task descriptions are canonically Markdown** (Marco's decision, 2026-08-09). `local_tasks.description` stores markdown; every writer — the editor, Todoist pull-apply, the importer, the future R3 CLI — reads/writes markdown verbatim. Todoist descriptions are already markdown, so sync/import become copy-through. Task 12 converts the editor and backfills existing HTML. The vault lesson applies: no corrupting round-trip ships.

## Parallel Execution Map

```
Task 1 (migration + types)          ── serial foundation
Task 2 (input-struct refactor)      ── serial, right after 1
─────────────────────────────────────────────────────────
Track A: Task 3 (recurrence engine) ┐
Track B: Task 4 (labels CRUD)       │  all parallel after Task 2
Track B: Task 5 (sections+nesting)  │  (independent files)
Track D: Task 6 (mobile mirror +    ┘
                 Turso gate)
─────────────────────────────────────────────────────────
Task 7 (task CRUD extension)        ── needs 2,4,5
Task 8 (recurrence-on-complete)     ── needs 3,7
Task 9 (Todoist merge/sync ext)     ── needs 4,7
Task 10 (importer upgrade)          ── needs 4,5,7
─────────────────────────────────────────────────────────
Track C (UI, parallel):
  Task 11 (labels UI)               ── needs 4 wrappers
  Task 12 (markdown descriptions)   ── needs 2 only (independent of 4–10)
  Task 13 (TaskEditor/QuickCreate)  ── needs 7,8,12 wrappers
  Task 14 (sections lanes+sidebar)  ── needs 5,7 wrappers
  Task 15 (mobile display compat)   ── needs 6
─────────────────────────────────────────────────────────
Task 16 (EDD end-to-end exit test + docs)  ── last
```

Branch: create `r1-schema-v19` from `main` (worktree via superpowers:using-git-worktrees).

---

### Task 1: Migration v19 + domain types

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append to `MIGRATIONS` after v18, ~line 466)
- Modify: `nimble-core/src/types.rs` (LocalTask ~line 28, Project ~line 14, new structs)

**Interfaces:**
- Produces: v19 schema; `Label { id, name, color, position, created_at }`; `Section { id, project_id, name, position, created_at }`; `LocalTask` gains `due_time: Option<String>` ("HH:MM" 24h), `duration_minutes: Option<i64>`, `recurrence_rule: Option<String>`, `section_id: Option<String>`, `labels: Vec<String>` (label ids, populated by queries in Task 7 — `#[serde(default)]`, skipped by FromRow); `Project` gains `parent_id: Option<String>`.

- [ ] **Step 1: Write the failing migration test** — in `migrations.rs` alongside `v18_tests`:

```rust
#[cfg(test)]
mod v19_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn v19_tables_and_columns_exist() {
        let pool = test_pool().await;
        for table in ["labels", "task_labels", "sections"] {
            let found: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_optional(&pool)
            .await
            .unwrap();
            assert!(found.is_some(), "missing table {table}");
        }
        // new columns accept writes
        sqlx::query(
            "INSERT INTO local_tasks (id, content, project_id, due_date, due_time, duration_minutes, recurrence_rule)
             VALUES ('t1', 'x', 'inbox', '2026-08-16', '09:00', 10, 'every 2 weeks')",
        )
        .execute(&pool)
        .await
        .expect("v19 columns on local_tasks");
        sqlx::query("INSERT INTO projects (id, name, color, position, parent_id) VALUES ('p2', 'Child', 'blue', 1, 'inbox')")
            .execute(&pool)
            .await
            .expect("parent_id on projects");
        // task_labels composite PK rejects duplicates
        sqlx::query("INSERT INTO labels (id, name, color, position) VALUES ('l1', 'deep work', 'orange', 0)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'l1')")
            .execute(&pool).await.unwrap();
        let dup = sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES ('t1', 'l1')")
            .execute(&pool).await;
        assert!(dup.is_err(), "task_labels (task_id, label_id) must be unique");
    }
}
```

- [ ] **Step 2: Run it to make sure it fails** — `cargo test v19_tests` in `nimble-core/` → FAIL (no such table: labels)

- [ ] **Step 3: Append the v19 migration** (single-statement-per-semicolon; additive only):

```rust
Migration {
    version: 19,
    description: "Task data-model parity: labels, sections, due_time, duration, recurrence, project nesting",
    sql: "
        CREATE TABLE IF NOT EXISTS labels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL DEFAULT 'gray',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE TABLE IF NOT EXISTS task_labels (
            task_id TEXT NOT NULL,
            label_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            PRIMARY KEY (task_id, label_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);
        CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            external_id TEXT,
            external_source TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_sections_project ON sections(project_id);
        ALTER TABLE local_tasks ADD COLUMN due_time TEXT;
        ALTER TABLE local_tasks ADD COLUMN duration_minutes INTEGER;
        ALTER TABLE local_tasks ADD COLUMN recurrence_rule TEXT;
        ALTER TABLE local_tasks ADD COLUMN section_id TEXT;
        ALTER TABLE projects ADD COLUMN parent_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_local_tasks_section ON local_tasks(section_id)
    ",
},
```

- [ ] **Step 4: Update `types.rs`** — extend `LocalTask` (after `due_date`) and `Project` (after `position`), add new structs:

```rust
// in LocalTask, after due_date:
    pub due_time: Option<String>,        // "HH:MM" 24h, None = all-day
    pub duration_minutes: Option<i64>,
    pub recurrence_rule: Option<String>, // human string, e.g. "every 2 weeks @ 09:00"
    pub section_id: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,             // label ids; loaded separately, not a table column

// in Project, after position:
    pub parent_id: Option<String>,

// new structs:
#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Section {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub position: i64,
    pub external_id: Option<String>,
    pub external_source: Option<String>,
    pub created_at: String,
}
```

Follow how `LocalTask` currently satisfies `FromRow` (check `db/tasks.rs` `SELECT_COLS` and any manual impl): add the four new **column** fields there; `labels` is NOT a column — exclude it from `SELECT_COLS` and default it in the row mapping.

- [ ] **Step 5: Run tests** — `cargo test v19_tests` → PASS; `cargo test` (whole crate) → PASS (fix any `LocalTask` construction sites the new fields break — use `..Default::default()` where a `Default` impl exists, else add fields explicitly)

- [ ] **Step 6: Commit** — `git commit -m "feat(r1): schema v19 — labels, sections, due_time, duration, recurrence_rule, project nesting"`

---

### Task 2: Input-struct refactor (pure refactor, no behavior change)

`create_local_task` already takes 7 positional args and Task 7 adds five more. Introduce input structs first so every later task composes cleanly.

**Files:**
- Modify: `nimble-core/src/db/tasks.rs:131-309`, `nimble-core/src/types.rs`
- Modify: every caller — `apps/desktop/src-tauri/src/commands/tasks.rs` (or equivalent), `nimble-core/src/api/todoist_migration.rs`, capture-convert path in `nimble-core/src/db/captures.rs`, Todoist pull-apply in `nimble-core/src/integrations/todoist/sync_loop.rs`

**Interfaces:**
- Produces (exact — later tasks depend on these):

```rust
#[derive(Debug, Default, Deserialize)]
pub struct CreateTaskInput {
    pub content: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i64>,
    pub due_date: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct UpdateTaskInput {
    pub content: Option<String>,
    pub description: Option<String>,
    pub project_id: Option<String>,
    pub priority: Option<i64>,
    pub due_date: Option<String>,
    pub clear_due_date: bool,
    pub linked_doc_id: Option<String>,
}

pub async fn create_local_task(pool: &SqlitePool, input: CreateTaskInput) -> crate::Result<LocalTask>
pub async fn update_local_task(pool: &SqlitePool, id: &str, input: UpdateTaskInput) -> crate::Result<LocalTask>
```

- [ ] **Step 1: Add the structs to `types.rs`** (code above, plus `Default` for `LocalTask` if not present — needed by tests)
- [ ] **Step 2: Rewrite the two fn signatures** to take the structs; body logic unchanged (same per-field UPDATE pattern, same `fields_changed`, same activity/sync/observer calls)
- [ ] **Step 3: Mechanically update every caller** — `grep -rn "create_local_task\|update_local_task" nimble-core apps/desktop/src-tauri` and convert each to struct syntax. Tauri command wrappers keep their existing individual parameters (frontend contract unchanged) and build the struct inside.
- [ ] **Step 4: Verify no behavior change** — `cargo test` → PASS; `cd apps/desktop && npm run build` → PASS
- [ ] **Step 5: Commit** — `git commit -m "refactor(r1): CreateTaskInput/UpdateTaskInput structs, no behavior change"`

---

### Task 3: Recurrence engine (pure module — Track A)

The trust-critical piece. Pure functions, no I/O, exhaustive tests. **This module is why Marco can trust Nimble with EDD certification and student loans.**

**Files:**
- Create: `nimble-core/src/recurrence.rs`; register `pub mod recurrence;` in `nimble-core/src/lib.rs`

**Interfaces:**
- Produces (exact):

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct RecurrenceRule {
    pub interval: u32,          // every N units, >= 1
    pub unit: RecurrenceUnit,   // Day | Week | Month | Year
    pub time: Option<String>,   // "HH:MM" 24h
}
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RecurrenceUnit { Day, Week, Month, Year }

/// None = string is not a supported rule (caller stores it anyway; task just won't auto-recur)
pub fn parse_rule(s: &str) -> Option<RecurrenceRule>;

/// Next due date strictly after `today`, advancing by whole intervals from `current_due`.
pub fn next_occurrence(rule: &RecurrenceRule, current_due: chrono::NaiveDate, today: chrono::NaiveDate) -> chrono::NaiveDate;
```

Grammar (case-insensitive, the WHOLE grammar): `every day`, `every N days`, `every week`, `every N weeks`, `every month`, `every N months`, `every year`, optionally followed by `@ HH:MM` or `at H[:MM][am|pm]`.

- [ ] **Step 1: Write the failing tests** (these exact cases; add more, never fewer):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn parses_marcos_real_rules() {
        assert_eq!(parse_rule("every month"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Month, time: None }));
        assert_eq!(parse_rule("every 2 weeks @ 09:00"),
            Some(RecurrenceRule { interval: 2, unit: RecurrenceUnit::Week, time: Some("09:00".into()) }));
        assert_eq!(parse_rule("Every Day"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Day, time: None }));
        assert_eq!(parse_rule("every 3 months at 9am"),
            Some(RecurrenceRule { interval: 3, unit: RecurrenceUnit::Month, time: Some("09:00".into()) }));
    }

    #[test]
    fn rejects_unsupported_strings() {
        for s in ["every 3rd tuesday", "weekdays", "every!", "", "tomorrow", "every 0 days"] {
            assert_eq!(parse_rule(s), None, "should reject {s:?}");
        }
    }

    #[test]
    fn completed_early_advances_one_interval_from_due() {
        // EDD: due 8/16, completed 8/10 → next 8/30 (from due, not from completion day)
        let rule = parse_rule("every 2 weeks @ 09:00").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-08-16"), d("2026-08-10")), d("2026-08-30"));
    }

    #[test]
    fn completed_late_advances_past_today() {
        // loans: due 8/27, completed 10/02 → next 10/27 (skips the already-past 9/27)
        let rule = parse_rule("every month").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-08-27"), d("2026-10-02")), d("2026-10-27"));
    }

    #[test]
    fn month_end_clamps() {
        let rule = parse_rule("every month").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-01-31"), d("2026-01-31")), d("2026-02-28"));
        assert_eq!(next_occurrence(&rule, d("2028-01-31"), d("2028-01-31")), d("2028-02-29")); // leap year
    }

    #[test]
    fn yearly_and_daily() {
        assert_eq!(next_occurrence(&parse_rule("every year").unwrap(), d("2026-03-06"), d("2026-03-06")), d("2027-03-06"));
        assert_eq!(next_occurrence(&parse_rule("every day").unwrap(), d("2026-08-09"), d("2026-08-09")), d("2026-08-10"));
    }
}
```

- [ ] **Step 2: Run tests** — `cargo test recurrence` → FAIL (module missing)
- [ ] **Step 3: Implement** — regex-free parser (lowercase → split on whitespace; strip `@`/`at` suffix into time; parse `H[:MM][am|pm]` into "HH:MM"). `next_occurrence`: loop `candidate = add_interval(candidate)` starting from `current_due` until `candidate > today`; `add_interval` for Month clamps day via "first day of month+N, then min(day, days_in_month)"; use `chrono::Months`/`Days` arithmetic.
- [ ] **Step 4: Run tests** — `cargo test recurrence` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): recurrence engine — parse + next_occurrence, exhaustively tested"`

---

### Task 4: Labels CRUD (Track B)

**Files:**
- Create: `nimble-core/src/db/labels.rs`; register in `nimble-core/src/db/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/labels.rs` + register per new-command checklist
- Modify: `apps/desktop/src/services/tauri.ts` (wrappers)

**Interfaces:**
- Produces (exact):

```rust
pub async fn list_labels(pool: &SqlitePool) -> crate::Result<Vec<Label>>;
pub async fn create_label(pool: &SqlitePool, name: &str, color: &str) -> crate::Result<Label>;
pub async fn update_label(pool: &SqlitePool, id: &str, name: Option<&str>, color: Option<&str>) -> crate::Result<Label>;
pub async fn delete_label(pool: &SqlitePool, id: &str) -> crate::Result<()>;   // also deletes task_labels rows
pub async fn get_or_create_label_by_name(pool: &SqlitePool, name: &str) -> crate::Result<Label>; // used by sync + importer
/// Replaces the task's full label set. Fires sync_log + Todoist observer with fields_changed=["labels"].
pub async fn set_task_labels(pool: &SqlitePool, task_id: &str, label_ids: &[String]) -> crate::Result<LocalTask>;
pub async fn labels_for_task(pool: &SqlitePool, task_id: &str) -> crate::Result<Vec<String>>; // label ids
```

TS wrappers in `tauri.ts`: `listLabels(): Promise<Label[]>`, `createLabel(name, color)`, `updateLabel(id, {name?, color?})`, `deleteLabel(id)`, `setTaskLabels(taskId, labelIds): Promise<LocalTask>`.

- [ ] **Step 1: Write failing tests** in `labels.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::db::tasks::{create_local_task};
    use crate::types::CreateTaskInput;

    #[tokio::test]
    async fn label_crud_and_assignment_roundtrip() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let l2 = create_label(&pool, "quick win", "yellow").await.unwrap();
        assert_eq!(list_labels(&pool).await.unwrap().len(), 2);

        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() }).await.unwrap();
        let t = set_task_labels(&pool, &t.id, &[l1.id.clone(), l2.id.clone()]).await.unwrap();
        assert_eq!(t.labels.len(), 2);

        // replace semantics, not append
        let t = set_task_labels(&pool, &t.id, &[l2.id.clone()]).await.unwrap();
        assert_eq!(t.labels, vec![l2.id.clone()]);

        // deleting a label detaches it from tasks
        delete_label(&pool, &l2.id).await.unwrap();
        assert!(labels_for_task(&pool, &t.id).await.unwrap().is_empty());

        // get_or_create is idempotent and case-insensitive on name
        let a = get_or_create_label_by_name(&pool, "Deep Work").await.unwrap();
        assert_eq!(a.id, l1.id);
    }
}
```

- [ ] **Step 2: Run** → FAIL (module missing)
- [ ] **Step 3: Implement** — UUID ids, `position` = max+1; `set_task_labels`: DELETE existing rows, INSERT new, then re-fetch the task via `db/tasks.rs` helpers, `append_sync_log("local_tasks", task_id, "UPDATE", Some("[\"labels\"]"), snapshot)` and `observer::on_task_mutation(Updated { fields_changed: ["labels"] })`. `labels` and `task_labels` tables must be added to the Turso synced-tables list — that lands in Task 6, note it here and move on.
- [ ] **Step 4: Run** → PASS. Add Tauri commands + tauri.ts wrappers; `npm run build` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): labels CRUD + task label assignment through sync observers"`

---

### Task 5: Sections CRUD + project nesting (Track B)

**Files:**
- Create: `nimble-core/src/db/sections.rs`; register in `db/mod.rs`
- Modify: `nimble-core/src/db/projects.rs` (accept/persist `parent_id` on create/update)
- Create: `apps/desktop/src-tauri/src/commands/sections.rs` + registration + `tauri.ts` wrappers

**Interfaces:**
- Produces (exact):

```rust
pub async fn list_sections(pool: &SqlitePool, project_id: &str) -> crate::Result<Vec<Section>>;
pub async fn create_section(pool: &SqlitePool, project_id: &str, name: &str) -> crate::Result<Section>;
pub async fn rename_section(pool: &SqlitePool, id: &str, name: &str) -> crate::Result<Section>;
/// Tasks in the section get section_id = NULL (fall back to project root). Fires sync_log per affected task.
pub async fn delete_section(pool: &SqlitePool, id: &str) -> crate::Result<()>;
pub async fn reorder_sections(pool: &SqlitePool, section_ids: &[String]) -> crate::Result<()>;
```

Project nesting: `db/projects.rs` create/update gain `parent_id: Option<&str>`; cycle guard (a project cannot be its own ancestor — walk up at most 5 hops, error on cycle). One level is the design intent but the guard makes any depth safe.

- [ ] **Step 1: Write failing tests** — section CRUD roundtrip; `delete_section` nulls `section_id` on its tasks (create task, assign section via raw update in test, delete section, assert task's `section_id` is None); project `parent_id` persists; cycle rejected (`set A.parent = B; set B.parent = A` errors).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** (sections mirror the labels.rs shape; `sections` table joins the Turso sync list in Task 6)
- [ ] **Step 4: Run** → PASS; wire commands + wrappers; `npm run build` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): sections CRUD + project nesting with cycle guard"`

---

### Task 6: Mobile schema mirror + Turso remote upgrade (Track D)

**Files:**
- Modify: `apps/mobile/services/database.ts` (append v19 migration mirroring Task 1's SQL exactly)
- Modify: `nimble-core/src/db/sync.rs` — add `labels`, `task_labels`, `sections` to the synced-tables list in `initialize_remote`; add the new `local_tasks`/`projects` columns to the remote schema, gated by a `turso_schema_v19_upgraded` setting (follow the existing v-gate pattern noted in CLAUDE.md's Sync Protocol section)

**Interfaces:**
- Consumes: Task 1's exact SQL.
- Produces: both platforms at schema v19; Turso remote accepts the new tables/columns; `labels`/`task_labels`/`sections` replicate; (`todoist_outbox`, `integration_sync_state`, `vault_fts` stay device-local as before).

- [ ] **Step 1: Mirror the migration in `database.ts`** — same statements, expo-sqlite style, same version number 19
- [ ] **Step 2: Turso remote** — extend `initialize_remote` table list; add `ALTER TABLE` upgrade block behind `turso_schema_v19_upgraded` (read setting → if absent, run alters idempotently → write setting)
- [ ] **Step 3: Verify** — `cargo test` → PASS; mobile: `cd apps/mobile && npx tsc --noEmit` (mobile tsconfig is a normal one) → PASS; manual: fresh mobile simulator boot runs v19 without error
- [ ] **Step 4: Commit** — `git commit -m "feat(r1): mobile v19 mirror + turso remote schema gate"`

---

### Task 7: Task CRUD extension (needs Tasks 2, 4, 5)

**Files:**
- Modify: `nimble-core/src/db/tasks.rs` (SELECT_COLS, create/update/get), `nimble-core/src/types.rs` (extend input structs)
- Modify: `apps/desktop/src-tauri/src/commands/tasks.rs` + `apps/desktop/src/services/tauri.ts` (pass-through params)

**Interfaces:**
- Consumes: `set_task_labels`/`labels_for_task` (Task 4), `Section` (Task 5).
- Produces: `CreateTaskInput` gains `due_time: Option<String>`, `duration_minutes: Option<i64>`, `recurrence_rule: Option<String>`, `section_id: Option<String>`, `label_ids: Option<Vec<String>>`. `UpdateTaskInput` gains the same plus `clear_due_time: bool`, `clear_recurrence: bool`, `clear_section: bool`. `get_local_tasks` returns tasks with `labels` populated (one aggregate query: `SELECT task_id, label_id FROM task_labels` folded into the task list — NOT one query per task).

- [ ] **Step 1: Write failing tests** — create with all new fields → read back intact (incl. `labels` populated); update each field independently; `clear_*` flags null the columns; `fields_changed` includes the right names (`due_time`, `duration_minutes`, `recurrence_rule`, `section_id`) so sync_log/observer fire.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** — follow the existing per-field UPDATE pattern exactly (one guarded UPDATE per field, `updated_at = datetime('now')`); `label_ids` delegates to `set_task_labels`; batch-load labels in `get_local_tasks` with a HashMap<task_id, Vec<label_id>>.
- [ ] **Step 4: Run** → PASS; extend Tauri command params + `tauri.ts` types; `npm run build` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): task CRUD carries due_time, duration, recurrence, section, labels"`

---

### Task 8: Recurrence-on-complete wiring (needs Tasks 3, 7)

**Files:**
- Modify: `nimble-core/src/db/tasks.rs:312` (`update_task_status`)

**Interfaces:**
- Consumes: `recurrence::{parse_rule, next_occurrence}`.
- Behavior contract (exact): when `update_task_status(id, "complete")` hits a task where `recurrence_rule` parses AND `due_date` is set → do NOT set `completed`/`completed_at`/`status=complete`. Instead: `due_date = next_occurrence(...)` (today = local date), `due_time = rule.time.or(existing due_time)`, `status = "todo"`, log activity `task_recurred` with `{ "from": old_due, "to": new_due }`, fire sync_log + observer with `fields_changed = ["due_date", "due_time", "status"]`. A task with an unparseable rule or no due date completes normally (rule is inert). All other statuses ignore recurrence entirely.

- [ ] **Step 1: Write failing tests** — completing the EDD-shaped task (due 2026-08-16, rule "every 2 weeks @ 09:00") leaves `completed = false`, `status = "todo"`, `due_date = "2026-08-30"`, `due_time = "09:00"`, and an activity row `task_recurred`; completing it AGAIN yields `2026-09-13` (the "twice in a row" exit test, in miniature); a task with rule but no due date completes normally; `status = "blocked"` on a recurring task does not touch the due date.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** (branch at the top of the `"complete"` arm; everything else untouched — **status workflow unchanged**)
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): recurring tasks reschedule on complete instead of completing"`

---

### Task 9: Todoist sync extension (needs Tasks 4, 7)

**Files:**
- Modify: `nimble-core/src/integrations/todoist/mappers.rs` (`TaskSnapshot` + `item_to_snapshot` + local-task→snapshot fn)
- Modify: `nimble-core/src/integrations/todoist/merge.rs` (MergePlan + merge_task + tests)
- Modify: `nimble-core/src/integrations/todoist/sync_loop.rs` (pull-apply + push payload), `observer.rs` (field list that triggers enqueue)

**Interfaces:**
- Consumes: `get_or_create_label_by_name` (Task 4), `UpdateTaskInput` (Task 7).
- Produces: `TaskSnapshot` gains `labels: Vec<String>` (Todoist label NAMES, sorted), `due_time: Option<String>`, `duration_minutes: Option<i64>`. `MergePlan` gains `labels: Option<Vec<String>>`, `due_time: Option<Option<String>>`, `duration_minutes: Option<Option<i64>>`.
- Scope line (deliberate): recurrence does NOT round-trip (2 tasks, hand-managed during soak — pull keeps Todoist's recurring `due` object out of `due_date` overwrites for tasks that have a local `recurrence_rule`); sections do NOT live-sync (import-only, Task 10); project `parent_id` does not live-sync.

- [ ] **Step 1: Extend merge tests first** (same style as existing merge.rs tests): labels remote-only change applies; labels both-changed uses LWW; due_time independent of due_date (local reschedules date, remote sets time → both survive); duration behaves like priority.
- [ ] **Step 2: Run** → FAIL (fields missing)
- [ ] **Step 3: Implement** — mappers: parse Todoist `due.datetime` into (`due_date`, `due_time`), `duration {amount, unit}` into minutes, item labels sorted; merge: three more `pick(...)` lines; pull-apply: labels via `get_or_create_label_by_name` then `set_task_labels` (bypass observer echo the same way existing pull-applies do); push payload: include `labels` (names), `due` with datetime when `due_time` set, `duration`/`duration_unit`. Observer: add the new field names to the fields-that-enqueue list.
- [ ] **Step 4: Run** — `cargo test` → PASS. Manual smoke: `todoist_sync_now` against the real account — add a label to a task in Todoist, pull, confirm it lands; add a label in Nimble, confirm it appears in Todoist.
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): todoist sync carries labels, due times, durations"`

---

### Task 10: Importer upgrade (needs Tasks 4, 5, 7)

**Files:**
- Modify: `nimble-core/src/api/todoist_migration.rs` (kill the flattening path, populate first-class fields)

**Interfaces:**
- Consumes: `get_or_create_label_by_name`, `create_section`, `CreateTaskInput` with all new fields.
- Produces: import maps — Todoist labels → label rows + assignments; `due.string` → `recurrence_rule` verbatim (parseable or not — inert strings still display); `due.datetime` → `due_time`; `duration` → `duration_minutes`; Todoist sections → native `sections` rows (with `external_id`) + task `section_id`; project hierarchy → `projects.parent_id` (replacing the "Parent / Child" name-joining in the chain-builder around line 255). `build_enriched_description` and the `preserve_labels`/`preserve_recurring` options are deleted — the description carries only the user's own prose.

- [ ] **Step 1: Write failing test** — feed a fixture `TodoistItem` set (one task with 2 labels + "every 2 weeks @ 09:00" recurring due with datetime + 10m duration + a section, one child project) through the import path; assert first-class fields land and description contains NO "— imported from Todoist —" block.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → `cargo test` PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): importer maps labels/recurrence/sections/nesting first-class"`

---

### Task 11: Labels UI — management + picker (Track C; needs Task 4 wrappers)

> **Marco's design surface.** Build it functional and token-clean; he'll do the visual polish pass. Use shadcn/ui primitives, `cn()` for class merging, existing color-dot conventions from projects.

**Files:**
- Create: `apps/desktop/src/components/tasks/LabelPicker.tsx`, `apps/desktop/src/components/settings/LabelManager.tsx` (Settings section)
- Modify: `apps/desktop/src/pages/SettingsPage.tsx` (mount LabelManager)

**Interfaces:**
- Consumes: `listLabels`, `createLabel`, `updateLabel`, `deleteLabel`, `setTaskLabels` from `tauri.ts`.
- Produces: `<LabelPicker value: string[] onChange: (labelIds: string[]) => void />` — popover with checkbox list + inline "create label" row; chips render as `label.color` dot + name.

- [ ] **Step 1: LabelPicker** — Popover (shadcn) anchored on a "+ label" ghost button; search input filters; Enter on no-match creates the label with a default color; selected labels render as removable chips:

```tsx
export function LabelChip({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border border-border/60",
      "px-2 py-0.5 text-xs text-muted-foreground"
    )}>
      <span className="size-2 rounded-full" style={{ background: labelColor(label.color) }} />
      {label.name}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 opacity-50 hover:opacity-100" aria-label={`Remove ${label.name}`}>×</button>
      )}
    </span>
  );
}
```

(`labelColor()` maps the Todoist-style color names already used by projects — reuse that map if one exists, create `@/lib/labelColors.ts` if not.)
- [ ] **Step 2: LabelManager in Settings** — list with inline rename, color swatch popover, delete with confirm (shows task count from a `labels_for_task`-style count if cheap, else plain confirm)
- [ ] **Step 3: Verify** — `npm run build` → PASS; manual: create/rename/assign/remove labels in the running app (`npm run tauri dev`)
- [ ] **Step 4: Commit** — `git commit -m "feat(r1): label picker + label management UI"`

---

### Task 12: Markdown-canonical task descriptions (Track C; needs Task 2 only)

Marco's decision (2026-08-09): descriptions are stored as **Markdown**, not Tiptap HTML. Todoist descriptions are already markdown (sync + import become verbatim copy-through), and Claude/the R3 CLI will be a primary description writer — markdown is what agents speak. The vault-corruption lesson applies here: **the editor must round-trip markdown losslessly for the features tasks actually use, proven before shipping.**

**Files:**
- Modify: the task-description editor surface — locate with `grep -rn "useEditor\|EditorContent" apps/desktop/src/components/tasks apps/desktop/src/pages/TaskDetailPage.tsx` (if descriptions turn out to be a plain textarea on some surfaces, those need no change — plain text is valid markdown)
- Modify: `apps/desktop/src/pages/SettingsPage.tsx` (one-time backfill, following the existing HTML→Markdown docs-migration + DB-snapshot pattern around line 1503)

**Interfaces:**
- Consumes: `tiptap-markdown@0.9.0` + the repo's ambient type declaration under `apps/desktop/src/types/` (do NOT silence a type error there with `as any` — CLAUDE.md gotcha; that call produces the persisted bytes).
- Produces: `local_tasks.description` contains markdown from this task forward; Tasks 9/10 (sync, importer) and R3's CLI write descriptions verbatim with no conversion layer.

- [ ] **Step 1: Convert the editor** — load description content through the Markdown extension, save via `editor.storage.markdown.getMarkdown()` (mirror how the docs/vault editor already uses tiptap-markdown)
- [ ] **Step 2: Round-trip fidelity check (do not skip)** — create a task whose description contains: a `[link](url)`, **bold**, a nested bullet list, a `code span`, and a bare URL → save → reopen → save again → the two saved strings must be identical (surface them via a temp debug log). If any feature corrupts, restrict the editor's enabled marks/nodes to the surviving set rather than shipping a corrupting round-trip.
- [ ] **Step 3: One-time backfill** — convert existing `local_tasks.description` HTML → markdown, DB snapshot first (reuse the docs-migration detection + backup pattern). Detection matters: descriptions pulled from Todoist are ALREADY markdown stored raw — only convert entries that are actually HTML (copy the docs migration's `<`-prefix heuristic); pass everything else through untouched.
- [ ] **Step 4: Verify** — `npm run build` → PASS; Todoist smoke: edit a markdown-rich description in Todoist, `todoist_sync_now`, confirm it renders in Nimble and survives an edit-save round-trip unchanged
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): markdown-canonical task descriptions + HTML backfill"`

---

### Task 13: TaskEditor + QuickCreate fields (Track C; needs Tasks 7, 8, 12 wrappers)

**Files:**
- Modify: `apps/desktop/src/components/tasks/TaskEditor.tsx`, `apps/desktop/src/components/tasks/QuickCreateDialog.tsx`, `apps/desktop/src/pages/TaskDetailPage.tsx`

**Interfaces:**
- Consumes: extended create/update wrappers (Task 7), `LabelPicker` (Task 11), the markdown-canonical description editor (Task 12).
- Produces: editing surface for due time, duration, recurrence, labels, section.

- [ ] **Step 1: TaskEditor row** — beneath the existing due-date control add: time input (only when a date is set; `<input type="time">` styled to match), duration select (10m/15m/30m/45m/1h/1h30m/2h + clear), recurrence select (None / Every day / Every week / Every 2 weeks / Every month / Every 3 months / Every year + "at time" toggle that reuses the time input — the select writes the canonical rule strings from Task 3's grammar), `LabelPicker`, section select (sections of the task's current project; hidden when the project has none, "+ new section" inline)
- [ ] **Step 2: Recurring affordance** — tasks with a parseable `recurrence_rule` show a small ↻ glyph + the rule string next to the due date (chip, `text-muted-foreground`); completing one triggers the existing complete interaction but the row stays with its new date — add a brief toast: `taskToast("Rescheduled to <date>")`. **No guilt copy anywhere.**
- [ ] **Step 3: QuickCreate** — keep it fast: only add the label picker + due time (recurrence/duration/section live in the full editor; ADHD principle — capture first, enrich later)
- [ ] **Step 4: Verify** — `npm run build` → PASS; manual: set every field on a real task, relaunch app, values persist; complete a recurring task → date advances, status back to todo
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): task editing for time, duration, recurrence, labels, sections"`

---

### Task 14: Section lanes + label filter + nested sidebar (Track C; needs Tasks 5, 7)

**Files:**
- Modify: `apps/desktop/src/pages/TasksPage.tsx`, `apps/desktop/src/pages/ProjectDetailPage.tsx`, sidebar/project-list component (locate via `grep -rn "projects.map" apps/desktop/src/components`)

**Interfaces:**
- Consumes: `list_sections` wrappers, tasks with `section_id`/`labels`.
- Produces: project views group tasks by section (unsectioned tasks first, then sections by `position`, section header = name + count + collapse); label filter chips in the TasksPage filter row (multi-select OR semantics, matching the existing status-pill interaction); sidebar renders child projects indented under parents (one level, `pl-6`), collapsible.

- [ ] **Step 1: Section grouping in ProjectDetailPage** (reuse the existing status-grouping pattern in TasksPage as the reference implementation; drag-reorder between sections sets `section_id` via the Task 7 update wrapper)
- [ ] **Step 2: Label filter chips on TasksPage** (render only labels that are in use; chip = LabelChip from Task 11 + selected state)
- [ ] **Step 3: Sidebar nesting** (indent + disclosure; child projects come from `projects.parent_id`)
- [ ] **Step 4: Verify** — `npm run build` → PASS; manual feel-check with real data
- [ ] **Step 5: Commit** — `git commit -m "feat(r1): section lanes, label filtering, nested project sidebar"`

---

### Task 15: Mobile display compat (Track C/D; needs Task 6)

R4 does full mobile parity — this task only keeps mobile honest about data desktop now writes.

**Files:**
- Modify: `apps/mobile/app/(tabs)/tasks.tsx`, mobile task-row component

**Interfaces:**
- Consumes: v19 columns via the existing mobile query layer.
- Produces: task rows show label chips (dot + name, read-only), due time next to due date when present, ↻ glyph for recurring. No editing (R4).

- [ ] **Step 1: Extend the mobile task query** to include the new columns + a labels join (mirror Task 7's aggregate approach in TS)
- [ ] **Step 2: Render** chips/time/glyph in the row (StyleSheet, match existing theme constants)
- [ ] **Step 3: Verify** — `npx tsc --noEmit` in apps/mobile → PASS; simulator: rows render, no crash on tasks with all-new fields
- [ ] **Step 4: Commit** — `git commit -m "feat(r1): mobile renders labels, due times, recurrence (read-only)"`

---

### Task 16: EDD end-to-end exit test + docs (last)

**Files:**
- Create: `nimble-core/tests/recurring_exit_test.rs` (integration test)
- Modify: `nimble/CLAUDE.md` (schema version → 19, new tables in Key Tables, recurrence semantics under Task Status Workflow)

- [ ] **Step 1: Write the exit test** — the R1 acceptance criterion as code:

```rust
// The plan's exit test: the EDD task lives natively and recurs correctly twice in a row.
use nimble_core::db::tasks::{create_local_task, update_task_status};
use nimble_core::types::CreateTaskInput;

#[tokio::test]
async fn edd_task_recurs_natively_twice() {
    let pool = nimble_core::test_util::test_pool().await;
    let t = create_local_task(&pool, CreateTaskInput {
        content: "🔴 Certify for EDD benefits (UI Online)".into(),
        due_date: Some("2026-08-16".into()),
        due_time: Some("09:00".into()),
        duration_minutes: Some(10),
        recurrence_rule: Some("every 2 weeks @ 09:00".into()),
        priority: Some(4),
        ..Default::default()
    }).await.unwrap();

    let t = update_task_status(&pool, &t.id, "complete", None).await.unwrap();
    assert_eq!(t.due_date.as_deref(), Some("2026-08-30"));
    assert_eq!(t.status, "todo");
    assert!(!t.completed);

    let t = update_task_status(&pool, &t.id, "complete", None).await.unwrap();
    assert_eq!(t.due_date.as_deref(), Some("2026-09-13"));
    assert_eq!(t.status, "todo");
}
```

(Adjust `update_task_status`'s exact signature to what exists — check `db/tasks.rs:312`; the assertions are the contract. Note: `next_occurrence` uses the real `today`, so this test creates due dates in the past relative to any run date after 2026-08-30 — compute the expected dates from the same `next_occurrence` function with explicit dates OR make the recurrence path in `update_task_status` accept an injectable `today` for tests. Prefer the injectable-today approach; wall-clock-dependent assertions are how recurrence bugs hide.)
- [ ] **Step 2: Run everything** — `cargo test` → ALL PASS; `cd apps/desktop && npm run build` → PASS
- [ ] **Step 3: Update CLAUDE.md** — schema version 19 + `labels`/`task_labels`/`sections` in Key Tables + one paragraph on recurrence semantics ("completing a recurring task reschedules it; it never enters `complete`")
- [ ] **Step 4: Commit** — `git commit -m "feat(r1): EDD exit test + docs — schema v19 complete"`

---

## Self-Review Notes

- **Spec coverage:** labels ✓ (1,4,7,9,10,11), sections ✓ (1,5,7,10,14), due_time ✓ (1,7,9,13), duration ✓ (1,7,9,13), recurrence ✓ (1,3,8,10,13,16), project nesting ✓ (1,5,10,14), markdown-canonical descriptions ✓ (12), Todoist merge extension ✓ (9), importer upgrade ✓ (10), mobile mirror ✓ (6,15), Turso gate ✓ (6), status workflow preserved ✓ (Global Constraints + 8).
- **Deliberate scope lines (not gaps):** no live Todoist sync for sections/recurrence/project-parents (import-only; documented in Task 9); reminders/notifications are R2/R4, not R1; NL date parsing is not in R1.
- **Type consistency:** `CreateTaskInput`/`UpdateTaskInput` defined in Task 2, extended in Task 7, consumed in 8/9/10/16. `Label`/`Section` defined in Task 1, consumed in 4/5/11/14. `parse_rule`/`next_occurrence` defined in Task 3, consumed in 8/16.
