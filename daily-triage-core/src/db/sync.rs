use sqlx::{SqlitePool, Column, Row};
use uuid::Uuid;
use chrono::Utc;

use crate::types::{SyncLogEntry, SyncStatus};

/// Append a sync log entry after a local mutation.
/// This is fire-and-forget: callers use `.ok()` so sync failures
/// never break the primary mutation.
pub async fn append_sync_log(
    pool: &SqlitePool,
    table_name: &str,
    row_id: &str,
    operation: &str,
    changed_columns: Option<&str>,
    snapshot: Option<&str>,
) -> crate::Result<()> {
    let device_id = get_or_create_device_id(pool).await?;
    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    sqlx::query(
        "INSERT INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
    )
    .bind(&id)
    .bind(table_name)
    .bind(row_id)
    .bind(operation)
    .bind(changed_columns)
    .bind(snapshot)
    .bind(&device_id)
    .bind(&timestamp)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get device_id from settings, or create one on first run.
pub async fn get_or_create_device_id(pool: &SqlitePool) -> crate::Result<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM settings WHERE key = 'device_id'",
    )
    .fetch_optional(pool)
    .await?;

    if let Some((device_id,)) = row {
        return Ok(device_id);
    }

    // Generate and persist a new device_id
    let device_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('device_id', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(&device_id)
    .execute(pool)
    .await?;

    Ok(device_id)
}

// ── Turso HTTP helpers ──

/// Build a Turso pipeline execute request from SQL + args.
fn turso_execute(sql: &str, args: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({
        "type": "execute",
        "stmt": {
            "sql": sql,
            "args": args
        }
    })
}

/// Wrap a string value for Turso pipeline args.
fn turso_text(val: &str) -> serde_json::Value {
    serde_json::json!({ "type": "text", "value": val })
}

/// Wrap a null value for Turso pipeline args.
fn turso_null() -> serde_json::Value {
    serde_json::json!({ "type": "null" })
}

/// Wrap an optional string as text or null for Turso pipeline args.
fn turso_text_or_null(val: &Option<String>) -> serde_json::Value {
    match val {
        Some(v) => turso_text(v),
        None => turso_null(),
    }
}

/// Send a pipeline request to Turso and return the parsed response.
async fn turso_pipeline(
    turso_url: &str,
    turso_token: &str,
    requests: Vec<serde_json::Value>,
) -> crate::Result<serde_json::Value> {
    let client = reqwest::Client::new();
    // Normalize the URL: convert libsql:// to https:// for the HTTP API
    let base_url = turso_url
        .trim_end_matches('/')
        .replace("libsql://", "https://");
    let url = format!("{}/v2/pipeline", base_url);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", turso_token))
        .json(&serde_json::json!({ "requests": requests }))
        .send()
        .await
        .map_err(|e| crate::Error::Api(format!("Turso request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(crate::Error::Api(format!(
            "Turso returned {}: {}", status, body
        )));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| crate::Error::Api(format!("Turso response parse failed: {}", e)))
}

// ── Test Connection ──

