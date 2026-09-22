# C1 Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce verified local snapshots, a recoverable private-Git JSON archive, and truthful backup status without touching live data during development.

**Architecture:** `nimble-core` owns deterministic export, snapshot validation, isolated recovery, and conservative pruning. Small desktop modules own scheduling, process locking, Git publication, persisted operational state and commands. The existing DataProvider exposes a desktop-only Settings surface.

**Tech Stack:** Existing Rust 1.90, sqlx 0.8/SQLite, Tokio, serde_json, chrono, BLAKE3, Tauri 2, React/TypeScript. System Git and GitHub CLI for authenticated private-repository verification; unavailable tools degrade to local backups.

**Spec:** [Approved C1 design](../specs/2026-09-21-c1-backup-restore-design.md). Read it before this plan. Marco approved it in this conversation; approval covers catch-up scheduling, isolated recovery, and deferring the conflict journal.

## Global Constraints

- Keep the latest successful snapshot for each of the last **14 represented local calendar dates**, plus one latest successful snapshot for each of the last **8 represented ISO weeks**. Deduplicate overlaps. Keep the last verified snapshot regardless of age.
- Recommended default: one daily run at **02:00 local time while Nimble is running**, plus a due check on launch and every five minutes.
- Prune local rows older than **30 days** only when `synced = 1` and a strictly newer entry for the same `(table_name, row_id)` remains.
- Never use `git add .`; never put snapshots, operational logs, or manifests containing machine settings into this repository.
- No direct Tauri imports in React components.
- No LaunchAgent, production restore/swap, automatic remote reconciliation, remote-log pruning, schema-v20 migration, conflict journal, or general `dt` CLI.
- Develop with synthetic file-backed databases and disposable local Git repositories. Do not open production `nimble.db`, enable production scheduling, publish real data, or run `update-app` as part of ordinary tests.
- Preserve existing unrelated edits. Before implementation, read root/app CLAUDE.md and AGENTS.md, inspect Git state, then use an isolated worktree. No implementation has been performed by preparing this document.

## Decisions that make the spec executable

**Stages, not a single success flag.** Persist local generation success separately from upload success. A verified snapshot plus canonical export advances `last_local_success_at` and suppresses another automatic snapshot that day even if Git subsequently fails. Record failed upload separately and retry the same pending generation. Do not prune/retain on a configured publication failure; defer cleanup until publication succeeds. With no remote configured, a successful local-only run may clean up. This honors “failed jobs do not trigger pruning” without flooding snapshots while offline. Cleanup only considers log IDs present in that verified snapshot; it must not delete newly arrived historical rows that were never backed up.

**Git is an optional second stage, enabled explicitly.** The app's default has no remote configured. A one-time Settings setup field accepts an existing `OWNER/REPO` on github.com, verifies privacy with authenticated `gh repo view`, and adopts/clones only the dedicated `~/Nimble-backups/` directory. Never create or select a remote automatically. Runtime verifies immutable repository ID and privacy before every push. This adds one setup control needed to activate the approved private archive; no generic hosting-provider framework.

**Nightly catch-up slot.** The due slot is today's date at/after 02:00 local, yesterday's date before 02:00. If no backup has ever succeeded, run immediately and mark today's date; do not run twice that day. Store local date/timezone offset in manifests, UTC instants for retries. Compare dates monotonically to avoid repeated runs after clock rollback. A timezone change does not rewrite existing retention buckets.

**Crash recovery.** Completed generations are directories atomically renamed from `.partial-<uuid>` to `<utc>-<uuid>` under the same parent. Files are flushed before the directory rename; flush the parent after it. A validated generation can recover status after a crash between publication and status persistence. No raw SQLite files in Git. Incomplete directories are quarantined from listing/retention; remove them only when positively identified as this app's scratch files and the job lock is held.

**Dependencies.** Use Rust's file locking API available under the declared Rust floor; confirm on the pinned toolchain before implementing. Prefer existing dependencies. Add `chrono-tz` only as a test dependency if needed for real DST transition tests; fixed offsets alone do not test DST. No new frontend test runner for this scope.

## Files and task order

All paths below are relative to the Git root `nimble/`. Execute tasks 1–8 in order; each ends in focused tests and a commit. Task 4 touches sync merge protection and needs its own careful diff review. Do not run workers concurrently against shared interface files.

| Task | Ownership |
| --- | --- |
| 1 | `nimble-core/src/db/export.rs`, `export_policy.rs`, `db/mod.rs`, export tests/fixtures |
| 2 | `nimble-core/src/db/backup.rs`, `backup_storage.rs`, core backup types, snapshot tests |
| 3 | `nimble-core/src/db/recovery.rs`, recovery example, recovery tests and runbook |
| 4 | Minimal pruning addition in `nimble-core/src/db/sync.rs` and regression tests |
| 5 | Desktop `backup_git.rs`, `backup_state.rs`, Git/state tests |
| 6 | Desktop `backup_runner.rs`, `commands/backup.rs`, registration/lifecycle and runner tests |
| 7 | Shared types, desktop/web providers, Settings UI and browser mock commands |
| 8 | Integration verification, native smoke checks, documentation, NEXT.md |

