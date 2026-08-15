use sqlx::{SqlitePool, Column, Row};
use uuid::Uuid;
use chrono::Utc;

use crate::types::{LocalTask, SyncLogEntry, SyncStatus};

/// Build a `sync_log` snapshot for a `local_tasks` row.
///
/// `LocalTask::labels` is a derived join over `task_labels` (loaded
/// separately, not a `local_tasks` column — see its doc comment in
/// `types.rs`), but a plain `serde_json::to_string(&task)` still includes it.
/// `build_data_mutation_requests`/`apply_remote_change` build their
/// `INSERT`'s column list directly from the snapshot's JSON keys, so an
/// un-stripped snapshot produces `INSERT INTO local_tasks (..., labels) ...`
/// against a table with no `labels` column — a `no such column` error on
/// every apply, local or remote, for every task, not just labeled ones.
/// Strip it here so the snapshot only ever carries real columns.
pub(crate) fn task_sync_snapshot(task: &LocalTask) -> String {
    let mut value = serde_json::to_value(task).unwrap_or_default();
    if let Some(obj) = value.as_object_mut() {
        obj.remove("labels");
    }
    serde_json::to_string(&value).unwrap_or_default()
}

/// `task_labels` has no `id` column (its PK is the composite `(task_id,
/// label_id)`), so its `sync_log` `row_id` encodes both halves joined by
/// `"::"`. Every other synced table uses a single `id` column value as
/// `row_id` directly.
pub(crate) fn task_labels_row_id(task_id: &str, label_id: &str) -> String {
    format!("{task_id}::{label_id}")
}

/// Inverse of `task_labels_row_id`. Returns `None` for a malformed row_id
/// (missing delimiter) rather than panicking — callers treat that as "nothing
/// to apply" instead of crashing on a corrupt/foreign sync_log row.
fn split_task_labels_row_id(row_id: &str) -> Option<(&str, &str)> {
    row_id.split_once("::")
}

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

/// Hard ceiling on a single Turso HTTP round trip. Without it a stalled
/// connection hangs the sync task forever (no default timeout in reqwest),
/// which is the other way a large push kills sync. Two minutes is generous for
/// the largest batch this module will send (see `MAX_BATCH_BYTES`) even on a
/// poor connection, while still guaranteeing the call returns.
const TURSO_REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Send a pipeline request to Turso and return the parsed response.
async fn turso_pipeline(
    turso_url: &str,
    turso_token: &str,
    requests: Vec<serde_json::Value>,
) -> crate::Result<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(TURSO_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| crate::Error::Api(format!("Turso client build failed: {}", e)))?;
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

/// Remote DDL for the vault tables. Used both when initializing a fresh remote
/// and when upgrading a remote that was initialized before v18 — keep it the
/// single definition so the two paths can never drift apart.
const VAULT_TABLE_DDL: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS vault_notes (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        frontmatter_json TEXT,
        mtime TEXT,
        size INTEGER NOT NULL DEFAULT 0,
        hash TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
    )",
    "CREATE TABLE IF NOT EXISTS vault_links (
        id TEXT PRIMARY KEY,
        from_note_id TEXT NOT NULL,
        to_path TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'wikilink',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
    "CREATE TABLE IF NOT EXISTS vault_tags (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
];

/// Remote DDL for the v19 tables (labels, task_labels, sections). Used both
/// when initializing a fresh remote and when upgrading a remote that was
/// initialized before v19 — keep it the single definition so the two paths
/// can never drift apart. Mirrors `migrations.rs` version 19 exactly, minus
/// its indexes (not required for correctness, same as `VAULT_TABLE_DDL`).
const V19_TABLE_DDL: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT 'gray',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
    "CREATE TABLE IF NOT EXISTS task_labels (
        task_id TEXT NOT NULL,
        label_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (task_id, label_id)
    )",
    "CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        external_id TEXT,
        external_source TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )",
];

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
        // Remote tables already exist from an earlier version of this app.
        // The CREATE TABLE statements below never run again, so columns added
        // since the remote's first initialization (external_id, external_source,
        // remote_updated_at, synced_snapshot, captures.context) must be added
        // out-of-band via idempotent ALTERs. Safe to call on every invocation.
        return upgrade_remote_schema(turso_url, turso_token).await;
    }

    // All CREATE TABLE statements for synced tables
    let mut create_statements = vec![
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
            due_time TEXT,
            duration_minutes INTEGER,
            recurrence_rule TEXT,
            section_id TEXT,
            completed INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT,
            status TEXT NOT NULL DEFAULT 'todo',
            linked_doc_id TEXT,
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            external_id TEXT,
            external_source TEXT,
            remote_updated_at TEXT,
            synced_snapshot TEXT
        )",
        // projects
        "CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6366f1',
            position INTEGER NOT NULL DEFAULT 0,
            goal_id TEXT,
            milestone_id TEXT,
            parent_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            external_id TEXT,
            external_source TEXT,
            remote_updated_at TEXT,
            synced_snapshot TEXT
        )",
        // captures
        "CREATE TABLE IF NOT EXISTS captures (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            converted_to_task_id TEXT,
            routed_to TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            context TEXT
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

    create_statements.extend_from_slice(&VAULT_TABLE_DDL);
    create_statements.extend_from_slice(&V19_TABLE_DDL);

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

/// Idempotent remote-schema upgrade: adds columns that were introduced after a
/// remote may have already been initialized. libSQL has no `ADD COLUMN IF NOT
/// EXISTS`, so this tolerates "duplicate column name" errors from Turso and
/// only warns on anything else.
async fn upgrade_remote_schema(turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let alter_statements = [
        "ALTER TABLE local_tasks ADD COLUMN external_id TEXT",
        "ALTER TABLE local_tasks ADD COLUMN external_source TEXT",
        "ALTER TABLE local_tasks ADD COLUMN remote_updated_at TEXT",
        "ALTER TABLE local_tasks ADD COLUMN synced_snapshot TEXT",
        "ALTER TABLE projects ADD COLUMN external_id TEXT",
        "ALTER TABLE projects ADD COLUMN external_source TEXT",
        "ALTER TABLE projects ADD COLUMN remote_updated_at TEXT",
        "ALTER TABLE projects ADD COLUMN synced_snapshot TEXT",
        "ALTER TABLE captures ADD COLUMN context TEXT",
    ];

    let mut requests: Vec<serde_json::Value> = alter_statements
        .iter()
        .map(|sql| turso_execute(sql, vec![]))
        .collect();
    requests.push(serde_json::json!({ "type": "close" }));

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                // "duplicate column name" means the ALTER already landed on a
                // previous run — expected and safe to ignore.
                if !err_msg.to_lowercase().contains("duplicate column") {
                    log::warn!("Turso schema upgrade statement {} failed: {}", i, err_msg);
                }
            }
        }
    }

    Ok(())
}

