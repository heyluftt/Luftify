use luft_librespot::VisualizerFrame;
use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualizerSnapshot {
    pub source: VisualizerSource,
    pub energy: f32,
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    pub beat: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VisualizerSource {
    Live,
    None,
}

#[tauri::command]
pub async fn get_visualizer_frame(
    state: State<'_, AppState>,
) -> Result<VisualizerSnapshot, CommandError> {
    if !state.uses_librespot() {
        return Ok(VisualizerSnapshot::silent(VisualizerSource::None));
    }

    Ok(VisualizerSnapshot::from_frame(
        VisualizerSource::Live,
        state.librespot.visualizer_frame(),
    ))
}

impl VisualizerSnapshot {
    fn silent(source: VisualizerSource) -> Self {
        Self {
            source,
            energy: 0.0,
            bass: 0.0,
            mid: 0.0,
            high: 0.0,
            beat: 0.0,
        }
    }

    fn from_frame(source: VisualizerSource, frame: VisualizerFrame) -> Self {
        Self {
            source,
            energy: frame.energy,
            bass: frame.bass,
            mid: frame.mid,
            high: frame.high,
            beat: frame.beat,
        }
    }
}
