use nimble_core::db::{labels, origin_label, tasks};
use nimble_core::test_util::test_pool;

async fn enable_todoist(pool: &sqlx::SqlitePool) {
    nimble_core::integrations::ensure_state(pool, "todoist").await.unwrap();
    sqlx::query("UPDATE integration_sync_state SET enabled = 1 WHERE provider='todoist'")
        .execute(pool)
        .await
        .unwrap();
    nimble_core::db::settings::set_setting(pool, "todoist_api_token", "tok")
        .await
        .unwrap();
}

/// `labels::labels_for_task` returns label ids (see its own doc comment),
/// not names — resolve through `names_for_ids` before comparing against
/// `ORIGIN_LABEL`.
async fn names_on_task(pool: &sqlx::SqlitePool, task_id: &str) -> Vec<String> {
    let ids = labels::labels_for_task(pool, task_id).await.unwrap();
    labels::names_for_ids(pool, &ids).await.unwrap()
}

#[tokio::test]
async fn v22_adds_archived_at() {
    let pool = test_pool().await;
    let v: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(v, 22);
    let p = nimble_core::db::projects::get_projects(&pool).await.unwrap();
    assert!(p.iter().find(|p| p.id == "inbox").unwrap().archived_at.is_none());
}

#[tokio::test]
async fn nimble_created_task_gets_origin_label_while_todoist_sync_is_on() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    let t = tasks::create_local_task(
        &pool,
        serde_json::from_value(serde_json::json!({"content": "made here"})).unwrap(),
    )
    .await
    .unwrap();
    let names = names_on_task(&pool, &t.id).await;
    assert!(names.contains(&origin_label::ORIGIN_LABEL.to_string()), "got {names:?}");
}

#[tokio::test]
async fn no_origin_label_when_todoist_sync_is_off() {
    // After cutover (sync off / no token) the auto-label stops by itself.
    let pool = test_pool().await;
    let t = tasks::create_local_task(
        &pool,
        serde_json::from_value(serde_json::json!({"content": "post cutover"})).unwrap(),
    )
    .await
    .unwrap();
    assert!(labels::labels_for_task(&pool, &t.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn origin_label_merges_with_user_labels() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    let admin = labels::create_label(&pool, "admin", "#888888").await.unwrap();
    let t = tasks::create_local_task(
        &pool,
        serde_json::from_value(serde_json::json!({"content": "x", "label_ids": [admin.id]})).unwrap(),
    )
    .await
    .unwrap();
    let mut names = names_on_task(&pool, &t.id).await;
    names.sort();
    assert_eq!(names, vec!["admin".to_string(), "nimble".to_string()]);
}

#[tokio::test]
async fn backfill_labels_only_unlinked_tasks_and_is_idempotent() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO local_tasks (id, content, project_id) VALUES ('n1','native','inbox')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO local_tasks (id, content, project_id, completed, status) VALUES ('n2','native done','inbox',1,'complete')",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO local_tasks (id, content, project_id, external_id, external_source) VALUES ('t1','from todoist','inbox','R1','todoist')",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 2);
    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 0);
    assert!(names_on_task(&pool, "t1").await.is_empty());
    assert_eq!(names_on_task(&pool, "n2").await, vec!["nimble".to_string()]);
}

/// Reviewer finding: the backfill's `task_labels` sync_log entry must carry
/// a real snapshot, not `None` — `build_data_mutation_requests` returns no
/// statements for an INSERT/UPDATE with a `None` snapshot, and `push` then
/// marks the entry synced anyway, so a `None` snapshot here would make the
/// label association silently never reach Turso.
#[tokio::test]
async fn backfill_sync_log_entry_carries_a_real_snapshot() {
    let pool = test_pool().await;
    sqlx::query("INSERT INTO local_tasks (id, content, project_id) VALUES ('n1','native','inbox')")
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 1);

    let label_id: String = sqlx::query_scalar("SELECT id FROM labels WHERE name = 'nimble'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let row_id = format!("n1::{label_id}");
    let snapshot: Option<String> = sqlx::query_scalar(
        "SELECT snapshot FROM sync_log WHERE table_name = 'task_labels' AND row_id = ? AND operation = 'INSERT'",
    )
    .bind(&row_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let snapshot = snapshot.expect("task_labels sync_log entry must carry a snapshot, not None");
    let snapshot: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
    assert_eq!(snapshot["task_id"], "n1");
    assert_eq!(snapshot["label_id"], label_id);
    assert!(snapshot.get("created_at").is_some(), "got {snapshot:?}");
}

/// Backfill must also merge `nimble` into any pending outbox `create` row for
/// an unlinked task — that queued create is the only thing that will ever
/// push the label to Todoist, since the task never goes through
/// `create_task_with_id_tx` a second time.
#[tokio::test]
async fn backfill_merges_origin_label_into_pending_outbox_create_payload() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    sqlx::query("INSERT INTO local_tasks (id, content, project_id) VALUES ('n1','native','inbox')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO todoist_outbox (id, local_id, object_type, op, payload_json, command_uuid, status)
         VALUES ('row-1','n1','task','create','{\"content\":\"native\",\"labels\":[\"work\"]}','cmd-1','pending')",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 1);

    let payload_json: String =
        sqlx::query_scalar("SELECT payload_json FROM todoist_outbox WHERE id = 'row-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&payload_json).unwrap();
    let mut labels: Vec<String> = payload["labels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    labels.sort();
    assert_eq!(labels, vec!["nimble".to_string(), "work".to_string()]);

    // Idempotent: running again does not duplicate the label in the payload.
    assert_eq!(origin_label::backfill_origin_label(&pool).await.unwrap(), 0);
    let payload_json: String =
        sqlx::query_scalar("SELECT payload_json FROM todoist_outbox WHERE id = 'row-1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let payload: serde_json::Value = serde_json::from_str(&payload_json).unwrap();
    assert_eq!(payload["labels"].as_array().unwrap().len(), 2);
}

/// Controller ruling: labels reach Todoist via a second observer call inside
/// `create_task_with_id_tx` (`TaskMutation::Updated{fields_changed:["labels"]}`)
/// that merges into the still-pending `create` outbox row. Prove the merged
/// `nimble` label actually lands in that row's payload, not just in
/// `task_labels`.
#[tokio::test]
async fn pending_create_outbox_payload_carries_the_origin_label() {
    let pool = test_pool().await;
    enable_todoist(&pool).await;
    let t = tasks::create_local_task(
        &pool,
        serde_json::from_value(serde_json::json!({"content": "made here"})).unwrap(),
    )
    .await
    .unwrap();
    let batch = nimble_core::integrations::todoist::outbox::pending_batch(&pool, 10)
        .await
        .unwrap();
    let row = batch.iter().find(|r| r.local_id == t.id).expect("outbox row for task");
    assert_eq!(row.op, "create");
    assert_eq!(
        row.payload["labels"],
        serde_json::json!([origin_label::ORIGIN_LABEL]),
        "got {:?}",
        row.payload
    );
}
