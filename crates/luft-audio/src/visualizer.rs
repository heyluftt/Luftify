use std::{
    sync::{
        Arc, Mutex, PoisonError,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

mod beat;
mod low_flux;
mod presentation;

use beat::{BeatTracker, HOP};
use low_flux::LowFlux;
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
    origin: Instant,
    presentation: Mutex<Presentation>,
    /// When the next sample handed to the output will be heard.
    queue_end_micros: AtomicU64,
}

impl Default for VisualizerControl {
    fn default() -> Self {
        Self {
            shared: Arc::new(VisualizerState {
                origin: Instant::now(),
                presentation: Mutex::new(Presentation::new()),
                queue_end_micros: AtomicU64::new(0),
            }),
        }
    }
}

impl VisualizerControl {
    /// What is audible right now, not what was analysed last.
    #[must_use]
    pub fn frame(&self) -> VisualizerFrame {
        self.presentation()
            .audible(self.now_micros() + DISPLAY_LEAD_MICROS)
    }

    /// Reported by the audio output after every write: how long the audio
    /// it holds still plays.
    pub fn set_output_latency(&self, latency: Duration) {
        let micros = u64::try_from(latency.as_micros()).unwrap_or(u64::MAX);
        self.shared
            .queue_end_micros
            .store(self.now_micros().saturating_add(micros), Ordering::Relaxed);
    }

    pub fn reset(&self) {
        self.presentation().clear();
    }

    fn now_micros(&self) -> u64 {
        u64::try_from(self.shared.origin.elapsed().as_micros()).unwrap_or(u64::MAX)
    }

    fn next_audible_micros(&self) -> u64 {
        self.shared
            .queue_end_micros
            .load(Ordering::Relaxed)
            .max(self.now_micros())
    }

    fn publish(&self, audible_at: u64, frame: VisualizerFrame, beat: beat::BeatState) {
        self.presentation().publish(audible_at, frame, beat);
    }

    fn presentation(&self) -> std::sync::MutexGuard<'_, Presentation> {
        self.shared
            .presentation
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

/// Reading, smoothing and drawing take this long; values are handed out
/// that much ahead so the screen meets the speaker.
const DISPLAY_LEAD_MICROS: u64 = 40_000;

pub struct VisualizerAnalyzer {
    control: VisualizerControl,
    sample_rate: f64,
    low_alpha: f64,
    mid_alpha: f64,
    low_pass: f64,
    mid_pass: f64,
    /// Smoothed power of the full signal, mid and high.
    power: [f64; 3],
    power_alphas: [f64; 3],
    envelope: VisualizerFrame,
    level: SongLevel,
    low_flux: LowFlux,
    bass_hit: SpectrumHit,
    note_flux: LowFlux,
    note_hit: SpectrumHit,
    /// Level, mid, high and bass hit of the last frames.
    recent: [[f32; 4]; ALIGN_FRAMES],
    recent_beats: [beat::BeatState; ALIGN_FRAMES],
    published: usize,
    hits: [BandHit; 2],
    frame_sums: [f64; 3],
    frame_fill: usize,
    /// When the next sample to analyse is heard, in the control's clock.
    clock: Option<f64>,
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
            power: [0.0; 3],
            power_alphas: POWER_SECONDS.map(|seconds| 1.0 - (-1.0 / (seconds * sample_rate)).exp()),
            envelope: VisualizerFrame::default(),
            level: SongLevel::default(),
            low_flux: LowFlux::hits(sample_rate),
            bass_hit: SpectrumHit::new(FLUX_MAX_REACH_DB),
            note_flux: LowFlux::notes(sample_rate),
            note_hit: SpectrumHit::new(NOTE_MAX_REACH_DB),
            recent: [[0.0; 4]; ALIGN_FRAMES],
            recent_beats: [beat::BeatState::default(); ALIGN_FRAMES],
            published: 0,
            hits: BandHit::all(),
            frame_sums: [0.0; 3],
            frame_fill: 0,
            clock: None,
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

        // Packets differ in length (3 to 23 ms) and so does the queue ahead of
        // them, so every value carries the time it is heard.
        let measured = self.control.next_audible_micros() as f64;
        let micros_per_frame = 1_000_000.0 / self.sample_rate;
        let start = match self.clock {
            Some(clock) if (clock - measured).abs() < RESYNC_MICROS => {
                let seconds = frames as f64 / self.sample_rate;
                clock + (measured - clock) * (1.0 - (-seconds / 0.25).exp())
            }
            _ => measured,
        };
        for (index, frame) in samples.chunks_exact(2).enumerate() {
            let left = finite_sample(frame[0]);
            let right = finite_sample(frame[1]);
            let mono = (left + right) * 0.5;
            self.low_pass += self.low_alpha * (mono - self.low_pass);
            self.mid_pass += self.mid_alpha * (mono - self.mid_pass);
            let bass = self.low_pass;
            let mid = self.mid_pass - self.low_pass;
            let high = mono - self.mid_pass;
            let squares = [(left * left + right * right) * 0.5, mid * mid, high * high];
            for (band, square) in squares.into_iter().enumerate() {
                self.power[band] += self.power_alphas[band] * (square - self.power[band]);
                self.frame_sums[band] += self.power[band];
            }
            self.low_flux.push(mono);
            self.note_flux.push(mono);
            self.frame_fill += 1;
            if self.frame_fill == FRAME_HOP {
                self.publish_frame(start + (index + 1) as f64 * micros_per_frame);
            }
            self.hop_bands[0] += bass * bass;
            self.hop_bands[1] += squares[1];
            self.hop_bands[2] += squares[2];
            self.hop_fill += 1;
            if self.hop_fill == HOP {
                self.beats
                    .push_hop(self.hop_bands.map(|sum| sum / HOP as f64));
                self.hop_bands = [0.0; 3];
                self.hop_fill = 0;
            }
        }
        self.clock = Some(start + frames as f64 * micros_per_frame);
    }

    fn publish_frame(&mut self, audible_at: f64) {
        let seconds = FRAME_HOP as f64 / self.sample_rate;
        let [energy_db, mid_db, high_db] = self
            .frame_sums
            .map(|sum| 10.0 * (sum / FRAME_HOP as f64).max(1.0e-12).log10());
        self.frame_sums = [0.0; 3];
        self.frame_fill = 0;
        let level = self.level.value(energy_db, seconds);
        let hit = self.bass_hit.value(self.low_flux.rise_db(), seconds);
        let [mid, high] = &mut self.hits;
        let mid = mid.value(mid_db, seconds);
        let high = high.value(high_db, seconds);
        // A quiet rumble changes all the time; only a bass that carries the
        // song counts as notes.
        let note_rise = self.note_flux.rise_db();
        let share_db = self.note_flux.peak_db() - 3.0 - energy_db;
        let carries = ((share_db + 9.0) / 5.0).clamp(0.0, 1.0);
        let note = self.note_hit.value(note_rise * carries, seconds);

        // The detectors answer at different speeds: line them up.
        let slot = self.published % ALIGN_FRAMES;
        let [level, mid, high, _] = std::mem::replace(&mut self.recent[slot], [level, mid, high, hit]);
        let hit = self.recent[(self.published + HIT_BEHIND) % ALIGN_FRAMES][3];
        let beats = std::mem::replace(&mut self.recent_beats[slot], self.beats.state());
        self.published += 1;

        let bass = hit.max(note);
        // A drum hits mids and highs together; a voice mostly only one of them.
        let drum = mid.min(high) * DRUM_SHARE;
        let envelope = &mut self.envelope;
        envelope.energy = smooth_envelope(envelope.energy, level, seconds, 0.08, 0.3);
        envelope.bass = smooth_envelope(envelope.bass, bass, seconds, HIT_ATTACK, 0.1);
        envelope.mid = smooth_envelope(envelope.mid, mid, seconds, HIT_ATTACK, 0.08);
        envelope.high = smooth_envelope(envelope.high, high, seconds, HIT_ATTACK, 0.055);
        let beat = bass.max(drum).max(high * HAT_SHARE);
        envelope.beat = smooth_envelope(envelope.beat, beat, seconds, HIT_ATTACK, 0.09);
        let behind = (ALIGN_FRAMES * FRAME_HOP) as f64 * 1_000_000.0 / self.sample_rate;
        self.control
            .publish((audible_at - behind).max(0.0) as u64, self.envelope, beats);
    }

    pub fn reset(&mut self) {
        self.low_pass = 0.0;
        self.mid_pass = 0.0;
        self.power = [0.0; 3];
        self.envelope = VisualizerFrame::default();
        self.level = SongLevel::default();
        self.low_flux.reset();
        self.bass_hit = SpectrumHit::new(FLUX_MAX_REACH_DB);
        self.note_flux.reset();
        self.note_hit = SpectrumHit::new(NOTE_MAX_REACH_DB);
        self.recent = [[0.0; 4]; ALIGN_FRAMES];
        self.recent_beats = [beat::BeatState::default(); ALIGN_FRAMES];
        self.published = 0;
        self.hits = BandHit::all();
        self.frame_sums = [0.0; 3];
        self.frame_fill = 0;
        self.clock = None;
        self.beats.reset();
        self.hop_bands = [0.0; 3];
        self.hop_fill = 0;
        self.control.reset();
    }
}

fn one_pole_alpha(cutoff_hz: f64, sample_rate: f64) -> f64 {
    1.0 - (-std::f64::consts::TAU * cutoff_hz / sample_rate).exp()
}

const SILENCE_DB: f64 = -72.0;
const MIN_SPAN_DB: f64 = 10.0;
const MIN_REACH_DB: f64 = 3.0;
const MAX_REACH_DB: f64 = 16.0;
/// Level wobble below this is not a hit.
const DEAD_DB: f64 = 0.8;
const HIT_ATTACK: f64 = 0.005;
/// Frames between two published values (6 ms).
const FRAME_HOP: usize = 256;
/// A clock further off than this starts anew (seek, new song, dropout).
const RESYNC_MICROS: f64 = 80_000.0;
/// Smoothing of the power before the level is read: full, mid, high.
const POWER_SECONDS: [f64; 3] = [0.015, 0.012, 0.006];
const FLUX_DEAD_DB: f64 = 2.5;
const FLUX_MIN_REACH_DB: f64 = 4.5;
const FLUX_MAX_REACH_DB: f64 = 12.0;
const NOTE_MAX_REACH_DB: f64 = 8.0;
/// Frames the slowest detector (bass notes) answers after mids and highs.
const ALIGN_FRAMES: usize = 8;
/// And the bass hits.
const HIT_BEHIND: usize = 2;
/// Snares stay a bit below the bass; a note that lands on a hi-hat looks
/// the same from here.
const DRUM_SHARE: f32 = 0.75;
/// A hi-hat alone shows as a small tick.
const HAT_SHARE: f32 = 0.22;

/// A band as hits: how far it jumps above the level it just had, measured
/// against the usual jump in this song. A held note is no hit, so a long bass
/// note does not keep the visuals pinned at full.
#[derive(Debug, Clone, Copy)]
struct BandHit {
    rise_seconds: f64,
    state: Option<HitState>,
}

#[derive(Debug, Clone, Copy)]
struct HitState {
    slow_db: f64,
    reach_db: f64,
}

impl BandHit {
    const fn new(rise_seconds: f64) -> Self {
        Self {
            rise_seconds,
            state: None,
        }
    }

    /// Mid, high.
    const fn all() -> [Self; 2] {
        [Self::new(0.05), Self::new(0.04)]
    }

    fn value(&mut self, db: f64, seconds: f64) -> f32 {
        let db = db.max(SILENCE_DB);
        let state = self.state.get_or_insert(HitState {
            slow_db: db,
            reach_db: MIN_REACH_DB,
        });
        let rise = db - state.slow_db;
        let catch_up = if rise > 0.0 { self.rise_seconds } else { 0.08 };
        state.slow_db = follow(state.slow_db, db, seconds, catch_up);
        state.reach_db = if rise > state.reach_db {
            follow(state.reach_db, rise.min(MAX_REACH_DB), seconds, 0.3)
        } else {
            follow(state.reach_db, MIN_REACH_DB, seconds, 8.0)
        };
        let full = state.reach_db.clamp(MIN_REACH_DB, MAX_REACH_DB);
        ((rise - DEAD_DB) / (full - DEAD_DB)).clamp(0.0, 1.0) as f32
    }
}

/// The bass as hits: how much its spectrum changes, against the usual change
/// in this song.
#[derive(Debug, Clone, Copy)]
struct SpectrumHit {
    reach_db: f64,
    max_reach_db: f64,
}

impl SpectrumHit {
    const fn new(max_reach_db: f64) -> Self {
        Self {
            reach_db: FLUX_MIN_REACH_DB,
            max_reach_db,
        }
    }

    fn value(&mut self, rise: f64, seconds: f64) -> f32 {
        self.reach_db = if rise > self.reach_db {
            follow(self.reach_db, rise.min(self.max_reach_db), seconds, 0.3)
        } else {
            follow(self.reach_db, FLUX_MIN_REACH_DB, seconds, 8.0)
        };
        ((rise - FLUX_DEAD_DB) / (self.reach_db - FLUX_DEAD_DB)).clamp(0.0, 1.0) as f32
    }
}

/// How loud the song is right now within its own recent range.
#[derive(Debug, Clone, Copy, Default)]
struct SongLevel {
    range: Option<(f64, f64)>,
}

impl SongLevel {
    fn value(&mut self, db: f64, seconds: f64) -> f32 {
        if db < SILENCE_DB {
            return 0.0;
        }
        let (ceiling, floor) = self.range.get_or_insert((db, db - MIN_SPAN_DB));
        *ceiling = follow(*ceiling, db, seconds, if db > *ceiling { 0.12 } else { 6.0 });
        *floor = follow(*floor, db, seconds, if db < *floor { 0.25 } else { 8.0 });
        let span = (*ceiling - *floor).max(MIN_SPAN_DB);
        ((db - (*ceiling - span)) / span).clamp(0.0, 1.0) as f32
    }
}

fn follow(current: f64, target: f64, seconds: f64, time_constant: f64) -> f64 {
    current + (target - current) * (1.0 - (-seconds / time_constant).exp())
}

fn smooth_envelope(current: f32, target: f32, seconds: f64, attack: f64, release: f64) -> f32 {
    smooth(
        current,
        target,
        seconds,
        if target > current { attack } else { release },
    )
}

fn smooth(current: f32, target: f32, seconds: f64, time_constant: f64) -> f32 {
    let amount = (1.0 - (-seconds / time_constant).exp()) as f32;
    current + (target - current) * amount.clamp(0.0, 1.0)
}

fn finite_sample(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 44_100;
    /// Samples per packet as the player delivers them (13 ms).
    const PACKET: usize = 1_152;

    /// A loudly mastered groove: pad and noise bed, kick on every beat, hat in between.
    fn groove(seconds: f64, bpm: f64, volume: f64) -> Vec<f64> {
        let frames = (seconds * f64::from(RATE)) as usize;
        let beat = 60.0 / bpm;
        let mut seed = 0x2545_F491_u32;
        let mut samples = Vec::with_capacity(frames * 2);
        for index in 0..frames {
            let t = index as f64 / f64::from(RATE);
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = f64::from(seed >> 8) / f64::from(1_u32 << 23) - 1.0;
            let pad = [110.0, 220.0, 330.0, 880.0, 2_400.0]
                .iter()
                .map(|hz| (std::f64::consts::TAU * hz * t).sin())
                .sum::<f64>()
                * 0.07;
            let since_kick = t % beat;
            let kick = (std::f64::consts::TAU * 58.0 * since_kick).sin() * (-since_kick / 0.09).exp() * 0.55;
            let since_hat = (t + beat / 2.0) % beat;
            let hat = noise * (-since_hat / 0.03).exp() * 0.25;
            let sample = (pad + noise * 0.05 + kick + hat) * volume;
            samples.push(sample);
            samples.push(sample);
        }
        samples
    }

    fn swing(volume: f64) -> [(f32, f32); 4] {
        let mut analyzer = VisualizerAnalyzer::new(RATE, VisualizerControl::default());
        let samples = groove(8.0, 120.0, volume);
        let mut low = [1.0_f32; 4];
        let mut high = [0.0_f32; 4];
        for (packet, chunk) in samples.chunks(PACKET).enumerate() {
            analyzer.process_interleaved_stereo(chunk);
            if packet * PACKET / 2 < 4 * RATE as usize {
                continue;
            }
            let frame = analyzer.envelope;
            for (slot, value) in [frame.energy, frame.bass, frame.mid, frame.high].into_iter().enumerate() {
                low[slot] = low[slot].min(value);
                high[slot] = high[slot].max(value);
            }
        }
        [0, 1, 2, 3].map(|slot| (low[slot], high[slot]))
    }

    #[test]
    fn a_loud_master_still_moves() {
        let [energy, bass, _, high] = swing(1.0);
        assert!(bass.0 < 0.15 && bass.1 > 0.7, "bass {bass:?}");
        assert!(high.0 < 0.2 && high.1 > 0.7, "high {high:?}");
        assert!(energy.0 > 0.4, "energy {energy:?}");
    }

    #[test]
    fn the_picture_does_not_depend_on_volume() {
        let loud = swing(1.0);
        let quiet = swing(0.05);
        for (loud, quiet) in loud.into_iter().zip(quiet) {
            assert!((loud.0 - quiet.0).abs() < 0.02 && (loud.1 - quiet.1).abs() < 0.02);
        }
    }

    #[test]
    fn a_held_bass_note_hits_and_then_lets_go() {
        let mut analyzer = VisualizerAnalyzer::new(RATE, VisualizerControl::default());
        let mut seed = 0x1234_5678_u32;
        let mut peak = 0.0_f32;
        let mut held = 0.0_f32;
        let frames = 4 * RATE as usize;
        let samples: Vec<f64> = (0..frames)
            .flat_map(|index| {
                let t = index as f64 / f64::from(RATE);
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let bed = (f64::from(seed >> 8) / f64::from(1_u32 << 23) - 1.0) * 0.01;
                let note = if t >= 2.0 {
                    (std::f64::consts::TAU * 55.0 * t).sin() * 0.5
                } else {
                    0.0
                };
                [bed + note, bed + note]
            })
            .collect();
        for (packet, chunk) in samples.chunks(PACKET).enumerate() {
            analyzer.process_interleaved_stereo(chunk);
            let t = (packet * PACKET / 2) as f64 / f64::from(RATE);
            if (2.0..2.2).contains(&t) {
                peak = peak.max(analyzer.envelope.bass);
            }
            if t >= 3.2 {
                held = held.max(analyzer.envelope.bass);
            }
        }
        assert!(peak > 0.8, "hit {peak}");
        assert!(held < 0.05, "held {held}");
    }

    #[test]
    fn values_come_out_when_they_are_heard() {
        let control = VisualizerControl::default();
        let mut analyzer = VisualizerAnalyzer::new(RATE, control.clone());
        control.set_output_latency(Duration::from_millis(250));
        analyzer.process_interleaved_stereo(&groove(0.1, 120.0, 1.0));
        assert_eq!(control.frame(), VisualizerFrame::default());
        std::thread::sleep(Duration::from_millis(300));
        assert!(control.frame().energy > 0.0);
    }

    #[test]
    fn silence_stays_dark() {
        let mut analyzer = VisualizerAnalyzer::new(RATE, VisualizerControl::default());
        analyzer.process_interleaved_stereo(&vec![0.0; 8_192]);
        assert_eq!(analyzer.envelope, VisualizerFrame::default());
    }
}
