use super::*;

// Called only after EndOfTrack passed the request/URI identity checks.
pub(super) fn finish_managed_track(snapshot: &mut PlaybackSnapshot) {
    if snapshot.room_queue_active && !snapshot.handoff_hold {
        // The final progress notification may precede the actual audio end.
        // Publish the exact endpoint so the room cannot mistake EOF for a pause.
        let item = visible_playback_item(snapshot);
        let duration = published_duration_ms(snapshot, item.as_ref());
        if duration > 0 {
            snapshot.position_ms = duration;
        }
    }
    snapshot.is_playing = false;
    snapshot.audio_started = false;
    snapshot.position_updated_at = Instant::now();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn room_end_preserves_the_endpoint_instead_of_stale_progress() {
        let mut snapshot = PlaybackSnapshot::default();
        snapshot.room_queue_active = true;
        snapshot.duration_ms = 180_000;
        snapshot.position_ms = 178_500;
        snapshot.is_playing = true;
        snapshot.audio_started = true;
        finish_managed_track(&mut snapshot);
        let state = snapshot_to_state(&snapshot);
        assert!(!state.is_playing);
        assert_eq!(state.position_ms, state.duration_ms);
        assert_eq!(state.position_ms, 180_000);
    }

    #[test]
    fn handoff_hold_does_not_claim_the_track_finished() {
        let mut snapshot = PlaybackSnapshot::default();
        snapshot.handoff_hold = true;
        snapshot.room_queue_active = true;
        snapshot.duration_ms = 180_000;
        snapshot.position_ms = 12_000;
        finish_managed_track(&mut snapshot);
        assert_eq!(snapshot.position_ms, 12_000);
    }
}
