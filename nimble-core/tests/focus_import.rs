#[path = "common/focus.rs"]
mod fixture;

use fixture::Harness;
use nimble_core::db::focus::import::{commit_import, preview_import};
use nimble_core::focus_types::{
    FocusAction, FocusImportPreview, FocusSource, ImportInclusion, ImportRecordStatus,
    ImportSeverity, LegacyFocusFiles,
};
use sqlx::SqlitePool;

const REMOTE: &str = "90071992547409931234";

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/focus/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn files() -> LegacyFocusFiles {
    LegacyFocusFiles {
        source_namespace: "fixture".into(),
        state_json: Some(fixture("state.json")),
        manual_json: Some(fixture("manual.json")),
        pending_json: Some(fixture("pending.json")),
    }
}

fn command() -> String {
    uuid::Uuid::new_v4().to_string()
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

fn record<'a>(preview: &'a FocusImportPreview, key: &str) -> &'a nimble_core::focus_types::FocusImportRecordPreview {
    preview
        .records
        .iter()
        .find(|r| r.record_key == key)
        .unwrap_or_else(|| panic!("record {key} missing: {:?}", preview.records.iter().map(|r| &r.record_key).collect::<Vec<_>>()))
}

#[tokio::test]
async fn malformed_source_is_not_empty_success() {
    let pool = nimble_core::test_util::test_pool().await;
    let files = nimble_core::focus_types::LegacyFocusFiles {
        source_namespace: "fixture".into(),
        state_json: Some("{".into()),
        manual_json: None,
        pending_json: None,
    };
    assert!(nimble_core::db::focus::import::preview_import(&pool, &files)
        .await
        .is_err());
}

#[tokio::test]
async fn fixture_preview_counts_completion_once_and_quarantines_the_rest() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    assert!(!preview.blocked, "{:?}", preview.issues);

    let included_12345: Vec<_> = preview
        .contributions
        .iter()
        .filter(|c| c.duration_ms == 12_345 && c.inclusion == ImportInclusion::Included)
        .collect();
    assert_eq!(included_12345.len(), 1, "{:?}", preview.contributions);
    assert_eq!(included_12345[0].source_kind, "completion");
    assert_eq!(included_12345[0].legacy_task_id, "manual:m1");

    // The residual same-ID timer is potential overlap: preserved, never summed.
    let residual = preview
        .contributions
        .iter()
        .find(|c| c.source_kind == "timer" && c.legacy_task_id == "manual:m1")
        .unwrap();
    assert_eq!(residual.inclusion, ImportInclusion::Excluded);
    assert_eq!(record(&preview, "timer:manual:m1").status, ImportRecordStatus::Quarantined);

    // Running timer recovers only through lastTickAt: 5,000 + 2,000.
    let open = preview
        .contributions
        .iter()
        .find(|c| c.source_kind == "timer" && c.legacy_task_id == "manual:m2")
        .unwrap();
    assert_eq!((open.duration_ms, open.inclusion), (7_000, ImportInclusion::Included));

    // The opaque remote ID stays a string and an unresolved reference.
    let remote = preview
        .contributions
        .iter()
        .find(|c| c.legacy_task_id == REMOTE)
        .unwrap();
    assert_eq!(remote.inclusion, ImportInclusion::Unresolved);
    assert!(remote.task_id.is_none());
    assert!(serde_json::to_string(&preview).unwrap().contains(&format!("\"{REMOTE}\"")));

    // Both pending operations are quarantined evidence, even though expired.
    let pending: Vec<_> = preview.records.iter().filter(|r| r.kind == "pending").collect();
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().all(|r| r.status == ImportRecordStatus::Quarantined));
    assert!(pending.iter().any(|r| r.raw_evidence["content"] == "Synthetic tracked-time comment"));

    // Unknown legacy fields are kept as evidence, not dropped.
    assert_eq!(record(&preview, "task:manual:m2").raw_evidence["legacyColor"], "teal");

    // Only the manual order is queueable (the remote body is unknown).
    let order: Vec<_> = preview.merged_order.iter().map(|o| o.legacy_task_id.as_deref()).collect();
    assert_eq!(order, vec![Some("manual:m2")]);
    assert_eq!(preview.source_order, vec![REMOTE.to_string()]);
    assert_eq!(preview.manual_order, vec!["manual:m2".to_string()]);
    assert_eq!(preview.file_hashes.len(), 3);
    // Preview is deterministic and writes nothing.
    assert_eq!(preview.preview_token, preview_import(&h.pool, &files()).await.unwrap().preview_token);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM local_tasks").await, 0);
}

