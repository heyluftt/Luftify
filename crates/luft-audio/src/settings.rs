use serde::{Deserialize, Serialize};

pub const EQ_BAND_COUNT: usize = 10;
pub const EQ_FREQUENCIES_HZ: [f64; EQ_BAND_COUNT] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0, 16_000.0,
];

pub const MIN_EQ_GAIN_DB: f32 = -12.0;
pub const MAX_EQ_GAIN_DB: f32 = 12.0;
pub const MIN_PREAMP_DB: f32 = -12.0;
pub const MAX_PREAMP_DB: f32 = 6.0;
pub const MIN_VOLUME_BOOST_DB: f32 = 0.0;
// 20 * log10(3): a threefold output gain, shown in the UI as 300 %.
pub const MAX_VOLUME_BOOST_DB: f32 = 9.542_425;
pub const MAX_SPACE_MIX_PERCENT: f32 = 30.0;
pub const MAX_PRE_DELAY_MS: f32 = 80.0;
pub const MIN_DECAY_SECONDS: f32 = 0.35;
pub const MAX_DECAY_SECONDS: f32 = 5.5;
pub const MIN_STEREO_WIDTH_PERCENT: f32 = 50.0;
pub const MAX_STEREO_WIDTH_PERCENT: f32 = 150.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct SpatialSettings {
    pub cabin_mode: bool,
    pub enabled: bool,
    pub preset_id: String,
    pub mix_percent: f32,
    pub pre_delay_ms: f32,
    pub decay_seconds: f32,
    pub damping_percent: f32,
    pub stereo_width_percent: f32,
}

impl Default for SpatialSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset_id: "direct".into(),
            cabin_mode: false,
            mix_percent: 0.0,
            pre_delay_ms: 0.0,
            decay_seconds: 1.2,
            damping_percent: 55.0,
            stereo_width_percent: 100.0,
        }
    }
}

/// Room presets whose values changed with the room model (September 2026):
/// (id, [mix, pre-delay, decay, damping, width] before, now). The old
/// pre-delays of 40–58 ms would now stack on the computed reflections.
const REVISED_ROOM_PRESETS: [(&str, [f32; 5], [f32; 5]); 4] = [
    (
        "studio",
        [10.0, 6.0, 0.88, 36.0, 110.0],
        [12.0, 0.0, 0.8, 40.0, 110.0],
    ),
    (
        "chamber",
        [16.0, 18.0, 1.7, 46.0, 122.0],
        [16.0, 3.0, 1.5, 28.0, 118.0],
    ),
    (
        "concert-hall",
        [22.0, 40.0, 3.0, 52.0, 140.0],
        [22.0, 6.0, 2.4, 24.0, 134.0],
    ),
    (
        "grand-hall",
        [27.0, 58.0, 4.5, 55.0, 150.0],
        [27.0, 12.0, 4.2, 44.0, 146.0],
    ),
];

impl SpatialSettings {
    /// A stored, untouched room preset from before the revision moves to its
    /// current values; edited settings ("custom") stay as they are.
    #[must_use]
    pub fn with_current_preset(mut self) -> Self {
        let values = [
            self.mix_percent,
            self.pre_delay_ms,
            self.decay_seconds,
            self.damping_percent,
            self.stereo_width_percent,
        ];
        if let Some((_, _, current)) = REVISED_ROOM_PRESETS.iter().find(|(id, old, _)| {
            *id == self.preset_id && old.iter().zip(&values).all(|(a, b)| (a - b).abs() < 1.0e-3)
        }) {
            [
                self.mix_percent,
                self.pre_delay_ms,
                self.decay_seconds,
                self.damping_percent,
                self.stereo_width_percent,
            ] = *current;
        }
        self
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.preset_id.chars().count() <= 48
            && finite_in(self.mix_percent, 0.0, MAX_SPACE_MIX_PERCENT)
            && finite_in(self.pre_delay_ms, 0.0, MAX_PRE_DELAY_MS)
            && finite_in(self.decay_seconds, MIN_DECAY_SECONDS, MAX_DECAY_SECONDS)
            && finite_in(self.damping_percent, 0.0, 100.0)
            && finite_in(
                self.stereo_width_percent,
                MIN_STEREO_WIDTH_PERCENT,
                MAX_STEREO_WIDTH_PERCENT,
            )
    }

