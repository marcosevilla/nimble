//! Momentum box (addendum 2026-09-25 §6, Lane C). Live on Today; the
//! snapshot keeps the morning's numbers so past briefs and the web render
//! them. Read-only: goal bonuses are persisted by the app's
//! `momentum_summary` reads, never by the brief.

use serde_json::Value;

use crate::brief::{BriefCtx, BriefModule, ModuleKind, ModuleManifest};

pub struct Momentum;

impl BriefModule for Momentum {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "momentum",
            name: "Momentum",
            kind: ModuleKind::Live,
            requires: vec![],
            default_enabled: true,
            // Goals, days off, Pause and karma live in Settings → Goals & momentum.
            config_schema: vec![],
        }
    }

    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let today = chrono::NaiveDate::parse_from_str(ctx.date, "%Y-%m-%d")
            .map_err(|e| crate::Error::Other(format!("momentum: brief date {}: {e}", ctx.date)))?;
        let summary = crate::db::karma::read_summary_at(ctx.pool, "7d", today).await?;
        serde_json::to_value(summary).map_err(|e| crate::Error::Other(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::brief::BriefCtx;

    #[test]
    fn momentum_is_on_by_default_with_no_box_options() {
        let m = Momentum::manifest();
        assert_eq!(m.id, "momentum");
        assert_eq!(m.name, "Momentum");
        assert!(m.default_enabled, "A5: Momentum box on by default");
        assert!(m.config_schema.is_empty(), "goals live in Settings → Goals & momentum");
        assert!(m.requires.is_empty());
    }

    #[tokio::test]
    async fn gather_snapshots_the_read_only_summary() {
        let pool = crate::test_util::test_pool().await;
        for i in 0..5 {
            crate::db::karma::record_tx(&mut *pool.acquire().await.unwrap(),
                &crate::db::karma::completion_event(&format!("t{i}"), 1, &format!("2026-09-23 1{i}:00:00")).unwrap()).await.unwrap();
        }
        let ctx = BriefCtx { pool: &pool, date: "2026-09-23" };
        let v = Momentum.gather(&ctx, &serde_json::json!({})).await.unwrap();
        assert_eq!(v["week_start"], "2026-09-21");
        assert_eq!(v["week_done"], 5);
        assert!(v["karma"].is_null());
        let goals: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM karma_events WHERE kind LIKE 'goal_%'").fetch_one(&pool).await.unwrap();
        assert_eq!(goals, 0, "gather never writes the ledger, even with a goal met");
    }
}