## Task 1: Deterministic, explicitly scoped export

**Files:** Create `nimble-core/src/db/{export,export_policy}.rs`, `nimble-core/tests/backup_export.rs`, `nimble-core/tests/fixtures/backup-v19.sql`; modify `nimble-core/src/db/mod.rs`.

**Interfaces produced:**

```rust
// db/export.rs — all APIs return crate::Result.
pub struct PortableExport { pub data: Vec<u8>, pub format: Vec<u8> }
pub async fn export_portable(pool: &sqlx::SqlitePool) -> crate::Result<PortableExport>;
pub async fn validate_schema(pool: &sqlx::SqlitePool) -> crate::Result<()>;
pub async fn compare_snapshot_tables(a: &sqlx::SqlitePool, b: &sqlx::SqlitePool)
    -> crate::Result<bool>;
```

`format` is canonical JSON with `export_version: 1`, `schema_version: 19`, and sorted included/excluded column policies. `data` maps every included table to its rows, even when empty. `compare_snapshot_tables` compares all ordinary application tables, including settings/queues/schema_version, without printing mismatched values. Exclude only SQLite internals and FTS/shadow tables from that comparison.

- [ ] **1. Write a synthetic fixture and these failing tests.** Use `test_util::file_pool()`, execute the fixture with `sqlx::raw_sql`, and clean only the returned unique test file after closing the pool.

```sql
-- Initial fixture rows; all timestamps are fixed to avoid clock-sensitive diffs.
INSERT INTO settings(key,value) VALUES ('todoist_api_token','TEST_SECRET_DO_NOT_EXPORT');
INSERT INTO local_tasks(id,content,project_id,priority,completed,status,due_date,due_time,
 duration_minutes,recurrence_rule,description,created_at,updated_at)
VALUES ('task-a','Recurring task','inbox',2,0,'todo','2026-09-21','09:00',30,
 'every 2 weeks',NULL,'2026-09-21 00:00:00','2026-09-21 00:00:00');
INSERT INTO labels(id,name) VALUES ('label-a','Focus');
INSERT INTO task_labels(task_id,label_id) VALUES ('task-a','label-a');
```

```rust
#[tokio::test]
async fn export_is_repeatable_and_excludes_configured_secrets() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::raw_sql(include_str!("fixtures/backup-v19.sql"))
        .execute(&pool).await.unwrap();
    let a = nimble_core::db::export::export_portable(&pool).await.unwrap();
    let b = nimble_core::db::export::export_portable(&pool).await.unwrap();
    assert_eq!(a.data, b.data);
    assert_eq!(a.format, b.format);
    let text = String::from_utf8(a.data.clone()).unwrap();
    assert!(!text.contains("TEST_SECRET_DO_NOT_EXPORT"));
    let data: serde_json::Value = serde_json::from_slice(&a.data).unwrap();
    assert_eq!(data["local_tasks"][0]["priority"].as_i64(), Some(2));
    assert!(data["local_tasks"][0]["description"].is_null());
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn unknown_schema_columns_fail_closed() {
    let (pool, path) = nimble_core::test_util::file_pool().await;
    sqlx::query("ALTER TABLE local_tasks ADD COLUMN unexpected_secret TEXT")
        .execute(&pool).await.unwrap();
    assert!(nimble_core::db::export::export_portable(&pool).await.is_err());
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}
```

- [ ] **2. Run** `cargo test -p nimble-core --test backup_export`; expect missing export APIs before implementation.
- [ ] **3. Implement a literal schema policy.** Use the v19 inventory in Appendix A; do not derive the allowlist dynamically from whichever columns happen to exist. Verify exact schema version and full table/column coverage before exporting. Recognize `vault_fts` and its actual SQLite FTS shadow tables explicitly. Known excluded tables still have explicit column lists so drift fails review.
- [ ] **4. Implement stable serialization.** Query only reviewed quoted identifiers, order composite primary keys by PK ordinal, and inspect SQLite storage type per cell. Map integer to JSON i64, finite real to JSON number, text to string and NULL to null; reject unexpected BLOB/non-finite values. Never stringify all cells. `serde_json::to_vec_pretty` over ordered maps plus one newline supplies canonical bytes. Read inside one transaction; exporter is normally fed a read-only snapshot.
- [ ] **5. Extend fixture/tests** with complete/blocked/subtasks, nested projects, labels/sections, a document and note, linked goals/milestones, habits/logs, captures/routes, daily state, activity, progress snapshots, vault records, and every excluded integration credential/queue location. Add reverse insertion order, non-ASCII text, real-vs-integer round trip, composite key order, unknown table, and wrong-schema tests. Use referentially valid synthetic records; include a separate invalid-FK case for Task 2.
- [ ] **6. Run** `cargo test -p nimble-core --test backup_export`; all tests pass. Commit only the Task 1 files with `feat(backup): add deterministic portable export`.

## Task 2: Verified snapshots and bounded storage

**Files:** Create `nimble-core/src/db/{backup,backup_storage}.rs`, `nimble-core/tests/backup_snapshot.rs`; modify `db/mod.rs`. Put shared backup types in `backup.rs` initially, not the broad domain types file.

**Interfaces produced:**

