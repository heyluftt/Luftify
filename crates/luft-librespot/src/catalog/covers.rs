use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use librespot::{
    core::{Session, SpotifyUri},
    metadata::{Artist, Metadata},
};
use luft_core::EntitySummary;
use tokio::task::JoinSet;
use tracing::debug;

use crate::metadata::{cover_from_images, normalize_cover_url};

const SEARCH_ARTIST_COVER_LIMIT: usize = 12;
const SEARCH_ARTIST_COVER_CONCURRENCY: usize = 8;
const SEARCH_ARTIST_COVER_TIMEOUT: Duration = Duration::from_secs(3);
const SEARCH_SPOTIFY_PLAYLIST_COVER_LIMIT: usize = 12;
const SEARCH_SPOTIFY_PLAYLIST_COVER_CONCURRENCY: usize = 8;
const SEARCH_SPOTIFY_PLAYLIST_COVER_TIMEOUT: Duration = Duration::from_secs(3);
const PLAYLIST_FALLBACK_COVER_LIMIT: usize = 12;
const PLAYLIST_FALLBACK_COVER_CONCURRENCY: usize = 3;
const PLAYLIST_FALLBACK_COVER_TIMEOUT: Duration = Duration::from_secs(4);
/// Covers found for search results, per artist or playlist. Typing "pa",
/// "pau", "paula" finds the same artists; they are looked up once.
const KNOWN_COVERS_MAX: usize = 4_000;
static KNOWN_COVERS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);

fn fill_known_covers(entries: &mut [EntitySummary]) {
    let Ok(known) = KNOWN_COVERS.lock() else { return };
    for entry in entries.iter_mut().filter(|entry| entry.cover_uri.is_none()) {
        entry.cover_uri = known.get(&entry.uri).cloned();
    }
}

fn remember_cover(uri: &str, cover: &str) {
    if let Ok(mut known) = KNOWN_COVERS.lock() {
        if known.len() >= KNOWN_COVERS_MAX {
            known.clear();
        }
        known.insert(uri.to_owned(), cover.to_owned());
    }
}

pub(super) async fn hydrate_missing_playlist_covers(
    session: &Session,
    playlists: &mut [EntitySummary],
) {
    promote_normalized_playlist_covers(playlists);
    let candidates = playlist_fallback_cover_candidates(playlists);
    if candidates.is_empty() {
        return;
    }

    let attempted = candidates.len();
    let mut pending = candidates.into_iter();
    let mut lookups = JoinSet::new();
    for _ in 0..PLAYLIST_FALLBACK_COVER_CONCURRENCY {
        let Some(candidate) = pending.next() else {
            break;
        };
        spawn_playlist_cover_lookup(&mut lookups, session, candidate);
    }

    let mut resolved = 0_usize;
    while let Some(outcome) = lookups.join_next().await {
        if let Ok(Some((index, cover_uri))) = outcome
            && let Some(playlist) = playlists.get_mut(index)
        {
            playlist.cover_uri = Some(cover_uri);
            resolved += 1;
        }
        if let Some(candidate) = pending.next() {
            spawn_playlist_cover_lookup(&mut lookups, session, candidate);
        }
    }

    debug!(
        adapter = "librespot",
        phase = "library-playlist-fallback-covers",
        attempted,
        resolved,
        "missing playlist covers hydrated from their first available track"
    );
}

fn spawn_playlist_cover_lookup(
    lookups: &mut JoinSet<Option<(usize, String)>>,
    session: &Session,
    candidate: (usize, String),
) {
    let session = session.clone();
    lookups.spawn(async move {
        let (index, uri) = candidate;
        let cover_uri = tokio::time::timeout(
            PLAYLIST_FALLBACK_COVER_TIMEOUT,
            crate::playlist::playlist_fallback_cover(&session, &uri),
        )
        .await
        .ok()??;
        Some((index, cover_uri))
    });
}