#[tokio::test]
async fn config_is_never_accepted_or_echoed() {
    let raw = r#"{"source_namespace":"x","config_json":"{\"token\":\"t\"}"}"#;
    assert!(serde_json::from_str::<LegacyFocusFiles>(raw).is_err());

    let pool = nimble_core::test_util::test_pool().await;
    let files = LegacyFocusFiles {
        source_namespace: "fixture".into(),
        state_json: Some(r#"{"token":"synthetic-secret-value"}"#.into()),
        manual_json: None,
        pending_json: None,
    };
    match preview_import(&pool, &files).await {
        Ok(preview) => {
            assert!(preview.blocked);
            assert!(!serde_json::to_string(&preview).unwrap().contains("synthetic-secret-value"));
        }
        Err(e) => assert!(!e.to_string().contains("synthetic-secret-value")),
    }
}

#[tokio::test]
async fn commit_writes_local_only_history_and_merged_queue_without_outbound_intent() {
    let h = Harness::new().await;
    nimble_core::integrations::ensure_state(&h.pool, "todoist").await.unwrap();
    nimble_core::db::settings::set_setting(&h.pool, "todoist_api_token", "synthetic").await.unwrap();
    let existing = h.task("Existing Nimble task").await;
    let outbox_before = count(&h.pool, "SELECT count(*) FROM todoist_outbox").await;
    h.send(FocusAction::Enqueue { task_ids: vec![existing.clone()], source: FocusSource::Local, explicit_still_open: false })
        .await
        .unwrap();

    let preview = preview_import(&h.pool, &files()).await.unwrap();
    let order: Vec<_> = preview.merged_order.iter().map(|o| o.task_id.clone()).collect();
    assert_eq!(order[0], existing, "existing Nimble queue stays first");
    let result = commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap();
    assert!(!result.replayed && !result.noop);
    assert_eq!(result.created_task_ids.len(), 2);

    // Local-only, unbound, with the actual completion epoch preserved.
    let rows: Vec<(String, String, bool, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT content,sync_policy,completed,completed_at,external_id FROM local_tasks WHERE id!=? ORDER BY content",
    )
    .bind(&existing)
    .fetch_all(&h.pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|r| r.1 == "local_only" && r.4.is_none()));
    let done = rows.iter().find(|r| r.0 == "Synthetic finished manual task").unwrap();
    assert!(done.2 && done.3.is_some());
    let occurrence_done: String = sqlx::query_scalar("SELECT completed_at FROM focus_occurrences WHERE state='completed'")
        .fetch_one(&h.pool).await.unwrap();
    assert!(occurrence_done.starts_with("2025-09-22T12:00:00"), "{occurrence_done}");

    // Import is not creation or completion to echo: no Todoist/delivery intent.
    assert_eq!(count(&h.pool, "SELECT count(*) FROM todoist_outbox").await, outbox_before);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM focus_delivery").await, 0);
    let seeded = nimble_core::integrations::todoist::observer::seed_outbox_for_unlinked(&h.pool).await.unwrap();
    assert_eq!(seeded.0, 0, "imported local-only tasks never seed a Todoist create");
    for id in &result.created_task_ids {
        let intents: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id=?")
            .bind(id).fetch_one(&h.pool).await.unwrap();
        assert_eq!(intents, 0);
    }

    // Queue: existing first, then the open manual task, paused with its timebox.
    let snap = h.snapshot().await;
    assert_eq!(snap.queue.len(), 2);
    assert_eq!(snap.queue[0].task_id, existing);
    let imported = &snap.queue[1];
    assert_eq!(imported.config.budget_ms, Some(1_500_000));
    assert_eq!(snap.totals[&imported.occurrence_id], 7_000);
    assert!(snap.session.is_none(), "nothing starts on import");

    // History: the completion counts once as imported time.
    let history = h.service.history(None, None).await.unwrap();
    let m1 = history.rows.iter().find(|r| r.title == "Synthetic finished manual task").unwrap();
    assert_eq!((m1.imported_ms, m1.recorded_ms, m1.total_ms), (12_345, 0, 12_345));

    // Evidence: unresolved remote retained as a string; pending quarantined.
    let unresolved: Vec<String> = sqlx::query_scalar(
        "SELECT unresolved_task_id FROM focus_import_totals WHERE inclusion='unresolved'",
    )
    .fetch_all(&h.pool)
    .await
    .unwrap();
    assert_eq!(unresolved, vec![REMOTE.to_string()]);
    assert_eq!(
        count(&h.pool, "SELECT count(*) FROM focus_import_records WHERE status='quarantined' AND record_key LIKE 'pending:%'").await,
        2
    );
    assert_eq!(count(&h.pool, "SELECT count(*) FROM focus_import_totals WHERE inclusion='included'").await, 2);
}

