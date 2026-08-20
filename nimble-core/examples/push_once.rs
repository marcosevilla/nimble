//! One-shot Turso sync, equivalent to pressing "Sync Now" in Settings.
//!
//! Scratch tool: the Settings button is the only trigger in the shipped app, so
//! there is no way to run a sync without the UI. This calls the SAME
//! `db::sync::push` / `db::sync::pull` the button calls — deliberately not a
//! reimplementation, because hand-rolled sync writes are exactly how this
//! codebase has lost data before.
//!
//! Opens the database read-write but NOT `create` (`mode=rw`), so a wrong path
//! fails loudly instead of silently creating an empty database. Does not run
//! migrations — the running app owns the schema.
//!
//! Run with: cargo run -p nimble-core --example push_once

use sqlx::sqlite::SqlitePoolOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::var("HOME")?;
    let db_path = format!(
        "{home}/Library/Application Support/com.marcosevilla.daily-triage/nimble.db"
    );
    if !std::path::Path::new(&db_path).exists() {
        return Err(format!("database not found at {db_path}").into());
    }

    // A single connection, so this contends as little as possible with the
    // running app holding its own pool on the same file.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{db_path}?mode=rw"))
        .await?;

    let url = nimble_core::db::settings::get_setting(&pool, "turso_url")
        .await?
        .ok_or("turso_url is not set")?;
    let token = nimble_core::db::settings::get_setting(&pool, "turso_token")
        .await?
        .ok_or("turso_token is not set")?;

    let before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE synced = 0")
            .fetch_one(&pool)
            .await?;
    println!("unsynced before: {before}");

    // Push and pull are reported separately and pull still runs if push fails —
    // matching the scheduler added in 7fac740.
    match nimble_core::db::sync::push(&pool, &url, &token).await {
        Ok(n) => println!("push: {n} entries pushed"),
        Err(e) => println!("push FAILED: {e}"),
    }

    match nimble_core::db::sync::pull(&pool, &url, &token).await {
        Ok(n) => println!("pull: {n} remote changes applied"),
        Err(e) => println!("pull FAILED: {e}"),
    }

    let after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sync_log WHERE synced = 0")
            .fetch_one(&pool)
            .await?;
    println!("unsynced after: {after}");

    pool.close().await;
    Ok(())
}
