//! Recurrence engine: pure functions to parse a small recurrence grammar and
//! compute the next occurrence of a recurring due date. No I/O, no DB.
//!
//! Grammar (case-insensitive, this is the WHOLE grammar):
//!   "every day" | "every N days"
//!   "every week" | "every N weeks"
//!   "every month" | "every N months"
//!   "every year" | "every N years"
//! optionally followed by "@ HH:MM" or "at H[:MM][am|pm]".

use chrono::{Datelike, Days, Months, NaiveDate};

#[derive(Debug, Clone, PartialEq)]
pub struct RecurrenceRule {
    pub interval: u32,          // every N units, >= 1
    pub unit: RecurrenceUnit,   // Day | Week | Month | Year
    pub time: Option<String>,   // "HH:MM" 24h
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RecurrenceUnit {
    Day,
    Week,
    Month,
    Year,
}

/// None = string is not a supported rule (caller stores it anyway; task just won't auto-recur)
pub fn parse_rule(s: &str) -> Option<RecurrenceRule> {
    let lower = s.trim().to_lowercase();
    if lower.is_empty() {
        return None;
    }

    // Split off the time suffix, introduced by "@" or "at".
    let (body, time) = split_time_suffix(&lower)?;

    let tokens: Vec<&str> = body.split_whitespace().collect();
    if tokens.first() != Some(&"every") {
        return None;
    }

    // Remaining tokens after "every": either [singular_unit] or [N, plural_unit],
    // matching the grammar exactly ("every day" / "every N days", never a bare
    // plural like "every days" or a singular with a count like "every 2 day").
    let rest = &tokens[1..];
    let (interval, unit) = match rest {
        [unit] => (1u32, match_singular_unit(unit)?),
        [n, unit] => {
            let n: u32 = n.parse().ok()?;
            (n, match_plural_unit(unit)?)
        }
        _ => return None,
    };

    if interval == 0 {
        return None;
    }

    Some(RecurrenceRule { interval, unit, time })
}

fn match_singular_unit(unit: &str) -> Option<RecurrenceUnit> {
    match unit {
        "day" => Some(RecurrenceUnit::Day),
        "week" => Some(RecurrenceUnit::Week),
        "month" => Some(RecurrenceUnit::Month),
        "year" => Some(RecurrenceUnit::Year),
        _ => None,
    }
}

fn match_plural_unit(unit: &str) -> Option<RecurrenceUnit> {
    match unit {
        "days" => Some(RecurrenceUnit::Day),
        "weeks" => Some(RecurrenceUnit::Week),
        "months" => Some(RecurrenceUnit::Month),
        "years" => Some(RecurrenceUnit::Year),
        _ => None,
    }
}

/// Splits a lowercased rule string into (body, optional "HH:MM" time),
/// where the time suffix is introduced by "@" or the word "at".
fn split_time_suffix(lower: &str) -> Option<(String, Option<String>)> {
    if let Some(idx) = lower.find('@') {
        let body = lower[..idx].trim().to_string();
        let time_str = lower[idx + 1..].trim();
        let time = parse_time(time_str)?;
        return Some((body, Some(time)));
    }

    // Look for a standalone " at " token boundary.
    let tokens: Vec<&str> = lower.split_whitespace().collect();
    if let Some(pos) = tokens.iter().position(|t| *t == "at") {
        let body = tokens[..pos].join(" ");
        let time_tokens = &tokens[pos + 1..];
        if time_tokens.is_empty() {
            return None;
        }
        let time = parse_time(&time_tokens.join(" "))?;
        return Some((body, Some(time)));
    }

    Some((lower.to_string(), None))
}

/// Parses "H[:MM][am|pm]" (or 24h "HH:MM") into "HH:MM".
fn parse_time(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    let (digits, meridiem) = if let Some(stripped) = s.strip_suffix("am") {
        (stripped.trim(), Some(false))
    } else if let Some(stripped) = s.strip_suffix("pm") {
        (stripped.trim(), Some(true))
    } else {
        (s, None)
    };

    let (hour_str, minute_str) = match digits.split_once(':') {
        Some((h, m)) => (h, m),
        None => (digits, "0"),
    };

    let mut hour: u32 = hour_str.parse().ok()?;
    let minute: u32 = minute_str.parse().ok()?;
    if minute > 59 {
        return None;
    }

    match meridiem {
        Some(is_pm) => {
            if !(1..=12).contains(&hour) {
                return None;
            }
            hour %= 12; // 12am -> 0, 12pm -> 12 (below)
            if is_pm {
                hour += 12;
            }
        }
        None => {
            if hour > 23 {
                return None;
            }
        }
    }

    Some(format!("{:02}:{:02}", hour, minute))
}

/// Next due date strictly after `today`, advancing by whole intervals from `current_due`.
pub fn next_occurrence(rule: &RecurrenceRule, current_due: NaiveDate, today: NaiveDate) -> NaiveDate {
    let mut candidate = current_due;
    loop {
        candidate = add_interval(candidate, rule);
        if candidate > today {
            return candidate;
        }
    }
}

fn add_interval(date: NaiveDate, rule: &RecurrenceRule) -> NaiveDate {
    match rule.unit {
        RecurrenceUnit::Day => date + Days::new(rule.interval as u64),
        RecurrenceUnit::Week => date + Days::new(rule.interval as u64 * 7),
        RecurrenceUnit::Month => add_months_clamped(date, rule.interval),
        RecurrenceUnit::Year => add_months_clamped(date, rule.interval * 12),
    }
}

/// Adds N months, clamping the day-of-month to the target month's length:
/// first day of (month + N), then min(original day, days_in_that_month).
fn add_months_clamped(date: NaiveDate, months: u32) -> NaiveDate {
    let day = date.day();
    let first_of_month = date.with_day(1).expect("day 1 is always valid");
    let target_first = first_of_month + Months::new(months);
    let days_in_target = days_in_month(target_first.year(), target_first.month());
    let clamped_day = day.min(days_in_target);
    target_first
        .with_day(clamped_day)
        .expect("clamped_day is within the target month's range")
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let first_of_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid date");
    let first_of_this = NaiveDate::from_ymd_opt(year, month, 1).expect("valid date");
    (first_of_next - first_of_this).num_days() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    fn d(s: &str) -> NaiveDate { NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

    #[test]
    fn parses_marcos_real_rules() {
        assert_eq!(parse_rule("every month"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Month, time: None }));
        assert_eq!(parse_rule("every 2 weeks @ 09:00"),
            Some(RecurrenceRule { interval: 2, unit: RecurrenceUnit::Week, time: Some("09:00".into()) }));
        assert_eq!(parse_rule("Every Day"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Day, time: None }));
        assert_eq!(parse_rule("every 3 months at 9am"),
            Some(RecurrenceRule { interval: 3, unit: RecurrenceUnit::Month, time: Some("09:00".into()) }));
    }

