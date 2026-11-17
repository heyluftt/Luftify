mod artist_releases;
mod covers;
mod permissions;
mod releases;
mod rootlist;
mod search;

use covers::hydrate_missing_playlist_covers;
pub(crate) use releases::new_releases;
use rootlist::rootlist_playlists;
pub(crate) use search::search;

use std::time::{Duration, Instant};

use http::Method;
use librespot::core::Session;
use serde_json::Value;
use tracing::{info, warn};

use luft_core::{
    EntitySummary, MediaCreator, MediaItem, MediaItemType, MediaSource, Page, PageRequest,
};

use crate::queue::canonicalize_item_uri;
use crate::session_http;

pub(crate) async fn playlists(
    session: &Session,
    request: PageRequest,
) -> Result<Page<EntitySummary>, luft_core::ProviderError> {
    let started = Instant::now();
    if let Some(page) = load_playlist_library_page(session, request).await {
        return Ok(page);
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    if let Some(page) = load_playlist_library_page(session, request).await {
        info!(
            adapter = "librespot",
            phase = "library-playlists",
            elapsed_ms = started.elapsed().as_millis(),
            "librespot playlists loaded after retry"
        );
        return Ok(page);
    }
    warn!(
        adapter = "librespot",
        phase = "library-playlists",
        elapsed_ms = started.elapsed().as_millis(),
        "all librespot playlist sources failed"
    );
    Err(luft_core::ProviderError::ActionRejected {
        message: "Die Playlists sind über Librespot gerade nicht erreichbar.".into(),
        retryable: true,
    })
}

async fn load_playlist_library_page(
    session: &Session,
    request: PageRequest,
) -> Option<Page<EntitySummary>> {
    let started = Instant::now();
    if let Some(mut page) = rootlist_playlists(session, request).await {
        mark_writable_library_playlists(&mut page.items);
        info!(
            adapter = "librespot",
            phase = "library-playlists",
            source = "rootlist",
            items = page.items.len(),
            offset = page.offset,
            limit = page.limit,
            elapsed_ms = started.elapsed().as_millis(),
            "librespot playlists loaded"
        );
        return Some(page);
    }
    warn!(
        adapter = "librespot",
        phase = "library-playlists",
        source = "rootlist",
        elapsed_ms = started.elapsed().as_millis(),
        "librespot playlist rootlist unavailable; trying web fallback"
    );
    let mut page = web_playlists(session, request).await?;
    mark_writable_library_playlists(&mut page.items);
    info!(
        adapter = "librespot",
        phase = "library-playlists",
        source = "web-api",
        items = page.items.len(),
        offset = page.offset,
        limit = page.limit,
        elapsed_ms = started.elapsed().as_millis(),
        "librespot playlists loaded"
    );
    Some(page)
}

pub(crate) async fn liked_tracks(
    session: &Session,
    request: PageRequest,
) -> Result<Page<MediaItem>, luft_core::ProviderError> {
    if let Some(page) = context_liked_tracks(session, request).await {
        return Ok(page);
    }
    if let Some(page) = web_liked_tracks(session, request).await {
        return Ok(page);
    }
    Err(luft_core::ProviderError::ActionRejected {
        message: "Die Lieblingssongs sind über Librespot gerade nicht erreichbar.".into(),
        retryable: true,
    })
}

async fn web_playlists(session: &Session, request: PageRequest) -> Option<Page<EntitySummary>> {
    let started = Instant::now();
    let request = PageRequest {
        offset: request.offset,
        limit: request.limit.clamp(1, 50),
    };
    let url = format!(
        "https://api.spotify.com/v1/me/playlists?limit={}&offset={}",
        request.limit, request.offset
    );
    // Spotify's desktop client ID rejects some combined Keymaster scope
    // requests even when an individual scope is accepted. The private scope
    // covers the normal playlist library and is therefore the safest first
    // fallback; the other variants retain compatibility with other accounts.
    // A resting Web API or a refused token makes every variant miss at once;
    // one line naming the reason says more than three empty ones.
    if let Some(reason) = session_http::scoped_web_api_blocked(&url) {
        info!(
            adapter = "librespot",
            phase = "library-web-playlists",
            reason,
            "librespot web playlist fallback skipped"
        );
        return None;
    }
    for (scope_variant, scopes) in [
        ("private", "playlist-read-private"),
        (
            "combined",
            "playlist-read-private,playlist-read-collaborative",
        ),
        ("collaborative", "playlist-read-collaborative"),
    ] {
        let Some(bytes) =
            session_http::request_web_api(session, &Method::GET, &url, None, scopes).await
        else {
            warn!(
                adapter = "librespot",
                phase = "library-web-playlists",
                scope_variant,
                elapsed_ms = started.elapsed().as_millis(),
                "librespot web playlist request returned no response"
            );
            if session_http::scoped_web_api_blocked(&url).is_some() {
                break;
            }
            continue;
        };
        let value = match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) => value,
            Err(error) => {
                warn!(
                    adapter = "librespot",
                    phase = "library-web-playlists",
                    scope_variant,
                    error = %error,
                    bytes = bytes.len(),
                    elapsed_ms = started.elapsed().as_millis(),
                    "librespot web playlist response was not valid JSON"
                );
                continue;
            }
        };
        let entities = items(&value)
            .into_iter()
            .filter_map(|record| {
                let mut entity = entity_from_value(record)?;
                entity.can_modify = permissions::playlist_write_access(record, &session.username());
                Some(entity)
            })
            .collect::<Vec<_>>();
        let total = value.get("total").and_then(Value::as_u64).map(|n| n as u32);
        if entities.is_empty() && total.is_none() {
            warn!(
                adapter = "librespot",
                phase = "library-web-playlists",
                scope_variant,
                bytes = bytes.len(),
                "librespot web playlist response had no page payload"
            );
            continue;
        }
        info!(
            adapter = "librespot",
            phase = "library-web-playlists",
            scope_variant,
            items = entities.len(),
            total = ?total,
            bytes = bytes.len(),
            elapsed_ms = started.elapsed().as_millis(),
            "librespot web playlist response parsed"
        );
        return Some(page_from_items(request, entities, total));
    }
    None
}

