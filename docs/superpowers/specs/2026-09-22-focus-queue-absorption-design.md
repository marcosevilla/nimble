# Focus Queue absorption into Nimble

Date: 2026-09-22

Status: architecture approved in voice; written specification awaiting Marco's review.

Scope: design only. No implementation, installation, live import, external mutation, routing change or retirement is authorized by this document.

## 1. Goal and approval boundary

Nimble will absorb every shipped Focus Queue capability so Marco can eventually retire the standalone app. Native Nimble tasks remain authoritative. Focus Queue is the interaction, layout and information-hierarchy reference; merge its familiar tracking experience into Nimble’s current design system. Adapt or replace parts of Nimble’s existing focus presentation as needed to preserve that experience. One deliberately ordered persistent queue and durable timing service underpin the main and always-on-top windows, task operations, history and assistant context. Count-up/timeboxes are the primary workflow; Nimble's optional Pomodoro remains.

Marco approved this architectural direction in originating task `01a0cae1-62b5-7f70-b721-58569d425cf4`. Approval permits this written spec, not implementation. The defaults in §2 are **proposed for written review**, not decisions previously approved. After written-spec approval, a separate implementation plan and execution selection are required. The phases in §12 define boundaries and acceptance, not executable work instructions.

Retiring Focus Queue and replacing the Todoist service are separate decisions. C1–C5 and the live reminder, assistant-routing and web acceptance gates in [NEXT](../../../NEXT.md) remain in force. Instinct continues to own its existing live productivity writes. This feature must not activate or rewrite its workflows.

Out of scope: Stage C facelift, native mobile revival, headless assistant runs, menu-bar timer, digest, checkpoints, break nudges and attention sensing. “Focused time” means recorded active timer time.

## 2. Proposed defaults needing written review

| Decision | Proposed default | Consequence / alternative |
|---|---|---|
| Source views and queue | One shared durable queue; Today, project and local-only are candidate views. Explicit “Queue these” seeds/appends; refresh never silently re-sorts or replaces the queue. | Keeps all source workflows and deliberate order. Changes the old app's automatic membership refresh; new candidates remain visible for explicit addition. Separate saved source queues are not proposed. |
| Sleep, wake and crash | Pause on system sleep; wake/relaunch stays paused. Persist every 20 seconds while running and at every transition. A heartbeat gap over 40 seconds is an interruption and recovers at the last durable checkpoint. | Does not count sleep/app downtime. A stalled process can undercount; show recovery reason. Never infer hours of work. |
| Desktop and web | One designated Mac owns queue writes and live timing initially. Web displays last synchronized queue/settled history, with timestamp and unavailable controls; no ticking or remote Start. | No implicit device takeover. Multi-Mac/phone timing needs a later ownership-handoff design. Existing web task CRUD stays supported. |
| Todoist time comments | Implement an optional temporary bridge, off until separately activated for the trial. Only mapped Todoist tasks, only newly completed occurrences with at least 60 seconds recorded, and only verified safe delivery. | Local timing/history always works. Preview totals round to minutes using legacy formatting; no historical comments replayed. Native/local-only tasks never generate Todoist writes. |

All remaining rules below are the concrete proposed design implementing the approved architecture. No open-ended “decide during implementation” behavior is intended. Rejecting a default means revising this spec before planning.

## 3. Verified source baseline and corrections

At drafting, Nimble `main` is `0150df9` and Focus Queue is `aa04bc7`; both checkouts were clean. The audit recorded Nimble 65 commits ahead of locally recorded origin, without fetching. Stage B is merged; Stage C is paused. Source state does not prove installation or deployment. Current installation/acceptance evidence is in [C2/C3 verification](../../c2-c3-verification.md).

The [August integration plan](../../focus-queue-integration-plan.md) is historical and superseded by this spec. In particular:

- Native tasks live in `local_tasks`, not `tasks`. There is **no existing `focus_sessions` table**. `nimble-core/src/db/focus.rs` only records a daily marker and activity events. Old activity metadata is not an authoritative time ledger.
- `duration_minutes` is scheduling/Google event duration, including clearing semantics when due time is cleared. It must not become a focus budget.
- `focusStore.ts` owns transient timing, swallows mutation errors, loses prior Pomodoro round time and can erase the queue. These are regressions to fix, not compatibility requirements.
- `packages/types/src/data-provider.ts` owns the provider contract; web focus methods in `turso-provider.ts` currently reject as unsupported. Existing notifications invalidate some views but do not serialize focus operations.
- Frontend tests and installed `dt` already exist. Focus Queue has 115 test declarations, but its audit test run could not execute because Vitest was missing. No Focus Queue tests or installed/source parity are claimed verified here.

Source map: `apps/desktop/src/stores/focusStore.ts`, `apps/desktop/src/components/focus/`, `apps/desktop/src/lib/dataChanges.ts`, `apps/desktop/src/services/{tauri,tauri-provider,turso-provider}.ts`; `nimble-core/src/db/{focus,tasks,migrations,sync,export_policy,export,recovery}.rs`; `nimble-core/src/integrations/todoist/`; `nimble-core/src/agent_protocol.rs`. Focus Queue evidence is in `/Users/marcosevilla/Developer/todoist-focus/src/{types.ts,store,logic,components,window,sync}` and its `docs/superpowers/specs/`.

The fresh audit is `/Users/marcosevilla/Obsidian/marcowits/resources/research/2026-09-22-nimble-focus-merge-review.md`. Saved-state counts cited in §10 come from that audit, not a new live snapshot.

## 4. Product behavior

### Queue and sources

