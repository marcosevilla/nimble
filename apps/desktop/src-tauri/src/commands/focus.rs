//! Thin wrappers over the one managed `FocusService` (see `focus_service.rs`).
//! Every error is a typed `FocusError { code, message }`.
use nimble_core::db::focus::engine::focus_error;
use nimble_core::focus_types::{
    FocusCapabilities, FocusCommand, FocusError, FocusErrorCode, FocusHistoryPage, FocusReply,
    FocusSnapshot,
};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::focus_service::{broadcast, FocusRuntime};

pub use nimble_core::types::FocusState;

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

fn legacy_retired() -> FocusError {
    FocusError {
        code: FocusErrorCode::Unsupported,
        message: "Legacy focus sessions are retired; the focus queue owns timing.".into(),
    }
}

/// Compatibility: the legacy single-task timer would be a second engine.
/// Rejected until Task 8 replaces its consumers.
#[tauri::command]
pub async fn start_focus_session(task_id: String, task_content: String) -> Result<(), FocusError> {
    let _ = (task_id, task_content);
    Err(legacy_retired())
}

#[tauri::command]
pub async fn end_focus_session(
    task_id: String,
    outcome: String,
    duration_secs: i64,
) -> Result<(), FocusError> {
    let _ = (task_id, outcome, duration_secs);
    Err(legacy_retired())
}

/// Legacy resume marker; the v21 migration cleared it, so this reads empty.
#[tauri::command]
pub async fn get_active_focus(app: AppHandle) -> Result<FocusState, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::focus::get_active_focus(pool.inner())
        .await
        .map_err(|e| e.to_string())
}
