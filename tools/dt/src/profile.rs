use crate::output::CliError;
use nimble_core::agent_protocol::{AgentProfile, SchemaLock};
use std::path::Path;
pub struct OpenProfile {
    pub pool: sqlx::SqlitePool,
    pub profile: AgentProfile,
    pub _lock: SchemaLock,
}
pub async fn open(path: Option<&Path>) -> Result<OpenProfile, CliError> {
    let root = match path {
        Some(p) => p.to_path_buf(),
        None => dirs::data_local_dir()
            .ok_or_else(|| CliError::new("unavailable", "Cannot resolve app data directory."))?
            .join("com.marcosevilla.daily-triage"),
    };
    if root.join("demo-mode").exists() {
        return Err(CliError::new(
            "unavailable",
            "Agent access is disabled while the selected app profile is in demo mode.",
        ));
    }
    let db = root.join("nimble.db");
    if !db.exists() {
        return Err(CliError::new(
            "unavailable",
            "Nimble database is missing. Open Nimble first; dt never creates or migrates it.",
        ));
    }
    let profile = AgentProfile::from_database(&db, path.is_some())?;
    let lock = SchemaLock::acquire(&profile.database, false)?;
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&profile.database)
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let version: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version),0) FROM schema_version")
        .fetch_one(&pool)
        .await?;
    if version != nimble_core::db::migrations::CURRENT_SCHEMA_VERSION {
        return Err(CliError::new(
            "schema_mismatch",
            "Database and dt versions differ. Update dt and open the matching Nimble app first.",
        ));
    }
    Ok(OpenProfile {
        pool,
        profile,
        _lock: lock,
    })
}
