# Foundation + Todoist Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the external-id plumbing bug and docs HTML→markdown format, then make Todoist a detachable two-way sync adapter over the native task model (outbox + incremental sync loop), retiring the legacy cached Todoist view.

**Architecture:** All business logic lands in `nimble-core` (new `src/integrations/` module tree); Tauri commands stay thin wrappers. Local mutations enqueue ops into a persistent `todoist_outbox`; a serialized sync loop pushes batched `/api/v1/sync` commands then pulls incremental deltas by `sync_token`, three-way-merging per field against a stored `synced_snapshot`. Docs content migrates from Tiptap HTML to markdown behind a `docs_content_format` setting.

**Tech Stack:** Rust (sqlx/SQLite, reqwest, tokio, chrono, serde_json, uuid; new dep: `htmd`), Tauri 2, React 19 + TypeScript (new dep: `tiptap-markdown`), Zustand, `@nimble/types`.

**Scope:** Spec Part 0 (foundation) + Part 1 (Todoist). Spec source: `nimble/docs/superpowers/specs/2026-08-04-todoist-obsidian-integration-design.md`. Parts 2 (Vault) and 3 (Mobile) get their own plans once this ships.

## Global Constraints

- Todoist base URL is `https://api.todoist.com/api/v1/` only (REST v2 / Sync v9 are dead). The sync engine uses the `/api/v1/sync` endpoint exclusively.
- Build every Todoist URL with `reqwest::Url::parse(...).query_pairs_mut().append_pair()` — never string-concat a cursor (documented gotcha: `+` in cursors becomes a space and silently caps results).
- Priority is a numeric pass-through 1–4 with 4 = highest on BOTH sides (matches `todoist_migration::map_priority`; the "inversion" in the spec refers to Todoist's UI labels only).
- Sections remain `section:{id}` pseudo-projects — existing importer convention (`external_id = "section:<todoist_section_id>"`).
- Local statuses `in_progress`/`blocked` are local-only; Todoist only ever sees open/closed.
- Frontend never does HTTP and never touches SQLite — Rust commands only.
- Neutral, no-guilt copy everywhere: "couldn't sync — will retry", never error-red walls or "overdue".
- New schema migration is **v17** (current is v16). Any column added to a Turso-synced table (`local_tasks`, `projects`) must be mirrored in `apps/mobile/services/database.ts`. `todoist_outbox` and `integration_sync_state` are Mac-local — do NOT mirror them and do NOT add them to any sync allowlist.
- Todoist token lives in settings key `todoist_api_token` (plaintext settings pattern retained — no keychain work in this project).
- `/sync` requests carry ≤100 commands; every command's `uuid` is persisted in the outbox row BEFORE sending (idempotent retries).
- Rust tests: `cargo test -p nimble-core`. Frontend check: `cd apps/desktop && npx tsc --noEmit`.
- Commit after every task. Repo root for git commands is `nimble/`.
- New-command recipe (from CLAUDE.md): core fn → thin wrapper in `apps/desktop/src-tauri/src/commands/<domain>.rs` → export in `commands/mod.rs` → register in `lib.rs` `invoke_handler![]` → TS wrapper in `apps/desktop/src/services/tauri.ts` → `DataProvider` interface + `TauriProvider` + mobile `SqliteProvider` stub.

## Spec deviations (implementation-level refinements — flag to Marco, product decisions untouched)

1. **`synced_hash` → `synced_snapshot TEXT` (JSON)** on `local_tasks`/`projects`. A hash detects echoes but cannot provide (a) the three-way merge *base* required by the spec's own field-level merge, or (b) the remote `due` object (recurrence string) required by "never rewrite the full due object on reschedule". One JSON column of last-synced remote-visible fields does all three jobs.
2. **`doc_notes` need no conversion** — they are plain text rendered as text (`DocNoteEntry.tsx:18`), not Tiptap HTML. The spec's assumption was wrong; migration touches `documents.content` only.
3. **Delete ops are self-contained** — the outbox `delete` payload carries the task's `external_id`, so local rows can hard-delete immediately; no soft-retention needed.
4. **Echo filtering relies on snapshot equality**, not on push-response token ordering. Push and pull stay decoupled (pull always uses the stored token); a pulled item identical to its stored snapshot is skipped. Simpler and strictly safer.
5. **`completed_info` is requested but unused** for now (it's stats, not items; completions arrive as `checked: true` item deltas).
6. **`integration_sync_state` gains a `last_error TEXT` column** (spec didn't list one) so the settings status line has something to show.

## File Structure

```
nimble-core/
  src/lib.rs                          MODIFY: + pub mod integrations; #[cfg(test)] pub mod test_util;
  src/test_util.rs                    NEW: in-memory pool + migrations for tests
  src/types.rs                        MODIFY: LocalTask/Project gain external + sync-meta fields
  src/db/tasks.rs                     MODIFY: FromRow impl, SELECT_COLS, observer hooks
  src/db/projects.rs                  MODIFY: external cols, observer hooks
  src/db/docs.rs                      MODIFY: + markdown migration (preview/migrate)
  src/db/migrations.rs                MODIFY: + Migration v17
  src/db/sync.rs                      MODIFY: Turso-pull → observer hook
  src/parsers/html_to_md.rs           NEW: htmd wrapper + unknown-tag scanner
  src/parsers/mod.rs                  MODIFY: + pub mod html_to_md;
  src/integrations/mod.rs             NEW: integration_sync_state helpers
  src/integrations/todoist/mod.rs     NEW: module decls
  src/integrations/todoist/outbox.rs  NEW: enqueue (coalescing), drain, mark
  src/integrations/todoist/client.rs  NEW: /sync HTTP client + response structs
  src/integrations/todoist/mappers.rs NEW: TaskSnapshot, command builders, ts helpers
  src/integrations/todoist/merge.rs   NEW: pure three-way field merge
  src/integrations/todoist/observer.rs NEW: mutation → outbox ops
  src/integrations/todoist/sync_loop.rs NEW: run_sync = push_outbox + apply_pull
apps/desktop/src-tauri/src/
  commands/todoist_sync.rs            NEW: sync_now / status / set_enabled
  commands/docs.rs                    MODIFY: + markdown migration commands
  commands/todoist.rs                 MODIFY (Task 14): drop legacy 4 commands
  commands/mod.rs, lib.rs             MODIFY: registration + triggers + sync_runner
  sync_runner.rs                      NEW: run_and_emit / run_if_due
apps/desktop/src/
  components/settings/TodoistSyncSection.tsx   NEW
  components/settings/DocsMigrationSection.tsx NEW
  components/docs/TiptapEditor.tsx    MODIFY: markdown mode
  components/docs/DocEditor.tsx       MODIFY: format-aware save
  services/tauri.ts, data-provider.ts, tauri-provider.ts  MODIFY
  hooks/useTodoist.ts, components/todoist/TaskRow.tsx     DELETE (Task 14)
packages/types/src/index.ts           MODIFY: new fields + new types
apps/mobile/services/database.ts      MODIFY: v17 mirror (columns only)
apps/mobile/services/sqlite-provider.ts MODIFY: stubs for new provider methods
```

---

### Task 1: Rust test harness + external_id/external_source plumbing

The latent bug: migration v15 added `external_id`/`external_source` to `local_tasks` and `projects`, but `LocalTask`, `Project`, `SELECT_COLS`, and `row_to_task` don't read them — app code can't see or preserve the Todoist link. This task makes them first-class, and stands up the repo's first Rust tests.

**Files:**
- Create: `nimble-core/src/test_util.rs`
- Modify: `nimble-core/src/lib.rs`
- Modify: `nimble-core/src/types.rs:13-39`
- Modify: `nimble-core/src/db/tasks.rs` (SELECT_COLS :44, row_to_task :8-42, all `query_as` call sites)
- Modify: `nimble-core/src/db/projects.rs` (get_projects :8, create_project :26)
- Modify: `packages/types/src/index.ts:107-133`
- Test: inline `#[cfg(test)] mod tests` in `tasks.rs` and `projects.rs`

**Interfaces:**
- Consumes: `crate::db::migrations::run_migrations(&pool)` (exists)
- Produces: `crate::test_util::test_pool() -> SqlitePool` (every later task's tests use this); `LocalTask`/`Project` with `pub external_id: Option<String>, pub external_source: Option<String>`; `impl FromRow<'_, SqliteRow> for LocalTask` (replaces tuple mapping — needed because Task 5 pushes the column count past sqlx's 16-element tuple limit)

- [ ] **Step 1: Create the test harness**

`nimble-core/src/test_util.rs`:
```rust
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

/// Fresh in-memory DB with all migrations applied.
/// max_connections(1) is required: each new connection to `sqlite::memory:`
/// would otherwise get its own empty database.
pub async fn test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("in-memory sqlite pool");
    crate::db::migrations::run_migrations(&pool)
        .await
        .expect("migrations on test pool");
    pool
}
```

In `nimble-core/src/lib.rs` add alongside the existing module decls:
```rust
#[cfg(test)]
pub mod test_util;
```

- [ ] **Step 2: Write the failing test**

At the bottom of `nimble-core/src/db/tasks.rs`:
```rust
#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn external_link_survives_task_edits() {
        let pool = test_pool().await;
        let task = super::create_local_task(&pool, "Buy milk", None, None, None, None, None)
            .await
            .unwrap();
        assert_eq!(task.external_id, None);
        assert_eq!(task.external_source, None);

        sqlx::query("UPDATE local_tasks SET external_id = ?, external_source = 'todoist' WHERE id = ?")
            .bind("6X7rM8997g3RQmvh")
            .bind(&task.id)
            .execute(&pool)
            .await
            .unwrap();

        let updated = super::update_local_task(
            &pool, &task.id, Some("Buy oat milk"), None, None, None, None, false, None,
        )
        .await
        .unwrap();
        assert_eq!(updated.external_id.as_deref(), Some("6X7rM8997g3RQmvh"));
        assert_eq!(updated.external_source.as_deref(), Some("todoist"));

        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let fetched = all.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(fetched.external_id.as_deref(), Some("6X7rM8997g3RQmvh"));
    }
}
```

And in `nimble-core/src/db/projects.rs`:
```rust
#[cfg(test)]
mod tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn projects_expose_external_columns() {
        let pool = test_pool().await;
        let p = super::create_project(&pool, "Errands", "#ff0000").await.unwrap();
        assert_eq!(p.external_id, None);

        sqlx::query("UPDATE projects SET external_id = 'abc123', external_source = 'todoist' WHERE id = ?")
            .bind(&p.id)
            .execute(&pool)
            .await
            .unwrap();

        let all = super::get_projects(&pool).await.unwrap();
        let fetched = all.iter().find(|x| x.id == p.id).unwrap();
        assert_eq!(fetched.external_id.as_deref(), Some("abc123"));
        assert_eq!(fetched.external_source.as_deref(), Some("todoist"));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p nimble-core`
Expected: COMPILE ERROR — `LocalTask` has no field `external_id` (this is the failing state; the struct doesn't have the fields yet).

- [ ] **Step 4: Implement**

`types.rs` — add to BOTH structs (end of field list):
```rust
    pub external_id: Option<String>,
    pub external_source: Option<String>,
```

`db/tasks.rs`:
1. `SELECT_COLS` → `"id, parent_id, content, description, project_id, priority, due_date, completed, completed_at, status, linked_doc_id, position, created_at, updated_at, external_id, external_source"`.
2. Delete `row_to_task` and replace with a manual `FromRow` impl (top of file):
```rust
use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row};

impl FromRow<'_, SqliteRow> for LocalTask {
    fn from_row(row: &SqliteRow) -> Result<Self, sqlx::Error> {
        Ok(LocalTask {
            id: row.try_get("id")?,
            parent_id: row.try_get("parent_id")?,
            content: row.try_get("content")?,
            description: row.try_get("description")?,
            project_id: row.try_get("project_id")?,
            priority: row.try_get("priority")?,
            due_date: row.try_get("due_date")?,
            completed: row.try_get::<i64, _>("completed")? != 0,
            completed_at: row.try_get("completed_at")?,
            status: row.try_get("status")?,
            linked_doc_id: row.try_get("linked_doc_id")?,
            position: row.try_get("position")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            external_id: row.try_get("external_id")?,
            external_source: row.try_get("external_source")?,
        })
    }
}
```
3. Change every `sqlx::query_as::<_, (…tuple…)>(…)` + `row_to_task(…)` call site to `sqlx::query_as::<_, LocalTask>(…)` directly (the SQL strings already select `SELECT_COLS`, so nothing else changes). The compiler finds every site.
4. In `create_local_task`, the manually-built `LocalTask { … }` literal gains `external_id: None, external_source: None`.

`db/projects.rs`:
1. `get_projects` SQL → `SELECT id, name, color, position, external_id, external_source FROM projects …`, and map the two new tuple elements (6-tuple is fine here, under the 16 limit) — or give `Project` the same manual `FromRow` treatment; either compiles, prefer `FromRow` for consistency.
2. `create_project`'s returned literal gains `external_id: None, external_source: None`.

`packages/types/src/index.ts` — add to both `LocalTask` and `Project`:
```ts
  external_id: string | null
  external_source: string | null
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p nimble-core`
Expected: both tests PASS.

- [ ] **Step 6: Verify nothing else broke**

Run: `cargo build` (workspace root) and `cd apps/desktop && npx tsc --noEmit`
Expected: clean. (`todoist_migration.rs` writes these columns via raw SQL and is unaffected; TS consumers only gain optional-shaped fields.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: expose external_id/external_source through task+project CRUD, add first Rust tests"
```

---

### Task 2: HTML→Markdown converter module

Rust-side conversion of Tiptap HTML to markdown via `htmd`, plus a tag scanner that powers the dry-run lossiness report. Pure functions, fully unit-tested.

**Files:**
- Modify: `nimble-core/Cargo.toml` (add `htmd`)
- Create: `nimble-core/src/parsers/html_to_md.rs`
- Modify: `nimble-core/src/parsers/mod.rs` (add `pub mod html_to_md;`)
- Test: inline in `html_to_md.rs`

**Interfaces:**
- Consumes: nothing internal
- Produces: `pub fn html_to_markdown(html: &str) -> String` and `pub fn scan_unknown_tags(html: &str) -> Vec<String>` (Task 3 uses both). Contract: input that doesn't start with `<` is returned unchanged (already plain/markdown); conversion failure falls back to input unchanged (never destroys content).

- [ ] **Step 1: Add the dependency**

Run: `cargo add htmd --package nimble-core`
Expected: `htmd = "…"` appears in `nimble-core/Cargo.toml`; `cargo build -p nimble-core` compiles.

- [ ] **Step 2: Write the failing tests**

