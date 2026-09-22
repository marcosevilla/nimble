# Reminders and Agent Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Develop C2 reminders and C3 local assistant access concurrently, preserving working backups and existing tasks.

**Architecture:** Two independently testable feature tracks share one integration owner. Establish schema and event contracts first; workers implement separate modules, while the integration owner alone changes shared startup, providers, task contracts, and backup policies. Integrate and release incrementally.

**Tech Stack:** Rust/sqlx/SQLite, Tauri 2, React/TypeScript, local Unix sockets, Google Calendar OAuth.

**Spec:** `docs/todoist-replacement-decisions.md`; companion plans `2026-09-21-c2-reminders.md` and `2026-09-21-c3-agent-access.md` in this directory.

**Status:** Draft for Marco's review. Planning authorized; implementation has not started. Newly proposed defaults in companion plans require approval as part of this plan.

## Global Constraints

- Web remains the phone client; native Expo stays dormant.
- All task mutations use existing core CRUD and retain sync/outbox semantics.
- Keep Todoist operational through the trial; no automatic workflow cutover.
- Preserve C1 private backups and isolated recovery, including existing schema-19 archives.
- Development and automated QA use synthetic profiles; no real calendar events or task mutations.
- Google connection and live calendar activation are separate visible user actions.
- No unrelated design redesign; use current controls, neutral copy, and keyboard patterns.

## Approach and ownership

Recommended: shared foundation followed by parallel workers, then integration. Fully sequential work is simpler to coordinate but unnecessarily blocks independent CLI work behind OAuth. Fully independent branches with separate schema/startup edits invite conflicting migrations and backup breakage.

| Owner | Exclusive responsibility |
| --- | --- |
| Integration owner | `Cargo.toml`, core module registrations, `db/migrations.rs`, `types.rs`, `db/tasks.rs`, `db/labels.rs`, `db/sync.rs`, export/backup/recovery compatibility, shared TypeScript models/provider, Tauri command registration and startup, `App.tsx`, capability/dependency edits, docs and final release |
| Reminders worker | New reminder scheduler/delivery modules, reminder commands/components, Google OAuth/calendar modules; concrete paths in C2 plan |
| Agent-access worker | New `tools/dt/` CLI, refresh socket implementation, CLI tests and workflow handoff documentation; concrete paths in C3 plan |

Workers must not edit each other's files or revert unrelated work. Requests to shared files go to the integration owner. Independent modules can be built and unit-tested against agreed contracts before the shared foundation is merged. Integration owner serializes shared edits; workers do not simultaneously cherry-pick into a shared working tree.

## Shared contract decisions

C2 requests task `reminder_offset_minutes` and `google_calendar_enabled`, nullable `labels.group`, and four device-local tables defined exactly in its plan. Root owns these edits, including the corresponding export policies. Google tokens remain in Keychain, never portable export. Task updates use explicit clear semantics and an optimistic precondition for incoming calendar edits so a simultaneous CLI edit cannot be overwritten. C3 refresh must invalidate all affected domains, not only task lists. Root also owns overlapping `TaskDetailPage.tsx` edits and the schema-access lock used by desktop migrations and CLI operations; workers submit focused patches for those files. CLI backup/sync execution uses the running app's existing orchestration, while ordinary CLI task edits work with the app closed. Background reminder/calendar work consumes the same post-commit change signal; an app-closed CLI write is discovered on startup.

## Task 1: Freeze contracts and isolated fixtures

**Files:** companion plans, `nimble-core/src/test_util.rs`, new `nimble-core/tests/schema20_compatibility.rs`.

- [ ] Read both companion plans and reconcile exact names, types, device-local table definitions, event payload and schema version in one review before code begins.
- [ ] Prepare synthetic schema-19 snapshot and portable-export fixtures using the existing C1 implementation. Retain bytes and hashes as regression fixtures; never substitute a production backup.
- [ ] Define one profile-resolution contract consumed by desktop and CLI. Test roots must never resolve to production data; unsupported/newer schema must fail before mutation.
- [ ] Assign disjoint implementation tasks and create isolated worktrees using the git-worktrees skill. Each worker receives this document plus its companion plan.

