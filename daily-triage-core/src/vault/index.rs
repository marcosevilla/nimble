use sqlx::SqlitePool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::db::sync;
use crate::vault::parser::parse_note;

/// One row of `vault_notes`. Field names are the column names verbatim —
/// the Turso push builds its INSERT column list from this struct's JSON keys.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultNoteRow {
    pub id: String,
    pub path: String,
    pub title: String,
    pub content: String,
    pub frontmatter_json: Option<String>,
    pub mtime: Option<String>,
    pub size: i64,
    pub hash: Option<String>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultNoteSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultSearchHit {
    pub id: String,
    pub path: String,
    pub title: String,
    pub snippet: String,
}

/// Stat + hash of an already-indexed file, used by the scanner to skip
/// unchanged files without reading them.
#[derive(Debug, Clone)]
pub struct IndexedFile {
    pub hash: String,
    pub size: i64,
    pub mtime: Option<String>,
}

const NOTE_COLS: &str =
    "id, path, title, content, frontmatter_json, mtime, size, hash, updated_at, deleted_at";

type NoteTuple = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    i64,
    Option<String>,
    String,
    Option<String>,
);

fn row_to_note(t: NoteTuple) -> VaultNoteRow {
    VaultNoteRow {
        id: t.0,
        path: t.1,
        title: t.2,
        content: t.3,
        frontmatter_json: t.4,
        mtime: t.5,
        size: t.6,
        hash: t.7,
        updated_at: t.8,
        deleted_at: t.9,
    }
}

pub async fn get_note_by_path(pool: &SqlitePool, path: &str) -> crate::Result<Option<VaultNoteRow>> {
    let row: Option<NoteTuple> =
        sqlx::query_as(&format!("SELECT {NOTE_COLS} FROM vault_notes WHERE path = ?"))
            .bind(path)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(row_to_note))
}

pub async fn get_note(pool: &SqlitePool, id: &str) -> crate::Result<Option<VaultNoteRow>> {
    let row: Option<NoteTuple> =
        sqlx::query_as(&format!("SELECT {NOTE_COLS} FROM vault_notes WHERE id = ?"))
            .bind(id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(row_to_note))
}

/// Live (non-tombstoned) notes, newest first.
pub async fn list_notes(pool: &SqlitePool) -> crate::Result<Vec<VaultNoteSummary>> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, path, title, updated_at FROM vault_notes
         WHERE deleted_at IS NULL ORDER BY path",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at })
        .collect())
}

pub async fn indexed_files(pool: &SqlitePool) -> crate::Result<HashMap<String, IndexedFile>> {
    let rows: Vec<(String, Option<String>, i64, Option<String>)> = sqlx::query_as(
        "SELECT path, hash, size, mtime FROM vault_notes WHERE deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(path, hash, size, mtime)| {
            (path, IndexedFile { hash: hash.unwrap_or_default(), size, mtime })
        })
        .collect())
}

