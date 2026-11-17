use std::sync::{
    Arc, RwLock,
    atomic::{AtomicU64, Ordering},
};

use crate::{
    DspSettings, EQ_BAND_COUNT, EQ_FREQUENCIES_HZ,
    filters::{BiquadCoefficients, BiquadState},
    limiter::LookaheadLimiter,
    spatial::SpatialProcessor,
};

const EQ_Q: f64 = 1.4;
const PARAMETER_SMOOTHING_MS: f64 = 28.0;

#[derive(Clone)]
pub struct DspControl {
    shared: Arc<ControlState>,
}

struct ControlState {
    settings: RwLock<DspSettings>,
    generation: AtomicU64,
}

impl Default for DspControl {
    fn default() -> Self {
        Self::new(DspSettings::default())
    }
}

impl DspControl {
    #[must_use]
    pub fn new(settings: DspSettings) -> Self {
        Self {
            shared: Arc::new(ControlState {
                settings: RwLock::new(settings.sanitized()),
                generation: AtomicU64::new(1),
            }),
        }
    }

    pub fn update(&self, settings: DspSettings) {
        let sanitized = settings.sanitized();
        let mut current = self
            .shared
            .settings
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *current == sanitized {
            return;
        }
        *current = sanitized;
        self.shared.generation.fetch_add(1, Ordering::Release);
    }

    #[must_use]
    pub fn settings(&self) -> DspSettings {
        self.shared
            .settings
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn snapshot_after(&self, generation: u64) -> Option<(u64, DspSettings)> {
        let next_generation = self.shared.generation.load(Ordering::Acquire);
        if next_generation == generation {
            return None;
        }
        Some((next_generation, self.settings()))
    }
}

pub struct DspProcessor {
    control: DspControl,
    generation: u64,
    sample_rate: f64,
    equalizer: [StereoBiquad; EQ_BAND_COUNT],
    preamp: SmoothedValue,
    output_gain: SmoothedValue,
    wet_mix: SmoothedValue,
    spatial: SpatialProcessor,
    limiter: LookaheadLimiter,
    limiter_enabled: bool,
}

impl DspProcessor {
    #[must_use]
    pub fn new(sample_rate: u32, control: DspControl) -> Self {
        let sample_rate = f64::from(sample_rate.max(8_000));
        let settings = control.settings();
        let equalizer = std::array::from_fn(|index| {
            StereoBiquad::new(BiquadCoefficients::peak(
                sample_rate,
                EQ_FREQUENCIES_HZ[index],
                EQ_Q,
                f64::from(settings.bands_db[index]),
            ))
        });
        Self {
            control,
            generation: 0,
            sample_rate,
            equalizer,
            preamp: SmoothedValue::new(db_to_gain(settings.effective_preamp_db())),
            output_gain: SmoothedValue::new(db_to_gain(settings.effective_volume_boost_db())),
            wet_mix: SmoothedValue::new(if settings.enabled { 1.0 } else { 0.0 }),
            spatial: SpatialProcessor::new(sample_rate, &settings.spatial),
            limiter: LookaheadLimiter::new(sample_rate),
            limiter_enabled: settings.limiter_enabled,
        }
        .with_initial_settings(settings, 0)
    }

