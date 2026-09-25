use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ConfigField, Integration, ModuleKind, ModuleManifest};

const TOMORROW_SHOWN: usize = 2;

pub struct Schedule;

impl BriefModule for Schedule {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "schedule",
            name: "Schedule",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Calendar],
            default_enabled: true,
            config_schema: vec![
                ConfigField::Bool { key: "tomorrow_peek", label: "Tomorrow peek", default: true },
                ConfigField::Bool { key: "free_block", label: "Free block", default: true },
            ],
        }
    }

    /// Cached events only. `tomorrow_peek` / `free_block` are display
    /// options: the payload always carries both, so a past brief can render
    /// whatever its recorded config says.
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let events = crate::api::calendar::read_cached_events(ctx.pool, ctx.date).await.unwrap_or_default();
        let tomorrow_date = (chrono::NaiveDate::parse_from_str(ctx.date, "%Y-%m-%d")
            .map_err(|e| crate::Error::Other(e.to_string()))?
            + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
        let tomorrow: Vec<_> = crate::api::calendar::read_cached_events(ctx.pool, &tomorrow_date)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|e| !e.event.all_day)
            .take(TOMORROW_SHOWN)
            .collect();
        Ok(json!({"events": events, "tomorrow": tomorrow}))
    }
}