`nimble-core/src/parsers/html_to_md.rs` (tests first; module skeleton so it compiles as a failing-test state is fine):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_representative_tiptap_structures() {
        let html = "<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> text.</p>\
                    <ul><li><p>item one</p></li><li><p>item two</p></li></ul>\
                    <blockquote><p>quoted</p></blockquote>\
                    <p><a href=\"https://example.com\">a link</a></p>\
                    <pre><code>let x = 1;</code></pre>";
        let md = html_to_markdown(html);
        assert!(md.contains("# Title"));
        assert!(md.contains("**bold**"));
        assert!(md.contains("*italic*") || md.contains("_italic_"));
        assert!(md.contains("item one"));
        assert!(md.contains("> quoted"));
        assert!(md.contains("[a link](https://example.com)"));
        assert!(md.contains("let x = 1;"));
        assert!(!md.contains('<'), "no HTML tags may survive: {md}");
    }

    #[test]
    fn plain_text_passes_through_untouched() {
        assert_eq!(html_to_markdown("already markdown # not html"), "already markdown # not html");
        assert_eq!(html_to_markdown(""), "");
    }

    #[test]
    fn mention_spans_keep_their_text() {
        let html = "<p>ping <span class=\"mention-tag\" data-id=\"marco\">@marco</span> today</p>";
        let md = html_to_markdown(html);
        assert!(md.contains("@marco"));
        assert!(!md.contains("<span"));
    }

    #[test]
    fn scanner_flags_tags_outside_allowlist() {
        let html = "<p>fine</p><table><tr><td>cell</td></tr></table><u>underline</u>";
        let tags = scan_unknown_tags(html);
        assert!(tags.contains(&"table".to_string()));
        assert!(tags.contains(&"u".to_string()));
        assert!(!tags.contains(&"p".to_string()));
    }

    #[test]
    fn scanner_ignores_plain_text() {
        assert!(scan_unknown_tags("a < b and c > d, no tags").is_empty());
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p nimble-core html_to_md`
Expected: COMPILE ERROR (`html_to_markdown` not defined) — add `pub mod html_to_md;` to `parsers/mod.rs` first so the module is reachable.

- [ ] **Step 4: Implement**

Top of `html_to_md.rs`:
```rust
/// Tags Tiptap's configured extensions can produce (StarterKit h1-3 + link + mention).
/// Anything else in a doc is flagged in the dry-run report as potentially lossy.
const KNOWN_TAGS: &[&str] = &[
    "p", "h1", "h2", "h3", "ul", "ol", "li", "strong", "b", "em", "i", "s",
    "code", "pre", "blockquote", "a", "br", "hr", "span",
];

/// Convert Tiptap HTML to markdown. Non-HTML input (doesn't start with '<')
/// and conversion failures return the input unchanged — never destroy content.
pub fn html_to_markdown(html: &str) -> String {
    if !html.trim_start().starts_with('<') {
        return html.to_string();
    }
    htmd::convert(html).unwrap_or_else(|_| html.to_string())
}

/// Distinct lowercase tag names present in `html` that are NOT in KNOWN_TAGS.
/// Hand-rolled scan (no regex dep): a tag is '<' + optional '/' + ascii-alpha run.
pub fn scan_unknown_tags(html: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let mut found: Vec<String> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let mut j = i + 1;
            if j < bytes.len() && bytes[j] == b'/' {
                j += 1;
            }
            let start = j;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-') {
                j += 1;
            }
            // must look like a real tag: name followed by '>', ' ', '/' or attribute
            if j > start && j < bytes.len() && (bytes[j] == b'>' || bytes[j] == b' ' || bytes[j] == b'/') {
                let name = html[start..j].to_ascii_lowercase();
                if !KNOWN_TAGS.contains(&name.as_str()) && !found.contains(&name) {
                    found.push(name);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    found.sort();
    found
}
```
Note: if `htmd::convert` isn't the crate's entry point at the resolved version, the builder form is `htmd::HtmlToMarkdown::new().convert(html)` — same contract, adjust the one call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p nimble-core html_to_md`
Expected: 5 tests PASS. If the mention test fails on residual `<span>`, configure htmd to unwrap unknown inline tags (builder option) rather than weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: HTML->markdown converter with tag scanner for docs migration"
```

---

### Task 3: Docs markdown migration — preview, backup, commit

Dry-run report over Marco's real docs, `VACUUM INTO` backup, then convert all `documents.content` in one transaction and flip the `docs_content_format` setting. `doc_notes` are plain text (spec deviation #2) — untouched.

**Files:**
- Modify: `nimble-core/src/db/docs.rs`
- Modify: `apps/desktop/src-tauri/src/commands/docs.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register 2 commands)
- Modify: `apps/desktop/src/services/tauri.ts`, `data-provider.ts`, `tauri-provider.ts`
- Modify: `apps/mobile/services/sqlite-provider.ts` (stubs)
- Modify: `packages/types/src/index.ts` (2 new types)
- Test: inline in `docs.rs`

**Interfaces:**
- Consumes: `crate::parsers::html_to_md::{html_to_markdown, scan_unknown_tags}` (Task 2); `crate::db::settings::set_setting` (exists); `sync::append_sync_log` (exists)
- Produces:
  - `pub async fn preview_docs_markdown_migration(pool: &SqlitePool) -> crate::Result<DocsMdPreview>`
  - `pub async fn migrate_docs_to_markdown(pool: &SqlitePool, backup_path: &str) -> crate::Result<DocsMdResult>`
  - Settings key `docs_content_format`: absent/`"html"` → HTML era; `"markdown"` after migration (Task 4's editor reads this)
  - TS types `DocsMdPreview`, `DocsMdResult`; provider methods `docs.previewMarkdownMigration()`, `docs.migrateToMarkdown()`

- [ ] **Step 1: Write the failing tests**

In `nimble-core/src/db/docs.rs`:
```rust
#[cfg(test)]
mod md_migration_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn preview_reports_flagged_docs_without_writing() {
        let pool = test_pool().await;
        let clean = super::create_document(&pool, "Clean", None).await.unwrap();
        super::update_document(&pool, &clean.id, None, Some("<p>hello <strong>world</strong></p>"), None)
            .await
            .unwrap();
        let risky = super::create_document(&pool, "Risky", None).await.unwrap();
        super::update_document(&pool, &risky.id, None, Some("<table><tr><td>x</td></tr></table>"), None)
            .await
            .unwrap();

        let preview = super::preview_docs_markdown_migration(&pool).await.unwrap();
        assert_eq!(preview.total, 2);
        assert_eq!(preview.flagged.len(), 1);
        assert_eq!(preview.flagged[0].title, "Risky");
        assert!(preview.flagged[0].unknown_tags.contains(&"table".to_string()));

        // preview must not modify content
        let doc = super::get_document(&pool, &clean.id).await.unwrap().unwrap();
        assert!(doc.content.starts_with("<p>"));
    }

    #[tokio::test]
    async fn migrate_converts_content_and_flips_setting() {
        let pool = test_pool().await;
        let doc = super::create_document(&pool, "Doc", None).await.unwrap();
        super::update_document(&pool, &doc.id, None, Some("<h2>Head</h2><p>body <em>i</em></p>"), None)
            .await
            .unwrap();

        let backup = std::env::temp_dir().join(format!("dt-test-backup-{}.db", uuid::Uuid::new_v4()));
        let result = super::migrate_docs_to_markdown(&pool, backup.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(result.converted, 1);
        assert!(std::path::Path::new(&result.backup_path).exists());

        let after = super::get_document(&pool, &doc.id).await.unwrap().unwrap();
        assert!(after.content.contains("## Head"));
        assert!(!after.content.contains('<'));

        let fmt = crate::db::settings::get_setting(&pool, "docs_content_format").await.unwrap();
        assert_eq!(fmt.as_deref(), Some("markdown"));

        // idempotent: second run converts nothing (content no longer starts with '<')
        let backup2 = std::env::temp_dir().join(format!("dt-test-backup-{}.db", uuid::Uuid::new_v4()));
        let again = super::migrate_docs_to_markdown(&pool, backup2.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(again.converted, 0);
        let _ = std::fs::remove_file(&backup);
        let _ = std::fs::remove_file(&backup2);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p nimble-core md_migration`
Expected: COMPILE ERROR — `preview_docs_markdown_migration` not defined.

- [ ] **Step 3: Implement the core functions**

In `docs.rs`:
```rust
use crate::parsers::html_to_md::{html_to_markdown, scan_unknown_tags};

#[derive(Debug, serde::Serialize)]
pub struct FlaggedDoc {
    pub id: String,
    pub title: String,
    pub unknown_tags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct DocsMdPreview {
    pub total: i64,
    pub convertible: usize,
    pub already_plain: usize,
    pub flagged: Vec<FlaggedDoc>,
}

#[derive(Debug, serde::Serialize)]
pub struct DocsMdResult {
    pub converted: usize,
    pub skipped_plain: usize,
    pub backup_path: String,
}

pub async fn preview_docs_markdown_migration(pool: &SqlitePool) -> crate::Result<DocsMdPreview> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, title, content FROM documents")
            .fetch_all(pool)
            .await?;
    let total = rows.len() as i64;
    let mut convertible = 0;
    let mut already_plain = 0;
    let mut flagged = Vec::new();
    for (id, title, content) in rows {
        if !content.trim_start().starts_with('<') {
            already_plain += 1;
            continue;
        }
        convertible += 1;
        let unknown = scan_unknown_tags(&content);
        if !unknown.is_empty() {
            flagged.push(FlaggedDoc { id, title, unknown_tags: unknown });
        }
    }
    Ok(DocsMdPreview { total, convertible, already_plain, flagged })
}

pub async fn migrate_docs_to_markdown(
    pool: &SqlitePool,
    backup_path: &str,
) -> crate::Result<DocsMdResult> {
    // 1. Online backup (safe while the DB is open)
    sqlx::query("VACUUM INTO ?").bind(backup_path).execute(pool).await?;

    // 2. Convert everything in one transaction
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id, content FROM documents")
        .fetch_all(pool)
        .await?;
    let mut converted = 0usize;
    let mut skipped_plain = 0usize;
    let mut tx = pool.begin().await?;
    let mut touched: Vec<String> = Vec::new();
    for (id, content) in rows {
        if !content.trim_start().starts_with('<') {
            skipped_plain += 1;
            continue;
        }
        let md = html_to_markdown(&content);
        sqlx::query("UPDATE documents SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(&md)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        converted += 1;
        touched.push(id);
    }
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('docs_content_format', 'markdown')")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    // 3. Sync-log the converted docs so Turso propagates the new content
    for id in touched {
        if let Ok(Some(doc)) = get_document(pool, &id).await {
            let snapshot = serde_json::to_string(&doc).unwrap_or_default();
            crate::db::sync::append_sync_log(pool, "documents", &id, "UPDATE", Some("content"), Some(&snapshot))
                .await
                .ok();
        }
    }
    Ok(DocsMdResult { converted, skipped_plain, backup_path: backup_path.to_string() })
}
```
(If the `settings` table's column names differ from `key`/`value`, match whatever `db/settings.rs::set_setting` uses — prefer calling `set_setting` after `tx.commit()` instead of raw SQL if its signature only takes a pool.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p nimble-core md_migration`
Expected: 2 tests PASS.

- [ ] **Step 5: Wire commands + TS**

`apps/desktop/src-tauri/src/commands/docs.rs` — append:
```rust
#[tauri::command]
pub async fn preview_docs_markdown_migration(
    app: AppHandle,
) -> Result<nimble_core::db::docs::DocsMdPreview, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::preview_docs_markdown_migration(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrate_docs_to_markdown(
    app: AppHandle,
) -> Result<nimble_core::db::docs::DocsMdResult, String> {
    let pool = app.state::<SqlitePool>();
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = app_dir.join(format!("nimble-backup-pre-markdown-{stamp}.db"));
    nimble_core::db::docs::migrate_docs_to_markdown(
        pool.inner(),
        backup.to_str().ok_or("backup path not utf-8")?,
    )
    .await
    .map_err(|e| e.to_string())
}
```
Register both in `lib.rs` `invoke_handler![]` under the existing `docs::` lines (match the fully-qualified `docs::fn_name,` pattern).

`packages/types/src/index.ts`:
```ts
export interface FlaggedDoc {
  id: string
  title: string
  unknown_tags: string[]
}

export interface DocsMdPreview {
  total: number
  convertible: number
  already_plain: number
  flagged: FlaggedDoc[]
}

export interface DocsMdResult {
  converted: number
  skipped_plain: number
  backup_path: string
}
```

`apps/desktop/src/services/tauri.ts` — add invoke wrappers `previewDocsMarkdownMigration(): Promise<DocsMdPreview>` → `invoke('preview_docs_markdown_migration')` and `migrateDocsToMarkdown(): Promise<DocsMdResult>` → `invoke('migrate_docs_to_markdown')`, following the file's existing wrapper style.

`data-provider.ts` — extend the `docs` group of the `DataProvider` interface:
```ts
  previewMarkdownMigration(): Promise<DocsMdPreview>
  migrateToMarkdown(): Promise<DocsMdResult>
```
`tauri-provider.ts` — delegate to the two tauri.ts wrappers. `apps/mobile/services/sqlite-provider.ts` — stubs that `throw new Error('desktop only')` (docs migration never runs on mobile).

- [ ] **Step 6: Verify build**

Run: `cargo build && cd apps/desktop && npx tsc --noEmit && cd ../..`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: docs markdown migration with dry-run preview and VACUUM INTO backup"
```

---

### Task 4: Tiptap markdown mode + Docs migration settings UI

The editor becomes format-aware: `docs_content_format` = `"markdown"` loads/saves markdown via `tiptap-markdown`; anything else keeps today's HTML behavior. A settings section runs preview → migrate.

**Files:**
- Modify: `apps/desktop/package.json` (add `tiptap-markdown`)
- Modify: `apps/desktop/src/components/docs/TiptapEditor.tsx`
- Modify: `apps/desktop/src/components/docs/DocEditor.tsx`
- Create: `apps/desktop/src/components/settings/DocsMigrationSection.tsx`
- Modify: the settings page that renders `TodoistMigrationSection` (add the new section beside it)

**Interfaces:**
- Consumes: `dp.docs.previewMarkdownMigration()` / `dp.docs.migrateToMarkdown()` (Task 3); settings read via the existing `getSetting` wrapper in `services/tauri.ts`
- Produces: `TiptapEditor` prop `format: 'html' | 'markdown'`; module-level `getDocsFormat(): Promise<'html' | 'markdown'>` helper in `DocEditor.tsx`

- [ ] **Step 1: Install the extension**

Run: `cd apps/desktop && npm install tiptap-markdown && cd ../..`
Expected: `tiptap-markdown` in `apps/desktop/package.json` dependencies.

- [ ] **Step 2: Make TiptapEditor format-aware**

In `TiptapEditor.tsx`:
```tsx
import { Markdown } from 'tiptap-markdown'

interface TiptapEditorProps {
  // …existing props…
  format?: 'html' | 'markdown'
}
```
- Extensions array (inside `useEditor`): when `format === 'markdown'`, append
  ```tsx
  Markdown.configure({ html: false, linkify: true, breaks: false }),
  ```
- Save path (the debounced `onUpdate` at :178 and the unmount flush at :192): replace `editor.getHTML()` with
  ```tsx
  const serialize = (editor: Editor) =>
    format === 'markdown' ? editor.storage.markdown.getMarkdown() : editor.getHTML()
  ```
  and call `onChange(serialize(editor))` in both places.
- Content-prop effect (:186): compare against `serialize(editor)` instead of `editor.getHTML()` so markdown docs don't loop.
- The `Markdown` extension makes `setContent`/initial `content` parse strings as markdown — no other load-path change needed.

- [ ] **Step 3: Make DocEditor pass the format**

In `DocEditor.tsx`:
```tsx
import { getSetting } from '@/services/tauri'

let cachedFormat: 'html' | 'markdown' | null = null
async function getDocsFormat(): Promise<'html' | 'markdown'> {
  if (cachedFormat) return cachedFormat
  const v = await getSetting('docs_content_format')
  cachedFormat = v === 'markdown' ? 'markdown' : 'html'
  return cachedFormat
}
export function invalidateDocsFormatCache() {
  cachedFormat = null
}
```
- `const [format, setFormat] = useState<'html' | 'markdown' | null>(null)` + `useEffect(() => { getDocsFormat().then(setFormat) }, [])`.
- Render the editor only once format is known, keyed so a format flip rebuilds it:
  ```tsx
  {format && <TiptapEditor key={format} format={format} …existingProps />}
  ```
  (If the existing `getSetting` wrapper has a different name/signature in `tauri.ts`, use that one — do not add a new command; a settings getter already exists because the Todoist token is read this way.)

- [ ] **Step 4: Build the settings section**

`apps/desktop/src/components/settings/DocsMigrationSection.tsx` — follow `TodoistMigrationSection.tsx`'s structure (preview button → summary panel → AlertDialog-confirmed migrate button). Content requirements:
```tsx
import { useState } from 'react'
import { getDataProvider } from '@/services/data-provider'
import { invalidateDocsFormatCache } from '@/components/docs/DocEditor'
import type { DocsMdPreview, DocsMdResult } from '@nimble/types'
// + the Button / AlertDialog imports used by TodoistMigrationSection

export function DocsMigrationSection() {
  const [preview, setPreview] = useState<DocsMdPreview | null>(null)
  const [result, setResult] = useState<DocsMdResult | null>(null)
  const [busy, setBusy] = useState(false)
  const dp = getDataProvider()

  const runPreview = async () => {
    setBusy(true)
    try { setPreview(await dp.docs.previewMarkdownMigration()) } finally { setBusy(false) }
  }
  const runMigrate = async () => {
    setBusy(true)
    try {
      setResult(await dp.docs.migrateToMarkdown())
      invalidateDocsFormatCache()
    } finally { setBusy(false) }
  }
  // Render: "Docs storage format" heading; body copy:
  // "Converts all docs from HTML to markdown. A backup of the database is
  //  saved first. Run the preview to see which docs contain formatting that
  //  may simplify during conversion."
  // Preview panel lists: total, convertible, already_plain, and each flagged
  // doc title with its unknown_tags. Migrate button disabled until preview ran.
  // After success: "Converted {n} docs. Backup saved to {backup_path}." + note
  // "Reopen any doc you have open to pick up the new format."
}
```
Fill in the JSX using the exact same shadcn components and classNames as `TodoistMigrationSection.tsx` (copy its layout skeleton). Add `<DocsMigrationSection />` to the settings page right after `<TodoistMigrationSection />`.

- [ ] **Step 5: Verify**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.
Manual check (run `npm run tauri dev`): existing docs still open/edit normally (HTML era untouched); Settings shows the new section; preview returns counts. Do NOT run the real migration during dev verification — that's Marco's call from the UI.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: markdown mode for Tiptap editor + docs migration settings UI"
```

---

### Task 5: Migration v17 + sync-metadata fields end-to-end

Adds the Todoist sync tables and per-row sync metadata, and threads the two new synced columns through `LocalTask`/`Project`, TS types, and the mobile schema mirror (so Turso snapshots round-trip without wiping them).

**Files:**
- Modify: `nimble-core/src/db/migrations.rs` (append v17 to the `MIGRATIONS` slice, matching the existing `Migration { version, description, sql }` shape)
- Modify: `nimble-core/src/types.rs` (2 new fields on both structs)
- Modify: `nimble-core/src/db/tasks.rs` (SELECT_COLS + FromRow + create literal)
- Modify: `nimble-core/src/db/projects.rs` (same)
- Modify: `packages/types/src/index.ts`
- Modify: `apps/mobile/services/database.ts` (v17 mirror — columns only)
- Test: extend the Task 1 test in `tasks.rs`

**Interfaces:**
- Consumes: Task 1's `FromRow` impl and `test_pool`
- Produces: tables `todoist_outbox`, `integration_sync_state`; columns `local_tasks.remote_updated_at`, `local_tasks.synced_snapshot` (+ same on `projects`); struct/TS fields `remote_updated_at: Option<String>` / `synced_snapshot: Option<String>` (`string | null` in TS). Every later task assumes these exist.

- [ ] **Step 1: Write the failing test**

Add to `tasks.rs` tests module:
```rust
    #[tokio::test]
    async fn v17_sync_metadata_roundtrips() {
        let pool = test_pool().await;
        // tables exist
        sqlx::query("SELECT id, local_id, object_type, op, payload_json, command_uuid, temp_id, status, error FROM todoist_outbox")
            .fetch_all(&pool).await.unwrap();
        sqlx::query("SELECT provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled FROM integration_sync_state")
            .fetch_all(&pool).await.unwrap();
        // columns visible through the struct
        let task = super::create_local_task(&pool, "t", None, None, None, None, None).await.unwrap();
        sqlx::query("UPDATE local_tasks SET synced_snapshot = '{}', remote_updated_at = '2026-08-04T00:00:00Z' WHERE id = ?")
            .bind(&task.id).execute(&pool).await.unwrap();
        let all = super::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = all.iter().find(|x| x.id == task.id).unwrap();
        assert_eq!(t.synced_snapshot.as_deref(), Some("{}"));
        assert_eq!(t.remote_updated_at.as_deref(), Some("2026-08-04T00:00:00Z"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p nimble-core v17_sync_metadata`
Expected: FAIL — `no such table: todoist_outbox`.

- [ ] **Step 3: Implement**

Append to the `MIGRATIONS` slice in `migrations.rs` (the runner splits `sql` on `;` — keep statements semicolon-separated, no semicolons inside statements):
```rust
Migration {
    version: 17,
    description: "todoist two-way sync: outbox, integration state, per-row sync metadata",
    sql: "
        CREATE TABLE IF NOT EXISTS todoist_outbox (
            id TEXT PRIMARY KEY,
            local_id TEXT NOT NULL,
            object_type TEXT NOT NULL,
            op TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            command_uuid TEXT NOT NULL,
            temp_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_todoist_outbox_status ON todoist_outbox(status);
        CREATE INDEX IF NOT EXISTS idx_todoist_outbox_local ON todoist_outbox(local_id, status);
        CREATE TABLE IF NOT EXISTS integration_sync_state (
            provider TEXT PRIMARY KEY,
            sync_token TEXT,
            last_sync_at TEXT,
            last_full_sync_at TEXT,
            last_error TEXT,
            enabled INTEGER NOT NULL DEFAULT 1
        );
        ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT;
        ALTER TABLE local_tasks ADD COLUMN synced_snapshot TEXT;
        ALTER TABLE projects ADD COLUMN remote_updated_at TEXT;
        ALTER TABLE projects ADD COLUMN synced_snapshot TEXT
    ",
},
```
(Match the exact field syntax of the existing `Migration` entries — if `sql` is a `&str` in a struct literal vs a constructor fn, copy the v16 entry's shape.)

Struct/TS/query threading (mechanical, compiler-driven):
1. `types.rs`: add `pub remote_updated_at: Option<String>, pub synced_snapshot: Option<String>` to `LocalTask` AND `Project`.
2. `tasks.rs`: `SELECT_COLS` += `, remote_updated_at, synced_snapshot`; `FromRow` impl += the two `try_get`s; `create_local_task` literal += `remote_updated_at: None, synced_snapshot: None`.
3. `projects.rs`: same three touches.
4. `packages/types/src/index.ts`: `remote_updated_at: string | null` and `synced_snapshot: string | null` on both interfaces.
5. `apps/mobile/services/database.ts`: append a v17 entry in the file's existing migration-entry shape with exactly these statements (and ONLY these — outbox/state tables are Mac-local):
```ts
'ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT',
'ALTER TABLE local_tasks ADD COLUMN synced_snapshot TEXT',
'ALTER TABLE projects ADD COLUMN remote_updated_at TEXT',
'ALTER TABLE projects ADD COLUMN synced_snapshot TEXT',
```
While in that file, confirm the mobile mirror already has v15 (`external_id`/`external_source` on `local_tasks` + `projects`, with indexes `idx_local_tasks_external`/`idx_projects_external` on `(external_source, external_id)`) and v16 (`ALTER TABLE captures ADD COLUMN context TEXT`). If either is missing, add it with that SQL before v17 — desktop snapshots already carry these keys and mobile's `INSERT OR REPLACE` apply will fail without the columns.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p nimble-core`
Expected: all tests PASS (including Tasks 1–3 tests — they now run migrations through v17).

- [ ] **Step 5: Verify builds**

Run: `cargo build && cd apps/desktop && npx tsc --noEmit && cd ../..`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: migration v17 - todoist outbox, integration sync state, per-row sync metadata"
```

---

### Task 6: Integration state helpers + outbox module

`integration_sync_state` accessors and the persistent outbox with coalescing rules: updates merge into pending creates/updates; a delete cancels all pending ops for that row (and is dropped entirely if the row never reached Todoist).

**Files:**
- Modify: `nimble-core/src/lib.rs` (add `pub mod integrations;`)
- Create: `nimble-core/src/integrations/mod.rs`
- Create: `nimble-core/src/integrations/todoist/mod.rs`
- Create: `nimble-core/src/integrations/todoist/outbox.rs`
- Test: inline in both new files

**Interfaces:**
- Consumes: `test_pool`, v17 tables
- Produces (used by observer/push/status tasks):
```rust
// integrations/mod.rs
pub struct IntegrationState {
    pub provider: String,
    pub sync_token: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_full_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub enabled: bool,
}
pub async fn get_state(pool: &SqlitePool, provider: &str) -> crate::Result<Option<IntegrationState>>;
pub async fn ensure_state(pool: &SqlitePool, provider: &str) -> crate::Result<IntegrationState>;
pub async fn set_enabled(pool: &SqlitePool, provider: &str, enabled: bool) -> crate::Result<()>;
/// Some(token) iff state row enabled AND todoist_api_token setting is set
pub async fn adapter_token_if_active(pool: &SqlitePool) -> crate::Result<Option<String>>;

// integrations/todoist/outbox.rs
pub struct OutboxRow {
    pub id: String,
    pub local_id: String,
    pub object_type: String, // "task" | "project"
    pub op: String,          // "create" | "update" | "close" | "reopen" | "delete" | "move"
    pub payload: serde_json::Value,
    pub command_uuid: String,
    pub temp_id: Option<String>,
}
pub async fn enqueue(pool: &SqlitePool, object_type: &str, local_id: &str, op: &str, payload: serde_json::Value) -> crate::Result<()>;
pub async fn pending_batch(pool: &SqlitePool, limit: i64) -> crate::Result<Vec<OutboxRow>>;
pub async fn pending_create_temp_id(pool: &SqlitePool, local_id: &str) -> crate::Result<Option<String>>;
pub async fn mark_done(pool: &SqlitePool, ids: &[String]) -> crate::Result<()>;
pub async fn mark_error(pool: &SqlitePool, id: &str, error: &str) -> crate::Result<()>;
pub async fn counts(pool: &SqlitePool) -> crate::Result<(i64, i64)>; // (pending, error)
pub async fn error_list(pool: &SqlitePool) -> crate::Result<Vec<(String, String, String)>>; // (id, op, error)
pub async fn prune_done(pool: &SqlitePool) -> crate::Result<()>; // done rows older than 7 days
```

- [ ] **Step 1: Write the failing tests**

`outbox.rs` tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use serde_json::json;

    #[tokio::test]
    async fn update_merges_into_pending_create() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a", "priority": 1})).await.unwrap();
        enqueue(&pool, "task", "t1", "update", json!({"content": "b"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "create");
        assert_eq!(batch[0].payload["content"], "b");
        assert_eq!(batch[0].payload["priority"], 1);
        assert!(batch[0].temp_id.is_some());
    }

    #[tokio::test]
    async fn update_merges_into_pending_update() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "update", json!({"due_date": "2026-08-05"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].payload["content"], "a");
        assert_eq!(batch[0].payload["due_date"], "2026-08-05");
    }

    #[tokio::test]
    async fn delete_cancels_pending_create_entirely() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "create", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "delete", json!({"external_id": null})).await.unwrap();
        assert!(pending_batch(&pool, 100).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn delete_of_synced_row_replaces_pending_ops() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "delete", json!({"external_id": "X9"})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "delete");
        assert_eq!(batch[0].payload["external_id"], "X9");
    }

    #[tokio::test]
    async fn close_and_move_append_without_merging() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "update", json!({"content": "a"})).await.unwrap();
        enqueue(&pool, "task", "t1", "close", json!({})).await.unwrap();
        enqueue(&pool, "task", "t1", "move", json!({"project_local_id": "p2"})).await.unwrap();
        assert_eq!(pending_batch(&pool, 100).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn command_uuid_persisted_at_enqueue() {
        let pool = test_pool().await;
        enqueue(&pool, "task", "t1", "close", json!({})).await.unwrap();
        let batch = pending_batch(&pool, 100).await.unwrap();
        assert!(!batch[0].command_uuid.is_empty());
    }
}
```

`integrations/mod.rs` test:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn adapter_active_requires_state_and_token() {
        let pool = test_pool().await;
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none());
        ensure_state(&pool, "todoist").await.unwrap();
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none()); // no token yet
        crate::db::settings::set_setting(&pool, "todoist_api_token", "tok_123").await.unwrap();
        assert_eq!(adapter_token_if_active(&pool).await.unwrap().as_deref(), Some("tok_123"));
        set_enabled(&pool, "todoist", false).await.unwrap();
        assert!(adapter_token_if_active(&pool).await.unwrap().is_none());
    }
}
```
(If `set_setting`'s real signature differs, match it — it exists in `db/settings.rs:31-53`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p nimble-core integrations`
Expected: COMPILE ERROR — module not defined. Add `pub mod integrations;` to `lib.rs`, `pub mod todoist;` to `integrations/mod.rs`, `pub mod outbox;` to `todoist/mod.rs`, then re-run to see the real missing-fn errors.

- [ ] **Step 3: Implement `integrations/mod.rs`**

```rust
use sqlx::SqlitePool;

pub mod todoist;

#[derive(Debug, Clone, serde::Serialize)]
pub struct IntegrationState {
    pub provider: String,
    pub sync_token: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_full_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub enabled: bool,
}

pub async fn get_state(pool: &SqlitePool, provider: &str) -> crate::Result<Option<IntegrationState>> {
    let row: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>, i64)> =
        sqlx::query_as("SELECT provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled FROM integration_sync_state WHERE provider = ?")
            .bind(provider)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled)| IntegrationState {
        provider, sync_token, last_sync_at, last_full_sync_at, last_error, enabled: enabled != 0,
    }))
}

pub async fn ensure_state(pool: &SqlitePool, provider: &str) -> crate::Result<IntegrationState> {
    sqlx::query("INSERT OR IGNORE INTO integration_sync_state (provider) VALUES (?)")
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(get_state(pool, provider).await?.expect("state row just ensured"))
}

pub async fn set_enabled(pool: &SqlitePool, provider: &str, enabled: bool) -> crate::Result<()> {
    ensure_state(pool, provider).await?;
    sqlx::query("UPDATE integration_sync_state SET enabled = ? WHERE provider = ?")
        .bind(enabled as i64)
        .bind(provider)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn adapter_token_if_active(pool: &SqlitePool) -> crate::Result<Option<String>> {
    let Some(state) = get_state(pool, "todoist").await? else { return Ok(None) };
    if !state.enabled {
        return Ok(None);
    }
    crate::db::settings::get_setting(pool, "todoist_api_token").await
}
```

- [ ] **Step 4: Implement `outbox.rs`**

```rust
use sqlx::SqlitePool;

#[derive(Debug, Clone)]
pub struct OutboxRow {
    pub id: String,
    pub local_id: String,
    pub object_type: String,
    pub op: String,
    pub payload: serde_json::Value,
    pub command_uuid: String,
    pub temp_id: Option<String>,
}

pub async fn enqueue(
    pool: &SqlitePool,
    object_type: &str,
    local_id: &str,
    op: &str,
    payload: serde_json::Value,
) -> crate::Result<()> {
    if op == "delete" {
        let had_create: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op = 'create'",
        )
        .bind(local_id)
        .fetch_optional(pool)
        .await?;
        sqlx::query("DELETE FROM todoist_outbox WHERE local_id = ? AND status = 'pending'")
            .bind(local_id)
            .execute(pool)
            .await?;
        if had_create.is_some() {
            return Ok(()); // row never existed remotely — nothing to delete there
        }
    } else if op == "update" {
        let existing: Option<(String, String)> = sqlx::query_as(
            "SELECT id, payload_json FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op IN ('create','update') ORDER BY rowid DESC LIMIT 1",
        )
        .bind(local_id)
        .fetch_optional(pool)
        .await?;
        if let Some((row_id, payload_json)) = existing {
            let mut merged: serde_json::Value =
                serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({}));
            if let (Some(m), Some(new)) = (merged.as_object_mut(), payload.as_object()) {
                for (k, v) in new {
                    m.insert(k.clone(), v.clone());
                }
            }
            sqlx::query("UPDATE todoist_outbox SET payload_json = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                .bind(merged.to_string())
                .bind(row_id)
                .execute(pool)
                .await?;
            return Ok(());
        }
    }
    let temp_id = if op == "create" { Some(uuid::Uuid::new_v4().to_string()) } else { None };
    sqlx::query(
        "INSERT INTO todoist_outbox (id, local_id, object_type, op, payload_json, command_uuid, temp_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(local_id)
    .bind(object_type)
    .bind(op)
    .bind(payload.to_string())
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(temp_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn pending_batch(pool: &SqlitePool, limit: i64) -> crate::Result<Vec<OutboxRow>> {
    let rows: Vec<(String, String, String, String, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, local_id, object_type, op, payload_json, command_uuid, temp_id FROM todoist_outbox WHERE status = 'pending' ORDER BY rowid LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, local_id, object_type, op, payload_json, command_uuid, temp_id)| OutboxRow {
            id, local_id, object_type, op,
            payload: serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
            command_uuid, temp_id,
        })
        .collect())
}

pub async fn pending_create_temp_id(pool: &SqlitePool, local_id: &str) -> crate::Result<Option<String>> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT temp_id FROM todoist_outbox WHERE local_id = ? AND status = 'pending' AND op = 'create'",
    )
    .bind(local_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|(t,)| t))
}

pub async fn mark_done(pool: &SqlitePool, ids: &[String]) -> crate::Result<()> {
    for id in ids {
        sqlx::query("UPDATE todoist_outbox SET status = 'done', updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn mark_error(pool: &SqlitePool, id: &str, error: &str) -> crate::Result<()> {
    sqlx::query("UPDATE todoist_outbox SET status = 'error', error = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .bind(error)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn counts(pool: &SqlitePool) -> crate::Result<(i64, i64)> {
    let pending: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM todoist_outbox WHERE status = 'pending'")
        .fetch_one(pool)
        .await?;
    let errors: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM todoist_outbox WHERE status = 'error'")
        .fetch_one(pool)
        .await?;
    Ok((pending.0, errors.0))
}

pub async fn error_list(pool: &SqlitePool) -> crate::Result<Vec<(String, String, String)>> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, op, error FROM todoist_outbox WHERE status = 'error' ORDER BY rowid DESC LIMIT 50",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id, op, e)| (id, op, e.unwrap_or_default())).collect())
}

pub async fn prune_done(pool: &SqlitePool) -> crate::Result<()> {
    sqlx::query("DELETE FROM todoist_outbox WHERE status = 'done' AND created_at < datetime('now', '-7 days', 'localtime')")
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p nimble-core integrations`
Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: integration state helpers + todoist outbox with op coalescing"
```

---

### Task 7: Todoist `/sync` HTTP client

Thin typed client for the unified Sync endpoint. No business logic here — that's why its tests are just serde shape checks; everything interesting is tested in mappers/merge/loop tasks.

**Files:**
- Create: `nimble-core/src/integrations/todoist/client.rs`
- Modify: `nimble-core/src/integrations/todoist/mod.rs` (`pub mod client;`)
- Test: inline (deserialization fixtures)

**Interfaces:**
- Consumes: nothing internal
- Produces:
```rust
pub async fn sync(token: &str, body: &serde_json::Value) -> crate::Result<SyncResponse>;
pub struct SyncResponse { /* fields below */ }
pub struct TodoistItem { /* fields below */ }
pub struct TodoistProject { pub id: String, pub name: String, pub is_deleted: Option<bool>, pub is_archived: Option<bool>, pub inbox_project: Option<bool> }
pub struct TodoistSection { pub id: String, pub project_id: String, pub name: String, pub is_deleted: Option<bool> }
pub struct TodoistDue { pub date: Option<String>, pub string: Option<String>, pub is_recurring: Option<bool> }
```

- [ ] **Step 1: Write the failing test**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_sync_response() {
        let json = r#"{
            "sync_token": "abcTOKEN",
            "full_sync": true,
            "items": [{
                "id": "6X7rM8997g3RQmvh",
                "content": "Buy milk",
                "description": "",
                "project_id": "6Jf8VQXxpwv56VQ7",
                "section_id": null,
                "parent_id": null,
                "priority": 1,
                "child_order": 3,
                "checked": false,
                "is_deleted": false,
                "updated_at": "2026-08-04T10:00:00.000000Z",
                "due": {"date": "2026-08-05", "string": "every day", "is_recurring": true}
            }],
            "projects": [{"id": "6Jf8VQXxpwv56VQ7", "name": "Errands", "is_deleted": false}],
            "sections": [{"id": "sec1", "project_id": "6Jf8VQXxpwv56VQ7", "name": "Soon", "is_deleted": false}],
            "temp_id_mapping": {"tmp-1": "real-1"},
            "sync_status": {"uuid-1": "ok", "uuid-2": {"error": "Item not found", "error_code": 20}}
        }"#;
        let resp: SyncResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.sync_token.as_deref(), Some("abcTOKEN"));
        let item = &resp.items[0];
        assert_eq!(item.content, "Buy milk");
        assert_eq!(item.due.as_ref().unwrap().is_recurring, Some(true));
        assert_eq!(resp.temp_id_mapping.get("tmp-1").unwrap(), "real-1");
        assert!(command_ok(&resp.sync_status["uuid-1"]));
        assert!(!command_ok(&resp.sync_status["uuid-2"]));
    }

    #[test]
    fn tolerates_missing_optional_blocks() {
        let resp: SyncResponse = serde_json::from_str(r#"{"sync_token": "t"}"#).unwrap();
        assert!(resp.items.is_empty());
        assert!(resp.sync_status.is_empty());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p nimble-core client`
Expected: COMPILE ERROR — types not defined.

- [ ] **Step 3: Implement**

```rust
use std::collections::HashMap;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistDue {
    pub date: Option<String>,
    pub string: Option<String>,
    pub is_recurring: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistItem {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub section_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub child_order: Option<i64>,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub is_deleted: Option<bool>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub due: Option<TodoistDue>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_deleted: Option<bool>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub inbox_project: Option<bool>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct TodoistSection {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub is_deleted: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub struct SyncResponse {
    #[serde(default)]
    pub sync_token: Option<String>,
    #[serde(default)]
    pub full_sync: Option<bool>,
    #[serde(default)]
    pub items: Vec<TodoistItem>,
    #[serde(default)]
    pub projects: Vec<TodoistProject>,
    #[serde(default)]
    pub sections: Vec<TodoistSection>,
    #[serde(default)]
    pub temp_id_mapping: HashMap<String, String>,
    #[serde(default)]
    pub sync_status: HashMap<String, serde_json::Value>,
}

/// A per-command sync_status value is the literal string "ok" on success,
/// or an error object on failure.
pub fn command_ok(status: &serde_json::Value) -> bool {
    status.as_str() == Some("ok")
}

pub async fn sync(token: &str, body: &serde_json::Value) -> crate::Result<SyncResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.todoist.com/api/v1/sync")
        .bearer_auth(token)
        .json(body)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        // Construct the error the same way api/todoist.rs::complete_todoist_task
        // does for non-2xx responses (same crate::Result error variant).
        return Err(crate::error_from_msg(format!("todoist sync HTTP {status}: {text}")));
    }
    Ok(resp.json::<SyncResponse>().await?)
}
```
Note: `crate::error_from_msg` is a stand-in — open `nimble-core/src/api/todoist.rs::complete_todoist_task` and use the exact same non-2xx error construction it uses (the crate's `thiserror` enum has an existing variant for API-message errors; do not add a new mechanism).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p nimble-core client`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: todoist /sync client with typed response structs"
```

---

### Task 8: Snapshots, mappers, merge (the data-safety core)

Pure functions: `TaskSnapshot` (the stored merge base / echo filter), item↔snapshot mapping, command-arg builders honoring the recurring-due rule, timestamp normalization, and the three-way field-level merge. This is the spec's mandated test surface — be thorough here.

**Files:**
- Create: `nimble-core/src/integrations/todoist/mappers.rs`
- Create: `nimble-core/src/integrations/todoist/merge.rs`
- Modify: `todoist/mod.rs` (`pub mod mappers; pub mod merge;`)
- Test: inline in both

**Interfaces:**
- Consumes: `client::{TodoistItem, TodoistDue}`, `crate::types::LocalTask`
- Produces:
```rust
// mappers.rs
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct TaskSnapshot {
    pub content: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub due_date: Option<String>,          // YYYY-MM-DD
    #[serde(default)] pub due: Option<serde_json::Value>,    // full remote due object (recurrence lives here)
    #[serde(default)] pub priority: i64,
    #[serde(default)] pub project_external_id: Option<String>, // "section:{id}" for sections
    #[serde(default)] pub parent_external_id: Option<String>,
    #[serde(default)] pub checked: bool,
}
pub fn item_to_snapshot(item: &client::TodoistItem) -> TaskSnapshot;
pub fn local_to_snapshot(task: &LocalTask, project_external_id: Option<String>, parent_external_id: Option<String>, base: Option<&TaskSnapshot>) -> TaskSnapshot;
pub fn due_args(new_due_date: Option<&str>, base_due: Option<&serde_json::Value>) -> serde_json::Value;
pub fn local_ts_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>>;   // "YYYY-MM-DD HH:MM:SS" localtime
pub fn rfc3339_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>>;

// merge.rs
#[derive(Debug, Default, PartialEq)]
pub struct MergePlan {
    pub content: Option<String>,
    pub description: Option<String>,
    pub due_date: Option<Option<String>>,   // Some(None) = clear the due date
    pub priority: Option<i64>,
    pub project_external_id: Option<String>,
    pub completed: Option<bool>,
}
impl MergePlan { pub fn is_empty(&self) -> bool; }
pub fn merge_task(
    local: &TaskSnapshot, base: Option<&TaskSnapshot>, remote: &TaskSnapshot,
    local_updated_utc: Option<chrono::DateTime<chrono::Utc>>,
    remote_updated_utc: Option<chrono::DateTime<chrono::Utc>>,
) -> MergePlan;
```

- [ ] **Step 1: Write the failing tests**

`mappers.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(due: Option<crate::integrations::todoist::client::TodoistDue>) -> crate::integrations::todoist::client::TodoistItem {
        serde_json::from_value(json!({
            "id": "R1", "content": "c", "description": "d",
            "project_id": "P1", "section_id": null, "parent_id": null,
            "priority": 3, "checked": false, "is_deleted": false,
            "updated_at": "2026-08-04T10:00:00Z",
            "due": due.map(|d| json!({"date": d.date, "string": d.string, "is_recurring": d.is_recurring}))
        }))
        .unwrap()
    }

    #[test]
    fn section_becomes_pseudo_project_external_id() {
        let mut it = item(None);
        it.section_id = Some("S9".into());
        let snap = item_to_snapshot(&it);
        assert_eq!(snap.project_external_id.as_deref(), Some("section:S9"));
    }

    #[test]
    fn plain_project_when_no_section() {
        let snap = item_to_snapshot(&item(None));
        assert_eq!(snap.project_external_id.as_deref(), Some("P1"));
        assert_eq!(snap.priority, 3);
        assert_eq!(snap.due_date, None);
    }

    #[test]
    fn recurring_reschedule_preserves_due_string() {
        let base_due = json!({"date": "2026-08-04", "string": "every day", "is_recurring": true});
        let args = due_args(Some("2026-08-10"), Some(&base_due));
        assert_eq!(args["due"]["string"], "every day");
        assert_eq!(args["due"]["date"], "2026-08-10");
    }

    #[test]
    fn non_recurring_reschedule_sends_plain_date() {
        let base_due = json!({"date": "2026-08-04", "string": "Aug 4", "is_recurring": false});
        let args = due_args(Some("2026-08-10"), Some(&base_due));
        assert_eq!(args["due"]["date"], "2026-08-10");
        assert!(args["due"].get("string").is_none());
    }

    #[test]
    fn clearing_due_sends_null() {
        let args = due_args(None, None);
        assert!(args["due"].is_null());
    }

    #[test]
    fn timestamp_parsers() {
        assert!(local_ts_to_utc("2026-08-04 10:30:00").is_some());
        assert!(local_ts_to_utc("garbage").is_none());
        assert!(rfc3339_to_utc("2026-08-04T10:00:00.000000Z").is_some());
    }
}
```

`merge.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::todoist::mappers::TaskSnapshot;

    fn snap(content: &str, due: Option<&str>, priority: i64) -> TaskSnapshot {
        TaskSnapshot {
            content: content.into(),
            due_date: due.map(String::from),
            priority,
            ..Default::default()
        }
    }

    #[test]
    fn echo_produces_empty_plan() {
        let base = snap("a", Some("2026-08-05"), 1);
        let plan = merge_task(&base.clone(), Some(&base), &base.clone(), None, None);
        assert!(plan.is_empty());
    }

    #[test]
    fn remote_only_change_applies_remotely_changed_field_only() {
        let base = snap("a", Some("2026-08-05"), 1);
        let local = base.clone();
        let remote = snap("b", Some("2026-08-05"), 1);
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("b"));
        assert_eq!(plan.due_date, None);
        assert_eq!(plan.priority, None);
    }

    #[test]
    fn independent_field_changes_merge_without_clobbering() {
        // local rescheduled, remote renamed — both survive
        let base = snap("a", Some("2026-08-05"), 1);
        let local = snap("a", Some("2026-08-09"), 1);
        let remote = snap("b", Some("2026-08-05"), 1);
        let plan = merge_task(&local, Some(&base), &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("b")); // remote rename applied
        assert_eq!(plan.due_date, None);                // local reschedule kept (outbox will push it)
    }

    #[test]
    fn same_field_conflict_uses_lww_remote_newer() {
        let base = snap("a", None, 1);
        let local = snap("local-edit", None, 1);
        let remote = snap("remote-edit", None, 1);
        let older = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T09:00:00Z");
        let newer = crate::integrations::todoist::mappers::rfc3339_to_utc("2026-08-04T11:00:00Z");
        let plan = merge_task(&local, Some(&base), &remote, older, newer);
        assert_eq!(plan.content.as_deref(), Some("remote-edit"));
        let plan2 = merge_task(&local, Some(&base), &remote, newer, older);
        assert_eq!(plan2.content, None); // local newer → local wins, keep local
    }

    #[test]
    fn no_base_means_remote_is_authoritative() {
        let local = snap("local", None, 1);
        let remote = snap("remote", Some("2026-08-06"), 3);
        let plan = merge_task(&local, None, &remote, None, None);
        assert_eq!(plan.content.as_deref(), Some("remote"));
        assert_eq!(plan.due_date, Some(Some("2026-08-06".into())));
        assert_eq!(plan.priority, Some(3));
    }

    #[test]
    fn remote_completion_applies() {
        let base = snap("a", None, 1);
        let mut remote = base.clone();
        remote.checked = true;
        let plan = merge_task(&base.clone(), Some(&base), &remote, None, None);
        assert_eq!(plan.completed, Some(true));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p nimble-core mappers merge`
Expected: COMPILE ERROR — types/fns not defined.

- [ ] **Step 3: Implement `mappers.rs`**

```rust
use crate::integrations::todoist::client::TodoistItem;
use crate::types::LocalTask;
use chrono::TimeZone;

// (TaskSnapshot struct exactly as in Interfaces above)

pub fn item_to_snapshot(item: &TodoistItem) -> TaskSnapshot {
    TaskSnapshot {
        content: item.content.clone(),
        description: item.description.clone().unwrap_or_default(),
        due_date: item.due.as_ref().and_then(|d| d.date.as_ref()).map(|d| d.chars().take(10).collect()),
        due: item.due.as_ref().map(|d| {
            serde_json::json!({"date": d.date, "string": d.string, "is_recurring": d.is_recurring})
        }),
        priority: item.priority.unwrap_or(1),
        project_external_id: item
            .section_id
            .as_ref()
            .map(|s| format!("section:{s}"))
            .or_else(|| item.project_id.clone()),
        parent_external_id: item.parent_id.clone(),
        checked: item.checked.unwrap_or(false),
    }
}

/// Project the local task into snapshot space so merge compares like with like.
/// `base` supplies the remote due object (local rows can't produce recurrence info).
pub fn local_to_snapshot(
    task: &LocalTask,
    project_external_id: Option<String>,
    parent_external_id: Option<String>,
    base: Option<&TaskSnapshot>,
) -> TaskSnapshot {
    TaskSnapshot {
        content: task.content.clone(),
        description: task.description.clone().unwrap_or_default(),
        due_date: task.due_date.clone(),
        due: base.and_then(|b| b.due.clone()),
        priority: task.priority,
        project_external_id,
        parent_external_id,
        checked: task.completed,
    }
}

pub fn due_args(new_due_date: Option<&str>, base_due: Option<&serde_json::Value>) -> serde_json::Value {
    match (new_due_date, base_due) {
        (None, _) => serde_json::json!({ "due": serde_json::Value::Null }),
        (Some(d), Some(base))
            if base.get("is_recurring").and_then(|v| v.as_bool()).unwrap_or(false) =>
        {
            let string = base.get("string").and_then(|v| v.as_str()).unwrap_or_default();
            serde_json::json!({ "due": { "string": string, "date": d } })
        }
        (Some(d), _) => serde_json::json!({ "due": { "date": d } }),
    }
}

pub fn local_ts_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()?;
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

pub fn rfc3339_to_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}
```

- [ ] **Step 4: Implement `merge.rs`**

```rust
use crate::integrations::todoist::mappers::TaskSnapshot;
use chrono::{DateTime, Utc};

