use serde_json::Value;

use crate::brief::{BriefCtx, BriefModule, ModuleKind, ModuleManifest};

pub struct Notes;

impl BriefModule for Notes {
    fn manifest() -> ModuleManifest {
        ModuleManifest { id: "notes", name: "Notes", kind: ModuleKind::Live, requires: vec![], default_enabled: false, config_schema: vec![] }
    }

    /// Notes live in `briefs.notes`, not the snapshot.
    async fn gather(&self, _ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        Ok(Value::Null)
    }
}
