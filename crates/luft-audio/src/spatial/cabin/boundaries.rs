//! Boundary reflections of a car interior, heard from the driver's seat
//! (left-hand drive). Cabin dimensions keep every path within ~9 ms; longer
//! echoes (as in a room) are what made the old model sound like a small room.
use super::super::{finite_sample, read_fractional};

struct Reflection {
    delay_ms: f64,
    /// How much of the left and right speaker reaches this surface.
    source: [f64; 2],
    /// Level at the left and right ear; the quieter ear hears it later.
    ears: [f64; 2],
    /// 0 = glass (bright), 1 = headliner/seat fabric (dull).
    absorption: f64,
}

const REFLECTIONS: [Reflection; 7] = [
    Reflection {
        delay_ms: 1.2,
        source: [0.5, 0.5],
        ears: [0.30, 0.30],
        absorption: 0.25,
    }, // dashboard
    Reflection {
        delay_ms: 1.7,
        source: [1.0, 0.0],
        ears: [0.46, 0.16],
        absorption: 0.0,
    }, // driver window
    Reflection {
        delay_ms: 2.5,
        source: [0.5, 0.5],
        ears: [0.20, 0.20],
        absorption: 0.75,
    }, // headliner
    Reflection {
        delay_ms: 3.6,
        source: [0.0, 1.0],
        ears: [0.12, 0.34],
        absorption: 0.0,
    }, // passenger window
    Reflection {
        delay_ms: 4.4,
        source: [1.0, 0.2],
        ears: [0.22, 0.08],
        absorption: 0.4,
    }, // B-pillar and door
    Reflection {
        delay_ms: 7.3,
        source: [0.5, 0.5],
        ears: [0.13, 0.13],
        absorption: 0.2,
    }, // rear window
    Reflection {
        delay_ms: 8.8,
        source: [0.2, 1.0],
        ears: [0.06, 0.15],
        absorption: 0.55,
    }, // rear passenger side
];

const INTERAURAL_DELAY_MS: f64 = 0.3;
/// Longest path plus interaural delay plus the maximum pre-delay (80 ms).
const BUFFER_SECONDS: f64 = 0.095;

pub(super) struct Boundaries {
    buffers: [Vec<f64>; 2],
    index: usize,
    delays: [[f64; 2]; REFLECTIONS.len()],
    filtered: [[f64; 2]; REFLECTIONS.len()],
}

impl Boundaries {
    pub(super) fn new(rate: f64) -> Self {
        let ms = |value: f64| rate * value / 1_000.0;
        Self {
            buffers: std::array::from_fn(|_| {
                vec![0.0; (rate * BUFFER_SECONDS).ceil() as usize + 4]
            }),
            index: 0,
            delays: REFLECTIONS.map(|reflection| {
                let later = |ear: usize| {
                    if reflection.ears[ear] < reflection.ears[1 - ear] {
                        INTERAURAL_DELAY_MS
                    } else {
                        0.0
                    }
                };
                [
                    ms(reflection.delay_ms + later(0)),
                    ms(reflection.delay_ms + later(1)),
                ]
            }),
            filtered: [[0.0; 2]; REFLECTIONS.len()],
        }
    }

    /// Takes the speaker feeds, returns the reflected field at both ears.
    pub(super) fn process(&mut self, speakers: [f64; 2], damping: f64, pre_delay: f64) -> [f64; 2] {
        for (buffer, sample) in self.buffers.iter_mut().zip(speakers) {
            buffer[self.index] = finite_sample(sample);
        }
        let mut ears = [0.0; 2];
        for (number, reflection) in REFLECTIONS.iter().enumerate() {
            // Glass returns nearly all treble, fabric very little; the damping
            // control darkens both.
            let alpha = damping * (1.0 - 0.6 * reflection.absorption)
                + (1.0 - damping) * (1.0 - reflection.absorption) * 0.7;
            for ear in 0..2 {
                let delay = self.delays[number][ear] + pre_delay;
                let arriving = reflection.source[0]
                    * read_fractional(&self.buffers[0], self.index, delay)
                    + reflection.source[1] * read_fractional(&self.buffers[1], self.index, delay);
                let state = &mut self.filtered[number][ear];
                *state += alpha * (arriving - *state);
                ears[ear] += *state * reflection.ears[ear];
            }
        }
        self.index = (self.index + 1) % self.buffers[0].len();
        ears.map(finite_sample)
    }

    pub(super) fn clear(&mut self) {
        self.buffers.iter_mut().for_each(|buffer| buffer.fill(0.0));
        self.index = 0;
        self.filtered = [[0.0; 2]; REFLECTIONS.len()];
    }
}
