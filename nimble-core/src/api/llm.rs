//! LLM seam for the morning brief (addendum 2026-09-25 §5; base spec §0 Q5/Q6).
//! Every brief AI call goes through `LlmClient`, so a hosted proxy later is one
//! more impl and tests never touch the network (`FakeLlm`).
//!
//! Request shape verified with the claude-api skill for `claude-opus-5-5`
//! (2026-09-25): JSON comes back through structured outputs
//! (`output_config.format` = `{type: "json_schema", schema}`); effort is always
//! explicit (`output_config.effort`; the model default is `medium`); no
//! `thinking` field (thinking can't be disabled on Opus 5.5); no `tool_choice`
//! (forced `any`/`tool` is a 400); no sampling params. `stop_reason` is checked
//! for `refusal` before `content` is read, and content is read by block type
//! because thinking blocks can come first.

use serde::Deserialize;
use serde_json::{json, Value};

pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
pub const DEFAULT_EFFORT: &str = "low";
pub const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
pub const ANTHROPIC_API_BASE: &str = "https://api.anthropic.com/";
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Thinking counts toward `max_tokens` even though its text isn't returned.
pub const MAX_TOKENS: u32 = 16_000;
const CONNECT_TIMEOUT_SECS: u64 = 15;

/// How long one call may take, by effort: deeper thinking takes longer, and a
/// timeout here reads as `timeout` (retryable), never as offline.
pub fn timeout_for(effort: &str) -> std::time::Duration {
    std::time::Duration::from_secs(match effort {
        "high" => 180,
        "xhigh" | "max" => 300,
        _ => 120,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct LlmRequest {
    pub model: String,
    pub effort: String,
    pub system: String,
    pub user: String,
    pub schema: Value,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LlmResponse {
    pub json: Value,
    pub model: String,
    pub usage: Usage,
}

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    /// No API key configured. Built by the caller; a client never sees it.
    NoKey,
    /// Couldn't reach the API (DNS, connect, reset).
    Offline(String),
    /// Reached it, but no answer within `timeout_for(effort)`.
    Timeout,
    RateLimited,
    Server(u16),
    /// 401/403: the key is wrong or revoked.
    Auth,
    /// Any other 4xx, e.g. an unknown model name in `brief.model`.
    BadRequest(String),
    Refusal { category: Option<String>, usage: Usage },
    /// `stop_reason == "max_tokens"`: the JSON is incomplete.
    Truncated { usage: Usage },
    /// 2xx, but no parseable JSON text block.
    InvalidOutput { detail: String, usage: Option<Usage> },
}

impl LlmError {
    /// Stable code stored in `briefs.error_code`. Never carries response text.
    pub fn code(&self) -> &'static str {
        match self {
            LlmError::NoKey => "no_key",
            LlmError::Offline(_) => "offline",
            LlmError::Timeout => "timeout",
            LlmError::RateLimited => "rate_limited",
            LlmError::Server(_) => "server_error",
            LlmError::Auth => "auth",
            LlmError::BadRequest(_) => "bad_request",
            LlmError::Refusal { .. } => "refusal",
            LlmError::Truncated { .. } => "truncated",
            LlmError::InvalidOutput { .. } => "invalid_output",
        }
    }

    /// Worth another attempt later today (the runner allows 3 per day).
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            LlmError::Offline(_) | LlmError::Timeout | LlmError::RateLimited | LlmError::Server(_) | LlmError::Truncated { .. } | LlmError::InvalidOutput { .. }
        )
    }

    /// Tokens the failed call still spent, when the API reported them.
    pub fn usage(&self) -> Option<Usage> {
        match self {
            LlmError::Refusal { usage, .. } | LlmError::Truncated { usage } => Some(*usage),
            LlmError::InvalidOutput { usage, .. } => *usage,
            _ => None,
        }
    }
}

