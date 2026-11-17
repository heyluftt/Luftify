use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use chrono::{DateTime, TimeZone, Utc};
use http::Method;
use librespot::{
    core::{Session, SpotifyUri},
    metadata::{Metadata, Playlist},
};
use luft_core::{MediaItem, PageRequest, PlaylistDetails, ProviderError};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::metadata::{
    cover_from_picture_bytes, is_placeholder_title, load_metadata_resilient, loading_item,
    merge_media_items, normalize_cover_url,
};
use crate::playback::is_playable_item_uri;
use crate::queue::canonicalize_item_uri;
use crate::session_http;
use tracing::{info, warn};

const PLAYLIST_READ_SCOPES: &str = "playlist-read-private,playlist-read-collaborative";
const ADDED_AT_PAGE_SIZE: u32 = 50;
const ADDED_AT_MAX_ITEMS: u32 = 100_000;
const PLAYLIST_SLICE: usize = 200;

/// Batched lookups make a large repair as quick as a small one used to be.
const REPAIR_BATCH_LIMIT: usize = 400;
static REPAIR_CURSOR: AtomicUsize = AtomicUsize::new(0);
const PLAYLIST_INDEX_TTL: Duration = Duration::from_secs(90);
const INDEX_FILL_WAIT: Duration = Duration::from_secs(8);

#[derive(Clone)]
pub(crate) struct CachedPlaylistIndex {
    fetched_at: Instant,
    uri: String,
    name: String,
    owner_name: Option<String>,
    owner: Option<luft_core::PlaylistContributor>,
    collaborative: Option<bool>,
    description: Option<String>,
    cover_uri: Option<String>,
    can_modify: Option<bool>,
    items: Vec<PlaylistTrackRef>,
    expected_len: usize,
    complete: bool,
}

pub(crate) struct PlaylistIndexCache {
    entries: Mutex<HashMap<String, CachedPlaylistIndex>>,
    completing: Mutex<HashSet<String>>,
    playback_entries: Mutex<Option<CachedPlaylistPlaybackEntries>>,
    catalog: Mutex<Option<CachedPlaylistCatalog>>,
}

#[derive(Clone)]
struct CachedPlaylistPlaybackEntries {
    playlist_id: String,
    items: Vec<PlaylistTrackRef>,
}

#[derive(Clone)]
struct CachedPlaylistCatalog {
    playlist_id: String,
    items: Arc<HashMap<String, MediaItem>>,
}

impl PlaylistIndexCache {
    pub(crate) async fn expire_metadata(&self, uri: &str) {
        if let Some(index) = self.entries.lock().await.get_mut(&playlist_cache_identity(uri)) {
            index.fetched_at = Instant::now() - PLAYLIST_INDEX_TTL;
        }
    }
    pub(crate) fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            completing: Mutex::new(HashSet::new()),
            playback_entries: Mutex::new(None),
            catalog: Mutex::new(None),
        }
    }

    pub(crate) async fn seed_playback_entries(&self, uri: &str, catalog: &[MediaItem]) -> usize {
        let items = catalog
            .iter()
            .filter_map(|item| {
                let uri = canonicalize_item_uri(&item.uri)?;
                is_playable_item_uri(&uri).then(|| PlaylistTrackRef {
                    uri,
                    added_at: item.added_at.clone(),
                    entry_id: item.playlist_entry_id.clone(),
                    added_by: item.added_by.clone(),
                })
            })
            .collect::<Vec<_>>();
        let count = items.len();
        if count > 0 {
            *self.playback_entries.lock().await = Some(CachedPlaylistPlaybackEntries {
                playlist_id: playlist_cache_identity(uri),
                items,
            });
        }
        count
    }

    pub(crate) async fn seed_catalog(&self, uri: &str, catalog: &[MediaItem]) -> usize {
        let items = catalog
            .iter()
            .filter(|item| !is_placeholder_title(&item.title, &item.uri))
            .map(|item| (item.uri.clone(), item.clone()))
            .collect::<HashMap<_, _>>();
        let count = items.len();
        if count > 0 {
            *self.catalog.lock().await = Some(CachedPlaylistCatalog {
                playlist_id: playlist_cache_identity(uri),
                items: Arc::new(items),
            });
        }
        count
    }

    async fn get(&self, uri: &str) -> Option<CachedPlaylistIndex> {
        self.entries
            .lock()
            .await
            .get(&playlist_cache_identity(uri))
            .cloned()
    }

    pub(crate) async fn cached_play_uris(&self, uri: &str) -> Vec<String> {
        if let Some(items) = self.playback_entries(uri).await {
            return items.into_iter().map(|item| item.uri).collect();
        }
        self.get(uri)
            .await
            .map(|index| index.items.into_iter().map(|item| item.uri).collect())
            .unwrap_or_default()
    }

    async fn playback_entries(&self, uri: &str) -> Option<Vec<PlaylistTrackRef>> {
        let key = playlist_cache_identity(uri);
        self.playback_entries
            .lock()
            .await
            .as_ref()
            .filter(|entry| entry.playlist_id == key)
            .map(|entry| entry.items.clone())
    }

    pub(crate) async fn catalog(&self, uri: &str) -> Option<Arc<HashMap<String, MediaItem>>> {
        let key = playlist_cache_identity(uri);
        self.catalog
            .lock()
            .await
            .as_ref()
            .filter(|entry| entry.playlist_id == key)
            .map(|entry| Arc::clone(&entry.items))
    }

    async fn insert(&self, index: CachedPlaylistIndex) {
        self.entries
            .lock()
            .await
            .insert(playlist_cache_identity(&index.uri), index);
    }

    async fn begin_complete(&self, uri: &str) -> bool {
        let cached = self.get(uri).await;
        if cached.as_ref().is_some_and(|index| index.complete) {
            return false;
        }
        self.completing
            .lock()
            .await
            .insert(playlist_cache_identity(uri))
    }

    async fn finish_complete(&self, uri: &str, items: Vec<PlaylistTrackRef>) {
        let key = playlist_cache_identity(uri);
        {
            let mut entries = self.entries.lock().await;
            if let Some(entry) = entries.get_mut(&key) {
                let items = dedupe_index_items(items);
                if items.len() >= dedupe_index_items(entry.items.clone()).len() {
                    entry.items = items;
                }
                if entry.items.len() > entry.expected_len {
                    entry.expected_len = entry.items.len();
                }
                entry.complete = entry.expected_len == 0
                    || playlist_index_looks_complete(&entry.items, entry.expected_len);
                entry.fetched_at = Instant::now();
            }
        }
        self.completing.lock().await.remove(&key);
    }

    pub(crate) async fn remember_added_track(
        &self,
        session: &Session,
        playlist_uri: &str,
        track_uri: &str,
        added_at: Option<String>,
    ) {
        let Some(uri) = canonicalize_item_uri(track_uri) else {
            return;
        };
        let key = playlist_cache_identity(playlist_uri);
        let item = match fetch_added_head_item(session, playlist_uri, &uri).await {
            Some(mut item) => {
                if item.added_at.is_none() {
                    item.added_at = added_at;
                }
                if item.added_by.is_none() {
                    item.added_by = crate::playlist_people::person(&session.username(), &session.username());
                }
                item
            }
            None => PlaylistTrackRef {
                uri,
                added_at,
                entry_id: None,
                added_by: crate::playlist_people::person(&session.username(), &session.username()),
            },
        };
        {
            let mut entries = self.entries.lock().await;
            if let Some(entry) = entries.get_mut(&key)
                && entry
                    .items
                    .first()
                    .is_none_or(|first| first.uri != item.uri || first.entry_id.as_ref().zip(item.entry_id.as_ref()).is_some_and(|(old, new)| old != new))
            {
                entry.items.insert(0, item.clone());
                entry.expected_len = entry.expected_len.max(entry.items.len());
                entry.fetched_at = Instant::now();
            }
        }
        let mut playback = self.playback_entries.lock().await;
        if let Some(entry) = playback.as_mut().filter(|entry| entry.playlist_id == key)
            && entry
                .items
                .first()
                .is_none_or(|first| first.uri != item.uri)
        {
            entry.items.insert(0, item);
        }
    }

    /// Libre removes by track URI, which drops every occurrence remotely.
    /// The cache mirrors that so a refresh cannot resurrect a duplicate.
    pub(crate) async fn remember_removed_track(&self, playlist_uri: &str, track_uri: &str) {
        let key = playlist_cache_identity(playlist_uri);
        let Some(canonical) = canonicalize_item_uri(track_uri) else {
            return;
        };
        {
            let mut entries = self.entries.lock().await;
            if let Some(entry) = entries.get_mut(&key) {
                let removed = forget_playlist_track(&mut entry.items, &canonical);
                if removed > 0 {
                    entry.expected_len = entry
                        .expected_len
                        .saturating_sub(removed)
                        .max(entry.items.len());
                    entry.fetched_at = Instant::now();
                }
            }
        }
        let mut playback = self.playback_entries.lock().await;
        if let Some(entry) = playback.as_mut().filter(|entry| entry.playlist_id == key) {
            forget_playlist_track(&mut entry.items, &canonical);
        }
    }
}