    #[must_use]
    pub fn sanitized(&self) -> Self {
        let mut sanitized = self.clone();
        sanitized.preset_id = sanitized.preset_id.trim().chars().take(48).collect();
        if sanitized.preset_id.is_empty() {
            sanitized.preset_id = "custom".into();
        }
        sanitized.mix_percent =
            finite_or_zero(sanitized.mix_percent).clamp(0.0, MAX_SPACE_MIX_PERCENT);
        sanitized.pre_delay_ms =
            finite_or_zero(sanitized.pre_delay_ms).clamp(0.0, MAX_PRE_DELAY_MS);
        sanitized.decay_seconds =
            finite_or(sanitized.decay_seconds, 1.2).clamp(MIN_DECAY_SECONDS, MAX_DECAY_SECONDS);
        sanitized.damping_percent = finite_or(sanitized.damping_percent, 55.0).clamp(0.0, 100.0);
        sanitized.stereo_width_percent = finite_or(sanitized.stereo_width_percent, 100.0)
            .clamp(MIN_STEREO_WIDTH_PERCENT, MAX_STEREO_WIDTH_PERCENT);
        sanitized
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DspSettings {
    pub enabled: bool,
    pub preset_id: String,
    pub preamp_db: f32,
    pub auto_headroom: bool,
    pub limiter_enabled: bool,
    pub volume_boost_enabled: bool,
    pub volume_boost_db: f32,
    pub bands_db: Vec<f32>,
    pub spatial: SpatialSettings,
}

impl Default for DspSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset_id: "neutral".into(),
            preamp_db: 0.0,
            auto_headroom: true,
            limiter_enabled: true,
            volume_boost_enabled: false,
            volume_boost_db: 3.0,
            bands_db: vec![0.0; EQ_BAND_COUNT],
            spatial: SpatialSettings::default(),
        }
    }
}

/// Equalizer presets revised in September 2026: (id, bands before, now).
const REVISED_EQ_PRESETS: [(&str, [f32; EQ_BAND_COUNT], [f32; EQ_BAND_COUNT]); 5] = [
    (
        "warm",
        [1.5, 1.7, 1.3, 0.7, 0.0, -0.2, 0.2, 0.7, 0.8, 0.4],
        [1.8, 1.8, 1.4, 0.8, 0.2, 0.0, -0.3, -0.7, -1.0, -1.2],
    ),
    (
        "deep",
        [3.2, 3.0, 2.0, 0.8, -0.3, -0.7, -0.2, 0.4, 0.3, 0.0],
        [3.5, 4.0, 2.5, 0.5, -0.8, -0.5, 0.0, 0.3, 0.3, 0.0],
    ),
    (
        "clear",
        [-0.6, -0.5, -0.2, 0.0, 0.3, 1.0, 1.7, 1.8, 1.1, 0.5],
        [-0.5, -0.5, -0.8, -1.2, -0.6, 0.2, 0.8, 1.2, 1.6, 1.4],
    ),
    (
        "voice",
        [-1.8, -1.2, -0.5, 0.7, 1.5, 2.0, 1.4, 0.4, -0.6, -1.0],
        [-3.0, -2.2, -1.0, 0.3, 1.2, 1.8, 2.2, 1.6, 0.2, -0.6],
    ),
    (
        "night",
        [2.2, 1.8, 1.0, 0.2, -0.4, -0.3, 0.1, 0.6, 1.0, 1.3],
        [3.5, 2.8, 1.6, 0.6, 0.0, -0.2, -0.4, -0.2, 0.8, 1.6],
    ),
];

