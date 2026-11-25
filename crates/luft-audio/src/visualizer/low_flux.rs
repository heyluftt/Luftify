//! Bass hits by how the low spectrum changes instead of how loud it is:
//! a kick on top of a held bass note barely moves the level.

const TARGET_RATE: f64 = 5_512.0;
/// Bins this far below the loudest one are noise.
const FLOOR_DB: f64 = 30.0;
const SILENCE_DB: f64 = -96.0;

#[derive(Clone, Copy)]
struct Shape {
    /// Samples of the thinned-out signal.
    window: usize,
    low_hz: f64,
    high_hz: f64,
    /// Frames between the two spectra that are compared.
    lag: usize,
    /// A note gliding into the bin next door is no hit.
    glides: bool,
}

pub struct LowFlux {
    shape: Shape,
    step: usize,
    sum: f64,
    fill: usize,
    ring: Vec<f64>,
    at: usize,
    /// Per bin: window times cosine and sine.
    table: Vec<(f64, f64)>,
    bins: usize,
    levels: Vec<f64>,
    past: Vec<f64>,
    frames: usize,
    peak_db: f64,
}

impl LowFlux {
    /// Kicks and other hits: short window, fast.
    pub fn hits(sample_rate: f64) -> Self {
        Self::new(
            sample_rate,
            Shape {
                window: 256,
                low_hz: 30.0,
                high_hz: 400.0,
                lag: 4,
                glides: true,
            },
        )
    }

    /// A new bass note right after another one: only the pitch moves, so
    /// this looks closer and needs twice the time.
    pub fn notes(sample_rate: f64) -> Self {
        Self::new(
            sample_rate,
            Shape {
                window: 512,
                low_hz: 30.0,
                high_hz: 200.0,
                lag: 8,
                glides: false,
            },
        )
    }

    fn new(sample_rate: f64, shape: Shape) -> Self {
        let size = shape.window;
        let step = (sample_rate / TARGET_RATE).round().max(1.0) as usize;
        let bin_hz = sample_rate / step as f64 / size as f64;
        let first = (shape.low_hz / bin_hz).ceil().max(1.0) as usize;
        let last = ((shape.high_hz / bin_hz).floor() as usize).max(first);
        let window: Vec<f64> = (0..size)
            .map(|n| 0.5 - 0.5 * (std::f64::consts::TAU * n as f64 / size as f64).cos())
            .collect();
        let gain = 2.0 / window.iter().sum::<f64>();
        let table = (first..=last)
            .flat_map(|bin| {
                let window = &window;
                (0..size).map(move |n| {
                    let turn = std::f64::consts::TAU * (bin * n) as f64 / size as f64;
                    (window[n] * gain * turn.cos(), window[n] * gain * turn.sin())
                })
            })
            .collect();
        let bins = last - first + 1;
        Self {
            shape,
            step,
            sum: 0.0,
            fill: 0,
            ring: vec![0.0; size],
            at: 0,
            table,
            bins,
            levels: vec![SILENCE_DB; bins],
            past: vec![SILENCE_DB; bins * shape.lag],
            frames: 0,
            peak_db: SILENCE_DB,
        }
    }

    pub fn push(&mut self, mono: f64) {
        self.sum += mono;
        self.fill += 1;
        if self.fill == self.step {
            self.ring[self.at] = self.sum / self.step as f64;
            self.at = (self.at + 1) % self.shape.window;
            self.sum = 0.0;
            self.fill = 0;
        }
    }

