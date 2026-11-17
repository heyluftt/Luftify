use std::time::Duration;

use super::*;

fn state(uri: &str, position_ms: u64, is_playing: bool) -> Value {
    serde_json::json!({
        "currentItem": {
            "uri": uri,
            "source": "spotify",
            "itemType": "track",
            "title": "Track",
            "creators": [{"name": "Artist", "uri": "spotify:artist:one"}],
            "albumName": "Album",
            "durationMs": 120_000
        },
        "isPlaying": is_playing,
        "positionMs": position_ms,
        "durationMs": 120_000,
        "contextUri": "spotify:playlist:test",
        "repeatMode": "off"
    })
}

#[test]
fn duplicate_events_accumulate_monotonic_time_only_once() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 1_000, true),
        start + Duration::from_secs(1),
        2_000,
    );
    tracker.on_message(
        "player.playbackChanged",
        &state("spotify:track:one", 1_000, true),
        start + Duration::from_secs(1),
        2_000,
    );
    let session = tracker
        .on_disconnected(start + Duration::from_secs(2), 3_000)
        .expect("session");
    assert_eq!(session.listened_ms, 2_000);
}

#[test]
fn checkpoint_does_not_make_regular_progress_look_like_a_seek() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );

    tracker
        .checkpoint(start + Duration::from_secs(15))
        .expect("checkpoint");
    tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 16_000,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(16),
        17_000,
    );

    let session = tracker
        .on_disconnected(start + Duration::from_secs(17), 18_000)
        .expect("session");
    assert_eq!(session.listened_ms, 17_000);
    assert_eq!(session.seek_count, 0);
}

#[test]
fn librespot_playback_state_payload_starts_a_session() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let payload = serde_json::json!({
        "currentItem": {
            "uri": "spotify:track:one",
            "source": "spotify",
            "itemType": "track",
            "title": "Track",
            "creators": [{"name": "Artist"}],
            "durationMs": 180_000,
            "explicit": false,
            "playable": true
        },
        "isPlaying": true,
        "positionMs": 1_200,
        "durationMs": 180_000,
        "volume": 0.5,
        "isMuted": false,
        "shuffleEnabled": false,
        "repeatMode": "off",
        "isSaved": false,
        "contextUri": "spotify:album:abc",
        "updatedAt": "2026-08-19T10:00:00Z"
    });
    tracker.on_message("player.trackChanged", &payload, start, 1_000);
    let session = tracker
        .checkpoint(start + Duration::from_secs(15))
        .expect("checkpoint");
    assert_eq!(session.track.uri, "spotify:track:one");
    assert_eq!(session.context_type, "album");
    assert_eq!(session.listened_ms, 15_000);
    assert!(!session.qualified_play);
}

#[test]
fn source_lost_finishes_an_active_session() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    let session = tracker
        .on_source_lost(start + Duration::from_secs(2), 3_000, "engine-switched")
        .expect("session");
    assert_eq!(session.end_reason.as_deref(), Some("engine-switched"));
    assert_eq!(session.listened_ms, 2_000);
    assert!(!session.qualified_play);
}

#[test]
fn paused_time_and_seek_distance_are_not_counted_as_listening() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    tracker.on_message(
        "player.playbackChanged",
        &state("spotify:track:one", 1_000, false),
        start + Duration::from_secs(1),
        2_000,
    );
    tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 80_000,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(11),
        12_000,
    );
    let session = tracker
        .on_disconnected(start + Duration::from_secs(12), 13_000)
        .expect("session");
    assert_eq!(session.listened_ms, 1_000);
    assert_eq!(session.pause_count, 1);
    assert_eq!(session.seek_count, 1);
}

#[test]
fn repeat_reset_finishes_cycle_without_changing_track_uri() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 89_000, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);
    for step in 1..=6 {
        tracker.on_message(
            "player.progressChanged",
            &serde_json::json!({
                "trackUri": "spotify:track:one",
                "positionMs": 89_000 + step * 5_000,
                "durationMs": 120_000
            }),
            start + Duration::from_secs(step * 5),
            1_000 + i64::try_from(step).expect("step") * 5_000,
        );
    }
    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 300,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(31),
        32_000,
    );
    assert_eq!(completed.len(), 1);
    assert!(completed[0].completed);
    assert!(completed[0].qualified_play);
    assert_eq!(completed[0].end_reason.as_deref(), Some("repeat"));
    let checkpoint = tracker
        .checkpoint(start + Duration::from_secs(32))
        .expect("new repeat cycle");
    assert_eq!(checkpoint.repeat_cycle, 1);
}

#[test]
fn repeat_one_detects_a_natural_wrap_without_an_exact_end_event() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 80_000, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);

    tracker
        .checkpoint(start + Duration::from_secs(15))
        .expect("checkpoint");
    tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 100_000,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(20),
        21_000,
    );
    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 300,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(40),
        41_000,
    );

    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].end_reason.as_deref(), Some("repeat"));
    assert!(completed[0].qualified_play);
    assert!(completed[0].completed);
    let checkpoint = tracker
        .checkpoint(start + Duration::from_secs(41))
        .expect("new repeat cycle");
    assert_eq!(checkpoint.repeat_cycle, 1);
}

#[test]
fn short_seek_near_the_end_is_not_a_completed_play() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 119_000,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(1),
        2_000,
    );
    let session = tracker
        .on_disconnected(start + Duration::from_secs(2), 3_000)
        .expect("session");

    assert_eq!(session.listened_ms, 2_000);
    assert!(!session.qualified_play);
    assert!(!session.completed);
    assert_eq!(session.seek_count, 1);
}

