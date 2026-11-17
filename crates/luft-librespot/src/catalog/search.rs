//! Catalog search. Spotify's own GraphQL search (the one the web player
//! uses) answers with every kind plus a top hit; the Web API is a fallback
//! (it is often rate-limited for librespot's client id), and the search
//! context, which only lists tracks, is the last resort.

use std::time::Instant;

use http::Method;
use librespot::core::Session;
use luft_core::{EntitySummary, MediaItem, SearchRequest, SearchResult};
use serde_json::{Value, json};
use tracing::{debug, info, warn};

use crate::pathfinder;
use crate::queue::canonicalize_item_uri;
use crate::session_http;

use super::covers::{hydrate_missing_artist_covers, hydrate_missing_spotify_playlist_covers};
use super::{
    collect_entities_from, collect_media, entity_from_value, entity_kind, entity_uri, group, items,
    media_from_value, unique_by_uri, unwrap_node, urlencoding_lite,
};

pub(crate) async fn search(
    session: &Session,
    request: &SearchRequest,
) -> Result<SearchResult, luft_core::ProviderError> {
    let started = Instant::now();
    let (source, mut result) = if let Some(result) = pathfinder_search(session, request).await {
        ("pathfinder", result)
    } else if let Some(result) = web_search(session, request).await {
        ("web-api", result)
    } else if let Some(mut result) = context_search(session, request).await {
        fill_derived_search_entities(&request.query, &mut result);
        ("context", result)
    } else {
        warn!(
            adapter = "librespot",
            offset = request.offset,
            elapsed_ms = started.elapsed().as_millis(),
            "librespot search found no working source"
        );
        return Err(luft_core::ProviderError::ActionRejected {
            message: "Die Suche ist über Librespot gerade nicht erreichbar.".into(),
            retryable: true,
        });
    };
    let (artists, playlists) = (&mut result.artists, &mut result.playlists);
    tokio::join!(
        hydrate_missing_artist_covers(session, artists),
        hydrate_missing_spotify_playlist_covers(session, playlists),
    );
    let elapsed_ms = started.elapsed().as_millis();
    macro_rules! answered {
        ($level:ident) => {
            $level!(
                adapter = "librespot",
                source,
                offset = request.offset,
                tracks = result.tracks.len(),
                artists = result.artists.len(),
                albums = result.albums.len(),
                playlists = result.playlists.len(),
                elapsed_ms,
                "librespot search answered"
            )
        };
    }
    // Fallback answers are worth seeing in normal logs: they explain thin results.
    if source == "pathfinder" {
        answered!(debug);
    } else {
        answered!(info);
    }
    Ok(result)
}

async fn pathfinder_search(session: &Session, request: &SearchRequest) -> Option<SearchResult> {
    let variables = json!({
        "searchTerm": request.query,
        "offset": request.offset,
        "limit": request.limit.max(1),
        "numberOfTopResults": 5,
        "includeAudiobooks": false,
        "includeArtistHasConcertsField": false,
        "includePreReleases": true,
        "includeAlbumPreReleases": false,
        "includeAuthors": false,
        "includeEpisodeContentRatingsV2": false,
        "sectionFilters": ["GENERIC"],
    });
    let data = pathfinder::query(session, &pathfinder::SEARCH_DESKTOP, variables).await?;
    let result = search_result_from_value(request, &data);
    has_search_hits(&result).then_some(result)
}

async fn web_search(session: &Session, request: &SearchRequest) -> Option<SearchResult> {
    let query = urlencoding_lite(&request.query);
    let url = format!(
        "https://api.spotify.com/v1/search?q={query}&type=track,artist,album,playlist&limit={}&offset={}",
        request.limit.max(1),
        request.offset
    );
    let bytes = session_http::request(session, &Method::GET, &url, None).await?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    let result = search_result_from_value(request, &value);
    has_search_hits(&result).then_some(result)
}

async fn context_search(session: &Session, request: &SearchRequest) -> Option<SearchResult> {
    let query = request
        .query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("+");
    let context = session
        .spclient()
        .get_context(&format!("spotify:search:{query}"))
        .await
        .ok()?;
    let mut uris = Vec::new();
    for page in context.pages {
        for track in page.tracks {
            if let Some(uri) = track.uri
                && let Some(uri) = canonicalize_item_uri(&uri)
            {
                uris.push(uri);
            }
        }
    }
    let total = uris.len();
    let start = request.offset.min(total as u32) as usize;
    let end = (start + request.limit.max(1) as usize).min(total);
    let tracks = crate::metadata_batch::tracks_in_order(session, &uris[start..end]).await;
    Some(SearchResult {
        query: request.query.clone(),
        offset: request.offset,
        limit: request.limit,
        has_more: end < total,
        tracks,
        artists: Vec::new(),
        albums: Vec::new(),
        playlists: Vec::new(),
        top_result_uri: None,
        unavailable: Vec::new(),
    })
    .filter(has_search_hits)
}

