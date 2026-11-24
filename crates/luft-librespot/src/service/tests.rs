use super::*;
use librespot::connect::{LoadContextOptions, PlayingTrack};

const TRACK_A: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
const TRACK_B: &str = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
const TRACK_C: &str = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
const TRACK_X: &str = "spotify:track:6habFhsOp2NvshLv26DqMb";

#[test]
fn blank_audio_device_names_fall_back_to_windows_default() {
    assert_eq!(sanitize_output_device(None), None);
    assert_eq!(sanitize_output_device(Some(String::new())), None);
    assert_eq!(sanitize_output_device(Some("  ".into())), None);
    assert_eq!(
        sanitize_output_device(Some("  Voicemeeter Input  ".into())).as_deref(),
        Some("Voicemeeter Input")
    );
}

#[test]
fn player_setup_maps_quality_and_loudness_to_librespot() {
    use librespot::playback::config::Bitrate;
    use luft_audio::{LoudnessNormalization, PlayerSetup, StreamingQuality};
    let default = player_config(&PlayerSetup::default());
    assert_eq!(default.bitrate, Bitrate::Bitrate320);
    assert!(!default.normalisation);
    let saver = player_config(&PlayerSetup {
        streaming_quality: StreamingQuality::Low,
        loudness: LoudnessNormalization::Loud,
        ..PlayerSetup::default()
    });
    assert_eq!(saver.bitrate, Bitrate::Bitrate96);
    assert!(saver.normalisation);
    assert!((saver.normalisation_pregain_db - 3.0).abs() < 1.0e-9);
}

#[tokio::test]
async fn adding_to_the_queue_notifies_queue_observers_immediately() {
    let service = LibrespotService::new(PathBuf::from("queue-notification-test"));
    service.shared.status.write().await.phase = LibrespotPhase::Ready;
    let mut playback = service.subscribe_playback();

    service.add_to_queue(TRACK_A).await.unwrap();

    assert!(playback.changed().await.is_ok());
    assert_eq!(service.queue_revision().await, 1);
}

#[test]
fn pause_resume_does_not_reload_from_the_start() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(7),
        current_player_reported_uri: Some(TRACK_A.into()),
        ..PlaybackSnapshot::default()
    };
    assert_eq!(decide_play_start(&snapshot), PlayStartDecision::Resume);
    snapshot.handoff_hold = true;
    assert_eq!(
        decide_play_start(&snapshot),
        PlayStartDecision::Reload(PlayReloadReason::HandoffHold)
    );
}

#[test]
fn restored_track_without_a_local_player_load_is_reloaded_on_play() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        context_uri: Some("spotify:playlist:restored".into()),
        ..PlaybackSnapshot::default()
    };
    assert_eq!(
        decide_play_start(&snapshot),
        PlayStartDecision::Reload(PlayReloadReason::LocalPlayerMissing)
    );
}

#[test]
fn play_keeps_a_pending_expected_track_instead_of_reloading_current() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        expected_track_uri: Some(TRACK_B.into()),
        expected_item: Some(loading_item(TRACK_B)),
        context_uri: Some("spotify:playlist:restored".into()),
        ..PlaybackSnapshot::default()
    };
    assert!(pending_expected_differs(&snapshot));
    assert_eq!(decide_play_start(&snapshot), PlayStartDecision::KeepPending);
    assert_eq!(
        decide_play_start(&snapshot).reason(),
        "pending-expected-load"
    );
    assert!(!decide_play_start(&snapshot).should_reload());
}

#[test]
fn pending_expected_wins_over_handoff_reload() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        expected_track_uri: Some(TRACK_B.into()),
        expected_item: Some(loading_item(TRACK_B)),
        handoff_hold: true,
        context_uri: Some("spotify:playlist:restored".into()),
        ..PlaybackSnapshot::default()
    };
    assert_eq!(decide_play_start(&snapshot), PlayStartDecision::KeepPending);
}

#[test]
fn restored_handoff_still_reloads_when_expected_matches_current() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        expected_track_uri: Some(TRACK_A.into()),
        expected_item: Some(loading_item(TRACK_A)),
        handoff_hold: true,
        context_uri: Some("spotify:playlist:restored".into()),
        ..PlaybackSnapshot::default()
    };
    assert!(!pending_expected_differs(&snapshot));
    assert_eq!(
        decide_play_start(&snapshot),
        PlayStartDecision::Reload(PlayReloadReason::HandoffHold)
    );
}

#[test]
fn mismatched_local_player_identity_is_reloaded_on_play() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(9),
        current_player_reported_uri: Some(TRACK_B.into()),
        ..PlaybackSnapshot::default()
    };
    assert_eq!(
        decide_play_start(&snapshot),
        PlayStartDecision::Reload(PlayReloadReason::PlayerTrackMismatch)
    );
}

