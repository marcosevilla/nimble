# C2 Reminders and Phone Alerts Implementation Plan

Execution status (2026-09-21): C2/C3 implementation is merged and installed. This approved plan is retained as an implementation checklist, not the current open-loops list; unchecked original steps do not by themselves mean work is unimplemented. See [NEXT.md](../../../NEXT.md) and [verification](../../c2-c3-verification.md) for completed evidence and remaining acceptance. Mac banner and Google connection/first sync passed; phone/two-way acceptance and assistant routing/web propagation remain open. The installed OAuth repair is still on its local unmerged branch.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give explicitly configured timed tasks persistent Mac reminders and opt-in Google Calendar phone alerts, without losing reminders when Nimble quits or the Mac sleeps.

**Architecture:** A pure Rust scheduler produces occurrence keys and due decisions; a device-local delivery ledger drives notifications and persistent catch-up cards. A separate OAuth adapter reconciles only explicitly opted-in task events in one app-created Google calendar. Shared schema, task CRUD, sync, export/recovery, provider contracts, and startup integration belong to the coordinating agent so C3 can proceed concurrently.

**Tech Stack:** Existing Rust/sqlx/chrono/reqwest/Tauri/React; Tauri notification plugin v2; PKCE S256 OAuth desktop flow; macOS Keychain for tokens. Add a timezone library with IANA/DST support and an audited OAuth/PKCE dependency during implementation; pin the selected versions in Cargo.lock.

**Spec:** `docs/todoist-replacement-decisions.md` D3/D7/D10 and C2 exit tests, plus `NEXT.md`. Execution and shared-file ownership are governed by [the coordination plan](2026-09-21-c2-c3-coordination.md). This plan supplies **proposed defaults**, not new locked decisions. Status: **draft pending Marco's approval of the coordinated C2/C3 plan**.

## Global Constraints

- All API calls happen in Rust, never in the React frontend (CORS + security).
- Task/project mutations must go through `db/tasks.rs` / `db/projects.rs` CRUD fns.
- Native Expo app remains dormant; the web client is the phone path.
- Keep Todoist operational until the safety, reminder, agent-access, and trial-period gates pass.
- Marco designs in Figma; implementation uses existing controls and minimal functional surfaces, not a redesign.
- No production Google writes, OAuth activation, real task edits, or app replacement during automated implementation checks. Real activation is a separately visible follow-up.
- Development/test/demo profiles cannot contact production Google or read production Keychain credentials. Use injected fake transport/credential store and synthetic SQLite.

## Proposed product defaults

1. Reminders are off until explicitly set on a task. One offset per task: at time, 5, 15, 30, 60 minutes, or custom integer 0–40320. A reminder requires a due date and time; date-only tasks receive no invented time. Clearing date/time clears the reminder and unpublishes any managed calendar event through reconciliation.
2. Desktop uses one configured IANA timezone, initially the Mac's timezone, displayed in settings. Calendar uses the same zone. Preserve this zone when travelling until the user changes it; do not silently reschedule existing reminders. Ambiguous DST time selects the earlier occurrence; nonexistent local times enter a visible needs-attention state, never silently disappear. A future per-task timezone model is out of this phase.
3. Each due occurrence gets one persistent catch-up item. On-time alerts (within 90 seconds) attempt a Mac notification; older ones go to a neutral “Reminders to review” card. Never burst many historical notifications on launch. Completion, deletion, rescheduling and offset changes invalidate old pending occurrences. Recurrence creates a fresh occurrence key.
4. Phone publishing is a separate **per-task opt-in**, enabled only after a connection exists. Use one dedicated “Nimble” calendar, the narrow `calendar.app.created` scope, no attendees, and no mutations of existing personal/work calendars. Existing ICS reading remains unchanged.
5. Two-way means mapped title, description, start, duration, and supported popup reminder edits round-trip. Google deletion, moving to all-day, unsupported recurrence, invalid fields, or conflicting edits create a review item; they never silently delete/complete the task. Nimble completion or opt-out removes only its managed event. Recurring Nimble tasks publish their current occurrence as a single event; advancing the task updates that event. Future occurrences are not guaranteed on the phone while Nimble remains closed.

