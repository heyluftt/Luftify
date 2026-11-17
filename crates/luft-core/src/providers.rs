use async_trait::async_trait;
use thiserror::Error;

use crate::{
    AlbumDetails, ArtistDetails, EntitySummary, MediaItem, Page, PageRequest, PlaybackState,
    PlaylistDetails, QueueReorderRequest, QueueState, RepeatMode, SearchRequest, SearchResult,
};

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("The requested capability is unavailable")]
    CapabilityUnavailable,
    #[error("The provider is disconnected")]
    Disconnected,
    #[error("The request timed out")]
    Timeout,
    #[error("The request is invalid: {0}")]
    InvalidRequest(String),
    #[error("The provider rejected the action: {message}")]
    ActionRejected { message: String, retryable: bool },
    #[error("The provider failed: {0}")]
    Internal(String),
}

#[async_trait]
pub trait PlaybackProvider: Send + Sync {
    /// Room authority owns transitions. Engines may warm one speculative track;
    /// preloading must never itself select or start it.
    async fn set_room_queue(
        &self,
        _active: bool,
        _next_uri: Option<&str>,
    ) -> Result<(), ProviderError> {
        Ok(())
    }
    async fn get_state(&self) -> Result<PlaybackState, ProviderError>;
    async fn toggle(&self) -> Result<(), ProviderError>;
    async fn play(&self) -> Result<(), ProviderError>;
    async fn pause(&self) -> Result<(), ProviderError>;
    async fn next(&self) -> Result<(), ProviderError>;
    async fn previous(&self) -> Result<(), ProviderError>;
    async fn seek(&self, position_ms: u64) -> Result<(), ProviderError>;
    async fn set_volume(&self, volume: f64) -> Result<(), ProviderError>;
    async fn toggle_mute(&self) -> Result<(), ProviderError>;
    async fn set_shuffle(&self, enabled: bool) -> Result<(), ProviderError>;
    async fn set_repeat(&self, mode: RepeatMode) -> Result<(), ProviderError>;
    async fn toggle_like(&self) -> Result<(), ProviderError>;
    async fn play_uri(&self, uri: &str) -> Result<(), ProviderError>;
    async fn play_context(&self, context_uri: &str, track_uri: &str) -> Result<(), ProviderError>;
}

#[async_trait]
pub trait SearchProvider: Send + Sync {
    async fn search(&self, request: SearchRequest) -> Result<SearchResult, ProviderError>;
}

#[async_trait]
pub trait LibraryProvider: Send + Sync {
    async fn get_playlists(
        &self,
        request: PageRequest,
    ) -> Result<Page<EntitySummary>, ProviderError>;
    async fn get_liked_tracks(
        &self,
        request: PageRequest,
    ) -> Result<Page<MediaItem>, ProviderError>;
    async fn set_track_saved(&self, uri: &str, saved: bool) -> Result<(), ProviderError>;
    async fn get_playlist(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<PlaylistDetails, ProviderError>;
    async fn add_track_to_playlist(
        &self,
        playlist_uri: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError>;
    async fn remove_track_from_playlist(
        &self,
        playlist_uri: &str,
        playlist_entry_id: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError>;
    async fn get_album(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<AlbumDetails, ProviderError>;
    async fn get_artist(&self, uri: &str) -> Result<ArtistDetails, ProviderError>;
}

#[async_trait]
pub trait QueueProvider: Send + Sync {
    async fn get_queue(&self) -> Result<QueueState, ProviderError>;
    async fn add_to_queue(&self, uri: &str) -> Result<(), ProviderError>;
    async fn remove_from_queue(&self, uri: &str) -> Result<(), ProviderError>;
    async fn clear_queue(&self) -> Result<(), ProviderError>;
    async fn reorder_queue(
        &self,
        request: QueueReorderRequest,
    ) -> Result<QueueState, ProviderError>;
}

pub trait SpotifyProvider:
    PlaybackProvider + SearchProvider + LibraryProvider + QueueProvider + Send + Sync
{
}

impl<T> SpotifyProvider for T where
    T: PlaybackProvider + SearchProvider + LibraryProvider + QueueProvider + Send + Sync
{
}
