use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use crate::api::weather::{Forecast, WeatherProvider, WeatherView};
use crate::brief::{BriefCtx, BriefModule, ChoiceOption, ConfigField, Integration, ModuleKind, ModuleManifest};
use crate::types::BriefLocation;

/// Renders as the brief's header chip, never as a box (addendum §4).
pub struct Weather;

impl BriefModule for Weather {
    fn manifest() -> ModuleManifest {
        ModuleManifest {
            id: "weather",
            name: "Weather chip",
            kind: ModuleKind::Fixed,
            requires: vec![Integration::Location],
            default_enabled: true,
            config_schema: vec![
                ConfigField::Choice {
                    key: "units",
                    label: "Units",
                    options: vec![
                        ChoiceOption { value: json!("auto"), label: "Auto" },
                        ChoiceOption { value: json!("F"), label: "°F" },
                        ChoiceOption { value: json!("C"), label: "°C" },
                    ],
                    default: json!("auto"),
                },
                ConfigField::Bool { key: "rain_notes", label: "Rain notes", default: true },
            ],
        }
    }

    /// The cached forecast for the brief location, only if it was fetched
    /// on the brief's date. Never the network: an offline first open still
    /// snapshots. Yesterday's fetch also covers today (`forecast_days=2`),
    /// but freezing it would pin a stale forecast: `null` lets the day's
    /// first fresh fetch fill it (`refresh`).
    async fn gather(&self, ctx: &BriefCtx<'_>, _config: &Value) -> crate::Result<Value> {
        let Some(loc) = crate::brief::settings::read_location(ctx.pool).await? else { return Ok(Value::Null) };
        Ok(match crate::api::weather::cached(ctx.pool, &loc).await? {
            Some((forecast, at)) if freezable(&loc, &forecast, &at, ctx.date) => snapshot_payload(&loc, &forecast, &at),
            _ => Value::Null,
        })
    }
}

/// A forecast belongs in `date`'s snapshot only if it covers that day and
/// was fetched on it (in the location's zone).
fn freezable(loc: &BriefLocation, forecast: &Forecast, fetched_at: &str, date: &str) -> bool {
    forecast.days.iter().any(|d| d.date == date)
        && crate::api::weather::fetched_on(fetched_at, &loc.tz).as_deref() == Some(date)
}

/// `snapshot.weather` (TS `WeatherSnapshot`).
pub fn snapshot_payload(loc: &BriefLocation, forecast: &Forecast, fetched_at: &str) -> Value {
    json!({"location": loc, "forecast": forecast, "fetched_at": fetched_at})
}