/// Removes every occurrence of `track_uri`; returns how many were dropped.
fn forget_playlist_track(items: &mut Vec<PlaylistTrackRef>, track_uri: &str) -> usize {
    let before = items.len();
    items.retain(|item| item.uri != track_uri);
    before - items.len()
}

#[derive(Clone)]
struct PlaylistTrackRef {
    uri: String,
    added_at: Option<String>,
    entry_id: Option<String>,
    added_by: Option<luft_core::PlaylistContributor>,
}

pub(crate) async fn load_playlist_details(
    session: &Session,
    uri: &str,
    request: PageRequest,
    cache: &Arc<PlaylistIndexCache>,
) -> Result<PlaylistDetails, ProviderError> {
    let mut index = load_or_get_index(session, uri, cache).await?;
    if !index.complete && !playlist_index_covers_request(&index, request) {
        index = await_index_progress(cache, uri, index).await;
    }
    if request.offset > 0 && !playlist_index_covers_request(&index, request) {
        warn!(
            adapter = "librespot",
            phase = "playlist-page",
            uri,
            requested_offset = request.offset,
            requested_limit = request.limit,
            known_items = index.items.len(),
            expected_items = index.expected_len,
            "playlist page is waiting for the complete index"
        );
        return Err(ProviderError::ActionRejected {
            message: "Die Playlist wird noch vollständig geladen.".into(),
            retryable: true,
        });
    }
    hydrate_playlist_page(session, &index, request, cache).await
}

fn playlist_index_covers_request(index: &CachedPlaylistIndex, request: PageRequest) -> bool {
    let known = index.items.len() as u32;
    let total = (index.expected_len as u32).max(known);
    let offset = request.offset.min(total);
    let requested_end = offset.saturating_add(request.limit.max(1)).min(total);
    known >= requested_end
}

