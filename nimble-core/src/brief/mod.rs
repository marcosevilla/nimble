//! Morning-brief module registry (addendum 2026-09-25 §1).
//!
//! Every box on Today is a module: a manifest the UI renders its settings
//! from, plus a `gather` whose payload is frozen into that day's snapshot.
//! `BriefModule` has a static `manifest()` and a native `async fn`, so it is
//! not dyn-compatible (and the crate takes no async-trait dependency): the
//! registry is two static lists that must name the same ids — `manifests()`
//! (default order + metadata) and `gather_module()` (dispatch). Adding a
//! module = one file under `modules/`, one line in each list. The
//! `every_manifest_dispatches…` test catches a half-registered one.

pub mod modules;
pub mod settings;
pub mod candidates;
pub mod prompt;
pub mod validate;
pub mod fallback;
pub mod compose;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKind { Fixed, Live, Ai }

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Integration { Calendar, Tasks, Vault, Ai, Location }

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ChoiceOption {
    pub value: Value,
    pub label: &'static str,
}

/// The closed set of per-module options (addendum §1), serialized with a
/// `type` tag so the frontend renders a control per field.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConfigField {
    Bool { key: &'static str, label: &'static str, default: bool },
    Choice { key: &'static str, label: &'static str, options: Vec<ChoiceOption>, default: Value },
    /// A label picker (phase 3 Quick wins); stored as the label's name.
    Label { key: &'static str, label: &'static str, default_name: &'static str },
}

impl ConfigField {
    pub fn key(&self) -> &'static str {
        match self {
            Self::Bool { key, .. } | Self::Choice { key, .. } | Self::Label { key, .. } => *key,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ModuleManifest {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: ModuleKind,
    pub requires: Vec<Integration>,
    pub default_enabled: bool,
    pub config_schema: Vec<ConfigField>,
}

/// What a module may read while gathering. Later phases may add fields
/// (an LLM client, the clock); modules only ever borrow it.
pub struct BriefCtx<'a> {
    pub pool: &'a SqlitePool,
    pub date: &'a str,
}

#[allow(async_fn_in_trait)]
pub trait BriefModule {
    fn manifest() -> ModuleManifest;
    async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value>;
}

/// One row of `brief.modules`, and of a snapshot's `layout_json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LayoutEntry {
    pub id: String,
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
}

/// Every registered module, in default order.
pub fn manifests() -> Vec<ModuleManifest> {
    use modules::*;
    vec![
        weather::Weather::manifest(),
        schedule::Schedule::manifest(),
        priorities::Priorities::manifest(),
        quick_wins::QuickWins::manifest(),
        due_today::DueToday::manifest(),
        still_open::StillOpen::manifest(),
        habits::Habits::manifest(),
        vault::Vault::manifest(),
        notes::Notes::manifest(),
    ]
}

/// Dispatch one module's gather. `None` = id not registered in this build.
pub async fn gather_module(id: &str, ctx: &BriefCtx<'_>, config: &Value) -> Option<crate::Result<Value>> {
    use modules::*;
    Some(match id {
        "weather" => weather::Weather.gather(ctx, config).await,
        "schedule" => schedule::Schedule.gather(ctx, config).await,
        "priorities" => priorities::Priorities.gather(ctx, config).await,
        "quick_wins" => quick_wins::QuickWins.gather(ctx, config).await,
        "due_today" => due_today::DueToday.gather(ctx, config).await,
        "still_open" => still_open::StillOpen.gather(ctx, config).await,
        "habits" => habits::Habits.gather(ctx, config).await,
        "vault" => vault::Vault.gather(ctx, config).await,
        "notes" => notes::Notes.gather(ctx, config).await,
        _ => return None,
    })
}

/// Every enabled module's payload keyed by id. A module that errors is
/// logged and frozen as null, so one bad source never blocks the day's
/// snapshot; the flag lets the caller mark the row `partial`.
pub async fn gather_snapshot(ctx: &BriefCtx<'_>, layout: &[LayoutEntry]) -> (Value, bool) {
    let mut out = serde_json::Map::new();
    let mut partial = false;
    for entry in layout.iter().filter(|e| e.enabled) {
        let Some(result) = gather_module(&entry.id, ctx, &entry.config).await else { continue };
        let payload = result.unwrap_or_else(|e| {
            log::warn!("brief module {} failed to gather: {e}", entry.id);
            partial = true;
            Value::Null
        });
        out.insert(entry.id.clone(), payload);
    }
    (Value::Object(out), partial)
}

pub(crate) fn config_u64(config: &Value, key: &str, default: u64) -> u64 {
    config.get(key).and_then(Value::as_u64).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::test_pool;

    #[tokio::test]
    async fn every_manifest_dispatches_and_unknown_ids_do_not() {
        let pool = test_pool().await;
        let ctx = BriefCtx { pool: &pool, date: "2026-09-25" };
        for m in manifests() {
            assert!(gather_module(m.id, &ctx, &Value::Null).await.is_some(), "{} has no gather arm", m.id);
        }
        assert!(gather_module("not_a_module", &ctx, &Value::Null).await.is_none());
    }

    #[test]
    fn manifest_ids_and_config_keys_are_unique() {
        let ms = manifests();
        let mut ids: Vec<&str> = ms.iter().map(|m| m.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), ms.len());
        for m in &ms {
            let mut keys: Vec<&str> = m.config_schema.iter().map(ConfigField::key).collect();
            let n = keys.len();
            keys.sort();
            keys.dedup();
            assert_eq!(keys.len(), n, "{} repeats a config key", m.id);
        }
    }

    #[test]
    fn manifests_serialize_for_the_frontend() {
        let v = serde_json::to_value(manifests()).unwrap();
        let still = v.as_array().unwrap().iter().find(|m| m["id"] == "still_open").unwrap();
        assert_eq!(still["kind"], "fixed");
        assert_eq!(still["name"], "Still open");
        assert_eq!(still["config_schema"][0], serde_json::json!({
            "type": "choice", "key": "count", "label": "How many",
            "options": [{"value": 3, "label": "3"}, {"value": 5, "label": "5"}, {"value": 10, "label": "10"}],
            "default": 5
        }));
    }

    #[tokio::test]
    async fn a_failing_module_freezes_as_null_and_flags_partial() {
        let pool = test_pool().await;
        let ctx = BriefCtx { pool: &pool, date: "not-a-date" };
        let (snap, partial) = gather_snapshot(&ctx, &settings::resolve_layout(None)).await;
        assert!(partial);
        assert!(snap["schedule"].is_null(), "schedule can't parse the date");
        assert!(snap.get("due_today").is_some(), "the other modules still gather");
    }
}
