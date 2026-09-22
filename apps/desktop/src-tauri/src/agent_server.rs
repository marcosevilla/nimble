//! Same-user local agent endpoint. Database mutations stay in nimble-core CRUD.
use nimble_core::agent_protocol::*;
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::AsyncWriteExt,
    net::{UnixListener, UnixStream},
    sync::Semaphore,
};

pub struct AgentServerGuard {
    task: tauri::async_runtime::JoinHandle<()>,
    socket: std::path::PathBuf,
    inode: u64,
    _lock: SchemaLock,
}
impl Drop for AgentServerGuard {
    fn drop(&mut self) {
        self.task.abort();
        if fs::symlink_metadata(&self.socket)
            .is_ok_and(|m| m.ino() == self.inode && m.uid() == effective_uid())
        {
            let _ = fs::remove_file(&self.socket);
        }
    }
}
pub fn start(app: &AppHandle, profile: AgentProfile) -> Result<AgentServerGuard, String> {
    start_inner(app, profile).map_err(|_| "Cannot start safe local agent endpoint".into())
}
fn start_inner(app: &AppHandle, profile: AgentProfile) -> std::io::Result<AgentServerGuard> {
    profile.ensure_socket_directory()?;
    let lock = SchemaLock::at(
        &profile.socket.parent().unwrap().join("listener.lock"),
        true,
    )?;
    if fs::symlink_metadata(&profile.socket).is_ok() {
        profile.validate_socket()?;
        match std::os::unix::net::UnixStream::connect(&profile.socket) {
            Ok(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "Listener active",
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
                fs::remove_file(&profile.socket)?
            }
            Err(e) => return Err(e),
        }
    }
    let listener = std::os::unix::net::UnixListener::bind(&profile.socket)?;
    fs::set_permissions(&profile.socket, fs::Permissions::from_mode(0o600))?;
    let inode = fs::symlink_metadata(&profile.socket)?.ino();
    listener.set_nonblocking(true)?;
    let socket = profile.socket.clone();
    let app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let Ok(listener) = UnixListener::from_std(listener) else {
            return;
        };
        let permits = std::sync::Arc::new(Semaphore::new(8));
        while let Ok((stream, _)) = listener.accept().await {
            let Ok(permit) = permits.clone().try_acquire_owned() else {
                continue;
            };
            let app = app.clone();
            let profile = profile.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                let _ = serve(stream, &app, &profile).await;
            });
        }
    });
    Ok(AgentServerGuard {
        task,
        socket,
        inode,
        _lock: lock,
    })
}
fn validate_request(request: &AgentRequest, profile: &AgentProfile) -> bool {
    request.version == VERSION
        && request.profile_id == profile.profile_id
        && uuid::Uuid::parse_str(&request.request_id).is_ok()
        && match &request.operation {
            AgentOperation::Invalidate { domains, ids } => {
                !domains.is_empty()
                    && domains.len() <= 6
                    && ids.len() <= 1000
                    && ids.iter().all(|id| id.len() <= 128)
            }
            _ => true,
        }
}
async fn serve(
    mut stream: UnixStream,
    app: &AppHandle,
    profile: &AgentProfile,
) -> std::io::Result<()> {
    if stream.peer_cred()?.uid() != effective_uid() {
        return Ok(());
    }
    let frame = match tokio::time::timeout(Duration::from_secs(2), read_frame(&mut stream)).await {
        Ok(Ok(v)) => v,
        _ => return Ok(()),
    };
    let request: AgentRequest = match serde_json::from_slice(&frame) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    if !validate_request(&request, profile) {
        return Ok(());
    }
    let operation = dispatch(app, profile, &request.operation).await;
    let response = match operation {
        Ok(data) => AgentResponse {
            version: VERSION,
            request_id: request.request_id,
            ok: true,
            data: Some(data),
            error: None,
        },
        // A typed focus rejection is a definite outcome (nothing committed),
        // so the caller can report it instead of treating it as uncertain.
        Err(Failure::Focus(e)) => AgentResponse {
            version: VERSION,
            request_id: request.request_id,
            ok: false,
            data: serde_json::to_value(&e).ok(),
            error: Some("rejected".into()),
        },
        Err(Failure::Generic) => AgentResponse {
            version: VERSION,
            request_id: request.request_id,
            ok: false,
            data: None,
            error: Some("operation_failed".into()),
        },
    };
    let mut bytes = serde_json::to_vec(&response)?;
    bytes.push(b'\n');
    if bytes.len() > MAX_FRAME {
        return Ok(());
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), stream.write_all(&bytes)).await;
    Ok(())
}
/// Generic failures stay opaque on the wire ("operation_failed"), as before.
enum Failure {
    Generic,
    Focus(nimble_core::focus_types::FocusError),
}
impl From<&str> for Failure {
    fn from(_: &str) -> Self {
        Self::Generic
    }
}
impl From<String> for Failure {
    fn from(_: String) -> Self {
        Self::Generic
    }
}
async fn dispatch(
    app: &AppHandle,
    profile: &AgentProfile,
    operation: &AgentOperation,
) -> Result<Value, Failure> {
    match operation {
        AgentOperation::NativeTask { command } => {
            let outcome = crate::focus_service::execute_task(
                app,
                command.action.clone(),
                Some(command.command_id.clone()),
            )
            .await
            .map_err(Failure::Focus)?;
            let ids: Vec<String> = outcome
                .task
                .as_ref()
                .map(|t| vec![t.id.clone()])
                .unwrap_or_default();
            let _ = app.emit(
                "nimble-data-changed",
                DataChanged {
                    version: VERSION,
                    domains: vec![Domain::Tasks, Domain::Activity],
                    ids,
                },
            );
            Ok(json!({
                "task": outcome.task,
                "replayed": outcome.replayed,
                "undo_token": outcome.undo_token,
            }))
        }
        AgentOperation::Invalidate { domains, ids } => {
            app.emit(
                "nimble-data-changed",
                DataChanged {
                    version: VERSION,
                    domains: domains.clone(),
                    ids: ids.clone(),
                },
            )
            .map_err(|_| "emit failed")?;
            Ok(json!({"emitted":true}))
        }
        AgentOperation::BackupStatus => serde_json::to_value(
            crate::backup_runner::read_status(app)
                .await
                .map_err(|_| "backup failed")?,
        )
        .map_err(|_| "encoding failed".into()),
        AgentOperation::BackupNow => serde_json::to_value(
            crate::backup_runner::run_now(app)
                .await
                .map_err(|_| "backup failed")?,
        )
        .map_err(|_| "encoding failed".into()),
        AgentOperation::BackupVerify => {
            crate::backup_runner::verify_latest(app)
                .await
                .map_err(|_| "verification failed")?;
            Ok(json!({"verified":true}))
        }
        AgentOperation::SyncStatus => {
            let pool = app.state::<sqlx::SqlitePool>();
            serde_json::to_value(
                nimble_core::db::sync::get_sync_status(pool.inner())
                    .await
                    .map_err(|_| "status failed")?,
            )
            .map_err(|_| "encoding failed".into())
        }
        AgentOperation::SyncNow => {
            if profile.test_mode {
                return Ok(
                    json!({"todoist":{"state":"disabled_test_profile"},"turso":{"state":"disabled_test_profile"}}),
                );
            }
            Ok(crate::sync_runner::run_agent_sync(app).await?)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_require_matching_profile_version_and_bounded_ids() {
        let profile = AgentProfile {
            database: "/unused".into(),
            socket: "/unused".into(),
            profile_id: "fixture".into(),
            test_mode: true,
        };
        let mut request = AgentRequest {
            version: VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            profile_id: "fixture".into(),
            operation: AgentOperation::Invalidate {
                domains: vec![Domain::Tasks],
                ids: vec!["1".into()],
            },
        };
        assert!(validate_request(&request, &profile));
        request.version = 99;
        assert!(!validate_request(&request, &profile));
        request.version = VERSION;
        request.profile_id = "other".into();
        assert!(!validate_request(&request, &profile));
        request.profile_id = "fixture".into();
        request.operation = AgentOperation::Invalidate {
            domains: vec![Domain::Tasks],
            ids: vec!["x".repeat(129)],
        };
        assert!(!validate_request(&request, &profile));
    }
}
