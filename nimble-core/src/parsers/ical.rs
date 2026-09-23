use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use ical::parser::ical::component::IcalCalendar;
use ical::property::Property;
use ical::IcalParser;
use serde::{Deserialize, Serialize};
use std::io::BufReader;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEvent {
    pub id: String,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_time: String,
    pub end_time: String,
    pub all_day: bool,
    pub meeting_url: Option<String>,
}

/// Parse an iCal feed string into calendar events for today
#[allow(dead_code)]
pub fn parse_ical_for_today(ical_content: &str) -> Vec<CalendarEvent> {
    parse_ical_for_date(ical_content, Local::now().date_naive())
}

/// Parse an iCal feed string into calendar events for a specific date
pub fn parse_ical_for_date(ical_content: &str, target_date: NaiveDate) -> Vec<CalendarEvent> {
    parse_ical_for_date_in(ical_content, target_date, &Local)
}

/// Parse an iCal feed string into calendar events for a specific date in `zone`
pub fn parse_ical_for_date_in<Z: TimeZone>(ical_content: &str, target_date: NaiveDate, zone: &Z) -> Vec<CalendarEvent> {
    let reader = BufReader::new(ical_content.as_bytes());
    let parser = IcalParser::new(reader);

    let mut events = Vec::new();

    for calendar_result in parser {
        let calendar: IcalCalendar = match calendar_result {
            Ok(c) => c,
            Err(_) => continue,
        };

        for event in calendar.events {
            let mut uid = String::new();
            let mut summary = String::new();
            let mut description: Option<String> = None;
            let mut location: Option<String> = None;
            let mut dtstart: Option<String> = None;
            let mut dtend: Option<String> = None;
            let mut start_tzid: Option<String> = None;
            let mut end_tzid: Option<String> = None;

            for prop in &event.properties {
                match prop.name.as_str() {
                    "UID" => uid = prop.value.clone().unwrap_or_default(),
                    "SUMMARY" => summary = prop.value.clone().unwrap_or_default(),
                    "DESCRIPTION" => description = prop.value.clone(),
                    "LOCATION" => location = prop.value.clone(),
                    "DTSTART" => {
                        dtstart = prop.value.clone();
                        start_tzid = tzid(prop);
                    }
                    "DTEND" => {
                        dtend = prop.value.clone();
                        end_tzid = tzid(prop);
                    }
                    _ => {}
                }
            }

            let Some(start_raw) = dtstart else { continue };
            let (end_raw, end_tzid) = match dtend {
                Some(end) => (end, end_tzid),
                None => (start_raw.clone(), start_tzid.clone()),
            };

            let all_day = start_raw.len() <= 10 || !start_raw.contains('T');

            let matches_date = if all_day {
                parse_ical_date(&start_raw)
                    .map(|d| d == target_date)
                    .unwrap_or(false)
            } else {
                parse_ical_datetime(&start_raw, start_tzid.as_deref(), zone)
                    .map(|dt| dt.date() == target_date)
                    .unwrap_or(false)
            };

            if !matches_date {
                continue;
            }

            let (start_time, end_time) = if all_day {
                (start_raw.clone(), end_raw.clone())
            } else {
                let start_fmt = parse_ical_datetime(&start_raw, start_tzid.as_deref(), zone)
                    .map(|dt| dt.format("%H:%M").to_string())
                    .unwrap_or(start_raw.clone());
                let end_fmt = parse_ical_datetime(&end_raw, end_tzid.as_deref(), zone)
                    .map(|dt| dt.format("%H:%M").to_string())
                    .unwrap_or(end_raw.clone());
                (start_fmt, end_fmt)
            };

            let meeting_url = extract_meeting_url(
                description.as_deref().unwrap_or(""),
                location.as_deref().unwrap_or(""),
            );

            events.push(CalendarEvent {
                id: uid,
                summary,
                description,
                location,
                start_time,
                end_time,
                all_day,
                meeting_url,
            });
        }
    }

    events.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    events
}

fn parse_ical_date(s: &str) -> Option<NaiveDate> {
    let clean = s.trim();
    NaiveDate::parse_from_str(clean, "%Y%m%d")
        .or_else(|_| NaiveDate::parse_from_str(clean, "%Y-%m-%d"))
        .ok()
}

fn tzid(prop: &Property) -> Option<String> {
    prop.params.as_ref()?.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("TZID"))
        .and_then(|(_, values)| values.first())
        .map(|v| v.trim_matches('"').to_string())
}

/// Parse a DATE-TIME into wall-clock time in `zone`. UTC (`Z`) and known
/// TZID values are converted; floating times and unknown TZIDs (e.g. Windows
/// zone names) are taken as already being in `zone`.
fn parse_ical_datetime<Z: TimeZone>(s: &str, tzid: Option<&str>, zone: &Z) -> Option<NaiveDateTime> {
    let trimmed = s.trim();
    let clean = trimmed.trim_end_matches('Z');
    let naive = NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S")
        .or_else(|_| NaiveDateTime::parse_from_str(clean, "%Y-%m-%dT%H:%M:%S"))
        .ok()?;
    if trimmed.ends_with('Z') {
        return Some(Utc.from_utc_datetime(&naive).with_timezone(zone).naive_local());
    }
    match tzid.and_then(|id| id.parse::<chrono_tz::Tz>().ok()) {
        Some(source) => Some(match source.from_local_datetime(&naive).earliest() {
            Some(dt) => dt.with_timezone(zone).naive_local(),
            None => naive, // inside a DST gap; keep the written time
        }),
        None => Some(naive),
    }
}

fn extract_meeting_url(description: &str, location: &str) -> Option<String> {
    let combined = format!("{} {}", description, location);

    let patterns = [
        "https://meet.google.com/",
        "https://zoom.us/j/",
        "https://us02web.zoom.us/",
        "https://us04web.zoom.us/",
        "https://us05web.zoom.us/",
        "https://us06web.zoom.us/",
        "https://teams.microsoft.com/l/meetup-join/",
    ];

    for pattern in &patterns {
        if let Some(start) = combined.find(pattern) {
            let url_slice = &combined[start..];
            let end = url_slice
                .find(|c: char| c.is_whitespace() || c == '"' || c == '<' || c == '>')
                .unwrap_or(url_slice.len());
            return Some(url_slice[..end].to_string());
        }
    }

    None
}
