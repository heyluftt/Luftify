//! Real-time beat tracking with a phase-locked loop.
//!
//! 1. Onset detection: every hop (512 samples, ~11.6 ms) the energy of three
//!    bands is log-compressed; its rise over the previous hop (spectral flux,
//!    band-weighted, locally detrended) forms the onset curve.
//! 2. Tempo: the autocorrelation of ~6 s of onset curve peaks at the beat
//!    period. A comb (lags L, 2L, 4L) and a tempo prior around 120 BPM keep it
//!    from locking onto half or double time.
//! 3. Phase: a comb over the onset history ("where do all beats line up?")
//!    measures the position of the last beat.
//! 4. Phase-locked loop: between measurements the phase runs freely at the
//!    period; each measurement pulls phase and period toward it. The loop
//!    therefore keeps the beat through breaks and predicts the next beat,
//!    which is what lets the visuals land on it instead of after it.
//!
//! Reference: Davies & Plumbley, "Context-dependent beat tracking of musical
//! audio" (2007); Ellis, "Beat tracking by dynamic programming" (2007).

pub(crate) const HOP: usize = 512;
const HISTORY: usize = 512;
const MIN_BPM: f64 = 60.0;
const MAX_BPM: f64 = 200.0;
/// Rayleigh prior peak; most popular music sits between 90 and 140 BPM.
const PRIOR_BPM: f64 = 120.0;
/// Analysis cadence in hops (~0.37 s).
const ANALYSIS_EVERY: usize = 32;
/// Seconds of onset history before the first tempo estimate.
const WARM_UP_SECONDS: f64 = 3.0;
const BAND_WEIGHTS: [f64; 3] = [1.0, 0.7, 0.45];

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct BeatState {
    /// Position inside the current beat at the newest analysed sample:
    /// 0 on the beat, rising towards 1 just before the next one.
    pub(crate) phase: f64,
    pub(crate) period_seconds: f64,
    /// 0 (no beat found) to 1 (tempo clear and phase locked).
    pub(crate) confidence: f64,
}

pub(crate) struct BeatTracker {
    hop_rate: f64,
    previous_level: [f64; 3],
    local_mean: f64,
    mean_alpha: f64,
    onsets: Vec<f64>,
    newest: usize,
    filled: usize,
    since_analysis: usize,
    period: f64,
    phase: f64,
    confidence: f64,
    pending_period: Option<f64>,
    onset_peak: f64,
}

impl BeatTracker {
    pub(crate) fn new(sample_rate: f64) -> Self {
        let hop_rate = sample_rate / HOP as f64;
        Self {
            hop_rate,
            previous_level: [0.0; 3],
            local_mean: 0.0,
            mean_alpha: 1.0 - (-1.0 / (0.25 * hop_rate)).exp(),
            onsets: vec![0.0; HISTORY],
            newest: 0,
            filled: 0,
            since_analysis: 0,
            period: 0.0,
            phase: 0.0,
            confidence: 0.0,
            pending_period: None,
            onset_peak: 1.0e-6,
        }
    }

    /// Feeds the mean-square energy of the bass, mid and high band of one hop.
    pub(crate) fn push_hop(&mut self, bands: [f64; 3]) {
        let mut flux = 0.0;
        for (band, energy) in bands.into_iter().enumerate() {
            let level = (1.0 + 1_000.0 * energy.max(0.0)).ln();
            flux += BAND_WEIGHTS[band] * (level - self.previous_level[band]).max(0.0);
            self.previous_level[band] = level;
        }
        self.local_mean += self.mean_alpha * (flux - self.local_mean);
        let onset = (flux - self.local_mean).max(0.0);
        self.newest = (self.newest + 1) % HISTORY;
        self.onsets[self.newest] = onset;
        self.filled = (self.filled + 1).min(HISTORY);
        self.onset_peak = (self.onset_peak * 0.995).max(onset).max(1.0e-6);

        if self.period > 0.0 {
            self.phase += 1.0 / self.period;
            self.phase -= self.phase.floor();
            // A strong onset close to the expected beat nudges the phase.
            let error = wrapped(self.phase);
            if onset > self.onset_peak * 0.45 && error.abs() < 0.12 {
                self.phase = (self.phase - error * 0.2).rem_euclid(1.0);
            }
        }

        let silent = bands.iter().sum::<f64>() < 1.0e-7;
        if silent {
            // Slow: musical breaks rarely last long; a stop is caught by staleness.
            self.confidence *= 0.995;
        }
        self.since_analysis += 1;
        if self.since_analysis >= ANALYSIS_EVERY
            && self.filled as f64 >= WARM_UP_SECONDS * self.hop_rate
            && !silent
        {
            self.since_analysis = 0;
            self.analyse();
        }
    }

