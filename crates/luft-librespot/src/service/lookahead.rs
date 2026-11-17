use super::*;

/// The next song is fetched only once the current one has played this long.
/// Quick skipping otherwise asked Spotify for a key for every next song that
/// never played, and after roughly 30 keys in five minutes Spotify refuses
/// all keys for about two minutes (vendor/librespot-playback/LUFTIFY.md).
const LOOKAHEAD_DELAY: Duration = Duration::from_secs(12);

/// Select exactly the title a manual Next would consume and keep one decoded
/// track ready in Librespot. A full-playlist audio download is both wasteful
/// and unsupported by Player; its single look-ahead slot is the useful fast
/// path for cold installs.
pub(super) fn take_audio_lookahead_request(snapshot: &mut PlaybackSnapshot) -> Option<String> {
    if snapshot.expected_track_uri.is_some() {
        return None;
    }

    let current = effective_cursor_uri(snapshot);
    let target = if snapshot.room_queue_active {
        snapshot.room_queue_next.clone()
    } else {
        snapshot
            .queue
            .explicit
            .first()
            .map(|entry| entry.item.uri.clone())
            .or_else(|| snapshot.queue.peek_next_uri(current.as_deref()))
            .filter(|uri| is_playable_item_uri(uri))
    };

    if target == snapshot.audio_lookahead_uri {
        return None;
    }
    snapshot.audio_lookahead_uri.clone_from(&target);
    target
}

pub(super) async fn dispatch_audio_lookahead(shared: &Shared, uri: String) {
    let Ok(track_id) = SpotifyUri::from_uri(&uri) else {
        return;
    };
    let player = shared
        .session
        .lock()
        .await
        .as_ref()
        .map(|active| Arc::clone(&active.player));
    let Some(player) = player else {
        let mut snapshot = shared.playback.write().await;
        if snapshot.audio_lookahead_uri.as_deref() == Some(uri.as_str()) {
            snapshot.audio_lookahead_uri = None;
        }
        return;
    };

    let playback = Arc::clone(&shared.playback);
    tokio::spawn(async move {
        tokio::time::sleep(LOOKAHEAD_DELAY).await;
        // Meanwhile the listener may have skipped on, or a newer queue head won.
        let snapshot = playback.read().await;
        if !lookahead_still_wanted(&snapshot, &uri) {
            return;
        }
        player.preload(track_id);
        drop(snapshot);
        info!(
            target: "luft_librespot::diagnostics",
            adapter = "librespot",
            phase = "audio-lookahead",
            track_uri = uri_tail(&uri),
            delay_ms = LOOKAHEAD_DELAY.as_millis(),
            "next queue track scheduled for preload"
        );
    });
}

fn lookahead_still_wanted(snapshot: &PlaybackSnapshot, uri: &str) -> bool {
    snapshot.audio_lookahead_uri.as_deref() == Some(uri)
        && snapshot.expected_track_uri.is_none()
        && (!snapshot.room_queue_active || snapshot.room_queue_next.as_deref() == Some(uri))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRACK_A: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
    const TRACK_B: &str = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
    const TRACK_C: &str = "spotify:track:7ouMYWpwJ422jRcDASZB7P";

    #[test]
    fn explicit_queue_item_wins_over_context_lookahead() {
        let mut snapshot = snapshot_with_upcoming();
        snapshot.queue.push_explicit(loading_item(TRACK_C));

        assert_eq!(
            take_audio_lookahead_request(&mut snapshot).as_deref(),
            Some(TRACK_C)
        );
    }

    #[test]
    fn lookahead_is_deduplicated_and_pauses_during_a_committed_load() {
        let mut snapshot = snapshot_with_upcoming();

        assert_eq!(
            take_audio_lookahead_request(&mut snapshot).as_deref(),
            Some(TRACK_B)
        );
        assert_eq!(take_audio_lookahead_request(&mut snapshot), None);

        begin_expected_track(&mut snapshot, TRACK_B);
        assert_eq!(snapshot.audio_lookahead_uri, None);
        assert_eq!(take_audio_lookahead_request(&mut snapshot), None);
    }

    fn snapshot_with_upcoming() -> PlaybackSnapshot {
        let mut snapshot = PlaybackSnapshot {
            current_item: Some(loading_item(TRACK_A)),
            ..PlaybackSnapshot::default()
        };
        snapshot.queue.upcoming.push(QueueItem {
            item: loading_item(TRACK_B),
            uid: Some("c0".into()),
        });
        snapshot
    }

    #[test]
    fn a_skip_before_the_delay_cancels_the_preload() {
        let mut snapshot = snapshot_with_upcoming();
        let target = take_audio_lookahead_request(&mut snapshot).expect("next song");
        assert!(lookahead_still_wanted(&snapshot, &target));
        // Skipping starts the next load; the pending preload is no longer wanted.
        begin_expected_track(&mut snapshot, TRACK_C);
        assert!(!lookahead_still_wanted(&snapshot, &target));
    }

    #[test]
    fn room_head_overrides_local_queue_and_removal_invalidates_lookahead() {
        let mut snapshot = snapshot_with_upcoming();
        snapshot.room_queue_active = true;
        snapshot.room_queue_next = Some(TRACK_C.into());
        assert_eq!(
            take_audio_lookahead_request(&mut snapshot).as_deref(),
            Some(TRACK_C)
        );
        snapshot.room_queue_next = None;
        assert_eq!(take_audio_lookahead_request(&mut snapshot), None);
        assert!(snapshot.audio_lookahead_uri.is_none());
        snapshot.room_queue_active = false;
        assert_eq!(
            take_audio_lookahead_request(&mut snapshot).as_deref(),
            Some(TRACK_B)
        );
    }
}
