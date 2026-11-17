use luft_core::{EntitySummary, Page, PageRequest};
use luft_infrastructure::PlaylistUsage;
use tauri::State;
use tracing::debug;

use crate::{error::CommandError, state::AppState};

#[tauri::command]
pub async fn get_playlist_usage(
    state: State<'_, AppState>,
) -> Result<Vec<PlaylistUsage>, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .playlist_usage(100)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn reset_playlist_usage(state: State<'_, AppState>) -> Result<(), CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .clear_playlist_usage()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    state
        .listening_analytics
        .clear()
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn get_new_releases(
    state: State<'_, AppState>,
) -> Result<Page<EntitySummary>, CommandError> {
    let request = PageRequest {
        offset: 0,
        limit: 12,
    };
    if state.uses_librespot() {
        match state.librespot.get_new_releases(request).await {
            Ok(page) if !page.items.is_empty() => return Ok(page),
            Ok(_) => {}
            // The Web API already warns about the 429 behind this; repeating it
            // for every poll during the rest only filled the log.
            Err(error) => debug!(
                adapter = "librespot",
                error = %error,
                "new releases via librespot unavailable"
            ),
        }
    }
    Ok(Page {
        items: Vec::new(),
        offset: 0,
        limit: 12,
        total: Some(0),
        has_more: false,
    })
}