#[test]
fn startup_restore_does_not_override_live_playback() {
    assert!(startup_adopt_is_safe(false, false, 0, 0));
    assert!(startup_adopt_is_safe(false, false, 7, 7));
    assert!(!startup_adopt_is_safe(true, false, 0, 0));
    assert!(!startup_adopt_is_safe(false, true, 0, 0));
    assert!(!startup_adopt_is_safe(false, false, 8, 7));
    assert!(startup_seed_is_safe(true, false, 0, 0));
    assert!(startup_seed_is_safe(true, false, 7, 7));
    assert!(!startup_seed_is_safe(false, false, 0, 0));
    assert!(!startup_seed_is_safe(true, true, 0, 0));
    assert!(!startup_seed_is_safe(true, false, 8, 7));
}

#[test]
fn adopted_handoff_stays_paused_until_the_user_plays() {
    let snapshot = PlaybackSnapshot {
        is_playing: false,
        handoff_hold: true,
        audio_started: false,
        position_ms: 54_000,
        duration_ms: 200_000,
        ..PlaybackSnapshot::default()
    };
    assert_eq!(interpolated_position(&snapshot), 54_000);
    assert!(snapshot.handoff_hold);
    assert!(!snapshot.is_playing);
}

#[test]
fn clock_stays_frozen_until_audio_has_started() {
    let mut snapshot = PlaybackSnapshot {
        is_playing: true,
        position_ms: 10_000,
        duration_ms: 200_000,
        audio_started: false,
        ..PlaybackSnapshot::default()
    };
    snapshot.position_updated_at = Instant::now() - Duration::from_secs(8);
    assert_eq!(interpolated_position(&snapshot), 10_000);
    snapshot.audio_started = true;
    assert!(interpolated_position(&snapshot) >= 18_000);
}

#[test]
fn playing_keeps_the_clock_live_after_a_resume_seek() {
    let mut snapshot = PlaybackSnapshot {
        is_playing: true,
        position_ms: 54_000,
        duration_ms: 200_000,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    snapshot.position_updated_at = Instant::now() - Duration::from_millis(400);
    assert!(interpolated_position(&snapshot) >= 54_000);
    assert!(interpolated_position(&snapshot) < 56_000);
}

#[test]
fn end_of_previous_track_is_ignored_after_skip() {
    assert!(should_ignore_track_event(
        Some("spotify:track:nextsong12nextsong12next"),
        "spotify:track:oldsong12oldsong12oldsong",
    ));
}

#[test]
fn next_ignores_stale_events_from_the_previous_track() {
    assert!(should_ignore_track_event(
        Some("spotify:track:nextsong12nextsong12next"),
        "spotify:track:oldsong12oldsong12oldsong",
    ));
    assert!(!should_ignore_track_event(
        Some("spotify:track:nextsong12nextsong12next"),
        "spotify:track:nextsong12nextsong12next",
    ));
    assert!(!should_ignore_track_event(
        Some("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"),
        "spotify:unknown:3n3Ppam7vgaVa1iaRUc9Lp",
    ));
    assert!(!should_ignore_track_event(
        None,
        "spotify:track:naturalsongadvance01",
    ));
}

#[test]
fn pending_skip_ignores_stop_and_pause_from_the_new_load() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(10),
        current_player_reported_uri: Some(TRACK_A.into()),
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_B.to_string(),
    });
    assert!(ignore_transport_halt_during_pending_load(&snapshot));
    assert!(!player_event_matches(&snapshot, 10, TRACK_A));

    assert!(register_player_request(&mut snapshot, 11));
    assert!(correlate_player_request(&mut snapshot, 11, TRACK_B));
    assert!(player_event_matches(&snapshot, 11, TRACK_B));
    assert!(ignore_transport_halt_during_pending_load(&snapshot));
    assert!(snapshot.is_playing);
    assert_eq!(snapshot.expected_player_request_id, Some(11));
}

#[test]
fn confirmed_playback_still_applies_stop() {
    let snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(10),
        current_player_reported_uri: Some(TRACK_A.into()),
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    assert!(!ignore_transport_halt_during_pending_load(&snapshot));
    assert!(player_event_matches(&snapshot, 10, TRACK_A));
}

#[test]
fn pending_skip_keeps_confirmed_item_but_moves_the_optimistic_clock() {
    let mut snapshot = PlaybackSnapshot::default();
    snapshot.current_item = Some(loading_item(TRACK_A));
    snapshot.is_playing = true;
    snapshot.audio_started = true;
    snapshot.position_ms = 87_000;
    snapshot.duration_ms = 180_000;
    snapshot.is_saved = true;
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = snapshot.play_generation.saturating_add(1);
    commit_expected_item(&mut snapshot, loading_item(TRACK_B));
    assert_eq!(snapshot.play_generation, generation);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_B));
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
    assert_eq!(snapshot.position_ms, 0);
    assert_eq!(snapshot.duration_ms, 180_000);
    assert!(snapshot.is_playing);
    assert!(!snapshot.audio_started);
    assert!(snapshot.is_saved);
    assert_eq!(effective_cursor_uri(&snapshot).as_deref(), Some(TRACK_B));

    assert!(reject_expected_load(&mut snapshot, generation, TRACK_B));
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
    assert_eq!(snapshot.position_ms, 0);
    assert_eq!(snapshot.duration_ms, 180_000);
    assert!(snapshot.is_saved);
    assert!(!snapshot.is_playing);
    assert!(!snapshot.audio_started);
    assert_eq!(effective_cursor_uri(&snapshot).as_deref(), Some(TRACK_A));
}