#[test]
fn seeking_to_zero_in_repeat_one_does_not_start_a_new_cycle() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 40_000, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);

    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 0,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(1),
        2_000,
    );

    assert!(completed.is_empty());
    let checkpoint = tracker
        .checkpoint(start + Duration::from_secs(2))
        .expect("same session");
    assert_eq!(checkpoint.repeat_cycle, 0);
    assert_eq!(checkpoint.seek_count, 1);
}

#[test]
fn previous_near_end_in_repeat_one_is_still_a_seek() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 116_000, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);

    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 0,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(1),
        2_000,
    );

    assert!(completed.is_empty());
    let checkpoint = tracker
        .checkpoint(start + Duration::from_secs(2))
        .expect("same session");
    assert_eq!(checkpoint.repeat_cycle, 0);
    assert_eq!(checkpoint.seek_count, 1);
}

#[test]
fn delayed_seek_to_zero_does_not_look_like_a_natural_wrap() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 110_000, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);

    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:one",
            "positionMs": 0,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(20),
        21_000,
    );

    assert!(completed.is_empty());
    let checkpoint = tracker
        .checkpoint(start + Duration::from_secs(21))
        .expect("same session");
    assert_eq!(checkpoint.repeat_cycle, 0);
    assert_eq!(checkpoint.seek_count, 1);
}

#[test]
fn long_event_gap_is_capped_after_resume() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    let session = tracker
        .on_disconnected(start + Duration::from_secs(120), 121_000)
        .expect("session");
    assert_eq!(session.listened_ms, MAX_ACCUMULATED_GAP_MS);
}

#[test]
fn stale_progress_for_another_track_does_not_end_the_session() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    let completed = tracker.on_message(
        "player.progressChanged",
        &serde_json::json!({
            "trackUri": "spotify:track:two",
            "positionMs": 1_000,
            "durationMs": 120_000
        }),
        start + Duration::from_secs(2),
        3_000,
    );
    assert!(completed.is_empty());
    let session = tracker
        .on_disconnected(start + Duration::from_secs(3), 4_000)
        .expect("session");
    assert_eq!(session.track.uri, "spotify:track:one");
    assert_eq!(session.end_reason.as_deref(), Some("bridge-disconnected"));
    assert_eq!(session.listened_ms, 3_000);
}

#[test]
fn paused_session_is_persisted_once_then_checkpoints_stay_quiet() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    let paused = tracker.on_message(
        "player.playbackChanged",
        &state("spotify:track:one", 2_000, false),
        start + Duration::from_secs(2),
        3_000,
    );
    assert_eq!(paused.len(), 1);
    assert_eq!(paused[0].pause_count, 1);
    assert_eq!(paused[0].listened_ms, 2_000);
    assert!(paused[0].end_reason.is_none());

    assert!(
        tracker
            .checkpoint(start + Duration::from_secs(17))
            .is_none()
    );
    assert!(
        tracker
            .checkpoint(start + Duration::from_secs(32))
            .is_none()
    );

    let session = tracker
        .on_disconnected(start + Duration::from_secs(33), 34_000)
        .expect("session");
    assert_eq!(session.listened_ms, 2_000);
    assert_eq!(session.pause_count, 1);
}

#[test]
fn clear_discards_the_active_session_without_a_late_checkpoint() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message(
        "player.stateChanged",
        &state("spotify:track:one", 0, true),
        start,
        1_000,
    );
    tracker.clear();

    assert!(
        tracker
            .checkpoint(start + Duration::from_secs(20))
            .is_none()
    );
    assert!(
        tracker
            .on_disconnected(start + Duration::from_secs(21), 22_000)
            .is_none()
    );
}

fn progress(position_ms: u64) -> Value {
    serde_json::json!({ "trackUri": "spotify:track:one", "positionMs": position_ms, "durationMs": 120_000 })
}

#[test]
fn restarting_a_song_after_it_counted_is_a_new_play() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    tracker.on_message("player.stateChanged", &state("spotify:track:one", 0, true), start, 1_000);
    for step in 1..=10_u64 {
        tracker.on_message("player.progressChanged", &progress(step * 10_000), start + Duration::from_secs(step * 10), 1_000);
    }
    // "Previous" at 1:40 brings the song back to the top.
    let finished = tracker.on_message("player.progressChanged", &progress(400), start + Duration::from_secs(101), 102_000);
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].end_reason.as_deref(), Some("restart"));
    assert!(finished[0].qualified_play);
    assert_eq!(finished[0].seek_count, 0);
    let next = tracker.checkpoint(start + Duration::from_secs(115)).expect("second play");
    assert_ne!(next.id, finished[0].id);
    assert_eq!(next.repeat_cycle, 0);
}

#[test]
fn repeat_one_wrap_after_a_long_event_gap_still_starts_the_next_cycle() {
    let start = Instant::now();
    let mut tracker = ListeningTracker::new("test".into(), true);
    let mut playback = state("spotify:track:one", 0, true);
    playback["repeatMode"] = Value::String("one".into());
    tracker.on_message("player.stateChanged", &playback, start, 1_000);
    tracker.on_message("player.progressChanged", &progress(90_000), start + Duration::from_secs(90), 91_000);
    // The next event arrives 45 s later, after the wrap: too late for the
    // timing check, which used to leave this as a "seek".
    let finished = tracker.on_message("player.progressChanged", &progress(3_000), start + Duration::from_secs(135), 136_000);
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].end_reason.as_deref(), Some("repeat"));
    assert!(finished[0].completed);
    let next = tracker.checkpoint(start + Duration::from_secs(140)).expect("next cycle");
    assert_eq!(next.repeat_cycle, 1);
}