## Task 2: Shared schema and backups

**Files:** `nimble-core/src/db/{migrations,tasks,labels,sync,export_policy,export,backup,recovery}.rs`, `nimble-core/src/types.rs`, `packages/types/`, dormant `apps/mobile/services/database.ts` migration mirror, desktop web provider, existing backup integration tests.

- [ ] Write failing tests for migration from populated v19 to v20: old tasks unchanged, nullable reminder offsets, explicit phone-publishing intent and label groups preserved, local delivery/calendar bookkeeping absent from replicated/portable data.
- [ ] Add the single reviewed v20 migration containing all approved C2 tables and fields. Do not add later tables silently under an already-applied version.
- [ ] Extend task inputs/models and synced snapshots with explicit set/clear semantics. Older incoming snapshots must not accidentally erase new fields. Add tests for both directions and remote schema upgrade.
- [ ] Refactor export policy selection to support explicit reviewed v19 and v20 policies. Unknown versions, tables and columns still fail closed; credentials and calendar bookkeeping never enter portable JSON.
- [ ] Make manifests record actual supported schema version. Restore each archive against its source-version schema and compare canonical bytes before any separate migration. Portable v19 recovery must not run all v20 migrations before comparing the original format.
- [ ] Add a bounded migration-to-version helper for isolated recovery. Keep normal startup migration separate. Do not migrate source backups in place.
- [ ] Run existing export/snapshot/recovery suites plus new compatibility cases: v19 snapshot, v19 portable, v20 snapshot, v20 portable, corrupt data and unknown schema. No live activation in any route.
- [ ] Commit the reviewed foundation and give both workers the same base.

## Task 3: Parallel feature development

- [ ] Execute C2 tasks in `2026-09-21-c2-reminders.md` using a reminders worker.
- [ ] Execute C3 tasks in `2026-09-21-c3-agent-access.md` using a separate agent-access worker.
- [ ] Review each completed task against requirements and code quality before accepting it. Integration owner applies shared registrations and provider edits after the module tests pass.
- [ ] Exercise C3 while Google credentials are unavailable: CLI completion must not depend on Google setup.

## Task 4: Combined behavior and delivery

**Files:** `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/App.tsx`, reminder and refresh runtime tests, `docs/c2-c3-verification.md`, `NEXT.md`, `CLAUDE.md`.

- [ ] In a synthetic app profile, create a timed task via CLI; verify visible refresh within one second, one persisted reminder occurrence and a notification/catch-up entry at the appropriate time.
- [ ] Reschedule and complete that task via CLI; verify stale delivery is suppressed, recurrence creates a new occurrence, and edits retain labels/time/duration and sync entries.
- [ ] Simulate app exit, sleep/wake, notification denial, refresh socket failure, Google disconnection and restart during pending delivery. A committed CLI write remains successful even if refresh delivery fails; do not retry the mutation automatically.
- [ ] Test mapped calendar edits through a fake Google server, including conflicts and retries. Live OAuth/phone alarm verification remains explicitly unverified until completed with Marco.
- [ ] Run `cargo test --workspace --offline`, desktop `npm run build`, web `npm run build:web`, and targeted lint for changed frontend files. Install dependencies before the offline run if the approved implementation adds crates.
- [ ] Perform native smoke checks in an isolated bundle. Browser mocks alone cannot verify notification permissions, sockets or app lifecycle.
- [ ] Document results and remaining live gates in `NEXT.md` and `docs/c2-c3-verification.md`. Show the reviewed change before release installation; retain rollback copy and verify backup success after any approved production update.

## Release checkpoints

1. Shared foundation and historical backup recovery pass.
2. CLI works with local app refresh independently of Google.
3. Desktop reminders persist and catch up correctly.
4. OAuth setup and an actual phone alarm pass before C2 is called complete.

This allows progress on both tracks without declaring phone reminders finished merely because desktop tests pass. Estimates from the August roadmap are historical, not delivery promises for this broader integration.
