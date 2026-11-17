use serde::{Deserialize, Serialize};

/// Spotify stream bitrate for Libre (Ogg Vorbis).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamingQuality {
    /// 96 kbps, for metered connections.
    Low,
    /// 160 kbps.
    Normal,
    /// 320 kbps (Premium).
    #[default]
    High,
}

/// Loudness normalization between tracks, like Spotify's "Normalize volume".
/// Uses the loudness values Spotify ships with every track.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LoudnessNormalization {
    /// Every track plays as mastered.
    #[default]
    Off,
    /// About -19 LUFS: more headroom, for noisy mastering.
    Quiet,
    /// About -14 LUFS, Spotify's default.
    Normal,
    /// About -11 LUFS; a limiter keeps boosted tracks from clipping.
    Loud,
}

impl LoudnessNormalization {
    /// Gain relative to Spotify's -14 LUFS reference, or `None` when off.
    #[must_use]
    pub fn pregain_db(self) -> Option<f64> {
        match self {
            Self::Off => None,
            Self::Quiet => Some(-5.0),
            Self::Normal => Some(0.0),
            Self::Loud => Some(3.0),
        }
    }
}

/// Everything Libre fixes when it opens its player; changes need a restart.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlayerSetup {
    pub audio_device: Option<String>,
    pub streaming_quality: StreamingQuality,
    pub loudness: LoudnessNormalization,
}
