# Task 2 report — native task transactions

Implemented connection-taking `create_task_tx`, `update_task_tx`, `set_status_tx`, and `delete_task_tx` in `db/task_tx.rs`. Public task APIs retain their signatures, begin `BEGIN IMMEDIATE`, commit task rows, label assignments, Turso sync records, and required Todoist outbox intents together, then log activity after commit. `TaskEffects.changed` holds post-mutation tasks (parent first on status changes), `deleted` holds pre-delete child and parent snapshots, `recurrence` holds task ID and before/after due strings, and `previous_status` supports activity. Task 3 can use these effects inside its own transaction without acquiring another pool connection.

`MutationPolicy::User` writes sync records and Todoist intents when the adapter is active; intent errors abort the transaction. `Import` writes local/Turso records but never Todoist intents. `Remote` writes neither outbound record nor intent. Adapter activation is checked using local SQLite state on the caller's connection; no network or credential value fetch occurs under the lock. All observers and the unlinked seed suppress `local_only`; switching a task to `local_only` cancels pending unsent intents, and switching back to default reestablishes create intent. Already-sending operations cannot be revoked after they leave the transaction boundary.

Recurring native completion advances the due date and yields one due-update intent, with no close intent. `set_status_tx` does not itself deduplicate a caller replaying the same old occurrence; Task 3 must reject stale occurrence IDs before calling it. The existing twice-complete native test confirms that two actual completions advance twice.

## RED / GREEN

- RED: `focus_task_tx` failed to compile because `db::task_tx` was absent.
- RED: local-only Turso pull delete enqueued a Todoist delete; fixed by carrying pre-delete sync policy to the observer.
- RED: switching to local-only left a pending create; fixed by cancelling pending intents in the same task transaction.
- RED: switching back to default created no intent; fixed by enqueuing a create for the newly exportable task.
- GREEN: `cargo test -p nimble-core --offline --test focus_task_tx` — 8 passed, including active-adapter rollback and a synthetic SQLite trigger that aborts a close intent after the native status update and verifies rollback.
- GREEN: `cargo test -p nimble-core --offline db::tasks --lib` — 24 passed.
- GREEN: `cargo test -p nimble-core --offline integrations::todoist --lib` — 74 passed.
- GREEN: `cargo check --workspace --offline` — passed. Commands used the shared `CARGO_TARGET_DIR` from the task brief.

The full `nimble-core --lib` run had 236 passes and the pre-existing schema-20 backup assertion failure `db::sync::backup_lock_regression::replaced_job_lock_prevents_any_pruning` (`backup_export_unsupported_schema`), reserved for Task 4. No test was weakened.