    pub fn process_interleaved_stereo(&mut self, samples: &mut [f64]) {
        self.sync_settings();
        if self.wet_mix.is_idle_at(0.0)
            && self.spatial.is_idle_bypassed()
            && self.output_gain.is_idle_at(1.0)
        {
            // The limiter's look-ahead delay keeps running, so bypassing the
            // stages never shifts the timeline.
            for frame in samples.chunks_exact_mut(2) {
                let (left, right) =
                    self.limiter
                        .process(finite_sample(frame[0]), finite_sample(frame[1]), false);
                (frame[0], frame[1]) = (full_scale(left), full_scale(right));
            }
            return;
        }

        for frame in samples.chunks_exact_mut(2) {
            let dry_left = finite_sample(frame[0]);
            let dry_right = finite_sample(frame[1]);
            let equalizer_mix = self.wet_mix.next();
            let (mut processed_left, mut processed_right) = (dry_left, dry_right);
            if equalizer_mix > 1.0e-8 {
                let preamp = self.preamp.next();
                let mut equalized_left = dry_left * preamp;
                let mut equalized_right = dry_right * preamp;
                for band in &mut self.equalizer {
                    (equalized_left, equalized_right) =
                        band.process(equalized_left, equalized_right);
                }
                processed_left = dry_left + (equalized_left - dry_left) * equalizer_mix;
                processed_right = dry_right + (equalized_right - dry_right) * equalizer_mix;
            }

            let spatial_active;
            (processed_left, processed_right, spatial_active) =
                self.spatial.process(processed_left, processed_right);
            let output_gain = self.output_gain.next();
            processed_left *= output_gain;
            processed_right *= output_gain;
            let boost_active = output_gain > 1.0 + 1.0e-8;
            let limit = limiter_should_process(
                self.limiter_enabled,
                boost_active,
                equalizer_mix > 1.0e-8,
                spatial_active,
            );
            (processed_left, processed_right) =
                self.limiter.process(processed_left, processed_right, limit);
            frame[0] = full_scale(processed_left);
            frame[1] = full_scale(processed_right);
        }
    }

    /// Forgets the sound of the previous audio (filter memory, hall,
    /// look-ahead), so a skip or seek does not carry it into what plays next.
    /// Settings stay.
    pub fn clear_tail(&mut self) {
        for band in &mut self.equalizer {
            band.left.clear();
            band.right.clear();
        }
        self.spatial.clear_tail();
        self.limiter = LookaheadLimiter::new(self.sample_rate);
    }

    fn with_initial_settings(mut self, settings: DspSettings, smoothing_frames: usize) -> Self {
        self.apply_settings(&settings, smoothing_frames);
        self.generation = self.control.shared.generation.load(Ordering::Acquire);
        self
    }

    fn sync_settings(&mut self) {
        let Some((generation, settings)) = self.control.snapshot_after(self.generation) else {
            return;
        };
        self.apply_settings(&settings, smoothing_frames(self.sample_rate));
        self.generation = generation;
    }

    fn apply_settings(&mut self, settings: &DspSettings, smoothing_frames: usize) {
        let settings = settings.sanitized();
        self.wet_mix
            .set_target(if settings.enabled { 1.0 } else { 0.0 }, smoothing_frames);
        self.preamp
            .set_target(db_to_gain(settings.effective_preamp_db()), smoothing_frames);
        self.output_gain.set_target(
            db_to_gain(settings.effective_volume_boost_db()),
            smoothing_frames,
        );
        for (index, band) in self.equalizer.iter_mut().enumerate() {
            band.set_target(
                BiquadCoefficients::peak(
                    self.sample_rate,
                    EQ_FREQUENCIES_HZ[index],
                    EQ_Q,
                    f64::from(settings.bands_db[index]),
                ),
                smoothing_frames,
            );
        }
        self.spatial
            .set_settings(&settings.spatial, smoothing_frames);
        self.limiter_enabled = settings.limiter_enabled;
    }
}

/// Per-frame coefficient step for gliding one filter into another.
fn coefficient_delta(
    from: BiquadCoefficients,
    to: BiquadCoefficients,
    frames: usize,
) -> BiquadCoefficients {
    let frames = frames.max(1) as f64;
    BiquadCoefficients {
        b0: (to.b0 - from.b0) / frames,
        b1: (to.b1 - from.b1) / frames,
        b2: (to.b2 - from.b2) / frames,
        a1: (to.a1 - from.a1) / frames,
        a2: (to.a2 - from.a2) / frames,
    }
}

fn add_coefficients(value: &mut BiquadCoefficients, delta: BiquadCoefficients) {
    value.b0 += delta.b0;
    value.b1 += delta.b1;
    value.b2 += delta.b2;
    value.a1 += delta.a1;
    value.a2 += delta.a2;
}

struct StereoBiquad {
    coefficients: BiquadCoefficients,
    target: BiquadCoefficients,
    delta: BiquadCoefficients,
    remaining: usize,
    left: BiquadState,
    right: BiquadState,
}

impl StereoBiquad {
    fn new(coefficients: BiquadCoefficients) -> Self {
        Self {
            coefficients,
            target: coefficients,
            delta: coefficient_delta(coefficients, coefficients, 1),
            remaining: 0,
            left: BiquadState::default(),
            right: BiquadState::default(),
        }
    }

