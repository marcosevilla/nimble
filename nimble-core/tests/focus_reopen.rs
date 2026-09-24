//! Agentation pass 3, lane D — reopening a focus-completed task restores it.
//! Plan: docs/superpowers/plans/2026-09-24-agentation-3.md → "D".
//! Marco 2026-09-24 (reverses the absorption spec §2 "Do not introduce
//! completion restore"): same local day only → back at the top of Up next,
//! removed from the completed tray, recorded focus time kept, no timer
//! started; completions from earlier days stay history only.
//!
//! Written RED by QA before the builder starts. Tests named `d<N>_…` map to
//! the QA brief's rules d1–d10.
//!
//! ── Contract for the builder ────────────────────────────────────────────
//!
//! Entry points (all already exist; the new behaviour lives in ONE place):
//! * `db::focus::engine::reconcile_task_effects_inner_tx` — every task write
//!   funnels here. Detect "was complete → now not complete" per changed task:
//!   - local writes: `TaskEffects.previous_status` (set by `set_status_tx`);
//!   - remote applies (`TaskWrite::commit` → owned or headless reconcile):
//!     `apply_pull_tx` / `apply_remote_rows*` build `TaskEffects` WITHOUT
//!     `previous_status`, so the pre-apply completion state has to be
//!     captured some other way (e.g. add a `reopened: Vec<String>` to
//!     `TaskEffects` filled by the applies, or read the prior row before the
//!     apply). Do NOT infer "reopen" from "task open + latest occurrence
//!     completed": a Focus-completed RECURRING task is exactly that state and
//!     must never come back (d8).
//! * Restore = the task's LATEST `focus_occurrences` row (max generation) is
//!   `state='completed'` with `completed_at` on today's LOCAL date → the SAME
//!   occurrence id goes back to `state='open'`, `completed_at=NULL`,
//!   `completion_reason=NULL` (sessions stay attached, so totals are kept),
//!   and a `FocusEntry` for it is inserted at index 1 when a card is selected
//!   (right after it; the selection never changes) or index 0 when the queue
//!   is empty. Save through `save_queue_tx` (bumps `queue_revision`) and mark
//!   `touched` (bumps `engine_revision`). Never open a session/segment.
//!   NB: the absorption spec's table row for `focus_occurrences` says
//!   "completion/reopen … creates a new generation" and §invariants say "a
//!   completed occurrence cannot be queued". The lane D plan (newer, Marco's
//!   decision) supersedes that: same occurrence, reopened — which is also the
//!   only way totals stay attached without copying ledger rows.
//! * Open questions, resolved 2026-09-24 (controller, Marco-approved): a
//!   tray-cleared occurrence (`archived=1`) restores and is un-archived; a
//!   restore into an empty queue becomes the selected (paused, sessionless)
//!   card; a still-unsent time comment is withdrawn on restore (d10).
//! * Paths covered here: `FocusService::execute_native_task(SetStatus)` (the
//!   desktop UI + `dt` with the app running, via `focus_service::execute_task`),
//!   `db::tasks::update_task_status` (headless/`dt` with the app closed),
//!   `db::sync::apply_remote_rows_with_focus` (Turso, owned + headless) and
//!   `integrations::todoist::sync_loop::apply_pull_with_focus` (Todoist).
//!
//! Local day / clock: there is no injectable WALL clock in focus code
//! (`ManualClock` is monotonic only). Engine code uses `chrono::Local::now()`
//! (device time zone) for dates and stores `completed_at` as UTC RFC 3339
//! (`Utc::now().to_rfc3339()`); the tray (`focusFlows.completedTrayRows`)
//! compares the local date of `completed_at` with today's local date. Use the
//! same rule: parse `completed_at`, `.with_timezone(&chrono::Local)
//! .date_naive() == chrono::Local::now().date_naive()`. Tests therefore move
//! time by back-dating `completed_at` in the DB (d2) rather than injecting a
//! clock; if you thread a `today: NaiveDate` into reconcile, keep production
//! callers on `chrono::Local::now().date_naive()` and these tests stay valid.
//!
//! Frontend refresh event: nothing new is needed IF both revisions move.
//! `focus_service::execute_task` → `committed()` emits `nimble-focus-changed`
//! after every native task write (the emit key is owner_epoch +
//! process_generation + ENGINE revision); sync runners call `broadcast()`
//! after applies. The webview re-reads the snapshot on that event, and
//! `useFocusTrayData` re-fetches `focus.history` (the completed tray) keyed on
//! `snapshot.queue_revision` — so the engine revision must bump (event fires)
//! AND the queue revision must bump (tray re-reads). d1 asserts both.
//!
//! Browser harness: `tools/mock-tauri.js` models focus as an empty read-only
//! queue (no engine, no history), so an e2e spec would need a JS engine port
//! — not cheap. Real-app check list for Marco instead (installed build):
//!   1. Queue A, B, C. Start A for ~1 min, press Complete. A is in the
//!      "done" tray; B is the card.
//!   2. On the Tasks page (or task detail / `x`), reopen A. Focus tray, with
//!      no reload: A is 2nd (top of Up next, right under B), B is still the
//!      card, no timer is running, A is gone from the "done" tray, and A's
//!      row shows its ~1 min.
//!   3. Start B, then reopen a second focus-completed task while B runs: B
//!      keeps running and stays the card.
//!   4. Reopen A again (status change twice) → still one A row.
//!   5. Complete a daily-repeat task in Focus → it is NOT back in Up next.
//!   6. With the companion window open, repeat step 2: it updates too.
//!   7. A task Focus-completed yesterday, reopened today → stays out of the
//!      queue; its time is still in the task's Focus history.
#[path = "common/focus.rs"]
mod fixture;

