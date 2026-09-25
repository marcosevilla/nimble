//! Quick wins (addendum §5, decision A4): two columns — "I can help" and
//! "Only you" — filled by the daily composition as brief_items (kinds
//! quick_help / quick_self). The module freezes only the labels it used, so a
//! past brief still knows what each column meant that day.

use serde_json::{json, Value};

use crate::brief::compose::quick_labels_from_config;
use crate::brief::{BriefCtx, BriefModule, ConfigField, Integration, ModuleKind, ModuleManifest};

pub struct QuickWins;

impl BriefModule for QuickWins {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "quick_wins",
            name: "Quick wins",
            kind: ModuleKind::Ai,
            // Works without an AI key (label-only picks), so only tasks are required.
            requires: vec![Integration::Tasks],
            default_enabled: true,
            config_schema: vec![
                ConfigField::Label { key: "help_label", label: "I can help", default_name: "needs-claude" },
                ConfigField::Label { key: "self_label", label: "Only you", default_name: "quick" },
            ],
        }
    }

    async fn gather(&self, _ctx: &BriefCtx<'_>, config: &Value) -> crate::Result<Value> {
        let labels = quick_labels_from_config(config);
        Ok(json!({ "help_label": labels.help_label, "self_label": labels.self_label }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::{gather_module, manifests, BriefCtx, ConfigField};
    use crate::test_util::test_pool;
    use serde_json::json;

    #[test]
    fn registered_right_after_priorities_with_two_label_pickers() {
        let ids: Vec<&str> = manifests().iter().map(|m| m.id).collect();
        let at = ids.iter().position(|id| *id == "priorities").unwrap();
        assert_eq!(ids[at + 1], "quick_wins", "{ids:?}");
        let m = QuickWins::manifest();
        assert_eq!((m.name, m.kind, m.default_enabled), ("Quick wins", ModuleKind::Ai, true));
        assert_eq!(m.config_schema, vec![
            ConfigField::Label { key: "help_label", label: "I can help", default_name: "needs-claude" },
            ConfigField::Label { key: "self_label", label: "Only you", default_name: "quick" },
        ]);
    }

    #[tokio::test]
    async fn gather_freezes_the_labels_it_used() {
        let pool = test_pool().await;
        let ctx = BriefCtx { pool: &pool, date: "2026-09-25" };
        let custom = gather_module("quick_wins", &ctx, &json!({"help_label": "claude", "self_label": "errand"})).await.unwrap().unwrap();
        assert_eq!(custom, json!({"help_label": "claude", "self_label": "errand"}));
        let defaults = gather_module("quick_wins", &ctx, &serde_json::Value::Null).await.unwrap().unwrap();
        assert_eq!(defaults, json!({"help_label": "needs-claude", "self_label": "quick"}));
    }
}
