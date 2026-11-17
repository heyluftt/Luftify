use super::{SpatialProcessor, room_scale};
use crate::SpatialSettings;

fn run(settings: SpatialSettings, frames: usize) -> (Vec<f64>, Vec<f64>) {
    let mut processor = SpatialProcessor::new(48_000.0, &settings);
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for index in 0..frames {
        let sample = if index == 32 { 0.9 } else { 0.0 };
        let (out_left, out_right, _) = processor.process(sample, sample);
        left.push(out_left);
        right.push(out_right);
    }
    (left, right)
}

fn side_to_mid_ratio(left: &[f64], right: &[f64]) -> f64 {
    let mut mid = 0.0;
    let mut side = 0.0;
    for index in 0..left.len() {
        let mid_sample = (left[index] + right[index]) * 0.5;
        let side_sample = (left[index] - right[index]) * 0.5;
        mid += mid_sample * mid_sample;
        side += side_sample * side_sample;
    }
    side / mid.max(1.0e-12)
}

fn preset(
    id: &str,
    mix: f32,
    pre_delay: f32,
    decay: f32,
    damping: f32,
    width: f32,
) -> SpatialSettings {
    SpatialSettings {
        enabled: true,
        preset_id: id.into(),
        cabin_mode: id == "car",
        mix_percent: mix,
        pre_delay_ms: pre_delay,
        decay_seconds: decay,
        damping_percent: damping,
        stereo_width_percent: width,
    }
}

fn studio() -> SpatialSettings {
    preset("studio", 12.0, 0.0, 0.8, 40.0, 110.0)
}

fn chamber() -> SpatialSettings {
    preset("chamber", 16.0, 3.0, 1.5, 28.0, 118.0)
}

fn concert_hall() -> SpatialSettings {
    preset("concert-hall", 22.0, 6.0, 2.4, 24.0, 134.0)
}

fn grand_hall() -> SpatialSettings {
    preset("grand-hall", 27.0, 12.0, 4.2, 44.0, 146.0)
}

fn peak(samples: &[f64]) -> f64 {
    samples
        .iter()
        .fold(0.0_f64, |peak, sample| peak.max(sample.abs()))
}

#[test]
fn a_cleared_tail_leaves_no_hall_of_the_previous_audio() {
    let hall_after = |clear: bool| {
        let mut processor = SpatialProcessor::new(48_000.0, &grand_hall());
        for index in 0..48_000 {
            let sample = (index as f64 * 0.05).sin() * 0.8;
            processor.process(sample, sample);
        }
        if clear {
            processor.clear_tail();
        }
        (0..4_800)
            .map(|_| processor.process(0.0, 0.0))
            .fold(0.0_f64, |peak, (left, right, _)| peak.max(left.abs()).max(right.abs()))
    };
    assert!(hall_after(false) > 0.01, "the hall rings on by itself");
    assert!(hall_after(true) < 1.0e-9);
}

#[test]
fn large_rooms_scale_noticeably_beyond_the_studio() {
    assert!(room_scale(4.5) > room_scale(0.88) + 0.7);
    assert!(room_scale(3.0) > room_scale(1.7) + 0.2);
    assert!(room_scale(1.7) > room_scale(0.88) + 0.12);
}

#[test]
fn rooms_step_the_source_back_in_order() {
    let studio_direct = peak(&run(studio(), 128).0[32..80]);
    let chamber_direct = peak(&run(chamber(), 128).0[32..80]);
    let concert_direct = peak(&run(concert_hall(), 128).0[32..80]);
    let hall_direct = peak(&run(grand_hall(), 128).0[32..80]);
    assert!(
        studio_direct > chamber_direct,
        "studio {studio_direct} should stay closer than chamber {chamber_direct}"
    );
    assert!(
        chamber_direct > concert_direct,
        "chamber {chamber_direct} should stay closer than concert {concert_direct}"
    );
    assert!(
        concert_direct > hall_direct,
        "concert {concert_direct} should stay closer than grand hall {hall_direct}"
    );
}