// (MergePlan struct exactly as in Interfaces above)

impl MergePlan {
    pub fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.description.is_none()
            && self.due_date.is_none()
            && self.priority.is_none()
            && self.project_external_id.is_none()
            && self.completed.is_none()
    }
}

/// Three-way per-field merge.
/// - field unchanged remotely → keep local (None in plan)
/// - field changed remotely only → apply remote
/// - field changed on both sides → last-write-wins by timestamp (ties → remote,
///   since Todoist was the visible copy)
/// - no base (first contact) → remote is authoritative for every field
pub fn merge_task(
    local: &TaskSnapshot,
    base: Option<&TaskSnapshot>,
    remote: &TaskSnapshot,
    local_updated_utc: Option<DateTime<Utc>>,
    remote_updated_utc: Option<DateTime<Utc>>,
) -> MergePlan {
    let remote_wins_conflicts = match (local_updated_utc, remote_updated_utc) {
        (Some(l), Some(r)) => r >= l,
        _ => true,
    };

    fn pick<T: PartialEq + Clone>(
        local: &T,
        base: Option<&T>,
        remote: &T,
        remote_wins_conflicts: bool,
    ) -> Option<T> {
        match base {
            None => (local != remote).then(|| remote.clone()),
            Some(b) => {
                let remote_changed = b != remote;
                let local_changed = b != local;
                match (local_changed, remote_changed) {
                    (_, false) => None,
                    (false, true) => Some(remote.clone()),
                    (true, true) => remote_wins_conflicts.then(|| remote.clone()),
                }
            }
        }
    }

    MergePlan {
        content: pick(&local.content, base.map(|b| &b.content), &remote.content, remote_wins_conflicts),
        description: pick(&local.description, base.map(|b| &b.description), &remote.description, remote_wins_conflicts),
        due_date: pick(&local.due_date, base.map(|b| &b.due_date), &remote.due_date, remote_wins_conflicts),
        priority: pick(&local.priority, base.map(|b| &b.priority), &remote.priority, remote_wins_conflicts),
        project_external_id: pick(
            &local.project_external_id,
            base.map(|b| &b.project_external_id),
            &remote.project_external_id,
            remote_wins_conflicts,
        )
        .flatten(),
        completed: pick(&local.checked, base.map(|b| &b.checked), &remote.checked, remote_wins_conflicts),
    }
}
```
Note the `due_date` plan field is `Option<Option<String>>` — `pick` on an `Option<String>` field yields exactly that (outer = "apply?", inner = new value or clear). `project_external_id`'s `.flatten()` collapses "apply None" to "don't move" — a remote project-clear never happens in practice (every Todoist item has a project).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p nimble-core mappers merge`
Expected: all 13 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: todoist snapshots, command mappers, three-way field merge with tests"
```

---

### Task 9: Mutation observer — local edits and Turso-pulled edits enqueue outbox ops

Hooks every task/project mutation path so the mirror is symmetric: direct edits, status changes, deletes, AND rows arriving via Turso pull (phone-originated). The Todoist sync loop's own applies bypass CRUD (direct SQL) so they never echo.

**Files:**
- Create: `nimble-core/src/integrations/todoist/observer.rs`
- Modify: `todoist/mod.rs` (`pub mod observer;`)
- Modify: `nimble-core/src/db/tasks.rs` (4 hook calls)
- Modify: `nimble-core/src/db/projects.rs` (3 hook calls)
- Modify: `nimble-core/src/db/sync.rs` (Turso-pull hook)
- Test: inline in `observer.rs`

**Interfaces:**
- Consumes: `outbox::enqueue`, `adapter_token_if_active`, `pending_create_temp_id`
- Produces:
```rust
pub enum TaskMutation<'a> {
    Created(&'a LocalTask),
    Updated { task: &'a LocalTask, fields_changed: &'a [String] },
    StatusChanged { task: &'a LocalTask, was_completed: bool },
    Deleted { task: &'a LocalTask },
}
/// Best-effort: logs and swallows errors, never fails the caller.
pub async fn on_task_mutation(pool: &SqlitePool, m: TaskMutation<'_>);
pub enum ProjectMutation<'a> {
    Created(&'a Project),
    Renamed(&'a Project),
    Deleted { project: &'a Project },
}
pub async fn on_project_mutation(pool: &SqlitePool, m: ProjectMutation<'_>);
/// Turso-pull hook: full-row upsert semantics (no field diff available).
pub async fn on_turso_row_applied(pool: &SqlitePool, table: &str, row_id: &str, pre_delete_external_id: Option<String>, deleted: bool);
/// Enable-time backfill: create ops for every open unlinked task + unlinked project.
pub async fn seed_outbox_for_unlinked(pool: &SqlitePool) -> crate::Result<(usize, usize)>;
```
- Payload key convention (push builder in Task 10 consumes these): task payloads use `content`, `description`, `due_date`, `priority`, `project_local_id`, `parent_local_id`; move payloads use `project_local_id`; delete payloads use `external_id`; project payloads use `name`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::todoist::outbox;
    use crate::test_util::test_pool;

    async fn activate(pool: &sqlx::SqlitePool) {
        crate::integrations::ensure_state(pool, "todoist").await.unwrap();
        crate::db::settings::set_setting(pool, "todoist_api_token", "tok").await.unwrap();
    }

    #[tokio::test]
    async fn disabled_adapter_enqueues_nothing() {
        let pool = test_pool().await;
        let t = crate::db::tasks::create_local_task(&pool, "x", None, None, None, None, None).await.unwrap();
        on_task_mutation(&pool, TaskMutation::Created(&t)).await;
        assert!(outbox::pending_batch(&pool, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn create_enqueues_item_create_payload() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(&pool, "Call vet", None, None, None, Some(3), Some("2026-08-06")).await.unwrap();
        // create_local_task itself calls the observer (wired in step 4), so the op is already there
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].op, "create");
        assert_eq!(batch[0].payload["content"], "Call vet");
        assert_eq!(batch[0].payload["due_date"], "2026-08-06");
        assert_eq!(batch[0].payload["priority"], 3);
        assert_eq!(batch[0].local_id, t.id);
    }

    #[tokio::test]
    async fn completion_toggle_enqueues_close_then_reopen() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(&pool, "x", None, None, None, None, None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "complete", None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "todo", None).await.unwrap();
        let ops: Vec<String> = outbox::pending_batch(&pool, 10).await.unwrap().into_iter().map(|r| r.op).collect();
        assert_eq!(ops, vec!["create", "close", "reopen"]);
    }

    #[tokio::test]
    async fn local_only_status_change_enqueues_nothing_extra() {
        let pool = test_pool().await;
        activate(&pool).await;
        let t = crate::db::tasks::create_local_task(&pool, "x", None, None, None, None, None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "in_progress", None).await.unwrap();
        crate::db::tasks::update_task_status(&pool, &t.id, "blocked", Some("waiting")).await.unwrap();
        let ops: Vec<String> = outbox::pending_batch(&pool, 10).await.unwrap().into_iter().map(|r| r.op).collect();
        assert_eq!(ops, vec!["create"]); // only the creation op
    }

    #[tokio::test]
    async fn project_change_enqueues_move() {
        let pool = test_pool().await;
        activate(&pool).await;
        let p = crate::db::projects::create_project(&pool, "Errands", "#fff").await.unwrap();
        let t = crate::db::tasks::create_local_task(&pool, "x", None, None, None, None, None).await.unwrap();
        crate::db::tasks::update_local_task(&pool, &t.id, None, None, Some(&p.id), None, None, false, None).await.unwrap();
        let batch = outbox::pending_batch(&pool, 10).await.unwrap();
        // project create + task create + move
        let moves: Vec<_> = batch.iter().filter(|r| r.op == "move").collect();
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].payload["project_local_id"], p.id);
    }

    #[tokio::test]
    async fn seed_backfills_unlinked_open_tasks_once() {
        let pool = test_pool().await;
        // create BEFORE activation → no ops enqueued yet
        crate::db::tasks::create_local_task(&pool, "old task", None, None, None, None, None).await.unwrap();
        activate(&pool).await;
        let (tasks_seeded, _projects_seeded) = seed_outbox_for_unlinked(&pool).await.unwrap();
        assert_eq!(tasks_seeded, 1);
        // idempotent
        let (again, _) = seed_outbox_for_unlinked(&pool).await.unwrap();
        assert_eq!(again, 0);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p nimble-core observer`
Expected: COMPILE ERROR — module missing.

- [ ] **Step 3: Implement `observer.rs`**

```rust
use crate::integrations::todoist::outbox;
use crate::types::{LocalTask, Project};
use sqlx::SqlitePool;

pub enum TaskMutation<'a> {
    Created(&'a LocalTask),
    Updated { task: &'a LocalTask, fields_changed: &'a [String] },
    StatusChanged { task: &'a LocalTask, was_completed: bool },
    Deleted { task: &'a LocalTask },
}

pub enum ProjectMutation<'a> {
    Created(&'a Project),
    Renamed(&'a Project),
    Deleted { project: &'a Project },
}

fn task_create_payload(task: &LocalTask) -> serde_json::Value {
    serde_json::json!({
        "content": task.content,
        "description": task.description,
        "due_date": task.due_date,
        "priority": task.priority,
        "project_local_id": task.project_id,
        "parent_local_id": task.parent_id,
    })
}

async fn active(pool: &SqlitePool) -> bool {
    matches!(crate::integrations::adapter_token_if_active(pool).await, Ok(Some(_)))
}

pub async fn on_task_mutation(pool: &SqlitePool, m: TaskMutation<'_>) {
    if !active(pool).await {
        return;
    }
    let result = match m {
        TaskMutation::Created(task) => {
            // rows the Todoist pull itself creates carry external_id already — never re-create
            if task.external_id.is_some() {
                return;
            }
            outbox::enqueue(pool, "task", &task.id, "create", task_create_payload(task)).await
        }
        TaskMutation::Updated { task, fields_changed } => {
            let mut payload = serde_json::Map::new();
            for field in fields_changed {
                match field.as_str() {
                    "content" => { payload.insert("content".into(), task.content.clone().into()); }
                    "description" => { payload.insert("description".into(), task.description.clone().into()); }
                    "due_date" => { payload.insert("due_date".into(), task.due_date.clone().into()); }
                    "priority" => { payload.insert("priority".into(), task.priority.into()); }
                    _ => {}
                }
            }
            let mut r = Ok(());
            if !payload.is_empty() {
                r = outbox::enqueue(pool, "task", &task.id, "update", payload.into()).await;
            }
            if r.is_ok() && fields_changed.iter().any(|f| f == "project_id") {
                r = outbox::enqueue(pool, "task", &task.id, "move",
                    serde_json::json!({"project_local_id": task.project_id})).await;
            }
            r
        }
        TaskMutation::StatusChanged { task, was_completed } => {
            match (was_completed, task.completed) {
                (false, true) => outbox::enqueue(pool, "task", &task.id, "close", serde_json::json!({})).await,
                (true, false) => outbox::enqueue(pool, "task", &task.id, "reopen", serde_json::json!({})).await,
                _ => Ok(()), // in_progress/blocked etc. are local-only
            }
        }
        TaskMutation::Deleted { task } => {
            outbox::enqueue(pool, "task", &task.id, "delete",
                serde_json::json!({"external_id": task.external_id})).await
        }
    };
    if let Err(e) = result {
        log::warn!("todoist observer enqueue failed: {e}");
    }
}

pub async fn on_project_mutation(pool: &SqlitePool, m: ProjectMutation<'_>) {
    if !active(pool).await {
        return;
    }
    let result = match m {
        ProjectMutation::Created(p) => {
            if p.external_id.is_some() || p.id == "inbox" {
                return;
            }
            outbox::enqueue(pool, "project", &p.id, "create", serde_json::json!({"name": p.name})).await
        }
        ProjectMutation::Renamed(p) => {
            // section pseudo-projects and inbox are never renamed remotely from here
            if p.id == "inbox" || p.external_id.as_deref().is_some_and(|e| e.starts_with("section:")) {
                return;
            }
            outbox::enqueue(pool, "project", &p.id, "update", serde_json::json!({"name": p.name})).await
        }
        ProjectMutation::Deleted { project } => {
            if project.external_id.as_deref().is_some_and(|e| e.starts_with("section:")) {
                return;
            }
            outbox::enqueue(pool, "project", &project.id, "delete",
                serde_json::json!({"external_id": project.external_id})).await
        }
    };
    if let Err(e) = result {
        log::warn!("todoist observer enqueue failed: {e}");
    }
}

/// Called by db/sync.rs after applying a Turso-pulled row (phone-originated change).
/// No field diff is available, so linked rows get a full update; unlinked rows get a create.
pub async fn on_turso_row_applied(
    pool: &SqlitePool,
    table: &str,
    row_id: &str,
    pre_delete_external_id: Option<String>,
    deleted: bool,
) {
    if !active(pool).await {
        return;
    }
    if table == "local_tasks" {
        if deleted {
            let _ = outbox::enqueue(pool, "task", row_id, "delete",
                serde_json::json!({"external_id": pre_delete_external_id})).await;
            return;
        }
        let task: Option<LocalTask> = sqlx::query_as(
            &format!("SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS),
        )
        .bind(row_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        let Some(task) = task else { return };
        if task.external_id.is_none() {
            on_task_mutation(pool, TaskMutation::Created(&task)).await;
        } else {
            let fields: Vec<String> = ["content", "description", "due_date", "priority", "project_id"]
                .iter().map(|s| s.to_string()).collect();
            on_task_mutation(pool, TaskMutation::Updated { task: &task, fields_changed: &fields }).await;
            // completion state may have flipped on the phone; close/reopen is
            // resolved by the push builder comparing task.completed to the
            // stored snapshot's checked (Task 10), not enqueued blindly here.
        }
    }
}

pub async fn seed_outbox_for_unlinked(pool: &SqlitePool) -> crate::Result<(usize, usize)> {
    let mut tasks_seeded = 0usize;
    let mut projects_seeded = 0usize;
    let projects = crate::db::projects::get_projects(pool).await?;
    for p in projects {
        if p.external_id.is_none() && p.id != "inbox"
            && outbox::pending_create_temp_id(pool, &p.id).await?.is_none()
        {
            outbox::enqueue(pool, "project", &p.id, "create", serde_json::json!({"name": p.name})).await?;
            projects_seeded += 1;
        }
    }
    let tasks: Vec<LocalTask> = sqlx::query_as(
        &format!("SELECT {} FROM local_tasks WHERE completed = 0 AND external_id IS NULL", crate::db::tasks::SELECT_COLS),
    )
    .fetch_all(pool)
    .await?;
    for t in tasks {
        if outbox::pending_create_temp_id(pool, &t.id).await?.is_none() {
            outbox::enqueue(pool, "task", &t.id, "create", task_create_payload(&t)).await?;
            tasks_seeded += 1;
        }
    }
    Ok((tasks_seeded, projects_seeded))
}
```
(In `seed_outbox_for_unlinked`, use the real projects SELECT — reuse `crate::db::projects::get_projects(pool)` instead of raw SQL if it's public; the placeholder string above must not survive. Make `SELECT_COLS` `pub(crate)` in `tasks.rs` so the observer can reuse it.)

- [ ] **Step 4: Wire the hooks**

`db/tasks.rs` — at the end of each mutation fn, right after the existing `append_sync_log`/activity calls, add (note: these are non-blocking best-effort calls, matching the activity-log philosophy):
- `create_local_task`: `crate::integrations::todoist::observer::on_task_mutation(pool, observer::TaskMutation::Created(&task)).await;`
- `update_local_task`: capture the existing `fields_changed: Vec<String>` the function already tracks, then `… TaskMutation::Updated { task: &task, fields_changed: &fields_changed } …`
- `update_task_status`: read `completed` BEFORE the update into `was_completed: bool` (one extra `SELECT completed FROM local_tasks WHERE id = ?`), fetch the task after, then `… TaskMutation::StatusChanged { task: &task, was_completed } …`
- `delete_local_task`: fetch the full task BEFORE deleting (`SELECT {SELECT_COLS} … WHERE id = ?`), delete, then `… TaskMutation::Deleted { task: &task } …`

`db/projects.rs` — same pattern: `create_project` → `Created`, `update_project` (when name changed) → `Renamed` (fetch the project after update), `delete_project` → fetch before delete → `Deleted`.

`db/sync.rs` — in the pull-apply path (`apply_remote_change`, :679-740): for `local_tasks` rows, before applying a DELETE fetch `external_id` (`SELECT external_id FROM local_tasks WHERE id = ?`); after a successful apply call:
```rust
crate::integrations::todoist::observer::on_turso_row_applied(
    pool, table_name, row_id, pre_delete_external_id, operation == "DELETE",
).await;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p nimble-core`
Expected: all observer tests PASS, all prior tests still PASS (they run with the adapter inactive, so hooks are no-ops).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mutation observer enqueues todoist ops from local edits and turso-pulled changes"
```

---

### Task 10: Push engine — drain the outbox as batched commands

Builds `/sync` commands from outbox rows (resolving local ids to external ids or in-batch temp_ids), sends batches of ≤100, processes per-command results, and records `temp_id → external_id` mappings plus initial snapshots.

**Files:**
- Create: `nimble-core/src/integrations/todoist/sync_loop.rs` (push half)
- Modify: `todoist/mod.rs` (`pub mod sync_loop;`)
- Test: inline (command-building is tested pure; HTTP send is not unit-tested)

**Interfaces:**
- Consumes: `outbox::*`, `client::{sync, command_ok, SyncResponse}`, `mappers::due_args`, task/project lookups
- Produces:
```rust
pub struct PushCtx { /* internal: local_id → temp_id map, project external lookups, task rows */ }
pub fn build_commands(rows: &[outbox::OutboxRow], ctx: &PushCtx) -> (Vec<serde_json::Value>, Vec<(String, String)>);
    // returns (commands, unbuildable: [(outbox_row_id, reason)])
pub async fn load_push_ctx(pool: &SqlitePool, rows: &[outbox::OutboxRow]) -> crate::Result<PushCtx>;
pub async fn push_outbox(pool: &SqlitePool, token: &str) -> crate::Result<usize>; // ops confirmed done
```
- Command JSON shape (Todoist Sync API): `{"type": "item_add", "uuid": "<command_uuid>", "temp_id": "<temp_id>", "args": {…}}`; types used: `item_add`, `item_update`, `item_close`, `item_uncomplete`, `item_delete`, `item_move`, `project_add`, `project_update`, `project_delete`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod push_tests {
    use super::*;
    use crate::integrations::todoist::outbox::{self, OutboxRow};
    use serde_json::json;

    fn row(op: &str, local_id: &str, payload: serde_json::Value, temp_id: Option<&str>) -> OutboxRow {
        OutboxRow {
            id: format!("ob-{op}-{local_id}"),
            local_id: local_id.into(),
            object_type: if op.starts_with("project") { "project".into() } else { "task".into() },
            op: op.into(),
            payload,
            command_uuid: format!("uuid-{op}-{local_id}"),
            temp_id: temp_id.map(String::from),
        }
    }

    fn ctx_with(task_external: &[(&str, Option<&str>)], project_external: &[(&str, &str)]) -> PushCtx {
        PushCtx::for_tests(
            task_external.iter().map(|(l, e)| ((*l).into(), e.map(String::from))).collect(),
            project_external.iter().map(|(l, e)| ((*l).into(), (*e).into())).collect(),
        )
    }

    #[test]
    fn create_becomes_item_add_with_temp_id() {
        let rows = vec![row("create", "t1",
            json!({"content": "c", "priority": 2, "project_local_id": "p1", "due_date": null, "description": null, "parent_local_id": null}),
            Some("tmp-t1"))];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[0]["type"], "item_add");
        assert_eq!(cmds[0]["temp_id"], "tmp-t1");
        assert_eq!(cmds[0]["uuid"], "uuid-create-t1");
        assert_eq!(cmds[0]["args"]["content"], "c");
        assert_eq!(cmds[0]["args"]["project_id"], "EXT-P1");
    }

    #[test]
    fn ops_on_unsynced_task_reference_in_batch_temp_id() {
        let rows = vec![
            row("create", "t1", json!({"content": "c", "project_local_id": "p1"}), Some("tmp-t1")),
            row("close", "t1", json!({}), None),
        ];
        let ctx = ctx_with(&[("t1", None)], &[("p1", "EXT-P1")]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(bad.is_empty());
        assert_eq!(cmds[1]["type"], "item_close");
        assert_eq!(cmds[1]["args"]["id"], "tmp-t1");
    }

    #[test]
    fn move_to_section_pseudo_project_uses_section_id() {
        let rows = vec![row("move", "t1", json!({"project_local_id": "p2"}), None)];
        let ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[("p2", "section:S77")]);
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["type"], "item_move");
        assert_eq!(cmds[0]["args"]["id"], "EXT-T1");
        assert_eq!(cmds[0]["args"]["section_id"], "S77");
        assert!(cmds[0]["args"].get("project_id").is_none());
    }

    #[test]
    fn delete_without_external_id_is_unbuildable_not_a_command() {
        let rows = vec![row("delete", "t9", json!({"external_id": null}), None)];
        let ctx = ctx_with(&[], &[]);
        let (cmds, bad) = build_commands(&rows, &ctx);
        assert!(cmds.is_empty());
        assert_eq!(bad.len(), 1);
    }

    #[test]
    fn update_with_due_date_uses_due_args_against_snapshot() {
        // ctx carries the task's stored snapshot due (recurring) — reschedule must preserve the string
        let rows = vec![row("update", "t1", json!({"due_date": "2026-08-10"}), None)];
        let mut ctx = ctx_with(&[("t1", Some("EXT-T1"))], &[]);
        ctx.set_base_due_for_tests("t1", json!({"date": "2026-08-04", "string": "every day", "is_recurring": true}));
        let (cmds, _) = build_commands(&rows, &ctx);
        assert_eq!(cmds[0]["type"], "item_update");
        assert_eq!(cmds[0]["args"]["due"]["string"], "every day");
        assert_eq!(cmds[0]["args"]["due"]["date"], "2026-08-10");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p nimble-core push_tests`
Expected: COMPILE ERROR.

- [ ] **Step 3: Implement the push half of `sync_loop.rs`**

```rust
use crate::integrations::todoist::{client, mappers, outbox};
use sqlx::SqlitePool;
use std::collections::HashMap;

pub struct PushCtx {
    /// local task id → external_id (None = exists locally, unsynced)
    task_external: HashMap<String, Option<String>>,
    /// local project id → external_id ("section:{id}" possible)
    project_external: HashMap<String, String>,
    /// local task id → stored snapshot due object
    base_due: HashMap<String, serde_json::Value>,
    /// local id → temp_id of an in-batch pending create
    temp_ids: HashMap<String, String>,
}

impl PushCtx {
    #[cfg(test)]
    pub fn for_tests(
        task_external: HashMap<String, Option<String>>,
        project_external: HashMap<String, String>,
    ) -> Self {
        Self { task_external, project_external, base_due: HashMap::new(), temp_ids: HashMap::new() }
    }
    #[cfg(test)]
    pub fn set_base_due_for_tests(&mut self, local_id: &str, due: serde_json::Value) {
        self.base_due.insert(local_id.into(), due);
    }

    fn resolve_task_id(&self, local_id: &str) -> Option<String> {
        self.task_external.get(local_id).cloned().flatten()
            .or_else(|| self.temp_ids.get(local_id).cloned())
    }
    fn resolve_project_ref(&self, local_id: &str) -> Option<String> {
        self.project_external.get(local_id).cloned()
            .or_else(|| self.temp_ids.get(local_id).cloned())
    }
}

pub async fn load_push_ctx(pool: &SqlitePool, rows: &[outbox::OutboxRow]) -> crate::Result<PushCtx> {
    let mut ctx = PushCtx {
        task_external: HashMap::new(),
        project_external: HashMap::new(),
        base_due: HashMap::new(),
        temp_ids: HashMap::new(),
    };
    for row in rows {
        if let Some(t) = &row.temp_id {
            ctx.temp_ids.insert(row.local_id.clone(), t.clone());
        }
    }
    // load referenced tasks (their external_id + snapshot due)
    for row in rows.iter().filter(|r| r.object_type == "task") {
        let rec: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT external_id, synced_snapshot FROM local_tasks WHERE id = ?",
        )
        .bind(&row.local_id)
        .fetch_optional(pool)
        .await?;
        if let Some((ext, snap)) = rec {
            if let Some(due) = snap
                .and_then(|s| serde_json::from_str::<mappers::TaskSnapshot>(&s).ok())
                .and_then(|s| s.due)
            {
                ctx.base_due.insert(row.local_id.clone(), due);
            }
            ctx.task_external.insert(row.local_id.clone(), ext);
        }
        // referenced target projects for create/move payloads
        for key in ["project_local_id", "parent_local_id"] {
            if let Some(pid) = row.payload.get(key).and_then(|v| v.as_str()) {
                if !ctx.project_external.contains_key(pid) {
                    let ext: Option<(Option<String>,)> =
                        sqlx::query_as("SELECT external_id FROM projects WHERE id = ?")
                            .bind(pid)
                            .fetch_optional(pool)
                            .await?;
                    if let Some((Some(e),)) = ext {
                        ctx.project_external.insert(pid.to_string(), e);
                    }
                }
                if key == "parent_local_id" {
                    // parent is a task, not a project — record its external id too
                    let ext: Option<(Option<String>,)> =
                        sqlx::query_as("SELECT external_id FROM local_tasks WHERE id = ?")
                            .bind(pid)
                            .fetch_optional(pool)
                            .await?;
                    if let Some((e,)) = ext {
                        ctx.task_external.entry(pid.to_string()).or_insert(e);
                    }
                }
            }
        }
    }
    Ok(ctx)
}

fn project_ref_args(external: &str) -> (String, serde_json::Value) {
    match external.strip_prefix("section:") {
        Some(section) => ("section_id".into(), section.into()),
        None => ("project_id".into(), external.into()),
    }
}

pub fn build_commands(
    rows: &[outbox::OutboxRow],
    ctx: &PushCtx,
) -> (Vec<serde_json::Value>, Vec<(String, String)>) {
    let mut cmds = Vec::new();
    let mut unbuildable = Vec::new();
    for row in rows {
        let cmd = match (row.object_type.as_str(), row.op.as_str()) {
            ("task", "create") => {
                let mut args = serde_json::Map::new();
                args.insert("content".into(), row.payload["content"].clone());
                if let Some(d) = row.payload.get("description").filter(|v| !v.is_null()) {
                    args.insert("description".into(), d.clone());
                }
                if let Some(p) = row.payload.get("priority").filter(|v| !v.is_null()) {
                    args.insert("priority".into(), p.clone());
                }
                if let Some(d) = row.payload.get("due_date").and_then(|v| v.as_str()) {
                    args.insert("due".into(), serde_json::json!({"date": d}));
                }
                if let Some(p) = row.payload.get("project_local_id").and_then(|v| v.as_str()) {
                    if let Some(ext) = ctx.resolve_project_ref(p) {
                        let (k, v) = project_ref_args(&ext);
                        args.insert(k, v);
                    } // unresolvable project → task lands in Todoist inbox; fine
                }
                if let Some(par) = row.payload.get("parent_local_id").and_then(|v| v.as_str()) {
                    if let Some(ext) = ctx.resolve_task_id(par) {
                        args.insert("parent_id".into(), ext.into());
                    }
                }
                Some(serde_json::json!({
                    "type": "item_add", "uuid": row.command_uuid,
                    "temp_id": row.temp_id, "args": args,
                }))
            }
            ("task", "update") => match ctx.resolve_task_id(&row.local_id) {
                None => { unbuildable.push((row.id.clone(), "no remote id for update".into())); None }
                Some(id) => {
                    let mut args = serde_json::Map::new();
                    args.insert("id".into(), id.into());
                    for key in ["content", "description", "priority"] {
                        if let Some(v) = row.payload.get(key) {
                            args.insert(key.into(), v.clone());
                        }
                    }
                    if row.payload.get("due_date").is_some() {
                        let due = mappers::due_args(
                            row.payload["due_date"].as_str(),
                            ctx.base_due.get(&row.local_id),
                        );
                        args.insert("due".into(), due["due"].clone());
                    }
                    Some(serde_json::json!({"type": "item_update", "uuid": row.command_uuid, "args": args}))
                }
            },
            ("task", "close") | ("task", "reopen") => match ctx.resolve_task_id(&row.local_id) {
                None => { unbuildable.push((row.id.clone(), "no remote id".into())); None }
                Some(id) => {
                    let cmd_type = if row.op == "close" { "item_close" } else { "item_uncomplete" };
                    Some(serde_json::json!({"type": cmd_type, "uuid": row.command_uuid, "args": {"id": id}}))
                }
            },
            ("task", "move") => match (
                ctx.resolve_task_id(&row.local_id),
                row.payload.get("project_local_id").and_then(|v| v.as_str()).and_then(|p| ctx.resolve_project_ref(p)),
            ) {
                (Some(id), Some(ext)) => {
                    let (k, v) = project_ref_args(&ext);
                    let mut args = serde_json::Map::new();
                    args.insert("id".into(), id.into());
                    args.insert(k, v);
                    Some(serde_json::json!({"type": "item_move", "uuid": row.command_uuid, "args": args}))
                }
                _ => { unbuildable.push((row.id.clone(), "unresolvable move".into())); None }
            },
            ("task", "delete") => match row.payload.get("external_id").and_then(|v| v.as_str()) {
                None => { unbuildable.push((row.id.clone(), "delete of never-synced row".into())); None }
                Some(ext) => Some(serde_json::json!({"type": "item_delete", "uuid": row.command_uuid, "args": {"id": ext}})),
            },
            ("project", "create") => Some(serde_json::json!({
                "type": "project_add", "uuid": row.command_uuid, "temp_id": row.temp_id,
                "args": {"name": row.payload["name"]},
            })),
            ("project", "update") => match ctx.resolve_project_ref(&row.local_id) {
                None => { unbuildable.push((row.id.clone(), "no remote id for project".into())); None }
                Some(ext) => Some(serde_json::json!({"type": "project_update", "uuid": row.command_uuid, "args": {"id": ext, "name": row.payload["name"]}})),
            },
            ("project", "delete") => match row.payload.get("external_id").and_then(|v| v.as_str()) {
                None => { unbuildable.push((row.id.clone(), "delete of never-synced project".into())); None }
                Some(ext) => Some(serde_json::json!({"type": "project_delete", "uuid": row.command_uuid, "args": {"id": ext}})),
            },
            _ => { unbuildable.push((row.id.clone(), format!("unknown op {}/{}", row.object_type, row.op))); None }
        };
        if let Some(c) = cmd {
            cmds.push(c);
        }
    }
    (cmds, unbuildable)
}

pub async fn push_outbox(pool: &SqlitePool, token: &str) -> crate::Result<usize> {
    let mut confirmed = 0usize;
    loop {
        let rows = outbox::pending_batch(pool, 100).await?;
        if rows.is_empty() {
            break;
        }
        let ctx = load_push_ctx(pool, &rows).await?;
        let (cmds, unbuildable) = build_commands(&rows, &ctx);
        for (row_id, reason) in &unbuildable {
            // never-synced deletes are a success (nothing to do remotely), not an error
            if reason.contains("never-synced") {
                outbox::mark_done(pool, &[row_id.clone()]).await?;
            } else {
                outbox::mark_error(pool, row_id, reason).await?;
            }
        }
        if cmds.is_empty() {
            continue;
        }
        let resp = client::sync(token, &serde_json::json!({"commands": cmds})).await?;
        for row in &rows {
            let Some(status) = resp.sync_status.get(&row.command_uuid) else { continue };
            if client::command_ok(status) {
                if row.op == "create" {
                    if let Some(temp) = &row.temp_id {
                        if let Some(real_id) = resp.temp_id_mapping.get(temp) {
                            let table = if row.object_type == "project" { "projects" } else { "local_tasks" };
                            sqlx::query(&format!(
                                "UPDATE {table} SET external_id = ?, external_source = 'todoist' WHERE id = ?"
                            ))
                            .bind(real_id)
                            .bind(&row.local_id)
                            .execute(pool)
                            .await?;
                        }
                    }
                }
                outbox::mark_done(pool, &[row.id.clone()]).await?;
                confirmed += 1;
            } else {
                outbox::mark_error(pool, &row.id, &status.to_string()).await?;
            }
        }
    }
    Ok(confirmed)
}
```
Note on snapshots after push: the pull that follows (Task 11) receives the pushed state as item deltas and stores the authoritative `synced_snapshot` — push doesn't have to construct one.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p nimble-core push_tests`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: todoist push engine - outbox to batched sync commands with temp_id resolution"
```

---

### Task 11: Pull engine + `run_sync` orchestration

Incremental pull with the stored `sync_token`, transactional apply (projects → sections → items two-pass), snapshot-based echo skip, merge application, and token persisted in the same transaction. `run_sync` serializes everything behind a `try_lock`.

**Files:**
- Modify: `nimble-core/src/integrations/todoist/sync_loop.rs` (pull half + orchestrator)
- Test: inline — `apply_pull` is tested against hand-built `SyncResponse` values (no HTTP mocking)

**Interfaces:**
- Consumes: everything from Tasks 6–10; `sync::append_sync_log`
- Produces:
```rust
#[derive(Debug, Default, serde::Serialize)]
pub struct SyncReport {
    pub skipped: Option<String>,       // "disabled" | "already running"
    pub pushed: usize,
    pub created: usize,                // native tasks created from pull
    pub updated: usize,
    pub deleted: usize,
    pub projects_upserted: usize,
}
impl SyncReport { pub fn changed_anything(&self) -> bool; }
pub async fn apply_pull(pool: &SqlitePool, resp: &client::SyncResponse) -> crate::Result<SyncReport>;
pub async fn run_sync(pool: &SqlitePool) -> crate::Result<SyncReport>;
pub async fn run_sync_if_due(pool: &SqlitePool, min_interval_secs: i64) -> crate::Result<SyncReport>;
```

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod pull_tests {
    use super::*;
    use crate::integrations::todoist::client::SyncResponse;
    use crate::test_util::test_pool;
    use serde_json::json;

    fn resp(v: serde_json::Value) -> SyncResponse {
        serde_json::from_value(v).unwrap()
    }

    #[tokio::test]
    async fn new_remote_item_creates_native_task() {
        let pool = test_pool().await;
        let r = resp(json!({
            "sync_token": "T1",
            "projects": [{"id": "P1", "name": "Errands"}],
            "items": [{
                "id": "R1", "content": "Buy milk", "description": "2%",
                "project_id": "P1", "priority": 2, "checked": false, "is_deleted": false,
                "updated_at": "2026-08-04T10:00:00Z",
                "due": {"date": "2026-08-06", "string": "Aug 6", "is_recurring": false}
            }]
        }));
        let report = apply_pull(&pool, &r).await.unwrap();
        assert_eq!(report.created, 1);
        assert_eq!(report.projects_upserted, 1);

        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert_eq!(t.content, "Buy milk");
        assert_eq!(t.due_date.as_deref(), Some("2026-08-06"));
        assert!(t.synced_snapshot.is_some());

        // project created + linked
        let projects = crate::db::projects::get_projects(&pool).await.unwrap();
        let p = projects.iter().find(|p| p.external_id.as_deref() == Some("P1")).unwrap();
        assert_eq!(t.project_id, p.id);

        // token persisted
        let state = crate::integrations::get_state(&pool, "todoist").await.unwrap().unwrap();
        assert_eq!(state.sync_token.as_deref(), Some("T1"));
    }

    #[tokio::test]
    async fn echo_of_stored_snapshot_is_skipped() {
        let pool = test_pool().await;
        let item = json!({"id": "R1", "content": "same", "priority": 1, "checked": false, "is_deleted": false});
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [item.clone()]}))).await.unwrap();
        let second = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [item]}))).await.unwrap();
        assert_eq!(second.created, 0);
        assert_eq!(second.updated, 0);
    }

    #[tokio::test]
    async fn remote_deletion_removes_local_row() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let report = apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": true}
        ]}))).await.unwrap();
        assert_eq!(report.deleted, 1);
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        assert!(!tasks.iter().any(|t| t.external_id.as_deref() == Some("R1")));
    }

    #[tokio::test]
    async fn remote_completion_completes_local_task() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "R1", "content": "x", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        apply_pull(&pool, &resp(json!({"sync_token": "T2", "items": [
            {"id": "R1", "content": "x", "checked": true, "is_deleted": false,
             "updated_at": "2026-08-04T12:00:00Z"}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, true).await.unwrap();
        let t = tasks.iter().find(|t| t.external_id.as_deref() == Some("R1")).unwrap();
        assert!(t.completed);
        assert_eq!(t.status, "complete");
    }

    #[tokio::test]
    async fn subtask_parent_resolved_in_second_pass() {
        let pool = test_pool().await;
        // child arrives BEFORE parent in the same delta
        apply_pull(&pool, &resp(json!({"sync_token": "T1", "items": [
            {"id": "C1", "content": "child", "parent_id": "PA1", "checked": false, "is_deleted": false},
            {"id": "PA1", "content": "parent", "checked": false, "is_deleted": false}
        ]}))).await.unwrap();
        let tasks = crate::db::tasks::get_local_tasks(&pool, None, None, false).await.unwrap();
        let parent = tasks.iter().find(|t| t.external_id.as_deref() == Some("PA1")).unwrap();
        let child = tasks.iter().find(|t| t.external_id.as_deref() == Some("C1")).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
    }

    #[tokio::test]
    async fn section_delta_creates_pseudo_project() {
        let pool = test_pool().await;
        apply_pull(&pool, &resp(json!({
            "sync_token": "T1",
            "projects": [{"id": "P1", "name": "Work"}],
            "sections": [{"id": "S1", "project_id": "P1", "name": "Soon"}]
        }))).await.unwrap();
        let projects = crate::db::projects::get_projects(&pool).await.unwrap();
        let pseudo = projects.iter().find(|p| p.external_id.as_deref() == Some("section:S1")).unwrap();
        assert_eq!(pseudo.name, "Work / Soon");
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p nimble-core pull_tests`
Expected: COMPILE ERROR — `apply_pull` not defined.

- [ ] **Step 3: Implement the pull half**

```rust
use std::sync::OnceLock;

static SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

impl SyncReport {
    pub fn changed_anything(&self) -> bool {
        self.created + self.updated + self.deleted + self.projects_upserted > 0
    }
}

async fn find_task_by_external(
    ex: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    external_id: &str,
) -> Result<Option<crate::types::LocalTask>, sqlx::Error> {
    sqlx::query_as(&format!(
        "SELECT {} FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?",
        crate::db::tasks::SELECT_COLS
    ))
    .bind(external_id)
    .fetch_optional(ex)
    .await
}

pub async fn apply_pull(pool: &SqlitePool, resp: &client::SyncResponse) -> crate::Result<SyncReport> {
    let mut report = SyncReport::default();
    let mut tx = pool.begin().await?;
    // (local_task_id, snapshot) pairs to sync_log AFTER commit
    let mut logged: Vec<(String, &'static str)> = Vec::new();

    // 1. projects
    for p in &resp.projects {
        if p.is_deleted.unwrap_or(false) || p.is_archived.unwrap_or(false) {
            continue; // keep local project; tasks were reassigned/removed via item deltas
        }
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&p.id)
        .fetch_optional(&mut *tx)
        .await?;
        match existing {
            Some((local_id,)) => {
                sqlx::query("UPDATE projects SET name = ? WHERE id = ? AND name != ?")
                    .bind(&p.name).bind(&local_id).bind(&p.name)
                    .execute(&mut *tx).await?;
            }
            None if p.inbox_project.unwrap_or(false) => {
                sqlx::query("UPDATE projects SET external_id = ?, external_source = 'todoist' WHERE id = 'inbox'")
                    .bind(&p.id).execute(&mut *tx).await?;
            }
            None => {
                let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM projects")
                    .fetch_one(&mut *tx).await?;
                sqlx::query("INSERT INTO projects (id, name, color, position, external_id, external_source) VALUES (?, ?, '#8b8b8b', ?, ?, 'todoist')")
                    .bind(uuid::Uuid::new_v4().to_string())
                    .bind(&p.name)
                    .bind(max.0)
                    .bind(&p.id)
                    .execute(&mut *tx).await?;
                report.projects_upserted += 1;
            }
        }
    }

    // 2. sections → pseudo-projects "Parent / Section"
    for s in &resp.sections {
        if s.is_deleted.unwrap_or(false) { continue; }
        let pseudo_ext = format!("section:{}", s.id);
        let exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?",
        ).bind(&pseudo_ext).fetch_optional(&mut *tx).await?;
        if exists.is_none() {
            let parent_name: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM projects WHERE external_source = 'todoist' AND external_id = ?",
            ).bind(&s.project_id).fetch_optional(&mut *tx).await?;
            let name = match parent_name {
                Some((p,)) => format!("{p} / {}", s.name),
                None => s.name.clone(),
            };
            let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM projects")
                .fetch_one(&mut *tx).await?;
            sqlx::query("INSERT INTO projects (id, name, color, position, external_id, external_source) VALUES (?, ?, '#8b8b8b', ?, ?, 'todoist')")
                .bind(uuid::Uuid::new_v4().to_string()).bind(&name).bind(max.0).bind(&pseudo_ext)
                .execute(&mut *tx).await?;
            report.projects_upserted += 1;
        }
    }

    // 3. items — pass 1
    let mut parent_links: Vec<(String, String)> = Vec::new(); // (child_external, parent_external)
    for item in &resp.items {
        let local = find_task_by_external(&mut *tx, &item.id).await?;
        if item.is_deleted.unwrap_or(false) {
            if let Some(t) = local {
                sqlx::query("DELETE FROM local_tasks WHERE id = ?").bind(&t.id).execute(&mut *tx).await?;
                logged.push((t.id, "DELETE"));
                report.deleted += 1;
            }
            continue;
        }
        let remote = mappers::item_to_snapshot(item);
        match local {
            None => {
                if remote.checked { continue; } // don't resurrect completed history
                let project_local: Option<(String,)> = match &remote.project_external_id {
                    Some(ext) => sqlx::query_as("SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?")
                        .bind(ext).fetch_optional(&mut *tx).await?,
                    None => None,
                };
                let project_id = project_local.map(|(id,)| id).unwrap_or_else(|| "inbox".to_string());
                let max: (i64,) = sqlx::query_as("SELECT COALESCE(MAX(position), 0) + 1 FROM local_tasks WHERE project_id = ?")
                    .bind(&project_id).fetch_one(&mut *tx).await?;
                let new_id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO local_tasks (id, content, description, project_id, priority, due_date, completed, status, position, external_id, external_source, remote_updated_at, synced_snapshot)
                     VALUES (?, ?, ?, ?, ?, ?, 0, 'todo', ?, ?, 'todoist', ?, ?)",
                )
                .bind(&new_id)
                .bind(&remote.content)
                .bind(if remote.description.is_empty() { None } else { Some(remote.description.clone()) })
                .bind(&project_id)
                .bind(remote.priority)
                .bind(&remote.due_date)
                .bind(max.0)
                .bind(&item.id)
                .bind(&item.updated_at)
                .bind(serde_json::to_string(&remote).unwrap_or_default())
                .execute(&mut *tx)
                .await?;
                if let Some(parent_ext) = &remote.parent_external_id {
                    parent_links.push((item.id.clone(), parent_ext.clone()));
                }
                logged.push((new_id, "INSERT"));
                report.created += 1;
            }
            Some(local_task) => {
                let base: Option<mappers::TaskSnapshot> = local_task
                    .synced_snapshot
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());
                if base.as_ref() == Some(&remote) { continue; } // echo
                let project_ext_of_local: Option<String> = sqlx::query_as::<_, (Option<String>,)>(
                    "SELECT external_id FROM projects WHERE id = ?",
                )
                .bind(&local_task.project_id)
                .fetch_optional(&mut *tx)
                .await?
                .and_then(|(e,)| e);
                let local_snap = mappers::local_to_snapshot(&local_task, project_ext_of_local, None, base.as_ref());
                let plan = merge::merge_task(
                    &local_snap,
                    base.as_ref(),
                    &remote,
                    mappers::local_ts_to_utc(&local_task.updated_at),
                    item.updated_at.as_deref().and_then(mappers::rfc3339_to_utc),
                );
                if let Some(c) = &plan.content {
                    sqlx::query("UPDATE local_tasks SET content = ? WHERE id = ?").bind(c).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(d) = &plan.description {
                    sqlx::query("UPDATE local_tasks SET description = ? WHERE id = ?")
                        .bind(if d.is_empty() { None } else { Some(d.clone()) }).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(due) = &plan.due_date {
                    sqlx::query("UPDATE local_tasks SET due_date = ? WHERE id = ?").bind(due).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(p) = plan.priority {
                    sqlx::query("UPDATE local_tasks SET priority = ? WHERE id = ?").bind(p).bind(&local_task.id).execute(&mut *tx).await?;
                }
                if let Some(ext) = &plan.project_external_id {
                    let target: Option<(String,)> = sqlx::query_as("SELECT id FROM projects WHERE external_source = 'todoist' AND external_id = ?")
                        .bind(ext).fetch_optional(&mut *tx).await?;
                    if let Some((pid,)) = target {
                        sqlx::query("UPDATE local_tasks SET project_id = ? WHERE id = ?").bind(&pid).bind(&local_task.id).execute(&mut *tx).await?;
                    }
                }
                if let Some(completed) = plan.completed {
                    if completed {
                        sqlx::query("UPDATE local_tasks SET completed = 1, status = 'complete', completed_at = datetime('now','localtime') WHERE id = ?")
                            .bind(&local_task.id).execute(&mut *tx).await?;
                    } else {
                        sqlx::query("UPDATE local_tasks SET completed = 0, status = 'todo', completed_at = NULL WHERE id = ?")
                            .bind(&local_task.id).execute(&mut *tx).await?;
                    }
                }
                sqlx::query("UPDATE local_tasks SET synced_snapshot = ?, remote_updated_at = ?, updated_at = datetime('now','localtime') WHERE id = ?")
                    .bind(serde_json::to_string(&remote).unwrap_or_default())
                    .bind(&item.updated_at)
                    .bind(&local_task.id)
                    .execute(&mut *tx)
                    .await?;
                if !plan.is_empty() {
                    logged.push((local_task.id.clone(), "UPDATE"));
                    report.updated += 1;
                }
            }
        }
    }

    // 4. items — pass 2: resolve parents
    for (child_ext, parent_ext) in parent_links {
        sqlx::query(
            "UPDATE local_tasks SET parent_id = (SELECT id FROM local_tasks WHERE external_source = 'todoist' AND external_id = ?)
             WHERE external_source = 'todoist' AND external_id = ?",
        )
        .bind(&parent_ext)
        .bind(&child_ext)
        .execute(&mut *tx)
        .await?;
    }

    // 5. token — same transaction as the applied deltas
    if let Some(token) = &resp.sync_token {
        sqlx::query("INSERT OR IGNORE INTO integration_sync_state (provider) VALUES ('todoist')")
            .execute(&mut *tx).await?;
        sqlx::query("UPDATE integration_sync_state SET sync_token = ?, last_sync_at = datetime('now','localtime'), last_error = NULL WHERE provider = 'todoist'")
            .bind(token).execute(&mut *tx).await?;
        if resp.full_sync.unwrap_or(false) {
            sqlx::query("UPDATE integration_sync_state SET last_full_sync_at = datetime('now','localtime') WHERE provider = 'todoist'")
                .execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;

    // 6. after commit: sync_log so Turso propagates (fire-and-forget, matches codebase pattern)
    for (row_id, op) in logged {
        let snapshot = if op == "DELETE" {
            None
        } else {
            match sqlx::query_as::<_, crate::types::LocalTask>(&format!(
                "SELECT {} FROM local_tasks WHERE id = ?", crate::db::tasks::SELECT_COLS
            )).bind(&row_id).fetch_optional(pool).await {
                Ok(Some(t)) => serde_json::to_string(&t).ok(),
                _ => None,
            }
        };
        crate::db::sync::append_sync_log(pool, "local_tasks", &row_id, op, None, snapshot.as_deref())
            .await
            .ok();
    }
    Ok(report)
}

pub async fn run_sync(pool: &SqlitePool) -> crate::Result<SyncReport> {
    let lock = SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let Ok(_guard) = lock.try_lock() else {
        return Ok(SyncReport { skipped: Some("already running".into()), ..Default::default() });
    };
    let Some(token) = crate::integrations::adapter_token_if_active(pool).await? else {
        return Ok(SyncReport { skipped: Some("disabled".into()), ..Default::default() });
    };
    outbox::prune_done(pool).await.ok();

    let result: crate::Result<SyncReport> = async {
        let pushed = push_outbox(pool, &token).await?;
        let state = crate::integrations::ensure_state(pool, "todoist").await?;
        let sync_token = state.sync_token.unwrap_or_else(|| "*".to_string());
        let resp = client::sync(&token, &serde_json::json!({
            "sync_token": sync_token,
            "resource_types": ["items", "projects", "sections", "completed_info"],
        })).await?;
        let mut report = apply_pull(pool, &resp).await?;
        report.pushed = pushed;
        Ok(report)
    }.await;

    if let Err(e) = &result {
        sqlx::query("UPDATE integration_sync_state SET last_error = ? WHERE provider = 'todoist'")
            .bind(e.to_string())
            .execute(pool)
            .await
            .ok();
    }
    result
}

pub async fn run_sync_if_due(pool: &SqlitePool, min_interval_secs: i64) -> crate::Result<SyncReport> {
    let (pending, _) = outbox::counts(pool).await?;
    if pending == 0 {
        if let Some(state) = crate::integrations::get_state(pool, "todoist").await? {
            if let Some(last) = state.last_sync_at.as_deref().and_then(mappers::local_ts_to_utc) {
                if (chrono::Utc::now() - last).num_seconds() < min_interval_secs {
                    return Ok(SyncReport { skipped: Some("recently synced".into()), ..Default::default() });
                }
            }
        }
    }
    run_sync(pool).await
}
```
(`find_task_by_external` and the sync-log refetch require `SELECT_COLS` to be `pub(crate)` — done in Task 9.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p nimble-core`
Expected: all 6 pull tests PASS, everything else still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: todoist pull engine with transactional apply, echo skip, and serialized run_sync"
```

---

### Task 12: Commands, triggers, and the frontend event bridge

Exposes sync to the app: three Tauri commands, the 5-minute background interval (first `tokio::spawn` in this codebase), window-focus trigger, a 10-second frontend debounce after local mutations, and a Tauri→window event bridge so applied pulls refresh the task lists.

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/todoist_sync.rs`
- Create: `apps/desktop/src-tauri/src/sync_runner.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/services/tauri.ts`, `data-provider.ts`, `tauri-provider.ts`
- Modify: `apps/mobile/services/sqlite-provider.ts` (stubs)
- Modify: `packages/types/src/index.ts`
- Modify: `apps/desktop/src/App.tsx` (event listener)
- Modify: the module defining `emitTasksChanged` (grep `export function emitTasksChanged` — expected in `apps/desktop/src/hooks/useLocalTasks.ts`)

**Interfaces:**
- Consumes: `sync_loop::{run_sync, run_sync_if_due, SyncReport}`, `integrations::{get_state, set_enabled, ensure_state}`, `outbox::{counts, error_list}`, `observer::seed_outbox_for_unlinked`
- Produces:
  - Commands: `todoist_sync_now() -> SyncReport`, `get_todoist_sync_status() -> TodoistSyncStatus`, `set_todoist_sync_enabled(enabled: bool)`
  - Tauri event `todoist-sync-applied` (emitted when a sync changed anything)
  - Provider group `dp.todoistSync.{syncNow, status, setEnabled}`
```rust
#[derive(serde::Serialize)]
pub struct TodoistSyncStatus {
    pub enabled: bool,
    pub connected: bool,          // token present
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub pending_ops: i64,
    pub error_ops: i64,
    pub errors: Vec<(String, String, String)>, // (outbox_id, op, error)
}
```

- [ ] **Step 1: Implement core status fn**

Add to `nimble-core/src/integrations/mod.rs`:
```rust
#[derive(Debug, serde::Serialize)]
pub struct TodoistSyncStatus {
    pub enabled: bool,
    pub connected: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub pending_ops: i64,
    pub error_ops: i64,
    pub errors: Vec<(String, String, String)>,
}

pub async fn todoist_sync_status(pool: &SqlitePool) -> crate::Result<TodoistSyncStatus> {
    let state = get_state(pool, "todoist").await?;
    let token = crate::db::settings::get_setting(pool, "todoist_api_token").await?;
    let (pending_ops, error_ops) = todoist::outbox::counts(pool).await?;
    let errors = todoist::outbox::error_list(pool).await?;
    Ok(TodoistSyncStatus {
        enabled: state.as_ref().map(|s| s.enabled).unwrap_or(false),
        connected: token.is_some(),
        last_sync_at: state.as_ref().and_then(|s| s.last_sync_at.clone()),
        last_error: state.and_then(|s| s.last_error),
        pending_ops,
        error_ops,
        errors,
    })
}
```

- [ ] **Step 2: Commands + runner**

`apps/desktop/src-tauri/src/commands/todoist_sync.rs`:
```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn todoist_sync_now(
    app: AppHandle,
) -> Result<nimble_core::integrations::todoist::sync_loop::SyncReport, String> {
    crate::sync_runner::run_and_emit(&app).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_todoist_sync_status(
    app: AppHandle,
) -> Result<nimble_core::integrations::TodoistSyncStatus, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::integrations::todoist_sync_status(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_todoist_sync_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::integrations::set_enabled(pool.inner(), "todoist", enabled)
        .await
        .map_err(|e| e.to_string())?;
    if enabled {
        // first-enable backfill: mirror pre-existing native tasks/projects out to Todoist
        nimble_core::integrations::todoist::observer::seed_outbox_for_unlinked(pool.inner())
            .await
            .map_err(|e| e.to_string())?;
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::sync_runner::run_and_emit(&app2).await;
        });
    }
    Ok(())
}
```

`apps/desktop/src-tauri/src/sync_runner.rs`:
```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

pub async fn run_and_emit(
    app: &AppHandle,
) -> nimble_core::Result<nimble_core::integrations::todoist::sync_loop::SyncReport> {
    let pool = app.state::<SqlitePool>();
    let report = nimble_core::integrations::todoist::sync_loop::run_sync(pool.inner()).await?;
    if report.changed_anything() {
        let _ = app.emit("todoist-sync-applied", ());
    }
    Ok(report)
}

pub async fn run_if_due_and_emit(app: &AppHandle, min_interval_secs: i64) {
    let pool = app.state::<SqlitePool>();
    match nimble_core::integrations::todoist::sync_loop::run_sync_if_due(pool.inner(), min_interval_secs).await {
        Ok(report) if report.changed_anything() => {
            let _ = app.emit("todoist-sync-applied", ());
        }
        Ok(_) => {}
        Err(e) => log::warn!("todoist sync failed (will retry on next trigger): {e}"),
    }
}
```
(`Emitter` vs `Manager` for `.emit` depends on the Tauri 2 minor in use — match whatever existing `emit` calls in the codebase import; if none exist, `use tauri::Emitter` is correct for 2.x.)

Wire-up in `lib.rs`:
1. `mod sync_runner;` at the top with the other module decls.
2. In `setup()` right after `app_handle.manage(pool)`:
```rust
{
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await; // first tick fires immediately → covers on-launch sync
            crate::sync_runner::run_if_due_and_emit(&handle, 60).await;
        }
    });
}
```
3. On the `Builder` chain (before `.setup(…)` or after — order doesn't matter):
```rust
.on_window_event(|window, event| {
    if let tauri::WindowEvent::Focused(true) = event {
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            crate::sync_runner::run_if_due_and_emit(&app, 60).await;
        });
    }
})
```
4. Register the three commands in `invoke_handler![]` (`todoist_sync::todoist_sync_now,` etc.) and `pub mod todoist_sync;` in `commands/mod.rs`.

- [ ] **Step 3: TS plumbing**

`packages/types/src/index.ts`:
```ts
export interface SyncReport {
  skipped: string | null
  pushed: number
  created: number
  updated: number
  deleted: number
  projects_upserted: number
}

export interface TodoistSyncStatus {
  enabled: boolean
  connected: boolean
  last_sync_at: string | null
  last_error: string | null
  pending_ops: number
  error_ops: number
  errors: [string, string, string][]
}
```

`tauri.ts` wrappers: `todoistSyncNow(): Promise<SyncReport>` → `invoke('todoist_sync_now')`; `getTodoistSyncStatus(): Promise<TodoistSyncStatus>` → `invoke('get_todoist_sync_status')`; `setTodoistSyncEnabled(enabled: boolean): Promise<void>` → `invoke('set_todoist_sync_enabled', { enabled })`.

`data-provider.ts` — new group on the interface:
```ts
  todoistSync: {
    syncNow(): Promise<SyncReport>
    status(): Promise<TodoistSyncStatus>
    setEnabled(enabled: boolean): Promise<void>
  }
```
`tauri-provider.ts` delegates to the wrappers. `apps/mobile/services/sqlite-provider.ts` stubs:
```ts
  todoistSync: {
    syncNow: async () => ({ skipped: 'mobile', pushed: 0, created: 0, updated: 0, deleted: 0, projects_upserted: 0 }),
    status: async () => ({ enabled: false, connected: false, last_sync_at: null, last_error: null, pending_ops: 0, error_ops: 0, errors: [] }),
    setEnabled: async () => {},
  },
```

- [ ] **Step 4: Frontend triggers**

In the module defining `emitTasksChanged` (expected `apps/desktop/src/hooks/useLocalTasks.ts`):
```ts
import { getDataProvider } from '@/services/data-provider'

let todoistSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleTodoistPush() {
  if (todoistSyncTimer) clearTimeout(todoistSyncTimer)
  todoistSyncTimer = setTimeout(() => {
    todoistSyncTimer = null
    getDataProvider().todoistSync.syncNow().catch(() => {
      // quiet by design: outbox persists, next trigger retries
    })
  }, 10_000)
}
```
Call `scheduleTodoistPush()` inside `emitTasksChanged()` (every local mutation already funnels through it).

In `App.tsx`, alongside the existing on-launch sync effect:
```tsx
import { listen } from '@tauri-apps/api/event'
// inside a mount useEffect:
const unlisten = listen('todoist-sync-applied', () => emitTasksChanged())
return () => { unlisten.then((f) => f()) }
```
Guard against a loop: `todoist-sync-applied` → `emitTasksChanged` → `scheduleTodoistPush` → `syncNow` is fine — the second sync finds an empty outbox and `run_sync_if_due`-style min-interval isn't used by `syncNow`, but the echo skip makes it a cheap no-op. If this proves chatty in practice, pass a `{ silent: true }` flag through `emitTasksChanged` from the listener to skip scheduling.

- [ ] **Step 5: Verify**

Run: `cargo build && cd apps/desktop && npx tsc --noEmit && cd ../..`
Expected: clean.
Manual (`npm run tauri dev` with a real token configured): app launches → within seconds `integration_sync_state.last_sync_at` is set (check via Settings status in Task 13, or `sqlite3` on the dev DB); creating a task locally shows up in Todoist within ~10s; completing it in Todoist mobile/web reflects locally after focus or ≤5 min.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: todoist sync commands, background interval, focus trigger, debounced push"
```

---

### Task 13: Settings UI — adapter toggle, status line, error list

The sunset switch and a neutral status surface. No guilt, no red walls: "couldn't sync — will retry".

**Files:**
- Create: `apps/desktop/src/components/settings/TodoistSyncSection.tsx`
- Modify: the settings page that renders `TodoistMigrationSection` (add the new section ABOVE it — sync is the everyday surface, migration is one-time)

**Interfaces:**
- Consumes: `dp.todoistSync.{status, syncNow, setEnabled}` (Task 12)
- Produces: `<TodoistSyncSection />`

- [ ] **Step 1: Build the component**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { getDataProvider } from '@/services/data-provider'
import type { TodoistSyncStatus } from '@nimble/types'
// reuse the exact Section wrapper / Switch / Button components and classNames
// used by TodoistMigrationSection.tsx and its neighbors

export function TodoistSyncSection() {
  const [status, setStatus] = useState<TodoistSyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const dp = getDataProvider()

  const refresh = useCallback(() => {
    dp.todoistSync.status().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const toggle = async (enabled: boolean) => {
    await dp.todoistSync.setEnabled(enabled)
    refresh()
  }

  const syncNow = async () => {
    setSyncing(true)
    try { await dp.todoistSync.syncNow() } finally { setSyncing(false); refresh() }
  }

  const [showErrors, setShowErrors] = useState(false)
  if (!status) return null

  const statusLine = [
    status.last_sync_at ? `Last synced ${status.last_sync_at}` : 'Not synced yet',
    status.pending_ops > 0
      ? `${status.pending_ops} change${status.pending_ops === 1 ? '' : 's'} waiting`
      : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Todoist sync</h3>
          <p className="text-xs text-muted-foreground">
            Keeps your tasks mirrored in Todoist both ways.
          </p>
        </div>
        <Switch
          checked={status.enabled}
          disabled={!status.connected}
          onCheckedChange={toggle}
        />
      </div>
      {!status.connected && (
        <p className="text-xs text-muted-foreground">
          Add your Todoist API token above to connect.
        </p>
      )}
      {status.connected && (
        <div className="flex items-center gap-3">
          <p className="text-xs text-muted-foreground">{statusLine}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={syncing || !status.enabled}
            onClick={syncNow}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      )}
      {(status.last_error || status.error_ops > 0) && (
        <div className="space-y-1">
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowErrors((v) => !v)}
          >
            Some changes couldn't sync — they'll retry automatically.
            {status.error_ops > 0 ? ` (${status.error_ops})` : ''}
          </button>
          {showErrors && (
            <ul className="space-y-0.5">
              {status.errors.map(([id, op, error]) => (
                <li key={id} className="text-xs text-muted-foreground">
                  {op}: {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```
Swap the wrapper `div` classNames for the exact section-skeleton classes used by the neighboring settings sections (match `TodoistMigrationSection.tsx`'s outer structure); `Switch`/`Button` come from `@/components/ui/`. Note the error toggle is a plain `<button>` — do NOT wrap it in a `TooltipTrigger` (known nested-button crash). Add `<TodoistSyncSection />` to the settings page above `<TodoistMigrationSection />`.

- [ ] **Step 2: Verify**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.
Manual: toggle off → creating tasks enqueues nothing (check status pending count stays 0); toggle on → seed + sync runs; "Sync now" spins and updates the timestamp.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: todoist sync settings section - toggle, status, neutral error list"
```

---

### Task 14: Retire the legacy Todoist view + docs touch-up

One native task list. The cached read-only Todoist panel, its hook, and its 4 commands go away; the migration section stays (onboarding path). `todoist_tasks` table remains (dropped in a later migration once sync is proven stable).

**Files:**
- Delete: `apps/desktop/src/hooks/useTodoist.ts`, `apps/desktop/src/components/todoist/TaskRow.tsx` (and the now-empty `components/todoist/` dir)
- Modify: `apps/desktop/src/components/pages/TasksPage.tsx` (imports :3, :5; usage :246)
- Modify: `apps/desktop/src/components/pages/TodayPage.tsx` (imports :2; usages :231, :330)
- Modify: `apps/desktop/src/stores/appStore.ts` (remove the `todoistTasks` slice + `setTodoistTasks`)
- Modify: `apps/desktop/src-tauri/src/commands/todoist.rs` (remove `fetch_todoist_tasks`, `refresh_todoist_tasks`, `complete_todoist_task`, `snooze_todoist_task`; KEEP `get_api_token`, `preview_todoist_migration`, `migrate_todoist`, `migrated_todoist_ids`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (deregister the 4 commands)
- Delete: `nimble-core/src/api/todoist.rs` (+ remove its `pub mod todoist;` from `api/mod.rs`)
- Modify: `apps/desktop/src/services/tauri.ts`, `data-provider.ts`, `tauri-provider.ts`, `apps/mobile/services/sqlite-provider.ts` (remove the 4 legacy wrappers from the `todoist` group; keep migration ones)
- Modify: `packages/types/src/index.ts` (remove `TodoistTask`/`TodoistTaskRow` type if nothing references it after the deletions)
- Modify: `nimble/CLAUDE.md`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing — this task only removes. `todoist_migration.rs` has its own HTTP fetchers and does NOT depend on `api/todoist.rs` (verified in research) — deleting the latter is safe.

- [ ] **Step 1: Remove frontend usage**

In `TasksPage.tsx` and `TodayPage.tsx`: delete the `useTodoist`/`TaskRow` imports, the hook calls, and the JSX blocks they feed (the "Todoist" panels/sections — in TodayPage both the ReviewMode call site and the dashboard one). Native `useLocalTasks` lists remain the only task surface. Then delete `useTodoist.ts` and `components/todoist/`.

- [ ] **Step 2: Remove the store slice and provider entries**

`appStore.ts`: drop `todoistTasks` state + `setTodoistTasks`. Remove the 4 legacy invoke wrappers from `tauri.ts`, the 4 methods from the `todoist` group in `data-provider.ts`/`tauri-provider.ts`/mobile stubs. Remove the `TodoistTask` row type from `packages/types` if `tsc` shows no remaining references.

- [ ] **Step 3: Remove the Rust side**

Strip the 4 command fns from `commands/todoist.rs` and their 4 lines from `invoke_handler![]`. Delete `nimble-core/src/api/todoist.rs`; remove its module decl. If `commands/todoist.rs` imported types from it (`TodoistTaskRow`), those imports go too.

- [ ] **Step 4: Verify everything builds and tests pass**

Run: `cargo build && cargo test -p nimble-core && cd apps/desktop && npx tsc --noEmit && cd ../..`
Expected: clean, all tests green.
Manual: `npm run tauri dev` — Tasks and Today pages render without the Todoist panel; settings migration section still works.

- [ ] **Step 5: Update CLAUDE.md**

In `nimble/CLAUDE.md`:
- Database Migrations: "Current version: **17**" with a line for v15–17.
- Key Tables: mark `todoist_tasks` as "legacy cache — UI retired, table dropped in a future migration"; add `todoist_outbox` and `integration_sync_state` (Mac-local, not synced).
- Architecture Rules: add "Task/project mutations must go through `db/tasks.rs` / `db/projects.rs` CRUD fns (they feed sync_log AND the Todoist outbox observer) — never raw SQL from commands."

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: retire legacy todoist cached view - one native task list"
```

---

## First-connect / onboarding flow (no new code — how the pieces compose)

For a fresh setup (or when Marco reconnects): token goes into settings (existing UI) → run the one-time **Import from Todoist** (existing `TodoistMigrationSection`, sets `external_id` on imported rows via its own upsert — pull-apply uses the same `external_source='todoist' AND external_id=?` convention, so the first full sync matches those rows instead of duplicating) → flip the **Todoist sync** toggle on (Task 12's `set_todoist_sync_enabled` seeds create-ops for any never-imported native rows and kicks the first sync, which full-syncs with token `*`). Order matters only in that importing before enabling avoids a burst of redundant-but-harmless merge work.

## Verification checklist (end-to-end, after Task 14)

1. `cargo test -p nimble-core` — all green.
2. Create task in app → appears in Todoist web within ~10 s.
3. Complete a **recurring** task in the app → Todoist advances it to the next occurrence (same item), local row gets the new due date on next pull, still open.
4. Reschedule that recurring task in the app → recurrence string intact in Todoist (inspect the task's due in Todoist web).
5. Edit content in app + reschedule the same task in Todoist (both before a sync) → both changes survive (field-level merge).
6. Delete a task in Todoist → gone locally after next sync. Delete locally → gone in Todoist.
7. Kill the network, make edits, relaunch → outbox drains once online; nothing lost, no error modals.
8. Toggle the adapter off → edits stop enqueueing; toggle on → backfill only creates genuinely unlinked rows.







