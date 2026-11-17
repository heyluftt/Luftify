use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use luft_core::{MediaItem, PageRequest, PlaylistDetails};
use luft_infrastructure::DatabaseHandle;
use tracing::info;

use crate::{error::CommandError, state::AppState};

const SNAPSHOT_PAGE_SIZE: u32 = 100;
const MAX_SNAPSHOT_TRACKS: u32 = 100_000;
const LIBRESPOT_FILL_PAGES: u32 = 12;
const LIBRESPOT_FILL_BUDGET: Duration = Duration::from_secs(4);

pub async fn read(state: &AppState, uri: &str) -> Result<Option<PlaylistDetails>, CommandError> {
    read_from_database(&state.database, uri).await
}

pub async fn read_from_database(
    database: &DatabaseHandle,
    uri: &str,
) -> Result<Option<PlaylistDetails>, CommandError> {
    let database = database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let canonical_uri = canonical_playlist_uri(uri);
    for version in [3, 2, 1] {
        let cached: Option<PlaylistDetails> = database
            .cached(&snapshot_cache_key_version(&canonical_uri, version))
            .await
            .map_err(|error| CommandError::internal(error.to_string()))?;
        if cached.is_some() {
            return Ok(cached);
        }
    }
    if canonical_uri != uri {
        for version in [3, 2, 1] {
            let cached: Option<PlaylistDetails> = database
                .cached(&raw_snapshot_cache_key_version(uri, version))
                .await
                .map_err(|error| CommandError::internal(error.to_string()))?;
            if cached.is_some() {
                return Ok(cached);
            }
        }
    }
    Ok(None)
}

pub async fn invalidate(state: &AppState, uri: &str) -> Result<(), CommandError> {
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let canonical_uri = canonical_playlist_uri(uri);
    database
        .clear_cache_prefix(&snapshot_cache_prefix(&canonical_uri))
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    if canonical_uri != uri {
        database
            .clear_cache_prefix(&raw_snapshot_cache_prefix(uri))
            .await
            .map_err(|error| CommandError::internal(error.to_string()))?;
    }
    Ok(())
}

pub async fn refresh(state: &AppState, uri: &str) -> Result<PlaylistDetails, CommandError> {
    let started = std::time::Instant::now();
    let cached = read(state, uri).await?;
    if state.uses_librespot()
        && let Some(cached) = cached.as_ref()
    {
        let seeded = state
            .librespot
            .seed_playlist_catalog_cache(uri, &cached.tracks)
            .await;
        info!(
            phase = "playlist-catalog-cache",
            adapter = "sqlite-to-librespot",
            uri,
            seeded_items = seeded,
            "playlist metadata cache seeded"
        );
    }
    let first = match super::library::fetch_playlist(
        state,
        uri,
        PageRequest {
            offset: 0,
            limit: SNAPSHOT_PAGE_SIZE,
        },
    )
    .await
    {
        Ok(first) => first,
        Err(error) => {
            if let Some(cached) = cached.clone().filter(|item| !item.tracks.is_empty()) {
                log_snapshot("cached-fallback", &cached, started.elapsed().as_millis());
                return Ok(cached);
            }
            return Err(error);
        }
    };

    if let Some(cached) = cached.as_ref() {
        if snapshot_is_complete(cached)
            && !snapshot_is_truncated(cached)
            && snapshot_total(&first).is_ok_and(|total| total <= cached.tracks.len() as u32)
        {
            match reconcile_snapshot(state, uri, cached, &first).await {
                Ok(Some(updated)) => {
                    let updated = merge_snapshot_dates(updated, cached);
                    let updated = repair_and_store_snapshot(state, uri, updated).await?;
                    log_snapshot("incremental", &updated, started.elapsed().as_millis());
                    return Ok(updated);
                }
                Ok(None) => {}
                Err(_) => {
                    let cached = repair_and_store_snapshot(state, uri, cached.clone()).await?;
                    log_snapshot("cached-fallback", &cached, started.elapsed().as_millis());
                    return Ok(cached);
                }
            }
        } else if let Some(continued) =
            continue_incomplete_snapshot(state, uri, cached, &first).await?
        {
            let continued = merge_snapshot_dates(continued, cached);
            return finish_snapshot(state, uri, continued, &first, started).await;
        }
    }

    let merged = if let Some(cached) = cached.as_ref() {
        merge_snapshot_dates(first, cached)
    } else {
        first
    };
    let first_page = merged.clone();
    finish_snapshot(state, uri, merged, &first_page, started).await
}

