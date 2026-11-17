//! Account switching deliberately crosses a process boundary: no old tasks/caches survive.
use luft_infrastructure::{AppPaths, DatabaseHandle, Settings};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use crate::{error::CommandError, state::AppState};

static SWITCH_LOCK: Mutex<()> = Mutex::const_new(());

pub(super) fn account_action_guard() -> Result<tokio::sync::MutexGuard<'static, ()>, CommandError> {
    SWITCH_LOCK
        .try_lock()
        .map_err(|_| internal("Eine Kontoaktion läuft bereits. Bitte zuerst abschließen."))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccountProfile {
    id: String,
    username: Option<String>,
    active: bool,
}

fn internal(error: impl std::fmt::Display) -> CommandError {
    CommandError::internal(error.to_string())
}

#[tauri::command]
pub async fn get_librespot_accounts(
    state: State<'_, AppState>,
) -> Result<Vec<LocalAccountProfile>, CommandError> {
    let base = AppPaths::discover_base().map_err(internal)?.data;
    let mut ids = vec!["default".to_string()];
    let directory = base.join("Accounts");
    if directory.exists() {
        let mut entries = tokio::fs::read_dir(directory).await.map_err(internal)?;
        while let Some(entry) = entries.next_entry().await.map_err(internal)? {
            let id = entry.file_name().to_string_lossy().into_owned();
            if let Ok(path) = AppPaths::account_data_dir(&base, &id)
                && path.join("luft-player.db").is_file()
            {
                ids.push(id);
            }
        }
    }
    let mut profiles = Vec::new();
    for id in ids {
        let data = AppPaths::account_data_dir(&base, &id).map_err(internal)?;
        let username = tokio::fs::read_to_string(data.join("spotify-account"))
            .await
            .ok()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty());
        profiles.push(LocalAccountProfile {
            id,
            username,
            active: data == state.paths.data,
        });
    }
    profiles.sort_by(|a, b| {
        b.active
            .cmp(&a.active)
            .then(a.username.cmp(&b.username))
            .then(a.id.cmp(&b.id))
    });
    Ok(profiles)
}

#[tauri::command]
pub async fn switch_librespot_account(
    profile_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let _guard = account_action_guard()?;
    if state.lifecycle.is_exiting() {
        return Err(internal("Luftify wird bereits beendet."));
    }
    let status = state.librespot.status().await;
    if matches!(
        status.phase,
        luft_librespot::LibrespotPhase::Authenticating | luft_librespot::LibrespotPhase::Connecting
    ) {
        return Err(internal(
            "Bitte die laufende Spotify-Anmeldung zuerst abschließen.",
        ));
    }
    let base = AppPaths::discover_base().map_err(internal)?.data;
    let creating = profile_id.is_none();
    let id = profile_id.unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    let data = AppPaths::account_data_dir(&base, &id).map_err(internal)?;
    if data == state.paths.data {
        return Ok(());
    }
    if creating {
        tokio::fs::create_dir_all(&data).await.map_err(internal)?;
        let current = state
            .database
            .get()
            .await
            .map_err(internal)?
            .settings()
            .await
            .map_err(internal)?;
        let target = DatabaseHandle::new(data.join("luft-player.db"));
        let settings = new_profile_settings(current);
        target
            .get()
            .await
            .map_err(internal)?
            .save_settings(&settings)
            .await
            .map_err(internal)?;
        target.close().await;
    } else {
        if !data.join("luft-player.db").is_file() {
            return Err(internal("Das lokale Account-Profil existiert nicht."));
        }
        let target = DatabaseHandle::new(data.join("luft-player.db"));
        let database = target.get().await.map_err(internal)?;
        let settings = account_entry_settings(database.settings().await.map_err(internal)?);
        database.save_settings(&settings).await.map_err(internal)?;
        target.close().await;
    }
    // Only select complete profiles; atomic replacement also preserves selection on a failed write.
    let pending = base.join("active-account.pending");
    tokio::fs::write(&pending, &id).await.map_err(internal)?;
    tokio::fs::rename(&pending, base.join("active-account"))
        .await
        .map_err(internal)?;
    state.lifecycle.request_shutdown();
    // Let observers flush the old account before ending its session.
    state.listen_together.shutdown().await;
    state.listening_analytics.shutdown().await;
    state.librespot.shutdown().await;
    state.database.close().await;
    app.restart();
}

/// Auxiliary windows must share the active profile's WebView storage, not the old account's.
pub fn webview_directory(app: &AppHandle) -> Option<std::path::PathBuf> {
    let state = app.state::<AppState>();
    let base = AppPaths::discover_base().ok()?;
    (state.paths.data != base.data).then(|| state.paths.data.join("Webview"))
}

fn account_entry_settings(mut settings: Settings) -> Settings {
    settings.last_route = "/settings".into();
    settings
}

fn new_profile_settings(current: Settings) -> Settings {
    let mut settings = account_entry_settings(Settings::default());
    settings.theme = current.theme;
    settings.audio_control = current.audio_control;
    settings.librespot_audio_device = current.librespot_audio_device;
    settings.librespot_streaming_quality = current.librespot_streaming_quality;
    settings.librespot_loudness = current.librespot_loudness;
    settings.listen_together.server_url = current.listen_together.server_url;
    settings
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn returning_account_keeps_personal_data_and_enters_libre() {
        let mut stored = Settings::default();
        stored.listen_together.display_name = "Alice".into();
        stored.home_feature_playlist_uri = Some("spotify:playlist:alice".into());
        stored.last_route = "/lyrics".into();
        let selected = account_entry_settings(stored);
        assert_eq!(selected.last_route, "/settings");
        assert_eq!(selected.listen_together.display_name, "Alice");
        assert_eq!(
            selected.home_feature_playlist_uri.as_deref(),
            Some("spotify:playlist:alice")
        );
    }

    #[test]
    fn new_account_keeps_device_preferences_but_not_personal_settings() {
        let mut old = Settings::default();
        old.theme = "luft.rose".into();
        old.listen_together.display_name = "Alice".into();
        old.listen_together.avatar_uri = Some("data:image/png;base64,old".into());
        old.home_feature_playlist_uri = Some("spotify:playlist:alice".into());
        let new = new_profile_settings(old);
        assert_eq!(new.theme, "luft.rose");
        assert!(new.listen_together.display_name.is_empty());
        assert!(new.listen_together.avatar_uri.is_none());
        assert!(new.home_feature_playlist_uri.is_none());
        assert_eq!(new.last_route, "/settings");
    }
}
