use std::time::Instant;

pub trait MonotonicClock: Send + Sync {
    fn elapsed_ms(&self) -> u64;
}

/// Production clock: monotonic AND counting system sleep.
///
/// `std::time::Instant` on macOS is `CLOCK_UPTIME_RAW`, which stops while the
/// Mac sleeps — after wake a running session would see only a few seconds of
/// delta, never cross the 40-second gap rule and silently keep running. The
/// focus engine needs the real sleep length (spec §7: a wake credits at most
/// 30 minutes; a sleep without an observed wake is a gap), so it samples a
/// sleep-inclusive monotonic clock instead:
/// `CLOCK_MONOTONIC_RAW` on Darwin (continues during sleep, not slewed) and
/// `CLOCK_BOOTTIME` on Linux. Other targets fall back to `Instant`.
pub struct SystemClock {
    origin_ms: u64,
    fallback: Instant,
}
impl Default for SystemClock {
    fn default() -> Self {
        Self {
            origin_ms: sleep_inclusive_ms().unwrap_or(0),
            fallback: Instant::now(),
        }
    }
}
impl MonotonicClock for SystemClock {
    fn elapsed_ms(&self) -> u64 {
        match sleep_inclusive_ms() {
            Some(now) => now.saturating_sub(self.origin_ms),
            None => self.fallback.elapsed().as_millis().min(u64::MAX as u128) as u64,
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sleep_inclusive_ms() -> Option<u64> {
    #[cfg(target_os = "macos")]
    const CLOCK: libc::clockid_t = libc::CLOCK_MONOTONIC_RAW;
    #[cfg(target_os = "linux")]
    const CLOCK: libc::clockid_t = libc::CLOCK_BOOTTIME;
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `ts` is a valid, writable timespec for the duration of the call.
    if unsafe { libc::clock_gettime(CLOCK, &mut ts) } != 0 {
        return None;
    }
    let secs = u64::try_from(ts.tv_sec).ok()?;
    let nanos = u64::try_from(ts.tv_nsec).ok()?;
    secs.checked_mul(1_000)?.checked_add(nanos / 1_000_000)
}
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn sleep_inclusive_ms() -> Option<u64> {
    None
}

/// An injected clock for deterministic engine tests. Production constructs SystemClock.
#[derive(Default)]
pub struct ManualClock(std::sync::atomic::AtomicU64);
impl ManualClock {
    pub fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, std::sync::atomic::Ordering::SeqCst);
    }
}
impl MonotonicClock for ManualClock {
    fn elapsed_ms(&self) -> u64 {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_clock_is_monotonic_and_starts_near_zero() {
        let clock = SystemClock::default();
        let a = clock.elapsed_ms();
        std::thread::sleep(std::time::Duration::from_millis(15));
        let b = clock.elapsed_ms();
        assert!(a < 1_000, "starts at its own origin");
        assert!(b >= a + 10, "advances with real time ({a} -> {b})");
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn production_clock_uses_the_sleep_inclusive_source() {
        assert!(sleep_inclusive_ms().is_some());
    }
}
