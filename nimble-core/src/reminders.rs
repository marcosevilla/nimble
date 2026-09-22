//! Pure reminder scheduling. The occurrence key depends on scheduling intent,
//! never on `updated_at`, so editing a title cannot repeat a banner.
use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use crate::types::LocalTask;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReminderCandidate {
    pub task_id: String,
    pub scheduled_at: DateTime<Utc>,
    pub occurrence_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryDecision { Notify, CatchUp, Future }

pub fn decide(now: DateTime<Utc>, at: DateTime<Utc>) -> DeliveryDecision {
    if now < at { DeliveryDecision::Future }
    else if now - at <= Duration::seconds(90) { DeliveryDecision::Notify }
    else { DeliveryDecision::CatchUp }
}

pub fn candidate(task: &LocalTask, timezone: &str) -> crate::Result<Option<ReminderCandidate>> {
    if task.completed { return Ok(None); }
    let (Some(date), Some(time), Some(offset)) = (&task.due_date, &task.due_time, task.reminder_offset_minutes) else { return Ok(None) };
    if !(0..=40_320).contains(&offset) { return Err(crate::Error::Parse("Invalid reminder offset".into())); }
    let zone: chrono_tz::Tz = timezone.parse().map_err(|_| crate::Error::Parse("Invalid reminder timezone".into()))?;
    let wall = NaiveDateTime::parse_from_str(&format!("{date} {time}"), "%Y-%m-%d %H:%M")
        .map_err(|_| crate::Error::Parse("Invalid task due date or time".into()))?;
    let due = match zone.from_local_datetime(&wall) {
        LocalResult::Single(v) => v,
        LocalResult::Ambiguous(a, b) => a.min(b),
        LocalResult::None => return Err(crate::Error::Parse("Reminder time needs attention: local time does not exist".into())),
    };
    Ok(Some(ReminderCandidate {
        task_id: task.id.clone(),
        scheduled_at: due.with_timezone(&Utc) - Duration::minutes(offset),
        occurrence_key: format!("{}|{}|{}|{}|{}", task.id, date, time, offset, timezone),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missed_reminder_becomes_catch_up() {
        assert_eq!(decide("2026-09-22T17:00:00Z".parse().unwrap(), "2026-09-22T16:00:00Z".parse().unwrap()), DeliveryDecision::CatchUp);
    }
}
