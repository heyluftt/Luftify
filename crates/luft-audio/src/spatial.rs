use crate::SpatialSettings;
mod binaural;
mod cabin;
#[cfg(test)]
mod character_tests;
mod delays;
mod diffusion;
mod hrir_data;
mod network;
mod parameters;
mod reflections;
mod rooms;
#[cfg(test)]
mod tests;
use delays::VariableStereoDelay;
use diffusion::StereoDiffuser;
use network::FdnReverb;
use parameters::*;
use reflections::EarlyReflections;

const FDN_LINE_COUNT: usize = 8;
const FDN_DELAY_SECONDS: [f64; FDN_LINE_COUNT] = [
    0.0319, 0.0413, 0.0473, 0.0539, 0.0629, 0.0743, 0.0881, 0.1049,
];
const FDN_MODULATION_HZ: [f64; FDN_LINE_COUNT] =
    [0.071, 0.089, 0.107, 0.127, 0.149, 0.083, 0.113, 0.137];
const FDN_MODULATION_MS: [f64; FDN_LINE_COUNT] = [0.18, 0.24, 0.16, 0.29, 0.21, 0.26, 0.17, 0.23];
const MAX_PRE_DELAY_SECONDS: f64 = 0.082;
const MAX_ROOM_SCALE: f64 = 2.55;
const FDN_MAX_SCALE: f64 = 1.6;
const REVERB_INPUT_GAIN: f64 = 0.26;
const REVERB_OUTPUT_GAIN: f64 = 0.52;
const EARLY_REFLECTION_GAIN: f64 = 0.52;
const WIDTH_PROTECTION_HZ: f64 = 145.0;
const REVERB_LOW_CUT_HZ: f64 = 82.0;
const DRY_AIR_HZ: f64 = 3_400.0;
const ROOM_MAKEUP_DB: f64 = 14.0;

pub(crate) struct SpatialProcessor {
    sample_rate: f64,
    cabin: cabin::Cabin,
    cabin_mix: SmoothedParameter,
    cabin_cleared: bool,
    mix_percent: SmoothedParameter,
    stereo_width: SmoothedParameter,
    pre_delay_samples: SmoothedParameter,
    room_scale: SmoothedParameter,
    decay_seconds: SmoothedParameter,
    damping_alpha: SmoothedParameter,
    feedback: [SmoothedParameter; FDN_LINE_COUNT],
    bass_boost: [SmoothedParameter; FDN_LINE_COUNT],
    pre_delay: VariableStereoDelay,
    early_reflections: EarlyReflections,
    diffuser: StereoDiffuser,
    reverb: FdnReverb,
    reverb_cleared: bool,
    /// The room network holds no state (skipped while only the car plays).
    room_clean: bool,
    side_lowpass: f64,
    side_lowpass_alpha: f64,
    reverb_lowpass_left: f64,
    reverb_lowpass_right: f64,
    reverb_lowpass_alpha: f64,
    dry_air_left: f64,
    dry_air_right: f64,
    dry_air_alpha: f64,
}

