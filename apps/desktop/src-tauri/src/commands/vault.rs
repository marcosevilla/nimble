use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use nimble_core::vault::{self, index, scanner, writer};

pub use nimble_core::vault::VaultStatus;
pub use nimble_core::vault::index::{VaultNoteRow, VaultNoteSummary, VaultSearchHit};
pub use nimble_core::vault::scanner::ScanReport;
pub use nimble_core::vault::writer::WriteOutcome;

async fn config(app: &AppHandle) -> Result<vault::VaultConfig, String> {
    let pool = app.state::<SqlitePool>();
    vault::load_config(pool.inner())
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Obsidian vault path not configured".to_string())
}

#[tauri::command]
pub async fn vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    let pool = app.state::<SqlitePool>();
    vault::status(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_rescan(app: AppHandle) -> Result<Option<ScanReport>, String> {
    let pool = app.state::<SqlitePool>();
    vault::scan_now(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_list_notes(app: AppHandle) -> Result<Vec<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::list_notes(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_get_note(app: AppHandle, path: String) -> Result<Option<VaultNoteRow>, String> {
    let pool = app.state::<SqlitePool>();
    index::get_note_by_path(pool.inner(), &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_search(
    app: AppHandle,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<VaultSearchHit>, String> {
    let pool = app.state::<SqlitePool>();
    index::search(pool.inner(), &query, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_backlinks(app: AppHandle, path: String) -> Result<Vec<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::backlinks(pool.inner(), &path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn vault_resolve_link(
    app: AppHandle,
    to_path: String,
) -> Result<Option<VaultNoteSummary>, String> {
    let pool = app.state::<SqlitePool>();
    index::resolve_link(pool.inner(), &to_path)
        .await
        .map_err(|e| e.to_string())
}

/// Write a note and immediately re-index it, so the UI reflects the save even
/// before the watcher's debounce window elapses.
#[tauri::command]
pub async fn vault_save_note(
    app: AppHandle,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteOutcome, String> {
    let cfg = config(&app).await?;
    let outcome = writer::write_note(&cfg, &path, &content, expected_hash.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    let pool = app.state::<SqlitePool>();
    let abs = cfg.root.join(&path);
    if let Err(e) = scanner::index_one(pool.inner(), &cfg, &abs).await {
        log::warn!("vault save: re-index of {path} failed: {e}");
    }
    if let WriteOutcome::Conflict { conflict_path, .. } = &outcome {
        let conflict_abs = cfg.root.join(conflict_path);
        if let Err(e) = scanner::index_one(pool.inner(), &cfg, &conflict_abs).await {
            log::warn!("vault save: re-index of conflict copy failed: {e}");
        }
    }

    Ok(outcome)
}

#[tauri::command]
pub async fn vault_create_note(
    app: AppHandle,
    path: String,
    content: Option<String>,
) -> Result<VaultNoteRow, String> {
    let cfg = config(&app).await?;
    let body = content.unwrap_or_default();
    writer::create_note(&cfg, &path, &body)
        .await
        .map_err(|e| e.to_string())?;

    let pool = app.state::<SqlitePool>();
    let abs = cfg.root.join(&path);
    scanner::index_one(pool.inner(), &cfg, &abs)
        .await
        .map_err(|e| e.to_string())?;

    index::get_note_by_path(pool.inner(), &path)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Note created but not indexed: {path}"))
}

#[tauri::command]
pub async fn vault_open_in_obsidian(app: AppHandle, path: String) -> Result<(), String> {
    let cfg = config(&app).await?;
    let uri = vault::obsidian_uri(&cfg, &path);
    std::process::Command::new("open")
        .arg(&uri)
        .spawn()
        .map_err(|e| format!("Failed to open Obsidian: {e}"))?;
    Ok(())
}
