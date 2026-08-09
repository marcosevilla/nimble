use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use super::local_tasks::LocalTask;
pub use nimble_core::types::Capture;

/// Get captures from SQLite, newest first
#[tauri::command]
pub async fn get_captures(
    app: AppHandle,
    limit: Option<i64>,
    include_converted: Option<bool>,
) -> Result<Vec<Capture>, String> {
    let pool = app.state::<SqlitePool>();
    let limit = limit.unwrap_or(50);
    let include_converted = include_converted.unwrap_or(false);
    nimble_core::db::captures::get_captures(pool.inner(), limit, include_converted)
        .await
        .map_err(|e| e.to_string())
}

/// Create a new capture in SQLite + backup to Obsidian
#[tauri::command]
pub async fn create_capture(
    app: AppHandle,
    content: String,
    source: Option<String>,
    context: Option<String>,
) -> Result<Capture, String> {
    let pool = app.state::<SqlitePool>();
    let source = source.unwrap_or_else(|| "manual".to_string());

    let capture = nimble_core::db::captures::create_capture(pool.inner(), &content, &source, context.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    // Backup to Obsidian (fire-and-forget, Tauri-specific: needs vault path from settings)
    let _ = write_obsidian_backup(&app, &content).await;

    Ok(capture)
}

/// Convert a capture to a task
#[tauri::command]
pub async fn convert_capture_to_task(
    app: AppHandle,
    capture_id: String,
    project_id: Option<String>,
) -> Result<LocalTask, String> {
    let pool = app.state::<SqlitePool>();

    let row = nimble_core::db::captures::get_capture_content(pool.inner(), &capture_id)
        .await
        .map_err(|e| e.to_string())?;
    let (_, content) = row.ok_or_else(|| "Capture not found".to_string())?;

    // Create the task via the core crate
    let task = nimble_core::db::tasks::create_local_task(
        pool.inner(),
        &content,
        project_id.as_deref(),
        None, None, None, None,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Mark capture as converted
    nimble_core::db::captures::mark_capture_converted(pool.inner(), &capture_id, &task.id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(task)
}

/// Delete a capture
#[tauri::command]
pub async fn delete_capture(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::captures::delete_capture(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}

/// Import captures from Obsidian Quick Captures.md into SQLite
#[tauri::command]
pub async fn import_obsidian_captures(app: AppHandle) -> Result<i64, String> {
    let pool = app.state::<SqlitePool>();

    // Get vault path (Tauri-specific: reads from settings + expands ~)
    let vault_path = get_vault_path(&app).await?;

    let file_path = format!("{}/inbox/Quick Captures.md", vault_path);
    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read Quick Captures.md: {}", e))?;

    // Parse entries (separated by ---)
    let mut imported = 0i64;
    let mut in_body = false;
    let mut header_count = 0;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        if line.trim() == "---" {
            if !in_body {
                header_count += 1;
                if header_count >= 2 {
                    in_body = true;
                }
                continue;
            }
            if !current_lines.is_empty() {
                let entry = current_lines.join("\n").trim().to_string();
                if !entry.is_empty() {
                    if nimble_core::db::captures::insert_capture_if_new(pool.inner(), &entry).await {
                        imported += 1;
                    }
                }
            }
            current_lines.clear();
            continue;
        }
        if in_body {
            current_lines.push(line);
        }
    }

    // Last entry
    if !current_lines.is_empty() {
        let entry = current_lines.join("\n").trim().to_string();
        if !entry.is_empty() {
            if nimble_core::db::captures::insert_capture_if_new(pool.inner(), &entry).await {
                imported += 1;
            }
        }
    }

    Ok(imported)
}

/// Write a backup copy to Obsidian Quick Captures.md (Tauri-specific: accesses app state)
async fn write_obsidian_backup(app: &AppHandle, content: &str) -> Result<(), String> {
    let vault_path = match get_vault_path(app).await {
        Ok(p) => p,
        Err(_) => return Ok(()), // No vault configured, skip silently
    };

    let file_path = format!("{}/inbox/Quick Captures.md", vault_path);
    let inbox_dir = format!("{}/inbox", vault_path);
    let _ = tokio::fs::create_dir_all(&inbox_dir).await;

    let timestamp = chrono::Local::now().format("%B %d, %Y at %I:%M %p").to_string();
    let new_entry = format!("\n---\n\n{}\n{}\n", timestamp, content.trim());

    let existing = match tokio::fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(_) => "---\ntags: inbox\n---\n".to_string(),
    };

    let updated = format!("{}{}", existing.trim_end(), new_entry);
    tokio::fs::write(&file_path, &updated)
        .await
        .map_err(|e| format!("Failed to write Obsidian backup: {}", e))?;

    Ok(())
}

/// Resolve vault path from settings (Tauri-specific helper)
async fn get_vault_path(app: &AppHandle) -> Result<String, String> {
    let pool = app.state::<SqlitePool>();
    let path = nimble_core::db::settings::get_setting(pool.inner(), "obsidian_vault_path")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Obsidian vault path not configured".to_string())?;

    if path.starts_with('~') {
        let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
        Ok(path.replacen('~', &home.to_string_lossy(), 1))
    } else {
        Ok(path)
    }
}
