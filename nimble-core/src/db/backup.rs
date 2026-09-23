//! Complete, verified, owner-only SQLite generations. No network or live restore.
use super::{backup_storage as storage, export};
use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Connection, SqliteConnection, SqlitePool,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    path::{Path, PathBuf},
    time::Duration,
};
use storage::invalid;

#[derive(Clone, Debug)]
pub struct BackupPaths {
    pub app_data: PathBuf,
    pub database: PathBuf,
    pub generations: PathBuf,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub id: String,
    pub created_at: String,
    pub local_date: String,
    pub local_iso_week: String,
    pub app_version: String,
    pub schema_version: i64,
    pub export_version: u32,
    pub snapshot_hash: String,
    pub data_hash: String,
    pub format_hash: String,
    pub row_counts: BTreeMap<String, u64>,
}
#[derive(Debug)]
pub struct VerifiedGeneration {
    directory: PathBuf,
    manifest: BackupManifest,
}
impl VerifiedGeneration {
    pub fn directory(&self) -> &Path {
        &self.directory
    }
    pub fn manifest(&self) -> &BackupManifest {
        &self.manifest
    }
}
pub struct BackupJobGuard {
    file: File,
    root: PathBuf,
}

fn root(paths: &BackupPaths) -> crate::Result<PathBuf> {
    let app = storage::checked_path(&paths.app_data)?;
    let generations = storage::checked_path(&paths.generations)?;
    let database = storage::checked_path(&paths.database)?;
    if generations != app.join("backups")
        || !database.starts_with(&app)
        || database == app
        || database.starts_with(&generations)
    {
        return Err(invalid("path_containment"));
    }
    if !app.is_dir() {
        return Err(invalid("missing_app_data"));
    }
    Ok(generations)
}
pub fn try_lock(paths: &BackupPaths) -> crate::Result<Option<BackupJobGuard>> {
    let root = root(paths)?;
    storage::private_dir(&root)?;
    let lock = root.join(".job.lock");
    let file = match storage::open_file(&lock, true, true) {
        Ok(file) => file,
        Err(crate::Error::Io(e)) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            storage::open_file(&lock, true, false)?
        }
        Err(e) => return Err(e),
    };
    match file.try_lock() {
        Ok(()) => Ok(Some(BackupJobGuard { file, root })),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(e)) => Err(e.into()),
    }
}
fn require_guard(paths: &BackupPaths, guard: &BackupJobGuard) -> crate::Result<PathBuf> {
    let current = root(paths)?;
    if current != guard.root {
        return Err(invalid("wrong_guard"));
    }
    // An unlinked/replaced lock must never authorize cleanup or publication.
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let held = guard.file.metadata()?;
        let named = storage::open_file(&current.join(".job.lock"), false, false)?.metadata()?;
        if held.dev() != named.dev() || held.ino() != named.ino() {
            return Err(invalid("lock_replaced"));
        }
    }
    Ok(current)
}
async fn readonly(path: &Path) -> crate::Result<SqlitePool> {
    storage::open_file(path, false, false)?;
    Ok(SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .read_only(true)
                .create_if_missing(false)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await?)
}
async fn validate(pool: &SqlitePool) -> crate::Result<()> {
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(pool)
        .await?;
    if integrity != ["ok"] {
        return Err(invalid("integrity"));
    }
    if !sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await?
        .is_empty()
    {
        return Err(invalid("foreign_keys"));
    }
    export::validate_schema(pool).await
}
fn counts(data: &[u8]) -> crate::Result<BTreeMap<String, u64>> {
    let value: BTreeMap<String, Vec<serde_json::Value>> =
        serde_json::from_slice(data).map_err(|_| invalid("export_json"))?;
    Ok(value
        .into_iter()
        .map(|(table, rows)| (table, rows.len() as u64))
        .collect())
}

