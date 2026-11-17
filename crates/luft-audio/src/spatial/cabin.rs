//! Music in a car, for headphones: the cabin's tone, two virtual front
//! speakers (measured KEMAR ear responses), the windscreen, boundary
//! reflections from the driver's seat and a short upholstered decay.
//! An authored interior, not a measured vehicle impulse response.
mod boundaries;
mod tail;
mod tone;

use super::finite_sample;
use boundaries::Boundaries;
use tail::CabinTail;
use tone::CabinTone;

const DIRECT_GAIN: f64 = 0.62;
const REFLECTION_GAIN: f64 = 1.5;
const TAIL_SEND: f64 = 0.8;
const TAIL_GAIN: f64 = 0.8;
/// The windscreen sits a hand's width above the dash speakers; its
/// reflection colours the speaker sound itself (comb filtering).
const WINDSCREEN_MS: f64 = 0.85;
const WINDSCREEN_GAIN: f64 = 0.25;
/// Keeps the car as loud as the dry signal (K-weighted, music-like noise;
/// see tests), so A/B comparisons are not won by loudness.
const OUTPUT_LEVEL: f64 = 0.63;

pub(super) struct Cabin {
    tone: CabinTone,
    windscreen: Vec<[f64; 2]>,
    windscreen_index: usize,
    speakers: super::binaural::FrontSpeakers,
    boundaries: Boundaries,
    tail: CabinTail,
}

impl Cabin {
    pub(super) fn new(rate: f64) -> Self {
        let windscreen = ((rate * WINDSCREEN_MS / 1_000.0).round() as usize).max(1);
        Self {
            tone: CabinTone::new(rate),
            windscreen: vec![[0.0; 2]; windscreen],
            windscreen_index: 0,
            speakers: super::binaural::FrontSpeakers::new(rate),
            boundaries: Boundaries::new(rate),
            tail: CabinTail::new(rate),
        }
    }

    pub(super) fn process(
        &mut self,
        left: f64,
        right: f64,
        damping: f64,
        pre_delay: f64,
        decay_seconds: f64,
    ) -> (f64, f64) {
        let toned = self.tone.process([left, right]);
        let reflected = self.windscreen[self.windscreen_index];
        self.windscreen[self.windscreen_index] = toned;
        self.windscreen_index = (self.windscreen_index + 1) % self.windscreen.len();
        let speakers = [
            toned[0] + reflected[0] * WINDSCREEN_GAIN,
            toned[1] + reflected[1] * WINDSCREEN_GAIN,
        ];

        let direct = self.speakers.process(speakers);
        let boundaries = self.boundaries.process(speakers, damping, pre_delay);
        let tail = self.tail.process(
            boundaries.map(|sample| sample * TAIL_SEND),
            damping,
            decay_seconds,
        );
        let ear = |channel: usize| {
            finite_sample(
                (direct[channel] * DIRECT_GAIN
                    + boundaries[channel] * REFLECTION_GAIN
                    + tail[channel] * TAIL_GAIN)
                    * OUTPUT_LEVEL,
            )
        };
        (ear(0), ear(1))
    }

    pub(super) fn clear(&mut self) {
        self.tone.clear();
        self.windscreen.fill([0.0; 2]);
        self.windscreen_index = 0;
        self.speakers.clear();
        self.boundaries.clear();
        self.tail.clear();
    }
}