#[test]
fn single_track_load_disables_spirc_shuffle_and_repeat() {
    let options = single_track_load_options(TRACK_B);
    assert!(options.start_playing);
    assert_eq!(options.seek_to, 0);
    let Some(LoadContextOptions::Options(flags)) = options.context_options else {
        panic!("single-track load must carry neutral context flags");
    };
    assert!(!flags.shuffle);
    assert!(!flags.repeat);
    assert!(!flags.repeat_track);
    assert!(matches!(
        options.playing_track,
        Some(PlayingTrack::Uri(uri)) if uri == TRACK_B
    ));
}

#[test]
fn recovery_seek_starts_only_the_load_it_was_meant_for() {
    let seek = PendingSeek { generation: 7, position_ms: 112_020 };
    let mut snapshot = PlaybackSnapshot { pending_seek: Some(seek), ..PlaybackSnapshot::default() };
    // Another load came first: it starts at 0 and the stale seek is gone.
    assert_eq!(take_pending_seek(&mut snapshot, 8), 0);
    assert!(snapshot.pending_seek.is_none());

    snapshot.pending_seek = Some(seek);
    let seek_to = take_pending_seek(&mut snapshot, 7);
    assert_eq!(seek_to, 112_020);
    assert_eq!(single_track_load_request(TRACK_B, seek_to).seek_to, 112_020);
}

#[test]
fn accepted_playing_event_updates_audio_truth_before_enrichment() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        is_playing: false,
        audio_started: false,
        ..PlaybackSnapshot::default()
    };

    apply_confirmed_player_state(
        &mut snapshot,
        TRACK_B,
        Some(loading_item(TRACK_B)),
        true,
        true,
        1_234,
    );

    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_B)
    );
    assert!(snapshot.is_playing);
    assert!(snapshot.audio_started);
    assert_eq!(snapshot.position_ms, 1_234);
}

#[test]
fn visible_item_switches_to_the_pending_track_before_audio_confirms() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(crate::metadata::loading_item(TRACK_B));

    let visible = visible_playback_item(&snapshot).expect("pending");
    assert_eq!(visible.uri, TRACK_B);

    apply_confirmed_player_state(
        &mut snapshot,
        TRACK_B,
        Some(loading_item(TRACK_B)),
        false,
        true,
        0,
    );
    let visible = visible_playback_item(&snapshot).expect("confirmed");
    assert_eq!(visible.uri, TRACK_B);
}

fn item_with_duration(uri: &str, duration_ms: u64) -> MediaItem {
    let mut item = loading_item(uri);
    item.duration_ms = Some(duration_ms);
    item
}

#[test]
fn published_state_uses_the_pending_track_at_zero_with_its_duration() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        position_ms: 54_000,
        is_playing: false,
        audio_started: false,
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(item_with_duration(TRACK_B, 180_000));

    let state = snapshot_to_state(&snapshot);
    assert_eq!(
        state.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_B)
    );
    assert_eq!(state.position_ms, 0);
    assert_eq!(state.duration_ms, 180_000);
    assert!(state.is_playing);
    assert!(!state.clock_ready);
}

#[test]
fn pending_track_does_not_keep_the_previous_duration() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        position_ms: 54_000,
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(loading_item(TRACK_B));

    let state = snapshot_to_state(&snapshot);
    assert_eq!(
        state.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_B)
    );
    assert_eq!(state.position_ms, 0);
    assert_eq!(state.duration_ms, 0);
    assert!(!snapshot.audio_started);
    assert!(!state.clock_ready);
}

#[test]
fn a_new_track_does_not_inherit_the_previous_live_position() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        position_ms: 87_000,
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    snapshot.position_updated_at = Instant::now() - Duration::from_secs(3);
    apply_confirmed_player_state(
        &mut snapshot,
        TRACK_B,
        Some(item_with_duration(TRACK_B, 181_000)),
        true,
        true,
        0,
    );
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_B)
    );
    assert_eq!(snapshot.position_ms, 0);
    assert_eq!(snapshot.duration_ms, 181_000);
    let state = snapshot_to_state(&snapshot);
    assert_eq!(state.position_ms, 0);
    assert_eq!(state.duration_ms, 181_000);
}