pub(super) async fn hydrate_missing_spotify_playlist_covers(
    session: &Session,
    playlists: &mut [EntitySummary],
) {
    promote_normalized_playlist_covers(playlists);
    fill_known_covers(playlists);
    let candidates = spotify_playlist_cover_candidates(playlists);
    if candidates.is_empty() {
        return;
    }

    let attempted = candidates.len();
    let mut pending = candidates.into_iter();
    let mut lookups = JoinSet::new();
    for _ in 0..SEARCH_SPOTIFY_PLAYLIST_COVER_CONCURRENCY {
        let Some(candidate) = pending.next() else {
            break;
        };
        spawn_spotify_playlist_cover_lookup(&mut lookups, session, candidate);
    }

    let mut resolved = 0_usize;
    while let Some(outcome) = lookups.join_next().await {
        if let Ok(Some((index, cover_uri))) = outcome
            && let Some(playlist) = playlists.get_mut(index)
        {
            remember_cover(&playlist.uri, &cover_uri);
            playlist.cover_uri = Some(cover_uri);
            resolved += 1;
        }
        if let Some(candidate) = pending.next() {
            spawn_spotify_playlist_cover_lookup(&mut lookups, session, candidate);
        }
    }

    debug!(
        adapter = "librespot",
        phase = "search-spotify-playlist-covers",
        attempted,
        resolved,
        "Spotify playlist covers hydrated from playlist metadata"
    );
}

fn playlist_fallback_cover_candidates(playlists: &[EntitySummary]) -> Vec<(usize, String)> {
    playlists
        .iter()
        .enumerate()
        .filter(|(_, playlist)| playlist_needs_https_cover(playlist))
        .take(PLAYLIST_FALLBACK_COVER_LIMIT)
        .map(|(index, playlist)| (index, playlist.uri.clone()))
        .collect()
}

fn spotify_playlist_cover_candidates(playlists: &[EntitySummary]) -> Vec<(usize, String)> {
    playlists
        .iter()
        .enumerate()
        .filter(|(_, playlist)| {
            playlist_needs_https_cover(playlist)
                && playlist
                    .subtitle
                    .as_deref()
                    .is_some_and(|owner| owner.eq_ignore_ascii_case("spotify"))
        })
        .take(SEARCH_SPOTIFY_PLAYLIST_COVER_LIMIT)
        .map(|(index, playlist)| (index, playlist.uri.clone()))
        .collect()
}

fn playlist_needs_https_cover(playlist: &EntitySummary) -> bool {
    playlist.uri.contains(":playlist:") && !has_https_cover(playlist.cover_uri.as_deref())
}

fn has_https_cover(cover_uri: Option<&str>) -> bool {
    cover_uri.is_some_and(|url| url.starts_with("https://"))
}

fn promote_normalized_playlist_covers(playlists: &mut [EntitySummary]) {
    for playlist in playlists
        .iter_mut()
        .filter(|playlist| playlist.uri.contains(":playlist:"))
    {
        if has_https_cover(playlist.cover_uri.as_deref()) {
            continue;
        }
        if let Some(cover) = playlist.cover_uri.as_deref().and_then(normalize_cover_url) {
            playlist.cover_uri = Some(cover);
        }
    }
}

fn spawn_spotify_playlist_cover_lookup(
    lookups: &mut JoinSet<Option<(usize, String)>>,
    session: &Session,
    candidate: (usize, String),
) {
    let session = session.clone();
    lookups.spawn(async move {
        let (index, uri) = candidate;
        let cover_uri = tokio::time::timeout(
            SEARCH_SPOTIFY_PLAYLIST_COVER_TIMEOUT,
            crate::playlist::playlist_metadata_cover(&session, &uri),
        )
        .await
        .ok()??;
        Some((index, cover_uri))
    });
}

