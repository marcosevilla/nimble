//! Morning-brief composition triggers (addendum §5): the existing 5-minute
//! loop once the local clock passes `brief.time`, and the first Today open of
//! the day (any time). Every run holds one job lock, so a first-open call made
//! while the scheduled run is in flight waits, then finds it done. Demo mode,
//! isolated test profiles and a process that doesn't own the profile never
//! schedule and never call the AI; a first open there still writes the
//! rule-based brief. A restored profile stays inert until it is activated.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use nimble_core::api::llm::AnthropicLlm;
use nimble_core::brief::compose::{self, ComposeOutcome, ComposeRun};
use nimble_core::types::Brief;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub struct BriefRuntime {
    ai_allowed: bool,
    scheduled: bool,
    job: tokio::sync::Mutex<()>,
}

impl BriefRuntime {
    /// `owns_profile`: this process holds the profile owner lock. Only the
    /// owner schedules and spends API calls; another process gets rule-based.
    pub fn new(demo: bool, isolated_test: bool, owns_profile: bool) -> Self {
        let off = demo || isolated_test || !owns_profile;
        Self { ai_allowed: !off, scheduled: !off, job: tokio::sync::Mutex::new(()) }
    }
}

/// The local date whose brief is due at `now`. Wall-clock comparison, so a
/// skipped DST hour still triggers and a repeated one is stopped by the row.
pub fn due_date(now: DateTime<FixedOffset>, brief_time: NaiveTime) -> Option<NaiveDate> {
    (now.time() >= brief_time).then(|| now.date_naive())
}

async fn llm_for(pool: &SqlitePool, runtime: &BriefRuntime) -> Option<AnthropicLlm> {
    if !runtime.ai_allowed {
        return None;
    }
    let key = nimble_core::db::settings::get_setting(pool, "anthropic_api_key").await.ok().flatten()?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    AnthropicLlm::new(key.to_string()).ok()
}

pub enum Mode {
    IfDue,
    Regenerate,
}

/// Ensure today's shell, then compose it (if due) or regenerate it. Only
/// today is ever composed; any other date is read back unchanged. Returns the
/// row and whether a composition was written. A Regenerate that fails while
/// AI picks are on screen writes nothing and errors (`regenerate_failed: …`).
pub async fn run_on(
    pool: &SqlitePool,
    runtime: &BriefRuntime,
    date: &str,
    today: &str,
    now: NaiveDateTime,
    mode: Mode,
) -> nimble_core::Result<(Option<Brief>, bool)> {
    // A restored profile stays inert until activated, like backups and sync.
    nimble_core::db::recovery::require_activation_clear(pool).await?;
    let _job = runtime.job.lock().await;
    if date != today {
        return Ok((nimble_core::db::briefs::get_brief(pool, date).await?, false));
    }
    nimble_core::db::briefs::ensure_snapshot(pool, date, today).await?;
    let llm = llm_for(pool, runtime).await;
    let outcome = match mode {
        Mode::IfDue => compose::compose(pool, llm.as_ref(), ComposeRun { date, now, force: false, regathered: None }).await?,
        Mode::Regenerate => compose::regenerate(pool, llm.as_ref(), date, now).await?,
    };
    let composed = match &outcome {
        ComposeOutcome::Composed { status, error_code } => {
            match error_code {
                Some(code) => log::warn!("Brief composed without AI ({code}); showing rule-based picks"),
                None => log::info!("Brief composed ({status})"),
            }
            true
        }
        ComposeOutcome::Kept { error_code } => {
            log::warn!("Regenerate failed ({error_code}); the brief on screen is kept");
            return Err(nimble_core::Error::Other(format!("regenerate_failed: {error_code}")));
        }
        ComposeOutcome::NotDue => false,
    };
    Ok((nimble_core::db::briefs::get_brief(pool, date).await?, composed))
}

pub async fn run(app: &AppHandle, date: &str, mode: Mode) -> nimble_core::Result<Option<Brief>> {
    let runtime = app.state::<BriefRuntime>();
    let pool = app.state::<SqlitePool>();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Local::now().naive_local();
    let (brief, composed) = run_on(pool.inner(), &runtime, date, &today, now, mode).await?;
    if composed {
        crate::data_events::broadcast(app, crate::data_events::BRIEF, vec![date.to_string()]);
    }
    Ok(brief)
}

