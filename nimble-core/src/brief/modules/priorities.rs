use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ChoiceOption, ConfigField, Integration, ModuleKind, ModuleManifest};
use crate::types::Priority;

pub struct Priorities;

impl BriefModule for Priorities {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "priorities",
            name: "Top priorities",
            kind: ModuleKind::Ai,
            requires: vec![Integration::Ai],
            default_enabled: true,
            config_schema: vec![ConfigField::Choice {
                key: "count",
                label: "How many",
                options: vec![
                    ChoiceOption { value: json!(1), label: "1" },
                    ChoiceOption { value: json!(2), label: "2" },
                    ChoiceOption { value: json!(3), label: "3" },
                ],
                default: json!(3),
            }],
        }
    }

    /// The day's cached priorities: null until generated
    /// (`db::briefs::set_priorities` patches them in later).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let stored: Option<Option<String>> = sqlx::query_scalar("SELECT top_priorities FROM daily_state WHERE date = ?")
            .bind(ctx.date)
            .fetch_optional(ctx.pool)
            .await?;
        let list: Option<Vec<Priority>> = stored.flatten().and_then(|j| serde_json::from_str(&j).ok());
        Ok(json!(list))
    }
}