pub(super) async fn hydrate_missing_artist_covers(
    session: &Session,
    artists: &mut [EntitySummary],
) {
    fill_known_covers(artists);
    let candidates = artists
        .iter()
        .enumerate()
        .filter(|(_, artist)| artist.cover_uri.is_none() && artist.uri.contains(":artist:"))
        .take(SEARCH_ARTIST_COVER_LIMIT)
        .map(|(index, artist)| (index, artist.uri.clone()))
        .collect::<Vec<_>>();
    let mut pending = candidates.into_iter();
    let mut lookups = JoinSet::new();
    for _ in 0..SEARCH_ARTIST_COVER_CONCURRENCY {
        let Some(candidate) = pending.next() else {
            break;
        };
        spawn_artist_cover_lookup(&mut lookups, session, candidate);
    }

    let mut resolved = 0_usize;
    while let Some(outcome) = lookups.join_next().await {
        if let Ok(Some((index, cover_uri))) = outcome
            && let Some(artist) = artists.get_mut(index)
        {
            remember_cover(&artist.uri, &cover_uri);
            artist.cover_uri = Some(cover_uri);
            resolved += 1;
        }
        if let Some(candidate) = pending.next() {
            spawn_artist_cover_lookup(&mut lookups, session, candidate);
        }
    }
    debug!(
        adapter = "librespot",
        phase = "search-artist-covers",
        artists = artists.len(),
        resolved,
        "librespot search artist covers hydrated"
    );
}

fn spawn_artist_cover_lookup(
    lookups: &mut JoinSet<Option<(usize, String)>>,
    session: &Session,
    candidate: (usize, String),
) {
    let session = session.clone();
    lookups.spawn(async move {
        let (index, uri) = candidate;
        let parsed = SpotifyUri::from_uri(&uri).ok()?;
        let artist =
            tokio::time::timeout(SEARCH_ARTIST_COVER_TIMEOUT, Artist::get(&session, &parsed))
                .await
                .ok()?
                .ok()?;
        let cover_uri = cover_from_images(&artist.portrait_group)
            .or_else(|| cover_from_images(&artist.portraits))?;
        Some((index, cover_uri))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_only_missing_spotify_playlist_covers_for_metadata_hydration() {
        let playlists = vec![
            EntitySummary {
                uri: "spotify:playlist:spotify-mix".into(),
                name: "Chill Mix".into(),
                subtitle: Some("Spotify".into()),
                cover_uri: None,
                can_modify: None,
                library: None,
            },
            EntitySummary {
                uri: "spotify:playlist:listener-mix".into(),
                name: "Listener Mix".into(),
                subtitle: Some("Sam".into()),
                cover_uri: None,
                can_modify: None,
                library: None,
            },
            EntitySummary {
                uri: "spotify:playlist:covered-spotify-mix".into(),
                name: "Covered Mix".into(),
                subtitle: Some("Spotify".into()),
                cover_uri: Some("https://i.scdn.co/image/covered".into()),
                can_modify: None,
                library: None,
            },
        ];

        assert_eq!(
            spotify_playlist_cover_candidates(&playlists),
            vec![(0, "spotify:playlist:spotify-mix".into())]
        );
    }

    #[test]
    fn promotes_mosaic_uris_and_only_fetches_covers_that_are_still_missing() {
        let mut playlists = vec![
            EntitySummary {
                uri: "spotify:playlist:night".into(),
                name: "Night".into(),
                subtitle: Some("Playlist".into()),
                cover_uri: Some("spotify:mosaic:aabbccdd".into()),
                can_modify: None,
                library: None,
            },
            EntitySummary {
                uri: "spotify:playlist:broken".into(),
                name: "Broken".into(),
                subtitle: Some("Playlist".into()),
                cover_uri: Some("spotify:playlist:broken".into()),
                can_modify: None,
                library: None,
            },
            EntitySummary {
                uri: "spotify:playlist:day".into(),
                name: "Day".into(),
                subtitle: Some("Playlist".into()),
                cover_uri: Some("https://i.scdn.co/image/day".into()),
                can_modify: None,
                library: None,
            },
            EntitySummary {
                uri: "spotify:playlist:empty".into(),
                name: "Empty".into(),
                subtitle: Some("Playlist".into()),
                cover_uri: None,
                can_modify: None,
                library: None,
            },
        ];

        promote_normalized_playlist_covers(&mut playlists);
        assert_eq!(
            playlists[0].cover_uri.as_deref(),
            Some("https://mosaic.scdn.co/300/aabbccdd")
        );
        assert_eq!(
            playlist_fallback_cover_candidates(&playlists),
            vec![
                (1, "spotify:playlist:broken".into()),
                (3, "spotify:playlist:empty".into()),
            ]
        );
    }
}
