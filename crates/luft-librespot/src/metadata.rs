use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use librespot::{
    core::{Session, SpotifyUri},
    metadata::{
        Episode, Metadata, Track,
        audio::{AudioItem, UniqueFields},
        image::Images,
    },
};
use luft_core::{MediaCreator, MediaItem, MediaItemType, MediaSource};
use std::time::Duration;

pub(crate) const LOADING_TITLE: &str = "Titel wird geladen…";
const UNKNOWN_TITLE: &str = "Unbekannter Titel";
const PREFERRED_COVER_WIDTH: i32 = 300;

#[derive(Debug, Clone)]
pub(crate) struct DisplayMetadata {
    pub title: String,
    pub creators: Vec<(String, Option<String>)>,
    pub album_name: Option<String>,
    pub album_uri: Option<String>,
    pub cover_uri: Option<String>,
    pub duration_ms: Option<u64>,
    pub explicit: bool,
    pub item_type: MediaItemType,
}

pub(crate) fn loading_item(uri: &str) -> MediaItem {
    item_from_display(
        uri,
        DisplayMetadata {
            title: LOADING_TITLE.to_string(),
            creators: Vec::new(),
            album_name: None,
            album_uri: None,
            cover_uri: None,
            duration_ms: None,
            explicit: false,
            item_type: item_type_from_uri(uri),
        },
    )
}

pub(crate) fn item_from_display(uri: &str, metadata: DisplayMetadata) -> MediaItem {
    sanitize_item(MediaItem {
        uri: uri.to_string(),
        source: MediaSource::Spotify,
        item_type: metadata.item_type,
        title: metadata.title,
        creators: metadata
            .creators
            .into_iter()
            .filter_map(|(name, artist_uri)| {
                let name = name.trim();
                if name.is_empty() {
                    None
                } else {
                    Some(MediaCreator {
                        name: name.to_string(),
                        uri: artist_uri.and_then(|value| nonempty(&value)),
                    })
                }
            })
            .collect(),
        album_name: metadata.album_name.and_then(|name| nonempty(&name)),
        album_uri: metadata.album_uri.and_then(|value| nonempty(&value)),
        duration_ms: metadata.duration_ms.filter(|ms| *ms > 0),
        play_count: None,
        cover_uri: metadata.cover_uri.and_then(|url| normalize_cover_url(&url)),
        canvas_url: None,
        added_at: None,
        playlist_entry_id: None,
        added_by: None,
        explicit: metadata.explicit,
        playable: true,
    })
}

pub(crate) fn item_from_audio_item(audio: &AudioItem) -> MediaItem {
    let cover_uri = pick_cover_url(
        audio
            .covers
            .iter()
            .map(|cover| (cover.width, cover.url.clone())),
    );
    let (creators, album_name, item_type) = match &audio.unique_fields {
        UniqueFields::Track { artists, album, .. } => (
            artists
                .iter()
                .filter_map(|artist| named_creator(&artist.name, artist.id.to_uri().ok()))
                .collect(),
            nonempty(album),
            MediaItemType::Track,
        ),
        UniqueFields::Local { artists, album, .. } => (
            artists
                .as_deref()
                .and_then(nonempty)
                .map(|name| vec![(name, None)])
                .unwrap_or_default(),
            album.as_deref().and_then(nonempty),
            MediaItemType::LocalTrack,
        ),
        UniqueFields::Episode { show_name, .. } => (
            nonempty(show_name)
                .map(|name| vec![(name, None)])
                .unwrap_or_default(),
            nonempty(show_name),
            MediaItemType::Episode,
        ),
    };

    item_from_display(
        &audio.uri,
        DisplayMetadata {
            title: audio.name.clone(),
            creators,
            album_name,
            album_uri: None,
            cover_uri,
            duration_ms: Some(u64::from(audio.duration_ms)).filter(|ms| *ms > 0),
            explicit: audio.is_explicit,
            item_type,
        },
    )
}

pub(crate) fn item_from_track(uri: &str, track: &Track) -> MediaItem {
    item_from_display(
        uri,
        DisplayMetadata {
            title: track.name.clone(),
            creators: track_creators(track),
            album_name: nonempty(&track.album.name),
            album_uri: track.album.id.to_uri().ok(),
            cover_uri: cover_from_images(&track.album.covers),
            duration_ms: u64::try_from(track.duration).ok().filter(|ms| *ms > 0),
            explicit: track.is_explicit,
            item_type: MediaItemType::Track,
        },
    )
}