use fixture::Harness;
use nimble_core::db::focus::engine::{NativeTaskAction, NativeTaskCommand, NativeTaskReply};
use nimble_core::focus_types::{FocusAction, FocusSnapshot, FocusSource, FocusStatus};
use nimble_core::integrations::todoist::focus_delivery as delivery;
use nimble_core::types::CreateTaskInput;
use serde_json::json;

// ── helpers ────────────────────────────────────────────────────────────────

async fn enqueue(h: &Harness, task_ids: &[&String]) {
    h.send(FocusAction::Enqueue {
        task_ids: task_ids.iter().map(|t| (*t).clone()).collect(),
        source: FocusSource::Today,
        explicit_still_open: false,
    })
    .await
    .unwrap();
}

fn occurrence_of(snap: &FocusSnapshot, task_id: &str) -> String {
    snap.queue
        .iter()
        .find(|e| e.task_id == task_id)
        .unwrap_or_else(|| panic!("{task_id} is not queued"))
        .occurrence_id
        .clone()
}

/// Start `occ`, record `ms` of work in heartbeat-sized steps (a single delta
/// over 40 s is a gap, not work), and leave it running.
async fn work_running(h: &Harness, occ: &str, ms: u64) {
    h.send(FocusAction::Start { occurrence_id: occ.into() }).await.unwrap();
    let mut left = ms;
    while left > 0 {
        let step = left.min(20_000);
        h.advance(step).await;
        left -= step;
    }
}

async fn complete_in_focus(h: &Harness, occ: &str) {
    h.send(FocusAction::Complete { occurrence_id: occ.into() }).await.unwrap();
}

/// The desktop UI / `dt`-with-app-running reopen path.
async fn set_status_native(h: &Harness, task_id: &str, status: &str) -> NativeTaskReply {
    h.service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::SetStatus {
                id: task_id.into(),
                status: status.into(),
                note: None,
                expected_due_date: None,
            },
        })
        .await
        .unwrap()
}

/// The headless reopen path (`update_task_status` → `update_task_status_inner`
/// → `set_status_tx` + `reconcile_task_effects_tx`): `dt` with the app closed.
async fn set_status_headless(h: &Harness, task_id: &str, status: &str) {
    nimble_core::db::tasks::update_task_status(&h.pool, task_id, status, None)
        .await
        .unwrap();
}

