# C1 — Backup and restore safety net

**Date:** 2026-09-21
**Status:** Approved by Marco in this conversation. Implementation plan requested; application implementation has not started.
**Implementation plan:** [C1 backup and restore](../plans/2026-09-21-c1-backup-restore.md).
**Scope:** C1 of [the locked Todoist-replacement decisions](../../todoist-replacement-decisions.md). C2–C5 and Focus Queue remain separate.

## Outcome

Nimble keeps verified local database snapshots and a readable, credential-free export in a private Git repository. Recovery is demonstrated against an isolated database before C1 is considered done. A failed backup never destroys the last usable copy or reports success.

This is a database safety net. Obsidian files remain the source of truth for vault notes; backing up their derived index does not back up the vault's attachments or filesystem. Turso sync is not the backup.

## Approach and tradeoffs

1. **Recommended: full local snapshots plus portable JSON in private Git.** This follows decision D9, gives fast local recovery and readable offsite history, and separates credentials from uploads.
2. **Snapshots only:** simpler and preserves everything, but loses the agreed readable/offsite archive. Not recommended.
3. **JSON only:** readable and portable, but cannot preserve every device-local integration detail. Not recommended.

Approved refinements to the August decision: scheduling runs in the desktop app with catch-up after sleep/quit; restore is initially an offline recovery utility, not a live database swap; conflict-history UI is deferred because no durable conflict ledger exists.

## Verified code constraints

- `apps/desktop/src-tauri/src/lib.rs` opens `nimble.db` under Tauri's app-data directory, runs migrations, then starts vault and sync workers. Demo mode uses `demo.db`.
- `nimble-core/src/db/settings.rs` stores API credentials in `settings`. A complete snapshot therefore contains credentials.
- `nimble-core/src/db/migrations.rs` currently defines schema v19. C2 reserves v20 for reminders and label groups; C1 needs no domain-schema migration.
- `nimble-core/src/db/sync.rs` uses local `sync_log` timestamps for last-write-wins protection, including deleted records. Deleting all old synced rows would weaken that protection.
- Desktop sync runs on launch, every five minutes, and on focus. Restored queues must never reach these runners automatically.
- `nimble-core/src/test_util.rs::file_pool()` provides a real temporary database for snapshot tests. Use file-backed tests, not only in-memory tests.

## 1. Snapshot creation and retention

Store snapshots outside Git in `<app_data>/backups/`, with owner-only directory/file permissions. The app resolves paths; no hard-coded username. Demo mode must not schedule production backups or write the production archive.

Each run:

1. Acquire one backup-job lock shared by scheduled and manual runs. Only one process may publish/prune a backup set at a time.
2. Run `VACUUM INTO` to a unique temporary path on a dedicated database connection with no open transaction. Use a bound destination value, not SQL string interpolation.
3. Open the result independently, require `PRAGMA integrity_check` = `ok`, require an empty `foreign_key_check`, and verify the schema is supported. A pre-existing integrity problem produces a failed verification; preserve diagnostic output locally without logging user content.
4. Generate the export from this snapshot, not from the changing live database. Compute a BLAKE3 file checksum and record schema, UTC creation time, application version, row counts, and export-format version in a local manifest.
5. Flush and atomically publish the verified snapshot and manifest. Incomplete files never appear in the usable-backup list.

Keep the latest successful snapshot for each of the last **14 represented local calendar dates**, plus one latest successful snapshot for each of the last **8 represented ISO weeks**. Deduplicate overlaps. Keep the last verified snapshot regardless of age. Retention is based on successful generations, not elapsed empty dates while the app was closed. Only app-owned verified sets may be removed, after the replacement set is durable; reject paths/symlinks escaping the backup directory.