#[allow(async_fn_in_trait)]
pub trait LlmClient {
    /// One user turn, answered as JSON that matches `req.schema`.
    async fn structured(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError>;
}

pub fn normalize_model(value: Option<&str>) -> String {
    match value.map(str::trim) {
        Some(m) if !m.is_empty() => m.to_string(),
        _ => DEFAULT_MODEL.to_string(),
    }
}

pub fn normalize_effort(value: Option<&str>) -> String {
    match value.map(str::trim) {
        Some(e) if EFFORTS.contains(&e) => e.to_string(),
        _ => DEFAULT_EFFORT.to_string(),
    }
}

/// The exact JSON body for `POST /v1/messages`.
pub fn anthropic_body(req: &LlmRequest) -> Value {
    json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": [{ "role": "user", "content": req.user }],
        "output_config": {
            "effort": req.effort,
            "format": { "type": "json_schema", "schema": req.schema },
        },
    })
}

pub fn classify_status(status: u16, body: &str) -> LlmError {
    match status {
        401 | 403 => LlmError::Auth,
        408 => LlmError::Offline(format!("HTTP {status}")),
        429 => LlmError::RateLimited,
        s if s >= 500 => LlmError::Server(s),
        s => LlmError::BadRequest(format!("HTTP {s}: {}", body.chars().take(200).collect::<String>())),
    }
}

#[derive(Deserialize)]
struct WireResponse {
    #[serde(default)]
    model: String,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    stop_details: Option<WireStopDetails>,
    #[serde(default)]
    content: Vec<WireBlock>,
    #[serde(default)]
    usage: WireUsage,
}

#[derive(Deserialize)]
struct WireStopDetails {
    #[serde(default)]
    category: Option<String>,
}

#[derive(Deserialize)]
struct WireBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct WireUsage {
    #[serde(default)]
    input_tokens: i64,
    #[serde(default)]
    output_tokens: i64,
}

/// Parse a 2xx body. Refusal and truncation are decided before content is read.
pub fn parse_anthropic_response(body: &str) -> Result<LlmResponse, LlmError> {
    let wire: WireResponse = serde_json::from_str(body)
        .map_err(|e| LlmError::InvalidOutput { detail: format!("unreadable response: {e}"), usage: None })?;
    let usage = Usage { input_tokens: wire.usage.input_tokens, output_tokens: wire.usage.output_tokens };
    match wire.stop_reason.as_deref() {
        Some("refusal") => {
            return Err(LlmError::Refusal { category: wire.stop_details.and_then(|d| d.category), usage });
        }
        Some("max_tokens") => return Err(LlmError::Truncated { usage }),
        _ => {}
    }
    let text = wire
        .content
        .iter()
        .find(|b| b.kind == "text")
        .and_then(|b| b.text.as_deref())
        .ok_or_else(|| LlmError::InvalidOutput { detail: "no text block".into(), usage: Some(usage) })?;
    let json = serde_json::from_str(text)
        .map_err(|e| LlmError::InvalidOutput { detail: format!("text is not JSON: {e}"), usage: Some(usage) })?;
    Ok(LlmResponse { json, model: wire.model, usage })
}

#[derive(Clone)]
pub struct AnthropicLlm {
    client: reqwest::Client,
    url: reqwest::Url,
    key: String,
}

impl AnthropicLlm {
    pub fn new(key: String) -> crate::Result<Self> {
        // No redirects: the key must only ever go to the configured host.
        // The per-call timeout is set from the effort (`timeout_for`).
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| crate::Error::Api(format!("Anthropic client: {e}")))?;
        Self::with_base(client, ANTHROPIC_API_BASE, key)
    }

    /// `base` must be https, or loopback for tests.
    pub fn with_base(client: reqwest::Client, base: &str, key: String) -> crate::Result<Self> {
        let base = reqwest::Url::parse(base).map_err(|e| crate::Error::Other(format!("invalid: llm base url {e}")))?;
        if base.scheme() != "https" && !matches!(base.host_str(), Some("127.0.0.1" | "localhost")) {
            return Err(crate::Error::Other("invalid: llm base url must be https".into()));
        }
        let url = base.join("v1/messages").map_err(|e| crate::Error::Other(format!("invalid: llm url {e}")))?;
        Ok(Self { client, url, key })
    }
}

