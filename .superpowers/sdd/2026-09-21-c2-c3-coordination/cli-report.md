# C3 CLI/backend implementation report

Implemented in the coordinated worktree; no production data or external workflow edits.

## Owned changes

- `tools/dt`: Rust `nimble-cli` package with `dt` binary, clap command grammar, JSON success/error/help, validated existing profile/schema guard, all approved task/project/section/label/capture/activity/backup/sync/gap commands. Native CRUD preserves sync/outbox and reminder fields; clear flags are explicit.
- `nimble-core/src/agent_protocol.rs`: shared profile identity, private per-user/profile socket resolution, same-owner filesystem validation, shared/exclusive schema locks, bounded framing and typed protocol.
- `db/activity.rs`: fallible `record_activity` for reliable local gap persistence; existing `log_activity` remains warning-only wrapper.
- `agent_server.rs`: bounded same-user Unix listener, profile/version validation, domain invalidation events, backup controls, sync controls, stale-socket lifecycle protection and owned guard cleanup.
- Additional ownership granted by root: `sync_runner.rs` and `commands/sync.rs`. All desktop Turso push/pull entrypoints now share serialization, returned outcomes distinguish partial failure, errors contain no credentials. Todoist retains its existing core lock.
- `docs/agent-access.md` and four local workflow proposals. No installed skills or Instinct routing modified.

## Root integration contract

Register core `agent_protocol`, desktop `agent_server`, workspace `tools/dt`. Before desktop migration acquire `SchemaLock::acquire(&database, true)` and hold through migration, then release. CLI holds shared guard through its command. After pool/BackupRuntime setup create `AgentProfile::from_database(&database, isolated_test)` and `agent_server::start(&app_handle, profile)`; keep the returned `AgentServerGuard` managed by app lifetime.

`nimble-data-changed` is app-wide, payload `{version:1,domains:[tasks/projects/sections/labels/captures/activity],ids:[...]}`. Root owns UI consumers and reminder/calendar wake behavior. Server already emits this event. CLI notification happens only after successful CRUD; failed/mismatched/missing acknowledgement leaves command successful and never repeats the write.

Synthetic CLI QA example (use the actual date/time selected for the fixture):

```sh
../nimble-c1/target/debug/dt --json --profile /private/tmp/SELECTED_TEST_ROOT task create "Synthetic CLI reminder" --due 2030-01-01 --time 09:00 --reminder-offset 2
```

The profile root must already contain `nimble.db` and marker `synthetic-profile` with exact contents `nimble-synthetic-only\n`; it must match the running test app profile. Create parent/children with returned IDs. Do not rerun creation after `refresh:unavailable`.

## Verification

- Initial executable CLI red run: five contract tests failed against stub, `/private/tmp/nimble-c3-red.log`.
- Nine executable CLI integration tests passed after implementation, `/private/tmp/nimble-c3-expanded.log`: missing/unsafe/schema-mismatch profiles, invalid JSON arguments, parent plus three children and fields/sync entries, supporting domain/status/delete commands, gap/capture persistence, failed gap insertion, unavailable app backup, real Unix socket acknowledgement/wrong acknowledgement with exactly one saved task per command.
- Three core protocol tests passed: framing limits, lock exclusion/symlink refusal, unknown operation rejection; `/private/tmp/nimble-c3-protocol.log`.
- Three desktop agent/sync tests passed: profile/version/bounds, sanitized partial sync result, shared Turso gate; `/private/tmp/nimble-c3-app-tests.log`.
- Socket test initially hit sandbox EPERM on bind, then passed with authorized local-socket access. No live network service called.
- Final expanded run: **10 CLI tests passed**, including synthetic Todoist-enabled outbox assertion; `/private/tmp/nimble-c3-final-tests.log`.
- `rustfmt` on owned Rust files and `git diff --check` passed.

## Remaining acceptance and limits

Root owns native app/UI smoke, combined reminder checks, desktop/web builds, independent review and any installation. Installed CLI workflow activation and live web propagation are not claimed here. Backup/sync execution requires app running. Search remains C4. Core mutation sync observers retain existing warning-only behavior; local success is not guaranteed remote delivery. Workflow proposals expressly forbid automatic dual writes or retry/fallback after partial/uncertain success.
