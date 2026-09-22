# C3 Agent Access Implementation Plan

Execution status (2026-09-21): C2/C3 implementation is merged and installed. This approved plan is retained as an implementation checklist, not the current open-loops list; unchecked original steps do not by themselves mean work is unimplemented. See [NEXT.md](../../../NEXT.md) and [verification](../../c2-c3-verification.md) for completed evidence and remaining acceptance. Mac banner and Google connection/first sync passed; phone/two-way acceptance and assistant routing/web propagation remain open. The installed OAuth repair is still on its local unmerged branch.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give local assistants a dependable `dt` command that manages Nimble data, preserves existing synchronization, and refreshes the running desktop app immediately.

**Architecture:** A small Rust workspace binary calls existing `nimble-core` CRUD against the desktop database. A private local socket carries invalidations and a small allowlist of app-owned backup/sync operations; it is not a second task-write API. Workflow adapters are drafted inside this repository and activated separately after verification.

**Tech Stack:** Rust 1.90+, Tokio, sqlx SQLite, serde/serde_json, clap derive, Tauri 2 events, existing React data providers.

**Spec:** `docs/todoist-replacement-decisions.md`, particularly D2, D8, D12 and C3; coordination and ownership in `docs/superpowers/plans/2026-09-21-c2-c3-coordination.md` take precedence over this companion's file assignments.

**Status:** Draft pending Marco's approval. This document is a plan, not authorization to mutate live tasks, install a new app, edit external skills, or perform live integration writes.

## Global Constraints

- All task/project writes use `nimble-core::db::tasks` / `projects` CRUD; other domains use their core CRUD. No SQL mutations in the CLI or socket handler.
- `--json` works at every command level, including errors and argument validation. No credentials or raw integration configuration in output.
- Keep Todoist operational throughout the trial. No automatic dual writing or fallback following an uncertain write.
- `apps/mobile` remains dormant. FTS task search belongs to C4; reserve `dt task search` but do not ship a misleading title-only substitute.
- No saved filter language, remote server, daemon, autonomous workflow runner, or Focus Queue implementation.
- Development and tests use synthetic temporary profiles. Never point test helpers at the production database, vault, Google account, Turso account, or backup repository.
- Root owns schema v20, shared task/label types, core exports, workspace membership, app startup, backup compatibility and final integration. C3 owns files identified below and requests shared edits through root.

## Verified starting point and implications

`nimble-core` is a library only; the workspace currently contains core and desktop. Task inputs already expose labels, sections, recurrence, due time, duration and parent IDs. Task/project CRUD feeds sync and the Todoist observer. These observers are not a transactional guarantee: some sync logging errors are warnings. Do not claim that a successful local mutation proves remote delivery.

`emitTasksChanged()` is an in-window JS event plus a debounced Todoist push. App.tsx listens to `todoist-sync-applied` and `remote-sync-applied`, but projects and several label/section consumers do not subscribe to that bus. Captures have a separate Tauri event. C3 must refresh these actual consumers, not merely emit a task event.

The desktop selects `nimble.db` under its Tauri app-data path and can select `demo.db`. Its initializer runs migrations. The CLI must not copy the legacy database, silently create an empty database, choose demo data, or run migrations. A missing or incompatible database is an actionable error.

Backup scheduling, status, Git publication and recovery verification are currently tied to desktop `AppHandle`; calling raw snapshot helpers from `dt backup now` would bypass that state machine. Use the app's existing backup operations through the socket. App-closed task access remains supported; app-closed backup execution returns `app_required`.

## Integration contract requested from root