pub async fn create_generation(
    paths: &BackupPaths,
    at: DateTime<FixedOffset>,
    version: &str,
    guard: &BackupJobGuard,
) -> crate::Result<VerifiedGeneration> {
    create_inner(paths, at, version, guard, None).await
}
/// Deterministic failure injection only compiled in synthetic test builds.
#[cfg(feature = "test-util")]
pub async fn create_generation_with_failure(
    paths: &BackupPaths,
    at: DateTime<FixedOffset>,
    version: &str,
    guard: &BackupJobGuard,
    failure: &str,
) -> crate::Result<VerifiedGeneration> {
    create_inner(paths, at, version, guard, Some(failure)).await
}
async fn create_inner(
    paths: &BackupPaths,
    at: DateTime<FixedOffset>,
    version: &str,
    guard: &BackupJobGuard,
    failure: Option<&str>,
) -> crate::Result<VerifiedGeneration> {
    let root = require_guard(paths, guard)?;
    let id = uuid::Uuid::new_v4().to_string();
    let staging = root.join(format!(".partial-{id}"));
    storage::private_dir(&staging)?;
    let snapshot = staging.join("snapshot.db");
    // VACUUM INTO accepts a pre-created empty file, allowing mode 0600 from birth.
    storage::write_new(&snapshot, &[])?;
    let source_options = SqliteConnectOptions::new()
        .filename(&paths.database)
        .read_only(true)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5));
    storage::open_file(&paths.database, false, false)?;
    let mut source = SqliteConnection::connect_with(&source_options).await?;
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    // Interrupt the SQLite VM too: dropping an async query alone does not stop its worker.
    source
        .lock_handle()
        .await?
        .set_progress_handler(1_000, move || std::time::Instant::now() < deadline);
    let vacuum = tokio::time::timeout(
        Duration::from_secs(120),
        sqlx::query("VACUUM INTO ?")
            .bind(snapshot.to_str().ok_or_else(|| invalid("path_encoding"))?)
            .execute(&mut source),
    )
    .await;
    source.close().await?;
    vacuum.map_err(|_| invalid("snapshot_timeout"))??;
    let pool = readonly(&snapshot).await?;
    let result = async {
        validate(&pool).await?;
        export::export_portable(&pool).await
    }
    .await;
    pool.close().await;
    let portable = result?;
    storage::private_dir(&staging.join("export"))?;
    storage::write_new(&staging.join("export/data.json"), &portable.data)?;
    if failure == Some("write") {
        return Err(invalid("injected_write_failure"));
    }
    storage::write_new(&staging.join("export/format.json"), &portable.format)?;
    let week = at.date_naive().iso_week();
    let manifest = BackupManifest {
        id: id.clone(),
        created_at: at.with_timezone(&Utc).to_rfc3339(),
        local_date: at.date_naive().to_string(),
        local_iso_week: format!("{:04}-W{:02}", week.year(), week.week()),
        app_version: version.to_owned(),
        schema_version: serde_json::from_slice::<serde_json::Value>(&portable.format)
            .map_err(|_| invalid("format"))?["schema_version"].as_i64()
            .ok_or_else(|| invalid("format_version"))?,
        export_version: 1,
        snapshot_hash: storage::hash(&snapshot)?,
        data_hash: storage::hash(&staging.join("export/data.json"))?,
        format_hash: storage::hash(&staging.join("export/format.json"))?,
        row_counts: counts(&portable.data)?,
    };
    storage::open_file(&snapshot, false, false)?.sync_all()?;
    let mut encoded =
        serde_json::to_vec_pretty(&manifest).map_err(|_| invalid("manifest_encode"))?;
    encoded.push(b'\n');
    storage::write_new(&staging.join("manifest.json"), &encoded)?;
    storage::flush_dir(&staging.join("export"))?;
    storage::flush_dir(&staging)?;
    require_guard(paths, guard)?;
    if failure == Some("publish") {
        return Err(invalid("injected_publication_failure"));
    }
    let directory = root.join(&id);
    storage::publish_directory(&staging, &directory)?;
    storage::flush_dir(&root)?;
    Ok(VerifiedGeneration {
        directory,
        manifest,
    })
}

fn exact_entries(directory: &Path, expected: &[&str]) -> crate::Result<()> {
    storage::checked_path(directory)?;
    if !fs::symlink_metadata(directory)?.is_dir() {
        return Err(invalid("not_directory"));
    }
    let actual: BTreeSet<String> = fs::read_dir(directory)?
        .map(|entry| {
            let entry = entry?;
            if entry.file_type()?.is_symlink() {
                return Err(invalid("symlink"));
            }
            entry
                .file_name()
                .into_string()
                .map_err(|_| invalid("filename"))
        })
        .collect::<crate::Result<_>>()?;
    let expected: BTreeSet<String> = expected.iter().map(|s| (*s).to_string()).collect();
    if actual != expected {
        return Err(invalid("unexpected_files"));
    }
    Ok(())
}
fn checked_manifest(directory: &Path) -> crate::Result<BackupManifest> {
    exact_entries(directory, &["snapshot.db", "manifest.json", "export"])?;
    exact_entries(&directory.join("export"), &["data.json", "format.json"])?;
    let manifest: BackupManifest =
        serde_json::from_slice(&storage::read(&directory.join("manifest.json"))?)
            .map_err(|_| invalid("manifest"))?;
    if uuid::Uuid::parse_str(&manifest.id)
        .map(|id| id.to_string())
        .ok()
        .as_deref()
        != Some(manifest.id.as_str())
        || directory.file_name().and_then(|s| s.to_str()) != Some(manifest.id.as_str())
    {
        return Err(invalid("generation_id"));
    }
    let created =
        DateTime::parse_from_rfc3339(&manifest.created_at).map_err(|_| invalid("created_at"))?;
    let date = NaiveDate::parse_from_str(&manifest.local_date, "%Y-%m-%d")
        .map_err(|_| invalid("local_date"))?;
    // Offset information is intentionally absent from created_at, but a valid local date
    // can differ from its UTC date by at most one day.
    if (created.date_naive() - date).num_days().abs() > 1 {
        return Err(invalid("local_date"));
    }
    let week = date.iso_week();
    if manifest.local_iso_week != format!("{:04}-W{:02}", week.year(), week.week())
        || !matches!(manifest.schema_version, 19 | 20 | 21)
        || manifest.export_version != 1
    {
        return Err(invalid("manifest_version"));
    }
    for (name, expected) in [
        ("snapshot.db", &manifest.snapshot_hash),
        ("export/data.json", &manifest.data_hash),
        ("export/format.json", &manifest.format_hash),
    ] {
        if storage::hash(&directory.join(name))? != *expected {
            return Err(invalid("checksum"));
        }
    }
    Ok(manifest)
}

