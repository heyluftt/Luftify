use std::{sync::Arc, time::Instant};

use async_trait::async_trait;
use chrono::Utc;
use tokio::{
    sync::Mutex,
    time::{Duration, sleep},
};

use crate::{
    AlbumDetails, ArtistDetails, ArtistRelease, ArtistReleaseType, Capability, EntitySummary,
    LibraryProvider, MediaCreator, MediaItem, MediaItemType, MediaSource, Page, PageRequest,
    PlaybackProvider, PlaybackState, PlaylistDetails, ProviderError, QueueItem, QueueItemReference,
    QueuePlacement, QueueProvider, QueueReorderRequest, QueueState, RepeatMode, SearchProvider,
    SearchRequest, SearchResult,
};

#[derive(Debug)]
struct MockState {
    current: usize,
    playback: PlaybackState,
    updated: Instant,
    queue: Vec<QueueItem>,
    revision: u64,
}

#[derive(Debug, Clone)]
pub struct MockSpotifyProvider {
    tracks: Arc<Vec<MediaItem>>,
    artists: Arc<Vec<EntitySummary>>,
    albums: Arc<Vec<EntitySummary>>,
    playlists: Arc<Vec<EntitySummary>>,
    state: Arc<Mutex<MockState>>,
    latency: Duration,
}

impl Default for MockSpotifyProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl MockSpotifyProvider {
    #[must_use]
    pub fn new() -> Self {
        let tracks = Arc::new(sample_tracks());
        let first = tracks.first().cloned();
        let playback = PlaybackState {
            duration_ms: first
                .as_ref()
                .and_then(|item| item.duration_ms)
                .unwrap_or(0),
            current_item: first,
            is_playing: true,
            position_ms: 42_000,
            volume: 0.72,
            is_muted: false,
            shuffle_enabled: false,
            repeat_mode: RepeatMode::Off,
            is_saved: true,
            context_uri: Some("spotify:playlist:mock-night-drive".into()),
            updated_at: Utc::now().to_rfc3339(),
            clock_ready: true,
        };
        Self {
            tracks: Arc::clone(&tracks),
            artists: Arc::new(sample_artists()),
            albums: Arc::new(sample_albums()),
            playlists: Arc::new(sample_playlists()),
            state: Arc::new(Mutex::new(MockState {
                current: 0,
                playback,
                updated: Instant::now(),
                queue: tracks
                    .iter()
                    .skip(1)
                    .take(3)
                    .cloned()
                    .enumerate()
                    .map(|(index, item)| QueueItem {
                        item,
                        uid: Some(format!("mock-queue-{index}")),
                    })
                    .collect(),
                revision: 1,
            })),
            latency: Duration::from_millis(45),
        }
    }

    async fn delay(&self) {
        sleep(self.latency).await;
    }

    async fn select(&self, index: usize) {
        let mut state = self.state.lock().await;
        let index = index % self.tracks.len();
        state.current = index;
        state.playback.current_item = self.tracks.get(index).cloned();
        state.playback.position_ms = 0;
        state.playback.duration_ms = state
            .playback
            .current_item
            .as_ref()
            .and_then(|item| item.duration_ms)
            .unwrap_or(0);
        state.playback.is_playing = true;
        state.playback.is_saved = index.is_multiple_of(2);
        state.playback.updated_at = Utc::now().to_rfc3339();
        state.updated = Instant::now();
    }
}

#[async_trait]
impl PlaybackProvider for MockSpotifyProvider {
    async fn get_state(&self) -> Result<PlaybackState, ProviderError> {
        self.delay().await;
        let mut state = self.state.lock().await;
        if state.playback.is_playing {
            let elapsed = u64::try_from(state.updated.elapsed().as_millis()).unwrap_or(u64::MAX);
            state.playback.position_ms = state
                .playback
                .position_ms
                .saturating_add(elapsed)
                .min(state.playback.duration_ms);
            state.updated = Instant::now();
        }
        state.playback.updated_at = Utc::now().to_rfc3339();
        Ok(state.playback.clone())
    }

    async fn toggle(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.is_playing = !state.playback.is_playing;
        state.updated = Instant::now();
        Ok(())
    }

    async fn play(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.is_playing = true;
        state.updated = Instant::now();
        Ok(())
    }

    async fn pause(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.is_playing = false;
        Ok(())
    }