The ambient queue tray remains accessible without starting focus. Reusing existing Nimble focus components is an implementation convenience, not a requirement to keep their current hierarchy or layout. Expanded FocusView, compact FocusBanner and detachable companion render the same selected task, order and state. Banner and companion can coexist. A source selector changes candidates, not the running task or queue. The running/paused card remains visible across source navigation, fixing hidden-running-timer behavior.

Today shows tasks due today in the app's local timezone; earlier open tasks stay in a collapsed “Still open” drawer until explicitly added. Project view includes its open tasks, including undated work, in project order. Local-only view contains native tasks with no external binding, including imported manual work. “Queue these” uses candidate order once, omits already queued occurrences, folds a child under its queued parent by default, and appends new entries. Explicitly queueing a child independently is allowed. No date, source switch, calendar edit, polling response or AI suggestion reorders user work.

Drag handles, keyboard reorder, move-to-top/bottom and promote all persist immediately through one revisioned operation. Promoting another task settles/pauses the active one, places the chosen task first and selects it paused. “Focus now” is an explicit Start action that performs that transition and starts the chosen task. Reordering below the active first entry does not pause it; changing the first entry does. Suggestions may appear outside the queue but cannot override its next entry.

Stop banks time, leaves the current task first and retains the queue. Skip banks time, moves the current task to the bottom and selects the new first entry paused (one item remains selected paused). Remove unqueues without deleting the task or its time. Complete may target an upcoming task without interrupting another task unless the completion also affects it through the task hierarchy. After completing the selected task the next entry is selected **paused**; it requires a distinct Start. Completing an unrelated upcoming task preserves the active task and its timer. Dismissing celebration or pressing a generic Enter must not start it.

Queue and per-occurrence totals survive midnight. Daily counts change date without deleting unfinished work. The original app's destructive daily remote-source reset becomes a candidate-view refresh; this deliberate compatibility change preserves more state and appears in import preview. Historical local lists never roll over.

### Timing and appearance

Count-up is the default for tasks without an explicitly chosen budget. Preserve 15/25/45/60-minute timeboxes, a positive custom-minute input and clear-to-count-up without losing elapsed time. Proposed validation is whole minutes 1–1,440. A one-time explicit “Use scheduling duration as budget” copy is allowed; later schedule changes never alter the budget and changing focus budget never edits the calendar. Budgets apply to accumulated work on the occurrence, including prior paused work and an imported known total. Lifetime time is a separate label.

Count-up becomes amber at 25 minutes and deep amber at 45, never red. Timebox zero chimes once, then continues counting overtime; red is reserved for that overtime. Changing a budget below elapsed shows overtime immediately without a retroactive chime. Sound uses Nimble's own completion/chime assets, with a mute preference, not the copied Todoist sound. A sound failure never affects accounting.

Pomodoro explicitly uses work-round length, break length and round count, separate from occurrence budget. On work-round zero, settle work at the boundary, signal once and enter `round_ready`; Start break is explicit. Break completion enters `work_ready`; Start next round is explicit. Work accumulation survives every break/round and excludes break time. Completing the configured rounds leaves the task paused, not completed. Switching modes first settles/pauses, preserves total work, and starts a fresh display round only on Start. This avoids the old round-reset accounting loss.

### Tasks, history and assistant context

Reuse native task create/edit, due/priority/project metadata, descriptions and parent/child UI. Queue quick-add in Today sets Inbox + due today; project quick-add uses that project; local-only quick-add stays unbound. Multi-line/batch entry creates tasks in input order. Capture the chosen source with the request: changing source during an in-flight create cannot move its result to a different project. Empty titles are rejected; failed creates preserve typed text with an error, and successful rapid entry keeps keyboard focus ready for the next task. Preserve due-time and priority cues without importing Todoist color literals.

Local-only tasks support inline rename, duplicate, delete with Undo, manual ordering and completed history. Duplicate copies editable task content but receives fresh identity, no external binding, no time/completions and no running state. Deletion settles time before removing the task, retains a history snapshot, and returns a durable undo token valid for 10 seconds. Undo restores task/order and paused timing, never an old running timestamp; it cannot steal another active timer. Restore near surviving original neighbors, but behind the currently active first entry if restoring the old position would displace it; retain current active selection. If no timer is active, restore the original bounded position and select the resulting first entry paused. This requires narrowly scoped transaction-aware task deletion/restore support, not a general soft-delete redesign of all domains. Externally mapped deletion follows existing native confirmation/outbox semantics, not the local-only shortcut.

Subtasks refresh from native task storage and existing sync, including undated children; direct completion updates all windows. Parent completion follows native cascade/recurrence policy while settling any affected running descendant. Completion history displays title snapshot, total measured time and completion timestamp where known. Completed tray can collapse and clear; clear hides/archives those entries from this tray and does not erase the task ledger. Do not introduce completion restore as an old-app requirement: only deletion Undo shipped.

Copy assistant context includes native ID, external ID if present, project, due/priority, description, subtasks, timer state, accumulated work and budget. It describes supported routes truthfully and never claims comments will refresh unless implemented. Existing Nimble agent tools remain available subject to C3 activation; no changes to task-assist/Instinct routing are implicit. Clipboard failure is visible and preserves the text for manual copy.

### Focus Queue UI → Nimble design-system mapping

This is an explicit user requirement added during drafting: preserve as much of Focus Queue's layout, controls and information hierarchy as practical, merged into Nimble's new design system. The familiar focused-task card and upcoming list are the reference for the embedded surface **and** the companion. Do not default to current Nimble's fullscreen/timer-first presentation merely because those components already exist. Reuse their capabilities and styles where they serve this hierarchy; there is still only one underlying session engine.

