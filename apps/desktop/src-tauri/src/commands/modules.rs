use luft_modules::{ModuleManifest, ModuleRegistry, audio_control_manifest, lyrics_manifest};
use serde::Serialize;
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleStatus {
    pub manifest: ModuleManifest,
    pub enabled: bool,
    pub available: bool,
}

#[tauri::command]
pub async fn get_modules(state: State<'_, AppState>) -> Result<Vec<ModuleStatus>, CommandError> {
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let settings = database
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut registry = ModuleRegistry::default();
    registry
        .register(audio_control_manifest())
        .map_err(|error| CommandError::internal(error.to_string()))?;
    registry
        .register(lyrics_manifest())
        .map_err(|error| CommandError::internal(error.to_string()))?;
    registry
        .set_enabled("audio-control", settings.audio_control.enabled)
        .map_err(|error| CommandError::internal(error.to_string()))?;
    registry
        .set_enabled("lyrics", settings.lyrics_enabled)
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(registry
        .manifests()
        .into_iter()
        .map(|manifest| {
            // The local engine provides every capability a module can require.
            let enabled = registry.enabled(&manifest.id);
            ModuleStatus {
                manifest,
                enabled,
                available: true,
            }
        })
        .collect())
}
