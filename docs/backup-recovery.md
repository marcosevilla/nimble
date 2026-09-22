# Offline backup recovery

Recovery creates a **new isolated directory** containing `recovered.db`. It never installs that database into Nimble or starts Tauri, watchers, sync, API clients, or mutation observers. Only canonical export version 1 / schema 19 is currently supported. New schemas require a reviewed importer update.

Local generation directories contain `snapshot.db`, `manifest.json`, and `export/{data,format}.json`. The snapshot includes settings, credentials, device identity, integration cursors, pending queues and sync history: keep it private. Portable JSON includes reviewed user records and indexed vault note content, but excludes credentials, preferences, caches, device identity, queues and sync history. It preserves external IDs as historical linkage, not authorization to reconnect. Neither route backs up Obsidian attachment files or the vault filesystem itself.

## Verify an isolated recovery

Use absolute paths with real, non-symlink ancestors. Resolve the temporary parent first on macOS (`/tmp` may be a symlink); the destination itself must not exist. All macOS `Library/Application Support` destinations and current bundle-ID paths are rejected, including descendants. Existing directories, files, hard-linked source files and symlink paths are refused. Recovery uses private staging files (0600) and directories (0700), verifies before publication, and refuses destination races.

From the repository root, run exactly one form, replacing paths with **synthetic scratch fixture** locations for drills:

```sh
cargo run -p nimble-core --example backup_recovery -- snapshot --source /private/tmp/nimble-drill/generation --dest /private/tmp/nimble-drill/snapshot-restored
cargo run -p nimble-core --example backup_recovery -- export --source /private/tmp/nimble-drill/export --dest /private/tmp/nimble-drill/export-restored
```

Successful output contains only the recovered database path and `verified=true`. Snapshot verification checks the manifest, hashes, database integrity, foreign keys, full ordinary-table contents and byte-identical canonical exports. Portable recovery validates exact tables, keys, declared scalar types, full primary keys, schema and format; it clears migration-seeded defaults, imports using bound SQL in one deferred-FK transaction, rebuilds active vault-note FTS, and requires byte-identical canonical re-export. Do not hand-edit canonical archive files: malformed, incompatible or noncanonical input fails closed. A rejected recovery publishes no unverified database. A late filesystem flush failure may leave a fully verified directory; inspect it before retrying and never overwrite it.

## Recover an historical private Git export

Select the intended commit from the configured private archive. Clone or check it out into a separate private temporary directory, without changing the managed backup checkout. Inspect the commit ID and date, then supply that checkout's `export` directory to the export command and a different, nonexistent destination. The recovery utility itself makes no Git or network calls. Use a disposable local bare remote containing synthetic records for development drills; never upload real data as a test fixture.

Portable recovery deliberately leaves integrations and preferences empty. Migration metadata remains valid. Task/project sync metadata is NULL. A later application activation would need fresh sign-ins/preferences and a fresh device identity, but this utility performs none of those actions.

## Activation is a separate procedure

**Do not copy `recovered.db` over the live database.** Before any future reviewed activation: quit Nimble fully, preserve the current database plus any `-wal` and `-shm` sidecars together, and retain the verified recovery in isolation. Decide how to reconcile newer Turso and Todoist changes before reconnecting.

Snapshots preserve old device IDs, cursors and pending operations; reconnecting them blindly can replay stale operations or skip history. Portable external IDs also need reconciliation. C1 proves point-in-time data recovery; it does not promise lossless remote rollback. Live activation/reconnection remains an open, separately reviewed prerequisite for the wider Todoist cutover.

## Synthetic checks

```sh
cargo test -p nimble-core --test backup_recovery --offline
cargo test -p nimble-core --example backup_recovery --offline
cargo test -p nimble-core --lib db::recovery --offline
```

These checks use only temporary synthetic databases. They cover both round trips, source preservation, excluded integration state, FTS rebuilding, malformed types/keys/format/references, existing and protected destinations, symlinks, and publication-race cleanup. End-to-end Git retrieval and native Settings smoke evidence are recorded separately by the integration task.
