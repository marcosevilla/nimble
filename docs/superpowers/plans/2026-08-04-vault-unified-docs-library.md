# Obsidian VaultService + Unified Docs Library — Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Index Marco's whole Obsidian vault into SQLite (content, links, tags, full-text search), let the app edit vault notes in place with conflict protection, and surface vault notes beside native docs in one Docs library UI.

**Architecture:** A new `daily-triage-core/src/vault/` module owns everything: config resolution, an Obsidian-flavored-markdown parser, the SQLite index (`vault_notes` / `vault_links` / `vault_tags` + a device-local FTS5 table), a filesystem scanner, an atomic writer with hash-check conflict handling, and a debounced `notify` watcher. Files on disk stay the physical truth — the DB is a derived index that also happens to be the sync payload. Tauri commands in `apps/desktop/src-tauri/src/commands/vault.rs` are thin wrappers; a `vault_runner.rs` (modelled on the existing `sync_runner.rs`) owns the watcher handle and emits `vault-changed` to the webview. The Docs UI grows a `backend: 'native' | 'vault'` discriminator routed through the existing DataProvider.

**Tech Stack:** Rust (sqlx/SQLite, tokio), `turbovault-parser` 1.6 (Obsidian-flavored markdown), `notify` 8.2 + `notify-debouncer-full` 0.6, `blake3` 1.8, `walkdir` 2.5, React 19 + Zustand + Tiptap (markdown mode) on the desktop frontend.

**Source spec:** `docs/superpowers/specs/2026-08-04-todoist-obsidian-integration-design.md` — Part 2 (Obsidian vault service) plus the Mac-side half of Part 3 (Turso replication of vault tables).

---

## Scope boundary (read this before Task 1)

This plan implements spec **Part 2** end-to-end on the Mac, plus the **desktop half** of Part 3's sync surface (Rust sync allowlist, Turso remote tables, pull-side index reconcile). It deliberately stops at the mobile boundary.

**In scope:** vault index, scanner, watcher, writer/conflicts, unified Docs library UI, unified search, settings surface, Turso replication of `vault_notes` / `vault_links` / `vault_tags` from the Mac.

**Out of scope — plan 3:** `apps/mobile/services/database.ts` migration mirror, mobile `sync.ts` `ALLOWED_TABLES` entries, mobile Docs UI, the `pending_file_write` phone-edit replay path, background scheduler polish. Desktop pushes vault rows to Turso and the remote tables exist; mobile simply doesn't read them yet. That is a working, shippable state.

**Do not touch** `apps/mobile/**` in this plan. Mobile has its own copy of the `DataProvider` interface (`apps/mobile/services/data-provider.ts`) — it is a parallel file, not a shared import, so adding a `vault` slice to the desktop interface does not break mobile type-checking.

## Deviations from the spec (decided during planning, with reasons)