```rust
pub struct BackupPaths {
    pub app_data: std::path::PathBuf,
    pub database: std::path::PathBuf,
    pub generations: std::path::PathBuf,
}
pub struct BackupManifest {
    pub id: String, pub created_at: String, pub local_date: String,
    pub local_iso_week: String, pub app_version: String,
    pub schema_version: i64, pub export_version: u32,
    pub snapshot_hash: String, pub data_hash: String, pub format_hash: String,
    pub row_counts: std::collections::BTreeMap<String, u64>,
}
pub struct VerifiedGeneration { pub directory: std::path::PathBuf, pub manifest: BackupManifest }
pub struct BackupJobGuard { file: std::fs::File, root: std::path::PathBuf }
pub fn try_lock(paths: &BackupPaths) -> crate::Result<Option<BackupJobGuard>>;
pub async fn create_generation(paths: &BackupPaths, at: chrono::DateTime<chrono::FixedOffset>,
    version: &str, guard: &BackupJobGuard) -> crate::Result<VerifiedGeneration>;
pub async fn verify_generation(directory: &std::path::Path) -> crate::Result<VerifiedGeneration>;
pub fn retention_candidates(generations: &[BackupManifest]) -> Vec<String>;
pub fn apply_retention(paths: &BackupPaths, ids: &[String], guard: &BackupJobGuard)
    -> crate::Result<()>;
```

Derive serialization for manifest and Clone where needed. Constructors enforce path validity; callers cannot manufacture a `VerifiedGeneration` that passed no verification. The declaration above lists fields for the implementer; make them read-only via getters at the public boundary. `BackupJobGuard` must bind to the canonical root; reject a guard obtained for another root.

- [ ] **1. Write the first snapshot test**, using a UUID-named root under `temp_dir()` with `db/` and `backups/`, created mode 0700. Test source database is produced with `file_pool()` and explicitly placed inside this unique root after pool close; reopen it for concurrent mutation cases.

```rust
// Inside backup_snapshot.rs, after building BackupPaths named paths:
let guard = nimble_core::db::backup::try_lock(&paths).unwrap().unwrap();
assert!(nimble_core::db::backup::try_lock(&paths).unwrap().is_none());
let at = chrono::DateTime::parse_from_rfc3339("2026-09-21T02:00:00-07:00").unwrap();
let generation = nimble_core::db::backup::create_generation(&paths, at, "test", &guard)
    .await.unwrap();
let verified = nimble_core::db::backup::verify_generation(generation.directory()).await.unwrap();
assert_eq!(generation.manifest().snapshot_hash, verified.manifest().snapshot_hash);
assert!(generation.directory().join("export/data.json").is_file());
```

- [ ] **2. Run** `cargo test -p nimble-core --test backup_snapshot`; expect unresolved backup module/functions.
- [ ] **3. Implement storage primitives.** Create directories with mode 0700 before writing credentials; files mode 0600. Reject symlinked roots/generations and destinations outside the canonical app-owned root. Keep the persistent lock file in place; use the OS lock, not its existence, as ownership. Open the source with `SqliteConnectOptions::read_only(true).create_if_missing(false)`, acquire a dedicated connection, use `VACUUM INTO ?` bound to the scratch path. Confirm behavior with file-backed tests on bundled SQLite; no production fallback copying a live `.db`.
- [ ] **4. Implement verification and publication.** Close the output connection after integrity/FK/schema checks and canonical export. Hash snapshot and export files, flush all files, write the manifest last, then rename the generation directory and flush its parent. `verify_generation` validates checksum, integrity, foreign keys, schema, filenames and export hashes, without migrations or mutation. List only complete verified sets.
- [ ] **5. Implement pure retention selection** from manifest local date/week buckets. Choose newest by `(created_at,id)`, retain latest 14 date buckets and 8 ISO-week buckets, plus newest overall. Deletion revalidates manifest/containment while holding guard; never recurse into unrecognized directories. It runs only when Task 6 authorizes cleanup.
- [ ] **6. Add failure tests:** corrupt snapshot/hash mismatch, invalid FK, unexpected schema, interrupted `.partial-*`, denied publication and simulated write failure (deterministic injected writer failure, not filling disk), second-process lock contention, retained newest snapshot after a long absence, date/week overlap and ISO year boundary. Exercise a write after snapshot creation and verify the export contains snapshot-time values. Verify restored FTS query behavior separately from physical row IDs.
- [ ] **7. Run** `cargo test -p nimble-core --test backup_snapshot` and Task 1 tests; commit `feat(backup): create and retain verified snapshots`.

## Task 3: Prove both recovery routes offline

**Files:** Create `nimble-core/src/db/recovery.rs`, `nimble-core/examples/backup_recovery.rs`, `nimble-core/tests/backup_recovery.rs`, `docs/backup-recovery.md`; modify `db/mod.rs`.

**Interfaces consumed:** `VerifiedGeneration`, `verify_generation`, `export_portable`, `compare_snapshot_tables`.

**Interfaces produced:**

```rust
pub struct RecoveryReport { pub output: std::path::PathBuf, pub verified: bool }
pub async fn restore_snapshot(generation: &std::path::Path, destination: &std::path::Path)
    -> crate::Result<RecoveryReport>;
pub async fn restore_export(export_directory: &std::path::Path, destination: &std::path::Path)
    -> crate::Result<RecoveryReport>;
```

