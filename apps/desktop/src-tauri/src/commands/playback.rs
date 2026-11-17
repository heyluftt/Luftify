use luft_core::{
    MediaItem, PageRequest, PlaybackProvider, PlaybackState, PlayerCommand, PlayerCommandRequest,
    QueueProvider,
};
use luft_infrastructure::DatabaseHandle;
use luft_librespot::{LibrespotPhase, LibrespotService, newest_first_catalog};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::State;
use tracing::{debug, info, warn};

use super::playlist_snapshot;
use crate::{error::CommandError, state::AppState};

const LAST_PLAYBACK_CACHE_KEY: &str = "spotify.playback.last.v1";
const LAST_PLAYBACK_SESSION_KEY: &str = "spotify.playback.last.v2";
const LAST_PLAYBACK_SESSION_KEY_LIBRESPOT: &str = "spotify.playback.last.v2.librespot";
const MAX_CACHED_QUEUE: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LastPlaybackSession {
    playback: PlaybackState,
    #[serde(default)]
    upcoming_uris: Vec<String>,
}

#[tauri::command]
pub async fn get_playback_state(state: State<'_, AppState>) -> Result<PlaybackState, CommandError> {
    if state.uses_librespot() {
        restore_librespot_startup_queue(&state.database, &state.librespot).await;
    }
    match state.provider.get_state().await {
        Ok(playback) => {
            persist_last_playback(&state, &playback).await;
            Ok(with_cached_item_if_empty(&state, playback).await)
        }
        Err(error) => {
            if !state.uses_librespot() {
                return Err(error.into());
            }
            match cached_last_playback(&state).await {
                Some(mut playback) => {
                    playback.is_playing = false;
                    Ok(playback)
                }
                None => Err(error.into()),
            }
        }
    }
}

async fn persist_last_playback(state: &State<'_, AppState>, playback: &PlaybackState) {
    if playback.current_item.is_none() {
        return;
    }
    let Ok(database) = state.database.get().await else {
        return;
    };
    let mut stored = playback.clone();
    stored.is_playing = false;
    let live = cached_upcoming_uris(state).await;
    let previous = cached_last_session(state).await;
    let upcoming_uris = merge_cached_upcoming(
        previous
            .as_ref()
            .map(|session| session.upcoming_uris.as_slice()),
        &live,
        previous
            .as_ref()
            .and_then(|session| session.playback.context_uri.as_deref()),
        stored.context_uri.as_deref(),
    );
    let session = LastPlaybackSession {
        playback: stored.clone(),
        upcoming_uris,
    };
    let _ = database
        .cache_persistent(LAST_PLAYBACK_SESSION_KEY_LIBRESPOT, "librespot", &session)
        .await;
    if state.uses_librespot() {
        let _ = database
            .cache_persistent(LAST_PLAYBACK_SESSION_KEY, "librespot", &session)
            .await;
        let _ = database
            .cache_persistent(LAST_PLAYBACK_CACHE_KEY, "librespot", &stored)
            .await;
    }
}

async fn cached_upcoming_uris(state: &State<'_, AppState>) -> Vec<String> {
    let Ok(queue) = state.provider.get_queue().await else {
        return Vec::new();
    };
    queue
        .items
        .into_iter()
        .map(|entry| entry.item.uri)
        .filter(|uri| !uri.is_empty())
        .take(MAX_CACHED_QUEUE)
        .collect()
}

async fn with_cached_item_if_empty(
    state: &State<'_, AppState>,
    mut playback: PlaybackState,
) -> PlaybackState {
    if playback.current_item.is_some() {
        return playback;
    }
    let Some(cached) = cached_last_playback(state).await else {
        return playback;
    };
    if cached.current_item.is_none() {
        return playback;
    }
    playback.current_item = cached.current_item;
    if playback.duration_ms == 0 {
        playback.duration_ms = cached.duration_ms;
    }
    if playback.context_uri.is_none() {
        playback.context_uri = cached.context_uri;
    }
    playback
}