pub(crate) fn item_from_episode(uri: &str, episode: &Episode) -> MediaItem {
    item_from_display(
        uri,
        DisplayMetadata {
            title: episode.name.clone(),
            creators: nonempty(&episode.show_name)
                .map(|name| vec![(name, None)])
                .unwrap_or_default(),
            album_name: nonempty(&episode.show_name),
            album_uri: None,
            cover_uri: cover_from_images(&episode.covers),
            duration_ms: u64::try_from(episode.duration).ok().filter(|ms| *ms > 0),
            explicit: episode.is_explicit,
            item_type: MediaItemType::Episode,
        },
    )
}

pub(crate) async fn load_metadata(session: &Session, uri: &str) -> Option<MediaItem> {
    // Songs already known this session (from any playlist, album or search) need no request.
    if let Some(item) = crate::metadata_batch::known(uri) {
        return Some(item);
    }
    let parsed = SpotifyUri::from_uri(uri).ok()?;
    match parsed {
        SpotifyUri::Track { .. } => {
            let track = Track::get(session, &parsed).await.ok()?;
            let item = item_from_track(uri, &track);
            crate::metadata_batch::remember([&item]);
            Some(item)
        }
        SpotifyUri::Episode { .. } => {
            let episode = Episode::get(session, &parsed).await.ok()?;
            Some(item_from_episode(uri, &episode))
        }
        SpotifyUri::Unknown { ref id, .. } if id.len() == 22 => {
            let track_uri = format!("spotify:track:{id}");
            let parsed = SpotifyUri::from_uri(&track_uri).ok()?;
            let track = Track::get(session, &parsed).await.ok()?;
            Some(item_from_track(&track_uri, &track))
        }
        _ => None,
    }
}

pub(crate) async fn load_metadata_resilient(
    session: &Session,
    uri: &str,
    attempts: usize,
) -> Option<MediaItem> {
    let attempts = attempts.max(1);
    for attempt in 0..attempts {
        if let Some(item) = load_metadata(session, uri).await {
            return Some(item);
        }
        if attempt + 1 < attempts {
            let backoff_ms = 140_u64.saturating_mul(1_u64 << attempt.min(3));
            let jitter_ms = uri
                .bytes()
                .fold(0_u64, |total, byte| total.wrapping_add(u64::from(byte)))
                % 83;
            tokio::time::sleep(Duration::from_millis(backoff_ms + jitter_ms)).await;
        }
    }
    None
}

pub(crate) fn merge_media_items(existing: Option<&MediaItem>, incoming: MediaItem) -> MediaItem {
    let incoming = sanitize_item(incoming);
    let Some(previous) = existing.filter(|item| item.uri == incoming.uri) else {
        return incoming;
    };

    MediaItem {
        title: prefer_title(&previous.title, &incoming.title, &incoming.uri),
        creators: if incoming.creators.is_empty() {
            previous.creators.clone()
        } else {
            incoming.creators
        },
        album_name: incoming.album_name.or_else(|| previous.album_name.clone()),
        album_uri: incoming.album_uri.or_else(|| previous.album_uri.clone()),
        duration_ms: incoming
            .duration_ms
            .filter(|ms| *ms > 0)
            .or(previous.duration_ms),
        play_count: incoming.play_count.or(previous.play_count),
        cover_uri: incoming.cover_uri.or_else(|| previous.cover_uri.clone()),
        canvas_url: incoming.canvas_url.or_else(|| previous.canvas_url.clone()),
        added_at: incoming.added_at.or_else(|| previous.added_at.clone()),
        playlist_entry_id: incoming
            .playlist_entry_id
            .or_else(|| previous.playlist_entry_id.clone()),
        added_by: incoming.added_by.or_else(|| previous.added_by.clone()),
        explicit: incoming.explicit || previous.explicit,
        playable: incoming.playable,
        item_type: incoming.item_type,
        source: incoming.source,
        uri: incoming.uri,
    }
}