1. Export `db::migrations::current_schema_version() -> i64`. C3 compares the database's actual maximum schema version with the compiled value before opening for writes. Reject both older and newer versions with `schema_mismatch`; instruct the user to update/open Nimble. Do not auto-migrate.
2. Root adds `tools/dt` workspace member and exposes `nimble_core::agent_protocol`. C3 writes the new protocol module. Schema v20 supplies reminder input/output fields; C3 adds their CLI flags after those fields land without owning migrations.
3. Root registers `agent_server::start(app: &tauri::AppHandle, profile: AgentProfile) -> Result<AgentServerGuard, String>` after the pool and BackupRuntime exist. `AgentProfile { database: PathBuf, socket: PathBuf, test_mode: bool }` is defined in `agent_protocol`; the guard owns listener/task shutdown and only removes its own socket. Root passes the same resolved profile to reminders and the socket.
4. Socket request JSON is versioned and newline-framed: `{"version":1,"request_id":"UUID","profile_id":"BLAKE3_CANONICAL_DB_PATH","operation":{"kind":"invalidate","domains":["tasks"],"ids":["UUID"]}}`. Enum variants are `invalidate`, `backup_status`, `backup_now`, `backup_verify`, `sync_status`, `sync_now`. No executable text, SQL, credentials, filesystem paths, or arbitrary Tauri commands.
5. The server calls existing backup and serialized sync runners; it does not launch a competing push/pull. `invalidate` emits `nimble-data-changed` to all desktop windows with `{version:1, domains, ids}`. The acknowledgement means the event was emitted, not that all windows painted or the network synchronized.
6. Proposed refinement of D12's literal `$TMPDIR/nimble.sock`: use `$TMPDIR/nimble-<uid>-<profile-hash>/agent.sock`, parent mode 0700 and socket 0600, verify owner and reject symlink components. Canonical per-user temp resolution must agree between Finder-launched app and shell; use the macOS user-temp directory rather than trusting an arbitrary shell TMPDIR override. Keep path length within macOS Unix socket limits. This preserves local-socket architecture while separating real/test profiles and avoiding collisions.
7. Schema and socket protocol checks are independent. A socket peer must match profile identity/version before any operation. If the app migrates between CLI validation and mutation, reject incompatibility rather than assuming the preflight remains valid; root supplies a shared schema-access lock held by app migration and each CLI operation.

## Command and output contract

All commands accept global `--json`; test harnesses also accept explicit `--profile <directory>` whose marker and canonical temporary path must validate. Production default is the existing Tauri app-data directory. No production `init`, `migrate`, credential-setting or integration-reconnection commands.

| Domain | Commands and mapping |
|---|---|
| task | `list [--project ID] [--due YYYY-MM-DD] [--include-completed]`, `get ID`, `create CONTENT`, `update ID`, `complete ID`, `reopen ID`, `status ID STATUS [--reason TEXT]`, `delete ID`, `labels ID --ids ID,ID`; core tasks and labels CRUD. `get` may filter `get_local_tasks(..., true)` initially; no duplicate read SQL. |
| task fields | Create: `--project`, `--parent`, `--description`, `--priority`, `--due`, `--time`, `--duration`, `--recurrence`, `--section`, `--labels`. Update supports existing UpdateTaskInput fields and explicit clear flags, plus linked document. Parent moves are unsupported because core UpdateTaskInput has no parent field. C2 adds `--reminder-offset` and its clear flag when shared inputs exist. |
| project | `list`, `create NAME [--color COLOR] [--parent ID]`, `update ID [--name NAME] [--color COLOR] [--parent ID|--clear-parent]`, `delete ID`; projects CRUD. |
| section | `list --project ID`, `create NAME --project ID`, `rename ID NAME`, `delete ID`, `reorder --ids ID,ID`; sections CRUD. |
| label | `list`, `create NAME --color COLOR`, `update ID [--name NAME] [--color COLOR]`, `delete ID`; labels CRUD. Group editing follows the shared C2 contract; taxonomy backfill/filtering belongs to C4. |
| capture | `list [--limit N] [--include-converted]`, `create CONTENT [--context TEXT]`, `delete ID`; source is `dt`. Conversion is excluded until core provides an atomic capture-to-task API; never synthesize two writes that can half-complete. |
| activity | `list --from DATE --to DATE [--action TYPE] [--target ID] [--limit N]`, `summary --date DATE`; existing read APIs. |
| backup | `status`, `now`, `verify`; request existing desktop operations. No restore activation, raw credential-rich snapshot printing or remote setup. |
| sync | `status`, `now`; status may read local core status with app closed; now requires running app and its serialized runner. Return pending counts and sanitized errors, never saved tokens. |
| gap | `dt gap "reason"` writes a durable `nimble_gap` activity; `dt gap list --from DATE --to DATE` reads those entries. No new table. |

Success JSON: `{"version":1,"ok":true,"data":...,"refresh":"acknowledged|app_not_running|unavailable|not_required","warnings":[]}`. Errors: `{"version":1,"ok":false,"error":{"code":"validation|not_found|schema_mismatch|busy|app_required|unavailable|internal","message":"sanitized explanation"}}`. Stdout contains one JSON document; diagnostics go to stderr without task content or credentials. Exit 0 means the requested operation committed/succeeded, 2 means invalid input, 1 means operational failure. An invalidation timeout after commit is success with warning, never a write failure. Interrupted/uncertain writes require inspection before retry or Todoist fallback.

## Task 1: CLI, profile guard and deterministic output

