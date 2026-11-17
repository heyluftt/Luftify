use super::*;

pub(super) struct SmoothedParameter {
    current: f64,
    target: f64,
    step: f64,
    remaining: usize,
}

impl SmoothedParameter {
    pub(super) fn new(value: f64) -> Self {
        Self {
            current: value,
            target: value,
            step: 0.0,
            remaining: 0,
        }
    }

    pub(super) fn set_target(&mut self, target: f64, frames: usize) {
        if self.target == target {
            return;
        }
        if frames == 0 {
            self.current = target;
            self.target = target;
            self.step = 0.0;
            self.remaining = 0;
            return;
        }
        self.target = target;
        self.step = (target - self.current) / frames as f64;
        self.remaining = frames;
    }

    pub(super) fn next(&mut self) -> f64 {
        if self.remaining > 0 {
            self.current += self.step;
            self.remaining -= 1;
            if self.remaining == 0 {
                self.current = self.target;
            }
        }
        self.current
    }

    pub(super) fn is_idle_at(&self, value: f64) -> bool {
        self.remaining == 0 && (self.current - value).abs() <= f64::EPSILON
    }
}

pub(super) fn feedback_values(
    sample_rate: f64,
    decay_seconds: f64,
    scale: f64,
) -> [f64; FDN_LINE_COUNT] {
    let scale = scale.clamp(0.7, MAX_ROOM_SCALE);
    std::array::from_fn(|index| {
        let delay_seconds = (FDN_DELAY_SECONDS[index] * scale).max(1.0 / sample_rate);
        10.0_f64
            .powf(-3.0 * delay_seconds / decay_seconds.max(0.1))
            .clamp(0.0, 0.995)
    })
}

/// Per-line gain of the bass band relative to the (damping-compensated)
/// mid feedback, so that bass decays `bass_ratio` times as long as 1 kHz.
/// The treble damping barely touches the bass, so the compensation alone
/// would already lengthen it; this corrects in both directions.
pub(super) fn bass_boost_values(
    sample_rate: f64,
    decay_seconds: f64,
    scale: f64,
    bass_ratio: f64,
    mid_feedback: [f64; FDN_LINE_COUNT],
) -> [f64; FDN_LINE_COUNT] {
    let low = feedback_values(sample_rate, decay_seconds * bass_ratio.max(1.0), scale);
    std::array::from_fn(|index| (low[index] / mid_feedback[index].max(1.0e-6)).clamp(0.8, 1.25))
}

/// The late network stretches its lines only this far; longer rooms get
/// their length from feedback. Longer lines made big halls grainy.
pub(super) fn network_scale(room_scale: f64) -> f64 {
    room_scale.min(FDN_MAX_SCALE)
}

/// Gain of the in-loop treble damping at 1 kHz. Feedback divides it out so
/// that the decay control is the reverb time at 1 kHz, as rooms are rated;
/// before, damping silently shortened a 2.4 s hall to 2.1 s.
pub(super) fn compensate_damping(
    feedback: [f64; FDN_LINE_COUNT],
    sample_rate: f64,
    damping_alpha: f64,
) -> [f64; FDN_LINE_COUNT] {
    let omega = std::f64::consts::TAU * 1_000.0 / sample_rate;
    let pole = 1.0 - damping_alpha;
    let denominator = ((1.0 - pole * omega.cos()).powi(2) + (pole * omega.sin()).powi(2)).sqrt();
    let gain = (damping_alpha / denominator).clamp(0.5, 1.0);
    feedback.map(|value| (value / gain).min(0.995))
}

pub(super) fn damping_alpha(sample_rate: f64, damping_percent: f64) -> f64 {
    let normalized = (damping_percent / 100.0).clamp(0.0, 1.0);
    let cutoff = 12_500.0 * (1_300.0_f64 / 12_500.0).powf(normalized);
    (1.0 - (-std::f64::consts::TAU * cutoff / sample_rate).exp()).clamp(0.0, 1.0)
}

pub(super) fn room_scale(decay_seconds: f64) -> f64 {
    let normalized = ((decay_seconds - 0.35) / (5.5 - 0.35)).clamp(0.0, 1.0);
    (0.78 + normalized.powf(0.72) * 1.72).clamp(0.7, MAX_ROOM_SCALE)
}

pub(super) fn one_pole_alpha(sample_rate: f64, cutoff_hz: f64) -> f64 {
    (1.0 - (-std::f64::consts::TAU * cutoff_hz / sample_rate).exp()).clamp(0.0, 1.0)
}