fn search_result_from_value(request: &SearchRequest, value: &Value) -> SearchResult {
    let search = search_root(value);
    let track_group = group(search, &["tracks", "trackV2", "tracksV2"]);
    let artist_group = group(search, &["artists", "artistsV2", "artist"]);
    let album_group = group(search, &["albums", "albumsV2", "album"]);
    let playlist_group = group(search, &["playlists", "playlistsV2", "playlist"]);

    let mut tracks = collect_media(track_group);
    let mut artists = collect_entities_from(artist_group);
    let mut albums = collect_entities_from(album_group);
    let mut playlists = collect_entities_from(playlist_group);
    collect_top_results(
        search,
        &mut tracks,
        &mut artists,
        &mut albums,
        &mut playlists,
    );

    SearchResult {
        query: request.query.clone(),
        offset: request.offset,
        limit: request.limit,
        has_more: has_more_from_groups(
            request,
            &[track_group, artist_group, album_group, playlist_group],
        ),
        tracks: unique_by_uri(tracks),
        artists: unique_by_uri(artists),
        albums: unique_by_uri(albums),
        playlists: unique_by_uri(playlists),
        top_result_uri: (request.offset == 0)
            .then(|| top_result_uri(search))
            .flatten(),
        unavailable: Vec::new(),
    }
}

/// Spotify's best match, when it is a kind this player shows.
fn top_result_uri(search: &Value) -> Option<String> {
    let top = group(search, &["topResultsV2", "topResults", "topHit"])?;
    let first = items(top).into_iter().next().unwrap_or(top);
    let record = unwrap_node(first);
    matches!(
        entity_kind(record).as_deref(),
        Some("track" | "artist" | "album" | "playlist")
    )
    .then(|| entity_uri(record))
    .flatten()
}

fn search_root(value: &Value) -> &Value {
    let data = value.get("data").unwrap_or(value);
    data.get("searchV2")
        .or_else(|| data.get("search"))
        .or_else(|| data.get("results"))
        .unwrap_or(data)
}

fn collect_top_results(
    search: &Value,
    tracks: &mut Vec<MediaItem>,
    artists: &mut Vec<EntitySummary>,
    albums: &mut Vec<EntitySummary>,
    playlists: &mut Vec<EntitySummary>,
) {
    let Some(top) = group(search, &["topResultsV2", "topResults", "topHit"]) else {
        return;
    };
    let nested = items(top);
    if nested.is_empty() && top.is_object() {
        push_classified(top, tracks, artists, albums, playlists);
        return;
    }
    for value in nested {
        push_classified(value, tracks, artists, albums, playlists);
    }
}

fn push_classified(
    value: &Value,
    tracks: &mut Vec<MediaItem>,
    artists: &mut Vec<EntitySummary>,
    albums: &mut Vec<EntitySummary>,
    playlists: &mut Vec<EntitySummary>,
) {
    let record = unwrap_node(value);
    match entity_kind(record).as_deref() {
        Some("track") => {
            if let Some(track) = media_from_value(value) {
                tracks.push(track);
            }
        }
        Some("artist") => {
            if let Some(artist) = entity_from_value(value) {
                artists.push(artist);
            }
        }
        Some("album") => {
            if let Some(album) = entity_from_value(value) {
                albums.push(album);
            }
        }
        Some("playlist") => {
            if let Some(playlist) = entity_from_value(value) {
                playlists.push(playlist);
            }
        }
        _ => {}
    }
}

fn has_search_hits(result: &SearchResult) -> bool {
    !result.tracks.is_empty()
        || !result.artists.is_empty()
        || !result.albums.is_empty()
        || !result.playlists.is_empty()
}

fn has_more_from_groups(request: &SearchRequest, groups: &[Option<&Value>]) -> bool {
    groups.iter().flatten().any(|group| {
        group
            .get("total")
            .or_else(|| group.get("totalCount"))
            .and_then(Value::as_u64)
            .is_some_and(|total| request.offset.saturating_add(request.limit) < total as u32)
            || items(group).len() as u32 >= request.limit.max(1)
    })
}

