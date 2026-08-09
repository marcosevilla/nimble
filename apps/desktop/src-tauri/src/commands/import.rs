use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub use nimble_core::types::ImportSummary;

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

/// Import goals, habits, and bingo items from the Obsidian vault.
#[tauri::command]
pub async fn import_goals_from_vault(app: AppHandle) -> Result<ImportSummary, String> {
    let pool = app.state::<SqlitePool>();
    let vault_path = get_vault_path(&app).await?;

    let mut goals_created: i32 = 0;
    let mut habits_created: i32 = 0;

    // --- Parse 2026 Resolutions & Goals ---
    let resolutions_path = format!(
        "{}/goals/\u{1FAA9} 2026 Resolutions & Goals.md",
        vault_path
    );
    if let Ok(content) = tokio::fs::read_to_string(&resolutions_path).await {
        let (goals, habits) = nimble_core::parsers::markdown::parse_resolutions(&content);

        for goal_name in &goals {
            let id = Uuid::new_v4().to_string();
            let max_pos: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM goals")
                    .fetch_one(pool.inner())
                    .await
                    .map_err(|e| e.to_string())?;

            sqlx::query(
                "INSERT INTO goals (id, name, status, position) VALUES (?, ?, 'active', ?)",
            )
            .bind(&id)
            .bind(goal_name)
            .bind(max_pos + 1)
            .execute(pool.inner())
            .await
            .map_err(|e| e.to_string())?;

            goals_created += 1;
        }

        for (habit_name, category) in &habits {
            let id = Uuid::new_v4().to_string();
            let max_pos: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM habits")
                    .fetch_one(pool.inner())
                    .await
                    .map_err(|e| e.to_string())?;

            sqlx::query(
                "INSERT INTO habits (id, name, category, position) VALUES (?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(habit_name)
            .bind(category)
            .bind(max_pos + 1)
            .execute(pool.inner())
            .await
            .map_err(|e| e.to_string())?;

            habits_created += 1;
        }
    }

    // --- Parse Bingo Card ---
    let bingo_path = format!("{}/goals/2026-bingo-card.md", vault_path);
    if let Ok(content) = tokio::fs::read_to_string(&bingo_path).await {
        let bingo_items = nimble_core::parsers::markdown::parse_bingo_card(&content);

        for item_name in &bingo_items {
            let id = Uuid::new_v4().to_string();
            let max_pos: i64 =
                sqlx::query_scalar("SELECT COALESCE(MAX(position), -1) FROM goals")
                    .fetch_one(pool.inner())
                    .await
                    .map_err(|e| e.to_string())?;

            sqlx::query(
                "INSERT INTO goals (id, name, status, position) VALUES (?, ?, 'not_started', ?)",
            )
            .bind(&id)
            .bind(item_name)
            .bind(max_pos + 1)
            .execute(pool.inner())
            .await
            .map_err(|e| e.to_string())?;

            goals_created += 1;
        }
    }

    nimble_core::db::activity::log_activity(
        pool.inner(),
        "vault_import",
        None,
        Some(serde_json::json!({
            "goals_created": goals_created,
            "habits_created": habits_created,
        })),
    )
    .await;

    Ok(ImportSummary {
        goals_created,
        habits_created,
    })
}
