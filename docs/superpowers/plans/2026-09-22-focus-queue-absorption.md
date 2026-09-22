# Focus Queue Absorption Implementation Plan

**Execution status (2026-09-22):** Tasks 1–4 implemented and independently reviewed; paused at Marco’s request before Task 5. Continue in `codex/focus-absorption`; see [verification](../../focus-queue-verification.md) and the worktree’s SDD ledger. Tasks 5–12 and whole-branch/native acceptance remain open.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Absorb shipped Focus Queue tracking into Nimble with its familiar card/queue interactions, durable shared timing, safe import and reviewable retirement readiness.

**Architecture:** Rust owns one persistent queue/session engine; native task CRUD participates in its transaction boundary. React surfaces and the companion render revisioned snapshots, with Focus Queue's hierarchy translated to Nimble tokens. Import and external delivery remain separate, provenance-aware operations; web initially reads settled replicas.

**Tech Stack:** Existing Rust/sqlx/SQLite/Tauri 2, React 19/TypeScript/Zustand, existing dnd-kit, node:test/Vite SSR frontend tests, Turso sync. No new frontend test runner.

**Spec:** [Approved design](../specs/2026-09-22-focus-queue-absorption-design.md), approved by Marco after commit `537d823`, including §2 defaults and §4 UI mapping. Read spec and plan together.

## Global Constraints

- “Native Nimble tasks remain authoritative.”
- “Focus Queue is the interaction, layout and information-hierarchy reference; merge its familiar tracking experience into Nimble’s current design system.”
- “Count-up/timeboxes are the primary workflow; Nimble's optional Pomodoro remains.”
- “Durations are nonnegative integer milliseconds throughout storage and API; UTC timestamps record events, with timezone captured for daily grouping.”
- “Nothing starts from a refresh, recovery, restore or completion.”
- “Instinct continues to own its existing live productivity writes.”
- Heartbeat every 20 seconds; gaps over 40 seconds recover paused at last durable checkpoint. Timebox presets 15/25/45/60; custom whole minutes 1–1,440. Amber at 25 minutes, deep amber at 45, red only timebox overtime.
- One designated desktop writer; web cannot start, reorder or import. No cross-window clock authority, per-entry LWW ordering, fake session spans, or silent retry expiry.
- Scheduling `duration_minutes` stays independent of focus budget. Local-only tasks never become Todoist creates, including through seed/pull observers.
- Source repository is the nested `nimble` Git repository, based on current local main including unpushed facelift/spec commits. Do not branch from remote main. Read outer AGENTS/CLAUDE and inner CLAUDE. Preserve others' edits; scope commits to owned files.
- No production install, deployment, push, live migration/replay, credential/data inspection, Todoist/Instinct writes, old-app deletion or cutover in implementation verification. Synthetic profiles/fixtures only. Live acceptance remains explicit in NEXT.

## Review Focus

- SQLite failure/cancellation between native completion and ledger commit must leave task, queue, time and delivery intent together; pinned in Tasks 2–3.
- `external_id = NULL` is currently auto-export eligible: local-only imports must remain local through every observer/seed/restore path; pinned in Tasks 2 and 10.
- Recurring task native completion currently emits due-field updates, not close: never send both date advancement and another remote close; pinned in Tasks 2 and 11.
- An event racing initial load or both windows mounting must not regress revision or play duplicate sound; pinned in Tasks 5 and 9.
- Unknown/corrupt legacy fields, opaque large numeric-looking IDs and cumulative import snapshots must preserve evidence without fabricated time/duplicate contributions; pinned in Task 10.

## Authorization and execution

Marco explicitly instructed: finish the plan, then start executing, and notify when finished. No further plan/method approval is needed. Recommended and selected method: subagent-driven, sequential implementers with scoped task review, then whole-branch review. These coupled changes can lose time/tasks if interfaces drift; the extra review is warranted. A controller owns integration and ledger, not a parallel second implementation of each task. Read-only discovery may run concurrently. Each worker has exclusive task ownership and must not spawn additional workers/reviewers.

One plan is appropriate because queue, ledger, CRUD and consumers share a single consistency boundary. Three independently verifiable checkpoints bound it: **foundation (1–5)**, **desktop experience (6–9)**, **migration/delivery/readiness (10–12)**. Do not release a partial UI as retirement parity. Optional feature availability remains off until foundation and consumers are coherent.

## File ownership and dependencies

Paths below are repository-relative. New paths are deliberate; existing paths were checked during planning. Each owner can modify its tests and associated documentation. Shared registry files are edited only by the current sequential task owner.

| Task | Owner responsibility / files | Depends on |
|---|---|---|
| 1 | `nimble-core/src/focus_types.rs`, `db/focus/schema.rs`, `db/migrations.rs`, `db/focus.rs`, `lib.rs`; `packages/types/src/focus.ts`, `index.ts` | Baseline |
| 2 | `db/tasks.rs`, new `db/task_tx.rs`; `integrations/todoist/{observer,outbox,sync_loop}.rs`; local-only field mirrors | 1 |
| 3 | `db/focus/{engine,clock,queue,tests}.rs`; extend `db/focus.rs` | 1–2 |
| 4 | `db/{export_policy,export,recovery,sync}.rs`, `apps/mobile/services/database.ts`, new focus replication helpers | 1–3 |
| 5 | Shared `data-provider.ts`; desktop services/providers; Tauri focus commands/state/lib; shared data event bridge | 3–4 |
| 6 | Pure frontend focus model/source/prompt helpers and controller cache | 5 |
| 7 | Focus card/queue/source/task/history controls using current components and tokens | 6 |
| 8 | Existing focus entry points, Dashboard, native task-detail/time display | 7 |
| 9 | Companion entry/lifecycle/geometry, Tauri capabilities/config/power/process coordination | 5, 7–8 |
| 10 | `db/focus/import.rs`, import DTO/provider methods/commands, preview UI/fixtures | 2–5, 7 |
| 11 | `integrations/todoist/focus_delivery.rs`, adapter/outbox wiring, reconciliation UI | 2–5, 10 |
| 12 | Cross-surface tests, native synthetic acceptance and docs/verification/NEXT | All |