    pub(crate) fn state(&self) -> BeatState {
        if self.period <= 0.0 {
            return BeatState::default();
        }
        BeatState {
            phase: self.phase,
            period_seconds: self.period / self.hop_rate,
            confidence: self.confidence,
        }
    }

    pub(crate) fn reset(&mut self) {
        *self = Self::new(self.hop_rate * HOP as f64);
    }

    fn analyse(&mut self) {
        let Some((lag, strength)) = self.tempo_lag() else {
            self.confidence *= 0.8;
            return;
        };
        self.update_period(lag);
        let measured = self.phase_of_last_beat();
        let error = wrapped(measured - self.phase);
        // Measurements are robust (a comb over ~6 s), so the loop follows them
        // firmly; the per-onset nudges above only fine-tune in between.
        self.phase = (self.phase + error * 0.5).rem_euclid(1.0);
        let lock = (1.0 - error.abs() * 3.0).clamp(0.0, 1.0);
        self.confidence = self.confidence * 0.6 + strength * lock * 0.4;
    }

    /// Best beat period in hops (fractional) and how clearly it stands out.
    fn tempo_lag(&self) -> Option<(f64, f64)> {
        let min_lag = (self.hop_rate * 60.0 / MAX_BPM).floor() as usize;
        let max_lag = (self.hop_rate * 60.0 / MIN_BPM).ceil() as usize;
        let prior_lag = self.hop_rate * 60.0 / PRIOR_BPM;
        let length = self.filled;
        if length < max_lag * 2 {
            return None;
        }
        let correlation = |lag: usize| -> f64 {
            if lag >= length {
                return 0.0;
            }
            let mut sum = 0.0;
            for age in 0..length - lag {
                sum += self.onset(age) * self.onset(age + lag);
            }
            sum / (length - lag) as f64
        };
        let energy = correlation(0).max(1.0e-12);
        let mut scores = Vec::with_capacity(max_lag - min_lag + 1);
        for lag in min_lag..=max_lag {
            let comb = correlation(lag) + 0.5 * correlation(lag * 2) + 0.25 * correlation(lag * 4);
            let lag_f = lag as f64;
            let prior = lag_f / (prior_lag * prior_lag)
                * (-(lag_f * lag_f) / (2.0 * prior_lag * prior_lag)).exp()
                * prior_lag
                * std::f64::consts::E.sqrt();
            scores.push(comb / energy * (0.35 + 0.65 * prior));
        }
        let (best_index, best) = scores
            .iter()
            .copied()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(&b.1))?;
        let mean = scores.iter().sum::<f64>() / scores.len() as f64;
        if best <= 0.0 || mean <= 0.0 {
            return None;
        }
        // Parabolic refinement to a fractional lag.
        let left = scores
            .get(best_index.wrapping_sub(1))
            .copied()
            .unwrap_or(best);
        let right = scores.get(best_index + 1).copied().unwrap_or(best);
        let curvature = left - 2.0 * best + right;
        let offset = if curvature < 0.0 {
            (0.5 * (left - right) / curvature).clamp(-0.5, 0.5)
        } else {
            0.0
        };
        let strength = ((best / mean - 1.25) / 1.5).clamp(0.0, 1.0);
        let coarse = (min_lag + best_index) as f64 + offset;
        Some((self.refine_lag(coarse), strength))
    }

    /// Integer lags are ~1 % apart at typical tempos; over the several beats
    /// the phase comb spans, that error adds up to tens of milliseconds.
    /// A fractional comb around the coarse lag pins the period down.
    fn refine_lag(&self, coarse: f64) -> f64 {
        let comb = |lag: f64| -> f64 {
            let reach = lag * 4.0 + 1.0;
            if reach >= self.filled as f64 {
                return 0.0;
            }
            let mut sum = 0.0;
            let mut age = 0.0;
            while age + reach < self.filled as f64 {
                let onset = self.onset_at(age);
                sum += onset
                    * (self.onset_at(age + lag)
                        + 0.5 * self.onset_at(age + lag * 2.0)
                        + 0.25 * self.onset_at(age + lag * 4.0));
                age += 1.0;
            }
            sum
        };
        let mut best = coarse;
        let mut best_score = comb(coarse);
        let mut lag = coarse - 1.5;
        while lag <= coarse + 1.5 {
            let score = comb(lag);
            if score > best_score {
                best_score = score;
                best = lag;
            }
            lag += 0.05;
        }
        best
    }

    /// Follows gradual tempo drift, but only switches to a clearly different
    /// tempo when two measurements in a row agree on it.
    fn update_period(&mut self, lag: f64) {
        if self.period <= 0.0 {
            self.period = lag;
            self.phase = 0.0;
            return;
        }
        if (lag / self.period - 1.0).abs() < 0.06 {
            self.period = self.period * 0.7 + lag * 0.3;
            self.pending_period = None;
            return;
        }
        match self.pending_period {
            Some(pending) if (lag / pending - 1.0).abs() < 0.06 => {
                self.period = lag;
                self.pending_period = None;
                self.confidence *= 0.5;
            }
            _ => self.pending_period = Some(lag),
        }
    }

    /// Phase of the newest hop, measured by lining up all past beats.
    fn phase_of_last_beat(&self) -> f64 {
        let period = self.period;
        let steps = period.ceil() as usize;
        let mut best_offset = 0.0;
        let mut best_score = f64::MIN;
        for step in 0..steps {
            let offset = step as f64;
            let mut score = 0.0;
            let mut age = offset;
            let mut weight = 1.0;
            while age < (self.filled - 1) as f64 {
                score += self.onset_at(age) * weight;
                // Recent beats count most; any residual period error grows with age.
                weight *= 0.8;
                age += period;
            }
            if score > best_score {
                best_score = score;
                best_offset = offset;
            }
        }
        (best_offset / period).rem_euclid(1.0)
    }

    fn onset(&self, age: usize) -> f64 {
        self.onsets[(self.newest + HISTORY - age % HISTORY) % HISTORY]
    }

    fn onset_at(&self, age: f64) -> f64 {
        let whole = age.floor() as usize;
        let fraction = age - whole as f64;
        self.onset(whole) * (1.0 - fraction) + self.onset(whole + 1) * fraction
    }
}