#[tokio::test]
async fn repeated_import_is_a_noop_and_cumulative_snapshot_replaces() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    let id = command();
    commit_import(&h.pool, &files(), &preview.preview_token, &id).await.unwrap();
    // Same command after the fact returns the stored receipt.
    let again = commit_import(&h.pool, &files(), &preview.preview_token, &id).await.unwrap();
    assert!(again.replayed);
    // Same command ID with a different body is refused.
    assert!(commit_import(&h.pool, &files(), "other-token", &id).await.is_err());

    let tasks = count(&h.pool, "SELECT count(*) FROM local_tasks").await;
    let revision = h.snapshot().await.queue_revision;
    let repeat = preview_import(&h.pool, &files()).await.unwrap();
    assert!(repeat.noop, "identical files change nothing: {:?}", repeat.records);
    let result = commit_import(&h.pool, &files(), &repeat.preview_token, &command()).await.unwrap();
    assert!(result.noop && result.created_task_ids.is_empty());
    assert_eq!(count(&h.pool, "SELECT count(*) FROM local_tasks").await, tasks);
    assert_eq!(h.snapshot().await.queue_revision, revision);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM focus_import_batches").await, 1);

    // A later cumulative snapshot of the same timer replaces, never adds.
    let mut changed = files();
    changed.state_json = Some(fixture("state.json").replace("\"elapsedMs\": 5000", "\"elapsedMs\": 9000"));
    let preview = preview_import(&h.pool, &changed).await.unwrap();
    let timer = preview
        .contributions
        .iter()
        .find(|c| c.legacy_task_id == "manual:m2")
        .unwrap();
    assert_eq!((timer.duration_ms, timer.replaces_ms), (11_000, Some(7_000)));
    commit_import(&h.pool, &changed, &preview.preview_token, &command()).await.unwrap();
    let snap = h.snapshot().await;
    assert_eq!(snap.queue.len(), 1, "no duplicate queue entry");
    assert_eq!(snap.totals[&snap.queue[0].occurrence_id], 11_000);
    let completion: i64 = sqlx::query_scalar("SELECT sum(duration_ms) FROM focus_import_totals WHERE inclusion='included' AND source_kind='completion'")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(completion, 12_345);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM local_tasks").await, tasks);

    // A smaller cumulative total is a conflict for review, not a silent reset.
    let mut regressed = files();
    regressed.state_json = Some(fixture("state.json").replace("\"elapsedMs\": 5000", "\"elapsedMs\": 1000"));
    let preview = preview_import(&h.pool, &regressed).await.unwrap();
    assert!(preview.blocked);
    assert!(commit_import(&h.pool, &regressed, &preview.preview_token, &command()).await.is_err());
}

#[tokio::test]
async fn post_import_edits_are_kept_and_flagged_for_review() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap();
    let mut changed = files();
    changed.manual_json = Some(fixture("manual.json").replace("Synthetic open manual task", "Renamed in legacy app"));
    let preview = preview_import(&h.pool, &changed).await.unwrap();
    assert!(preview.issues.iter().any(|i| i.record_key.as_deref() == Some("task:manual:m2") && i.severity == ImportSeverity::Review));
    commit_import(&h.pool, &changed, &preview.preview_token, &command()).await.unwrap();
    let titles: Vec<String> = sqlx::query_scalar("SELECT content FROM local_tasks ORDER BY content").fetch_all(&h.pool).await.unwrap();
    assert!(titles.contains(&"Synthetic open manual task".to_string()));
    assert!(!titles.contains(&"Renamed in legacy app".to_string()));
}