## Shared interface contract

Use snake_case serialized fields consistent with existing native DTOs. `packages/types/src/focus.ts` and Rust `focus_types.rs` mirror each other. Stable opaque string IDs; unsigned safe integer milliseconds and revisions (reject JSON integers above Number.MAX_SAFE_INTEGER).

```ts
export type FocusMode = 'count_up' | 'timebox' | 'pomodoro'
export type FocusPhase = 'idle' | 'work' | 'break' | 'round_ready' | 'work_ready'
export type FocusStatus = 'paused' | 'running' | 'ended'
export type FocusSource = { kind: 'today' } | { kind: 'project'; project_id: string } | { kind: 'local' }
export interface FocusConfig { mode: FocusMode; budget_ms: number | null; work_ms: number; break_ms: number; rounds: number }
export interface FocusEntry { id: string; task_id: string; occurrence_id: string; added_at: string; source: FocusSource; explicit_still_open: boolean; config: FocusConfig }
export interface FocusSession { id: string; occurrence_id: string; status: FocusStatus; phase: FocusPhase; work_ms: number; break_ms: number; round_work_ms: number; round: number; config: FocusConfig }
export interface FocusSnapshot { queue_revision: number; engine_revision: number; owner_epoch: string; process_generation: number; writer_device_id: string; queue: FocusEntry[]; selected_occurrence_id: string | null; session: FocusSession | null; totals: Record<string, number>; as_of: string; checkpoint_at: string | null; recovery_reason: string | null; replica: boolean }
export interface FocusCapabilities { queue_read: boolean; queue_write: boolean; history_read: boolean; live_timing: boolean; companion: boolean; import: boolean; reason: string | null }
export type FocusAction =
 | { kind: 'enqueue'; task_ids: string[]; source: FocusSource; explicit_still_open: boolean }
 | { kind: 'reorder'; entry_ids: string[] }
 | { kind: 'promote' | 'remove' | 'start' | 'complete'; occurrence_id: string }
 | { kind: 'pause' | 'resume' | 'stop' | 'skip' | 'start_break' | 'end_break' }
 | { kind: 'configure'; occurrence_id: string; config: FocusConfig }
 | { kind: 'archive_history'; occurrence_ids: string[] }
 | { kind: 'undo_delete'; token: string }
export interface FocusCommand { command_id: string; expected_engine_revision: number; expected_queue_revision: number; owner_epoch: string; process_generation: number; session_id: string | null; action: FocusAction }
export interface FocusReply { snapshot: FocusSnapshot; replayed: boolean; committed_revision: number }
export interface FocusHistoryRow { occurrence_id: string; task_id: string | null; title: string; total_ms: number; recorded_ms: number; imported_ms: number; completed_at: string | null; archived: boolean }
export interface FocusHistoryPage { rows: FocusHistoryRow[]; next_cursor: string | null }
export type FocusErrorCode = 'conflict' | 'wrong_owner' | 'stale_occurrence' | 'not_found' | 'invalid' | 'unsupported' | 'storage' | 'needs_review'
export interface FocusError { code: FocusErrorCode; message: string }
```

Native service API: `FocusService::new(pool: SqlitePool, device_id: String) -> Self`; `initialize(&self) -> Result<()>`; `snapshot(&self) -> Result<FocusSnapshot>`; `execute(&self, command: FocusCommand) -> Result<FocusReply>`; `checkpoint(&self, elapsed_ms: u64, wall_time: String) -> Result<FocusSnapshot>`; `interrupt(&self, reason: &str) -> Result<FocusSnapshot>`; `history(&self, cursor: Option<String>, task_id: Option<String>) -> Result<FocusHistoryPage>`. `checkpoint` elapsed is **since last checkpoint**, generated by a Rust monotonic clock, never frontend input; test callers supply deterministic values. Public wire commands must not expose it. Use a service mutex and immediate SQLite transaction; do not hold an open transaction across network I/O.

Test harness created with Task 3 in `nimble-core/tests/common/focus.rs`: `Harness::new().await`, fields `pool`, `service`; `task(title).await -> String` via native CRUD; `send(action).await -> Result<FocusReply>` constructs a fresh envelope from current snapshot; `advance(ms).await` checkpoints with deterministic wall time; `snapshot().await`. Each new focused test file declares `#[path="common/focus.rs"] mod fixture;` and uses this real database harness, not a second fake engine. Test commands use `cargo test -p nimble-core --offline --test <file_stem>`.

---

### Task 1: Persist the domain and its constraints

**Files:** Create `nimble-core/src/focus_types.rs`, `nimble-core/src/db/focus/schema.rs`, `packages/types/src/focus.ts`, `nimble-core/tests/focus_schema.rs`. Modify `nimble-core/src/{lib.rs,db/focus.rs,db/migrations.rs}`, `packages/types/src/index.ts`.

