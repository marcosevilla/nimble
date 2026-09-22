//! Installed-app OAuth, limited to Google's app-created calendar scope.
//! Secrets never appear in command results or error strings.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{sync::atomic::{AtomicBool, Ordering}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.app.created";
static CONNECTING: AtomicBool = AtomicBool::new(false);

pub struct AttemptGuard;
impl AttemptGuard {
    pub fn acquire() -> Result<Self, &'static str> {
        CONNECTING.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst)
            .map(|_|Self).map_err(|_|"google_connection_busy")
    }
}
impl Drop for AttemptGuard { fn drop(&mut self) { CONNECTING.store(false,Ordering::SeqCst); } }

#[derive(Debug, Clone)]
pub struct Challenge { pub state:String, pub verifier:String, pub challenge:String }
impl Challenge {
    pub fn new() -> Self {
        let mut state=[0u8;32]; let mut verifier=[0u8;32];
        rand::thread_rng().fill_bytes(&mut state); rand::thread_rng().fill_bytes(&mut verifier);
        let state=URL_SAFE_NO_PAD.encode(state); let verifier=URL_SAFE_NO_PAD.encode(verifier);
        let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self { state, verifier, challenge }
    }
    pub fn validate(&self, callback: &str) -> Result<String,&'static str> {
        let url=reqwest::Url::parse(callback).map_err(|_|"google_callback_invalid")?;
        if url.host_str()!=Some("127.0.0.1") || url.path()!="/callback" { return Err("google_callback_invalid") }
        let state=url.query_pairs().find(|(k,_)|k=="state").map(|(_,v)|v.into_owned());
        if state.as_deref()!=Some(&self.state) { return Err("google_state_mismatch") }
        url.query_pairs().find(|(k,_)|k=="code").map(|(_,v)|v.into_owned()).ok_or("google_callback_cancelled")
    }
}

#[derive(Deserialize)]
pub struct TokenResponse { pub access_token:String, pub refresh_token:Option<String> }

pub async fn authorize(client_id:&str, client:&reqwest::Client) -> Result<TokenResponse,&'static str> {
    let _guard=AttemptGuard::acquire()?;
    let listener=TcpListener::bind("127.0.0.1:0").await.map_err(|_|"google_loopback_failed")?;
    let port=listener.local_addr().map_err(|_|"google_loopback_failed")?.port();
    let redirect=format!("http://127.0.0.1:{port}/callback");
    let challenge=Challenge::new();
    let mut auth=reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|_|"google_setup_failed")?;
    auth.query_pairs_mut().append_pair("client_id",client_id).append_pair("redirect_uri",&redirect)
        .append_pair("response_type","code").append_pair("scope",SCOPE)
        .append_pair("access_type","offline").append_pair("prompt","consent")
        .append_pair("state",&challenge.state).append_pair("code_challenge",&challenge.challenge)
        .append_pair("code_challenge_method","S256");
    std::process::Command::new("open").arg(auth.as_str()).spawn().map_err(|_|"google_browser_failed")?;
    let (mut stream,peer)=tokio::time::timeout(Duration::from_secs(300),listener.accept()).await
        .map_err(|_|"google_connection_timed_out")?.map_err(|_|"google_loopback_failed")?;
    if !peer.ip().is_loopback() { return Err("google_callback_invalid") }
    let mut buffer=[0u8;4096];
    let count=tokio::time::timeout(Duration::from_secs(10),stream.read(&mut buffer)).await
        .map_err(|_|"google_callback_timed_out")?.map_err(|_|"google_callback_invalid")?;
    let request=std::str::from_utf8(&buffer[..count]).map_err(|_|"google_callback_invalid")?;
    let path=request.lines().next().and_then(|line|line.strip_prefix("GET ")).and_then(|line|line.split_whitespace().next())
        .ok_or("google_callback_invalid")?;
    let callback=format!("http://127.0.0.1:{port}{path}");
    let code=challenge.validate(&callback)?;
    let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 77\r\nConnection: close\r\n\r\n<html><body>Google connected. You can return to Nimble now.</body></html>").await;
    let response=client.post("https://oauth2.googleapis.com/token").form(&[
        ("client_id",client_id),("code",code.as_str()),("code_verifier",challenge.verifier.as_str()),
        ("redirect_uri",redirect.as_str()),("grant_type","authorization_code")
    ]).send().await.map_err(|_|"google_token_exchange_failed")?;
    if !response.status().is_success() { return Err("google_token_exchange_failed") }
    response.json().await.map_err(|_|"google_token_exchange_failed")
}