fn derive_artists_from_tracks(query: &str, tracks: &[MediaItem]) -> Vec<EntitySummary> {
    let needle = query.trim().to_ascii_lowercase();
    let mut artists = Vec::new();
    for track in tracks {
        for creator in &track.creators {
            let Some(uri) = creator.uri.as_deref() else {
                continue;
            };
            if !uri.contains(":artist:") {
                continue;
            }
            if artists
                .iter()
                .any(|artist: &EntitySummary| artist.uri == uri)
            {
                continue;
            }
            artists.push(EntitySummary {
                uri: uri.to_string(),
                name: creator.name.clone(),
                subtitle: Some("Künstler".into()),
                cover_uri: None,
                can_modify: None,
                library: None,
            });
        }
    }
    if !needle.is_empty() {
        artists.sort_by(|left, right| {
            name_match_score(&right.name, &needle).cmp(&name_match_score(&left.name, &needle))
        });
    }
    artists
}

fn derive_albums_from_tracks(tracks: &[MediaItem]) -> Vec<EntitySummary> {
    let mut albums = Vec::new();
    for track in tracks {
        let (Some(uri), Some(name)) = (track.album_uri.as_deref(), track.album_name.as_deref())
        else {
            continue;
        };
        if !uri.contains(":album:") || albums.iter().any(|album: &EntitySummary| album.uri == uri) {
            continue;
        }
        let subtitle = (!track.creators.is_empty()).then(|| {
            track
                .creators
                .iter()
                .map(|creator| creator.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        });
        albums.push(EntitySummary {
            uri: uri.to_string(),
            name: name.to_string(),
            subtitle,
            cover_uri: track.cover_uri.clone(),
            can_modify: None,
            library: None,
        });
    }
    albums
}

fn fill_derived_search_entities(query: &str, result: &mut SearchResult) {
    if result.artists.is_empty() {
        result.artists = derive_artists_from_tracks(query, &result.tracks);
    }
    if result.albums.is_empty() {
        result.albums = derive_albums_from_tracks(&result.tracks);
    }
}

fn name_match_score(name: &str, needle: &str) -> u8 {
    let name = name.trim().to_ascii_lowercase();
    if name == needle {
        3
    } else if name.starts_with(needle) || needle.starts_with(&name) {
        2
    } else if name.contains(needle) || needle.contains(&name) {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use luft_core::{MediaCreator, MediaItemType, MediaSource};

    use super::*;

    fn request() -> SearchRequest {
        SearchRequest {
            query: "nightcall".into(),
            offset: 0,
            limit: 10,
        }
    }

    #[test]
    fn parses_web_search_payloads() {
        let result = search_result_from_value(
            &request(),
            &json!({
                "tracks": { "items": [{
                    "uri": "spotify:track:nightcall",
                    "name": "Nightcall",
                    "artists": [{ "name": "Kavinsky", "uri": "spotify:artist:k" }],
                    "duration_ms": 255000
                }], "total": 12 },
                "artists": { "items": [{ "uri": "spotify:artist:k", "name": "Kavinsky" }] },
                "albums": { "items": [] },
                "playlists": { "items": [] }
            }),
        );
        assert_eq!(result.tracks[0].title, "Nightcall");
        assert_eq!(result.artists[0].name, "Kavinsky");
        assert!(result.has_more);
    }

    #[test]
    fn parses_graphql_artists_from_profile_name() {
        let result = search_result_from_value(
            &request(),
            &json!({
                "data": {
                    "searchV2": {
                        "tracksV2": { "items": [{
                            "item": {
                                "data": {
                                    "__typename": "Track",
                                    "uri": "spotify:track:nightcall",
                                    "name": "Nightcall",
                                    "artists": { "items": [{
                                        "uri": "spotify:artist:k",
                                        "profile": { "name": "Kavinsky" }
                                    }] }
                                }
                            }
                        }] },
                        "artists": { "items": [{
                            "data": {
                                "__typename": "Artist",
                                "uri": "spotify:artist:k",
                                "profile": { "name": "Kavinsky" },
                                "visuals": {
                                    "avatarImage": {
                                        "sources": [{ "url": "https://i.scdn.co/image/k" }]
                                    }
                                }
                            }
                        }] },
                        "albumsV2": { "items": [] },
                        "playlists": { "items": [] }
                    }
                }
            }),
        );
        assert_eq!(result.tracks[0].title, "Nightcall");
        assert_eq!(result.tracks[0].creators[0].name, "Kavinsky");
        assert_eq!(result.artists[0].name, "Kavinsky");
        assert_eq!(result.artists[0].uri, "spotify:artist:k");
        assert_eq!(
            result.artists[0].cover_uri.as_deref(),
            Some("https://i.scdn.co/image/k")
        );
        assert_eq!(result.artists[0].subtitle.as_deref(), Some("Künstler"));
    }

    #[test]
    fn parses_artists_from_top_results_when_artists_key_is_missing() {
        let result = search_result_from_value(
            &request(),
            &json!({
                "data": {
                    "searchV2": {
                        "tracksV2": { "items": [] },
                        "topResultsV2": {
                            "itemsV2": [{
                                "item": {
                                    "data": {
                                        "__typename": "Artist",
                                        "uri": "spotify:artist:k",
                                        "profile": { "name": "Kavinsky" }
                                    }
                                }
                            }]
                        }
                    }
                }
            }),
        );
        assert_eq!(result.artists.len(), 1);
        assert_eq!(result.artists[0].name, "Kavinsky");
        assert!(result.tracks.is_empty());
    }

    #[test]
    fn parses_the_web_players_search_with_its_top_hit() {
        let wrap = |kind: &str, data: Value| json!({ "__typename": format!("{kind}ResponseWrapper"), "data": data });
        let result = search_result_from_value(
            &request(),
            &json!({
                "searchV2": {
                    "topResultsV2": { "itemsV2": [{
                        "item": wrap("Artist", json!({ "__typename": "Artist", "uri": "spotify:artist:k", "profile": { "name": "Kavinsky" } }))
                    }] },
                    "tracksV2": { "totalCount": 40, "items": [{
                        "item": wrap("Track", json!({
                            "__typename": "Track",
                            "uri": "spotify:track:nightcall",
                            "name": "Nightcall",
                            "contentRating": { "label": "EXPLICIT" },
                            "playability": { "playable": false },
                            "duration": { "totalMilliseconds": 258000 },
                            "artists": { "items": [{ "uri": "spotify:artist:k", "profile": { "name": "Kavinsky" } }] }
                        }))
                    }] },
                    "albumsV2": { "items": [wrap("Album", json!({
                        "__typename": "Album", "uri": "spotify:album:o", "name": "OutRun",
                        "artists": { "items": [{ "profile": { "name": "Kavinsky" } }] }
                    }))] },
                    "playlists": { "items": [wrap("Playlist", json!({
                        "__typename": "Playlist", "uri": "spotify:playlist:p", "name": "Drive",
                        "ownerV2": { "data": { "name": "Spotify" } },
                        "images": { "items": [{ "sources": [{ "url": "https://i.scdn.co/image/drive" }] }] }
                    }))] }
                }
            }),
        );
        assert_eq!(result.top_result_uri.as_deref(), Some("spotify:artist:k"));
        assert_eq!(result.artists[0].name, "Kavinsky");
        assert!(result.tracks[0].explicit);
        assert!(!result.tracks[0].playable);
        assert_eq!(result.tracks[0].duration_ms, Some(258_000));
        assert_eq!(result.albums[0].subtitle.as_deref(), Some("Kavinsky"));
        assert_eq!(
            result.playlists[0].cover_uri.as_deref(),
            Some("https://i.scdn.co/image/drive")
        );
        assert!(result.has_more);
    }

    #[test]
    fn does_not_treat_the_whole_search_object_as_artists() {
        let result = search_result_from_value(
            &request(),
            &json!({
                "tracks": { "items": [{
                    "uri": "spotify:track:nightcall",
                    "name": "Nightcall",
                    "artists": [{ "name": "Kavinsky", "uri": "spotify:artist:k" }]
                }] }
            }),
        );
        assert_eq!(result.tracks.len(), 1);
        assert!(result.artists.is_empty());
    }

    #[test]
    fn derives_matching_artists_from_track_creators() {
        let tracks = vec![MediaItem {
            uri: "spotify:track:nightcall".into(),
            source: MediaSource::Spotify,
            item_type: MediaItemType::Track,
            title: "Nightcall".into(),
            creators: vec![
                MediaCreator {
                    name: "Kavinsky".into(),
                    uri: Some("spotify:artist:k".into()),
                },
                MediaCreator {
                    name: "Lovefoxxx".into(),
                    uri: Some("spotify:artist:l".into()),
                },
            ],
            album_name: None,
            album_uri: None,
            duration_ms: None,
            play_count: None,
            cover_uri: None,
            canvas_url: None,
            added_at: None,
            playlist_entry_id: None,
            added_by: None,
            explicit: false,
            playable: true,
        }];
        let artists = derive_artists_from_tracks("kavinsky", &tracks);
        assert_eq!(artists[0].uri, "spotify:artist:k");
        assert_eq!(artists[0].name, "Kavinsky");
        assert_eq!(artists.len(), 2);
    }
}
