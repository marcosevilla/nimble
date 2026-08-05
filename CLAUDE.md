# Daily Triage

A personal daily triage and briefing macOS app built with Tauri 2.0.

## Tech Stack
- **Frontend (desktop):** React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui (base-nova style)
- **Frontend (mobile):** React Native (Expo) + TypeScript + StyleSheet
- **Backend:** Rust (Tauri 2.0) + `daily-triage-core` library crate
- **Database:** SQLite via sqlx (desktop) / expo-sqlite (mobile)
- **Sync:** Custom sync protocol via Turso (hosted libSQL) — last-write-wins, single-user
- **State:** Zustand (appStore, focusStore, detailStore) via DataProvider abstraction
- **AI:** Claude Haiku via Anthropic API (priorities generation, task breakdown)

## Commands
- `cd apps/desktop && npm run tauri dev` — Start full Tauri desktop app
- `cd apps/mobile && npx expo start` — Start Expo mobile dev server
- `cd apps/desktop && npm run build` — Build desktop frontend for production
- `cd apps/desktop && npm run tauri build` — Build distributable .app
- **No test suite yet** — no unit or integration tests

## Project Structure (Monorepo)
```
daily-triage/
├── apps/
│   ├── desktop/              (Tauri desktop app)
│   │   ├── src/              (React frontend)
│   │   ├── src-tauri/        (Rust backend — thin command wrappers)
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── mobile/               (Expo React Native app)
│       ├── app/              (expo-router file-based pages)
│       ├── services/         (database, sync, providers)
│       ├── constants/        (theme)
│       └── package.json
├── packages/
│   └── types/                (shared TypeScript types — @daily-triage/types)
├── daily-triage-core/        (Rust library crate — all business logic)
│   ├── src/db/               (tasks, projects, captures, goals, habits, docs, sync, etc.)
│   ├── src/api/              (todoist_migration, anthropic, calendar, updater)
│   ├── src/parsers/          (ical, markdown)
│   └── src/types.rs          (all domain types)
├── docs/                     (architecture docs, research)
├── Cargo.toml                (Rust workspace root)
└── package.json              (npm workspace root)
```

## Architecture Rules
- All API calls happen in Rust, never in the React frontend (CORS + security)
- All file system access happens in Rust via tauri-plugin-fs
- All URL opening happens via the custom `open_url` Rust command (not shell plugin)
- Frontend communicates with backend via `invoke()` Tauri commands
- Zustand stores for global state (app, focus, detail). Local state for ephemeral UI.
- `emitTasksChanged()` event bus to sync all `useLocalTasks` instances after mutations
- Activity logging via `crate::db::activity::log_activity()` — fire-and-forget, never fails user-facing commands
- Task/project mutations must go through `db/tasks.rs` / `db/projects.rs` CRUD fns (they feed sync_log AND the Todoist outbox observer) — never raw SQL from commands

## Adding a Rust Command
1. Add the business logic function in `daily-triage-core/src/db/<domain>.rs`
2. Create a thin Tauri wrapper in `apps/desktop/src-tauri/src/commands/<domain>.rs`
3. Export the module in `apps/desktop/src-tauri/src/commands/mod.rs`
4. Import it in `apps/desktop/src-tauri/src/lib.rs`
5. Register in the `invoke_handler![]` macro in `lib.rs`
6. Add TypeScript wrapper in `apps/desktop/src/services/tauri.ts`

## Database Migrations
- SQLite managed via sqlx (desktop Rust) and expo-sqlite (mobile TypeScript)
- Versioned migration system in `daily-triage-core/src/db/migrations.rs` (Rust) and `apps/mobile/services/database.ts` (TypeScript mirror)
- Both platforms share the same schema — keep migrations in sync
- Current version: **18** (v1-13: core schema + v14: sync_log table + device_id + v15: external_id/external_source tracking on local_tasks/projects + v16: capture context column + v17: todoist_outbox, integration_sync_state, and remote_updated_at/synced_snapshot columns for two-way sync + v18: vault_notes/vault_links/vault_tags + device-local vault_fts (FTS5))
- `schema_version` table tracks what's been applied