async fn web_liked_tracks(session: &Session, request: PageRequest) -> Option<Page<MediaItem>> {
    let url = format!(
        "https://api.spotify.com/v1/me/tracks?limit={}&offset={}",
        request.limit.max(1),
        request.offset
    );
    let bytes =
        session_http::request_web_api(session, &Method::GET, &url, None, "user-library-read")
            .await?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    let tracks = items(&value)
        .into_iter()
        .filter_map(|item| {
            let added_at = string_value(item.get("added_at"))
                .and_then(|value| crate::playlist::added_at_from_raw(&value));
            let mut track = media_from_value(item.get("track").unwrap_or(item))?;
            if added_at.is_some() {
                track.added_at = added_at;
            }
            Some(track)
        })
        .collect::<Vec<_>>();
    Some(page_from_items(
        request,
        tracks,
        value.get("total").and_then(Value::as_u64).map(|n| n as u32),
    ))
}

/// Every liked track URI, newest first, from one context resolve. Cheap
/// enough to answer "is this saved?" for tracks outside the loaded pages.
pub(crate) async fn liked_track_uris(session: &Session) -> Option<Vec<String>> {
    let mut uris = liked_list(session).await?.into_iter().map(|(uri, _)| uri).collect::<Vec<_>>();
    crate::collection::apply_recent_writes(
        &mut uris,
        &crate::collection::recent_writes(&session.username()),
    );
    Some(uris)
}

/// The liked list as Spotify last sent it, per account. Pages of 50 used to
/// download the whole list each; now one download serves a scroll through it.
/// Own likes and unlikes are laid on top below, so they show at once.
static LIKED_LIST: std::sync::LazyLock<std::sync::Mutex<Option<(String, Instant, Vec<(String, Option<String>)>)>>> =
    std::sync::LazyLock::new(std::sync::Mutex::default);
const LIKED_LIST_FRESH: Duration = Duration::from_secs(90);

async fn liked_list(session: &Session) -> Option<Vec<(String, Option<String>)>> {
    let user = session.username();
    if let Ok(cached) = LIKED_LIST.lock()
        && let Some((owner, at, list)) = cached.as_ref()
        && *owner == user
        && at.elapsed() < LIKED_LIST_FRESH
    {
        return Some(list.clone());
    }
    let uri = format!("spotify:user:{user}:collection");
    let context = session.spclient().get_context(&uri).await.ok()?;
    let mut uris = Vec::new();
    for page in context.pages {
        for track in page.tracks {
            if let Some(uri) = track.uri
                && let Some(uri) = canonicalize_item_uri(&uri)
            {
                uris.push((
                    uri,
                    crate::playlist::added_at_from_metadata(&track.metadata),
                ));
            }
        }
    }
    if let Ok(mut cached) = LIKED_LIST.lock() {
        *cached = Some((user, Instant::now(), uris.clone()));
    }
    Some(uris)
}

