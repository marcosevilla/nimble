use crate::backup_runner::{self, BackupStatus};
use tauri::AppHandle;
fn public_error(error: nimble_core::Error) -> String {
    backup_runner::public_error_code(&error).into()
}
#[tauri::command]
pub async fn backup_get_status(app: AppHandle) -> Result<BackupStatus, String> {
    backup_runner::read_status(&app).await.map_err(public_error)
}
#[tauri::command]
pub async fn backup_run_now(app: AppHandle) -> Result<BackupStatus, String> {
    backup_runner::run_now(&app).await.map_err(public_error)
}
#[tauri::command]
pub async fn backup_open_folder(app: AppHandle) -> Result<(), String> {
    backup_runner::open_folder(&app).await.map_err(public_error)
}
#[tauri::command]
pub async fn backup_configure_remote(
    app: AppHandle,
    owner_repo: String,
) -> Result<BackupStatus, String> {
    backup_runner::configure_remote(&app, &owner_repo)
        .await
        .map_err(public_error)
}
#[derive(serde::Serialize)]
pub struct Verification {
    verified: bool,
}
#[tauri::command]
pub async fn backup_verify_latest(app: AppHandle) -> Result<Verification, String> {
    backup_runner::verify_latest(&app)
        .await
        .map(|()| Verification { verified: true })
        .map_err(public_error)
}
/// Explicitly activate a restored profile on this Mac (clears the restore
/// marker, re-initializes focus ownership; starts nothing). Idempotent.
#[tauri::command]
pub async fn backup_activate_restored_profile(app: AppHandle) -> Result<BackupStatus, String> {
    crate::focus_service::activate_restored(&app)
        .await
        .map_err(|e| match e.code {
            nimble_core::focus_types::FocusErrorCode::WrongOwner => "restore_activation_refused".to_string(),
            _ => "backup_action_failed".to_string(),
        })?;
    backup_runner::read_status(&app).await.map_err(public_error)
}