/// One scheduler tick (5-minute loop; the first tick fires at launch).
pub async fn tick(app: &AppHandle) {
    let Some(runtime) = app.try_state::<BriefRuntime>() else { return };
    if !runtime.scheduled {
        return;
    }
    let Some(pool) = app.try_state::<SqlitePool>() else { return };
    // A restored profile stays inert until activated, like backups and sync.
    if nimble_core::db::recovery::require_activation_clear(pool.inner()).await.is_err() {
        return;
    }
    let setting = nimble_core::db::settings::get_setting(pool.inner(), "brief.time").await.ok().flatten();
    let Some(date) = due_date(chrono::Local::now().fixed_offset(), compose::parse_brief_time(setting.as_deref())) else { return };
    let date = date.format("%Y-%m-%d").to_string();
    // Cheap check before taking the lock or gathering anything.
    if let Ok(Some(existing)) = nimble_core::db::briefs::get_brief(pool.inner(), &date).await {
        if !compose::compose_due(&existing) {
            return;
        }
    }
    if let Err(e) = run(app, &date, Mode::IfDue).await {
        log::warn!("Scheduled brief did not finish: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, NaiveDate, NaiveTime};

    fn time(s: &str) -> DateTime<chrono::FixedOffset> { DateTime::parse_from_rfc3339(s).unwrap() }
    fn hm(h: u32, m: u32) -> NaiveTime { NaiveTime::from_hms_opt(h, m, 0).unwrap() }

    #[test]
    fn due_once_the_local_clock_passes_brief_time() {
        assert_eq!(due_date(time("2026-09-25T06:29:00-07:00"), hm(6, 30)), None);
        assert_eq!(due_date(time("2026-09-25T06:30:00-07:00"), hm(6, 30)), NaiveDate::from_ymd_opt(2026, 9, 25));
        // Launch at 9:00 after sleeping through 6:30 → catch up now.
        assert_eq!(due_date(time("2026-09-25T09:00:00-07:00"), hm(6, 30)), NaiveDate::from_ymd_opt(2026, 9, 25));
        // Just after midnight the new day isn't due yet; yesterday is never composed.
        assert_eq!(due_date(time("2026-09-26T00:10:00-07:00"), hm(6, 30)), None);
    }

    #[test]
    fn dst_skipped_and_repeated_hours() {
        // Spring forward: 02:30 never happens; 03:00 PDT is past it → due.
        assert_eq!(due_date(time("2026-03-08T03:00:00-07:00"), hm(2, 30)), NaiveDate::from_ymd_opt(2026, 3, 8));
        // Fall back: 01:30 happens twice; both say "due" and the brief row
        // (compose_due) stops the second run.
        for at in ["2026-11-01T01:30:00-07:00", "2026-11-01T01:30:00-08:00"] {
            assert_eq!(due_date(time(at), hm(1, 30)), NaiveDate::from_ymd_opt(2026, 11, 1));
        }
    }

    #[test]
    fn demo_isolated_and_non_owner_profiles_never_call_the_ai_or_schedule() {
        for (demo, isolated, owner) in [(true, false, true), (false, true, true), (true, true, true), (false, false, false)] {
            let r = BriefRuntime::new(demo, isolated, owner);
            assert!(!r.ai_allowed && !r.scheduled, "{demo} {isolated} {owner}");
        }
        let live = BriefRuntime::new(false, false, true);
        assert!(live.ai_allowed && live.scheduled);
    }

    async fn pool() -> SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        nimble_core::db::migrations::run_migrations(&pool).await.unwrap();
        pool
    }

    fn noon() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 9, 25).unwrap().and_hms_opt(12, 0, 0).unwrap()
    }

    #[tokio::test]
    async fn a_restored_profile_composes_nothing_until_activated() {
        let pool = pool().await;
        nimble_core::db::settings::set_setting(&pool, "restored_activation_required", "1").await.unwrap();
        let live = BriefRuntime::new(false, false, true);
        for mode in [Mode::IfDue, Mode::Regenerate] {
            assert!(run_on(&pool, &live, "2026-09-25", "2026-09-25", noon(), mode).await.is_err());
        }
        assert!(nimble_core::db::briefs::get_brief(&pool, "2026-09-25").await.unwrap().is_none(), "not even the shell");
    }

    #[tokio::test]
    async fn a_non_owner_gets_the_rule_based_brief_without_an_api_call() {
        let pool = pool().await;
        nimble_core::db::settings::set_setting(&pool, "anthropic_api_key", "sk-would-be-used").await.unwrap();
        let second = BriefRuntime::new(false, false, false);
        let (brief, composed) = run_on(&pool, &second, "2026-09-25", "2026-09-25", noon(), Mode::IfDue).await.unwrap();
        let brief = brief.unwrap();
        assert!(composed);
        assert_eq!((brief.status.as_str(), brief.model.as_deref()), ("fallback", None), "no client was built");
    }
}
