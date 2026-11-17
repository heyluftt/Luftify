//! Tonal fingerprint of music played through car speakers in a closed cabin.
//! The cabin gain (bass rising below ~100 Hz) needs no shelf here: it
//! emerges from the boundary reflections adding up in phase at low
//! frequencies, as the pressure does in a real sealed cabin.
use crate::filters::{BiquadCoefficients, BiquadState};

const SECTION_COUNT: usize = 5;

pub(super) struct CabinTone {
    sections: [BiquadCoefficients; SECTION_COUNT],
    state: [[BiquadState; SECTION_COUNT]; 2],
}

impl CabinTone {
    pub(super) fn new(rate: f64) -> Self {
        Self {
            sections: [
                // Small door woofers roll off below ~80 Hz before the cabin
                // lifts the bass back up; keeps the car from booming.
                BiquadCoefficients::low_shelf(rate, 80.0, 0.8, -2.5),
                // Front-to-back standing wave around 1.6 m.
                BiquadCoefficients::peak(rate, 105.0, 1.6, 2.5),
                // Seat and dash cancellation in the low mids.
                BiquadCoefficients::peak(rate, 230.0, 1.2, -2.5),
                // Midrange projected off the windscreen and dashboard.
                BiquadCoefficients::peak(rate, 1_150.0, 1.1, 1.2),
                // Door tweeters aim past the ears; seats and headliner absorb.
                BiquadCoefficients::high_shelf(rate, 7_000.0, 0.7, -2.5),
            ],
            state: [[BiquadState::default(); SECTION_COUNT]; 2],
        }
    }

    pub(super) fn process(&mut self, input: [f64; 2]) -> [f64; 2] {
        let mut output = input;
        for (channel, sample) in output.iter_mut().enumerate() {
            for (section, state) in self.sections.iter().zip(&mut self.state[channel]) {
                *sample = state.process(*sample, *section);
            }
        }
        output
    }

    pub(super) fn clear(&mut self) {
        self.state.iter_mut().flatten().for_each(BiquadState::clear);
    }
}