#[test]
fn a_late_zero_position_report_does_not_rewind_the_same_track() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_B, 181_000)),
        is_playing: true,
        audio_started: true,
        position_ms: 0,
        duration_ms: 181_000,
        clock_track_uri: Some(TRACK_B.into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.position_updated_at = Instant::now() - Duration::from_secs(3);
    apply_reported_position(&mut snapshot, TRACK_B, 0);
    assert!(
        snapshot.position_ms >= 2_500,
        "position report rewound the clock to {}",
        snapshot.position_ms
    );
    apply_seeked_position(&mut snapshot, TRACK_B, 0);
    assert_eq!(snapshot.position_ms, 0);
}

#[test]
fn pending_audio_resets_the_clock_while_the_previous_track_is_still_current() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        position_ms: 87_000,
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(loading_item(TRACK_B));
    assert!(start_pending_audio_from_loaded_track(
        &mut snapshot,
        TRACK_B,
        181_000
    ));
    assert_eq!(snapshot.position_ms, 0);
    assert_eq!(snapshot.duration_ms, 181_000);
}

#[test]
fn loaded_track_keeps_the_clock_frozen_until_playing_confirms() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(loading_item(TRACK_B));

    assert!(start_pending_audio_from_loaded_track(
        &mut snapshot,
        TRACK_B,
        181_000
    ));
    assert!(snapshot.is_playing);
    assert!(!snapshot.audio_started);
    assert_eq!(snapshot.duration_ms, 181_000);
    assert_eq!(snapshot.position_ms, 0);

    snapshot.position_updated_at = Instant::now() - Duration::from_millis(2_500);
    assert_eq!(interpolated_position(&snapshot), 0);
    apply_confirmed_player_state(
        &mut snapshot,
        TRACK_B,
        Some(item_with_duration(TRACK_B, 181_000)),
        false,
        true,
        0,
    );
    assert_eq!(snapshot.position_ms, 0);
    assert!(snapshot.audio_started);
    let state = snapshot_to_state(&snapshot);
    assert_eq!(state.position_ms, 0);
    assert!(state.is_playing);
    assert!(state.clock_ready);
}

#[test]
fn metadata_enrichment_keeps_the_live_clock() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_B, 180_000)),
        duration_ms: 180_000,
        is_playing: true,
        audio_started: true,
        position_ms: 0,
        ..PlaybackSnapshot::default()
    };
    snapshot.position_updated_at = Instant::now() - Duration::from_millis(2_800);
    let live = interpolated_position(&snapshot);
    assert!(live >= 2_500, "live clock {live}");
    snapshot.position_ms = live;
    snapshot.position_updated_at = Instant::now();
    assert!(
        interpolated_position(&snapshot) >= 2_500,
        "rewound to {}",
        interpolated_position(&snapshot)
    );
}

#[test]
fn playing_keeps_audio_duration_from_the_staged_track() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(item_with_duration(TRACK_A, 200_000)),
        duration_ms: 200_000,
        ..PlaybackSnapshot::default()
    };
    begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.expected_item = Some(loading_item(TRACK_B));
    snapshot.player_item_candidate = Some(PlayerItemCandidate {
        request_id: None,
        item: item_with_duration(TRACK_B, 181_000),
    });

    assert!(register_player_request(&mut snapshot, 9));
    assert_eq!(
        snapshot
            .player_item_candidate
            .as_ref()
            .map(|candidate| candidate.request_id),
        Some(Some(9))
    );

    let pending = confirmed_player_item(&snapshot, 9, TRACK_B);
    apply_confirmed_player_state(&mut snapshot, TRACK_B, pending, false, true, 0);
    assert_eq!(snapshot.duration_ms, 181_000);
    let state = snapshot_to_state(&snapshot);
    assert_eq!(state.duration_ms, 181_000);
    assert!(state.is_playing);
    assert!(state.clock_ready);
}

#[test]
fn context_seed_uses_live_shuffle_value_at_commit_time() {
    let captured_before_remote_await = false;
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        shuffle_enabled: true,
        ..PlaybackSnapshot::default()
    };
    let (_, _, committed_shuffle) = apply_context_seed_queue(
        &mut snapshot,
        Some(TRACK_A),
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
    );

    assert_ne!(committed_shuffle, captured_before_remote_await);
    assert!(committed_shuffle);
    assert_eq!(snapshot.queue.upcoming.len(), 2);
}

#[test]
fn startup_queue_restore_uses_live_shuffle_value_at_commit_time() {
    let captured_before_remote_await = false;
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        shuffle_enabled: true,
        ..PlaybackSnapshot::default()
    };
    let committed_shuffle = replace_startup_context_queue(
        &mut snapshot,
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
    );

    assert_ne!(committed_shuffle, captured_before_remote_await);
    assert!(committed_shuffle);
    assert_eq!(snapshot.queue.upcoming.len(), 2);
}

#[test]
fn same_uri_events_from_the_baseline_request_do_not_confirm_a_new_load() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(7),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_A);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_A.to_string(),
    });

    assert!(!player_event_matches(&snapshot, 7, TRACK_A));
    assert!(!accept_player_identity(&mut snapshot, 7, TRACK_A).is_confirmed());
    assert!(!register_player_request(&mut snapshot, 7));
    assert!(register_player_request(&mut snapshot, 8));
    assert!(correlate_player_request(&mut snapshot, 8, TRACK_A));
    assert_eq!(snapshot.expected_player_request_id, Some(8));
    assert!(accept_player_identity(&mut snapshot, 8, TRACK_A).is_confirmed());
}