    async fn next(&self) -> Result<(), ProviderError> {
        let index = self.state.lock().await.current + 1;
        self.select(index).await;
        Ok(())
    }

    async fn previous(&self) -> Result<(), ProviderError> {
        let state = self.state.lock().await;
        let index = if state.current == 0 {
            self.tracks.len() - 1
        } else {
            state.current - 1
        };
        drop(state);
        self.select(index).await;
        Ok(())
    }

    async fn seek(&self, position_ms: u64) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.position_ms = position_ms.min(state.playback.duration_ms);
        state.updated = Instant::now();
        Ok(())
    }

    async fn set_volume(&self, volume: f64) -> Result<(), ProviderError> {
        if !volume.is_finite() {
            return Err(ProviderError::InvalidRequest(
                "volume must be finite".into(),
            ));
        }
        self.state.lock().await.playback.volume = volume.clamp(0.0, 1.0);
        Ok(())
    }

    async fn toggle_mute(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.is_muted = !state.playback.is_muted;
        Ok(())
    }

    async fn set_shuffle(&self, enabled: bool) -> Result<(), ProviderError> {
        self.state.lock().await.playback.shuffle_enabled = enabled;
        Ok(())
    }

    async fn set_repeat(&self, mode: RepeatMode) -> Result<(), ProviderError> {
        self.state.lock().await.playback.repeat_mode = mode;
        Ok(())
    }

    async fn toggle_like(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.playback.is_saved = !state.playback.is_saved;
        Ok(())
    }

    async fn play_uri(&self, uri: &str) -> Result<(), ProviderError> {
        let index = self
            .tracks
            .iter()
            .position(|item| item.uri == uri)
            .ok_or_else(|| ProviderError::InvalidRequest("unknown mock URI".into()))?;
        self.select(index).await;
        Ok(())
    }

    async fn play_context(&self, _context_uri: &str, track_uri: &str) -> Result<(), ProviderError> {
        self.play_uri(track_uri).await
    }
}

#[async_trait]
impl SearchProvider for MockSpotifyProvider {
    async fn search(&self, request: SearchRequest) -> Result<SearchResult, ProviderError> {
        self.delay().await;
        let query = request.query.trim();
        if query.is_empty() || query.chars().count() > 200 {
            return Err(ProviderError::InvalidRequest(
                "query must contain 1 to 200 characters".into(),
            ));
        }
        if query.eq_ignore_ascii_case("disconnect") {
            return Err(ProviderError::Disconnected);
        }
        if query.eq_ignore_ascii_case("error") {
            return Err(ProviderError::Internal("simulated search failure".into()));
        }
        let query_lower = query.to_lowercase();
        let limit = usize::try_from(request.limit.clamp(1, 50)).unwrap_or(20);
        let offset = usize::try_from(request.offset).unwrap_or(usize::MAX);
        let matches = |value: &str| value.to_lowercase().contains(&query_lower);
        Ok(SearchResult {
            query: query.into(),
            offset: request.offset,
            limit: request.limit,
            has_more: false,
            tracks: self
                .tracks
                .iter()
                .filter(|item| {
                    matches(&item.title)
                        || item.creators.iter().any(|creator| matches(&creator.name))
                })
                .skip(offset)
                .take(limit)
                .cloned()
                .collect(),
            artists: self
                .artists
                .iter()
                .filter(|item| matches(&item.name))
                .skip(offset)
                .take(limit)
                .cloned()
                .collect(),
            albums: self
                .albums
                .iter()
                .filter(|item| matches(&item.name) || item.subtitle.as_deref().is_some_and(matches))
                .skip(offset)
                .take(limit)
                .cloned()
                .collect(),
            playlists: self
                .playlists
                .iter()
                .filter(|item| matches(&item.name))
                .skip(offset)
                .take(limit)
                .cloned()
                .collect(),
            top_result_uri: None,
            unavailable: Vec::<Capability>::new(),
        })
    }
}

#[async_trait]
impl LibraryProvider for MockSpotifyProvider {
    async fn get_playlists(
        &self,
        request: PageRequest,
    ) -> Result<Page<EntitySummary>, ProviderError> {
        self.delay().await;
        Ok(page(&self.playlists, request))
    }

