//! Brief settings in the KV store (addendum §2). This task adds the
//! layout: `brief.modules` = ordered `[{id, enabled, config}]`. Unknown ids
//! are skipped, duplicates keep the first, registered modules missing from
//! the list are appended with their defaults, and every config is sanitized
//! against the module's schema. Reading never fails: garbage reads as defaults.

use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::brief::{manifests, ConfigField, LayoutEntry};

pub const KEY_MODULES: &str = "brief.modules";

#[derive(Deserialize)]
struct StoredEntry {
    id: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
    #[serde(default)]
    config: Value,
}

fn enabled_by_default() -> bool {
    true
}

pub fn resolve_layout(stored: Option<&str>) -> Vec<LayoutEntry> {
    let registry = manifests();
    let items: Vec<Value> = stored.and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
    let mut out: Vec<LayoutEntry> = Vec::new();
    for item in items {
        let Ok(entry) = serde_json::from_value::<StoredEntry>(item) else { continue };
        let Some(m) = registry.iter().find(|m| m.id == entry.id) else { continue };
        if out.iter().any(|e| e.id == entry.id) {
            continue;
        }
        out.push(LayoutEntry { config: merge_config(&m.config_schema, &entry.config), id: entry.id, enabled: entry.enabled });
    }
    for m in &registry {
        if !out.iter().any(|e| e.id == m.id) {
            out.push(LayoutEntry {
                id: m.id.to_string(),
                enabled: m.default_enabled,
                config: merge_config(&m.config_schema, &Value::Null),
            });
        }
    }
    out
}

/// Exactly the schema's keys: a stored value when it is valid for the field,
/// else the field's default.
pub fn merge_config(schema: &[ConfigField], stored: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for field in schema {
        let value = match field {
            ConfigField::Bool { key, default, .. } => Value::Bool(stored.get(*key).and_then(Value::as_bool).unwrap_or(*default)),
            ConfigField::Choice { key, options, default, .. } => stored
                .get(*key)
                .filter(|v| options.iter().any(|o| o.value == **v))
                .cloned()
                .unwrap_or_else(|| default.clone()),
            ConfigField::Label { key, default_name, .. } => Value::String(
                stored.get(*key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).unwrap_or(*default_name).to_string(),
            ),
        };
        out.insert(field.key().to_string(), value);
    }
    Value::Object(out)
}

pub async fn load_layout(pool: &SqlitePool) -> crate::Result<Vec<LayoutEntry>> {
    let stored = crate::db::settings::get_setting(pool, KEY_MODULES).await?;
    Ok(resolve_layout(stored.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::ConfigField;
    use serde_json::json;

    fn enabled(l: &[crate::brief::LayoutEntry]) -> Vec<&str> {
        l.iter().filter(|e| e.enabled).map(|e| e.id.as_str()).collect()
    }

    #[test]
    fn defaults_match_the_phase_one_layout() {
        let l = resolve_layout(None);
        assert_eq!(enabled(&l), ["schedule", "priorities", "due_today", "still_open", "vault"]);
        let off: Vec<&str> = l.iter().filter(|e| !e.enabled).map(|e| e.id.as_str()).collect();
        assert_eq!(off, ["habits", "notes"]);
        assert_eq!(l.iter().find(|e| e.id == "still_open").unwrap().config, json!({"count": 5}));
        assert_eq!(l.iter().find(|e| e.id == "schedule").unwrap().config, json!({"tomorrow_peek": true, "free_block": true}));
    }

    #[test]
    fn stored_order_wins_unknown_and_duplicate_ids_drop_missing_modules_append() {
        let l = resolve_layout(Some(
            r#"[{"id":"vault","enabled":false},{"id":"quick_wins","enabled":true},{"id":"schedule"},{"id":"vault","enabled":true}]"#,
        ));
        let ids: Vec<&str> = l.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["vault", "schedule", "priorities", "due_today", "still_open", "habits", "notes"]);
        assert!(!l[0].enabled, "the first vault entry wins");
        assert!(l[1].enabled, "a missing `enabled` reads as on");
    }

    #[test]
    fn config_is_sanitized_against_the_schema() {
        let l = resolve_layout(Some(
            r#"[{"id":"still_open","enabled":true,"config":{"count":7,"extra":1}},
                {"id":"schedule","enabled":true,"config":{"tomorrow_peek":"no","free_block":false}}]"#,
        ));
        assert_eq!(l[0].config, json!({"count": 5}), "7 is not an option; unknown keys drop");
        assert_eq!(l[1].config, json!({"tomorrow_peek": true, "free_block": false}));
    }

    #[test]
    fn label_fields_fall_back_to_their_default_name() {
        let schema = [ConfigField::Label { key: "help_label", label: "Help label", default_name: "needs-claude" }];
        assert_eq!(merge_config(&schema, &json!({"help_label": "  "})), json!({"help_label": "needs-claude"}));
        assert_eq!(merge_config(&schema, &json!({"help_label": " ai "})), json!({"help_label": "ai"}));
    }

    #[test]
    fn garbage_falls_back_to_defaults() {
        for s in ["not json", "{}", r#"[1, null, {"enabled":true}]"#, ""] {
            assert_eq!(resolve_layout(Some(s)), resolve_layout(None), "{s}");
        }
    }
}
