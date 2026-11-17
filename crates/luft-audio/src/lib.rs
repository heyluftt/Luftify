use serde::{Deserialize, Serialize};

mod filters;
mod limiter;
mod playback_options;
mod processor;
mod resampler;
mod settings;
mod spatial;
mod visualizer;

pub use playback_options::{LoudnessNormalization, PlayerSetup, StreamingQuality};
pub use processor::{DspControl, DspProcessor};
pub use resampler::StereoResampler;
pub use settings::{DspSettings, EQ_BAND_COUNT, EQ_FREQUENCIES_HZ, SpatialSettings};
pub use visualizer::{VisualizerAnalyzer, VisualizerControl, VisualizerFrame};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioControlSource {
    SpotifyInternal,
    WindowsSession,
    LocalPlayback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioFeature {
    Volume,
    Mute,
    Equalizer,
    Preamp,
    VolumeBoost,
    Dsp,
    Spectrum,
}

pub trait AudioEffect: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn supports(&self, source: AudioControlSource) -> bool;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectPreset {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub values: Vec<f32>,
}