impl SpatialProcessor {
    pub(crate) fn new(sample_rate: f64, settings: &SpatialSettings) -> Self {
        let settings = settings.sanitized();
        let mix_percent = if settings.enabled {
            f64::from(settings.mix_percent)
        } else {
            0.0
        };
        let stereo_width = if settings.enabled {
            f64::from(settings.stereo_width_percent) / 100.0
        } else {
            1.0
        };
        let decay = f64::from(settings.decay_seconds);
        let shape = rooms::room_shape(decay);
        let network = network_scale(room_scale(decay));
        let feedback_values = compensate_damping(
            feedback_values(sample_rate, decay, network),
            sample_rate,
            damping_alpha(sample_rate, f64::from(settings.damping_percent)),
        );
        let bass_values = bass_boost_values(
            sample_rate,
            decay,
            network,
            shape.bass_ratio,
            feedback_values,
        );
        Self {
            sample_rate,
            cabin: cabin::Cabin::new(sample_rate),
            cabin_mix: SmoothedParameter::new(
                if settings.cabin_mode || settings.preset_id == "car" {
                    1.0
                } else {
                    0.0
                },
            ),
            cabin_cleared: true,
            mix_percent: SmoothedParameter::new(mix_percent),
            stereo_width: SmoothedParameter::new(stereo_width),
            pre_delay_samples: SmoothedParameter::new(
                sample_rate * f64::from(settings.pre_delay_ms) / 1_000.0,
            ),
            room_scale: SmoothedParameter::new(room_scale(f64::from(settings.decay_seconds))),
            decay_seconds: SmoothedParameter::new(f64::from(settings.decay_seconds)),
            damping_alpha: SmoothedParameter::new(damping_alpha(
                sample_rate,
                f64::from(settings.damping_percent),
            )),
            feedback: std::array::from_fn(|index| SmoothedParameter::new(feedback_values[index])),
            bass_boost: std::array::from_fn(|index| SmoothedParameter::new(bass_values[index])),
            pre_delay: VariableStereoDelay::new(
                (sample_rate * MAX_PRE_DELAY_SECONDS).ceil() as usize + 2,
            ),
            early_reflections: EarlyReflections::new(sample_rate, &shape),
            diffuser: StereoDiffuser::new(sample_rate),
            reverb: FdnReverb::new(sample_rate),
            reverb_cleared: true,
            room_clean: true,
            side_lowpass: 0.0,
            side_lowpass_alpha: one_pole_alpha(sample_rate, WIDTH_PROTECTION_HZ),
            reverb_lowpass_left: 0.0,
            reverb_lowpass_right: 0.0,
            reverb_lowpass_alpha: one_pole_alpha(sample_rate, REVERB_LOW_CUT_HZ),
            dry_air_left: 0.0,
            dry_air_right: 0.0,
            dry_air_alpha: one_pole_alpha(sample_rate, DRY_AIR_HZ),
        }
    }

    pub(crate) fn set_settings(&mut self, settings: &SpatialSettings, smoothing_frames: usize) {
        let settings = settings.sanitized();
        let room_smoothing = smoothing_frames.max((self.sample_rate * 0.08).round() as usize);
        self.cabin_mix.set_target(
            if settings.cabin_mode || settings.preset_id == "car" {
                1.0
            } else {
                0.0
            },
            room_smoothing,
        );
        self.mix_percent.set_target(
            if settings.enabled {
                f64::from(settings.mix_percent)
            } else {
                0.0
            },
            room_smoothing,
        );
        self.stereo_width.set_target(
            if settings.enabled {
                f64::from(settings.stereo_width_percent) / 100.0
            } else {
                1.0
            },
            smoothing_frames,
        );
        self.pre_delay_samples.set_target(
            self.sample_rate * f64::from(settings.pre_delay_ms) / 1_000.0,
            room_smoothing,
        );
        self.room_scale.set_target(
            room_scale(f64::from(settings.decay_seconds)),
            room_smoothing,
        );
        self.decay_seconds
            .set_target(f64::from(settings.decay_seconds), room_smoothing);
        self.damping_alpha.set_target(
            damping_alpha(self.sample_rate, f64::from(settings.damping_percent)),
            room_smoothing,
        );
        let decay = f64::from(settings.decay_seconds);
        let shape = rooms::room_shape(decay);
        let network = network_scale(room_scale(decay));
        let feedback_values = compensate_damping(
            feedback_values(self.sample_rate, decay, network),
            self.sample_rate,
            damping_alpha(self.sample_rate, f64::from(settings.damping_percent)),
        );
        for (parameter, target) in self.feedback.iter_mut().zip(feedback_values) {
            parameter.set_target(target, room_smoothing);
        }
        let bass_values = bass_boost_values(
            self.sample_rate,
            decay,
            network,
            shape.bass_ratio,
            feedback_values,
        );
        for (parameter, target) in self.bass_boost.iter_mut().zip(bass_values) {
            parameter.set_target(target, room_smoothing);
        }
        self.early_reflections.set_shape(&shape, room_smoothing);
    }