| Shipped source UI | Nimble destination and required interaction |
|---|---|
| Big focused-task card: completion circle left; multiline title; assistant/menu/collapse controls; small project/source and due-time below | Primary card in tray/expanded focus/companion. Keep task identity above the timer, multiline readability and immediately reachable completion. Native detail opens from a secondary affordance; do not replace the card with a detail form. |
| Open subtasks inline beneath metadata | Keep visible and directly completable in expanded and card-only companion modes. Shared native data supplies refreshed children. |
| Prominent tabular timer bottom-left, circular Start/Pause bottom-right; clicking timer opens timebox picker | Preserve placement and direct manipulation. Presets/custom/count-up and budget caption stay close to the timer. Pomodoro is an optional mode control, not the default hierarchy. |
| “Up next” compact rows: completion/priority cue, single-line title, assistant/menu/due-time; grip in gutter | Shared ordered queue immediately below card. Click row promotes and pauses; checking, editing, menu and handle-drag do not accidentally promote. Keyboard equivalent and focus retention required. |
| Inline Add, then completed tray with struck-through title + spent time and Show/Hide/Clear | Same sequence and density. Rapid Add stays focused. Completed time remains visible without opening history. Clear archives tray visibility instead of deleting durable evidence. |
| Collapsed still-open drawer and bottom-anchored source selector, completion count and sync indicator | Same secondary hierarchy; scrolling queue does not hide footer. Source selector is labeled as candidate selection under the shared-queue proposal, and its “Queue these” action makes additions explicit. Never implies choosing a source replaces the active queue. |
| Chevron collapses to whole card, with metadata, subtasks, timer and persistent Show queue control | Companion card-only mode hides/unmounts queue/Add/tray/drawer/footer, including their tab stops. Empty card retains Show queue. Toggling presentation never starts, pauses or resets timing while a focus surface remains visible. |
| Completion animation/sound and next card ready | Use Nimble feedback style, preserve immediate acknowledgement after commit. Next card remains paused; completion feedback cannot obscure pending delivery failures. |

Nimble translation: use current semantic color tokens, type scale, icons, components, spacing, focus rings and reduced-motion behavior. Preserve density and hierarchy rather than hard-copying old CSS. Source baselines are a 15px multiline title, 34px tabular timer and 44px Start/Pause target; choose closest current Nimble tokens while maintaining readable task text, dominant timer and accessible controls. Avoid copying Todoist asset/color literals; priority and overtime semantics remain distinguishable. Existing compact in-app banner may use a single-row adaptation because of shell space, but the embedded expanded card and companion must retain the familiar hierarchy.

Companion baseline: 340 logical pixels wide expanded, 560 default logical height, resizable height 420–640; queue scrolls and footer stays anchored. Compact card scales proportionally from 340 to min(1020, monitor work-area width), or 1–3× where the screen permits. Refit height to actual title/subtasks plus native titlebar; clamp to work area with usable overflow rather than clipping on small displays. Remember compact width and expanded height separately and clamp restored geometry after monitor changes. Preserve approximately 220ms expand/collapse intent using Nimble motion tokens; reduced motion is immediate. Native acceptance covers shadow bleed, capability permissions, activation, scaling, popovers and the titlebar offset. Do not assume copying old window math unchanged is correct for the chosen Nimble shell decoration.

Visual acceptance is a side-by-side comparison with the matching Focus Queue source/build reference, recording installed-version uncertainty until verified. Review narrow expanded queue; long-title/subtask compact card; scaled compact card; timebox picker; local edit/menu/Undo; completed tray; still-open/source picker; empty/loading/offline states in light/dark and all supported Nimble accent themes. Verify keyboard/tab order, screen-reader labels, pointer target separation, window resizing and remembered geometry in real macOS, not only browser mocks. Record a reason for every hierarchy/interaction deviation; approval of the architecture does not silently approve a new visual direction.

### Deliberate deviations for review

| Deviation from Focus Queue | Reason / preserved outcome |
|---|---|
| Source choice browses candidates; explicit additions instead of source replacement/live automatic membership | One stable shared queue avoids losing chosen order or hiding work. Today/project/manual selection and quick-add defaults remain. This is the most visible proposed interaction change. |
| Queue and time survive midnight; external removal banks time; Clear archives history | Durable history supersedes legacy data loss. Daily count still rolls by date. |
| Budget does not auto-follow scheduling duration | Focus intent and Calendar event length differ; explicit one-time copy remains available. |
| Native quick-add can work offline; manual assistant context is now available | Native task authority removes old Todoist-only limitations. No automatic assistant routing change. |
| Closing last visible focus surface pauses; sleep/restart pauses; completing a Pomodoro round waits for explicit next action | Avoid hidden/overnight accounting and preserve voluntary Start. Compact/expanded toggles alone are purely visual. |
| Nimble tokens/sound/motion; compact in-app banner may differ spatially | Integrate with Nimble while preserving the primary card/queue experience and accessible controls. |
| Roadmap viewer is not copied | It describes standalone-app future features, not a tracking workflow; those future features remain out of parity scope. |

Source UI evidence: Focus Queue `src/App.tsx`, `src/components/{FocusCard,TimerDisplay,TimeboxPicker,Queue,QuickAdd,CompletedTray,OverdueDrawer,SourcePicker,FocusToggle,Collapsible,EditableTitle}.tsx`, `src/index.css`, `src/logic/focusView.ts` and `src/window/{constraints,focusViewController,useFocusScale}.ts`. This mapping was checked against source, not a launched app or screenshots during this documentation stage.

## 5. Domain model and invariants

