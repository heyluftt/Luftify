use luft_infrastructure::Settings;
use tauri::{AppHandle, Emitter, State};

use crate::{error::CommandError, state::AppState};

const MAX_LYRICS_COLOR_STRENGTH_PERCENT: u8 = 200;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn save_settings(
    mut settings: Settings,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if settings.theme.chars().count() > 80
        || settings.last_route.chars().count() > 512
        || settings
            .home_feature_playlist_uri
            .as_ref()
            .is_some_and(|uri| !uri.starts_with("spotify:playlist:") || uri.chars().count() > 512)
        || settings.audio_control.presets.is_empty()
        || settings.audio_control.presets.len() > 10
        || settings
            .audio_control
            .presets
            .iter()
            .any(|value| *value > 100)
        || ![1, 2, 5, 10].contains(&settings.audio_control.step_percent)
        || settings.audio_control.volume_up_shortcut.chars().count() > 40
        || settings.audio_control.volume_down_shortcut.chars().count() > 40
        || settings.audio_control.mute_shortcut.chars().count() > 40
        || !settings.audio_control.dsp.is_valid()
        || settings.lyrics_visuals.spread_percent > 100
        || settings.lyrics_visuals.color_strength_percent > MAX_LYRICS_COLOR_STRENGTH_PERCENT
        || settings.lyrics_visuals.visualizer_sensitivity_percent > 100
        || !settings.miniplayer.scale.is_finite()
        || !(0.75..=1.5).contains(&settings.miniplayer.scale)
        || !(35..=100).contains(&settings.miniplayer.opacity_percent)
        || settings
            .miniplayer
            .position_x
            .is_some_and(|value| value.abs() > 100_000)
        || settings
            .miniplayer
            .position_y
            .is_some_and(|value| value.abs() > 100_000)
        || settings
            .librespot_audio_device
            .as_ref()
            .is_some_and(|name| name.trim().is_empty() || name.chars().count() > 256)
        || !valid_sync_url(&settings.listen_together.server_url)
    {
        return Err(CommandError::internal("settings are invalid"));
    }
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let previous = database
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    // Profile changes use their own command; an older settings form must not
    // overwrite a profile saved while that form was open.
    settings.listen_together.display_name = previous.listen_together.display_name.clone();
    settings.listen_together.avatar_uri = previous.listen_together.avatar_uri.clone();
    database
        .save_settings(&settings)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut live_dsp = settings.audio_control.dsp.clone();
    live_dsp.enabled &= settings.audio_control.enabled;
    live_dsp.spatial.enabled &= settings.audio_control.enabled;
    live_dsp.volume_boost_enabled &= settings.audio_control.enabled;
    state.librespot.set_dsp_settings(live_dsp);
    state
        .librespot
        .set_experimental_canvas(settings.experimental_libre_canvas);
    // Device, bitrate and loudness are fixed per player; changing one restarts it.
    let setup_changed = previous.librespot_player_setup() != settings.librespot_player_setup();
    if setup_changed && state.uses_librespot() {
        if let Err(error) = state
            .librespot
            .apply_player_setup(settings.librespot_player_setup())
            .await
        {
            state
                .librespot
                .set_player_setup(previous.librespot_player_setup())
                .await;
            let mut restored = settings.clone();
            restored.librespot_audio_device = previous.librespot_audio_device.clone();
            restored.librespot_streaming_quality = previous.librespot_streaming_quality;
            restored.librespot_loudness = previous.librespot_loudness;
            database
                .save_settings(&restored)
                .await
                .map_err(|rollback_error| CommandError::internal(rollback_error.to_string()))?;
            return Err(error.into());
        }
    } else {
        state
            .librespot
            .set_player_setup(settings.librespot_player_setup())
            .await;
    }
    state
        .listening_analytics
        .set_enabled(settings.listening_analytics_enabled)
        .await
        .map_err(CommandError::internal)?;
    state.lifecycle.apply_settings(settings.clone()).await;
    crate::miniplayer::apply_saved_settings(&app, &settings.miniplayer).await?;
    let _ = app.emit("settings://changed", ());
    let executable =
        std::env::current_exe().map_err(|error| CommandError::internal(error.to_string()))?;
    state
        .autostart
        .set_enabled(&executable, settings.windows_autostart)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    crate::tray::sync_from_app(&app).await;
    if previous.listen_together.server_url != settings.listen_together.server_url {
        state.friends.set_server_url(settings.listen_together.server_url.clone()).await;
        let _ = state
            .listen_together
            .set_server_url(settings.listen_together.server_url.clone())
            .await;
    }
    Ok(())
}

fn valid_sync_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value.trim()) else {
        return false;
    };
    (url.scheme() == "ws" || url.scheme() == "wss") && value.chars().count() <= 512
}
