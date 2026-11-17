//! Song details for the whole app: playlists, albums, artists, liked songs,
//! search and the queue all ask here.
//!
//! 1. A song once known is remembered for the session, across playlists.
//! 2. Unknown songs are asked for in batches: librespot asks `extended-metadata`
//!    for one track at a time, the Spotify apps put many into one request.
//! 3. What a batch does not answer goes to the single lookup as before.
//! 4. Songs Spotify has no details for (removed, region locked) are not
//!    asked again for a while; otherwise every opening of a playlist with a
//!    few of them waits for the same empty answers.
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use librespot::{
    core::Session,
    metadata::Track,
    protocol::{
        extended_metadata::{BatchedEntityRequest, BatchedExtensionResponse, EntityRequest, ExtensionQuery},
        extension_kind::ExtensionKind,
        metadata::Track as TrackMessage,
    },
};
use luft_core::MediaItem;
use protobuf::{EnumOrUnknown, Message};
use tokio::task::JoinSet;
use tracing::{debug, info};

use crate::metadata::{is_placeholder_title, item_from_track, load_metadata_resilient};

/// Songs per request; the Spotify clients send batches of this size.
const BATCH: usize = 100;
/// Two batches at once: a large playlist is quick without flooding Spotify.
const BATCH_PARALLEL: usize = 2;
const BATCH_TIMEOUT: Duration = Duration::from_secs(12);
/// Songs remembered for the session (about 15–20 MB at most). When full,
/// known songs stay and new ones are simply looked up again.
const KNOWN_MAX: usize = 30_000;
/// Single lookups for what batches left out, a few at a time.
const SINGLE_PARALLEL: usize = 8;
const SINGLE_TIMEOUT: Duration = Duration::from_secs(6);

/// How long a song without an answer rests before it is asked again.
const UNANSWERED_REST: Duration = Duration::from_secs(30 * 60);
const UNANSWERED_MAX: usize = 10_000;

static KNOWN: LazyLock<Mutex<HashMap<String, MediaItem>>> = LazyLock::new(Mutex::default);
static UNANSWERED: LazyLock<Mutex<HashMap<String, Instant>>> = LazyLock::new(Mutex::default);

fn resting(uri: &str) -> bool {
    UNANSWERED.lock().ok().and_then(|map| map.get(uri).copied()).is_some_and(|since| since.elapsed() < UNANSWERED_REST)
}

fn rest(uris: &[String]) {
    let Ok(mut map) = UNANSWERED.lock() else { return };
    if map.len() + uris.len() > UNANSWERED_MAX {
        map.retain(|_, since| since.elapsed() < UNANSWERED_REST);
    }
    let now = Instant::now();
    for uri in uris {
        if map.len() >= UNANSWERED_MAX { break; }
        map.insert(uri.clone(), now);
    }
}

fn is_track(uri: &str) -> bool {
    uri.strip_prefix("spotify:track:").is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// The song itself, without what belongs to one place it appears in.
fn catalog_entry(item: &MediaItem) -> MediaItem {
    MediaItem { added_at: None, playlist_entry_id: None, added_by: None, play_count: None, ..item.clone() }
}

/// A remembered song, if any.
pub(crate) fn known(uri: &str) -> Option<MediaItem> {
    KNOWN.lock().ok()?.get(uri).cloned()
}

/// Remembers complete song details, e.g. from a stored playlist or a fresh answer.
pub(crate) fn remember<'a>(items: impl IntoIterator<Item = &'a MediaItem>) {
    let Ok(mut known) = KNOWN.lock() else { return };
    for item in items {
        if !is_track(&item.uri) || is_placeholder_title(&item.title, &item.uri) {
            continue;
        }
        if known.len() >= KNOWN_MAX && !known.contains_key(&item.uri) {
            continue;
        }
        known.insert(item.uri.clone(), catalog_entry(item));
    }
}

/// A few remembered songs, e.g. to try something on real tracks.
pub(crate) fn sample(count: usize) -> Vec<String> {
    let Ok(known) = KNOWN.lock() else { return Vec::new() };
    let mut uris: Vec<String> = known.keys().cloned().collect();
    uris.sort();
    uris.truncate(count);
    uris
}

/// The artists that appear most often among the remembered songs, most first.
pub(crate) fn top_artists(limit: usize) -> Vec<String> {
    let Ok(known) = KNOWN.lock() else { return Vec::new() };
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for item in known.values() {
        for uri in item.creators.iter().filter_map(|creator| creator.uri.as_deref()) {
            if uri.starts_with("spotify:artist:") {
                *counts.entry(uri).or_default() += 1;
            }
        }
    }
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    ranked.into_iter().take(limit).map(|(uri, _)| uri.to_string()).collect()
}