#[test]
fn superseded_playing_cannot_claim_the_newer_transport_intent() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(15),
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    begin_expected_track(&mut snapshot, TRACK_C);

    assert_eq!(
        accept_player_identity(&mut snapshot, 15, TRACK_A),
        PlayerIdentityDecision::Superseded {
            expected_uri: TRACK_C.to_string()
        }
    );
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_C));
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
}

#[test]
fn stale_sent_load_cannot_claim_a_newer_expected_track() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(40),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation_b = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: generation_b,
        uri: TRACK_B.to_string(),
    });
    reserve_snapshot_load_intent(&mut snapshot);
    let generation_c = begin_expected_track(&mut snapshot, TRACK_C);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: generation_c,
        uri: TRACK_C.to_string(),
    });

    assert!(register_player_request(&mut snapshot, 41));
    assert!(!correlate_player_request(&mut snapshot, 41, TRACK_B));
    assert_eq!(snapshot.expected_player_request_id, None);
    assert_eq!(
        accept_player_identity(&mut snapshot, 41, TRACK_B),
        PlayerIdentityDecision::Superseded {
            expected_uri: TRACK_C.to_string()
        }
    );
    assert!(register_player_request(&mut snapshot, 42));
    assert!(correlate_player_request(&mut snapshot, 42, TRACK_C));
    assert_eq!(snapshot.expected_player_request_id, Some(42));
    assert!(accept_player_identity(&mut snapshot, 42, TRACK_C).is_confirmed());
}

#[test]
fn rapid_next_keeps_only_the_latest_target_and_history_transaction() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(10),
        current_player_reported_uri: Some(TRACK_A.into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![
            TRACK_A.into(),
            TRACK_B.into(),
            TRACK_C.into(),
            TRACK_X.into(),
        ],
        TRACK_A,
        false,
    );

    let first_intent = reserve_snapshot_load_intent(&mut snapshot);
    let first = prepare_next_load(&mut snapshot, first_intent).expect("first next");
    assert_eq!(first.item.uri, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: first.generation,
        uri: first.item.uri,
    });
    assert!(register_player_request(&mut snapshot, 11));

    let second_intent = reserve_snapshot_load_intent(&mut snapshot);
    let second = prepare_next_load(&mut snapshot, second_intent).expect("second next");
    assert_eq!(second.item.uri, TRACK_C);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: second.generation,
        uri: second.item.uri,
    });

    assert!(!correlate_player_request(&mut snapshot, 11, TRACK_B));
    assert_eq!(
        accept_player_identity(&mut snapshot, 11, TRACK_B),
        PlayerIdentityDecision::Superseded {
            expected_uri: TRACK_C.to_string()
        }
    );
    assert!(!player_position_event_allowed(&snapshot, 11, TRACK_B));
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_C));
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
    assert_eq!(snapshot.queue.history, vec![TRACK_A, TRACK_B]);

    assert!(register_player_request(&mut snapshot, 12));
    assert!(correlate_player_request(&mut snapshot, 12, TRACK_C));
    let pending = confirmed_player_item(&snapshot, 12, TRACK_C);
    let decision = accept_player_identity(&mut snapshot, 12, TRACK_C);
    assert!(decision.is_confirmed());
    assert!(decision.prepared_transport());
    apply_confirmed_player_state(&mut snapshot, TRACK_C, pending, false, true, 0);

    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_C)
    );
    assert_eq!(snapshot.queue.history, vec![TRACK_A, TRACK_B]);
}

#[test]
fn rapid_previous_keeps_only_the_latest_target_and_restores_forward_order() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_C)),
        current_player_request_id: Some(20),
        current_player_reported_uri: Some(TRACK_C.into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![
            TRACK_A.into(),
            TRACK_B.into(),
            TRACK_C.into(),
            TRACK_X.into(),
        ],
        TRACK_C,
        false,
    );
    snapshot.queue.history = vec![TRACK_A.into(), TRACK_B.into()];

    let first_intent = reserve_snapshot_load_intent(&mut snapshot);
    let first = prepare_previous_load(&mut snapshot, first_intent).expect("first previous");
    assert_eq!(first.item.uri, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: first.generation,
        uri: first.item.uri,
    });
    assert!(register_player_request(&mut snapshot, 21));

    let second_intent = reserve_snapshot_load_intent(&mut snapshot);
    let second = prepare_previous_load(&mut snapshot, second_intent).expect("second previous");
    assert_eq!(second.item.uri, TRACK_A);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation: second.generation,
        uri: second.item.uri,
    });

    assert!(!correlate_player_request(&mut snapshot, 21, TRACK_B));
    assert_eq!(
        accept_player_identity(&mut snapshot, 21, TRACK_B),
        PlayerIdentityDecision::Superseded {
            expected_uri: TRACK_A.to_string()
        }
    );
    assert!(!player_position_event_allowed(&snapshot, 21, TRACK_B));
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_A));
    assert_eq!(snapshot.queue.history, Vec::<String>::new());

    assert!(register_player_request(&mut snapshot, 22));
    assert!(correlate_player_request(&mut snapshot, 22, TRACK_A));
    let pending = confirmed_player_item(&snapshot, 22, TRACK_A);
    let decision = accept_player_identity(&mut snapshot, 22, TRACK_A);
    assert!(decision.is_confirmed());
    apply_confirmed_player_state(&mut snapshot, TRACK_A, pending, false, true, 0);

    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
    assert_eq!(snapshot.queue.history, Vec::<String>::new());
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .first()
            .map(|entry| entry.item.uri.as_str()),
        Some(TRACK_B)
    );
}

