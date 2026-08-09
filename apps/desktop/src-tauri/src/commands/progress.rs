use chrono::Local;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::SaveResult;

/// Save progress: snapshot to SQLite + append session entry to Obsidian vault
#[tauri::command]
pub async fn save_progress(
    app: AppHandle,
    tasks_completed: String,
    tasks_open: String,
    tasks_deferred: String,
) -> Result<SaveResult, String> {
    let pool = app.state::<SqlitePool>();
    let now = Local::now();

    // 1. Save snapshot to SQLite + update daily_state
    let snapshot_id = nimble_core::db::daily_state::save_progress_snapshot(
        pool.inner(),
        &tasks_completed,
        &tasks_open,
        &tasks_deferred,
    )
    .await
    .map_err(|e| e.to_string())?;

    // 2. Write session log to Obsidian vault (Tauri-specific: needs vault path)
    let vault_path = get_vault_path(&app).await?;
    let session_file = format!(
        "{}/journal/sessions/Session {}.md",
        vault_path,
        now.format("%Y-%m-%d")
    );

    let sessions_dir = format!("{}/journal/sessions", vault_path);
    tokio::fs::create_dir_all(&sessions_dir)
        .await
        .map_err(|e| format!("Failed to create sessions dir: {}", e))?;

    let time_str = now.format("%-I:%M %p").to_string();
    let completed_list: Vec<String> = serde_json::from_str(&tasks_completed).unwrap_or_default();
    let open_list: Vec<String> = serde_json::from_str(&tasks_open).unwrap_or_default();

    let mut entry = String::new();

    let file_exists = tokio::fs::metadata(&session_file).await.is_ok();
    if !file_exists {
        entry.push_str(&format!(
            "---\ntype: session_log\ndate: {}\ngenerated: true\n---\n\n# Sessions — {}\n",
            now.format("%Y-%m-%d"),
            now.format("%A, %B %-d")
        ));
    }

    entry.push_str(&format!("\n---\n\n## {} — Nimble\n\n", time_str));
    entry.push_str("`#triage`\n\n");

    if !completed_list.is_empty() {
        entry.push_str("**Completed:**\n");
        for item in &completed_list {
            entry.push_str(&format!("- {}\n", item));
        }
        entry.push('\n');
    }

    if !open_list.is_empty() {
        entry.push_str("**Still open:**\n");
        for item in &open_list {
            entry.push_str(&format!("- {}\n", item));
        }
        entry.push('\n');
    }

    entry.push_str("> Logged from Nimble app\n");

    let mut existing = if file_exists {
        tokio::fs::read_to_string(&session_file)
            .await
            .unwrap_or_default()
    } else {
        String::new()
    };
    existing.push_str(&entry);

    tokio::fs::write(&session_file, &existing)
        .await
        .map_err(|e| format!("Failed to write session log: {}", e))?;

    Ok(SaveResult {
        snapshot_id,
        session_log_path: session_file,
    })
}

/// Resolve vault path from settings
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
