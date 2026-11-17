use std::{
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};

mod beat;
mod presentation;

use beat::{BeatTracker, HOP};
use presentation::Presentation;

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualizerFrame {
    pub energy: f32,
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    pub beat: f32,
}

#[derive(Clone)]
pub struct VisualizerControl {
    shared: Arc<VisualizerState>,
}

struct VisualizerState {
    presentation: Mutex<Presentation>,
    /// Audio queued between the analyser and the speaker.
    output_latency_micros: AtomicU64,
}

impl Default for VisualizerControl {
    fn default() -> Self {
        Self {
            shared: Arc::new(VisualizerState {
                presentation: Mutex::new(Presentation::new()),
                output_latency_micros: AtomicU64::new(0),
            }),
        }
    }
}

impl VisualizerControl {
    /// What is audible right now, not what was analysed last.
    #[must_use]
    pub fn frame(&self) -> VisualizerFrame {
        let presentation = self.presentation();
        let now = presentation.now_micros();
        presentation.audible(
            now,
            self.shared.output_latency_micros.load(Ordering::Relaxed),
        )
    }

    /// Reported by the audio output after every write.
    pub fn set_output_latency(&self, latency: Duration) {
        let micros = u64::try_from(latency.as_micros()).unwrap_or(u64::MAX);
        self.shared
            .output_latency_micros
            .store(micros, Ordering::Relaxed);
    }

    pub fn reset(&self) {
        self.presentation().clear();
    }

    fn publish(&self, frame: VisualizerFrame, beat: beat::BeatState) {
        let mut presentation = self.presentation();
        let now = presentation.now_micros();
        presentation.publish(now, frame, beat);
    }

    fn presentation(&self) -> std::sync::MutexGuard<'_, Presentation> {
        self.shared
            .presentation
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct VisualizerAnalyzer {
    control: VisualizerControl,
    sample_rate: f64,
    low_alpha: f64,
    mid_alpha: f64,
    low_pass: f64,
    mid_pass: f64,
    envelope: VisualizerFrame,
    bass_average: f32,
    beats: BeatTracker,
    hop_bands: [f64; 3],
    hop_fill: usize,
}

impl VisualizerAnalyzer {
    #[must_use]
    pub fn new(sample_rate: u32, control: VisualizerControl) -> Self {
        let sample_rate = f64::from(sample_rate.max(8_000));
        Self {
            control,
            sample_rate,
            low_alpha: one_pole_alpha(190.0, sample_rate),
            mid_alpha: one_pole_alpha(2_600.0, sample_rate),
            low_pass: 0.0,
            mid_pass: 0.0,
            envelope: VisualizerFrame::default(),
            bass_average: 0.0,
            beats: BeatTracker::new(sample_rate),
            hop_bands: [0.0; 3],
            hop_fill: 0,
        }
    }

    pub fn process_interleaved_stereo(&mut self, samples: &[f64]) {
        let frames = samples.len() / 2;
        if frames == 0 {
            return;
        }

        let mut energy_sum = 0.0;
        let mut bass_sum = 0.0;
        let mut mid_sum = 0.0;
        let mut high_sum = 0.0;
        for frame in samples.chunks_exact(2) {
            let left = finite_sample(frame[0]);
            let right = finite_sample(frame[1]);
            let mono = (left + right) * 0.5;
            self.low_pass += self.low_alpha * (mono - self.low_pass);
            self.mid_pass += self.mid_alpha * (mono - self.mid_pass);
            let bass = self.low_pass;
            let mid = self.mid_pass - self.low_pass;
            let high = mono - self.mid_pass;
            energy_sum += (left * left + right * right) * 0.5;
            bass_sum += bass * bass;
            mid_sum += mid * mid;
            high_sum += high * high;
            self.hop_bands[0] += bass * bass;
            self.hop_bands[1] += mid * mid;
            self.hop_bands[2] += high * high;
            self.hop_fill += 1;
            if self.hop_fill == HOP {
                self.beats
                    .push_hop(self.hop_bands.map(|sum| sum / HOP as f64));
                self.hop_bands = [0.0; 3];
                self.hop_fill = 0;
            }
        }

        let count = frames as f64;
        let target_bass = normalize_rms((bass_sum / count).sqrt(), 1.55);
        let target = VisualizerFrame {
            energy: normalize_rms((energy_sum / count).sqrt(), 1.0),
            bass: target_bass,
            mid: normalize_rms((mid_sum / count).sqrt(), 1.35),
            high: normalize_rms((high_sum / count).sqrt(), 1.7),
            beat: 0.0,
        };
        let seconds = count / self.sample_rate;
        self.bass_average = smooth(self.bass_average, target_bass, seconds, 0.34);
        let onset = ((target_bass - self.bass_average) * 5.2).clamp(0.0, 1.0);
        self.envelope.energy = smooth_envelope(self.envelope.energy, target.energy, seconds);
        self.envelope.bass = smooth_envelope(self.envelope.bass, target.bass, seconds);
        self.envelope.mid = smooth_envelope(self.envelope.mid, target.mid, seconds);
        self.envelope.high = smooth_envelope(self.envelope.high, target.high, seconds);
        self.envelope.beat = if onset > self.envelope.beat {
            smooth(self.envelope.beat, onset, seconds, 0.025)
        } else {
            smooth(self.envelope.beat, 0.0, seconds, 0.19)
        };
        self.control.publish(self.envelope, self.beats.state());
    }

    pub fn reset(&mut self) {
        self.low_pass = 0.0;
        self.mid_pass = 0.0;
        self.envelope = VisualizerFrame::default();
        self.bass_average = 0.0;
        self.beats.reset();
        self.hop_bands = [0.0; 3];
        self.hop_fill = 0;
        self.control.reset();
    }
}

fn one_pole_alpha(cutoff_hz: f64, sample_rate: f64) -> f64 {
    1.0 - (-std::f64::consts::TAU * cutoff_hz / sample_rate).exp()
}

fn normalize_rms(rms: f64, gain: f64) -> f32 {
    let db = 20.0 * (rms * gain).max(1.0e-6).log10();
    ((db + 54.0) / 48.0).clamp(0.0, 1.0) as f32
}

fn smooth_envelope(current: f32, target: f32, seconds: f64) -> f32 {
    smooth(
        current,
        target,
        seconds,
        if target > current { 0.055 } else { 0.28 },
    )
}

fn smooth(current: f32, target: f32, seconds: f64, time_constant: f64) -> f32 {
    let amount = (1.0 - (-seconds / time_constant).exp()) as f32;
    current + (target - current) * amount.clamp(0.0, 1.0)
}

fn finite_sample(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}