#[test]
fn rapid_previous_after_elapsed_track_restarts_then_traverses_history() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_B)),
        current_player_request_id: Some(30),
        current_player_reported_uri: Some(TRACK_B.into()),
        position_ms: 12_000,
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_B,
        false,
    );
    snapshot.queue.history = vec![TRACK_A.into()];

    let restart_intent = reserve_snapshot_load_intent(&mut snapshot);
    let restart = prepare_previous_restart(&mut snapshot, restart_intent)
        .expect("first previous restarts elapsed track");
    assert_eq!(restart.uri(), Some(TRACK_B));
    assert_eq!(snapshot.position_ms, 0);

    let previous_intent = reserve_snapshot_load_intent(&mut snapshot);
    let previous = prepare_previous_load(&mut snapshot, previous_intent)
        .expect("second previous traverses history");
    assert_eq!(previous.item.uri, TRACK_A);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_A));
    assert!(!rollback_previous_restart(&mut snapshot, &restart));
}

#[test]
fn transport_burst_only_allows_the_latest_generation_to_claim_a_load() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        last_transport_load_sent_at: Some(Instant::now()),
        ..PlaybackSnapshot::default()
    };
    assert!(!transport_settle_delay(&snapshot).is_zero());

    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    assert!(!claim_transport_load(
        &mut snapshot,
        generation.saturating_sub(1),
        TRACK_A,
    ));
    assert!(claim_transport_load(&mut snapshot, generation, TRACK_B));
}

#[test]
fn noop_command_reservation_does_not_invalidate_a_committed_load() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(3),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_B.to_string(),
    });

    reserve_snapshot_load_intent(&mut snapshot);
    assert!(expected_load_is_current(&snapshot, generation, TRACK_B));
    assert!(register_player_request(&mut snapshot, 4));
    assert!(correlate_player_request(&mut snapshot, 4, TRACK_B));
    assert_eq!(snapshot.expected_player_request_id, Some(4));
    assert!(accept_player_identity(&mut snapshot, 4, TRACK_B).is_confirmed());
}

#[test]
fn late_context_seed_cannot_replace_a_player_confirmed_fallback() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(11),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_B.to_string(),
    });
    assert!(register_player_request(&mut snapshot, 12));
    assert!(correlate_player_request(&mut snapshot, 12, TRACK_B));
    assert_eq!(
        accept_player_identity(&mut snapshot, 12, TRACK_C),
        PlayerIdentityDecision::Confirmed {
            replaced_expected_uri: Some(TRACK_B.to_string()),
            prepared_transport: true,
        }
    );
    snapshot.current_item = Some(loading_item(TRACK_C));
    snapshot.is_playing = true;
    snapshot.audio_started = true;

    let order = vec![TRACK_B.to_string(), TRACK_C.to_string()];
    assert_eq!(
        context_seed_current_uri(&snapshot, Some(TRACK_B), &order, false).as_deref(),
        Some(TRACK_C)
    );
    assert_eq!(
        apply_publish_loading_item(
            &mut snapshot,
            TRACK_B,
            Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into()),
            Some(generation),
        ),
        None
    );
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_C)
    );
    assert!(snapshot.audio_started);
}

#[test]
fn remote_request_before_local_load_cannot_claim_the_local_intent() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(9),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_B.to_string(),
    });

    assert!(register_player_request(&mut snapshot, 10));
    assert!(!correlate_player_request(&mut snapshot, 10, TRACK_C));
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_B));
    assert_eq!(snapshot.expected_player_request_id, None);
    assert_eq!(snapshot.sent_player_loads.len(), 1);

    assert!(register_player_request(&mut snapshot, 11));
    assert!(correlate_player_request(&mut snapshot, 11, TRACK_B));
    assert_eq!(snapshot.expected_player_request_id, Some(11));
    assert!(snapshot.sent_player_loads.is_empty());
    assert!(accept_player_identity(&mut snapshot, 11, TRACK_B).is_confirmed());
}

