use std::time::{Duration, Instant};

use luft_core::{
    AlbumDetails, ArtistDetails, EntitySummary, MediaItem, Page, PageRequest, PlaylistDetails,
    QueueItemReference, QueueReorderRequest, QueueState,
};
use tauri::State;
use tracing::{info, warn};

use super::playlist_snapshot;
use crate::{error::CommandError, state::AppState};

const REQUEST_DEDUPE_WINDOW: Duration = Duration::from_secs(2);
const CACHE_SOURCE: &str = "librespot";

fn normalized(mut request: PageRequest) -> PageRequest {
    request.limit = request.limit.clamp(1, 100);
    request
}

fn cache_key(prefix: &str, request: PageRequest) -> String {
    format!("spotify.{prefix}.{}.{}.v1", request.offset, request.limit)
}

fn entity_cache_key(prefix: &str, uri: &str, request: PageRequest) -> String {
    format!(
        "spotify.{prefix}.{uri}.{}.{}.v1",
        request.offset, request.limit
    )
}

#[tauri::command]
pub async fn get_cached_playlists(
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<Option<Page<EntitySummary>>, CommandError> {
    let started = Instant::now();
    let request = normalized(request);
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let value = database
        .cached(&cache_key("playlists-v2", request))
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    info!(
        phase = "playlist-cache-read",
        duration_ms = started.elapsed().as_millis(),
        status = if value.is_some() { "hit" } else { "miss" },
        adapter = "sqlite",
        "library timing"
    );
    Ok(value)
}

#[tauri::command]
pub async fn get_playlists(
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<Page<EntitySummary>, CommandError> {
    let started = Instant::now();
    let request = normalized(request);
    let mut refresh = state.playlist_refresh.lock().await;
    if refresh.request == Some(request)
        && refresh
            .completed_at
            .is_some_and(|completed| completed.elapsed() <= REQUEST_DEDUPE_WINDOW)
        && let Some(page) = refresh.page.clone()
    {
        info!(
            phase = "playlist-request-deduplicated",
            duration_ms = started.elapsed().as_millis(),
            status = "hit",
            adapter = "request-deduplicator",
            "library timing"
        );
        return Ok(page);
    }
    let page = state.provider.get_playlists(request).await?;
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    database
        .cache_persistent(&cache_key("playlists-v2", request), CACHE_SOURCE, &page)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    refresh.request = Some(request);
    refresh.completed_at = Some(Instant::now());
    refresh.page = Some(page.clone());
    info!(
        phase = "playlist-first-page",
        duration_ms = started.elapsed().as_millis(),
        status = "loaded",
        adapter = CACHE_SOURCE,
        items = page.items.len(),
        "library timing"
    );
    Ok(page)
}

#[tauri::command]
pub async fn get_cached_liked_tracks(
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<Option<Page<MediaItem>>, CommandError> {
    let request = normalized(request);
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .cached(&cache_key("liked-tracks", request))
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn get_liked_tracks(
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<Page<MediaItem>, CommandError> {
    let request = normalized(request);
    let page = state.provider.get_liked_tracks(request).await?;
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .cache_persistent(&cache_key("liked-tracks", request), CACHE_SOURCE, &page)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(page)
}

#[tauri::command]
pub async fn set_track_saved(
    uri: String,
    saved: bool,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    state.provider.set_track_saved(&uri, saved).await?;
    invalidate_cache_prefix_best_effort(state.inner(), "spotify.liked-tracks.").await;
    Ok(())
}

#[tauri::command]
pub async fn get_playlist(
    uri: String,
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<PlaylistDetails, CommandError> {
    validate_uri(&uri)?;
    let request = normalized(request);
    let details = fetch_playlist(state.inner(), &uri, request).await?;
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .cache_persistent(
            &entity_cache_key("playlist-v2", &uri, request),
            CACHE_SOURCE,
            &details,
        )
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(details)
}

#[tauri::command]
pub async fn get_cached_playlist(
    uri: String,
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<Option<PlaylistDetails>, CommandError> {
    validate_uri(&uri)?;
    let request = normalized(request);
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .cached(&entity_cache_key("playlist-v2", &uri, request))
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn get_playlist_snapshot(
    uri: String,
    state: State<'_, AppState>,
) -> Result<PlaylistDetails, CommandError> {
    validate_uri(&uri)?;
    playlist_snapshot::refresh(state.inner(), &uri).await
}

#[tauri::command]
pub async fn get_cached_playlist_snapshot(
    uri: String,
    state: State<'_, AppState>,
) -> Result<Option<PlaylistDetails>, CommandError> {
    validate_uri(&uri)?;
    playlist_snapshot::read(state.inner(), &uri).await
}

#[tauri::command]
pub async fn add_track_to_playlist(
    playlist_uri: String,
    track_uri: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    validate_uri(&playlist_uri)?;
    validate_uri(&track_uri)?;
    state
        .provider
        .add_track_to_playlist(&playlist_uri, &track_uri)
        .await
        .map_err(CommandError::from)?;
    invalidate_playlist_after_mutation(state.inner(), &playlist_uri).await;
    Ok(())
}

#[tauri::command]
pub async fn remove_track_from_playlist(
    playlist_uri: String,
    playlist_entry_id: String,
    track_uri: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    validate_uri(&playlist_uri)?;
    validate_uri(&track_uri)?;
    if playlist_entry_id.chars().count() > 512 {
        return Err(CommandError::internal("invalid playlist entry ID"));
    }
    state
        .provider
        .remove_track_from_playlist(&playlist_uri, &playlist_entry_id, &track_uri)
        .await
        .map_err(CommandError::from)?;
    invalidate_playlist_after_mutation(state.inner(), &playlist_uri).await;
    Ok(())
}

#[tauri::command]
pub async fn get_album(
    uri: String,
    request: PageRequest,
    state: State<'_, AppState>,
) -> Result<AlbumDetails, CommandError> {
    validate_uri(&uri)?;
    fetch_album(state.inner(), &uri, normalized(request)).await
}

pub(crate) async fn fetch_album(
    state: &AppState,
    uri: &str,
    request: PageRequest,
) -> Result<AlbumDetails, CommandError> {
    state
        .provider
        .get_album(uri, request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_artist(
    uri: String,
    state: State<'_, AppState>,
) -> Result<ArtistDetails, CommandError> {
    validate_uri(&uri)?;
    state.provider.get_artist(&uri).await.map_err(Into::into)
}

/// Pictures of several artists at once (listening analysis, recap), in one
/// request; an empty list makes the app fall back to searching.
#[tauri::command]
pub async fn artist_portraits(
    uris: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<EntitySummary>, CommandError> {
    let uris: Vec<String> = uris.into_iter().filter(|uri| uri.starts_with("spotify:artist:") && validate_uri(uri).is_ok()).take(50).collect();
    if uris.is_empty() {
        return Ok(Vec::new());
    }
    state.librespot.get_artist_portraits(&uris).await.map_err(Into::into)
}

/// All liked track URIs, so saved hearts are right beyond the loaded pages.
/// Only Librespot can list them cheaply; the mock answers with none.
#[tauri::command]
pub async fn get_liked_track_uris(state: State<'_, AppState>) -> Result<Vec<String>, CommandError> {
    if !state.uses_librespot() {
        return Ok(Vec::new());
    }
    state.librespot.liked_track_uris().await.map_err(Into::into)
}

pub(crate) async fn fetch_playlist(
    state: &AppState,
    uri: &str,
    request: PageRequest,
) -> Result<PlaylistDetails, CommandError> {
    state
        .provider
        .get_playlist(uri, request)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn get_queue(
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<QueueState, CommandError> {
    // Libre can hand out the leading window of long contexts (liked songs)
    // together with the full length; the UI grows it while scrolling.
    if let Some(limit) = limit
        && state.uses_librespot()
    {
        return state
            .librespot
            .queue_window(limit as usize)
            .await
            .map_err(Into::into);
    }
    state.provider.get_queue().await.map_err(Into::into)
}

/// Loads titles for queue rows on screen that are still placeholders.
#[tauri::command]
pub async fn hydrate_queue_items(
    uris: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if state.uses_librespot() {
        let uris = uris
            .into_iter()
            .take(64)
            .filter(|uri| uri.len() <= 128)
            .collect();
        state.librespot.hydrate_queue_items(uris).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn add_to_queue(
    uri: String,
    track: Option<luft_core::MediaItem>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    validate_uri(&uri)?;
    if super::listen_together::enqueue_in_room(
        &state,
        &uri,
        track.as_ref().map(std::slice::from_ref),
    )
    .await?
    {
        return Ok(());
    }
    state.provider.add_to_queue(&uri).await.map_err(Into::into)
}

#[tauri::command]
pub async fn remove_from_queue(
    uri: String,
    uid: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    super::listen_together::require_local_playback(&state).await?;
    validate_uri(&uri)?;
    // Libre rows carry stable uids; the URI alone is ambiguous for titles
    // that are both queued manually and part of the context.
    if let Some(uid) = uid
        .as_deref()
        .filter(|uid| !uid.is_empty() && uid.len() <= 64)
        && state.uses_librespot()
    {
        return state
            .librespot
            .remove_queue_entry(uid, &uri)
            .await
            .map_err(Into::into);
    }
    state
        .provider
        .remove_from_queue(&uri)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn clear_queue(state: State<'_, AppState>) -> Result<(), CommandError> {
    super::listen_together::require_local_playback(&state).await?;
    state.provider.clear_queue().await.map_err(Into::into)
}

#[tauri::command]
pub async fn reorder_queue(
    request: QueueReorderRequest,
    state: State<'_, AppState>,
) -> Result<QueueState, CommandError> {
    super::listen_together::require_local_playback(&state).await?;
    validate_queue_reference(&request.moved)?;
    validate_queue_reference(&request.anchor)?;

    if request.moved == request.anchor {
        return Err(CommandError::internal(
            "Ein Queue-Eintrag kann nicht relativ zu sich selbst verschoben werden.",
        ));
    }

    state
        .provider
        .reorder_queue(request)
        .await
        .map_err(Into::into)
}

pub(super) fn validate_uri(uri: &str) -> Result<(), CommandError> {
    if uri.is_empty()
        || uri.chars().count() > 512
        || !(uri.starts_with("spotify:") || uri.starts_with("mock:"))
    {
        return Err(CommandError::internal("invalid URI"));
    }
    Ok(())
}

fn validate_queue_reference(reference: &QueueItemReference) -> Result<(), CommandError> {
    validate_uri(&reference.uri)?;
    if reference
        .uid
        .as_ref()
        .is_some_and(|uid| uid.trim().is_empty() || uid.chars().count() > 512)
    {
        return Err(CommandError::internal("invalid queue UID"));
    }
    Ok(())
}

pub(super) async fn invalidate_playlist_after_mutation(state: &AppState, playlist_uri: &str) {
    if let Err(error) = playlist_snapshot::invalidate(state, playlist_uri).await {
        warn!(
            phase = "playlist-cache-invalidate",
            status = "snapshot-failed",
            error = ?error,
            "playlist mutation succeeded but snapshot invalidation failed"
        );
    }
    invalidate_cache_prefix_best_effort(state, &format!("spotify.playlist-v2.{playlist_uri}."))
        .await;
}

async fn invalidate_cache_prefix_best_effort(state: &AppState, prefix: &str) {
    let database = match state.database.get().await {
        Ok(database) => database,
        Err(error) => {
            warn!(
                phase = "cache-invalidate",
                status = "database-unavailable",
                error = %error,
                "remote mutation succeeded but cache invalidation was skipped"
            );
            return;
        }
    };
    if let Err(error) = database.clear_cache_prefix(prefix).await {
        warn!(
            phase = "cache-invalidate",
            status = "failed",
            error = %error,
            "remote mutation succeeded but cache invalidation failed"
        );
    }
}