async fn finish_snapshot(
    state: &AppState,
    uri: &str,
    details: PlaylistDetails,
    first_page: &PlaylistDetails,
    started: std::time::Instant,
) -> Result<PlaylistDetails, CommandError> {
    let details = if state.uses_librespot() {
        fill_librespot_snapshot(state, uri, details, first_page, started).await?
    } else {
        details
    };
    let status = if details.has_more {
        "continued"
    } else if snapshot_is_complete(&details) {
        "complete"
    } else {
        "first-page"
    };
    let details = repair_and_store_snapshot(state, uri, details).await?;
    log_snapshot(status, &details, started.elapsed().as_millis());
    Ok(details)
}

async fn fill_librespot_snapshot(
    state: &AppState,
    uri: &str,
    mut details: PlaylistDetails,
    first_page: &PlaylistDetails,
    started: std::time::Instant,
) -> Result<PlaylistDetails, CommandError> {
    let mut pages = 0_u32;
    while details.has_more
        && pages < LIBRESPOT_FILL_PAGES
        && started.elapsed() < LIBRESPOT_FILL_BUDGET
    {
        match continue_incomplete_snapshot(state, uri, &details, first_page).await? {
            Some(next) if next.tracks.len() > details.tracks.len() => {
                details = merge_snapshot_dates(next, &details);
                pages += 1;
            }
            _ => break,
        }
    }
    Ok(details)
}

async fn repair_and_store_snapshot(
    state: &AppState,
    uri: &str,
    mut details: PlaylistDetails,
) -> Result<PlaylistDetails, CommandError> {
    let before = placeholder_count(&details.tracks);
    if before > 0 && state.uses_librespot() {
        details.tracks = state
            .librespot
            .repair_playlist_metadata(&details.tracks)
            .await;
        let after = placeholder_count(&details.tracks);
        let seeded = state
            .librespot
            .seed_playlist_catalog_cache(uri, &details.tracks)
            .await;
        info!(
            phase = "playlist-snapshot-self-repair",
            adapter = "librespot",
            uri,
            placeholders_before = before,
            placeholders_after = after,
            repaired = before.saturating_sub(after),
            seeded_items = seeded,
            "playlist snapshot metadata health checked"
        );
    }
    store(state, uri, &details).await?;
    Ok(details)
}

fn placeholder_count(tracks: &[MediaItem]) -> usize {
    tracks
        .iter()
        .filter(|track| is_placeholder_track(track))
        .count()
}