    #[test]
    fn rejects_unsupported_strings() {
        for s in ["every 3rd tuesday", "weekdays", "every!", "", "tomorrow", "every 0 days"] {
            assert_eq!(parse_rule(s), None, "should reject {s:?}");
        }
    }

    #[test]
    fn completed_early_advances_one_interval_from_due() {
        // EDD: due 8/16, completed 8/10 → next 8/30 (from due, not from completion day)
        let rule = parse_rule("every 2 weeks @ 09:00").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-08-16"), d("2026-08-10")), d("2026-08-30"));
    }

    #[test]
    fn completed_late_advances_past_today() {
        // loans: due 8/27, completed 10/02 → next 10/27 (skips the already-past 9/27)
        let rule = parse_rule("every month").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-08-27"), d("2026-10-02")), d("2026-10-27"));
    }

    #[test]
    fn month_end_clamps() {
        let rule = parse_rule("every month").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-01-31"), d("2026-01-31")), d("2026-02-28"));
        assert_eq!(next_occurrence(&rule, d("2028-01-31"), d("2028-01-31")), d("2028-02-29")); // leap year
    }

    #[test]
    fn yearly_and_daily() {
        assert_eq!(next_occurrence(&parse_rule("every year").unwrap(), d("2026-03-06"), d("2026-03-06")), d("2027-03-06"));
        assert_eq!(next_occurrence(&parse_rule("every day").unwrap(), d("2026-08-09"), d("2026-08-09")), d("2026-08-10"));
    }

    // --- Additional edge cases beyond the mandatory set ---

    #[test]
    fn parses_time_variants() {
        assert_eq!(parse_rule("every week at 5pm"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Week, time: Some("17:00".into()) }));
        assert_eq!(parse_rule("every day at 12am"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Day, time: Some("00:00".into()) }));
        assert_eq!(parse_rule("every day at 12pm"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Day, time: Some("12:00".into()) }));
        assert_eq!(parse_rule("every day at 9:30am"),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Day, time: Some("09:30".into()) }));
    }

    #[test]
    fn rejects_more_malformed_strings() {
        for s in [
            "every day at",           // "at" with nothing following
            "every day @",            // "@" with nothing following
            "every day at 13pm",      // out-of-range 12h hour
            "every day @ 25:00",      // out-of-range 24h hour
            "every day @ 09:99",      // out-of-range minutes
            "every -1 days",          // negative interval unparsable as u32
            "every months",           // bare plural with no count is not in the grammar
            "every 2 day",            // count with singular unit is not in the grammar
            "every 2",                // missing unit
            "every",                  // nothing after "every"
        ] {
            assert_eq!(parse_rule(s), None, "should reject {s:?}");
        }
    }

    #[test]
    fn is_case_insensitive_and_trims_whitespace() {
        assert_eq!(parse_rule("  EVERY   Month  "),
            Some(RecurrenceRule { interval: 1, unit: RecurrenceUnit::Month, time: None }));
    }

    #[test]
    fn next_occurrence_never_returns_today_even_when_interval_lands_on_it() {
        // If advancing by one interval lands exactly on `today`, keep advancing.
        let rule = parse_rule("every week").unwrap();
        assert_eq!(next_occurrence(&rule, d("2026-08-02"), d("2026-08-09")), d("2026-08-16"));
    }

    #[test]
    fn year_leap_day_clamps_to_feb_28_on_non_leap_year() {
        let rule = parse_rule("every year").unwrap();
        assert_eq!(next_occurrence(&rule, d("2028-02-29"), d("2028-02-29")), d("2029-02-28"));
    }
}
