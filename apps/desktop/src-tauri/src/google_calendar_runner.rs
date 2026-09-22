use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};
use crate::google_credentials::{client_secret_account, GoogleCredentials, KeychainClientCredentials, KeychainCredentials};
static GOOGLE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub async fn lock() -> tokio::sync::MutexGuard<'static,()> { GOOGLE_LOCK.lock().await }

pub fn profile_identity(app: &AppHandle) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let path=app.path().app_data_dir().map_err(|_|"google_profile_failed")?;
    let digest=Sha256::digest(path.to_string_lossy().as_bytes());
    Ok(format!("nimble-{:x}", digest))
}

pub fn network_allowed(app:&AppHandle)->bool {
    !app.try_state::<crate::backup_runner::BackupRuntime>().is_some_and(|r|r.is_test_profile())
        && !cfg!(debug_assertions)
        && app.path().app_data_dir().is_ok_and(|path|!path.join("demo-mode").exists())
}

pub async fn client_id(pool:&SqlitePool)->Result<String,String> {
    if let Ok(value)=std::env::var("NIMBLE_GOOGLE_CLIENT_ID") {
        if !value.trim().is_empty() { return Ok(value.trim().to_owned()) }
    }
    nimble_core::db::settings::get_setting(pool,"google_calendar_client_id")
        .await.map_err(|_|"google_settings_failed")?
        .filter(|value|!value.trim().is_empty())
        .ok_or_else(||"google_connection_setup_needed".into())
}

pub async fn tick(app:&AppHandle)->Result<nimble_core::integrations::google_calendar::ReconcileResult,String> {
    let _guard=lock().await;
    if !network_allowed(app) { return Err("google_live_network_disabled".into()) }
    let pool=app.state::<SqlitePool>();
    nimble_core::db::recovery::require_activation_clear(pool.inner()).await
        .map_err(|_|"restore_activation_required")?;
    let state=nimble_core::db::google_calendar::state(pool.inner()).await.map_err(|_|"google_status_failed")?;
    if matches!(state.error_code.as_deref(),Some("google_reconnect_required"|"google_permission_denied")) {
        return Ok(nimble_core::integrations::google_calendar::ReconcileResult { changed_task_ids:vec![],error_code:state.error_code });
    }
    if state.retry_after.as_deref().and_then(|v|chrono::DateTime::parse_from_rfc3339(v).ok()).is_some_and(|at|at.with_timezone(&chrono::Utc)>chrono::Utc::now()) {
        return Ok(nimble_core::integrations::google_calendar::ReconcileResult { changed_task_ids:vec![],error_code:Some("google_retry_scheduled".into()) });
    }
    let client_id=client_id(pool.inner()).await?;
    let profile=profile_identity(app)?;
    let client_secret=KeychainClientCredentials.load(&client_secret_account(&profile,&client_id)).map_err(str::to_owned)?.ok_or("google_client_config_missing")?;
    let credentials=KeychainCredentials;
    let refresh_token=credentials.load(&profile).map_err(str::to_owned)?.ok_or("google_connection_needed")?;
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(10)).build().map_err(|_|"google_transport_failed")?;
    let token=match crate::google_oauth::refresh(&client_id,&client_secret,&refresh_token,&client).await {
        Ok(v)=>v,
        Err(code @ ("google_reconnect_required" | "google_client_config_rejected"))=> {
            nimble_core::db::google_calendar::set_error(pool.inner(),Some(code),None).await.map_err(|_|"google_status_failed")?;
            return Err(code.into());
        }
        Err(e)=>return Err(e.into()),
    };
    if let Some(replacement)=token.refresh_token.as_deref() {
        credentials.store(&profile,replacement).map_err(str::to_owned)?;
    }
    let transport=nimble_core::api::google_calendar::CalendarTransport::new(client,nimble_core::api::google_calendar::GOOGLE_API_BASE,token.access_token)
        .map_err(|_|"google_transport_failed")?;
    // Calendar HTTP runs outside the focus guard; each local edit enters it.
    let focus=crate::focus_service::live(app).await;
    nimble_core::integrations::google_calendar::run_once_with_focus(pool.inner(),&transport,chrono::Utc::now(),focus.as_deref())
        .await.map_err(|_|"google_sync_failed".into())
}