async fn cached_last_playback(state: &State<'_, AppState>) -> Option<PlaybackState> {
    cached_last_session(state)
        .await
        .map(|session| session.playback)
}

async fn read_last_session(database: &DatabaseHandle) -> Option<LastPlaybackSession> {
    read_named_session(database, LAST_PLAYBACK_SESSION_KEY_LIBRESPOT)
        .await
        .or(read_named_session(database, LAST_PLAYBACK_SESSION_KEY).await)
        .or(read_legacy_playback_only(database).await)
}

async fn cached_last_session(state: &State<'_, AppState>) -> Option<LastPlaybackSession> {
    if let Some(session) =
        read_named_session(&state.database, LAST_PLAYBACK_SESSION_KEY_LIBRESPOT).await
    {
        return Some(session);
    }
    if state.uses_librespot() {
        return read_last_session(&state.database).await;
    }
    None
}

async fn read_named_session(database: &DatabaseHandle, key: &str) -> Option<LastPlaybackSession> {
    database.get().await.ok()?.cached(key).await.ok().flatten()
}

async fn read_legacy_playback_only(database: &DatabaseHandle) -> Option<LastPlaybackSession> {
    database
        .get()
        .await
        .ok()?
        .cached(LAST_PLAYBACK_CACHE_KEY)
        .await
        .ok()
        .flatten()
        .map(|playback| LastPlaybackSession {
            playback,
            upcoming_uris: Vec::new(),
        })
}

fn merge_cached_upcoming(
    previous: Option<&[String]>,
    live: &[String],
    previous_context: Option<&str>,
    live_context: Option<&str>,
) -> Vec<String> {
    let same_context = match (previous_context, live_context) {
        (Some(left), Some(right)) => left == right,
        (None, None) => true,
        _ => false,
    };
    if same_context && previous.is_some_and(|previous| previous.len() > live.len()) {
        return previous.unwrap_or_default().to_vec();
    }
    live.to_vec()
}

pub(crate) async fn restore_librespot_startup_queue(
    database: &DatabaseHandle,
    librespot: &LibrespotService,
) {
    if librespot.status().await.phase != LibrespotPhase::Ready {
        return;
    }
    if !librespot.claim_startup_queue_restore().await {
        return;
    }
    let started = Instant::now();
    let Some(session) = read_last_session(database).await else {
        info!(
            adapter = "playback-restore",
            phase = "queue-restore",
            elapsed_ms = started.elapsed().as_millis(),
            "no last playback session to restore"
        );
        return;
    };
    let Some(track) = session
        .playback
        .current_item
        .as_ref()
        .map(|item| item.uri.clone())
        .filter(|uri| !uri.is_empty())
    else {
        info!(
            adapter = "playback-restore",
            phase = "queue-restore",
            elapsed_ms = started.elapsed().as_millis(),
            "last session has no current track"
        );
        return;
    };
    info!(
        adapter = "playback-restore",
        phase = "queue-restore",
        track_uri = track.rsplit(':').next().unwrap_or(track.as_str()),
        context_uri = session.playback.context_uri.as_deref(),
        upcoming = session.upcoming_uris.len(),
        shuffle = session.playback.shuffle_enabled,
        elapsed_ms = started.elapsed().as_millis(),
        "restoring last librespot session"
    );
    if !librespot.adopt_playback_if_idle(&session.playback).await {
        info!(
            adapter = "playback-restore",
            phase = "queue-restore",
            elapsed_ms = started.elapsed().as_millis(),
            "startup adopt skipped, playback is already live"
        );
        return;
    }
    if let Some(context) = session
        .playback
        .context_uri
        .as_deref()
        .map(str::trim)
        .filter(|uri| !uri.is_empty() && *uri != track)
    {
        let catalog = playlist_snapshot::read_from_database(database, context)
            .await
            .ok()
            .flatten()
            .map(|details| newest_first_catalog(details.tracks))
            .filter(|tracks| !tracks.is_empty())
            .unwrap_or_default();
        let player = librespot.clone();
        let context = context.to_string();
        tokio::spawn(async move {
            player
                .seed_context_queue(&context, Some(track.as_str()), catalog)
                .await;
        });
        return;
    }
    let player = librespot.clone();
    let upcoming = session.upcoming_uris.clone();
    tokio::spawn(async move {
        for uri in upcoming.iter().filter(|uri| uri.as_str() != track.as_str()) {
            let _ = player.add_to_queue(uri).await;
        }
    });
}