These are proposed schema entities, not tables claimed to exist. Use the next free migration version at implementation time; do not reserve v21 against concurrent work. Durations are nonnegative integer milliseconds throughout storage and API; UTC timestamps record events, with timezone captured for daily grouping. Display rounding never changes stored totals.

| Entity | Required fields and rules |
|---|---|
| `focus_queue_state` | One aggregate row: queue ID, writer device ID, owner epoch, revision, ordered entry JSON, selected occurrence ID, updated timestamp. Each entry has stable entry ID, native task ID, occurrence ID, added timestamp, source provenance, explicit-still-open flag, mode and budget. Unique occurrence membership. Full list replacement in one transaction avoids per-row position LWW. |
| `focus_occurrences` | Stable occurrence ID, task ID (nullable on deletion), original task ID, title/project snapshot, scheduling identity at creation, generation, state open/completed/removed, completion timestamp and reason. Ordinary due-date edits preserve occurrence identity; completion/reopen or recurrence advancement creates a new generation. |
| `focus_sessions` | Session UUID, occurrence ID, owner device/epoch, status, mode/config snapshot, accumulated work ms, break ms separately, round index and round work ms, start/checkpoint/end timestamps, session revision and end reason. At most one live slot globally on the owning Mac. Paused sessions for other occurrences are permitted; only the selected one can resume. |
| `focus_segments` | Segment UUID, session ID, kind work/break, start and last-checkpoint timestamps, measured duration ms, closed timestamp/reason. One open segment for the live slot. Segments audit the session accumulator; totals sum sessions, **not sessions plus segments**. Imported aggregates have no fake segment rows. |
| `focus_runtime` | Device-local singleton live-session pointer, stable owner epoch, process generation, engine revision, heartbeat sequence, last durable checkpoint, sound/boundary tokens. Monotonic clock anchor lives in process only. Never grants ownership via remote LWW. |
| `focus_import_totals` | Deterministic source-record key, occurrence ID or unresolved reference, exact known ms, optional actual completion timestamp, source kind, import batch ID, inclusion classification. Imported contribution counted once alongside new sessions; a timer/completion pair for the same old work is never summed twice. |
| `focus_command_receipts` | Command UUID, request hash, outcome/result revision and affected IDs. Committed atomically with mutations. Same UUID + same body returns prior result; same UUID + different body rejects. Keep receipts for retained history/import operations; no expiry that permits replaying completion. |
| `focus_import_batches` and `focus_import_records` | Source installation namespace, schema version, file hashes, preview hash, deterministic mappings, record fingerprints, unresolved/quarantined records and reconciliation decisions. Raw credential files excluded. |
| `focus_delivery` | One durable external operation per occurrence/purpose: operation UUID, native/external IDs, payload, idempotency key if supported, lifecycle, attempts, next attempt, last error and remote receipt. Extends/cooperates with existing Todoist outbox; never a second independent poller. |
| `focus_undo` | Local-only task deletion snapshot, affected queue entry/relative neighbors, occurrence references, issued/expiry times and consumed flag. Restore cannot reset ledger time or resume a timer. |

Invariants enforced by transactions and constraints: one running work/break segment; selected entry agrees with live occurrence; completed occurrence cannot be queued or started; no negative/double-counted durations; every accepted mutation has a receipt; completed task/history/queue changes settle together; nothing starts from a refresh, recovery, restore or completion. Task deletion must not cascade away historical time.

`total_work_ms(occurrence) = SUM(session.accumulated_work_ms) + SUM(included import totals)`. A checkpoint folds only the delta since the prior checkpoint into both session total and segment audit duration, then advances the anchor. Reads may display uncommitted elapsed interpolation, explicitly bounded by the current snapshot; persistence and commands always use engine time. Imported open work contributes to the occurrence budget; a new session starts at zero additional time. Task lifetime total sums its occurrences, even if no longer queued.

Native recurrence currently reschedules the same task row to `todo`. Queue/session identity therefore cannot be task ID alone. Completion names an expected occurrence generation and expected task version/due identity. A completion receipt freezes the old generation; the rescheduled row gets a new generation and is not silently requeued. Duplicate/delayed commands for the old generation return the old receipt or stale-occurrence error. A remote due change alone is treated as an edit; only a verified completion/recurrence event advances generation. Ambiguous remote changes pause the affected session and require reconciliation rather than inventing a completion.

## 6. Authority, commands and failure semantics

The long-lived Rust app service serializes focus commands, checkpoints and incoming task-change reconciliation. React/Zustand is a render/cache layer. Both windows and future explicitly enabled agent commands use the same service. A process/profile lock and database live-slot constraint prevent a second process from becoming a timer writer. Live ownership is the configured desktop device, not whichever window was most recently focused. The stable ownership epoch changes only on explicit takeover/recovery activation; process generation increments on service restart and invalidates stale runtime anchors without changing replica ownership. Commands for new execution include both owner epoch and process generation.

Proposed shared DataProvider contract (names illustrative; semantics required):

| Operation | Request / result |
|---|---|
| `focus.capabilities()` | Queue read/write, history read, live timing, pop-out and import support flags; ownership identity and reason for unavailable controls. |
| `focus.snapshot()` | Consistent queue, selected occurrence, active/paused session, totals, engine/queue revisions, sampled UTC time, durable checkpoint and recovery reason. Web returns settled replica with `asOf`, never a live authority claim. |
| `focus.execute(command)` | Envelope `{commandId, expectedEngineRevision, expectedQueueRevision?, sessionId?, occurrenceId?, ownerEpoch, processGeneration, payload}`. Returns committed snapshot/result or typed error. Client generates ID once and reuses it after an uncertain response. |
| `focus.history(filter, cursor)` | Paginated occurrences, totals, completion timestamps, imported/recorded provenance, archived-tray flag and task snapshots. |
| `focus.previewImport(files)` / `focus.commitImport(previewToken, commandId)` | Desktop-only validated preview and atomic import against unchanged file hashes and task/queue revisions; import commits no external replay. |
| `focus.openCompanion()` | Desktop-only window lifecycle; no new session or clock. |

