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
        if url.query_pairs().any(|(k,_)|k=="error") { return Err("google_callback_cancelled") }
        url.query_pairs().find(|(k,_)|k=="code").map(|(_,v)|v.into_owned()).filter(|v|!v.is_empty()).ok_or("google_callback_cancelled")
    }
}

#[derive(Deserialize)]
pub struct TokenResponse { pub access_token:String, pub refresh_token:Option<String> }

pub async fn authorize(client_id:&str, client_secret:&str, client:&reqwest::Client) -> Result<TokenResponse,&'static str> {
    validate_client_config(client_id,client_secret)?;
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
    write_callback_response(&mut stream).await;
    exchange_code(client_id,client_secret,&code,&challenge.verifier,&redirect,client,"https://oauth2.googleapis.com/token").await
}

async fn write_callback_response(stream:&mut tokio::net::TcpStream) {
    // Consent precedes token exchange, credential storage, and calendar validation.
    let body="<html><body>Google approval received. Return to Nimble to check connection status.</body></html>";
    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
    let _=stream.write_all(response.as_bytes()).await;
    let _=stream.shutdown().await;
}

fn validate_client_config(client_id:&str,client_secret:&str)->Result<(),&'static str> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() { return Err("google_client_config_missing") }
    Ok(())
}

async fn exchange_code(client_id:&str,client_secret:&str,code:&str,verifier:&str,redirect:&str,client:&reqwest::Client,endpoint:&str)->Result<TokenResponse,&'static str> {
    validate_client_config(client_id,client_secret)?;
    let response=client.post(endpoint).timeout(Duration::from_secs(30)).form(&[
        ("client_id",client_id),("client_secret",client_secret),("code",code),("code_verifier",verifier),
        ("redirect_uri",redirect),("grant_type","authorization_code")
    ]).send().await;
    token_response(response,"google_token_exchange_failed").await
}

pub async fn refresh(client_id:&str,client_secret:&str,refresh_token:&str,client:&reqwest::Client)->Result<TokenResponse,&'static str> {
    refresh_at(client_id,client_secret,refresh_token,client,"https://oauth2.googleapis.com/token").await
}

async fn refresh_at(client_id:&str,client_secret:&str,refresh_token:&str,client:&reqwest::Client,endpoint:&str)->Result<TokenResponse,&'static str> {
    validate_client_config(client_id,client_secret)?;
    let response=client.post(endpoint).timeout(Duration::from_secs(30)).form(&[
        ("client_id",client_id),("client_secret",client_secret),("refresh_token",refresh_token),("grant_type","refresh_token")
    ]).send().await;
    token_response(response,"google_refresh_failed").await
}