**Files:** Create `tools/dt/Cargo.toml`, `tools/dt/src/{main,lib,args,output,profile}.rs`, `tools/dt/tests/profile_contract.rs`; root modifies `Cargo.toml`, `Cargo.lock`, core migration export and shared schema lock.

**Interfaces:** `run(args: impl IntoIterator<Item=OsString>) -> i32`; `open_profile(path: &Path) -> Result<SqlitePool, CliError>`; `CliError { code: &'static str, message: String }`; serde output envelope specified above. Package `nimble-cli`, binary `dt`.

- [ ] Add failing executable tests for `dt --json --bad-flag`, JSON help, absent DB, demo marker, unmarked test profile, schema newer/older, foreign-key enforcement and SQLite busy timeout. Assert an absent database remains absent.
- [ ] Run `cargo test -p nimble-cli --test profile_contract --offline`; expect missing binary/module failure initially.
- [ ] Add clap derive with global JSON/profile flags. Intercept clap errors/help and format them through the envelope. Open existing DB only with SQLite connect options, foreign keys true, bounded busy timeout, and no create-if-missing. Acquire root's schema-access lock before checking version and hold through the operation.

```rust
let options = sqlx::sqlite::SqliteConnectOptions::new()
    .filename(database)
    .create_if_missing(false)
    .foreign_keys(true)
    .busy_timeout(std::time::Duration::from_secs(5));
let pool = sqlx::sqlite::SqlitePoolOptions::new()
    .max_connections(1).connect_with(options).await?;
```

- [ ] Rerun tests, verify JSON is parseable for every exit path, commit `feat: add guarded dt command foundation`. Resolve/download clap once during implementation if not cached; current lockfile has no clap entry, so initial dependency resolution cannot assume offline availability.

## Task 2: Task commands preserving existing semantics

**Files:** Create `tools/dt/src/commands/{mod,tasks}.rs`, `tools/dt/tests/task_commands.rs`; root applies any shared input-field additions.

**Interfaces:** `tasks::execute(pool: &SqlitePool, command: TaskCommand) -> Result<CommandResult, CliError>`. Define `CommandResult { data: serde_json::Value, changed_domains: Vec<Domain>, changed_ids: Vec<String> }` in commands/mod.rs; `Domain` comes from agent_protocol and serializes snake_case. Reads return empty changes.

- [ ] Add failing tests using `nimble_core::test_util::file_pool()` and a synthetic marker. Create parent plus three subtasks, assign existing labels, due date/time/duration/recurrence/section; inspect rows, sync entries and Todoist outbox fixtures, not merely CLI text. Test completion recurrence, reopening, clear flags, duplicate label IDs, nonexistent IDs and wrong-project sections.
- [ ] Run `cargo test -p nimble-cli --test task_commands --offline` and confirm the first missing task command fails.
- [ ] Map typed arguments directly to core inputs; never reconstruct status or recurrence logic in CLI. Reject simultaneous set/clear flags before calling CRUD. Use stable IDs, not ambiguous name matching. Blank content, malformed dates/time and invalid priority must fail before mutation.

```rust
let task = nimble_core::db::tasks::create_local_task(pool,
    nimble_core::types::CreateTaskInput {
        content, project_id, parent_id, description, priority, due_date,
        due_time, duration_minutes, recurrence_rule, section_id, label_ids,
        ..Default::default()
    }).await?;
```

- [ ] Add C2 offset flags only after the shared fields land; round-trip the offset and clearing in tests. Preserve all unspecified fields on update.
- [ ] Rerun and commit `feat: expose native task operations through dt`.

## Task 3: Supporting domains and reliable gap recording

**Files:** Create `tools/dt/src/commands/{projects,sections,labels,captures,activity,gap}.rs`, `tools/dt/tests/domain_commands.rs`; modify `nimble-core/src/db/activity.rs` only after ownership approval from root.

**Interfaces:** Each module exports `execute(pool: &SqlitePool, command: <Domain>Command) -> Result<CommandResult, CliError>`. Core adds `record_activity(pool, action_type, target_id, metadata) -> crate::Result<ActivityEntry>`; existing `log_activity` remains its warning-only wrapper. `gap` calls the fallible function so an unwritten gap is never reported as recorded.

- [ ] Add failing tests for project nesting/cycle rejection; sections/reorder; label replacement retaining the explicit full ID set; capture context; activity date filters; gap persistence/read-back and simulated write failure. Assert returned IDs and sync records as appropriate.
- [ ] Run `cargo test -p nimble-cli --test domain_commands --offline` and confirm missing commands fail.
- [ ] Implement the command matrix by delegating to existing APIs. Validate bounded positive limits and date ordering. Core gap creation uses action `nimble_gap` and metadata `{"reason":reason,"source":"dt"}`; it returns the inserted activity entry and preserves existing activity sync logging.