Commands include enqueue/seed, reorder, promote, remove, select-and-start, pause, resume, stop, skip, set-budget, set-mode, start/end-break, complete-occurrence, archive-history, undo-delete and import-commit. Composite quick-add-and-queue and local-delete-and-settle use native CRUD internals within the same transaction. Native task edits/completions/deletes from other UI/agent/sync paths join this consistency boundary when they affect a focused occurrence. Components cannot call status mutation separately and pretend focus completion succeeded.

The current pool-based task APIs and best-effort observers are not sufficient to promise atomic composition. Introduce internal transaction-aware task operations shared by existing public CRUD and focus commands. Task row changes, recurrence/cascade effects, queue revision, ledger settlement, command receipt and required external-delivery intent commit together. Sync publication intent for focus is durable in that transaction; activity logging stays best-effort and is never the ledger. Do not bypass task observers with command-layer raw SQL.

For an authenticated local request, look up the command receipt and compare its request hash **before** checking stale revisions or owner/process generation: a previously committed identical command returns its stored result even after a restart or later mutation, plus a fresh snapshot marked separately. A mismatching hash rejects reuse. Only unseen commands proceed to new-execution validation.

Validation happens before mutation. Stale revision, stale occurrence, wrong owner, missing/deleted task, invalid order/budget, unsupported provider and storage failure are distinct errors. Reorder requires the complete current entry set, no duplicates; concurrent additions cause a conflict and fresh snapshot, not loss. A stale UI may refresh then ask the user to repeat the action. It never silently retries a different intent under a new ID.

After commit, broadcast one invalidation with domains, queue/engine revisions and affected IDs, no task bodies. Both windows subscribe before initial read; if an event races that read, read again. Older snapshots are ignored. Reconnect, focus/visibility change and detected revision gaps fetch a full snapshot. A lost event cannot lose data. No frontend success/celebration, queue removal or sound occurs before a committed result. After timeout, query/retry the same command ID; do not fire a parallel fallback task write.

Closing the companion only closes a view. Closing main while companion remains also leaves the owner service running. Closing the last visible focus surface pauses work so there is no hidden timer; explicit app Quit settles and checkpoints before exit. A forced exit follows crash recovery. Window controls need native lifecycle tests; UI unmount alone is not authority.

## 7. State transitions and clocks

| From / event | Durable effect | Visible result |
|---|---|---|
| Selected idle / Start | Validate occurrence, create session/open work segment and claim live slot; set native status in_progress through CRUD. | Running current task. |
| Work running / Pause | Fold elapsed once; close work segment, clear live slot. | Paused with exact preserved total. |
| Paused / Resume | Revalidate task/owner, open fresh segment in same resumable session and saved phase (work or break). | Continues work total or remaining break, never resets to zero. |
| Running A / explicit Start B | Settle/pause A; reorder/select B; start/resume B atomically. | One running task; A remains in queue with banked time. |
| Running / timebox zero | Durable boundary token, no task completion and no work stop. | One chime; overtime continues. |
| Pomodoro work / round boundary | Credit only through round target, close work segment, enter round_ready. | Explicit Start break or finish controls. |
| Break / Pause | Settle break segment, preserve break phase and remaining duration. | Paused break; Resume continues that break. |
| Break / boundary or explicit End break | Close break segment; enter work_ready for next round. | Work total unchanged; Start next round required. |
| Any open session / Stop or Skip | Settle active segment, end session with reason; Stop retains selection, Skip moves entry bottom. | Paused task/next entry, queue preserved. |
| Complete current/upcoming | Settle any affected live segment; native completion/recurrence + history + queue removal + delivery intent + receipt commit together. | If active/selected occurrence is removed, next entry ready and Start required; otherwise unrelated running task remains unchanged. |
| Native/remote delete or completion | Serialize reconciliation, settle affected work; retain history snapshots, remove ineligible occurrence; no duplicate close/comment echo. | Paused next entry plus reason. |
| System sleep / suspension gap | On timely sleep notice, settle at notice; otherwise use last durable checkpoint. Pause work or break. | Wake requires Resume; recovery explanation. |
| Relaunch / persisted running marker | Keep only checkpointed time, close segment with recovered reason, clear live slot, increment process generation (not ownership epoch). | Paused recovery across any date. |

Use monotonic deltas for in-process work, wall time for timestamps/day grouping. Heartbeat every 20 seconds and every mutation flush a checkpoint transaction. A delayed tick over 40 seconds does not retroactively count the gap. Clock jumps, DST and timezone changes must not create negative durations or rewrite prior completion dates. A Pomodoro checkpoint crossing its target caps work at that target; remaining delay is not break/work credit. Count-up/timebox checkpoints accrue only eligible active deltas.

If storage fails, the engine freezes at the last durable checkpoint, reports recovery required and stops accepting Start/Resume until persistence works. It must not display an unpersisted “saved” total. A chime token is claimed durably before the native sound request; failure or crash may omit a sound, but cannot duplicate time. The Rust owner emits sound once, not both webviews independently.

## 8. Replication, exports and recovery

First release uses one explicit writer device for focus data. The queue replicates as an indivisible aggregate `(owner_epoch, revision, ordered entries)`; apply only a higher revision from the recognized writer in that epoch. Do not use ordinary per-row LWW for entry positions or allow stale remote focus state to overwrite the authority. History uses stable session/occurrence IDs and monotonic writer revisions. Only settled/paused checkpoints are replicated, never a usable running marker or a lease.