pub(crate) fn is_placeholder_title(title: &str, uri: &str) -> bool {
    let trimmed = title.trim();
    trimmed.is_empty()
        || trimmed == LOADING_TITLE
        || trimmed == UNKNOWN_TITLE
        || trimmed == uri
        || trimmed == uri_tail(uri)
        || looks_like_spotify_id(trimmed)
}

pub(crate) fn pick_cover_url<I>(covers: I) -> Option<String>
where
    I: IntoIterator<Item = (i32, String)>,
{
    let mut covers: Vec<(i32, String)> = covers
        .into_iter()
        .filter_map(|(width, url)| normalize_cover_url(&url).map(|url| (width, url)))
        .collect();
    if covers.is_empty() {
        return None;
    }
    covers.sort_by_key(|(width, _)| ((width - PREFERRED_COVER_WIDTH).abs(), -width));
    covers.into_iter().next().map(|(_, url)| url)
}

pub(crate) fn cover_from_images(images: &Images) -> Option<String> {
    pick_cover_url(images.iter().filter_map(|image| {
        let id = image.id.to_string();
        if id.is_empty() {
            None
        } else {
            Some((image.width, format!("https://i.scdn.co/image/{id}")))
        }
    }))
}

fn track_creators(track: &Track) -> Vec<(String, Option<String>)> {
    let from_artists = track
        .artists
        .iter()
        .filter_map(|artist| named_creator(&artist.name, artist.id.to_uri().ok()))
        .collect::<Vec<_>>();
    if !from_artists.is_empty() {
        return from_artists;
    }
    track
        .artists_with_role
        .iter()
        .filter_map(|artist| named_creator(&artist.name, artist.id.to_uri().ok()))
        .collect()
}

fn named_creator(name: &str, uri: Option<String>) -> Option<(String, Option<String>)> {
    nonempty(name).map(|name| (name, uri.and_then(|value| nonempty(&value))))
}

fn sanitize_item(mut item: MediaItem) -> MediaItem {
    item.title = sanitize_title(&item.title, &item.uri);
    item.creators
        .retain(|creator| !creator.name.trim().is_empty());
    item.album_name = item.album_name.and_then(|name| nonempty(&name));
    item.album_uri = item.album_uri.and_then(|uri| nonempty(&uri));
    item.cover_uri = item.cover_uri.and_then(|url| normalize_cover_url(&url));
    item
}

fn sanitize_title(title: &str, uri: &str) -> String {
    let trimmed = title.trim();
    if is_placeholder_title(trimmed, uri) {
        LOADING_TITLE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn prefer_title(previous: &str, incoming: &str, uri: &str) -> String {
    if !is_placeholder_title(incoming, uri) {
        incoming.trim().to_string()
    } else if !is_placeholder_title(previous, uri) {
        previous.trim().to_string()
    } else {
        LOADING_TITLE.to_string()
    }
}

pub(crate) fn normalize_cover_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(id) = trimmed.strip_prefix("spotify:image:") {
        let id = id.trim();
        if id.is_empty() {
            None
        } else {
            Some(format!("https://i.scdn.co/image/{id}"))
        }
    } else if let Some(id) = mosaic_image_id(trimmed) {
        Some(format!("https://mosaic.scdn.co/300/{id}"))
    } else if trimmed.starts_with("https://") {
        Some(trimmed.to_string())
    } else if is_hex_image_id(trimmed) {
        Some(format!("https://i.scdn.co/image/{trimmed}"))
    } else {
        None
    }
}

fn mosaic_image_id(value: &str) -> Option<String> {
    let payload = value.strip_prefix("spotify:mosaic:")?;
    let id: String = payload
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    (!id.is_empty()).then_some(id)
}

pub(crate) fn cover_from_picture_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        if let Some(url) = normalize_cover_url(text) {
            return Some(url);
        }
        let encoded = text.trim();
        for engine in [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD] {
            if let Ok(decoded) = engine.decode(encoded)
                && (16..=64).contains(&decoded.len())
            {
                return cover_from_raw_picture_bytes(&decoded);
            }
        }
    }
    cover_from_raw_picture_bytes(bytes)
}

fn cover_from_raw_picture_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.len() >= 16 {
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        return Some(format!("https://i.scdn.co/image/{hex}"));
    }
    None
}

