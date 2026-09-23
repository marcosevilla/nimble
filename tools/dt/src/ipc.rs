use crate::{commands::CommandResult, output::CliError};
use nimble_core::agent_protocol::*;
use tokio::{io::AsyncWriteExt, net::UnixStream};
pub async fn request(
    profile: &AgentProfile,
    operation: AgentOperation,
) -> Result<serde_json::Value, CliError> {
    let quick = matches!(operation, AgentOperation::Invalidate { .. });
    let budget = std::time::Duration::from_millis(if quick { 500 } else { 120_000 });
    tokio::time::timeout(budget,async {
        profile.validate_socket().map_err(|e|if e.kind()==std::io::ErrorKind::NotFound{CliError::new("app_required","Open the matching Nimble app to run this operation.")}else{e.into()})?;
        let mut socket=UnixStream::connect(&profile.socket).await.map_err(|_|CliError::new("app_required","The matching Nimble app is not listening."))?;
        if socket.peer_cred()?.uid()!=effective_uid(){return Err(CliError::new("unavailable","Local endpoint owner mismatch."));}
        let id=uuid::Uuid::new_v4().to_string();
        let message=AgentRequest{version:VERSION,request_id:id.clone(),profile_id:profile.profile_id.clone(),operation};
        let mut bytes=serde_json::to_vec(&message).map_err(|_|CliError::new("internal","Cannot encode local request."))?;bytes.push(b'\n');
        if bytes.len()>MAX_FRAME{return Err(CliError::validation("Local request exceeds size limit."));}
        socket.write_all(&bytes).await?;
        let frame=read_frame(socket).await?;
        let response:AgentResponse=serde_json::from_slice(&frame).map_err(|_|CliError::new("unavailable","Invalid response from Nimble."))?;
        if response.version!=VERSION||response.request_id!=id{return Err(CliError::new("unavailable","Mismatched response from Nimble."));}
        if response.ok{Ok(response.data.unwrap_or(serde_json::Value::Null))}else{Err(CliError::new("unavailable","Nimble could not finish this operation. Check app status before retrying."))}
    }).await.map_err(|_|CliError::new("unavailable","Nimble did not acknowledge in time. The operation may have completed; inspect its status before retrying."))?
}
pub async fn notify(profile: &AgentProfile, result: &CommandResult) -> &'static str {
    if result.domains.is_empty() {
        return "not_required";
    }
    match request(
        profile,
        AgentOperation::Invalidate {
            domains: result.domains.clone(),
            ids: result.ids.clone(),
        },
    )
    .await
    {
        Ok(_) => "acknowledged",
        Err(e) if e.code == "app_required" => "app_not_running",
        Err(_) => "unavailable",
    }
}

/// Outcome classes for an app-handled task write. Only `AppNotRunning`
/// permits the direct database path; anything after the request may have
/// been sent is `Uncertain` and must be retried with the same command id.
pub enum NativeFailure {
    AppNotRunning,
    NotSent(CliError),
    Uncertain,
    Rejected { code: &'static str, message: String },
}

fn focus_code(code: &str) -> &'static str {
    match code {
        "conflict" => "conflict",
        "wrong_owner" => "wrong_owner",
        "stale_occurrence" => "stale_occurrence",
        "not_found" => "not_found",
        "invalid" => "validation",
        "unsupported" => "unsupported",
        "needs_review" => "needs_review",
        _ => "storage",
    }
}

pub async fn native_task(
    profile: &AgentProfile,
    command: nimble_core::db::focus::engine::NativeTaskCommand,
) -> Result<serde_json::Value, NativeFailure> {
    use std::io::ErrorKind;
    match profile.validate_socket() {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => return Err(NativeFailure::AppNotRunning),
        Err(e) => return Err(NativeFailure::NotSent(e.into())),
    }
    let mut socket = match UnixStream::connect(&profile.socket).await {
        Ok(s) => s,
        Err(e) if matches!(e.kind(), ErrorKind::ConnectionRefused | ErrorKind::NotFound) => {
            return Err(NativeFailure::AppNotRunning)
        }
        Err(e) => return Err(NativeFailure::NotSent(e.into())),
    };
    match socket.peer_cred() {
        Ok(cred) if cred.uid() == effective_uid() => {}
        _ => return Err(NativeFailure::NotSent(CliError::new("unavailable", "Local endpoint owner mismatch."))),
    }
    let id = uuid::Uuid::new_v4().to_string();
    let message = AgentRequest {
        version: VERSION,
        request_id: id.clone(),
        profile_id: profile.profile_id.clone(),
        operation: AgentOperation::NativeTask { command },
    };
    let mut bytes = serde_json::to_vec(&message)
        .map_err(|_| NativeFailure::NotSent(CliError::new("internal", "Cannot encode local request.")))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_FRAME {
        return Err(NativeFailure::NotSent(CliError::validation("Local request exceeds size limit.")));
    }
    // From here on the app may have committed the write.
    let exchange = async {
        socket.write_all(&bytes).await.ok()?;
        let frame = read_frame(socket).await.ok()?;
        serde_json::from_slice::<AgentResponse>(&frame).ok()
    };
    let response = tokio::time::timeout(std::time::Duration::from_secs(15), exchange)
        .await
        .ok()
        .flatten()
        .ok_or(NativeFailure::Uncertain)?;
    if response.version != VERSION || response.request_id != id {
        return Err(NativeFailure::Uncertain);
    }
    if response.ok {
        return Ok(response.data.unwrap_or(serde_json::Value::Null));
    }
    match (response.error.as_deref(), response.data) {
        (Some("rejected"), Some(data)) => Err(NativeFailure::Rejected {
            code: focus_code(data.get("code").and_then(|c| c.as_str()).unwrap_or("")),
            message: data
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Nimble rejected this task write.")
                .to_owned(),
        }),
        _ => Err(NativeFailure::Uncertain),
    }
}