#[tauri::command]
pub async fn send_player_command(
    request: PlayerCommandRequest,
    state: State<'_, AppState>,
) -> Result<PlaybackState, CommandError> {
    if !matches!(
        request.command,
        PlayerCommand::ToggleLike | PlayerCommand::SetVolume | PlayerCommand::ToggleMute
    ) {
        super::listen_together::require_local_playback(&state).await?;
        state.friends.take_over_playback().await;
    }
    match request.command {
        PlayerCommand::Toggle => {
            let live = state.provider.get_state().await.ok();
            if live.as_ref().is_some_and(|playback| playback.is_playing) {
                state.provider.pause().await?;
            } else {
                start_or_resume_playback(&state).await?;
            }
        }
        PlayerCommand::Play => start_or_resume_playback(&state).await?,
        PlayerCommand::Pause => state.provider.pause().await?,
        PlayerCommand::Next | PlayerCommand::Previous => {
            return Err(CommandError::internal(
                "Next und Previous benötigen den TransportCoordinator.",
            ));
        }
        PlayerCommand::Seek => state.provider.seek(valid_u64(request.value)?).await?,
        PlayerCommand::SetVolume => {
            state
                .provider
                .set_volume(
                    request
                        .value
                        .ok_or_else(|| CommandError::internal("volume is required"))?,
                )
                .await?
        }
        PlayerCommand::ToggleMute => state.provider.toggle_mute().await?,
        PlayerCommand::SetShuffle => {
            state
                .provider
                .set_shuffle(
                    request
                        .enabled
                        .ok_or_else(|| CommandError::internal("shuffle target is required"))?,
                )
                .await?
        }
        PlayerCommand::SetRepeat => {
            state
                .provider
                .set_repeat(
                    request
                        .repeat_mode
                        .ok_or_else(|| CommandError::internal("repeat target is required"))?,
                )
                .await?
        }
        PlayerCommand::ToggleLike => state.provider.toggle_like().await?,
    }
    state.provider.get_state().await.map_err(Into::into)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeCommandRequest {
    pub request_id: String,
    pub sequence: u64,
    pub connection_epoch: u64,
    pub created_at_ms: u64,
    pub sent_at_ms: u64,
    pub ui_volume: f64,
    pub volume: f64,
    pub curve: String,
    pub unmute: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumePreviewReceipt {
    pub request_id: String,
    pub sequence: u64,
    pub rust_received_at_ms: u64,
    pub rust_queued_at_ms: u64,
}

#[tauri::command]
pub async fn preview_volume(
    request: VolumeCommandRequest,
    state: State<'_, AppState>,
) -> Result<VolumePreviewReceipt, CommandError> {
    let rust_received_at_ms = timestamp_ms();
    validate_volume_request(&request, rust_received_at_ms)?;
    apply_provider_volume(&state, &request).await?;
    let rust_queued_at_ms = timestamp_ms();
    debug!(
        request_id = %request.request_id,
        sequence = request.sequence,
        connection_epoch = request.connection_epoch,
        rust_received_at_ms,
        rust_queued_at_ms,
        ui_target = request.ui_volume,
        spotify_target = request.volume,
        curve = %request.curve,
        phase = "preview-queued",
        "volume timing"
    );
    Ok(VolumePreviewReceipt {
        request_id: request.request_id,
        sequence: request.sequence,
        rust_received_at_ms,
        rust_queued_at_ms,
    })
}

#[tauri::command]
pub async fn send_volume_command(
    request: VolumeCommandRequest,
    state: State<'_, AppState>,
) -> Result<PlaybackState, CommandError> {
    let received_at_ms = timestamp_ms();
    validate_volume_request(&request, received_at_ms)?;
    debug!(
        request_id = %request.request_id,
        sequence = request.sequence,
        connection_epoch = request.connection_epoch,
        created_at_ms = request.created_at_ms,
        sent_at_ms = request.sent_at_ms,
        received_at_ms,
        target = request.volume,
        phase = "rust-received",
        "volume timing"
    );
    let playback = apply_provider_volume(&state, &request).await?;
    debug!(
        request_id = %request.request_id,
        sequence = request.sequence,
        response_at_ms = timestamp_ms(),
        confirmed = playback.volume,
        muted = playback.is_muted,
        phase = "rust-response",
        "volume timing"
    );
    Ok(playback)
}

async fn start_or_resume_playback(state: &State<'_, AppState>) -> Result<(), CommandError> {
    let live = state.provider.get_state().await.ok();
    if !state.uses_librespot() || !needs_cached_resume(live.as_ref()) {
        info!(
            adapter = "playback",
            phase = "play",
            track_uri = live
                .as_ref()
                .and_then(|playback| playback.current_item.as_ref())
                .map(|item| item.uri.as_str()),
            "play uses the live engine state"
        );
        return state.provider.play().await.map_err(Into::into);
    }
    let Some(session) = cached_last_session(state)
        .await
        .filter(|session| session.playback.current_item.is_some())
    else {
        info!(
            adapter = "playback",
            phase = "play",
            "play has no cached session, forwarding to the engine"
        );
        return state.provider.play().await.map_err(Into::into);
    };
    info!(
        adapter = "playback",
        phase = "play",
        track_uri = session
            .playback
            .current_item
            .as_ref()
            .map(|item| item.uri.as_str()),
        context_uri = session.playback.context_uri.as_deref(),
        "play resumes the cached session"
    );
    resume_cached_session(state, &session).await
}

async fn resume_cached_session(
    state: &State<'_, AppState>,
    session: &LastPlaybackSession,
) -> Result<(), CommandError> {
    if state.uses_librespot() {
        let phase = state.librespot.status().await.phase;
        if phase != LibrespotPhase::Ready {
            state.librespot.connect_if_possible().await?;
        }
        state.librespot.adopt_playback(&session.playback).await;
        let volume = if session.playback.is_muted {
            0.0
        } else {
            session.playback.volume
        };
        let _ = state.librespot.set_volume(volume).await;
    }
    match play_target_from_state(&session.playback) {
        Some(PlayTarget::Context { context, track }) => {
            resume_cached_context(state, &context, &track, &session.upcoming_uris).await?;
        }
        Some(PlayTarget::Uri(track)) => {
            state.provider.play_uri(&track).await?;
            restore_cached_queue(state, &track, &session.upcoming_uris).await;
        }
        None => state.provider.play().await?,
    }
    Ok(())
}

async fn resume_cached_context(
    state: &State<'_, AppState>,
    context: &str,
    track: &str,
    upcoming_uris: &[String],
) -> Result<(), CommandError> {
    if state.uses_librespot() {
        let catalog = load_context_catalog(state, context, None).await;
        if state
            .librespot
            .play_context_from_catalog(context, Some(track), catalog)
            .await
            .is_ok()
        {
            return Ok(());
        }
        warn!(
            context_uri = context,
            adapter = "playback-resume",
            "cached playlist context could not be restored, falling back to the track"
        );
    } else if state.provider.play_context(context, track).await.is_ok() {
        return Ok(());
    }
    state.provider.play_uri(track).await?;
    restore_cached_queue(state, track, upcoming_uris).await;
    Ok(())
}

async fn restore_cached_queue(
    state: &State<'_, AppState>,
    current_uri: &str,
    upcoming_uris: &[String],
) {
    for uri in upcoming_uris
        .iter()
        .filter(|uri| uri.as_str() != current_uri)
    {
        if let Err(error) = state.provider.add_to_queue(uri).await {
            warn!(
                error = %error,
                uri,
                adapter = "playback-resume",
                "cached queue item skipped"
            );
        }
    }
}

fn needs_cached_resume(live: Option<&PlaybackState>) -> bool {
    live.is_none_or(|playback| playback.current_item.is_none())
}

async fn apply_provider_volume(
    state: &State<'_, AppState>,
    request: &VolumeCommandRequest,
) -> Result<PlaybackState, CommandError> {
    if request.unmute && state.provider.get_state().await?.is_muted {
        state.provider.toggle_mute().await?;
    }
    state.provider.set_volume(request.volume).await?;
    state.provider.get_state().await.map_err(Into::into)
}

fn validate_volume_request(
    request: &VolumeCommandRequest,
    received_at_ms: u64,
) -> Result<(), CommandError> {
    let id_length = request.request_id.chars().count();
    let age = received_at_ms.saturating_sub(request.created_at_ms);
    if id_length == 0
        || id_length > 128
        || request.sequence == 0
        || !request.ui_volume.is_finite()
        || !(0.0..=1.0).contains(&request.ui_volume)
        || !request.volume.is_finite()
        || !(0.0..=1.0).contains(&request.volume)
        || request.sent_at_ms < request.created_at_ms
        || received_at_ms < request.created_at_ms
        || age > 5_000
        || !matches!(request.curve.as_str(), "linear" | "perceptual")
    {
        return Err(CommandError::internal(
            "Lautstärkebefehl ist ungültig oder abgelaufen.",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportAction {
    Next,
    Previous,
}

impl TransportAction {
    fn method(self) -> &'static str {
        match self {
            Self::Next => "player.next",
            Self::Previous => "player.previous",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportCommandRequest {
    pub request_id: String,
    pub action: TransportAction,
    pub created_at_ms: u64,
    pub sent_at_ms: u64,
    pub expires_at_ms: u64,
    pub connection_epoch: u64,
    pub created_track_generation: u64,
    pub track_generation: u64,
    pub track_uri_before: Option<String>,
    pub position_before_ms: u64,
}

#[tauri::command]
pub async fn send_transport_command(
    request: TransportCommandRequest,
    state: State<'_, AppState>,
) -> Result<PlaybackState, CommandError> {
    super::listen_together::require_local_playback(&state).await?;
    validate_transport_request(&request)?;
    let received_at_ms = timestamp_ms();
    if received_at_ms >= request.expires_at_ms {
        warn!(
            request_id = %request.request_id,
            action = request.action.method(),
            created_at_ms = request.created_at_ms,
            sent_at_ms = request.sent_at_ms,
            received_at_ms,
            phase = "expired-before-rust-send",
            "transport timing"
        );
        return Err(CommandError::internal("Transportbefehl ist abgelaufen."));
    }
    info!(
        request_id = %request.request_id,
        action = request.action.method(),
        created_at_ms = request.created_at_ms,
        sent_at_ms = request.sent_at_ms,
        received_at_ms,
        connection_epoch = request.connection_epoch,
        track_generation = request.track_generation,
        track_uri_before = ?request.track_uri_before,
        phase = "rust-received",
        "transport timing"
    );

    state.friends.take_over_playback().await;
    match request.action {
        TransportAction::Next => state.provider.next().await?,
        TransportAction::Previous => state.provider.previous().await?,
    }
    let playback = state.provider.get_state().await?;
    let response_at_ms = timestamp_ms();
    info!(
        request_id = %request.request_id,
        action = request.action.method(),
        response_at_ms,
        elapsed_ms = response_at_ms.saturating_sub(received_at_ms),
        track_uri_before = ?request.track_uri_before,
        track_uri_after = ?playback.current_item.as_ref().map(|item| item.uri.as_str()),
        phase = "rust-response",
        "transport timing"
    );
    Ok(playback)
}

fn validate_transport_request(request: &TransportCommandRequest) -> Result<(), CommandError> {
    let id_length = request.request_id.chars().count();
    let uri_valid = request
        .track_uri_before
        .as_ref()
        .is_none_or(|uri| !uri.is_empty() && uri.chars().count() <= 512);
    let lifetime = request.expires_at_ms.saturating_sub(request.created_at_ms);
    if id_length == 0
        || id_length > 128
        || !uri_valid
        || request.sent_at_ms < request.created_at_ms
        || request.expires_at_ms <= request.sent_at_ms
        || lifetime > 5_000
    {
        return Err(CommandError::internal("Transportbefehl ist ungültig."));
    }
    Ok(())
}

fn timestamp_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

#[tauri::command]
pub async fn play_uri(
    uri: String,
    context_tracks: Option<Vec<MediaItem>>,
    preserve_queue: Option<bool>,
    state: State<'_, AppState>,
) -> Result<PlaybackState, CommandError> {
    if super::listen_together::select_in_room(&state, &uri, context_tracks.as_deref()).await? {
        return state.provider.get_state().await.map_err(Into::into);
    }
    if uri.is_empty() || uri.chars().count() > 512 {
        return Err(CommandError::internal("invalid URI"));
    }
    state.friends.take_over_playback().await;
    if preserve_queue.unwrap_or(false) {
        if !state.uses_librespot() {
            return Err(CommandError::internal("queue playback engine changed"));
        }
        state.librespot.play_queue_item(&uri).await?;
        return state.provider.get_state().await.map_err(Into::into);
    }
    if state.uses_librespot() && is_library_context_uri(&uri) {
        let catalog = context_tracks.unwrap_or_default();
        state
            .librespot
            .play_context_from_catalog(&uri, None, catalog)
            .await?;
        return state.provider.get_state().await.map_err(Into::into);
    }
    state.provider.play_uri(&uri).await?;
    state.provider.get_state().await.map_err(Into::into)
}

#[tauri::command]
pub async fn play_context(
    context_uri: String,
    track_uri: String,
    context_tracks: Option<Vec<MediaItem>>,
    state: State<'_, AppState>,
) -> Result<PlaybackState, CommandError> {
    if super::listen_together::select_in_room(&state, &track_uri, context_tracks.as_deref()).await? {
        return state.provider.get_state().await.map_err(Into::into);
    }
    if context_uri.is_empty()
        || track_uri.is_empty()
        || context_uri.chars().count() > 512
        || track_uri.chars().count() > 512
    {
        return Err(CommandError::internal("invalid URI"));
    }
    state.friends.take_over_playback().await;
    if state.uses_librespot() {
        let catalog = context_tracks.unwrap_or_default();
        let track = (!track_uri.is_empty()).then_some(track_uri.as_str());
        state
            .librespot
            .play_context_from_catalog(&context_uri, track, catalog)
            .await?;
        return state.provider.get_state().await.map_err(Into::into);
    }
    state
        .provider
        .play_context(&context_uri, &track_uri)
        .await?;
    state.provider.get_state().await.map_err(Into::into)
}

/// What a cached session should start again with: the track inside its
/// playlist/album/artist context when one is stored, otherwise the bare track.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PlayTarget {
    Uri(String),
    Context { context: String, track: String },
}

fn play_target_from_state(state: &PlaybackState) -> Option<PlayTarget> {
    let track = state
        .current_item
        .as_ref()
        .map(|item| item.uri.trim())
        .filter(|uri| is_playable_item_uri(uri))?;
    let context = state
        .context_uri
        .as_deref()
        .map(str::trim)
        .filter(|uri| is_context_uri(uri) && *uri != track);
    Some(match context {
        Some(context) => PlayTarget::Context {
            context: context.to_string(),
            track: track.to_string(),
        },
        None => PlayTarget::Uri(track.to_string()),
    })
}

fn is_playable_item_uri(uri: &str) -> bool {
    let uri = uri.trim();
    uri.starts_with("spotify:track:")
        || uri.starts_with("spotify:episode:")
        || uri.starts_with("spotify:local:")
        || uri.starts_with("mock:track:")
}

fn is_context_uri(uri: &str) -> bool {
    let uri = uri.trim();
    if is_playable_item_uri(uri) {
        return false;
    }
    uri.starts_with("spotify:playlist:")
        || uri.starts_with("spotify:album:")
        || uri.starts_with("spotify:artist:")
        || uri.starts_with("spotify:show:")
        || uri.starts_with("spotify:collection:")
        || uri.starts_with("mock:playlist:")
        || uri.starts_with("mock:album:")
        || (uri.starts_with("spotify:user:") && uri.contains(":playlist:"))
}

fn is_library_context_uri(uri: &str) -> bool {
    let uri = uri.trim();
    uri.starts_with("spotify:playlist:")
        || uri.starts_with("spotify:search:")
        || uri.starts_with("spotify:album:")
        || uri.starts_with("spotify:artist:")
        || (uri.starts_with("spotify:user:") && uri.contains(":playlist:"))
}

async fn load_context_catalog(
    state: &State<'_, AppState>,
    context_uri: &str,
    provided: Option<Vec<MediaItem>>,
) -> Vec<MediaItem> {
    if let Some(tracks) = provided.filter(|tracks| !tracks.is_empty()) {
        return tracks;
    }
    if context_uri.contains(":playlist:")
        && let Ok(Some(snapshot)) = playlist_snapshot::read(state.inner(), context_uri).await
        && !snapshot.tracks.is_empty()
    {
        return newest_first_catalog(snapshot.tracks);
    }
    if context_uri.starts_with("spotify:album:")
        && let Ok(album) = super::library::fetch_album(
            state.inner(),
            context_uri,
            PageRequest {
                offset: 0,
                limit: 500,
            },
        )
        .await
        && !album.tracks.is_empty()
    {
        return album.tracks;
    }
    if context_uri.starts_with("spotify:artist:") {
        if state.uses_librespot()
            && let Ok(artist) = state.librespot.get_artist(context_uri).await
            && !artist.popular_tracks.is_empty()
        {
            return artist.popular_tracks;
        }
        if let Ok(artist) = state.provider.get_artist(context_uri).await
            && !artist.popular_tracks.is_empty()
        {
            return artist.popular_tracks;
        }
    }
    Vec::new()
}

fn valid_u64(value: Option<f64>) -> Result<u64, CommandError> {
    let value = value.ok_or_else(|| CommandError::internal("position is required"))?;
    if !value.is_finite() || value < 0.0 || value > u64::MAX as f64 {
        return Err(CommandError::internal("position is invalid"));
    }
    Ok(value.round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TransportCommandRequest {
        TransportCommandRequest {
            request_id: "transport-test-1".into(),
            action: TransportAction::Next,
            created_at_ms: 1_000,
            sent_at_ms: 1_010,
            expires_at_ms: 2_800,
            connection_epoch: 3,
            created_track_generation: 4,
            track_generation: 4,
            track_uri_before: Some("spotify:track:one".into()),
            position_before_ms: 12_000,
        }
    }

    fn playback(current_item: bool) -> PlaybackState {
        PlaybackState {
            current_item: current_item.then(|| MediaItem {
                uri: "spotify:track:one".into(),
                source: luft_core::MediaSource::Spotify,
                item_type: luft_core::MediaItemType::Track,
                title: "One".into(),
                creators: Vec::new(),
                album_name: None,
                album_uri: None,
                duration_ms: Some(200_000),
                play_count: None,
                cover_uri: None,
                canvas_url: None,
                added_at: None,
                playlist_entry_id: None,
                added_by: None,
                explicit: false,
                playable: true,
            }),
            is_playing: false,
            position_ms: 12_000,
            duration_ms: 200_000,
            volume: 0.5,
            is_muted: false,
            shuffle_enabled: false,
            repeat_mode: luft_core::RepeatMode::Off,
            is_saved: false,
            context_uri: None,
            updated_at: "2026-08-19T12:00:00Z".into(),
            clock_ready: true,
        }
    }

    #[test]
    fn playlist_context_is_preferred_over_the_bare_track() {
        let mut state = playback(true);
        state.context_uri = Some("spotify:playlist:night".into());
        assert_eq!(
            play_target_from_state(&state),
            Some(PlayTarget::Context {
                context: "spotify:playlist:night".into(),
                track: "spotify:track:one".into(),
            })
        );
        state.context_uri = Some("spotify:track:one".into());
        assert_eq!(
            play_target_from_state(&state),
            Some(PlayTarget::Uri("spotify:track:one".into()))
        );
    }

    #[test]
    fn play_reloads_the_last_track_when_the_engine_is_empty() {
        assert!(needs_cached_resume(None));
        assert!(needs_cached_resume(Some(&playback(false))));
        assert!(!needs_cached_resume(Some(&playback(true))));
    }

    #[test]
    fn last_session_keeps_upcoming_uris_for_resume() {
        let session = LastPlaybackSession {
            playback: playback(true),
            upcoming_uris: vec!["spotify:track:two".into(), "spotify:track:three".into()],
        };
        let encoded = serde_json::to_value(&session).expect("encode");
        let decoded: LastPlaybackSession = serde_json::from_value(encoded).expect("decode");
        assert_eq!(decoded.upcoming_uris.len(), 2);
        assert!(matches!(
            play_target_from_state(&decoded.playback),
            Some(PlayTarget::Uri(_))
        ));
    }

    #[test]
    fn last_session_does_not_shrink_the_same_context_queue() {
        let previous = vec![
            "spotify:track:two".into(),
            "spotify:track:three".into(),
            "spotify:track:four".into(),
        ];
        let live = vec!["spotify:track:two".into()];
        let merged = merge_cached_upcoming(
            Some(&previous),
            &live,
            Some("spotify:playlist:night"),
            Some("spotify:playlist:night"),
        );
        assert_eq!(merged, previous);
        let next_context = merge_cached_upcoming(
            Some(&previous),
            &live,
            Some("spotify:playlist:night"),
            Some("spotify:playlist:other"),
        );
        assert_eq!(next_context, live);
    }

    #[test]
    fn last_session_without_queue_field_still_loads() {
        let value = serde_json::json!({
            "playback": {
                "currentItem": {
                    "uri": "spotify:track:one",
                    "source": "spotify",
                    "itemType": "track",
                    "title": "One",
                    "creators": [],
                    "explicit": false,
                    "playable": true
                },
                "isPlaying": false,
                "positionMs": 0,
                "durationMs": 200000,
                "volume": 0.5,
                "isMuted": false,
                "shuffleEnabled": false,
                "repeatMode": "off",
                "isSaved": false,
                "contextUri": "spotify:playlist:night",
                "updatedAt": "2026-08-19T12:00:00Z"
            }
        });
        let session: LastPlaybackSession = serde_json::from_value(value).expect("decode");
        assert!(session.upcoming_uris.is_empty());
        assert!(matches!(
            play_target_from_state(&session.playback),
            Some(PlayTarget::Context { .. })
        ));
    }

    #[test]
    fn transport_request_rejects_expired_or_excessive_lifetime() {
        assert!(validate_transport_request(&request()).is_ok());
        let mut invalid = request();
        invalid.expires_at_ms = 9_000;
        assert!(validate_transport_request(&invalid).is_err());
    }

    #[test]
    fn volume_request_rejects_stale_and_invalid_values() {
        let request = VolumeCommandRequest {
            request_id: "volume-1".into(),
            sequence: 1,
            connection_epoch: 2,
            created_at_ms: 1_000,
            sent_at_ms: 1_010,
            ui_volume: 0.75,
            volume: 0.75,
            curve: "linear".into(),
            unmute: true,
        };
        assert!(validate_volume_request(&request, 1_020).is_ok());
        assert!(validate_volume_request(&request, 7_000).is_err());
        let mut invalid = request;
        invalid.volume = 1.5;
        assert!(validate_volume_request(&invalid, 1_020).is_err());
    }
}