**Interfaces:** Produce the DTOs above and new focus tables from spec §5. Existing `FocusState` remains compatibility-only until Task 8 removes old consumers. Expose `db::focus::schema::validate_config(&FocusConfig) -> Result<()>` and export FocusService later from `db::focus`.

- [x] Write migration tests before adding schema. Use the existing test pool and exact invariants:
```rust
#[tokio::test]
async fn focus_schema_is_present() {
 let pool = nimble_core::test_util::test_pool().await;
 for name in ["focus_queue_state", "focus_occurrences", "focus_sessions", "focus_segments", "focus_runtime", "focus_import_totals", "focus_command_receipts", "focus_import_batches", "focus_import_records", "focus_delivery", "focus_undo"] {
  let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?").bind(name).fetch_one(&pool).await.unwrap();
  assert_eq!(count, 1, "{name}");
 }
}
```
- [x] Run `cargo test -p nimble-core --offline --test focus_schema`; expect missing-table assertion before implementation.
- [x] Add the next free migration (currently after 20). Implement fields in spec §5 with explicit CHECK constraints for nonnegative times/revisions, unique imported record keys, unique receipt IDs and retained historical IDs. Queue is ONE JSON aggregate row; sessions and segment durations are separate audit/total representations. No SQL trigger bodies (migration runner splits on semicolons).
```sql
CREATE UNIQUE INDEX focus_one_open_segment ON focus_segments((1)) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX focus_one_occurrence_generation ON focus_occurrences(original_task_id, generation);
CREATE UNIQUE INDEX focus_import_record_key ON focus_import_records(source_namespace, record_key);
```
Add persistent `local_tasks.sync_policy` values `default`/`local_only`, default `default` for existing tasks; preserve it in Rust/TS task DTOs and ordinary create/update. `NULL external_id` alone cannot encode local-only. References to historical task IDs must survive deletion (nullable current task reference plus immutable original ID).
- [x] Implement config validation: all times safe integer ms, budget null for count-up, positive 1–1,440 whole-minute budget for timebox, Pomodoro work/break positive whole minutes and rounds 1–100. Mirror shape exports; no scheduling field coupling.
- [x] Run schema tests and existing migration tests. Assert repeated migration is a no-op and old data unchanged. Commit owned schema/types/tests as `feat: persist focus queue and timing domain`.

### Task 2: Make native task mutations transaction-composable

**Files:** Create `nimble-core/src/db/task_tx.rs`, `nimble-core/tests/focus_task_tx.rs`. Modify `db/{mod,tasks}.rs`, `integrations/todoist/{observer,outbox,sync_loop}.rs`, task field projections/mappers/providers that compile against `sync_policy`.

**Interfaces:** Internal functions consume `&mut sqlx::SqliteConnection`, not a pool: `create_task_tx(conn, input: CreateTaskInput, policy: MutationPolicy) -> Result<LocalTask>`, `update_task_tx(conn, id: &str, input: UpdateTaskInput, policy) -> Result<LocalTask>`, `set_status_tx(conn, id: &str, status: &str, today: NaiveDate, policy) -> Result<TaskEffects>`, `delete_task_tx(conn, id: &str, policy) -> Result<TaskEffects>`. `MutationPolicy` = User/Remote/Import. `TaskEffects` owns changed/deleted task snapshots and recurrence before/after due identity. Public task APIs retain signatures and wrap these operations; observers enqueue through the same connection. Activity remains post-commit best-effort.

- [x] Add a rollback test using real native create/status logic in an explicit transaction:
```rust
#[tokio::test]
async fn task_and_delivery_intent_rollback_together() {
 let pool = nimble_core::test_util::test_pool().await;
 let mut tx = pool.begin().await.unwrap();
 let before: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks").fetch_one(&mut *tx).await.unwrap();
 let input = nimble_core::types::CreateTaskInput { content: "Rollback task".into(), ..Default::default() };
 let task = nimble_core::db::task_tx::create_task_tx(&mut tx, input, nimble_core::db::task_tx::MutationPolicy::User).await.unwrap();
 let inserted: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks WHERE id=?").bind(&task.id).fetch_one(&mut *tx).await.unwrap();
 assert_eq!(inserted, 1);
 tx.rollback().await.unwrap();
 let after: i64 = sqlx::query_scalar("SELECT count(*) FROM local_tasks").fetch_one(&pool).await.unwrap();
 assert_eq!(after, before);
}
```
Add an active-adapter synthetic fixture to assert the in-transaction outbox insert also rolls back. Add deterministic fault injection after native status change and before receipt commit to prove rollback (Task 3 adds receipt integration).
- [x] Run `cargo test -p nimble-core --offline --test focus_task_tx`; initially fail on missing transaction API. Preserve existing task hierarchy, labels, reminder and Calendar behavior through their existing suites.
- [x] Move mutation internals into connection-taking helpers without nested BEGIN or post-commit mandatory enqueue. Snapshot mutation policy and adapter activation before transaction; avoid a credentials/network lookup under lock. User required intents fail the local transaction on enqueue error. Remote/Import never echo outbound changes. Native task APIs call focus reconciliation in the same transaction once Task 3 supplies it.
```rust
let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
let effects = set_status_tx(&mut tx, id, status, today, MutationPolicy::User).await?;
tx.commit().await?;
// Activity/invalidation occurs after successful commit only.
```
- [x] Test `local_only` suppression on create, update, pull-observer and `seed_outbox_for_unlinked`, not only import. A duplicate local task remains local. Preserve existing normal task export behavior.
- [x] Pin recurrence effects: ordinary native recurring completion advances local due date through existing recurrence logic and produces **one due-update intent, not a due-update plus close**. Record old occurrence completion independently; the time-comment bridge can report the work. This preserves current native adapter behavior; legacy pending recurring closes require reconciliation. Add a twice-complete test with old generation retry and no double advance.
- [x] Run relevant existing task/Todoist tests plus new transaction suite; commit as `refactor: compose native task mutations with focus transactions`.