**Honest limits:** Mac notifications require the app running and OS permission; catch-up persists across launch/wake. Google can notify for already-published events while Nimble is closed; new edits need the Mac to sync. OS display and a SQLite write cannot be one transaction: promise durable catch-up and no routine duplicate alerts, not mathematically exact-once visible banners. Native phone receipt is an acceptance test, not implied by a successful API response.

## Shared integration request (coordinator owns these edits)

Files: `nimble-core/src/db/migrations.rs`, `types.rs`, `db/tasks.rs`, `db/labels.rs`, `db/sync.rs`, `db/export_policy.rs`, `db/export.rs`, `db/recovery.rs`, module registries; `packages/types/src/index.ts`, `data-provider.ts`; desktop `services/tauri.ts`, `tauri-provider.ts`, `turso-provider.ts`, `src-tauri/src/commands/local_tasks.rs`, `lib.rs`; dormant mobile migration mirror if policy requires it. C2 worker submits interfaces to root, not competing edits.

Schema20 requested SQL (split statements, no SQL triggers):

```sql
ALTER TABLE local_tasks ADD COLUMN reminder_offset_minutes INTEGER;
ALTER TABLE local_tasks ADD COLUMN google_calendar_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE labels ADD COLUMN "group" TEXT;
CREATE TABLE reminder_deliveries (
 occurrence_key TEXT PRIMARY KEY, task_id TEXT NOT NULL,
 scheduled_at TEXT NOT NULL, state TEXT NOT NULL,
 last_fired_at TEXT, acknowledged_at TEXT, error_code TEXT
);
CREATE INDEX reminder_deliveries_task ON reminder_deliveries(task_id);
CREATE TABLE google_calendar_state (
 id INTEGER PRIMARY KEY CHECK(id = 1), calendar_id TEXT,
 timezone TEXT NOT NULL, sync_token TEXT, last_synced_at TEXT,
 retry_after TEXT, error_code TEXT
);
CREATE TABLE google_calendar_links (
 task_id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE,
 etag TEXT, base_json TEXT, operation_id TEXT NOT NULL,
 desired_json TEXT, state TEXT NOT NULL, retry_after TEXT
);
CREATE TABLE google_calendar_conflicts (
 task_id TEXT PRIMARY KEY, reason TEXT NOT NULL,
 local_json TEXT NOT NULL, remote_json TEXT, created_at TEXT NOT NULL
);
```

`reminder_deliveries.state`: `pending`, `dispatching`, `notified`, `catch_up`, `acknowledged`, `superseded`. `google_calendar_links.state`: `pending_upsert`, `linked`, `pending_delete`, `conflict`. No foreign key cascade on links: task deletion must leave the evidence required to delete the remote event. The reconciler compares the task's current existence/opt-in with all mappings every run; do not rely solely on fire-and-forget observers or sync-log retention to discover deletions. `operation_id` and deterministic remote event IDs make insert retry safe.

Synced/exported user intent: both task columns and nullable `labels.group`. All new ledgers/mapping/tokens/conflicts are device-local, excluded from Turso and portable exports; full private snapshots include SQLite ledgers but no Keychain secrets. Explicit export policy entries are required for every new table, even excluded tables. Restore must reset integration/delivery activation before any live use. Preserve recovery of v19 backups by selecting source-schema policy and validating before migration; do not merely bump C1's policy version constant.

Rust task additions: `LocalTask.reminder_offset_minutes: Option<i64>`, `google_calendar_enabled: bool`; matching optional create/update fields and `UpdateTaskInput.clear_reminder: bool`. Applying clears wins over sets, matching current due-time behavior. Label group is schema/storage plumbing only; taxonomy backfill and grouped UI stay C4. TS camelCase mutation parameters follow the existing provider pattern. Web can edit synced reminder intent but explicitly reports unsupported local notifications/OAuth; no browser token storage.

## Task 1: Pure reminder decisions and durable delivery ledger

**Files:** Create `nimble-core/src/reminders.rs`, `nimble-core/src/db/reminders.rs`, `nimble-core/tests/reminders.rs`. Root adds module exports and schema first.

**Interfaces:** Define in `reminders.rs`:

```rust
pub struct ReminderCandidate {
    pub task_id: String,
    pub scheduled_at: chrono::DateTime<chrono::Utc>,
    pub occurrence_key: String,
}
pub enum DeliveryDecision { Notify, CatchUp, Future }
pub fn decide(now: chrono::DateTime<chrono::Utc>, at: chrono::DateTime<chrono::Utc>) -> DeliveryDecision;
pub fn candidate(task: &crate::types::LocalTask, timezone: &str) -> crate::Result<Option<ReminderCandidate>>;
// db/reminders.rs
pub async fn collect_due(pool: &sqlx::SqlitePool, now: chrono::DateTime<chrono::Utc>, timezone: &str) -> crate::Result<Vec<ReminderCandidate>>;
pub async fn claim_notification(pool: &sqlx::SqlitePool, key: &str) -> crate::Result<bool>;
pub async fn acknowledge(pool: &sqlx::SqlitePool, key: &str) -> crate::Result<()>;
```

- [ ] Add failing boundary test (then duplicate claim, restart, completion, reschedule, recurrence, DST and clock rollback tests):

```rust
#[test]
fn missed_reminder_becomes_catch_up() {
    use nimble_core::reminders::{decide, DeliveryDecision};
    let at = "2026-09-22T16:00:00Z".parse().unwrap();
    let now = "2026-09-22T17:00:00Z".parse().unwrap();
    assert!(matches!(decide(now, at), DeliveryDecision::CatchUp));
}
```

- [ ] Run `cargo test -p nimble-core --test reminders --offline` and confirm failure is the missing implementation.
- [ ] Implement `decide`: future if `now < at`, notify if elapsed <=90s, catch-up otherwise. Build occurrence key from task ID, original wall date/time, offset and resolved timezone (not task `updated_at`, so title edits cannot re-fire). Reject malformed/negative/out-of-range offsets at CRUD boundary. Candidate returns None for complete or untimed/no-offset tasks.
- [ ] Persist insert-if-absent pending rows transactionally; atomic `UPDATE ... WHERE state='pending'` claims a banner. On restart, ambiguous `dispatching` rows become catch-up, never re-send automatically. Record successful plugin acknowledgement as `notified` plus `last_fired_at`; plugin failure becomes `catch_up`. Acknowledging a card marks one occurrence only. Compare keys against current tasks to supersede stale rows before delivery, including after wake.
- [ ] Run tests with a fixed clock and file-backed DB reopened between steps. Assert 60s tick repetition and two competing claims deliver once; title edit preserves key; due edit and recurring advancement change it; denied OS delivery still leaves a review item.
- [ ] Commit `feat: add persistent reminder decisions and delivery ledger` after root's shared schema is available.

## Task 2: Desktop runner, controls and catch-up card

