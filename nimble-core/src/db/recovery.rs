//! Offline, non-activating recovery into a new isolated directory.
use super::{
    backup, backup_storage as fs,
    export::{compare_snapshot_tables, export_portable},
    export_policy::tables_for_version,
};
use serde_json::Value;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub struct RecoveryReport {
    pub output: PathBuf,
    pub verified: bool,
}
fn invalid(code: &str) -> crate::Error {
    fs::invalid(&format!("recovery_{code}"))
}

fn protected(path: &Path, extra_forbidden: Option<&Path>) -> bool {
    // Conservative ASCII case folding protects case-insensitive macOS volumes,
    // including legacy names anywhere under Application Support.
    let parts = path
        .components()
        .map(|p| p.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>();
    parts.iter().any(|p| p == "com.marcosevilla.daily-triage")
        || parts
            .windows(2)
            .any(|p| p[0] == "library" && p[1] == "application support")
        || extra_forbidden.is_some_and(|root| path.starts_with(root))
}

fn destination(path: &Path, extra_forbidden: Option<&Path>) -> crate::Result<PathBuf> {
    let path = fs::checked_path(path)?;
    if protected(&path, extra_forbidden) {
        return Err(invalid("production_destination"));
    }
    if path.exists() {
        return Err(invalid("destination_exists"));
    }
    let parent = path
        .parent()
        .filter(|p| p.is_dir())
        .ok_or_else(|| invalid("parent_missing"))?;
    // Resolve existing directory spelling before deriving the new output. Never
    // canonicalize before checked_path: that would silently accept symlinks.
    let canonical_parent = parent.canonicalize()?;
    fs::checked_path(&canonical_parent)?;
    let resolved = canonical_parent.join(path.file_name().ok_or_else(|| invalid("destination"))?);
    let canonical_forbidden = extra_forbidden.and_then(|root| root.canonicalize().ok());
    if protected(&resolved, extra_forbidden) || protected(&resolved, canonical_forbidden.as_deref())
    {
        return Err(invalid("production_destination"));
    }
    Ok(resolved)
}

struct Stage(PathBuf);
impl Stage {
    fn new(dest: &Path) -> crate::Result<Self> {
        let stage = dest
            .parent()
            .unwrap()
            .join(format!(".recovery-{}", uuid::Uuid::new_v4()));
        fs::private_dir(&stage)?;
        Ok(Self(stage))
    }
    fn publish(self, dest: &Path) -> crate::Result<RecoveryReport> {
        destination(dest, None)?;
        fs::open_file(&self.0.join("recovered.db"), false, false)?.sync_all()?;
        fs::flush_dir(&self.0)?;
        fs::publish_directory(&self.0, dest)?;
        fs::flush_dir(dest.parent().unwrap())?;
        Ok(RecoveryReport {
            output: dest.join("recovered.db"),
            verified: true,
        })
    }
}
impl Drop for Stage {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
async fn open(path: &Path, readonly: bool) -> crate::Result<SqlitePool> {
    fs::open_file(path, false, false)?;
    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .read_only(readonly)
                .create_if_missing(false)
                .foreign_keys(true)
                .pragma("trusted_schema", "OFF"),
        )
        .await?)
}
async fn validate(pool: &SqlitePool) -> crate::Result<()> {
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(pool)
        .await?;
    if integrity != ["ok"]
        || !sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(pool)
            .await?
            .is_empty()
    {
        return Err(invalid("integrity"));
    }
    super::export::validate_schema(pool).await
}

