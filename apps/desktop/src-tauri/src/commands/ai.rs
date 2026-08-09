use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

/// Break a task into digestible subtasks using Claude
#[tauri::command]
pub async fn break_down_task(
    app: AppHandle,
    task_content: String,
    task_description: Option<String>,
) -> Result<Vec<String>, String> {
    let pool = app.state::<SqlitePool>();

    // Get API key
    let api_key = nimble_core::db::settings::get_setting(pool.inner(), "anthropic_api_key")
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Anthropic API key not configured. Add it in Settings.".to_string())?;

    let subtasks = nimble_core::api::anthropic::break_down_task(
        &api_key,
        &task_content,
        task_description.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Log activity
    nimble_core::db::activity::log_activity(
        pool.inner(),
        "task_breakdown_requested",
        None,
        Some(serde_json::json!({
            "task_content": &task_content,
            "subtask_count": subtasks.len(),
        })),
    )
    .await;

    Ok(subtasks)
}