async fn context_liked_tracks(session: &Session, request: PageRequest) -> Option<Page<MediaItem>> {
    let mut uris = liked_list(session).await?;
    let writes = crate::collection::recent_writes(&session.username());
    if !writes.is_empty() {
        let mut ordered = uris.iter().map(|(uri, _)| uri.clone()).collect::<Vec<_>>();
        crate::collection::apply_recent_writes(&mut ordered, &writes);
        let mut dates = uris
            .into_iter()
            .collect::<std::collections::HashMap<_, _>>();
        uris = ordered
            .into_iter()
            .map(|uri| {
                let added = dates.remove(&uri).flatten();
                (uri, added)
            })
            .collect();
    }
    let total = uris.len() as u32;
    let start = request.offset.min(total) as usize;
    let end = (start + request.limit.max(1) as usize).min(uris.len());
    let window = &uris[start..end];
    let added = window
        .iter()
        .cloned()
        .collect::<std::collections::HashMap<_, _>>();
    let window_uris = window
        .iter()
        .map(|(uri, _)| uri.clone())
        .collect::<Vec<_>>();
    // Loading one track after the other made a page of 50 wait for 50 round trips.
    let mut tracks = crate::album::hydrate_tracks(session, &window_uris).await;
    for item in &mut tracks {
        if item.added_at.is_none() {
            item.added_at = added.get(&item.uri).cloned().flatten();
        }
    }
    Some(Page {
        items: tracks,
        offset: request.offset,
        limit: request.limit,
        total: Some(total),
        has_more: (request.offset.saturating_add(request.limit)) < total,
    })
}

fn group<'a>(source: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = source.get(*key) {
            return Some(value);
        }
    }
    None
}

fn items(value: &Value) -> Vec<&Value> {
    if let Some(array) = value
        .get("items")
        .or_else(|| value.get("itemsV2"))
        .or_else(|| value.get("hits"))
        .or_else(|| value.get("nodes"))
        .or_else(|| value.pointer("/content/items"))
        .or_else(|| value.pointer("/items/items"))
        .and_then(Value::as_array)
    {
        return array.iter().collect();
    }
    value
        .as_array()
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn collect_media(value: Option<&Value>) -> Vec<MediaItem> {
    value
        .map(|value| {
            items(value)
                .into_iter()
                .filter_map(media_from_value)
                .collect()
        })
        .unwrap_or_default()
}

fn collect_entities_from(value: Option<&Value>) -> Vec<EntitySummary> {
    value
        .map(|value| {
            items(value)
                .into_iter()
                .filter_map(entity_from_value)
                .collect()
        })
        .unwrap_or_default()
}

fn collect_entities(value: &Value) -> Vec<EntitySummary> {
    let mut entities = Vec::new();
    walk_entities(value, &mut entities, 0);
    entities
}

fn walk_entities(value: &Value, output: &mut Vec<EntitySummary>, depth: usize) {
    if depth > 8 {
        return;
    }
    if let Some(entity) = entity_from_value(value) {
        if !output.iter().any(|item| item.uri == entity.uri) {
            output.push(entity);
        }
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                walk_entities(item, output, depth + 1);
            }
        }
        Value::Object(object) => {
            // Rootlist payloads changed shape more than once. Walking values
            // also covers rows/entries/folders without binding the player to
            // one private Spotify response schema.
            for nested in object.values() {
                walk_entities(nested, output, depth + 1);
            }
        }
        _ => {}
    }
}

