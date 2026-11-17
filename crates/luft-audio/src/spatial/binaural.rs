//! Two virtual front speakers at +/-30 degrees, using measured KEMAR ear responses.
//! Filter construction/resampling happens once; the audio callback only convolves.
use super::hrir_data::{FAR, NEAR};

pub(super) struct FrontSpeakers {
    kernels: Vec<[f64; 2]>,
    history: [Vec<f64>; 2],
    index: usize,
}

impl FrontSpeakers {
    pub(super) fn new(rate: f64) -> Self {
        let ratio = rate / 44_100.0;
        let count = (128.0 * ratio).ceil() as usize;
        let kernels = (0..count)
            .rev()
            .map(|i| {
                // Shared gain and polarity preserve interaural level and time differences.
                [resample(&NEAR, i, ratio), resample(&FAR, i, ratio)].map(|v| v * -1.5 / 32768.0)
            })
            .collect();
        Self {
            kernels,
            history: std::array::from_fn(|_| vec![0.0; count * 2]),
            index: 0,
        }
    }

    pub(super) fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        let count = self.kernels.len();
        for (history, sample) in self.history.iter_mut().zip(input) {
            history[self.index] = sample;
            history[self.index + count] = sample;
        }
        // Duplicated rings make this contiguous; no per-tap modulo or allocations.
        let start = self.index + 1;
        let left = &self.history[0][start..start + count];
        let right = &self.history[1][start..start + count];
        let mut ears = [0.0; 2];
        for ((l, r), [near, far]) in left.iter().zip(right).zip(&self.kernels) {
            ears[0] += l * near + r * far;
            ears[1] += l * far + r * near;
        }
        self.index = (self.index + 1) % count;
        ears
    }

    pub(super) fn clear(&mut self) {
        self.history
            .iter_mut()
            .for_each(|history| history.fill(0.0));
        self.index = 0;
    }
}

// Windowed-sinc resampling keeps the measured ear delay in seconds at other rates.
// The rate conversion factor preserves impulse-response gain, unlike audio resampling.
fn resample(source: &[i16; 128], index: usize, ratio: f64) -> f64 {
    if (ratio - 1.0).abs() < 1.0e-10 {
        return f64::from(source[index]);
    }
    let position = index as f64 / ratio;
    let cutoff = ratio.min(1.0);
    let radius = 16.0 / cutoff;
    let first = (position - radius).ceil().max(0.0) as usize;
    let last = ((position + radius).floor() as usize).min(source.len() - 1);
    let mut value = 0.0;
    for (i, sample) in source.iter().enumerate().take(last + 1).skip(first) {
        let distance = i as f64 - position;
        let x = std::f64::consts::PI * distance * cutoff;
        let sinc = if x.abs() < 1.0e-10 { 1.0 } else { x.sin() / x };
        let window = 0.5 + 0.5 * (std::f64::consts::PI * distance / radius).cos();
        value += f64::from(*sample) * sinc * window * cutoff / ratio;
    }
    value
}
