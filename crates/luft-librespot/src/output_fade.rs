//! Soft edges at the speaker.
//!
//! A skip, seek or pause used to break the waveform off mid-swing (a click),
//! and a skip first played out the half second still queued, hall included.
//! The fade sits after every effect, on the audio thread: whatever is audible
//! at the moment of a cut fades out, and the next audio rises in from silence.
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::Duration,
};

use rodio::{ChannelCount, SampleRate, Source};

pub(crate) const FADE_OUT: Duration = Duration::from_millis(100);
/// Shorter: the first beat of the next song should still land.
const FADE_IN: Duration = Duration::from_millis(40);

/// Fade state shared by the writer and the audio thread. The writer only
/// sets the direction; the audio thread moves the level frame by frame.
pub(crate) struct Fade {
    /// Linear progress 0..=1 as `f32` bits; the heard gain is eased.
    progress: AtomicU32,
    rising: AtomicBool,
}

impl Fade {
    /// Starts silent and rising, so the very first audio rises in too.
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            progress: AtomicU32::new(0.0_f32.to_bits()),
            rising: AtomicBool::new(true),
        })
    }

    pub(crate) fn rise(&self) {
        self.rising.store(true, Ordering::Relaxed);
    }

    pub(crate) fn fall(&self) {
        self.rising.store(false, Ordering::Relaxed);
    }

    pub(crate) fn is_silent(&self) -> bool {
        !self.rising.load(Ordering::Relaxed) && self.progress() <= 0.0
    }

    /// Only while the audio thread does not play from this queue.
    pub(crate) fn silence(&self) {
        self.fall();
        self.progress.store(0.0_f32.to_bits(), Ordering::Relaxed);
    }

    fn progress(&self) -> f32 {
        f32::from_bits(self.progress.load(Ordering::Relaxed))
    }
}

/// A queued buffer played through the shared fade.
pub(crate) struct Faded<S> {
    inner: S,
    fade: Arc<Fade>,
    channels: ChannelCount,
    channel: ChannelCount,
    step_in: f32,
    step_out: f32,
    gain: f32,
}

impl<S: Source> Faded<S> {
    pub(crate) fn new(inner: S, fade: Arc<Fade>) -> Self {
        let frames = |duration: Duration| (inner.sample_rate() as f32 * duration.as_secs_f32()).max(1.0);
        Self {
            channels: inner.channels().max(1),
            channel: 0,
            step_in: 1.0 / frames(FADE_IN),
            step_out: 1.0 / frames(FADE_OUT),
            gain: 1.0,
            fade,
            inner,
        }
    }

    /// Moves the level one frame on and returns the gain to hear.
    fn advance(&self) -> f32 {
        let progress = self.fade.progress();
        let next = if self.fade.rising.load(Ordering::Relaxed) {
            (progress + self.step_in).min(1.0)
        } else {
            (progress - self.step_out).max(0.0)
        };
        if next != progress {
            self.fade.progress.store(next.to_bits(), Ordering::Relaxed);
        }
        next * next * (3.0 - 2.0 * next)
    }
}

impl<S: Source> Iterator for Faded<S> {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        if self.channel == 0 {
            self.gain = self.advance();
        }
        self.channel = (self.channel + 1) % self.channels;
        Some(sample * self.gain)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
    }
}

impl<S: Source> Source for Faded<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }

    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }

    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    fn play(fade: &Arc<Fade>, frames: usize) -> Vec<f32> {
        Faded::new(SamplesBuffer::new(2, 1_000, vec![1.0; frames * 2]), Arc::clone(fade)).collect()
    }

    #[test]
    fn audio_rises_in_falls_to_silence_and_rises_again() {
        let fade = Fade::new();
        let first = play(&fade, 100);
        assert!(first[0] < 0.05 && first[first.len() - 1] == 1.0, "rises in from silence");

        fade.fall();
        let tail = play(&fade, 150);
        assert!(tail[0] > 0.95, "starts where it was");
        assert!(tail.windows(2).all(|pair| pair[1] <= pair[0]), "never rises while falling");
        assert_eq!(tail[tail.len() - 1], 0.0);
        assert!(fade.is_silent());

        fade.rise();
        let next = play(&fade, 100);
        assert!(next[0] < 0.05 && next[next.len() - 1] == 1.0);
    }

    #[test]
    fn both_channels_of_a_frame_get_the_same_gain() {
        let samples = play(&Fade::new(), 10);
        for frame in samples.chunks(2) {
            assert_eq!(frame[0], frame[1]);
        }
    }
}
