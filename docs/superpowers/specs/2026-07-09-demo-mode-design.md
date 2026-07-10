# Demo Mode — Design

**Date:** 2026-07-09
**Status:** Approved

## Purpose

A toggle that clears all visible content (inbox captures, tasks, docs, goals, calendar, Todoist) for demonstration purposes — screen-sharing, portfolio walkthroughs — while keeping Marco's real data fully intact in the background. Anything created during a demo vanishes when the toggle turns off.

## Requirements (from brainstorm)

1. Demo mode shows **empty states** everywhere — the fresh-install experience. No seeded sample data (may be added later).
2. Content created during a demo (captures, tasks, goals) **vanishes on toggle-off**. Real data is never polluted.
3. **Externally-synced content is hidden too**: Google Calendar events, Todoist tasks, Obsidian docs. Nothing personal on screen.
4. The wipe must **never propagate to Turso sync** — real data on other devices is untouched.

## Approach: separate demo database, selected at startup

All app content *and* all integration config (Turso credentials, Todoist token, calendar feeds, Obsidian vault path) live in one SQLite database. Demo mode swaps which database file the app opens:

- **Marker file** `demo-mode` in the app data dir (`~/Library/Application Support/com.marcosevilla.daily-triage/`).
- At startup, `lib.rs` checks for the marker: present → open `demo.db`; absent → open `daily-triage.db` (unchanged path).
- `demo.db` is created fresh on every entry into demo mode (existing migrations run, which seed default life areas and the Inbox project). Because its `settings` table is empty, sync, Todoist, calendar, and Obsidian are all automatically unconfigured — no special-case guards needed.
- Exiting demo mode deletes the marker and `demo.db`.

### Why not swap the pool at runtime?

The `SqlitePool` is Tauri managed state consumed by ~90 command handlers. Wrapping it in a lock would touch every command signature. Instead, toggling **restarts the app natively** (`tauri::process::restart`) — a 1–2s interruption that is acceptable because toggling happens before/after a demo, not during. The diff stays small and zero existing commands change.

### Rejected alternatives

- **Frontend data-provider filter:** ~26 UI components still call invoke wrappers directly (Wave B pending) and would leak real data.
- **`demo` flag column on rows:** touches every query in the Rust core, risks polluting `sync_log`.

## Components

### Rust — `commands/demo.rs` (new)

- `demo_status(app) -> bool` — marker file exists.
- `demo_toggle(app, on: bool) -> Result<(), String>` —
  - `on=true`: delete any stale `demo.db*`, write marker, restart app.
  - `on=false`: delete marker, delete `demo.db*` (unlink of the open file is safe on macOS; handles closed at process exit), restart app.
  - No-op if already in the requested state.

### Rust — `lib.rs`

DB filename chosen by marker presence. Log which database was opened. Register the two new commands.

### Frontend

- `services/tauri.ts`: `getDemoStatus()`, `toggleDemoMode(on)` wrappers.
- **SettingsPage**: new "Demo Mode" section with a `Switch` and description. Confirmation copy explains the app will restart.
- **NavSidebar**: persistent "Demo" pill/badge visible whenever demo mode is active, so it's obvious the app is in demo state (and provable that no real data is loaded).

Desktop only — mobile app is out of scope.

## Behavior notes

- Demo mode **persists across app restarts** (marker file) until explicitly toggled off. The sidebar pill keeps this visible. Rationale: a crash or accidental quit mid-demo shouldn't dump real data on screen.
- Real database is never opened, read, or written while in demo mode.
- Fresh `demo.db` per entry guarantees demos always start from a clean slate.

## Error handling

- Marker/db file operations surface errors to the frontend via the command `Result`; toast on failure, no restart.
- If `demo.db` creation fails at startup (disk full etc.), existing `expect` behavior applies (app fails loudly, same as today for the real DB).

## Testing (manual)

1. Toggle on → app restarts → every page shows empty state; Settings shows sync/integrations unconfigured; calendar sidebar blank.
2. Create a capture, task, and goal in demo mode → they behave normally.
3. Toggle off → app restarts → real data intact; demo items gone; `demo.db` and marker removed from disk.
4. Quit and relaunch while in demo mode → still in demo mode, pill visible.
5. Real DB file mtime unchanged across a full demo cycle.