async fn occurrence_row(h: &Harness, occ: &str) -> (String, Option<String>, Option<String>) {
    sqlx::query_as("SELECT state,completed_at,completion_reason FROM focus_occurrences WHERE id=?")
        .bind(occ)
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

async fn open_sessions(h: &Harness) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM focus_sessions WHERE status!='ended'")
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

async fn live_session(h: &Harness) -> Option<String> {
    sqlx::query_scalar("SELECT live_session_id FROM focus_runtime WHERE id=1")
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

fn entries_for(snap: &FocusSnapshot, task_id: &str) -> usize {
    snap.queue.iter().filter(|e| e.task_id == task_id).count()
}

fn order(snap: &FocusSnapshot) -> Vec<String> {
    snap.queue.iter().map(|e| e.task_id.clone()).collect()
}

async fn history_row(h: &Harness, occ: &str) -> nimble_core::focus_types::FocusHistoryRow {
    h.service
        .history(None, None)
        .await
        .unwrap()
        .rows
        .into_iter()
        .find(|r| r.occurrence_id == occ)
        .unwrap_or_else(|| panic!("occurrence {occ} missing from history"))
}

/// Same rule as the frontend's `completedTrayRows`: not archived, completed
/// on today's local date.
async fn tray_occurrences(h: &Harness) -> Vec<String> {
    let today = chrono::Local::now().date_naive();
    h.service
        .history(None, None)
        .await
        .unwrap()
        .rows
        .into_iter()
        .filter(|r| {
            !r.archived
                && r.completed_at.as_deref().is_some_and(|at| {
                    chrono::DateTime::parse_from_rfc3339(at)
                        .map(|d| d.with_timezone(&chrono::Local).date_naive() == today)
                        .unwrap_or(false)
                })
        })
        .map(|r| r.occurrence_id)
        .collect()
}

fn remote_row(row_id: &str, op: &str, snapshot: Option<String>) -> nimble_core::db::sync::RemoteRow {
    nimble_core::db::sync::RemoteRow {
        entry_id: uuid::Uuid::new_v4().to_string(),
        table_name: "local_tasks".into(),
        row_id: row_id.into(),
        operation: op.into(),
        changed_columns: None,
        snapshot,
        device_id: "remote-device".into(),
        timestamp: "2099-01-01T00:00:00Z".into(),
    }
}

async fn task_row(h: &Harness, id: &str) -> serde_json::Value {
    let task = nimble_core::db::tasks::get_local_tasks(&h.pool, None, None, true)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .unwrap();
    serde_json::from_str(&nimble_core::db::sync::task_sync_snapshot(&task)).unwrap()
}

async fn task_status(h: &Harness, id: &str) -> (String, i64) {
    sqlx::query_as("SELECT status,completed FROM local_tasks WHERE id=?")
        .bind(id)
        .fetch_one(&h.pool)
        .await
        .unwrap()
}

async fn map_todoist(h: &Harness, task_id: &str, external: &str) {
    sqlx::query("UPDATE local_tasks SET external_id=?,external_source='todoist' WHERE id=?")
        .bind(external)
        .bind(task_id)
        .execute(&h.pool)
        .await
        .unwrap();
}

/// A, B, C queued; A worked 30 s and completed in Focus. Returns
/// (a, b, c, occurrence of A). Queue after: [B, C], B selected, nothing running.
async fn abc_with_a_focus_completed(h: &Harness) -> (String, String, String, String) {
    let a = h.task("A").await;
    let b = h.task("B").await;
    let c = h.task("C").await;
    enqueue(h, &[&a, &b, &c]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    work_running(h, &occ_a, 30_000).await;
    complete_in_focus(h, &occ_a).await;
    let after = h.snapshot().await;
    assert_eq!(order(&after), [b.clone(), c.clone()], "precondition: A left the queue");
    assert_eq!(occurrence_row(h, &occ_a).await.0, "completed", "precondition");
    (a, b, c, occ_a)
}

// ── d1: same-day reopen restores ───────────────────────────────────────────

/// d1 via the desktop UI path (status dropdown, `x`, detail page, `dt` RPC).
#[tokio::test]
async fn d1_same_day_reopen_via_native_status_restores_to_top_of_up_next() {
    let h = Harness::new().await;
    let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
    let before = h.snapshot().await;
    let selected_before = before.selected_occurrence_id.clone();
    assert_eq!(selected_before.as_deref(), Some(occurrence_of(&before, &b).as_str()));

    let reply = set_status_native(&h, &a, "todo").await;

    // The reply snapshot is what `focus_service::committed` emits from.
    assert_eq!(
        order(&reply.snapshot),
        [b.clone(), a.clone(), c.clone()],
        "reopened A must sit at the top of Up next, right after the selected card B"
    );
    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b.clone(), a.clone(), c.clone()]);
    assert_eq!(
        occurrence_of(&snap, &a),
        occ_a,
        "the SAME occurrence is restored (keeps its recorded time), not a new generation"
    );
    assert_eq!(snap.selected_occurrence_id, selected_before, "the selected card never changes");
    let (state, completed_at, reason) = occurrence_row(&h, &occ_a).await;
    assert_eq!(state, "open", "restored occurrence is open again");
    assert_eq!(completed_at, None, "restored occurrence has no completed_at");
    assert_eq!(reason, None, "restored occurrence has no completion_reason");
    assert!(snap.session.is_none(), "no session starts on restore");
    assert_eq!(open_sessions(&h).await, 0, "no paused/running session created");
    assert_eq!(live_session(&h).await, None, "no live timer");
    assert!(
        snap.queue_revision > before.queue_revision,
        "queue revision must bump so the tray re-reads history ({} -> {})",
        before.queue_revision,
        snap.queue_revision
    );
    assert!(
        snap.engine_revision > before.engine_revision,
        "engine revision must bump so nimble-focus-changed is emitted ({} -> {})",
        before.engine_revision,
        snap.engine_revision
    );
}

/// d1 via the headless path (`update_task_status_inner` → `set_status_tx` →
/// `reconcile_task_effects_tx`): `dt` with the app closed.
#[tokio::test]
async fn d1_same_day_reopen_via_headless_status_restores_to_top_of_up_next() {
    let h = Harness::new().await;
    let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
    let before = h.snapshot().await;

    set_status_headless(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(
        order(&snap),
        [b.clone(), a.clone(), c.clone()],
        "headless reopen must also restore A to the top of Up next"
    );
    assert_eq!(occurrence_of(&snap, &a), occ_a);
    assert_eq!(snap.selected_occurrence_id, before.selected_occurrence_id);
    assert_eq!(occurrence_row(&h, &occ_a).await, ("open".into(), None, None));
    assert_eq!(open_sessions(&h).await, 0, "no session starts on restore");
    assert!(snap.queue_revision > before.queue_revision, "queue revision bumps");
    assert!(snap.engine_revision > before.engine_revision, "engine revision bumps");
}

/// d1 edge: A was the only card, so the queue is empty after completion. The
/// restored entry is the whole queue and the selected card (like Enqueue
/// selecting its first entry); still no session — a selected card is not a
/// running timer.
#[tokio::test]
async fn d1_reopen_into_an_empty_queue_restores_without_starting() {
    let h = Harness::new().await;
    let a = h.task("Solo").await;
    enqueue(&h, &[&a]).await;
    let occ = occurrence_of(&h.snapshot().await, &a);
    work_running(&h, &occ, 20_000).await;
    complete_in_focus(&h, &occ).await;
    assert!(h.snapshot().await.queue.is_empty(), "precondition");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(order(&snap), vec![a.clone()], "restored into the empty queue");
    assert_eq!(snap.queue[0].occurrence_id, occ);
    assert_eq!(
        snap.selected_occurrence_id.as_deref(),
        Some(occ.as_str()),
        "decided 2026-09-24: the lone restored card becomes the selected (paused) card"
    );
    assert!(
        snap.session.as_ref().is_none_or(|s| s.status != FocusStatus::Running),
        "never running after restore"
    );
    assert_eq!(open_sessions(&h).await, 0, "no session created");
    assert_eq!(live_session(&h).await, None);
}

/// d1 edge (plan rule 1 read literally: "latest occurrence is completed today",
/// whatever completed it). A QUEUED task completed from the task list
/// (`completion_reason='task_effect'`) and reopened the same day comes back
/// too. If the builder/Marco decide only Focus-button completions restore,
/// change this test and say so in the report.
#[tokio::test]
async fn d1_queued_task_completed_from_task_list_then_reopened_restores() {
    let h = Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    enqueue(&h, &[&b, &a]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    set_status_native(&h, &a, "complete").await;
    assert_eq!(occurrence_row(&h, &occ_a).await.0, "completed", "precondition");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b.clone(), a.clone()], "restored right after the selected card");
    assert_eq!(occurrence_of(&snap, &a), occ_a);
}

// ── d2: an earlier local day is history only ──────────────────────────────

/// Guard (expected to PASS on main).
#[tokio::test]
async fn d2_completed_on_previous_local_day_is_not_restored() {
    let h = Harness::new().await;
    let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
    // Yesterday at local noon: unambiguously a previous local day in any zone.
    let yesterday_noon = chrono::Local::now()
        .date_naive()
        .pred_opt()
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .single()
        .unwrap()
        .with_timezone(&chrono::Utc)
        .to_rfc3339();
    sqlx::query("UPDATE focus_occurrences SET completed_at=? WHERE id=?")
        .bind(&yesterday_noon)
        .bind(&occ_a)
        .execute(&h.pool)
        .await
        .unwrap();
    let before = h.snapshot().await;

    set_status_native(&h, &a, "todo").await;
    set_status_headless(&h, &a, "in_progress").await;

    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b, c], "yesterday's completion stays out of the queue");
    assert_eq!(snap.selected_occurrence_id, before.selected_occurrence_id);
    let (state, completed_at, _) = occurrence_row(&h, &occ_a).await;
    assert_eq!(state, "completed", "yesterday's occurrence stays completed (history only)");
    assert_eq!(completed_at.as_deref(), Some(yesterday_noon.as_str()));
    assert_eq!(open_sessions(&h).await, 0);
}