#[tokio::test]
async fn stale_destination_or_changed_file_rejects_commit() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    let mut changed = files();
    changed.pending_json = Some("[]".into());
    let e = commit_import(&h.pool, &changed, &preview.preview_token, &command()).await.unwrap_err();
    assert!(e.to_string().contains("stale"), "{e}");

    let other = h.task("Queued after preview").await;
    h.send(FocusAction::Enqueue { task_ids: vec![other], source: FocusSource::Local, explicit_still_open: false })
        .await
        .unwrap();
    let e = commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap_err();
    assert!(e.to_string().contains("stale"), "{e}");
    assert_eq!(count(&h.pool, "SELECT count(*) FROM focus_import_batches").await, 0);
    let fresh = preview_import(&h.pool, &files()).await.unwrap();
    commit_import(&h.pool, &files(), &fresh.preview_token, &command()).await.unwrap();
}

#[tokio::test]
async fn failure_mid_commit_rolls_back_the_whole_batch() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    let before = h.snapshot().await;
    sqlx::query("CREATE TRIGGER fail_import BEFORE INSERT ON focus_import_totals BEGIN SELECT RAISE(ABORT,'injected failure'); END")
        .execute(&h.pool)
        .await
        .unwrap();
    let id = command();
    assert!(commit_import(&h.pool, &files(), &preview.preview_token, &id).await.is_err());
    for table in ["local_tasks", "focus_occurrences", "focus_import_batches", "focus_import_records", "focus_command_receipts"] {
        let rows = count(&h.pool, &format!("SELECT count(*) FROM {table}")).await;
        assert_eq!(rows, 0, "{table} kept partial import rows");
    }
    let tasks_logged = count(&h.pool, "SELECT count(*) FROM sync_log WHERE table_name='local_tasks'").await;
    assert_eq!(tasks_logged, 0);
    let after = h.snapshot().await;
    assert_eq!((after.queue_revision, after.engine_revision), (before.queue_revision, before.engine_revision));

    sqlx::query("DROP TRIGGER fail_import").execute(&h.pool).await.unwrap();
    commit_import(&h.pool, &files(), &preview.preview_token, &id).await.unwrap();
}

#[tokio::test]
async fn corrupt_values_are_evidence_without_fabricated_time() {
    let h = Harness::new().await;
    let state = r#"{
      "dateStamp": "2025-09-22", "source": {"kind": "manual"}, "queueIds": ["manual:m2"],
      "pulledInOverdueIds": [], "hasManuallyDragged": false, "completedToday": 0,
      "timers": {
        "manual:m2": {"taskId": "manual:m2", "elapsedMs": 4000, "startedAt": 1758542400000, "lastTickAt": null, "timeboxMs": null},
        "manual:gone": {"taskId": "manual:gone", "elapsedMs": 9000, "startedAt": 1758542400000, "lastTickAt": 1758542300000, "timeboxMs": null},
        "manual:neg": {"taskId": "manual:neg", "elapsedMs": -5, "startedAt": null, "lastTickAt": null, "timeboxMs": null}
      }
    }"#;
    let mut f = files();
    f.state_json = Some(state.into());
    f.manual_json = Some(fixture("manual.json").replace("\"order\": [\"manual:m2\"]", "\"order\": [\"manual:m2\", \"manual:missing\"]"));
    let preview = preview_import(&h.pool, &f).await.unwrap();
    // Missing heartbeat adds zero.
    let m2 = preview.contributions.iter().find(|c| c.legacy_task_id == "manual:m2").unwrap();
    assert_eq!((m2.duration_ms, m2.inclusion), (4_000, ImportInclusion::Included));
    // Impossible anchors and negative durations are quarantined, not zeroed.
    for key in ["timer:manual:gone", "timer:manual:neg"] {
        assert_eq!(record(&preview, key).status, ImportRecordStatus::Quarantined, "{key}");
        assert!(!preview.contributions.iter().any(|c| c.record_key == key && c.inclusion == ImportInclusion::Included));
    }
    assert_eq!(record(&preview, "timer:manual:neg").raw_evidence["elapsedMs"], -5);
    // A dangling order reference is surfaced, never an invented task.
    assert!(preview.issues.iter().any(|i| i.message.contains("manual:missing")));
    assert!(!preview.tasks.iter().any(|t| t.legacy_task_id == "manual:missing" && t.native_task_id.is_some()));

    // A numeric (precision-losing) ID is refused rather than parsed.
    let mut numeric = files();
    numeric.state_json = Some(fixture("state.json").replace("\"queueIds\": [\"90071992547409931234\"]", "\"queueIds\": [90071992547409931234]"));
    let preview = preview_import(&h.pool, &numeric).await.unwrap();
    assert!(preview.blocked);
}

