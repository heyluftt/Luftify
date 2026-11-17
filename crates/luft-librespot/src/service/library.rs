use std::time::Duration;

use chrono::Utc;
use luft_core::{
    AlbumDetails, ArtistDetails, EntitySummary, MediaItem, Page, PageRequest, PlaylistDetails,
    ProviderError, SearchRequest, SearchResult,
};

use crate::metadata::{is_placeholder_title, load_metadata_resilient};
use crate::queue::same_item_uri;

use super::{LibrespotService, METADATA_TIMEOUT, not_ready, notify_playback};

impl LibrespotService {
    pub async fn get_album(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<AlbumDetails, ProviderError> {
        self.ensure_ready().await?;
        let session = self
            .shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone())
            .ok_or_else(not_ready)?;
        crate::album::load_album_details(&session, uri, request).await
    }

    pub async fn get_artist(&self, uri: &str) -> Result<ArtistDetails, ProviderError> {
        self.ensure_ready().await?;
        let session = self
            .shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone())
            .ok_or_else(not_ready)?;
        crate::artist::load_artist_details(&session, uri).await
    }

    /// Names and pictures of up to 50 artists in one request.
    pub async fn get_artist_portraits(&self, uris: &[String]) -> Result<Vec<EntitySummary>, ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        Ok(crate::artist::load_artist_portraits(&session, uris).await)
    }

    /// Lossless, phase 0: whether FLAC files and their keys come for these songs
    /// (or a few remembered ones). Read-only, nothing is played.
    pub async fn probe_lossless(&self, uris: Vec<String>) -> Result<crate::LosslessProbe, ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        let mut uris: Vec<String> = uris.into_iter().filter(|uri| uri.starts_with("spotify:track:")).collect();
        for known in crate::metadata_batch::sample(crate::lossless_probe::MAX_TRACKS) {
            if uris.len() >= crate::lossless_probe::MAX_TRACKS { break; }
            if !uris.contains(&known) { uris.push(known); }
        }
        Ok(crate::lossless_probe::probe(&session, &uris).await)
    }

    pub async fn get_new_releases(
        &self,
        request: PageRequest,
    ) -> Result<Page<EntitySummary>, ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        crate::catalog::new_releases(&session, request).await
    }

    pub async fn get_playlist(
        &self,
        uri: &str,
        request: PageRequest,
    ) -> Result<PlaylistDetails, ProviderError> {
        self.wait_until_ready(Duration::from_secs(8)).await?;
        let session = self.session_clone().await?;
        crate::playlist::load_playlist_details(&session, uri, request, &self.shared.playlist_cache)
            .await
    }

    pub async fn seed_playlist_catalog_cache(&self, uri: &str, catalog: &[MediaItem]) -> usize {
        crate::metadata_batch::remember(catalog);
        self.shared.playlist_cache.seed_catalog(uri, catalog).await
    }

    /// Songs the app already stored (playlists, liked songs) become known at once,
    /// for every playlist, album, search and the queue. Needs no session.
    pub fn remember_tracks(&self, items: &[MediaItem]) {
        crate::metadata_batch::remember(items);
    }

    pub async fn repair_playlist_metadata(&self, catalog: &[MediaItem]) -> Vec<MediaItem> {
        if !catalog
            .iter()
            .any(|item| is_placeholder_title(&item.title, &item.uri))
        {
            return catalog.to_vec();
        }
        let Ok(session) = self.session_clone().await else {
            return catalog.to_vec();
        };
        crate::playlist::repair_placeholder_metadata(&session, catalog).await
    }

    pub async fn resolve_item_metadata(&self, uri: &str) -> Option<MediaItem> {
        let session = self.session_clone().await.ok()?;
        tokio::time::timeout(METADATA_TIMEOUT, load_metadata_resilient(&session, uri, 2))
            .await
            .ok()
            .flatten()
    }

    pub async fn get_lyrics(&self, uri: &str) -> Result<Option<crate::TrackLyrics>, ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        let lookup_key = format!("{}\0{uri}", session.username());
        if !self
            .shared
            .native_lyrics_misses
            .lock()
            .await
            .begin_lookup(&lookup_key)
        {
            return Ok(None);
        }

        let lyrics = crate::lyrics::load_track_lyrics(&session, uri).await;
        if lyrics.is_some() {
            self.shared
                .native_lyrics_misses
                .lock()
                .await
                .forget(&lookup_key);
        }
        Ok(lyrics)
    }

    pub async fn search(&self, request: SearchRequest) -> Result<SearchResult, ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        crate::catalog::search(&session, &request).await
    }

    pub async fn get_playlists(
        &self,
        request: PageRequest,
    ) -> Result<Page<EntitySummary>, ProviderError> {
        self.wait_until_ready(Duration::from_secs(8)).await?;
        let session = self.session_clone().await?;
        crate::catalog::playlists(&session, request).await
    }

    pub async fn get_liked_tracks(
        &self,
        request: PageRequest,
    ) -> Result<Page<MediaItem>, ProviderError> {
        self.wait_until_ready(Duration::from_secs(8)).await?;
        let session = self.session_clone().await?;
        crate::catalog::liked_tracks(&session, request).await
    }

    pub async fn liked_track_uris(&self) -> Result<Vec<String>, ProviderError> {
        self.wait_until_ready(Duration::from_secs(8)).await?;
        let session = self.session_clone().await?;
        crate::catalog::liked_track_uris(&session)
            .await
            .ok_or_else(|| ProviderError::ActionRejected {
                message: "Gespeicherte Titel sind gerade nicht abrufbar.".into(),
                retryable: true,
            })
    }

    /// Removes one queue row by its uid; falls back to the first URI match
    /// when the row is gone (e.g. the queue was rebuilt meanwhile).
    pub async fn remove_queue_entry(&self, uid: &str, uri: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        {
            let mut snapshot = self.shared.playback.write().await;
            if !snapshot.queue.remove_entry(uid, uri) {
                snapshot.queue.remove_uri(uri);
            }
        }
        notify_playback(&self.shared).await;
        Ok(())
    }

    pub async fn add_track_to_playlist(
        &self,
        playlist_uri: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        let result = crate::playlist_mutate::add_track(&session, playlist_uri, track_uri).await;
        if result.is_ok() {
            self.shared
                .playlist_cache
                .remember_added_track(
                    &session,
                    playlist_uri,
                    track_uri,
                    Some(Utc::now().to_rfc3339()),
                )
                .await;
        }
        result
    }

    pub async fn remove_track_from_playlist(
        &self,
        playlist_uri: &str,
        // Libre's remote delete is URI based and removes every occurrence;
        // the entry id only matters for the desktop engine.
        _playlist_entry_id: &str,
        track_uri: &str,
    ) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        let result = crate::playlist_mutate::remove_track(&session, playlist_uri, track_uri).await;
        if result.is_ok() {
            self.shared
                .playlist_cache
                .remember_removed_track(playlist_uri, track_uri)
                .await;
        }
        result
    }

    /// A new, empty playlist in the library; returns its URI.
    pub async fn create_playlist(&self, name: &str) -> Result<String, ProviderError> {
        self.ensure_ready().await?;
        crate::playlist_manage::create(&self.session_clone().await?, name).await
    }

    pub async fn rename_playlist(&self, uri: &str, name: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        crate::playlist_manage::rename(&self.session_clone().await?, uri, name).await
    }

    pub async fn set_playlist_collaborative(&self, uri: &str, collaborative: bool) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        crate::playlist_manage::set_collaborative(&self.session_clone().await?, uri, collaborative).await
    }

    pub async fn set_playlist_cover(&self, uri: &str, jpeg: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        crate::playlist_cover::set(&self.session_clone().await?, uri, jpeg).await?;
        self.shared.playlist_cache.expire_metadata(uri).await;
        Ok(())
    }

    /// Into the library (a friend's playlist) or out of it (deleting one's own).
    pub async fn set_playlist_followed(&self, uri: &str, followed: bool) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        if followed {
            crate::playlist_manage::follow(&session, uri).await
        } else {
            crate::playlist_manage::unfollow(&session, uri).await
        }
    }

    pub async fn set_track_saved(&self, uri: &str, saved: bool) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let session = self.session_clone().await?;
        if !crate::collection::set_saved(&session, uri, saved).await {
            return Err(ProviderError::ActionRejected {
                message: "Der Titel konnte nicht in der Bibliothek gespeichert werden.".into(),
                retryable: true,
            });
        }
        let mut snapshot = self.shared.playback.write().await;
        if snapshot
            .current_item
            .as_ref()
            .is_some_and(|item| same_item_uri(&item.uri, uri))
        {
            snapshot.is_saved = saved;
        }
        drop(snapshot);
        notify_playback(&self.shared).await;
        Ok(())
    }
}