#[test]
fn external_request_after_bound_local_load_supersedes_the_expectation() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(9),
        ..PlaybackSnapshot::default()
    };
    reserve_snapshot_load_intent(&mut snapshot);
    let generation = begin_expected_track(&mut snapshot, TRACK_B);
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: TRACK_B.to_string(),
    });

    assert!(register_player_request(&mut snapshot, 10));
    assert!(correlate_player_request(&mut snapshot, 10, TRACK_B));
    assert_eq!(snapshot.expected_player_request_id, Some(10));

    assert!(register_player_request(&mut snapshot, 11));
    assert!(!correlate_player_request(&mut snapshot, 11, TRACK_C));
    assert_eq!(snapshot.expected_track_uri, None);
    assert_eq!(snapshot.expected_player_request_id, None);
    assert!(accept_player_identity(&mut snapshot, 11, TRACK_C).is_confirmed());
    snapshot.current_item = Some(loading_item(TRACK_C));
    assert!(player_event_matches(&snapshot, 11, TRACK_C));
}

#[test]
fn auto_advance_waits_for_matching_stopped_and_unavailable_wins() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_B)),
        current_player_request_id: Some(21),
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    assert!(mark_pending_auto_advance(&mut snapshot, 21, TRACK_B, true,));
    let first_intent = snapshot
        .pending_auto_advance
        .as_ref()
        .map(|pending| pending.load_intent)
        .expect("end-of-track must create a pending transition");
    assert!(!snapshot.is_playing);
    assert!(!snapshot.audio_started);
    assert!(take_pending_auto_advance(&mut snapshot, 20, TRACK_B).is_none());

    assert!(mark_pending_auto_advance(&mut snapshot, 21, TRACK_B, false,));
    assert_eq!(snapshot.load_intent_epoch, first_intent);
    assert_eq!(
        take_pending_auto_advance(&mut snapshot, 21, TRACK_B),
        Some((false, first_intent))
    );
}

#[test]
fn unavailable_streak_stops_automatic_queue_drain_and_user_action_resets_it() {
    let mut diagnostics = PlaybackDiagnostics::default();
    for uri in [TRACK_A, TRACK_B, TRACK_C] {
        assert!(diagnostics.record_unavailable(uri).auto_advance_allowed);
    }
    assert!(!diagnostics.record_unavailable(TRACK_X).auto_advance_allowed);

    diagnostics.reset_unavailable_streak();
    assert!(diagnostics.record_unavailable(TRACK_A).auto_advance_allowed);
}

#[test]
fn unavailable_circuit_invalidates_pending_load_without_consuming_more_queue() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(21),
        expected_track_uri: Some(TRACK_B.into()),
        expected_item: Some(loading_item(TRACK_B)),
        expected_player_request_id: Some(21),
        is_playing: true,
        audio_started: true,
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    assert!(mark_pending_auto_advance(&mut snapshot, 21, TRACK_B, false));
    let pending_intent = snapshot.load_intent_epoch;
    let upcoming = snapshot.queue.upcoming.clone();

    halt_unavailable_auto_advance(&mut snapshot);

    assert!(snapshot.load_intent_epoch > pending_intent);
    assert!(snapshot.pending_auto_advance.is_none());
    assert!(snapshot.expected_track_uri.is_none());
    assert!(snapshot.current_player_request_id.is_none());
    assert!(!snapshot.is_playing);
    assert!(!snapshot.audio_started);
    assert_eq!(snapshot.queue.upcoming, upcoming);
}

#[test]
fn stale_next_plan_leaves_explicit_and_context_queues_untouched() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        context_uri: Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    snapshot.queue.push_explicit(loading_item(TRACK_X));
    let stale_intent = reserve_snapshot_load_intent(&mut snapshot);
    let live_intent = reserve_snapshot_load_intent(&mut snapshot);

    assert!(prepare_next_load(&mut snapshot, stale_intent).is_none());
    assert_eq!(snapshot.queue.explicit.len(), 1);
    assert_eq!(snapshot.queue.explicit[0].item.uri, TRACK_X);
    assert!(snapshot.queue.history.is_empty());
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_B, TRACK_C]
    );

    let prepared =
        prepare_next_load(&mut snapshot, live_intent).expect("live next must be committed");
    assert!(prepared.explicit);
    assert_eq!(prepared.item.uri, TRACK_X);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_X));
    assert_eq!(
        snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
        Some(TRACK_A)
    );
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_B, TRACK_C]
    );
    assert_eq!(
        snapshot.queue.context_uris,
        vec![
            TRACK_A.to_string(),
            TRACK_B.to_string(),
            TRACK_C.to_string()
        ]
    );
}

#[test]
fn stale_auto_advance_plan_does_not_consume_the_next_context_track() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(30),
        context_uri: Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    let stale_intent = reserve_snapshot_load_intent(&mut snapshot);
    let live_intent = reserve_snapshot_load_intent(&mut snapshot);

    assert!(prepare_auto_advance_load(&mut snapshot, true, stale_intent).is_none());
    assert!(snapshot.expected_track_uri.is_none());
    assert!(snapshot.queue.history.is_empty());
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_B, TRACK_C]
    );

    let prepared = prepare_auto_advance_load(&mut snapshot, true, live_intent)
        .expect("current auto-advance must atomically commit its next track");
    assert_eq!(prepared.item.uri, TRACK_B);
    assert!(prepared.refresh_context);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_B));
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_C]
    );
}

