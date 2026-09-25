//! Brief items (addendum §5, schema v26): the rows the brief shows with their
//! own state. Written with the day's composition in one transaction (see
//! `db::briefs::record_composition`); acted-on rows survive Regenerate.
//! Synced through sync_log by `id`.

use std::collections::HashSet;

use sqlx::{SqliteConnection, SqlitePool};

use crate::db::sync;
use crate::types::{BriefItem, BriefItemTask};

pub const KINDS: [&str; 3] = ["priority", "quick_help", "quick_self"];
pub const ORIGINS: [&str; 2] = ["ai", "rule"];
pub const ACTION_STATES: [&str; 4] = ["none", "produced", "dismissed", "confirmed"];

#[derive(Debug, Clone, PartialEq)]
pub struct NewBriefItem {
    pub kind: String,
    pub module_id: String,
    pub title: String,
    pub body: Option<String>,
    pub task_id: String,
    pub origin: String,
    pub position: i64,
}

pub fn item_id(date: &str, kind: &str, task_id: &str) -> String {
    format!("{date}:{kind}:{task_id}")
}

pub fn dedupe_key(kind: &str, task_id: &str) -> String {
    format!("{kind}:{task_id}")
}

const ITEM_COLS: &str = "bi.id, bi.date, bi.module_id, bi.kind, bi.title, bi.body, bi.task_id, bi.origin, bi.dedupe_key, bi.action_kind, bi.action_state, bi.produced_ref, bi.position, bi.created_at, bi.updated_at, t.status AS t_status, t.completed AS t_completed, t.due_date AS t_due_date, t.content AS t_content, t.description AS t_description, t.project_id AS t_project_id";
const ORDER: &str = "ORDER BY CASE bi.kind WHEN 'priority' THEN 0 WHEN 'quick_help' THEN 1 WHEN 'quick_self' THEN 2 ELSE 3 END, bi.position, bi.id";

#[derive(sqlx::FromRow)]
struct ItemRow {
    id: String,
    date: String,
    module_id: String,
    kind: String,
    title: String,
    body: Option<String>,
    task_id: Option<String>,
    origin: String,
    dedupe_key: Option<String>,
    action_kind: Option<String>,
    action_state: String,
    produced_ref: Option<String>,
    position: i64,
    created_at: String,
    updated_at: String,
    t_status: Option<String>,
    t_completed: Option<bool>,
    t_due_date: Option<String>,
    t_content: Option<String>,
    t_description: Option<String>,
    t_project_id: Option<String>,
}

fn to_item(r: ItemRow) -> BriefItem {
    let task = match (r.t_content, r.t_status, r.t_project_id) {
        (Some(content), Some(status), Some(project_id)) => Some(BriefItemTask {
            status,
            completed: r.t_completed.unwrap_or(false),
            due_date: r.t_due_date,
            content,
            description: r.t_description,
            project_id,
        }),
        _ => None,
    };
    BriefItem {
        id: r.id, date: r.date, module_id: r.module_id, kind: r.kind, title: r.title, body: r.body,
        task_id: r.task_id, origin: r.origin, dedupe_key: r.dedupe_key, action_kind: r.action_kind,
        action_state: r.action_state, produced_ref: r.produced_ref, position: r.position,
        created_at: r.created_at, updated_at: r.updated_at, task,
    }
}

/// The row as sync sees it: DB column names only (no joined task).
fn sync_snapshot(i: &BriefItem) -> String {
    serde_json::json!({
        "id": i.id, "date": i.date, "module_id": i.module_id, "kind": i.kind, "title": i.title,
        "body": i.body, "task_id": i.task_id, "origin": i.origin, "dedupe_key": i.dedupe_key,
        "action_kind": i.action_kind, "action_state": i.action_state, "produced_ref": i.produced_ref,
        "position": i.position, "created_at": i.created_at, "updated_at": i.updated_at,
    })
    .to_string()
}

