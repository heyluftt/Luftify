//! Band-limited stereo sample-rate conversion (windowed-sinc interpolation,
//! J. O. Smith's "Digital Audio Resampling").
//!
//! Spotify decodes at 44.1 kHz while Windows devices usually run at 48 kHz.
//! Rodio converts that difference by linear interpolation, which dulls the
//! top octave (about -1.4 dB at 10 kHz, -3.4 dB at 15 kHz) and mirrors
//! images into the audio band. This converter stays flat to 20 kHz.

const ZERO_CROSSINGS: usize = 48;
const PHASES: usize = 512;
const KAISER_BETA: f64 = 8.0;
/// Passband edge as a fraction of the lower of both Nyquist frequencies.
const CUTOFF: f64 = 0.95;

pub struct StereoResampler {
    step: f64,
    position: f64,
    half: usize,
    taps: usize,
    table: Vec<f32>,
    pending: Vec<[f32; 2]>,
}

impl StereoResampler {
    /// `None` when both rates match and no conversion is needed.
    #[must_use]
    pub fn new(input_rate: u32, output_rate: u32) -> Option<Self> {
        if input_rate == output_rate || input_rate == 0 || output_rate == 0 {
            return None;
        }
        let ratio = f64::from(output_rate) / f64::from(input_rate);
        // Downsampling must also remove what the lower output rate cannot hold.
        let cut = CUTOFF * ratio.min(1.0);
        let half = (ZERO_CROSSINGS as f64 / cut).ceil() as usize;
        let taps = half * 2;
        let mut table = vec![0.0_f32; (PHASES + 1) * taps];
        for phase in 0..=PHASES {
            let fraction = phase as f64 / PHASES as f64;
            let row = &mut table[phase * taps..(phase + 1) * taps];
            let mut sum = 0.0;
            let mut values = vec![0.0; taps];
            for (tap, value) in values.iter_mut().enumerate() {
                let distance = tap as f64 - (half as f64 - 1.0) - fraction;
                let x = cut * distance;
                let sinc = if x.abs() < 1.0e-12 {
                    1.0
                } else {
                    (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
                };
                *value = cut * sinc * kaiser(distance / half as f64);
                sum += *value;
            }
            // Unity gain at every phase: no ripple on steady signals.
            for (slot, value) in row.iter_mut().zip(values) {
                *slot = (value / sum) as f32;
            }
        }
        Some(Self {
            step: f64::from(input_rate) / f64::from(output_rate),
            position: 0.0,
            half,
            taps,
            table,
            // Start centred on the first real sample.
            pending: vec![[0.0; 2]; half - 1],
        })
    }

    /// Converts interleaved stereo and appends interleaved stereo output.
    pub fn process(&mut self, input: &[f64], output: &mut Vec<f32>) {
        self.pending.extend(
            input
                .chunks_exact(2)
                .map(|frame| [finite(frame[0]) as f32, finite(frame[1]) as f32]),
        );
        output.reserve(((input.len() / 2) as f64 / self.step) as usize * 2 + 4);
        loop {
            let base = self.position.floor() as usize;
            if base + self.taps > self.pending.len() {
                break;
            }
            let phase = (self.position - base as f64) * PHASES as f64;
            let row = (phase.floor() as usize).min(PHASES - 1);
            let blend = (phase - row as f64) as f32;
            let first = &self.table[row * self.taps..(row + 1) * self.taps];
            let second = &self.table[(row + 1) * self.taps..(row + 2) * self.taps];
            let window = &self.pending[base..base + self.taps];
            let mut sample = [0.0_f32; 2];
            for ((frame, a), b) in window.iter().zip(first).zip(second) {
                let coefficient = a + (b - a) * blend;
                sample[0] += frame[0] * coefficient;
                sample[1] += frame[1] * coefficient;
            }
            output.extend_from_slice(&sample);
            self.position += self.step;
        }
        let consumed = (self.position.floor() as usize).min(self.pending.len());
        self.pending.drain(..consumed);
        self.position -= consumed as f64;
    }

    /// Forgets buffered input, e.g. after a seek or a new track.
    pub fn reset(&mut self) {
        self.pending.clear();
        self.pending.resize(self.half - 1, [0.0; 2]);
        self.position = 0.0;
    }
}

fn kaiser(normalized: f64) -> f64 {
    if normalized.abs() >= 1.0 {
        return 0.0;
    }
    bessel_i0(KAISER_BETA * (1.0 - normalized * normalized).sqrt()) / bessel_i0(KAISER_BETA)
}

fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let quarter = x * x / 4.0;
    for k in 1..64 {
        term *= quarter / (k * k) as f64;
        sum += term;
        if term < sum * 1.0e-12 {
            break;
        }
    }
    sum
}

fn finite(sample: f64) -> f64 {
    if sample.is_finite() { sample } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone_gain_db(from: u32, to: u32, frequency: f64) -> f64 {
        let mut resampler = StereoResampler::new(from, to).expect("rates differ");
        let input: Vec<f64> = (0..from as usize / 2)
            .flat_map(|index| {
                let value = (std::f64::consts::TAU * frequency * index as f64 / f64::from(from))
                    .sin()
                    * 0.5;
                [value, value]
            })
            .collect();
        let mut output = Vec::new();
        // Feed in uneven packets, as the decoder does.
        for chunk in input.chunks(1_234) {
            resampler.process(chunk, &mut output);
        }
        let settled = &output[output.len() / 4..];
        let rms = (settled
            .iter()
            .step_by(2)
            .map(|s| f64::from(*s).powi(2))
            .sum::<f64>()
            / (settled.len() / 2) as f64)
            .sqrt();
        20.0 * (rms / (0.5 / 2.0_f64.sqrt())).log10()
    }

    #[test]
    fn upsampling_to_48k_stays_flat_across_the_audio_band() {
        for frequency in [100.0, 1_000.0, 10_000.0, 15_000.0, 19_000.0] {
            let gain = tone_gain_db(44_100, 48_000, frequency);
            assert!(gain.abs() < 0.1, "{frequency} Hz: {gain:+.3} dB");
        }
    }

    #[test]
    fn downsampling_removes_what_the_output_cannot_hold() {
        assert!(tone_gain_db(44_100, 32_000, 1_000.0).abs() < 0.1);
        // 20 kHz cannot exist at 32 kHz; it must not alias back as a tone.
        assert!(tone_gain_db(44_100, 32_000, 20_000.0) < -50.0);
    }

    #[test]
    fn output_length_follows_the_rate_ratio() {
        let mut resampler = StereoResampler::new(44_100, 48_000).expect("rates differ");
        let mut output = Vec::new();
        resampler.process(&vec![0.1; 44_100 * 2], &mut output);
        let frames = output.len() / 2;
        assert!((47_900..=48_000).contains(&frames), "{frames} frames");
        assert!(StereoResampler::new(44_100, 44_100).is_none());
    }
}