/// Index (or re-index) one note. Reuses the existing row id for a given path
/// so note identity survives edits, re-scans, and Turso round-trips.
pub async fn upsert_note(
    pool: &SqlitePool,
    path: &str,
    content: &str,
    mtime: Option<&str>,
    size: i64,
    hash: &str,
) -> crate::Result<String> {
    let existing = get_note_by_path(pool, path).await?;
    let id = existing
        .as_ref()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let is_new = existing.is_none();

    let parsed = parse_note(path, content);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    sqlx::query(
        "INSERT INTO vault_notes
            (id, path, title, content, frontmatter_json, mtime, size, hash, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET
            title = excluded.title,
            content = excluded.content,
            frontmatter_json = excluded.frontmatter_json,
            mtime = excluded.mtime,
            size = excluded.size,
            hash = excluded.hash,
            updated_at = excluded.updated_at,
            deleted_at = NULL",
    )
    .bind(&id)
    .bind(path)
    .bind(&parsed.title)
    .bind(content)
    .bind(&parsed.frontmatter_json)
    .bind(mtime)
    .bind(size)
    .bind(hash)
    .bind(&now)
    .execute(pool)
    .await?;

    replace_links(pool, &id, &parsed.links).await?;
    replace_tags(pool, &id, &parsed.tags).await?;
    refresh_fts(pool, &id, &parsed.title, content).await?;

    let row = VaultNoteRow {
        id: id.clone(),
        path: path.to_string(),
        title: parsed.title,
        content: content.to_string(),
        frontmatter_json: parsed.frontmatter_json,
        mtime: mtime.map(|s| s.to_string()),
        size,
        hash: Some(hash.to_string()),
        updated_at: now,
        deleted_at: None,
    };
    let snapshot = serde_json::to_string(&row).unwrap_or_default();
    let op = if is_new { "INSERT" } else { "UPDATE" };
    sync::append_sync_log(pool, "vault_notes", &id, op, None, Some(&snapshot))
        .await
        .ok();

    Ok(id)
}

/// Update only the cheap stat columns when a file's mtime/size changed but its
/// content hash did not — keeps the scanner's next pre-check fast without
/// re-parsing or generating sync traffic for a no-op edit.
pub async fn touch_stat(
    pool: &SqlitePool,
    path: &str,
    mtime: Option<&str>,
    size: i64,
) -> crate::Result<()> {
    sqlx::query("UPDATE vault_notes SET mtime = ?, size = ? WHERE path = ?")
        .bind(mtime)
        .bind(size)
        .bind(path)
        .execute(pool)
        .await?;
    Ok(())
}

/// Tombstone a note whose file is gone: keep the row (so the deletion
/// replicates), drop its derived rows and search entry.
pub async fn soft_delete_note(pool: &SqlitePool, path: &str) -> crate::Result<()> {
    let Some(existing) = get_note_by_path(pool, path).await? else {
        return Ok(());
    };
    if existing.deleted_at.is_some() {
        return Ok(());
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE vault_notes SET deleted_at = ?, updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&now)
        .bind(&existing.id)
        .execute(pool)
        .await?;

    clear_derived(pool, &existing.id).await?;

    let row = VaultNoteRow {
        deleted_at: Some(now.clone()),
        updated_at: now,
        ..existing
    };
    let snapshot = serde_json::to_string(&row).unwrap_or_default();
    sync::append_sync_log(
        pool,
        "vault_notes",
        &row.id,
        "UPDATE",
        Some(r#"["deleted_at"]"#),
        Some(&snapshot),
    )
    .await
    .ok();

    Ok(())
}

/// FTS5 query. The user's raw input is quoted so that Obsidian-ish text
/// ("journal/2026", "note-name") can't blow up as FTS operator syntax.
pub async fn search(pool: &SqlitePool, query: &str, limit: i64) -> crate::Result<Vec<VaultSearchHit>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let quoted = format!("\"{}\"", trimmed.replace('"', "\"\""));

    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT n.id, n.path, n.title, snippet(vault_fts, 2, '', '', '…', 12)
         FROM vault_fts
         JOIN vault_notes n ON n.id = vault_fts.note_id
         WHERE vault_fts MATCH ? AND n.deleted_at IS NULL
         ORDER BY rank
         LIMIT ?",
    )
    .bind(&quoted)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, path, title, snippet)| VaultSearchHit { id, path, title, snippet })
        .collect())
}

/// Notes that link to the given note, matched on full path or filename stem
/// (Obsidian wikilinks usually name the stem, not the path).
pub async fn backlinks(pool: &SqlitePool, path: &str) -> crate::Result<Vec<VaultNoteSummary>> {
    let stem = crate::vault::parser::title_from_path(path);
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT n.id, n.path, n.title, n.updated_at
         FROM vault_links l
         JOIN vault_notes n ON n.id = l.from_note_id
         WHERE (l.to_path = ? OR l.to_path = ?) AND n.deleted_at IS NULL
         ORDER BY n.path",
    )
    .bind(path)
    .bind(&stem)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at })
        .collect())
}

/// Resolve a wikilink target to a note: exact path first, then filename stem,
/// then title. `None` means an unresolved link (UI offers to create the note).
pub async fn resolve_link(pool: &SqlitePool, to_path: &str) -> crate::Result<Option<VaultNoteSummary>> {
    let with_ext = if to_path.ends_with(".md") {
        to_path.to_string()
    } else {
        format!("{to_path}.md")
    };
    let stem = crate::vault::parser::title_from_path(to_path);

    let row: Option<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, path, title, updated_at FROM vault_notes
         WHERE deleted_at IS NULL
           AND (path = ? OR path = ? OR path LIKE ? OR title = ?)
         ORDER BY LENGTH(path)
         LIMIT 1",
    )
    .bind(to_path)
    .bind(&with_ext)
    .bind(format!("%/{with_ext}"))
    .bind(&stem)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, path, title, updated_at)| VaultNoteSummary { id, path, title, updated_at }))
}