**Files:** Create `apps/desktop/src-tauri/src/reminder_runner.rs`, `commands/reminders.rs`, `apps/desktop/src/components/settings/ReminderSection.tsx`, `components/tasks/ReminderPicker.tsx`, `components/today/ReminderCatchUp.tsx`. Modify `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `components/detail/TaskDetailPage.tsx`, `components/pages/TodayPage.tsx`, `components/pages/SettingsPage.tsx`. Root owns provider/startup registration.

**Interfaces:** `reminder_runner::tick(app: &tauri::AppHandle) -> Result<(), String>`; Tauri `reminder_get_status`, `reminder_request_permission`, `reminder_list_catch_up`, `reminder_acknowledge`. Provider `reminders` exposes `supported`, `getStatus`, `requestPermission`, `listCatchUp`, `acknowledge`; status reports permission + timezone + sanitized last error. Catch-up items contain occurrence key/task ID/title/scheduled UTC time only. Root wires 60-second interval, immediate startup tick, and focus/wake reconciliation with a mutex; no duplicate runners.

- [ ] Add fake-notifier test whose send returns an error and assert persisted `catch_up` remains. Test concurrent wake/tick claims using the Task1 ledger.
- [ ] Run `cargo test -p app --offline reminder`.
- [ ] Register plugin using `tauri_plugin_notification::init()` and implement the Rust `NotificationExt` boundary; isolate notification calls behind a test adapter. Ask OS permission only on explicit Enable action; report denied permissions with an actionable settings hint. No JS direct plugin imports.
- [ ] Add existing-style selector to task detail; use provider task updates. Render catch-up card from persisted records on Today, with View task and Dismiss per item and a clearly labelled Dismiss all visible action. Neutral wording; no guilt/streak counters. C3's shared task-change event triggers refresh; reminders also refresh after own acknowledgement.
- [ ] Run desktop/web builds, targeted lint, and native signed synthetic-bundle test: due in three minutes with two-minute offset, quit/reopen after due, permission denied, complete before due, recurrence advances. Browser mocks cannot pass the native permission gate.
- [ ] Commit `feat: add desktop reminder alerts and catch-up review`.

## Task 3: OAuth connection and private credential boundary

**Files:** Create `apps/desktop/src-tauri/src/google_oauth.rs`, `google_credentials.rs`, `commands/google_calendar.rs`, `apps/desktop/src/components/settings/GoogleCalendarSection.tsx`; modify desktop Cargo.toml for dependency pins. Root owns registration/provider additions.

**Interfaces:** `GoogleCredentials` trait loads/stores/deletes a refresh token by synthetic-or-production profile identity; production implementation uses Keychain, test implementation in-memory. `GoogleConnectionStatus` contains connected/calendar label/timezone/error code, never tokens. Commands `google_calendar_connect`, `google_calendar_disconnect`, `google_calendar_status`; provider `googleCalendar.connect/disconnect/getStatus/syncNow/listConflicts/resolveConflict` is desktop-only.

- [ ] Write tests for wrong/missing state, callback replay, timeout/cancel, refresh response without replacement refresh token, invalid_grant, credential-store failure, and synthetic profile isolation. Assert no token appears in serialized status/error text or request logs.
- [ ] Run desktop filtered OAuth tests to see missing implementation fail.
- [ ] Use Desktop OAuth client, external system browser through existing Rust URL-opening path, a loopback listener bound only to `127.0.0.1` on an ephemeral port, random state and PKCE S256. Five-minute attempt timeout, one active attempt, one-use callback. Request offline access and only `https://www.googleapis.com/auth/calendar.app.created`. Keep access token in memory, refresh token in Keychain, public client ID in config. Never use embedded webview login or put tokens in settings/export/logs.
- [ ] Connect creates a dedicated Nimble calendar only after consent; save returned ID and timezone before publishing tasks. If creation result is ambiguous, surface recoverable setup state rather than endlessly creating calendars. Disconnect stops workers, revokes token when possible, deletes local credential, leaves calendar/events intact and explains that behavior; no bulk destructive cleanup.
- [ ] Verify cancellation leaves reminders functional. Missing Desktop client ID presents “Google connection setup needed”; build and mocked sync remain testable without any credential. Document Cloud project/API/client/consent-screen steps in `docs/google-calendar-setup.md`; check testing-mode refresh-token lifetime before calling it ready for unattended use.
- [ ] Commit `feat: add isolated Google Calendar OAuth connection`.

## Task 4: Conservative two-way task calendar reconciliation

**Files:** Create `nimble-core/src/api/google_calendar.rs`, `nimble-core/src/integrations/google_calendar.rs`, `nimble-core/src/db/google_calendar.rs`, `nimble-core/tests/google_calendar.rs`, `apps/desktop/src-tauri/src/google_calendar_runner.rs`. Extend settings component and task detail with Phone alert opt-in and last sync/error states.

**Interfaces:** Define `CalendarProjection { task_id, content, description, start_rfc3339, end_rfc3339, timezone, reminder_offset_minutes }`, `RemoteEvent { event_id, etag, projection: Option<CalendarProjection>, cancelled }`, `MergeDecision::{Unchanged, Push, Pull, Conflict}` and pure `merge(base, local, remote)`. Core API methods accept an injected reqwest client/base URL and bearer token supplied by desktop; production URL fixed to Google's API. Worker `run_once(pool, transport, now)` returns changed task IDs and sanitized status. Root routes changed IDs through shared app refresh mechanism, never C3's socket protocol from core.