/// Ensure the remote has the current column set before pushing data mutations
/// that reference them. Gated by a local setting so this only hits Turso once
/// per device rather than on every push; if the attempt fails outright (e.g.
/// network error) the setting is never marked, so the next push retries it.
async fn ensure_remote_schema_upgraded(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
) -> crate::Result<()> {
    let done: Option<(String,)> = sqlx::query_as(
        "SELECT value FROM settings WHERE key = 'turso_schema_v17_upgraded'",
    )
    .fetch_optional(pool)
    .await?;

    if done.is_some() {
        return Ok(());
    }

    upgrade_remote_schema(turso_url, turso_token).await?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('turso_schema_v17_upgraded', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Create the vault tables on a remote that was initialized before v18.
/// `CREATE TABLE IF NOT EXISTS` is idempotent, so this is safe to retry.
/// Shares `VAULT_TABLE_DDL` with `initialize_remote` — one definition only.
async fn create_remote_vault_tables(turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let mut requests: Vec<serde_json::Value> =
        VAULT_TABLE_DDL.iter().map(|sql| turso_execute(sql, vec![])).collect();
    requests.push(serde_json::json!({ "type": "close" }));

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                log::warn!("Turso vault-table statement {i} failed: {err_msg}");
                return Err(crate::Error::Api(format!(
                    "Turso vault schema upgrade failed: {err_msg}"
                )));
            }
        }
    }

    Ok(())
}

/// Gate the v18 remote upgrade behind a local setting so it hits Turso once per
/// device. If it fails the setting is never written, so the next push retries.
async fn ensure_remote_vault_schema(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
) -> crate::Result<()> {
    let done: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'turso_schema_v18_upgraded'")
            .fetch_optional(pool)
            .await?;
    if done.is_some() {
        return Ok(());
    }

    create_remote_vault_tables(turso_url, turso_token).await?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('turso_schema_v18_upgraded', '1', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Add the v19 tables (`labels`, `task_labels`, `sections`) and the v19
/// columns on already-synced tables (`local_tasks.due_time`/
/// `duration_minutes`/`recurrence_rule`/`section_id`, `projects.parent_id`)
/// to a remote that was initialized before v19. `CREATE TABLE IF NOT EXISTS`
/// and "duplicate column" tolerance make this idempotent/safe to retry.
async fn upgrade_remote_v19_schema(turso_url: &str, turso_token: &str) -> crate::Result<()> {
    let alter_statements = [
        "ALTER TABLE local_tasks ADD COLUMN due_time TEXT",
        "ALTER TABLE local_tasks ADD COLUMN duration_minutes INTEGER",
        "ALTER TABLE local_tasks ADD COLUMN recurrence_rule TEXT",
        "ALTER TABLE local_tasks ADD COLUMN section_id TEXT",
        "ALTER TABLE projects ADD COLUMN parent_id TEXT",
    ];

    let mut requests: Vec<serde_json::Value> =
        V19_TABLE_DDL.iter().map(|sql| turso_execute(sql, vec![])).collect();
    requests.extend(alter_statements.iter().map(|sql| turso_execute(sql, vec![])));
    requests.push(serde_json::json!({ "type": "close" }));

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    if let Some(results) = body.get("results").and_then(|v| v.as_array()) {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                // "duplicate column name" means the ALTER already landed on a
                // previous run — expected and safe to ignore. The CREATE
                // TABLE statements are already IF NOT EXISTS, so they never
                // surface as errors here.
                if !err_msg.to_lowercase().contains("duplicate column") {
                    log::warn!("Turso v19 schema upgrade statement {} failed: {}", i, err_msg);
                }
            }
        }
    }

    Ok(())
}

/// Gate the v19 remote upgrade behind a local setting so it hits Turso once
/// per device. If it fails the setting is never written, so the next push
/// retries. Mirrors `ensure_remote_vault_schema`'s v18 gate.
async fn ensure_remote_v19_schema(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
) -> crate::Result<()> {
    let done: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'turso_schema_v19_upgraded'")
            .fetch_optional(pool)
            .await?;
    if done.is_some() {
        return Ok(());
    }

    upgrade_remote_v19_schema(turso_url, turso_token).await?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('turso_schema_v19_upgraded', '1', datetime('now'))
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
            // task_labels has no `id` column — its row_id is the composite
            // "task_id::label_id" encoding (see `task_labels_row_id`).
            if table_name == "task_labels" {
                return match split_task_labels_row_id(row_id) {
                    Some((task_id, label_id)) => vec![turso_execute(
                        "DELETE FROM task_labels WHERE task_id = ? AND label_id = ?",
                        vec![turso_text(task_id), turso_text(label_id)],
                    )],
                    None => vec![],
                };
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

/// One unsynced `sync_log` row as selected by `push`:
/// `(id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp)`.
type PushEntry = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
    String,
);

/// Max entries in one Turso pipeline request.
///
/// Each entry contributes two statements (the data mutation and the sync_log
/// insert), so 200 entries is ~400 statements plus the `close` — well inside
/// what libSQL accepts in one pipeline, and few enough round trips that a
/// normal push (a handful of entries) still goes out in a single request.
const MAX_BATCH_ENTRIES: usize = 200;

/// Max approximate payload bytes in one Turso pipeline request.
///
/// The entry count alone is not a safe bound: a vault note's snapshot carries
/// the note's full text and travels **twice** per entry, so a few long journal
/// notes can blow past a request-size limit long before 200 entries do. 2 MiB
/// keeps every POST comfortably under Turso's request ceiling and bounded in
/// time; the first push after seeding the vault (~17–25 MB) becomes a dozen-odd
/// requests whose progress is committed one batch at a time instead of one
/// oversized request that fails and permanently wedges sync.
const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;

/// Approximate wire size of one entry, used only for batching decisions.
/// The snapshot is counted twice because it is sent twice — once inside the
/// data mutation's args and once inside the sync_log insert's args.
fn entry_payload_bytes(entry: &PushEntry) -> usize {
    let (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp) = entry;
    let snapshot_len = snapshot.as_ref().map(|s| s.len()).unwrap_or(0);
    id.len()
        + table_name.len()
        + row_id.len()
        + operation.len()
        + changed_columns.as_ref().map(|s| s.len()).unwrap_or(0)
        + snapshot_len * 2
        + device_id.len()
        + timestamp.len()
}

/// Split entry sizes (in order) into batches bounded by **both**
/// `MAX_BATCH_ENTRIES` and `MAX_BATCH_BYTES`, returning the entry count of each
/// batch. Pure so the boundary rules are testable without touching the network.
///
/// A single entry larger than `MAX_BATCH_BYTES` still goes out on its own —
/// emitting an empty batch instead would drop it and loop forever.
fn plan_batches(sizes: &[usize]) -> Vec<usize> {
    let mut batches: Vec<usize> = Vec::new();
    let mut count = 0usize;
    let mut bytes = 0usize;

    for &size in sizes {
        if count > 0 && (count + 1 > MAX_BATCH_ENTRIES || bytes + size > MAX_BATCH_BYTES) {
            batches.push(count);
            count = 0;
            bytes = 0;
        }
        count += 1;
        bytes += size;
    }

    if count > 0 {
        batches.push(count);
    }
    batches
}

/// Which pipeline statements a single `sync_log` entry contributed.
///
/// Recorded while the batch is assembled, so the response can be attributed
/// back to individual entries. Without it a batch is all-or-nothing and there
/// is no way to tell which entry a failed statement belonged to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EntrySpan {
    /// Index of this entry's first statement in the pipeline.
    start: usize,
    /// How many statements it contributed: its data mutations plus its one
    /// `sync_log` insert. Always at least 1.
    len: usize,
    /// False when the entry produced no data mutation at all — an unparseable
    /// snapshot, or a table name that failed validation. Such an entry can
    /// never succeed, however often it is retried.
    has_data_mutation: bool,
}

