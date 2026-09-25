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

const A_DAY_EVENT: &str = "DTSTART:20260923T170000Z\r\nDTEND:20260923T180000Z\r\n";

#[test]
fn escaped_commas_and_semicolons_are_unescaped_in_summary() {
    // Raw ICS bytes carry a literal `\,` and `\;` per RFC 5545 §3.3.11.
    let content = feed(&[&format!(
        "UID:a\r\nSUMMARY:shot list\\, grade\\; export\r\n{A_DAY_EVENT}"
    )]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events[0].summary, "shot list, grade; export");
}

#[test]
fn escaped_newlines_become_real_newlines_in_description() {
    let content = feed(&[&format!(
        "UID:a\r\nSUMMARY:Meeting\r\nDESCRIPTION:Line one\\nLine two\\NLine three\r\n{A_DAY_EVENT}"
    )]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events[0].description.as_deref(), Some("Line one\nLine two\nLine three"));
}

#[test]
fn escaped_backslashes_are_unescaped_in_location() {
    let content = feed(&[&format!(
        "UID:a\r\nSUMMARY:Off-site\r\nLOCATION:C:\\\\Users\\\\marco\\\\notes\r\n{A_DAY_EVENT}"
    )]);
    let events = day(2026, 9, 23, &content);
    // Two escaped backslashes (`\\`) each collapse to one literal backslash.
    assert_eq!(events[0].location.as_deref(), Some("C:\\Users\\marco\\notes"));
}

#[test]
fn an_escaped_backslash_followed_by_a_literal_n_is_not_a_newline() {
    // Raw value is `A` + backslash + backslash + `n` + `B`: an escaped
    // backslash (`\\` -> `\`) immediately followed by a plain `n`. It must
    // NOT be read as the newline escape `\n` -- order-of-operations
    // regression guard (single left-to-right pass, no double-unescaping).
    let content = feed(&[&format!("UID:a\r\nSUMMARY:A\\\\nB\r\n{A_DAY_EVENT}")]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events[0].summary, "A\\nB");
}

#[test]
fn an_unknown_escape_sequence_is_kept_as_is() {
    // `\x` isn't a defined TEXT escape -- pass it through unchanged rather
    // than silently dropping the backslash.
    let content = feed(&[&format!("UID:a\r\nSUMMARY:weird \\x escape\r\n{A_DAY_EVENT}")]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events[0].summary, "weird \\x escape");
}

#[test]
fn a_trailing_backslash_is_kept_as_is() {
    let content = feed(&[&format!("UID:a\r\nSUMMARY:trailing\\\r\n{A_DAY_EVENT}")]);
    let events = day(2026, 9, 23, &content);
    assert_eq!(events[0].summary, "trailing\\");
}
