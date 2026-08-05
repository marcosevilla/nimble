# Todoist + Obsidian Integration — Design Spec

**Date:** 2026-08-04
**Status:** Approved by Marco (direction + design), pending implementation plan
**Companion research:** `2026-08-04-todoist-obsidian-integration-research.md` (raw discovery-workflow reports with source URLs)

## Goal

Make daily-triage the complete source of truth for tasks, docs, and context:

1. **Todoist** becomes a detachable two-way sync adapter over the fully native task model — mirror now (Todoist mobile covers the iPhone gap), clean sunset later once the app's own mobile capture + reminders exist.
2. **Obsidian** integrates as a unified docs library — one docs UI over two backends: vault notes remain markdown files on disk (files = physical truth, app edits them in place), app-native docs remain DB-first.
3. **Mobile-ready by construction:** hub-and-spoke — the Mac is the only integration host; the iPhone app syncs the resulting SQLite state through the existing Turso layer.

### Decisions locked with Marco

| Decision | Choice |
|---|---|
| Todoist role | Two-way mirror via detachable adapter; planned sunset when own mobile stack covers capture + reminders |
| Docs model | Unified library: vault notes file-backed, native docs DB-backed, one UI |
| Content format | Everything markdown; one-time migration of existing native docs from Tiptap HTML |
| Vault scope | Whole vault indexed AND content replicated through Turso cloud sync now (Marco explicitly accepts journal content residing on Turso's servers) |

## Architecture overview

All business logic lives in `daily-triage-core` (existing rule: frontend never does HTTP; Tauri commands are thin wrappers). New work follows the same shape.

```
daily-triage-core/
  src/integrations/            ← NEW: adapter layer
    mod.rs                     (shared: outbox draining, sync-state helpers)
    todoist/                   (client, sync loop, mappers)
  src/vault/                   ← NEW: VaultService (watcher, scanner, parser, writer)
  src/db/                      (migration v17+, new tables below)
apps/desktop/src-tauri/src/commands/   (thin command wrappers, registered in lib.rs)
apps/desktop/src/              (unified docs UI, retire legacy Todoist view)
apps/mobile/services/          (mirror new synced tables in database.ts + sync allowlist)
packages/types/                (TS types for new/changed models)
```

## Part 0 — Foundation fixes (prerequisites)

1. **Plumb `external_id`/`external_source` through task CRUD.** Columns exist since migration v15 but `LocalTask` (`daily-triage-core/src/types.rs`), `SELECT_COLS`, and `row_to_task` in `db/tasks.rs` omit them — normal edits currently cannot see or preserve the Todoist link. Add to the Rust struct, all queries, and `@daily-triage/types`.
2. **Docs → markdown migration.** Convert `documents.content` from Tiptap HTML to markdown (Rust-side HTML→MD conversion, e.g. `htmd`); switch the Tiptap pipeline to markdown serialization (`tiptap-markdown`). Migration runs in dry-run mode first (report of any lossy conversions across Marco's real docs), backs up the DB, then commits. `doc_notes` content converts the same way.

## Part 1 — Todoist two-way sync

### Schema (migration v17)

```sql
-- queued local mutations destined for Todoist
todoist_outbox(id TEXT PK, local_id TEXT, object_type TEXT /*task|project*/,
  op TEXT /*create|update|close|reopen|delete|move*/, payload_json TEXT,
  command_uuid TEXT NOT NULL,   -- persisted BEFORE sending; idempotent retries
  temp_id TEXT,                 -- for creates; response maps temp→real id
  status TEXT DEFAULT 'pending' /*pending|sent|done|error*/,
  error TEXT, created_at TEXT, updated_at TEXT);

-- per-provider incremental sync cursor
integration_sync_state(provider TEXT PK, sync_token TEXT, last_sync_at TEXT,
  last_full_sync_at TEXT, enabled INTEGER DEFAULT 1);

-- per-row sync metadata on local_tasks + projects
ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT;
ALTER TABLE local_tasks ADD COLUMN synced_hash TEXT;  -- hash of last-synced remote-visible fields; distinguishes real remote changes from echoes of our own push
-- (same two columns on projects)
```

Tombstones: task deletion already flows through `sync_log`; deletions of Todoist-linked tasks additionally enqueue a `delete` op and the row is soft-retained until the push confirms.

### Sync loop (serialized state machine — never concurrent runs)

1. **Push:** drain `todoist_outbox` as batched `/api/v1/sync` `commands` (≤100/request) with stored `command_uuid`s and `temp_id`s. On per-command `ok`, mark done and record `temp_id → real id` into `external_id`.
2. **Pull:** incremental sync with stored `sync_token` (`resource_types`: items, projects, sections, completed_info). Push-before-pull means the returned token already reflects our writes.
3. **Merge:** per row — remote changed + no pending local op → apply remote; both changed → field-level merge (content, due, priority, project treated independently), last-write-wins per field by timestamp. `synced_hash` filters echo updates.
4. **Commit:** new `sync_token` persisted in the same SQLite transaction as applied deltas.

### Semantics

- Recurring completion → `item_close` (advances recurrence; item id persists across occurrences — same local row). Never rewrite the full `due` object on reschedule.
- Priority mapping inverted (Todoist 4 = UI p1). Subtasks via `parent_id`, parents created before children in one batch via temp_ids. Sections remain `section:{id}` pseudo-projects (existing importer convention).
- Local statuses `in_progress`/`blocked` are local-only; Todoist sees open/closed.
- Auth: existing personal API token (`todoist_api_token` setting). Client already on unified API v1 (v2/v9 are dead). Mind the documented pagination-cursor URL gotcha.
- New Todoist tasks arriving via pull are created as native tasks (this is how phone capture flows in during the mirror era).
- Mirror is symmetric: app-created tasks and projects enqueue `create` ops so Todoist reflects full task state (that's what keeps Todoist mobile trustworthy until sunset). The mutation-observer that enqueues outbox ops hooks both direct local edits and rows arriving via Turso pull (phone-originated changes).

### Triggers

On launch, on window focus, ~5-minute tokio background interval (new — spawned in `src-tauri/src/lib.rs` setup), and debounced (~10s) after any local mutation of a Todoist-linked row. Failures back off; app remains fully functional offline (outbox accumulates).

### UI changes

- Retire the legacy cached view: `useTodoist.ts`, `components/todoist/TaskRow.tsx`, and the `todoist_tasks` cache table's UI role (table dropped in a later migration once stable). One native task list.
- Settings: adapter on/off toggle (the sunset switch), last-sync status line, per-row sync-error surfacing kept minimal (neutral "couldn't sync — will retry" framing, no guilt).
- `todoist_migration.rs` one-time import remains the onboarding path for first connect.

## Part 2 — Obsidian vault service

### Core (`daily-triage-core/src/vault/`)

- **Watcher:** `notify` + `notify-debouncer-full` (≈500ms) on `obsidian_vault_path`, background thread, events → Tauri events to the webview. Full rescan on launch (walk + mtime/size pre-check, blake3 hash to confirm changes) covers missed events. Watcher state is Mac-only.
- **Parser:** Obsidian-flavored markdown — YAML frontmatter, `[[wikilinks]]` (incl. heading/block refs), embeds, tags. Prefer `turbovault-parser`; fallback `pulldown-cmark` + `gray_matter` + wikilink regex.
- **Index + content tables (migration v17, synced via Turso — see Part 3):**

```sql
vault_notes(id TEXT PK /*uuid*/, path TEXT UNIQUE /*vault-relative*/, title TEXT,
  content TEXT, frontmatter_json TEXT, mtime TEXT, size INTEGER, hash TEXT,
  updated_at TEXT, deleted_at TEXT);
vault_links(from_note_id, to_path, link_type /*wikilink|embed*/);
vault_tags(note_id, tag);
-- FTS5 virtual table over title+content (device-local, rebuilt per device)
```

Exclude list setting (default: `.obsidian/`, `templates/`, attachments/binary files).

- **Writer (edit-in-place):** app edits serialize markdown and write the file atomically (temp + rename) with a pre-write hash check against hash-at-read. Divergence → write `<name> (conflict <timestamp>).md` beside it + non-blocking UI banner; never silently overwrite. File watcher then re-indexes both.
- **iCloud hazard:** if the vault lives in iCloud Drive, handle dataless files defensively (check `SF_DATALESS`; treat unreadable files as pending, don't error the scan). Recommend to Marco the vault not live in iCloud, but don't require it.
- Existing `commands/obsidian.rs` reads (today.md, quick captures, journal briefs/sessions, checkbox toggle) are re-pointed at VaultService; behavior preserved.

### UI (unified library)

- Docs sidebar gains a **Vault** section mirroring vault folder structure alongside native doc folders; one search (FTS across both), one Tiptap editor (markdown mode) for both backends.
- Vault notes render wikilinks as clickable (resolve via `vault_links`; unresolved links offer note creation). "Open in Obsidian" action via `obsidian://open` URI.
- Native docs keep `doc_notes` and task-linking as-is; vault notes don't get `doc_notes` (no file analogue).
- `docsStore.ts` grows a backend discriminator (`native` | `vault`) routed through the DataProvider; `local_tasks.linked_doc_id` may reference either kind.

## Part 3 — Mobile extensibility (hub-and-spoke)

- **Mac is the sole integration host.** Todoist sync loop and VaultService run only on desktop. Mobile never calls Todoist or touches files.
- **Sync surface:** `vault_notes`/`vault_links`/`vault_tags` join the existing `sync_log`/Turso replication; mirror schemas in `apps/mobile/services/database.ts` and add to the sync allowlists (Rust `sync.rs` + TS `sync.ts`). `todoist_outbox` and `integration_sync_state` stay **Mac-local** (single writer to Todoist — mobile never needs them). FTS stays device-local.
- **Phone-originated external actions:** completing a Todoist-linked task on mobile is just a normal `local_tasks` mutation that syncs to the Mac; the Mac's mutation-observer enqueues the outbox op. Mobile vault edits (later) write to `vault_notes` with a `pending_file_write` flag the Mac replays onto disk — same conflict rules.
- **Freshness caveat (accepted):** mobile is as fresh as the Mac is awake. Escape hatch if it chafes: the Todoist adapter (API-only) can lift-and-shift to a small cloud cron writing to Turso; Obsidian stays Mac-bound regardless.
- **Hygiene enforced now:** UUID PKs, `updated_at` + soft-delete on all synced tables, no absolute paths in synced rows (vault-relative only), integration state in tables not code.

## Error handling

- Sync failures are non-fatal and quiet: retry with backoff, neutral status in settings, no modal interruptions.
- Outbox ops that error terminally (e.g. task deleted remotely) mark `error` with reason, surfaced in a settings-level list, never lost.
- Vault scan errors (unreadable file, parse failure) skip-and-log per file; one bad note never breaks the index.

## Testing

Repo currently has zero tests. Scope tests to where bugs destroy data:

1. **Merge logic** (Todoist field-level merge, echo detection, recurring-close) — pure-Rust unit tests in `integrations/todoist/`.
2. **HTML→markdown conversion** — dry-run report against Marco's real docs DB before the migration commits; unit tests for representative Tiptap structures.
3. **Vault writer conflict path** — unit test: hash-diverged write produces conflict copy, never overwrites.

Everything else stays pragmatic (personal app).

## Explicit non-goals

- No Todoist webhooks/OAuth app (polling + personal token is correct for a desktop app).
- No Obsidian Local REST API / official CLI dependency (both require Obsidian running; optional future enhancement only).
- No CRDTs / new sync engine — existing Turso LWW layer is sufficient for one user.
- No secure-keychain migration of tokens in this project (existing plaintext-settings pattern retained; separate concern).
- No mobile vault *file* access — phone sees the synced index/content, never the filesystem.

## Build order

1. **Foundation:** external_id plumbing; docs markdown migration (dry-run → commit).
2. **Todoist two-way sync:** schema v17, outbox + sync loop, triggers, retire legacy view.
3. **Vault:** VaultService index + unified library read/search → then edit-in-place + conflicts.
4. **Mobile:** table mirroring + allowlists, background scheduler polish, phone-intent path.

Each phase ships independently and leaves the app fully working.