### Task 3: Build serialized queue and timer execution

**Files:** Create `db/focus/{engine,clock,queue}.rs`, `nimble-core/tests/{focus_engine,focus_recovery}.rs`, `nimble-core/tests/common/focus.rs`; modify `db/focus.rs` and Task 2's task mutation hooks.

**Interfaces:** Produce `FocusService` contract above. `reconcile_task_effects_tx(conn, effects: &TaskEffects) -> Result<()>` settles/removes affected occurrences using current persisted checkpoint and advances revisions. Normal focus command handling settles elapsed just before acquiring its transaction; source task operations must share the service's monotonic clock/serialization on desktop. DB writes outside desktop service must pause at persisted checkpoint, never guess elapsed.

- [x] Write executable scenario tests with the real Harness; the first failing case is time preservation:
```rust
#[tokio::test]
async fn paused_time_survives_switch_and_next_requires_start() {
 let h = fixture::Harness::new().await;
 let a=h.task("A").await; let b=h.task("B").await;
 h.send(serde_json::from_value(serde_json::json!({"kind":"enqueue","task_ids":[a,b],"source":{"kind":"today"},"explicit_still_open":false})).unwrap()).await.unwrap();
 let first=h.snapshot().await.queue[0].occurrence_id.clone();
 h.send(serde_json::from_value(serde_json::json!({"kind":"start","occurrence_id":first})).unwrap()).await.unwrap();
 h.advance(20_000).await;
 h.send(serde_json::from_value(serde_json::json!({"kind":"pause"})).unwrap()).await.unwrap();
 assert_eq!(h.snapshot().await.totals[&first],20_000);
 h.send(serde_json::from_value(serde_json::json!({"kind":"complete","occurrence_id":first})).unwrap()).await.unwrap();
 assert_ne!(h.snapshot().await.session.map(|s|s.status),Some(nimble_core::focus_types::FocusStatus::Running));
 assert_eq!(h.snapshot().await.queue.len(),1);
}
```
- [x] Run `cargo test -p nimble-core --offline --test focus_engine`; expect missing service/behavior failure. Add harness methods by calling actual service/native CRUD, not reimplementing state transitions.
- [x] Implement receipt-first command execution, serialized revisions and invariant checks:
```text
lock service -> hash canonical request -> read matching receipt
if same ID/body exists: return old result plus current snapshot, replayed=true
if ID/body differs: invalid
validate owner/process/revisions/occurrence -> begin immediate
settle clock delta -> apply queue/task/session effects -> persist receipt + publication intent
commit -> update monotonic anchor -> broadcast IDs/revisions
```
Implement every FocusAction, duplicate enqueue no-op, full-set reorder conflict, promote pause, Start switch atomic, Stop retains first, Skip moves bottom, direct upcoming completion preserves unrelated running session. Undo restores behind active entry. Completion/recurrence freezes generation; new occurrence not autoqueued.
- [x] Implement segmented accumulation and recovery; checkpoints accept <=40,000ms, longer gaps freeze/pause at prior checkpoint. Work/break accounted separately; Pomodoro rounds cap at work boundary and wait; paused break resumes same phase. Boundaries have durable sound tokens. Never sum segment audit plus session accumulator. Test 3 work rounds + breaks, Stop/Resume, budget changes and 60-second gap.
- [x] Add tests for same command replay after restart/stale revisions, mismatched body, simultaneous Start/reorder, disk error rollback, parent cascade, remote completion and delete/Undo while B runs. Use integer exact totals, no sleeps. Restart increments process generation but retains owner epoch; running marker normalizes paused across dates.
- [x] Run engine/recovery/task suites, commit as `feat: serialize durable focus queue and timer commands`.

### Task 4: Preserve focus through backup and ordered replication

**Files:** Create `db/focus/replica.rs`, `nimble-core/tests/{focus_backup,focus_replica}.rs`. Modify `db/{export_policy,export,recovery,sync}.rs`, `apps/mobile/services/database.ts` schema mirror.

**Interfaces:** `apply_focus_replica_tx(conn, payload: FocusReplica) -> Result<bool>` accepts only recognized writer/epoch and strictly newer revision; `FocusReplica { writer_device_id, owner_epoch, revision, queue, occurrences, sessions, totals, as_of }` contains settled data only. `normalize_focus_restore(conn) -> Result<()>` clears authority/live segments and quarantines pending delivery. Existing archive versions remain readable; bump export format compatibly.