#[tokio::test]
async fn duplicate_remote_matches_block_until_resolved() {
    let h = Harness::new().await;
    for title in ["Remote copy A", "Remote copy B"] {
        let id = h.task(title).await;
        sqlx::query("UPDATE local_tasks SET external_source='todoist',external_id=? WHERE id=?")
            .bind(REMOTE)
            .bind(&id)
            .execute(&h.pool)
            .await
            .unwrap();
    }
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    assert!(preview.blocked);
    assert!(preview.issues.iter().any(|i| i.severity == ImportSeverity::Blocking && i.message.contains(REMOTE)));
    assert!(commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.is_err());
}

#[tokio::test]
async fn matched_remote_task_is_reused_and_queued_in_source_order() {
    let h = Harness::new().await;
    let id = h.task("Remote task body").await;
    sqlx::query("UPDATE local_tasks SET external_source='todoist',external_id=? WHERE id=?")
        .bind(REMOTE)
        .bind(&id)
        .execute(&h.pool)
        .await
        .unwrap();
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    let order: Vec<_> = preview.merged_order.iter().map(|o| o.legacy_task_id.as_deref()).collect();
    assert_eq!(order, vec![Some(REMOTE), Some("manual:m2")]);
    commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap();
    let snap = h.snapshot().await;
    assert_eq!(snap.queue[0].task_id, id);
    assert_eq!(snap.totals[&snap.queue[0].occurrence_id], 60_000);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM local_tasks").await, 3);
}

#[tokio::test]
async fn running_session_blocks_import_until_paused() {
    let h = Harness::new().await;
    let task = h.task("Timing now").await;
    let reply = h
        .send(FocusAction::Enqueue { task_ids: vec![task], source: FocusSource::Local, explicit_still_open: false })
        .await
        .unwrap();
    let occurrence = reply.snapshot.queue[0].occurrence_id.clone();
    h.send(FocusAction::Start { occurrence_id: occurrence }).await.unwrap();
    h.advance(1_000).await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    assert!(preview.blocked);
    let e = h.service.commit_import(&files(), &preview.preview_token, &command()).await.unwrap_err();
    assert!(e.to_string().contains("running"), "{e}");
    h.send(FocusAction::Pause).await.unwrap();
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    assert!(!preview.blocked, "{:?}", preview.issues);
    let (result, snapshot) = h.service.commit_import(&files(), &preview.preview_token, &command()).await.unwrap();
    assert_eq!(result.created_task_ids.len(), 2);
    assert_eq!(snapshot.session.as_ref().map(|s| s.status), Some(nimble_core::focus_types::FocusStatus::Paused));
    assert_eq!(snapshot.queue.len(), 2);
}

#[tokio::test]
async fn later_legacy_completion_never_withdraws_imported_open_time() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap();
    let occurrence = h.snapshot().await.queue[0].occurrence_id.clone();
    assert_eq!(h.snapshot().await.totals[&occurrence], 7_000);

    // In Focus Queue, m2 then gained time and was completed.
    let mut later = files();
    later.state_json = Some(fixture("state.json").replace("\"elapsedMs\": 5000", "\"elapsedMs\": 9000"));
    later.manual_json = Some(fixture("manual.json")
        .replace("\"order\": [\"manual:m2\"]", "\"order\": []")
        .replace("{ \"id\": \"manual:m1\", \"spentMs\": 12345, \"completedAt\": 1758542400000 }",
            "{ \"id\": \"manual:m1\", \"spentMs\": 12345, \"completedAt\": 1758542400000 }, { \"id\": \"manual:m2\", \"spentMs\": 11000, \"completedAt\": 1758546000000 }"));
    let preview = preview_import(&h.pool, &later).await.unwrap();
    assert!(!preview.blocked, "{:?}", preview.issues);
    assert!(preview.issues.iter().any(|i| i.record_key.as_deref() == Some("timer:manual:m2")));
    commit_import(&h.pool, &later, &preview.preview_token, &command()).await.unwrap();
    let total: i64 = sqlx::query_scalar("SELECT COALESCE(sum(duration_ms),0) FROM focus_import_totals WHERE occurrence_id=? AND inclusion='included'")
        .bind(&occurrence).fetch_one(&h.pool).await.unwrap();
    assert_eq!(total, 7_000, "previously imported time stays on its occurrence");
    let completions: i64 = sqlx::query_scalar("SELECT COALESCE(sum(duration_ms),0) FROM focus_import_totals WHERE inclusion='included' AND source_kind='completion'")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(completions, 12_345, "the overlapping later completion is not added");
}

