pub use nimble_core::types::UpdateStatus;

#[tauri::command]
pub async fn check_for_updates() -> UpdateStatus {
    let current = env!("CARGO_PKG_VERSION");
    nimble_core::api::updater::check_for_updates(current).await
}
