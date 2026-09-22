use crate::backup_runner::{self, BackupStatus};
use tauri::AppHandle;
fn public_error(_: nimble_core::Error) -> String {
    "The backup action could not finish. Check Backups in Settings.".into()
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