/// Test connection to Turso by running SELECT 1.
pub async fn test_connection(turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let requests = vec![
        turso_execute("SELECT 1", vec![]),
        serde_json::json!({ "type": "close" }),
    ];

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    // Verify we got a successful result
    let ok = body
        .pointer("/results/0/type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if ok != "ok" {
        let err_msg = body
            .pointer("/results/0/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        return Err(crate::Error::Api(format!("Turso test failed: {}", err_msg)));
    }

    Ok(())
}

// ── Initialize Remote ──

/// Create all synced tables on the remote Turso database.
/// Only runs once — checks for `turso_initialized` setting.
pub async fn initialize_remote(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<()> {
    // Check if already initialized
    let initialized: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM settings WHERE key = 'turso_initialized'",
    )
    .fetch_optional(pool)
    .await?;

    if initialized.is_some() {
        return Ok(());
    }

    // All CREATE TABLE statements for synced tables
    let create_statements = vec![
        // settings (needed for sync_log references but also useful)
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // local_tasks
        "CREATE TABLE IF NOT EXISTS local_tasks (
            id TEXT PRIMARY KEY,
            parent_id TEXT,
            content TEXT NOT NULL,
            description TEXT,
            project_id TEXT NOT NULL DEFAULT 'inbox',
            priority INTEGER NOT NULL DEFAULT 1,
            due_date TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            status TEXT NOT NULL DEFAULT 'todo',
            linked_doc_id TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // projects
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6366f1',
            position INTEGER NOT NULL DEFAULT 0,
            goal_id TEXT,
            milestone_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // captures
        "CREATE TABLE IF NOT EXISTS captures (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            converted_to_task_id TEXT,
            routed_to TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // goals
        "CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            life_area_id TEXT,
            start_date TEXT,
            target_date TEXT,
            color TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // milestones
        "CREATE TABLE IF NOT EXISTS milestones (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            name TEXT NOT NULL,
            target_date TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // habits
        "CREATE TABLE IF NOT EXISTS habits (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            icon TEXT NOT NULL DEFAULT 'Circle',
            color TEXT NOT NULL DEFAULT '#f59e0b',
            active INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // habit_logs
        "CREATE TABLE IF NOT EXISTS habit_logs (
            id TEXT PRIMARY KEY,
            habit_id TEXT NOT NULL,
            date TEXT NOT NULL,
            intensity INTEGER NOT NULL DEFAULT 5,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(habit_id, date)
        )",
        // daily_state
        "CREATE TABLE IF NOT EXISTS daily_state (
            date TEXT PRIMARY KEY,
            energy_level TEXT DEFAULT 'medium',
            top_priorities TEXT,
            first_opened_at TEXT,
            last_saved_at TEXT,
            focus_task_id TEXT,
            focus_started_at TEXT,
            focus_paused_at TEXT
        )",
        // activity_log
        "CREATE TABLE IF NOT EXISTS activity_log (
            id TEXT PRIMARY KEY,
            action_type TEXT NOT NULL,
            target_id TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // documents
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            folder_id TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // doc_folders
        "CREATE TABLE IF NOT EXISTS doc_folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // doc_notes
        "CREATE TABLE IF NOT EXISTS doc_notes (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            content TEXT NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // capture_routes
        "CREATE TABLE IF NOT EXISTS capture_routes (
            id TEXT PRIMARY KEY,
            prefix TEXT NOT NULL UNIQUE,
            target_type TEXT NOT NULL DEFAULT 'doc',
            doc_id TEXT,
            label TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#f59e0b',
            icon TEXT NOT NULL DEFAULT 'FileText',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // life_areas
        "CREATE TABLE IF NOT EXISTS life_areas (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'Target',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // calendar_feeds
        "CREATE TABLE IF NOT EXISTS calendar_feeds (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            url TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6366f1',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        // sync_log
        "CREATE TABLE IF NOT EXISTS sync_log (
            id TEXT PRIMARY KEY,
            table_name TEXT NOT NULL,
            row_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            changed_columns TEXT,
            snapshot TEXT,
            device_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            synced INTEGER DEFAULT 0
        )",
        "CREATE INDEX IF NOT EXISTS idx_sync_log_synced ON sync_log(synced)",
        "CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp)",
        "CREATE INDEX IF NOT EXISTS idx_sync_log_table_row ON sync_log(table_name, row_id)",
    ];

    // Build pipeline requests — one execute per statement
    let mut requests: Vec<serde_json::Value> = create_statements
        .iter()
        .map(|sql| turso_execute(sql, vec![]))
        .collect();
    requests.push(serde_json::json!({ "type": "close" }));

    turso_pipeline(turso_url, turso_token, requests).await?;

    // Mark as initialized locally
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('turso_initialized', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ── Push ──

/// Build INSERT OR REPLACE statements from a snapshot JSON for a given table.
/// Returns a vector of Turso execute requests to apply the data mutation.
fn build_data_mutation_requests(
    table_name: &str,
    row_id: &str,
    operation: &str,
    snapshot: &Option<String>,
) -> Vec<serde_json::Value> {
    match operation {
        "DELETE" => {
            // Validate table name
            if sanitize_table_name(table_name).is_err() {
                return vec![];
            }
            let sql = format!("DELETE FROM {} WHERE id = ?", table_name);
            vec![turso_execute(&sql, vec![turso_text(row_id)])]
        }
        "INSERT" | "UPDATE" => {
            let snapshot_str = match snapshot {
                Some(s) => s,
                None => return vec![],
            };

            let parsed: serde_json::Value = match serde_json::from_str(snapshot_str) {
                Ok(v) => v,
                Err(_) => return vec![],
            };

            let obj = match parsed.as_object() {
                Some(o) => o,
                None => return vec![],
            };

            // Validate table name
            if sanitize_table_name(table_name).is_err() {
                return vec![];
            }

            let columns: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
            let placeholders: Vec<&str> = columns.iter().map(|_| "?").collect();

            let sql = format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                table_name,
                columns.join(", "),
                placeholders.join(", ")
            );

            let args: Vec<serde_json::Value> = columns
                .iter()
                .map(|col| {
                    let val = &obj[*col];
                    match val {
                        serde_json::Value::Null => turso_null(),
                        serde_json::Value::Bool(b) => {
                            serde_json::json!({ "type": "integer", "value": if *b { "1" } else { "0" } })
                        }
                        serde_json::Value::Number(n) => {
                            if let Some(i) = n.as_i64() {
                                serde_json::json!({ "type": "integer", "value": i.to_string() })
                            } else if let Some(f) = n.as_f64() {
                                serde_json::json!({ "type": "float", "value": f.to_string() })
                            } else {
                                turso_text(&n.to_string())
                            }
                        }
                        serde_json::Value::String(s) => turso_text(s),
                        other => turso_text(&other.to_string()),
                    }
                })
                .collect();

            vec![turso_execute(&sql, args)]
        }
        _ => vec![],
    }
}

