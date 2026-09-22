use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use crate::google_credentials::{client_secret_account, GoogleCredentials, KeychainClientCredentials, KeychainCredentials};

#[derive(Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct GoogleConnectionStatus {
    pub connected:bool,
    pub client_secret_configured:bool,
    pub calendar_label:Option<String>,
    pub timezone:String,
    pub error_code:Option<String>,
}

#[tauri::command]
pub async fn google_calendar_status(app:AppHandle)->Result<GoogleConnectionStatus,String> {
    let pool=app.state::<SqlitePool>();
    let state=nimble_core::db::google_calendar::state(pool.inner()).await.map_err(|_|"google_status_failed")?;
    let (connected, client_secret_configured)=if !crate::google_calendar_runner::network_allowed(&app) {
        (false, false)
    } else {
        let profile=crate::google_calendar_runner::profile_identity(&app)?;
        let configured=match crate::google_calendar_runner::client_id(pool.inner()).await {
            Ok(id)=>KeychainClientCredentials.load(&client_secret_account(&profile,&id)).map_err(str::to_owned)?.is_some(),
            Err(_)=>false,
        };
        let connected=configured && should_reuse_session(state.calendar_id.is_some(),KeychainCredentials.load(&profile).map_err(str::to_owned)?.is_some(),state.error_code.as_deref());
        (connected,configured)
    };
    Ok(GoogleConnectionStatus { connected, client_secret_configured, calendar_label:state.calendar_id.map(|_|"Nimble".into()), timezone:state.timezone, error_code:state.error_code })
}

#[tauri::command]
pub async fn google_calendar_connect(app:AppHandle)->Result<GoogleConnectionStatus,String> {
    let _guard=crate::google_calendar_runner::lock().await;
    if !crate::google_calendar_runner::network_allowed(&app) { return Err("google_live_network_disabled".into()) }
    let pool=app.state::<SqlitePool>();
    let client_id=crate::google_calendar_runner::client_id(pool.inner()).await?;
    let state=nimble_core::db::google_calendar::state(pool.inner()).await.map_err(|_|"google_status_failed")?;
    let profile=crate::google_calendar_runner::profile_identity(&app)?;
    let client_secret=KeychainClientCredentials.load(&client_secret_account(&profile,&client_id)).map_err(str::to_owned)?.ok_or("google_client_config_missing")?;
    let credentials=KeychainCredentials;
    let has_credential=credentials.load(&profile).map_err(str::to_owned)?.is_some();
    if should_reuse_session(state.calendar_id.is_some(),has_credential,state.error_code.as_deref()) {
        return google_calendar_status(app).await;
    }
    if state.calendar_id.is_none() && state.error_code.as_deref()==Some("google_calendar_create_pending") { return Err("google_calendar_setup_needs_review".into()) }
    let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(10)).build().map_err(|_|"google_transport_failed")?;
    let token=crate::google_oauth::authorize(&client_id,&client_secret,&client).await.map_err(str::to_owned)?;
    if let Some(refresh_token)=token.refresh_token.as_deref() {
        credentials.store(&profile,refresh_token).map_err(str::to_owned)?;
    } else if credentials.load(&profile).map_err(str::to_owned)?.is_none() {
        return Err("google_refresh_token_missing".into());
    }
    if let Some(calendar_id)=state.calendar_id.as_deref() {
        // Reconnect only to the owned calendar already linked to tasks. A
        // missing/inaccessible calendar needs review, never a replacement POST.
        crate::google_oauth::validate_existing_calendar(&client,"https://www.googleapis.com/calendar/v3/calendars/",calendar_id,&token.access_token)
            .await.map_err(str::to_owned)?;
        nimble_core::db::google_calendar::set_error(pool.inner(),None,None).await.map_err(|_|"google_status_failed")?;
        return google_calendar_status(app).await;
    }
    // Keep an ambiguous POST from silently creating multiple calendars.
    nimble_core::db::google_calendar::set_error(pool.inner(),Some("google_calendar_create_pending"),None)
        .await.map_err(|_|"google_status_failed")?;
    let timezone=crate::commands::reminders::reminder_timezone(pool.inner()).await?;
    let response=client.post("https://www.googleapis.com/calendar/v3/calendars")
        .bearer_auth(&token.access_token)
        .json(&serde_json::json!({"summary":"Nimble","timeZone":timezone}))
        .send().await.map_err(|_|"google_calendar_setup_needs_review")?;
    if !response.status().is_success() { return Err("google_calendar_setup_needs_review".into()) }
    let result:serde_json::Value=response.json().await.map_err(|_|"google_calendar_setup_needs_review")?;
    let calendar_id=result.get("id").and_then(|v|v.as_str()).ok_or("google_calendar_setup_needs_review")?;
    nimble_core::db::google_calendar::set_calendar(pool.inner(),calendar_id,&timezone).await.map_err(|_|"google_status_failed")?;
    nimble_core::db::google_calendar::set_error(pool.inner(),None,None).await.map_err(|_|"google_status_failed")?;
    google_calendar_status(app).await
}