    async fn get_liked_tracks(
        &self,
        request: PageRequest,
    ) -> Result<Page<MediaItem>, ProviderError> {
        self.delay().await;
        Ok(page(&self.tracks, request))
    }

    async fn set_track_saved(&self, uri: &str, saved: bool) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        if state
            .playback
            .current_item
            .as_ref()
            .is_some_and(|item| item.uri == uri)
        {
            state.playback.is_saved = saved;
        }
        Ok(())
    }

    async fn get_playlist(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<PlaylistDetails, ProviderError> {
        let playlist = self
            .playlists
            .iter()
            .find(|item| item.uri == uri)
            .ok_or_else(|| ProviderError::InvalidRequest("unknown mock playlist".into()))?;
        let mut tracks = page(&self.tracks, request);
        for (index, track) in tracks.items.iter_mut().enumerate() {
            track.playlist_entry_id =
                Some(format!("mock-entry-{}", request.offset as usize + index));
        }
        Ok(PlaylistDetails {
            owner: None,
            collaborative: None,
            uri: playlist.uri.clone(),
            name: playlist.name.clone(),
            owner_name: Some("Lokaler Mock-Provider".into()),
            description: Some("Lokale Testplaylist".into()),
            cover_uri: playlist.cover_uri.clone(),
            can_modify: Some(true),
            tracks: tracks.items,
            offset: tracks.offset,
            limit: tracks.limit,
            total: tracks.total,
            has_more: tracks.has_more,
        })
    }

    async fn add_track_to_playlist(
        &self,
        playlist_uri: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        if !self.playlists.iter().any(|item| item.uri == playlist_uri) {
            return Err(ProviderError::InvalidRequest(
                "unknown mock playlist".into(),
            ));
        }
        if !self.tracks.iter().any(|item| item.uri == track_uri) {
            return Err(ProviderError::InvalidRequest("unknown mock track".into()));
        }
        Ok(())
    }

    async fn remove_track_from_playlist(
        &self,
        playlist_uri: &str,
        playlist_entry_id: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        if !self.playlists.iter().any(|item| item.uri == playlist_uri) {
            return Err(ProviderError::InvalidRequest(
                "unknown mock playlist".into(),
            ));
        }
        if playlist_entry_id.trim().is_empty() {
            return Err(ProviderError::InvalidRequest(
                "missing mock playlist entry".into(),
            ));
        }
        if !self.tracks.iter().any(|item| item.uri == track_uri) {
            return Err(ProviderError::InvalidRequest("unknown mock track".into()));
        }
        Ok(())
    }

    async fn get_album(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<AlbumDetails, ProviderError> {
        let album = self
            .albums
            .iter()
            .find(|item| item.uri == uri)
            .ok_or_else(|| ProviderError::InvalidRequest("unknown mock album".into()))?;
        let matching: Vec<_> = self
            .tracks
            .iter()
            .filter(|track| track.album_uri.as_deref() == Some(uri))
            .cloned()
            .collect();
        let tracks = page(&matching, request);
        Ok(AlbumDetails {
            uri: album.uri.clone(),
            name: album.name.clone(),
            artists: vec![EntitySummary {
                uri: "mock:artist:nocturne-atlas".into(),
                name: album.subtitle.clone().unwrap_or_else(|| "Künstler".into()),
                subtitle: Some("Künstler".into()),
                cover_uri: None,
                can_modify: None,
                library: None,
            }],
            year: Some(2026),
            cover_uri: album.cover_uri.clone(),
            tracks: tracks.items,
            offset: tracks.offset,
            limit: tracks.limit,
            total: tracks.total,
            has_more: tracks.has_more,
        })
    }

    async fn get_artist(&self, uri: &str) -> Result<ArtistDetails, ProviderError> {
        let artist = self
            .artists
            .iter()
            .find(|item| item.uri == uri)
            .ok_or_else(|| ProviderError::InvalidRequest("unknown mock artist".into()))?;
        let popular_tracks = self
            .tracks
            .iter()
            .filter(|track| {
                track
                    .creators
                    .iter()
                    .any(|creator| creator.uri.as_deref() == Some(uri))
            })
            .cloned()
            .collect();
        Ok(ArtistDetails {
            uri: artist.uri.clone(),
            name: artist.name.clone(),
            image_uri: artist.cover_uri.clone(),
            popular_tracks,
            albums: self
                .albums
                .iter()
                .map(|album| ArtistRelease {
                    uri: album.uri.clone(),
                    name: album.name.clone(),
                    subtitle: album.subtitle.clone(),
                    cover_uri: album.cover_uri.clone(),
                    release_date: None,
                    year: None,
                    release_type: ArtistReleaseType::Album,
                    artists: vec![artist.clone()],
                })
                .collect(),
            singles: Vec::new(),
            compilations: Vec::new(),
            discography_status: None,
        })
    }
}

#[async_trait]
impl QueueProvider for MockSpotifyProvider {
    async fn get_queue(&self) -> Result<QueueState, ProviderError> {
        let state = self.state.lock().await;
        Ok(QueueState {
            current_item: state.playback.current_item.clone(),
            items: state.queue.clone(),
            revision: state.revision,
            total_items: None,
        })
    }

    async fn add_to_queue(&self, uri: &str) -> Result<(), ProviderError> {
        let item = self
            .tracks
            .iter()
            .find(|item| item.uri == uri)
            .cloned()
            .ok_or_else(|| ProviderError::InvalidRequest("unknown mock URI".into()))?;
        let mut state = self.state.lock().await;
        let uid = format!("mock-queue-{}", state.revision.saturating_add(1));
        state.queue.push(QueueItem {
            item,
            uid: Some(uid),
        });
        state.revision += 1;
        Ok(())
    }

    async fn remove_from_queue(&self, uri: &str) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        if let Some(index) = state.queue.iter().position(|entry| entry.item.uri == uri) {
            state.queue.remove(index);
            state.revision += 1;
        }
        Ok(())
    }

    async fn clear_queue(&self) -> Result<(), ProviderError> {
        let mut state = self.state.lock().await;
        state.queue.clear();
        state.revision += 1;
        Ok(())
    }

    async fn reorder_queue(
        &self,
        request: QueueReorderRequest,
    ) -> Result<QueueState, ProviderError> {
        let mut state = self.state.lock().await;
        if state.revision != request.expected_revision {
            return Err(ProviderError::ActionRejected {
                message: "queue changed before reorder".into(),
                retryable: true,
            });
        }

        let moved_index = state
            .queue
            .iter()
            .position(|entry| queue_item_matches(entry, &request.moved))
            .ok_or_else(|| ProviderError::InvalidRequest("moved queue item is missing".into()))?;
        let anchor_index = state
            .queue
            .iter()
            .position(|entry| queue_item_matches(entry, &request.anchor))
            .ok_or_else(|| ProviderError::InvalidRequest("queue anchor is missing".into()))?;
        if moved_index == anchor_index {
            return Err(ProviderError::InvalidRequest(
                "moved queue item and anchor must differ".into(),
            ));
        }

        let moved = state.queue.remove(moved_index);
        let anchor_index = if moved_index < anchor_index {
            anchor_index.saturating_sub(1)
        } else {
            anchor_index
        };
        let insertion_index = match request.placement {
            QueuePlacement::Before => anchor_index,
            QueuePlacement::After => anchor_index.saturating_add(1),
        };

        state.queue.insert(insertion_index, moved);
        state.revision += 1;

        Ok(QueueState {
            current_item: state.playback.current_item.clone(),
            items: state.queue.clone(),
            revision: state.revision,
            total_items: None,
        })
    }
}