#[test]
fn grand_hall_puts_space_between_a_mono_impulse() {
    let (left, right) = run(grand_hall(), 16_000);
    let tail_left = &left[1_200..];
    let tail_right = &right[1_200..];
    let ratio = side_to_mid_ratio(tail_left, tail_right);
    assert!(
        ratio > 0.12,
        "grand hall still too centered, side/mid={ratio}"
    );
    assert!(tail_left.iter().any(|sample| sample.abs() > 1.0e-6));
    assert!(tail_right.iter().any(|sample| sample.abs() > 1.0e-6));
}

#[test]
fn grand_hall_is_more_open_than_studio() {
    let (hall_left, hall_right) = run(grand_hall(), 12_000);
    let (studio_left, studio_right) = run(studio(), 12_000);
    let hall = side_to_mid_ratio(&hall_left[800..], &hall_right[800..]);
    let studio = side_to_mid_ratio(&studio_left[800..], &studio_right[800..]);
    assert!(
        hall > studio * 1.35,
        "hall side/mid {hall} should exceed studio {studio}"
    );
}

#[test]
fn spatial_output_stays_finite() {
    let (left, right) = run(grand_hall(), 4_096);
    assert!(left.iter().chain(&right).all(|sample| sample.is_finite()));
    assert!(left.iter().chain(&right).all(|sample| sample.abs() < 8.0));
}

#[test]
fn tiny_room_mix_approaches_the_uncolored_direct_signal() {
    let mut settings = grand_hall();
    settings.mix_percent = 0.001;
    settings.stereo_width_percent = 100.0;
    let mut processor = SpatialProcessor::new(48_000.0, &settings);
    // Before any reflection can arrive, test the formerly discontinuous dry-air filter.
    for index in 0..128 {
        let input = if index % 2 == 0 { 0.6 } else { -0.6 };
        let (left, right, _) = processor.process(input, input);
        assert!((left - input).abs() < 0.0001);
        assert!((right - input).abs() < 0.0001);
    }
}

#[test]
fn early_reflections_absorb_more_highs_with_stronger_damping() {
    fn brightness(alpha: f64) -> f64 {
        let mut reflections =
            super::EarlyReflections::new(48_000.0, &super::rooms::room_shape(1.5));
        let mut energy = 0.0;
        let mut difference_energy = 0.0;
        let mut last = 0.0;
        for index in 0..12_000 {
            let impulse = if index == 0 { 1.0 } else { 0.0 };
            let (left, _) = reflections.process(impulse, impulse, alpha);
            energy += left * left;
            difference_energy += (left - last).powi(2);
            last = left;
        }
        difference_energy / energy.max(1.0e-20)
    }
    assert!(brightness(0.1) < brightness(0.9) * 0.5);
}

#[test]
fn extreme_room_settings_decay_without_instability_at_common_sample_rates() {
    for sample_rate in [44_100.0, 48_000.0, 96_000.0] {
        let settings = preset("custom", 30.0, 80.0, 5.5, 0.0, 150.0);
        let mut processor = SpatialProcessor::new(sample_rate, &settings);
        let frames = (sample_rate * 8.0) as usize;
        let mut initial_tail = 0.0;
        let mut final_tail = 0.0;
        for index in 0..frames {
            let input = if index == 0 { 1.0 } else { 0.0 };
            let (left, right, _) = processor.process(input, input);
            assert!(left.is_finite() && right.is_finite());
            assert!(left.abs() < 4.0 && right.abs() < 4.0);
            let time = index as f64 / sample_rate;
            let energy = left * left + right * right;
            if (1.0..2.0).contains(&time) {
                initial_tail += energy;
            }
            if time >= 7.0 {
                final_tail += energy;
            }
        }
        assert!(initial_tail > 0.0);
        assert!(final_tail < initial_tail * 0.01);
    }
}