fn media_from_value(value: &Value) -> Option<MediaItem> {
    let record = unwrap_node(value);
    let uri = string_value(record.get("uri"))
        .or_else(|| string_value(record.get("id")).map(|id| format!("spotify:track:{id}")))?;
    if !uri.contains(":track:") {
        return None;
    }
    let title = string_value(record.get("name")).or_else(|| string_value(record.get("title")))?;
    let artists = artist_values(record);
    Some(MediaItem {
        uri,
        source: MediaSource::Spotify,
        item_type: MediaItemType::Track,
        title,
        creators: artists,
        album_name: album_name(record),
        album_uri: album_uri(record),
        duration_ms: duration_ms(record),
        play_count: None,
        cover_uri: image_url(record),
        canvas_url: None,
        added_at: None,
        playlist_entry_id: None,
        added_by: None,
        explicit: record
            .get("explicit")
            .and_then(Value::as_bool)
            .unwrap_or_else(|| {
                string_value(record.pointer("/contentRating/label")).as_deref() == Some("EXPLICIT")
            }),
        playable: record
            .get("isPlayable")
            .or_else(|| record.get("playable"))
            .or_else(|| record.pointer("/playability/playable"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn mark_writable_library_playlists(items: &mut [EntitySummary]) {
    for item in items {
        item.can_modify =
            crate::playlist::mark_library_playlist_writable(&item.uri, item.can_modify);
    }
}

fn entity_from_value(value: &Value) -> Option<EntitySummary> {
    let record = unwrap_node(value);
    let uri = entity_uri(record)?;
    if uri.contains(":track:") || uri.contains(":episode:") {
        return None;
    }
    let name = entity_name(record)?;
    Some(EntitySummary {
        uri: uri.clone(),
        name,
        subtitle: entity_subtitle(record, &uri),
        cover_uri: image_url(record),
        can_modify: None,
        library: None,
    })
}

fn entity_uri(record: &Value) -> Option<String> {
    if let Some(uri) = string_value(record.get("uri")) {
        return Some(uri);
    }
    if let Some(link) = string_value(record.get("link"))
        && (link.contains(":playlist:") || link.contains(":album:") || link.contains(":artist:"))
    {
        return Some(link);
    }
    let id = string_value(record.get("id"))?;
    match entity_kind(record).as_deref() {
        Some("artist") => Some(format!("spotify:artist:{id}")),
        Some("album") => Some(format!("spotify:album:{id}")),
        Some("playlist") => Some(format!("spotify:playlist:{id}")),
        Some("track") => Some(format!("spotify:track:{id}")),
        _ if record.get("artists").is_none() && record.get("album_type").is_none() => {
            Some(format!("spotify:artist:{id}"))
        }
        _ => None,
    }
}

fn entity_name(record: &Value) -> Option<String> {
    string_value(record.get("name"))
        .or_else(|| string_value(record.get("title")))
        .or_else(|| string_value(record.pointer("/profile/name")))
        .or_else(|| string_value(record.pointer("/attributes/name")))
}

fn entity_subtitle(record: &Value, uri: &str) -> Option<String> {
    if uri.contains(":album:") {
        let names = artist_values(record)
            .into_iter()
            .map(|artist| artist.name)
            .collect::<Vec<_>>();
        if !names.is_empty() {
            return Some(names.join(", "));
        }
    }
    if uri.contains(":playlist:") {
        return string_value(record.pointer("/ownerV2/data/name"))
            .or_else(|| string_value(record.pointer("/owner/display_name")))
            .or_else(|| string_value(record.pointer("/owner/name")))
            .or_else(|| Some("Playlist".into()));
    }
    if uri.contains(":artist:") {
        return Some("Künstler".into());
    }
    string_value(record.get("type")).or_else(|| string_value(record.get("__typename")))
}

fn entity_kind(record: &Value) -> Option<String> {
    if let Some(kind) =
        string_value(record.get("__typename")).or_else(|| string_value(record.get("type")))
    {
        return Some(kind.to_ascii_lowercase());
    }
    let uri = string_value(record.get("uri"))?;
    if uri.contains(":artist:") {
        Some("artist".into())
    } else if uri.contains(":album:") {
        Some("album".into())
    } else if uri.contains(":playlist:") {
        Some("playlist".into())
    } else if uri.contains(":track:") {
        Some("track".into())
    } else {
        None
    }
}

fn unwrap_node(value: &Value) -> &Value {
    let mut current = value;
    for _ in 0..4 {
        let next = current
            .get("data")
            .or_else(|| current.get("item"))
            .or_else(|| current.get("track"))
            .or_else(|| current.get("node"))
            .or_else(|| current.get("hit"));
        match next {
            Some(inner) if inner.is_object() => current = inner,
            _ => break,
        }
    }
    current
}

fn artist_values(record: &Value) -> Vec<MediaCreator> {
    let artists = record
        .get("artists")
        .or_else(|| record.get("artistsV2"))
        .and_then(|value| value.get("items").or(Some(value)))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    artists
        .iter()
        .filter_map(|artist| {
            let artist = unwrap_node(artist);
            let name = string_value(artist.get("name"))
                .or_else(|| string_value(artist.pointer("/profile/name")))?;
            Some(MediaCreator {
                name,
                uri: string_value(artist.get("uri")),
            })
        })
        .collect()
}

fn album_name(record: &Value) -> Option<String> {
    string_value(record.pointer("/album/name"))
        .or_else(|| string_value(record.pointer("/albumOfTrack/name")))
}

fn album_uri(record: &Value) -> Option<String> {
    string_value(record.pointer("/album/uri"))
        .or_else(|| string_value(record.pointer("/albumOfTrack/uri")))
}

fn duration_ms(record: &Value) -> Option<u64> {
    record
        .get("duration_ms")
        .or_else(|| record.pointer("/duration/totalMilliseconds"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|ms| ms as u64))
                .or_else(|| value.as_str()?.parse().ok())
        })
        .filter(|ms| *ms > 0)
}

fn image_url(record: &Value) -> Option<String> {
    if let Some(url) = string_value(record.get("image"))
        .or_else(|| string_value(record.get("imageUrl")))
        .or_else(|| string_value(record.get("image_url")))
        .or_else(|| string_value(record.get("imageSmallUrl")))
        .or_else(|| string_value(record.pointer("/pictures/standardLink")))
        .or_else(|| string_value(record.pointer("/pictures/standard_link")))
        .or_else(|| string_value(record.pointer("/pictures/largeLink")))
        .or_else(|| string_value(record.pointer("/pictures/large_link")))
    {
        return crate::metadata::normalize_cover_url(&url).or(Some(url));
    }
    let images = record
        .get("images")
        .or_else(|| record.pointer("/album/images"))
        .or_else(|| record.pointer("/albumOfTrack/coverArt/sources"))
        .or_else(|| record.pointer("/visuals/avatarImage/sources"))
        .or_else(|| record.pointer("/visuals/avatar/sources"))
        .or_else(|| record.pointer("/coverArt/sources"))
        .or_else(|| record.pointer("/images/items"));
    images
        .into_iter()
        .flat_map(|images| std::iter::once(images).chain(items(images)))
        .find_map(image_source_url)
        .or_else(|| {
            string_value(record.pointer("/attributes/picture")).and_then(|picture| {
                crate::metadata::normalize_cover_url(&picture)
                    .or_else(|| crate::metadata::cover_from_picture_bytes(picture.as_bytes()))
            })
        })
}

fn image_source_url(value: &Value) -> Option<String> {
    string_value(value.get("url"))
        .or_else(|| string_value(value.get("uri")))
        .and_then(|url| crate::metadata::normalize_cover_url(&url))
        .or_else(|| {
            value.get("sources").and_then(|sources| {
                items(sources).into_iter().find_map(|source| {
                    string_value(source.get("url"))
                        .or_else(|| string_value(source.get("uri")))
                        .and_then(|url| crate::metadata::normalize_cover_url(&url))
                })
            })
        })
}

fn string_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn page_from_items<T>(request: PageRequest, items: Vec<T>, total: Option<u32>) -> Page<T> {
    let count = items.len() as u32;
    Page {
        items,
        offset: request.offset,
        limit: request.limit,
        total,
        has_more: total.is_some_and(|total| request.offset.saturating_add(request.limit) < total)
            || count >= request.limit.max(1),
    }
}

fn unique_by_uri<T: HasUri>(mut values: Vec<T>) -> Vec<T> {
    let mut seen = std::collections::HashSet::new();
    values.retain(|value| seen.insert(value.uri().to_string()));
    values
}

trait HasUri {
    fn uri(&self) -> &str;
}

impl HasUri for MediaItem {
    fn uri(&self) -> &str {
        &self.uri
    }
}

impl HasUri for EntitySummary {
    fn uri(&self) -> &str {
        &self.uri
    }
}

fn urlencoding_lite(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn playlist_picture_ids_become_cover_urls() {
        let entities = collect_entities(&json!({
            "items": [{
                "uri": "spotify:playlist:night",
                "name": "Night",
                "attributes": {
                    "picture": "aabbccddeeff00112233445566778899aabbccdd"
                }
            }]
        }));
        assert_eq!(entities[0].name, "Night");
        assert_eq!(
            entities[0].cover_uri.as_deref(),
            Some("https://i.scdn.co/image/aabbccddeeff00112233445566778899aabbccdd")
        );
    }

    #[test]
    fn parses_rootlist_rows_with_playlist_links() {
        let entities = collect_entities(&json!({
            "rows": [{
                "link": "spotify:user:listener:playlist:night",
                "attributes": {
                    "name": "Night"
                }
            }]
        }));
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].uri, "spotify:user:listener:playlist:night");
        assert_eq!(entities[0].name, "Night");
    }
}
