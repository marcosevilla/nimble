use serde_json::{json, Value};
#[derive(Debug)]
pub struct CliError {
    pub code: &'static str,
    pub message: String,
}
impl CliError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new("validation", message)
    }
    pub fn not_found() -> Self {
        Self::new("not_found", "The requested record does not exist.")
    }
}
impl From<sqlx::Error> for CliError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::Database(d) if matches!(d.code().as_deref(), Some("5" | "6")) => {
                Self::new(
                    "busy",
                    "Nimble's database is busy. Inspect the result before retrying a write.",
                )
            }
            _ => Self::new(
                "internal",
                "Database operation failed. Inspect the record before retrying a write.",
            ),
        }
    }
}
impl From<nimble_core::Error> for CliError {
    fn from(e: nimble_core::Error) -> Self {
        match e {nimble_core::Error::Database(e)=>e.into(), _=>Self::new("validation","Nimble rejected this operation. Check the record IDs, fields, and relationships before retrying.")}
    }
}
impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        if e.kind() == std::io::ErrorKind::WouldBlock {
            Self::new(
                "busy",
                "Nimble is changing its database. Try again after the update finishes.",
            )
        } else {
            Self::new(
                "unavailable",
                "Cannot safely open the requested Nimble profile or local endpoint.",
            )
        }
    }
}
pub fn success(data: Value, refresh: &str) -> Value {
    let warnings = if matches!(refresh, "unavailable" | "app_not_running") {
        vec!["Change saved locally. Refresh was not acknowledged; do not repeat the mutation."]
    } else {
        vec![]
    };
    json!({"version":1,"ok":true,"data":data,"refresh":refresh,"warnings":warnings})
}
pub fn failure(error: &CliError) -> Value {
    json!({"version":1,"ok":false,"error":{"code":error.code,"message":error.message}})
}
