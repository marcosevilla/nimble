//! Brief settings in the KV store (addendum §2). This task adds the
//! layout: `brief.modules` = ordered `[{id, enabled, config}]`. Unknown ids
//! are skipped, duplicates keep the first, registered modules missing from
//! the list are appended with their defaults, and every config is sanitized
//! against the module's schema. Reading never fails: garbage reads as defaults.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

use crate::brief::{manifests, ConfigField, LayoutEntry, ModuleManifest};
use crate::types::BriefLocation;

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

pub const KEY_TIME: &str = "brief.time";
pub const KEY_LOCATION: &str = "brief.location";
pub const KEY_MODEL: &str = "brief.model";
pub const KEY_EFFORT: &str = "brief.effort";
pub const KEY_SETUP_COMPLETED_AT: &str = "today.setup_completed_at";
/// `goals.*` meaning belongs to Lane C (momentum); the Today setup writes them.
pub const KEY_GOALS_DAILY: &str = "goals.daily";
pub const KEY_GOALS_WEEKLY: &str = "goals.weekly";
pub const KEY_GOALS_DAYS_OFF: &str = "goals.days_off";

pub const DEFAULT_TIME: &str = "06:30";
/// Verified against the claude-api skill 2026-09-25. Haiku 4.5 is left out:
/// it rejects `output_config.effort`.
pub const MODELS: [&str; 2] = ["claude-opus-5-5", "claude-sonnet-5"];
pub const EFFORTS: [&str; 3] = ["low", "medium", "high"];
pub const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DEFAULT_DAYS_OFF: [&str; 2] = ["sat", "sun"];
/// Same bounds as Lane C's `karma::save_goals` (it owns what goals mean).
const DAILY_RANGE: std::ops::RangeInclusive<i64> = 1..=100;
const WEEKLY_RANGE: std::ops::RangeInclusive<i64> = 1..=700;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GoalSettings {
    pub daily: i64,
    pub weekly: i64,
    pub days_off: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct BriefSources {
    pub calendar: bool,
    pub tasks: bool,
    pub vault: bool,
    pub ai: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct BriefSettingsView {
    pub time: String,
    pub location: Option<BriefLocation>,
    pub modules: Vec<LayoutEntry>,
    pub model: String,
    pub effort: String,
    pub setup_completed_at: Option<String>,
    pub goals: GoalSettings,
    pub sources: BriefSources,
    pub manifests: Vec<ModuleManifest>,
}

#[derive(Deserialize, Default, Debug)]
pub struct GoalsPatch {
    pub daily: Option<i64>,
    pub weekly: Option<i64>,
    pub days_off: Option<Vec<String>>,
}

/// Every field optional; `location: null` clears, an absent key keeps.
#[derive(Deserialize, Default, Debug)]
pub struct BriefSettingsPatch {
    pub time: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub location: Option<Option<BriefLocation>>,
    pub modules: Option<Vec<LayoutEntry>>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub goals: Option<GoalsPatch>,
    #[serde(default)]
    pub complete_setup: bool,
}

/// A present key (even `null`) deserializes to `Some(_)`.
fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

fn invalid(key: &str) -> crate::Error {
    crate::Error::Other(format!("invalid_setting: {key}"))
}

fn valid_time(t: &str) -> bool {
    t.len() == 5 && chrono::NaiveTime::parse_from_str(t, "%H:%M").is_ok()
}

fn validate_location(l: &BriefLocation) -> crate::Result<()> {
    let name = l.name.trim();
    if name.is_empty() || name.chars().count() > 200 { return Err(invalid(KEY_LOCATION)); }
    if !l.lat.is_finite() || !(-90.0..=90.0).contains(&l.lat) { return Err(invalid(KEY_LOCATION)); }
    if !l.lon.is_finite() || !(-180.0..=180.0).contains(&l.lon) { return Err(invalid(KEY_LOCATION)); }
    if l.tz.parse::<chrono_tz::Tz>().is_err() { return Err(invalid(KEY_LOCATION)); }
    Ok(())
}

/// Known weekdays in week order. All seven off is refused (one rule with
/// `karma::save_goals` and the forms: at least one day is a goal day).
fn normalize_days(days: &[String]) -> crate::Result<Vec<String>> {
    if days.iter().any(|d| !WEEKDAYS.contains(&d.as_str())) { return Err(invalid(KEY_GOALS_DAYS_OFF)); }
    let days: Vec<String> = WEEKDAYS.iter().filter(|w| days.iter().any(|d| d.as_str() == **w)).map(|w| w.to_string()).collect();
    if days.len() == WEEKDAYS.len() { return Err(invalid(KEY_GOALS_DAYS_OFF)); }
    Ok(days)
}

pub async fn read_location(pool: &SqlitePool) -> crate::Result<Option<BriefLocation>> {
    let stored = crate::db::settings::get_setting(pool, KEY_LOCATION).await?;
    Ok(stored
        .and_then(|s| serde_json::from_str::<BriefLocation>(&s).ok())
        .filter(|l| validate_location(l).is_ok()))
}

/// Every brief setting with defaults filled in. Never fails on bad stored
/// values: each field falls back on its own.
pub async fn load_view(pool: &SqlitePool) -> crate::Result<BriefSettingsView> {
    let all: HashMap<String, String> = crate::db::settings::get_all_settings(pool)
        .await?
        .into_iter()
        .map(|r| (r.key, r.value))
        .collect();
    let get = |k: &str| all.get(k).map(String::as_str).filter(|v| !v.trim().is_empty());
    let feeds: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM calendar_feeds WHERE enabled = 1").fetch_one(pool).await?;
    Ok(BriefSettingsView {
        time: get(KEY_TIME).filter(|t| valid_time(t)).unwrap_or(DEFAULT_TIME).to_string(),
        location: get(KEY_LOCATION)
            .and_then(|s| serde_json::from_str::<BriefLocation>(s).ok())
            .filter(|l| validate_location(l).is_ok()),
        modules: resolve_layout(get(KEY_MODULES)),
        model: get(KEY_MODEL).filter(|m| MODELS.contains(m)).unwrap_or(MODELS[0]).to_string(),
        effort: get(KEY_EFFORT).filter(|e| EFFORTS.contains(e)).unwrap_or(EFFORTS[0]).to_string(),
        setup_completed_at: get(KEY_SETUP_COMPLETED_AT).map(str::to_string),
        goals: GoalSettings {
            daily: get(KEY_GOALS_DAILY).and_then(|v| v.parse().ok()).filter(|n| DAILY_RANGE.contains(n)).unwrap_or(5),
            weekly: get(KEY_GOALS_WEEKLY).and_then(|v| v.parse().ok()).filter(|n| WEEKLY_RANGE.contains(n)).unwrap_or(25),
            days_off: get(KEY_GOALS_DAYS_OFF)
                .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
                .and_then(|d| normalize_days(&d).ok())
                .unwrap_or_else(|| DEFAULT_DAYS_OFF.iter().map(|d| d.to_string()).collect()),
        },
        sources: BriefSources {
            calendar: feeds > 0 || get("ical_feed_url").is_some(),
            tasks: get("todoist_api_token").is_some(),
            vault: get("obsidian_vault_path").is_some(),
            ai: get("anthropic_api_key").is_some(),
        },
        manifests: manifests(),
    })
}

/// Validate every field first, then write all of them in one transaction:
/// a patch lands whole or not at all (setup's Finish is one save).
pub async fn save_patch(pool: &SqlitePool, patch: BriefSettingsPatch, now: &str) -> crate::Result<BriefSettingsView> {
    let mut writes: Vec<(&'static str, String)> = Vec::new();
    if let Some(t) = patch.time {
        let t = t.trim();
        if !valid_time(t) { return Err(invalid(KEY_TIME)); }
        writes.push((KEY_TIME, t.to_string()));
    }
    if let Some(location) = patch.location {
        match location {
            Some(mut l) => {
                validate_location(&l)?;
                l.name = l.name.trim().to_string();
                writes.push((KEY_LOCATION, serde_json::to_string(&l).map_err(|e| crate::Error::Parse(e.to_string()))?));
            }
            None => writes.push((KEY_LOCATION, String::new())),
        }
    }
    if let Some(modules) = patch.modules {
        let mut seen = HashSet::new();
        if !modules.iter().all(|m| seen.insert(m.id.clone())) { return Err(invalid(KEY_MODULES)); }
        let raw = serde_json::to_string(&modules).map_err(|e| crate::Error::Parse(e.to_string()))?;
        let resolved = resolve_layout(Some(&raw));
        writes.push((KEY_MODULES, serde_json::to_string(&resolved).map_err(|e| crate::Error::Parse(e.to_string()))?));
    }
    if let Some(m) = patch.model {
        if !MODELS.contains(&m.as_str()) { return Err(invalid(KEY_MODEL)); }
        writes.push((KEY_MODEL, m));
    }
    if let Some(e) = patch.effort {
        if !EFFORTS.contains(&e.as_str()) { return Err(invalid(KEY_EFFORT)); }
        writes.push((KEY_EFFORT, e));
    }
    if let Some(g) = patch.goals {
        if let Some(d) = g.daily {
            if !DAILY_RANGE.contains(&d) { return Err(invalid(KEY_GOALS_DAILY)); }
            writes.push((KEY_GOALS_DAILY, d.to_string()));
        }
        if let Some(w) = g.weekly {
            if !WEEKLY_RANGE.contains(&w) { return Err(invalid(KEY_GOALS_WEEKLY)); }
            writes.push((KEY_GOALS_WEEKLY, w.to_string()));
        }
        if let Some(days) = g.days_off {
            let days = normalize_days(&days)?;
            writes.push((KEY_GOALS_DAYS_OFF, serde_json::to_string(&days).map_err(|e| crate::Error::Parse(e.to_string()))?));
        }
    }
    if patch.complete_setup {
        writes.push((KEY_SETUP_COMPLETED_AT, now.to_string()));
    }
    let mut tx = pool.begin().await?;
    for (key, value) in &writes {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        )
        .bind(key)
        .bind(value)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    load_view(pool).await
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
        assert_eq!(enabled(&l), ["weather", "schedule", "priorities", "quick_wins", "due_today", "still_open", "vault", "momentum"]);
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
        assert_eq!(ids, ["vault", "quick_wins", "schedule", "weather", "priorities", "due_today", "still_open", "habits", "notes", "momentum"]);
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

    use crate::brief::LayoutEntry;
    use crate::test_util::test_pool;
    use crate::types::BriefLocation;

    const NOW: &str = "2026-09-25 07:00:00";

    fn sf() -> BriefLocation {
        BriefLocation { name: "San Francisco, California".into(), lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles".into() }
    }

    #[tokio::test]
    async fn an_empty_profile_reads_every_default() {
        let pool = test_pool().await;
        let v = load_view(&pool).await.unwrap();
        assert_eq!((v.time.as_str(), v.model.as_str(), v.effort.as_str()), ("06:30", "claude-opus-5-5", "low"));
        assert!(v.location.is_none());
        assert!(v.setup_completed_at.is_none());
        assert_eq!(v.goals, GoalSettings { daily: 5, weekly: 25, days_off: vec!["sat".into(), "sun".into()] });
        assert_eq!(v.sources, BriefSources::default());
        assert_eq!(v.modules, resolve_layout(None));
        assert_eq!(v.manifests.len(), crate::brief::manifests().len());
    }

    #[tokio::test]
    async fn corrupt_values_read_as_defaults() {
        let pool = test_pool().await;
        for (k, val) in [
            ("brief.time", "25:99"), ("brief.location", r#"{"name":"X"}"#), ("brief.model", "gpt-5"),
            ("brief.effort", "max"), ("goals.daily", "0"), ("goals.weekly", "lots"),
            ("goals.days_off", r#""sat""#), ("brief.modules", "{"),
        ] {
            crate::db::settings::set_setting(&pool, k, val).await.unwrap();
        }
        let v = load_view(&pool).await.unwrap();
        assert_eq!((v.time.as_str(), v.model.as_str(), v.effort.as_str()), ("06:30", "claude-opus-5-5", "low"));
        assert!(v.location.is_none());
        assert_eq!((v.goals.daily, v.goals.weekly), (5, 25));
        assert_eq!(v.goals.days_off, ["sat", "sun"]);
        assert_eq!(v.modules, resolve_layout(None));
    }

    #[tokio::test]
    async fn one_save_writes_every_key_and_marks_setup_complete() {
        let pool = test_pool().await;
        let mut modules = resolve_layout(None);
        modules.swap(0, 1);
        let patch = BriefSettingsPatch {
            time: Some("07:15".into()),
            location: Some(Some(sf())),
            modules: Some(modules.clone()),
            model: Some("claude-sonnet-5".into()),
            effort: Some("medium".into()),
            goals: Some(GoalsPatch { daily: Some(3), weekly: Some(15), days_off: Some(vec!["sun".into(), "sat".into(), "sun".into()]) }),
            complete_setup: true,
        };
        let v = save_patch(&pool, patch, NOW).await.unwrap();
        assert_eq!(v.time, "07:15");
        assert_eq!(v.location, Some(sf()));
        assert_eq!(v.modules, modules);
        assert_eq!((v.model.as_str(), v.effort.as_str()), ("claude-sonnet-5", "medium"));
        assert_eq!(v.goals, GoalSettings { daily: 3, weekly: 15, days_off: vec!["sat".into(), "sun".into()] });
        assert_eq!(v.setup_completed_at.as_deref(), Some(NOW));
        for key in ["brief.time", "brief.location", "brief.modules", "brief.model", "brief.effort",
                    "goals.daily", "goals.weekly", "goals.days_off", "today.setup_completed_at"] {
            assert!(crate::db::settings::get_setting(&pool, key).await.unwrap().is_some(), "{key} stored under the addendum's name");
        }
    }

    #[tokio::test]
    async fn an_invalid_field_rejects_the_whole_patch() {
        let pool = test_pool().await;
        let mixed = BriefSettingsPatch { time: Some("7am".into()), effort: Some("high".into()), ..Default::default() };
        assert!(save_patch(&pool, mixed, NOW).await.is_err());
        assert_eq!(load_view(&pool).await.unwrap().effort, "low", "nothing was written");
        let dup = LayoutEntry { id: "schedule".into(), enabled: true, config: serde_json::json!({}) };
        for bad in [
            BriefSettingsPatch { model: Some("claude-3".into()), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { tz: "Mars/Olympus".into(), ..sf() })), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { lat: 91.0, ..sf() })), ..Default::default() },
            BriefSettingsPatch { location: Some(Some(BriefLocation { name: "  ".into(), ..sf() })), ..Default::default() },
            BriefSettingsPatch { goals: Some(GoalsPatch { days_off: Some(vec!["someday".into()]), ..Default::default() }), ..Default::default() },
            BriefSettingsPatch { goals: Some(GoalsPatch { days_off: Some(WEEKDAYS.map(String::from).to_vec()), ..Default::default() }), ..Default::default() },
            BriefSettingsPatch { goals: Some(GoalsPatch { daily: Some(0), ..Default::default() }), ..Default::default() },
            BriefSettingsPatch { modules: Some(vec![dup.clone(), dup.clone()]), ..Default::default() },
        ] {
            assert!(save_patch(&pool, bad, NOW).await.is_err());
        }
    }

    #[tokio::test]
    async fn a_null_location_clears_it_and_a_missing_one_keeps_it() {
        let pool = test_pool().await;
        save_patch(&pool, BriefSettingsPatch { location: Some(Some(sf())), ..Default::default() }, NOW).await.unwrap();
        let kept = save_patch(&pool, BriefSettingsPatch { time: Some("08:00".into()), ..Default::default() }, NOW).await.unwrap();
        assert_eq!(kept.location, Some(sf()));
        assert_eq!(read_location(&pool).await.unwrap(), Some(sf()));
        let clear: BriefSettingsPatch = serde_json::from_str(r#"{"location":null}"#).unwrap();
        assert!(save_patch(&pool, clear, NOW).await.unwrap().location.is_none());
        assert!(read_location(&pool).await.unwrap().is_none());
        let empty: BriefSettingsPatch = serde_json::from_str("{}").unwrap();
        assert!(empty.location.is_none() && !empty.complete_setup);
    }

    #[tokio::test]
    async fn sources_reflect_what_is_connected() {
        let pool = test_pool().await;
        crate::db::settings::set_setting(&pool, "anthropic_api_key", "k").await.unwrap();
        crate::db::settings::set_setting(&pool, "obsidian_vault_path", "  ").await.unwrap();
        sqlx::query("INSERT INTO calendar_feeds (id, label, url) VALUES ('f1', 'Home', 'https://example.com/a.ics')")
            .execute(&pool).await.unwrap();
        let s = load_view(&pool).await.unwrap().sources;
        assert_eq!(s, BriefSources { calendar: true, tasks: false, vault: false, ai: true });
    }
}