/// Maps a phase to [-0.5, 0.5): distance to the nearest beat, in beats.
fn wrapped(phase: f64) -> f64 {
    (phase + 0.5).rem_euclid(1.0) - 0.5
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44_100.0;

    /// Hop energies of a kick drum pattern with some noise, optionally with
    /// a silent break, and the true beat times in hops.
    fn pattern(bpm: f64, seconds: f64, break_between: Option<(f64, f64)>) -> Vec<[f64; 3]> {
        let hop_rate = RATE / HOP as f64;
        let hops = (seconds * hop_rate) as usize;
        let beat_hops = hop_rate * 60.0 / bpm;
        let mut seed = 7_u64;
        (0..hops)
            .map(|hop| {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                let noise = (seed >> 11) as f64 / (1_u64 << 53) as f64 * 0.002;
                let time = hop as f64 / hop_rate;
                if break_between.is_some_and(|(from, to)| time >= from && time < to) {
                    return [0.0; 3];
                }
                let since_beat = (hop as f64 % beat_hops) / hop_rate;
                let kick = (-since_beat / 0.06).exp() * 0.08;
                let offbeat = ((hop as f64 + beat_hops / 2.0) % beat_hops) / hop_rate;
                let hat = (-offbeat / 0.02).exp() * 0.01;
                [kick + noise, noise * 0.5 + 0.004, hat + noise]
            })
            .collect()
    }

    fn run(bands: &[[f64; 3]]) -> BeatTracker {
        let mut tracker = BeatTracker::new(RATE);
        for hop in bands {
            tracker.push_hop(*hop);
        }
        tracker
    }

    fn bpm(state: BeatState) -> f64 {
        60.0 / state.period_seconds
    }

    #[test]
    fn finds_tempo_and_locks_on_the_beat() {
        for tempo in [92.0, 128.0, 174.0] {
            let bands = pattern(tempo, 12.0, None);
            let state = run(&bands).state();
            assert!(
                (bpm(state) - tempo).abs() < 1.5,
                "{tempo}: {:.1} BPM",
                bpm(state)
            );
            let hop_rate = RATE / HOP as f64;
            let beat_hops = hop_rate * 60.0 / tempo;
            let true_phase = ((bands.len() - 1) as f64 % beat_hops) / beat_hops;
            let error = wrapped(state.phase - true_phase).abs() * state.period_seconds;
            assert!(
                error < 0.03,
                "{tempo}: phase off by {:.0} ms",
                error * 1_000.0
            );
            assert!(
                state.confidence > 0.4,
                "{tempo}: confidence {:.2}",
                state.confidence
            );
        }
    }

    /// Kick on 1 and 3, snare on 2 and 4, eighth-note hats, a syncopated
    /// extra kick and strong noise: the tracker must find the quarter note.
    fn drum_groove_noisy(bpm: f64, seconds: f64, amount: f64) -> Vec<[f64; 3]> {
        let hop_rate = RATE / HOP as f64;
        let beat = hop_rate * 60.0 / bpm;
        let mut seed = 11_u64;
        (0..(seconds * hop_rate) as usize)
            .map(|hop| {
                seed = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                let noise = (seed >> 11) as f64 / (1_u64 << 53) as f64 * amount;
                let position = hop as f64 / beat;
                let hit = |at: f64, cycle: f64, length: f64| {
                    let since = (position - at).rem_euclid(cycle) * beat / hop_rate;
                    (-since / length).exp()
                };
                let kick = hit(0.0, 2.0, 0.07) * 0.08 + hit(2.5, 4.0, 0.06) * 0.05;
                let snare = hit(1.0, 2.0, 0.05) * 0.05;
                let hats = hit(0.0, 0.5, 0.015) * 0.012;
                [kick + noise, snare + noise * 0.6 + 0.006, hats + noise]
            })
            .collect()
    }

    #[test]
    fn finds_the_quarter_note_in_a_noisy_groove() {
        for tempo in [96.0, 124.0] {
            let bands = drum_groove_noisy(tempo, 14.0, 0.008);
            let state = run(&bands).state();
            assert!(
                (bpm(state) - tempo).abs() < 1.0,
                "{tempo}: {:.1} BPM",
                bpm(state)
            );
            let hop_rate = RATE / HOP as f64;
            let beat_hops = hop_rate * 60.0 / tempo;
            let true_phase = ((bands.len() - 1) as f64 % beat_hops) / beat_hops;
            let error = wrapped(state.phase - true_phase).abs() * state.period_seconds;
            assert!(
                error < 0.02,
                "{tempo}: phase off by {:.0} ms",
                error * 1_000.0
            );
            assert!(
                state.confidence > 0.3,
                "{tempo}: confidence {:.2}",
                state.confidence
            );
        }
    }

    #[test]
    fn admits_uncertainty_when_the_groove_drowns_in_noise() {
        for tempo in [96.0, 124.0] {
            let state = run(&drum_groove_noisy(tempo, 14.0, 0.012)).state();
            assert!(
                state.confidence < 0.2,
                "{tempo}: confidence {:.2}",
                state.confidence
            );
        }
    }

    #[test]
    fn keeps_the_beat_through_a_short_break() {
        let tempo = 120.0;
        let bands = pattern(tempo, 14.0, Some((9.0, 10.5)));
        let mut tracker = BeatTracker::new(RATE);
        let hop_rate = RATE / HOP as f64;
        let resume = (10.5 * hop_rate) as usize;
        for hop in &bands[..resume] {
            tracker.push_hop(*hop);
        }
        // Right after the break the prediction must still match the grid.
        let state = tracker.state();
        let beat_hops = hop_rate * 60.0 / tempo;
        let true_phase = ((resume - 1) as f64 % beat_hops) / beat_hops;
        let error = wrapped(state.phase - true_phase).abs() * state.period_seconds;
        assert!(
            error < 0.04,
            "phase off by {:.0} ms after the break",
            error * 1_000.0
        );
    }

    #[test]
    fn follows_a_tempo_change() {
        let mut bands = pattern(100.0, 10.0, None);
        bands.extend(pattern(140.0, 12.0, None));
        let state = run(&bands).state();
        assert!((bpm(state) - 140.0).abs() < 2.0, "{:.1} BPM", bpm(state));
    }

    #[test]
    fn silence_does_not_invent_a_beat() {
        let state = run(&vec![[0.0; 3]; 1_200]).state();
        assert!(state.confidence < 0.05);
    }
}
