use luft_librespot::{AudioOutputDevice, DspSettings, LibrespotStatus, LosslessProbe, list_output_devices};
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[tauri::command]
pub async fn get_librespot_status(
    state: State<'_, AppState>,
) -> Result<LibrespotStatus, CommandError> {
    Ok(state.librespot.status().await)
}

#[tauri::command]
pub async fn start_librespot_login(
    state: State<'_, AppState>,
) -> Result<LibrespotStatus, CommandError> {
    let _guard = super::accounts::account_action_guard()?;
    if state.lifecycle.is_exiting() {
        return Err(CommandError::internal(
            "Luftify wechselt gerade den Account oder wird beendet.",
        ));
    }
    state
        .librespot
        .login_and_connect()
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn logout_librespot(state: State<'_, AppState>) -> Result<LibrespotStatus, CommandError> {
    let _guard = super::accounts::account_action_guard()?;
    if state.lifecycle.is_exiting() {
        return Err(CommandError::internal(
            "Luftify wechselt gerade den Account oder wird beendet.",
        ));
    }
    state.librespot.logout().await.map_err(CommandError::from)
}

/// 30-second clips for the recap story; empty without a Libre session.
#[tauri::command]
pub async fn get_track_previews(
    uris: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<luft_librespot::TrackPreview>, CommandError> {
    state
        .librespot
        .track_previews(uris)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn list_audio_outputs() -> Result<Vec<AudioOutputDevice>, CommandError> {
    Ok(tokio::task::spawn_blocking(list_output_devices)
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn preview_dsp_settings(
    settings: DspSettings,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if !settings.is_valid() {
        return Err(CommandError::internal("audio settings are invalid"));
    }
    state.librespot.set_dsp_settings(settings);
    Ok(())
}

#[tauri::command]
pub async fn save_dsp_settings(
    settings: DspSettings,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if !settings.is_valid() {
        return Err(CommandError::internal("audio settings are invalid"));
    }
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut app_settings = database
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    app_settings.audio_control.dsp = settings.clone();
    database
        .save_settings(&app_settings)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut live_settings = settings;
    if !app_settings.audio_control.enabled {
        live_settings.enabled = false;
        live_settings.spatial.enabled = false;
        live_settings.volume_boost_enabled = false;
    }
    state.librespot.set_dsp_settings(live_settings);
    Ok(())
}

/// Diagnostics: whether Spotify gives this account FLAC files and their keys
/// (lossless, phase 0). Read-only; only outcomes, never keys or addresses.
#[tauri::command]
pub async fn probe_lossless(
    uris: Vec<String>,
    state: State<'_, AppState>,
) -> Result<LosslessProbe, CommandError> {
    let uris = uris.into_iter().take(3).collect();
    state.librespot.probe_lossless(uris).await.map_err(Into::into)
}