Remote schema setup/upgrades, allowed-table validation, serialization, seed behavior and pull application all need explicit new-entity handling in `db/sync.rs`. Queue replicas whose referenced task rows have not arrived show “task unavailable; sync pending” and remain non-actionable; do not discard the references. No remote write-back of a replica is allowed. Web may still mutate native tasks through its existing path; those mutations reconcile on the desktop before another focus command succeeds. While desktop is offline, remotely completed work can continue locally until received; on receipt, settle at observed local time, label the conflict and never fabricate remote timing precision.

A second Mac/restored profile starts with focus writes disabled, even offline. Taking over is a separately confirmed stopped-owner recovery procedure, requiring old owner shutdown and a new epoch. There is no automatic lease expiry/takeover. This avoids two legitimate offline writers. Dormant mobile receives no UI work; keep schema compatibility per repository guidance without reactivating its stale provider.

| Data | Local snapshot | Portable export / isolated restore | Remote replica |
|---|---|---|---|
| Queue, occurrences, sessions, segment audit, included totals, history visibility | Included | Included with format version; restore paused | Queue and settled ledger only |
| Receipts, import mappings/reconciliation evidence | Included | Included; retain duplicate protection | Import provenance needed for history; not live command authority |
| Runtime ownership, sound tokens, window preferences, undo tokens | Included | Ownership/undo disabled; normalize all running state paused; safe preferences optional | Excluded |
| Pending delivery intent | Included | Quarantined intent/evidence; never an armed replay | Excluded; only owning Mac sends |
| Credentials/raw config | Existing private snapshot policy only | Excluded | Excluded |

Update the enumerated `db/export_policy.rs` and export/recovery schemas rather than relying on table discovery. Freeze older archive fixtures, migrate them in an isolated directory and prove old C1 restores still work. Restore derives totals from canonical contributions, validates referential integrity and uniqueness, and never reconnects integrations or replaces live data. Restored profiles cannot resume timers/send mutations without a separate activation. Retain unresolvable task references and title snapshots for history.

Existing `daily_state.focus_*` markers cease to be authority. Clear/retire them during migration; if one claims active work, preserve an informational recovery note with unknown elapsed rather than inventing time. Existing activity durations remain legacy activity entries; do not auto-add them to the new ledger, which could double-count known defects. No schema downgrade over a used new database is supported: rollback uses an isolated pre-change backup and a reviewed delta, not an old binary opening the new database.

## 9. Offline work and temporary external compatibility

Native CRUD and queue/timing work offline. Existing Todoist sync remains the task adapter; this feature adds no credentials, polling controller or independent source-of-truth store. Local completion is durable even when external delivery fails, with visible pending/error state. Pending close suppresses resurrection. Native local-only tasks are explicitly unbound; migration/create must not let an enabled global Todoist observer export them accidentally.

For mapped tasks, native task completion supplies its normal durable close intent. The optional time-comment bridge adds exactly one new-time summary per occurrence, with >=60,000ms recorded; round display as the old formatter does, retaining exact local ms. Include timebox context when set, exclude breaks and imported historical totals from a new delivery. Accumulate eligible new sessions over the occurrence; stopping/switching alone does not send comments. A completed occurrence with imported + new time retains the full local total, while its external comment describes only newly recorded time.

Use existing retry scheduling with bounded exponential backoff and Retry-After. Auth errors suspend delivery until reconnected; rate limits/transient failures retry; gone/ambiguous tasks become visible reconciliation cases. No retry expiry silently drops intent. Track pending, sending, acknowledged, uncertain, retryable-error and needs-review states, plus a deliberate archived/abandoned resolution with reason. Close and comment acknowledgements are separate; failure of one must not resend the other.

Transport timeout after possible delivery is **uncertain**, not evidence of failure. During implementation, verify the current official API's actual idempotency guarantees before selecting headers/keys. Reuse a supported operation key if guaranteed; otherwise reconcile remote task/comment evidence and stop automatic retries for uncertain comments. Never claim exactly-once remote delivery from a local receipt alone. Imported pending operations lack reliable keys: they enter quarantine, not the normal retry queue. No new bridge/live writes activate without separate approval and a verified fixture/test target.

## 10. Import preview, deduplication and rollback

No live snapshot or replay is performed for this design. The audit observed 41 manual task records, 12 manual ordered entries, 29 manual completions; separate Today state with 20 queue IDs and four timers, none running; and two pending mutations (close + comment). Delivery, expiration and source/installed parity are unverified. These are a preview baseline, not expected final counts.

### Inputs and exact semantics

| Input | Preserve / interpret |
|---|---|
| `manual.json` | `tasks`, authoritative `order`, `completed[{id,spentMs,completedAt}]`, `showCompleted`. Convert native records with deterministic IDs and unbound provenance; preserve completed records not in order. The source uses `manual:<uuid>` and `projectId: manual`; do not create a Todoist project/binding. |
| `state.json` | `dateStamp`, optional source, queueIds, pulledInOverdueIds, hasManuallyDragged, timers, completedToday, focusView, focusWidth, expandedHeight. Manual source's queueIds is a projection: manual.order wins. Today/project state is a separate ordered source snapshot. Preserve legacy daily count as a summary, not fabricated completion records. |
| Timer record | taskId, elapsedMs, startedAt, lastTickAt, timeboxMs. Recover to paused at `elapsedMs + max(0,lastTickAt-startedAt)` only when both running anchors exist; missing heartbeat adds zero. Validate timestamps/duration and quarantine impossible/corrupt values. No session spans can be reconstructed. |
| `pending.json` | kind close/comment, taskId, optional content, createdAt, attempts, nextAttemptAt. Preserve unchanged as quarantined evidence, including apparently expired entries. These are delivery intents, not additional time records. |
| `config.json` | Explicitly excluded: credentials are neither imported nor printed/exported. New integration reuses Nimble's own configured adapter. |

