use chrono::NaiveDate;
use chrono_tz::America::Los_Angeles;
use nimble_core::parsers::ical::{parse_ical_for_date_in, CalendarEvent};

fn feed(events: &[&str]) -> String {
    let mut s = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n");
    for e in events {
        s.push_str("BEGIN:VEVENT\r\n");
        s.push_str(e);
        s.push_str("END:VEVENT\r\n");
    }
    s.push_str("END:VCALENDAR\r\n");
    s
}

fn day(y: i32, m: u32, d: u32, content: &str) -> Vec<CalendarEvent> {
    parse_ical_for_date_in(content, NaiveDate::from_ymd_opt(y, m, d).unwrap(), &Los_Angeles)
}

fn times(events: &[CalendarEvent]) -> Vec<(String, String, String)> {
    events.iter().map(|e| (e.summary.clone(), e.start_time.clone(), e.end_time.clone())).collect()
}

fn t(summary: &str, start: &str, end: &str) -> (String, String, String) {
    (summary.into(), start.into(), end.into())
}

#[test]
fn utc_times_are_shown_in_the_display_zone() {
    // Google's secret iCal feed emits most events in UTC. 17:00Z is 10:00 PDT.
    let content = feed(&["UID:a\r\nSUMMARY:Covered CA\r\nDTSTART:20260923T170000Z\r\nDTEND:20260923T183000Z\r\n"]);
    assert_eq!(times(&day(2026, 9, 23, &content)), vec![t("Covered CA", "10:00", "11:30")]);
}

#[test]
fn utc_times_use_the_winter_offset_after_dst_ends() {
    let content = feed(&["UID:a\r\nSUMMARY:Winter\r\nDTSTART:20261215T180000Z\r\nDTEND:20261215T190000Z\r\n"]);
    assert_eq!(times(&day(2026, 12, 15, &content)), vec![t("Winter", "10:00", "11:00")]);
}

#[test]
fn events_are_bucketed_by_their_local_date_not_their_utc_date() {
    let content = feed(&[
        // 2026-09-24 01:30Z = 2026-09-23 18:30 PDT → belongs to the 23rd.
        "UID:evening\r\nSUMMARY:Evening\r\nDTSTART:20260924T013000Z\r\nDTEND:20260924T023000Z\r\n",
        // 2026-09-23 01:00Z = 2026-09-22 18:00 PDT → belongs to the 22nd.
        "UID:prev\r\nSUMMARY:Previous evening\r\nDTSTART:20260923T010000Z\r\nDTEND:20260923T020000Z\r\n",
    ]);
    assert_eq!(times(&day(2026, 9, 23, &content)), vec![t("Evening", "18:30", "19:30")]);
    assert_eq!(times(&day(2026, 9, 22, &content)), vec![t("Previous evening", "18:00", "19:00")]);
}

#[test]
fn tzid_times_are_converted_from_their_own_zone() {
    let content = feed(&[
        "UID:la\r\nSUMMARY:LA\r\nDTSTART;TZID=America/Los_Angeles:20260923T200000\r\nDTEND;TZID=America/Los_Angeles:20260923T210000\r\n",
        "UID:ny\r\nSUMMARY:NY\r\nDTSTART;TZID=America/New_York:20260923T120000\r\nDTEND;TZID=America/New_York:20260923T130000\r\n",
    ]);
    assert_eq!(times(&day(2026, 9, 23, &content)), vec![t("NY", "09:00", "10:00"), t("LA", "20:00", "21:00")]);
}

#[test]
fn floating_and_unknown_tzid_times_stay_as_written() {
    let content = feed(&[
        "UID:f\r\nSUMMARY:Floating\r\nDTSTART:20260923T090000\r\nDTEND:20260923T100000\r\n",
        "UID:w\r\nSUMMARY:Windows zone\r\nDTSTART;TZID=Pacific Standard Time:20260923T110000\r\nDTEND;TZID=Pacific Standard Time:20260923T120000\r\n",
    ]);
    assert_eq!(times(&day(2026, 9, 23, &content)), vec![t("Floating", "09:00", "10:00"), t("Windows zone", "11:00", "12:00")]);
}

#[test]
fn all_day_events_are_unchanged() {
    let content = feed(&["UID:d\r\nSUMMARY:All day\r\nDTSTART;VALUE=DATE:20260923\r\nDTEND;VALUE=DATE:20260924\r\n"]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events.len(), 1);
    assert!(events[0].all_day);
    assert_eq!((events[0].start_time.as_str(), events[0].end_time.as_str()), ("20260923", "20260924"));
}