/// Raw answers for other kinds (artists, albums), asked in batches like songs.
pub(crate) async fn entities(session: &Session, kind: ExtensionKind, uris: &[String]) -> Vec<(String, Vec<u8>)> {
    let mut chunks = uris.chunks(BATCH).map(<[String]>::to_vec).collect::<Vec<_>>().into_iter();
    let mut running = JoinSet::new();
    let mut found = Vec::new();
    loop {
        while running.len() < BATCH_PARALLEL && let Some(chunk) = chunks.next() {
            let session = session.clone();
            running.spawn(async move { raw_batch(&session, kind, &chunk).await });
        }
        let Some(done) = running.join_next().await else { break };
        if let Ok(Some(answers)) = done {
            found.extend(answers);
        }
    }
    found
}

async fn raw_batch(session: &Session, kind: ExtensionKind, uris: &[String]) -> Option<Vec<(String, Vec<u8>)>> {
    let request = BatchedEntityRequest {
        entity_request: uris.iter().map(|uri| EntityRequest {
            entity_uri: uri.clone(),
            query: vec![ExtensionQuery { extension_kind: EnumOrUnknown::new(kind), ..Default::default() }],
            ..Default::default()
        }).collect(),
        ..Default::default()
    };
    let response = tokio::time::timeout(BATCH_TIMEOUT, session.spclient().get_extended_metadata(request)).await.ok()?.ok()?;
    Some(response.extended_metadata.iter()
        .flat_map(|array| array.extension_data.iter())
        .filter_map(|entry| Some((entry.entity_uri.clone(), entry.extension_data.as_ref()?.value.clone())))
        .collect())
}

/// Details for the given songs in their order; songs nobody could answer are left out.
pub(crate) async fn tracks_in_order(session: &Session, uris: &[String]) -> Vec<MediaItem> {
    let found = tracks(session, uris).await;
    uris.iter().filter_map(|uri| found.get(uri).cloned()).collect()
}

/// Details for the given songs, keyed by URI: remembered first, then batches, then one by one.
pub(crate) async fn tracks(session: &Session, uris: &[String]) -> HashMap<String, MediaItem> {
    let mut found = HashMap::with_capacity(uris.len());
    let mut missing = Vec::new();
    for uri in uris {
        if found.contains_key(uri) {
            continue;
        }
        match known(uri) {
            Some(item) => { found.insert(uri.clone(), item); }
            None if resting(uri) => {}
            None => missing.push(uri.clone()),
        }
    }
    missing.sort();
    missing.dedup();
    if missing.is_empty() {
        return found;
    }
    let (batched, answered) = load_batches(session, missing.iter().filter(|uri| is_track(uri)).cloned().collect()).await;
    remember(batched.values());
    found.extend(batched);
    let leftovers: Vec<String> = missing.into_iter().filter(|uri| !found.contains_key(uri)).collect();
    let singles = load_singles(session, leftovers.clone()).await;
    remember(singles.values());
    // Only when Spotify did answer: a lost connection must not mark songs as missing.
    if answered {
        let unanswered: Vec<String> = leftovers.into_iter().filter(|uri| is_track(uri) && !singles.contains_key(uri)).collect();
        rest(&unanswered);
    }
    found.extend(singles);
    found
}

/// The songs a batch answered, and whether every batch got an answer at all.
async fn load_batches(session: &Session, uris: Vec<String>) -> (HashMap<String, MediaItem>, bool) {
    let mut found = HashMap::with_capacity(uris.len());
    if uris.is_empty() {
        return (found, false);
    }
    let mut answered = true;
    let asked = uris.len();
    let mut chunks = uris.chunks(BATCH).map(<[String]>::to_vec).collect::<Vec<_>>().into_iter();
    let mut running = JoinSet::new();
    loop {
        while running.len() < BATCH_PARALLEL && let Some(chunk) = chunks.next() {
            let session = session.clone();
            running.spawn(async move { load_batch(&session, &chunk).await });
        }
        let Some(done) = running.join_next().await else { break };
        match done {
            Ok(Some(items)) => found.extend(items),
            // A refused batch means the others would be refused too: the single lookups take over.
            _ => { answered = false; running.abort_all(); break; }
        }
    }
    info!(adapter = "librespot", phase = "metadata-batch", asked, answered = found.len(), "song details loaded in batches");
    (found, answered)
}