pub(crate) async fn load_playlist_play_entries(
    session: &Session,
    uri: &str,
    cache: &Arc<PlaylistIndexCache>,
) -> Vec<crate::queue::DatedUri> {
    if let Some(items) = cache.playback_entries(uri).await {
        info!(
            adapter = "librespot",
            phase = "playlist-play-cache",
            outcome = "hit",
            uri,
            entries = items.len(),
            "playlist playback entries reused"
        );
        return items
            .into_iter()
            .map(|item| crate::queue::DatedUri {
                uri: item.uri,
                added_at: item.added_at,
            })
            .collect();
    }
    load_or_get_index(session, uri, cache)
        .await
        .map(|index| {
            index
                .items
                .into_iter()
                .map(|item| crate::queue::DatedUri {
                    uri: item.uri,
                    added_at: item.added_at,
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn load_or_get_index(
    session: &Session,
    uri: &str,
    cache: &Arc<PlaylistIndexCache>,
) -> Result<CachedPlaylistIndex, ProviderError> {
    if let Some(cached) = cached_index(cache, uri).await {
        if !cached.complete {
            spawn_index_complete(session.clone(), cached.clone(), Arc::clone(cache));
        }
        return Ok(cached);
    }
    let loaded = match load_index_from_metadata(session, uri).await {
        Ok(index) => index,
        Err(error) => {
            warn!(
                error = %error,
                uri,
                adapter = "librespot",
                "playlist metadata failed, trying context resolve"
            );
            load_index_from_context(session, uri).await.ok_or(error)?
        }
    };
    cache.insert(loaded.clone()).await;
    if !loaded.complete {
        spawn_index_complete(session.clone(), loaded.clone(), Arc::clone(cache));
    }
    Ok(loaded)
}

async fn cached_index(cache: &PlaylistIndexCache, uri: &str) -> Option<CachedPlaylistIndex> {
    let cached = cache.get(uri).await?;
    if !cached.complete || cached.fetched_at.elapsed() < PLAYLIST_INDEX_TTL {
        return Some(cached);
    }
    None
}

fn spawn_index_complete(
    session: Session,
    index: CachedPlaylistIndex,
    cache: Arc<PlaylistIndexCache>,
) {
    tokio::spawn(async move {
        if !cache.begin_complete(&index.uri).await {
            return;
        }
        let parsed = match SpotifyUri::from_uri(&index.uri) {
            Ok(parsed) => parsed,
            Err(_) => {
                cache.finish_complete(&index.uri, index.items).await;
                return;
            }
        };
        let completed = complete_playlist_items(
            &session,
            &index.uri,
            &parsed,
            index.items,
            index.expected_len,
        )
        .await;
        cache.finish_complete(&index.uri, completed).await;
    });
}

async fn load_index_from_metadata(
    session: &Session,
    uri: &str,
) -> Result<CachedPlaylistIndex, ProviderError> {
    let parsed = SpotifyUri::from_uri(uri).map_err(|error| {
        ProviderError::InvalidRequest(format!("Ungültige Playlist-URI: {error}"))
    })?;
    let playlist = fetch_metadata_playlist(session, &parsed).await?;
    let playlist_uri = playlist.id.to_uri().unwrap_or_else(|_| uri.to_string());
    let items = items_from_playlist(&playlist);
    let reported = playlist.length.max(0) as usize;
    let expected = if reported > 0 { reported } else { 0 };
    Ok(CachedPlaylistIndex {
        fetched_at: Instant::now(),
        uri: playlist_uri,
        name: playlist.name().to_string(),
        owner_name: owner_name(&playlist, &session.username()),
        owner: match &playlist.id { SpotifyUri::Playlist { user: Some(user), .. } => crate::playlist_people::person(user, &session.username()), _ => None },
        collaborative: Some(playlist.attributes.is_collaborative),
        description: nonempty(&playlist.attributes.description),
        cover_uri: playlist_cover(&playlist),
        can_modify: Some(playlist.capabilities.can_edit_items),
        expected_len: expected,
        complete: playlist_index_looks_complete(&items, expected),
        items,
    })
}

fn playlist_index_looks_complete(items: &[PlaylistTrackRef], expected: usize) -> bool {
    (expected == 0 && items.is_empty()) || (expected > 0 && items.len() >= expected)
}

async fn await_index_progress(
    cache: &PlaylistIndexCache,
    uri: &str,
    current: CachedPlaylistIndex,
) -> CachedPlaylistIndex {
    if current.complete {
        return current;
    }
    let started = Instant::now();
    let mut latest = current;
    while started.elapsed() < INDEX_FILL_WAIT {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let Some(cached) = cache.get(uri).await else {
            break;
        };
        latest = cached;
        if latest.complete || latest.items.len() >= latest.expected_len.max(1) {
            break;
        }
    }
    latest
}

pub(crate) async fn fetch_metadata_playlist(
    session: &Session,
    parsed: &SpotifyUri,
) -> Result<Playlist, ProviderError> {
    match tokio::time::timeout(Duration::from_secs(8), Playlist::get(session, parsed)).await {
        Ok(Ok(playlist)) => Ok(playlist),
        Ok(Err(error)) if is_rate_limited(&error) => {
            tokio::time::sleep(Duration::from_millis(800)).await;
            Playlist::get(session, parsed).await.map_err(|error| {
                ProviderError::Internal(format!("Playlist konnte nicht geladen werden: {error}"))
            })
        }
        Ok(Err(error)) => Err(ProviderError::Internal(format!(
            "Playlist konnte nicht geladen werden: {error}"
        ))),
        Err(_) => Err(ProviderError::Internal(
            "Playlist-Metadaten haben zu lange gedauert.".into(),
        )),
    }
}

fn is_rate_limited(error: &librespot::core::Error) -> bool {
    let message = error.to_string();
    message.contains("rate limited") || message.contains("Resource has been exhausted")
}

async fn load_index_from_context(session: &Session, uri: &str) -> Option<CachedPlaylistIndex> {
    let context = tokio::time::timeout(Duration::from_secs(8), session.spclient().get_context(uri))
        .await
        .ok()?
        .ok()?;
    let name = context
        .metadata
        .get("context_description")
        .cloned()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Playlist".into());
    let items = context
        .pages
        .into_iter()
        .flat_map(|page| page.tracks)
        .filter_map(|track| {
            let track_uri = canonicalize_item_uri(track.uri.as_deref()?)?;
            Some(PlaylistTrackRef {
                uri: track_uri,
                added_at: added_at_from_metadata(&track.metadata),
                entry_id: track.uid.filter(|uid| !uid.is_empty()),
                added_by: track.metadata.get("added_by").or_else(|| track.metadata.get("addedBy")).and_then(|raw| crate::playlist_people::person(raw, &session.username())),
            })
        })
        .collect::<Vec<_>>();
    if items.is_empty() {
        return None;
    }
    Some(CachedPlaylistIndex {
        fetched_at: Instant::now(),
        uri: uri.to_string(),
        name,
        owner_name: None,
        owner: None,
        collaborative: None,
        description: None,
        cover_uri: None,
        can_modify: mark_library_playlist_writable(uri, None),
        expected_len: 0,
        complete: false,
        items,
    })
}

fn items_from_playlist(playlist: &Playlist) -> Vec<PlaylistTrackRef> {
    playlist
        .contents
        .items
        .iter()
        .filter_map(|item| {
            Some(PlaylistTrackRef {
                uri: item
                    .id
                    .to_uri()
                    .ok()
                    .and_then(|uri| canonicalize_item_uri(&uri))?,
                added_at: added_at_from_timestamp_ms(item.attributes.timestamp.as_timestamp_ms())
                    .or_else(|| added_at_from_metadata(&item.attributes.format_attributes.0)),
                entry_id: hex_id(&item.attributes.item_id),
                added_by: crate::playlist_people::person(&item.attributes.added_by, ""),
            })
        })
        .collect()
}

async fn complete_playlist_items(
    session: &Session,
    uri: &str,
    parsed: &SpotifyUri,
    mut items: Vec<PlaylistTrackRef>,
    expected: usize,
) -> Vec<PlaylistTrackRef> {
    let Some(playlist_id) = playlist_id(uri) else {
        return items;
    };
    if let Some(mut remote) = fetch_remote_entries(session, playlist_id).await {
        if remote.len() >= items.len()
            && (expected == 0
                || remote.len() >= expected.saturating_sub(8)
                || remote.len() > items.len())
        {
            apply_entry_ids(&mut remote, &items);
            apply_added_at_list(&mut remote, &items);
            remote = dedupe_index_items(remote);
            let dated_before_slices = added_at_count(&remote);
            if dated_before_slices < remote.len() {
                hydrate_missing_added_at_from_playlist_slices(
                    session,
                    parsed,
                    playlist_id,
                    &mut remote,
                )
                .await;
            }
            info!(
                adapter = "librespot",
                phase = "playlist-added-at",
                uri,
                entries = remote.len(),
                dated_entries = added_at_count(&remote),
                dates_before_slices = dated_before_slices,
                "playlist entry dates resolved"
            );
            return remote;
        }
        apply_entry_ids(&mut items, &remote);
        apply_added_at_list(&mut items, &remote);
    }
    let target = if expected == 0 {
        ADDED_AT_MAX_ITEMS as usize
    } else {
        expected.max(items.len())
    };
    extend_from_playlist_slices(session, parsed, playlist_id, &mut items, target).await;
    items
}

async fn hydrate_missing_added_at_from_playlist_slices(
    session: &Session,
    parsed: &SpotifyUri,
    playlist_id: &str,
    items: &mut [PlaylistTrackRef],
) {
    for from in (0..items.len()).step_by(PLAYLIST_SLICE) {
        let end = (from + PLAYLIST_SLICE).min(items.len());
        if items[from..end].iter().all(|item| item.added_at.is_some()) {
            continue;
        }
        let Some(slice) =
            fetch_playlist_slice(session, parsed, playlist_id, from, end - from).await
        else {
            break;
        };
        if slice.is_empty() {
            break;
        }
        let aligned_from = if slice.len() == items.len() { 0 } else { from };
        if !apply_aligned_slice_dates(items, aligned_from, &slice) {
            warn!(
                adapter = "librespot",
                phase = "playlist-added-at",
                offset = from,
                slice_entries = slice.len(),
                "playlist date slice did not match the current entry order"
            );
            break;
        }
        if added_at_count(items) == items.len() {
            break;
        }
    }
}

fn apply_aligned_slice_dates(
    items: &mut [PlaylistTrackRef],
    offset: usize,
    slice: &[PlaylistTrackRef],
) -> bool {
    let Some(target) = items.get_mut(offset..offset.saturating_add(slice.len())) else {
        return false;
    };
    if !target
        .iter()
        .zip(slice)
        .all(|(left, right)| left.uri == right.uri)
    {
        return false;
    }
    for (target, source) in target.iter_mut().zip(slice) {
        if target.added_at.is_none() {
            target.added_at.clone_from(&source.added_at);
        }
        if target.entry_id.is_none() {
            target.entry_id.clone_from(&source.entry_id);
        }
        if target.added_by.is_none() { target.added_by.clone_from(&source.added_by); }
    }
    true
}

fn added_at_count(items: &[PlaylistTrackRef]) -> usize {
    items.iter().filter(|item| item.added_at.is_some()).count()
}

async fn hydrate_playlist_page(
    session: &Session,
    index: &CachedPlaylistIndex,
    request: PageRequest,
    cache: &PlaylistIndexCache,
) -> Result<PlaylistDetails, ProviderError> {
    let known = index.items.len() as u32;
    let total = (index.expected_len as u32).max(known);
    let offset = request.offset.min(total);
    let limit = request.limit.max(1);
    let page = index
        .items
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .cloned()
        .collect::<Vec<_>>();
    let cached_catalog = cache.catalog(&index.uri).await;
    // Everything this playlist's stored copy does not know comes from the
    // shared song service in batches (metadata_batch), not one by one.
    let missing = page.iter()
        .filter(|item| cached_catalog.as_ref().is_none_or(|catalog| !catalog.contains_key(&item.uri)))
        .map(|item| item.uri.clone())
        .collect::<Vec<_>>();
    let fetched = crate::metadata_batch::tracks(session, &missing).await;
    let username = session.username();
    let tracks = page.into_iter().map(|item| {
        let known = cached_catalog.as_ref().and_then(|catalog| catalog.get(&item.uri)).or_else(|| fetched.get(&item.uri));
        let mut media = known.cloned().unwrap_or_else(|| loading_item(&item.uri));
        media.added_at = item.added_at.or(media.added_at);
        media.playlist_entry_id = item.entry_id.or(media.playlist_entry_id);
        // Attribution belongs to this occurrence in this playlist, never a track catalog.
        media.added_by = item.added_by.map(|mut person| { person.is_self = person.username == username; person });
        media
    }).collect::<Vec<_>>();
    Ok(PlaylistDetails {
        uri: index.uri.clone(),
        name: index.name.clone(),
        owner_name: index.owner_name.clone(),
        owner: index.owner.clone(),
        collaborative: index.collaborative,
        description: index.description.clone(),
        cover_uri: index.cover_uri.clone(),
        can_modify: index.can_modify,
        tracks,
        offset,
        limit,
        total: Some(total),
        has_more: offset.saturating_add(limit) < total || !index.complete,
    })
}

pub(crate) async fn repair_placeholder_metadata(
    session: &Session,
    source: &[MediaItem],
) -> Vec<MediaItem> {
    let placeholders = source
        .iter()
        .enumerate()
        .filter(|(_, item)| is_placeholder_title(&item.title, &item.uri))
        .map(|(index, item)| (index, item.uri.clone()))
        .collect::<Vec<_>>();
    if placeholders.is_empty() {
        return source.to_vec();
    }
    let start = REPAIR_CURSOR.fetch_add(REPAIR_BATCH_LIMIT, Ordering::Relaxed) % placeholders.len();
    let targets = placeholders
        .iter()
        .cycle()
        .skip(start)
        .take(REPAIR_BATCH_LIMIT.min(placeholders.len()))
        .cloned()
        .collect::<Vec<_>>();

    let started = Instant::now();
    let mut repaired = source.to_vec();
    let mut resolved = 0usize;
    let uris = targets.iter().map(|(_, uri)| uri.clone()).collect::<Vec<_>>();
    let found = crate::metadata_batch::tracks(session, &uris).await;
    for (index, uri) in &targets {
        if let Some(item) = found.get(uri).cloned()
            && let Some(slot) = repaired.get_mut(*index)
        {
            *slot = merge_media_items(Some(slot), item);
            resolved = resolved.saturating_add(1);
        }
    }

    info!(
        target: "luft_librespot::diagnostics",
        adapter = "librespot",
        phase = "playlist-metadata-repair",
        attempted = targets.len(),
        resolved,
        remaining = targets.len().saturating_sub(resolved),
        elapsed_ms = started.elapsed().as_millis(),
        "playlist placeholder metadata repair completed"
    );
    repaired
}

fn playlist_cache_identity(uri: &str) -> String {
    playlist_id(uri).unwrap_or(uri).to_string()
}

fn owner_name(playlist: &Playlist, session_username: &str) -> Option<String> {
    match &playlist.id {
        SpotifyUri::Playlist { user, .. } => user
            .as_deref()
            .and_then(|name| display_playlist_owner(name, session_username)),
        _ => None,
    }
}

fn display_playlist_owner(raw: &str, session_username: &str) -> Option<String> {
    let name = nonempty(raw)?;
    let session = session_username.trim();
    if !session.is_empty() && name.eq_ignore_ascii_case(session) {
        return Some("Du".into());
    }
    if is_internal_user_id(&name) {
        return None;
    }
    Some(name)
}

fn is_internal_user_id(value: &str) -> bool {
    let len = value.len();
    (20..=32).contains(&len)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

fn playlist_cover(playlist: &Playlist) -> Option<String> {
    playlist
        .attributes
        .picture_sizes
        .iter()
        .find_map(|picture| normalize_cover_url(&picture.url))
        .or_else(|| cover_from_picture_bytes(&playlist.attributes.picture))
        .or_else(|| {
            playlist
                .attributes
                .format_attributes
                .values()
                .find_map(|value| normalize_cover_url(value))
        })
}

/// Search responses for Spotify's own playlists can omit the image even when
/// the playlist metadata includes one. Fetch only that metadata, rather than
/// loading tracks just to derive a fallback cover.
pub(crate) async fn playlist_metadata_cover(session: &Session, uri: &str) -> Option<String> {
    let parsed = SpotifyUri::from_uri(uri).ok()?;
    let playlist = Playlist::get(session, &parsed).await.ok()?;
    playlist_cover(&playlist)
}

/// Spotify does not store an image in the rootlist for playlists without a
/// custom cover. Resolve a real, stable fallback from the first playable item
/// without loading the complete playlist.
pub(crate) async fn playlist_fallback_cover(session: &Session, uri: &str) -> Option<String> {
    let parsed = SpotifyUri::from_uri(uri).ok()?;
    let playlist_id = playlist_id(uri)?;
    let items = fetch_playlist_slice(session, &parsed, playlist_id, 0, 4).await?;
    for item in items.into_iter().take(4) {
        if let Some(cover_uri) = load_metadata_resilient(session, &item.uri, 1)
            .await
            .and_then(|item| item.cover_uri)
        {
            return Some(cover_uri);
        }
    }
    None
}

async fn fetch_remote_entries(
    session: &Session,
    playlist_id: &str,
) -> Option<Vec<PlaylistTrackRef>> {
    if let Some(list) = fetch_added_at_web(session, playlist_id).await {
        return Some(list);
    }
    fetch_added_at_spclient(session, playlist_id).await
}

async fn extend_from_playlist_slices(
    session: &Session,
    parsed: &SpotifyUri,
    playlist_id: &str,
    items: &mut Vec<PlaylistTrackRef>,
    expected: usize,
) {
    while items.len() < expected {
        let from = items.len();
        let Some(slice) =
            fetch_playlist_slice(session, parsed, playlist_id, from, PLAYLIST_SLICE).await
        else {
            break;
        };
        if slice.is_empty()
            || items
                .first()
                .zip(slice.first())
                .is_some_and(|(left, right)| left.uri == right.uri && from > 0)
        {
            break;
        }
        let skip = index_slice_overlap(items, &slice);
        let before = items.len();
        items.extend(slice.into_iter().skip(skip));
        if items.len() <= before {
            break;
        }
    }
}

async fn fetch_playlist_slice(
    session: &Session,
    parsed: &SpotifyUri,
    playlist_id: &str,
    from: usize,
    length: usize,
) -> Option<Vec<PlaylistTrackRef>> {
    let endpoint = format!("/playlist/v2/playlist/{playlist_id}?from={from}&length={length}");
    if let Ok(bytes) = session
        .spclient()
        .request(&Method::GET, &endpoint, None, None)
        .await
    {
        if let Some(items) = playlist_items_from_protobuf(&bytes, parsed)
            && !items.is_empty()
        {
            return Some(items);
        }
        if let Some(page) = parse_entry_page(&bytes)
            && !page.items.is_empty()
        {
            return Some(page.items);
        }
    }
    let bytes = session_http::request(
        session,
        &Method::GET,
        &format!("https://spclient.wg.spotify.com{endpoint}"),
        None,
    )
    .await?;
    parse_entry_page(&bytes)
        .map(|page| page.items)
        .filter(|items| !items.is_empty())
}

fn playlist_items_from_protobuf(
    bytes: &[u8],
    parsed: &SpotifyUri,
) -> Option<Vec<PlaylistTrackRef>> {
    use librespot::metadata::Metadata;
    use protobuf::Message;
    let msg = <Playlist as Metadata>::Message::parse_from_bytes(bytes).ok()?;
    let playlist = Playlist::parse(&msg, parsed).ok()?;
    let items = items_from_playlist(&playlist);
    (!items.is_empty()).then_some(items)
}

async fn fetch_added_at_web(session: &Session, playlist_id: &str) -> Option<Vec<PlaylistTrackRef>> {
    let first = fetch_added_at_web_page(session, playlist_id, 0).await?;
    if first.items.is_empty() {
        return None;
    }
    let mut items = first.items;
    let total = first
        .total
        .unwrap_or(items.len() as u32)
        .min(ADDED_AT_MAX_ITEMS);
    let mut offset = ADDED_AT_PAGE_SIZE;
    while offset < total {
        let Some(page) = fetch_added_at_web_page(session, playlist_id, offset).await else {
            break;
        };
        if page.items.is_empty() {
            break;
        }
        items.extend(page.items);
        offset += ADDED_AT_PAGE_SIZE;
    }
    (!items.is_empty()).then_some(items)
}

async fn fetch_added_at_web_page(
    session: &Session,
    playlist_id: &str,
    offset: u32,
) -> Option<AddedAtPage> {
    let url = format!(
        "https://api.spotify.com/v1/playlists/{playlist_id}/items?offset={offset}&limit={ADDED_AT_PAGE_SIZE}"
    );
    if let Some(bytes) = session_http::request(session, &Method::GET, &url, None).await
        && let Some(page) = parse_entry_page(&bytes)
        && !page.items.is_empty()
    {
        return Some(page);
    }
    let bytes =
        session_http::request_web_api(session, &Method::GET, &url, None, PLAYLIST_READ_SCOPES)
            .await?;
    parse_entry_page(&bytes).filter(|page| !page.items.is_empty())
}

async fn fetch_added_at_spclient(
    session: &Session,
    playlist_id: &str,
) -> Option<Vec<PlaylistTrackRef>> {
    let mut items = Vec::new();
    let mut offset = 0_u32;
    loop {
        let path =
            format!("/playlist/v2/playlist/{playlist_id}/contents?offset={offset}&limit=100");
        let mut page = None;
        for host in [
            "https://spclient.wg.spotify.com",
            "https://api-partner.spotify.com",
        ] {
            if let Some(bytes) =
                session_http::request(session, &Method::GET, &format!("{host}{path}"), None).await
                && let Some(parsed) = parse_entry_page(&bytes)
                && !parsed.items.is_empty()
            {
                page = Some(parsed);
                break;
            }
        }
        let Some(page) = page else {
            break;
        };
        let count = page.items.len() as u32;
        items.extend(page.items);
        let total = page.total.unwrap_or(items.len() as u32);
        offset += count.max(1);
        if offset >= total || count == 0 || items.len() as u32 >= ADDED_AT_MAX_ITEMS {
            break;
        }
    }
    (!items.is_empty()).then_some(items)
}

fn parse_entry_page(bytes: &[u8]) -> Option<AddedAtPage> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let list = value
        .get("items")
        .or_else(|| value.pointer("/contents/items"))
        .or_else(|| value.pointer("/data/playlist/content/items"))
        .or_else(|| value.pointer("/data/playlistV2/content/items"))
        .unwrap_or(&Value::Null);
    let items = match list {
        Value::Array(entries) => entries
            .iter()
            .filter_map(playlist_entry)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    if items.is_empty() {
        return None;
    }
    Some(AddedAtPage {
        total: value
            .get("total")
            .or_else(|| value.pointer("/contents/total"))
            .or_else(|| value.pointer("/data/playlist/content/totalCount"))
            .and_then(Value::as_u64)
            .map(|total| total as u32),
        items,
    })
}

fn playlist_entry(value: &Value) -> Option<PlaylistTrackRef> {
    let uri = json_string(value.pointer("/track/uri"))
        .or_else(|| json_string(value.pointer("/itemV2/data/uri")))
        .or_else(|| json_string(value.pointer("/item/uri")))
        .or_else(|| json_string(value.pointer("/item/track/uri")))
        .or_else(|| json_string(value.get("uri")))
        .and_then(|uri| canonicalize_item_uri(&uri))?;
    let entry_id = json_string(value.get("uid"))
        .or_else(|| json_string(value.pointer("/item/uid")))
        .or_else(|| json_string(value.pointer("/attributes/itemId")))
        .filter(|id| !id.is_empty() && !uri.ends_with(&format!(":{id}")));
    Some(PlaylistTrackRef {
        uri,
        added_at: json_added_at(value.get("added_at"))
            .or_else(|| json_added_at(value.get("addedAt")))
            .or_else(|| json_added_at(value.pointer("/addedAt")))
            .or_else(|| json_added_at(value.pointer("/item/addedAt")))
            .or_else(|| json_added_at(value.pointer("/item/added_at")))
            .or_else(|| json_added_at(value.pointer("/attributes/timestamp")))
            .or_else(|| json_added_at(value.pointer("/item/attributes/timestamp"))),
        entry_id,
        added_by: crate::playlist_people::entry_author(value),
    })
}

fn json_added_at(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(raw)) => added_at_from_raw(raw),
        Some(Value::Number(number)) => number.as_i64().and_then(added_at_from_timestamp_ms),
        Some(Value::Object(object)) => json_string(object.get("isoString"))
            .or_else(|| json_string(object.get("iso8601")))
            .and_then(|raw| added_at_from_raw(&raw))
            .or_else(|| {
                object
                    .get("timestamp")
                    .and_then(Value::as_i64)
                    .and_then(added_at_from_timestamp_ms)
            }),
        _ => None,
    }
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn dedupe_index_items(items: Vec<PlaylistTrackRef>) -> Vec<PlaylistTrackRef> {
    let mut seen = HashSet::<String>::new();
    items
        .into_iter()
        .filter(|item| match &item.entry_id {
            Some(id) if !id.is_empty() => seen.insert(id.clone()),
            _ => true,
        })
        .collect()
}

fn index_slice_overlap(items: &[PlaylistTrackRef], slice: &[PlaylistTrackRef]) -> usize {
    let max = items.len().min(slice.len());
    (1..=max)
        .rev()
        .find(|&len| {
            items[items.len() - len..]
                .iter()
                .zip(&slice[..len])
                .all(|(left, right)| left.uri == right.uri && left.entry_id == right.entry_id)
        })
        .unwrap_or(0)
}

fn apply_entry_ids(items: &mut [PlaylistTrackRef], source: &[PlaylistTrackRef]) {
    let mut by_uri = HashMap::<String, VecDeque<Option<String>>>::new();
    for item in source {
        by_uri
            .entry(item.uri.clone())
            .or_default()
            .push_back(item.entry_id.clone());
    }
    for item in items {
        if item.entry_id.is_some() {
            continue;
        }
        if let Some(entry_id) = by_uri
            .get_mut(&item.uri)
            .and_then(VecDeque::pop_front)
            .flatten()
        {
            item.entry_id = Some(entry_id);
        }
    }
}

async fn fetch_added_head_item(
    session: &Session,
    playlist_uri: &str,
    track_uri: &str,
) -> Option<PlaylistTrackRef> {
    let parsed = SpotifyUri::from_uri(playlist_uri).ok()?;
    let playlist_id = playlist_id(playlist_uri)?;
    let slice = fetch_playlist_slice(session, &parsed, playlist_id, 0, 8).await?;
    slice.into_iter().find(|item| item.uri == track_uri)
}

fn apply_added_at_list(items: &mut [PlaylistTrackRef], dates: &[PlaylistTrackRef]) {
    apply_entry_authors(items, dates);
    let mut by_entry = HashMap::<String, String>::new();
    let mut by_uri = HashMap::<String, VecDeque<Option<String>>>::new();
    for date in dates {
        if let (Some(entry_id), Some(added_at)) = (&date.entry_id, &date.added_at) {
            by_entry.insert(entry_id.clone(), added_at.clone());
        }
        by_uri
            .entry(date.uri.clone())
            .or_default()
            .push_back(date.added_at.clone());
    }
    for item in items {
        let fallback = by_uri
            .get_mut(&item.uri)
            .and_then(VecDeque::pop_front)
            .flatten();
        if item.added_at.is_some() {
            continue;
        }
        if let Some(added_at) = item
            .entry_id
            .as_ref()
            .and_then(|entry_id| by_entry.get(entry_id))
            .cloned()
            .or(fallback)
        {
            item.added_at = Some(added_at);
        }
    }
}

struct AddedAtPage {
    items: Vec<PlaylistTrackRef>,
    total: Option<u32>,
}

fn apply_entry_authors(items: &mut [PlaylistTrackRef], source: &[PlaylistTrackRef]) {
    let mut by_entry = HashMap::new();
    let mut by_uri = HashMap::<String, VecDeque<_>>::new();
    for item in source {
        if let Some(id) = &item.entry_id { by_entry.insert(id.clone(), item); }
        by_uri.entry(item.uri.clone()).or_default().push_back(item);
    }
    for item in items {
        let occurrences = by_uri.get_mut(&item.uri);
        let matched = if let Some(id) = &item.entry_id {
            by_entry.get(id).copied().or_else(|| occurrences.as_ref()?.iter().find(|entry| entry.entry_id.is_none()).copied())
        } else {
            occurrences.as_ref().and_then(|entries| entries.front()).copied()
        };
        if let (Some(entries), Some(matched)) = (occurrences, matched) {
            if let Some(index) = entries.iter().position(|entry| std::ptr::eq(*entry, matched)) { entries.remove(index); }
        }
        if item.added_by.is_none() {
            item.added_by = matched.and_then(|entry| entry.added_by.clone());
        }
    }
}

fn rfc3339(timestamp_ms: i64) -> Option<String> {
    Utc.timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|time| time.to_rfc3339())
}

pub(crate) fn added_at_from_metadata(metadata: &HashMap<String, String>) -> Option<String> {
    const KEYS: &[&str] = &[
        "added_at",
        "addedAt",
        "added-at",
        "add_time",
        "added_time",
        "addedTime",
        "collection.added_at",
    ];
    KEYS.iter().find_map(|key| {
        metadata
            .get(*key)
            .and_then(|value| added_at_from_raw(value))
    })
}

pub(crate) fn added_at_from_raw(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return trimmed
            .parse::<i64>()
            .ok()
            .and_then(added_at_from_timestamp_ms);
    }
    DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|time| time.timestamp_millis())
        .and_then(added_at_from_timestamp_ms)
}

pub(crate) fn added_at_from_timestamp_ms(value: i64) -> Option<String> {
    rfc3339(normalize_epoch_ms(value)?)
}

fn normalize_epoch_ms(value: i64) -> Option<i64> {
    if value <= 0 {
        return None;
    }
    let ms = if value >= 100_000_000_000_000 {
        value / 1_000
    } else if value < 100_000_000_000 {
        value * 1_000
    } else {
        value
    };
    const MIN_MS: i64 = 1_199_145_600_000;
    let max_ms = Utc::now().timestamp_millis().saturating_add(7 * 86_400_000);
    (ms >= MIN_MS && ms <= max_ms).then_some(ms)
}

fn hex_id(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub(crate) fn mark_library_playlist_writable(uri: &str, can_modify: Option<bool>) -> Option<bool> {
    if can_modify.is_some() {
        return can_modify;
    }
    is_generated_playlist(uri).then_some(false)
}

pub(crate) fn playlist_id(uri: &str) -> Option<&str> {
    let uri = uri.trim();
    if let Some(id) = uri.strip_prefix("spotify:playlist:") {
        return (!id.is_empty() && !id.contains(':')).then_some(id);
    }
    uri.starts_with("spotify:user:")
        .then(|| uri.rsplit_once(":playlist:"))
        .flatten()
        .map(|(_, id)| id)
        .filter(|id| !id.is_empty())
}

fn is_generated_playlist(uri: &str) -> bool {
    playlist_id(uri).is_some_and(|id| id.starts_with("37i9dQZF"))
}

fn nonempty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use luft_core::PageRequest;

    #[test]
    fn authors_follow_entry_ids_when_duplicate_songs_move_or_are_replaced() {
        let entry = |id: &str, author: Option<&str>| super::PlaylistTrackRef {
            uri: "spotify:track:one".into(), added_at: None, entry_id: Some(id.into()),
            added_by: author.and_then(|name| crate::playlist_people::person(name, "")),
        };
        let source = vec![entry("first", Some("alice")), entry("second", Some("bob"))];
        let mut current = vec![entry("second", None), entry("new", None), entry("first", None)];
        super::apply_entry_authors(&mut current, &source);
        assert_eq!(current.iter().map(|item| item.added_by.as_ref().map(|person| person.username.as_str())).collect::<Vec<_>>(), vec![Some("bob"), None, Some("alice")]);
    }

    #[test]
    fn first_page_is_not_covered_until_the_index_has_the_window() {
        let index = super::CachedPlaylistIndex {
            fetched_at: std::time::Instant::now(),
            uri: "spotify:playlist:night".into(),
            name: "Night".into(),
            owner_name: None,
            owner: None,
            collaborative: None,
            description: None,
            cover_uri: None,
            can_modify: Some(true),
            items: vec![super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            }],
            expected_len: 80,
            complete: false,
        };
        assert!(!super::playlist_index_covers_request(
            &index,
            PageRequest {
                offset: 0,
                limit: 100,
            }
        ));
        let mut ready = index.clone();
        ready.items = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            };
            80
        ];
        assert!(super::playlist_index_covers_request(
            &ready,
            PageRequest {
                offset: 0,
                limit: 100,
            }
        ));
    }

    #[test]
    fn overlapping_index_slices_are_not_appended_twice() {
        let items = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: Some("a".into()),
                added_by: None,
            },
            super::PlaylistTrackRef {
                uri: "spotify:track:two".into(),
                added_at: None,
                entry_id: Some("b".into()),
                added_by: None,
            },
        ];
        let slice = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:two".into(),
                added_at: None,
                entry_id: Some("b".into()),
                added_by: None,
            },
            super::PlaylistTrackRef {
                uri: "spotify:track:three".into(),
                added_at: None,
                entry_id: Some("c".into()),
                added_by: None,
            },
        ];
        assert_eq!(super::index_slice_overlap(&items, &slice), 1);
        let combined = items.into_iter().chain(slice).collect();
        assert_eq!(
            super::dedupe_index_items(combined)
                .iter()
                .map(|item| item.entry_id.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("a"), Some("b"), Some("c")]
        );
    }

    #[test]
    fn a_short_first_page_is_not_treated_as_the_full_playlist() {
        let items = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            };
            320
        ];
        assert!(!super::playlist_index_looks_complete(&items, 814));
        assert!(super::playlist_index_looks_complete(&items, 320));
        assert!(!super::playlist_index_looks_complete(&items, 0));
    }

    #[test]
    fn playlist_pages_stay_inside_the_requested_window() {
        let request = PageRequest {
            offset: 80,
            limit: 50,
        };
        let total = 95_u32;
        let offset = request.offset.min(total);
        let end = offset.saturating_add(request.limit).min(total);
        assert_eq!(offset, 80);
        assert_eq!(end, 95);
    }

    #[test]
    fn playlist_ids_are_read_from_standard_and_user_uris() {
        assert_eq!(super::playlist_id("spotify:playlist:night"), Some("night"));
        assert_eq!(
            super::playlist_id("spotify:user:sam:playlist:night"),
            Some("night")
        );
        assert_eq!(super::playlist_id("spotify:track:night"), None);
    }

    #[test]
    fn generated_spotify_playlists_are_not_writable() {
        assert!(super::is_generated_playlist(
            "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        ));
        assert_eq!(
            super::mark_library_playlist_writable("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", None),
            Some(false)
        );
        assert_eq!(
            super::mark_library_playlist_writable("spotify:playlist:mine", None),
            None
        );
        assert_eq!(
            super::mark_library_playlist_writable("spotify:playlist:mine", Some(false)),
            Some(false)
        );
    }

    #[test]
    fn longer_remote_lists_replace_truncated_playlist_pages() {
        let payload = serde_json::json!({
            "total": 3,
            "items": [
                { "added_at": "2026-08-19T08:00:00Z", "track": { "uri": "spotify:track:0000000000000000000003" } },
                { "added_at": "2026-01-01T00:00:00Z", "track": { "uri": "spotify:track:0000000000000000000002" } },
                { "added_at": "2024-01-01T00:00:00Z", "track": { "uri": "spotify:track:0000000000000000000001" } }
            ]
        });
        let page = super::parse_entry_page(payload.to_string().as_bytes()).expect("page");
        assert_eq!(page.items.len(), 3);
        assert_eq!(page.total, Some(3));
        assert_eq!(page.items[0].uri, "spotify:track:0000000000000000000003");
    }

    #[test]
    fn web_api_added_dates_overwrite_playlist_order() {
        let payload = serde_json::json!({
            "total": 2,
            "items": [
                {
                    "added_at": "2026-07-14T10:30:00Z",
                    "track": { "uri": "spotify:track:0000000000000000000002" }
                },
                {
                    "added_at": "2024-01-01T00:00:00Z",
                    "track": { "uri": "spotify:track:0000000000000000000001" }
                }
            ]
        });
        let page = super::parse_entry_page(payload.to_string().as_bytes()).expect("page");
        assert_eq!(page.total, Some(2));
        let mut items = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:0000000000000000000001".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            },
            super::PlaylistTrackRef {
                uri: "spotify:track:0000000000000000000002".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            },
        ];
        super::apply_added_at_list(&mut items, &page.items);
        assert!(
            items[1]
                .added_at
                .as_deref()
                .unwrap()
                .starts_with("2026-07-14")
        );
        assert!(
            items[0]
                .added_at
                .as_deref()
                .unwrap()
                .starts_with("2024-01-01")
        );
    }

    #[test]
    fn playlist_seconds_timestamps_are_recovered_as_added_dates() {
        let recovered = super::added_at_from_timestamp_ms(1_784_025_000).expect("seconds");
        assert!(recovered.starts_with("2026-07-14"));
        assert!(super::added_at_from_timestamp_ms(0).is_none());
        assert!(super::added_at_from_timestamp_ms(1_000).is_none());
    }

    #[test]
    fn incomplete_playlist_index_is_not_treated_as_finished() {
        assert!(!super::playlist_index_looks_complete(&[], 40));
        assert!(!super::playlist_index_looks_complete(
            &[super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            }],
            40,
        ));
        assert!(super::playlist_index_looks_complete(
            &[super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            }],
            1,
        ));
    }

    #[test]
    fn playlist_added_dates_are_read_from_context_metadata() {
        let mut metadata = std::collections::HashMap::new();
        metadata.insert("added_at".into(), "1784025000".into());
        let parsed = super::added_at_from_metadata(&metadata).expect("metadata date");
        assert!(parsed.starts_with("2026-07-14"));
    }

    #[test]
    fn own_playlist_owner_is_shown_as_you() {
        assert_eq!(
            super::display_playlist_owner("k3vq8zt2wmd61rx9pfhb4ycn0", "k3vq8zt2wmd61rx9pfhb4ycn0")
                .as_deref(),
            Some("Du")
        );
    }

    #[test]
    fn internal_owner_ids_are_hidden() {
        assert_eq!(
            super::display_playlist_owner("k3vq8zt2wmd61rx9pfhb4ycn0", "someone-else"),
            None
        );
        assert_eq!(
            super::display_playlist_owner("Sam", "someone-else").as_deref(),
            Some("Sam")
        );
    }

    #[test]
    fn forget_playlist_track_drops_every_occurrence_like_the_remote_delete() {
        let item = |uri: &str, uid: &str| super::PlaylistTrackRef {
            uri: uri.into(),
            added_at: None,
            entry_id: Some(uid.into()),
            added_by: None,
        };
        let mut items = vec![
            item("spotify:track:one", "uid-a"),
            item("spotify:track:two", "uid-b"),
            item("spotify:track:one", "uid-c"),
        ];
        assert_eq!(
            super::forget_playlist_track(&mut items, "spotify:track:one"),
            2
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].uri, "spotify:track:two");
        assert_eq!(
            super::forget_playlist_track(&mut items, "spotify:track:one"),
            0
        );
    }

    #[test]
    fn apply_entry_ids_fills_missing_uids_in_uri_order() {
        let source = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: Some("uid-a".into()),
                added_by: None,
            },
            super::PlaylistTrackRef {
                uri: "spotify:track:two".into(),
                added_at: None,
                entry_id: Some("uid-b".into()),
                added_by: None,
            },
        ];
        let mut remote = vec![
            super::PlaylistTrackRef {
                uri: "spotify:track:one".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            },
            super::PlaylistTrackRef {
                uri: "spotify:track:two".into(),
                added_at: None,
                entry_id: None,
                added_by: None,
            },
        ];
        super::apply_entry_ids(&mut remote, &source);
        assert_eq!(remote[0].entry_id.as_deref(), Some("uid-a"));
        assert_eq!(remote[1].entry_id.as_deref(), Some("uid-b"));
    }
}
