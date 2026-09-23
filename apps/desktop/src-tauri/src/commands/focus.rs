//! Thin wrappers over the one managed `FocusService` (see `focus_service.rs`).
//! Every error is a typed `FocusError { code, message }`.
use nimble_core::db::focus::engine::focus_error;
use nimble_core::focus_types::{
    FocusCapabilities, FocusCommand, FocusError, FocusErrorCode, FocusHistoryPage,
    FocusImportPreview, FocusImportResult, FocusReply, FocusSnapshot, LegacyFocusFiles,
};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::focus_service::{broadcast, committed, FocusRuntime};
use crate::focus_window::{self, CompanionGeometry};

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
    // The service, not UI gating, refuses to open a live segment unless the
    // heartbeat/lifecycle that settles it is wired in this process.
    rt.check_live_timing(&command.action)?;
    let command_id = command.command_id.clone();
    // Start/complete/restore also change native task rows: every window's
    // task lists must re-read, not just the one that sent the action.
    let touches_tasks = crate::data_events::focus_action_touches_tasks(&command.action);
    match service.execute(command).await {
        Ok(reply) => {
            committed(&app, &reply.snapshot, Some(command_id)).await;
            if touches_tasks {
                crate::data_events::broadcast(&app, crate::data_events::TASKS, Vec::new());
            }
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

/// Read-only preview of user-chosen frozen Focus Queue file contents.
/// Owner-only, like commit: the preview is proposed against the writer's queue.
#[tauri::command]
pub async fn focus_preview_import(
    app: AppHandle,
    files: LegacyFocusFiles,
) -> Result<FocusImportPreview, FocusError> {
    runtime(&app)?.writer().await?;
    let pool = app.state::<sqlx::SqlitePool>();
    nimble_core::db::focus::import::preview_import(pool.inner(), &files)
        .await
        .map_err(|e| focus_error(&e))
}

/// Atomic local import of exactly the previewed decisions. No remote calls.
#[tauri::command]
pub async fn focus_commit_import(
    app: AppHandle,
    files: LegacyFocusFiles,
    preview_token: String,
    command_id: String,
) -> Result<FocusImportResult, FocusError> {
    let service = runtime(&app)?.writer().await?;
    match service.commit_import(&files, &preview_token, &command_id).await {
        Ok((result, snapshot)) => {
            committed(&app, &snapshot, Some(command_id)).await;
            if !result.created_task_ids.is_empty() {
                crate::data_events::broadcast(&app, crate::data_events::TASKS, Vec::new());
            }
            Ok(result)
        }
        Err(e) => Err(focus_error(&e)),
    }
}

/// Show the always-on-top companion (a view only: no session, no clock).
/// Synchronous so the show/activation stays tied to the user's action.
#[tauri::command]
pub fn focus_open_companion(app: AppHandle) -> Result<(), FocusError> {
    focus_window::open_companion(&app)
}

/// Companion "Open details": show main and open the task there.
#[tauri::command]
pub fn focus_open_task_in_main(app: AppHandle, task_id: String) -> Result<(), FocusError> {
    focus_window::open_task_in_main(&app, &task_id)
}

/// Apply geometry computed by `focusWindow.ts`; accepted only from the companion.
#[tauri::command]
pub fn focus_companion_apply_geometry(
    window: WebviewWindow,
    geometry: CompanionGeometry,
) -> Result<(), FocusError> {
    focus_window::apply_geometry(&window, geometry)
}