Destination is a NEW DIRECTORY, not an existing database path; utility creates `recovered.db` inside a staged sibling directory. Hard-reject canonical production app-data directories (current bundle ID plus any detected legacy data location), their descendants, and symlink escapes, even if empty. Test policy includes an additional synthetic forbidden root; production roots are always added internally, not caller-removable. Do not claim that recovery output is safe to activate with sync.

- [ ] **1. Write tests for snapshot -> isolated restore -> identical export** using Task 2 generation fixture. Compare ordinary application tables via `compare_snapshot_tables`; do not log differences containing secrets.
- [ ] **2. Write the JSON round-trip test.** It reads the generation's `export/`, calls `restore_export`, then requires `data` AND `format` byte equality. Query every excluded credential/queue table in the destination to confirm empty integration state; retain legitimate migration metadata. Verify non-exported task/project sync metadata is NULL.

```rust
let report = nimble_core::db::recovery::restore_export(&export_dir, &new_destination)
    .await.unwrap();
assert!(report.verified);
let options = sqlx::sqlite::SqliteConnectOptions::new()
    .filename(&report.output).read_only(true).create_if_missing(false);
let restored = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
    .connect_with(options).await.unwrap();
let actual = nimble_core::db::export::export_portable(&restored).await.unwrap();
assert_eq!(expected.data, actual.data);
assert_eq!(expected.format, actual.format);
let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todoist_outbox")
    .fetch_one(&restored).await.unwrap();
assert_eq!(count, 0);
restored.close().await;
```

- [ ] **3. Run** `cargo test -p nimble-core --test backup_recovery`; expect missing recovery APIs.
- [ ] **4. Implement snapshot recovery.** Reject unsafe destination before copying; preserve source, stage copy mode 0600, validate, compare tables and canonical exports, then atomically publish directory. No migration for snapshot route. Reject destination races instead of overwriting.
- [ ] **5. Implement JSON recovery.** Strictly parse format/schema and exact rows/keys/types before publication. Create fresh schema, start a transaction, enable deferred foreign keys for the transaction, clear seeded user defaults in dependency-safe order, insert only policy-whitelisted columns using bound values, verify foreign keys, commit, rebuild vault FTS from active indexed notes, and verify canonical re-export. Use raw SQL only in this isolated importer; no CRUD observers/outboxes. Preserve explicit IDs including integer PKs; SQLite sequence state follows inserts. Reject unknown/missing fields, invalid types, duplicate PKs, broken required references and incompatible versions. Do not repair inputs silently.
- [ ] **6. Add CLI example** with exactly two forms; argument parser rejects extras and missing values:

```text
cargo run -p nimble-core --example backup_recovery -- snapshot --source <generation-directory> --dest <new-directory>
cargo run -p nimble-core --example backup_recovery -- export --source <export-directory> --dest <new-directory>
```

Print only result path and verification outcome. Core utility has no network client initialization. Add test coverage for both parser forms, existing destination, corrupt manifest/export, simulated publication failure, symlink destination and production-path rejection. Use only test scratch roots in executable examples/runbook drills.
- [ ] **7. Write the recovery runbook** describing local vs portable contents, no vault-attachment protection, how to select a historical Git export in a separate temporary checkout, both commands, and preservation of live DB/WAL/SHM before any future activation. Explicitly leave live activation/reconciliation outside this utility.
- [ ] **8. Run** `cargo test -p nimble-core --test backup_recovery`; commit `feat(backup): verify isolated snapshot and archive recovery`.

## Task 4: Prune only redundant, backed-up local sync history

**Files:** Modify `nimble-core/src/db/sync.rs`; add focused tests in its existing test module. No schema change.

**Interface produced:**

```rust
pub async fn prune_backed_up_log(
    pool: &sqlx::SqlitePool,
    generation: &crate::db::backup::VerifiedGeneration,
    now: chrono::DateTime<chrono::Utc>,
) -> crate::Result<u64>;
```

Caller holds the backup guard. Open the verified snapshot read-only, collect its exact log IDs, and restrict deletion to those IDs; don't prune post-snapshot arrivals even when their timestamps are old. Recheck checksum/identity if the generation was loaded from disk, not freshly produced.

- [ ] **1. Write failing regression tests** with an old acknowledged UPDATE, a newer UPDATE, an unsynced row, a NULL-synced row, a deleted entity's newest tombstone, equal-max timestamps, an invalid timestamp, and an old row inserted AFTER snapshot. Assert only redundant acknowledged backed-up history is deleted.
- [ ] **2. Run** `cargo test -p nimble-core prune_backed_up_log`; expect missing API.
- [ ] **3. Implement** candidate timestamp parsing in Rust (RFC3339 or the exact legacy UTC formats already emitted by sync); retain any unparseable value. Begin an immediate write transaction before candidate selection to serialize against appending writers. Use SQL's existing text timestamp ordering for the newer-row predicate, not normalized ordering:

