use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ConfigField, ModuleKind, ModuleManifest};

pub struct DueToday;

impl BriefModule for DueToday {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "due_today",
            name: "Due today",
            kind: ModuleKind::Live,
            requires: vec![],
            default_enabled: true,
            config_schema: vec![ConfigField::Bool { key: "show_completed", label: "Show completed", default: true }],
        }
    }

    /// The morning's open top-level tasks due that day (the box itself is live).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let tasks = super::open_top_level(ctx).await?;
        Ok(json!(tasks
            .iter()
            .filter(|t| t.due_date.as_deref() == Some(ctx.date))
            .map(super::task_ref)
            .collect::<Vec<_>>()))
    }
}
