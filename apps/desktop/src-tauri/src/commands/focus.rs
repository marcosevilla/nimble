//! Thin wrappers over the one managed `FocusService` (see `focus_service.rs`).
//! Every error is a typed `FocusError { code, message }`.
use nimble_core::db::focus::engine::focus_error;
use nimble_core::focus_types::{
    FocusCapabilities, FocusCommand, FocusError, FocusErrorCode, FocusHistoryPage, FocusReply,
    FocusSnapshot,
};
use tauri::{AppHandle, Manager};

use crate::focus_service::{broadcast, FocusRuntime};

fn runtime(app: &AppHandle) -> Result<tauri::State<'_, FocusRuntime>, FocusError> {
    app.try_state::<FocusRuntime>().ok_or_else(|| FocusError {
        code: FocusErrorCode::Storage,
        message: "focus service is starting".into(),
    })
}

#[tauri::command]
pub async fn focus_capabilities(app: AppHandle) -> Result<FocusCapabilities, FocusError> {
    Ok(runtime(&app)?.capabilities().await)
}

#[tauri::command]
pub async fn focus_snapshot(app: AppHandle) -> Result<FocusSnapshot, FocusError> {
    let service = runtime(&app)?.reader().await?;
    service.snapshot().await.map_err(|e| focus_error(&e))
}

#[tauri::command]
pub async fn focus_execute(app: AppHandle, command: FocusCommand) -> Result<FocusReply, FocusError> {
    let rt = runtime(&app)?;
    let service = rt.writer().await?;
    let command_id = command.command_id.clone();
    match service.execute(command).await {
        Ok(reply) => {
            rt.emit(&app, &reply.snapshot, Some(command_id));
            Ok(reply)
        }
        Err(e) => {
            // A storage failure may have committed a recovery pause.
            broadcast(&app).await;
            Err(focus_error(&e))
        }
    }
}

#[tauri::command]
pub async fn focus_history(
    app: AppHandle,
    cursor: Option<String>,
    task_id: Option<String>,
) -> Result<FocusHistoryPage, FocusError> {
    let service = runtime(&app)?.reader().await?;
    service.history(cursor, task_id).await.map_err(|e| focus_error(&e))
}

/// The companion window arrives with Task 9 (lifecycle, geometry, ownership).
#[tauri::command]
pub async fn focus_open_companion() -> Result<(), FocusError> {
    Err(FocusError {
        code: FocusErrorCode::Unsupported,
        message: "The focus companion window is not available yet.".into(),
    })
}