## Key Tables
- `settings` — key-value config store
- `projects` — native project labels (id, name, color, position). Default: Inbox
- `local_tasks` — native tasks with subtask support (parent_id), priority, due dates, descriptions, status workflow
- `captures` — native captures (migrated from Obsidian Quick Captures.md)
- `activity_log` — timestamped activity events (action_type, target_id, metadata JSON)
- `capture_routes` — user-configurable prefix routing for captures (prefix, target_type, doc_id, label, color, icon)
- `goals` — annual/life goals with status, life area, start/target dates, auto-calculated progress
- `milestones` — binary checkpoints under goals with optional target dates
- `life_areas` — categories for goals (Career, Health, Creative, Financial, Personal, Learning)
- `habits` — daily repeatable actions (name, category, icon, color)
- `habit_logs` — daily check-off records (habit_id, date, intensity 1-5)
- `daily_state` — per-day energy level, cached AI priorities, focus session state
- `todoist_tasks` — legacy cache — UI retired, table dropped in a future migration
- `todoist_outbox` — pending local→Todoist mutations (create/update/delete ops, status, retries) driving the two-way sync push (Mac-local, not synced)
- `integration_sync_state` — per-provider sync token, last sync/error timestamps, enabled flag (Mac-local, not synced)
- `calendar_events` / `calendar_feeds` — cached calendar data with 7-day window caching
- `sync_log` — change tracking for cross-device sync (table_name, row_id, operation, snapshot, device_id, timestamp)
- `vault_notes` — indexed Obsidian notes (vault-relative path, content, frontmatter JSON, blake3 hash, soft-delete). Files on disk are the source of truth; this table is a derived index that also syncs.
- `vault_links` — wikilink/embed edges between notes (deterministic ids, replaced on re-index)
- `vault_tags` — inline + frontmatter tags per note (deterministic ids, replaced on re-index)
- `vault_fts` — FTS5 index over note title+content. Device-local, never synced, written by `vault::index`, not by SQL triggers (the migration runner splits on `;`)

## Task Status Workflow
- Statuses: `backlog` → `todo` → `in_progress` → `blocked` → `complete`
- Default for new tasks: `todo`
- Focus mode auto-sets `in_progress` on start, `complete` on finish
- Blocked status prompts for reason (logged to activity)
- Status changes logged as `status_changed` activity events

## Style Guide
- Use shadcn/ui components as base, customize with Tailwind
- Path alias: `@/` maps to `src/`
- Import shadcn components from `@/components/ui/`
- Import utils from `@/lib/utils`
- Use `cn()` for all conditional class merging (never template literals)
- Use `openUrl()` from `@/services/tauri` for all URL opening (never shell plugin `open()`)
- Use `taskToast()` from `@/lib/taskToast` for task-related toasts (includes "View" link)

## Anti-Patterns
- Don't make HTTP calls from the frontend — use Rust commands
- Don't access SQLite from the frontend — use Rust commands
- Don't use loading spinners — use skeleton placeholders matching content shape
- Don't show "overdue" labels — use neutral "still open" framing
- Don't add guilt-inducing UI (streaks, "you've been away" messages)
- Don't use `<button>` inside `<TooltipTrigger>` — causes nested button crash in Tauri webview

