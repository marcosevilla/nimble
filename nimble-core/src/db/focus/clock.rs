use std::time::Instant;

pub trait MonotonicClock: Send + Sync {
    fn elapsed_ms(&self) -> u64;
}

pub struct SystemClock(Instant);
impl Default for SystemClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}
impl MonotonicClock for SystemClock {
    fn elapsed_ms(&self) -> u64 {
        self.0.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
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
