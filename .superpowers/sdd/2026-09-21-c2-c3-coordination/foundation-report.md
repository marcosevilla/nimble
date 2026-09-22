# C2/C3 shared foundation report

Schema 20 is the single reviewed migration. It adds task reminder offset and Google publishing intent, nullable label group, and four device-local delivery/calendar tables. The dormant mobile migration mirror has the same SQL. New intent fields ride in task/label snapshots and portable exports; delivery/calendar state is explicitly excluded from portable data and Turso sync. Full private snapshots retain the local tables.

Interfaces: `migrations::CURRENT_SCHEMA_VERSION = 20`, `current_schema_version(pool) -> Result<i64>`, `run_migrations_to_version(pool, target) -> Result<()>` (only 19 or 20). `CreateTaskInput` and `UpdateTaskInput` add `reminder_offset_minutes: Option<i64>` and `google_calendar_enabled: Option<bool>`; updates also add `clear_reminder: bool`. `LocalTask` adds offset and bool. `labels::set_label_group(pool,id,group)` returns Label. `tasks::update_local_task_if_unchanged(pool,id,expected:&LocalTask,input)` returns `Option<LocalTask>`; `None` signals stale/missing row, and the comparison plus mutation run under SQLite's IMMEDIATE write lock. This helper accepts calendar-editable fields only and preserves sync/outbox observations.

A synthetic v19 SQL fixture was copied before migration edits (SHA-256 bd942a89c96131fa727a255b1b9c742c72485dff073d9b6f9997fcd319c8e068). Historical v19 snapshot and portable routes restore into isolated v19 DBs without upgrading or altering source archives. v20 export policy remains fail-closed for unknown schema, table, or column.

Verification: `cargo test -p nimble-core --offline --target-dir ../nimble-c1/target --test backup_export --test backup_snapshot --test backup_recovery` passed 6+12+5 tests; `--test schema20_compatibility` passed 4 tests; `v19_snapshot_does_not_clear_v20_intent` passed. `cargo test -p app --lib ... backup_runner` passed 7 tests, and full app lib passed 26. One full core suite run had only the known sandbox-sensitive vault watcher failure; the initial sync SQL assertion was repaired and focused rerun passed. Untouched main desktop backup runner had intermittent `backup_snapshot_failed` under the concurrently shared build target; this worktree's full desktop lib now passes. Use a distinct build target per worktree if that failure recurs.

No production database or live integration was accessed.

## Review round 1

Task updates now use one `sqlx::Pool::begin_with("BEGIN IMMEDIATE")` transaction for the row read, final-value validation, and coherent write. The Google optimistic update uses the same RAII transaction instead of raw BEGIN/COMMIT. Dropping or cancelling either future rolls back. New two-connection tests cover a concurrent due-time clear versus reminder set and cancellation releasing the writer lock; both pass.

The historical recovery test now uses an immutable archive emitted by the original C1 exporter from git commit `254bcf1`, extracted with `git archive` into a temporary synthetic checkout. Generation `22a15675-9a61-40f3-840e-47bb23f279e2` contains an untouched schema-19 snapshot and portable export. SHA-256: snapshot `7524d01215d768200db5f65497f11d8482f6fbe7d18d667044d282bd68eb57b9`, manifest `557e3dcfecb78fee2a599d6f1b2f8a27af40a60649ad745445276a34ad51db88`, data `3e5a1a4db66d17c913ad7b11d2687f312ba1c544d1b61172f50109677e9b97c2`, format `23ef9cb87d32b2ccbd63d71f50295c8d9092fbb4f064425a15463c17e5bb4e89`. The new test copies these bytes into a disposable directory and verifies both restore routes without generating a new archive.

Isolated-target `schema20_compatibility` passed 6/6; frozen C1 archive restore passed. Full core library ran 236 passing tests and one previously known filesystem-watcher test failure under the sandbox (`vault::watcher::tests::watcher_reports_changed_paths_within_the_debounce_window`).

## Review round 2

A task moved to another project without an explicit destination section now clears its retained section in the same transaction; the sync changed-columns list includes `section_id`. Edits within the same project retain the section, and an explicitly supplied section is still checked against the destination project. The focused `schema20_compatibility` suite passed 7/7 using the isolated build target.