// ── d3: never duplicated ───────────────────────────────────────────────────

/// Reopen → other open status → complete from the task list → reopen again:
/// always exactly one entry, always the same occurrence.
#[tokio::test]
async fn d3_reopening_repeatedly_keeps_exactly_one_entry() {
    let h = Harness::new().await;
    let (a, _b, _c, occ_a) = abc_with_a_focus_completed(&h).await;

    set_status_native(&h, &a, "todo").await;
    assert_eq!(entries_for(&h.snapshot().await, &a), 1, "first reopen restores exactly one entry");

    set_status_native(&h, &a, "in_progress").await;
    set_status_headless(&h, &a, "todo").await;
    assert_eq!(entries_for(&h.snapshot().await, &a), 1, "further open-status changes add nothing");

    // Complete again from the task list (reconcile closes the restored
    // occurrence), then reopen the same day again.
    set_status_native(&h, &a, "complete").await;
    assert_eq!(entries_for(&h.snapshot().await, &a), 0, "precondition: completion removed it");
    set_status_native(&h, &a, "todo").await;
    let snap = h.snapshot().await;
    assert_eq!(entries_for(&snap, &a), 1, "second reopen restores exactly one entry");
    assert_eq!(occurrence_of(&snap, &a), occ_a, "still the same occurrence");
}

