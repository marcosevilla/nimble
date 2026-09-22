# Focus Queue absorption — verification record

Status: **Tasks 1–5 reviewed (foundation checkpoint)**; Tasks 6–12 in progress on `codex/focus-absorption`. Code through `0a6117e`. This is an evidence log, not release or live-acceptance approval.

Spec: [approved architecture](superpowers/specs/2026-09-22-focus-queue-absorption-design.md). Plan: [12 staged tasks](superpowers/plans/2026-09-22-focus-queue-absorption.md).

## Isolation and baseline

Implementation checkout: `/Users/marcosevilla/Developer/marco-task-app/.worktrees/nimble-focus-absorption`, created from local `6ff894a` including approved documentation and facelift. Native worktree creation could not resolve the outer non-Git folder, so the nested Git repository was used directly. No remote-base reset or main-source implementation edits.

Unchanged baseline: `cargo test --workspace --offline` passed 330 tests across 15 targets; `node --test apps/desktop/tests/*.test.mjs` passed 97 tests. Rust target cache is shared; each build compiles the isolated source. Locked npm dependencies were installed in the worktree. Existing Rust dead-code/unused-assignment and Vite warnings are recorded separately from new failures.

## Completed stage evidence

| Stage | Commits | Verification / review |
|---|---|---|
| 1: schema/domain | `905737b`, `3457e53` | Six focused schema tests pass, workspace compile and desktop build pass. Independent review requested JS-safe integer storage bounds; fix passed scoped re-review. |
| 2: task transactions | `4068f5b`, `973fee3` | Twelve focused transaction tests, 24 existing native-task tests and 74 Todoist tests pass; workspace compile passes. Independent review fixes cover stale local-only delivery claims, Calendar conditional-update rollback, and activity metadata/no-op preservation. Scoped re-review approved. |
| 3: queue/timer engine | `df20da8`, `dbfc422`, `6ddbbbd` | 48 focused schema/transaction/engine/recovery tests pass; existing native task tests and workspace compile pass. Review and two scoped fix rounds approved: mode/Pomodoro transitions, recurrence guard, storage/gap recovery, reorder, and 10-second neighbor-aware Undo. |
| 4: backup/restore/replication | `9fd6d88`, `0a6117e` | Initial full core run: 336 tests across 15 targets pass; web build and workspace compile pass. Review fixes reran backup 3, replica 5, Google 5, reminders 4, web validator 2 plus compile/web build; scoped review approved. |
| 5: service/providers/events | `a0f0272`, `e5a9baf` | Full workspace 412 Rust tests pass (incl. new `focus_routing` 10, `dt` contracts 15); frontend 110/110; desktop/web builds. Review fixes: per-chunk pulled applies with no revision bump for unfocused tasks, full cascaded-subtree delete reconciliation, `dt` direct-path due-identity guard, restored-marker backup test expectation (Task 4 regression), web history cursor parity. Scoped re-review approved. |

Task 4 resolved the temporary v21 export/schema compatibility failures and added the real remote/web `sync_policy` column. Frozen v19/v20 policies remain compatible. Both restore routes verify source/copy equality before normalizing the activation copy; restored v21 profiles remain paused with ownership disabled, and a persistent activation gate blocks independent reminder, Google, backup, Todoist and Turso side effects. Pending evidence/configuration is preserved. Aggregate replication rejects stale/foreign revisions, delayed upserts and invalid numeric ledger fields at native/web boundaries. No build has been installed or deployed.

The 336-test full-core run preceded the final review fix; the focused regression runs and compilation/build checks listed above validate that fix. Existing compiler/deprecation/bundle-size warnings remain; no failing check is being hidden as a warning.

Task2 external-delivery boundary: once a pending operation has been atomically claimed into `sending`, a later policy change cannot revoke that claim. This boundary can precede HTTP start; do not describe it as cancellable until the request begins. Pre-claim cancelled/stale rows are excluded from the actual send batch.

## External API evidence for the optional bridge

On 2026-09-22, the [official Todoist API documentation](https://developer.todoist.com/api/v1/) documented Sync command UUID deduplication and `note_add` using `uuid`, `temp_id`, `item_id` and `content`. New logical comments must retain identifiers across retries and read per-command results. Existing legacy pending operations have no original UUID and cannot gain retrospective deduplication by assigning a new one; reconcile them first. No authenticated request or live operation was made for this check. Actual bridge implementation and transport tests are not yet completed.

## Resume boundary after Task 4

Marco requested a pause after Task 4, before provider/UI integration. Resume with Task 5 of the approved plan; preserve this worktree and its review ledger. Tasks 5–12 remain required before feature acceptance.

The next service integration must route desktop task commands, app-handled `dt` RPC, and incoming Todoist/Turso/Calendar local applies through the single `FocusService`. Preserve command IDs after uncertain responses and send the displayed recurring due identity. Network fetches happen before the service transaction guard. Native lifecycle, process ownership and 20-second heartbeat remain Task 9; safe optional delivery remains Task 11. The current core implementation alone does not establish any of those runtime guarantees.

## Acceptance tracking

F01–F26 remain unaccepted for the complete integrated feature until their owning plan tasks and integration review finish. Schema and transaction evidence above prove those narrower stages only. Product/native visual acceptance, live import, unknown pending-operation decisions, installation, signed-in web checks, daily-use trial and app retirement are separate gates.

Production Nimble, Focus Queue, credentials, saved task files, Instinct routing and Todoist cutover have not been changed by this implementation session. No product push, deployment or live migration has been performed.