SQLite documents `VACUUM INTO` as a consistent live-database snapshot, but an interrupted output may be corrupt; temporary output and verification are therefore required. See [SQLite VACUUM documentation](https://www.sqlite.org/lang_vacuum.html).

## 2. Portable JSON contract

Use `~/Nimble-backups/` as a dedicated Git working directory. Commit only explicit generated paths: `export/data.json` and `export/format.json`. Never use `git add .`; never put snapshots, operational logs, or manifests containing machine settings into this repository.

`data.json` is deterministic: lexically sorted table names and object keys, rows ordered by their full declared primary key, UTF-8 with fixed indentation and a trailing newline. Preserve JSON integers, real values, strings and null distinctly. No generation timestamp in the canonical payload, so unchanged data produces identical bytes. `format.json` records export version, source schema and a stable list of included/excluded fields. A version change is explicit, not a silently changed archive contract.

Export complete user records, including completed items, from:

- Tasks: `projects`, `local_tasks`, `labels`, `task_labels`, `sections`.
- Captures and native docs: `captures`, `capture_routes`, `doc_folders`, `documents`, `doc_notes`.
- Goals and daily use: `life_areas`, `goals`, `milestones`, `habits`, `habit_logs`, `daily_state`, `activity_log`, `progress_snapshots`.
- Derived vault content: `vault_notes`, `vault_links`, `vault_tags`, explicitly labeled as an index, not a filesystem backup.

Exclude integration-only `remote_updated_at` and `synced_snapshot` columns from task/project records. Preserve external identifiers for attribution but do not treat them as permission to reconnect an integration. Exclude `settings`, `integration_sync_state`, `todoist_outbox`, `action_log`, `sync_log`, cached `todoist_tasks`/`calendar_events`, `calendar_feeds` (subscription URLs can contain credentials), FTS/shadow tables, and SQLite internal tables. Schema version goes in format metadata. These excluded records remain in the complete local snapshot.

Use explicit table/column policy. A schema-coverage test must classify every application table and column, so a new migration cannot silently leak settings or omit new task fields. Deliberately seeded credential values must be absent from the export. User-authored text is preserved as written; this is not a content-redaction service.

The portable archive restores user data into a fresh isolated database, not a ready-to-sync clone. Preferences and integration sign-ins must be reconfigured. This limitation must appear in the recovery instructions.

## 3. Schedule, Git, and failures

Recommended default: one daily run at **02:00 local time while Nimble is running**, plus a due check on launch and every five minutes. If the scheduled time was missed, run once at the next opportunity. A first installation with no verified backup is due immediately. Use a persisted last-successful date and an injected clock in tests; handle daylight-saving transitions without duplicate daily jobs.

This does not promise execution while the app is quit or the Mac is asleep. No LaunchAgent or second background service in C1. If strict unattended nightly execution is required, revise this choice before implementation.

The first setup requires a dedicated private remote selected or created during implementation setup. Verify it is private before the first push; never invent a URL or fall back to public hosting. Missing Git, credentials, or remote configuration must not prevent local snapshots. Use argument-vector process execution with sanitized error output and a timeout; do not place credentials in command arguments. Refuse an unrelated/dirty working tree and unexpected remotes. Never reset, force-push, or rewrite repository history.

Commit only when canonical export bytes changed. Push outstanding commits even when this run produces no new commit. Track separately: snapshot verified, export generated, local commit recorded, and remote push acknowledged. “Backed up offsite” requires the last step. Offline pushes retry with bounded backoff, at most once per 15 minutes while running; local recovery remains available.

Disk-full, locked database, permission, validation, and Git errors retain the previous good generation. Failed jobs do not advance last-success or trigger retention/pruning. Persist operational state in an atomic owner-only file under app-data, outside the backed-up database and Git, to avoid generating backup changes merely by recording a backup.

## 4. Conservative local sync-log pruning

Run only after a verified local snapshot exists for this job. Prune local rows older than **30 days** only when `synced = 1` and a strictly newer entry for the same `(table_name, row_id)` remains. Retain all entries tied at that record's maximum timestamp, every unsynced/unknown-status row, and latest DELETE tombstones even when the domain row no longer exists. Unparseable timestamps are retained.

Choose and delete candidates in one database transaction. Use the same timestamp ordering as the existing LWW check; do not introduce a different comparison rule in C1. Do not prune Turso's remote history or Todoist's outbox. Do not alter pull cursors, snapshots, or merge semantics.

This bounds redundant local history, not the number of deleted-record tombstones. Proving safety is mandatory: an older remote update must still be rejected after pruning, including for a deleted task. If that cannot be demonstrated, ship backup/export with pruning disabled and keep the C1 pruning item open.

## 5. Recovery and exit tests

Deliver a small offline recovery/verification utility using `nimble-core`, with a required source and **new, empty destination**. It must reject the production app-data directory, existing databases, and paths resolving through symlinks into them. It must not instantiate Tauri, watchers, API clients, CRUD observers, or sync runners. This is narrowly scoped tooling, not the C3 `dt` CLI.

**Snapshot route:** verify checksum/integrity and supported schema, restore to the isolated destination, then re-export with the same canonical exporter. Require byte-identical portable JSON and compare every ordinary application table against the source snapshot with type-preserving canonical records, including device-local queues/settings. Compare in memory or restricted temporary files without printing credentials. Physical database bytes and FTS internals need not match. A deliberately deleted/corrupted *test* database is replaced; the live database is never moved for this test.

**Offsite route:** read a selected committed export, validate format/schema and all keys, create a fresh isolated schema, clear seeded defaults, insert the exported records in a single transaction with foreign-key validation before publication, and re-export byte-identically. Populate no integration credentials, cursors, outboxes, or sync history. Generate a fresh device identity only if later opened by the application. Unsupported schemas fail before destination publication. Initial compatibility is the implemented schema/version pair; future migrations must extend the importer and fixtures before claiming compatibility.

Do not automatically install either recovered file as `nimble.db`. A recovery runbook must describe quitting the app, preserving the current database and any WAL/SHM sidecars as a set, and keeping the recovered database isolated while deciding how to reconcile newer remote edits. No copying over an open pool. C1 verifies recovery of the backup's point-in-time data; it does not promise lossless rollback of Turso or Todoist.

Snapshot recovery preserves old device IDs, cursors and pending queues. Resuming sync without reconciliation can replay stale operations or miss same-device remote history. Production activation/reconnection needs its own reviewed recovery procedure and is a prerequisite before declaring the wider Todoist cutover safe.

## 6. Settings surface

Add a compact desktop-only **Backups** section using existing Settings components:

- Last verified local backup and last acknowledged offsite push, shown separately.
- Export commit identifier, backup location, and retained snapshot count.
- Pending Turso changes and pending/failed Todoist operations, labeled separately. Query failure reads “Unavailable,” never zero.
- Actions: **Back up now**, **Open backup folder**, **Verify latest backup**. Verification uses a temporary isolated destination and never replaces production data.
- Short status for missing setup, in-progress work, or an actionable failure. No per-success notification and no guilt language.

Provider access follows the shared DataProvider contract. Add a typed backup capability, implemented by TauriProvider; TursoProvider reports unsupported and the web Settings page omits desktop backup controls. No direct Tauri imports in React components.

**Approved deferral:** the August C1 row names a conflict log. Current sync has no durable ledger suitable for that UI. C1 exposes errors and pending work, but does not imply “no conflicts.” A conflict journal and resolution surface stay open as a separate reliability item; do not silently check them off.

## Implementation boundaries

Expected ownership, to turn into a task-level plan after approval:

| Area | Files / responsibility |
| --- | --- |
| Core backup/export/recovery | New `nimble-core/src/db/backup.rs`, `export.rs`, `recovery.rs`; register in `db/mod.rs`; file-backed integration tests under `nimble-core/tests/` |
| Retention and safe pruning | Backup module plus narrowly scoped change/tests in `nimble-core/src/db/sync.rs` |
| Desktop orchestration | New `apps/desktop/src-tauri/src/backup_runner.rs` and `commands/backup.rs`; register commands/setup in existing modules; own scheduling, Git and operational status |
| Shared interface and UI | `packages/types/src/{index,data-provider}.ts`, desktop `services/{tauri,tauri-provider,turso-provider}.ts`, new `components/settings/BackupSection.tsx`, existing `SettingsPage.tsx` |
| Offline recovery | New `nimble-core/examples/backup_recovery.rs` and `docs/backup-recovery.md`; no general CLI or live restore button |

No reminders, new label schema, task-search implementation, native mobile revival, or live-data mutation during this design task.

## Acceptance checklist

- [ ] A file-backed database with completed tasks, nesting, labels, recurrence, goals, docs, nulls, integers, vault content, and pending integration rows snapshots and restores successfully.
- [ ] Canonical snapshot export equals restored export; complete snapshot table comparison also passes. Concurrent edits after the snapshot do not contaminate its export.
- [ ] Portable JSON from a local test Git remote restores into a fresh isolated database with byte-identical re-export. Configured credentials and queues are absent.
- [ ] Interrupted/corrupt output, disk/permission failures, Git rejection/offline state, and duplicate job attempts preserve previous backups and truthful status.
- [ ] Daily/weekly retention and missed-run/DST behavior pass clock-controlled tests. Demo mode cannot write the production archive.
- [ ] Pruning preserves unsynced rows, same-timestamp ties and latest tombstones; delayed remote edits cannot overwrite newer local state after pruning.
- [ ] Manual native-app check confirms Settings actions and filesystem capabilities work; browser mocks alone are insufficient.
- [ ] `cargo test --workspace`, desktop `npm run build`, and `npm run build:web` pass. Verify the private remote separately before enabling real-data pushes.
- [x] Marco approved the scope refinements above; `NEXT.md` and the linked implementation plan record the execution handoff.

## Review summary

Marco approved the snapshot + JSON design, catch-up scheduling, isolated recovery, and conflict-journal deferral. The implementation plan is the next execution guide. No real database has been read or changed, no backup repository created, and no implementation/tests run in preparing this draft.