impl DspSettings {
    /// Untouched stored presets (equalizer and room) move to their current
    /// values; anything the listener edited stays.
    #[must_use]
    pub fn with_current_presets(mut self) -> Self {
        if let Some((_, _, current)) = REVISED_EQ_PRESETS.iter().find(|(id, old, _)| {
            *id == self.preset_id
                && self.bands_db.len() == EQ_BAND_COUNT
                && old
                    .iter()
                    .zip(&self.bands_db)
                    .all(|(a, b)| (a - b).abs() < 1.0e-3)
        }) {
            self.bands_db = current.to_vec();
        }
        self.spatial = self.spatial.with_current_preset();
        self
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.preset_id.chars().count() <= 48
            && self.preamp_db.is_finite()
            && (MIN_PREAMP_DB..=MAX_PREAMP_DB).contains(&self.preamp_db)
            && self.volume_boost_db.is_finite()
            && (MIN_VOLUME_BOOST_DB..=MAX_VOLUME_BOOST_DB).contains(&self.volume_boost_db)
            && self.bands_db.len() == EQ_BAND_COUNT
            && self
                .bands_db
                .iter()
                .all(|gain| gain.is_finite() && (MIN_EQ_GAIN_DB..=MAX_EQ_GAIN_DB).contains(gain))
            && self.spatial.is_valid()
    }

    #[must_use]
    pub fn sanitized(&self) -> Self {
        let mut sanitized = self.clone();
        sanitized.preset_id = sanitized.preset_id.trim().chars().take(48).collect();
        if sanitized.preset_id.is_empty() {
            sanitized.preset_id = "custom".into();
        }
        sanitized.preamp_db =
            finite_or_zero(sanitized.preamp_db).clamp(MIN_PREAMP_DB, MAX_PREAMP_DB);
        sanitized.volume_boost_db = finite_or(sanitized.volume_boost_db, 3.0)
            .clamp(MIN_VOLUME_BOOST_DB, MAX_VOLUME_BOOST_DB);
        if sanitized.bands_db.len() != EQ_BAND_COUNT {
            sanitized.bands_db = vec![0.0; EQ_BAND_COUNT];
        } else {
            for gain in &mut sanitized.bands_db {
                *gain = finite_or_zero(*gain).clamp(MIN_EQ_GAIN_DB, MAX_EQ_GAIN_DB);
            }
        }
        sanitized.spatial = sanitized.spatial.sanitized();
        sanitized
    }

    #[must_use]
    pub fn effective_preamp_db(&self) -> f64 {
        let sanitized = self.sanitized();
        let headroom_db = if sanitized.auto_headroom {
            sanitized.bands_db.iter().copied().fold(0.0_f32, f32::max)
        } else {
            0.0
        };
        f64::from(sanitized.preamp_db - headroom_db)
    }

    #[must_use]
    pub fn effective_volume_boost_db(&self) -> f64 {
        let sanitized = self.sanitized();
        if sanitized.volume_boost_enabled {
            f64::from(sanitized.volume_boost_db)
        } else {
            0.0
        }
    }
}

fn finite_or_zero(value: f32) -> f32 {
    if value.is_finite() { value } else { 0.0 }
}

fn finite_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() { value } else { fallback }
}

fn finite_in(value: f32, minimum: f32, maximum: f32) -> bool {
    value.is_finite() && (minimum..=maximum).contains(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untouched_old_room_presets_move_to_their_current_values() {
        let old = SpatialSettings {
            enabled: true,
            preset_id: "concert-hall".into(),
            mix_percent: 22.0,
            pre_delay_ms: 40.0,
            decay_seconds: 3.0,
            damping_percent: 52.0,
            stereo_width_percent: 140.0,
            ..SpatialSettings::default()
        };
        let upgraded = old.clone().with_current_preset();
        assert_eq!(upgraded.decay_seconds, 2.4);
        assert_eq!(upgraded.pre_delay_ms, 6.0);
        let custom = SpatialSettings {
            preset_id: "custom".into(),
            ..old
        };
        assert_eq!(custom.clone().with_current_preset(), custom);
    }

    #[test]
    fn accepts_a_threefold_volume_boost() {
        let settings = DspSettings {
            volume_boost_enabled: true,
            volume_boost_db: MAX_VOLUME_BOOST_DB,
            ..DspSettings::default()
        };

        assert!(settings.is_valid());
        let gain = 10_f64.powf(settings.effective_volume_boost_db() / 20.0);
        assert!((gain - 3.0).abs() < 0.001);
    }
}