```sql
DELETE FROM sync_log
WHERE id = ? AND synced = 1
  AND EXISTS (
    SELECT 1 FROM sync_log AS newer
    WHERE newer.table_name = sync_log.table_name
      AND newer.row_id = sync_log.row_id
      AND newer.timestamp > sync_log.timestamp
  )
```

Bind only snapshot-member IDs whose live timestamp passed the 30-day age check inside the transaction. Keep all maximum-timestamp ties. Commit once; rollback on any error. No remote operation and no domain-row deletion.
- [ ] **4. Test actual LWW protection after pruning.** Extract only the existing newer-entry SQL into a small private helper used by `pull` and the test if necessary; preserve behavior and error handling. An older incoming UPDATE still finds a newer entry for both a live task and a deleted task. Verify latest history is retained so seed-existing-data does not mistake it for never-synced state.
- [ ] **5. Run** focused tests, then `cargo test -p nimble-core` to cover existing sync behavior. Review this diff independently before committing `feat(backup): prune acknowledged redundant local sync history`. If the protection test fails, leave pruning unconnected and the task incomplete; do not substitute age-only deletion.

## Task 5: Private Git publisher and durable stage state

**Files:** Create `apps/desktop/src-tauri/src/{backup_git,backup_state}.rs`; register modules in `lib.rs` without starting any worker. Tests live in these modules and use a disposable bare Git remote and fake `gh` executable. No real account access in tests.

**Interfaces produced:**

```rust
// backup_state.rs (serde Serialize/Deserialize)
pub struct RemoteConfig { pub owner_repo: String, pub repository_id: String, pub root: std::path::PathBuf }
pub struct BackupState {
    pub last_local_success_at: Option<String>, pub last_local_slot: Option<String>,
    pub generation_id: Option<String>, pub export_commit: Option<String>,
    pub pushed_commit: Option<String>, pub last_push_at: Option<String>,
    pub next_publish_attempt_at: Option<String>, pub publish_failures: u32,
    pub pending_generation_id: Option<String>, pub cleanup_generation_id: Option<String>,
    pub remote: Option<RemoteConfig>, pub stage_error: Option<StageError>,
}
pub struct StageError { pub stage: String, pub code: String, pub at: String }
pub fn load_state(app_data: &std::path::Path) -> nimble_core::Result<BackupState>;
pub fn save_state(app_data: &std::path::Path, state: &BackupState) -> nimble_core::Result<()>;
// backup_git.rs
pub struct PublishResult { pub commit: String, pub acknowledged_at: String }
pub async fn configure_remote(owner_repo: &str, root: &std::path::Path)
    -> nimble_core::Result<RemoteConfig>;
pub async fn publish(remote: &RemoteConfig, generation: &nimble_core::db::backup::VerifiedGeneration)
    -> nimble_core::Result<PublishResult>;
```

State is under `<app_data>/backup-state.json`, mode 0600, atomic sibling-temp rename and parent flush; never in SQLite or Git. Persist status codes, not raw command stderr. Missing state returns defaults; corrupt state returns an actionable error and blocks cleanup until reconciled against verified generations. In-flight status is in memory; crash does not leave a permanent “running” flag.

- [ ] **1. Write tests** for atomic state publication and pending-commit retry against a local bare repository, and for private/public/unknown-repository identity responses using a fake `gh`. Exercise the process runner with temp scripts, not shell command interpolation. Fixtures must not bypass privacy checks in the production codepath.
- [ ] **2. Run** `cargo test -p app backup_git` and `cargo test -p app backup_state`; expect unimplemented symbols/test failure.
- [ ] **3. Implement bounded command execution.** Use `tokio::process::Command` with individual args, `kill_on_drop(true)`, closed stdin, captured bounded output, and a 60-second timeout; set `GIT_TERMINAL_PROMPT=0`. Classify errors without showing raw URLs/stderr. Auth stays in existing credential helpers/gh configuration. Do not write tokens, set global Git config, or run a shell.

```rust
let mut command = tokio::process::Command::new("gh");
command.args(["repo", "view", owner_repo, "--json", "id,visibility,nameWithOwner"])
    .stdin(std::process::Stdio::null()).kill_on_drop(true);
let output = tokio::time::timeout(std::time::Duration::from_secs(60), command.output())
    .await.map_err(|_| nimble_core::Error::Other("remote_check_timeout".into()))??;
// Parse structured JSON only after success; require visibility == "PRIVATE".
// Check id against configured repository_id on EVERY publication attempt.
```