async fn load_batch(session: &Session, uris: &[String]) -> Option<Vec<(String, MediaItem)>> {
    let request = BatchedEntityRequest {
        entity_request: uris.iter().map(|uri| EntityRequest {
            entity_uri: uri.clone(),
            query: vec![ExtensionQuery { extension_kind: EnumOrUnknown::new(ExtensionKind::TRACK_V4), ..Default::default() }],
            ..Default::default()
        }).collect(),
        ..Default::default()
    };
    match tokio::time::timeout(BATCH_TIMEOUT, session.spclient().get_extended_metadata(request)).await {
        Ok(Ok(response)) => Some(read_tracks(&response)),
        Ok(Err(error)) => {
            debug!(adapter = "librespot", error = %error, songs = uris.len(), "song batch was not answered");
            None
        }
        Err(_) => {
            debug!(adapter = "librespot", songs = uris.len(), "song batch timed out");
            None
        }
    }
}

fn read_tracks(response: &BatchedExtensionResponse) -> Vec<(String, MediaItem)> {
    response.extended_metadata.iter()
        .flat_map(|array| array.extension_data.iter())
        .filter_map(|entry| {
            let data = entry.extension_data.as_ref()?;
            let message = TrackMessage::parse_from_bytes(&data.value).ok()?;
            let track = Track::try_from(&message).ok()?;
            let item = item_from_track(&entry.entity_uri, &track);
            (!is_placeholder_title(&item.title, &item.uri)).then(|| (entry.entity_uri.clone(), item))
        })
        .collect()
}

async fn load_singles(session: &Session, uris: Vec<String>) -> HashMap<String, MediaItem> {
    let mut found = HashMap::with_capacity(uris.len());
    let mut pending = uris.into_iter();
    let mut running = JoinSet::new();
    loop {
        while running.len() < SINGLE_PARALLEL && let Some(uri) = pending.next() {
            let session = session.clone();
            running.spawn(async move {
                let item = tokio::time::timeout(SINGLE_TIMEOUT, load_metadata_resilient(&session, &uri, 2)).await.ok().flatten();
                (uri, item)
            });
        }
        let Some(done) = running.join_next().await else { break };
        if let Ok((uri, Some(item))) = done {
            found.insert(uri, item);
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_core::{MediaItemType, MediaSource};

    fn item(uri: &str, title: &str) -> MediaItem {
        MediaItem {
            uri: uri.into(), source: MediaSource::Spotify, item_type: MediaItemType::Track, title: title.into(),
            creators: Vec::new(), album_name: None, album_uri: None, duration_ms: None, play_count: Some(3),
            cover_uri: None, canvas_url: None, added_at: Some("2026-10-01".into()), playlist_entry_id: Some("e1".into()),
            added_by: None, explicit: false, playable: true,
        }
    }

    #[test]
    fn only_plain_track_uris_are_batched() {
        assert!(is_track("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!is_track("spotify:episode:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!is_track("spotify:local:artist:album:title:180"));
        assert!(!is_track("spotify:track:short"));
    }

    #[test]
    fn remembered_songs_drop_what_belongs_to_one_playlist() {
        remember([&item("spotify:track:aaaaaaaaaaaaaaaaaaaaa1", "Nachtbus"), &item("spotify:track:aaaaaaaaaaaaaaaaaaaaa2", "Titel wird geladen…")]);
        let known = known("spotify:track:aaaaaaaaaaaaaaaaaaaaa1").expect("remembered");
        assert_eq!(known.title, "Nachtbus");
        assert!(known.added_at.is_none() && known.playlist_entry_id.is_none() && known.play_count.is_none());
        assert!(super::known("spotify:track:aaaaaaaaaaaaaaaaaaaaa2").is_none(), "placeholders are never remembered");
    }

    #[test]
    fn top_artists_count_every_remembered_song() {
        let mut one = item("spotify:track:bbbbbbbbbbbbbbbbbbbbb1", "Eins");
        one.creators = vec![luft_core::MediaCreator { name: "Zed".into(), uri: Some("spotify:artist:zzzzzzzzzzzzzzzzzzzzz1".into()) }];
        let mut two = item("spotify:track:bbbbbbbbbbbbbbbbbbbbb2", "Zwei");
        two.creators = one.creators.clone();
        remember([&one, &two]);
        // Other tests share the memory, so only check that the artist ranks.
        assert!(top_artists(50).contains(&"spotify:artist:zzzzzzzzzzzzzzzzzzzzz1".to_string()));
    }

    #[test]
    fn songs_without_an_answer_rest() {
        let uri = "spotify:track:aaaaaaaaaaaaaaaaaaaaa3".to_string();
        assert!(!resting(&uri));
        rest(std::slice::from_ref(&uri));
        assert!(resting(&uri));
    }

    #[test]
    fn an_empty_answer_reads_as_nothing() {
        assert!(read_tracks(&BatchedExtensionResponse::new()).is_empty());
    }
}