## Known Gotchas
- Todoist API pagination cursors are base64-ish opaque tokens containing `+`, `/`, `=` — appending them to a URL via naive string concat mangles `+` into a space and breaks the next request (symptom: an exactly-500-task cap from Todoist's v1 API). Always build these URLs with `reqwest::Url::parse(...).query_pairs_mut().append_pair()`.
- React flex truncation requires `min-w-0` on EVERY ancestor in the flex chain, not just the truncating element — missing it on `<main>` (a flex-1 child inside overflow-y-auto) lets intrinsic content width silently push the whole page wide into horizontal scroll. Add `overflow-x-hidden` on the scroll container as a belt-and-suspenders guarantee.
- Mobile: `min-h-dvh` + `overflow-y-auto` does not enable scrolling if inner content uses `flex-1` without a constrained parent height. Use `h-dvh` + `flex flex-col` on the outer container so `flex-1` children get bounded remaining space.
- shadcn Checkbox className overrides (e.g. `data-checked:bg-white`) don't reliably beat the internal `data-checked:bg-primary` on dark backgrounds. Build a custom checkbox button for dark UIs instead.
- Expo in this monorepo requires `metro.config.js` (with `watchFolders` + `nodeModulesPaths` pointing to the monorepo root) and `babel.config.js` (`babel-preset-expo`). Without both, the app renders a blank white screen with no error.
- Before deriving layout from a screenshot or reference capture, verify which UI state it shows — Daily Triage renders different layouts for the guided morning flow (Today page, first open, centered ~520px) vs. the dashboard (review complete). Take final dimensions from `getBoundingClientRect`, not image estimates.
- When working from screenshots of this app, verify the dark 44px circle bottom-right isn't the Agentation dev toolbar (collapsed) — it's a dev-only overlay, not real app UI.
- `services/data-provider.ts` is type-only at runtime — importing a value (e.g. `getDataProvider`) from it passes tsc but throws "Importing binding name not found" at module eval and blanks the whole app. Runtime provider access comes from `@/services/provider-context`.
- `npx tsc --noEmit` in `apps/desktop` type-checks NOTHING. `tsconfig.json` there is solution-style (`"files": []` + project references), so the bare command resolves it, checks zero files, and exits 0 regardless of how broken `src/` is. Use `npm run build` (which runs `tsc -b`, descending into `tsconfig.app.json`) as the real type check. This silently hid a production-build failure across two plans.
- `tiptap-markdown@0.9.0` ships no module augmentation for Tiptap's `Storage` interface, so `editor.storage.markdown` has no type. The repo supplies its own ambient declaration under `apps/desktop/src/types/` — don't "fix" a future error there with `as any`; that call produces the markdown written to real vault files.
- `run_migrations` splits each migration's SQL on `;`, so a statement containing an internal semicolon (`CREATE TRIGGER ... BEGIN ...; END`) is shredded into invalid fragments. Keep migrations to single-statement-per-semicolon SQL.
- Obsidian vault writes go through `vault::writer`, never `tokio::fs::write` directly — it hash-checks against what the app last read and diverts to a `(conflict <timestamp>).md` copy instead of overwriting an edit made in Obsidian.

## Architecture: DataProvider Abstraction
- `DataProvider` interface (`services/data-provider.ts`) decouples frontend from Tauri invoke
- Desktop: `TauriProvider` delegates to `services/tauri.ts` invoke wrappers
- Mobile: `SqliteProvider` talks directly to expo-sqlite
- Stores access provider via `getDataProvider()` (module-level, not React context)
- 26 desktop UI components still call invoke wrappers directly from tauri.ts (Wave B migration pending — all stores + hooks are fully decoupled as of 2026-04-16)

## Sync Protocol
- Every mutation appends to `sync_log` (fire-and-forget, never blocks the mutation)
- Push: send unsynced entries + data mutations to Turso via HTTP pipeline API
- Pull: fetch remote entries, apply with LWW conflict resolution (skip if local is newer)
- "Seed Existing Data" command backfills sync_log for pre-existing data
- Turso URL format: `libsql://<db>-<org>.turso.io` (auto-normalized to https)
- Remote schema initialization runs once, creating every synced table on Turso (the list lives in `initialize_remote` in `daily-triage-core/src/db/sync.rs`)
- Vault tables replicate through the same sync_log pipeline; `vault_fts`, `todoist_outbox`, and `integration_sync_state` stay device/Mac-local
- Remote schema upgrades are gated per version by a `turso_schema_v<N>_upgraded` setting, since `initialize_remote` only runs once per database

## Current State

- **Last session:** 2026-04-16 (loop-closing + logging-system design)
- **Completed this session:**
  - Committed the outstanding CLAUDE.md monorepo/mobile/sync refresh (a58eaa1)
  - Audited all 48 files importing from `services/tauri`; split into Wave A (22 type-only) and Wave B (26 UI components still calling invoke wrappers)
  - Executed Wave A: bulk renamed `@/services/tauri` → `@daily-triage/types` across 22 files (7e3252a). All 4 stores + 6 hooks now fully decoupled from tauri.ts. `tsc --noEmit` clean.
  - Added git remote `origin` → github.com/marcosevilla/todo and force-pushed clean 50-commit history (overwrote the README-only placeholder commit)
  - Designed v2 logging system proposal with Marco (hooks + nightly rollup + opt-in /note); saved to `~/Obsidian/marcowits/claude-sync/logging-system-v2.md`
- **Known issues:** Tiptap duplicate link extension warning. HelpPanel roadmap data is stale. First sync push is slow with large datasets. 26 desktop UI components still call invoke wrappers directly (Wave B — scoped as a dedicated follow-up session).
- **Next up:** Per the v2 proposal's build order, next session = drop-or-fix decision on `daily-brief-data` repo. After that: hook scripts → /note skill → nightly rollup. Unrelated work still pending: Phase 3 mobile polish, evening review flow, goals detail page, Wave B migration (~26 files × ~100 callsites).
