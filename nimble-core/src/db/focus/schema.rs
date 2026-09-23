use crate::focus_types::{FocusConfig, FocusMode, MAX_SAFE_INTEGER};

pub fn validate_config(config: &FocusConfig) -> crate::Result<()> {
    fn whole_minutes(ms: u64) -> bool { ms >= 60_000 && ms <= 86_400_000 && ms % 60_000 == 0 }
    let invalid = || crate::Error::Other("invalid focus configuration".into());
    if config.work_ms > MAX_SAFE_INTEGER || config.break_ms > MAX_SAFE_INTEGER ||
        config.budget_ms.is_some_and(|v| v > MAX_SAFE_INTEGER) { return Err(invalid()); }
    match config.mode {
        FocusMode::CountUp if config.budget_ms.is_none() => Ok(()),
        FocusMode::Timebox if config.budget_ms.is_some_and(whole_minutes) => Ok(()),
        FocusMode::Pomodoro if config.budget_ms.is_none() && whole_minutes(config.work_ms) &&
            whole_minutes(config.break_ms) && (1..=100).contains(&config.rounds) => Ok(()),
        _ => Err(invalid()),
    }
}