impl LlmClient for AnthropicLlm {
    async fn structured(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError> {
        // Sensitive: never printed by reqwest's Debug output or logs.
        let mut key = reqwest::header::HeaderValue::from_str(&self.key)
            .map_err(|_| LlmError::Auth)?;
        key.set_sensitive(true);
        let response = self
            .client
            .post(self.url.clone())
            .timeout(timeout_for(&req.effort))
            .header("x-api-key", key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&anthropic_body(req))
            .send()
            .await
            .map_err(transport_error)?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(transport_error)?;
        if !(200..300).contains(&status) {
            return Err(classify_status(status, &body));
        }
        parse_anthropic_response(&body)
    }
}

fn transport_error(e: reqwest::Error) -> LlmError {
    if e.is_timeout() { LlmError::Timeout } else { LlmError::Offline(e.to_string()) }
}

/// Scripted client for tests: replies in order, then `Offline` once exhausted.
#[cfg(any(test, feature = "test-util"))]
pub struct FakeLlm {
    replies: std::sync::Mutex<std::collections::VecDeque<Result<LlmResponse, LlmError>>>,
    seen: std::sync::Mutex<Vec<LlmRequest>>,
}

#[cfg(any(test, feature = "test-util"))]
impl FakeLlm {
    pub fn new(replies: Vec<Result<LlmResponse, LlmError>>) -> Self {
        Self { replies: std::sync::Mutex::new(replies.into()), seen: std::sync::Mutex::new(Vec::new()) }
    }
    pub fn json(value: Value) -> Self {
        Self::new(vec![Ok(LlmResponse {
            json: value,
            model: DEFAULT_MODEL.into(),
            usage: Usage { input_tokens: 9_000, output_tokens: 600 },
        })])
    }
    pub fn failing(error: LlmError) -> Self {
        Self::new(vec![Err(error)])
    }
    pub fn calls(&self) -> usize {
        self.seen.lock().unwrap().len()
    }
    pub fn last_request(&self) -> Option<LlmRequest> {
        self.seen.lock().unwrap().last().cloned()
    }
}

#[cfg(any(test, feature = "test-util"))]
impl LlmClient for FakeLlm {
    async fn structured(&self, req: &LlmRequest) -> Result<LlmResponse, LlmError> {
        self.seen.lock().unwrap().push(req.clone());
        self.replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Err(LlmError::Offline("fake: no scripted reply".into())))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn req() -> LlmRequest {
        LlmRequest {
            model: DEFAULT_MODEL.into(),
            effort: "low".into(),
            system: "sys".into(),
            user: "hello".into(),
            schema: json!({"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}),
            max_tokens: MAX_TOKENS,
        }
    }

    #[test]
    fn body_uses_structured_outputs_and_explicit_effort_only() {
        let b = anthropic_body(&req());
        assert_eq!(b["model"], "claude-opus-5-5");
        assert_eq!(b["max_tokens"], 16000);
        assert_eq!(b["system"], "sys");
        assert_eq!(b["messages"], json!([{"role":"user","content":"hello"}]));
        assert_eq!(b["output_config"]["effort"], "low");
        assert_eq!(b["output_config"]["format"]["type"], "json_schema");
        assert_eq!(b["output_config"]["format"]["schema"]["required"], json!(["summary"]));
        for absent in ["thinking", "tool_choice", "tools", "temperature", "top_p"] {
            assert!(b.get(absent).is_none(), "{absent} must never be sent to claude-opus-5-5");
        }
    }

    #[test]
    fn settings_normalize_to_safe_defaults() {
        assert_eq!(normalize_model(None), "claude-opus-5-5");
        assert_eq!(normalize_model(Some("  ")), "claude-opus-5-5");
        assert_eq!(normalize_model(Some(" claude-sonnet-5 ")), "claude-sonnet-5");
        assert_eq!(normalize_effort(None), "low");
        assert_eq!(normalize_effort(Some("turbo")), "low");
        assert_eq!(normalize_effort(Some("xhigh")), "xhigh");
    }

    #[test]
    fn text_is_read_by_type_after_thinking_blocks() {
        let body = r#"{"model":"claude-opus-5-5","stop_reason":"end_turn","content":[
            {"type":"thinking","thinking":"","signature":"s"},
            {"type":"text","text":"{\"summary\":\"A calm day.\"}"}],
            "usage":{"input_tokens":900,"output_tokens":40,"cache_read_input_tokens":0}}"#;
        let r = parse_anthropic_response(body).unwrap();
        assert_eq!(r.json["summary"], "A calm day.");
        assert_eq!(r.model, "claude-opus-5-5");
        assert_eq!(r.usage, Usage { input_tokens: 900, output_tokens: 40 });
    }

