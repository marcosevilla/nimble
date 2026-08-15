# DORMANT — not part of the build

**Status as of 2026-08-14:** unplugged from the npm workspace. Not deleted, not maintained.

`apps/mobile` was removed from the root `package.json` `workspaces` array (`["apps/*", ...]` → `["apps/desktop", ...]`). It is no longer installed, built, or type-checked by anything at the repo root. The code is intact and the git history is intact.

## Why it was unplugged

Not for disk space — the source is ~260 KB against a 37 GB repo. It was unplugged because it carries **duplicate copies of things that have already drifted**:

- `services/data-provider.ts` (313 lines) is a parallel copy of the desktop `DataProvider` interface (392 lines), not a shared import. It has a `labels` domain the desktop interface lacks. That drift is why 6 of the 9 remaining `@/services/tauri` imports still exist on desktop.
- `services/database.ts` is a hand-maintained TypeScript mirror of `nimble-core/src/db/migrations.rs`. It skips v18 entirely (17 → 19).
- `services/sync.ts` `initializeRemote` still ships the pre-v15 DDL and has no `turso_schema_v*` upgrade gates, so a fresh remote created by the phone would be born at the April schema.

Leaving it listed as an active workspace implied it was maintained. It wasn't.

## Known bug — do not run this against real data

`services/sqlite-provider.ts` — `updateStatus` / `complete` / `uncomplete` write **partial** 5-key snapshots to `sync_log`, but receivers apply snapshots with `INSERT OR REPLACE`, which deletes and re-inserts the whole row. Completing a task on the phone would blank `content`, `due_date`, `priority` and ~14 other columns **on every device**. The Rust side always re-SELECTs the full 22-column row, which is why this has never fired from desktop.

The app has only ever run once (2026-08-06, empty, no sync wired), so this has almost certainly never actually happened. Filed under Todoist "Nimble fixes".

**Rule for any future client, web included: never write a partial snapshot. Always re-read the full row first.**

## What this does NOT foreclose

A web client cannot do an iOS home-screen widget, and web push on iOS is unreliable. If either becomes a requirement, this is the shell to revive — reviving it costs far less than starting over.

## To bring it back

1. Restore `"apps/*"` in the root `package.json` `workspaces` array
2. `npm install` at the repo root
3. Reconcile the three drifted files above against their current desktop/Rust counterparts **before** letting it write anything
4. Fix the partial-snapshot bug first

Context: `docs/web-client-architecture-decision.md`.
