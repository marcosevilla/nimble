use serde_json::Value;

use crate::brief::{BriefCtx, BriefModule, Integration, ModuleKind, ModuleManifest};

pub struct Vault;

impl BriefModule for Vault {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "vault",
            name: "From your vault",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Vault],
            default_enabled: true,
            config_schema: vec![],
        }
    }

    /// The legacy markdown brief is read from the vault by date at render
    /// time (and the box hides when there's no file), so nothing is frozen.
    async fn gather(&self, _ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        Ok(Value::Null)
    }
}