- [x] Write backup test using Task 3 Harness, pause after 20,000ms, invoke existing export and isolated restore helpers, assert total/order equality and no running/armed intent. Use existing frozen C1 archive fixtures unchanged.
```rust
#[test]
fn stale_replica_revision_is_rejected() {
 use nimble_core::db::focus::replica::accept_revision;
 assert!(!accept_revision("mac-a","epoch-1",9,"mac-a","epoch-1",8));
 assert!(!accept_revision("mac-a","epoch-1",9,"mac-b","epoch-1",10));
 assert!(accept_revision("mac-a","epoch-1",9,"mac-a","epoch-1",10));
}
```
Expose the pure `accept_revision(writer: &str, epoch: &str, revision: u64, incoming_writer: &str, incoming_epoch: &str, incoming_revision: u64) -> bool` used by real apply.
- [x] Run `cargo test -p nimble-core --offline --test focus_backup --test focus_replica`; expect schema/export omissions initially.
- [x] Extend every enumerated export table/column policy with spec §8 categories. Restore receipts/import keys, preserve unresolved references, normalize running to paused, reset ownership to disabled, quarantine external intents and invalidate Undo. Do not infer durations from legacy daily_state/activity. Preserve existing source-versus-restored equality verification first, then normalize a separate activation copy before publication; do not alter evidence before equality checks.
- [x] Extend remote schema creation/upgrades, sanitizer, seed and pull handlers; publish queue as one aggregate, never separate row positions. Local authority ignores pulled focus writes; web sees settled snapshots with as_of. Missing task bodies show unavailable references. Mirror schema only in dormant mobile; do not revive mobile UI/provider.
- [x] Run focus backup/replica tests and existing export/recovery suite; commit as `feat: back up and replicate settled focus state safely`.

### Task 5: Expose one service to providers and all windows

**Files:** Modify `packages/types/src/data-provider.ts`, `apps/desktop/src/services/{tauri,tauri-provider,turso-provider}.ts`, `apps/desktop/src-tauri/src/{lib.rs,commands/focus.rs,commands/mod.rs}`, `apps/desktop/src/{App.tsx,lib/dataChanges.ts}`. Create `apps/desktop/src-tauri/src/focus_service.rs`, `apps/desktop/src/services/focus-events.ts`, `apps/desktop/tests/focusProvider.test.mjs`.

**Interfaces:** `DataProvider.focus` exposes `capabilities`, `snapshot`, `execute`, `history({cursor?,task_id?})`, `openCompanion`; Task 10 adds import. Core service owned once via `app.manage`. `subscribeFocusChanges(callback: () => void): () => void` is a provider-neutral invalidation seam. Desktop event `nimble-focus-changed` contains IDs/revisions, no content. Web typed unsupported errors for writes; history/snapshot real settled reads.

- [ ] Add test for subscribe-before-load ordering and stale response rejection using a pure helper in `services/focus-events.ts`:
```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldApplyFocusRevision } from '../src/services/focus-events.ts'
test('late initial load cannot overwrite a newer event result',()=>{
 assert.equal(shouldApplyFocusRevision(12,11),false)
 assert.equal(shouldApplyFocusRevision(12,12),true)
})
```
Signature `shouldApplyFocusRevision(current: number, incoming: number): boolean` returns incoming >= current. Same epoch only; epoch mismatch requires full owner snapshot revalidation.
- [ ] Run `cd apps/desktop && node --test tests/focusProvider.test.mjs`; first fail missing helper/provider contract. Do not install Vitest.
- [ ] Register thin commands `focus_capabilities`, `focus_snapshot`, `focus_execute`, `focus_history`, `focus_open_companion`; keep service clock checkpoint private. Route old start/end methods through compatibility errors until Task 8 replaces all consumers; do not silently execute two engines.
- [ ] Extract shared provider event subscription from App into provider-root behavior so companion does not bypass it. On reconnect/visibility/revision gap read full snapshot; ignore stale replies. Errors carry typed code/message and retain client intent. Desktop broadcasts after commit, sound consumed only by owner.
- [ ] Add mocked provider tests for unsupported web controls and real settled read, no fake success. Run desktop/web builds (`npm run build --workspace @nimble/desktop`, `npm run build:web --workspace @nimble/desktop`) to validate every provider. Commit as `feat: expose revisioned focus service across providers`.

### Task 6: Implement source candidates, formatting and render cache

**Files:** Create `apps/desktop/src/lib/{focusModel,focusSources,focusPrompt}.ts`, `apps/desktop/tests/{focusModel,focusSources,focusPrompt}.test.mjs`; replace `stores/focusStore.ts` authority with provider-backed cache.

**Interfaces:** `timerPresentation(totalMs:number,budgetMs:number|null): {text:string,phase:'normal'|'amber'|'deepAmber'|'overtime'}`; `candidateIds(tasks:LocalTask[],source:FocusSource,today:string): {ids:string[],still_open_ids:string[]}`; `buildFocusPrompt(task:LocalTask,children:LocalTask[],snapshot:FocusSnapshot):string`; `refreshFocus():Promise<void>`, `sendFocusAction(action:FocusAction):Promise<FocusReply>`. Store owns snapshot/capabilities/loading/error/optimistic presentation only, never independent elapsed accounting. Retry an uncertain action with the same envelope/UUID.

- [ ] Write boundary tests:
```js
import test from 'node:test'; import assert from 'node:assert/strict'
import { timerPresentation } from '../src/lib/focusModel.ts'
test('count up never becomes red and timebox continues overtime',()=>{
 assert.equal(timerPresentation(25*60000,null).phase,'amber')
 assert.equal(timerPresentation(45*60000,null).phase,'deepAmber')
 assert.equal(timerPresentation(60*60000,null).phase,'deepAmber')
 assert.equal(timerPresentation(16*60000,15*60000).phase,'overtime')
})
```
- [ ] Run `cd apps/desktop && node --test tests/focusModel.test.mjs tests/focusSources.test.mjs tests/focusPrompt.test.mjs`; fail before helpers exist.
- [ ] Implement Today local-date/project/local-only candidates, collapsed still-open membership, native parent-child folding, stable append order. Capture source in add intent. Queue selection never follows current filter automatically. Prompt includes IDs/project/due/priority/description/subtasks/elapsed/budget, truthful route capability and no unsupported comment-refresh promise.
- [ ] Test stale source-change replies, due-today timezone, undated project tasks, huge string IDs, local-only flag, clipboard failure and prompt completeness. Store refresh subscribes before read and retry keeps command ID. Commit as `feat: model focus sources and provider-backed presentation`.