fn queue_item_matches(item: &QueueItem, reference: &QueueItemReference) -> bool {
    match reference.uid.as_deref() {
        Some(uid) => item.uid.as_deref() == Some(uid),
        None => item.item.uri == reference.uri,
    }
}

fn page<T: Clone>(items: &[T], request: PageRequest) -> Page<T> {
    let offset = usize::try_from(request.offset).unwrap_or(usize::MAX);
    let limit = usize::try_from(request.limit.clamp(1, 100)).unwrap_or(50);
    let selected: Vec<_> = items.iter().skip(offset).take(limit).cloned().collect();
    Page {
        items: selected,
        offset: request.offset,
        limit: request.limit,
        total: u32::try_from(items.len()).ok(),
        has_more: offset.saturating_add(limit) < items.len(),
    }
}

fn sample_tracks() -> Vec<MediaItem> {
    [
        (
            "mock:track:airborne",
            "Airborne",
            "Nocturne Atlas",
            "Glass Cities",
            244_000,
        ),
        (
            "mock:track:blue-hour",
            "Blue Hour",
            "Vela",
            "Soft Signals",
            216_000,
        ),
        (
            "mock:track:afterglow",
            "Afterglow Circuit",
            "Monolake Drive",
            "Night Geometry",
            268_000,
        ),
        (
            "mock:track:still-light",
            "Still Light",
            "Arden Field",
            "Still Light",
            198_000,
        ),
        (
            "mock:track:parallel",
            "Parallel Lines",
            "Nocturne Atlas",
            "Glass Cities",
            232_000,
        ),
        (
            "mock:track:halo",
            "Halo Static",
            "Vela",
            "Soft Signals",
            205_000,
        ),
    ]
    .into_iter()
    .map(|(uri, title, artist, album, duration)| MediaItem {
        uri: uri.into(),
        source: MediaSource::Spotify,
        item_type: MediaItemType::Track,
        title: title.into(),
        creators: vec![MediaCreator {
            name: artist.into(),
            uri: Some(format!(
                "mock:artist:{}",
                artist.to_lowercase().replace(' ', "-")
            )),
        }],
        album_name: Some(album.into()),
        album_uri: Some(format!(
            "mock:album:{}",
            album.to_lowercase().replace(' ', "-")
        )),
        duration_ms: Some(duration),
        play_count: None,
        cover_uri: None,
        canvas_url: None,
        added_at: None,
        playlist_entry_id: None,
        added_by: None,
        explicit: false,
        playable: true,
    })
    .collect()
}

