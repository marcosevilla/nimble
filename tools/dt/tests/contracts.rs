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