/// Decide which entries of a batch may be marked `synced = 1`.
///
/// `statement_ok[i]` is whether pipeline statement `i` came back `ok`.
///
/// An entry is marked only once EVERY statement it produced succeeded. This is
/// the rule that was missing: the previous version logged failed statements and
/// then marked the whole batch synced regardless. Because `push` only ever
/// selects `WHERE synced = 0`, a rejected write was never retried — it diverged
/// silently and permanently. Measured cost on this database before the fix:
/// 16 projects and 317 tasks absent from Turso while every local entry claimed
/// to be synced, traced to logged `no column named external_id` errors.
///
/// Two deliberate asymmetries:
///  - A missing result (the response carried fewer results than we sent) counts
///    as NOT ok, so a truncated response retries rather than silently drops.
///  - An entry with no data mutation is marked anyway. Retrying cannot parse an
///    invalid snapshot, and leaving it unsynced would wedge the queue behind a
///    poison pill forever. The caller logs it at error level instead.
///
/// Pure, so the attribution rules are testable without touching the network.
fn entries_safe_to_mark(spans: &[EntrySpan], statement_ok: &[bool]) -> Vec<bool> {
    spans
        .iter()
        .map(|span| {
            if !span.has_data_mutation {
                return true;
            }
            (span.start..span.start + span.len)
                .all(|i| statement_ok.get(i).copied().unwrap_or(false))
        })
        .collect()
}

