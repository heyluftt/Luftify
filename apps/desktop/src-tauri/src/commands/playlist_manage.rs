//! Creating, renaming, sharing and removing playlists. Only the Librespot
//! engine can do it; Spotify Desktop keeps its own playlist tools.
use luft_core::ProviderError;
use tauri::State;

use super::library::{invalidate_playlist_after_mutation, validate_uri};
use crate::{error::CommandError, state::AppState};

#[tauri::command]
pub async fn create_playlist(name: String, state: State<'_, AppState>) -> Result<String, CommandError> {
    require_librespot(&state)?;
    let uri = state.librespot.create_playlist(&name).await?;
    library_changed(&state).await;
    Ok(uri)
}

#[tauri::command]
pub async fn rename_playlist(uri: String, name: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    require_librespot(&state)?;
    state.librespot.rename_playlist(&uri, &name).await?;
    invalidate_playlist_after_mutation(state.inner(), &uri).await;
    library_changed(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn set_playlist_collaborative(uri: String, collaborative: bool, state: State<'_, AppState>) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    require_librespot(&state)?;
    state.librespot.set_playlist_collaborative(&uri, collaborative).await?;
    invalidate_playlist_after_mutation(state.inner(), &uri).await;
    library_changed(&state).await;
    Ok(())
}

/// `followed: false` on one's own playlist deletes it, as in Spotify.
#[tauri::command]
pub async fn set_playlist_followed(uri: String, followed: bool, state: State<'_, AppState>) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    require_librespot(&state)?;
    state.librespot.set_playlist_followed(&uri, followed).await?;
    library_changed(&state).await;
    Ok(())
}

#[tauri::command]
pub async fn set_playlist_cover(uri: String, jpeg: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    require_librespot(&state)?;
    state.librespot.set_playlist_cover(&uri, &jpeg).await?;
    invalidate_playlist_after_mutation(state.inner(), &uri).await;
    library_changed(&state).await;
    Ok(())
}

fn require_librespot(state: &State<'_, AppState>) -> Result<(), CommandError> {
    if state.uses_librespot() {
        Ok(())
    } else {
        Err(ProviderError::CapabilityUnavailable.into())
    }
}

/// The next library request asks Spotify again instead of the last answer.
async fn library_changed(state: &State<'_, AppState>) {
    let mut refresh = state.playlist_refresh.lock().await;
    refresh.completed_at = None;
    refresh.page = None;
}
