# Focus Queue absorption — verification record

Status: **Tasks 1–12 implemented; Task 12 integration verification recorded below** (code through `95bbb53`, plus Task 12 test/tooling only). The final whole-branch review, the short human checklist (H1–H9) and every live gate are still open. This is an evidence log, not release or live-acceptance approval.

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

Tasks 6–11 (UI, entry points, companion/lifecycle, native fixes, import, optional delivery) are recorded commit by commit in `NEXT.md`, the [native run](focus-native-run-2026-09-22.md) and the SDD ledger (`.superpowers/sdd/2026-09-22-focus-queue-absorption/progress.md`); Task 12 is below.

Task 4 resolved the temporary v21 export/schema compatibility failures and added the real remote/web `sync_policy` column. Frozen v19/v20 policies remain compatible. Both restore routes verify source/copy equality before normalizing the activation copy; restored v21 profiles remain paused with ownership disabled, and a persistent activation gate blocks independent reminder, Google, backup, Todoist and Turso side effects. Pending evidence/configuration is preserved. Aggregate replication rejects stale/foreign revisions, delayed upserts and invalid numeric ledger fields at native/web boundaries. No build has been installed or deployed.

The 336-test full-core run preceded the final review fix; the focused regression runs and compilation/build checks listed above validate that fix. Existing compiler/deprecation/bundle-size warnings remain; no failing check is being hidden as a warning.

Task2 external-delivery boundary: once a pending operation has been atomically claimed into `sending`, a later policy change cannot revoke that claim. This boundary can precede HTTP start; do not describe it as cancellable until the request begins. Pre-claim cancelled/stale rows are excluded from the actual send batch.

## External API evidence for the optional bridge

