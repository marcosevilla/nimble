use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::activity;
use crate::db::settings::set_setting;
use crate::db::sync;
use crate::parsers::html_to_md::{html_to_markdown, scan_unknown_tags};
use crate::types::{DocFolder, DocNote, Document};

// ── Folder operations ──

pub async fn get_doc_folders(pool: &SqlitePool) -> crate::Result<Vec<DocFolder>> {
    let rows: Vec<(String, String, i64, String)> = sqlx::query_as(
        "SELECT id, name, position, created_at FROM doc_folders ORDER BY position, created_at",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, name, position, created_at)| DocFolder { id, name, position, created_at }).collect())
}

pub async fn create_doc_folder(pool: &SqlitePool, name: &str) -> crate::Result<DocFolder> {
    let id = Uuid::new_v4().to_string();
    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM doc_folders")
        .fetch_one(pool)
        .await?;

    sqlx::query("INSERT INTO doc_folders (id, name, position) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(max_pos + 1)
        .execute(pool)
        .await?;

    activity::log_activity(pool, "folder_created", Some(&id), Some(serde_json::json!({ "name": name }))).await;

    let folder = DocFolder { id, name: name.to_string(), position: max_pos + 1, created_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string() };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&folder).unwrap_or_default();
    sync::append_sync_log(pool, "doc_folders", &folder.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(folder)
}

pub async fn rename_doc_folder(pool: &SqlitePool, id: &str, name: &str) -> crate::Result<()> {
    sqlx::query("UPDATE doc_folders SET name = ? WHERE id = ?")
        .bind(name)
        .bind(id)
        .execute(pool)
        .await?;

    // Sync log: UPDATE
    let row: Option<(String, String, i64, String)> = sqlx::query_as(
        "SELECT id, name, position, created_at FROM doc_folders WHERE id = ?"
    ).bind(id).fetch_optional(pool).await.ok().flatten();
    if let Some((fid, fname, fposition, fcreated_at)) = row {
        let folder = DocFolder { id: fid, name: fname, position: fposition, created_at: fcreated_at };
        let changed = serde_json::json!(["name"]).to_string();
        let snapshot = serde_json::to_string(&folder).unwrap_or_default();
        sync::append_sync_log(pool, "doc_folders", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
    }

    Ok(())
}

pub async fn delete_doc_folder(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("UPDATE documents SET folder_id = NULL WHERE folder_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM doc_folders WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "doc_folders", id, "DELETE", None, None).await.ok();

    Ok(())
}

// ── Document operations ──

pub async fn get_documents(pool: &SqlitePool, folder_id: Option<&str>) -> crate::Result<Vec<Document>> {
    let rows: Vec<(String, String, String, Option<String>, i64, String, String)> = if let Some(fid) = folder_id {
        sqlx::query_as(
            "SELECT id, title, content, folder_id, position, created_at, updated_at FROM documents WHERE folder_id = ? ORDER BY position, created_at DESC",
        )
        .bind(fid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, title, content, folder_id, position, created_at, updated_at FROM documents ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await?
    };

    Ok(rows.into_iter().map(|(id, title, content, folder_id, position, created_at, updated_at)| Document {
        id, title, content, folder_id, position, created_at, updated_at,
    }).collect())
}

pub async fn get_document(pool: &SqlitePool, id: &str) -> crate::Result<Option<Document>> {
    let row: Option<(String, String, String, Option<String>, i64, String, String)> = sqlx::query_as(
        "SELECT id, title, content, folder_id, position, created_at, updated_at FROM documents WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, title, content, folder_id, position, created_at, updated_at)| Document {
        id, title, content, folder_id, position, created_at, updated_at,
    }))
}

pub async fn create_document(pool: &SqlitePool, title: &str, folder_id: Option<&str>) -> crate::Result<Document> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM documents WHERE folder_id IS ?")
        .bind(folder_id)
        .fetch_one(pool)
        .await?;

    sqlx::query(
        "INSERT INTO documents (id, title, content, folder_id, position, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(title)
    .bind(folder_id)
    .bind(max_pos + 1)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;

    activity::log_activity(pool, "doc_created", Some(&id), Some(serde_json::json!({ "title": title }))).await;

    let doc = Document { id, title: title.to_string(), content: String::new(), folder_id: folder_id.map(|s| s.to_string()), position: max_pos + 1, created_at: now.clone(), updated_at: now };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&doc).unwrap_or_default();
    sync::append_sync_log(pool, "documents", &doc.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(doc)
}

pub async fn update_document(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    content: Option<&str>,
    folder_id: Option<&str>,
) -> crate::Result<Document> {
    if let Some(t) = title {
        sqlx::query("UPDATE documents SET title = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(t)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(c) = content {
        sqlx::query("UPDATE documents SET content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(c)
            .bind(id)
            .execute(pool)
            .await?;
    }
    if let Some(fid) = folder_id {
        sqlx::query("UPDATE documents SET folder_id = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .bind(fid)
            .bind(id)
            .execute(pool)
            .await?;
    }

    activity::log_activity(pool, "doc_updated", Some(id), None).await;

    let doc = get_document(pool, id).await.and_then(|d| d.ok_or_else(|| crate::Error::Other("Document not found".to_string())))?;

    // Sync log: UPDATE
    let mut fields_changed = Vec::new();
    if title.is_some() { fields_changed.push("title"); }
    if content.is_some() { fields_changed.push("content"); }
    if folder_id.is_some() { fields_changed.push("folder_id"); }
    let changed = serde_json::to_string(&fields_changed).unwrap_or_default();
    let snapshot = serde_json::to_string(&doc).unwrap_or_default();
    sync::append_sync_log(pool, "documents", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();

    Ok(doc)
}

pub async fn delete_document(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    // Sync log for doc_notes deletes
    let note_ids: Vec<(String,)> = sqlx::query_as("SELECT id FROM doc_notes WHERE doc_id = ?")
        .bind(id).fetch_all(pool).await.unwrap_or_default();
    for (nid,) in &note_ids {
        sync::append_sync_log(pool, "doc_notes", nid, "DELETE", None, None).await.ok();
    }

    sqlx::query("DELETE FROM doc_notes WHERE doc_id = ?").bind(id).execute(pool).await?;
    sqlx::query("DELETE FROM documents WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "documents", id, "DELETE", None, None).await.ok();

    activity::log_activity(pool, "doc_deleted", Some(id), None).await;
    Ok(())
}

pub async fn search_documents(pool: &SqlitePool, query: &str) -> crate::Result<Vec<Document>> {
    let pattern = format!("%{}%", query);
    let rows: Vec<(String, String, String, Option<String>, i64, String, String)> = sqlx::query_as(
        "SELECT id, title, content, folder_id, position, created_at, updated_at FROM documents WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 20",
    )
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, title, content, folder_id, position, created_at, updated_at)| Document {
        id, title, content, folder_id, position, created_at, updated_at,
    }).collect())
}

// ── Doc Note operations ──

pub async fn get_doc_notes(pool: &SqlitePool, doc_id: &str) -> crate::Result<Vec<DocNote>> {
    let rows: Vec<(String, String, String, i64, String)> = sqlx::query_as(
        "SELECT id, doc_id, content, position, created_at FROM doc_notes WHERE doc_id = ? ORDER BY position, created_at",
    )
    .bind(doc_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(id, doc_id, content, position, created_at)| DocNote { id, doc_id, content, position, created_at }).collect())
}

pub async fn create_doc_note(pool: &SqlitePool, doc_id: &str, content: &str) -> crate::Result<DocNote> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let max_pos: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM doc_notes WHERE doc_id = ?")
        .bind(doc_id)
        .fetch_one(pool)
        .await?;

    sqlx::query("INSERT INTO doc_notes (id, doc_id, content, position, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(doc_id)
        .bind(content)
        .bind(max_pos + 1)
        .bind(&now)
        .execute(pool)
        .await?;

    let note = DocNote { id, doc_id: doc_id.to_string(), content: content.to_string(), position: max_pos + 1, created_at: now };

    // Sync log: INSERT
    let snapshot = serde_json::to_string(&note).unwrap_or_default();
    sync::append_sync_log(pool, "doc_notes", &note.id, "INSERT", None, Some(&snapshot)).await.ok();

    Ok(note)
}

pub async fn delete_doc_note(pool: &SqlitePool, id: &str) -> crate::Result<()> {
    sqlx::query("DELETE FROM doc_notes WHERE id = ?").bind(id).execute(pool).await?;

    // Sync log: DELETE
    sync::append_sync_log(pool, "doc_notes", id, "DELETE", None, None).await.ok();

    Ok(())
}

pub async fn reorder_doc_notes(pool: &SqlitePool, note_ids: &[String]) -> crate::Result<()> {
    for (i, id) in note_ids.iter().enumerate() {
        sqlx::query("UPDATE doc_notes SET position = ? WHERE id = ?")
            .bind(i as i64)
            .bind(id)
            .execute(pool)
            .await?;

        // Sync log: UPDATE for reorder
        let row: Option<(String, String, String, i64, String)> = sqlx::query_as(
            "SELECT id, doc_id, content, position, created_at FROM doc_notes WHERE id = ?"
        ).bind(id).fetch_optional(pool).await.ok().flatten();
        if let Some((nid, ndoc_id, ncontent, nposition, ncreated_at)) = row {
            let note = DocNote { id: nid, doc_id: ndoc_id, content: ncontent, position: nposition, created_at: ncreated_at };
            let changed = serde_json::json!(["position"]).to_string();
            let snapshot = serde_json::to_string(&note).unwrap_or_default();
            sync::append_sync_log(pool, "doc_notes", id, "UPDATE", Some(&changed), Some(&snapshot)).await.ok();
        }
    }
    Ok(())
}

// ── Markdown migration ──

#[derive(Debug, serde::Serialize)]
pub struct FlaggedDoc {
    pub id: String,
    pub title: String,
    pub unknown_tags: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct DocsMdPreview {
    pub total: i64,
    pub convertible: usize,
    pub already_plain: usize,
    pub flagged: Vec<FlaggedDoc>,
}

#[derive(Debug, serde::Serialize)]
pub struct DocsMdResult {
    pub converted: usize,
    pub skipped_plain: usize,
    pub backup_path: String,
}

/// Dry-run report: which documents look HTML, how many would flip untouched
/// (already plain-text), and which contain tags outside the known Tiptap
/// allowlist (risk of lossy conversion). Read-only — never writes.
pub async fn preview_docs_markdown_migration(pool: &SqlitePool) -> crate::Result<DocsMdPreview> {
    let rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT id, title, content FROM documents")
            .fetch_all(pool)
            .await?;
    let total = rows.len() as i64;
    let mut convertible = 0;
    let mut already_plain = 0;
    let mut flagged = Vec::new();
    for (id, title, content) in rows {
        if !content.trim_start().starts_with('<') {
            already_plain += 1;
            continue;
        }
        convertible += 1;
        let unknown = scan_unknown_tags(&content);
        if !unknown.is_empty() {
            flagged.push(FlaggedDoc { id, title, unknown_tags: unknown });
        }
    }
    Ok(DocsMdPreview { total, convertible, already_plain, flagged })
}

/// Back up the live DB (via `VACUUM INTO`, safe while open), then convert
/// every HTML `documents.content` to markdown in a single transaction and
/// flip the `docs_content_format` setting to `"markdown"`. `doc_notes` are
/// plain text already (spec deviation #2) and are left untouched.
///
/// Idempotent: rows that no longer start with '<' are skipped, so re-running
/// after a successful migration converts nothing.
pub async fn migrate_docs_to_markdown(
    pool: &SqlitePool,
    backup_path: &str,
) -> crate::Result<DocsMdResult> {
    // 1. Online backup (safe while the DB is open)
    sqlx::query("VACUUM INTO ?").bind(backup_path).execute(pool).await?;

    // 2. Convert everything in one transaction
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT id, content FROM documents")
        .fetch_all(pool)
        .await?;
    let mut converted = 0usize;
    let mut skipped_plain = 0usize;
    let mut tx = pool.begin().await?;
    let mut touched: Vec<String> = Vec::new();
    for (id, content) in rows {
        if !content.trim_start().starts_with('<') {
            skipped_plain += 1;
            continue;
        }
        let md = html_to_markdown(&content);
        sqlx::query("UPDATE documents SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .bind(&md)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        converted += 1;
        touched.push(id);
    }
    tx.commit().await?;

    // 3. Flip the format setting. `set_setting` only takes a pool (no
    // transaction handle), so this happens immediately after commit rather
    // than inside the transaction above — see docs.rs task-3 report for why.
    set_setting(pool, "docs_content_format", "markdown").await?;

    // 4. Sync-log the converted docs so Turso propagates the new content
    for id in touched {
        if let Ok(Some(doc)) = get_document(pool, &id).await {
            let snapshot = serde_json::to_string(&doc).unwrap_or_default();
            crate::db::sync::append_sync_log(pool, "documents", &id, "UPDATE", Some("content"), Some(&snapshot))
                .await
                .ok();
        }
    }
    Ok(DocsMdResult { converted, skipped_plain, backup_path: backup_path.to_string() })
}

#[cfg(test)]
mod md_migration_tests {
    use crate::test_util::{file_pool, test_pool};

    #[tokio::test]
    async fn preview_reports_flagged_docs_without_writing() {
        let pool = test_pool().await;
        let clean = super::create_document(&pool, "Clean", None).await.unwrap();
        super::update_document(&pool, &clean.id, None, Some("<p>hello <strong>world</strong></p>"), None)
            .await
            .unwrap();
        let risky = super::create_document(&pool, "Risky", None).await.unwrap();
        super::update_document(&pool, &risky.id, None, Some("<table><tr><td>x</td></tr></table>"), None)
            .await
            .unwrap();

        let preview = super::preview_docs_markdown_migration(&pool).await.unwrap();
        assert_eq!(preview.total, 2);
        assert_eq!(preview.flagged.len(), 1);
        assert_eq!(preview.flagged[0].title, "Risky");
        assert!(preview.flagged[0].unknown_tags.contains(&"table".to_string()));

        // preview must not modify content
        let doc = super::get_document(&pool, &clean.id).await.unwrap().unwrap();
        assert!(doc.content.starts_with("<p>"));
    }

    // NOTE: this test uses `file_pool()` (a real on-disk SQLite file), not the
    // in-memory `test_pool()` used everywhere else. `VACUUM INTO` is a no-op
    // against SQLite's `:memory:` databases (confirmed against sqlx 0.8.6 /
    // libsqlite3-sys 0.30.1 here: the query returns Ok with no error, but no
    // file is ever written) — a known SQLite/sqlx limitation, not something
    // production hits since the real app always runs on a file-backed pool.
    #[tokio::test]
    async fn migrate_converts_content_and_flips_setting() {
        let (pool, _db_path) = file_pool().await;
        let doc = super::create_document(&pool, "Doc", None).await.unwrap();
        super::update_document(&pool, &doc.id, None, Some("<h2>Head</h2><p>body <em>i</em></p>"), None)
            .await
            .unwrap();

        let backup = std::env::temp_dir().join(format!("dt-test-backup-{}.db", uuid::Uuid::new_v4()));
        let result = super::migrate_docs_to_markdown(&pool, backup.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(result.converted, 1);
        assert!(std::path::Path::new(&result.backup_path).exists());

        let after = super::get_document(&pool, &doc.id).await.unwrap().unwrap();
        assert!(after.content.contains("## Head"));
        assert!(!after.content.contains('<'));

        let fmt = crate::db::settings::get_setting(&pool, "docs_content_format").await.unwrap();
        assert_eq!(fmt.as_deref(), Some("markdown"));

        // idempotent: second run converts nothing (content no longer starts with '<')
        let backup2 = std::env::temp_dir().join(format!("dt-test-backup-{}.db", uuid::Uuid::new_v4()));
        let again = super::migrate_docs_to_markdown(&pool, backup2.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(again.converted, 0);
        let _ = std::fs::remove_file(&backup);
        let _ = std::fs::remove_file(&backup2);
    }
}
