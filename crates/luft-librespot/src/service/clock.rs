use super::*;

const KEEP_LIVE_POSITION_MS: u64 = 400;

pub(super) fn interpolated_position(snapshot: &PlaybackSnapshot) -> u64 {
    if !snapshot.is_playing || !snapshot.audio_started {
        return snapshot.position_ms;
    }
    let elapsed = snapshot.position_updated_at.elapsed().as_millis() as u64;
    let next = snapshot.position_ms.saturating_add(elapsed);
    if snapshot.duration_ms == 0 {
        next
    } else {
        next.min(snapshot.duration_ms)
    }
}

/// Delayed `Playing` events for the same clock track often arrive at 0 after
/// the local clock already started. A new track must never inherit that clock.
pub(super) fn resolve_confirmed_position(
    clock_track_changed: bool,
    is_playing: bool,
    live_position: u64,
    incoming_position: u64,
) -> u64 {
    if clock_track_changed {
        return incoming_position;
    }
    if is_playing && live_position > incoming_position.saturating_add(KEEP_LIVE_POSITION_MS) {
        live_position
    } else {
        incoming_position
    }
}

pub(super) fn apply_confirmed_player_state(
    snapshot: &mut PlaybackSnapshot,
    uri: &str,
    pending_item: Option<MediaItem>,
    record_previous_in_history: bool,
    is_playing: bool,
    position_ms: u32,
) {
    let identity_changed = snapshot
        .current_item
        .as_ref()
        .is_none_or(|item| !same_item_uri(&item.uri, uri));
    if identity_changed {
        if record_previous_in_history && let Some(previous) = snapshot.current_item.clone() {
            let already_last = snapshot
                .queue
                .history
                .last()
                .is_some_and(|last| same_item_uri(last, &previous.uri));
            if !already_last {
                snapshot.queue.push_history(&previous.uri);
            }
            snapshot.queue.remember_item(&previous);
        }
        let item = pending_item.unwrap_or_else(|| loading_item(uri));
        snapshot.current_item = Some(merge_media_items(snapshot.current_item.as_ref(), item));
        snapshot.queue.sync_current(uri);
        snapshot.is_saved = false;
        snapshot.duration_ms = snapshot
            .current_item
            .as_ref()
            .and_then(|item| item.duration_ms)
            .filter(|ms| *ms > 0)
            .unwrap_or(0);
    } else if let Some(item) = pending_item {
        snapshot.current_item = Some(merge_media_items(snapshot.current_item.as_ref(), item));
    }
    let clock_track_changed = snapshot
        .clock_track_uri
        .as_deref()
        .is_none_or(|clock| !same_item_uri(clock, uri));
    let live_position = interpolated_position(snapshot);
    snapshot.is_playing = is_playing;
    snapshot.audio_started = is_playing;
    let incoming_position = u64::from(position_ms);
    snapshot.position_ms = resolve_confirmed_position(
        clock_track_changed,
        is_playing,
        live_position,
        incoming_position,
    );
    snapshot.clock_track_uri = Some(uri.to_owned());
    if let Some(duration_ms) = snapshot
        .current_item
        .as_ref()
        .and_then(|item| item.duration_ms)
        .filter(|ms| *ms > 0)
    {
        snapshot.duration_ms = duration_ms;
    }
    snapshot.position_updated_at = Instant::now();
}

pub(super) fn start_pending_audio_from_loaded_track(
    snapshot: &mut PlaybackSnapshot,
    uri: &str,
    duration_ms: u64,
) -> bool {
    let matches_expected = snapshot
        .expected_track_uri
        .as_deref()
        .is_some_and(|expected| same_item_uri(expected, uri));
    if !matches_expected {
        return false;
    }
    if duration_ms > 0 {
        snapshot.duration_ms = duration_ms;
        if let Some(expected_item) = snapshot.expected_item.as_mut() {
            expected_item.duration_ms = expected_item
                .duration_ms
                .filter(|ms| *ms > 0)
                .or(Some(duration_ms));
        }
    }
    let expected_clock_is_live = snapshot.audio_started
        && snapshot
            .clock_track_uri
            .as_deref()
            .is_some_and(|clock| same_item_uri(clock, uri));
    if expected_clock_is_live {
        return true;
    }
    snapshot.is_playing = true;
    snapshot.audio_started = false;
    snapshot.position_ms = 0;
    snapshot.clock_track_uri = Some(uri.to_owned());
    snapshot.position_updated_at = Instant::now();
    true
}

pub(super) fn apply_reported_position(
    snapshot: &mut PlaybackSnapshot,
    uri: &str,
    position_ms: u32,
) {
    let incoming_position = u64::from(position_ms);
    let clock_track_changed = snapshot
        .clock_track_uri
        .as_deref()
        .is_none_or(|clock| !same_item_uri(clock, uri));
    let live_position = interpolated_position(snapshot);
    snapshot.position_ms = resolve_confirmed_position(
        clock_track_changed,
        snapshot.is_playing,
        live_position,
        incoming_position,
    );
    if snapshot.is_playing {
        snapshot.audio_started = true;
    }
    snapshot.clock_track_uri = Some(uri.to_owned());
    snapshot.position_updated_at = Instant::now();
}

pub(super) fn apply_seeked_position(snapshot: &mut PlaybackSnapshot, uri: &str, position_ms: u32) {
    snapshot.position_ms = u64::from(position_ms);
    snapshot.clock_track_uri = Some(uri.to_owned());
    if snapshot.is_playing {
        snapshot.audio_started = true;
    }
    snapshot.position_updated_at = Instant::now();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_track_uses_the_player_position_not_the_previous_clock() {
        assert_eq!(resolve_confirmed_position(true, true, 87_000, 0), 0);
        assert_eq!(resolve_confirmed_position(true, true, 87_000, 1_234), 1_234);
    }

    #[test]
    fn delayed_playing_on_the_same_clock_track_keeps_the_live_clock() {
        assert_eq!(resolve_confirmed_position(false, true, 2_500, 0), 2_500);
        assert_eq!(resolve_confirmed_position(false, true, 200, 0), 0);
        assert_eq!(resolve_confirmed_position(false, false, 2_500, 0), 0);
    }
}