- [ ] **4. Implement configure/adopt.** Accept only a conservative `OWNER/REPO` character pattern, verify privacy first, clone into a unique staging sibling if the fixed root does not exist, then publish the directory atomically. If root exists, require an owned/expected repository with only `export/data.json` and `export/format.json` tracked, exact expected fetch/push remote, no extra remotes, and clean staged/unstaged/untracked state. Empty matching repos are allowed. Require `main` or an unborn `main`; refuse other existing branches. Reject credential-bearing URLs, multiple push URLs, and Git URL rewrites that change the effective destination. Nonmatching/dirty roots are refused without mutation. Record repository ID only after checks. Reconfiguration to a different repo is refused; no automatic migration.
- [ ] **5. Implement publish as an idempotent stage machine.** Reverify root identity and remote privacy; reject unexpected files or dirty state. Copy generation export into repo with atomic file writes; `git add -- export/data.json export/format.json`; commit only when staged diff exists. Use an explicit `HEAD:refs/heads/main` push and verify the acknowledged remote ref equals the intended commit. No force, reset, pull/rebase, or broad staging. Divergence surfaces an error. An already-local, unpushed commit is retried even if this generation is unchanged.
- [ ] **6. Handle crash-owned dirtiness without adopting user changes.** Before replacing files, persist expected prior HEAD plus target export hashes in an owner-only journal outside Git. On restart, resume ONLY when current HEAD/index/worktree exactly match recorded pre/post states and contain no other changes. Otherwise refuse. Clear journal after commit state is durable. Disable repository hooks for managed commands using an app-owned empty hooks directory; never execute unexpected repo hooks during backup.
- [ ] **7. Add tests** for unchanged export/no empty commit, offline push/retry, non-fast-forward rejection, timeout, missing tools, public remote, changed repository ID, unexpected push URL, dirty/unrelated repo, wrong branch, interrupted staging, unrelated changes after crash, and sentinel credentials absent from every committed tree. Confirm no process arguments contain credentials.
- [ ] **8. Run** Task 5 tests; commit `feat(backup): publish portable exports to a verified private remote`.

## Task 6: Schedule local jobs, resume publication, expose native commands

**Files:** Create `apps/desktop/src-tauri/src/backup_runner.rs`, `commands/backup.rs`; modify `lib.rs`, `commands/mod.rs`. Keep scheduling policy and state transitions pure/testable inside runner; use injected time and narrow function inputs instead of a generalized job framework.

**Interfaces produced:**

```rust
// backup_runner.rs
pub enum BackupMode { Disabled, Enabled }
pub struct BackupRuntime {
    paths: nimble_core::db::backup::BackupPaths,
    mode: BackupMode,
    job: tokio::sync::Mutex<()>,
    running: std::sync::atomic::AtomicBool,
}
pub fn due_slot(now: chrono::DateTime<chrono::FixedOffset>, last: Option<chrono::NaiveDate>)
    -> Option<chrono::NaiveDate>;
pub async fn run_if_due(app: &tauri::AppHandle) -> nimble_core::Result<()>;
pub async fn run_now(app: &tauri::AppHandle) -> nimble_core::Result<BackupStatus>;
pub async fn read_status(app: &tauri::AppHandle) -> nimble_core::Result<BackupStatus>;
// commands/backup.rs — return Result<_, String>, sanitize errors at boundary
// backup_get_status, backup_run_now, backup_verify_latest,
// backup_open_folder, backup_configure_remote(owner_repo: String)
```

`BackupStatus` is defined in Task 7's shared contract below; add its matching Rust serde type here. `backup_verify_latest` returns `{ verified: bool }` and uses Task 3 in an app-owned temporary recovery directory, then removes only that directory. `backup_open_folder` runs `/usr/bin/open` with the resolved fixed backup directory; accepts no caller-supplied path. `backup_configure_remote` serializes with the job guard, invokes Task 5 with `~/Nimble-backups/`, persists config, and returns status. None of these commands initiates a live restore.

- [ ] **1. Write schedule tests** with no previous backup, before/after 02:00, same-date repeats, a week-long absence, manual backup satisfying today's slot, clock rollback, timezone change, and spring-forward/fall-back instants. Add `chrono-tz` to desktop dev-dependencies only if using named-zone conversion for the latter.

```rust
#[test]
fn missing_history_is_due_immediately_but_success_is_once_per_day() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-09-21T00:30:00-07:00").unwrap();
    assert_eq!(due_slot(now, None), Some(now.date_naive()));
    assert_eq!(due_slot(now, Some(now.date_naive())), None);
}
#[test]
fn missed_yesterday_runs_before_todays_two_am_slot() {
    let now = chrono::DateTime::parse_from_rfc3339("2026-09-21T01:00:00-07:00").unwrap();
    let last = chrono::NaiveDate::from_ymd_opt(2026, 9, 19).unwrap();
    assert_eq!(due_slot(now, Some(last)), chrono::NaiveDate::from_ymd_opt(2026, 9, 20));
}
```