#[tokio::test]
async fn unknown_source_queue_ids_are_evidence_only() {
    let h = Harness::new().await;
    let id = h.task("Remote task body").await;
    sqlx::query("UPDATE local_tasks SET external_source='todoist',external_id=? WHERE id=?")
        .bind(REMOTE).bind(&id).execute(&h.pool).await.unwrap();
    for source in ["", "\"source\": { \"kind\": \"someday\" },"] {
        let mut f = files();
        f.state_json = Some(fixture("state.json").replace("\"source\": { \"kind\": \"today\" },", source));
        let preview = preview_import(&h.pool, &f).await.unwrap();
        let order: Vec<_> = preview.merged_order.iter().map(|o| o.legacy_task_id.as_deref()).collect();
        assert_eq!(order, vec![Some("manual:m2")], "source {source:?}");
        assert_eq!(preview.source_order, vec![REMOTE.to_string()]);
    }
}

#[tokio::test]
async fn same_files_under_another_namespace_are_blocked() {
    let h = Harness::new().await;
    let preview = preview_import(&h.pool, &files()).await.unwrap();
    commit_import(&h.pool, &files(), &preview.preview_token, &command()).await.unwrap();
    let tasks = count(&h.pool, "SELECT count(*) FROM local_tasks").await;
    let mut renamed = files();
    renamed.source_namespace = "Focus Queue".into();
    let preview = preview_import(&h.pool, &renamed).await.unwrap();
    assert!(preview.blocked);
    assert!(preview.issues.iter().any(|i| i.message.contains("\"fixture\"")), "{:?}", preview.issues);
    assert!(commit_import(&h.pool, &renamed, &preview.preview_token, &command()).await.is_err());
    // A later snapshot (different file hashes) is still caught by record fingerprints.
    renamed.state_json = Some(fixture("state.json").replace("\"elapsedMs\": 5000", "\"elapsedMs\": 9000"));
    renamed.pending_json = None;
    assert!(preview_import(&h.pool, &renamed).await.unwrap().blocked);
    assert_eq!(count(&h.pool, "SELECT count(*) FROM local_tasks").await, tasks);
}

/// Final review M-a: an identical duplicate completion entry (same id and
/// completedAt) is one completion: counted once in the preview and in
/// included_ms, with the duplicate kept as quarantined evidence.
#[tokio::test]
async fn duplicate_completion_key_counts_once_and_keeps_the_duplicate_as_evidence() {
    let h = Harness::new().await;
    let entry = "{ \"id\": \"manual:m1\", \"spentMs\": 12345, \"completedAt\": 1758542400000 }";
    let mut dup = files();
    dup.manual_json = Some(fixture("manual.json").replace(entry, &format!("{entry}, {entry}")));
    let preview = preview_import(&h.pool, &dup).await.unwrap();
    assert!(!preview.blocked, "{:?}", preview.issues);
    let included: Vec<_> = preview
        .contributions
        .iter()
        .filter(|c| c.source_kind == "completion" && c.inclusion == ImportInclusion::Included)
        .collect();
    assert_eq!(included.len(), 1, "{:?}", preview.contributions);
    let key = "completion:manual:m1:1758542400000";
    assert_eq!(record(&preview, key).status, ImportRecordStatus::Included);
    let duplicate = record(&preview, &format!("{key}:duplicate:1"));
    assert_eq!(duplicate.status, ImportRecordStatus::Quarantined);

    let (result, _) = h.service.commit_import(&dup, &preview.preview_token, &command()).await.unwrap();
    let stored: i64 = sqlx::query_scalar("SELECT COALESCE(sum(duration_ms),0) FROM focus_import_totals WHERE inclusion='included'")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(result.included_ms, stored as u64, "result matches what was stored");
    let completions: i64 = sqlx::query_scalar("SELECT COALESCE(sum(duration_ms),0) FROM focus_import_totals WHERE inclusion='included' AND source_kind='completion'")
        .fetch_one(&h.pool).await.unwrap();
    assert_eq!(completions, 12_345);
}
