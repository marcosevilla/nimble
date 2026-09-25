//! Pins the exact wire request/response handling of `AnthropicLlm` against a
//! loopback listener (never the network). Skips when the sandbox denies bind.
use nimble_core::api::llm::{AnthropicLlm, LlmClient, LlmError, LlmRequest};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

async fn listener() -> Option<TcpListener> {
    match TcpListener::bind("127.0.0.1:0").await {
        Ok(v) => Some(v),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            eprintln!("local socket denied by sandbox; run this test with loopback permission");
            None
        }
        Err(e) => panic!("loopback bind failed: {e}"),
    }
}

/// Accepts one connection; fails fast (not hangs) if the client never connects.
async fn accept(listener: &TcpListener) -> tokio::net::TcpStream {
    tokio::time::timeout(std::time::Duration::from_secs(10), listener.accept())
        .await
        .expect("no client connected within 10s")
        .unwrap()
        .0
}

async fn serve_one(listener: &TcpListener, status: u16, body: &str) -> String {
    let mut stream = accept(listener).await;
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).await.unwrap();
        if n == 0 { break }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let header = String::from_utf8_lossy(&bytes[..end + 4]);
            let len = header.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
            if bytes.len() >= end + 4 + len { break }
        }
    }
    let request = String::from_utf8_lossy(&bytes).into_owned();
    let reason = match status { 200 => "OK", 429 => "Too Many Requests", 401 => "Unauthorized", _ => "Error" };
    let response = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    stream.write_all(response.as_bytes()).await.unwrap();
    request
}

fn request() -> LlmRequest {
    LlmRequest {
        model: "claude-opus-5-5".into(),
        effort: "low".into(),
        system: "sys".into(),
        user: "hi".into(),
        schema: serde_json::json!({"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}),
        max_tokens: 16000,
    }
}

fn client(port: u16) -> AnthropicLlm {
    AnthropicLlm::with_base(reqwest::Client::builder().no_proxy().build().unwrap(), &format!("http://127.0.0.1:{port}/"), "sk-test".into()).unwrap()
}

#[tokio::test]
async fn sends_the_structured_output_request_and_reads_text_after_thinking() {
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    let reply = r#"{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","stop_reason":"end_turn","stop_details":null,"content":[{"type":"thinking","thinking":"","signature":"sig"},{"type":"text","text":"{\"summary\":\"A calm day.\"}"}],"usage":{"input_tokens":1234,"output_tokens":56,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}"#;
    let server = tokio::spawn(async move { serve_one(&listener, 200, reply).await });
    let out = client(port).structured(&request()).await.unwrap();
    assert_eq!(out.json["summary"], "A calm day.");
    assert_eq!((out.usage.input_tokens, out.usage.output_tokens), (1234, 56));
    let raw = server.await.unwrap();
    assert!(raw.starts_with("POST /v1/messages "), "{raw}");
    let lower = raw.to_ascii_lowercase();
    assert!(lower.contains("x-api-key: sk-test"), "{raw}");
    assert!(lower.contains("anthropic-version: 2023-06-01"), "{raw}");
    assert!(lower.contains("content-type: application/json"), "{raw}");
    let body: serde_json::Value = serde_json::from_str(raw.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["model"], "claude-opus-5-5");
    assert_eq!(body["output_config"]["effort"], "low");
    assert_eq!(body["output_config"]["format"]["type"], "json_schema");
    for absent in ["thinking", "tool_choice", "tools", "temperature", "top_p"] {
        assert!(body.get(absent).is_none(), "{absent} must not be sent");
    }
}

#[tokio::test]
async fn rate_limit_is_retryable_and_bad_key_is_not() {
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        serve_one(&listener, 429, r#"{"type":"error","error":{"type":"rate_limit_error"}}"#).await;
        serve_one(&listener, 401, r#"{"type":"error","error":{"type":"authentication_error"}}"#).await;
    });
    let llm = client(port);
    let first = llm.structured(&request()).await.unwrap_err();
    assert_eq!(first, LlmError::RateLimited);
    assert!(first.retryable());
    let second = llm.structured(&request()).await.unwrap_err();
    assert_eq!(second, LlmError::Auth);
    assert!(!second.retryable());
    server.await.unwrap();
}

#[tokio::test]
async fn a_dropped_connection_reads_as_offline() {
    // The listener stays bound (no release-then-reconnect race on the port):
    // the server accepts and hangs up without answering.
    let Some(listener) = listener().await else { return };
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { drop(accept(&listener).await) });
    assert_eq!(client(port).structured(&request()).await.unwrap_err().code(), "offline");
    server.await.unwrap();
}
