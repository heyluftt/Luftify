//! Short, dense decay of a small upholstered cabin: a six-line feedback
//! delay network with millisecond-scale lines instead of the room reverb.
use super::super::finite_sample;

const LINE_COUNT: usize = 6;
const LINE_MS: [f64; LINE_COUNT] = [2.9, 3.7, 4.6, 5.9, 7.1, 8.3];
/// A van or bus stretches the lines; the car preset stays at 1.
const MAX_SIZE: f64 = 2.2;

pub(super) struct CabinTail {
    rate: f64,
    lines: [Vec<f64>; LINE_COUNT],
    index: usize,
    delays: [usize; LINE_COUNT],
    feedback: [f64; LINE_COUNT],
    damping: [f64; LINE_COUNT],
    decay_seconds: f64,
}

impl CabinTail {
    pub(super) fn new(rate: f64) -> Self {
        let longest = (rate * LINE_MS[LINE_COUNT - 1] * MAX_SIZE / 1_000.0).ceil() as usize + 2;
        let mut tail = Self {
            rate,
            lines: std::array::from_fn(|_| vec![0.0; longest]),
            index: 0,
            delays: [1; LINE_COUNT],
            feedback: [0.0; LINE_COUNT],
            damping: [0.0; LINE_COUNT],
            decay_seconds: f64::NAN,
        };
        tail.set_decay(0.4);
        tail
    }

    /// Maps the room decay control onto a cabin: 0.4 s gives ~0.13 s RT60,
    /// the longest setting a large van (~0.85 s).
    fn set_decay(&mut self, decay_seconds: f64) {
        if (decay_seconds - self.decay_seconds).abs() < 1.0e-4 {
            return;
        }
        self.decay_seconds = decay_seconds;
        let normalized = ((decay_seconds - 0.35) / (5.5 - 0.35)).clamp(0.0, 1.0);
        let size = 1.0 + normalized * (MAX_SIZE - 1.0);
        let rt60 = 0.12 + (decay_seconds - 0.35).max(0.0) * 0.14;
        let capacity = self.lines[0].len() - 1;
        for line in 0..LINE_COUNT {
            let samples = (self.rate * LINE_MS[line] * size / 1_000.0).round() as usize;
            self.delays[line] = samples.clamp(1, capacity);
            let seconds = self.delays[line] as f64 / self.rate;
            self.feedback[line] = 10.0_f64.powf(-3.0 * seconds / rt60).min(0.97);
        }
    }

    pub(super) fn process(
        &mut self,
        input: [f64; 2],
        damping: f64,
        decay_seconds: f64,
    ) -> [f64; 2] {
        self.set_decay(decay_seconds);
        let length = self.lines[0].len();
        let mut outputs = [0.0; LINE_COUNT];
        for line in 0..LINE_COUNT {
            let read = (self.index + length - self.delays[line]) % length;
            let sample = self.lines[line][read];
            // Upholstery absorbs treble on every pass.
            self.damping[line] += damping * (sample - self.damping[line]);
            outputs[line] = self.damping[line];
        }
        // Householder mixing: lossless, every line feeds every other.
        let sum: f64 = outputs.iter().sum();
        let reflected = sum * 2.0 / LINE_COUNT as f64;
        for line in 0..LINE_COUNT {
            let injected = if line % 2 == 0 { input[0] } else { input[1] };
            self.lines[line][self.index] =
                finite_sample(injected + (outputs[line] - reflected) * self.feedback[line]);
        }
        self.index = (self.index + 1) % length;
        [
            finite_sample(outputs[0] + outputs[2] * 0.8 - outputs[4] * 0.5 + outputs[3] * 0.25),
            finite_sample(outputs[1] + outputs[3] * 0.8 - outputs[5] * 0.5 + outputs[2] * 0.25),
        ]
    }

    pub(super) fn clear(&mut self) {
        self.lines.iter_mut().for_each(|line| line.fill(0.0));
        self.damping = [0.0; LINE_COUNT];
        self.index = 0;
    }
}