### Task 7: Build the familiar card and ordered queue UI

**Files:** Create `components/focus/{FocusQueueTray,FocusTaskCard,FocusQueueList,FocusSourcePicker,FocusTimeboxPicker,FocusCompletedTray}.tsx`, `apps/desktop/tests/{focusCard,focusQueue}.test.mjs`, SSR fixture `tests/fixtures/focusRender.tsx`; reuse existing task editing, menu, Button and typography tokens.

**Interfaces:** All components receive `snapshot:FocusSnapshot`, resolved task data and `onAction:(action:FocusAction)=>Promise<FocusReply>`; card has `compact:boolean`. Source selection is candidate browsing; `FocusQueueTray` provides explicit Queue these. Rendering current snapshot cannot start a timer.

- [ ] Add SSR test fixture using existing googleSetupRender/Vite harness pattern, with exported `renderFocusCard():string` and `renderCompactFocus():string`. Assert ordering by stable accessible labels:
```js
test('task identity precedes prominent timer and compact retains controls',()=>{
 const html=rendered.renderCompactFocus()
 assert.ok(html.indexOf('Example task') < html.indexOf('Focus timer'))
 assert.match(html,/Start/); assert.match(html,/Show queue/)
 assert.doesNotMatch(html,/Up next/)
})
```
`rendered` is imported in the existing before/after SSR build pattern, with React fixture supplying a paused task and inline subtask. No static-source regex substitutes for rendered hierarchy.
- [ ] Run `cd apps/desktop && node --test tests/focusCard.test.mjs tests/focusQueue.test.mjs`; fail until actual components render.
- [ ] Implement source mapping from spec §4: completion/title/actions → metadata → inline subtasks → timer-left and circular Start/Pause-right; Up next rows below; inline Add; completed tray; bottom-anchored source/count/sync and collapsed still-open drawer. Click timer opens 15/25/45/60/custom/count-up. Timer and tabular text dominate without replacing task identity.
- [ ] Wire handle-only dnd-kit, keyboard move, row promote, distinct completion/menu controls, inline local rename/duplicate/delete Undo, native quick-add batch, preserved failure text and input focus. Pending errors never disappear behind celebration. History Clear archives tray entries. Use current semantic tokens; no Todoist sound/color literals; mute option and optional Pomodoro fit secondary controls.
- [ ] Test command intents from pure handlers plus rendered labels/tab stops; reduced-motion and all accent themes in later native review. Commit as `feat: merge Focus Queue card and queue into Nimble styling`.

### Task 8: Replace transient focus entry points and expose history

**Files:** Modify `components/focus/{FocusView,FocusBanner,FocusResumeDialog,FocusPlayMenu,FocusCelebration}.tsx`, `components/layout/Dashboard.tsx`, focus hook/entry files located in source map, task detail display and `stores/focusStore.ts`. Tests `apps/desktop/tests/focusFlows.test.mjs`.

**Interfaces:** Every entry point submits FocusAction; multi-select defaults enqueue; Focus now explicitly starts. No `dp.tasks.updateStatus` + separate focus.endSession sequence survives. History uses `focus.history` and totals from snapshots, not activity logs. Shared controls expose Start rather than auto-start from celebration.

- [ ] Add intent regression test through an extracted `completionNextAction(key:string):FocusAction|null` in `lib/focusModel.ts`:
```js
test('celebration dismissal never starts another task',()=>{
 assert.equal(completionNextAction('Enter'),null)
 assert.equal(completionNextAction('Escape'),null)
})
```
Also record mocked provider calls for current/upcoming completion and failed completion; failure must leave queue/current card unchanged and show error.
- [ ] Run focusFlows test; observe failure against legacy auto-start behavior before replacing it.
- [ ] Replace old overlay contents with new card/queue surfaces; preserve banner coexistence and shell navigation. Stop/Skip no longer clear queue. Recovery renders paused total from any date. Remove heuristic next-task override and old interval authority; migrate existing shortcuts to explicit Start/queue actions using current key guards.
- [ ] Add per-task total/history display, exact provenance labels (“Imported total”, recorded work), nullable timestamps and archived-tray controls. Ensure no claim that old totals represent session spans. Existing Today/project/native workflows remain usable outside focus.
- [ ] Run all frontend node tests plus desktop/web builds. Search old `startSession/endSession` consumers and remove or reject stale API paths explicitly. Commit as `feat: route Nimble focus workflows through durable engine`.

### Task 9: Add the shared always-on-top companion and lifecycle

**Files:** Create `src/components/focus/FocusCompanion.tsx`, `src/lib/focusWindow.ts`, `src-tauri/src/focus_window.rs`, `apps/desktop/tests/focusWindow.test.mjs`; modify `src/main.tsx`, Tauri `lib.rs`, `tauri.conf.json`, `capabilities/default.json`, Task 5 service.

**Interfaces:** `fitFocusWindow(width:number,cardHeight:number,chromeHeight:number,workArea:{width:number,height:number}):{width:number,height:number,scale:number}`; `FocusService::interrupt(reason)` settles/persists. Native lifecycle owns profile lock, sleep/wake, visible-surface count and 20-second heartbeats, never browser intervals. `?window=focus` mounts the shared provider/event bridge.