/// Guard (expected to PASS on main): the user re-added the completed task by
/// hand ("still open" choice → a new generation). Reopening must not add the
/// old occurrence as a second card; the latest occurrence is the open one.
#[tokio::test]
async fn d3_task_readded_manually_is_not_duplicated_on_reopen() {
    let h = Harness::new().await;
    let (a, _b, _c, occ_a) = abc_with_a_focus_completed(&h).await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: true,
    })
    .await
    .unwrap();
    let manual = occurrence_of(&h.snapshot().await, &a);
    assert_ne!(manual, occ_a, "precondition: manual re-add is a new occurrence");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(entries_for(&snap, &a), 1, "exactly one card for A");
    assert_eq!(occurrence_of(&snap, &a), manual, "the manual entry is kept");
    assert_eq!(occurrence_row(&h, &occ_a).await.0, "completed", "old generation stays history");
}

// ── d4: active card + running session untouched ────────────────────────────

#[tokio::test]
async fn d4_restore_never_touches_the_active_card_or_running_session() {
    let h = Harness::new().await;
    let (a, b, c, _occ_a) = abc_with_a_focus_completed(&h).await;
    let occ_b = occurrence_of(&h.snapshot().await, &b);
    work_running(&h, &occ_b, 20_000).await;
    let before = h.snapshot().await;
    let session_before = before.session.clone().expect("precondition: B is running");
    assert_eq!(session_before.status, FocusStatus::Running);
    let live_before = live_session(&h).await;
    assert!(live_before.is_some(), "precondition: live slot set");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(
        order(&snap),
        [b.clone(), a.clone(), c.clone()],
        "A restored right AFTER the running card, never in front of it"
    );
    assert_eq!(snap.selected_occurrence_id.as_deref(), Some(occ_b.as_str()), "B stays selected");
    let session = snap.session.expect("B's session still exists");
    assert_eq!(session.id, session_before.id, "same session");
    assert_eq!(session.occurrence_id, occ_b);
    assert_eq!(session.status, FocusStatus::Running, "B keeps running");
    assert_eq!(live_session(&h).await, live_before, "live slot unchanged");
    assert_eq!(snap.totals[&occ_b], before.totals[&occ_b], "B's time is not disturbed");
    assert_eq!(open_sessions(&h).await, 1, "only B's session is open; none created for A");
}

// ── d5: recorded time kept ────────────────────────────────────────────────