/// Push unsynced local entries to Turso via its HTTP API.
/// For each entry, pushes both the sync_log record and the actual data mutation.
/// Returns the count of entries pushed.
pub async fn push(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<u64> {
    // Fetch all unsynced entries
    let entries: Vec<(String, String, String, String, Option<String>, Option<String>, String, String)> =
        sqlx::query_as(
            "SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp
             FROM sync_log WHERE synced = 0 ORDER BY timestamp"
        )
        .fetch_all(pool)
        .await?;

    if entries.is_empty() {
        return Ok(0);
    }

    // Build batch of statements for Turso
    let mut statements: Vec<serde_json::Value> = Vec::new();
    let mut pushed_ids: Vec<String> = Vec::new();

    for (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp) in &entries {
        // 1. Apply the actual data mutation on Turso's copy of the table
        let mutation_requests = build_data_mutation_requests(table_name, row_id, operation, snapshot);
        statements.extend(mutation_requests);

        // 2. Insert the sync_log entry on Turso (so other devices can pull it)
        statements.push(turso_execute(
            "INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
            vec![
                turso_text(id),
                turso_text(table_name),
                turso_text(row_id),
                turso_text(operation),
                turso_text_or_null(changed_columns),
                turso_text_or_null(snapshot),
                turso_text(device_id),
                turso_text(timestamp),
            ],
        ));

        pushed_ids.push(id.clone());
    }

    // Add a "close" to end the pipeline
    statements.push(serde_json::json!({ "type": "close" }));

    // Send the pipeline — check for errors in the response
    let body = turso_pipeline(turso_url, turso_token, statements).await?;

    // Check if any result was an error
    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                log::warn!("Turso pipeline statement {} failed: {}", i, err_msg);
                // Don't fail the whole push for individual statement errors
                // (e.g., constraint violations on already-synced data)
            }
        }
    }

    // Mark local entries as synced
    let count = pushed_ids.len() as u64;
    for id in &pushed_ids {
        sqlx::query("UPDATE sync_log SET synced = 1 WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
    }

    // Update last_push_timestamp
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('last_push_timestamp', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(&now)
    .execute(pool)
    .await?;

    Ok(count)
}

// ── Pull ──

/// Pull remote changes from Turso that originated on other devices.
/// Applies each change to the local DB using last-write-wins.
/// Returns the count of applied entries.
pub async fn pull(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<u64> {
    let device_id = get_or_create_device_id(pool).await?;

    // Get last pull timestamp from settings
    let last_pull: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT value FROM settings WHERE key = 'last_pull_timestamp'), '1970-01-01T00:00:00.000Z')"
    )
    .fetch_one(pool)
    .await?;

    // Query Turso for entries from other devices since last pull
    let requests = vec![
        turso_execute(
            "SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp FROM sync_log WHERE timestamp > ? AND device_id != ? ORDER BY timestamp ASC",
            vec![turso_text(&last_pull), turso_text(&device_id)],
        ),
        serde_json::json!({ "type": "close" }),
    ];

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    // Parse the pipeline response: results[0].response.result.rows
    let rows = body
        .pointer("/results/0/response/result/rows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut applied: u64 = 0;
    let mut max_timestamp = last_pull.clone();

    for row in &rows {
        let cols = match row.as_array() {
            Some(c) => c,
            None => continue,
        };

        // Each column is { "type": "text", "value": "..." } or { "type": "null" }
        let get_text = |idx: usize| -> Option<String> {
            cols.get(idx)
                .and_then(|c| c.get("value"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        let entry_id = match get_text(0) { Some(v) => v, None => continue };
        let table_name = match get_text(1) { Some(v) => v, None => continue };
        let row_id = match get_text(2) { Some(v) => v, None => continue };
        let operation = match get_text(3) { Some(v) => v, None => continue };
        let changed_columns = get_text(4);
        let snapshot = get_text(5);
        let remote_device_id = match get_text(6) { Some(v) => v, None => continue };
        let timestamp = match get_text(7) { Some(v) => v, None => continue };

        // LWW check: skip if local has a newer sync_log entry for the same (table_name, row_id)
        let local_newer: Option<(String,)> = sqlx::query_as(
            "SELECT timestamp FROM sync_log WHERE table_name = ? AND row_id = ? AND timestamp > ? ORDER BY timestamp DESC LIMIT 1"
        )
        .bind(&table_name)
        .bind(&row_id)
        .bind(&timestamp)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);

        if local_newer.is_some() {
            log::info!("Skipping remote change {} — local has newer entry for {}/{}", entry_id, table_name, row_id);
            // Still record the entry so we don't pull it again
            let _ = sqlx::query(
                "INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"
            )
            .bind(&entry_id)
            .bind(&table_name)
            .bind(&row_id)
            .bind(&operation)
            .bind(&changed_columns)
            .bind(&snapshot)
            .bind(&remote_device_id)
            .bind(&timestamp)
            .execute(pool)
            .await;

            if timestamp > max_timestamp {
                max_timestamp = timestamp;
            }
            continue;
        }

        // For local_tasks deletes, capture external_id BEFORE the row dies so the
        // observer can still enqueue a Todoist delete op referencing it.
        let pre_delete_external_id: Option<String> = if operation == "DELETE" && table_name == "local_tasks" {
            sqlx::query_scalar("SELECT external_id FROM local_tasks WHERE id = ?")
                .bind(&row_id)
                .fetch_optional(pool)
                .await
                .ok()
                .flatten()
        } else {
            None
        };

        // Apply the change locally
        if let Err(e) = apply_remote_change(pool, &table_name, &row_id, &operation, snapshot.as_deref()).await {
            log::warn!("Failed to apply remote change {}: {}", entry_id, e);
            continue;
        }

        // Todoist mutation observer: best-effort, mirrors phone-originated changes
        crate::integrations::todoist::observer::on_turso_row_applied(
            pool,
            &table_name,
            &row_id,
            pre_delete_external_id,
            operation == "DELETE",
        )
        .await;

        // Record entry in local sync_log as already synced (so we don't push it back)
        let _ = sqlx::query(
            "INSERT OR IGNORE INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)"
        )
        .bind(&entry_id)
        .bind(&table_name)
        .bind(&row_id)
        .bind(&operation)
        .bind(&changed_columns)
        .bind(&snapshot)
        .bind(&remote_device_id)
        .bind(&timestamp)
        .execute(pool)
        .await;

        if timestamp > max_timestamp {
            max_timestamp = timestamp;
        }
        applied += 1;
    }

    // Update last_pull_timestamp
    if max_timestamp > last_pull {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES ('last_pull_timestamp', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
        )
        .bind(&max_timestamp)
        .execute(pool)
        .await?;
    }

    Ok(applied)
}

/// Apply a single remote change to the local database.
/// Uses last-write-wins: the snapshot contains the full row state.
async fn apply_remote_change(
    pool: &SqlitePool,
    table_name: &str,
    row_id: &str,
    operation: &str,
    snapshot: Option<&str>,
) -> crate::Result<()> {
    match operation {
        "DELETE" => {
            let sql = format!("DELETE FROM {} WHERE id = ?", sanitize_table_name(table_name)?);
            sqlx::query(&sql).bind(row_id).execute(pool).await?;
        }
        "INSERT" | "UPDATE" => {
            let snapshot = snapshot.ok_or_else(|| {
                crate::Error::Other("Missing snapshot for INSERT/UPDATE".to_string())
            })?;

            let row: serde_json::Value = serde_json::from_str(snapshot)
                .map_err(|e| crate::Error::Other(format!("Invalid snapshot JSON: {}", e)))?;

            let obj = row.as_object().ok_or_else(|| {
                crate::Error::Other("Snapshot is not a JSON object".to_string())
            })?;

            // Build an UPSERT: INSERT OR REPLACE
            let columns: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
            let placeholders: Vec<&str> = columns.iter().map(|_| "?").collect();

            let sql = format!(
                "INSERT OR REPLACE INTO {} ({}) VALUES ({})",
                sanitize_table_name(table_name)?,
                columns.join(", "),
                placeholders.join(", ")
            );

            let mut query = sqlx::query(&sql);
            for col in &columns {
                let val = &obj[*col];
                match val {
                    serde_json::Value::Null => { query = query.bind(None::<String>); }
                    serde_json::Value::Bool(b) => { query = query.bind(if *b { 1i64 } else { 0i64 }); }
                    serde_json::Value::Number(n) => {
                        if let Some(i) = n.as_i64() {
                            query = query.bind(i);
                        } else if let Some(f) = n.as_f64() {
                            query = query.bind(f);
                        }
                    }
                    serde_json::Value::String(s) => { query = query.bind(s.clone()); }
                    other => { query = query.bind(other.to_string()); }
                }
            }

            query.execute(pool).await?;
        }
        _ => {
            log::warn!("Unknown sync operation: {}", operation);
        }
    }

    Ok(())
}

/// Only allow known table names to prevent SQL injection.
fn sanitize_table_name(name: &str) -> crate::Result<&str> {
    const ALLOWED: &[&str] = &[
        "local_tasks",
        "projects",
        "captures",
        "goals",
        "milestones",
        "habits",
        "habit_logs",
        "daily_state",
        "activity_log",
        "documents",
        "doc_folders",
        "doc_notes",
        "capture_routes",
        "life_areas",
        "calendar_feeds",
    ];

    if ALLOWED.contains(&name) {
        Ok(name)
    } else {
        Err(crate::Error::Other(format!(
            "Table '{}' is not allowed for sync", name
        )))
    }
}

/// Get current sync status: pending changes, last sync time, device_id, config state.
pub async fn get_sync_status(pool: &SqlitePool) -> crate::Result<SyncStatus> {
    let pending_changes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_log WHERE synced = 0"
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let last_sync: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'last_pull_timestamp'"
    )
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let device_id = get_or_create_device_id(pool).await?;

    let turso_configured: bool = {
        let url: Option<String> = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key = 'turso_url'"
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        let token: Option<String> = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key = 'turso_token'"
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        url.is_some() && token.is_some()
    };

    let remote_initialized: bool = {
        let val: Option<String> = sqlx::query_scalar(
            "SELECT value FROM settings WHERE key = 'turso_initialized'"
        )
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        val.is_some()
    };

    Ok(SyncStatus {
        pending_changes,
        last_sync,
        device_id,
        turso_configured,
        remote_initialized,
    })
}

/// Seed sync_log with all existing data that predates sync tracking.
/// This creates INSERT entries for every row in every synced table that
/// doesn't already have a sync_log entry. Run once after enabling sync.
pub async fn seed_existing_data(pool: &SqlitePool) -> crate::Result<u64> {
    let device_id = get_or_create_device_id(pool).await?;
    let tables_with_id = [
        "local_tasks", "projects", "captures", "goals", "milestones",
        "habits", "habit_logs", "documents", "doc_folders", "doc_notes",
        "capture_routes", "life_areas", "calendar_feeds", "activity_log",
    ];

    let mut count: u64 = 0;

    for table in &tables_with_id {
        // Get all rows that don't have a sync_log entry yet
        let sql = format!(
            "SELECT id FROM {} WHERE id NOT IN (SELECT row_id FROM sync_log WHERE table_name = ?)",
            table
        );
        let rows: Vec<(String,)> = sqlx::query_as(&sql)
            .bind(*table)
            .fetch_all(pool)
            .await?;

        for (row_id,) in &rows {
            // Fetch the full row as JSON snapshot
            let row_sql = format!("SELECT * FROM {} WHERE id = ?", table);
            let row_data: Option<sqlx::sqlite::SqliteRow> = sqlx::query(&row_sql)
                .bind(row_id)
                .fetch_optional(pool)
                .await?;

            if let Some(row) = row_data {
                let columns = row.columns();
                let mut map = serde_json::Map::new();
                for col in columns {
                    let name = col.name();
                    let val: Option<String> = row.try_get(name).unwrap_or(None);
                    match val {
                        Some(v) => { map.insert(name.to_string(), serde_json::Value::String(v)); }
                        None => { map.insert(name.to_string(), serde_json::Value::Null); }
                    }
                }
                let snapshot = serde_json::to_string(&serde_json::Value::Object(map)).unwrap_or_default();

                let id = Uuid::new_v4().to_string();
                let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

                sqlx::query(
                    "INSERT INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
                     VALUES (?, ?, ?, 'INSERT', NULL, ?, ?, ?, 0)"
                )
                .bind(&id).bind(*table).bind(row_id)
                .bind(&snapshot).bind(&device_id).bind(&timestamp)
                .execute(pool)
                .await?;

                count += 1;
            }
        }
    }

    // Also seed daily_state (uses 'date' as PK, not 'id')
    let ds_rows: Vec<(String,)> = sqlx::query_as(
        "SELECT date FROM daily_state WHERE date NOT IN (SELECT row_id FROM sync_log WHERE table_name = 'daily_state')"
    )
    .fetch_all(pool)
    .await?;

    for (date,) in &ds_rows {
        let row_data: Option<sqlx::sqlite::SqliteRow> = sqlx::query("SELECT * FROM daily_state WHERE date = ?")
            .bind(date)
            .fetch_optional(pool)
            .await?;

        if let Some(row) = row_data {
            let columns = row.columns();
            let mut map = serde_json::Map::new();
            for col in columns {
                let name = col.name();
                let val: Option<String> = row.try_get(name).unwrap_or(None);
                match val {
                    Some(v) => { map.insert(name.to_string(), serde_json::Value::String(v)); }
                    None => { map.insert(name.to_string(), serde_json::Value::Null); }
                }
            }
            let snapshot = serde_json::to_string(&serde_json::Value::Object(map)).unwrap_or_default();

            let id = Uuid::new_v4().to_string();
            let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

            sqlx::query(
                "INSERT INTO sync_log (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)
                 VALUES (?, 'daily_state', ?, 'INSERT', NULL, ?, ?, ?, 0)"
            )
            .bind(&id).bind(date)
            .bind(&snapshot).bind(&device_id).bind(&timestamp)
            .execute(pool)
            .await?;

            count += 1;
        }
    }

    Ok(count)
}

/// Get unsynced sync log entries (for diagnostics).
pub async fn get_pending_entries(pool: &SqlitePool) -> crate::Result<Vec<SyncLogEntry>> {
    let rows: Vec<(String, String, String, String, Option<String>, Option<String>, String, String, i64)> =
        sqlx::query_as(
            "SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced
             FROM sync_log WHERE synced = 0 ORDER BY timestamp LIMIT 100"
        )
        .fetch_all(pool)
        .await?;

    Ok(rows.into_iter().map(|(id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp, synced)| {
        SyncLogEntry {
            id,
            table_name,
            row_id,
            operation,
            changed_columns,
            snapshot,
            device_id,
            timestamp,
            synced: synced != 0,
        }
    }).collect())
}
