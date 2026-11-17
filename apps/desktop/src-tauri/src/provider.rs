use std::sync::Arc;

use async_trait::async_trait;
use luft_core::{
    AlbumDetails, ArtistDetails, EntitySummary, LibraryProvider, MediaItem, Page, PageRequest,
    PlaybackProvider, PlaybackState, PlaylistDetails, ProviderError, QueueProvider,
    QueueReorderRequest, QueueState, RepeatMode, SearchProvider, SearchRequest, SearchResult,
};
use luft_librespot::LibrespotService;

/// Libre as the app's single `SpotifyProvider`. Playback and queue already
/// come from the service's trait implementations; search and library are
/// inherent methods there, so this adapter only forwards them.
pub struct LibreProvider {
    inner: Arc<LibrespotService>,
}

impl LibreProvider {
    #[must_use]
    pub fn new(inner: Arc<LibrespotService>) -> Self {
        Self { inner }
    }

    fn playback(&self) -> &dyn PlaybackProvider {
        self.inner.as_ref()
    }

    fn queue(&self) -> &dyn QueueProvider {
        self.inner.as_ref()
    }
}

#[async_trait]
impl PlaybackProvider for LibreProvider {
    async fn set_room_queue(
        &self,
        active: bool,
        next_uri: Option<&str>,
    ) -> Result<(), ProviderError> {
        self.playback().set_room_queue(active, next_uri).await
    }
    async fn get_state(&self) -> Result<PlaybackState, ProviderError> {
        self.playback().get_state().await
    }
    async fn toggle(&self) -> Result<(), ProviderError> {
        self.playback().toggle().await
    }
    async fn play(&self) -> Result<(), ProviderError> {
        self.playback().play().await
    }
    async fn pause(&self) -> Result<(), ProviderError> {
        self.playback().pause().await
    }
    async fn next(&self) -> Result<(), ProviderError> {
        self.playback().next().await
    }
    async fn previous(&self) -> Result<(), ProviderError> {
        self.playback().previous().await
    }
    async fn seek(&self, position_ms: u64) -> Result<(), ProviderError> {
        self.playback().seek(position_ms).await
    }
    async fn set_volume(&self, volume: f64) -> Result<(), ProviderError> {
        self.playback().set_volume(volume).await
    }
    async fn toggle_mute(&self) -> Result<(), ProviderError> {
        self.playback().toggle_mute().await
    }
    async fn set_shuffle(&self, enabled: bool) -> Result<(), ProviderError> {
        self.playback().set_shuffle(enabled).await
    }
    async fn set_repeat(&self, mode: RepeatMode) -> Result<(), ProviderError> {
        self.playback().set_repeat(mode).await
    }
    async fn toggle_like(&self) -> Result<(), ProviderError> {
        self.playback().toggle_like().await
    }
    async fn play_uri(&self, uri: &str) -> Result<(), ProviderError> {
        self.playback().play_uri(uri).await
    }
    async fn play_context(&self, context_uri: &str, track_uri: &str) -> Result<(), ProviderError> {
        self.playback().play_context(context_uri, track_uri).await
    }
}

#[async_trait]
impl SearchProvider for LibreProvider {
    async fn search(&self, request: SearchRequest) -> Result<SearchResult, ProviderError> {
        self.inner.search(request).await
    }
}

#[async_trait]
impl LibraryProvider for LibreProvider {
    async fn get_playlists(
        &self,
        request: PageRequest,
    ) -> Result<Page<EntitySummary>, ProviderError> {
        self.inner.get_playlists(request).await
    }
    async fn get_liked_tracks(
        &self,
        request: PageRequest,
    ) -> Result<Page<MediaItem>, ProviderError> {
        self.inner.get_liked_tracks(request).await
    }
    async fn set_track_saved(&self, uri: &str, saved: bool) -> Result<(), ProviderError> {
        self.inner.set_track_saved(uri, saved).await
    }
    async fn get_playlist(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<PlaylistDetails, ProviderError> {
        self.inner.get_playlist(uri, request).await
    }
    async fn add_track_to_playlist(
        &self,
        playlist_uri: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        self.inner
            .add_track_to_playlist(playlist_uri, track_uri)
            .await
    }
    async fn remove_track_from_playlist(
        &self,
        playlist_uri: &str,
        playlist_entry_id: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        self.inner
            .remove_track_from_playlist(playlist_uri, playlist_entry_id, track_uri)
            .await
    }
    async fn get_album(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<AlbumDetails, ProviderError> {
        self.inner.get_album(uri, request).await
    }
    async fn get_artist(&self, uri: &str) -> Result<ArtistDetails, ProviderError> {
        self.inner.get_artist(uri).await
    }
}

#[async_trait]
impl QueueProvider for LibreProvider {
    async fn get_queue(&self) -> Result<QueueState, ProviderError> {
        self.queue().get_queue().await
    }
    async fn add_to_queue(&self, uri: &str) -> Result<(), ProviderError> {
        self.queue().add_to_queue(uri).await
    }
    async fn remove_from_queue(&self, uri: &str) -> Result<(), ProviderError> {
        self.queue().remove_from_queue(uri).await
    }
    async fn clear_queue(&self) -> Result<(), ProviderError> {
        self.queue().clear_queue().await
    }
    async fn reorder_queue(
        &self,
        request: QueueReorderRequest,
    ) -> Result<QueueState, ProviderError> {
        self.queue().reorder_queue(request).await
    }
}