- [ ] Add fixture-driven failing merge tests: local only edit -> Push; remote only -> Pull; identical both -> Unchanged; disjoint field edits -> merge; same field divergent -> Conflict. Add fixtures for 401/403, 404/410, 409 duplicate create, 412 ETag mismatch, 429/5xx retry, pagination failure, deleted task with retained link, and unsupported event recurrence/all-day.
- [ ] Run `cargo test -p nimble-core --test google_calendar --offline`.
- [ ] Project only opted-in incomplete timed tasks. Default missing duration to 30 minutes in event projection without silently writing duration into the task. Use `reminders.useDefault=false` plus exactly one popup override when offset exists; opt-in without offset is invalid. Set deterministic UUID-derived lowercase hex event ID and private task marker, never attendees. For an ambiguous create, GET that ID and verify marker before treating it as success.
- [ ] Persist desired operation before network mutation. Pull all changed pages before advancing sync token; preserve old token on partial failure. HTTP410 resets token and triggers full reconciliation, not local-task deletion. ETag conditional writes prevent stale overwrite; HTTP412 re-fetches and reruns three-way comparison against persisted base. Preserve unrelated server fields when updating supported fields.
- [ ] Apply accepted incoming fields through existing `update_local_task`, then save acknowledged base; crash recovery compares normalized projections so observer feedback cannot echo forever. Recheck task after network fetch to detect simultaneous CLI/web edits before applying remote changes. Root supplies optimistic CRUD precondition if needed; do not raw-SQL task updates.
- [ ] Persist conflict snapshots and expose Keep Nimble / Use Calendar actions. Remote deleted/all-day/unsupported recurrence cannot use generic Pull; review action either re-creates the owned timed event or disables phone publishing while preserving task. Completion/deletion/opt-out persists remote delete intent and treats remote404/410 deletion as success. Never import unrelated events as tasks.
- [ ] Poll every60s while connected plus startup/focus, serialize runs and coalesce edits. Honor Retry-After and bounded exponential retry for transient failures; invalid_grant requires reconnect, 403 pauses with reason. Local edits and Mac reminders continue while offline. No push webhooks/server infrastructure.
- [ ] Pass transport tests asserting no request targets another calendar, no duplicate event after restart, no sync-token advance after mid-page failure, and no silent conflict overwrite. Commit `feat: sync opted-in timed tasks with dedicated Google calendar`.

## Task 5: Combined C2/C3 verification and activation handoff

**Files:** Create `docs/c2-verification.md`, `docs/google-calendar-setup.md`; coordinator updates `NEXT.md` and `CLAUDE.md`.

- [ ] Run `cargo test --workspace --offline`, `npm run build --workspace @nimble/desktop`, `npm run build:web --workspace @nimble/desktop`, targeted frontend lint. Also run C1 regression fixtures including schema19 recovery into an isolated directory and schema20 export/snapshot/restore.
- [ ] Through the C3 CLI in a synthetic profile, create a timed reminder task; assert app refresh within a second, reminder runner sees it without restart, fake remote event updates once, and web edit pull changes schedule. Repeat with task completion and deletion while a Google retry is pending.
- [ ] Run signed synthetic native Mac reminder exit tests and record observations. Real Google/phone test remains explicitly unchecked until client setup and live activation are authorized; mocked success is not a phone alert.
- [ ] For later authorized activation, use a disposable explicitly opted-in test task in the dedicated calendar: verify popup on physical phone, move event on phone and confirm Nimble time updates, edit Nimble and confirm phone calendar updates, disconnect/reconnect, and refresh-token persistence. Only then configure the real EDD task's 30-minute alarm and record its separate acceptance evidence.
- [ ] Keep historical live biweekly recurrence-twice exit gate open until actually observed. Update NEXT with completed implementation versus pending live acceptance and commit docs.

## Review checkpoints and unresolved external setup

- Before implementation: approve proposed timing/timezone/calendar/conflict defaults. This is the coordinator's one combined plan approval, not separate approvals per agent.
- After shared schema landing: schema/sync/export reviewer checks old-backup compatibility and web mutation preservation before C2/C3 build on it.
- After desktop milestone: verify durable catch-up with OS failure, not only pure scheduler tests.
- Before Google integration: Desktop OAuth client/API/consent mode may require account setup. No evidence of existing client configuration was found in source; do not assume it exists.
- Before release: check conflict recovery, delayed network responses, Keychain isolation and C1 backups together. Implementing the old estimate's entire OAuth two-way surface is materially more than a simple notification toggle; ship the desktop checkpoint first while calendar reconciliation is reviewed.

## Official guidance checked for this draft

- [Tauri notification plugin](https://v2.tauri.app/plugin/notification/) — plugin setup, permission boundary and native verification.
- [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app) — external browser, loopback redirect, PKCE, refresh-token exchange.
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) — `calendar.app.created` permits app-created secondary calendar events.
- [Incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync) — pagination and sync-token reset on410.
- [Event insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) and [event update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update) — event fields, explicit IDs, reminders and event update contract.