/// Called from the Turso pull loop after a remote row lands locally. Only the
/// FTS entry is reconciled here — links and tags are re-derived by the Mac when
/// it re-parses the file, which is the path every real edit takes.
pub async fn on_turso_row_applied(pool: &SqlitePool, table_name: &str, row_id: &str) {
    if table_name != "vault_notes" {
        return;
    }
    if let Err(e) = reconcile_fts(pool, row_id).await {
        log::warn!("vault FTS reconcile failed for {row_id}: {e}");
    }
}

async fn reconcile_fts(pool: &SqlitePool, note_id: &str) -> crate::Result<()> {
    let Some(row) = get_note(pool, note_id).await? else {
        sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
            .bind(note_id)
            .execute(pool)
            .await?;
        return Ok(());
    };
    if row.deleted_at.is_some() {
        sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
            .bind(note_id)
            .execute(pool)
            .await?;
        return Ok(());
    }
    refresh_fts(pool, &row.id, &row.title, &row.content).await
}

// ── Derived-row helpers ──

/// Link/tag ids are deterministic (`{note_id}:l{index}`) so a re-index rewrites
/// the same rows instead of churning sync_log with delete/insert pairs.
async fn replace_links(
    pool: &SqlitePool,
    note_id: &str,
    links: &[crate::vault::parser::ParsedLink],
) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_links", "from_note_id", note_id, links.len(), 'l').await?;
    for (i, link) in links.iter().enumerate() {
        let id = format!("{note_id}:l{i}");
        sqlx::query(
            "INSERT INTO vault_links (id, from_note_id, to_path, link_type) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET to_path = excluded.to_path, link_type = excluded.link_type",
        )
        .bind(&id)
        .bind(note_id)
        .bind(&link.to_path)
        .bind(&link.link_type)
        .execute(pool)
        .await?;

        let snapshot = serde_json::json!({
            "id": id,
            "from_note_id": note_id,
            "to_path": link.to_path,
            "link_type": link.link_type,
        })
        .to_string();
        sync::append_sync_log(pool, "vault_links", &id, "UPDATE", None, Some(&snapshot))
            .await
            .ok();
    }
    Ok(())
}

async fn replace_tags(pool: &SqlitePool, note_id: &str, tags: &[String]) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_tags", "note_id", note_id, tags.len(), 't').await?;
    for (i, tag) in tags.iter().enumerate() {
        let id = format!("{note_id}:t{i}");
        sqlx::query(
            "INSERT INTO vault_tags (id, note_id, tag) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET tag = excluded.tag",
        )
        .bind(&id)
        .bind(note_id)
        .bind(tag)
        .execute(pool)
        .await?;

        let snapshot =
            serde_json::json!({ "id": id, "note_id": note_id, "tag": tag }).to_string();
        sync::append_sync_log(pool, "vault_tags", &id, "UPDATE", None, Some(&snapshot))
            .await
            .ok();
    }
    Ok(())
}

/// Remove derived rows whose deterministic index is past the current count
/// (i.e. the note shed links/tags since the last index).
async fn delete_derived_beyond(
    pool: &SqlitePool,
    table: &str,
    owner_col: &str,
    note_id: &str,
    keep: usize,
    marker: char,
) -> crate::Result<()> {
    let ids: Vec<(String,)> = sqlx::query_as(&format!(
        "SELECT id FROM {table} WHERE {owner_col} = ?"
    ))
    .bind(note_id)
    .fetch_all(pool)
    .await?;

    for (id,) in ids {
        let index: Option<usize> = id
            .rsplit_once(&format!(":{marker}"))
            .and_then(|(_, n)| n.parse().ok());
        if index.map(|i| i >= keep).unwrap_or(true) {
            sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
                .bind(&id)
                .execute(pool)
                .await?;
            sync::append_sync_log(pool, table, &id, "DELETE", None, None).await.ok();
        }
    }
    Ok(())
}

