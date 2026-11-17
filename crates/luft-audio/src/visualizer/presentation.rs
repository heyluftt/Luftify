//! Presentation clock: the analyser sees audio when it is queued for the
//! device, which is up to half a second before it is heard. Frames are kept
//! with their analysis time; readers get the frame that is audible *now*,
//! and the beat is extrapolated to that moment.
use std::{collections::VecDeque, time::Instant};

use super::{VisualizerFrame, beat::BeatState};

/// Covers the deepest output queue (~0.6 s) with room to spare.
const RETAINED_MICROS: u64 = 1_500_000;
/// Longer than any packet gap while playing; beyond it the stream stopped.
const STALE_MICROS: u64 = 400_000;
/// How long a predicted beat flashes, in seconds.
const PULSE_SECONDS: f64 = 0.11;
/// Below this confidence the tracker's beat is not trusted at all.
const MIN_TRUSTED_CONFIDENCE: f64 = 0.25;

pub(super) struct Presentation {
    origin: Instant,
    frames: VecDeque<(u64, VisualizerFrame)>,
    beat: Option<(u64, BeatState)>,
}

impl Presentation {
    pub(super) fn new() -> Self {
        Self {
            origin: Instant::now(),
            frames: VecDeque::with_capacity(128),
            beat: None,
        }
    }

    pub(super) fn now_micros(&self) -> u64 {
        u64::try_from(self.origin.elapsed().as_micros()).unwrap_or(u64::MAX)
    }

    pub(super) fn publish(&mut self, at: u64, frame: VisualizerFrame, beat: BeatState) {
        self.frames.push_back((at, frame));
        while self
            .frames
            .front()
            .is_some_and(|(stamp, _)| at.saturating_sub(*stamp) > RETAINED_MICROS)
        {
            self.frames.pop_front();
        }
        self.beat = Some((at, beat));
    }

    pub(super) fn clear(&mut self) {
        self.frames.clear();
        self.beat = None;
    }

    /// The frame audible at `now`, given how long queued audio takes to play.
    pub(super) fn audible(&self, now: u64, latency: u64) -> VisualizerFrame {
        let Some(&(newest, _)) = self.frames.back() else {
            return VisualizerFrame::default();
        };
        if now.saturating_sub(newest) > latency + STALE_MICROS {
            return VisualizerFrame::default();
        }
        let heard = now.saturating_sub(latency);
        let mut frame = self
            .frames
            .iter()
            .rev()
            .find(|(stamp, _)| *stamp <= heard)
            .or_else(|| self.frames.front())
            .map(|(_, frame)| *frame)
            .unwrap_or_default();

        if let Some((stamp, beat)) = self.beat
            && beat.period_seconds > 0.0
            && beat.confidence > MIN_TRUSTED_CONFIDENCE
        {
            // Seconds from the analysed beat state to the audible moment;
            // negative when the audible audio is older than the analysis.
            let offset = (heard as f64 - stamp as f64) / 1_000_000.0;
            let phase = (beat.phase + offset / beat.period_seconds).rem_euclid(1.0);
            let since_beat = phase * beat.period_seconds;
            let pulse = (-since_beat / PULSE_SECONDS).exp() as f32;
            let trust = (((beat.confidence - MIN_TRUSTED_CONFIDENCE)
                / (0.7 - MIN_TRUSTED_CONFIDENCE))
                .clamp(0.0, 1.0)) as f32;
            // Locked: the pulse sits on the beat. Unsure: the onset heuristic.
            frame.beat = frame.beat * (1.0 - trust) + pulse * trust;
        }
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(energy: f32) -> VisualizerFrame {
        VisualizerFrame {
            energy,
            ..VisualizerFrame::default()
        }
    }

    #[test]
    fn readers_get_what_is_audible_not_what_was_just_decoded() {
        let mut presentation = Presentation::new();
        for step in 0..10_u64 {
            presentation.publish(
                step * 50_000,
                frame(step as f32 / 10.0),
                BeatState::default(),
            );
        }
        // 450 ms of audio queued: at 450 ms the speaker plays what was analysed at 0 ms.
        let heard = presentation.audible(450_000, 450_000);
        assert!(heard.energy.abs() < 1.0e-6);
        let later = presentation.audible(450_000, 200_000);
        assert!((later.energy - 0.5).abs() < 1.0e-6);
    }

    #[test]
    fn a_locked_beat_pulses_when_the_beat_is_heard() {
        let mut presentation = Presentation::new();
        let beat = BeatState {
            phase: 0.0,
            period_seconds: 0.5,
            confidence: 0.9,
        };
        // The analyser saw a beat at 1.0 s; 300 ms of audio are queued.
        presentation.publish(1_000_000, frame(0.5), beat);
        let before = presentation.audible(1_200_000, 300_000).beat;
        let on_beat = presentation.audible(1_300_000, 300_000).beat;
        assert!(on_beat > 0.95, "on the beat: {on_beat}");
        assert!(before < 0.2, "before the beat: {before}");
    }

    #[test]
    fn a_stopped_stream_goes_quiet() {
        let mut presentation = Presentation::new();
        presentation.publish(0, frame(0.8), BeatState::default());
        assert!(presentation.audible(2_000_000, 100_000).energy.abs() < 1.0e-6);
    }
}