pub async fn refresh(client_id:&str, refresh_token:&str, client:&reqwest::Client) -> Result<TokenResponse,&'static str> {
    let response=client.post("https://oauth2.googleapis.com/token").form(&[
        ("client_id",client_id),("refresh_token",refresh_token),("grant_type","refresh_token")
    ]).send().await.map_err(|_|"google_refresh_failed")?;
    if response.status()==reqwest::StatusCode::BAD_REQUEST { return Err("google_reconnect_required") }
    if !response.status().is_success() { return Err("google_refresh_failed") }
    response.json().await.map_err(|_|"google_refresh_failed")
}

pub async fn validate_existing_calendar(client:&reqwest::Client,base_url:&str,calendar_id:&str,access_token:&str)->Result<(),&'static str> {
    if calendar_id.is_empty() || calendar_id.contains('/') || calendar_id.contains("..") { return Err("google_calendar_reconnect_needs_review") }
    let mut url=reqwest::Url::parse(base_url).map_err(|_|"google_calendar_setup_failed")?;
    url.path_segments_mut().map_err(|_|"google_calendar_setup_failed")?.pop_if_empty().push(calendar_id);
    let response=client.get(url).bearer_auth(access_token).send().await.map_err(|_|"google_calendar_reconnect_needs_review")?;
    if !response.status().is_success() { return Err("google_calendar_reconnect_needs_review") }
    let body:serde_json::Value=response.json().await.map_err(|_|"google_calendar_reconnect_needs_review")?;
    if body.get("id").and_then(|v|v.as_str())!=Some(calendar_id) { return Err("google_calendar_reconnect_needs_review") }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_is_required_and_one_use_guard() {
        let c=Challenge::new();
        assert_eq!(c.validate("http://127.0.0.1/callback?code=secret"),Err("google_state_mismatch"));
        let guard=AttemptGuard::acquire().unwrap();
        assert!(AttemptGuard::acquire().is_err());
        drop(guard);
        assert!(AttemptGuard::acquire().is_ok());
    }
    #[tokio::test]
    async fn reconnect_validates_stored_calendar_without_creating_another() {
        let listener=match TcpListener::bind("127.0.0.1:0").await {
            Ok(v)=>v,
            Err(e) if e.kind()==std::io::ErrorKind::PermissionDenied=>return,
            Err(e)=>panic!("loopback bind failed: {e}"),
        };
        let port=listener.local_addr().unwrap().port();
        let server=tokio::spawn(async move {
            let (mut stream,_)=listener.accept().await.unwrap();
            let mut bytes=[0u8;4096]; let n=stream.read(&mut bytes).await.unwrap();
            let request=String::from_utf8_lossy(&bytes[..n]).into_owned();
            let body=r#"{"id":"owned-calendar"}"#;
            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            stream.write_all(response.as_bytes()).await.unwrap();
            request
        });
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        validate_existing_calendar(&client,&format!("http://127.0.0.1:{port}/calendar/v3/calendars/"),"owned-calendar","fake-access").await.unwrap();
        let request=server.await.unwrap();
        assert!(request.starts_with("GET /calendar/v3/calendars/owned-calendar "),"{request}");
        assert!(!request.contains("POST "));
    }
}