fn sample_artists() -> Vec<EntitySummary> {
    ["Nocturne Atlas", "Vela", "Monolake Drive", "Arden Field"]
        .into_iter()
        .map(|name| EntitySummary {
            uri: format!("mock:artist:{}", name.to_lowercase().replace(' ', "-")),
            name: name.into(),
            subtitle: Some("Künstler".into()),
            cover_uri: None,
            can_modify: None,
            library: None,
        })
        .collect()
}

fn sample_albums() -> Vec<EntitySummary> {
    [
        ("Glass Cities", "Nocturne Atlas"),
        ("Soft Signals", "Vela"),
        ("Night Geometry", "Monolake Drive"),
        ("Still Light", "Arden Field"),
    ]
    .into_iter()
    .map(|(name, artist)| EntitySummary {
        uri: format!("mock:album:{}", name.to_lowercase().replace(' ', "-")),
        name: name.into(),
        subtitle: Some(artist.into()),
        cover_uri: None,
        can_modify: None,
        library: None,
    })
    .collect()
}

fn sample_playlists() -> Vec<EntitySummary> {
    [
        ("Night Drive", "24 Titel"),
        ("Quiet Focus", "41 Titel"),
        ("Neon Rain", "18 Titel"),
        ("Sunday Air", "32 Titel"),
    ]
    .into_iter()
    .map(|(name, subtitle)| EntitySummary {
        uri: format!("mock:playlist:{}", name.to_lowercase().replace(' ', "-")),
        name: name.into(),
        subtitle: Some(subtitle.into()),
        cover_uri: None,
        can_modify: Some(true),
        library: None,
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_playback_and_search_share_models() {
        let provider = MockSpotifyProvider::new();
        provider.pause().await.expect("pause");
        assert!(!provider.get_state().await.expect("state").is_playing);
        let result = provider
            .search(SearchRequest {
                query: "atlas".into(),
                offset: 0,
                limit: 20,
            })
            .await
            .expect("search");
        assert_eq!(result.tracks.len(), 2);
    }

    #[tokio::test]
    async fn explicit_shuffle_and_repeat_targets_are_independent() {
        let provider = MockSpotifyProvider::new();
        provider.set_repeat(RepeatMode::One).await.expect("repeat");
        provider.set_shuffle(true).await.expect("shuffle");
        let state = provider.get_state().await.expect("state");
        assert!(state.shuffle_enabled);
        assert_eq!(state.repeat_mode, RepeatMode::One);
    }

    #[tokio::test]
    async fn track_change_preserves_repeat_mode() {
        let provider = MockSpotifyProvider::new();
        provider.set_repeat(RepeatMode::All).await.expect("repeat");
        provider.next().await.expect("next");
        assert_eq!(
            provider.get_state().await.expect("state").repeat_mode,
            RepeatMode::All
        );
    }
}