fn should_reuse_session(has_calendar:bool,has_credential:bool,error:Option<&str>)->bool {
    has_calendar && has_credential && !matches!(error,Some("google_reconnect_required"|"google_permission_denied"|"google_calendar_create_pending"|"google_client_config_rejected"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reconnect_pause_requires_new_authorization() {
        assert!(!should_reuse_session(true,true,Some("google_reconnect_required")));
        assert!(!should_reuse_session(true,true,Some("google_client_config_rejected")));
        assert!(!should_reuse_session(true,false,None));
        assert!(should_reuse_session(true,true,None));
    }
}

#[tauri::command]
pub async fn google_calendar_disconnect(app:AppHandle)->Result<GoogleConnectionStatus,String> {
    let _guard=crate::google_calendar_runner::lock().await;
    if !crate::google_calendar_runner::network_allowed(&app) { return Err("google_live_network_disabled".into()) }
    let profile=crate::google_calendar_runner::profile_identity(&app)?;
    let credentials=KeychainCredentials;
    if let Some(token)=credentials.load(&profile).map_err(str::to_owned)? {
        if let Ok(client)=reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build() {
            let _=client.post("https://oauth2.googleapis.com/revoke").form(&[("token",token.as_str())]).send().await;
        }
    }
    credentials.delete(&profile).map_err(str::to_owned)?;
    google_calendar_status(app).await
}

#[tauri::command]
pub async fn google_calendar_sync_now(app:AppHandle)->Result<nimble_core::integrations::google_calendar::ReconcileResult,String> {
    let result=crate::google_calendar_runner::tick(&app).await?;
    if !result.changed_task_ids.is_empty() {
        let _=app.emit("nimble-data-changed",serde_json::json!({"version":1,"domains":["tasks"],"ids":result.changed_task_ids}));
    }
    Ok(result)
}

#[tauri::command]
pub async fn google_calendar_list_conflicts(app:AppHandle)->Result<Vec<nimble_core::db::google_calendar::CalendarConflict>,String> {
    let pool=app.state::<SqlitePool>();
    nimble_core::db::google_calendar::list_conflicts(pool.inner()).await.map_err(|_|"google_conflicts_failed".into())
}

#[tauri::command]
pub async fn google_calendar_resolve_conflict(app:AppHandle,task_id:String,resolution:String)->Result<(),String> {
    let pool=app.state::<SqlitePool>();
    let conflict=nimble_core::db::google_calendar::list_conflicts(pool.inner()).await.map_err(|_|"google_conflicts_failed")?
        .into_iter().find(|c|c.task_id==task_id).ok_or("google_conflict_missing")?;
    match resolution.as_str() {
        "keep_nimble" => {
            nimble_core::db::google_calendar::queue_upsert(pool.inner(),&task_id,&nimble_core::integrations::google_calendar::event_id(&task_id),&conflict.local)
                .await.map_err(|_|"google_resolution_failed")?;
        }
        "use_calendar" => {
            let remote=conflict.remote.ok_or("google_remote_unsupported")?;
            // Reconciliation rechecks the latest local task before applying.
            if !nimble_core::integrations::google_calendar::apply_remote_if_unchanged(pool.inner(),&conflict.local,&remote)
                .await.map_err(|_|"google_resolution_failed")? { return Err("google_local_changed_review_again".into()) }
            nimble_core::db::google_calendar::acknowledge_upsert(pool.inner(),&task_id,None,&remote)
                .await.map_err(|_|"google_resolution_failed")?;
        }
        _ => return Err("google_resolution_invalid".into()),
    }
    sqlx::query("DELETE FROM google_calendar_conflicts WHERE task_id=?").bind(&task_id).execute(pool.inner()).await.map_err(|_|"google_resolution_failed")?;
    let _=app.emit("nimble-data-changed",serde_json::json!({"version":1,"domains":["tasks"],"ids":[task_id]}));
    Ok(())
}

#[tauri::command]
pub async fn google_calendar_configure(app:AppHandle,client_id:String,client_secret:String)->Result<GoogleConnectionStatus,String> {
    let _guard=crate::google_calendar_runner::lock().await;
    if !crate::google_calendar_runner::network_allowed(&app) { return Err("google_live_network_disabled".into()) }
    let pool=app.state::<SqlitePool>();
    let profile=crate::google_calendar_runner::profile_identity(&app)?;
    let state=nimble_core::db::google_calendar::state(pool.inner()).await.map_err(|_|"google_status_failed")?;
    let bound=state.calendar_id.is_some() || KeychainCredentials.load(&profile).map_err(str::to_owned)?.is_some();
    save_client_configuration(pool.inner(),&profile,&client_id,&client_secret,bound,&KeychainClientCredentials).await?;
    google_calendar_status(app).await
}

async fn save_client_configuration(
    pool: &SqlitePool, profile: &str, client_id: &str, client_secret: &str,
    bound: bool, store: &dyn GoogleCredentials,
) -> Result<(), String> {
    let id=client_id.trim();
    let secret=client_secret.trim();
    if id.is_empty() || secret.is_empty() { return Err("google_client_config_missing".into()) }
    if id.len()>512 || !id.ends_with(".apps.googleusercontent.com") || id.chars().any(|c|c.is_whitespace() || c.is_control())
        || secret.len()>4096 || secret.chars().any(char::is_control) {
        return Err("google_client_config_rejected".into())
    }
    if std::env::var("NIMBLE_GOOGLE_CLIENT_ID").ok().filter(|v|!v.trim().is_empty()).is_some_and(|v|v.trim()!=id) {
        return Err("google_client_change_blocked".into())
    }
    if bound && crate::google_calendar_runner::client_id(pool).await?.trim()!=id {
        return Err("google_client_change_blocked".into())
    }
    store.store(&client_secret_account(profile,id),secret).map_err(str::to_owned)?;
    nimble_core::db::settings::set_setting(pool,"google_calendar_client_id",id).await.map_err(|_|"google_settings_failed".into())
}

#[cfg(test)]
mod setup_tests {
    use super::*;
    use crate::google_credentials::{client_secret_account, MemoryCredentials};
    async fn pool() -> SqlitePool {
        let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT)").execute(&pool).await.unwrap();
        pool
    }
    #[tokio::test]
    async fn setup_saves_only_public_id_in_database_and_secret_in_bound_store() {
        let pool=pool().await;
        let store=MemoryCredentials::default();
        let id="123-alpha.apps.googleusercontent.com";
        save_client_configuration(&pool,"profile-a",id,"fake-secret",false,&store).await.unwrap();
        let rows: Vec<(String,String)>=sqlx::query_as("SELECT key,value FROM settings").fetch_all(&pool).await.unwrap();
        assert_eq!(rows,vec![("google_calendar_client_id".into(),id.into())]);
        assert_eq!(store.load(&client_secret_account("profile-a",id)).unwrap().as_deref(),Some("fake-secret"));
        assert_eq!(store.load(&client_secret_account("profile-b",id)).unwrap(),None);
    }
    #[tokio::test]
    async fn setup_rejects_switching_clients_for_a_bound_calendar() {
        let pool=pool().await;
        let store=MemoryCredentials::default();
        let old="123-alpha.apps.googleusercontent.com";
        let new="456-beta.apps.googleusercontent.com";
        nimble_core::db::settings::set_setting(&pool,"google_calendar_client_id",old).await.unwrap();
        assert_eq!(save_client_configuration(&pool,"profile-a",new,"fake-new",true,&store).await,Err("google_client_change_blocked".into()));
        assert_eq!(nimble_core::db::settings::get_setting(&pool,"google_calendar_client_id").await.unwrap().as_deref(),Some(old));
        assert_eq!(store.load(&client_secret_account("profile-a",new)).unwrap(),None);
        save_client_configuration(&pool,"profile-a",old,"fake-replacement",true,&store).await.unwrap();
        assert_eq!(store.load(&client_secret_account("profile-a",old)).unwrap().as_deref(),Some("fake-replacement"));
    }
    #[tokio::test]
    async fn setup_rejects_empty_secret_without_persisting_public_id() {
        let pool=pool().await;
        let store=MemoryCredentials::default();
        assert_eq!(save_client_configuration(&pool,"profile-a","123-alpha.apps.googleusercontent.com"," ",false,&store).await,Err("google_client_config_missing".into()));
        assert_eq!(nimble_core::db::settings::get_setting(&pool,"google_calendar_client_id").await.unwrap(),None);
    }
}