#[test]
fn disabling_the_room_settles_to_dry_and_does_not_replay_an_old_tail() {
    let mut processor = SpatialProcessor::new(48_000.0, &grand_hall());
    for index in 0..24_000 {
        processor.process(if index == 0 { 1.0 } else { 0.0 }, 0.0);
    }
    processor.set_settings(&SpatialSettings::default(), 64);
    for _ in 0..5_000 {
        processor.process(0.0, 0.0);
    }
    assert!(processor.is_idle_bypassed());
    let (left, right, active) = processor.process(0.25, -0.5);
    assert!((left - 0.25).abs() < 1.0e-12);
    assert!((right + 0.5).abs() < 1.0e-12);
    assert!(!active);
    // Let the separate stereo-width filter settle after the dry stereo probe.
    for _ in 0..5_000 {
        processor.process(0.0, 0.0);
    }
    processor.set_settings(&grand_hall(), 64);
    for _ in 0..12_000 {
        let (left, right, _) = processor.process(0.0, 0.0);
        assert!(left.abs() < 1.0e-12 && right.abs() < 1.0e-12);
    }
}

#[test]
fn car_preset_has_a_distinct_cabin_response_and_short_tail() {
    let car = preset("car", 30.0, 0.0, 0.4, 68.0, 82.0);
    assert!(car.is_valid());
    let (car_left, car_right) = run(car, 48_000);
    let (studio_left, studio_right) = run(studio(), 48_000);
    let tail_energy = |left: &[f64], right: &[f64]| {
        left[14_400..]
            .iter()
            .chain(&right[14_400..])
            .map(|sample| sample * sample)
            .sum::<f64>()
    };
    // The cabin changes the direct tone, and reflections arrive within a few ms.
    assert!((car_left[32] - studio_left[32]).abs() > 0.1);
    let early_energy = |samples: &[f64]| samples[80..480].iter().map(|x| x * x).sum::<f64>();
    assert!(early_energy(&car_left) > early_energy(&studio_left) * 3.0);
    assert!(tail_energy(&car_left, &car_right) < tail_energy(&studio_left, &studio_right) * 0.5);
    assert!(
        car_left
            .iter()
            .chain(&car_right)
            .all(|sample| sample.is_finite() && sample.abs() < 1.0)
    );
    // A room response is present, even though the late tail is deliberately subtle.
    assert!(
        car_left[128..14_400]
            .iter()
            .any(|sample| sample.abs() > 1.0e-6)
    );
}

#[test]
fn front_speakers_preserve_ear_timing_mirror_and_clear_at_supported_rates() {
    for rate in [44_100.0, 48_000.0, 96_000.0] {
        let mut left_speaker = super::binaural::FrontSpeakers::new(rate);
        let mut right_speaker = super::binaural::FrontSpeakers::new(rate);
        let mut peaks = [(0usize, 0.0f64); 2];
        let mut energy = [0.0; 2];
        for i in 0..(rate * 0.01) as usize {
            let impulse = if i == 0 { 1.0 } else { 0.0 };
            let l = left_speaker.process([impulse, 0.0]);
            let r = right_speaker.process([0.0, impulse]);
            assert!((l[0] - r[1]).abs() < 1e-12 && (l[1] - r[0]).abs() < 1e-12);
            for ear in 0..2 {
                assert!(l[ear].is_finite());
                energy[ear] += l[ear] * l[ear];
                if l[ear].abs() > peaks[ear].1 {
                    peaks[ear] = (i, l[ear].abs());
                }
            }
        }
        let delay = (peaks[1].0 as f64 - peaks[0].0 as f64) / rate;
        assert!((0.00018..0.00032).contains(&delay), "ear delay: {delay}");
        assert!(energy[0] > energy[1] * 2.0 && energy[1] > 0.01);
        left_speaker.process([1.0, -1.0]);
        left_speaker.clear();
        for _ in 0..(rate * 0.01) as usize {
            assert_eq!(left_speaker.process([0.0, 0.0]), [0.0; 2]);
        }
    }
}