    fn set_target(&mut self, target: BiquadCoefficients, frames: usize) {
        self.target = target;
        self.delta = coefficient_delta(self.coefficients, target, frames);
        self.remaining = frames;
    }

    fn process(&mut self, left: f64, right: f64) -> (f64, f64) {
        if self.remaining > 0 {
            add_coefficients(&mut self.coefficients, self.delta);
            self.remaining -= 1;
            if self.remaining == 0 {
                self.coefficients = self.target;
            }
        }
        (
            self.left.process(left, self.coefficients),
            self.right.process(right, self.coefficients),
        )
    }
}

struct SmoothedValue {
    current: f64,
    target: f64,
    step: f64,
    remaining: usize,
}

impl SmoothedValue {
    fn new(value: f64) -> Self {
        Self {
            current: value,
            target: value,
            step: 0.0,
            remaining: 0,
        }
    }

    fn set_target(&mut self, target: f64, frames: usize) {
        self.target = target;
        self.remaining = frames;
        self.step = (target - self.current) / frames.max(1) as f64;
    }

    fn next(&mut self) -> f64 {
        if self.remaining > 0 {
            self.current += self.step;
            self.remaining -= 1;
            if self.remaining == 0 {
                self.current = self.target;
            }
        }
        self.current
    }

    fn is_idle_at(&self, value: f64) -> bool {
        self.remaining == 0 && (self.current - value).abs() <= f64::EPSILON
    }
}

fn smoothing_frames(sample_rate: f64) -> usize {
    ((sample_rate * PARAMETER_SMOOTHING_MS / 1_000.0).round() as usize).max(1)
}

fn db_to_gain(db: f64) -> f64 {
    10.0_f64.powf(db / 20.0)
}

/// Hard clip at digital full scale. The output is float now, and Windows
/// softens float overs with its own limiter; without this, turning peak
/// protection off no longer overdrove like the former 16-bit output did.
fn full_scale(sample: f64) -> f64 {
    sample.clamp(-1.0, 1.0)
}

fn finite_sample(sample: f64) -> f64 {
    if sample.is_finite() { sample } else { 0.0 }
}

fn limiter_should_process(
    limiter_enabled: bool,
    boost_active: bool,
    equalizer_active: bool,
    spatial_active: bool,
) -> bool {
    limiter_enabled && (boost_active || equalizer_active || spatial_active)
}

#[cfg(test)]
mod tests {
    use super::{DspControl, DspProcessor, limiter_should_process};
    use crate::DspSettings;

    #[test]
    fn without_peak_protection_a_boost_clips_hard_at_full_scale() {
        let settings = DspSettings {
            limiter_enabled: false,
            volume_boost_enabled: true,
            volume_boost_db: 9.0,
            ..DspSettings::default()
        };
        let mut processor = DspProcessor::new(48_000, DspControl::new(settings));
        let mut samples: Vec<f64> = (0..9_600)
            .flat_map(|index| {
                let value = (index as f64 * 0.03).sin() * 0.8;
                [value, value]
            })
            .collect();
        processor.process_interleaved_stereo(&mut samples);
        let settled = &samples[4_800..];
        assert!(settled.iter().all(|sample| sample.abs() <= 1.0));
        // Flat-topped: many samples sit exactly on full scale.
        let clipped = settled.iter().filter(|sample| sample.abs() == 1.0).count();
        assert!(clipped > settled.len() / 4, "{clipped} clipped samples");
    }

    #[test]
    fn peak_protection_covers_every_active_dsp_stage() {
        assert!(limiter_should_process(true, true, false, false));
        assert!(limiter_should_process(true, false, true, false));
        assert!(limiter_should_process(true, false, false, true));
        assert!(!limiter_should_process(true, false, false, false));
    }

    #[test]
    fn disabled_peak_protection_bypasses_the_limiter_for_every_stage() {
        assert!(!limiter_should_process(false, true, false, false));
        assert!(!limiter_should_process(false, false, true, false));
        assert!(!limiter_should_process(false, false, false, true));
    }
}