    /// Mean rise of the bass bins in dB since a moment ago.
    pub fn rise_db(&mut self) -> f64 {
        let (newer, older) = self.ring.split_at(self.at);
        let levels = &mut self.levels;
        for (level, rows) in levels.iter_mut().zip(self.table.chunks_exact(self.shape.window)) {
            let (mut re, mut im) = (0.0, 0.0);
            for (sample, (cos, sin)) in older.iter().chain(newer).zip(rows) {
                re += sample * cos;
                im += sample * sin;
            }
            *level = 10.0 * (re * re + im * im).max(1.0e-18).log10();
        }
        self.peak_db = levels.iter().copied().fold(SILENCE_DB, f64::max);
        let floor = self.peak_db - FLOOR_DB;
        for level in levels.iter_mut() {
            *level = level.max(floor).max(SILENCE_DB);
        }

        let slot = self.frames % self.shape.lag * self.bins;
        let before = &self.past[slot..slot + self.bins];
        let mut rise = 0.0;
        for (bin, level) in levels.iter().enumerate() {
            let reach = usize::from(self.shape.glides);
            let from = bin.saturating_sub(reach);
            let to = (bin + reach).min(self.bins - 1);
            let reference = before[from..=to].iter().copied().fold(SILENCE_DB, f64::max);
            rise += (level - reference).max(0.0);
        }
        self.past[slot..slot + self.bins].copy_from_slice(levels);
        self.frames += 1;
        rise / self.bins as f64
    }

    /// Level of the loudest bass tone in the last window.
    pub fn peak_db(&self) -> f64 {
        self.peak_db
    }

    pub fn reset(&mut self) {
        self.sum = 0.0;
        self.fill = 0;
        self.ring.fill(0.0);
        self.at = 0;
        self.past.fill(SILENCE_DB);
        self.frames = 0;
        self.peak_db = SILENCE_DB;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 44_100.0;
    const HOP: usize = 256;

    fn rises(signal: impl Fn(f64) -> f64, seconds: f64) -> Vec<f64> {
        rises_of(LowFlux::hits(RATE), signal, seconds)
    }

    fn rises_of(mut flux: LowFlux, signal: impl Fn(f64) -> f64, seconds: f64) -> Vec<f64> {
        let mut out = Vec::new();
        for index in 0..(seconds * RATE) as usize {
            flux.push(signal(index as f64 / RATE));
            if (index + 1) % HOP == 0 {
                out.push(flux.rise_db());
            }
        }
        out
    }

    fn tone(hz: f64, t: f64) -> f64 {
        (std::f64::consts::TAU * hz * t).sin() * 0.5
    }

    #[test]
    fn a_held_note_is_no_hit() {
        let rises = rises(|t| tone(45.0, t), 2.0);
        let held = rises[rises.len() / 2..].iter().copied().fold(0.0, f64::max);
        assert!(held < 0.5, "held {held}");
    }

    #[test]
    fn a_kick_on_a_held_note_is_a_hit() {
        // Same loudness all the way, like behind a limiter.
        let rises = rises(
            |t| {
                let since = (t - 1.0).max(0.0);
                let sweep = 60.0 + 240.0 * (-since / 0.03).exp();
                let kick = if t >= 1.0 { tone(sweep, since) * (-since / 0.08).exp() } else { 0.0 };
                (tone(45.0, t) + kick).clamp(-0.5, 0.5)
            },
            2.0,
        );
        let frame = (RATE / HOP as f64) as usize;
        let before = rises[frame / 2..frame - 2].iter().copied().fold(0.0, f64::max);
        let hit = rises[frame..frame + 12].iter().copied().fold(0.0, f64::max);
        assert!(before < 0.5 && hit > 5.0, "before {before}, hit {hit}");
    }

    #[test]
    fn a_new_note_right_after_another_is_a_hit() {
        // Same loudness, only the pitch steps down a little.
        let rises = rises_of(
            LowFlux::notes(RATE),
            |t| {
                let hz = if t < 1.0 { 70.0 } else { 62.0 };
                tone(hz, t) + tone(hz * 2.0, t) * 0.5 + tone(hz * 3.0, t) * 0.3
            },
            2.0,
        );
        let frame = (RATE / HOP as f64) as usize;
        let before = rises[frame / 2..frame - 2].iter().copied().fold(0.0, f64::max);
        let hit = rises[frame..frame + 20].iter().copied().fold(0.0, f64::max);
        assert!(before < 0.5 && hit > 4.0, "before {before}, hit {hit}");
    }
}