/// Items for a date, each joined with its task's live state, in display order.
pub async fn list_items(pool: &SqlitePool, date: &str) -> crate::Result<Vec<BriefItem>> {
    let rows: Vec<ItemRow> = sqlx::query_as(&format!(
        "SELECT {ITEM_COLS} FROM brief_items bi LEFT JOIN local_tasks t ON t.id = bi.task_id WHERE bi.date = ? {ORDER}"
    ))
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(to_item).collect())
}

pub async fn get_item(pool: &SqlitePool, id: &str) -> crate::Result<Option<BriefItem>> {
    let row: Option<ItemRow> = sqlx::query_as(&format!(
        "SELECT {ITEM_COLS} FROM brief_items bi LEFT JOIN local_tasks t ON t.id = bi.task_id WHERE bi.id = ?"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(to_item))
}

/// Tasks the user already acted on today; Regenerate keeps these rows and
/// never adds their task again under another heading.
pub async fn acted_task_ids(pool: &SqlitePool, date: &str) -> crate::Result<HashSet<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT task_id FROM brief_items WHERE date = ? AND action_state != 'none' AND task_id IS NOT NULL",
    )
    .bind(date)
    .fetch_all(pool)
    .await?;
    Ok(ids.into_iter().collect())
}

pub async fn set_item_state(
    pool: &SqlitePool,
    id: &str,
    state: &str,
    action_kind: Option<&str>,
    produced_ref: Option<&str>,
) -> crate::Result<BriefItem> {
    if !ACTION_STATES.contains(&state) {
        return Err(crate::Error::Other("invalid_action_state".into()));
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let changed = sqlx::query("UPDATE brief_items SET action_state = ?, action_kind = ?, produced_ref = ?, updated_at = ? WHERE id = ?")
        .bind(state).bind(action_kind).bind(produced_ref).bind(&now).bind(id)
        .execute(pool).await?.rows_affected();
    if changed == 0 {
        return Err(crate::Error::Other("brief_item_missing".into()));
    }
    let item = get_item(pool, id).await?.ok_or_else(|| crate::Error::Other("brief_item_missing".into()))?;
    let cols = serde_json::json!(["action_state", "action_kind", "produced_ref", "updated_at"]).to_string();
    sync::append_sync_log(pool, "brief_items", id, "UPDATE", Some(&cols), Some(&sync_snapshot(&item))).await.ok();
    Ok(item)
}

/// Inside the composition transaction: drop the date's un-acted rows, insert
/// the new ones. A new row whose id already exists (an acted-on row for the
/// same task and kind) is ignored, so acted-on rows keep their state.
pub(crate) async fn replace_unacted_tx(
    conn: &mut SqliteConnection,
    date: &str,
    items: &[NewBriefItem],
    now: &str,
) -> crate::Result<()> {
    let stale: Vec<String> = sqlx::query_scalar("SELECT id FROM brief_items WHERE date = ? AND action_state = 'none'")
        .bind(date)
        .fetch_all(&mut *conn)
        .await?;
    for id in &stale {
        sqlx::query("DELETE FROM brief_items WHERE id = ?").bind(id).execute(&mut *conn).await?;
        sync::append_sync_log_tx(&mut *conn, "brief_items", id, "DELETE", None, None).await?;
    }
    for it in items {
        if !KINDS.contains(&it.kind.as_str()) || !ORIGINS.contains(&it.origin.as_str()) {
            return Err(crate::Error::Other(format!("invalid brief item {}/{}", it.kind, it.origin)));
        }
        let row = BriefItem {
            id: item_id(date, &it.kind, &it.task_id),
            date: date.into(),
            module_id: it.module_id.clone(),
            kind: it.kind.clone(),
            title: it.title.clone(),
            body: it.body.clone(),
            task_id: Some(it.task_id.clone()),
            origin: it.origin.clone(),
            dedupe_key: Some(dedupe_key(&it.kind, &it.task_id)),
            action_kind: None,
            action_state: "none".into(),
            produced_ref: None,
            position: it.position,
            created_at: now.into(),
            updated_at: now.into(),
            task: None,
        };
        let inserted = sqlx::query(
            "INSERT OR IGNORE INTO brief_items (id, date, module_id, kind, title, body, task_id, origin, dedupe_key, action_kind, action_state, produced_ref, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', NULL, ?, ?, ?)",
        )
        .bind(&row.id).bind(&row.date).bind(&row.module_id).bind(&row.kind).bind(&row.title).bind(&row.body)
        .bind(&row.task_id).bind(&row.origin).bind(&row.dedupe_key).bind(row.position).bind(now).bind(now)
        .execute(&mut *conn)
        .await?
        .rows_affected();
        if inserted == 1 {
            sync::append_sync_log_tx(&mut *conn, "brief_items", &row.id, "INSERT", None, Some(&sync_snapshot(&row))).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::briefs::{self, CompositionRecord};
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    const D: &str = "2026-09-25";
    const NOW: &str = "2026-09-25 06:30:05";

    async fn task(pool: &SqlitePool, content: &str) -> String {
        crate::db::tasks::create_local_task(pool, CreateTaskInput { content: content.into(), ..Default::default() }).await.unwrap().id
    }

    fn item(kind: &str, task_id: &str, position: i64) -> NewBriefItem {
        NewBriefItem {
            kind: kind.into(),
            module_id: if kind == "priority" { "priorities".into() } else { "quick_wins".into() },
            title: format!("Title {task_id}"),
            body: Some("Because.".into()),
            task_id: task_id.into(),
            origin: "ai".into(),
            position,
        }
    }

    fn record(items: Vec<NewBriefItem>, bump: bool, attempts: i64) -> CompositionRecord {
        CompositionRecord {
            date: D.into(), status: "ready".into(), model: Some("claude-opus-5-5".into()),
            input_tokens: Some(9000), output_tokens: Some(600), error_code: None,
            compose: serde_json::json!({"summary": "A calm day.", "origin": "ai", "wins": []}),
            items, attempts, bump_version: bump, regathered: None, now: NOW.into(),
        }
    }

    async fn count(pool: &SqlitePool, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
    }

    #[tokio::test]
    async fn composition_writes_row_items_and_sync_together() {
        let pool = test_pool().await;
        let (a, b) = (task(&pool, "Send the draft").await, task(&pool, "Outline the reply").await);
        briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        let brief = briefs::record_composition(&pool, &record(vec![item("priority", &a, 0), item("quick_help", &b, 0)], false, 1)).await.unwrap();
        assert_eq!((brief.version, brief.status.as_str(), brief.compose_attempts), (1, "ready", 1));
        assert_eq!(brief.composed_at.as_deref(), Some(NOW));
        assert_eq!((brief.model.as_deref(), brief.input_tokens, brief.output_tokens), (Some("claude-opus-5-5"), Some(9000), Some(600)));
        assert_eq!(brief.snapshot["compose"]["summary"], "A calm day.");
        let stored = briefs::get_brief(&pool, D).await.unwrap().unwrap();
        assert_eq!(stored.composed_at.as_deref(), Some(NOW));
        let items = list_items(&pool, D).await.unwrap();
        assert_eq!(items.iter().map(|i| i.kind.as_str()).collect::<Vec<_>>(), ["priority", "quick_help"]);
        assert_eq!(items[0].id, format!("{D}:priority:{a}"));
        assert_eq!(items[0].dedupe_key.as_deref(), Some(format!("priority:{a}").as_str()));
        assert_eq!(items[0].task.as_ref().unwrap().content, "Send the draft");
        assert_eq!(items[0].action_state, "none");
        assert_eq!(count(&pool, "SELECT count(*) FROM sync_log WHERE table_name='brief_items' AND operation='INSERT'").await, 2);
        assert_eq!(count(&pool, "SELECT count(*) FROM sync_log WHERE table_name='briefs' AND operation='UPDATE'").await, 1);
    }

    #[tokio::test]
    async fn recompose_keeps_acted_items_and_replaces_the_rest() {
        let pool = test_pool().await;
        let (a, b, c) = (task(&pool, "A").await, task(&pool, "B").await, task(&pool, "C").await);
        briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        briefs::record_composition(&pool, &record(vec![item("priority", &a, 0), item("quick_help", &b, 0)], false, 1)).await.unwrap();
        let produced = set_item_state(&pool, &item_id(D, "quick_help", &b), "produced", Some("break_down"), Some("[\"s1\",\"s2\"]")).await.unwrap();
        assert_eq!(produced.action_state, "produced");
        assert_eq!(acted_task_ids(&pool, D).await.unwrap(), HashSet::from([b.clone()]));
        let brief = briefs::record_composition(&pool, &record(vec![item("priority", &c, 0), item("quick_help", &b, 1)], true, 2)).await.unwrap();
        assert_eq!(brief.version, 2);
        let items = list_items(&pool, D).await.unwrap();
        let summary: Vec<(String, String)> = items.iter().map(|i| (i.kind.clone(), i.task_id.clone().unwrap())).collect();
        assert_eq!(summary, [("priority".to_string(), c.clone()), ("quick_help".to_string(), b.clone())]);
        let kept = items.iter().find(|i| i.kind == "quick_help").unwrap();
        assert_eq!((kept.action_state.as_str(), kept.produced_ref.as_deref(), kept.position), ("produced", Some("[\"s1\",\"s2\"]"), 0));
        assert_eq!(count(&pool, "SELECT count(*) FROM sync_log WHERE table_name='brief_items' AND operation='DELETE'").await, 1);
    }

    #[tokio::test]
    async fn item_state_is_validated_and_synced() {
        let pool = test_pool().await;
        let a = task(&pool, "A").await;
        briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        briefs::record_composition(&pool, &record(vec![item("quick_help", &a, 0)], false, 1)).await.unwrap();
        let id = item_id(D, "quick_help", &a);
        assert!(set_item_state(&pool, &id, "bogus", None, None).await.is_err());
        assert!(set_item_state(&pool, "missing", "produced", None, None).await.is_err());
        let back = set_item_state(&pool, &id, "none", None, None).await.unwrap();
        assert_eq!((back.action_state.as_str(), back.action_kind.as_deref(), back.produced_ref.as_deref()), ("none", None, None));
        assert_eq!(count(&pool, "SELECT count(*) FROM sync_log WHERE table_name='brief_items' AND operation='UPDATE'").await, 1);
    }

    #[tokio::test]
    async fn failed_retry_only_bumps_the_counter() {
        let pool = test_pool().await;
        let a = task(&pool, "A").await;
        briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        let mut rec = record(vec![item("priority", &a, 0)], false, 1);
        rec.status = "fallback".into();
        rec.error_code = Some("offline".into());
        briefs::record_composition(&pool, &rec).await.unwrap();
        let before = list_items(&pool, D).await.unwrap();
        let b = briefs::record_failed_retry(&pool, D, 2, "server_error", "2026-09-25 06:35:00").await.unwrap();
        assert_eq!((b.compose_attempts, b.error_code.as_deref(), b.status.as_str()), (2, Some("server_error"), "fallback"));
        assert_eq!(list_items(&pool, D).await.unwrap(), before);
    }

    #[tokio::test]
    async fn a_missing_brief_writes_nothing() {
        let pool = test_pool().await;
        let a = task(&pool, "A").await;
        assert!(briefs::record_composition(&pool, &record(vec![item("priority", &a, 0)], false, 1)).await.is_err());
        assert_eq!(count(&pool, "SELECT count(*) FROM brief_items").await, 0);
        assert_eq!(count(&pool, "SELECT count(*) FROM sync_log WHERE table_name IN ('briefs','brief_items')").await, 0);
    }

    #[tokio::test]
    async fn an_invalid_kind_rolls_the_whole_write_back() {
        let pool = test_pool().await;
        let a = task(&pool, "A").await;
        briefs::ensure_snapshot(&pool, D, D).await.unwrap();
        let mut bad = item("priority", &a, 0);
        bad.kind = "attention".into();
        assert!(briefs::record_composition(&pool, &record(vec![bad], false, 1)).await.is_err());
        let b = briefs::get_brief(&pool, D).await.unwrap().unwrap();
        assert!(b.composed_at.is_none(), "the row patch rolled back with the items");
    }
}