On 2026-09-22, the [official Todoist API documentation](https://developer.todoist.com/api/v1/) documented Sync command UUID deduplication and `note_add` using `uuid`, `temp_id`, `item_id` and `content`. New logical comments must retain identifiers across retries and read per-command results. Existing legacy pending operations have no original UUID and cannot gain retrospective deduplication by assigning a new one; reconcile them first. No authenticated request or live operation was made for this check. Actual bridge implementation and transport tests are not yet completed.

Task 11 (implemented against that evidence; mock and loopback transports only, no Todoist request): time comments use Sync `note_add` with a `uuid`/`temp_id` persisted at completion and reused on every retry and explicit re-arm. No REST idempotency header is relied on. Guarantees claimed: 429/503/refused-connection retry with bounded backoff (30 s doubling, 1 h cap) and Retry-After; 401/403 pauses until the credential changes; 404/410 or a per-command not-found needs review; a timeout after send, 500/502/504, an unreadable success body, a missing per-command status or a crash mid-send is `uncertain` and is never retried automatically. Exactly-once remote delivery is not claimed. The bridge is off unless `focus_time_delivery_enabled` is `1`; enabling it is a separate live gate. Imported legacy pending operations are listed as evidence and change only through an explicit acknowledge, archive or (comments only) verified-undelivered adoption. Focus delivery never builds a close: an old close is acknowledged, archived, or settled by completing the one-off task natively in Nimble so its normal outbox close is sent. A time comment is created on any local native completion (focus, task list/detail, `dt`/agent) of a mapped task's open occurrence with at least 60,000 ms new work, never on a remote apply.

## Resume boundary after Task 4 (historical)

Marco requested a pause after Task 4, before provider/UI integration. Resume with Task 5 of the approved plan; preserve this worktree and its review ledger. Tasks 5–12 remain required before feature acceptance.

The next service integration must route desktop task commands, app-handled `dt` RPC, and incoming Todoist/Turso/Calendar local applies through the single `FocusService`. Preserve command IDs after uncertain responses and send the displayed recurring due identity. Network fetches happen before the service transaction guard. Native lifecycle, process ownership and 20-second heartbeat remain Task 9; safe optional delivery remains Task 11. The current core implementation alone does not establish any of those runtime guarantees.

## Task 12 — integrated verification (2026-09-22)

Build identity: branch `codex/focus-absorption` at `95bbb53` for all app code. Task 12 adds only `nimble-core/tests/focus_round_trip.rs` (one test, one `#[ignore]` native-seed helper) and `tools/capture-focus-states.js`; no product code changed. Logs: `.superpowers/sdd/2026-09-22-focus-queue-absorption/task-12/`.

### Suites

| Check | Result |
|---|---|
| `cargo test --workspace --offline --no-fail-fast` (final) | **477 passed, 0 failed, 1 ignored** (476 baseline + the new round-trip test; the ignored one is the native-seed helper) |
| Same, first run (default fail-fast) | 1 failure: `backup_git::tests::backup_git_process_timeout_missing_tool_and_bounded_sanitized_output` (`apps/desktop/src-tauri/src/backup_git.rs:1424`, `message.contains("output_limit")`). Passed on the next two full runs. This is the previously unnamed intermittent desktop-crate failure: a python subprocess printing 3.2 MB under a 5 s timeout, so under load it hits the timeout before the output limit. Pre-existing, outside focus scope, not fixed |
| `node --test apps/desktop/tests/*.test.mjs` | **279/279 pass** |
| `npm run build --workspace @nimble/desktop` | pass (only the existing chunk-size note) |
| `npm run build:web --workspace @nimble/desktop` | pass (same note) |
| ESLint on the 69 frontend files changed since `6ff894a` | 10 errors and 4 warnings, all in 7 files and **all identical at the base commit** (react-refresh exports, one set-state-in-effect, stale disables). Zero new findings |

### Backup / import round-trip and rollback rehearsal (synthetic)

`nimble-core/tests/focus_round_trip.rs::backup_import_repeat_restore_and_rollback_keep_exact_local_only_time`, using the Task 10 fixtures in `nimble-core/tests/fixtures/focus/`, on a file-backed profile with Todoist marked connected:

1. An existing task records exactly 20,000 ms and pauses. A verified pre-import backup generation is taken (the rollback point); its portable export equals the live export byte for byte.
2. Import: queue order is existing task, then the imported open task. Totals are exactly 20,000 and 7,000 ms. The completed legacy task shows 12,345 ms as imported, 0 recorded. The stored ledger sums to exactly 39,345 ms. Both imported tasks are `local_only` with no external ID. No new `todoist_outbox` rows and no `focus_delivery` rows. The only session is the real 20 s one, so no session spans are invented. The unresolved remote ID `90071992547409931234` and both pending operations stay as quarantined evidence (nothing is silently dropped).
3. Repeat import: the preview is a no-op, the commit is a no-op, and the ledger dump (queue, sessions, occurrences, totals, records, tasks, batches) plus per-occurrence ms totals are identical.
4. A post-import backup is restored through both routes (snapshot and portable) into isolated directories. The ledger dump and ms totals equal the source exactly. The activation gate stays on, and there are no rows for the imported tasks in `todoist_outbox` and none in `focus_delivery`. The portable route has no outbox at all: it is device-local and excluded from export by policy.
5. Rollback rehearsal: the pre-import generation is restored into an isolated profile. It equals the pre-import ledger exactly (no import batch, one occurrence at 20,000 ms). The live post-import profile is unchanged by the rehearsal.

Older C1 archives remain covered by `backup_recovery::frozen_c1_v19_archive_restores_both_routes_without_upgrading`. No real Focus Queue files, credentials or live profile were read.

### Native checks run by the agent (frozen worktree `nimble-focus-test` at `95bbb53`)

Profile `/private/tmp/nimble-backup-test-task12` (with the `synthetic-profile` marker), `CARGO_TARGET_DIR=…/nimble-focus-test-target`, checked with `sqlite3 -readonly`. The Mac was idle and its display locked. System Events could see the process but no windows, and keystrokes didn't arrive, so nothing that needs clicking was attempted.

| Checklist item | Check | Result |
|---|---|---|
| fresh launch | v21 schema created, owner lock file, `focus_runtime` generation 1, integrity ok | **PASS** |
| 24 | A second instance of the same binary on the same profile runs, but owner epoch, generation (1) and queue writer are unchanged | **PASS** at the DB level. The read-only reason text in its UI was not seen (H3) |
| 23 | `kill -9` of the idle owner: integrity ok, no stray live marker | **PASS** |
| 23 / F16 | Crash with a running session. The state is seeded with the real engine (`seed_crashed_running_session_into_synthetic_profile`, `--ignored`, refuses non-synthetic paths): running, exactly 20,000 ms checkpointed at 06:16:13Z, live marker persisted, process exited without pausing. Native relaunch about 3.5 min later: owner epoch retained, generation 3, session **paused at exactly 20,000 ms** (downtime not credited), segment closed as `recovered`, reason "recovered at last durable checkpoint". Still paused with an unchanged total later; no outbox or delivery rows | **PASS** |

The test app was stopped at the end (SIGTERM; no app, tauri or vite processes remain). The installed app, real data, `~/.local/bin/dt` and `update-app` were not touched.

Earlier hands-on native evidence (Marco, [native run](focus-native-run-2026-09-22.md)): 12/12 pass. It covers companion open and always-on-top, drag and height bounds, compact refit (`9e002d1`), 1 s tick, Space pause, Alt reorder focus (`484cfb1`), timebox chime and red overtime, completion sound, last-surface close pause, ⌘Q pause with exact 41,481 ms, and sleep → paused. The run started at `0e453ec`; fixes were loaded up to `484cfb1`.

### Rendered review states

Contact sheet: `~/Developer/second-brain/outputs/2026/2026-09-23-nimble-focus-review-states.html`, with 46 PNGs in the adjacent folder of the same name (`outputs/INDEX.md` row added). The renders use Playwright WebKit against the Vite dev server with `tools/mock-tauri.js` plus an in-page synthetic focus stub (`tools/capture-focus-states.js`). Covered:
- narrow expanded, running
- timebox overtime (red)
- count-up past 45 minutes (deep amber)
- compact with long title and subtasks at 1×, and scaled at 2× (window size taken from `fitFocusWindow`)
- timebox picker
- card menu, inline rename and delete with Undo
- completed tray
- source picker with still-open
- empty, loading, snapshot error and read-only
- main banner and main expanded

All of the above are in light and dark with the warm accent, plus the expanded state in all 6 accents in both modes. The card, timer and Up next hierarchy holds in every state.

Caveats:
- The delete/Undo frame shows "Task no longer available", because the mock does not broadcast the focus-changed event after a delete. That frame is a harness artifact (H4).
- The open source menu covers the expanded Still open drawer.
- These are browser renders, not native chrome.

### F01–F26 status

Legend:
- **automated**: closed by tests.
- **native**: real app evidence, with its SHA.
- **pending-human**: needs an item from the checklist below.
- **manual-live**: a post-install or live-data gate.

| ID | Status | Evidence / what remains |
|---|---|---|
| F01 | pending-human (H3) | `focusSources`/`focusQueue` tests; native visible queue entries PASS (`fbdecb0`). Remaining: switch source while running, natively |
| F02 | pending-human (H2) | `simultaneous_start_and_reorder_do_not_lose_an_entry`, `reorder_below_running…`; native G Alt reorder PASS (`484cfb1`). Remaining: mouse drag handle |
| F03 | automated | `focusSources`/`focusFlows` tests; still-open, empty, loading and error renders |
| F04 | pending-human (H5) | Quick-add and local-only create tests (`focusQueue`, `local_only_create_update_and_seed_never_export`). Remaining: native offline batch create |
| F05 | native | `switching_tasks_banks_a_and_runs_only_b`, `paused_time_survives_switch…`; native E/F PASS |
| F06 | native | `config_validation…`, `budget_change_preserves_recorded_time`, `focusModel`; native H 1-min timebox PASS |
| F07 | pending-human (H6) | `timebox_overtime_continues_and_claims_one_boundary`, `two_subscribers_cannot_both_claim_one_sound`; native H/I PASS. Remaining: mute, no audio device |
| F08 | pending-human (H6) | `three_rounds_preserve_paused_break_and_only_credit_work`, `pomodoro_caps_round…`, `natural_break_boundary…` (exact multi-round totals, fake clock). Remaining: native Pomodoro chimes and card flip |
| F09 | pending-human (H1, H9) | Native A–D PASS (`9e002d1`); compact geometry renders. Remaining: shadow, titlebar and popovers across themes; Spaces; small or removed displays |
| F10 | native | Native J, K PASS; Task 12 `kill -9` and second process PASS (`95bbb53`); `second_process_without_the_profile_lock_is_read_only…` |
| F11 | pending-human (H4) | `native_delete_undo_restores_parent_and_child_behind_running_entry`, `undo_restores_paused_first…`, `undo_uses_surviving_neighbors…`; render 06. Remaining: delete/Undo while B runs, natively |
| F12 | automated | `focus_task_tx` suite, `parent_completion_cascades…`, `direct_upcoming_completion_does_not_stop_active_work`, `focus_routing` |
| F13 | native | `focusFlows` history/daily grouping; native I completion sound PASS; render 07 |
| F14 | pending-human (H7) | `focusPrompt` tests. Remaining: real clipboard copy and paste. Assistant route activation stays a C3 live gate |
| F15 | manual-live | 23 `focus_delivery` tests (mock and loopback transport). Remaining: separately approved live fixture and enabling the bridge |
| F16 | native | `focus_recovery` suite (midnight, gap, heartbeat, restart); native K/L PASS; Task 12 crash-restart PASS (`95bbb53`). Not native: DST, timezone or manual clock change (automated only); `pmset sleepnow` (H8) |
| F17 | pending-human (H3) | `simultaneous_start_and_reorder…`, receipt replay/failure and `failed_queue_write…` tests. Remaining: two real windows racing |
| F18 | manual-live | Occurrence tests + `recurring_exit_test::edd_task_recurs_natively_twice`. Remaining: the explicit native exit test on real data (R1 gate) |
| F19 | automated | `focusFlows`/`focusStore` tests (next task needs Start; Stop/Skip keep order) |
| F20 | manual-live | 15 `focus_import` tests. Remaining: import of the approved real final snapshot |
| F21 | manual-live | `focus_import` + `focus_round_trip` (exact ms, order, no-op repeat, zero outbound). Remaining: live import |
| F22 | manual-live | `focus_delivery` review/adopt/archive tests. Remaining: Marco's decisions on real pending operations |
| F23 | automated | `focus_backup`, `focus_round_trip`, frozen v19 archive restore |
| F24 | manual-live | `focus_replica` and web validator tests. Remaining: signed-in web read check |
| F25 | manual-live | Synthetic rollback rehearsal automated. Remaining: installed parity, about 14 days of daily use, real rollback rehearsal, retirement decision |
| F26 | pending-human (H1) | Render sheet (46 states); native D PASS. Remaining: side by side against the legacy Focus Queue build, and native visual judgement |

Counts: automated 4 (F03, F12, F19, F23) · native 5 (F05, F06, F10, F13, F16) · pending-human 10 (F01, F02, F04, F07, F08, F09, F11, F14, F17, F26) · manual-live 7 (F15, F18, F20, F21, F22, F24, F25).

### Human-only checklist (about 30 min, synthetic profile, frozen test worktree)

Launch with the steps in [native run → How to re-run](focus-native-run-2026-09-22.md), using a fresh `/private/tmp/nimble-backup-test-<name>` profile. Record pass or fail with the build SHA.

- **H1** (F09/F26): In light and dark, with two accents, check the companion in expanded mode, compact 1× and compact 2×:
  - no shadow bleed
  - the first card row is not under the titlebar
  - the timebox picker, task menu and source picker sit at their anchors and are not clipped or double-scaled

  Put the legacy Focus Queue app beside it, and note every hierarchy deviation. (Checklist 12–14.)
- **H2** (F02): Drag an Up next row by its handle in main and in the companion. The order persists after relaunch, and dragging does not promote.
- **H3** (F17/F01/F10): With main and the companion both open:
  - Click Start in one while you reorder or complete in the other, quickly. One timer only, no lost entry, both windows agree.
  - Switch the source while a timer runs. The card and timer stay.
  - Launch a second instance and read its read-only reason.
- **H4** (F11): With B running, delete a Nimble-only task from Up next, then press Undo within 10 s. It comes back paused behind B, and B keeps running. Also delete the focused card task: the next entry is selected paused.
- **H5** (F04): With Wi-Fi off, quick-add three lines in the "Nimble only" source. They are created in order, local-only, keyboard focus stays in Add, and there is no error.
- **H6** (F07/F08):
  - Mute on: a timebox end and a completion play nothing. Unmute does not replay them.
  - Pomodoro with 1-min rounds: one chime at the round end and one at the break end; the card flips to "Start break" / "Start next round"; the total excludes the break.
- **H7** (F14): Copy assistant context from the card and paste it into a text editor. The IDs, elapsed time and route lines are correct.
- **H8** (F16): With a timer running, `pmset sleepnow` (or close the lid) for over a minute, then wake. It is paused with no auto-resume. Also decide checklist 21a: should ⌘H pause?
- **H9** (F09): Put the companion over a full-screen app and across Spaces (checklist 3). Record the behaviour.

### Live gates (not codeable here)

Still open after this session:
- source/build vs installed parity
- Marco's approved final paused Focus Queue snapshot and the reviewed live import
- decisions on the real pending close/comment operations
- the separately approved enabling of the time-comment bridge
- the signed-in web read check
- the pre-install check of existing children of local-only tasks for queued Todoist creates
- about 14 days of daily use, a rollback rehearsal on the real backup, and a separate app-retirement decision

Todoist C1–C5 and Instinct ownership are unchanged.

## Final review fixes (2026-09-22)

The final whole-branch review returned "with fixes". All six items are fixed test-first on `codex/focus-absorption` after `54e95df`:

- **C1 — recurring double advance.** Enqueue (and import) store the task's due date in `focus_occurrences.scheduling_identity`; only a local user due edit refreshes it. Focus Complete checks it (`ensure_expected_due_tx`), so after a Todoist/Turso pull has advanced a recurring task, Complete returns `stale_occurrence`: due unchanged, nothing enqueued for Todoist. The occurrence stays open in the queue and the tray shows readable copy (remove and re-add to continue). Overturns the Task 7 ruling that `occurrence_id` binds the recurrence generation.
- **I2 — replica churn.** Running heartbeats/checkpoints and periodic pulls that touch no focused work no longer write `focus_replica` sync_log rows; commands, pauses and boundary/gap stops still publish. Each publish deletes older unsynced `focus_replica/current` rows, so at most one waits for Turso.
- **I3 — migration atomicity.** Each migration and its `schema_version` row run in one `BEGIN IMMEDIATE` transaction. An injected failure late in v21 leaves a populated v20 database byte-for-byte v20 in `sqlite_master`; a rerun succeeds.
- **I4 — restored-profile dead end.** New explicit activation (`backup_activate_restored_profile`, Settings → Backups button shown only for a restored profile, `dt backup activate`). It clears the restore marker and makes this device the focus writer under a fresh epoch, only in the profile-owner process. It is idempotent and starts nothing. Runbook line added to `NEXT.md`.
- **M-a — import double count.** Identical duplicate completion entries count once in the preview and `included_ms`; later copies are quarantined evidence (`<key>:duplicate:<n>`).
- **M-b — Undo-delete labels.** Restored task labels get `task_labels` sync_log INSERT rows.

Suites after the fixes: 488 Rust passed (1 ignored native-seed helper), 280 frontend, desktop and web builds, eslint clean on touched frontend files. The known `backup_git` bounded-output flake did not recur in this run.

## Acceptance tracking

F01–F26 are mapped above. None is accepted for release until the controller's final whole-branch review, H1–H9 and the live gates are done. Product/native visual acceptance, live import, pending-operation decisions, installation, signed-in web checks, the daily-use trial and app retirement are separate gates.

Production Nimble, Focus Queue, credentials, saved task files, Instinct routing and the Todoist cutover have not been changed by this implementation. No push, deployment, installation or live migration has been performed.