#[test]
fn artist_top_tracks_keep_the_seeded_queue_on_auto_advance() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        current_player_request_id: Some(30),
        context_uri: Some("spotify:artist:kavinsky".into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    let intent = reserve_snapshot_load_intent(&mut snapshot);
    let prepared = prepare_auto_advance_load(&mut snapshot, true, intent)
        .expect("artist top-track auto-advance must take the next seeded track");
    assert_eq!(prepared.item.uri, TRACK_B);
    assert!(
        !prepared.refresh_context,
        "artist radio must not replace the seeded top-tracks queue"
    );
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_C]
    );
}

#[test]
fn failed_next_restores_the_selected_track_and_context() {
    let context = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M";
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        context_uri: Some(context.into()),
        is_playing: true,
        audio_started: true,
        position_ms: 87_000,
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    let original_revision = snapshot.queue.revision;
    let intent = reserve_snapshot_load_intent(&mut snapshot);
    let prepared = prepare_next_load(&mut snapshot, intent).expect("next must prepare track B");
    assert_eq!(prepared.item.uri, TRACK_B);
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_C]
    );

    assert!(reject_expected_load_with_rollback(
        &mut snapshot,
        prepared.generation,
        &prepared.item.uri,
        Some(&prepared.rollback),
    ));
    assert_eq!(snapshot.expected_track_uri, None);
    assert_eq!(snapshot.context_uri.as_deref(), Some(context));
    assert_eq!(snapshot.queue.revision, original_revision);
    assert!(snapshot.queue.history.is_empty());
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect::<Vec<_>>(),
        vec![TRACK_B, TRACK_C]
    );
    assert!(snapshot.is_playing);
    assert!(snapshot.audio_started);
    assert_eq!(snapshot.position_ms, 87_000);
}

#[test]
fn stale_load_failure_cannot_roll_back_a_newer_expectation() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        context_uri: Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    let intent_b = reserve_snapshot_load_intent(&mut snapshot);
    let prepared_b = prepare_next_load(&mut snapshot, intent_b).expect("next must prepare track B");
    let queue_after_b = snapshot
        .queue
        .upcoming
        .iter()
        .map(|entry| entry.item.uri.clone())
        .collect::<Vec<_>>();

    reserve_snapshot_load_intent(&mut snapshot);
    let generation_c = begin_expected_track(&mut snapshot, TRACK_C);
    assert!(!reject_expected_load_with_rollback(
        &mut snapshot,
        prepared_b.generation,
        &prepared_b.item.uri,
        Some(&prepared_b.rollback),
    ));
    assert_eq!(snapshot.play_generation, generation_c);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_C));
    assert_eq!(
        snapshot
            .queue
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.clone())
            .collect::<Vec<_>>(),
        queue_after_b
    );
}

#[test]
fn previous_uses_pending_track_position_zero_instead_of_confirmed_clock() {
    let mut snapshot = PlaybackSnapshot {
        current_item: Some(loading_item(TRACK_A)),
        position_ms: 87_000,
        context_uri: Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into()),
        ..PlaybackSnapshot::default()
    };
    snapshot.queue.replace_upcoming(
        vec![TRACK_A.into(), TRACK_B.into(), TRACK_C.into()],
        TRACK_A,
        false,
    );
    let next_intent = reserve_snapshot_load_intent(&mut snapshot);
    let next = prepare_next_load(&mut snapshot, next_intent).expect("next must prepare track B");
    assert_eq!(next.item.uri, TRACK_B);
    assert!(!should_restart_previous(&snapshot));

    let previous_intent = reserve_snapshot_load_intent(&mut snapshot);
    let previous = prepare_previous_load(&mut snapshot, previous_intent)
        .expect("pending B must navigate back to A instead of seeking B");
    assert_eq!(previous.item.uri, TRACK_A);
    assert_eq!(snapshot.expected_track_uri.as_deref(), Some(TRACK_A));
}

#[test]
fn a_new_session_keeps_the_listeners_volume_and_mute() {
    let previous = PlaybackSnapshot {
        volume: 0.23,
        is_muted: true,
        last_unmuted_volume: 0.31,
        is_playing: true,
        play_generation: 4,
        load_intent_epoch: 9,
        ..PlaybackSnapshot::default()
    };
    let fresh = reset_playback(&previous);
    assert_eq!((fresh.volume, fresh.is_muted, fresh.last_unmuted_volume), (0.23, true, 0.31));
    assert!(!fresh.is_playing);
    assert_eq!((fresh.play_generation, fresh.startup_play_generation, fresh.load_intent_epoch), (5, 5, 10));
}
