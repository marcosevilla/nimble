use serde_json::{json, Value};

use crate::brief::{BriefCtx, BriefModule, ModuleKind, ModuleManifest};

pub struct Habits;

impl BriefModule for Habits {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "habits",
            name: "Before you start",
            kind: ModuleKind::Live,
            requires: vec![],
            default_enabled: false,
            config_schema: vec![],
        }
    }

    /// Active habits and whether each was checked off that day (no counts,
    /// no history: base spec §3.2 #8).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let rows: Vec<(String, String, String, String, bool)> = sqlx::query_as(
            "SELECT h.id, h.name, h.icon, h.color,
                    EXISTS(SELECT 1 FROM habit_logs l WHERE l.habit_id = h.id AND l.date = ?)
             FROM habits h WHERE h.active = 1 ORDER BY h.position, h.created_at",
        )
        .bind(ctx.date)
        .fetch_all(ctx.pool)
        .await?;
        Ok(json!(rows
            .into_iter()
            .map(|(id, name, icon, color, done)| json!({"id": id, "name": name, "icon": icon, "color": color, "done": done}))
            .collect::<Vec<_>>()))
    }
}
