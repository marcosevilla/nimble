use chrono::{Local, TimeDelta};
use sqlx::SqlitePool;

use crate::parsers::ical;
use crate::types::{CalendarEventWithFeed, CalendarFeed};

// ── Calendar Feed CRUD ──

pub async fn get_calendar_feeds(pool: &SqlitePool) -> crate::Result<Vec<CalendarFeed>> {
    let rows: Vec<(String, String, String, String, i32)> =
        sqlx::query_as("SELECT id, label, url, color, enabled FROM calendar_feeds")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(id, label, url, color, enabled)| CalendarFeed { id, label, url, color, enabled }).collect())
}

pub async fn add_calendar_feed(
    pool: &SqlitePool,
    label: &str,
    url: &str,
    color: &str,
) -> crate::Result<CalendarFeed> {
    let id = uuid::Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO calendar_feeds (id, label, url, color) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(label)
        .bind(url)
        .bind(color)
        .execute(pool)
        .await?;

    Ok(CalendarFeed {
        id,
        label: label.to_string(),
        url: url.to_string(),
        color: color.to_string(),
        enabled: 1,
    })
}

pub async fn remove_calendar_feed(pool: &SqlitePool, feed_id: &str) -> crate::Result<()> {
    sqlx::query("DELETE FROM calendar_feeds WHERE id = ?")
        .bind(feed_id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Feed fetching ──

/// Get the iCal feed URL from settings (legacy fallback)
async fn get_ical_url(pool: &SqlitePool) -> crate::Result<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = 'ical_feed_url'")
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

/// Build the list of feed sources (url, label, color) from DB or legacy setting
pub async fn get_feed_sources(pool: &SqlitePool) -> crate::Result<Vec<(String, String, String)>> {
    let feeds: Vec<(String, String, String, String, i32)> =
        sqlx::query_as("SELECT id, label, url, color, enabled FROM calendar_feeds WHERE enabled = 1")
            .fetch_all(pool)
            .await?;

    if feeds.is_empty() {
        match get_ical_url(pool).await? {
            Some(url) => Ok(vec![(url, "Calendar".to_string(), "#6366f1".to_string())]),
            None => Err(crate::Error::Other("No calendar feeds configured".to_string())),
        }
    } else {
        Ok(feeds
            .iter()
            .map(|f| (f.2.clone(), f.1.clone(), f.3.clone()))
            .collect())
    }
}

/// Fetch a single iCal feed for a 7-day window
async fn fetch_single_feed_7day(
    client: &reqwest::Client,
    url: &str,
    feed_label: &str,
    feed_color: &str,
) -> Vec<CalendarEventWithFeed> {
    let response = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            log::error!("Failed to fetch feed '{}': {}", feed_label, e);
            return Vec::new();
        }
    };

    let ical_content = match response.text().await {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to read feed '{}': {}", feed_label, e);
            return Vec::new();
        }
    };

    let today = Local::now().date_naive();
    let mut all_events = Vec::new();

    for offset in -3..=3i64 {
        let target = today + TimeDelta::days(offset);
        let date_str = target.format("%Y-%m-%d").to_string();
        let events = ical::parse_ical_for_date(&ical_content, target);
        for event in events {
            all_events.push(CalendarEventWithFeed {
                event,
                date: Some(date_str.clone()),
                feed_label: Some(feed_label.to_string()),
                feed_color: Some(feed_color.to_string()),
            });
        }
    }

    all_events
}

/// Check if we have a fresh cache for the given date (fetched within last 15 minutes)
async fn has_fresh_cache(pool: &SqlitePool, date: &str) -> bool {
    let result: Option<(i32,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM calendar_events WHERE date = ? AND fetched_at > datetime('now', '-15 minutes')"
    )
    .bind(date)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    matches!(result, Some((count,)) if count > 0)
}

/// Read cached events for a date from SQLite
pub async fn read_cached_events(pool: &SqlitePool, date: &str) -> crate::Result<Vec<CalendarEventWithFeed>> {
    let rows: Vec<(String, String, Option<String>, Option<String>, String, String, bool, Option<String>, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT id, summary, description, location, start_time, end_time, all_day, meeting_url, date, feed_label, feed_color
             FROM calendar_events WHERE date = ? ORDER BY start_time ASC"
        )
        .bind(date)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|(id, summary, description, location, start_time, end_time, all_day, meeting_url, date, feed_label, feed_color)| {
            CalendarEventWithFeed {
                event: ical::CalendarEvent {
                    id,
                    summary,
                    description,
                    location,
                    start_time,
                    end_time,
                    all_day,
                    meeting_url,
                },
                date,
                feed_label,
                feed_color,
            }
        })
        .collect())
}

/// Cache events to SQLite for a set of dates
async fn cache_events(pool: &SqlitePool, events: &[CalendarEventWithFeed]) -> crate::Result<()> {
    let mut dates_to_clear: Vec<String> = events
        .iter()
        .filter_map(|e| e.date.clone())
        .collect();
    dates_to_clear.sort();
    dates_to_clear.dedup();

    for date in &dates_to_clear {
        sqlx::query("DELETE FROM calendar_events WHERE date = ?")
            .bind(date)
            .execute(pool)
            .await?;
    }

    for item in events {
        sqlx::query(
            "INSERT OR REPLACE INTO calendar_events
             (id, summary, description, location, start_time, end_time, all_day, meeting_url, date, feed_label, feed_color, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        )
        .bind(&item.event.id)
        .bind(&item.event.summary)
        .bind(&item.event.description)
        .bind(&item.event.location)
        .bind(&item.event.start_time)
        .bind(&item.event.end_time)
        .bind(item.event.all_day)
        .bind(&item.event.meeting_url)
        .bind(&item.date)
        .bind(&item.feed_label)
        .bind(&item.feed_color)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Fetch calendar events from all enabled feeds with caching.
pub async fn fetch_calendar_events(
    pool: &SqlitePool,
    date: Option<&str>,
) -> crate::Result<Vec<CalendarEventWithFeed>> {
    let today = Local::now().date_naive();
    let target_date_str = date.map(|s| s.to_string()).unwrap_or_else(|| today.format("%Y-%m-%d").to_string());

    // Check if we have fresh cached data for this date
    if has_fresh_cache(pool, &target_date_str).await {
        return read_cached_events(pool, &target_date_str).await;
    }

    let client = reqwest::Client::new();
    let feed_sources = get_feed_sources(pool).await?;

    let futures: Vec<_> = feed_sources
        .iter()
        .map(|(url, label, color)| fetch_single_feed_7day(&client, url, label, color))
        .collect();

    let results = futures::future::join_all(futures).await;
    let all_events: Vec<CalendarEventWithFeed> = results.into_iter().flatten().collect();

    cache_events(pool, &all_events).await?;

    read_cached_events(pool, &target_date_str).await
}