/// Activation safety is applied only to a verified, separate v21 output copy.
/// Canonical source/copy and portable equality checks must happen first.
pub async fn normalize_focus_restore(pool: &SqlitePool) -> crate::Result<()> {
    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM schema_version").fetch_one(pool).await?;
    if version < 21 { return Ok(()); }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('restored_activation_required','1',datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1',updated_at=datetime('now')")
        .execute(&mut *tx).await?;
    let work: Vec<(String, i64)> = sqlx::query_as(
        "SELECT occurrence_id,work_ms FROM focus_sessions").fetch_all(&mut *tx).await?;
    let imported: Vec<(String, i64)> = sqlx::query_as(
        "SELECT occurrence_id,duration_ms FROM focus_import_totals WHERE inclusion='included' AND occurrence_id IS NOT NULL")
        .fetch_all(&mut *tx).await?;
    let mut totals = std::collections::HashMap::<String, u64>::new();
    for (occurrence_id, duration) in work.into_iter().chain(imported) {
        if duration < 0 { return Err(invalid("negative_focus_total")); }
        let total = totals.entry(occurrence_id).or_default();
        *total = total.checked_add(duration as u64).filter(|sum| *sum <= crate::focus_types::MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("focus_total_overflow"))?;
    }
    sqlx::query("UPDATE focus_segments SET closed_at=checkpoint_at,close_reason='restored' WHERE closed_at IS NULL")
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE focus_sessions SET status='paused' WHERE status='running'")
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE focus_queue_state SET writer_device_id='' WHERE id=1")
        .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO focus_runtime(id,owner_epoch,process_generation,engine_revision,recovery_reason) VALUES(1,'',0,0,'restore requires explicit activation') ON CONFLICT(id) DO UPDATE SET live_session_id=NULL,owner_epoch='',process_generation=0,sound_token=NULL,boundary_token=NULL,recovery_reason='restore requires explicit activation'")
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE focus_delivery SET state='needs-review',next_attempt_at=NULL,last_error='restored; delivery quarantined' WHERE state IN ('pending','sending','retryable-error')")
        .execute(&mut *tx).await?;
    sqlx::query("DELETE FROM focus_undo").execute(&mut *tx).await?;
    sqlx::query("UPDATE daily_state SET focus_task_id=NULL,focus_started_at=NULL,focus_paused_at=NULL")
        .execute(&mut *tx).await?;
    tx.commit().await?;
    validate(pool).await
}

/// A restored v21 profile remains inert until a separate, explicit activation
/// procedure clears this marker. Runners and direct network entrypoints share it.
pub async fn require_activation_clear(pool: &SqlitePool) -> crate::Result<()> {
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key='restored_activation_required'")
        .fetch_optional(pool).await?;
    if marker.as_deref() == Some("1") {
        return Err(invalid("restore_activation_required"));
    }
    Ok(())
}

/// The explicit activation a restored v21 profile needs before it may sync,
/// back up, remind or write focus: clears the restore marker and makes
/// `device_id` the focus writer under a fresh owner epoch, in one
/// transaction. Nothing starts — restored sessions stay paused at their
/// exact totals and quarantined deliveries stay in review. Returns `false`
/// when the profile is already active for this device (idempotent). Refuses
/// (`wrong_owner`) a queue another device owns. The caller must hold the
/// profile owner lock and re-initialize its focus service afterwards.
pub async fn activate_restored_profile(pool: &SqlitePool, device_id: &str) -> crate::Result<bool> {
    if device_id.is_empty() {
        return Err(crate::Error::Other("invalid: empty device id".into()));
    }
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key='restored_activation_required'")
        .fetch_optional(&mut *tx).await?;
    let writer: Option<String> = sqlx::query_scalar(
        "SELECT writer_device_id FROM focus_queue_state WHERE id=1")
        .fetch_optional(&mut *tx).await?;
    let restored = marker.as_deref() == Some("1");
    match writer.as_deref() {
        Some(w) if !w.is_empty() && w != device_id => {
            return Err(crate::Error::Other(
                "wrong_owner: another device owns this focus queue".into(),
            ));
        }
        Some(w) if w == device_id && !restored => return Ok(false),
        None if !restored => return Ok(false),
        _ => {}
    }
    sqlx::query("DELETE FROM settings WHERE key='restored_activation_required'")
        .execute(&mut *tx).await?;
    if writer.is_some() {
        let epoch = uuid::Uuid::new_v4().to_string();
        sqlx::query("UPDATE focus_queue_state SET writer_device_id=?,owner_epoch=?,updated_at=? WHERE id=1")
            .bind(device_id).bind(&epoch).bind(chrono::Utc::now().to_rfc3339())
            .execute(&mut *tx).await?;
        sqlx::query("UPDATE focus_runtime SET owner_epoch=?,live_session_id=NULL,recovery_reason=NULL,engine_revision=engine_revision+1 WHERE id=1")
            .bind(&epoch).execute(&mut *tx).await?;
        crate::db::focus::replica::publish_focus_replica_tx(&mut tx).await?;
    }
    tx.commit().await?;
    Ok(true)
}

pub async fn restore_snapshot(source: &Path, dest: &Path) -> crate::Result<RecoveryReport> {
    let dest = destination(dest, None)?;
    let verified = backup::verify_generation(source).await?;
    let stage = Stage::new(&dest)?;
    let path = stage.0.join("recovered.db");
    fs::write_new(&path, &fs::read(&verified.directory().join("snapshot.db"))?)?;
    let original = open(&verified.directory().join("snapshot.db"), true).await?;
    let restored = open(&path, true).await?;
    let result = async {
        validate(&restored).await?;
        if !compare_snapshot_tables(&original, &restored).await? {
            return Err(invalid("snapshot_mismatch"));
        }
        let a = export_portable(&original).await?;
        let b = export_portable(&restored).await?;
        if a.data != b.data || a.format != b.format {
            return Err(invalid("export_mismatch"));
        }
        // Reverify after reading to catch changed source bytes.
        backup::verify_generation(source).await?;
        Ok(())
    }
    .await;
    original.close().await;
    restored.close().await;
    result?;
    if verified.manifest().schema_version >= 21 {
        let activation = open(&path, false).await?;
        let normalization = normalize_focus_restore(&activation).await;
        activation.close().await;
        normalization?;
    }
    stage.publish(&dest)
}

pub async fn restore_export(source: &Path, dest: &Path) -> crate::Result<RecoveryReport> {
    let dest = destination(dest, None)?;
    fs::checked_path(source)?;
    let data = fs::read(&source.join("data.json"))?;
    let format = fs::read(&source.join("format.json"))?;
    let format_value: Value = serde_json::from_slice(&format).map_err(|_| invalid("format"))?;
    let version = format_value["schema_version"].as_i64().ok_or_else(|| invalid("format_version"))?;
    let tables_policy = tables_for_version(version).ok_or_else(|| invalid("format_version"))?;
    let parsed: Value = serde_json::from_slice(&data).map_err(|_| invalid("json"))?;
    let tables = parsed.as_object().ok_or_else(|| invalid("tables"))?;
    let expected: BTreeSet<&str> = tables_policy
        .iter()
        .filter(|p| !p.included.is_empty())
        .map(|p| p.name)
        .collect();
    if tables.keys().map(String::as_str).collect::<BTreeSet<_>>() != expected {
        return Err(invalid("tables"));
    }
    let stage = Stage::new(&dest)?;
    let path = stage.0.join("recovered.db");
    fs::write_new(&path, &[])?;
    let pool = open(&path, false).await?;
    let result = async {
        super::migrations::run_migrations_to_version(&pool, version).await?;
        if export_portable(&pool).await?.format != format { return Err(invalid("format")); }
        let mut tx = pool.begin().await?;
        sqlx::query("PRAGMA defer_foreign_keys=ON").execute(&mut *tx).await?;
        // No observers or CRUD functions: this connection belongs only to the isolated importer.
        for policy in tables_policy.iter().rev().filter(|p| p.name != "schema_version") {
            sqlx::query(&format!("DELETE FROM \"{}\"", policy.name)).execute(&mut *tx).await?;
        }
        for policy in tables_policy.iter().filter(|p| !p.included.is_empty()) {
            let rows = tables[policy.name].as_array().ok_or_else(|| invalid("rows"))?;
            let schema = sqlx::query(&format!("PRAGMA table_info(\"{}\")", policy.name)).fetch_all(&mut *tx).await?;
            let keys: BTreeSet<&str> = policy.included.iter().copied().collect();
            let mut seen = BTreeSet::new();
            for row in rows {
                let row = row.as_object().ok_or_else(|| invalid("row"))?;
                if row.keys().map(String::as_str).collect::<BTreeSet<_>>() != keys { return Err(invalid("columns")); }
                let pk: Vec<&Value> = policy.primary_key.iter().map(|k| &row[*k]).collect();
                if pk.iter().any(|v| v.is_null()) || !seen.insert(serde_json::to_string(&pk).map_err(|_| invalid("key"))?) { return Err(invalid("duplicate_or_null_key")); }
                let columns = policy.included.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(",");
                let sql = format!("INSERT INTO \"{}\" ({columns}) VALUES ({})", policy.name, vec!["?"; policy.included.len()].join(","));
                let mut insert = sqlx::query(&sql);
                for column in policy.included {
                    let metadata = schema.iter().find(|r| r.get::<String,_>("name") == *column).ok_or_else(|| invalid("schema"))?;
                    let kind: String = metadata.try_get("type")?;
                    let required: i64 = metadata.try_get("notnull")?;
                    let value = &row[*column];
                    insert = match value {
                        Value::Null if required == 0 => insert.bind(Option::<String>::None),
                        Value::String(v) if kind == "TEXT" => insert.bind(v),
                        Value::Number(v) if kind == "INTEGER" && v.as_i64().is_some() => insert.bind(v.as_i64().unwrap()),
                        Value::Number(v) if kind == "REAL" && v.as_f64().is_some() => insert.bind(v.as_f64().unwrap()),
                        _ => return Err(invalid("type")),
                    };
                }
                insert.execute(&mut *tx).await.map_err(|_| invalid("insert"))?;
            }
        }
        if !sqlx::query("PRAGMA foreign_key_check").fetch_all(&mut *tx).await?.is_empty() { return Err(invalid("foreign_key")); }
        tx.commit().await?;
        sqlx::query("DELETE FROM vault_fts").execute(&pool).await?;
        sqlx::query("INSERT INTO vault_fts(note_id,title,content) SELECT id,title,content FROM vault_notes WHERE deleted_at IS NULL").execute(&pool).await?;
        if version >= 25 { // schema-v25
            // Device-local task index: rebuilt from the restored rows, never exported.
            // Raw SQL (not task_search::rebuild_task_index) so the restored copy gains
            // no settings row; the app heals the version key on first launch.
            sqlx::query("DELETE FROM tasks_fts").execute(&pool).await?;
            sqlx::query("INSERT INTO tasks_fts(task_id,content,description) SELECT id,content,COALESCE(description,'') FROM local_tasks").execute(&pool).await?;
        }
        validate(&pool).await?;
        let actual = export_portable(&pool).await?;
        // Canonical equality also rejects duplicate JSON object keys and coercion.
        if actual.data != data || actual.format != format { return Err(invalid("noncanonical_or_mismatch")); }
        Ok(())
    }.await;
    pool.close().await;
    result?;
    if version >= 21 {
        let activation = open(&path, false).await?;
        let normalization = normalize_focus_restore(&activation).await;
        activation.close().await;
        normalization?;
    }
    stage.publish(&dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn publication_race_preserves_destination_and_cleans_stage() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("recovery-test-{}", uuid::Uuid::new_v4()));
        fs::private_dir(&root).unwrap();
        let dest = root.join("new");
        let stage = Stage::new(&dest).unwrap();
        let stage_path = stage.0.clone();
        fs::write_new(&stage.0.join("recovered.db"), b"synthetic").unwrap();
        fs::private_dir(&dest).unwrap();
        fs::write_new(&dest.join("sentinel"), b"preserved").unwrap();
        assert!(stage.publish(&dest).is_err());
        assert!(!stage_path.exists());
        assert_eq!(fs::read(&dest.join("sentinel")).unwrap(), b"preserved");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn differently_cased_existing_production_parents_are_refused() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("recovery-case-test-{}", uuid::Uuid::new_v4()));
        for parent in [
            "library/application support/legacy-app",
            "COM.MARCOSEVILLA.DAILY-TRIAGE",
        ] {
            let parent = root.join(parent);
            std::fs::create_dir_all(&parent).unwrap();
            let dest = parent.join("new");
            assert!(destination(&dest, None).is_err());
            assert!(!dest.exists());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn protected_roots_cannot_be_removed_by_test_policy() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(destination(&root.join("com.marcosevilla.daily-triage/new"), None).is_err());
        assert!(destination(&root.join("Library/Application Support/new"), None).is_err());
        assert!(destination(&root.join("synthetic/new"), Some(&root.join("synthetic"))).is_err());
    }
}
