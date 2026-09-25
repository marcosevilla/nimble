//! Open-Meteo weather + geocoding behind `WeatherProvider` (addendum §4).
//! Temperatures are always fetched in °C; the frontend converts for display,
//! so a units change never invalidates the cache and snapshots stay
//! unit-free. Unit tests parse fixtures and use `testing::FakeWeather`; no
//! test reaches the network.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::types::BriefLocation;

pub const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
pub const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
pub const CACHE_MODULE: &str = "weather";
pub const FRESH_MINUTES: i64 = 60;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WeatherDay {
    pub date: String,
    pub high_c: f64,
    pub low_c: f64,
    pub precip_max: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WeatherHour {
    /// Location-local "YYYY-MM-DDTHH:MM" (`timezone=auto`).
    pub time: String,
    pub temp_c: f64,
    pub precip: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Forecast {
    pub timezone: String,
    pub current_time: Option<String>,
    pub current_c: Option<f64>,
    pub days: Vec<WeatherDay>,
    pub hourly: Vec<WeatherHour>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GeoPlace {
    pub name: String,
    pub admin1: Option<String>,
    pub country: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub tz: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeatherStatus { NoLocation, Fresh, Stale, Unavailable }

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct WeatherView {
    pub status: WeatherStatus,
    pub location: Option<BriefLocation>,
    pub forecast: Option<Forecast>,
    /// RFC 3339 UTC of the forecast shown (the frontend renders "as of h:mm").
    pub fetched_at: Option<String>,
}

#[allow(async_fn_in_trait)]
pub trait WeatherProvider {
    async fn forecast(&self, lat: f64, lon: f64) -> crate::Result<Forecast>;
    async fn geocode(&self, query: &str) -> crate::Result<Vec<GeoPlace>>;
}

pub struct OpenMeteo {
    client: reqwest::Client,
}

impl OpenMeteo {
    pub fn new() -> crate::Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|e| crate::Error::Api(format!("weather client: {e}")))?;
        Ok(Self { client })
    }

    async fn get_text(&self, url: reqwest::Url) -> crate::Result<String> {
        let resp = self.client.get(url).send().await.map_err(|e| crate::Error::Api(format!("weather request failed: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(crate::Error::Api(format!("weather returned {status}")));
        }
        resp.text().await.map_err(|e| crate::Error::Api(format!("weather body: {e}")))
    }
}

impl WeatherProvider for OpenMeteo {
    async fn forecast(&self, lat: f64, lon: f64) -> crate::Result<Forecast> {
        parse_forecast(&self.get_text(forecast_url(lat, lon)).await?)
    }
    async fn geocode(&self, query: &str) -> crate::Result<Vec<GeoPlace>> {
        parse_geocode(&self.get_text(geocode_url(query)).await?)
    }
}

pub fn forecast_url(lat: f64, lon: f64) -> reqwest::Url {
    let mut url = reqwest::Url::parse(FORECAST_URL).expect("static forecast url");
    url.query_pairs_mut()
        .append_pair("latitude", &format!("{lat:.4}"))
        .append_pair("longitude", &format!("{lon:.4}"))
        .append_pair("current", "temperature_2m")
        .append_pair("hourly", "temperature_2m,precipitation_probability")
        .append_pair("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max")
        .append_pair("temperature_unit", "celsius")
        .append_pair("timezone", "auto")
        .append_pair("forecast_days", "2");
    url
}

pub fn geocode_url(query: &str) -> reqwest::Url {
    let mut url = reqwest::Url::parse(GEOCODE_URL).expect("static geocode url");
    url.query_pairs_mut()
        .append_pair("name", query)
        .append_pair("count", "5")
        .append_pair("language", "en")
        .append_pair("format", "json");
    url
}

/// A search worth sending: trimmed, 2–100 characters.
pub fn normalize_query(q: &str) -> Option<&str> {
    let q = q.trim();
    let n = q.chars().count();
    (2..=100).contains(&n).then_some(q)
}

#[derive(Deserialize)]
struct RawForecast { timezone: String, current: Option<RawCurrent>, hourly: RawHourly, daily: RawDaily }
#[derive(Deserialize)]
struct RawCurrent { time: String, temperature_2m: Option<f64> }
#[derive(Deserialize)]
struct RawHourly {
    time: Vec<String>,
    temperature_2m: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability: Vec<Option<f64>>,
}
#[derive(Deserialize)]
struct RawDaily {
    time: Vec<String>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<f64>>,
}

fn pct(v: Option<&Option<f64>>) -> Option<i64> {
    v.copied().flatten().map(|p| p.round() as i64)
}

pub fn parse_forecast(body: &str) -> crate::Result<Forecast> {
    let raw: RawForecast = serde_json::from_str(body).map_err(|e| crate::Error::Parse(format!("weather forecast: {e}")))?;
    let days: Vec<WeatherDay> = raw.daily.time.iter().enumerate()
        .filter_map(|(i, date)| Some(WeatherDay {
            date: date.clone(),
            high_c: raw.daily.temperature_2m_max.get(i).copied().flatten()?,
            low_c: raw.daily.temperature_2m_min.get(i).copied().flatten()?,
            precip_max: pct(raw.daily.precipitation_probability_max.get(i)),
        }))
        .collect();
    if days.is_empty() {
        return Err(crate::Error::Parse("weather forecast: no daily data".into()));
    }
    let hourly: Vec<WeatherHour> = raw.hourly.time.iter().enumerate()
        .filter_map(|(i, time)| Some(WeatherHour {
            time: time.clone(),
            temp_c: raw.hourly.temperature_2m.get(i).copied().flatten()?,
            precip: pct(raw.hourly.precipitation_probability.get(i)),
        }))
        .collect();
    let (current_time, current_c) = match raw.current {
        Some(c) => (Some(c.time), c.temperature_2m),
        None => (None, None),
    };
    Ok(Forecast { timezone: raw.timezone, current_time, current_c, days, hourly })
}

#[derive(Deserialize)]
struct RawGeo {
    #[serde(default)]
    results: Vec<RawPlace>,
}
#[derive(Deserialize)]
struct RawPlace { name: String, latitude: f64, longitude: f64, timezone: Option<String>, admin1: Option<String>, country: Option<String> }

pub fn parse_geocode(body: &str) -> crate::Result<Vec<GeoPlace>> {
    let raw: RawGeo = serde_json::from_str(body).map_err(|e| crate::Error::Parse(format!("weather geocode: {e}")))?;
    Ok(raw.results.into_iter()
        .filter_map(|p| Some(GeoPlace { tz: p.timezone?, name: p.name, admin1: p.admin1, country: p.country, lat: p.latitude, lon: p.longitude }))
        .collect())
}

fn cache_key(loc: &BriefLocation) -> String {
    format!("{:.3},{:.3}", loc.lat, loc.lon)
}

/// The last forecast stored for `loc` and when it was fetched.
pub async fn cached(pool: &SqlitePool, loc: &BriefLocation) -> crate::Result<Option<(Forecast, String)>> {
    let Some((json, at)) = crate::db::module_cache::get(pool, CACHE_MODULE, &cache_key(loc)).await? else { return Ok(None) };
    Ok(serde_json::from_str::<Forecast>(&json).ok().map(|f| (f, at)))
}

fn is_fresh(fetched_at: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(fetched_at)
        .map(|t| now.signed_duration_since(t.with_timezone(&Utc)) < chrono::Duration::minutes(FRESH_MINUTES))
        .unwrap_or(false)
}

fn view(status: WeatherStatus, loc: &BriefLocation, forecast: Option<Forecast>, fetched_at: Option<String>) -> WeatherView {
    WeatherView { status, location: Some(loc.clone()), forecast, fetched_at }
}

/// Serve the cache while fresh (60 min); otherwise fetch and store. A
/// failed fetch falls back to the last forecast (`Stale`, keeping its
/// `fetched_at`) or `Unavailable`. Never errors on the network.
pub async fn load_forecast<P: WeatherProvider>(
    pool: &SqlitePool,
    provider: &P,
    location: Option<&BriefLocation>,
    now: DateTime<Utc>,
) -> crate::Result<WeatherView> {
    let Some(loc) = location else {
        return Ok(WeatherView { status: WeatherStatus::NoLocation, location: None, forecast: None, fetched_at: None });
    };
    let cache = cached(pool, loc).await?;
    if let Some((forecast, at)) = &cache {
        if is_fresh(at, now) {
            return Ok(view(WeatherStatus::Fresh, loc, Some(forecast.clone()), Some(at.clone())));
        }
    }
    match provider.forecast(loc.lat, loc.lon).await {
        Ok(forecast) => {
            let at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
            let json = serde_json::to_string(&forecast).map_err(|e| crate::Error::Parse(e.to_string()))?;
            crate::db::module_cache::put(pool, CACHE_MODULE, &cache_key(loc), &json, &at).await?;
            Ok(view(WeatherStatus::Fresh, loc, Some(forecast), Some(at)))
        }
        Err(e) => {
            log::info!("weather fetch failed, serving the cache: {e}");
            Ok(match cache {
                Some((forecast, at)) => view(WeatherStatus::Stale, loc, Some(forecast), Some(at)),
                None => view(WeatherStatus::Unavailable, loc, None, None),
            })
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use chrono::{DateTime, Utc};

    use super::{parse_forecast, Forecast, GeoPlace, WeatherProvider};
    use crate::types::BriefLocation;

    /// A trimmed real Open-Meteo response. The 26th has a null low, so only
    /// the 25th parses as a day; one hourly slot is null and is skipped.
    pub const FORECAST_FIXTURE: &str = r#"{"latitude":37.76,"longitude":-122.42,"timezone":"America/Los_Angeles",
      "current":{"time":"2026-09-25T06:30","interval":900,"temperature_2m":14.2},
      "hourly":{"time":["2026-09-25T06:00","2026-09-25T07:00","2026-09-25T19:00","2026-09-26T07:00"],
                "temperature_2m":[13.8,14.1,17.9,null],"precipitation_probability":[0,5,60,null]},
      "daily":{"time":["2026-09-25","2026-09-26"],"temperature_2m_max":[21.1,20.0],"temperature_2m_min":[13.9,null],
               "precipitation_probability_max":[60,10]}}"#;

    pub struct FakeWeather {
        pub forecast: Option<Forecast>,
        pub calls: AtomicUsize,
    }

    impl FakeWeather {
        pub fn ok() -> Self { Self { forecast: Some(parse_forecast(FORECAST_FIXTURE).unwrap()), calls: AtomicUsize::new(0) } }
        pub fn offline() -> Self { Self { forecast: None, calls: AtomicUsize::new(0) } }
        pub fn calls(&self) -> usize { self.calls.load(Ordering::SeqCst) }
    }

    impl WeatherProvider for FakeWeather {
        async fn forecast(&self, _lat: f64, _lon: f64) -> crate::Result<Forecast> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.forecast.clone().ok_or_else(|| crate::Error::Api("offline".into()))
        }
        async fn geocode(&self, _query: &str) -> crate::Result<Vec<GeoPlace>> {
            Ok(vec![])
        }
    }

    pub fn sf() -> BriefLocation {
        BriefLocation { name: "San Francisco, California".into(), lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles".into() }
    }

    pub fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::testing::{at, sf, FakeWeather, FORECAST_FIXTURE};
    use super::*;
    use crate::test_util::test_pool;

    fn query(url: &reqwest::Url) -> HashMap<String, String> {
        url.query_pairs().into_owned().collect()
    }

    #[test]
    fn forecast_url_carries_every_parameter_in_celsius() {
        let url = forecast_url(37.7749, -122.4194);
        let q = query(&url);
        assert_eq!(url.host_str(), Some("api.open-meteo.com"));
        assert_eq!((q["latitude"].as_str(), q["longitude"].as_str()), ("37.7749", "-122.4194"));
        assert_eq!(q["current"], "temperature_2m");
        assert_eq!(q["hourly"], "temperature_2m,precipitation_probability");
        assert_eq!(q["daily"], "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
        assert_eq!(q["temperature_unit"], "celsius");
        assert_eq!((q["timezone"].as_str(), q["forecast_days"].as_str()), ("auto", "2"));
    }

    #[test]
    fn geocode_url_encodes_the_query() {
        let url = geocode_url("Winston-Salem & Co+op");
        let q = query(&url);
        assert_eq!(url.host_str(), Some("geocoding-api.open-meteo.com"));
        assert_eq!(q["name"], "Winston-Salem & Co+op");
        assert_eq!((q["count"].as_str(), q["language"].as_str(), q["format"].as_str()), ("5", "en", "json"));
        assert!(url.as_str().contains("name=Winston-Salem+%26+Co%2Bop"), "{url}");
    }

    #[test]
    fn a_forecast_parses_and_skips_missing_values() {
        let f = parse_forecast(FORECAST_FIXTURE).unwrap();
        assert_eq!(f.timezone, "America/Los_Angeles");
        assert_eq!((f.current_c, f.current_time.as_deref()), (Some(14.2), Some("2026-09-25T06:30")));
        assert_eq!(f.days, vec![WeatherDay { date: "2026-09-25".into(), high_c: 21.1, low_c: 13.9, precip_max: Some(60) }]);
        assert_eq!(f.hourly.len(), 3);
        assert_eq!(f.hourly[2], WeatherHour { time: "2026-09-25T19:00".into(), temp_c: 17.9, precip: Some(60) });
    }

    #[test]
    fn a_forecast_without_days_or_json_is_an_error() {
        let empty = r#"{"timezone":"UTC","hourly":{"time":[],"temperature_2m":[]},"daily":{"time":[],"temperature_2m_max":[],"temperature_2m_min":[]}}"#;
        assert!(parse_forecast(empty).is_err());
        assert!(parse_forecast("<html>rate limited</html>").is_err());
    }

    #[test]
    fn geocode_results_parse_and_an_empty_search_is_empty() {
        let body = r#"{"results":[
            {"id":5391959,"name":"San Francisco","latitude":37.77493,"longitude":-122.41942,"timezone":"America/Los_Angeles","country":"United States","admin1":"California"},
            {"id":1,"name":"Nowhere","latitude":0.0,"longitude":0.0}],"generationtime_ms":0.5}"#;
        assert_eq!(parse_geocode(body).unwrap(), vec![GeoPlace {
            name: "San Francisco".into(), admin1: Some("California".into()), country: Some("United States".into()),
            lat: 37.77493, lon: -122.41942, tz: "America/Los_Angeles".into(),
        }]);
        assert!(parse_geocode(r#"{"generationtime_ms":0.3}"#).unwrap().is_empty(), "no `results` key = nothing found");
    }

    #[test]
    fn geocode_queries_are_trimmed_and_bounded() {
        assert_eq!(normalize_query("  San "), Some("San"));
        assert_eq!(normalize_query(" S "), None);
        assert_eq!(normalize_query(&"x".repeat(101)), None);
    }

    #[tokio::test]
    async fn no_location_never_calls_the_provider() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        let v = load_forecast(&pool, &p, None, at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::NoLocation);
        assert_eq!(p.calls(), 0);
    }

    #[tokio::test]
    async fn a_fresh_cache_is_served_without_a_call() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        let first = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        assert_eq!((first.status, first.fetched_at.as_deref()), (WeatherStatus::Fresh, Some("2026-09-25T13:30:00Z")));
        let again = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T14:29:00Z")).await.unwrap();
        assert_eq!(again.status, WeatherStatus::Fresh);
        assert_eq!(p.calls(), 1);
    }

    #[tokio::test]
    async fn an_hour_old_cache_refetches() {
        let pool = test_pool().await;
        let p = FakeWeather::ok();
        load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T13:30:00Z")).await.unwrap();
        let v = load_forecast(&pool, &p, Some(&sf()), at("2026-09-25T14:31:00Z")).await.unwrap();
        assert_eq!((v.status, v.fetched_at.as_deref()), (WeatherStatus::Fresh, Some("2026-09-25T14:31:00Z")));
        assert_eq!(p.calls(), 2);
    }

    #[tokio::test]
    async fn offline_serves_the_last_forecast_as_stale() {
        let pool = test_pool().await;
        load_forecast(&pool, &FakeWeather::ok(), Some(&sf()), at("2026-09-25T13:31:00Z")).await.unwrap();
        let v = load_forecast(&pool, &FakeWeather::offline(), Some(&sf()), at("2026-09-25T16:00:00Z")).await.unwrap();
        assert_eq!((v.status, v.fetched_at.as_deref()), (WeatherStatus::Stale, Some("2026-09-25T13:31:00Z")));
        assert!(v.forecast.is_some());
    }

    #[tokio::test]
    async fn offline_with_nothing_cached_is_unavailable() {
        let pool = test_pool().await;
        let v = load_forecast(&pool, &FakeWeather::offline(), Some(&sf()), at("2026-09-25T16:00:00Z")).await.unwrap();
        assert_eq!(v.status, WeatherStatus::Unavailable);
        assert!(v.forecast.is_none() && v.location == Some(sf()));
    }
}