fn is_placeholder_track(track: &MediaItem) -> bool {
    let title = track.title.trim();
    let uri_tail = track.uri.rsplit(':').next().unwrap_or_default();
    title.is_empty()
        || title.starts_with("Titel wird geladen")
        || title == "Unbekannter Titel"
        || title == track.uri
        || title == uri_tail
        || (title.len() == 22 && title.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

async fn reconcile_snapshot(
    state: &AppState,
    uri: &str,
    cached: &PlaylistDetails,
    first: &PlaylistDetails,
) -> Result<Option<PlaylistDetails>, CommandError> {
    let old_total = cached.tracks.len() as u32;
    let new_total = snapshot_total(first)?;

    if new_total < old_total || !same_prefix(&cached.tracks, &first.tracks) {
        return Ok(None);
    }

    if new_total > old_total {
        if old_total > 0 {
            let tail_offset = old_total.saturating_sub(SNAPSHOT_PAGE_SIZE);
            let tail = super::library::fetch_playlist(
                state,
                uri,
                PageRequest {
                    offset: tail_offset,
                    limit: SNAPSHOT_PAGE_SIZE,
                },
            )
            .await?;
            if !same_cached_slice(cached, &tail) {
                return Ok(None);
            }
        }
        let appended = fetch_pages(state, uri, old_total, new_total).await?;
        if !pages_reach_playlist_end(&appended, new_total) {
            return Ok(None);
        }
        let extra = appended.into_iter().flat_map(|page| page.tracks).collect();
        let tracks = extend_snapshot_tracks(cached.tracks.clone(), extra);
        return Ok(Some(complete_details(first, tracks, new_total)));
    }

    if new_total == 0 {
        return Ok(Some(complete_details(first, Vec::new(), 0)));
    }

    let tail_offset = new_total.saturating_sub(SNAPSHOT_PAGE_SIZE);
    let tail = super::library::fetch_playlist(
        state,
        uri,
        PageRequest {
            offset: tail_offset,
            limit: SNAPSHOT_PAGE_SIZE,
        },
    )
    .await?;

    if tail.has_more || !same_cached_slice(cached, &tail) {
        return Ok(None);
    }

    Ok(Some(complete_details(
        first,
        cached.tracks.clone(),
        new_total,
    )))
}

async fn continue_incomplete_snapshot(
    state: &AppState,
    uri: &str,
    cached: &PlaylistDetails,
    first: &PlaylistDetails,
) -> Result<Option<PlaylistDetails>, CommandError> {
    if cached.tracks.is_empty() {
        return Ok(None);
    }
    if !cached.has_more && !snapshot_is_truncated(cached) {
        return Ok(None);
    }
    if !same_prefix(&cached.tracks, &first.tracks) {
        return Ok(None);
    }
    let total = snapshot_total(first)?;
    let loaded = cached.tracks.len() as u32;
    if loaded >= total {
        return Ok(Some(complete_details(first, cached.tracks.clone(), total)));
    }
    let next = super::library::fetch_playlist(
        state,
        uri,
        PageRequest {
            offset: loaded,
            limit: SNAPSHOT_PAGE_SIZE,
        },
    )
    .await?;
    let tracks = extend_snapshot_tracks(cached.tracks.clone(), next.tracks);
    Ok(Some(complete_details(first, tracks, total)))
}

fn extend_snapshot_tracks(cached: Vec<MediaItem>, next: Vec<MediaItem>) -> Vec<MediaItem> {
    let skip = overlapping_prefix_len(&cached, &next);
    let mut tracks = cached;
    tracks.extend(next.into_iter().skip(skip));
    dedupe_snapshot_entry_ids(tracks)
}

fn overlapping_prefix_len(cached: &[MediaItem], next: &[MediaItem]) -> usize {
    let max = cached.len().min(next.len());
    (1..=max)
        .rev()
        .find(|&len| same_prefix(&cached[cached.len() - len..], &next[..len]))
        .unwrap_or(0)
}

fn dedupe_snapshot_entry_ids(tracks: Vec<MediaItem>) -> Vec<MediaItem> {
    let mut seen = HashSet::<String>::new();
    tracks
        .into_iter()
        .filter(|track| match &track.playlist_entry_id {
            Some(id) if !id.is_empty() => seen.insert(id.clone()),
            _ => true,
        })
        .collect()
}

async fn fetch_pages(
    state: &AppState,
    uri: &str,
    start_offset: u32,
    total: u32,
) -> Result<Vec<PlaylistDetails>, CommandError> {
    if total > MAX_SNAPSHOT_TRACKS {
        return Err(CommandError::internal(
            "Die Playlist meldet eine ungültig große Titelanzahl.",
        ));
    }
    if start_offset >= total {
        return Ok(Vec::new());
    }

    let offsets = (start_offset..total)
        .step_by(SNAPSHOT_PAGE_SIZE as usize)
        .collect::<Vec<_>>();
    let mut pages = Vec::with_capacity(offsets.len());
    for offset in offsets {
        pages.push(
            super::library::fetch_playlist(
                state,
                uri,
                PageRequest {
                    offset,
                    limit: SNAPSHOT_PAGE_SIZE,
                },
            )
            .await?,
        );
    }
    pages.sort_by_key(|page| page.offset);
    Ok(pages)
}

fn pages_reach_playlist_end(pages: &[PlaylistDetails], total: u32) -> bool {
    pages.last().is_some_and(|page| {
        !page.has_more && page.offset.saturating_add(page.tracks.len() as u32) >= total
    })
}

async fn store(state: &AppState, uri: &str, details: &PlaylistDetails) -> Result<(), CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .cache_persistent(&snapshot_cache_key(uri), "spotify-bridge", details)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

fn complete_details(
    metadata: &PlaylistDetails,
    mut tracks: Vec<MediaItem>,
    total: u32,
) -> PlaylistDetails {
    tracks.truncate(total as usize);
    let loaded = tracks.len() as u32;
    PlaylistDetails {
        uri: metadata.uri.clone(),
        name: metadata.name.clone(),
        owner_name: metadata.owner_name.clone(),
        owner: metadata.owner.clone(),
        collaborative: metadata.collaborative,
        description: metadata.description.clone(),
        cover_uri: metadata.cover_uri.clone(),
        can_modify: metadata.can_modify,
        tracks,
        offset: 0,
        limit: loaded,
        total: Some(total),
        has_more: loaded < total,
    }
}

fn snapshot_is_complete(details: &PlaylistDetails) -> bool {
    !details.has_more
        && !snapshot_is_truncated(details)
        && details
            .total
            .is_none_or(|total| details.tracks.len() as u32 >= total)
}

fn snapshot_is_truncated(details: &PlaylistDetails) -> bool {
    details
        .total
        .is_some_and(|total| (details.tracks.len() as u32).saturating_add(8) < total)
}

fn snapshot_total(details: &PlaylistDetails) -> Result<u32, CommandError> {
    let total = details.total.unwrap_or(details.tracks.len() as u32);
    if total > MAX_SNAPSHOT_TRACKS {
        return Err(CommandError::internal(
            "Die Playlist meldet eine ungültig große Titelanzahl.",
        ));
    }
    Ok(total)
}

fn same_prefix(cached: &[MediaItem], current: &[MediaItem]) -> bool {
    cached
        .iter()
        .zip(current)
        .all(|(left, right)| same_track(left, right))
}

fn same_cached_slice(cached: &PlaylistDetails, page: &PlaylistDetails) -> bool {
    cached
        .tracks
        .get(page.offset as usize..)
        .is_some_and(|tracks| same_prefix(tracks, &page.tracks))
}

fn same_track(left: &MediaItem, right: &MediaItem) -> bool {
    left.uri == right.uri
        && match (&left.playlist_entry_id, &right.playlist_entry_id) {
            (Some(left_id), Some(right_id)) => left_id == right_id,
            _ => true,
        }
}

fn dated_count(details: &PlaylistDetails) -> usize {
    details
        .tracks
        .iter()
        .filter(|track| {
            track
                .added_at
                .as_ref()
                .is_some_and(|value| !value.is_empty())
        })
        .count()
}

#[cfg(test)]
fn should_keep_cached(cached: &PlaylistDetails, incoming: &PlaylistDetails) -> bool {
    if !snapshot_is_complete(cached) || snapshot_is_truncated(cached) {
        return false;
    }
    if snapshot_is_complete(incoming) {
        return false;
    }
    let cached_len = cached.tracks.len();
    let incoming_len = incoming.tracks.len();
    if incoming_len <= cached_len.saturating_add(8) {
        return true;
    }
    false
}

fn merge_snapshot_dates(
    mut incoming: PlaylistDetails,
    cached: &PlaylistDetails,
) -> PlaylistDetails {
    let mut by_entry = HashMap::<String, MediaItem>::new();
    let mut by_uri = HashMap::<String, VecDeque<MediaItem>>::new();
    for track in &cached.tracks {
        if let Some(entry_id) = &track.playlist_entry_id {
            by_entry.insert(entry_id.clone(), track.clone());
        }
        by_uri
            .entry(track.uri.clone())
            .or_default()
            .push_back(track.clone());
    }
    for track in &mut incoming.tracks {
        let cached_track = track
            .playlist_entry_id
            .as_ref()
            .and_then(|entry_id| by_entry.get(entry_id))
            .cloned()
            .or_else(|| by_uri.get_mut(&track.uri).and_then(VecDeque::pop_front));
        let Some(cached_track) = cached_track else {
            continue;
        };
        if is_placeholder_track(track) && !is_placeholder_track(&cached_track) {
            let fresh_added_by = track.added_by.clone();
            let fresh_added_at = track.added_at.clone();
            let fresh_entry_id = track.playlist_entry_id.clone();
            let fresh_playable = track.playable;
            *track = cached_track.clone();
            track.added_at = fresh_added_at.or(cached_track.added_at.clone());
            track.playlist_entry_id = fresh_entry_id.or(cached_track.playlist_entry_id.clone());
            track.playable = fresh_playable;
            track.added_by = fresh_added_by.or(cached_track.added_by.clone());
        } else {
            if track.added_by.is_none() { track.added_by = cached_track.added_by.clone(); }
            if track.playlist_entry_id.is_none() {
                track.playlist_entry_id = cached_track.playlist_entry_id.clone();
            }
            if track.added_at.as_ref().is_none_or(|value| value.is_empty()) {
                track.added_at = cached_track.added_at.filter(|value| !value.is_empty());
            }
        }
    }
    incoming
}

fn snapshot_cache_key(uri: &str) -> String {
    snapshot_cache_key_version(uri, 3)
}

fn snapshot_cache_key_version(uri: &str, version: u8) -> String {
    format!("{}{}", snapshot_cache_prefix(uri), version)
}

fn raw_snapshot_cache_key_version(uri: &str, version: u8) -> String {
    format!("{}{}", raw_snapshot_cache_prefix(uri), version)
}

fn snapshot_cache_prefix(uri: &str) -> String {
    raw_snapshot_cache_prefix(&canonical_playlist_uri(uri))
}

fn raw_snapshot_cache_prefix(uri: &str) -> String {
    format!("spotify.playlist.snapshot.{uri}.v")
}

fn canonical_playlist_uri(uri: &str) -> String {
    let uri = uri.trim();
    if let Some(id) = uri.strip_prefix("spotify:playlist:")
        && !id.is_empty()
        && !id.contains(':')
    {
        return format!("spotify:playlist:{id}");
    }
    if uri.starts_with("spotify:user:")
        && let Some((_, id)) = uri.rsplit_once(":playlist:")
        && !id.is_empty()
        && !id.contains(':')
    {
        return format!("spotify:playlist:{id}");
    }
    uri.to_string()
}

fn log_snapshot(status: &str, details: &PlaylistDetails, duration_ms: u128) {
    let dated_items = dated_count(details);
    info!(
        phase = "playlist-snapshot",
        duration_ms,
        status,
        adapter = "sqlite-and-spotify-bridge",
        uri = %details.uri,
        items = details.tracks.len(),
        total = details.total.unwrap_or(details.tracks.len() as u32),
        has_more = details.has_more,
        dated_items,
        undated_items = details.tracks.len().saturating_sub(dated_items),
        "library timing"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_core::{MediaItemType, MediaSource};

    #[test]
    fn detects_equal_cached_slices_without_reordering() {
        let cached = details(vec![track("a"), track("b"), track("c")]);
        let mut page = details(vec![track("b"), track("c")]);
        page.offset = 1;
        assert!(same_cached_slice(&cached, &page));
    }

    #[test]
    fn rejects_changed_cached_slices() {
        let cached = details(vec![track("a"), track("b"), track("c")]);
        let mut page = details(vec![track("x"), track("c")]);
        page.offset = 1;
        assert!(!same_cached_slice(&cached, &page));
    }

    #[test]
    fn track_identity_ignores_added_at_so_dates_can_be_merged() {
        let mut left = track("a");
        let mut right = track("a");
        left.added_at = Some("2026-01-01T00:00:00Z".into());
        right.added_at = None;
        assert!(same_track(&left, &right));
    }

    #[test]
    fn keeps_a_complete_cached_snapshot_when_the_refresh_is_truncated() {
        let cached = details(vec![track("a"), track("b"), track("c")]);
        let mut incoming = details(vec![track("a")]);
        incoming.total = Some(3);
        incoming.has_more = true;
        assert!(should_keep_cached(&cached, &incoming));
    }

    #[test]
    fn keeps_a_complete_cache_until_a_larger_refresh_is_complete() {
        let mut cached = details((0..3).map(|index| track(&format!("{index}"))).collect());
        cached.total = Some(3);
        let mut incoming = details((0..3).map(|index| track(&format!("{index}"))).collect());
        incoming.total = Some(8);
        incoming.has_more = true;
        assert!(should_keep_cached(&cached, &incoming));
        assert!(!snapshot_is_complete(&incoming));
    }

    #[test]
    fn accepts_a_confirmed_playlist_shrink() {
        let cached = details(vec![track("a"), track("b"), track("c")]);
        let incoming = details(vec![track("a")]);
        assert!(!should_keep_cached(&cached, &incoming));
    }

    #[test]
    fn canonicalizes_legacy_playlist_uris_for_the_snapshot_cache() {
        assert_eq!(
            canonical_playlist_uri("spotify:user:sam:playlist:night"),
            "spotify:playlist:night"
        );
        assert_eq!(
            snapshot_cache_key("spotify:user:sam:playlist:night"),
            snapshot_cache_key("spotify:playlist:night")
        );
    }

    #[test]
    fn fills_missing_added_dates_from_the_cached_snapshot() {
        let cached = details(vec![track("a")]);
        let mut incoming = details(vec![track("a")]);
        incoming.tracks[0].added_at = None;
        let merged = merge_snapshot_dates(incoming, &cached);
        assert_eq!(
            merged.tracks[0].added_at.as_deref(),
            Some("2026-07-26T00:00:00Z")
        );
    }

    #[test]
    fn keeps_a_fresh_added_date_instead_of_overwriting_it_from_cache() {
        let cached = details(vec![track("a")]);
        let mut incoming = details(vec![track("a")]);
        incoming.tracks[0].added_at = Some("2026-08-22T00:00:00Z".into());
        let merged = merge_snapshot_dates(incoming, &cached);
        assert_eq!(
            merged.tracks[0].added_at.as_deref(),
            Some("2026-08-22T00:00:00Z")
        );
    }

    #[test]
    fn overlapping_pages_do_not_duplicate_tracks() {
        let cached = vec![track("a"), track("b"), track("c")];
        let next = vec![track("b"), track("c"), track("d")];
        assert_eq!(overlapping_prefix_len(&cached, &next), 2);
        assert_eq!(
            extend_snapshot_tracks(cached, next)
                .iter()
                .map(|track| track.uri.as_str())
                .collect::<Vec<_>>(),
            vec![
                "spotify:track:a",
                "spotify:track:b",
                "spotify:track:c",
                "spotify:track:d",
            ]
        );
    }

    #[test]
    fn duplicate_entry_ids_are_removed_from_the_snapshot() {
        let mut first = track("a");
        let mut again = track("a");
        first.playlist_entry_id = Some("entry-a".into());
        again.playlist_entry_id = Some("entry-a".into());
        let tracks = dedupe_snapshot_entry_ids(vec![first, again, track("b")]);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[1].uri, "spotify:track:b");
    }

    #[test]
    fn fills_missing_playlist_entry_ids_from_the_cached_snapshot() {
        let cached = details(vec![track("a")]);
        let mut incoming = details(vec![track("a")]);
        incoming.tracks[0].playlist_entry_id = None;
        let merged = merge_snapshot_dates(incoming, &cached);
        assert_eq!(
            merged.tracks[0].playlist_entry_id.as_deref(),
            Some("entry-a")
        );
    }

    #[test]
    fn rejects_unbounded_provider_totals_before_allocating_page_offsets() {
        let mut page = details(Vec::new());
        page.total = Some(MAX_SNAPSHOT_TRACKS + 1);
        assert!(snapshot_total(&page).is_err());
    }

    fn details(tracks: Vec<MediaItem>) -> PlaylistDetails {
        PlaylistDetails {
            owner: None,
            collaborative: None,
            uri: "spotify:playlist:test".into(),
            name: "Test".into(),
            owner_name: None,
            description: None,
            cover_uri: None,
            can_modify: Some(true),
            total: Some(tracks.len() as u32),
            limit: tracks.len() as u32,
            tracks,
            offset: 0,
            has_more: false,
        }
    }

    fn track(uri: &str) -> MediaItem {
        MediaItem {
            uri: format!("spotify:track:{uri}"),
            source: MediaSource::Spotify,
            item_type: MediaItemType::Track,
            title: uri.into(),
            creators: Vec::new(),
            album_name: None,
            album_uri: None,
            duration_ms: None,
            play_count: None,
            cover_uri: None,
            canvas_url: None,
            added_at: Some("2026-07-26T00:00:00Z".into()),
            playlist_entry_id: Some(format!("entry-{uri}")),
            added_by: None,
            explicit: false,
            playable: true,
        }
    }
}