/// Send one batch of entries to Turso and mark `synced = 1` on exactly those
/// entries whose statements all succeeded. Returns how many were marked.
///
/// Entries with a failed statement stay `synced = 0` and go out again on the
/// next push — which re-runs the remote schema upgrades first, so the common
/// cause (a snapshot naming a column the remote table does not have yet)
/// heals itself instead of silently losing the write.
///
/// Marking per batch (rather than after the whole run) is what makes progress
/// survive a mid-run failure: a batch that landed stays landed, and the next
/// push resumes from the first unsynced entry instead of restarting.
async fn push_batch(
    pool: &SqlitePool,
    turso_url: &str,
    turso_token: &str,
    entries: &[PushEntry],
) -> crate::Result<u64> {
    let mut statements: Vec<serde_json::Value> = Vec::new();
    let mut spans: Vec<EntrySpan> = Vec::with_capacity(entries.len());

    for (id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp) in entries {
        let start = statements.len();

        // 1. Apply the actual data mutation on Turso's copy of the table
        let mutation_requests = build_data_mutation_requests(table_name, row_id, operation, snapshot);
        let has_data_mutation = !mutation_requests.is_empty();
        statements.extend(mutation_requests);

        if !has_data_mutation {
            // The row cannot be reconstructed from this entry, so it will never
            // reach Turso. Say so loudly: it is marked synced below purely to
            // stop it blocking every future push, not because it succeeded.
            log::error!(
                "Turso push: sync_log entry {} ({} {} on {}) produced no data mutation — \
                 its row will NOT reach Turso. Marking synced anyway; retrying cannot \
                 repair an unparseable snapshot or a rejected table name.",
                id,
                operation,
                row_id,
                table_name
            );
        }

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

        spans.push(EntrySpan {
            start,
            len: statements.len() - start,
            has_data_mutation,
        });
    }

    // Add a "close" to end the pipeline
    statements.push(serde_json::json!({ "type": "close" }));

    // Send the pipeline — check for errors in the response
    let body = turso_pipeline(turso_url, turso_token, statements).await?;

    // Turso answers with HTTP 200 even when individual statements failed, so
    // the per-statement types are the only signal that a write was rejected.
    let results = body.get("results").and_then(|v| v.as_array());
    let statement_ok: Vec<bool> = results
        .map(|rs| {
            rs.iter()
                .map(|r| r.get("type").and_then(|v| v.as_str()) != Some("error"))
                .collect()
        })
        .unwrap_or_default();

    if let Some(results) = results {
        for (i, result) in results.iter().enumerate() {
            if let Some("error") = result.get("type").and_then(|v| v.as_str()) {
                let err_msg = result
                    .pointer("/error/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error");
                log::warn!("Turso pipeline statement {} failed: {}", i, err_msg);
            }
        }
    }

    // Mark ONLY the entries whose every statement landed. The rest keep
    // `synced = 0` and go out again on the next push. Marking unconditionally
    // here is what silently and permanently dropped rejected writes.
    let safe_to_mark = entries_safe_to_mark(&spans, &statement_ok);

    let mut marked: u64 = 0;
    for ((id, ..), ok) in entries.iter().zip(safe_to_mark.iter()) {
        if !ok {
            continue;
        }
        sqlx::query("UPDATE sync_log SET synced = 1 WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;
        marked += 1;
    }

    let retrying = entries.len() as u64 - marked;
    if retrying > 0 {
        log::warn!(
            "Turso push: {} of {} entries were rejected and stay unsynced; \
             the next push retries them after re-running the remote schema upgrades",
            retrying,
            entries.len()
        );
    }

    Ok(marked)
}

/// Push unsynced local entries to Turso via its HTTP API.
/// For each entry, pushes both the sync_log record and the actual data mutation.
/// Sends them in batches bounded by entry count and payload size, committing
/// each batch's `synced` flags before the next goes out. Returns the count of
/// entries pushed; on a batch failure it stops and returns the error, leaving
/// the batches that already landed marked synced.
pub async fn push(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<u64> {
    // Guard against C1: on an already-initialized remote, ensure the columns
    // this branch added (external_id, external_source, remote_updated_at,
    // synced_snapshot, captures.context) exist before we try to write them.
    ensure_remote_schema_upgraded(pool, turso_url, turso_token).await?;

    // v18: the vault tables may not exist on a remote initialized earlier.
    ensure_remote_vault_schema(pool, turso_url, turso_token).await?;

    // v19: labels/task_labels/sections tables + local_tasks/projects columns
    // may not exist on a remote initialized earlier.
    ensure_remote_v19_schema(pool, turso_url, turso_token).await?;

    // Fetch all unsynced entries
    let entries: Vec<PushEntry> = sqlx::query_as(
        "SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp
         FROM sync_log WHERE synced = 0 ORDER BY timestamp"
    )
    .fetch_all(pool)
    .await?;

    if entries.is_empty() {
        return Ok(0);
    }

    // Split into batches. A push that fits both bounds — the common case —
    // plans exactly one batch, so it behaves identically to an unchunked push.
    let sizes: Vec<usize> = entries.iter().map(entry_payload_bytes).collect();
    let batches = plan_batches(&sizes);
    if batches.len() > 1 {
        log::info!(
            "Turso push: {} unsynced entries split into {} batches",
            entries.len(),
            batches.len()
        );
    }

    let mut pushed: u64 = 0;
    let mut offset = 0usize;
    let mut failure: Option<crate::Error> = None;

    for batch_len in batches {
        let chunk = &entries[offset..offset + batch_len];
        offset += batch_len;
        match push_batch(pool, turso_url, turso_token, chunk).await {
            Ok(n) => pushed += n,
            Err(e) => {
                // Stop here, but keep what already landed: those batches are
                // marked synced, so the next push resumes instead of retrying
                // the whole (possibly oversized) set from the start.
                log::warn!(
                    "Turso push failed after {} of {} entries: {}",
                    pushed,
                    entries.len(),
                    e
                );
                failure = Some(e);
                break;
            }
        }
    }

    // Update last_push_timestamp only if something actually reached Turso.
    if pushed > 0 {
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES ('last_push_timestamp', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
        )
        .bind(&now)
        .execute(pool)
        .await?;
    }

    match failure {
        Some(e) => Err(e),
        None => Ok(pushed),
    }
}

// ── Pull ──

/// Max `sync_log` rows fetched from Turso in one pull request.
///
/// The pull had no LIMIT at all: it asked for everything newer than
/// `last_pull_timestamp` in a single pipeline request and held the whole result
/// set — snapshots included — in memory. With a four-month-stale watermark and a
/// ~34k-row backlog that request is large enough to fail, and a failed request
/// never advanced the watermark, so the next pull re-issued the identical
/// failing request forever.
///
/// 200 mirrors `MAX_BATCH_ENTRIES` on the push side deliberately. A pull row
/// carries its snapshot **once** (push sends it twice — data mutation plus
/// sync_log insert), so a 200-row pull response is strictly smaller than a
/// 200-entry push request, a bound already proven in production. Unlike push we
/// cannot bound the response by bytes in advance — the row count is the only
/// lever the server-side LIMIT gives us — which is another reason to keep the
/// count conservative rather than raising it to shorten the drain.
const MAX_PULL_ROWS: usize = 200;

/// Where the last pull stopped, as a **composite** keyset cursor.
///
/// A bare timestamp cannot page safely: several `sync_log` rows routinely share
/// one millisecond, and a chunk boundary can land in the middle of such a group.
/// `timestamp > watermark` would then skip the rest of the group, while
/// `timestamp >= watermark` would re-read it forever. Pairing the timestamp with
/// the row `id` (the `sync_log` primary key) makes the ordering total, so
/// `(timestamp, id) > (cursor.timestamp, cursor.entry_id)` advances past exactly
/// the rows already handled and no others.
#[derive(Clone, Debug, PartialEq, Eq)]
struct PullCursor {
    timestamp: String,
    /// `sync_log.id` of the last row handled at `timestamp`. Empty means "start
    /// of that millisecond" — every id sorts after `""`, so nothing is skipped.
    entry_id: String,
}

/// Settings key holding the encoded composite cursor. `last_pull_timestamp`
/// stays the canonical, human-readable watermark (the sync status UI reads it);
/// this key only carries the extra id half.
const PULL_CURSOR_KEY: &str = "last_pull_cursor";

const PULL_EPOCH: &str = "1970-01-01T00:00:00.000Z";

/// Encode a cursor as `"<timestamp>|<entry_id>"`. Timestamps and UUIDs never
/// contain `|`, so the split is unambiguous.
fn encode_pull_cursor(cursor: &PullCursor) -> String {
    format!("{}|{}", cursor.timestamp, cursor.entry_id)
}

/// Rebuild the cursor from the two settings values.
///
/// The stored id is honoured **only** when the timestamp embedded alongside it
/// still matches `last_pull_timestamp`. That self-check makes a torn write (the
/// two settings rows are written back to back, not atomically) harmless in both
/// orders: a mismatch degrades to `entry_id = ""`, which re-reads that one
/// millisecond — idempotent, since applying a snapshot is `INSERT OR REPLACE`
/// and recording the entry is `INSERT OR IGNORE` — instead of skipping rows.
fn decode_pull_cursor(last_pull: &str, stored: Option<&str>) -> PullCursor {
    let entry_id = stored
        .and_then(|s| s.split_once('|'))
        .filter(|(ts, _)| *ts == last_pull)
        .map(|(_, id)| id.to_string())
        .unwrap_or_default();

    PullCursor {
        timestamp: last_pull.to_string(),
        entry_id,
    }
}

/// Load the pull cursor from settings.
async fn load_pull_cursor(pool: &SqlitePool) -> crate::Result<PullCursor> {
    let last_pull: String = sqlx::query_scalar(
        "SELECT COALESCE((SELECT value FROM settings WHERE key = 'last_pull_timestamp'), ?)"
    )
    .bind(PULL_EPOCH)
    .fetch_one(pool)
    .await?;

    let stored: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = ?"
    )
    .bind(PULL_CURSOR_KEY)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    Ok(decode_pull_cursor(&last_pull, stored.as_deref()))
}

/// Persist the cursor. Called once per applied chunk — that per-chunk commit is
/// what makes an interrupted drain resumable instead of restarting.
async fn save_pull_cursor(pool: &SqlitePool, cursor: &PullCursor) -> crate::Result<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(PULL_CURSOR_KEY)
    .bind(encode_pull_cursor(cursor))
    .execute(pool)
    .await?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES ('last_pull_timestamp', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(&cursor.timestamp)
    .execute(pool)
    .await?;

    Ok(())
}

/// Fetch one bounded chunk of remote `sync_log` rows strictly after `cursor`.
async fn fetch_pull_chunk(
    turso_url: &str,
    turso_token: &str,
    device_id: &str,
    cursor: &PullCursor,
) -> crate::Result<Vec<serde_json::Value>> {
    // Keyset pagination on (timestamp, id): the second disjunct is what carries
    // us across a chunk boundary that fell inside a group of rows sharing one
    // timestamp.
    let sql = format!(
        "SELECT id, table_name, row_id, operation, changed_columns, snapshot, device_id, timestamp \
         FROM sync_log \
         WHERE (timestamp > ? OR (timestamp = ? AND id > ?)) AND device_id != ? \
         ORDER BY timestamp ASC, id ASC LIMIT {}",
        MAX_PULL_ROWS
    );

    let requests = vec![
        turso_execute(
            &sql,
            vec![
                turso_text(&cursor.timestamp),
                turso_text(&cursor.timestamp),
                turso_text(&cursor.entry_id),
                turso_text(device_id),
            ],
        ),
        serde_json::json!({ "type": "close" }),
    ];

    let body = turso_pipeline(turso_url, turso_token, requests).await?;

    // A statement-level failure comes back as HTTP 200 with an error result, so
    // `turso_pipeline` cannot catch it. Treating that as "no rows" is how an
    // oversized request looked like a successful empty pull.
    if body.pointer("/results/0/type").and_then(|v| v.as_str()) == Some("error") {
        let msg = body
            .pointer("/results/0/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(crate::Error::Api(format!("Turso pull failed: {}", msg)));
    }

    Ok(body
        .pointer("/results/0/response/result/rows")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default())
}

/// Pull remote changes from Turso that originated on other devices.
/// Applies each change to the local DB using last-write-wins.
///
/// Rows are drained in chunks of `MAX_PULL_ROWS`, and the watermark is persisted
/// after every chunk, so an interrupted or failed drain resumes where it stopped
/// rather than re-issuing the whole request. Returns the count of applied
/// entries; on a chunk failure it stops and returns the error, keeping the
/// progress already committed.
pub async fn pull(pool: &SqlitePool, turso_url: &str, turso_token: &str) -> crate::Result<u64> {
    let device_id = get_or_create_device_id(pool).await?;
    let mut cursor = load_pull_cursor(pool).await?;

    let mut applied: u64 = 0;
    let mut seen: u64 = 0;

    loop {
        let rows = match fetch_pull_chunk(turso_url, turso_token, &device_id, &cursor).await {
            Ok(rows) => rows,
            Err(e) => {
                // Stop, but keep the chunks that already landed: their cursor is
                // persisted, so the next pull resumes from there instead of
                // retrying the whole backlog.
                log::warn!(
                    "Turso pull failed after {} applied ({} rows seen): {}",
                    applied,
                    seen,
                    e
                );
                return Err(e);
            }
        };

        if rows.is_empty() {
            break;
        }

        let chunk_len = rows.len();
        // Cursor position reached within this chunk. Advanced for every row we
        // *saw*, applied or not — a row we skip (LWW) or fail to apply must not
        // pin the watermark, or one poison row wedges the drain permanently,
        // which is the failure mode this fix exists to remove.
        let mut chunk_cursor: Option<PullCursor> = None;

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

            // id + timestamp first: they are the cursor, so a row missing
            // anything else can still be stepped over.
            let entry_id = match get_text(0) { Some(v) => v, None => continue };
            let timestamp = match get_text(7) { Some(v) => v, None => continue };
            chunk_cursor = Some(PullCursor {
                timestamp: timestamp.clone(),
                entry_id: entry_id.clone(),
            });
            seen += 1;

            let table_name = match get_text(1) { Some(v) => v, None => continue };
            let row_id = match get_text(2) { Some(v) => v, None => continue };
            let operation = match get_text(3) { Some(v) => v, None => continue };
            let changed_columns = get_text(4);
            let snapshot = get_text(5);
            let remote_device_id = match get_text(6) { Some(v) => v, None => continue };

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

            // Vault: a note row applied from another device needs its device-local
            // FTS entry refreshed (links/tags are re-derived when the Mac re-parses
            // the file).
            crate::vault::index::on_turso_row_applied(pool, &table_name, &row_id).await;

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

            applied += 1;
        }

        match chunk_cursor {
            Some(next) => {
                // Commit progress before requesting the next chunk.
                cursor = next;
                save_pull_cursor(pool, &cursor).await?;
            }
            None => {
                // Every row in the chunk lacked an id or timestamp — pathological
                // data. Continuing would re-request the identical chunk forever,
                // so stop and leave the watermark untouched.
                log::error!(
                    "Turso pull: chunk of {} rows yielded no usable cursor; stopping drain at {}",
                    chunk_len,
                    cursor.timestamp
                );
                break;
            }
        }

        if chunk_len < MAX_PULL_ROWS {
            break;
        }

        log::info!(
            "Turso pull: {} rows drained so far (cursor {}), fetching next chunk",
            seen,
            cursor.timestamp
        );
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
            let table = sanitize_table_name(table_name)?;
            // task_labels has no `id` column — its row_id is the composite
            // "task_id::label_id" encoding (see `task_labels_row_id`).
            if table == "task_labels" {
                if let Some((task_id, label_id)) = split_task_labels_row_id(row_id) {
                    sqlx::query("DELETE FROM task_labels WHERE task_id = ? AND label_id = ?")
                        .bind(task_id)
                        .bind(label_id)
                        .execute(pool)
                        .await?;
                }
                return Ok(());
            }
            let sql = format!("DELETE FROM {} WHERE id = ?", table);
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
        "vault_notes",
        "vault_links",
        "vault_tags",
        "labels",
        "task_labels",
        "sections",
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
        "vault_notes", "vault_links", "vault_tags",
        "labels", "sections",
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

    // Also seed task_labels (composite PK task_id+label_id, no 'id' column —
    // row_id is the "task_id::label_id" encoding from `task_labels_row_id`).
    let tl_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT task_id, label_id FROM task_labels")
            .fetch_all(pool)
            .await?;

    for (task_id, label_id) in &tl_rows {
        let row_id = task_labels_row_id(task_id, label_id);
        let already_seeded: Option<(String,)> = sqlx::query_as(
            "SELECT row_id FROM sync_log WHERE table_name = 'task_labels' AND row_id = ?",
        )
        .bind(&row_id)
        .fetch_optional(pool)
        .await?;
        if already_seeded.is_some() {
            continue;
        }

        let row_data: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
            "SELECT * FROM task_labels WHERE task_id = ? AND label_id = ?",
        )
        .bind(task_id)
        .bind(label_id)
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
                 VALUES (?, 'task_labels', ?, 'INSERT', NULL, ?, ?, ?, 0)"
            )
            .bind(&id).bind(&row_id)
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

#[cfg(test)]
mod push_batching_tests {
    use super::{
        entries_safe_to_mark, entry_payload_bytes, plan_batches, EntrySpan, PushEntry,
        MAX_BATCH_BYTES, MAX_BATCH_ENTRIES,
    };

    fn entry(snapshot_len: usize) -> PushEntry {
        (
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            None,
            Some("x".repeat(snapshot_len)),
            String::new(),
            String::new(),
        )
    }

    #[test]
    fn nothing_to_push_plans_no_batches() {
        assert!(plan_batches(&[]).is_empty());
    }

    /// One entry contributing `len` statements starting at `start`, with a real
    /// data mutation — the ordinary case.
    fn span(start: usize, len: usize) -> EntrySpan {
        EntrySpan { start, len, has_data_mutation: true }
    }

    #[test]
    fn a_fully_successful_batch_marks_every_entry() {
        // Two entries, two statements each (mutation + sync_log insert).
        let spans = [span(0, 2), span(2, 2)];
        assert_eq!(
            entries_safe_to_mark(&spans, &[true, true, true, true]),
            vec![true, true]
        );
    }

    #[test]
    fn a_failed_statement_leaves_its_own_entry_unsynced_and_spares_the_rest() {
        // Entry 1's data mutation is rejected (statement 2). Its sync_log insert
        // still succeeds — which is exactly why checking "did the POST return
        // 2xx" was not enough to catch this.
        let spans = [span(0, 2), span(2, 2), span(4, 2)];
        let ok = [true, true, false, true, true, true];
        assert_eq!(
            entries_safe_to_mark(&spans, &ok),
            vec![true, false, true],
            "only the entry owning the failed statement may stay unsynced"
        );
    }

    /// The concrete regression: on 2026-08-03 sixteen `projects` rows were
    /// rejected with `table projects has no column named external_id`, were
    /// logged as warnings, and were then marked synced anyway — so they never
    /// retried and stayed absent from Turso until repaired by hand.
    #[test]
    fn the_regression_that_lost_sixteen_projects_stays_unsynced_for_retry() {
        let spans: Vec<EntrySpan> = (0..16).map(|i| span(i * 2, 2)).collect();
        // Every data mutation rejected; every sync_log insert accepted.
        let ok: Vec<bool> = (0..32).map(|i| i % 2 == 1).collect();
        let marked = entries_safe_to_mark(&spans, &ok);
        assert!(
            marked.iter().all(|m| !m),
            "no entry may be marked synced when its data mutation was rejected"
        );
    }

    #[test]
    fn a_truncated_response_retries_rather_than_dropping() {
        // Two entries sent, results for only the first came back.
        let spans = [span(0, 2), span(2, 2)];
        assert_eq!(
            entries_safe_to_mark(&spans, &[true, true]),
            vec![true, false],
            "a missing result must count as failure, not as success"
        );
    }

    #[test]
    fn an_unparseable_entry_is_marked_rather_than_wedging_the_queue() {
        // No data mutation could be built, so only the sync_log insert went out.
        // Retrying can never fix it; leaving it unsynced would block the queue
        // behind a poison pill on every future push.
        let spans = [EntrySpan { start: 0, len: 1, has_data_mutation: false }];
        assert_eq!(entries_safe_to_mark(&spans, &[true]), vec![true]);
    }

    #[test]
    fn an_empty_batch_marks_nothing() {
        assert!(entries_safe_to_mark(&[], &[]).is_empty());
    }

    #[test]
    fn a_small_push_stays_a_single_batch() {
        // The common case must not change semantics: one request, as before.
        let sizes = vec![100usize; 12];
        assert_eq!(plan_batches(&sizes), vec![12]);
    }

    #[test]
    fn entry_count_bound_splits_at_the_limit_not_before() {
        let exact = vec![1usize; MAX_BATCH_ENTRIES];
        assert_eq!(plan_batches(&exact), vec![MAX_BATCH_ENTRIES]);

        let one_over = vec![1usize; MAX_BATCH_ENTRIES + 1];
        assert_eq!(plan_batches(&one_over), vec![MAX_BATCH_ENTRIES, 1]);

        let two_and_a_bit = vec![1usize; MAX_BATCH_ENTRIES * 2 + 3];
        assert_eq!(
            plan_batches(&two_and_a_bit),
            vec![MAX_BATCH_ENTRIES, MAX_BATCH_ENTRIES, 3]
        );
    }

    #[test]
    fn byte_bound_splits_before_the_entry_bound_when_entries_are_large() {
        // Three entries at 40% of the byte ceiling: two fit, the third starts a
        // new batch, even though the entry count is nowhere near its limit.
        let big = MAX_BATCH_BYTES * 2 / 5;
        assert_eq!(plan_batches(&[big, big, big]), vec![2, 1]);

        // Exactly filling the ceiling is allowed; one byte more is not.
        let half = MAX_BATCH_BYTES / 2;
        assert_eq!(plan_batches(&[half, MAX_BATCH_BYTES - half]), vec![2]);
        assert_eq!(plan_batches(&[half, MAX_BATCH_BYTES - half + 1]), vec![1, 1]);
    }

    #[test]
    fn an_oversized_entry_goes_out_alone_rather_than_being_dropped() {
        // A single journal note bigger than the whole byte budget must still be
        // pushed — never silently skipped, never an empty batch (which would
        // make the caller loop forever).
        let plan = plan_batches(&[10, MAX_BATCH_BYTES * 3, 10]);
        assert_eq!(plan, vec![1, 1, 1]);
        assert_eq!(plan.iter().sum::<usize>(), 3, "every entry is accounted for");
        assert!(plan.iter().all(|&n| n > 0), "no empty batches: {plan:?}");
    }

    #[test]
    fn every_entry_lands_in_exactly_one_batch() {
        let sizes: Vec<usize> = (0..1000).map(|i| (i * 7919) % 50_000).collect();
        let plan = plan_batches(&sizes);
        assert_eq!(plan.iter().sum::<usize>(), sizes.len());
        assert!(plan.iter().all(|&n| n <= MAX_BATCH_ENTRIES));

        // And each planned batch respects the byte bound unless it is a lone
        // oversized entry.
        let mut offset = 0usize;
        for len in plan {
            let bytes: usize = sizes[offset..offset + len].iter().sum();
            assert!(
                bytes <= MAX_BATCH_BYTES || len == 1,
                "batch of {len} entries is {bytes} bytes"
            );
            offset += len;
        }
    }

    #[test]
    fn snapshot_is_counted_twice_because_it_is_sent_twice() {
        // The snapshot rides along in both the data mutation and the sync_log
        // insert; a size bound that counted it once would under-measure by ~2x.
        let e = entry(1000);
        assert_eq!(entry_payload_bytes(&e), 2000);
    }
}

#[cfg(test)]
mod pull_cursor_tests {
    use super::{decode_pull_cursor, encode_pull_cursor, PullCursor};

    #[test]
    fn a_fresh_client_starts_at_the_beginning_of_the_watermark_millisecond() {
        // No stored cursor: the id half is empty, and every UUID sorts after
        // "", so `id > ''` re-reads the whole millisecond rather than skipping
        // rows the old `timestamp >` comparison would have dropped.
        let c = decode_pull_cursor("2026-04-05T06:20:35.108Z", None);
        assert_eq!(c.timestamp, "2026-04-05T06:20:35.108Z");
        assert_eq!(c.entry_id, "");
    }

    #[test]
    fn a_matching_stored_cursor_keeps_its_id_half() {
        let c = decode_pull_cursor(
            "2026-04-05T06:20:35.108Z",
            Some("2026-04-05T06:20:35.108Z|abc-123"),
        );
        assert_eq!(c.entry_id, "abc-123");
    }

    #[test]
    fn a_torn_write_degrades_to_a_re_read_never_to_a_skip() {
        // The two settings rows are written back to back, not atomically. If
        // only one landed, the embedded timestamp no longer matches and the id
        // must be discarded — re-reading one millisecond is idempotent, whereas
        // trusting a stale id against a different timestamp would skip rows.
        let stale = decode_pull_cursor(
            "2026-04-06T00:00:00.000Z",
            Some("2026-04-05T06:20:35.108Z|abc-123"),
        );
        assert_eq!(stale.entry_id, "");
        assert_eq!(stale.timestamp, "2026-04-06T00:00:00.000Z");

        let garbage = decode_pull_cursor("2026-04-06T00:00:00.000Z", Some("not-a-cursor"));
        assert_eq!(garbage.entry_id, "");
    }

    #[test]
    fn encoding_round_trips() {
        let c = PullCursor {
            timestamp: "2026-04-05T06:20:35.108Z".to_string(),
            entry_id: "3f2a-9c".to_string(),
        };
        let encoded = encode_pull_cursor(&c);
        assert_eq!(encoded, "2026-04-05T06:20:35.108Z|3f2a-9c");
        assert_eq!(decode_pull_cursor(&c.timestamp, Some(&encoded)), c);
    }

    #[test]
    fn duplicate_timestamps_are_ordered_by_id_so_a_boundary_neither_skips_nor_loops() {
        // Three rows share one millisecond and a chunk boundary falls after the
        // second. The keyset predicate the query uses is
        // `(ts > cur.ts) OR (ts = cur.ts AND id > cur.id)`; model it here.
        let ts = "2026-04-05T06:20:35.108Z";
        let group = [("a", ts), ("b", ts), ("c", ts), ("d", "2026-04-05T06:20:35.109Z")];

        let cursor = PullCursor {
            timestamp: ts.to_string(),
            entry_id: "b".to_string(),
        };
        let next: Vec<&str> = group
            .iter()
            .filter(|(id, row_ts)| {
                *row_ts > cursor.timestamp.as_str()
                    || (*row_ts == cursor.timestamp.as_str() && *id > cursor.entry_id.as_str())
            })
            .map(|(id, _)| *id)
            .collect();

        // "c" survives (a bare `timestamp >` would have dropped it) and "b" does
        // not reappear (a bare `timestamp >=` would have looped on it forever).
        assert_eq!(next, vec!["c", "d"]);
    }
}

#[cfg(test)]
mod vault_sync_tests {
    use crate::test_util::test_pool;

    #[test]
    fn vault_tables_are_allowed_for_sync() {
        for table in ["vault_notes", "vault_links", "vault_tags"] {
            assert!(
                super::sanitize_table_name(table).is_ok(),
                "{table} must be sync-allowed"
            );
        }
        assert!(super::sanitize_table_name("todoist_outbox").is_err(), "Mac-local only");
        assert!(super::sanitize_table_name("vault_fts").is_err(), "device-local only");
    }

    #[test]
    fn vault_note_snapshot_builds_a_valid_insert() {
        let snapshot = serde_json::json!({
            "id": "n1",
            "path": "journal/A.md",
            "title": "A",
            "content": "body",
            "frontmatter_json": serde_json::Value::Null,
            "mtime": "2026-08-04T10:00:00Z",
            "size": 4,
            "hash": "abc",
            "updated_at": "2026-08-04 10:00:00",
            "deleted_at": serde_json::Value::Null,
        })
        .to_string();

        let reqs = super::build_data_mutation_requests(
            "vault_notes",
            "n1",
            "INSERT",
            &Some(snapshot),
        );
        assert_eq!(reqs.len(), 1);
        let sql = reqs[0].pointer("/stmt/sql").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(sql.starts_with("INSERT OR REPLACE INTO vault_notes"), "got {sql}");
    }

    #[tokio::test]
    async fn seed_existing_data_covers_vault_notes() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO vault_notes (id, path, title, content) VALUES ('n1', 'a.md', 'A', 'body')",
        )
        .execute(&pool)
        .await
        .unwrap();

        super::seed_existing_data(&pool).await.unwrap();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'vault_notes' AND row_id = 'n1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }
}

#[cfg(test)]
mod v19_sync_tests {
    use crate::db::labels::{create_label, delete_label, set_task_labels};
    use crate::db::sections::{create_section, delete_section, rename_section, reorder_sections};
    use crate::db::projects::create_project;
    use crate::db::tasks::create_local_task;
    use crate::test_util::test_pool;
    use crate::types::CreateTaskInput;

    #[test]
    fn v19_tables_are_allowed_for_sync() {
        for table in ["labels", "task_labels", "sections"] {
            assert!(
                super::sanitize_table_name(table).is_ok(),
                "{table} must be sync-allowed"
            );
        }
    }

    #[test]
    fn task_labels_delete_uses_composite_row_id() {
        // task_labels has no `id` column — a generic "DELETE FROM t WHERE id = ?"
        // would be wrong; this must build the composite WHERE clause instead.
        let reqs = super::build_data_mutation_requests(
            "task_labels",
            &super::task_labels_row_id("task-1", "label-1"),
            "DELETE",
            &None,
        );
        assert_eq!(reqs.len(), 1);
        let sql = reqs[0].pointer("/stmt/sql").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(sql.contains("task_id = ?") && sql.contains("label_id = ?"), "got {sql}");

        // A malformed row_id (no delimiter) must be dropped, not panic or
        // build a bogus statement.
        let reqs = super::build_data_mutation_requests("task_labels", "not-composite", "DELETE", &None);
        assert!(reqs.is_empty());
    }

    /// Regression: a plain `serde_json::to_string(&task)` snapshot carries
    /// `LocalTask::labels` (not a `local_tasks` column), which broke every
    /// apply — local or remote — with "no such column: labels" for every
    /// task, not just labeled ones. `task_sync_snapshot` must strip it so a
    /// real task snapshot round-trips through `apply_remote_change`.
    #[tokio::test]
    async fn task_sync_snapshot_strips_labels_and_applies_cleanly() {
        let pool = test_pool().await;
        let task = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();

        let snapshot = super::task_sync_snapshot(&task);
        assert!(!snapshot.contains("\"labels\""), "snapshot must not carry the derived labels field: {snapshot}");

        super::apply_remote_change(&pool, "local_tasks", &task.id, "UPDATE", Some(&snapshot))
            .await
            .expect("a stripped snapshot must apply without a schema error");
    }

    #[tokio::test]
    async fn label_crud_appends_sync_log() {
        let pool = test_pool().await;
        let label = create_label(&pool, "deep work", "orange").await.unwrap();

        let insert_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'labels' AND row_id = ? AND operation = 'INSERT'",
        )
        .bind(&label.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(insert_count, 1);

        crate::db::labels::update_label(&pool, &label.id, Some("deeper work"), None)
            .await
            .unwrap();
        let update_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'labels' AND row_id = ? AND operation = 'UPDATE'",
        )
        .bind(&label.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(update_count, 1);

        delete_label(&pool, &label.id).await.unwrap();
        let delete_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'labels' AND row_id = ? AND operation = 'DELETE'",
        )
        .bind(&label.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(delete_count, 1);
    }

    /// `set_task_labels` already fires a `local_tasks` UPDATE (pre-existing),
    /// but the `task_labels` rows themselves need their own entries or the
    /// join table never replicates to another device. Assigning fires an
    /// INSERT; a later unassignment must fire a matching DELETE for the
    /// removed pair (and none for the one that stayed).
    #[tokio::test]
    async fn set_task_labels_replicates_task_labels_rows() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let l2 = create_label(&pool, "quick win", "yellow").await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();

        set_task_labels(&pool, &t.id, &[l1.id.clone(), l2.id.clone()]).await.unwrap();

        let row_id_1 = super::task_labels_row_id(&t.id, &l1.id);
        let row_id_2 = super::task_labels_row_id(&t.id, &l2.id);
        for row_id in [&row_id_1, &row_id_2] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels' AND row_id = ? AND operation = 'INSERT'",
            )
            .bind(row_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1, "expected an INSERT sync_log entry for {row_id}");
        }

        // Unassign l1, keep l2.
        set_task_labels(&pool, &t.id, &[l2.id.clone()]).await.unwrap();

        let l1_deletes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels' AND row_id = ? AND operation = 'DELETE'",
        )
        .bind(&row_id_1)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(l1_deletes, 1, "removed assignment must fire a DELETE");

        let l2_deletes: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels' AND row_id = ? AND operation = 'DELETE'",
        )
        .bind(&row_id_2)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(l2_deletes, 0, "retained assignment must not fire a DELETE");
    }

    /// `delete_label` wipes every `task_labels` row referencing it — each
    /// detached row needs its own DELETE too, not just the `labels` row.
    #[tokio::test]
    async fn delete_label_replicates_detached_task_labels_rows() {
        let pool = test_pool().await;
        let l1 = create_label(&pool, "deep work", "orange").await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();
        set_task_labels(&pool, &t.id, &[l1.id.clone()]).await.unwrap();

        delete_label(&pool, &l1.id).await.unwrap();

        let row_id = super::task_labels_row_id(&t.id, &l1.id);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels' AND row_id = ? AND operation = 'DELETE'",
        )
        .bind(&row_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn section_crud_appends_sync_log() {
        let pool = test_pool().await;
        let p = create_project(&pool, "Errands", "blue", None).await.unwrap();
        let s1 = create_section(&pool, &p.id, "Groceries").await.unwrap();
        let s2 = create_section(&pool, &p.id, "Chores").await.unwrap();

        for s in [&s1, &s2] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sync_log WHERE table_name = 'sections' AND row_id = ? AND operation = 'INSERT'",
            )
            .bind(&s.id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1);
        }

        rename_section(&pool, &s1.id, "Shopping").await.unwrap();
        let rename_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'sections' AND row_id = ? AND operation = 'UPDATE'",
        )
        .bind(&s1.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rename_count, 1);

        reorder_sections(&pool, &[s2.id.clone(), s1.id.clone()]).await.unwrap();
        for s in [&s1, &s2] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sync_log WHERE table_name = 'sections' AND row_id = ? AND changed_columns LIKE '%position%'",
            )
            .bind(&s.id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1, "reorder must log a position UPDATE for {}", s.id);
        }

        delete_section(&pool, &s1.id).await.unwrap();
        let delete_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'sections' AND row_id = ? AND operation = 'DELETE'",
        )
        .bind(&s1.id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(delete_count, 1);
    }

    #[tokio::test]
    async fn seed_existing_data_covers_labels_sections_and_task_labels() {
        let pool = test_pool().await;
        // Insert rows directly (bypassing CRUD, as if pre-existing before
        // sync was enabled) so seeding is the only thing producing entries.
        sqlx::query("INSERT INTO labels (id, name, color, position) VALUES ('l1', 'deep work', 'orange', 0)")
            .execute(&pool).await.unwrap();
        let p = create_project(&pool, "Errands", "blue", None).await.unwrap();
        sqlx::query("INSERT INTO sections (id, project_id, name, position) VALUES ('s1', ?, 'Groceries', 0)")
            .bind(&p.id)
            .execute(&pool).await.unwrap();
        let t = create_local_task(&pool, CreateTaskInput { content: "x".into(), ..Default::default() })
            .await
            .unwrap();
        sqlx::query("INSERT INTO task_labels (task_id, label_id) VALUES (?, 'l1')")
            .bind(&t.id)
            .execute(&pool).await.unwrap();

        super::seed_existing_data(&pool).await.unwrap();

        let label_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'labels' AND row_id = 'l1'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(label_count, 1);

        let section_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'sections' AND row_id = 's1'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(section_count, 1);

        let tl_row_id = super::task_labels_row_id(&t.id, "l1");
        let tl_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sync_log WHERE table_name = 'task_labels' AND row_id = ?",
        ).bind(&tl_row_id).fetch_one(&pool).await.unwrap();
        assert_eq!(tl_count, 1);
    }
}
