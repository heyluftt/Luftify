use super::*;

pub(super) async fn update_track_snapshot(
    shared: &Shared,
    session: &Session,
    track: Option<&SpotifyUri>,
    request_id: u64,
    session_epoch: u64,
) -> bool {
    if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
        return false;
    }
    let uri = track.map(spotify_uri_to_string);
    let generation = shared.playback.read().await.play_generation;
    let fetched = match uri.as_deref() {
        Some(uri) => tokio::time::timeout(
            QUEUE_HYDRATE_TRACK_TIMEOUT,
            load_metadata_resilient(session, uri, 3),
        )
        .await
        .ok()
        .flatten(),
        None => None,
    };
    if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
        return false;
    }
    let mut snapshot = shared.playback.write().await;
    if shared.session_epoch.load(Ordering::SeqCst) != session_epoch
        || snapshot.play_generation != generation
        || !player_request_is_current(&snapshot, request_id)
        || uri.as_deref().is_some_and(|uri| {
            snapshot
                .current_item
                .as_ref()
                .is_none_or(|current| !same_item_uri(&current.uri, uri))
        })
    {
        return false;
    }
    merge_track_metadata(&mut snapshot, uri.as_deref(), fetched);
    true
}

// Metadata may arrive after Pause, Resume or Seek for the same player request.
// Only player events own transport state and the playback clock.
fn merge_track_metadata(
    snapshot: &mut PlaybackSnapshot,
    uri: Option<&str>,
    fetched: Option<MediaItem>,
) {
    if let Some(uri) = uri {
        if let Some(item) = fetched {
            snapshot.current_item = Some(merge_media_items(snapshot.current_item.as_ref(), item));
        }
        snapshot.queue.sync_current(uri);
    }
    if let Some(duration_ms) = snapshot
        .current_item
        .as_ref()
        .and_then(|item| item.duration_ms)
        && duration_ms > 0
    {
        snapshot.duration_ms = duration_ms;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_metadata_preserves_pause_resume_and_seek() {
        let uri = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
        // Both directions matter: a Playing fetch can arrive after Pause,
        // and a Paused fetch can arrive after Resume, with the same request ID.
        for playing in [false, true] {
            let mut snapshot = PlaybackSnapshot {
                current_item: Some(loading_item(uri)),
                is_playing: playing,
                audio_started: playing,
                position_ms: 42_000,
                ..PlaybackSnapshot::default()
            };
            let clock = snapshot.position_updated_at;
            let mut fetched = loading_item(uri);
            fetched.title = "Resolved title".into();
            fetched.duration_ms = Some(180_000);
            merge_track_metadata(&mut snapshot, Some(uri), Some(fetched));
            assert_eq!(snapshot.is_playing, playing);
            assert_eq!(snapshot.audio_started, playing);
            assert_eq!(snapshot.position_ms, 42_000);
            assert_eq!(snapshot.position_updated_at, clock);
            assert_eq!(snapshot.duration_ms, 180_000);
            assert_eq!(snapshot.current_item.unwrap().title, "Resolved title");
        }
    }
}