    pub(crate) fn is_idle_bypassed(&self) -> bool {
        self.mix_percent.is_idle_at(0.0) && self.stereo_width.is_idle_at(1.0)
    }

    pub(crate) fn process(&mut self, left: f64, right: f64) -> (f64, f64, bool) {
        let cabin_mix = self.cabin_mix.next();
        let width = self.stereo_width.next();
        let middle = (left + right) * 0.5;
        let input_side = (left - right) * 0.5;
        self.side_lowpass += self.side_lowpass_alpha * (input_side - self.side_lowpass);
        let side = self.side_lowpass + (input_side - self.side_lowpass) * width;
        let staged_left = middle + side;
        let staged_right = middle - side;
        let mix = (self.mix_percent.next() / 100.0).clamp(0.0, 0.3);
        let width_active = (width - 1.0).abs() > 1.0e-6;

        if mix <= 1.0e-8 {
            if !self.reverb_cleared {
                self.clear_reverb();
            }
            return (staged_left, staged_right, width_active);
        }

        self.reverb_cleared = false;
        // Advance every smoothed control each frame, whichever model runs.
        let room_scale = self.room_scale.next();
        let decay_seconds = self.decay_seconds.next();
        let pre_delay_samples = self.pre_delay_samples.next();
        let damping_alpha = self.damping_alpha.next();
        let feedback = std::array::from_fn(|index| self.feedback[index].next());
        let bass_boost = std::array::from_fn(|index| self.bass_boost[index].next());

        // Only the car plays: the room network would be crossfaded away.
        let regular = if cabin_mix >= 1.0 - 1.0e-9 {
            if !self.room_clean {
                self.clear_room();
            }
            (staged_left, staged_right)
        } else {
            self.room_clean = false;
            self.room(
                (staged_left, staged_right),
                mix,
                width,
                room_scale,
                pre_delay_samples,
                damping_alpha,
                feedback,
                bass_boost,
            )
        };
        if cabin_mix > 1.0e-8 {
            self.cabin_cleared = false;
            let (cabin_left, cabin_right) = self.cabin.process(
                staged_left,
                staged_right,
                damping_alpha,
                pre_delay_samples,
                decay_seconds,
            );
            // 30 % is the full car; below it the dry signal is mixed back in.
            let amount = mix / 0.3;
            let car_left = staged_left + (cabin_left - staged_left) * amount;
            let car_right = staged_right + (cabin_right - staged_right) * amount;
            return (
                regular.0 + (car_left - regular.0) * cabin_mix,
                regular.1 + (car_right - regular.1) * cabin_mix,
                true,
            );
        }
        if !self.cabin_cleared {
            self.cabin.clear();
            self.cabin_cleared = true;
        }
        (regular.0, regular.1, true)
    }

