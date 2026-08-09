use chrono::Local;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::parsers::markdown::ParsedTodayMd;
pub use nimble_core::types::QuickCapture;

/// Resolve the vault path from settings, expanding ~
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

/// Read a vault file's content, preferring the index (already in memory,
/// no disk hit) and falling back to disk when the note isn't indexed yet —
/// e.g. the very first launch before the initial scan finishes, or a file
/// under an excluded folder.
async fn read_vault_file(app: &AppHandle, rel: &str) -> Result<Option<String>, String> {
    let pool = app.state::<SqlitePool>();
    if let Ok(Some(note)) = nimble_core::vault::index::get_note_by_path(pool.inner(), rel).await {
        if note.deleted_at.is_none() {
            return Ok(Some(note.content));
        }
    }

    let vault_path = get_vault_path(app).await?;
    let file_path = format!("{}/{}", vault_path, rel);
    match tokio::fs::read_to_string(&file_path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", rel, e)),
    }
}

/// Parse Quick Captures.md -- entries separated by ---
fn parse_quick_captures(content: &str) -> Vec<QuickCapture> {
    let mut captures = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let mut header_count = 0;
    let mut in_body = false;

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
                    let (timestamp, text) = extract_timestamp(&entry);
                    captures.push(QuickCapture {
                        timestamp,
                        content: text,
                    });
                }
            }
            current_lines.clear();
            continue;
        }
        if in_body {
            current_lines.push(line);
        }
    }

    if !current_lines.is_empty() {
        let entry = current_lines.join("\n").trim().to_string();
        if !entry.is_empty() {
            let (timestamp, text) = extract_timestamp(&entry);
            captures.push(QuickCapture {
                timestamp,
                content: text,
            });
        }
    }

    captures.reverse();
    captures.truncate(10);
    captures
}

fn extract_timestamp(entry: &str) -> (Option<String>, String) {
    let lines: Vec<&str> = entry.lines().collect();
    if lines.is_empty() {
        return (None, entry.to_string());
    }

    let first = lines[0].trim();
    if first.contains("202") && (first.contains("AM") || first.contains("PM")) {
        let rest = lines[1..].join("\n").trim().to_string();
        (Some(first.to_string()), if rest.is_empty() { first.to_string() } else { rest })
    } else {
        (None, entry.to_string())
    }
}

#[tauri::command]
pub async fn read_today_md(app: AppHandle) -> Result<ParsedTodayMd, String> {
    let content = read_vault_file(&app, "today.md")
        .await?
        .ok_or_else(|| "Failed to read today.md: not found".to_string())?;
    Ok(nimble_core::parsers::markdown::parse_today_md(&content))
}

#[tauri::command]
pub async fn read_quick_captures(app: AppHandle) -> Result<Vec<QuickCapture>, String> {
    let content = read_vault_file(&app, "inbox/Quick Captures.md")
        .await?
        .ok_or_else(|| "Failed to read Quick Captures.md: not found".to_string())?;
    Ok(parse_quick_captures(&content))
}

#[tauri::command]
pub async fn read_session_log(app: AppHandle) -> Result<Option<String>, String> {
    let today = Local::now().format("%Y-%m-%d").to_string();
    read_vault_file(&app, &format!("journal/sessions/Session {}.md", today)).await
}

#[tauri::command]
pub async fn read_daily_brief(app: AppHandle, date: Option<String>) -> Result<Option<String>, String> {
    let date = date.unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    read_vault_file(&app, &format!("journal/briefs/Brief {}.md", date)).await
}

#[tauri::command]
pub async fn list_brief_dates(app: AppHandle) -> Result<Vec<String>, String> {
    let vault_path = get_vault_path(&app).await?;
    let briefs_dir = format!("{}/journal/briefs", vault_path);

    let mut dates = Vec::new();
    let mut dir = match tokio::fs::read_dir(&briefs_dir).await {
        Ok(d) => d,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(dates),
        Err(e) => return Err(format!("Failed to read briefs directory: {}", e)),
    };

    while let Ok(Some(entry)) = dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("Brief ") && name.ends_with(".md") {
            let date = name.trim_start_matches("Brief ").trim_end_matches(".md").to_string();
            if date.len() == 10 {
                dates.push(date);
            }
        }
    }

    dates.sort();
    dates.reverse();
    Ok(dates)
}

#[tauri::command]
pub async fn write_quick_capture(app: AppHandle, content: String) -> Result<QuickCapture, String> {
    let vault_path = get_vault_path(&app).await?;
    let file_path = format!("{}/inbox/Quick Captures.md", vault_path);

    let inbox_dir = format!("{}/inbox", vault_path);
    tokio::fs::create_dir_all(&inbox_dir)
        .await
        .map_err(|e| format!("Failed to create inbox dir: {}", e))?;

    let timestamp = Local::now().format("%B %d, %Y at %I:%M %p").to_string();
    let new_entry = format!("\n---\n\n{}\n{}\n", timestamp, content.trim());

    let existing = match tokio::fs::read_to_string(&file_path).await {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            "---\ntags: inbox\n---\n".to_string()
        }
        Err(e) => return Err(format!("Failed to read Quick Captures.md: {}", e)),
    };

    let updated = format!("{}{}", existing.trim_end(), new_entry);
    tokio::fs::write(&file_path, &updated)
        .await
        .map_err(|e| format!("Failed to write Quick Captures.md: {}", e))?;

    let pool = app.state::<SqlitePool>();
    nimble_core::db::activity::log_activity(
        pool.inner(),
        "item_captured",
        None,
        Some(serde_json::json!({
            "content": content.trim(),
            "source": "quick_capture",
        })),
    )
    .await;

    Ok(QuickCapture {
        timestamp: Some(timestamp),
        content: content.trim().to_string(),
    })
}

#[tauri::command]
pub async fn toggle_obsidian_checkbox(
    app: AppHandle,
    file_name: String,
    line_number: usize,
) -> Result<ParsedTodayMd, String> {
    let vault_path = get_vault_path(&app).await?;
    let file_path = format!("{}/{}", vault_path, file_name);

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read {}: {}", file_name, e))?;

    let new_content = nimble_core::parsers::markdown::toggle_checkbox(&content, line_number);

    tokio::fs::write(&file_path, &new_content)
        .await
        .map_err(|e| format!("Failed to write {}: {}", file_name, e))?;

    Ok(nimble_core::parsers::markdown::parse_today_md(&new_content))
}