#[tokio::test]
async fn d5_restored_occurrence_keeps_its_recorded_totals() {
    let h = Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    enqueue(&h, &[&a, &b]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    work_running(&h, &occ_a, 90_000).await;
    complete_in_focus(&h, &occ_a).await;
    let recorded = history_row(&h, &occ_a).await;
    assert_eq!(recorded.total_ms, 90_000, "precondition");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(
        snap.totals.get(&occ_a).copied(),
        Some(90_000),
        "restored card shows its 90 s (snapshot totals keyed by the restored occurrence)"
    );
    let row = history_row(&h, &occ_a).await;
    assert_eq!(row.total_ms, 90_000, "history total unchanged");
    assert_eq!(row.recorded_ms, 90_000, "recorded time unchanged");
}

// ── d6: out of the completed tray ─────────────────────────────────────────

#[tokio::test]
async fn d6_completed_tray_and_history_no_longer_show_it_completed() {
    let h = Harness::new().await;
    let (a, _b, _c, occ_a) = abc_with_a_focus_completed(&h).await;
    assert!(tray_occurrences(&h).await.contains(&occ_a), "precondition: A is in today's tray");

    set_status_native(&h, &a, "todo").await;

    assert!(
        !tray_occurrences(&h).await.contains(&occ_a),
        "the completed tray must no longer list the reopened occurrence"
    );
    let row = history_row(&h, &occ_a).await;
    assert_eq!(row.completed_at, None, "history shows the time without a completion");
    assert_eq!(row.total_ms, 30_000, "…but keeps the time");
}

// ── d7: deleted / removed never come back ──────────────────────────────────

/// Guard (expected to PASS on main): removed from the queue (not completed),
/// then completed and reopened from the task list → stays out.
#[tokio::test]
async fn d7_removed_occurrence_is_never_restored() {
    let h = Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    enqueue(&h, &[&b, &a]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    h.send(FocusAction::Remove { occurrence_id: occ_a.clone() }).await.unwrap();
    set_status_native(&h, &a, "complete").await;

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(entries_for(&snap, &a), 0, "a removed occurrence never returns");
    assert_eq!(occurrence_row(&h, &occ_a).await.0, "removed");
}

/// Guard (expected to PASS on main): the LATEST occurrence decides. A was
/// Focus-completed (gen 1), re-added by hand (gen 2) and removed; reopening
/// must not resurrect gen 1.
#[tokio::test]
async fn d7_latest_occurrence_removed_blocks_restore_of_older_completion() {
    let h = Harness::new().await;
    let (a, _b, _c, occ_a) = abc_with_a_focus_completed(&h).await;
    h.send(FocusAction::Enqueue {
        task_ids: vec![a.clone()],
        source: FocusSource::Today,
        explicit_still_open: true,
    })
    .await
    .unwrap();
    let gen2 = occurrence_of(&h.snapshot().await, &a);
    h.send(FocusAction::Remove { occurrence_id: gen2.clone() }).await.unwrap();

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(entries_for(&snap, &a), 0, "latest occurrence was removed → no restore");
    assert_eq!(occurrence_row(&h, &occ_a).await.0, "completed");
    assert_eq!(occurrence_row(&h, &gen2).await.0, "removed");
}

/// Guard (expected to PASS on main): a Focus-completed task that is then
/// deleted leaves no card behind, and the delete succeeds.
#[tokio::test]
async fn d7_deleted_task_is_never_restored() {
    let h = Harness::new().await;
    let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
    h.service
        .execute_native_task(NativeTaskCommand {
            command_id: uuid::Uuid::new_v4().to_string(),
            action: NativeTaskAction::Delete { id: a.clone() },
        })
        .await
        .unwrap();
    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b, c], "deleted task never comes back");
    assert_eq!(occurrence_row(&h, &occ_a).await.0, "completed", "history kept");
}

// ── d8: recurring completion never restores ────────────────────────────────

