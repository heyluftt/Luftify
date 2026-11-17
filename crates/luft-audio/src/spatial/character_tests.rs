//! Measured character of the room presets: tone, timing and loudness.
use super::SpatialProcessor;
use crate::SpatialSettings;
use crate::filters::{BiquadCoefficients, BiquadState};

const RATE: f64 = 48_000.0;

fn settings(id: &str, mix: f32, pre: f32, decay: f32, damping: f32, width: f32) -> SpatialSettings {
    SpatialSettings {
        enabled: true,
        preset_id: id.into(),
        cabin_mode: id == "car",
        mix_percent: mix,
        pre_delay_ms: pre,
        decay_seconds: decay,
        damping_percent: damping,
        stereo_width_percent: width,
    }
}

fn car() -> SpatialSettings {
    settings("car", 30.0, 0.0, 0.4, 68.0, 82.0)
}

fn impulse_response(settings: &SpatialSettings, frames: usize) -> (Vec<f64>, Vec<f64>) {
    let mut processor = SpatialProcessor::new(RATE, settings);
    (0..frames)
        .map(|index| {
            let sample = if index == 0 { 0.5 } else { 0.0 };
            let (left, right, _) = processor.process(sample, sample);
            (left, right)
        })
        .unzip()
}

/// Mean power of a third-octave band around `center`, in dB.
fn band_db(signal: &[f64], center: f64) -> f64 {
    let points = 24;
    let power: f64 = (0..points)
        .map(|point| {
            let offset = (point as f64 / (points - 1) as f64 - 0.5) / 3.0;
            let frequency = center * 2.0_f64.powf(offset);
            let (mut real, mut imaginary) = (0.0, 0.0);
            for (index, sample) in signal.iter().enumerate() {
                let angle = std::f64::consts::TAU * frequency * index as f64 / RATE;
                real += sample * angle.cos();
                imaginary -= sample * angle.sin();
            }
            real * real + imaginary * imaginary
        })
        .sum();
    10.0 * (power / points as f64).log10()
}

struct Noise(u64);

impl Noise {
    fn white(&mut self) -> f64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 11) as f64 / (1_u64 << 53) as f64 - 0.5
    }
}

/// Paul Kellet's pink noise filter.
#[derive(Default)]
struct Pink([f64; 3]);

impl Pink {
    fn next(&mut self, white: f64) -> f64 {
        self.0[0] = 0.997_65 * self.0[0] + white * 0.099_046;
        self.0[1] = 0.963 * self.0[1] + white * 0.296_516_4;
        self.0[2] = 0.57 * self.0[2] + white * 1.052_691_3;
        (self.0.iter().sum::<f64>() + white * 0.1848) * 0.06
    }
}

/// K-weighted (ITU-R BS.1770 style) level change on music-like pink noise:
/// a shared centre plus some independent side content per channel.
fn loudness_change_db(settings: &SpatialSettings) -> f64 {
    let shelf = BiquadCoefficients::high_shelf(RATE, 1_681.0, 1.0, 4.0);
    let highpass = {
        let omega = std::f64::consts::TAU * 38.0 / RATE;
        let (cosine, alpha) = (omega.cos(), omega.sin());
        let a0 = 1.0 + alpha;
        BiquadCoefficients {
            b0: (1.0 + cosine) / 2.0 / a0,
            b1: -(1.0 + cosine) / a0,
            b2: (1.0 + cosine) / 2.0 / a0,
            a1: -2.0 * cosine / a0,
            a2: (1.0 - alpha) / a0,
        }
    };
    let mut weighting = [[BiquadState::default(); 2]; 4];
    let mut weigh = |slot: usize, sample: f64| {
        let [first, second] = &mut weighting[slot];
        second.process(first.process(sample, highpass), shelf)
    };
    let mut processor = SpatialProcessor::new(RATE, settings);
    let mut noise = Noise(4_242);
    let mut pink: [Pink; 3] = Default::default();
    let (mut before, mut after) = (0.0, 0.0);
    for index in 0..192_000 {
        let source: [f64; 3] = std::array::from_fn(|channel| pink[channel].next(noise.white()));
        let input = [source[0] + source[1] * 0.45, source[0] + source[2] * 0.45];
        let (left, right, _) = processor.process(input[0], input[1]);
        let weighted = [
            weigh(0, input[0]),
            weigh(1, input[1]),
            weigh(2, left),
            weigh(3, right),
        ];
        if index > 24_000 {
            before += weighted[0].powi(2) + weighted[1].powi(2);
            after += weighted[2].powi(2) + weighted[3].powi(2);
        }
    }
    10.0 * (after / before).log10()
}

#[test]
fn car_sounds_like_a_cabin_not_a_room() {
    let (left, right) = impulse_response(&car(), 24_000);
    let mono: Vec<f64> = left.iter().zip(&right).map(|(l, r)| l + r).collect();
    let reference = band_db(&mono[..9_600], 1_000.0);
    // Cabin gain: bass well above the mids, but no boom.
    let bass = band_db(&mono[..9_600], 50.0) - reference;
    assert!((5.0..9.0).contains(&bass), "cabin gain {bass:.1} dB");
    assert!(band_db(&mono[..9_600], 250.0) - reference < 2.0);

    let energy = |signal: &[f64], from_ms: f64, to_ms: f64| {
        let range = (RATE * from_ms / 1_000.0) as usize..(RATE * to_ms / 1_000.0) as usize;
        signal[range]
            .iter()
            .map(|sample| sample * sample)
            .sum::<f64>()
    };
    // Boundaries sit within ~9 ms; the driver's window is nearer than the passenger's.
    assert!(energy(&left, 1.0, 10.0) > energy(&left, 12.0, 40.0) * 4.0);
    assert!(energy(&left, 1.0, 10.0) > energy(&right, 1.0, 10.0) * 1.15);
    // Direct sound leads, but only by a few dB: "too close" otherwise.
    let direct = energy(&left, 0.0, 1.0) + energy(&right, 0.0, 1.0);
    let early = energy(&left, 1.0, 10.0) + energy(&right, 1.0, 10.0);
    let ratio_db = 10.0 * (direct / early).log10();
    assert!(
        (0.0..5.0).contains(&ratio_db),
        "direct to reflected {ratio_db:.1} dB"
    );
    // Upholstered cabin: gone well before a tenth of a room's tail.
    assert!(energy(&left, 150.0, 500.0) < energy(&left, 0.0, 150.0) * 1.0e-3);
}

