//! Look-ahead peak limiter.
//!
//! The previous limiter snapped its gain to the ceiling on the very sample
//! that exceeded it. That instant gain step acts like a clipper and is
//! audible on bass-heavy EQ or boost. Here the gain starts falling
//! `LOOKAHEAD` before a peak and reaches the required reduction exactly when
//! the peak leaves the delay line:
//!
//! - `hold` is the minimum required gain over the last `L + 1` input frames,
//! - `smooth` averages the last `L` hold values (a linear fade),
//! - every hold value in that average already covers the delayed frame, so
//!   the fade can never undershoot the peak it prepares for.
//!
//! The delay line runs even while nothing is limited, so switching DSP
//! stages never shifts the timeline (no click from a jump in latency).

const LOOKAHEAD_MS: f64 = 1.5;
const CEILING_DB: f64 = -0.35;
const RELEASE_MS: f64 = 120.0;

pub(crate) struct LookaheadLimiter {
    ceiling: f64,
    release_coefficient: f64,
    delay: Vec<[f64; 2]>,
    required: Vec<f64>,
    hold_window: MinWindow,
    hold_ring: Vec<f64>,
    hold_sum: f64,
    index: usize,
    envelope: f64,
}

impl LookaheadLimiter {
    pub(crate) fn new(sample_rate: f64) -> Self {
        let length = ((sample_rate * LOOKAHEAD_MS / 1_000.0).round() as usize).max(2);
        Self {
            ceiling: 10.0_f64.powf(CEILING_DB / 20.0),
            release_coefficient: (-1.0 / (RELEASE_MS / 1_000.0 * sample_rate)).exp(),
            delay: vec![[0.0; 2]; length],
            required: vec![1.0; length],
            // One frame longer than the delay, so it spans the delayed frame too.
            hold_window: MinWindow::new(length + 1),
            hold_ring: vec![1.0; length],
            hold_sum: length as f64,
            index: 0,
            envelope: 1.0,
        }
    }

    /// Delays the frame by the look-ahead and, when `limit` is set, keeps
    /// its peak at or below the ceiling. Unlimited frames pass unchanged.
    pub(crate) fn process(&mut self, left: f64, right: f64, limit: bool) -> (f64, f64) {
        let length = self.delay.len();
        let [delayed_left, delayed_right] = self.delay[self.index];
        self.delay[self.index] = [left, right];

        let peak = left.abs().max(right.abs());
        let required = if limit && peak > self.ceiling {
            self.ceiling / peak
        } else {
            1.0
        };
        self.required[self.index] = required;
        let hold = self.hold_window.push(required);
        self.hold_sum += hold - self.hold_ring[self.index];
        self.hold_ring[self.index] = hold;
        self.index = (self.index + 1) % length;
        if self.index == 0 {
            // Re-anchor the running sum so rounding cannot drift.
            self.hold_sum = self.hold_ring.iter().sum();
        }

        let smooth = (self.hold_sum / length as f64).min(1.0);
        self.envelope = if smooth < self.envelope {
            smooth
        } else {
            smooth - (smooth - self.envelope) * self.release_coefficient
        };
        (delayed_left * self.envelope, delayed_right * self.envelope)
    }

    #[cfg(test)]
    pub(crate) fn latency_frames(&self) -> usize {
        self.delay.len()
    }
}

/// Sliding minimum over a fixed window, without allocation per sample.
struct MinWindow {
    values: Vec<f64>,
    positions: Vec<u64>,
    head: usize,
    len: usize,
    position: u64,
    window: u64,
}

impl MinWindow {
    fn new(window: usize) -> Self {
        Self {
            values: vec![1.0; window + 1],
            positions: vec![0; window + 1],
            head: 0,
            len: 0,
            position: 0,
            window: window as u64,
        }
    }

    fn push(&mut self, value: f64) -> f64 {
        let capacity = self.values.len();
        // Drop larger values from the back; they can never be the minimum again.
        while self.len > 0 {
            let back = (self.head + self.len - 1) % capacity;
            if self.values[back] >= value {
                self.len -= 1;
            } else {
                break;
            }
        }
        let slot = (self.head + self.len) % capacity;
        self.values[slot] = value;
        self.positions[slot] = self.position;
        self.len += 1;
        // Drop values that left the window from the front.
        while self.positions[self.head] + self.window <= self.position {
            self.head = (self.head + 1) % capacity;
            self.len -= 1;
        }
        self.position += 1;
        self.values[self.head]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sudden_peak_is_held_at_the_ceiling_without_a_gain_step() {
        let rate = 48_000.0;
        let mut limiter = LookaheadLimiter::new(rate);
        let latency = limiter.latency_frames();
        let ceiling = 10.0_f64.powf(CEILING_DB / 20.0);
        let mut output = Vec::new();
        for index in 0..4_800 {
            let input = if (1_000..1_400).contains(&index) {
                1.8
            } else {
                0.4
            };
            output.push(limiter.process(input, -input, true).0);
        }
        assert!(output.iter().all(|sample| sample.abs() <= ceiling + 1.0e-9));
        // The fade starts before the delayed peak instead of on it.
        let before_peak = output[1_000 + latency - 1].abs();
        assert!(
            before_peak < 0.4 - 1.0e-3,
            "no look-ahead fade: {before_peak}"
        );
        let largest_step = output
            .windows(2)
            // After the empty delay line filled, up to the signal's own jump.
            .take(1_000 + latency - 1)
            .skip(latency + 1)
            .map(|pair| (pair[1] - pair[0]).abs())
            .fold(0.0, f64::max);
        assert!(largest_step < 0.02, "gain step: {largest_step}");
    }

    #[test]
    fn unlimited_audio_is_only_delayed() {
        let mut limiter = LookaheadLimiter::new(44_100.0);
        let latency = limiter.latency_frames();
        let input: Vec<f64> = (0..400)
            .map(|index| (index as f64 * 0.05).sin() * 0.5)
            .collect();
        let output: Vec<f64> = input
            .iter()
            .map(|sample| limiter.process(*sample, *sample, false).0)
            .collect();
        for index in latency..input.len() {
            assert!((output[index] - input[index - latency]).abs() < 1.0e-12);
        }
    }
}