/// Today's weather for the chip, then freeze it into today's snapshot if
/// that morning's `weather` was recorded empty (first success only).
pub async fn refresh<P: WeatherProvider>(pool: &SqlitePool, provider: &P, today: &str, now: DateTime<Utc>) -> crate::Result<WeatherView> {
    let location = crate::brief::settings::read_location(pool).await?;
    let view = crate::api::weather::load_forecast(pool, provider, location.as_ref(), now).await?;
    if let (Some(loc), Some(forecast), Some(at)) = (&view.location, &view.forecast, &view.fetched_at) {
        if freezable(loc, forecast, at, today) {
            crate::db::briefs::patch_snapshot_if_null(pool, today, "weather", snapshot_payload(loc, forecast, at)).await?;
        }
    }
    Ok(view)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::weather::testing::{at, sf, FakeWeather};
    use crate::api::weather::WeatherStatus;
    use crate::brief::settings::{save_patch, BriefSettingsPatch};
    use crate::test_util::test_pool;

    async fn with_location(pool: &sqlx::SqlitePool) {
        save_patch(pool, BriefSettingsPatch { location: Some(Some(sf())), ..Default::default() }, "2026-09-25 07:00:00").await.unwrap();
    }

    #[tokio::test]
    async fn the_snapshot_freezes_the_cached_forecast_for_that_day_only() {
        let pool = test_pool().await;
        with_location(&pool).await;
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap().unwrap();
        assert!(b.snapshot.get("weather").is_some_and(|w| w.is_null()), "nothing cached yet: frozen as null");
        let v = refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Fresh);
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["forecast"]["days"][0]["high_c"], 21.1);
        assert_eq!(b.snapshot["weather"]["fetched_at"], "2026-09-25T13:30:00Z");
        refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T15:00:00Z")).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["fetched_at"], "2026-09-25T13:30:00Z", "never rewritten once frozen");
    }

    #[tokio::test]
    async fn yesterdays_fetch_is_not_frozen_and_the_first_fresh_fetch_fills_it() {
        use std::sync::atomic::AtomicUsize;
        let pool = test_pool().await;
        with_location(&pool).await;
        let mut two_days = crate::api::weather::parse_forecast(crate::api::weather::testing::FORECAST_FIXTURE).unwrap();
        two_days.days.push(crate::api::weather::WeatherDay { date: "2026-09-26".into(), high_c: 19.0, low_c: 12.0, precip_max: Some(10) });
        let p = FakeWeather { forecast: Some(two_days), calls: AtomicUsize::new(0) };
        // 21:00 UTC = 14:00 on the 25th in San Francisco; the forecast covers the 26th too.
        crate::api::weather::load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T21:00:00Z")).await.unwrap();
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-26", "2026-09-26").await.unwrap().unwrap();
        assert!(b.snapshot["weather"].is_null(), "fetched on the 25th: not the 26th's forecast");
        // 14:00 UTC = 07:00 on the 26th: the cache is 17 h old, so this fetches fresh.
        let v = refresh(&pool, &p, "2026-09-26", at("2026-09-26T14:00:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Fresh);
        let b = crate::db::briefs::get_brief(&pool, "2026-09-26").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["fetched_at"], "2026-09-26T14:00:00Z");
    }

    #[tokio::test]
    async fn a_stale_cache_from_yesterday_is_never_patched_in_offline() {
        let pool = test_pool().await;
        with_location(&pool).await;
        let mut two_days = crate::api::weather::parse_forecast(crate::api::weather::testing::FORECAST_FIXTURE).unwrap();
        two_days.days.push(crate::api::weather::WeatherDay { date: "2026-09-26".into(), high_c: 19.0, low_c: 12.0, precip_max: Some(10) });
        let p = FakeWeather { forecast: Some(two_days), calls: std::sync::atomic::AtomicUsize::new(0) };
        crate::api::weather::load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T21:00:00Z")).await.unwrap();
        crate::db::briefs::ensure_snapshot(&pool, "2026-09-26", "2026-09-26").await.unwrap();
        let v = refresh(&pool, &FakeWeather::offline(), "2026-09-26", at("2026-09-26T14:00:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Stale, "the chip still shows it, marked with its date");
        let b = crate::db::briefs::get_brief(&pool, "2026-09-26").await.unwrap().unwrap();
        assert!(b.snapshot["weather"].is_null(), "but the 26th's snapshot waits for a fetch made that day");
    }

    #[tokio::test]
    async fn a_cached_forecast_without_the_brief_date_is_not_frozen() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::api::weather::load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-27", "2026-09-27").await.unwrap().unwrap();
        assert!(b.snapshot["weather"].is_null(), "the cache holds the 25th only");
    }

    #[tokio::test]
    async fn weather_off_that_morning_is_never_patched_in() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::db::settings::set_setting(&pool, "brief.modules", r#"[{"id":"weather","enabled":false,"config":{}}]"#).await.unwrap();
        crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap();
        refresh(&pool, &FakeWeather::ok(), "2026-09-25", at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().unwrap();
        assert!(b.snapshot.get("weather").is_none());
    }

    #[tokio::test]
    async fn the_snapshot_reads_the_cache_and_never_the_network() {
        let pool = test_pool().await;
        with_location(&pool).await;
        crate::api::weather::load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let b = crate::db::briefs::ensure_snapshot(&pool, "2026-09-25", "2026-09-25").await.unwrap().unwrap();
        assert_eq!(b.snapshot["weather"]["location"]["name"], "San Francisco, California");
    }
}