    #[allow(clippy::too_many_arguments)]
    fn room(
        &mut self,
        (staged_left, staged_right): (f64, f64),
        mix: f64,
        width: f64,
        room_scale: f64,
        pre_delay_samples: f64,
        damping_alpha: f64,
        feedback: [f64; FDN_LINE_COUNT],
        bass_boost: [f64; FDN_LINE_COUNT],
    ) -> (f64, f64) {
        let distance = ((room_scale - 0.92) / 1.55).clamp(0.0, 1.0);
        self.dry_air_left += self.dry_air_alpha * (staged_left - self.dry_air_left);
        self.dry_air_right += self.dry_air_alpha * (staged_right - self.dry_air_right);
        // Approach dry continuously: even a tiny wet mix must not darken vocals.
        let air = distance * 0.36 * (mix / 0.3);
        let dry_left = staged_left * (1.0 - air) + self.dry_air_left * air;
        let dry_right = staged_right * (1.0 - air) + self.dry_air_right * air;

        let (delayed_left, delayed_right) =
            self.pre_delay
                .process(staged_left, staged_right, pre_delay_samples);
        self.reverb_lowpass_left +=
            self.reverb_lowpass_alpha * (delayed_left - self.reverb_lowpass_left);
        self.reverb_lowpass_right +=
            self.reverb_lowpass_alpha * (delayed_right - self.reverb_lowpass_right);
        let late_send_left = delayed_left - self.reverb_lowpass_left;
        let late_send_right = delayed_right - self.reverb_lowpass_right;
        let (early_left, early_right) =
            self.early_reflections
                .process(late_send_left, late_send_right, damping_alpha);
        let (diffused_left, diffused_right) =
            self.diffuser.process(late_send_left, late_send_right);
        let (late_left, late_right) = self.reverb.process(
            diffused_left,
            diffused_right,
            damping_alpha,
            feedback,
            bass_boost,
            network_scale(room_scale),
        );
        // The FDN already decorrelates both channels; do not delay only the right ear.
        let early_gain = EARLY_REFLECTION_GAIN * (1.0 + distance * 0.72);
        let mut wet_left = late_left + early_left * early_gain;
        let mut wet_right = late_right + early_right * early_gain;
        let wet_mid = (wet_left + wet_right) * 0.5;
        let wet_side = (wet_left - wet_right) * 0.5;
        let wet_spread = (0.92 + width * 0.42) * (0.88 + (room_scale - 0.75).max(0.0) * 0.38);
        wet_left = wet_mid + wet_side * wet_spread;
        wet_right = wet_mid - wet_side * wet_spread;

        let recede = mix * (0.55 + 1.15 * distance);
        // Receding lowers the direct level; make that back up so a large
        // hall sounds distant, not simply quieter (-3.5 dB K-weighted before).
        let makeup = 10.0_f64.powf(ROOM_MAKEUP_DB * mix * distance / 20.0);
        let dry_gain = (1.0 - recede).clamp(0.5, 1.0) * makeup;
        let wet_gain = mix * (1.45 + 0.72 * distance) * makeup;
        (
            dry_left * dry_gain + wet_left * wet_gain,
            dry_right * dry_gain + wet_right * wet_gain,
        )
    }

    fn clear_room(&mut self) {
        self.pre_delay.clear();
        self.early_reflections.clear();
        self.diffuser.clear();
        self.reverb.clear();
        self.reverb_lowpass_left = 0.0;
        self.reverb_lowpass_right = 0.0;
        self.dry_air_left = 0.0;
        self.dry_air_right = 0.0;
        self.room_clean = true;
    }

    /// Forgets the hall of the previous audio (see `DspProcessor::clear_tail`).
    pub(crate) fn clear_tail(&mut self) {
        self.side_lowpass = 0.0;
        self.clear_reverb();
    }

    fn clear_reverb(&mut self) {
        self.cabin.clear();
        self.cabin_cleared = true;
        self.clear_room();
        self.reverb_cleared = true;
    }
}

fn milliseconds_to_samples(sample_rate: f64, milliseconds: f64) -> usize {
    ((sample_rate * milliseconds / 1_000.0).round() as usize).max(1)
}

fn read_fractional(buffer: &[f64], write_index: usize, delay_samples: f64) -> f64 {
    let read_position = (write_index as f64 - delay_samples).rem_euclid(buffer.len() as f64);
    let first = read_position.floor() as usize;
    let second = (first + 1) % buffer.len();
    let fraction = read_position - first as f64;
    buffer[first] + (buffer[second] - buffer[first]) * fraction
}

fn finite_sample(sample: f64) -> f64 {
    if sample.is_finite() { sample } else { 0.0 }
}