- [ ] **2. Run** `cargo test -p app backup_runner`; expect missing functions.
- [ ] **3. Implement orchestration:** mode check -> acquire in-process + OS job locks -> reload/reconcile state -> due local generation -> persist local stage -> optional Git stage -> conditional cleanup -> persist status. Keep old successful timestamps on failures. Snapshot failure retries no more than every 15 minutes; publication delays are 15/30/60/120/240 minutes capped at 240. Persist deadlines before yielding. A new daily snapshot may supersede a queued export, but never lose already-committed unpushed history. Publish the latest generation and retain previous successful snapshots until cleanup is eligible.
- [ ] **4. Connect retention and pruning** only after eligible stage success. Track `cleanup_generation_id` separately so cleanup failure can be retried without creating a new snapshot. `prune_backed_up_log` only sees that generation's IDs. Never clean up after snapshot/export failure, configured upload failure, invalid state, or loss of lock.
- [ ] **5. Wire startup safely.** Store resolved production/demo paths in `BackupRuntime` after the existing pool setup. Demo mode disables all backup commands/scheduling. In debug builds default scheduling OFF; enable only with an explicit test-mode flag and a separate synthetic app-data root. Release builds schedule after migrations on an immediate tick, then every 300 seconds with delayed missed ticks. Existing sync/vault workers are not modified. Do not hold database write transactions while running Git.
- [ ] **6. Query status honestly.** Count Turso `synced=0` rows and Todoist `pending/sending` and `failed` operations separately with fallible queries; map failures to nullable counts. Do not reuse the current helper that defaults SQL errors to zero. Return sanitized stage errors plus persisted stage successes and configured-state indicator.
- [ ] **7. Add runner failure tests:** offline publication leaves one local success, repeated 5-minute ticks create no new snapshot, lock contention returns busy, quit/restart resumes pending push, successful upload with subsequent state-write failure reconciles safely, corrupted state blocks cleanup, demo/debug-disabled makes zero filesystem/API calls. Inject operations so tests make no Tauri app/network calls.
- [ ] **8. Run** Task 6 and preceding Rust tests; commit `feat(backup): schedule and expose staged backup jobs`.

## Task 7: Desktop Settings and provider contract

**Files:** Modify `packages/types/src/{index,data-provider}.ts`, `apps/desktop/src/services/{tauri,tauri-provider,turso-provider}.ts`, `apps/desktop/src/components/pages/SettingsPage.tsx`, `tools/mock-tauri.js`; create `apps/desktop/src/components/settings/BackupSection.tsx`.

**Exact shared contract:**

```typescript
export interface BackupStatus {
  running: boolean
  disabled_reason: string | null
  last_local_success_at: string | null
  last_push_at: string | null
  export_commit: string | null
  backup_directory: string
  retained_count: number | null
  remote_configured: boolean
  remote_name: string | null
  turso_pending: number | null
  todoist_pending: number | null
  todoist_failed: number | null
  error: { stage: string; code: string; at: string } | null
}
export interface BackupCapability {
  supported: boolean
  status(): Promise<BackupStatus>
  runNow(): Promise<BackupStatus>
  verifyLatest(): Promise<{ verified: boolean }>
  openFolder(): Promise<void>
  configureRemote(ownerRepo: string): Promise<BackupStatus>
}
// Add required `backup: BackupCapability` to DataProvider.
```

- [ ] **1. Add types and run** `npm run build --workspace @nimble/desktop`; expect missing `backup` properties on both providers.
- [ ] **2. Add wrappers** with exact command names and camel-case argument mapping; TauriProvider delegates directly. TursoProvider uses `supported: false` and rejected promises for method calls, preserving existing asynchronous rejection style. Do not change dormant mobile interfaces.

```typescript
export const backupGetStatus = () => invoke<BackupStatus>('backup_get_status')
export const backupRunNow = () => invoke<BackupStatus>('backup_run_now')
export const backupVerifyLatest = () => invoke<{ verified: boolean }>('backup_verify_latest')
export const backupOpenFolder = () => invoke<void>('backup_open_folder')
export const backupConfigureRemote = (ownerRepo: string) =>
  invoke<BackupStatus>('backup_configure_remote', { ownerRepo })
```

- [ ] **3. Build a separate BackupSection** using existing Button/Input/typography/skeleton components. Check capability before mounting the data-fetching child; poll status every 15 seconds only while mounted, cancel stale results, and clean up timer. Disable actions while running. Show “Unavailable” for null counts. Render local and offsite timestamps independently. Keep stage errors visible until resolved; do not swallow rejection or show per-success notifications.

```tsx
export function BackupSection() {
  const dp = useDataProvider()
  return dp.backup.supported ? <DesktopBackupSection /> : null
}
// DesktopBackupSection owns hooks and invokes only dp.backup methods.
// The page imports this section beside SyncSection, with no Tauri import.
```

- [ ] **4. Add setup affordance** when no remote is configured: a single `OWNER/REPO` input and “Connect private repository” action; explain that local backups work independently. When configured, show its name read-only. Do not provide repository creation, destructive reset, or public fallback. Disabled demo/debug mode explains why actions are unavailable.
- [ ] **5. Extend mock-tauri fixtures** for empty, working, local-only, fully uploaded, pending upload, error and unavailable-count states. Browser smoke checks cover labels and button calls; no new frontend test framework. Confirm web Settings renders no BackupSection and makes no backup method calls.
- [ ] **6. Run** desktop build, web build, and targeted ESLint over edited TS/TSX files. A bare `tsc --noEmit` is not valid verification here. Commit `feat(settings): show local and offsite backup status`.

## Task 8: End-to-end recovery drill and handoff

**Files:** Finish `docs/backup-recovery.md`; update `CLAUDE.md` narrowly with actual backup commands/limitations and `NEXT.md`. Do not rewrite unrelated historical guidance.

- [ ] **1. Run all required checks once on the integrated tree:**

```bash
cargo test --workspace
npm run build --workspace @nimble/desktop
npm run build:web --workspace @nimble/desktop
```

