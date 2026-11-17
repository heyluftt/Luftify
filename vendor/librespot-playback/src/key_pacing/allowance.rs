//! Spotify's audio key allowance.
//!
//! Keys come out of an allowance that refills steadily: about 18 at once and
//! one more roughly every 15 seconds. Past it every request is refused with
//! "error audio key 0 2" until a key has refilled. The logs of 11, 17 and
//! 18 Nov 2026 (180 keys, 3 refusals) fit this without a contradiction; no
//! "N keys per five minutes" window fits them. The allowance belongs to the
//! account and outlives an app restart.
use std::time::{Duration, Instant};

/// A little below what the logs show, so no request is refused.
pub(super) const CAPACITY: f64 = 18.0;
pub(super) const REFILL: Duration = Duration::from_secs(16);
/// Keys left to songs the listener starts; preloading does not touch them.
pub(super) const PRELOAD_RESERVE: f64 = 3.0;

pub(super) struct Allowance {
    keys: f64,
    at: Instant,
}

impl Allowance {
    pub(super) fn new(keys: f64, at: Instant) -> Self {
        Self { keys: keys.clamp(0.0, CAPACITY), at }
    }

    pub(super) fn keys(&self, now: Instant) -> f64 {
        let refilled = now.saturating_duration_since(self.at).as_secs_f64() / REFILL.as_secs_f64();
        (self.keys + refilled).min(CAPACITY)
    }

    /// Takes one key and leaves `reserve` untouched, or says how long until
    /// that is possible.
    pub(super) fn take(&mut self, now: Instant, reserve: f64) -> Result<(), Duration> {
        let keys = self.keys(now);
        if keys >= 1.0 + reserve {
            *self = Self { keys: keys - 1.0, at: now };
            return Ok(());
        }
        Err(REFILL.mul_f64(1.0 + reserve - keys))
    }

    /// Spotify refused a key: nothing is left, whatever was assumed.
    pub(super) fn empty(&mut self, now: Instant) {
        *self = Self { keys: 0.0, at: now };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_allowance_gives_its_keys_at_once_then_one_per_refill() {
        let start = Instant::now();
        let mut allowance = Allowance::new(CAPACITY, start);
        for key in 0..CAPACITY as usize {
            assert_eq!(allowance.take(start, 0.0), Ok(()), "key {key}");
        }
        assert_eq!(allowance.take(start, 0.0), Err(REFILL));
        // The wait does not start over for whoever asks next.
        let later = start + REFILL / 4;
        assert_eq!(allowance.take(later, 0.0), Err(REFILL - REFILL / 4));
        assert_eq!(allowance.take(start + REFILL, 0.0), Ok(()));
    }

    #[test]
    fn preloading_leaves_the_reserve() {
        let start = Instant::now();
        let mut allowance = Allowance::new(PRELOAD_RESERVE + 1.0, start);
        assert_eq!(allowance.take(start, PRELOAD_RESERVE), Ok(()));
        assert!(allowance.take(start, PRELOAD_RESERVE).is_err());
        assert_eq!(allowance.take(start, 0.0), Ok(()), "a song the listener starts still gets one");
    }

    #[test]
    fn it_never_refills_past_its_capacity_and_a_refusal_empties_it() {
        let start = Instant::now();
        let mut allowance = Allowance::new(2.0, start);
        assert_eq!(allowance.keys(start + Duration::from_secs(3600)), CAPACITY);
        allowance.empty(start);
        assert_eq!(allowance.take(start, 0.0), Err(REFILL));
    }
}
