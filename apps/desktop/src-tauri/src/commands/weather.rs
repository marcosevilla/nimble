use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use nimble_core::api::weather::{normalize_query, GeoPlace, OpenMeteo, WeatherProvider, WeatherView};

/// Today's forecast for the brief chip (cache first, 60 min fresh), freezing
/// it into today's snapshot on the first success.
#[tauri::command]
pub async fn weather_get(app: AppHandle) -> Result<WeatherView, String> {
    let pool = app.state::<SqlitePool>();
    let provider = OpenMeteo::new().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    nimble_core::brief::modules::weather::refresh(pool.inner(), &provider, &today, chrono::Utc::now())
        .await
        .map_err(|e| e.to_string())
}

/// City search for Settings → Location & weather and the setup.
#[tauri::command]
pub async fn weather_geocode(query: String) -> Result<Vec<GeoPlace>, String> {
    let Some(q) = normalize_query(&query) else { return Ok(Vec::new()) };
    OpenMeteo::new().map_err(|e| e.to_string())?.geocode(q).await.map_err(|e| e.to_string())
}