#[test]
fn every_room_keeps_the_loudness_of_the_dry_signal() {
    for preset in [car(), studio(), chamber(), concert_hall(), grand_hall()] {
        let change = loudness_change_db(&preset);
        assert!(change.abs() < 1.0, "{}: {change:+.2} dB", preset.preset_id);
    }
}

fn studio() -> SpatialSettings {
    settings("studio", 12.0, 0.0, 0.8, 40.0, 110.0)
}

fn chamber() -> SpatialSettings {
    settings("chamber", 16.0, 3.0, 1.5, 28.0, 118.0)
}

fn concert_hall() -> SpatialSettings {
    settings("concert-hall", 22.0, 6.0, 2.4, 24.0, 134.0)
}

fn grand_hall() -> SpatialSettings {
    settings("grand-hall", 27.0, 12.0, 4.2, 44.0, 146.0)
}

/// Response of the room alone: the processor minus its dry path.
fn wet_response(settings: &SpatialSettings, frames: usize) -> Vec<f64> {
    let (left, right) = impulse_response(settings, frames);
    let mut dry = settings.clone();
    dry.mix_percent = 0.0;
    let (dry_left, dry_right) = impulse_response(&dry, frames);
    (0..frames)
        .map(|index| (left[index] - dry_left[index]) + (right[index] - dry_right[index]))
        .collect()
}

/// Decay time (T20, extrapolated to 60 dB) of one octave band, from the
/// backward-integrated energy of the tail (after the first 100 ms, where
/// the direct sound and early reflections would dominate).
fn decay_time(response: &[f64], center: f64) -> f64 {
    let response = &response[(RATE * 0.1) as usize..];
    let omega = std::f64::consts::TAU * center / RATE;
    let alpha = omega.sin() / (2.0 * 1.4);
    let a0 = 1.0 + alpha;
    let bandpass = BiquadCoefficients {
        b0: alpha / a0,
        b1: 0.0,
        b2: -alpha / a0,
        a1: -2.0 * omega.cos() / a0,
        a2: (1.0 - alpha) / a0,
    };
    let (mut first, mut second) = (BiquadState::default(), BiquadState::default());
    let energy: Vec<f64> = response
        .iter()
        .map(|sample| {
            second
                .process(first.process(*sample, bandpass), bandpass)
                .powi(2)
        })
        .collect();
    let mut remaining = energy.iter().sum::<f64>();
    let total = remaining;
    let (mut start, mut end) = (None, None);
    for (index, value) in energy.iter().enumerate() {
        let level = 10.0 * (remaining / total).log10();
        if start.is_none() && level <= -5.0 {
            start = Some(index);
        }
        if level <= -25.0 {
            end = Some(index);
            break;
        }
        remaining -= value;
    }
    3.0 * (end.unwrap_or(energy.len()) - start.unwrap_or(0)) as f64 / RATE
}

/// Early (1.5–80 ms) to late energy of the room alone, in dB; like C80
/// without the direct sound, which the dry path carries.
fn clarity_db(response: &[f64]) -> f64 {
    let split = (RATE * 0.08) as usize;
    let early: f64 = response[(RATE * 0.0015) as usize..split]
        .iter()
        .map(|x| x * x)
        .sum();
    let late: f64 = response[split..].iter().map(|x| x * x).sum();
    10.0 * (early / late).log10()
}

#[test]
fn every_room_decays_like_its_kind() {
    let rooms = [studio(), chamber(), concert_hall(), grand_hall()];
    let measured = rooms.clone().map(|room| {
        let response = wet_response(&room, 48_000 * 6);
        let mid = decay_time(&response, 1_000.0);
        (
            room.decay_seconds as f64,
            mid,
            decay_time(&response, 125.0) / mid,
            decay_time(&response, 4_000.0) / mid,
            clarity_db(&response),
        )
    });
    for (index, (control, mid, bass, treble, _)) in measured.iter().enumerate() {
        let name = &rooms[index].preset_id;
        // The decay control is the reverb time at 1 kHz, as rooms are rated.
        assert!(
            (mid / control - 1.0).abs() < 0.12,
            "{name}: {mid:.2} s for {control} s"
        );
        assert!(
            *treble > 0.4 && *treble < 0.9,
            "{name}: treble ratio {treble:.2}"
        );
        if index < 2 {
            assert!((0.85..1.15).contains(bass), "{name}: bass ratio {bass:.2}");
        } else {
            // Halls are warm: bass outlasts the mids (Beranek: 1.1–1.45).
            assert!((1.1..1.45).contains(bass), "{name}: bass ratio {bass:.2}");
        }
    }
    // Air over long paths darkens the big hall more than the concert hall.
    assert!(measured[3].3 < measured[2].3);
    // Clarity falls as the rooms grow.
    assert!(
        measured.windows(2).all(|pair| pair[1].4 < pair[0].4),
        "{:?}",
        measured.map(|m| m.4)
    );
}