/// Guard (expected to PASS on main — and the trap for a naive builder): a
/// Focus-completed repeat is rescheduled to `todo` in the same row, so "task
/// open + latest occurrence completed today" is true right after completion.
/// Later open-status changes and remote edits are NOT reopens.
#[tokio::test]
async fn d8_recurring_completion_is_never_restored() {
    let h = Harness::new().await;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let r = nimble_core::db::tasks::create_local_task(
        &h.pool,
        CreateTaskInput {
            content: "Stretch".into(),
            due_date: Some(today.clone()),
            recurrence_rule: Some("every day".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .id;
    let b = h.task("B").await;
    enqueue(&h, &[&r, &b]).await;
    let occ_r = occurrence_of(&h.snapshot().await, &r);
    work_running(&h, &occ_r, 20_000).await;
    complete_in_focus(&h, &occ_r).await;
    let (status, completed) = task_status(&h, &r).await;
    assert!(status != "complete" && completed == 0, "precondition: repeat rescheduled, not complete");
    assert_eq!(entries_for(&h.snapshot().await, &r), 0, "precondition");

    set_status_native(&h, &r, "in_progress").await;
    set_status_headless(&h, &r, "todo").await;
    let mut row = task_row(&h, &r).await;
    row["content"] = json!("Stretch (edited remotely)");
    nimble_core::db::sync::apply_remote_rows_with_focus(
        &h.pool,
        Some(&h.service),
        &[remote_row(&r, "UPDATE", Some(row.to_string()))],
    )
    .await
    .unwrap();

    let snap = h.snapshot().await;
    assert_eq!(entries_for(&snap, &r), 0, "a completed repeat is never put back in the queue");
    assert_eq!(occurrence_row(&h, &occ_r).await.0, "completed");
    assert_eq!(open_sessions(&h).await, 0);
}

// ── d9: incoming applies restore too ───────────────────────────────────────

/// Turso pull that un-completes the task, both under the live service guard
/// (`TaskWrite::Owned`) and headless (`TaskWrite::Headless`).
#[tokio::test]
async fn d9_incoming_turso_reopen_restores() {
    for owned in [true, false] {
        let h = Harness::new().await;
        let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
        let before = h.snapshot().await;
        let mut row = task_row(&h, &a).await;
        row["completed"] = json!(0);
        row["status"] = json!("todo");
        row["completed_at"] = serde_json::Value::Null;
        nimble_core::db::sync::apply_remote_rows_with_focus(
            &h.pool,
            owned.then_some(&h.service),
            &[remote_row(&a, "UPDATE", Some(row.to_string()))],
        )
        .await
        .unwrap();
        let (status, completed) = task_status(&h, &a).await;
        assert!(status != "complete" && completed == 0, "precondition (owned={owned}): Turso reopened the task");

        let snap = h.snapshot().await;
        assert_eq!(
            order(&snap),
            [b.clone(), a.clone(), c.clone()],
            "incoming Turso reopen (owned={owned}) must restore A to the top of Up next"
        );
        assert_eq!(occurrence_of(&snap, &a), occ_a);
        assert_eq!(occurrence_row(&h, &occ_a).await.0, "open");
        assert_eq!(snap.selected_occurrence_id, before.selected_occurrence_id);
        assert_eq!(open_sessions(&h).await, 0, "no session starts (owned={owned})");
        assert!(snap.queue_revision > before.queue_revision);
        assert!(snap.engine_revision > before.engine_revision);
    }
}

/// Todoist pull that un-checks the task (reopened on the phone).
#[tokio::test]
async fn d9_incoming_todoist_reopen_restores() {
    let h = Harness::new().await;
    let a = h.task("A").await;
    let b = h.task("B").await;
    map_todoist(&h, &a, "RA").await;
    enqueue(&h, &[&a, &b]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    work_running(&h, &occ_a, 20_000).await;
    complete_in_focus(&h, &occ_a).await;
    let resp: nimble_core::integrations::todoist::client::SyncResponse =
        serde_json::from_value(json!({"sync_token": "T-reopen", "items": [
            {"id": "RA", "content": "A", "checked": false, "is_deleted": false,
             "updated_at": "2099-01-01T00:00:00Z"}
        ]}))
        .unwrap();
    nimble_core::integrations::todoist::sync_loop::apply_pull_with_focus(&h.pool, &resp, Some(&h.service))
        .await
        .unwrap();
    let (status, completed) = task_status(&h, &a).await;
    assert!(
        status != "complete" && completed == 0,
        "precondition: the Todoist pull reopened the task (status={status}, completed={completed})"
    );

    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b, a.clone()], "incoming Todoist reopen must restore A after the selected card");
    assert_eq!(occurrence_of(&snap, &a), occ_a);
    assert_eq!(open_sessions(&h).await, 0);
}

// ── d10: queued Todoist time comment ───────────────────────────────────────

/// Decided 2026-09-24 (controller, Marco-approved behaviour): a restore
/// withdraws a still-unsent time comment (`pending`, or a definite
/// `retryable-error` failure) for the restored occurrence, so Todoist is never
/// told "⏱ Nm spent" about a task that is open again; the next completion of
/// the same occurrence queues a fresh one carrying the updated total. There is
/// never more than one intent per occurrence.
#[tokio::test]
async fn d10_restore_withdraws_unsent_time_comment_and_recompletion_requeues_it() {
    let h = Harness::new().await;
    nimble_core::db::settings::set_setting(&h.pool, delivery::ENABLED_SETTING, "1").await.unwrap();
    let a = h.task("A").await;
    let b = h.task("B").await;
    map_todoist(&h, &a, "RA").await;
    enqueue(&h, &[&a, &b]).await;
    let occ_a = occurrence_of(&h.snapshot().await, &a);
    work_running(&h, &occ_a, 90_000).await;
    complete_in_focus(&h, &occ_a).await;

    let comments = |h: &Harness, occ: String| {
        let pool = h.pool.clone();
        async move {
            sqlx::query_as::<_, (String, String)>(
                "SELECT state,payload_json FROM focus_delivery WHERE occurrence_id=? AND purpose=?",
            )
            .bind(occ)
            .bind(delivery::TIME_COMMENT)
            .fetch_all(&pool)
            .await
            .unwrap()
        }
    };
    let recorded_ms = |payload: &str| -> u64 {
        serde_json::from_str::<serde_json::Value>(payload).unwrap()["recorded_ms"].as_u64().unwrap()
    };
    let after_complete = comments(&h, occ_a.clone()).await;
    assert_eq!(after_complete.len(), 1, "precondition: Focus Complete queued one time comment");
    assert_eq!(after_complete[0].0, "pending", "precondition");
    assert_eq!(recorded_ms(&after_complete[0].1), 90_000, "precondition");

    set_status_native(&h, &a, "todo").await;
    assert!(
        comments(&h, occ_a.clone()).await.is_empty(),
        "restore withdraws the unsent time comment"
    );

    // Work more on the restored card, then complete it from the task list:
    // a fresh comment carries the new total.
    let snap = h.snapshot().await;
    let selected = snap.selected_occurrence_id.clone().unwrap();
    h.send(FocusAction::Promote { occurrence_id: occ_a.clone() }).await.unwrap();
    assert_ne!(selected, occ_a, "precondition: A was restored behind the card");
    work_running(&h, &occ_a, 60_000).await;
    set_status_native(&h, &a, "complete").await;
    let after_recomplete = comments(&h, occ_a.clone()).await;
    assert_eq!(after_recomplete.len(), 1, "re-completion queues exactly one comment: {after_recomplete:?}");
    assert_eq!(after_recomplete[0].0, "pending");
    assert_eq!(recorded_ms(&after_recomplete[0].1), 150_000, "the fresh comment has the updated total");

    // A definite send failure is still unsent: a reopen withdraws it too.
    sqlx::query("UPDATE focus_delivery SET state='retryable-error',attempts=1 WHERE occurrence_id=?")
        .bind(&occ_a)
        .execute(&h.pool)
        .await
        .unwrap();
    set_status_native(&h, &a, "todo").await;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM focus_delivery WHERE native_task_id=? AND purpose=?",
    )
    .bind(&a)
    .bind(delivery::TIME_COMMENT)
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(total, 0, "no time-comment intent survives a reopen before it was sent");
}

/// A comment that may already have reached Todoist can't be un-sent: a
/// restore leaves it exactly as it is (and the occurrence still restores).
#[tokio::test]
async fn d10_restore_keeps_a_time_comment_that_may_have_been_sent() {
    for state in ["sending", "acknowledged", "uncertain", "needs-review"] {
        let h = Harness::new().await;
        nimble_core::db::settings::set_setting(&h.pool, delivery::ENABLED_SETTING, "1").await.unwrap();
        let a = h.task("A").await;
        let b = h.task("B").await;
        map_todoist(&h, &a, "RA").await;
        enqueue(&h, &[&a, &b]).await;
        let occ_a = occurrence_of(&h.snapshot().await, &a);
        work_running(&h, &occ_a, 90_000).await;
        complete_in_focus(&h, &occ_a).await;
        sqlx::query("UPDATE focus_delivery SET state=? WHERE occurrence_id=?")
            .bind(state)
            .bind(&occ_a)
            .execute(&h.pool)
            .await
            .unwrap();

        set_status_native(&h, &a, "todo").await;

        let kept: Vec<String> = sqlx::query_scalar(
            "SELECT state FROM focus_delivery WHERE occurrence_id=? AND purpose=?",
        )
        .bind(&occ_a)
        .bind(delivery::TIME_COMMENT)
        .fetch_all(&h.pool)
        .await
        .unwrap();
        assert_eq!(kept, vec![state.to_string()], "a {state} comment is left alone");
        assert_eq!(occurrence_of(&h.snapshot().await, &a), occ_a, "restore still happens ({state})");
    }
}

// ── tray-cleared occurrence (controller decision 3) ────────────────────────

/// Decided 2026-09-24: an occurrence the user already cleared from today's
/// tray (`archived=1`) still restores on a same-day reopen, and the archive
/// flag is cleared so history stays consistent.
#[tokio::test]
async fn cleared_from_tray_then_reopened_same_day_restores_and_unarchives() {
    let h = Harness::new().await;
    let (a, b, c, occ_a) = abc_with_a_focus_completed(&h).await;
    h.send(FocusAction::ArchiveHistory { occurrence_ids: vec![occ_a.clone()] }).await.unwrap();
    assert!(history_row(&h, &occ_a).await.archived, "precondition: cleared from the tray");

    set_status_native(&h, &a, "todo").await;

    let snap = h.snapshot().await;
    assert_eq!(order(&snap), [b, a.clone(), c]);
    assert_eq!(occurrence_of(&snap, &a), occ_a);
    assert!(!history_row(&h, &occ_a).await.archived, "restore clears the archive flag");
}