async fn token_response(response:Result<reqwest::Response,reqwest::Error>,fallback:&'static str)->Result<TokenResponse,&'static str> {
    let map_error=|error:reqwest::Error|if error.is_timeout() { "google_connection_timed_out" } else { fallback };
    let response=response.map_err(map_error)?;
    if !response.status().is_success() {
        // Only classify known OAuth codes; descriptions and response bodies never escape.
        #[derive(Deserialize)]
        struct OAuthError { error:String }
        let error=response.json::<OAuthError>().await.map_err(map_error)?;
        return Err(match error.error.as_str() {
            "invalid_client" | "unauthorized_client" | "invalid_request" => "google_client_config_rejected",
            "access_denied" => "google_callback_cancelled",
            "invalid_grant" => "google_reconnect_required",
            _ => fallback,
        });
    }
    response.json().await.map_err(map_error)
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
    async fn token_server(status:&str,body:&str)->(String,tokio::task::JoinHandle<String>) {
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint=format!("http://{}/token",listener.local_addr().unwrap());
        let response=format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        let server=tokio::spawn(async move {
            let (mut stream,_)=listener.accept().await.unwrap();
            let mut request=Vec::new();
            loop {
                let mut chunk=[0u8;1024];
                let count=stream.read(&mut chunk).await.unwrap();
                assert!(count>0,"request ended early");
                request.extend_from_slice(&chunk[..count]);
                if let Some(end)=request.windows(4).position(|w|w==b"\r\n\r\n") {
                    let headers=String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                    let length:usize=headers.lines().find_map(|line|line.strip_prefix("content-length: ")).unwrap().parse().unwrap();
                    if request.len()>=end+4+length { break }
                }
            }
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
            String::from_utf8(request).unwrap()
        });
        (endpoint,server)
    }

    fn form(request:&str)->std::collections::HashMap<String,String> {
        reqwest::Url::parse(&format!("http://localhost/?{}",request.split_once("\r\n\r\n").unwrap().1))
            .unwrap().query_pairs().into_owned().collect()
    }

    #[tokio::test]
    async fn authorization_exchange_sends_desktop_secret_and_pkce() {
        let (endpoint,server)=token_server("200 OK",r#"{"access_token":"fake-access","refresh_token":"fake-refresh"}"#).await;
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        let result=exchange_code("fake-id","fake+secret&value","fake-code","fake-verifier","http://127.0.0.1:4321/callback",&client,&endpoint).await.unwrap();
        assert_eq!(result.access_token,"fake-access");
        let fields=form(&server.await.unwrap());
        assert_eq!(fields.get("client_secret").map(String::as_str),Some("fake+secret&value"));
        assert_eq!(fields["client_id"],"fake-id");
        assert_eq!(fields["code"],"fake-code");
        assert_eq!(fields["code_verifier"],"fake-verifier");
        assert_eq!(fields["redirect_uri"],"http://127.0.0.1:4321/callback");
        assert_eq!(fields["grant_type"],"authorization_code");
    }

    #[tokio::test]
    async fn refresh_sends_desktop_secret() {
        let (endpoint,server)=token_server("200 OK",r#"{"access_token":"fake-access"}"#).await;
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        refresh_at("fake-id","fake-secret","fake-refresh",&client,&endpoint).await.unwrap();
        let fields=form(&server.await.unwrap());
        assert_eq!(fields.get("client_secret").map(String::as_str),Some("fake-secret"));
        assert_eq!(fields["client_id"],"fake-id");
        assert_eq!(fields["refresh_token"],"fake-refresh");
        assert_eq!(fields["grant_type"],"refresh_token");
    }

    #[tokio::test]
    async fn token_errors_are_actionable_and_sanitized() {
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        for (body,expected) in [
            (r#"{"error":"invalid_client","error_description":"fake-secret"}"#,"google_client_config_rejected"),
            (r#"{"error":"invalid_request","error_description":"client_secret is missing."}"#,"google_client_config_rejected"),
            (r#"{"error":"access_denied","error_description":"fake-secret"}"#,"google_callback_cancelled"),
            (r#"{"error":"invalid_grant","error_description":"fake-secret"}"#,"google_reconnect_required"),
            ("fake-secret upstream failure","google_refresh_failed"),
        ] {
            let (endpoint,server)=token_server("400 Bad Request",body).await;
            let error=refresh_at("fake-id","fake-secret","fake-refresh",&client,&endpoint).await.err().unwrap();
            server.await.unwrap();
            assert_eq!(error,expected);
            assert!(!error.contains("fake-secret"));
        }
    }

    #[tokio::test]
    async fn missing_config_is_rejected_before_http() {
        let client=reqwest::Client::builder().no_proxy().build().unwrap();
        for (id,secret) in [("","fake-secret"),("fake-id","")] {
            let error=exchange_code(id,secret,"code","verifier","http://127.0.0.1/callback",&client,"http://127.0.0.1:0/token").await.err().unwrap();
            assert_eq!(error,"google_client_config_missing");
            let error=refresh_at(id,secret,"refresh",&client,"http://127.0.0.1:0/token").await.err().unwrap();
            assert_eq!(error,"google_client_config_missing");
        }
    }

    #[test]
    fn denied_or_empty_callback_is_cancelled() {
        let challenge=Challenge::new();
        for query in ["error=access_denied&code=ignored","code="] {
            assert_eq!(challenge.validate(&format!("http://127.0.0.1/callback?state={}&{query}",challenge.state)),Err("google_callback_cancelled"));
        }
    }

    #[tokio::test]
    async fn callback_acknowledges_approval_without_claiming_connection() {
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut reader=tokio::net::TcpStream::connect(listener.local_addr().unwrap()).await.unwrap();
        let (mut writer,_)=listener.accept().await.unwrap();
        write_callback_response(&mut writer).await;
        let mut response=String::new();
        tokio::time::timeout(Duration::from_secs(1),reader.read_to_string(&mut response)).await.unwrap().unwrap();
        let (headers,body)=response.split_once("\r\n\r\n").unwrap();
        assert!(body.contains("Google approval received. Return to Nimble to check connection status."));
        assert!(!body.contains("Google connected"));
        assert!(headers.contains(&format!("Content-Length: {}",body.len())));
    }

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