    #[test]
    fn refusal_is_checked_before_content() {
        let body = r#"{"model":"claude-opus-5-5","stop_reason":"refusal","stop_details":{"type":"refusal","category":"bio","explanation":"x"},
            "content":[{"type":"text","text":"{\"summary\":\"ok\"}"}],"usage":{"input_tokens":10,"output_tokens":0}}"#;
        let e = parse_anthropic_response(body).unwrap_err();
        assert_eq!(e, LlmError::Refusal { category: Some("bio".into()), usage: Usage { input_tokens: 10, output_tokens: 0 } });
        assert_eq!(e.code(), "refusal");
        assert!(!e.retryable());
    }

    #[test]
    fn truncated_and_unreadable_output_are_retryable_and_keep_usage() {
        let cut = r#"{"stop_reason":"max_tokens","content":[{"type":"text","text":"{\"summ"}],"usage":{"input_tokens":5,"output_tokens":16000}}"#;
        let e = parse_anthropic_response(cut).unwrap_err();
        assert_eq!(e.code(), "truncated");
        assert!(e.retryable());
        assert_eq!(e.usage(), Some(Usage { input_tokens: 5, output_tokens: 16000 }));
        let prose = r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"Sure! Here you go"}],"usage":{"input_tokens":5,"output_tokens":3}}"#;
        assert_eq!(parse_anthropic_response(prose).unwrap_err().code(), "invalid_output");
        let empty = r#"{"stop_reason":"end_turn","content":[],"usage":{"input_tokens":5,"output_tokens":0}}"#;
        assert_eq!(parse_anthropic_response(empty).unwrap_err().code(), "invalid_output");
    }

    #[test]
    fn http_status_classification() {
        assert_eq!(classify_status(401, ""), LlmError::Auth);
        assert_eq!(classify_status(403, ""), LlmError::Auth);
        assert_eq!(classify_status(429, ""), LlmError::RateLimited);
        assert_eq!(classify_status(529, ""), LlmError::Server(529));
        assert_eq!(classify_status(500, ""), LlmError::Server(500));
        assert!(matches!(classify_status(400, "bad model"), LlmError::BadRequest(ref s) if s.contains("400")));
        assert!(!LlmError::Auth.retryable() && !LlmError::NoKey.retryable() && !LlmError::BadRequest("x".into()).retryable());
        assert!(LlmError::RateLimited.retryable() && LlmError::Server(503).retryable() && LlmError::Offline("dns".into()).retryable());
        assert_eq!(LlmError::NoKey.code(), "no_key");
        assert_eq!(LlmError::Offline("x".into()).code(), "offline");
    }

    #[test]
    fn timeouts_scale_with_effort_and_are_retryable() {
        assert_eq!(timeout_for("low").as_secs(), 120);
        assert_eq!(timeout_for("medium").as_secs(), 120);
        assert_eq!(timeout_for("high").as_secs(), 180);
        assert_eq!(timeout_for("xhigh").as_secs(), 300);
        assert_eq!(timeout_for("max").as_secs(), 300);
        assert_eq!(LlmError::Timeout.code(), "timeout");
        assert!(LlmError::Timeout.retryable());
    }

    #[test]
    fn plain_http_is_only_allowed_on_loopback() {
        assert!(AnthropicLlm::with_base(reqwest::Client::new(), "http://api.anthropic.com/", "k".into()).is_err());
        assert!(AnthropicLlm::with_base(reqwest::Client::new(), "http://127.0.0.1:9/", "k".into()).is_ok());
        assert!(AnthropicLlm::new("k".into()).is_ok());
    }

    #[tokio::test]
    async fn fake_replays_scripted_replies_and_records_requests() {
        let fake = FakeLlm::new(vec![Err(LlmError::Offline("x".into())), Ok(LlmResponse { json: json!({"a":1}), model: "m".into(), usage: Usage::default() })]);
        assert_eq!(fake.structured(&req()).await.unwrap_err().code(), "offline");
        assert_eq!(fake.structured(&req()).await.unwrap().json["a"], 1);
        assert_eq!(fake.structured(&req()).await.unwrap_err().code(), "offline"); // script exhausted
        assert_eq!(fake.calls(), 3);
        assert_eq!(fake.last_request().unwrap().effort, "low");
    }
}