```rust
let entry = nimble_core::db::activity::record_activity(
    pool, "nimble_gap", None,
    Some(serde_json::json!({"reason": reason, "source": "dt"})),
).await?;
```

- [ ] Rerun CLI domain tests and existing core activity/sync tests; commit `feat: add dt supporting domains and gap log`.

## Task 4: Private profile socket and committed-write notifications

**Files:** Create `nimble-core/src/agent_protocol.rs`, `tools/dt/src/ipc.rs`, `apps/desktop/src-tauri/src/agent_server.rs`, `tools/dt/tests/ipc_contract.rs`; root owns core export and desktop startup changes.

**Interfaces:** Define `Domain { Tasks, Projects, Sections, Labels, Captures, Activity }`, `AgentProfile` as above, serializable `AgentRequest`, `AgentOperation`, `AgentResponse`; `ipc::request(profile: &AgentProfile, operation: AgentOperation) -> Result<AgentResponse, CliError>`. `AgentResponse` contains request ID, protocol version, `ok`, optional data and optional sanitized error. Invalidation has a 500ms budget; long app operations use a bounded 120s response timeout and report uncertain timeout without automatic repeat.

- [ ] Add failing socket tests for valid acknowledgements; wrong user/profile/version; malformed/oversize messages; stalled peers; server unavailable; stale socket; simultaneous startup; regular file/symlink occupying endpoint. Frame limit 64KiB, 2s inbound read deadline, bounded 8 concurrent handlers; reject excess rather than spawn unlimited tasks.
- [ ] Run `cargo test -p nimble-cli --test ipc_contract --offline` and desktop agent_server unit tests; expect missing protocol/server initially.
- [ ] Implement socket lifecycle, owner checks, exclusive startup lock and a version/profile handshake before dispatch. Only remove a stale same-owner socket after proving no live listener while holding the startup lock. Do not put task bodies in invalidation messages. Capture changed IDs from successful CRUD and notify exactly once.

```rust
let result = tasks::execute(&pool, command).await?;
// The database operation has already completed. Notification failure is advisory.
let refresh = notify_committed_change(&profile, &result).await;
print_success(result.data, refresh);
```

`notify_committed_change(profile: &AgentProfile, result: &CommandResult) -> RefreshOutcome` returns `not_required` for empty changes, otherwise translates socket outcomes into the success-envelope refresh value. `print_success(data: Value, refresh: RefreshOutcome)` is output.rs's formatter; neither retries the CRUD call.

- [ ] Verify invalidation never causes SQL changes; test a committed task plus unavailable socket remains exactly one task and exit0. Commit `feat: notify Nimble of external local changes`.

## Task 5: Refresh every affected desktop surface

**Files:** Create `apps/desktop/src/lib/dataChanges.ts`; modify `App.tsx`, `hooks/useLocalTasks.ts`, `components/pages/{TasksPage,InboxPage}.tsx`, `components/detail/{TaskDetailPage,CaptureDetailPage}.tsx`, `components/tasks/{ProjectDetailPage,TaskComposerCard,LocalTaskRow}.tsx`, `components/shared/CommandBar.tsx`. Root integrates App.tsx if C2 also changes it.

**Interfaces:** `dispatchDataChanges(domains: DataDomain[]): void`, `subscribeDataChanges(domain: DataDomain, callback: () => void): () => void`, where `DataDomain` matches Rust Domain. Keep existing task mutation bus working; do not remount the application or erase open drafts to refresh data.

- [ ] Add a focused event-bus test using the project's available JS test facilities; if adding a runner is necessary use Node's built-in test runner for the pure module rather than installing a frontend suite. Assert one invalidation reaches multiple subscribers and cleanup prevents later callbacks.
- [ ] Implement app-level Tauri listener with correct cleanup, forwarding tasks through `emitTasksChanged()` and other domains through dataChanges. Subscribe project hooks and the actual label/section/capture consumers listed above; invalidate LocalTaskRow's label cache. Project/section/label deletion also invalidates tasks.

```typescript
const unlisten = listen<{version: number; domains: DataDomain[]}>(
  'nimble-data-changed', ({ payload }) => {
    if (payload.version !== 1) return
    dispatchDataChanges(payload.domains)
  },
)
return () => { void unlisten.then(stop => stop()) }
```

