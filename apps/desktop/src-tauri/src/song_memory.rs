//! After start, songs from stored playlists and liked songs become known to
//! the engine, so playlists, albums, search and the queue rarely wait for
//! Spotify. Existing users profit at once; nothing is downloaded here.
use std::{sync::Arc, time::Duration};

use luft_core::{MediaItem, Page, PlaylistDetails};
use luft_infrastructure::DatabaseHandle;
use luft_librespot::LibrespotService;
use tracing::{info, warn};

/// The window and the first playback come first.
const START_DELAY: Duration = Duration::from_secs(4);
/// Newest playlists first; a few thousand songs each at most.
const MAX_PLAYLISTS: i64 = 120;
const MAX_LIKED_PAGES: i64 = 200;

pub fn spawn(database: DatabaseHandle, librespot: Arc<LibrespotService>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(START_DELAY).await;
        let started = std::time::Instant::now();
        let database = match database.get().await {
            Ok(database) => database,
            Err(error) => {
                warn!(phase = "song-memory", error = %error, "stored songs were not read");
                return;
            }
        };
        let playlists: Vec<PlaylistDetails> = database.cached_by_prefix("spotify.playlist.snapshot.", MAX_PLAYLISTS).await.unwrap_or_default();
        let liked: Vec<Page<MediaItem>> = database.cached_by_prefix("spotify.liked-tracks.", MAX_LIKED_PAGES).await.unwrap_or_default();
        let mut songs = 0usize;
        for playlist in &playlists {
            librespot.remember_tracks(&playlist.tracks);
            songs += playlist.tracks.len();
        }
        for page in &liked {
            librespot.remember_tracks(&page.items);
            songs += page.items.len();
        }
        info!(
            phase = "song-memory",
            playlists = playlists.len(),
            liked_pages = liked.len(),
            songs,
            duration_ms = started.elapsed().as_millis(),
            "stored songs known to the engine"
        );
    });
}
