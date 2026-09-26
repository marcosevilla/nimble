use serde_json::{json, Value};
use std::{path::PathBuf, process::Command};

fn invoke(args: &[&str]) -> (i32, Value) {
    let out = Command::new(env!("CARGO_BIN_EXE_dt"))
        .args(args)
        .output()
        .unwrap();
    let value = serde_json::from_slice(&out.stdout).unwrap_or(json!({"invalid_json":true}));
    (out.status.code().unwrap(), value)
}

#[test]
fn unknown_argument_has_json_error() {
    let (code, out) = invoke(&["--json", "--bad-flag"]);
    assert_eq!(code, 2);
    assert_eq!(out["error"]["code"], "validation");
}

async fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!("nimble-cli-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("synthetic-profile"), "nimble-synthetic-only\n").unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(root.join("nimble.db"))
        .create_if_missing(true);
    let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
    nimble_core::db::migrations::run_migrations(&pool)
        .await
        .unwrap();
    pool.close().await;
    root
}
fn run(root: &std::path::Path, args: &[&str]) -> (i32, Value) {
    let mut all = vec!["--json", "--profile", root.to_str().unwrap()];
    all.extend(args);
    invoke(&all)
}
#[test]
fn missing_profile_does_not_create_database() {
    let root = std::env::temp_dir().join(format!("nimble-absent-{}", uuid::Uuid::new_v4()));
    let (code, out) = run(&root, &["task", "list"]);
    assert_eq!(code, 1);
    assert_eq!(out["ok"], false);
    assert!(!root.exists());
}
#[tokio::test]
async fn committed_task_succeeds_with_app_closed_and_preserves_fields() {
    let root = fixture().await;
    let (code, p) = run(
        &root,
        &["project", "create", "Synthetic", "--color", "blue"],
    );
    assert_eq!(code, 0, "{p}");
    let pid = p["data"]["id"].as_str().unwrap();
    let (_, l) = run(&root, &["label", "create", "Focus", "--color", "blue"]);
    let lid = l["data"]["id"].as_str().unwrap();
    let (code, t) = run(
        &root,
        &[
            "task",
            "create",
            "Parent",
            "--project",
            pid,
            "--due",
            "2030-01-01",
            "--time",
            "09:00",
            "--duration",
            "30",
            "--labels",
            lid,
        ],
    );
    assert_eq!(code, 0, "{t}");
    assert_eq!(t["refresh"], "app_not_running");
    let id = t["data"]["id"].as_str().unwrap();
    for name in ["One", "Two", "Three"] {
        let (c, v) = run(
            &root,
            &["task", "create", name, "--parent", id, "--project", pid],
        );
        assert_eq!(c, 0, "{v}");
    }
    let (c, v) = run(&root, &["task", "update", id, "--description", "updated"]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["due_time"], "09:00");
    assert_eq!(v["data"]["labels"][0], lid);
    let (_, all) = run(&root, &["task", "list"]);
    assert_eq!(all["data"].as_array().unwrap().len(), 4);
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("nimble.db")),
    )
    .await
    .unwrap();
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_log WHERE table_name='local_tasks'")
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(n >= 5);
    db.close().await;
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn gap_and_capture_are_persisted_and_backup_requires_app() {
    let root = fixture().await;
    let (c, v) = run(&root, &["gap", "Missing useful view"]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(
        &root,
        &["gap", "list", "--from", "2000-01-01", "--to", "2099-01-01"],
    );
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"].as_array().unwrap().len(), 1);
    let (c, v) = run(
        &root,
        &["capture", "create", "Idea", "--context", "fixture"],
    );
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["context"], "fixture");
    let (c, v) = run(&root, &["backup", "now"]);
    assert_eq!(c, 1);
    assert_eq!(v["error"]["code"], "app_required");
    // Restored-profile activation re-initializes the running app's focus
    // ownership, so it is app-only too (never a direct DB write).
    let (c, v) = run(&root, &["backup", "activate"]);
    assert_eq!(c, 1, "{v}");
    assert_eq!(v["error"]["code"], "app_required");
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn mismatched_schema_and_invalid_input_fail_before_mutation() {
    let root = fixture().await;
    let (c, v) = run(&root, &["task", "create", "Bad", "--due", "not-a-date"]);
    assert_eq!(c, 2, "{v}");
    let (c, v) = run(
        &root,
        &[
            "task",
            "update",
            "missing",
            "--due",
            "2030-01-01",
            "--clear-due-date",
        ],
    );
    assert_eq!(c, 2, "{v}");
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("nimble.db")),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO schema_version(version, description) VALUES (999,'test')")
        .execute(&db)
        .await
        .unwrap();
    db.close().await;
    let (c, v) = run(&root, &["task", "create", "No"]);
    assert_eq!(c, 1);
    assert_eq!(v["error"]["code"], "schema_mismatch");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn domains_and_status_round_trip_through_core() {
    let root = fixture().await;
    let (_, p) = run(&root, &["project", "create", "Parent"]);
    let pid = p["data"]["id"].as_str().unwrap();
    let (_, child) = run(&root, &["project", "create", "Child", "--parent", pid]);
    let childid = child["data"]["id"].as_str().unwrap();
    let (c, _) = run(&root, &["project", "update", pid, "--parent", childid]);
    assert_ne!(c, 0);
    let (c, v) = run(
        &root,
        &[
            "project",
            "update",
            childid,
            "--clear-parent",
            "--name",
            "Renamed",
        ],
    );
    assert_eq!(c, 0, "{v}");
    let (_, s) = run(&root, &["section", "create", "Lane", "--project", pid]);
    let sid = s["data"]["id"].as_str().unwrap();
    let (c, v) = run(&root, &["section", "rename", sid, "Renamed lane"]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(&root, &["section", "reorder", "--ids", sid]);
    assert_eq!(c, 0, "{v}");
    let (_, label) = run(&root, &["label", "create", "A"]);
    let lid = label["data"]["id"].as_str().unwrap();
    let (c, v) = run(&root, &["label", "update", lid, "--name", "B"]);
    assert_eq!(c, 0, "{v}");
    let (_, t) = run(
        &root,
        &[
            "task",
            "create",
            "Scheduled",
            "--project",
            pid,
            "--section",
            sid,
            "--due",
            "2030-01-01",
            "--time",
            "09:00",
            "--reminder-offset",
            "30",
        ],
    );
    let id = t["data"]["id"].as_str().unwrap();
    let ids = format!("{lid},{lid}");
    let (c, v) = run(&root, &["task", "labels", id, "--ids", &ids]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["labels"].as_array().unwrap().len(), 1);
    let (c, v) = run(
        &root,
        &["task", "status", id, "blocked", "--reason", "fixture"],
    );
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["status"], "blocked");
    let (c, v) = run(&root, &["task", "complete", id]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["completed"], true);
    let (c, v) = run(&root, &["task", "reopen", id]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["completed"], false);
    let (c, v) = run(
        &root,
        &[
            "task",
            "update",
            id,
            "--clear-reminder",
            "--clear-due-time",
            "--clear-section",
            "--clear-labels",
        ],
    );
    assert_eq!(c, 0, "{v}");
    assert!(v["data"]["reminder_offset_minutes"].is_null());
    assert!(v["data"]["due_time"].is_null());
    let (c, v) = run(&root, &["section", "delete", sid]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(&root, &["label", "delete", lid]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(&root, &["task", "delete", id]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(&root, &["task", "get", id]);
    assert_eq!(c, 1);
    assert_eq!(v["error"]["code"], "not_found");
    let (c, v) = run(&root, &["project", "delete", childid]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(&root, &["sync", "status"]);
    assert_eq!(c, 0, "{v}");
    let (c, v) = run(
        &root,
        &[
            "activity",
            "list",
            "--from",
            "2000-01-01",
            "--to",
            "2099-01-01",
        ],
    );
    assert_eq!(c, 0, "{v}");
    assert!(!v["data"].as_array().unwrap().is_empty());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn profile_rejects_unmarked_demo_and_symlink_database() {
    let root = fixture().await;
    std::fs::remove_file(root.join("synthetic-profile")).unwrap();
    let (c, v) = run(&root, &["task", "list"]);
    assert_eq!(c, 1, "{v}");
    std::fs::write(root.join("synthetic-profile"), "nimble-synthetic-only\n").unwrap();
    std::fs::write(root.join("demo-mode"), "").unwrap();
    let (c, v) = run(&root, &["task", "list"]);
    assert_eq!(c, 1, "{v}");
    std::fs::remove_file(root.join("demo-mode")).unwrap();
    std::fs::rename(root.join("nimble.db"), root.join("real.db")).unwrap();
    std::os::unix::fs::symlink(root.join("real.db"), root.join("nimble.db")).unwrap();
    let (c, v) = run(&root, &["task", "list"]);
    assert_eq!(c, 1, "{v}");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn invalidation_acknowledgement_and_wrong_response_never_duplicate_write() {
    use nimble_core::agent_protocol::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::io::AsyncWriteExt;
    let root = fixture().await;
    let profile = AgentProfile::from_database(&root.join("nimble.db"), true).unwrap();
    profile.ensure_socket_directory().unwrap();
    let listener = tokio::net::UnixListener::bind(&profile.socket).unwrap();
    std::fs::set_permissions(&profile.socket, std::fs::Permissions::from_mode(0o600)).unwrap();
    let server = tokio::spawn(async move {
        for mismatch in [false, true] {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request: AgentRequest =
                serde_json::from_slice(&read_frame(&mut stream).await.unwrap()).unwrap();
            assert!(matches!(
                request.operation,
                AgentOperation::Invalidate { .. }
            ));
            let response = AgentResponse {
                version: VERSION,
                request_id: if mismatch {
                    "wrong".into()
                } else {
                    request.request_id
                },
                ok: true,
                data: Some(json!({"emitted":true})),
                error: None,
            };
            let mut bytes = serde_json::to_vec(&response).unwrap();
            bytes.push(b'\n');
            stream.write_all(&bytes).await.unwrap();
        }
    });
    let path = root.clone();
    let (c, v) =
        tokio::task::spawn_blocking(move || run(&path, &["capture", "create", "Acknowledged"]))
            .await
            .unwrap();
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["refresh"], "acknowledged");
    let path = root.clone();
    let (c, v) =
        tokio::task::spawn_blocking(move || run(&path, &["capture", "create", "Unacknowledged"]))
            .await
            .unwrap();
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["refresh"], "unavailable");
    server.await.unwrap();
    let (_, v) = run(&root, &["capture", "list"]);
    assert_eq!(v["data"].as_array().unwrap().len(), 2);
    std::fs::remove_file(&profile.socket).unwrap();
    std::fs::remove_dir(profile.socket.parent().unwrap()).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn gap_write_failure_is_not_reported_as_success() {
    let pool = nimble_core::test_util::test_pool().await;
    sqlx::query("DROP TABLE activity_log")
        .execute(&pool)
        .await
        .unwrap();
    assert!(nimble_core::db::activity::record_activity(
        &pool,
        "nimble_gap",
        None,
        Some(json!({"reason":"test"}))
    )
    .await
    .is_err());
}

#[tokio::test]
async fn task_mutation_feeds_existing_todoist_outbox_without_network() {
    let root = fixture().await;
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("nimble.db")),
    )
    .await
    .unwrap();
    nimble_core::integrations::set_enabled(&db, "todoist", true)
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(&db, "todoist_api_token", "synthetic-not-a-credential")
        .await
        .unwrap();
    let (code, value) = run(&root, &["task", "create", "Observed synthetic task"]);
    assert_eq!(code, 0, "{value}");
    let id = value["data"]["id"].as_str().unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id = ?")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    assert!(count > 0);
    db.close().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn a_rule_todoist_owns_is_read_only_while_sync_is_on() {
    let root = fixture().await;
    let db = sqlx::SqlitePool::connect_with(
        sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("nimble.db")),
    )
    .await
    .unwrap();
    nimble_core::integrations::set_enabled(&db, "todoist", true).await.unwrap();
    nimble_core::db::settings::set_setting(&db, "todoist_api_token", "synthetic-not-a-credential").await.unwrap();
    let snapshot = json!({"content": "Pay", "due_date": "2026-10-06", "checked": false,
        "due": {"date": "2026-10-06", "string": "every month", "is_recurring": true}});
    sqlx::query("INSERT INTO local_tasks (id, content, due_date, recurrence_rule, external_id, external_source, synced_snapshot) VALUES ('t1', 'Pay', '2026-10-06', 'every month', 'R1', 'todoist', ?)")
        .bind(snapshot.to_string()).execute(&db).await.unwrap();
    for args in [&["task", "update", "t1", "--recurrence", "every week"][..], &["task", "update", "t1", "--clear-recurrence"][..]] {
        let (code, value) = run(&root, args);
        assert_eq!((code, value["error"]["code"].as_str()), (2, Some("validation")), "{value}");
        assert!(value["error"]["message"].as_str().unwrap().contains("Todoist"), "{value}");
    }
    let rule: Option<String> = sqlx::query_scalar("SELECT recurrence_rule FROM local_tasks WHERE id = 't1'").fetch_one(&db).await.unwrap();
    assert_eq!(rule.as_deref(), Some("every month"));
    let queued: i64 = sqlx::query_scalar("SELECT count(*) FROM todoist_outbox WHERE local_id = 't1'").fetch_one(&db).await.unwrap();
    assert_eq!(queued, 0);
    // Other fields stay editable; with sync off the rule is Nimble's again.
    let (code, value) = run(&root, &["task", "update", "t1", "--description", "autopay"]);
    assert_eq!(code, 0, "{value}");
    nimble_core::integrations::set_enabled(&db, "todoist", false).await.unwrap();
    let (code, value) = run(&root, &["task", "update", "t1", "--recurrence", "every week"]);
    assert_eq!(code, 0, "{value}");
    db.close().await;
    std::fs::remove_dir_all(root).unwrap();
}

/// A fake app endpoint that answers each NativeTask request with `reply`.
/// `None` reads the request and hangs up without answering (uncertain).
async fn native_server(
    root: &std::path::Path,
    replies: Vec<Option<fn(&nimble_core::db::focus::engine::NativeTaskCommand) -> (bool, Value)>>,
) -> (
    nimble_core::agent_protocol::AgentProfile,
    tokio::task::JoinHandle<Vec<nimble_core::db::focus::engine::NativeTaskCommand>>,
) {
    use nimble_core::agent_protocol::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::io::AsyncWriteExt;
    let profile = AgentProfile::from_database(&root.join("nimble.db"), true).unwrap();
    profile.ensure_socket_directory().unwrap();
    let listener = tokio::net::UnixListener::bind(&profile.socket).unwrap();
    std::fs::set_permissions(&profile.socket, std::fs::Permissions::from_mode(0o600)).unwrap();
    let server = tokio::spawn(async move {
        let mut seen = vec![];
        for reply in replies {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request: AgentRequest =
                serde_json::from_slice(&read_frame(&mut stream).await.unwrap()).unwrap();
            let AgentOperation::NativeTask { command } = request.operation else {
                panic!("task writes must route through the app's focus service");
            };
            if let Some(reply) = reply {
                let (ok, data) = reply(&command);
                let response = AgentResponse {
                    version: VERSION,
                    request_id: request.request_id,
                    ok,
                    data: Some(data),
                    error: if ok { None } else { Some("rejected".into()) },
                };
                let mut bytes = serde_json::to_vec(&response).unwrap();
                bytes.push(b'\n');
                stream.write_all(&bytes).await.unwrap();
            }
            seen.push(command);
        }
        seen
    });
    (profile, server)
}

fn cleanup(profile: &nimble_core::agent_protocol::AgentProfile, root: &std::path::Path) {
    let _ = std::fs::remove_file(&profile.socket);
    let _ = std::fs::remove_dir(profile.socket.parent().unwrap());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn running_app_executes_task_writes_through_its_service() {
    let root = fixture().await;
    let (profile, server) = native_server(
        &root,
        vec![Some(|_| (true, json!({"task": {"id": "from-app", "content": "App wrote"}, "replayed": false})))],
    )
    .await;
    let path = root.clone();
    let (c, v) = tokio::task::spawn_blocking(move || run(&path, &["task", "create", "App wrote"]))
        .await
        .unwrap();
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["refresh"], "acknowledged");
    assert_eq!(v["data"]["id"], "from-app");
    let seen = server.await.unwrap();
    assert!(uuid::Uuid::parse_str(&seen[0].command_id).is_ok());
    // dt never wrote the row itself: the (fake) app owns the write.
    let (_, list) = run(&root, &["task", "list"]);
    assert_eq!(list["data"].as_array().unwrap().len(), 0);
    cleanup(&profile, &root);
}

#[tokio::test]
async fn uncertain_app_reply_never_falls_back_and_names_the_retry_id() {
    let root = fixture().await;
    let (profile, server) = native_server(&root, vec![None]).await;
    let path = root.clone();
    let (c, v) = tokio::task::spawn_blocking(move || run(&path, &["task", "create", "Maybe"]))
        .await
        .unwrap();
    assert_eq!(c, 1, "{v}");
    assert_eq!(v["error"]["code"], "uncertain");
    let seen = server.await.unwrap();
    let message = v["error"]["message"].as_str().unwrap();
    assert!(message.contains(&format!("--command-id {}", seen[0].command_id)), "{message}");
    let (_, list) = run(&root, &["task", "list"]);
    assert_eq!(list["data"].as_array().unwrap().len(), 0, "no direct-DB fallback");
    cleanup(&profile, &root);
}

#[tokio::test]
async fn retry_reuses_command_id_and_typed_rejection_is_reported() {
    let root = fixture().await;
    let (_, t) = run(&root, &["task", "create", "Recurring", "--due", "2030-01-01", "--recurrence", "every day"]);
    let id = t["data"]["id"].as_str().unwrap().to_owned();
    let (profile, server) = native_server(
        &root,
        vec![Some(|_| (false, json!({"code": "stale_occurrence", "message": "date moved"})))],
    )
    .await;
    let retry = uuid::Uuid::new_v4().to_string();
    let (path, task_id, retry_id) = (root.clone(), id.clone(), retry.clone());
    let (c, v) = tokio::task::spawn_blocking(move || {
        run(&path, &["task", "complete", &task_id, "--command-id", &retry_id, "--expected-due", "2030-01-01"])
    })
    .await
    .unwrap();
    assert_eq!(c, 1, "{v}");
    assert_eq!(v["error"]["code"], "stale_occurrence");
    let seen = server.await.unwrap();
    assert_eq!(seen[0].command_id, retry);
    let body = serde_json::to_value(&seen[0].action).unwrap();
    assert_eq!(body["expected_due_date"], "2030-01-01");
    cleanup(&profile, &root);
}

#[tokio::test]
async fn retry_without_the_app_is_refused_instead_of_written_directly() {
    let root = fixture().await;
    let (_, t) = run(&root, &["task", "create", "Once"]);
    let id = t["data"]["id"].as_str().unwrap().to_owned();
    let retry = uuid::Uuid::new_v4().to_string();
    let (c, v) = run(&root, &["task", "complete", &id, "--command-id", &retry]);
    assert_eq!(c, 1, "{v}");
    assert_eq!(v["error"]["code"], "app_required");
    let (_, got) = run(&root, &["task", "get", &id]);
    assert_eq!(got["data"]["completed"], false);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn direct_complete_with_app_closed_refuses_an_already_advanced_occurrence() {
    let root = fixture().await;
    let (_, t) = run(&root, &["task", "create", "Recurring", "--due", "2030-01-01", "--recurrence", "every day"]);
    let id = t["data"]["id"].as_str().unwrap().to_owned();
    // First completion (app closed) advances the occurrence.
    let (c, v) = run(&root, &["task", "complete", &id, "--expected-due", "2030-01-01"]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["refresh"], "app_not_running");
    let advanced = v["data"]["due_date"].as_str().unwrap().to_owned();
    assert_ne!(advanced, "2030-01-01");
    // A second completion naming the old occurrence must not advance again.
    for args in [
        vec!["task", "complete", id.as_str(), "--expected-due", "2030-01-01"],
        vec!["task", "status", id.as_str(), "complete", "--expected-due", "2030-01-01"],
    ] {
        let (c, v) = run(&root, &args);
        assert_eq!(c, 1, "{v}");
        assert_eq!(v["error"]["code"], "stale_occurrence");
    }
    let (_, got) = run(&root, &["task", "get", &id]);
    assert_eq!(got["data"]["due_date"], advanced.as_str());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn running_owner_with_unreachable_listener_blocks_direct_writes() {
    let root = fixture().await;
    let (_, t) = run(&root, &["task", "create", "Owned"]);
    let id = t["data"]["id"].as_str().unwrap().to_owned();
    // The app holds the profile but its local listener never started.
    let owner = nimble_core::agent_protocol::ProfileOwnerLock::acquire(&root.join("nimble.db")).unwrap();
    let (c, v) = run(&root, &["task", "complete", &id]);
    assert_eq!(c, 1, "{v}");
    assert_eq!(v["error"]["code"], "app_unreachable");
    let (_, got) = run(&root, &["task", "get", &id]);
    assert_eq!(got["data"]["completed"], false, "no direct write behind a running owner");
    // Once the owner exits, the direct path is available again.
    drop(owner);
    let (c, v) = run(&root, &["task", "complete", &id]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["refresh"], "app_not_running");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn reconcile_without_a_token_fails_before_any_fetch_or_write() {
    let root = fixture().await;
    for args in [&["sync", "reconcile"][..], &["sync", "reconcile", "--apply"][..]] {
        let (code, out) = run(&root, args);
        assert_eq!(code, 1, "{out}");
        assert_eq!(out["ok"], false);
        assert_eq!(out["error"]["code"], "reconcile_failed");
        assert!(
            out["error"]["message"].as_str().unwrap().contains("todoist_api_token"),
            "{out}"
        );
    }
    let reports = std::fs::read_dir(&root)
        .unwrap()
        .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().starts_with("reconcile-"))
        .count();
    assert_eq!(reports, 0, "no report without a fetch");
    std::fs::remove_dir_all(&root).ok();
}

fn data_id(v: &Value) -> String {
    v["data"]["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn label_groups_archive_restore_and_search_round_trip() {
    let root = fixture().await;
    let (_, deep) = run(&root, &["label", "create", "deep"]);
    run(&root, &["label", "create", "quick"]);
    run(&root, &["label", "create", "Comms"]);
    run(&root, &["label", "create", "comms"]); // UNIQUE is case-sensitive, so this is allowed

    let (code, effort) = run(&root, &["label", "group", "create", "EFFORT", "--pick-one"]);
    assert_eq!(code, 0, "{effort}");
    assert_eq!(effort["data"]["exclusive"], true);
    let (_, again) = run(&root, &["label", "group", "create", "effort"]);
    assert_eq!(data_id(&again), data_id(&effort), "create reuses a group by name");
    assert_eq!(again["data"]["exclusive"], true, "a re-run never switches a flag off");
    let (_, system) = run(&root, &["label", "group", "create", "SYSTEM", "--system"]);
    assert_eq!(system["data"]["system"], true);
    let (_, groups) = run(&root, &["label", "group", "list"]);
    assert_eq!(groups["data"].as_array().unwrap().len(), 2);

    let (code, assigned) = run(&root, &["label", "group", "assign", "DEEP", "Effort"]);
    assert_eq!(code, 0, "{assigned}");
    assert_eq!(assigned["data"]["group"], data_id(&effort).as_str());
    let (code, ambiguous) = run(&root, &["label", "group", "assign", "COMMS", "effort"]);
    assert_eq!((code, ambiguous["error"]["code"].as_str()), (2, Some("validation")), "{ambiguous}");
    let (code, exact) = run(&root, &["label", "group", "assign", "comms", "effort"]);
    assert_eq!(code, 0, "an exact-case name wins over its case-insensitive twin: {exact}");
    assert_eq!(exact["data"]["name"], "comms");
    let (code, missing) = run(&root, &["label", "archive", "nope"]);
    assert_eq!((code, missing["error"]["code"].as_str()), (1, Some("not_found")), "{missing}");

    let (_, task) = run(&root, &["task", "create", "Update portfolio", "--labels", &data_id(&deep)]);
    let (_, unused) = run(&root, &["label", "unused"]);
    let names: Vec<&str> = unused["data"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"quick") && !names.contains(&"deep"), "{names:?}");

    let (code, archived) = run(&root, &["label", "archive", "--unused"]);
    assert_eq!(code, 0, "{archived}");
    assert_eq!(archived["data"].as_array().unwrap().len(), 2, "quick, Comms (comms is grouped now, so never archived)");
    let (code, restored) = run(&root, &["label", "restore", "quick"]);
    assert_eq!(code, 0, "{restored}");
    assert!(restored["data"][0]["archived_at"].is_null());

    let (_, done) = run(&root, &["task", "create", "Old portfolio draft"]);
    let (code, c) = run(&root, &["task", "complete", &data_id(&done)]);
    assert_eq!(code, 0, "{c}");
    let (code, hits) = run(&root, &["task", "search", "portf"]);
    assert_eq!(code, 0, "{hits}");
    let titles: Vec<&str> = hits["data"].as_array().unwrap().iter().map(|h| h["task"]["content"].as_str().unwrap()).collect();
    assert_eq!(titles, ["Update portfolio", "Old portfolio draft"], "open first, completed included");
    let (_, completed) = run(&root, &["task", "search", "portfolio", "--status", "completed"]);
    assert_eq!(completed["data"].as_array().unwrap().len(), 1);
    let (_, by_label) = run(&root, &["task", "search", "portfolio", "--label", "DEEP"]);
    assert_eq!(by_label["data"][0]["task"]["id"], data_id(&task).as_str());
    let (code, reindexed) = run(&root, &["task", "search", "--reindex"]);
    assert_eq!(code, 0, "{reindexed}");
    assert_eq!(reindexed["data"]["reindexed"], 2);
    let (code, bad) = run(&root, &["task", "search"]);
    assert_eq!((code, bad["error"]["code"].as_str()), (2, Some("validation")));
}

#[tokio::test]
async fn seed_script_is_idempotent_and_keeps_taxonomy_labels_visible() {
    let root = fixture().await;
    // Marco 2026-09-25: the seed matches exact (plain) names only; emoji
    // near-duplicates stay ungrouped and, with no open task, get archived.
    for name in ["deep", "quick", "comms", "admin", "🛟 admin", "📸 photography", "🚗 errands", "from-instinct", "stale-idea"] {
        run(&root, &["label", "create", name]);
    }
    let (_, deep) = run(&root, &["label", "list"]);
    let deep_id = deep["data"].as_array().unwrap().iter().find(|l| l["name"] == "deep").unwrap()["id"].as_str().unwrap().to_string();
    run(&root, &["task", "create", "Focus block", "--labels", &deep_id]);

    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/seed-label-groups.sh");
    for pass in 0..2 {
        let out = Command::new("bash")
            .arg(script)
            .args(["--profile", root.to_str().unwrap()])
            .env("DT", env!("CARGO_BIN_EXE_dt"))
            .env("SKIP_BACKUP", "1")
            .output()
            .unwrap();
        assert!(out.status.success(), "pass {pass}: {}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    }
    let (_, groups) = run(&root, &["label", "group", "list"]);
    let groups = groups["data"].as_array().unwrap();
    let names: Vec<&str> = groups.iter().map(|g| g["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["EFFORT", "TYPE", "STATE", "ASSIST", "SYSTEM"]);
    assert_eq!(groups[0]["exclusive"], true);
    assert_eq!(groups[4]["system"], true);
    let (_, labels) = run(&root, &["label", "list"]);
    let labels = labels["data"].as_array().unwrap();
    let mut archived: Vec<&str> = labels.iter()
        .filter(|l| !l["archived_at"].is_null()).map(|l| l["name"].as_str().unwrap()).collect();
    archived.sort();
    assert_eq!(archived, ["stale-idea", "🛟 admin"], "grouped labels stay visible even with no open tasks");
    let group_of = |name: &str| labels.iter().find(|l| l["name"] == name).unwrap()["group"].clone();
    let type_id = groups[1]["id"].clone();
    assert_eq!(group_of("admin"), type_id, "the plain name is grouped");
    assert!(group_of("🛟 admin").is_null(), "the emoji variant is left ungrouped");
    assert_eq!(group_of("📸 photography"), type_id, "emoji names in the list are grouped exactly");
    assert_eq!(group_of("🚗 errands"), type_id);
}

fn seed_script(root: &std::path::Path, dt: &str, extra: &[&str]) -> std::process::Output {
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tools/seed-label-groups.sh");
    Command::new("bash")
        .arg(script)
        .args(["--profile", root.to_str().unwrap()])
        .args(extra)
        .env("DT", dt)
        .env("SKIP_BACKUP", "1")
        .output()
        .unwrap()
}

#[tokio::test]
async fn seed_script_dry_run_prints_the_plan_and_writes_nothing() {
    let root = fixture().await;
    for name in ["deep", "quick", "stale-idea", "🛟 admin", "🚗 errands", "📸 photography"] {
        run(&root, &["label", "create", name]);
    }
    let out = seed_script(&root, env!("CARGO_BIN_EXE_dt"), &["--dry-run"]);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}{}", String::from_utf8_lossy(&out.stderr));
    assert!(stdout.contains("would create group EFFORT --pick-one"), "{stdout}");
    assert!(stdout.contains("would put deep → EFFORT"), "{stdout}");
    assert!(stdout.contains("warning: skipped comms"), "{stdout}");
    assert!(stdout.contains("would put 🚗 errands → TYPE") && stdout.contains("would put 📸 photography → TYPE"), "{stdout}");
    assert!(!stdout.contains("skipped 🚗") && !stdout.contains("skipped 📸"), "{stdout}");
    assert!(stdout.contains("would archive 2: stale-idea, 🛟 admin") || stdout.contains("would archive 2: 🛟 admin, stale-idea"), "{stdout}");
    let (_, groups) = run(&root, &["label", "group", "list"]);
    assert!(groups["data"].as_array().unwrap().is_empty(), "dry run created no group");
    let (_, labels) = run(&root, &["label", "list"]);
    assert!(labels["data"].as_array().unwrap().iter().all(|l| l["archived_at"].is_null() && l["group"].is_null()));
}

#[tokio::test]
async fn seed_script_stops_before_archiving_when_an_assignment_fails() {
    use std::os::unix::fs::PermissionsExt;
    let root = fixture().await;
    for name in ["deep", "stale-idea"] {
        run(&root, &["label", "create", name]);
    }
    // A dt that fails every `label group assign` and passes everything else through.
    let fake = root.join("fake-dt.sh");
    std::fs::write(&fake, format!(
        "#!/usr/bin/env bash\nfor a in \"$@\"; do if [ \"$a\" = assign ]; then echo '{{\"version\":1,\"ok\":false,\"error\":{{\"code\":\"internal\",\"message\":\"injected\"}}}}'; exit 1; fi; done\nexec \"{}\" \"$@\"\n",
        env!("CARGO_BIN_EXE_dt")
    )).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let out = seed_script(&root, fake.to_str().unwrap(), &[]);
    assert_eq!(out.status.code(), Some(1), "{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stderr).contains("Stopping before archiving"));
    let (_, labels) = run(&root, &["label", "list"]);
    assert!(labels["data"].as_array().unwrap().iter().all(|l| l["archived_at"].is_null()), "nothing archived");
}

#[tokio::test]
async fn momentum_backfill_is_direct_and_idempotent() {
    let root = fixture().await;
    let (c, t) = run(&root, &["task", "create", "Ship it", "--priority", "3"]);
    assert_eq!(c, 0, "{t}");
    let id = t["data"]["id"].as_str().unwrap().to_owned();
    let (c, v) = run(&root, &["task", "complete", &id]);
    assert_eq!(c, 0, "{v}");
    // The completion hook already wrote the ledger row: nothing new to backfill.
    let (c, v) = run(&root, &["momentum", "backfill"]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["tasks"], 0);
    // A completion from before the ledger existed is picked up exactly once.
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("nimble.db"));
    let pool = sqlx::SqlitePool::connect_with(options).await.unwrap();
    sqlx::query("INSERT INTO local_tasks (id, content, project_id, status, completed, completed_at) VALUES ('legacy', 'Old', 'inbox', 'complete', 1, '2026-09-01 10:00:00')")
        .execute(&pool).await.unwrap();
    pool.close().await;
    let (_, v) = run(&root, &["momentum", "backfill"]);
    assert_eq!(v["data"]["tasks"], 1, "{v}");
    let (_, v) = run(&root, &["momentum", "backfill"]);
    assert_eq!(v["data"]["tasks"], 0, "{v}");
    let (c, v) = run(&root, &["momentum", "summary", "--range", "all"]);
    assert_eq!(c, 0, "{v}");
    assert_eq!(v["data"]["stats"]["completed"], 2);
    let (c, v) = run(&root, &["momentum", "summary", "--range", "year"]);
    assert_eq!((c, v["error"]["code"].as_str()), (2, Some("validation")));
    std::fs::remove_dir_all(root).unwrap();
}