pub async fn verify_generation(directory: &Path) -> crate::Result<VerifiedGeneration> {
    let directory = storage::checked_path(directory)?;
    let manifest = checked_manifest(&directory)?;
    let pool = readonly(&directory.join("snapshot.db")).await?;
    let result = async {
        validate(&pool).await?;
        let portable = export::export_portable(&pool).await?;
        if portable.data != storage::read(&directory.join("export/data.json"))?
            || portable.format != storage::read(&directory.join("export/format.json"))?
            || counts(&portable.data)? != manifest.row_counts
        {
            return Err(invalid("export_mismatch"));
        }
        Ok(())
    }
    .await;
    pool.close().await;
    result?;
    // Refuse a changed set between the checksum pass and database verification.
    let after = checked_manifest(&directory)?;
    if after != manifest {
        return Err(invalid("generation_changed"));
    }
    Ok(VerifiedGeneration {
        directory,
        manifest,
    })
}

/// Invalid and incomplete directories never appear as usable backups.
pub async fn list_verified(paths: &BackupPaths) -> crate::Result<Vec<VerifiedGeneration>> {
    let root = root(paths)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(generation) = verify_generation(&entry.path()).await {
            result.push(generation);
        }
    }
    result.sort_by(|a, b| order(a.manifest()).cmp(&order(b.manifest())));
    Ok(result)
}
fn order(manifest: &BackupManifest) -> (DateTime<FixedOffset>, &str) {
    (
        DateTime::parse_from_rfc3339(&manifest.created_at)
            .unwrap_or(DateTime::<Utc>::MIN_UTC.fixed_offset()),
        manifest.id.as_str(),
    )
}
/// Returns deletion candidates, retaining 14 represented dates and 8 represented ISO weeks.
pub fn retention_candidates(generations: &[BackupManifest]) -> Vec<String> {
    let mut sorted: Vec<_> = generations.iter().collect();
    sorted.sort_by(|a, b| order(b).cmp(&order(a)));
    let mut dates = BTreeMap::<&str, &BackupManifest>::new();
    let mut weeks = BTreeMap::<&str, &BackupManifest>::new();
    for generation in &sorted {
        dates.entry(&generation.local_date).or_insert(generation);
        weeks
            .entry(&generation.local_iso_week)
            .or_insert(generation);
    }
    let mut keep = BTreeSet::new();
    if let Some(latest) = sorted.first() {
        keep.insert(latest.id.as_str());
    }
    for (_, generation) in dates
        .iter()
        .rev()
        .take(14)
        .chain(weeks.iter().rev().take(8))
    {
        keep.insert(generation.id.as_str());
    }
    sorted
        .iter()
        .filter(|g| !keep.contains(g.id.as_str()))
        .map(|g| g.id.clone())
        .collect()
}

/// Only the explicit files in rechecked, retention-eligible generations are removed.
/// No recursive deletion: unknown files or directories always block cleanup.
pub fn apply_retention(
    paths: &BackupPaths,
    ids: &[String],
    guard: &BackupJobGuard,
) -> crate::Result<()> {
    let root = require_guard(paths, guard)?;
    // This synchronous API may be called from an async runner. Verify on an isolated
    // thread/runtime rather than nesting block_on in the caller's Tokio runtime.
    let verification_paths = paths.clone();
    let manifests = std::thread::spawn(move || -> crate::Result<Vec<BackupManifest>> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            Ok(list_verified(&verification_paths)
                .await?
                .into_iter()
                .map(|g| g.manifest)
                .collect())
        })
    })
    .join()
    .map_err(|_| invalid("retention_verifier"))??;
    let candidates: BTreeSet<_> = retention_candidates(&manifests).into_iter().collect();
    // Validate the entire requested batch before the first deletion.
    for id in ids {
        if !candidates.contains(id) {
            return Err(invalid("retention_not_eligible"));
        }
    }
    for id in ids {
        require_guard(paths, guard)?;
        let directory = root.join(id);
        checked_manifest(&directory)?;
        for name in ["export/data.json", "export/format.json"] {
            fs::remove_file(directory.join(name))?;
        }
        fs::remove_dir(directory.join("export"))?;
        fs::remove_file(directory.join("snapshot.db"))?;
        fs::remove_file(directory.join("manifest.json"))?;
        fs::remove_dir(directory)?;
    }
    storage::flush_dir(&root)?;
    Ok(())
}

/// Check that this root still names the inode locked by the current job.
pub fn validate_guard(paths: &BackupPaths, guard: &BackupJobGuard) -> crate::Result<()> {
    require_guard(paths, guard).map(|_| ())
}