fn is_hex_image_id(value: &str) -> bool {
    let len = value.len();
    (32..=40).contains(&len) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn item_type_from_uri(uri: &str) -> MediaItemType {
    if uri.starts_with("spotify:episode:") {
        MediaItemType::Episode
    } else if uri.starts_with("spotify:local:") {
        MediaItemType::LocalTrack
    } else {
        MediaItemType::Track
    }
}

fn uri_tail(uri: &str) -> &str {
    uri.rsplit(':').next().unwrap_or(uri)
}

/// Base62 IDs mix digits and both cases; a 22-letter single-word title
/// ("Weltuntergangsstimmung") must not be mistaken for one.
fn looks_like_spotify_id(value: &str) -> bool {
    value.len() == 22
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
        && value.bytes().any(|byte| byte.is_ascii_digit())
        && value.bytes().any(|byte| byte.is_ascii_uppercase())
        && value.bytes().any(|byte| byte.is_ascii_lowercase())
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACK_URI: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";

    fn sample(uri: &str, title: &str) -> MediaItem {
        item_from_display(
            uri,
            DisplayMetadata {
                title: title.to_string(),
                creators: vec![("Nara".into(), Some("spotify:artist:nara".into()))],
                album_name: Some("Atlas".into()),
                album_uri: Some("spotify:album:atlas".into()),
                cover_uri: Some("https://i.scdn.co/image/abc".into()),
                duration_ms: Some(180_000),
                explicit: false,
                item_type: MediaItemType::Track,
            },
        )
    }

    #[test]
    fn uri_ids_are_never_used_as_visible_titles() {
        let item = item_from_display(
            TRACK_URI,
            DisplayMetadata {
                title: String::new(),
                creators: Vec::new(),
                album_name: None,
                album_uri: None,
                cover_uri: None,
                duration_ms: None,
                explicit: false,
                item_type: MediaItemType::Track,
            },
        );
        assert_eq!(item.title, LOADING_TITLE);
        assert!(!item.title.contains("3n3Ppam7vgaVa1iaRUc9Lp"));

        let from_id = item_from_display(
            TRACK_URI,
            DisplayMetadata {
                title: "3n3Ppam7vgaVa1iaRUc9Lp".into(),
                creators: Vec::new(),
                album_name: None,
                album_uri: None,
                cover_uri: None,
                duration_ms: None,
                explicit: false,
                item_type: MediaItemType::Track,
            },
        );
        assert_eq!(from_id.title, LOADING_TITLE);
    }

    #[test]
    fn placeholder_detection_covers_ids_and_loading_labels() {
        assert!(is_placeholder_title("3n3Ppam7vgaVa1iaRUc9Lp", TRACK_URI));
        assert!(is_placeholder_title(TRACK_URI, TRACK_URI));
        assert!(is_placeholder_title(LOADING_TITLE, TRACK_URI));
        assert!(is_placeholder_title("Unbekannter Titel", TRACK_URI));
        assert!(!is_placeholder_title("Midnight City", TRACK_URI));
        assert!(!is_placeholder_title("Weltuntergangsstimmung", TRACK_URI));
    }

    #[test]
    fn merge_keeps_richer_fields_and_upgrades_the_title() {
        let loading = loading_item(TRACK_URI);
        let named = sample(TRACK_URI, "Midnight City");
        let merged = merge_media_items(Some(&loading), named.clone());
        assert_eq!(merged.title, "Midnight City");
        assert_eq!(merged.creators[0].name, "Nara");
        assert_eq!(merged.album_name.as_deref(), Some("Atlas"));
        assert_eq!(
            merged.cover_uri.as_deref(),
            Some("https://i.scdn.co/image/abc")
        );

        let name_only = item_from_display(
            TRACK_URI,
            DisplayMetadata {
                title: "Midnight City".into(),
                creators: Vec::new(),
                album_name: None,
                album_uri: None,
                cover_uri: None,
                duration_ms: Some(180_000),
                explicit: false,
                item_type: MediaItemType::Track,
            },
        );
        let kept = merge_media_items(Some(&named), name_only);
        assert_eq!(kept.title, "Midnight City");
        assert_eq!(kept.creators[0].name, "Nara");
        assert_eq!(kept.album_name.as_deref(), Some("Atlas"));
        assert_eq!(
            kept.cover_uri.as_deref(),
            Some("https://i.scdn.co/image/abc")
        );
        assert_eq!(kept.album_uri.as_deref(), Some("spotify:album:atlas"));
    }

    #[test]
    fn merge_does_not_replace_a_real_title_with_an_id() {
        let named = sample(TRACK_URI, "Midnight City");
        let stub = loading_item(TRACK_URI);
        let merged = merge_media_items(Some(&named), stub);
        assert_eq!(merged.title, "Midnight City");
        assert_eq!(merged.creators[0].name, "Nara");
    }

    #[test]
    fn merge_replaces_metadata_when_the_uri_changes() {
        let previous = sample(TRACK_URI, "Midnight City");
        let next = sample("spotify:track:nexttrackid000000001", "Nightcall");
        let merged = merge_media_items(Some(&previous), next);
        assert_eq!(merged.uri, "spotify:track:nexttrackid000000001");
        assert_eq!(merged.title, "Nightcall");
    }

    #[test]
    fn cover_picker_prefers_a_mid_size_https_image() {
        let chosen = pick_cover_url([
            (64, "https://i.scdn.co/image/small".into()),
            (300, "https://i.scdn.co/image/mid".into()),
            (640, "https://i.scdn.co/image/large".into()),
        ]);
        assert_eq!(chosen.as_deref(), Some("https://i.scdn.co/image/mid"));

        let from_spotify_uri = pick_cover_url([(300, "spotify:image:abcdef".into())]);
        assert_eq!(
            from_spotify_uri.as_deref(),
            Some("https://i.scdn.co/image/abcdef")
        );
    }

    #[test]
    fn playlist_file_ids_become_cdn_cover_urls() {
        let hex = "aabbccddeeff00112233445566778899aabbccdd";
        let bytes: Vec<u8> = (0..hex.len())
            .step_by(2)
            .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
            .collect();
        assert_eq!(
            cover_from_picture_bytes(&bytes).as_deref(),
            Some("https://i.scdn.co/image/aabbccddeeff00112233445566778899aabbccdd")
        );
        assert_eq!(
            cover_from_picture_bytes(hex.as_bytes()).as_deref(),
            Some("https://i.scdn.co/image/aabbccddeeff00112233445566778899aabbccdd")
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        assert_eq!(
            cover_from_picture_bytes(encoded.as_bytes()).as_deref(),
            Some("https://i.scdn.co/image/aabbccddeeff00112233445566778899aabbccdd")
        );
        assert_eq!(
            normalize_cover_url("spotify:image:abcdef").as_deref(),
            Some("https://i.scdn.co/image/abcdef")
        );
        assert_eq!(
            normalize_cover_url(
                "spotify:mosaic:aabbccddeeff00112233445566778899aabbccdd:112233445566778899aabbccddeeff0011223344"
            )
            .as_deref(),
            Some(
                "https://mosaic.scdn.co/300/aabbccddeeff00112233445566778899aabbccdd112233445566778899aabbccddeeff0011223344"
            )
        );
        assert_eq!(normalize_cover_url("spotify:mosaic:").as_deref(), None);
    }

    #[test]
    fn mapped_track_fields_stay_human_readable() {
        let item = item_from_display(
            TRACK_URI,
            DisplayMetadata {
                title: "Nightcall".into(),
                creators: vec![
                    ("Kavinsky".into(), Some("spotify:artist:kavinsky".into())),
                    ("Lovefoxxx".into(), None),
                ],
                album_name: Some("OutRun".into()),
                album_uri: Some("spotify:album:outrun".into()),
                cover_uri: Some("https://i.scdn.co/image/outrun".into()),
                duration_ms: Some(257_000),
                explicit: false,
                item_type: MediaItemType::Track,
            },
        );
        assert_eq!(item.title, "Nightcall");
        assert_eq!(item.creators.len(), 2);
        assert_eq!(item.creators[0].name, "Kavinsky");
        assert_eq!(item.album_name.as_deref(), Some("OutRun"));
        assert_eq!(
            item.cover_uri.as_deref(),
            Some("https://i.scdn.co/image/outrun")
        );
        assert_ne!(item.title, uri_tail(TRACK_URI));
    }
}