async fn clear_derived(pool: &SqlitePool, note_id: &str) -> crate::Result<()> {
    delete_derived_beyond(pool, "vault_links", "from_note_id", note_id, 0, 'l').await?;
    delete_derived_beyond(pool, "vault_tags", "note_id", note_id, 0, 't').await?;
    sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
        .bind(note_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn refresh_fts(
    pool: &SqlitePool,
    note_id: &str,
    title: &str,
    content: &str,
) -> crate::Result<()> {
    sqlx::query("DELETE FROM vault_fts WHERE note_id = ?")
        .bind(note_id)
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO vault_fts (note_id, title, content) VALUES (?, ?, ?)")
        .bind(note_id)
        .bind(title)
        .bind(content)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    const BODY: &str = "---\ntitle: Alpha Note\ntags: [work]\n---\n\nLinks to [[Beta]] and #deep/tag.\n";

    #[tokio::test]
    async fn upsert_indexes_note_links_tags_and_fts() {
        let pool = test_pool().await;
        let id = upsert_note(&pool, "a/Alpha.md", BODY, Some("2026-08-04T10:00:00Z"), 120, "hash1")
            .await
            .unwrap();

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert_eq!(row.id, id);
        assert_eq!(row.title, "Alpha Note");
        assert_eq!(row.hash.as_deref(), Some("hash1"));
        assert!(row.deleted_at.is_none());

        let links: Vec<(String, String)> =
            sqlx::query_as("SELECT to_path, link_type FROM vault_links WHERE from_note_id = ?")
                .bind(&id)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(links, vec![("Beta".to_string(), "wikilink".to_string())]);

        let mut tags: Vec<(String,)> = sqlx::query_as("SELECT tag FROM vault_tags WHERE note_id = ?")
            .bind(&id)
            .fetch_all(&pool)
            .await
            .unwrap();
        tags.sort();
        assert_eq!(tags.len(), 2, "inline + frontmatter tags: {tags:?}");

        let hits = search(&pool, "Beta", 10).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a/Alpha.md");
    }

    #[tokio::test]
    async fn reindex_keeps_id_and_replaces_derived_rows() {
        let pool = test_pool().await;
        let id1 = upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        let id2 = upsert_note(&pool, "a/Alpha.md", "# Renamed\n\nNo links now.\n", None, 40, "hash2")
            .await
            .unwrap();
        assert_eq!(id1, id2, "path identity must survive a re-index");

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert_eq!(row.title, "Renamed");

        let link_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM vault_links WHERE from_note_id = ?")
                .bind(&id1)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(link_count, 0, "stale links must be cleared");

        let fts_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_fts WHERE note_id = ?")
            .bind(&id1)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fts_rows, 1, "exactly one FTS row per note");
    }

    #[tokio::test]
    async fn soft_delete_tombstones_row_and_clears_search() {
        let pool = test_pool().await;
        let id = upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        soft_delete_note(&pool, "a/Alpha.md").await.unwrap();

        let row = get_note_by_path(&pool, "a/Alpha.md").await.unwrap().unwrap();
        assert!(row.deleted_at.is_some(), "row is tombstoned, not removed");
        assert!(search(&pool, "Beta", 10).await.unwrap().is_empty());
        assert!(list_notes(&pool).await.unwrap().is_empty());

        let links: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM vault_links WHERE from_note_id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(links, 0);
    }

    #[tokio::test]
    async fn writes_append_sync_log_entries_for_vault_notes() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "hash1").await.unwrap();
        let entries: Vec<(String, String)> = sqlx::query_as(
            "SELECT operation, snapshot FROM sync_log WHERE table_name = 'vault_notes'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(entries.len(), 1);
        let snapshot: serde_json::Value = serde_json::from_str(&entries[0].1).unwrap();
        // Snapshot keys become the INSERT column list on Turso — they must be
        // exactly the table's columns.
        for col in ["id", "path", "title", "content", "frontmatter_json", "mtime", "size", "hash", "updated_at", "deleted_at"] {
            assert!(snapshot.get(col).is_some(), "snapshot missing column {col}");
        }
    }

    #[tokio::test]
    async fn indexed_files_returns_stat_map_for_scanner_precheck() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, Some("2026-08-04T10:00:00Z"), 120, "hash1")
            .await
            .unwrap();
        let map = indexed_files(&pool).await.unwrap();
        let entry = map.get("a/Alpha.md").expect("indexed entry");
        assert_eq!(entry.hash, "hash1");
        assert_eq!(entry.size, 120);
        assert_eq!(entry.mtime.as_deref(), Some("2026-08-04T10:00:00Z"));
    }

    #[tokio::test]
    async fn backlinks_and_link_resolution_work_by_path_or_title() {
        let pool = test_pool().await;
        upsert_note(&pool, "a/Alpha.md", BODY, None, 120, "h1").await.unwrap();
        upsert_note(&pool, "a/Beta.md", "# Beta\n\nbody", None, 20, "h2").await.unwrap();

        let resolved = resolve_link(&pool, "Beta").await.unwrap().expect("resolves by title/stem");
        assert_eq!(resolved.path, "a/Beta.md");
        assert!(resolve_link(&pool, "Nonexistent").await.unwrap().is_none());

        let back = backlinks(&pool, "a/Beta.md").await.unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].path, "a/Alpha.md");
    }
}