1. **`vault_links` / `vault_tags` get `id TEXT PRIMARY KEY`.** The spec's DDL sketch lists them without primary keys, but the existing sync layer requires one: `build_data_mutation_requests` (`db/sync.rs:479`) deletes by `id`, and `seed_existing_data` (`db/sync.rs:957`) selects `id`. Ids are **deterministic** (`{note_id}:l{index}`, `{note_id}:t{index}`) rather than random UUIDs so that re-indexing an unchanged note rewrites the same rows instead of churning sync_log with delete/insert pairs.
2. **No SQL triggers for FTS.** `run_migrations` splits migration SQL on `;` (`db/migrations.rs:446`), so any `CREATE TRIGGER ... BEGIN ...; ... END` would be shredded into invalid fragments. FTS rows are therefore written by `vault::index` alongside every note write, and the Turso pull path calls an explicit `vault::index::on_turso_row_applied` hook — mirroring how the Todoist observer already hooks pull (`db/sync.rs:749`).
3. **Turso pull reconciles FTS only, not links/tags.** A note row arriving from another device gets its FTS entry refreshed so search stays correct. Links/tags are re-derived only by the Mac when it re-parses the file, which is the path every real edit eventually takes (plan 3's `pending_file_write` replay writes the file, which trips the watcher). This avoids two devices ping-ponging derived rows.
4. **`turbovault-parser` requires Rust 1.90** (edition 2024). Both workspace crates currently declare `rust-version = "1.77.2"`; Task 1 raises them to `1.90.0`. The installed toolchain is 1.94.0, so nothing else changes — but the bump must happen **before** `cargo add`, or MSRV-aware resolution silently selects an ancient `turbovault-parser`.
5. **`turbovault-parser` pulls `serde_json` with the `preserve_order` feature**, which unifies across the workspace: JSON object keys will serialize in insertion order rather than sorted order. Verified safe — nothing in `integrations/todoist/` compares snapshot JSON as strings; merge logic parses values. Called out because it changes the byte-level shape of `synced_snapshot` and sync_log snapshots after this branch lands.
6. **Vault tables land in migration v18, not v17.** The spec drafted both halves against a single v17; plan 1 shipped v17 for the Todoist outbox and sync metadata, so the vault schema takes the next version.
7. **Note renames produce a new note id.** The watcher sees a delete + a create; there is no rename tracking. The old row is tombstoned (`deleted_at`) and a fresh row is indexed. Acceptable for a personal vault; `local_tasks.linked_doc_id` pointing at a renamed vault note will dangle, which the UI renders as "note not found" rather than crashing.

## Global Constraints

- All business logic lives in `daily-triage-core`; Tauri commands are thin wrappers. Registration path: core fn → `src-tauri/src/commands/<domain>.rs` → export in `commands/mod.rs` → import in `lib.rs` → add to `invoke_handler![]` → TS wrapper in `apps/desktop/src/services/tauri.ts`.
- Frontend never does HTTP or filesystem or SQLite access — always `invoke()`.
- Every **content-bearing** mutation to a synced table appends to `sync_log` via `crate::db::sync::append_sync_log(pool, table, row_id, op, changed_columns, snapshot)`; the snapshot's JSON keys **must** exactly match the SQLite column names, because the Turso push builds `INSERT OR REPLACE` column lists straight from them. The one deliberate exception is `vault_notes.mtime`/`size` touched on their own (`vault::index::touch_stat`, Task 4): those columns are a device-local stat cache that lets the scanner skip unchanged files, and the note's content is by definition identical — logging them would push a row to Turso every time Obsidian rewrites the same bytes. Any change to `content`, `title`, `frontmatter_json`, `hash`, or `deleted_at` is content-bearing and must be logged.
- Vault paths stored in the DB are **vault-relative, forward-slash** (`journal/briefs/Brief 2026-08-04.md`). Absolute paths never enter a synced row.
- Timestamps: `datetime('now','localtime')`-style strings (`YYYY-MM-DD HH:MM:SS`) for `updated_at` / `deleted_at`, matching every other table. File mtimes are stored as RFC3339 (they come from the filesystem, not SQLite).
- UI copy stays neutral and guilt-free: no "overdue", no streaks, no scolding. Sync/scan failures read as "will retry".
- Use `cn()` for conditional classes; import shadcn primitives from `@/components/ui/`; skeletons over spinners.
- Rust tests: `cargo test -p daily-triage-core`. Desktop types: `cd apps/desktop && npm run build` — **not** `npx tsc --noEmit`. `apps/desktop/tsconfig.json` is a solution-style config (`"files": []` plus project references), so a bare `tsc --noEmit` resolves it, checks **zero** files, and exits 0 no matter how broken the code is. Only `tsc -b` (which `npm run build` runs) descends into `tsconfig.app.json` and actually type-checks `src/`. Discovered during Task 14 — every earlier "tsc clean" in this plan was a no-op. Both commands must be clean before every commit.
- Commit messages use `feat:` / `fix:` / `refactor:` prefixes, one commit per task.

---

### Task 1: Dependencies and migration v18 (vault schema)

**Files:**
- Modify: `daily-triage-core/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.toml:9`
- Modify: `daily-triage-core/src/db/migrations.rs` (append to `MIGRATIONS`, after the v17 entry ending at line ~429)
- Modify: `daily-triage-core/CLAUDE.md` is NOT touched here; `daily-triage/CLAUDE.md` schema notes are updated in Task 14.

**Interfaces:**
- Consumes: nothing.
- Produces: tables `vault_notes`, `vault_links`, `vault_tags`, `vault_fts` available to every later task; crates `turbovault_parser`, `notify`, `notify_debouncer_full`, `blake3`, `walkdir` available to the core crate.

- [ ] **Step 1: Raise the MSRV on both crates before adding dependencies**

In `daily-triage-core/Cargo.toml` change:

```toml
rust-version = "1.77.2"
```

to:

```toml
rust-version = "1.90.0"
```

Do the same at `apps/desktop/src-tauri/Cargo.toml:9`. Both must change: cargo's MSRV-aware resolution uses the lowest `rust-version` in the workspace, and `turbovault-parser` 1.6 declares `rust-version = "1.90.0"` (it is an edition-2024 crate). Skipping this makes `cargo add` silently resolve to a years-old version.

- [ ] **Step 2: Add the dependencies**

```bash
cd daily-triage-core
cargo add turbovault-parser@1.6 notify@8.2 notify-debouncer-full@0.6 blake3@1.8 walkdir@2.5
```

- [ ] **Step 3: Verify the resolved versions are the intended ones**

```bash
cd /Users/marcosevilla/Developer/marco-task-app/daily-triage
grep -A1 'name = "turbovault-parser"' Cargo.lock
grep -A1 'name = "notify-debouncer-full"' Cargo.lock
```

Expected: `version = "1.6.0"` and `version = "0.6.0"`. If `turbovault-parser` resolved to anything below 1.6, Step 1 was not applied to both manifests — fix and re-run.

- [ ] **Step 4: Write the failing migration test**

Add to the bottom of `daily-triage-core/src/db/migrations.rs`:

```rust
#[cfg(test)]
mod v18_tests {
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn vault_tables_and_fts_exist_after_migrations() {
        let pool = test_pool().await;

        for table in ["vault_notes", "vault_links", "vault_tags"] {
            let found: Option<(String,)> = sqlx::query_as(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_optional(&pool)
            .await
            .unwrap();
            assert!(found.is_some(), "missing table {table}");
        }

        // FTS5 virtual table is device-local but must exist on desktop.
        sqlx::query("INSERT INTO vault_fts (note_id, title, content) VALUES ('n1', 'Alpha', 'body text')")
            .execute(&pool)
            .await
            .expect("insert into vault_fts");
        let hits: Vec<(String,)> =
            sqlx::query_as("SELECT note_id FROM vault_fts WHERE vault_fts MATCH 'body'")
                .fetch_all(&pool)
                .await
                .expect("fts query");
        assert_eq!(hits.len(), 1);

        // path is unique — two notes may not claim the same file
        sqlx::query("INSERT INTO vault_notes (id, path, title, content) VALUES ('a', 'x.md', 'X', '')")
            .execute(&pool)
            .await
            .unwrap();
        let dup = sqlx::query("INSERT INTO vault_notes (id, path, title, content) VALUES ('b', 'x.md', 'X', '')")
            .execute(&pool)
            .await;
        assert!(dup.is_err(), "path must be UNIQUE");
    }
}
```

- [ ] **Step 5: Run it and watch it fail**

Run: `cargo test -p daily-triage-core v18_tests -- --nocapture`
Expected: FAIL — `missing table vault_notes`.

- [ ] **Step 6: Add migration v18**

Append this `Migration` entry to the `MIGRATIONS` slice in `daily-triage-core/src/db/migrations.rs`, immediately after the version 17 entry and before the closing `];`. Note there are **no** `CREATE TRIGGER` statements — the runner splits this string on `;`, so a trigger body would be torn apart.

```rust
    Migration {
        version: 18,
        description: "Obsidian vault index: notes, links, tags, device-local FTS",
        sql: "
            CREATE TABLE IF NOT EXISTS vault_notes (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                frontmatter_json TEXT,
                mtime TEXT,
                size INTEGER NOT NULL DEFAULT 0,
                hash TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_vault_notes_deleted ON vault_notes(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_vault_notes_updated ON vault_notes(updated_at);
            CREATE TABLE IF NOT EXISTS vault_links (
                id TEXT PRIMARY KEY,
                from_note_id TEXT NOT NULL,
                to_path TEXT NOT NULL,
                link_type TEXT NOT NULL DEFAULT 'wikilink',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_vault_links_from ON vault_links(from_note_id);
            CREATE INDEX IF NOT EXISTS idx_vault_links_to ON vault_links(to_path);
            CREATE TABLE IF NOT EXISTS vault_tags (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_vault_tags_note ON vault_tags(note_id);
            CREATE INDEX IF NOT EXISTS idx_vault_tags_tag ON vault_tags(tag);
            CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(note_id UNINDEXED, title, content)
        ",
    },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo test -p daily-triage-core v18_tests`
Expected: PASS.

- [ ] **Step 8: Confirm the whole suite still passes**

Run: `cargo test -p daily-triage-core`
Expected: all pre-existing tests (68 at branch point) plus the new one pass.

- [ ] **Step 9: Commit**

```bash
git add daily-triage-core/Cargo.toml daily-triage-core/src/db/migrations.rs apps/desktop/src-tauri/Cargo.toml Cargo.lock
git commit -m "feat: add vault index schema (migration v18) and vault dependencies"
```

---

### Task 2: Vault config — path resolution and exclusion rules

**Files:**
- Create: `daily-triage-core/src/vault/mod.rs`
- Modify: `daily-triage-core/src/lib.rs:1-7` (add `pub mod vault;`)

**Interfaces:**
- Consumes: `crate::db::settings::{get_setting, set_setting}`.
- Produces:
  - `pub struct VaultConfig { pub root: std::path::PathBuf, pub excludes: Vec<String> }`
  - `pub async fn load_config(pool: &SqlitePool) -> crate::Result<Option<VaultConfig>>`
  - `pub fn is_excluded(rel_path: &str, excludes: &[String]) -> bool`
  - `pub fn is_indexable(rel_path: &str, excludes: &[String]) -> bool`
  - `pub fn rel_path(root: &Path, abs: &Path) -> Option<String>`
  - `pub const DEFAULT_EXCLUDES: [&str; 3]`
  - settings keys `vault_exclude_globs`, `vault_last_scan_at`, `vault_last_scan_error`

- [ ] **Step 1: Write the failing test**

Create `daily-triage-core/src/vault/mod.rs` containing only this test module for now:

```rust
#[cfg(test)]
mod config_tests {
    use super::*;
    use crate::test_util::test_pool;

    #[test]
    fn excludes_match_directory_segments_at_any_depth() {
        let ex: Vec<String> = DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect();
        assert!(is_excluded(".obsidian/workspace.json", &ex));
        assert!(is_excluded("journal/.obsidian/cache", &ex));
        assert!(is_excluded("templates/Daily.md", &ex));
        assert!(!is_excluded("journal/briefs/Brief 2026-08-04.md", &ex));
        assert!(!is_excluded("my templates note.md", &ex));
    }

    #[test]
    fn only_markdown_files_are_indexable() {
        let ex: Vec<String> = DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect();
        assert!(is_indexable("inbox/Quick Captures.md", &ex));
        assert!(!is_indexable("attachments/photo.png", &ex));
        assert!(!is_indexable("notes/archive.MD.zip", &ex));
        assert!(!is_indexable("templates/Daily.md", &ex));
    }

    #[test]
    fn rel_path_is_forward_slashed_and_rejects_outside_paths() {
        let root = std::path::Path::new("/Users/marco/Obsidian/marcowits");
        assert_eq!(
            rel_path(root, std::path::Path::new("/Users/marco/Obsidian/marcowits/journal/a.md")).as_deref(),
            Some("journal/a.md")
        );
        assert_eq!(rel_path(root, std::path::Path::new("/etc/passwd")), None);
    }

    #[tokio::test]
    async fn load_config_expands_tilde_and_defaults_excludes() {
        let pool = test_pool().await;
        assert!(load_config(&pool).await.unwrap().is_none(), "unset vault path yields None");

        crate::db::settings::set_setting(&pool, "obsidian_vault_path", "~/Obsidian/marcowits")
            .await
            .unwrap();
        let cfg = load_config(&pool).await.unwrap().expect("config");
        assert!(cfg.root.is_absolute(), "~ must be expanded: {:?}", cfg.root);
        assert!(!cfg.root.to_string_lossy().contains('~'));
        assert_eq!(cfg.excludes.len(), DEFAULT_EXCLUDES.len());

        crate::db::settings::set_setting(&pool, "vault_exclude_globs", r#"["archive","x/"]"#)
            .await
            .unwrap();
        let cfg = load_config(&pool).await.unwrap().expect("config");
        assert_eq!(cfg.excludes, vec!["archive".to_string(), "x/".to_string()]);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core config_tests`
Expected: FAIL — `cannot find function is_excluded` / module `vault` not declared.

- [ ] **Step 3: Declare the module**

In `daily-triage-core/src/lib.rs`, add `pub mod vault;` to the module list so it reads:

```rust
pub mod api;
pub mod db;
pub mod integrations;
pub mod parsers;
#[cfg(test)]
pub mod test_util;
pub mod types;
pub mod vault;
```

- [ ] **Step 4: Write the implementation**

Put this **above** the test module in `daily-triage-core/src/vault/mod.rs`:

```rust
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

pub mod index;
pub mod parser;
pub mod scanner;
pub mod watcher;
pub mod writer;

/// Directories skipped by default. Matched against any path segment, so
/// `.obsidian` is excluded wherever it appears in the tree.
pub const DEFAULT_EXCLUDES: [&str; 3] = [".obsidian/", ".trash/", "templates/"];

#[derive(Debug, Clone)]
pub struct VaultConfig {
    /// Absolute, tilde-expanded vault root.
    pub root: PathBuf,
    /// Raw exclude entries as configured (trailing slashes tolerated).
    pub excludes: Vec<String>,
}

/// Read the vault configuration from settings. Returns `Ok(None)` when
/// `obsidian_vault_path` is unset — an unconfigured vault is a normal state,
/// not an error, and every caller degrades to a no-op.
pub async fn load_config(pool: &SqlitePool) -> crate::Result<Option<VaultConfig>> {
    let Some(raw_path) = crate::db::settings::get_setting(pool, "obsidian_vault_path").await? else {
        return Ok(None);
    };
    if raw_path.trim().is_empty() {
        return Ok(None);
    }

    let expanded = if let Some(stripped) = raw_path.strip_prefix('~') {
        let home = dirs::home_dir()
            .ok_or_else(|| crate::Error::Other("Cannot determine home directory".into()))?;
        home.join(stripped.trim_start_matches('/'))
    } else {
        PathBuf::from(&raw_path)
    };

    let excludes = match crate::db::settings::get_setting(pool, "vault_exclude_globs").await? {
        Some(json) => serde_json::from_str::<Vec<String>>(&json)
            .unwrap_or_else(|_| DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect()),
        None => DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
    };

    Ok(Some(VaultConfig { root: expanded, excludes }))
}

/// True when any exclude entry matches the whole relative path or one of its
/// path segments. Deliberately segment matching, not glob matching: it covers
/// every real case (`.obsidian/`, `templates/`) without a glob dependency, and
/// never accidentally matches a note whose *name* contains the word.
pub fn is_excluded(rel_path: &str, excludes: &[String]) -> bool {
    for raw in excludes {
        let ex = raw.trim_end_matches('/');
        if ex.is_empty() {
            continue;
        }
        if rel_path == ex {
            return true;
        }
        if rel_path.split('/').any(|segment| segment == ex) {
            return true;
        }
    }
    false
}

/// Only markdown files are indexed; everything else (attachments, binaries,
/// `.canvas`, images) is ignored outright.
pub fn is_indexable(rel_path: &str, excludes: &[String]) -> bool {
    if is_excluded(rel_path, excludes) {
        return false;
    }
    Path::new(rel_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Vault-relative, forward-slashed path for an absolute file path. Returns
/// `None` when the path escapes the vault root — synced rows must never carry
/// an absolute path.
pub fn rel_path(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}
```

Note: the `pub mod index; pub mod parser; pub mod scanner; pub mod watcher; pub mod writer;` lines reference files created in Tasks 3–7. Create the four remaining files as empty placeholders now so the crate compiles:

```bash
cd daily-triage-core/src/vault
touch index.rs parser.rs scanner.rs watcher.rs writer.rs
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core config_tests`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add daily-triage-core/src/lib.rs daily-triage-core/src/vault/
git commit -m "feat: vault config — path resolution and exclusion rules"
```

---

### Task 3: Vault parser — Obsidian-flavored markdown to indexable fields

**Files:**
- Modify: `daily-triage-core/src/vault/parser.rs` (currently empty)

**Interfaces:**
- Consumes: `turbovault_parser::ParsedContent`, `crate::vault::rel_path` conventions.
- Produces:
  - `pub struct ParsedNote { pub title: String, pub frontmatter_json: Option<String>, pub links: Vec<ParsedLink>, pub tags: Vec<String> }`
  - `pub struct ParsedLink { pub to_path: String, pub link_type: String }`
  - `pub fn parse_note(rel_path: &str, content: &str) -> ParsedNote`
  - `pub fn title_from_path(rel_path: &str) -> String`

Verified `turbovault-parser` 1.6 behaviour this task depends on (checked against the real crate, not assumed):
`ParsedContent::parse(&str)` is synchronous and infallible; `frontmatter: Option<Frontmatter>` where `Frontmatter { data: HashMap<String, serde_json::Value>, .. }` and `Frontmatter::tags()` returns `Vec<String>`; `wikilinks` / `embeds` are `Vec<Link>` with `target: String` carrying the full target **including** any `#heading` or `#^block` fragment (`[[Other Note#Section|alias]]` → `target == "Other Note#Section"`, `display_text == Some("alias")`); `tags: Vec<Tag>` with `name: String` **without** the leading `#` (`#project/obsidian` → `"project/obsidian"`); inline tags do **not** include frontmatter tags, so they must be merged manually; `headings[i]` exposes `.level` and `.text`. None of these types need to be imported by name — field access through `ParsedContent` is enough.

- [ ] **Step 1: Write the failing test**

Add to `daily-triage-core/src/vault/parser.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\ntitle: My Real Title\ntags: [alpha, beta]\n---\n\n# Ignored Heading\n\nSee [[Other Note#Section|alias]] and ![[attachments/img.png]] plus [[Other Note]] again.\n\nTagged #rust and #project/obsidian.\n";

    #[test]
    fn title_prefers_frontmatter_then_h1_then_filename() {
        assert_eq!(parse_note("a/b.md", NOTE).title, "My Real Title");

        let h1_only = "# Heading Wins\n\nbody";
        assert_eq!(parse_note("a/b.md", h1_only).title, "Heading Wins");

        let bare = "just body text";
        assert_eq!(parse_note("journal/Brief 2026-08-04.md", bare).title, "Brief 2026-08-04");
    }

    #[test]
    fn links_drop_fragments_dedupe_and_keep_type() {
        let parsed = parse_note("a/b.md", NOTE);
        assert_eq!(
            parsed.links,
            vec![
                ParsedLink { to_path: "Other Note".into(), link_type: "wikilink".into() },
                ParsedLink { to_path: "attachments/img.png".into(), link_type: "embed".into() },
            ]
        );
    }

    #[test]
    fn same_document_anchors_are_not_links() {
        let parsed = parse_note("a/b.md", "See [[#^block123]] and [[#Section]].");
        assert!(parsed.links.is_empty(), "got {:?}", parsed.links);
    }

    #[test]
    fn tags_merge_inline_and_frontmatter_without_duplicates() {
        let mut tags = parse_note("a/b.md", NOTE).tags;
        tags.sort();
        assert_eq!(tags, vec!["alpha", "beta", "project/obsidian", "rust"]);

        let dupes = parse_note("a/b.md", "---\ntags: [rust]\n---\n\n#rust #rust\n");
        assert_eq!(dupes.tags, vec!["rust"]);
    }

    #[test]
    fn frontmatter_json_round_trips_or_is_none() {
        let parsed = parse_note("a/b.md", NOTE);
        let json = parsed.frontmatter_json.expect("frontmatter json");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["title"], "My Real Title");

        assert!(parse_note("a/b.md", "no frontmatter here").frontmatter_json.is_none());
    }

    #[test]
    fn frontmatter_json_key_order_is_stable() {
        // The upstream frontmatter map is a HashMap; without an explicit
        // ordering the same note would serialize differently run to run.
        let wide = "---\nzeta: 1\nalpha: 2\nmiddle: 3\ntitle: T\ntags: [x]\n---\n\nbody\n";
        let first = parse_note("a/b.md", wide).frontmatter_json.expect("json");
        for _ in 0..8 {
            assert_eq!(parse_note("a/b.md", wide).frontmatter_json.as_deref(), Some(first.as_str()));
        }
        assert!(first.starts_with(r#"{"alpha":"#), "keys should be sorted: {first}");
    }

    #[test]
    fn blank_title_levels_fall_through() {
        // Requirement: an empty or whitespace-only value at one precedence
        // level falls through to the next.
        let blank_fm = "---\ntitle: \"   \"\n---\n\n# H1 Wins\n\nbody";
        assert_eq!(parse_note("a/b.md", blank_fm).title, "H1 Wins");

        let blank_both = "---\ntitle: \"\"\n---\n\n#    \n\nbody";
        assert_eq!(parse_note("journal/Fallback Name.md", blank_both).title, "Fallback Name");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault::parser`
Expected: FAIL — `cannot find function parse_note in this scope`.

- [ ] **Step 3: Write the implementation**

Put this above the test module in `daily-triage-core/src/vault/parser.rs`:

```rust
use turbovault_parser::ParsedContent;

/// A link extracted from a note, normalised for the index: the `#heading` /
/// `#^block` fragment is stripped so `to_path` can be matched against
/// `vault_notes.path` (or a note title) during resolution.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ParsedLink {
    pub to_path: String,
    /// `"wikilink"` or `"embed"`.
    pub link_type: String,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedNote {
    pub title: String,
    pub frontmatter_json: Option<String>,
    pub links: Vec<ParsedLink>,
    pub tags: Vec<String>,
}

/// Filename stem as a human title: `journal/Brief 2026-08-04.md` → `Brief 2026-08-04`.
pub fn title_from_path(rel_path: &str) -> String {
    rel_path
        .rsplit('/')
        .next()
        .unwrap_or(rel_path)
        .trim_end_matches(".md")
        .trim_end_matches(".MD")
        .to_string()
}

/// Parse one note's raw markdown into the fields the index stores.
///
/// Title precedence: frontmatter `title` → first H1 → filename stem.
/// Never fails: a note that parses to nothing still yields a filename title.
pub fn parse_note(rel_path: &str, content: &str) -> ParsedNote {
    let parsed = ParsedContent::parse(content);

    // `fm.data` is a `HashMap`, whose iteration order is randomized per
    // process — serializing it directly would give the same note a different
    // `frontmatter_json` string on every app restart, and a different one on
    // each device. Collect into a `BTreeMap` first so the column is stable and
    // comparable.
    let frontmatter_json = parsed.frontmatter.as_ref().and_then(|fm| {
        let ordered: std::collections::BTreeMap<&String, &serde_json::Value> =
            fm.data.iter().collect();
        serde_json::to_string(&ordered).ok()
    });

    let title = parsed
        .frontmatter
        .as_ref()
        .and_then(|fm| fm.data.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            parsed
                .headings
                .iter()
                .find(|h| h.level == 1)
                .map(|h| h.text.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| title_from_path(rel_path));

    let mut links: Vec<ParsedLink> = Vec::new();
    let mut push_link = |target: &str, link_type: &str, links: &mut Vec<ParsedLink>| {
        // Strip the `#heading` / `#^block` fragment; a target that is *only* a
        // fragment is a same-document anchor and not a link between notes.
        let to_path = target.split('#').next().unwrap_or("").trim().to_string();
        if to_path.is_empty() {
            return;
        }
        let candidate = ParsedLink { to_path, link_type: link_type.to_string() };
        if !links.contains(&candidate) {
            links.push(candidate);
        }
    };
    for link in &parsed.wikilinks {
        push_link(&link.target, "wikilink", &mut links);
    }
    for embed in &parsed.embeds {
        push_link(&embed.target, "embed", &mut links);
    }

    let mut tags: Vec<String> = Vec::new();
    for tag in &parsed.tags {
        let name = tag.name.trim_start_matches('#').trim().to_string();
        if !name.is_empty() && !tags.contains(&name) {
            tags.push(name);
        }
    }
    if let Some(fm) = parsed.frontmatter.as_ref() {
        for name in fm.tags() {
            let name = name.trim_start_matches('#').trim().to_string();
            if !name.is_empty() && !tags.contains(&name) {
                tags.push(name);
            }
        }
    }

    ParsedNote { title, frontmatter_json, links, tags }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core vault::parser`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add daily-triage-core/src/vault/parser.rs
git commit -m "feat: vault parser — titles, wikilinks, embeds, tags, frontmatter"
```

---

### Task 4: Vault index — note upsert, tombstones, FTS, sync_log

**Files:**
- Modify: `daily-triage-core/src/vault/index.rs` (currently empty)

**Interfaces:**
- Consumes: `crate::vault::parser::{parse_note, ParsedNote}`, `crate::db::sync::append_sync_log`.
- Produces:
  - `pub struct VaultNoteRow { id, path, title, content, frontmatter_json, mtime, size, hash, updated_at, deleted_at }` (serde field names == column names)
  - `pub struct VaultNoteSummary { id, path, title, updated_at }`
  - `pub struct VaultSearchHit { id, path, title, snippet }`
  - `pub struct IndexedFile { hash: String, size: i64, mtime: Option<String> }`
  - `pub async fn upsert_note(pool, path: &str, content: &str, mtime: Option<&str>, size: i64, hash: &str) -> crate::Result<String>`
  - `pub async fn touch_stat(pool, path: &str, mtime: Option<&str>, size: i64) -> crate::Result<()>`
  - `pub async fn soft_delete_note(pool, path: &str) -> crate::Result<()>`
  - `pub async fn get_note_by_path(pool, path: &str) -> crate::Result<Option<VaultNoteRow>>`
  - `pub async fn list_notes(pool) -> crate::Result<Vec<VaultNoteSummary>>`
  - `pub async fn indexed_files(pool) -> crate::Result<std::collections::HashMap<String, IndexedFile>>`
  - `pub async fn search(pool, query: &str, limit: i64) -> crate::Result<Vec<VaultSearchHit>>`
  - `pub async fn backlinks(pool, path: &str) -> crate::Result<Vec<VaultNoteSummary>>`
  - `pub async fn resolve_link(pool, to_path: &str) -> crate::Result<Option<VaultNoteSummary>>`
  - `pub async fn on_turso_row_applied(pool, table_name: &str, row_id: &str)`

- [ ] **Step 1: Write the failing test**

Add to `daily-triage-core/src/vault/index.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    const BODY: &str = "---\ntitle: Alpha Note\ntags: [work]\n---\n\nLinks to [[Beta]] and #deep/tag.\n";

    #[tokio::test]
    async fn upsert_indexes_note_links_tags_and_fts() {
        let pool = test_pool().await;
        let id = upsert_note(&pool, "a/Alpha.md", BODY, Some("2026-08-04T10:00:00Z"), 120, "hash1")
            .await
            .unwrap();

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert_eq!(row.id, id);
        assert_eq!(row.title, "Alpha Note");
        assert_eq!(row.hash.as_deref(), Some("hash1"));
        assert!(row.deleted_at.is_none());

        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT to_path, link_type FROM vault_links WHERE from_note_id = ?")
                .bind(&id)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(links, vec![("Beta".to_string(), "wikilink".to_string())]);

        let mut tags: Vec<(String,)> = sqlx::query_as("SELECT tag FROM vault_tags WHERE note_id = ?")
            .bind(&id)
            .fetch_all(&pool)
            .await
            .unwrap();
        tags.sort();
        assert_eq!(tags.len(), 2, "inline + frontmatter tags: {tags:?}");

        let hits = search(&pool, "Beta", 10).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a/Alpha.md");
    }

    #[tokio::test]
    async fn reindex_keeps_id_and_replaces_derived_rows() {
        let pool = test_pool().await;
        let id1 = upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        let id2 = upsert_note(&pool, "a/Alpha.md", "# Renamed\n\nNo links now.\n", None, 40, "hash2")
            .await
            .unwrap();
        assert_eq!(id1, id2, "path identity must survive a re-index");

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert_eq!(row.title, "Renamed");

        let link_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vault_links WHERE from_note_id = ?")
                .bind(&id1)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(link_count, 0, "stale links must be cleared");

        let fts_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_fts WHERE note_id = ?")
            .bind(&id1)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fts_rows, 1, "exactly one FTS row per note");
    }

    #[tokio::test]
    async fn soft_delete_tombstones_row_and_clears_search() {
        let pool = test_pool().await;
        let id = upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        soft_delete_note(&pool, "a/Alpha.md").await.unwrap();

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert!(row.deleted_at.is_some(), "row is tombstoned, not removed");
        assert!(search(&pool, "Beta", 10).await.unwrap().is_empty());
        assert!(list_notes(&pool).await.unwrap().is_empty());

        let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_links WHERE from_note_id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(links, 0);
    }

    #[tokio::test]
    async fn writes_append_sync_log_entries_for_vault_notes() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        let entries: Vec<(String, String)> = sqlx::query_as(
            "SELECT operation, snapshot FROM sync_log WHERE table_name = 'vault_notes'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(entries.len(), 1);
        let snapshot: serde_json::Value = serde_json::from_str(&entries[0].1).unwrap();
        // Snapshot keys become the INSERT column list on Turso — they must be
        // exactly the table's columns.
        for col in ["id", "path", "title", "content", "frontmatter_json", "mtime", "size", "hash", "updated_at", "deleted_at"] {
            assert!(snapshot.get(col).is_some(), "snapshot missing column {col}");
        }
    }

    #[tokio::test]
    async fn indexed_files_returns_stat_map_for_scanner_precheck() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, Some("2026-08-04T10:00:00Z"), 120, "hash1")
            .await
            .unwrap();
        let map = indexed_files(&pool).await.unwrap();
        let entry = map.get("a/Alpha.md").expect("indexed entry");
        assert_eq!(entry.hash, "hash1");
        assert_eq!(entry.size, 120);
        assert_eq!(entry.mtime.as_deref(), Some("2026-08-04T10:00:00Z"));
    }

    #[tokio::test]
    async fn backlinks_and_link_resolution_work_by_path_or_title() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "h1").await.unwrap();
        upsert_note(&pool, "a/Beta.md", "# Beta\n\nbody", None, 20, "h2").await.unwrap();

        let resolved = resolve_link(&pool, "Beta").await.unwrap().expect("resolves by title/stem");
        assert_eq!(resolved.path, "a/Beta.md");
        assert!(resolve_link(&pool, "Nonexistent").await.unwrap().is_none());

        let back = backlinks(&pool, "a/Beta.md").await.unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].path, "a/Alpha.md");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault::index`
Expected: FAIL — `cannot find function upsert_note in this scope`.

- [ ] **Step 3: Write the implementation**

Put this above the test module in `daily-triage-core/src/vault/index.rs`:

```rust
use sqlx::SqlitePool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::db::sync;
use crate::vault::parser::parse_note;

/// One row of `vault_notes`. Field names are the column names verbatim —
/// the Turso push builds its INSERT column list from this struct's JSON keys.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultNoteRow {
    pub id: String,
    pub path: String,
    pub title: String,
    pub content: String,
    pub frontmatter_json: Option<String>,
    pub mtime: Option<String>,
    pub size: i64,
    pub hash: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultNoteSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultSearchHit {
    pub id: String,
    pub path: String,
    pub title: String,
    pub snippet: String,
}

/// Stat + hash of an already-indexed file, used by the scanner to skip
/// unchanged files without reading them.
#[derive(Debug, Clone)]
pub struct IndexedFile {
    pub hash: String,
    pub size: i64,
    pub mtime: Option<String>,
}

const NOTE_COLS: &str =
    "id, path, title, content, frontmatter_json, mtime, size, hash, updated_at, deleted_at";

type NoteTuple = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
    Option<String>,
    String,
    Option<String>,
);

fn row_to_note(t: NoteTuple) -> VaultNoteRow {
    VaultNoteRow {
        id: t.0,
        path: t.1,
        title: t.2,
        content: t.3,
        frontmatter_json: t.4,
        mtime: t.5,
        size: t.6,
        hash: t.7,
        updated_at: t.8,
        deleted_at: t.9,
    }
}

pub async fn get_note_by_path(pool: &SqlitePool, path: &str) -> crate::Result<Option<VaultNoteRow>> {
    let row: Option<NoteTuple> =
        sqlx::query_as(&format!("SELECT {NOTE_COLS} FROM vault_notes WHERE path = ?"))
            .bind(path)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(row_to_note))
}

pub async fn get_note(pool: &SqlitePool, id: &str) -> crate::Result<Option<VaultNoteRow>> {
    let row: Option<NoteTuple> =
        sqlx::query_as(&format!("SELECT {NOTE_COLS} FROM vault_notes WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(row_to_note))
}

/// Live (non-tombstoned) notes, newest first.
pub async fn list_notes(pool: &SqlitePool) -> crate::Result<Vec<VaultNoteSummary>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, path, title, updated_at FROM vault_notes
         WHERE deleted_at IS NULL ORDER BY path",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at })
        .collect())
}

pub async fn indexed_files(pool: &SqlitePool) -> crate::Result<HashMap<String, IndexedFile>> {
    let rows: Vec<(String, Option<String>, i64, Option<String>)> = sqlx::query_as(
        "SELECT path, hash, size, mtime FROM vault_notes WHERE deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(path, hash, size, mtime)| {
            (path, IndexedFile { hash: hash.unwrap_or_default(), size, mtime })
        })
        .collect())
}

/// Index (or re-index) one note. Reuses the existing row id for a given path
/// so note identity survives edits, re-scans, and Turso round-trips.
pub async fn upsert_note(
    pool: &SqlitePool,
    path: &str,
    content: &str,
    mtime: Option<&str>,
    size: i64,
    hash: &str,
) -> crate::Result<String> {
    let existing = get_note_by_path(pool, path).await?;
    let id = existing
        .as_ref()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let is_new = existing.is_none();

    let parsed = parse_note(path, content);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Log BEFORE writing the row, and propagate the error rather than
    // swallowing it. The scanner skips any file whose stored hash matches the
    // file on disk, so a row written with its new hash but no sync_log entry
    // would be treated as up to date forever and never replicate. Logging
    // first means a failed append leaves the old hash in place and the next
    // scan retries the note. The reverse failure — logged, then the write
    // fails — is benign: the snapshot carries the correct content, and the
    // next scan re-indexes because the stored hash is still stale.
    let row = VaultNoteRow {
        id: id.clone(),
        path: path.to_string(),
        title: parsed.title.clone(),
        content: content.to_string(),
        frontmatter_json: parsed.frontmatter_json.clone(),
        mtime: mtime.map(|s| s.to_string()),
        size,
        hash: Some(hash.to_string()),
        updated_at: now.clone(),
        deleted_at: None,
    };
    let snapshot = serde_json::to_string(&row).unwrap_or_default();
    let op = if is_new { "INSERT" } else { "UPDATE" };
    sync::append_sync_log(pool, "vault_notes", &id, op, None, Some(&snapshot)).await?;

    sqlx::query(
        "INSERT INTO vault_notes
            (id, path, title, content, frontmatter_json, mtime, size, hash, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            frontmatter_json = excluded.frontmatter_json,
            mtime = excluded.mtime,
            size = excluded.size,
            hash = excluded.hash,
            updated_at = excluded.updated_at,
            deleted_at = NULL",
    )
    .bind(&id)
    .bind(path)
    .bind(&parsed.title)
    .bind(content)
    .bind(&parsed.frontmatter_json)
    .bind(mtime)
    .bind(size)
    .bind(hash)
    .bind(&now)
    .execute(pool)
    .await?;

    replace_links(pool, &id, &parsed.links).await?;
    replace_tags(pool, &id, &parsed.tags).await?;
    refresh_fts(pool, &id, &parsed.title, content).await?;

    Ok(id)
}

/// Update only the cheap stat columns when a file's mtime/size changed but its
/// content hash did not — keeps the scanner's next pre-check fast without
/// re-parsing or generating sync traffic for a no-op edit.
pub async fn touch_stat(
    pool: &SqlitePool,
    path: &str,
    mtime: Option<&str>,
    size: i64,
) -> crate::Result<()> {
    sqlx::query("UPDATE vault_notes SET mtime = ?, size = ? WHERE path = ?")
        .bind(mtime)
        .bind(size)
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

/// Tombstone a note whose file is gone: keep the row (so the deletion
/// replicates), drop its derived rows and search entry.
pub async fn soft_delete_note(pool: &SqlitePool, path: &str) -> crate::Result<()> {
    let Some(existing) = get_note_by_path(pool, path).await? else {
        return Ok(());
    };
    if existing.deleted_at.is_some() {
        return Ok(());
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE vault_notes SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&existing.id)
        .execute(pool)
        .await?;

    clear_derived(pool, &existing.id).await?;

    let row = VaultNoteRow {
        deleted_at: Some(now.clone()),
        updated_at: now,
        ..existing
    };
    let snapshot = serde_json::to_string(&row).unwrap_or_default();
    sync::append_sync_log(
        pool,
        "vault_notes",
        &row.id,
        "UPDATE",
        Some(r#"["deleted_at"]"#),
        Some(&snapshot),
    )
    .await
    .ok();

    Ok(())
}

/// FTS5 query. The user's raw input is quoted so that Obsidian-ish text
/// ("journal/2026", "note-name") can't blow up as FTS operator syntax.
pub async fn search(pool: &SqlitePool, query: &str, limit: i64) -> crate::Result<Vec<VaultSearchHit>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let quoted = format!("\"{}\"", trimmed.replace('"', "\"\""));

    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT n.id, n.path, n.title, snippet(vault_fts, 2, '', '', '…', 12)
         FROM vault_fts
         JOIN vault_notes n ON n.id = vault_fts.note_id
         WHERE vault_fts MATCH ? AND n.deleted_at IS NULL
         ORDER BY rank
         LIMIT ?",
    )
    .bind(&quoted)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, path, title, snippet)| VaultSearchHit { id, path, title, snippet })
        .collect())
}

/// Notes that link to the given note. A wikilink target is stored verbatim
/// minus its fragment, so the same note can be referenced three ways:
/// `[[a/Beta.md]]` (full path), `[[a/Beta]]` (extension-less path — Obsidian's
/// "absolute path in vault" form), and `[[Beta]]` (filename stem, the common
/// case). Match all three, plus the note's title, so this stays symmetric with
/// `resolve_link` — a link that resolves forward must resolve backward.
pub async fn backlinks(pool: &SqlitePool, path: &str) -> crate::Result<Vec<VaultNoteSummary>> {
    let stem = crate::vault::parser::title_from_path(path);
    let without_ext = path.trim_end_matches(".md").to_string();
    let title: Option<String> =
        sqlx::query_scalar("SELECT title FROM vault_notes WHERE path = ? AND deleted_at IS NULL")
            .bind(path)
            .fetch_optional(pool)
            .await?;

    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT n.id, n.path, n.title, n.updated_at
         FROM vault_links l
         JOIN vault_notes n ON n.id = l.from_note_id
         WHERE (l.to_path = ? OR l.to_path = ? OR l.to_path = ? OR l.to_path = ?)
           AND n.deleted_at IS NULL
         ORDER BY n.path",
    )
    .bind(path)
    .bind(&without_ext)
    .bind(&stem)
    .bind(title.as_deref().unwrap_or(""))
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at })
        .collect())
}

/// Resolve a wikilink target to a note: exact path first, then filename stem,
/// then title. `None` means an unresolved link (UI offers to create the note).
pub async fn resolve_link(pool: &SqlitePool, to_path: &str) -> crate::Result<Option<VaultNoteSummary>> {
    let with_ext = if to_path.ends_with(".md") {
        to_path.to_string()
    } else {
        format!("{to_path}.md")
    };
    let stem = crate::vault::parser::title_from_path(to_path);

    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, path, title, updated_at FROM vault_notes
         WHERE deleted_at IS NULL
           AND (path = ? OR path = ? OR path LIKE ? OR title = ?)
         ORDER BY LENGTH(path)
         LIMIT 1",
    )
    .bind(to_path)
    .bind(&with_ext)
    .bind(format!("%/{with_ext}"))
    .bind(&stem)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at }))
}

/// Called from the Turso pull loop after a remote row lands locally. Only the
/// FTS entry is reconciled here — links and tags are re-derived by the Mac when
/// it re-parses the file, which is the path every real edit takes.
pub async fn on_turso_row_applied(pool: &SqlitePool, table_name: &str, row_id: &str) {
    if table_name != "vault_notes" {
        return;
    }
    if let Err(e) = reconcile_fts(pool, row_id).await {
        log::warn!("vault FTS reconcile failed for {row_id}: {e}");
    }
}

async fn reconcile_fts(pool: &SqlitePool, note_id: &str) -> crate::Result<()> {
    let Some(row) = get_note(pool, note_id).await? else {
        sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
            .bind(note_id)
            .execute(pool)
            .await?;
        return Ok(());
    };
    if row.deleted_at.is_some() {
        sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
            .bind(note_id)
            .execute(pool)
            .await?;
        return Ok(());
    }
    refresh_fts(pool, &row.id, &row.title, &row.content).await
}

// ── Derived-row helpers ──

/// Link/tag ids are deterministic (`{note_id}:l{index}`) so a re-index rewrites
/// the same rows instead of churning sync_log with delete/insert pairs.
async fn replace_links(
    pool: &SqlitePool,
    note_id: &str,
    links: &[crate::vault::parser::ParsedLink],
) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_links", "from_note_id", note_id, links.len(), 'l').await?;
    for (i, link) in links.iter().enumerate() {
        let id = format!("{note_id}:l{i}");
        sqlx::query(
            "INSERT INTO vault_links (id, from_note_id, to_path, link_type) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET to_path = excluded.to_path, link_type = excluded.link_type",
        )
        .bind(&id)
        .bind(note_id)
        .bind(&link.to_path)
        .bind(&link.link_type)
        .execute(pool)
        .await?;

        let snapshot = serde_json::json!({
            "id": id,
            "from_note_id": note_id,
            "to_path": link.to_path,
            "link_type": link.link_type,
        })
        .to_string();
        sync::append_sync_log(pool, "vault_links", &id, "UPDATE", None, Some(&snapshot))
            .await
            .ok();
    }
    Ok(())
}

async fn replace_tags(pool: &SqlitePool, note_id: &str, tags: &[String]) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_tags", "note_id", note_id, tags.len(), 't').await?;
    for (i, tag) in tags.iter().enumerate() {
        let id = format!("{note_id}:t{i}");
        sqlx::query(
            "INSERT INTO vault_tags (id, note_id, tag) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET tag = excluded.tag",
        )
        .bind(&id)
        .bind(note_id)
        .bind(tag)
        .execute(pool)
        .await?;

        let snapshot =
            serde_json::json!({ "id": id, "note_id": note_id, "tag": tag }).to_string();
        sync::append_sync_log(pool, "vault_tags", &id, "UPDATE", None, Some(&snapshot))
            .await
            .ok();
    }
    Ok(())
}

/// Remove derived rows whose deterministic index is past the current count
/// (i.e. the note shed links/tags since the last index).
async fn delete_derived_beyond(
    pool: &SqlitePool,
    table: &str,
    owner_col: &str,
    note_id: &str,
    keep: usize,
    marker: char,
) -> crate::Result<()> {
    let ids: Vec<(String,)> = sqlx::query_as(&format!(
        "SELECT id FROM {table} WHERE {owner_col} = ?"
    ))
    .bind(note_id)
    .fetch_all(pool)
    .await?;

    for (id,) in ids {
        let index: Option<usize> = id
            .rsplit_once(&format!(":{marker}"))
            .and_then(|(_, n)| n.parse().ok());
        if index.map(|i| i >= keep).unwrap_or(true) {
            sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
                .bind(&id)
                .execute(pool)
                .await?;
            sync::append_sync_log(pool, table, &id, "DELETE", None, None).await.ok();
        }
    }
    Ok(())
}

async fn clear_derived(pool: &SqlitePool, note_id: &str) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_links", "from_note_id", note_id, 0, 'l').await?;
    delete_derived_beyond(pool, "vault_tags", "note_id", note_id, 0, 't').await?;
    sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
        .bind(note_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn refresh_fts(
    pool: &SqlitePool,
    note_id: &str,
    title: &str,
    content: &str,
) -> crate::Result<()> {
    sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
        .bind(note_id)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO vault_fts (note_id, title, content) VALUES (?, ?, ?)")
        .bind(note_id)
        .bind(title)
        .bind(content)
        .execute(pool)
        .await?;
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core vault::index`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add daily-triage-core/src/vault/index.rs
git commit -m "feat: vault index — upsert, tombstones, FTS, backlinks, sync_log"
```

---

### Task 5: Vault scanner — full walk with mtime/size pre-check and blake3 confirm

**Files:**
- Modify: `daily-triage-core/src/vault/scanner.rs` (currently empty)

**Interfaces:**
- Consumes: `crate::vault::{VaultConfig, is_indexable, rel_path}`, `crate::vault::index::{indexed_files, upsert_note, touch_stat, soft_delete_note}`.
- Produces:
  - `pub struct ScanReport { pub scanned: usize, pub indexed: usize, pub unchanged: usize, pub removed: usize, pub skipped: usize }` (serde-serializable, returned to the frontend)
  - `pub async fn full_scan(pool: &SqlitePool, cfg: &VaultConfig) -> crate::Result<ScanReport>`
  - `pub async fn index_one(pool: &SqlitePool, cfg: &VaultConfig, abs: &Path) -> crate::Result<bool>`
  - `pub fn is_dataless(path: &Path) -> bool`
  - `pub fn hash_content(content: &str) -> String`

- [ ] **Step 1: Write the failing test**

Add to `daily-triage-core/src/vault/scanner.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;
    use crate::vault::VaultConfig;

    fn temp_vault() -> (std::path::PathBuf, VaultConfig) {
        let root = std::env::temp_dir().join(format!("dt-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("journal")).unwrap();
        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        let cfg = VaultConfig {
            root: root.clone(),
            excludes: crate::vault::DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
        };
        (root, cfg)
    }

    #[tokio::test]
    async fn scan_indexes_markdown_and_skips_excluded_and_binary() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("journal/Brief.md"), "# Brief\n\n[[Other]]\n").unwrap();
        std::fs::write(root.join("Root Note.md"), "plain body").unwrap();
        std::fs::write(root.join(".obsidian/workspace.json"), "{}").unwrap();
        std::fs::write(root.join("attachments/photo.png"), [0u8, 1, 2]).unwrap();

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 2, "{report:?}");
        assert_eq!(report.removed, 0);

        let notes = crate::vault::index::list_notes(&pool).await.unwrap();
        let paths: Vec<&str> = notes.iter().map(|n| n.path.as_str()).collect();
        assert_eq!(paths, vec!["Root Note.md", "journal/Brief.md"]);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn rescan_skips_unchanged_files_and_tombstones_deleted_ones() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("A.md"), "# A").unwrap();
        std::fs::write(root.join("B.md"), "# B").unwrap();
        full_scan(&pool, &cfg).await.unwrap();

        std::fs::remove_file(root.join("B.md")).unwrap();
        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.unchanged, 1, "A.md untouched: {report:?}");
        assert_eq!(report.indexed, 0);
        assert_eq!(report.removed, 1);

        let live: Vec<String> = crate::vault::index::list_notes(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|n| n.path)
            .collect();
        assert_eq!(live, vec!["A.md".to_string()]);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn changed_content_reindexes_and_keeps_note_id() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("A.md"), "# First").unwrap();
        full_scan(&pool, &cfg).await.unwrap();
        let before = crate::vault::index::get_note_by_path(&pool, "A.md").await.unwrap().unwrap();

        std::fs::write(root.join("A.md"), "# Second\n\nmore text").unwrap();
        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 1, "{report:?}");

        let after = crate::vault::index::get_note_by_path(&pool, "A.md").await.unwrap().unwrap();
        assert_eq!(after.id, before.id);
        assert_eq!(after.title, "Second");
        assert_ne!(after.hash, before.hash);

        std::fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn unreadable_file_is_skipped_not_fatal() {
        let pool = test_pool().await;
        let (root, cfg) = temp_vault();
        std::fs::write(root.join("Good.md"), "# Good").unwrap();
        // Invalid UTF-8 makes read_to_string fail — stands in for any per-file
        // read error (dataless iCloud file, permissions, race with a delete).
        std::fs::write(root.join("Bad.md"), [0xff, 0xfe, 0xfd]).unwrap();

        let report = full_scan(&pool, &cfg).await.unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(report.skipped, 1, "{report:?}");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn hash_is_stable_and_content_sensitive() {
        assert_eq!(hash_content("abc"), hash_content("abc"));
        assert_ne!(hash_content("abc"), hash_content("abd"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault::scanner`
Expected: FAIL — `cannot find function full_scan in this scope`.

- [ ] **Step 3: Write the implementation**

Put this above the test module in `daily-triage-core/src/vault/scanner.rs`:

```rust
use sqlx::SqlitePool;
use std::path::Path;
use walkdir::WalkDir;

use crate::vault::{index, is_indexable, rel_path, VaultConfig};

/// macOS `SF_DATALESS`: the file is an iCloud placeholder whose contents live
/// in the cloud. Reading it would trigger a download, so the scanner treats it
/// as pending and skips it rather than materialising Marco's whole vault.
const SF_DATALESS: u32 = 0x4000_0000;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ScanReport {
    /// Markdown files considered (after exclusions).
    pub scanned: usize,
    /// Files whose content changed and were (re-)indexed.
    pub indexed: usize,
    /// Files already indexed with identical content.
    pub unchanged: usize,
    /// Indexed notes whose file no longer exists — tombstoned.
    pub removed: usize,
    /// Files skipped this pass (unreadable, dataless, non-UTF-8).
    pub skipped: usize,
}

pub fn hash_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

/// True when the file is an iCloud placeholder with no local content.
pub fn is_dataless(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        if let Ok(md) = std::fs::metadata(path) {
            return md.st_flags() & SF_DATALESS != 0;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
    false
}

fn mtime_string(md: &std::fs::Metadata) -> Option<String> {
    md.modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
}

/// Walk the whole vault and reconcile the index with the filesystem.
///
/// Cheap path: a file whose size *and* mtime match the index is not read at
/// all. Otherwise the file is read and hashed; only a changed hash triggers a
/// re-parse. Per-file errors are logged and counted, never fatal — one
/// unreadable note must not break the scan.
pub async fn full_scan(pool: &SqlitePool, cfg: &VaultConfig) -> crate::Result<ScanReport> {
    if !cfg.root.is_dir() {
        return Err(crate::Error::Other(format!(
            "Vault path is not a directory: {}",
            cfg.root.display()
        )));
    }

    let mut report = ScanReport::default();
    let known = index::indexed_files(pool).await?;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for entry in WalkDir::new(&cfg.root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let Some(rel) = rel_path(&cfg.root, abs) else { continue };
        if !is_indexable(&rel, &cfg.excludes) {
            continue;
        }
        report.scanned += 1;
        seen.insert(rel.clone());

        if is_dataless(abs) {
            log::info!("vault scan: skipping dataless (iCloud) file {rel}");
            report.skipped += 1;
            continue;
        }

        let md = match std::fs::metadata(abs) {
            Ok(md) => md,
            Err(e) => {
                log::warn!("vault scan: cannot stat {rel}: {e}");
                report.skipped += 1;
                continue;
            }
        };
        let size = md.len() as i64;
        let mtime = mtime_string(&md);

        if let Some(prev) = known.get(&rel) {
            if prev.size == size && prev.mtime == mtime {
                report.unchanged += 1;
                continue;
            }
        }

        let content = match tokio::fs::read_to_string(abs).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!("vault scan: cannot read {rel}: {e}");
                report.skipped += 1;
                continue;
            }
        };
        let hash = hash_content(&content);

        if let Some(prev) = known.get(&rel) {
            if prev.hash == hash {
                // Touched but identical (e.g. an Obsidian save that rewrote the
                // same bytes). Refresh the stat columns so the next scan takes
                // the cheap path, and generate no sync traffic.
                index::touch_stat(pool, &rel, mtime.as_deref(), size).await?;
                report.unchanged += 1;
                continue;
            }
        }

        index::upsert_note(pool, &rel, &content, mtime.as_deref(), size, &hash).await?;
        report.indexed += 1;
    }

    for path in known.keys() {
        if !seen.contains(path) {
            index::soft_delete_note(pool, path).await?;
            report.removed += 1;
        }
    }

    Ok(report)
}

/// Index a single absolute path (used by the watcher). Returns `Ok(false)` when
/// the path is not an indexable vault file. A path that no longer exists is
/// tombstoned.
pub async fn index_one(pool: &SqlitePool, cfg: &VaultConfig, abs: &Path) -> crate::Result<bool> {
    let Some(rel) = rel_path(&cfg.root, abs) else { return Ok(false) };
    if !is_indexable(&rel, &cfg.excludes) {
        return Ok(false);
    }

    if !abs.exists() {
        index::soft_delete_note(pool, &rel).await?;
        return Ok(true);
    }
    if is_dataless(abs) {
        log::info!("vault watch: skipping dataless (iCloud) file {rel}");
        return Ok(false);
    }

    let md = std::fs::metadata(abs)?;
    let size = md.len() as i64;
    let mtime = mtime_string(&md);
    let content = match tokio::fs::read_to_string(abs).await {
        Ok(c) => c,
        Err(e) => {
            log::warn!("vault watch: cannot read {rel}: {e}");
            return Ok(false);
        }
    };
    let hash = hash_content(&content);

    if let Some(existing) = index::get_note_by_path(pool, &rel).await? {
        if existing.hash.as_deref() == Some(hash.as_str()) && existing.deleted_at.is_none() {
            index::touch_stat(pool, &rel, mtime.as_deref(), size).await?;
            return Ok(false);
        }
    }

    index::upsert_note(pool, &rel, &content, mtime.as_deref(), size, &hash).await?;
    Ok(true)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core vault::scanner`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add daily-triage-core/src/vault/scanner.rs
git commit -m "feat: vault scanner — full walk, stat pre-check, blake3 confirm, tombstones"
```

---

### Task 6: Vault writer — atomic edit-in-place with conflict copies

**Files:**
- Modify: `daily-triage-core/src/vault/writer.rs` (currently empty)

**Interfaces:**
- Consumes: `crate::vault::{VaultConfig, is_indexable}`, `crate::vault::scanner::hash_content`.
- Produces:
  - `pub enum WriteOutcome { Written { hash: String }, Conflict { conflict_path: String, disk_hash: String } }`
  - `pub async fn write_note(cfg: &VaultConfig, rel: &str, content: &str, expected_hash: Option<&str>) -> crate::Result<WriteOutcome>`
  - `pub async fn create_note(cfg: &VaultConfig, rel: &str, content: &str) -> crate::Result<String>`

- [ ] **Step 1: Write the failing test**

Add to `daily-triage-core/src/vault/writer.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::scanner::hash_content;
    use crate::vault::VaultConfig;

    fn temp_vault() -> VaultConfig {
        let root = std::env::temp_dir().join(format!("dt-vaultw-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        VaultConfig {
            root,
            excludes: crate::vault::DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[tokio::test]
    async fn matching_hash_writes_in_place_and_leaves_no_temp_files() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "old body").unwrap();
        let expected = hash_content("old body");

        let outcome = write_note(&cfg, "A.md", "new body", Some(&expected)).await.unwrap();
        match outcome {
            WriteOutcome::Written { hash } => assert_eq!(hash, hash_content("new body")),
            other => panic!("expected Written, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new body");

        let leftovers: Vec<_> = std::fs::read_dir(&cfg.root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn diverged_hash_writes_conflict_copy_and_never_overwrites() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "changed on disk by obsidian").unwrap();
        let stale = hash_content("what the app last read");

        let outcome = write_note(&cfg, "A.md", "app version", Some(&stale)).await.unwrap();
        let conflict_path = match outcome {
            WriteOutcome::Conflict { conflict_path, .. } => conflict_path,
            other => panic!("expected Conflict, got {other:?}"),
        };

        // Original file is untouched — this is the whole point.
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "changed on disk by obsidian"
        );
        let conflict_abs = cfg.root.join(&conflict_path);
        assert_eq!(std::fs::read_to_string(&conflict_abs).unwrap(), "app version");
        assert!(conflict_path.contains("(conflict "), "got {conflict_path}");
        assert!(conflict_path.ends_with(".md"));

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn unreadable_file_is_never_overwritten() {
        // A note that exists but can't be read — an iCloud-evicted placeholder,
        // a permissions problem, non-UTF-8 content — must not be treated as
        // absent. Non-UTF-8 bytes stand in for the whole class, the same way
        // scanner.rs's `unreadable_file_is_skipped_not_fatal` does.
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        let original: [u8; 3] = [0xff, 0xfe, 0xfd];
        std::fs::write(&path, original).unwrap();

        // With an expected hash: refuses, leaves the bytes alone.
        let err = write_note(&cfg, "A.md", "app version", Some("some-stale-hash"))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("refusing to overwrite"), "got: {err}");
        assert_eq!(std::fs::read(&path).unwrap(), original);

        // And without one: a forced write must not clobber it either.
        assert!(write_note(&cfg, "A.md", "app version", None).await.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn same_second_conflicts_do_not_destroy_each_other() {
        let cfg = temp_vault();
        let path = cfg.root.join("A.md");
        std::fs::write(&path, "on disk").unwrap();
        let stale = hash_content("what the app last read");

        let first = write_note(&cfg, "A.md", "first app version", Some(&stale)).await.unwrap();
        let second = write_note(&cfg, "A.md", "second app version", Some(&stale)).await.unwrap();

        let (p1, p2) = match (first, second) {
            (WriteOutcome::Conflict { conflict_path: a, .. }, WriteOutcome::Conflict { conflict_path: b, .. }) => (a, b),
            other => panic!("expected two conflicts, got {other:?}"),
        };
        assert_ne!(p1, p2, "second conflict must not reuse the first filename");
        assert_eq!(std::fs::read_to_string(cfg.root.join(&p1)).unwrap(), "first app version");
        assert_eq!(std::fs::read_to_string(cfg.root.join(&p2)).unwrap(), "second app version");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "on disk");

        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn no_expected_hash_writes_unconditionally() {
        let cfg = temp_vault();
        std::fs::write(cfg.root.join("A.md"), "old").unwrap();
        let outcome = write_note(&cfg, "A.md", "forced", None).await.unwrap();
        assert!(matches!(outcome, WriteOutcome::Written { .. }));
        assert_eq!(std::fs::read_to_string(cfg.root.join("A.md")).unwrap(), "forced");
        std::fs::remove_dir_all(&cfg.root).ok();
    }

    #[tokio::test]
    async fn create_note_makes_parent_dirs_and_refuses_duplicates_and_escapes() {
        let cfg = temp_vault();
        let hash = create_note(&cfg, "journal/new/Note.md", "# Note\n").await.unwrap();
        assert_eq!(hash, hash_content("# Note\n"));
        assert!(cfg.root.join("journal/new/Note.md").exists());

        assert!(create_note(&cfg, "journal/new/Note.md", "x").await.is_err(), "no clobber");
        assert!(create_note(&cfg, "../escape.md", "x").await.is_err(), "no path escape");
        assert!(create_note(&cfg, "notes/thing.txt", "x").await.is_err(), "markdown only");

        std::fs::remove_dir_all(&cfg.root).ok();
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault::writer`
Expected: FAIL — `cannot find function write_note in this scope`.

- [ ] **Step 3: Write the implementation**

Put this above the test module in `daily-triage-core/src/vault/writer.rs`:

```rust
use std::path::{Path, PathBuf};

use crate::vault::scanner::hash_content;
use crate::vault::{is_indexable, VaultConfig};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WriteOutcome {
    /// The file was replaced atomically; `hash` is the new content hash and
    /// becomes the caller's next `expected_hash`.
    Written { hash: String },
    /// The file on disk changed since the app read it. The app's version was
    /// written beside it as `conflict_path` (vault-relative) and the original
    /// was left exactly as-is.
    Conflict { conflict_path: String, disk_hash: String },
}

/// Resolve a vault-relative path to an absolute one, refusing anything that
/// escapes the vault root or isn't an indexable markdown file.
fn resolve(cfg: &VaultConfig, rel: &str) -> crate::Result<PathBuf> {
    if rel.trim().is_empty() {
        return Err(crate::Error::Other("Empty note path".into()));
    }
    if rel.split('/').any(|seg| seg == ".." || seg == ".") || rel.starts_with('/') {
        return Err(crate::Error::Other(format!("Unsafe note path: {rel}")));
    }
    if !is_indexable(rel, &cfg.excludes) {
        return Err(crate::Error::Other(format!(
            "Not an editable vault note (markdown only, not excluded): {rel}"
        )));
    }
    Ok(cfg.root.join(rel))
}

/// Hash of whatever is currently on disk.
///
/// `Ok(None)` means the file genuinely does not exist — safe to create.
/// `Err` means it exists but could not be read: an iCloud-evicted (dataless)
/// note, a permissions problem, or non-UTF-8 content. That case must never
/// collapse into `None`: the caller's divergence check would not fire and it
/// would overwrite a note whose contents we were unable to compare.
async fn read_disk_hash(abs: &Path) -> crate::Result<Option<String>> {
    match tokio::fs::read_to_string(abs).await {
        Ok(c) => Ok(Some(hash_content(&c))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(crate::Error::Other(format!(
            "Can't read {} to check for outside edits ({e}) — refusing to overwrite it.",
            abs.display()
        ))),
    }
}

/// Create a file that must not already exist, failing with
/// `ErrorKind::AlreadyExists` if it does. Exclusive creation is atomic in the
/// filesystem, unlike an `exists()` check followed by a write — which loses to
/// anything that creates the file in between (Obsidian, a sync daemon).
async fn write_new(abs: &Path, content: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;
    if let Some(parent) = abs.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(abs)
        .await?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;
    Ok(())
}

/// Write `content` to a vault note, atomically (temp file + rename) and only
/// when the file on disk still matches `expected_hash`.
///
/// Divergence never overwrites: the app's version lands in
/// `<stem> (conflict <timestamp>).md` beside the original and the caller
/// surfaces a non-blocking banner. The watcher then re-indexes both files.
pub async fn write_note(
    cfg: &VaultConfig,
    rel: &str,
    content: &str,
    expected_hash: Option<&str>,
) -> crate::Result<WriteOutcome> {
    let abs = resolve(cfg, rel)?;
    let disk_hash = read_disk_hash(&abs).await?;

    if let (Some(expected), Some(actual)) = (expected_hash, disk_hash.as_deref()) {
        if expected != actual {
            // The conflict copy is created exclusively and its name is
            // disambiguated on collision: the timestamp has one-second
            // resolution, and a plain rename would silently destroy an earlier
            // conflict copy — the file holding the user's other unsaved version.
            let stem = rel.trim_end_matches(".md");
            let stamp = chrono::Local::now().format("%Y-%m-%d %H%M%S").to_string();
            let mut attempt = 1;
            let conflict_rel = loop {
                let candidate = if attempt == 1 {
                    format!("{stem} (conflict {stamp}).md")
                } else {
                    format!("{stem} (conflict {stamp} {attempt}).md")
                };
                match write_new(&cfg.root.join(&candidate), content).await {
                    Ok(()) => break candidate,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        attempt += 1;
                        if attempt > 50 {
                            return Err(crate::Error::Other(format!(
                                "Too many conflict copies of {rel} in the same second"
                            )));
                        }
                    }
                    Err(e) => return Err(e.into()),
                }
            };
            log::warn!("vault write conflict on {rel} — app copy saved as {conflict_rel}");
            return Ok(WriteOutcome::Conflict {
                conflict_path: conflict_rel,
                disk_hash: actual.to_string(),
            });
        }
    }

    atomic_write(&abs, content).await?;
    Ok(WriteOutcome::Written { hash: hash_content(content) })
}

/// Create a new note, making parent directories as needed. Errors if the file
/// already exists — creation never clobbers. The exclusivity comes from the
/// filesystem (`create_new`), not from a preceding `exists()` check, so a file
/// that appears in the meantime is respected rather than overwritten.
pub async fn create_note(cfg: &VaultConfig, rel: &str, content: &str) -> crate::Result<String> {
    let abs = resolve(cfg, rel)?;
    match write_new(&abs, content).await {
        Ok(()) => Ok(hash_content(content)),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(crate::Error::Other(format!("Note already exists: {rel}")))
        }
        Err(e) => Err(e.into()),
    }
}

/// Write via a temp file in the same directory followed by a rename, so a
/// crash mid-write can never leave a half-written note on disk.
async fn atomic_write(abs: &Path, content: &str) -> crate::Result<()> {
    let parent = abs
        .parent()
        .ok_or_else(|| crate::Error::Other(format!("No parent directory for {}", abs.display())))?;
    tokio::fs::create_dir_all(parent).await?;

    let file_name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "note.md".to_string());
    let tmp = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));

    if let Err(e) = tokio::fs::write(&tmp, content).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    if let Err(e) = tokio::fs::rename(&tmp, abs).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    Ok(())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core vault::writer`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add daily-triage-core/src/vault/writer.rs
git commit -m "feat: vault writer — atomic edit-in-place with conflict copies"
```

---

### Task 7: Vault watcher — debounced filesystem events

**Files:**
- Modify: `daily-triage-core/src/vault/watcher.rs` (currently empty)

**Interfaces:**
- Consumes: `notify`, `notify_debouncer_full`.
- Produces:
  - `pub struct VaultWatcher { _debouncer: Debouncer<RecommendedWatcher, RecommendedCache> }`
  - `pub fn spawn<F>(root: &Path, on_paths: F) -> notify::Result<VaultWatcher> where F: Fn(Vec<PathBuf>) + Send + 'static`

The exact API shape below is compile-verified against `notify` 8.2.0 + `notify-debouncer-full` 0.6.0: `new_debouncer(Duration, Option<Duration>, tx)` where `tx: std::sync::mpsc::Sender<DebounceEventResult>`, then `debouncer.watch(path, RecursiveMode::Recursive)`, with each `DebouncedEvent` exposing `.paths` and `.kind`. **The returned `VaultWatcher` must be kept alive** — dropping it stops the watch.

- [ ] **Step 1: Write the failing test**

Add to `daily-triage-core/src/vault/watcher.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn watcher_reports_changed_paths_within_the_debounce_window() {
        let root = std::env::temp_dir().join(format!("dt-vaultwatch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();

        let seen: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let _watcher = spawn(&root, move |paths| {
            sink.lock().unwrap().extend(paths);
        })
        .expect("watcher spawns");

        std::thread::sleep(std::time::Duration::from_millis(200));
        std::fs::write(root.join("Note.md"), "# hello").unwrap();

        // Debounce is 500ms; allow generous slack for CI/filesystem latency.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let hit = seen
                .lock()
                .unwrap()
                .iter()
                .any(|p| p.file_name().map(|n| n == "Note.md").unwrap_or(false));
            if hit {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "watcher never reported Note.md");
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        std::fs::remove_dir_all(&root).ok();
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault::watcher`
Expected: FAIL — `cannot find function spawn in this scope`.

- [ ] **Step 3: Write the implementation**

Put this above the test module in `daily-triage-core/src/vault/watcher.rs`:

```rust
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Debounce window: Obsidian writes a note as several rapid filesystem events;
/// 500ms coalesces them into one re-index.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// Live filesystem watch over the vault root. **Must be held** for the watch to
/// stay active — dropping this struct stops the watcher.
pub struct VaultWatcher {
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// Start watching `root` recursively. `on_paths` is invoked on a dedicated
/// background thread with the de-duplicated set of changed paths from each
/// debounced batch. Watch errors are logged and the watcher keeps running —
/// a transient error must not silently kill indexing.
pub fn spawn<F>(root: &Path, on_paths: F) -> notify::Result<VaultWatcher>
where
    F: Fn(Vec<PathBuf>) + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel::<DebounceEventResult>();
    let mut debouncer = new_debouncer(DEBOUNCE, None, tx)?;
    debouncer.watch(root, RecursiveMode::Recursive)?;

    std::thread::spawn(move || {
        for result in rx {
            match result {
                Ok(events) => {
                    let mut paths: Vec<PathBuf> = Vec::new();
                    for event in events {
                        for path in &event.paths {
                            if !paths.contains(path) {
                                paths.push(path.clone());
                            }
                        }
                    }
                    if !paths.is_empty() {
                        on_paths(paths);
                    }
                }
                Err(errors) => {
                    for e in errors {
                        log::warn!("vault watcher error (watch continues): {e}");
                    }
                }
            }
        }
        log::info!("vault watcher channel closed — watch thread exiting");
    });

    Ok(VaultWatcher { _debouncer: debouncer })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p daily-triage-core vault::watcher -- --nocapture`
Expected: PASS. (This test touches the real filesystem and takes up to ~1s.)

- [ ] **Step 5: Run the whole core suite**

Run: `cargo test -p daily-triage-core`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add daily-triage-core/src/vault/watcher.rs
git commit -m "feat: vault watcher — debounced filesystem events"
```

---

### Task 8: Turso replication for vault tables (Mac side)

**Files:**
- Modify: `daily-triage-core/src/db/sync.rs` — `initialize_remote` create list (~line 320, after the `doc_notes` entry), `sanitize_table_name` ALLOWED list (line 861-877), `seed_existing_data` table list (line 946-950), `push` (line 546-551), and the pull loop (line 743-756)
- Modify: `daily-triage-core/src/vault/index.rs` (no change if Task 4 already added `on_turso_row_applied` — verify)

**Interfaces:**
- Consumes: `crate::vault::index::on_turso_row_applied`.
- Produces: `vault_notes` / `vault_links` / `vault_tags` replicate through the existing sync_log pipeline; new gate setting `turso_schema_v18_upgraded`.

- [ ] **Step 1: Write the failing test**

Add to the existing test area at the bottom of `daily-triage-core/src/db/sync.rs` (create the module if there isn't one):

```rust
#[cfg(test)]
mod vault_sync_tests {
    use crate::test_util::test_pool;

    #[test]
    fn vault_tables_are_allowed_for_sync() {
        for table in ["vault_notes", "vault_links", "vault_tags"] {
            assert!(
                super::sanitize_table_name(table).is_ok(),
                "{table} must be sync-allowed"
            );
        }
        assert!(super::sanitize_table_name("todoist_outbox").is_err(), "Mac-local only");
        assert!(super::sanitize_table_name("vault_fts").is_err(), "device-local only");
    }

    #[test]
    fn vault_note_snapshot_builds_a_valid_insert() {
        let snapshot = serde_json::json!({
            "id": "n1",
            "path": "journal/A.md",
            "title": "A",
            "content": "body",
            "frontmatter_json": serde_json::Value::Null,
            "mtime": "2026-08-04T10:00:00Z",
            "size": 4,
            "hash": "abc",
            "updated_at": "2026-08-04 10:00:00",
            "deleted_at": serde_json::Value::Null,
        })
        .to_string();

        let reqs = super::build_data_mutation_requests(
            "vault_notes",
            "n1",
            "INSERT",
            &Some(snapshot),
        );
        assert_eq!(reqs.len(), 1);
        let sql = reqs[0].pointer("/stmt/sql").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(sql.starts_with("INSERT OR REPLACE INTO vault_notes"), "got {sql}");
    }

    #[tokio::test]
    async fn seed_existing_data_covers_vault_notes() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO vault_notes (id, path, title, content) VALUES ('n1', 'a.md', 'A', 'body')",
        )
        .execute(&pool)
        .await
        .unwrap();

        super::seed_existing_data(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'vault_notes' AND row_id = 'n1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p daily-triage-core vault_sync_tests`
Expected: FAIL — `vault_notes must be sync-allowed`.

- [ ] **Step 3: Add the three tables to the sync allowlist**

In `daily-triage-core/src/db/sync.rs`, extend the `ALLOWED` const inside `sanitize_table_name` (line 861) so it ends:

```rust
        "capture_routes",
        "life_areas",
        "calendar_feeds",
        "vault_notes",
        "vault_links",
        "vault_tags",
    ];
```

`vault_fts` is deliberately absent — the FTS index is device-local and rebuilt per device.

- [ ] **Step 4: Add them to `seed_existing_data`**

In the same file, extend `tables_with_id` (line 946):

```rust
    let tables_with_id = [
        "local_tasks", "projects", "captures", "goals", "milestones",
        "habits", "habit_logs", "documents", "doc_folders", "doc_notes",
        "capture_routes", "life_areas", "calendar_feeds", "activity_log",
        "vault_notes", "vault_links", "vault_tags",
    ];
```

- [ ] **Step 5: Define the vault DDL once and use it for fresh remotes**

The same three `CREATE TABLE` statements are needed in two places (a fresh remote, and the v18 upgrade of an already-initialized one), so they live in a single constant. Add it immediately above `initialize_remote` in `daily-triage-core/src/db/sync.rs`:

```rust
/// Remote DDL for the vault tables. Used both when initializing a fresh remote
/// and when upgrading a remote that was initialized before v18 — keep it the
/// single definition so the two paths can never drift apart.
const VAULT_TABLE_DDL: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS vault_notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        frontmatter_json TEXT,
        mtime TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
    )",
    "CREATE TABLE IF NOT EXISTS vault_links (
        id TEXT PRIMARY KEY,
        from_note_id TEXT NOT NULL,
        to_path TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'wikilink',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
    "CREATE TABLE IF NOT EXISTS vault_tags (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
];
```

Then wire it into `initialize_remote`. Change the binding at line 180 from `let create_statements = vec![` to `let mut create_statements = vec![`, and immediately after the vector literal closes (before the code that turns it into pipeline requests) add:

```rust
    create_statements.extend_from_slice(&VAULT_TABLE_DDL);
```

- [ ] **Step 6: Add the v18 remote upgrade path for already-initialized remotes**

Marco's Turso database is already initialized, so `initialize_remote` short-circuits at line 170 and those CREATE statements will never run for him. Mirror the existing v17 pattern: add these two functions right after `ensure_remote_schema_upgraded` (which ends at line 461):

```rust
/// Create the vault tables on a remote that was initialized before v18.
/// `CREATE TABLE IF NOT EXISTS` is idempotent, so this is safe to retry.
/// Shares `VAULT_TABLE_DDL` with `initialize_remote` — one definition only.
async fn create_remote_vault_tables(turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let mut requests: Vec<serde_json::Value> =
        VAULT_TABLE_DDL.iter().map(|sql| turso_execute(sql, vec![])).collect();
    requests.push(serde_json::json!({ "type": "close" }));

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                log::warn!("Turso vault-table statement {i} failed: {err_msg}");
                return Err(crate::Error::Api(format!(
                    "Turso vault schema upgrade failed: {err_msg}"
                )));
            }
        }
    }

    Ok(())
}

/// Gate the v18 remote upgrade behind a local setting so it hits Turso once per
/// device. If it fails the setting is never written, so the next push retries.
async fn ensure_remote_vault_schema(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
) -> crate::Result<()> {
    let done: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'turso_schema_v18_upgraded'")
            .fetch_optional(pool)
            .await?;
    if done.is_some() {
        return Ok(());
    }

    create_remote_vault_tables(turso_url, turso_token).await?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('turso_schema_v18_upgraded', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .execute(pool)
    .await?;

    Ok(())
}
```

- [ ] **Step 7: Call the v18 gate from `push`**

In `push` (line 546), directly after the existing `ensure_remote_schema_upgraded(...)` call at line 550, add:

```rust
    // v18: the vault tables may not exist on a remote initialized earlier.
    ensure_remote_vault_schema(pool, turso_url, turso_token).await?;
```

- [ ] **Step 8: Hook the pull loop so search stays correct**

In `pull`, immediately after the existing Todoist observer call (line 749-756), add:

```rust
        // Vault: a note row applied from another device needs its device-local
        // FTS entry refreshed (links/tags are re-derived when the Mac re-parses
        // the file).
        crate::vault::index::on_turso_row_applied(pool, &table_name, &row_id).await;
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cargo test -p daily-triage-core vault_sync_tests`
Expected: PASS (3 tests).

- [ ] **Step 10: Run the whole core suite**

Run: `cargo test -p daily-triage-core`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add daily-triage-core/src/db/sync.rs
git commit -m "feat: replicate vault tables through Turso (Mac side)"
```

---

### Task 9: Tauri commands, watcher runtime, and TypeScript surface

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/vault.rs`
- Create: `apps/desktop/src-tauri/src/vault_runner.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (module list line 1-8, `use commands::{...}` line 20, `.setup()` block ~line 298, `invoke_handler![]` ~line 380)
- Modify: `packages/types/src/index.ts` (append after the Docs section, ~line 205)
- Modify: `apps/desktop/src/services/tauri.ts` (append after the docs wrappers, ~line 495)
- Modify: `apps/desktop/src/services/data-provider.ts` (add a `vault` slice after `docs`, ~line 213)
- Modify: `apps/desktop/src/services/tauri-provider.ts`

**Interfaces:**
- Consumes: `daily_triage_core::vault::{load_config, index, scanner, watcher, writer}`.
- Produces: commands `vault_status`, `vault_rescan`, `vault_list_notes`, `vault_get_note`, `vault_save_note`, `vault_create_note`, `vault_search`, `vault_backlinks`, `vault_resolve_link`, `vault_open_in_obsidian`; the `vault-changed` webview event; TS types `VaultNoteSummary`, `VaultNoteDetail`, `VaultSearchHit`, `VaultStatus`, `VaultScanReport`, `VaultSaveResult`; `dp.vault.*`.

- [ ] **Step 1: Add a status helper to the core vault module**

Append to `daily-triage-core/src/vault/mod.rs` (above its test module):

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultStatus {
    pub configured: bool,
    pub root: Option<String>,
    pub note_count: i64,
    pub last_scan_at: Option<String>,
    pub last_error: Option<String>,
    pub excludes: Vec<String>,
}

/// Everything the settings panel needs in one round-trip. Never errors on an
/// unconfigured vault — that's a normal, quiet state.
pub async fn status(pool: &SqlitePool) -> crate::Result<VaultStatus> {
    let cfg = load_config(pool).await?;
    let note_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM vault_notes WHERE deleted_at IS NULL")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let last_scan_at = crate::db::settings::get_setting(pool, "vault_last_scan_at").await?;
    let last_error = crate::db::settings::get_setting(pool, "vault_last_scan_error").await?;

    Ok(VaultStatus {
        configured: cfg.is_some(),
        root: cfg.as_ref().map(|c| c.root.to_string_lossy().to_string()),
        note_count,
        last_scan_at,
        last_error,
        excludes: cfg.map(|c| c.excludes).unwrap_or_else(|| {
            DEFAULT_EXCLUDES.iter().map(|s| s.to_string()).collect()
        }),
    })
}

/// Scan the vault and record the outcome in settings so the UI can show a
/// neutral status line. Returns `Ok(None)` when no vault is configured.
pub async fn scan_now(pool: &SqlitePool) -> crate::Result<Option<scanner::ScanReport>> {
    let Some(cfg) = load_config(pool).await? else { return Ok(None) };
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    match scanner::full_scan(pool, &cfg).await {
        Ok(report) => {
            crate::db::settings::set_setting(pool, "vault_last_scan_at", &now).await.ok();
            crate::db::settings::set_setting(pool, "vault_last_scan_error", "").await.ok();
            Ok(Some(report))
        }
        Err(e) => {
            crate::db::settings::set_setting(pool, "vault_last_scan_error", &e.to_string())
                .await
                .ok();
            Err(e)
        }
    }
}

/// `obsidian://open?vault=<vault folder name>&file=<note path without .md>`
pub fn obsidian_uri(cfg: &VaultConfig, rel: &str) -> String {
    let vault_name = cfg
        .root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let file = rel.trim_end_matches(".md");
    format!(
        "obsidian://open?vault={}&file={}",
        urlencode(&vault_name),
        urlencode(file)
    )
}

/// Minimal percent-encoding for the two URI components we build. Avoids adding
/// a dependency for one call site.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
```

Add this test to the `config_tests` module in the same file:

```rust
    #[test]
    fn obsidian_uri_encodes_vault_and_path() {
        let cfg = VaultConfig {
            root: std::path::PathBuf::from("/Users/marco/Obsidian/marco wits"),
            excludes: vec![],
        };
        let uri = obsidian_uri(&cfg, "journal/briefs/Brief 2026-08-04.md");
        assert_eq!(
            uri,
            "obsidian://open?vault=marco%20wits&file=journal%2Fbriefs%2FBrief%202026-08-04"
        );
    }
```

Run: `cargo test -p daily-triage-core config_tests`
Expected: PASS (5 tests).

- [ ] **Step 2: Write the Tauri command wrappers**

Create `apps/desktop/src-tauri/src/commands/vault.rs`:

```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use daily_triage_core::vault::{self, index, scanner, writer};

pub use daily_triage_core::vault::VaultStatus;
pub use daily_triage_core::vault::index::{VaultNoteRow, VaultNoteSummary, VaultSearchHit};
pub use daily_triage_core::vault::scanner::ScanReport;
pub use daily_triage_core::vault::writer::WriteOutcome;

async fn config(app: &AppHandle) -> Result<vault::VaultConfig, String> {
    let pool = app.state::<SqlitePool>();
    vault::load_config(pool.inner())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Obsidian vault path not configured".to_string())
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    let pool = app.state::<SqlitePool>();
    vault::status(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_rescan(app: AppHandle) -> Result<Option<ScanReport>, String> {
    let pool = app.state::<SqlitePool>();
    vault::scan_now(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_list_notes(app: AppHandle) -> Result<Vec<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::list_notes(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_get_note(app: AppHandle, path: String) -> Result<Option<VaultNoteRow>, String> {
    let pool = app.state::<SqlitePool>();
    index::get_note_by_path(pool.inner(), &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_search(
    app: AppHandle,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<VaultSearchHit>, String> {
    let pool = app.state::<SqlitePool>();
    index::search(pool.inner(), &query, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_backlinks(app: AppHandle, path: String) -> Result<Vec<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::backlinks(pool.inner(), &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_resolve_link(
    app: AppHandle,
    to_path: String,
) -> Result<Option<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::resolve_link(pool.inner(), &to_path)
        .await
        .map_err(|e| e.to_string())
}

/// Write a note and immediately re-index it, so the UI reflects the save even
/// before the watcher's debounce window elapses.
#[tauri::command]
pub async fn vault_save_note(
    app: AppHandle,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteOutcome, String> {
    let cfg = config(&app).await?;
    let outcome = writer::write_note(&cfg, &path, &content, expected_hash.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    let pool = app.state::<SqlitePool>();
    let abs = cfg.root.join(&path);
    if let Err(e) = scanner::index_one(pool.inner(), &cfg, &abs).await {
        log::warn!("vault save: re-index of {path} failed: {e}");
    }
    if let WriteOutcome::Conflict { conflict_path, .. } = &outcome {
        let conflict_abs = cfg.root.join(conflict_path);
        if let Err(e) = scanner::index_one(pool.inner(), &cfg, &conflict_abs).await {
            log::warn!("vault save: re-index of conflict copy failed: {e}");
        }
    }

    Ok(outcome)
}

#[tauri::command]
pub async fn vault_create_note(
    app: AppHandle,
    path: String,
    content: Option<String>,
) -> Result<VaultNoteRow, String> {
    let cfg = config(&app).await?;
    let body = content.unwrap_or_default();
    writer::create_note(&cfg, &path, &body)
        .await
        .map_err(|e| e.to_string())?;

    let pool = app.state::<SqlitePool>();
    let abs = cfg.root.join(&path);
    scanner::index_one(pool.inner(), &cfg, &abs)
        .await
        .map_err(|e| e.to_string())?;

    index::get_note_by_path(pool.inner(), &path)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Note created but not indexed: {path}"))
}

#[tauri::command]
pub async fn vault_open_in_obsidian(app: AppHandle, path: String) -> Result<(), String> {
    let cfg = config(&app).await?;
    let uri = vault::obsidian_uri(&cfg, &path);
    std::process::Command::new("open")
        .arg(&uri)
        .spawn()
        .map_err(|e| format!("Failed to open Obsidian: {e}"))?;
    Ok(())
}
```

- [ ] **Step 3: Write the watcher runtime**

Create `apps/desktop/src-tauri/src/vault_runner.rs`, modelled on the existing `sync_runner.rs`:

```rust
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};

use daily_triage_core::vault::{self, scanner, watcher::VaultWatcher};

/// Holds the live watcher so it isn't dropped (dropping stops the watch).
pub struct VaultWatchState(pub std::sync::Mutex<Option<VaultWatcher>>);

/// Full scan on launch, then start the debounced watcher. Both steps are
/// best-effort: an unconfigured or missing vault leaves the app fully working.
pub async fn start(app: &AppHandle) {
    let pool = app.state::<SqlitePool>();

    match vault::scan_now(pool.inner()).await {
        Ok(Some(report)) => {
            log::info!(
                "vault scan: {} scanned, {} indexed, {} unchanged, {} removed, {} skipped",
                report.scanned, report.indexed, report.unchanged, report.removed, report.skipped
            );
            if report.indexed > 0 || report.removed > 0 {
                let _ = app.emit("vault-changed", ());
            }
        }
        Ok(None) => log::info!("vault scan skipped — no vault path configured"),
        Err(e) => log::warn!("vault scan failed (watch still starts if possible): {e}"),
    }

    let Ok(Some(cfg)) = vault::load_config(pool.inner()).await else { return };
    if !cfg.root.is_dir() {
        log::warn!("vault watch not started — {} is not a directory", cfg.root.display());
        return;
    }

    let handle = app.clone();
    let watch_cfg = cfg.clone();
    let spawned = daily_triage_core::vault::watcher::spawn(&cfg.root, move |paths| {
        let handle = handle.clone();
        let cfg = watch_cfg.clone();
        tauri::async_runtime::spawn(async move {
            let pool = handle.state::<SqlitePool>();
            let mut changed = false;
            for path in paths {
                match scanner::index_one(pool.inner(), &cfg, &path).await {
                    Ok(true) => changed = true,
                    Ok(false) => {}
                    Err(e) => log::warn!("vault watch: index of {} failed: {e}", path.display()),
                }
            }
            if changed {
                let _ = handle.emit("vault-changed", ());
            }
        });
    });

    match spawned {
        Ok(w) => {
            log::info!("vault watcher started on {}", cfg.root.display());
            if let Some(state) = app.try_state::<VaultWatchState>() {
                *state.0.lock().unwrap() = Some(w);
            }
        }
        Err(e) => log::warn!("vault watcher failed to start: {e}"),
    }
}
```

- [ ] **Step 4: Register everything in the Tauri app**

In `apps/desktop/src-tauri/src/commands/mod.rs`, add `pub mod vault;` alongside the other command modules.

In `apps/desktop/src-tauri/src/lib.rs`:

1. Add the runner module next to `mod sync_runner;` (line 3):

```rust
mod vault_runner;
```

2. Extend the command import (line 20) so `vault` is included:

```rust
use commands::{activity, ai, calendar, capture_routes, captures, demo, docs, focus, goals, habits, import, local_tasks, obsidian, open_url, priorities, progress, projects, settings, sync, todoist, todoist_sync, updater, vault};
```

3. Inside `.setup(|app| { ... })`, immediately before the existing Todoist background-sync block (line ~298), register the watcher state and kick off the scan/watch:

```rust
            // --- Obsidian vault: launch scan, then debounced watch ---
            app.manage(crate::vault_runner::VaultWatchState(std::sync::Mutex::new(None)));
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    crate::vault_runner::start(&handle).await;
                });
            }
```

4. Add the commands to `invoke_handler![]`, after the `docs::migrate_docs_to_markdown` line:

```rust
            vault::vault_status,
            vault::vault_rescan,
            vault::vault_list_notes,
            vault::vault_get_note,
            vault::vault_search,
            vault::vault_backlinks,
            vault::vault_resolve_link,
            vault::vault_save_note,
            vault::vault_create_note,
            vault::vault_open_in_obsidian,
```

- [ ] **Step 5: Add the shared TypeScript types**

Append to `packages/types/src/index.ts` after the Docs block (after `DocsMdResult`):

```ts
// ── Obsidian vault ──

export interface VaultNoteSummary {
  id: string
  path: string
  title: string
  updated_at: string
}

export interface VaultNoteDetail {
  id: string
  path: string
  title: string
  content: string
  frontmatter_json: string | null
  mtime: string | null
  size: number
  hash: string | null
  updated_at: string
  deleted_at: string | null
}

export interface VaultSearchHit {
  id: string
  path: string
  title: string
  snippet: string
}

export interface VaultScanReport {
  scanned: number
  indexed: number
  unchanged: number
  removed: number
  skipped: number
}

export interface VaultStatus {
  configured: boolean
  root: string | null
  note_count: number
  last_scan_at: string | null
  last_error: string | null
  excludes: string[]
}

/** Discriminated on `kind` by the Rust `WriteOutcome` enum. */
export type VaultSaveResult =
  | { kind: 'written'; hash: string }
  | { kind: 'conflict'; conflict_path: string; disk_hash: string }
```

- [ ] **Step 6: Add the invoke wrappers**

Append to `apps/desktop/src/services/tauri.ts` (import the new types alongside the existing `@daily-triage/types` imports at the top of the file):

```ts
// ── Obsidian vault ──

export async function vaultStatus(): Promise<VaultStatus> {
  return invoke<VaultStatus>('vault_status')
}

export async function vaultRescan(): Promise<VaultScanReport | null> {
  return invoke<VaultScanReport | null>('vault_rescan')
}

export async function vaultListNotes(): Promise<VaultNoteSummary[]> {
  return invoke<VaultNoteSummary[]>('vault_list_notes')
}

export async function vaultGetNote(path: string): Promise<VaultNoteDetail | null> {
  return invoke<VaultNoteDetail | null>('vault_get_note', { path })
}

export async function vaultSearch(query: string, limit?: number): Promise<VaultSearchHit[]> {
  return invoke<VaultSearchHit[]>('vault_search', { query, limit })
}

export async function vaultBacklinks(path: string): Promise<VaultNoteSummary[]> {
  return invoke<VaultNoteSummary[]>('vault_backlinks', { path })
}

export async function vaultResolveLink(toPath: string): Promise<VaultNoteSummary | null> {
  return invoke<VaultNoteSummary | null>('vault_resolve_link', { toPath })
}

export async function vaultSaveNote(
  path: string,
  content: string,
  expectedHash?: string | null,
): Promise<VaultSaveResult> {
  return invoke<VaultSaveResult>('vault_save_note', { path, content, expectedHash })
}

export async function vaultCreateNote(path: string, content?: string): Promise<VaultNoteDetail> {
  return invoke<VaultNoteDetail>('vault_create_note', { path, content })
}

export async function vaultOpenInObsidian(path: string): Promise<void> {
  return invoke<void>('vault_open_in_obsidian', { path })
}
```

- [ ] **Step 7: Add the `vault` slice to the DataProvider**

In `apps/desktop/src/services/data-provider.ts`, add after the `docs` slice (line 213) — importing the new types at the top of the file:

```ts
  vault: {
    status(): Promise<VaultStatus>
    rescan(): Promise<VaultScanReport | null>
    listNotes(): Promise<VaultNoteSummary[]>
    getNote(path: string): Promise<VaultNoteDetail | null>
    search(query: string, limit?: number): Promise<VaultSearchHit[]>
    backlinks(path: string): Promise<VaultNoteSummary[]>
    resolveLink(toPath: string): Promise<VaultNoteSummary | null>
    saveNote(path: string, content: string, expectedHash?: string | null): Promise<VaultSaveResult>
    createNote(path: string, content?: string): Promise<VaultNoteDetail>
    openInObsidian(path: string): Promise<void>
  }
```

In `apps/desktop/src/services/tauri-provider.ts`, wire the slice through to the wrappers, matching the file's existing style:

```ts
  vault: {
    status: tauri.vaultStatus,
    rescan: tauri.vaultRescan,
    listNotes: tauri.vaultListNotes,
    getNote: tauri.vaultGetNote,
    search: tauri.vaultSearch,
    backlinks: tauri.vaultBacklinks,
    resolveLink: tauri.vaultResolveLink,
    saveNote: tauri.vaultSaveNote,
    createNote: tauri.vaultCreateNote,
    openInObsidian: tauri.vaultOpenInObsidian,
  },
```

Place it directly after the `docs` slice, which ends at `apps/desktop/src/services/tauri-provider.ts:93`.

- [ ] **Step 8: Verify the Rust side compiles and the frontend type-checks**

```bash
cargo build -p daily-triage-core
cd apps/desktop/src-tauri && cargo check
cd ../ && npx tsc --noEmit
```
Expected: all three clean.

- [ ] **Step 9: Commit**

```bash
git add daily-triage-core/src/vault/mod.rs apps/desktop/src-tauri/src apps/desktop/src/services packages/types/src/index.ts
git commit -m "feat: vault Tauri commands, launch scan + watcher runtime, TS surface"
```

---

### Task 10: Re-point the existing Obsidian reads at the vault index

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/obsidian.rs:89-137`

**Interfaces:**
- Consumes: `daily_triage_core::vault::index::get_note_by_path`.
- Produces: unchanged command signatures — `read_today_md`, `read_quick_captures`, `read_session_log`, `read_daily_brief` keep their exact return types.

Behaviour must be preserved exactly: these commands feed `TodayPanel.tsx` and `BriefDisplay.tsx`. The change is the *source* of the bytes (index first, disk fallback), not the shape of the result. `write_quick_capture` and `toggle_obsidian_checkbox` keep writing to disk directly — the watcher re-indexes them — because they are surgical line edits, not whole-note replacements.

- [ ] **Step 1: Add a shared read helper**

Add to `apps/desktop/src-tauri/src/commands/obsidian.rs`, below `get_vault_path`:

```rust
/// Read a vault file's content, preferring the index (already in memory,
/// no disk hit) and falling back to disk when the note isn't indexed yet —
/// e.g. the very first launch before the initial scan finishes, or a file
/// under an excluded folder.
async fn read_vault_file(app: &AppHandle, rel: &str) -> Result<Option<String>, String> {
    let pool = app.state::<SqlitePool>();
    if let Ok(Some(note)) = daily_triage_core::vault::index::get_note_by_path(pool.inner(), rel).await {
        if note.deleted_at.is_none() {
            return Ok(Some(note.content));
        }
    }

    let vault_path = get_vault_path(app).await?;
    let file_path = format!("{}/{}", vault_path, rel);
    match tokio::fs::read_to_string(&file_path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", rel, e)),
    }
}
```

- [ ] **Step 2: Rewrite the four read commands to use it**

Replace the bodies of `read_today_md`, `read_quick_captures`, `read_session_log`, and `read_daily_brief` (lines 89-137) with:

```rust
#[tauri::command]
pub async fn read_today_md(app: AppHandle) -> Result<ParsedTodayMd, String> {
    let content = read_vault_file(&app, "today.md")
        .await?
        .ok_or_else(|| "Failed to read today.md: not found".to_string())?;
    Ok(daily_triage_core::parsers::markdown::parse_today_md(&content))
}

#[tauri::command]
pub async fn read_quick_captures(app: AppHandle) -> Result<Vec<QuickCapture>, String> {
    let content = read_vault_file(&app, "inbox/Quick Captures.md")
        .await?
        .ok_or_else(|| "Failed to read Quick Captures.md: not found".to_string())?;
    Ok(parse_quick_captures(&content))
}

#[tauri::command]
pub async fn read_session_log(app: AppHandle) -> Result<Option<String>, String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    read_vault_file(&app, &format!("journal/sessions/Session {}.md", today)).await
}

#[tauri::command]
pub async fn read_daily_brief(app: AppHandle, date: Option<String>) -> Result<Option<String>, String> {
    let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    read_vault_file(&app, &format!("journal/briefs/Brief {}.md", date)).await
}
```

`list_brief_dates` stays as-is (it lists a directory, not file contents).

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop/src-tauri && cargo check`
Expected: clean.

- [ ] **Step 4: Manual verification against the real vault**

Run: `cd apps/desktop && npm run tauri dev`

Confirm on the Today page: the Obsidian today.md panel renders its checklist, the quick-captures list populates, and the brief displays under Activity. Then check the log for the launch scan line:

```bash
grep "vault scan:" "$HOME/Library/Logs/com.marcosevilla.daily-triage/Marco's Task App.log" | tail -3
```
Expected: a line reporting scanned/indexed counts for Marco's real vault.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/obsidian.rs
git commit -m "refactor: serve Obsidian reads from the vault index with disk fallback"
```

---

### Task 11: Docs store and sidebar — the Vault section

**Files:**
- Modify: `apps/desktop/src/stores/docsStore.ts`
- Modify: `apps/desktop/src/components/docs/FolderTree.tsx`

**Interfaces:**
- Consumes: `dp.vault.listNotes()`, `dp.vault.getNote(path)`.
- Produces: store fields `vaultNotes`, `selectedVaultPath`, `currentVaultNote`, `vaultExpanded`; actions `loadVaultNotes()`, `selectVaultNote(path)`, `setVaultExpanded(v)`; `export function groupVaultNotes(notes: VaultNoteSummary[]): VaultFolderGroup[]` from `FolderTree.tsx`.

- [ ] **Step 1: Extend the docs store**

Rewrite `apps/desktop/src/stores/docsStore.ts` as:

```ts
import { create } from 'zustand'
import { getDataProvider } from '@/services/provider-context'
import type { DocFolder, Document, VaultNoteDetail, VaultNoteSummary } from '@daily-triage/types'

interface DocsStore {
  folders: DocFolder[]
  documents: Document[]
  selectedFolderId: string | null
  selectedDocId: string | null
  currentDoc: Document | null
  folderTreeCollapsed: boolean
  folderTreeWidth: number

  // Vault backend
  vaultNotes: VaultNoteSummary[]
  selectedVaultPath: string | null
  currentVaultNote: VaultNoteDetail | null
  vaultExpanded: boolean

  loadFolders: () => Promise<void>
  loadDocuments: (folderId?: string) => Promise<void>
  loadVaultNotes: () => Promise<void>
  selectFolder: (id: string | null) => void
  selectDoc: (id: string | null) => Promise<void>
  selectVaultNote: (path: string | null) => Promise<void>
  setVaultExpanded: (v: boolean) => void
  setFolderTreeCollapsed: (v: boolean) => void
  setFolderTreeWidth: (w: number) => void
  refresh: () => Promise<void>
}

export const useDocsStore = create<DocsStore>((set, get) => ({
  folders: [],
  documents: [],
  selectedFolderId: null,
  selectedDocId: null,
  currentDoc: null,
  folderTreeCollapsed: false,
  folderTreeWidth: 220,

  vaultNotes: [],
  selectedVaultPath: null,
  currentVaultNote: null,
  vaultExpanded: true,

  loadFolders: async () => {
    try {
      const dp = getDataProvider()
      const folders = await dp.docs.getFolders()
      set({ folders })
    } catch { /* silently fail */ }
  },

  loadDocuments: async (folderId) => {
    try {
      const dp = getDataProvider()
      const documents = await dp.docs.getDocuments(folderId)
      set({ documents })
    } catch { /* silently fail */ }
  },

  loadVaultNotes: async () => {
    try {
      const dp = getDataProvider()
      const vaultNotes = await dp.vault.listNotes()
      set({ vaultNotes })
    } catch {
      // An unconfigured vault is a normal state — the section just stays empty.
      set({ vaultNotes: [] })
    }
  },

  selectFolder: (id) => {
    set({ selectedFolderId: id })
    get().loadDocuments(id ?? undefined)
  },

  // Selecting one backend clears the other — exactly one note is open at a time.
  selectDoc: async (id) => {
    if (!id) {
      set({ selectedDocId: null, currentDoc: null })
      return
    }
    set({ selectedDocId: id, selectedVaultPath: null, currentVaultNote: null })
    try {
      const dp = getDataProvider()
      const doc = await dp.docs.getDocument(id)
      set({ currentDoc: doc })
    } catch {
      set({ currentDoc: null })
    }
  },

  selectVaultNote: async (path) => {
    if (!path) {
      set({ selectedVaultPath: null, currentVaultNote: null })
      return
    }
    set({ selectedVaultPath: path, selectedDocId: null, currentDoc: null })
    try {
      const dp = getDataProvider()
      const note = await dp.vault.getNote(path)
      set({ currentVaultNote: note })
    } catch {
      set({ currentVaultNote: null })
    }
  },

  setVaultExpanded: (v) => set({ vaultExpanded: v }),
  setFolderTreeCollapsed: (v) => set({ folderTreeCollapsed: v }),
  setFolderTreeWidth: (w) => set({ folderTreeWidth: w }),

  refresh: async () => {
    await get().loadFolders()
    await get().loadDocuments(get().selectedFolderId ?? undefined)
    await get().loadVaultNotes()

    const docId = get().selectedDocId
    if (docId) {
      try {
        const dp = getDataProvider()
        const doc = await dp.docs.getDocument(docId)
        set({ currentDoc: doc })
      } catch { /* skip */ }
    }

    const vaultPath = get().selectedVaultPath
    if (vaultPath) {
      try {
        const dp = getDataProvider()
        const note = await dp.vault.getNote(vaultPath)
        set({ currentVaultNote: note })
      } catch { /* skip */ }
    }
  },
}))
```

- [ ] **Step 2: Add the Vault section to the sidebar**

In `apps/desktop/src/components/docs/FolderTree.tsx`:

1. Extend the lucide import (line 5) with `Folder` and `Vault`:

```tsx
import { ChevronRight, Plus, FolderOpen, Folder, FileText, Trash2, PanelLeftClose, Vault } from 'lucide-react'
```

2. Add the store selectors alongside the existing ones (after line 20):

```tsx
  const vaultNotes = useDocsStore((s) => s.vaultNotes)
  const selectedVaultPath = useDocsStore((s) => s.selectedVaultPath)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)
  const vaultExpanded = useDocsStore((s) => s.vaultExpanded)
  const setVaultExpanded = useDocsStore((s) => s.setVaultExpanded)
  const [expandedVaultFolders, setExpandedVaultFolders] = useState<Set<string>>(new Set())
```

3. Add this exported grouping helper at the bottom of the file (module scope, not inside the component):

```tsx
export interface VaultFolderGroup {
  /** Vault-relative folder path; '' is the vault root. */
  folder: string
  notes: VaultNoteSummary[]
}

/** Group vault notes by their immediate parent folder, root first then A–Z. */
export function groupVaultNotes(notes: VaultNoteSummary[]): VaultFolderGroup[] {
  const byFolder = new Map<string, VaultNoteSummary[]>()
  for (const note of notes) {
    const slash = note.path.lastIndexOf('/')
    const folder = slash === -1 ? '' : note.path.slice(0, slash)
    const bucket = byFolder.get(folder)
    if (bucket) bucket.push(note)
    else byFolder.set(folder, [note])
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, notes]) => ({ folder, notes }))
}
```

Add `import type { Document, VaultNoteSummary } from '@daily-triage/types'` (replacing the existing type-only Document import on line 8).

4. Render the section immediately after the "Unfiled docs" block (after line 245, before the new-folder input). It mirrors the native tree's visual language so the two backends read as one library:

```tsx
        {/* Vault notes */}
        {vaultNotes.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setVaultExpanded(!vaultExpanded)}
              className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors"
            >
              <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', vaultExpanded && 'rotate-90')} />
              <Vault className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-label text-muted-foreground">Vault</span>
              <span className="text-label text-muted-foreground">{vaultNotes.length}</span>
            </button>

            {vaultExpanded && (
              <div className="ml-4 space-y-0.5">
                {groupVaultNotes(vaultNotes).map(({ folder, notes }) => {
                  const isOpen = folder === '' || expandedVaultFolders.has(folder)
                  return (
                    <div key={folder || '__root__'}>
                      {folder !== '' && (
                        <button
                          onClick={() =>
                            setExpandedVaultFolders((prev) => {
                              const next = new Set(prev)
                              if (next.has(folder)) next.delete(folder)
                              else next.add(folder)
                              return next
                            })
                          }
                          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/10 transition-colors"
                        >
                          <ChevronRight className={cn('size-3 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 text-left text-meta truncate">{folder}</span>
                        </button>
                      )}
                      {isOpen && (
                        <div className={cn('space-y-0.5', folder !== '' && 'ml-4')}>
                          {notes.map((note) => (
                            <div
                              key={note.id}
                              onClick={() => selectVaultNote(note.path)}
                              title={note.path}
                              className={cn(
                                'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left cursor-pointer transition-colors',
                                selectedVaultPath === note.path
                                  ? 'bg-accent/40 text-foreground'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/10',
                              )}
                            >
                              <FileText className="size-3 shrink-0 text-muted-foreground" />
                              <span className="flex-1 text-meta truncate">{note.title || note.path}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
```

Note there is deliberately **no delete button** on vault rows: deleting a real file from a sidebar hover target is not a risk worth taking, and Obsidian is one keystroke away.

- [ ] **Step 3: Refresh the tree when the watcher reports a change**

In `apps/desktop/src/components/pages/DocsPage.tsx`, add a listener next to the existing mount effect:

```tsx
import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
```

```tsx
  // The vault watcher re-indexes on disk changes; pull the fresh tree in.
  useEffect(() => {
    const unlisten = listen('vault-changed', () => { refresh() })
    return () => { unlisten.then((fn) => fn()) }
  }, [refresh])
```

- [ ] **Step 4: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify visually**

Run: `cd apps/desktop && npm run tauri dev`, open Docs. Expected: a "Vault" section under the native docs with Marco's real note count, collapsible folders, and a click selecting a note (the editor pane still shows native-doc behaviour until Task 12).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/stores/docsStore.ts apps/desktop/src/components/docs/FolderTree.tsx apps/desktop/src/components/pages/DocsPage.tsx
git commit -m "feat: unified docs sidebar — vault notes beside native docs"
```

---

### Task 12: Editor — vault notes in place, with conflict handling

> ⚠️ **SUPERSEDED BY THE FINAL REVIEW — vault editing does not ship in this branch.**
>
> This task as written wires `TiptapEditor` (`format="markdown"`) directly at the user's real vault files. That pipeline is **lossy**: `tiptap-markdown` parses with markdown-it and re-serializes with `prosemirror-markdown`, neither of which knows Obsidian's dialect. Verified round-trip on a representative note — YAML frontmatter is re-emitted as an `##` heading (every tag/alias/date lost), `[[wikilinks]]` and `![[embeds]]` come back as escaped literals (`\[\[…\]\]`, breaking both Obsidian and `vault_links`), `- [ ]` checkboxes become `\[ \]`, and callouts flatten.
>
> The hash guard does **not** protect against this, which is what makes it dangerous: the hash matches, because the app read the file correctly. The corruption is introduced on serialization, so the write proceeds with no conflict, no banner, and no warning. It would also hit `today.md` and `inbox/Quick Captures.md`, which this branch makes reachable from the Docs sidebar, breaking the Today page's parsers.
>
> **This is a planning defect, not an implementation one.** The plan never asked whether Tiptap round-trips Obsidian markdown losslessly; the word "fidelity" appears nowhere in it. Every per-task review passed because each verified its own piece correctly, and `WikilinkExtension.ts`'s doc comment ("the underlying markdown text is never rewritten") is true of that file and false of the pipeline around it.
>
> **Resolution (Marco's ruling, post-final-review):** the vault editor becomes **read-only**. Rendering, backlinks, clickable wikilinks and "Open in Obsidian" all stay; `onChange` is removed so no vault write can originate from the editor. Editing returns in a follow-up via a raw-markdown source editor (textarea/CodeMirror), which is byte-exact by construction and the right affordance for a vault the user also edits in Obsidian.
>
> **Any future work that re-enables vault editing must ship with a round-trip fidelity test** — open a note containing frontmatter, a `[[wikilink]]`, an `![[embed]]`, a `- [ ]` checkbox and a callout, save it unchanged, and assert the on-disk bytes are identical.
>
> The steps below are retained as the historical record of what was built and then disabled.

**Files:**
- Modify: `apps/desktop/src/components/docs/DocEditor.tsx`
- Create: `apps/desktop/src/components/docs/VaultNoteEditor.tsx`
- Modify: `apps/desktop/src/components/pages/DocsPage.tsx` (header meta for vault notes)

**Interfaces:**
- Consumes: `dp.vault.saveNote/getNote/backlinks/resolveLink/openInObsidian`, `useDocsStore.currentVaultNote`, `TiptapEditor` (`format="markdown"`).
- Produces: `VaultNoteEditor` component rendered by `DocEditor` when a vault note is selected.

- [ ] **Step 1: Write the vault editor**

Create `apps/desktop/src/components/docs/VaultNoteEditor.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { TiptapEditor } from './TiptapEditor'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { VaultNoteSummary } from '@daily-triage/types'

/** Debounce for auto-save: long enough that a burst of typing is one write. */
const SAVE_DELAY_MS = 1200

export function VaultNoteEditor() {
  const dp = useDataProvider()
  const note = useDocsStore((s) => s.currentVaultNote)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)
  const refresh = useDocsStore((s) => s.refresh)

  const [backlinks, setBacklinks] = useState<VaultNoteSummary[]>([])
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The hash the app last read; sent with every save so a change made in
  // Obsidian meanwhile can never be silently overwritten.
  const expectedHash = useRef<string | null>(null)
  const lastSaved = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    expectedHash.current = note?.hash ?? null
    lastSaved.current = note?.content ?? ''
    setConflictPath(null)
    if (note?.path) {
      dp.vault.backlinks(note.path).then(setBacklinks).catch(() => setBacklinks([]))
    } else {
      setBacklinks([])
    }
  }, [note?.path, note?.hash, note?.content, dp])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useCallback(async (content: string) => {
    if (!note) return
    setSaving(true)
    try {
      const result = await dp.vault.saveNote(note.path, content, expectedHash.current)
      if (result.kind === 'conflict') {
        setConflictPath(result.conflict_path)
        // Re-read so the editor shows what's actually on disk now.
        await selectVaultNote(note.path)
      } else {
        expectedHash.current = result.hash
        lastSaved.current = content
        setConflictPath(null)
      }
    } catch (e) {
      toast.error(`Couldn't save note — ${e}`)
    } finally {
      setSaving(false)
    }
  }, [note, dp, selectVaultNote])

  const handleChange = useCallback((content: string) => {
    if (!note || content === lastSaved.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { save(content) }, SAVE_DELAY_MS)
  }, [note, save])

  const openInObsidian = useCallback(async () => {
    if (!note) return
    try {
      await dp.vault.openInObsidian(note.path)
    } catch (e) {
      toast.error(`Couldn't open Obsidian — ${e}`)
    }
  }, [note, dp])

  if (!note) return null

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-3 px-8 pt-6">
        <Meta as="p" className="truncate" title={note.path}>{note.path}</Meta>
        <div className="flex items-center gap-2">
          {saving && <Meta as="span">Saving…</Meta>}
          <Button variant="secondary" size="sm" onClick={openInObsidian}>
            <ExternalLink className="size-3" />
            Open in Obsidian
          </Button>
        </div>
      </div>

      {conflictPath && (
        <div className="mx-8 mt-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
          <Meta as="p">
            This note changed on disk while you were editing, so your version was saved
            beside it as <span className="text-foreground">{conflictPath}</span>. The editor
            now shows what's on disk.
          </Meta>
          <button
            type="button"
            className="mt-1 text-meta text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => { setConflictPath(null); selectVaultNote(conflictPath); refresh() }}
          >
            Open my version
          </button>
        </div>
      )}

      <div className="px-8 py-4">
        <TiptapEditor
          key={note.id}
          content={note.content}
          onChange={handleChange}
          format="markdown"
          placeholder="Write…"
        />
      </div>

      {backlinks.length > 0 && (
        <div className="border-t border-border/20 px-8 py-4">
          <span className="text-label text-muted-foreground">Linked from</span>
          <div className="mt-2 space-y-1">
            {backlinks.map((b) => (
              <button
                key={b.id}
                onClick={() => selectVaultNote(b.path)}
                className="block w-full truncate text-left text-meta text-muted-foreground hover:text-foreground transition-colors"
              >
                {b.title || b.path}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Route the editor pane by backend**

In `apps/desktop/src/components/docs/DocEditor.tsx`, add the import and an early branch at the top of the component's render (before the existing native-doc markup):

```tsx
import { VaultNoteEditor } from './VaultNoteEditor'
```

```tsx
  const currentVaultNote = useDocsStore((s) => s.currentVaultNote)

  // A vault note is selected — file-backed editing takes over the pane.
  if (currentVaultNote) {
    return <VaultNoteEditor />
  }
```

Place the `currentVaultNote` selector alongside the existing `useDocsStore` selectors near the top of the component, and the `if` immediately before the component's existing `return`, after all hooks have run (React requires unconditional hook order — do not move the branch above the `useEffect`/`useCallback` declarations).

- [ ] **Step 3: Show the vault note title in the page header**

In `apps/desktop/src/components/pages/DocsPage.tsx`, replace the `meta` prop:

```tsx
  const currentVaultNote = useDocsStore((s) => s.currentVaultNote)
```

```tsx
        <PageHeader
          title="Docs"
          meta={currentVaultNote ? currentVaultNote.title : currentDoc ? currentDoc.title : undefined}
        />
```

- [ ] **Step 4: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify the conflict path end-to-end with the real vault**

Run: `cd apps/desktop && npm run tauri dev`, then:

1. Open a vault note in the app, type a word, wait ~2s, and confirm the file changed on disk (`cat` it in a terminal).
2. Open the same note in Obsidian, change a line, and save.
3. Type in the app again and wait for auto-save.

Expected: the app shows the "changed on disk" banner, the original file keeps Obsidian's version, and a `… (conflict <timestamp>).md` file appears beside it containing the app's text. The sidebar picks up the conflict copy within ~1s (watcher + `vault-changed`).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/docs apps/desktop/src/components/pages/DocsPage.tsx
git commit -m "feat: edit vault notes in place with conflict copies and backlinks"
```

---

### Task 13: One search across both backends

**Files:**
- Create: `apps/desktop/src/components/docs/DocsSearch.tsx`
- Modify: `apps/desktop/src/components/docs/FolderTree.tsx` (mount the search box above the tree)

**Interfaces:**
- Consumes: `dp.docs.searchDocuments(query)`, `dp.vault.search(query, limit)`, `useDocsStore.{selectDoc, selectVaultNote}`.
- Produces: `DocsSearch` component, mounted in the docs sidebar. Its internal hit shape is `{ backend: 'native' | 'vault'; key: string; title: string; subtitle: string }`, where `key` is `native:<docId>` or `vault:<path>` so one list can address both backends.

- [ ] **Step 1: Write the search component**

Create `apps/desktop/src/components/docs/DocsSearch.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocsStore } from '@/stores/docsStore'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'

interface DocsSearchHit {
  backend: 'native' | 'vault'
  key: string
  title: string
  subtitle: string
}

const DEBOUNCE_MS = 180

export function DocsSearch() {
  const dp = useDataProvider()
  const selectDoc = useDocsStore((s) => s.selectDoc)
  const selectVaultNote = useDocsStore((s) => s.selectVaultNote)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocsSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against an older, slower query overwriting a newer one's results.
  const requestId = useRef(0)

  const run = useCallback(async (q: string) => {
    const id = ++requestId.current
    setSearching(true)
    const [docs, notes] = await Promise.all([
      dp.docs.searchDocuments(q).catch(() => []),
      dp.vault.search(q, 20).catch(() => []),
    ])
    if (id !== requestId.current) return

    setHits([
      ...docs.map((d) => ({
        backend: 'native' as const,
        key: `native:${d.id}`,
        title: d.title || 'Untitled',
        subtitle: 'Doc',
      })),
      ...notes.map((n) => ({
        backend: 'vault' as const,
        key: `vault:${n.path}`,
        title: n.title || n.path,
        subtitle: n.snippet ? n.snippet : n.path,
      })),
    ])
    setSearching(false)
  }, [dp])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (!q) {
      setHits([])
      setSearching(false)
      return
    }
    timer.current = setTimeout(() => { run(q) }, DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, run])

  const openHit = useCallback((hit: DocsSearchHit) => {
    const id = hit.key.slice(hit.key.indexOf(':') + 1)
    if (hit.backend === 'native') selectDoc(id)
    else selectVaultNote(id)
    setQuery('')
    setHits([])
  }, [selectDoc, selectVaultNote])

  return (
    <div className="border-b border-border/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5 rounded-md bg-muted/20 px-1.5 py-1">
        <Search className="size-3 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setHits([]) } }}
          placeholder="Search docs and vault"
          className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => { setQuery(''); setHits([]) }} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="size-3" />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-1 space-y-0.5">
          {hits.map((hit) => (
            <button
              key={hit.key}
              onClick={() => openHit(hit)}
              className={cn(
                'flex w-full flex-col items-start rounded-md px-1.5 py-1 text-left transition-colors',
                'text-muted-foreground hover:bg-accent/10 hover:text-foreground',
              )}
            >
              <span className="w-full truncate text-meta">{hit.title}</span>
              <span className="w-full truncate text-label text-muted-foreground">{hit.subtitle}</span>
            </button>
          ))}
          {!searching && hits.length === 0 && (
            <div className="px-1.5 py-1 text-meta text-muted-foreground">
              Nothing matches yet — try fewer words.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the sidebar**

In `apps/desktop/src/components/docs/FolderTree.tsx`, import it:

```tsx
import { DocsSearch } from './DocsSearch'
```

and render it between the header block and the folder list — i.e. immediately after the closing `</div>` of the header (line 157) and before `{/* Folder list */}`:

```tsx
      <DocsSearch />
```

- [ ] **Step 3: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify against the real vault**

Run the app, open Docs, and search a word you know appears only in a vault note (e.g. a phrase from a recent journal brief) and one that appears only in a native doc. Expected: both kinds of hit appear in one list, and clicking either opens the right editor.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/docs/DocsSearch.tsx apps/desktop/src/components/docs/FolderTree.tsx
git commit -m "feat: one search across native docs and vault notes"
```

---

### Task 14: Clickable wikilinks, with note creation for unresolved targets

**Files:**
- Create: `apps/desktop/src/components/docs/WikilinkExtension.ts`
- Modify: `apps/desktop/src/components/docs/TiptapEditor.tsx` (props interface ~line 14, extension list)
- Modify: `apps/desktop/src/components/docs/VaultNoteEditor.tsx`

**Interfaces:**
- Consumes: `@tiptap/core` `Extension`, `@tiptap/pm/state`, `@tiptap/pm/view` (`@tiptap/pm` ^3.21.0 is already a dependency), `dp.vault.resolveLink`, `dp.vault.createNote`.
- Produces: `Wikilink` Tiptap extension with a `onClick(target: string)` option; `TiptapEditor` gains an optional `onWikilinkClick?: (target: string) => void` prop (native docs pass nothing and are unaffected).

- [ ] **Step 0: Fix the pre-existing production-build failure in this same file**

`npm run build` is currently broken — on this branch *and* on `main` — with exactly one error:

```
src/components/docs/TiptapEditor.tsx(92,44): error TS2339: Property 'markdown' does not exist on type 'Storage'.
```

Line 92 is `format === 'markdown' ? editor.storage.markdown.getMarkdown() : editor.getHTML()`. `tiptap-markdown` declares a module augmentation adding `markdown` to Tiptap's `Storage` interface; that augmentation is not reaching the build. It predates this plan (introduced with `tiptap-markdown` in plan 1) and went unnoticed because every verification step so far uses `tsc --noEmit`, which passes — `npm run build` runs `tsc -b`, which uses `tsconfig.app.json` and does not.

Fix it properly rather than casting to `any`: diagnose why the augmentation isn't visible under `tsc -b` (likely a `types`/`include` narrowing in `tsconfig.app.json`, or the augmentation living in a file the app project doesn't pull in) and make the declaration reachable. A `@ts-expect-error` or an `as any` is not acceptable here — it would hide a real type error in the one call that converts the editor's content to the markdown that gets written to the user's vault files.

Verify with `cd apps/desktop && npm run build` — it must complete, not just type-check. This is the step that makes Task 15's build verification meaningful.

- [ ] **Step 1: Write the extension**

Create `apps/desktop/src/components/docs/WikilinkExtension.ts`:

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]` — single line only. */
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g

export interface WikilinkOptions {
  onClick: (target: string) => void
}

/**
 * Decorates `[[wikilinks]]` in the editor body and routes clicks to `onClick`
 * with the raw inner text (alias and heading fragment included — the caller
 * normalises). Decoration-based rather than a node type, so the underlying
 * markdown text is never rewritten: what's on disk stays exactly what Obsidian
 * wrote.
 */
export const Wikilink = Extension.create<WikilinkOptions>({
  name: 'wikilink',

  addOptions() {
    return { onClick: () => {} }
  },

  addProseMirrorPlugins() {
    const onClick = this.options.onClick
    return [
      new Plugin({
        key: new PluginKey('wikilink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              WIKILINK_RE.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = WIKILINK_RE.exec(node.text)) !== null) {
                const from = pos + match.index
                decorations.push(
                  Decoration.inline(from, from + match[0].length, {
                    class: 'text-accent-blue cursor-pointer hover:underline',
                    'data-wikilink': match[1],
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },

          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-wikilink]')
            const target = el?.getAttribute('data-wikilink')
            if (!target) return false
            onClick(target)
            return true
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 2: Give TiptapEditor an opt-in prop**

In `apps/desktop/src/components/docs/TiptapEditor.tsx`, extend the props interface (line 14-19):

```tsx
interface TiptapEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  format?: 'html' | 'markdown'
  /** When provided, `[[wikilinks]]` become clickable and route here. */
  onWikilinkClick?: (target: string) => void
}
```

Import the extension:

```tsx
import { Wikilink } from './WikilinkExtension'
```

and append it conditionally to the `extensions` array passed to `useEditor` — keep the existing entries untouched and add, as the last element:

```tsx
      ...(onWikilinkClick ? [Wikilink.configure({ onClick: onWikilinkClick })] : []),
```

Add `onWikilinkClick` to the `useEditor` dependency array if the file passes one (match whatever the existing `useEditor` call already lists; do not otherwise change its options).

- [ ] **Step 3: Handle the click in the vault editor**

In `apps/desktop/src/components/docs/VaultNoteEditor.tsx`, add this callback next to `openInObsidian`:

```tsx
  const handleWikilink = useCallback(async (raw: string) => {
    if (!note) return
    // Strip alias and heading/block fragment: `Note#Section|alias` → `Note`
    const target = raw.split('|')[0].split('#')[0].trim()
    if (!target) return

    try {
      const hit = await dp.vault.resolveLink(target)
      if (hit) {
        selectVaultNote(hit.path)
        return
      }
    } catch {
      // fall through to the create offer
    }

    // Unresolved: offer to create it. A bare name lands beside the current
    // note; a name with slashes is treated as vault-relative.
    const folder = note.path.includes('/')
      ? note.path.slice(0, note.path.lastIndexOf('/'))
      : ''
    const newPath = target.includes('/')
      ? `${target}.md`
      : folder
        ? `${folder}/${target}.md`
        : `${target}.md`

    toast(`No note called "${target}" yet.`, {
      action: {
        label: 'Create it',
        onClick: async () => {
          try {
            const created = await dp.vault.createNote(newPath, `# ${target}\n\n`)
            await refresh()
            selectVaultNote(created.path)
          } catch (e) {
            toast.error(`Couldn't create note — ${e}`)
          }
        },
      },
    })
  }, [note, dp, selectVaultNote, refresh])
```

and pass it to the editor:

```tsx
        <TiptapEditor
          key={note.id}
          content={note.content}
          onChange={handleChange}
          format="markdown"
          placeholder="Write…"
          onWikilinkClick={handleWikilink}
        />
```

- [ ] **Step 4: Type-check**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify against the real vault**

Run the app and open a vault note containing a `[[wikilink]]`. Expected: the link renders in the accent colour, clicking a link to an existing note opens it, and clicking a link to a non-existent note shows a "No note called … yet" toast whose "Create it" action creates the file (confirm on disk), indexes it, and opens it.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/docs/WikilinkExtension.ts apps/desktop/src/components/docs/TiptapEditor.tsx apps/desktop/src/components/docs/VaultNoteEditor.tsx
git commit -m "feat: clickable wikilinks with note creation for unresolved targets"
```

---

### Task 15: Settings surface and documentation

**Files:**
- Create: `apps/desktop/src/components/settings/VaultSection.tsx`
- Modify: `apps/desktop/src/components/pages/SettingsPage.tsx` (import ~line 44, sidebar nav ~line 1245, section placement ~line 1460)
- Modify: `daily-triage/CLAUDE.md` (migration version, key tables, sync notes)

**Interfaces:**
- Consumes: `dp.vault.status()`, `dp.vault.rescan()`.
- Produces: a "Vault" settings section; updated project documentation.

- [ ] **Step 1: Write the settings section**

Create `apps/desktop/src/components/settings/VaultSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useDataProvider } from '@/services/provider-context'
import { Button } from '@/components/ui/button'
import { Meta } from '@/components/shared/typography'
import { toast } from 'sonner'
import type { VaultStatus } from '@daily-triage/types'

export function VaultSection() {
  const dp = useDataProvider()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [scanning, setScanning] = useState(false)

  const refresh = useCallback(() => {
    dp.vault.status().then(setStatus).catch(() => {})
  }, [dp])

  useEffect(() => { refresh() }, [refresh])

  const rescan = useCallback(async () => {
    setScanning(true)
    try {
      const report = await dp.vault.rescan()
      if (report) {
        toast.success(
          `Vault scanned — ${report.indexed} updated, ${report.unchanged} unchanged` +
            (report.skipped > 0 ? `, ${report.skipped} skipped` : ''),
        )
      }
    } catch (e) {
      toast.error(`Couldn't scan the vault — ${e}`)
    } finally {
      setScanning(false)
      refresh()
    }
  }, [dp, refresh])

  if (!status) return null

  if (!status.configured) {
    return <Meta as="p">Set your vault path above to index your notes.</Meta>
  }

  const statusLine = [
    `${status.note_count} note${status.note_count === 1 ? '' : 's'} indexed`,
    status.last_scan_at ? `last scanned ${status.last_scan_at}` : 'not scanned yet',
  ].join(' · ')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Meta as="p">{statusLine}</Meta>
        <Button variant="secondary" size="sm" disabled={scanning} onClick={rescan}>
          {scanning ? 'Scanning…' : 'Rescan vault'}
        </Button>
      </div>

      {status.excludes.length > 0 && (
        <Meta as="p">Skipping {status.excludes.join(', ')}</Meta>
      )}

      {status.last_error && (
        <Meta as="p">
          Last scan didn&apos;t finish ({status.last_error}) — it&apos;ll retry on next launch.
        </Meta>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in Settings**

In `apps/desktop/src/components/pages/SettingsPage.tsx`:

1. Add the import next to the other settings-section imports (line 44-45):

```tsx
import { VaultSection } from '@/components/settings/VaultSection'
```

2. Add a nav link in the sidebar list, next to the existing `#todoist-sync` link (line 1245):

```tsx
            <a href="#vault" className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors">
              Vault
            </a>
```

3. Add the section itself immediately before the `{/* Todoist sync */}` block (line 1460), matching its neighbours exactly — `SectionHeader` with `title`/`description`, followed by a `<Separator />`:

```tsx
      {/* Obsidian vault */}
      <section id="vault" className="space-y-4 scroll-mt-6">
        <SectionHeader
          title="Vault"
          description="Indexes your Obsidian notes so they're searchable and editable here. Files on disk stay the source of truth."
        />
        <VaultSection />
      </section>

      <Separator />
```

- [ ] **Step 3: Update the project documentation**

In `daily-triage/CLAUDE.md`:

1. In **Database Migrations**, change `Current version: **17**` to `**18**` and extend the version list with:

```
+ v18: vault_notes/vault_links/vault_tags + device-local vault_fts (FTS5)
```

2. In **Key Tables**, add:

```
- `vault_notes` — indexed Obsidian notes (vault-relative path, content, frontmatter JSON, blake3 hash, soft-delete). Files on disk are the source of truth; this table is a derived index that also syncs.
- `vault_links` — wikilink/embed edges between notes (deterministic ids, replaced on re-index)
- `vault_tags` — inline + frontmatter tags per note (deterministic ids, replaced on re-index)
- `vault_fts` — FTS5 index over note title+content. Device-local, never synced, written by `vault::index`, not by SQL triggers (the migration runner splits on `;`)
```

3. In **Sync Protocol**, add:

```
- Vault tables replicate through the same sync_log pipeline; `vault_fts`, `todoist_outbox`, and `integration_sync_state` stay device/Mac-local
- Remote schema upgrades are gated per version by a `turso_schema_v<N>_upgraded` setting, since `initialize_remote` only runs once per database
```

4. In **Known Gotchas**, add:

```
- `npx tsc --noEmit` in `apps/desktop` type-checks NOTHING. `tsconfig.json` there is solution-style (`"files": []` + project references), so the bare command resolves it, checks zero files, and exits 0 regardless of how broken `src/` is. Use `npm run build` (which runs `tsc -b`, descending into `tsconfig.app.json`) as the real type check. This silently hid a production-build failure across two plans.
- `tiptap-markdown@0.9.0` ships no module augmentation for Tiptap's `Storage` interface, so `editor.storage.markdown` has no type. The repo supplies its own ambient declaration under `apps/desktop/src/types/` — don't "fix" a future error there with `as any`; that call produces the markdown written to real vault files.
- `run_migrations` splits each migration's SQL on `;`, so a statement containing an internal semicolon (`CREATE TRIGGER ... BEGIN ...; END`) is shredded into invalid fragments. Keep migrations to single-statement-per-semicolon SQL.
- Obsidian vault writes go through `vault::writer`, never `tokio::fs::write` directly — it hash-checks against what the app last read and diverts to a `(conflict <timestamp>).md` copy instead of overwriting an edit made in Obsidian.
```

- [ ] **Step 4: Full verification**

```bash
cargo test -p daily-triage-core
cd apps/desktop/src-tauri && cargo check
cd .. && npx tsc --noEmit && npm run build
```
Expected: all clean.

- [ ] **Step 5: Manual acceptance pass**

Run `npm run tauri dev` and confirm, in order:

1. Settings → Vault shows a real note count and a recent scan time; "Rescan vault" completes with a toast.
2. Docs sidebar shows the Vault section; opening a note renders its markdown.
3. Editing a note writes the file on disk (verify in a terminal), and editing the same file in Obsidian updates the app within ~1s.
4. The conflict path still behaves as verified in Task 12.
5. Wikilinks are clickable: an existing target opens, a missing one offers "Create it".
6. Search returns hits from both native docs and vault notes in one list.
7. Today page's Obsidian panels (today.md, quick captures, brief) still render — no regression from Task 10.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/settings/VaultSection.tsx apps/desktop/src/components/pages/SettingsPage.tsx CLAUDE.md
git commit -m "feat: vault settings section and updated project docs"
```

---

## After the plan

Two follow-ups belong to **plan 3**, not here:

1. **Mobile mirroring** — `apps/mobile/services/database.ts` migration v18, `sync.ts` `ALLOWED_TABLES` + remote-table creation, the mobile `DataProvider` copy's `vault` slice, and a read-only mobile notes view.
2. **Phone-originated vault edits** — the `pending_file_write` flag and the Mac's replay onto disk, using the same `vault::writer` conflict rules.

Known non-blocking items this plan leaves open, worth a line in the next session's notes:

- Note **renames** produce a new id and a tombstone rather than a move; `linked_doc_id` references to renamed notes dangle.
- **Turso payload size**: the whole vault's content replicates. Marco explicitly accepted journal content living on Turso, but the first push after seeding will be large and slow (the same "first sync push is slow with large datasets" caveat already in CLAUDE.md).
- **Wikilink resolution is name-based**, not Obsidian's full shortest-unique-path algorithm: exact path, then filename stem, then title (`vault::index::resolve_link`). Two notes with the same stem in different folders resolve to the shorter path. Worth revisiting only if Marco hits it in practice.
- **Vault notes are read-only in the app.** The vault library, search, link graph, backlinks and "Open in Obsidian" all ship; editing does not — see the superseded-task notice on Task 12 for why. The entire writer layer (`vault::writer`, `vault_save_note`, `vault_create_note`) remains implemented, tested and reachable from Rust; only the editor's `onChange` is disconnected. Re-enabling editing means adding a byte-exact source editor plus the round-trip fidelity test described there, not re-wiring Tiptap.
- **`vault::writer::resolve` does not defend against symlinks.** It rejects `..` segments, absolute paths, non-markdown files and excluded paths, but never canonicalizes the resolved path to confirm it still sits under the vault root. A symlinked directory or file inside the vault could therefore let a write land outside it. Deferred deliberately (Task 6 review): it requires a symlink the user created themselves inside their own vault, and the fix needs canonicalization with not-yet-created-parent handling. Fix by canonicalizing the deepest existing ancestor and checking it against the canonicalized root.
- **Changing the vault path requires a relaunch** to re-point the watcher. `vault_runner::start` reads the path once at setup; "Rescan vault" re-indexes against the new path but the live `notify` watch still points at the old root. Restarting the watcher on a path change is a small follow-up (swap the `VaultWatchState` contents), not wired here.
- **Vault notes have no delete affordance** in the app by design — deleting a real file from a sidebar hover target isn't a risk worth taking. Deletion happens in Obsidian or Finder; the watcher tombstones the row.