### Preview and commit

1. Before the final snapshot, explicitly pause and quit Focus Queue, then re-read the files after shutdown; persistence can overwrite a live edit. Stop both timer writers for cutover. Privately archive the three inputs with hashes, capture source app/build identity if available, and take a verified Nimble backup. Do not retire/delete the old app or change autostart yet.
2. Validate files as a set, showing missing/corrupt/unknown fields without treating them as empty data. Legacy writes are individually atomic but the three-file snapshot is not transactional: check order/task/completion/timer references across files and preserve any discrepancy for review. Build deterministic mappings in a persistent source-installation namespace. Todoist IDs map by `(external_source, external_id)` to existing `local_tasks`; duplicates require a selected match, never title matching. Manual IDs map deterministically into native IDs. Unmatched remote IDs remain unresolved references; preview can propose creating/importing real task records only from verified bodies, never invented titles/dates. state.json does not contain remote task bodies or a project dictionary; only a project source can supply its saved name. Nonmanual completion history is not reconstructable from completedToday or pending comments.
3. Preview tasks to create/reuse, exact field differences, both source orders, timer/completion totals and provenance, unavailable references and the two or current pending operations. Proposed merged order is existing Nimble queue first, then old active source order, then remaining manual order; deduplicate by occurrence while preserving relative order. Show this order explicitly for confirmation. Retain both original order snapshots even if not selected. Imported timers all remain paused.
4. For completed manual tasks, completion `spentMs` is authoritative for that recorded completion. A residual timer with the same ID is potential overlap: quarantine it unless evidence proves a separate later occurrence. Do not add both. Noncompleted timers contribute one imported aggregate; task-body records alone contribute zero. Preserve actual completion epochs; start/end timestamps remain absent. Record any conflict or rejected contribution in the manifest.
5. Commit only against the unchanged preview hash, file hashes and destination revisions. In one local transaction write tasks through migration-aware native CRUD, mappings, provenance, contributions and the accepted queue, plus an import receipt. Disable outbound task observers for historical import; import is not creation/completion to be echoed externally. Failure rolls back the batch. Restart can query the receipt. Re-importing identical files is a no-op; changed snapshots update only verified unmodified imported contributions or require explicit conflict resolution. Never reset post-import edits or add the same cumulative total twice.

Record keys are independent of batch/file hash: manual task ID, manual completion `(ID, completedAt)`, timer `(ID, source date/snapshot lineage)`, and pending intent fingerprint plus original index for identical duplicates. File hash identifies a revision of that source, not permission to import its cumulative time again. Timer lineage replacement and completed-record precedence must appear in preview; uncertain overlap remains preserved but excluded from totals.

### Pending external reconciliation

For each pending close/comment, record pending payload, remote verification time/evidence, intended task occurrence and chosen resolution. A verified delivered operation is marked acknowledged without replay. A definitely undelivered operation may be adopted into Nimble's existing delivery service only through a separately approved reconciliation step after the old app is stopped. A task now on a later recurrence cannot be closed using an old close intent. An uncertain comment stays needs-review; do not blindly resend text even if the old retry deadline expired. Import is allowed with quarantined items, but retirement acceptance is not.

### Reversible trial

After synthetic, native and import gates pass, run roughly 14 daily-use days in Nimble, one timer/writer at a time. Old Focus Queue remains closed and available. Verify order, timeboxes/count-up, Pomodoro, task editing, offline recovery, two-window agreement, histories, delivery status and a fresh recoverable backup. Extend the trial if normal workflows have not occurred; elapsed calendar days alone do not pass it.

Rollback first pauses/quits Nimble focus, saves its trial delta/export and reconciles every pending write. Do not simply reopen old Focus Queue with stale pending.json: it could resend actions. Prepare a reviewed reconciliation copy of the old files (preserving originals), map new native tasks/time totals only when representable, and archive any nonrepresentable history separately. Resume the old app only after ensuring one writer and no duplicate pending replay. No reverse conversion is claimed already implemented. A pre-import Nimble backup can recover into an isolated profile; never restore over trial task edits without comparing the delta.

Retirement is a later explicit action: remove Focus Queue launch shortcuts/automations and archive the app/data only after Marco accepts the trial, all pending operations are resolved and backup/rollback is verified. Uninstall/delete separately if requested. Todoist service and Instinct continue until their own C1–C5 cutover decision.

## 11. Capability acceptance matrix

All rows below are **required and not yet verified for the new design**. “Source” denotes shipped behavior, not proof of installed parity. Synthetic tests are necessary but do not replace native daily-use acceptance.