- [ ] **2. Perform the synthetic end-to-end drill.** Create a file-backed fixture, run local generation, publish through a disposable local bare Git remote in the test harness, retrieve its committed export into a different temporary directory, restore snapshot and JSON independently, and compare exports. Delete or corrupt only a disposable source copy to prove recovery does not depend on it. Record counts/hashes and pass/fail, not content. Verify no production path/API client was opened.
- [ ] **3. Native smoke-check in the isolated test app-data mode.** Confirm status, Back up now, Open backup folder, Verify latest backup, busy/error rendering, and command permissions. Confirm demo mode can't touch production backup roots. Browser mocks cannot satisfy this step. Check live application logs for permission errors without dumping user data.
- [ ] **4. Prepare private-remote activation separately.** Implementation can finish without a chosen repo, but offsite activation stays explicitly open. Resolve an existing private repository with Marco during setup, validate its visibility/ID and intended contents, then enable real-data upload only within the authorized setup action. Never use production uploads as test fixtures. Do not mark offsite protection complete until a real push is acknowledged.
- [ ] **5. Review the combined diff** with particular attention to credential exclusions, path containment, stage crash recovery and LWW pruning. Update NEXT.md with actual checks performed, any blocked checks, deferred conflict journal and live-reconnection procedure. Commit documentation with `docs(backup): document verified recovery and activation`.

## Acceptance coverage

| Spec requirement | Evidence owner |
| --- | --- |
| Full typed user data, explicit exclusions and drift guard | Task 1 schema/serialization tests |
| Consistent verified snapshot, atomic publication and retention | Task 2 file-backed/failure tests |
| Snapshot and private-archive recovery | Task 3 tests + Task 8 Git-to-restore drill |
| Pruning preserves LWW and tombstones | Task 4 actual protection regression |
| Private-only Git, no broad staging, retry/timeout/crash semantics | Task 5 fake-gh and bare-remote tests |
| Catch-up/DST, independent local/upload success, demo isolation | Task 6 schedule and orchestration tests |
| Truthful desktop-only controls and no zero-on-error counts | Task 7 browser states + Task 8 native smoke |
| Required builds/tests; no production mutation during development | Task 8 recorded results |

## Appendix A: v19 table/column inventory for the explicit policy

This inventory was derived from migration SQL in an in-memory database, not from Marco's live database. PK is `id` except `settings.key`, `daily_state.date`, `integration_sync_state.provider`, `schema_version.version`, and `task_labels.(task_id,label_id)`. Include all listed columns of included tables except `remote_updated_at` and `synced_snapshot` on projects/tasks. Exact included/excluded table classification comes from the approved spec.

```text
action_log: id,action_type,target_id,payload,synced,created_at
activity_log: id,action_type,target_id,metadata,created_at
calendar_events: id,summary,description,location,start_time,end_time,all_day,meeting_url,fetched_at,date,feed_label,feed_color
calendar_feeds: id,label,url,color,enabled,created_at
capture_routes: id,prefix,target_type,doc_id,label,color,icon,position,created_at
captures: id,content,source,converted_to_task_id,created_at,routed_to,context
daily_state: date,energy_level,top_priorities,first_opened_at,last_saved_at,focus_task_id,focus_started_at,focus_paused_at
doc_folders: id,name,position,created_at
doc_notes: id,doc_id,content,position,created_at
documents: id,title,content,folder_id,position,created_at,updated_at
goals: id,name,description,status,life_area_id,start_date,target_date,color,position,created_at,updated_at
habit_logs: id,habit_id,date,intensity,created_at
habits: id,name,category,icon,color,active,position,created_at
integration_sync_state: provider,sync_token,last_sync_at,last_full_sync_at,last_error,enabled
labels: id,name,color,position,created_at
life_areas: id,name,color,icon,position,created_at
local_tasks: id,parent_id,content,description,project_id,priority,due_date,completed,completed_at,position,created_at,updated_at,status,linked_doc_id,external_id,external_source,remote_updated_at,synced_snapshot,due_time,duration_minutes,recurrence_rule,section_id
milestones: id,goal_id,name,target_date,completed,completed_at,position,created_at
progress_snapshots: id,energy_level,tasks_completed,tasks_open,tasks_deferred,priorities,notes,created_at
projects: id,name,color,position,created_at,goal_id,milestone_id,external_id,external_source,remote_updated_at,synced_snapshot,parent_id
schema_version: version,description,applied_at
sections: id,project_id,name,position,external_id,external_source,created_at
settings: key,value,updated_at
sync_log: id,table_name,row_id,operation,changed_columns,snapshot,device_id,timestamp,synced
task_labels: task_id,label_id,created_at
todoist_outbox: id,local_id,object_type,op,payload_json,command_uuid,temp_id,status,error,created_at,updated_at
todoist_tasks: id,content,description,project_id,project_name,priority,due_date,due_is_recurring,is_completed,todoist_url,fetched_at
vault_links: id,from_note_id,to_path,link_type,created_at
vault_notes: id,path,title,content,frontmatter_json,mtime,size,hash,updated_at,deleted_at
vault_tags: id,note_id,tag,created_at
```

**Completion boundary for this planning task:** spec approved; implementation plan written and reviewed for coverage. No application code changed, no tests claimed to pass, and no remote configured. Execution starts with Task 1 after Marco chooses to proceed.
