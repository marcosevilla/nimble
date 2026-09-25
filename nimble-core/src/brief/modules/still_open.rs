use serde_json::{json, Value};

use crate::brief::{config_u64, BriefCtx, BriefModule, ChoiceOption, ConfigField, ModuleKind, ModuleManifest};

pub struct StillOpen;

impl BriefModule for StillOpen {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "still_open",
            name: "Still open",
            kind: ModuleKind::Fixed,
            requires: vec![],
            default_enabled: true,
            config_schema: vec![ConfigField::Choice {
                key: "count",
                label: "How many",
                options: vec![
                    ChoiceOption { value: json!(3), label: "3" },
                    ChoiceOption { value: json!(5), label: "5" },
                    ChoiceOption { value: json!(10), label: "10" },
                ],
                default: json!(5),
            }],
        }
    }

    /// The `count` oldest open top-level tasks due before the day, plus the total.
    async fn gather(&self, ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value> {
        let count = config_u64(config, "count", 5) as usize;
        let mut still: Vec<_> = super::open_top_level(ctx)
            .await?
            .into_iter()
            .filter(|t| t.due_date.as_deref().is_some_and(|d| d < ctx.date))
            .collect();
        still.sort_by(|a, b| a.due_date.cmp(&b.due_date));
        Ok(json!({
            "total": still.len(),
            "oldest": still.iter().take(count).map(super::task_ref).collect::<Vec<_>>(),
        }))
    }
}