| ID | Capability / required acceptance | Verification |
|---|---|---|
| F01 | Today, project including undated work, local-only candidates; switch sources without hiding/changing active task | Source-specific fixtures + native flows |
| F02 | Persistent manual order; drag handle, keyboard reorder, top/bottom/promote; new seeds append; AI never overrides | Revision/concurrency tests + keyboard/native drag |
| F03 | Still-open drawer collapsed; explicit add only; parent/child dedup; empty/loading/error and retry states | Reconciliation/render tests |
| F04 | Quick-add source defaults; multi-line manual batch; change source mid-create; native offline create; clear errors | CRUD/outbox fixtures + native editing |
| F05 | Count-up Start/Pause/Resume; switch with banked time; only one timer | Fake-clock + simultaneous-window commands |
| F06 | Timeboxes 15/25/45/60/custom/clear; auto-arm chosen budget; changing budget retains time; calendar independent | Boundary/input + calendar-duration regression |
| F07 | Amber thresholds; red only overtime; one zero-crossing chime; continued overtime; mute and audio failure | Math tests + real WKWebView/native audio |
| F08 | Optional Pomodoro, multiple rounds, break exclusion, pause/restart, no automatic next work | Exact ledger arithmetic with fake clock |
| F09 | Main tray/expanded/banner plus always-on-top companion agree; collapse, scale, resize, geometry recovery | Native macOS, multiple displays, title-bar/shadow/permissions checks |
| F10 | Close either window, close last surface, quit/crash; no hidden running engine or second owner | Real app lifecycle + process lock tests |
| F11 | Inline local rename, duplicate, delete/Undo, batch input; Undo during another timer restores paused | Transaction/undo + native UI tests |
| F12 | Description/subtasks/priority/due/project; undated child refresh, direct upcoming/subtask complete | Native shared CRUD + integration fixtures |
| F13 | Completion sound/count, collapsed completed tray, exact totals and real timestamps, clear/archive | History/render + daily grouping tests |
| F14 | Copy assistant context/clipboard failures; accurate IDs, elapsed and routing; no false comment-refresh promise | Prompt fixtures + manual copy/approved assistant route |
| F15 | Offline completion/time-comment compatibility; retry status/auth/rate-limit; pending-close resurrection guard | Mock transport/outbox + separately approved live fixture |
| F16 | Crash/midnight/sleep/wake/DST/timezone/manual clock change; restart paused at heartbeat | Fake-clock and native suspend/relaunch |
| F17 | Rapid repeated Complete; two windows race Start/reorder/complete; uncertain response retry; failed disk commit | Deterministic concurrency/fault injection |
| F18 | Recurrence repeats twice, delayed old completion, external delete/complete, parent cascade | Occurrence fixtures + explicit native exit test |
| F19 | Stop/Skip/complete preserve remaining order; next task always requires Start; stale heuristic removed | UI/store regression tests |
| F20 | Import all three files, credentials excluded, missing/corrupt inputs, manual/remote references and totals overlap | Frozen sanitized fixtures + exact manifest comparison |
| F21 | Import twice/changed cumulative snapshot/crash commit; order and ms totals preserved; no outbound replay | DB transaction/dedup tests + zero-outbox assertions |
| F22 | Pending close/comment delivered/undelivered/uncertain/expired, including old recurrence | Reconciliation fixtures; no blind sends |
| F23 | Export and isolated restore including older C1 archives; owners disabled and intents quarantined | Schema/allowlist/round-trip equality + integrity checks |
| F24 | Whole-queue replica order; stale epoch/revision rejection; delayed tasks; truthful web read-only state | Sync/provider contract tests + signed-in web read check |
| F26 | Familiar focused-task-card/timer/Up-next/control hierarchy; compact full-card behavior; design-system translation and reviewed deviations | Side-by-side source/build reference and native visual/interaction review set in §4 |
| F25 | Source/build versus installed parity; roughly 14 days daily trial; rollback rehearsal before retirement | Recorded release identity + Marco acceptance + isolated recovery |

Existing defects deliberately not preserved: hidden timer on source switch; stale running timestamps after Undo; silent retry expiry; vanished cached remote bodies after offline cold start; heuristic next-task override; queue deletion on Stop; multi-round time loss; silent provider failures; misleading assistant refresh claims. Known metadata retained as provenance is not claimed complete history.

## 12. Bounded delivery phases and exit gates

| Phase | Deliverable boundary | Exit gate |
|---|---|---|
| A — durable foundation | Queue/occurrence/session ledger, serialized commands, transaction-aware CRUD, provider capabilities, schema/export/restore/sync policy | F05–08, F16–18, F21/23/24 domain tests; no source install/live writes |
| B — existing UI integration | Replace frontend authority; ambient queue, source candidates, native task operations/history/context, companion lifecycle and accessibility | F01–14/F19/F26 in synthetic and real native test profile; both windows consistent |
| C — migration and compatibility | Preview/import/reconciliation, optional Todoist time bridge using existing adapter, native source/build parity record | F15/F20–24 with sanitized fixtures; isolated restoration and rollback rehearsal; separate review before live activation |
| D — live acceptance | Approved final paused snapshot, reviewed import, single-writer daily trial | F25 plus no unresolved delivery/import discrepancies; Marco accepts parity |
| E — retirement decision | Separately approved reversible archive/launch cleanup | Verified backups and rollback; Todoist service decision remains separate |

Each phase can become its own bounded implementation plan after this spec is reviewed. No “quick UI port” bypasses foundation correctness. Verification should use the existing Rust and frontend runners, desktop and web builds, provider contract checks, then real macOS acceptance. Re-establish exact runnable test baselines before code changes; the audit's 97 Nimble frontend tests and 115 Focus declarations are historical counts, not tests run for this spec.

## 13. Self-review record

Documentation review completed: an independent read-only consistency review identified and this revision resolved receipt lookup ordering, stable ownership versus process generation, paused-break resume, unrelated upcoming completion, and Undo placement behind an active task. Checks include source/table/provider paths; current acceptance boundaries; every shipped capability mapped; explicit defaults separated from voice approval; exact time accounting and occurrence identity; serialized cross-window ownership; queue revision conflicts; import overlap/dedup and pending-operation quarantine; backup/replica policy and rollback; no placeholder implementation claims. Product tests, live data inspection, installation and external API verification were not performed during spec drafting. Any future API-dependent implementation must verify the then-current official contract.