- [ ] Write geometry tests:
```js
test('compact geometry includes chrome and fits current display',()=>{
 const x=fitFocusWindow(1020,300,28,{width:800,height:700})
 assert.ok(x.width<=800); assert.ok(x.height<=700)
 assert.ok(x.scale>=1 && x.scale<=3)
})
```
Also test monitor smaller than 340 with scrollable fallback, long titles/subtasks, restore after monitor removal, and titlebar=0 versus 28.
- [ ] Run `cd apps/desktop && node --test tests/focusWindow.test.mjs` before helper. Implement proportional scale/fit based on work area; expanded defaults 340×560, height 420–640; compact width max min(1020,work area), clamp/overflow safely. Separate stored expanded height/compact width. Translate ~220ms intent to Nimble motion tokens; reduced motion immediate.
- [ ] Register `focus` window and exact required Tauri permissions, shared app state and provider root; synchronous show/activation from user action. Companion close keeps main session if another focus surface visible; last visible surface close pauses; Quit settles; forced quit recovers. Add process/profile locking and native suspend callbacks; fallback >40-second gap safely pauses if callback absent.
- [ ] Use owner-only native sound effect emission with durable boundary token. Test two subscribers cannot duplicate sound claims. Add native synthetic checklist for drag, resize/scale, shadow bleed, titlebar offset, popovers, always-on-top, focus visibility, close/hide and sleep/wake. Do not install over production.
- [ ] Run geometry tests, Tauri/Rust tests and desktop build; commit as `feat: share durable focus with native companion window`.

### Task 10: Implement frozen-file import preview and safe commit

**Files:** Create `db/focus/import.rs`, `nimble-core/tests/focus_import.rs`, sanitized JSON fixtures under `nimble-core/tests/fixtures/focus/`, `components/focus/FocusImportDialog.tsx`; modify focus DTO/provider/Tauri command registries/export mappings.

**Interfaces:** `LegacyFocusFiles { source_namespace:String, state_json:Option<String>, manual_json:Option<String>, pending_json:Option<String> }` excludes config/path crawling. `preview_import(pool:&SqlitePool, files:&LegacyFocusFiles)->Result<FocusImportPreview>`; `commit_import(pool:&SqlitePool, files:&LegacyFocusFiles, preview_token:&str, command_id:&str)->Result<FocusImportResult>`. Preview includes hashes, destination revisions, mapped task/order/contribution proposals, raw unknown evidence and blocking/review issues. UI chooses files explicitly; original files untouched.

- [ ] Write sanitized fixture tests with manual task m1, 12,345ms completed total, a residual same-ID timer of 12,345ms, remote ID `90071992547409931234`, one close and one comment. Assert one included 12,345ms contribution, residual quarantined, unresolved remote retained, no config field accepted, pending operations quarantined. Add repeated import/changed cumulative snapshot test.
```rust
#[tokio::test]
async fn malformed_source_is_not_empty_success() {
 let pool=nimble_core::test_util::test_pool().await;
 let files=nimble_core::focus_types::LegacyFocusFiles{source_namespace:"fixture".into(),state_json:Some("{".into()),manual_json:None,pending_json:None};
 assert!(nimble_core::db::focus::import::preview_import(&pool,&files).await.is_err());
}
```
- [ ] Run `cargo test -p nimble-core --offline --test focus_import`; fail missing importer. Implement typed parsing preserving unknown fields in provenance; validation checks cross-file references and safe timestamps, not empty fallback. Manual order wins its projection. Recover running timer only through lastTickAt; missing heartbeat adds zero. No remote metadata invention.
- [ ] Implement deterministic namespace+record mapping independent of file hash using existing blake3 (opaque hex ID prefix), completion precedence and cumulative lineage replacement. Changed post-import tasks require review, not overwrite. Preview merged queue = existing → active legacy source → remaining manual; dedup occurrence. Exact known totals remain aggregates with absent spans.
```text
transaction: verify preview/file hashes + destination revisions
lookup import receipt -> return if identical
native CRUD with Import policy + local_only -> upsert provenance/contributions
quarantine all pending -> persist accepted queue + receipt -> commit
```
Expose preview token for approved selections; stale destination/file state rejects and regenerates preview. Commit performs zero remote calls and no armed outbound intent. Add rollback fault test and imported sync-policy seed test.
- [ ] Build reviewable import dialog with counts/order/totals/conflicts/provenance and clear blocked commit reason for unresolved selections; no automatic scan of live app data. Read-only preview can run on supplied frozen fixtures. Run import/backup/provider tests and builds; commit as `feat: preview and deduplicate Focus Queue imports`.

### Task 11: Add optional time delivery and pending reconciliation

**Files:** Create `integrations/todoist/focus_delivery.rs`, `nimble-core/tests/focus_delivery.rs`, `components/focus/FocusDeliveryReview.tsx`; modify `integrations/todoist/{mod,sync_loop,client,outbox}.rs` and focus completion transaction.

**Interfaces:** `delivery_for_completion(occurrence_id:&str, recorded_ms:u64, budget_ms:Option<u64>, external_id:Option<&str>, enabled:bool)->Option<FocusDeliveryIntent>`; `FocusDeliveryIntent` carries stable operation ID, occurrence/external ID, exact new recorded ms, rounded comment payload, state. `resolve_delivery(id, resolution: Acknowledged|AdoptVerifiedUndelivered|ArchiveWithReason, evidence:String)` is explicit and durable; no automatic replay of import evidence.