- [ ] Build desktop/web with `npm run build --workspace @nimble/desktop` and `npm run build:web --workspace @nimble/desktop`. Perform native synthetic-profile QA: open task detail/project list/label picker/capture list, mutate each via CLI, verify correct updates without focus changes or draft loss; test two windows.
- [ ] Record visible refresh timing for parent and three subtasks: target ≤1s with app already open. Commit `feat: refresh desktop views after agent edits`.

## Task 6: App-owned backup and sync commands

**Files:** Create `tools/dt/src/commands/{backup,sync}.rs`, `tools/dt/tests/app_operations.rs`; extend `agent_server.rs`; root coordinates backup/sync runner call sites.

**Interfaces:** `backup::execute(profile: &AgentProfile, command: BackupCommand) -> Result<CommandResult, CliError>` and `sync::execute(pool: &SqlitePool, profile: &AgentProfile, command: SyncCommand) -> Result<CommandResult, CliError>`. Requests call `backup_runner::{read_status,run_now,verify_latest}` and the existing serialized sync runner, preserving its enabled/configuration checks.

- [ ] Add failing tests with a fake local socket service for no-app errors, timeout ambiguity, server sanitization, backup busy state, successful status/verification, and local sync status with app closed.
- [ ] Run `cargo test -p nimble-cli --test app_operations --offline`.
- [ ] Implement enum dispatch with direct typed runner calls. No generic invoke bridge. For `sync now`, report actual per-provider outcomes, not just that a rate-limited runner returned; root can provide a typed public result on the existing runner. Backup verify creates an isolated recovery copy using existing behavior and never activates it.

```rust
AgentOperation::BackupNow => {
    let status = crate::backup_runner::run_now(&app).await?;
    Ok(serde_json::to_value(status)?)
}
```

- [ ] Test actual native backup status/now/verify only in a marked synthetic profile, with remote publication disabled. Simulate sync outcomes locally; no live Todoist/Turso writes. Commit `feat: add dt backup and sync controls`.

## Task 7: Workflow proposals and release acceptance

**Files:** Create `docs/agent-access.md`, `docs/agent-workflows/{td,task-assist,brief,admin}.md`, `tools/dt/tests/agent_scenario.rs`; root updates `NEXT.md`, `CLAUDE.md`, verification record and approved release packaging.

- [ ] Add an executable synthetic fixture scenario: list existing labels/project, create parent, create three subtasks using returned parent ID, verify labels/due dates and all read-back fields. Each command consumes returned IDs, never guesses them; interrupted scenarios inspect state and do not restart the whole sequence automatically.
- [ ] Run `cargo test -p nimble-cli --test agent_scenario --offline`.
- [ ] Write repository-local workflow proposals: `/td` uses core create/update/read; `/task-assist` resolves the exact Nimble task before changing it; `/brief` performs read-only task/activity queries; `/admin` reads and drafts actions before its normal authorization boundary. All use `dt --json`, preserve complete label sets, and keep tool errors distinct from empty lists. Do not edit installed skills or Instinct instructions.
- [ ] Specify fallback: choose destination before the first write; a confirmed unavailable CLI with no mutation may route through the already-authorized Todoist workflow. After success, partial success or uncertain result, inspect/repair the Nimble record before any alternate destination. Never create a second task in Todoist simply because refresh or sync failed. Instinct retains ownership of live productivity writes until Marco explicitly changes that arrangement.
- [ ] Run full Rust workspace tests and desktop/web builds, then independent code/security review of database profile selection, socket ownership, output sanitization, field preservation and failure semantics. Record only synthetic IDs/counts in verification docs.
- [ ] Commit `docs: document dt workflows and verification`. Root installs the reviewed `dt` binary using a concrete approved release path and documents its shell PATH; no global install during planning or unit tests. Workflow activation and the ≤5-minute web propagation exit test remain explicit live acceptance gates requiring authorized synthetic remote fixtures/account, not arbitrary production task creation. C3 is not fully activated until those gates pass.

## Parallel staging and completion definition

Tasks 1–3 can develop alongside the pure C2 scheduler. Tasks 4 and6 depend on root's profile/startup and runner integration. Task5 owns distinct refresh UI concerns but must coordinate App.tsx and shared task detail with C2; root merges these changes. Task7 runs after integration. Schema20 must update C1 export/snapshot/recovery compatibility before either track reaches a live app.

C3 code-complete means every domain in the table works, tests pass, native synthetic refresh passes, and adapters exist as reviewed local proposals. C3 activated additionally means the installed binary is verified, Marco approves workflow routing changes, and the parent-plus-three-subtasks local/web exit test passes. Report those states separately. Neither code completion nor this plan changes Todoist cutover status.
