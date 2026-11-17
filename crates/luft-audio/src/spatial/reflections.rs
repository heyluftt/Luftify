//! Early reflections of the current room (see `rooms`): every first- and
//! second-order wall reflection of both stage sources, with its own delay,
//! level and treble loss at each ear. Changing the room glides every tap
//! to its new place instead of switching patterns.
use super::rooms::{IMAGE_COUNT, LONGEST_TAP_SECONDS, RoomShape, Tap, image_taps};
use super::{finite_sample, read_fractional};

/// Early energy relative to the old fixed pattern, so that the room mix
/// and loudness balance keep their meaning.
const OUTPUT_LEVEL: f64 = 0.78;
const GLIDE_SECONDS: f64 = 0.09;

#[derive(Clone, Copy, Default)]
struct Glide {
    current: [[f64; 2]; 3],
    step: [[f64; 2]; 3],
}

pub(super) struct EarlyReflections {
    rate: f64,
    /// Left and right stage source.
    buffers: [Vec<f64>; 2],
    index: usize,
    taps: [[Glide; IMAGE_COUNT]; 2],
    remaining: usize,
    filtered: [[[f64; 2]; IMAGE_COUNT]; 2],
    shape: Option<RoomShape>,
}

impl EarlyReflections {
    pub(super) fn new(rate: f64, shape: &RoomShape) -> Self {
        let length = (rate * LONGEST_TAP_SECONDS).ceil() as usize + 4;
        let mut reflections = Self {
            rate,
            buffers: std::array::from_fn(|_| vec![0.0; length]),
            index: 0,
            taps: [[Glide::default(); IMAGE_COUNT]; 2],
            remaining: 0,
            filtered: [[[0.0; 2]; IMAGE_COUNT]; 2],
            shape: None,
        };
        reflections.set_shape(shape, 0);
        reflections
    }

    pub(super) fn set_shape(&mut self, shape: &RoomShape, smoothing_frames: usize) {
        if self.shape.as_ref() == Some(shape) {
            return;
        }
        self.shape = Some(*shape);
        let frames = if smoothing_frames == 0 {
            0
        } else {
            smoothing_frames.max((self.rate * GLIDE_SECONDS) as usize)
        };
        let targets = [image_taps(shape, -1.0), image_taps(shape, 1.0)];
        let energy: f64 = targets
            .iter()
            .flatten()
            .map(|tap| tap.gain[0].powi(2) + tap.gain[1].powi(2))
            .sum();
        // Same early energy in every room; distance and size are carried by
        // timing, direction and tone, the balance by the room mix.
        let normalize = OUTPUT_LEVEL / (energy / 2.0).sqrt().max(1.0e-9);
        for (source, taps) in targets.iter().enumerate() {
            for (glide, tap) in self.taps[source].iter_mut().zip(taps) {
                let target = values(tap, self.rate, normalize);
                for (quantity, values) in target.iter().enumerate() {
                    for ear in 0..2 {
                        if frames == 0 {
                            glide.current[quantity][ear] = values[ear];
                            glide.step[quantity][ear] = 0.0;
                        } else {
                            glide.step[quantity][ear] =
                                (values[ear] - glide.current[quantity][ear]) / frames as f64;
                        }
                    }
                }
            }
        }
        self.remaining = frames;
    }

    /// Takes the (pre-delayed) left and right source, returns both ears.
    pub(super) fn process(&mut self, left: f64, right: f64, damping: f64) -> (f64, f64) {
        self.buffers[0][self.index] = finite_sample(left);
        self.buffers[1][self.index] = finite_sample(right);
        let gliding = self.remaining > 0;
        if gliding {
            self.remaining -= 1;
        }
        let mut ears = [0.0; 2];
        for source in 0..2 {
            for (number, glide) in self.taps[source].iter_mut().enumerate() {
                if gliding {
                    for quantity in 0..3 {
                        for ear in 0..2 {
                            glide.current[quantity][ear] += glide.step[quantity][ear];
                        }
                    }
                }
                let [delays, gains, brightness] = glide.current;
                for ear in 0..2 {
                    if gains[ear] <= 1.0e-5 {
                        continue;
                    }
                    let arriving = read_fractional(&self.buffers[source], self.index, delays[ear]);
                    let state = &mut self.filtered[source][number][ear];
                    *state += damping * brightness[ear] * (arriving - *state);
                    ears[ear] += *state * gains[ear];
                }
            }
        }
        self.index = (self.index + 1) % self.buffers[0].len();
        (finite_sample(ears[0]), finite_sample(ears[1]))
    }

    pub(super) fn clear(&mut self) {
        self.buffers.iter_mut().for_each(|buffer| buffer.fill(0.0));
        self.index = 0;
        self.filtered = [[[0.0; 2]; IMAGE_COUNT]; 2];
    }
}

/// Delay in samples (at least one), gain and brightness per ear.
fn values(tap: &Tap, rate: f64, normalize: f64) -> [[f64; 2]; 3] {
    [
        tap.delay_seconds.map(|seconds| (seconds * rate).max(1.0)),
        tap.gain.map(|gain| gain * normalize),
        tap.brightness.map(|brightness| brightness.clamp(0.05, 1.0)),
    ]
}