- [ ] Test threshold, imported-time exclusion and duplicate occurrence delivery:
```rust
#[test]
fn historical_or_unmapped_time_never_becomes_comment() {
 use nimble_core::integrations::todoist::focus_delivery::delivery_for_completion;
 assert!(delivery_for_completion("occ",59_999,None,Some("remote"),true).is_none());
 assert!(delivery_for_completion("occ",60_000,None,None,true).is_none());
 assert!(delivery_for_completion("occ",60_000,None,Some("remote"),false).is_none());
 assert!(delivery_for_completion("occ",60_000,None,Some("remote"),true).is_some());
}
```
- [ ] Run `cargo test -p nimble-core --offline --test focus_delivery`; observe missing behavior. Before selecting transport, verify then-current official Todoist API with sources and record guarantees in verification docs. Do not copy legacy retry assumptions or create a second poller.
- [ ] Persist one optional comment intent per occurrence/new measured contribution within completion transaction. Bridge defaults off. Dispatch through existing sync service after commit. Nonrecurring close keeps its existing intent; recurring native completion keeps its single due update (Task 2), never an additional close. Show separate acknowledgements. Native counts/time stay committed if network fails.
- [ ] Implement explicit states pending/sending/acknowledged/uncertain/retryable-error/needs-review/archived. Honor Retry-After and bounded backoff; auth pauses; gone/ambiguous requires review; no expiry deletion. If provider lacks a proven idempotency guarantee, a possible-success timeout becomes uncertain and is not automatically retried. Existing reset_stuck_sending must not turn uncertain comments into duplicate sends.
- [ ] Reconciliation UI shows evidence/task occurrence, especially legacy recurring close. Adopt only verified undelivered intent after separate approval; otherwise acknowledge evidence or archive reason. No live sends during tests. Verify mock HTTP timeout after server accept, restart, auth, 429, gone, repeated command and mixed close/comment outcomes. Commit as `feat: reconcile optional focus time delivery safely`.

### Task 12: Verify integrated parity and prepare live acceptance

**Files:** Create `docs/focus-queue-verification.md`, sanitized native test-profile/fixture support under `tools/` only as needed; update `NEXT.md`, spec/plan progress and focused regression tests for discovered defects. No production update helper invocation.

**Interfaces:** Final evidence maps every F01–F26 to automated/native/manual-live status, with commands, results and build identity. Import report contains only synthetic inputs unless Marco separately provides an approved final snapshot.

- [ ] Run complete appropriate suites after integration:
```bash
cargo test --workspace --offline
node --test apps/desktop/tests/*.test.mjs
npm run build --workspace @nimble/desktop
npm run build:web --workspace @nimble/desktop
```
Run targeted lint on changed frontend files. Use existing dependencies; if setup required, install locked project dependencies only in worktree and preserve lockfile. Bare `tsc --noEmit` is not a build check here.
- [ ] Build/run a distinctly named synthetic native app/profile with integrations/backups disabled, never `/Applications/Nimble.app`. Exercise two windows racing, close/reopen, sleep/wake, offline edits, exact multiple-round total, delete/Undo during B, completion errors, and source changes. Verify expected real native results; mark anything unavailable honestly.
- [ ] Render reference review states from spec §4 in both themes and supported accent themes: narrow expanded; long-title+subtask compact; scaled; picker; edit/menu/Undo; history; source/still-open; empty/loading/offline. Preserve card/timer/Up-next hierarchy. Keep visual artifacts in `~/Developer/second-brain/outputs/2026/` with INDEX entry after reading its guidance, not repository screenshot clutter or `/tmp` deliverables.
- [ ] Perform isolated backup/import round-trip and repeat import, verify exact millisecond totals/order/local-only/zero remote writes; test rollback procedure on synthetic profiles. Record no invented session spans and no unresolved silent data loss.
- [ ] Run a fresh whole-branch code/spec review with the exact branch diff and task evidence. Fix blocking findings within scope, rerun affected tests and one scoped re-review. Update NEXT: implementation/test status separate from source installed, live import, pending-operation decisions, roughly 14 daily-use days, and app retirement/Todoist C1–C5. Commit `docs: record Focus Queue integration verification and remaining live gates`.

## Coverage and completion contract

| Spec area | Tasks / acceptance IDs |
|---|---|
| Queue sources, order, task operations | 2, 3, 6–8 / F01–04, F11–12, F19 |
| Exact timing, optional Pomodoro, recovery | 1, 3, 6, 9 / F05–08, F16–18 |
| Familiar UI, history, assistant context | 6–9 / F09, F13–14, F26 |
| Ownership/provider/web/replication/restore | 3–5, 9 / F10, F17, F23–24 |
| Migration/delivery/trial/rollback | 10–12 / F15, F20–22, F25 |

Self-review before execution: check all spec sections against this table; check names/types and cross-task signatures; check required files exist or are marked new; scan placeholders; ensure every Review Focus item has its owning test. Read implementation observations as evidence, never as permission to erase approved behavior. Live trial/retirement cannot finish in a code session; all implementable code, synthetic verification and a concrete live-readiness handoff can.

Plan self-review completed before execution: 26 acceptance IDs covered, all 12 task interfaces/dependencies checked, no unresolved placeholders, and existing frontend runner/source entry points verified. Native recurrence delivery preserves existing due-update semantics; external_id absence is not local-only intent.
