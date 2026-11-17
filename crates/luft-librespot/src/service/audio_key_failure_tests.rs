use super::*;

const SONG: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
const NEXT: &str = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";

#[tokio::test]
async fn key_failure_stops_pending_load_without_advancing_and_play_can_retry() {
    let service = LibrespotService::new(PathBuf::from("audio-key-failure-test"));
    let session = Session::new(SessionConfig::default(), None);
    let shared = &service.shared;
    {
        let mut state = shared.playback.write().await;
        state.current_item = Some(loading_item(NEXT));
        let generation = begin_expected_track(&mut state, SONG);
        state.sent_player_loads.push_back(PlayerLoadIntent { generation, uri: SONG.into() });
        register_player_request(&mut state, 7);
        state.queue.replace_upcoming(vec![SONG.into(), NEXT.into()], SONG, false);
    }
    let queue = shared.playback.read().await.queue.upcoming.clone();
    let epoch = shared.session_epoch.load(Ordering::SeqCst);
    for event in [
        PlayerEvent::AudioKeyFailed { play_request_id: 7, track_id: SpotifyUri::from_uri(SONG).unwrap() },
        PlayerEvent::Stopped { play_request_id: 7, track_id: SpotifyUri::from_uri(SONG).unwrap() },
    ] {
        apply_player_event(shared, &session, event, epoch, Instant::now()).await;
    }
    let state = shared.playback.read().await;
    assert!(!state.is_playing);
    assert!(!state.audio_started);
    assert!(state.expected_track_uri.is_none());
    assert!(state.pending_auto_advance.is_none());
    assert_eq!(state.current_item.as_ref().unwrap().uri, SONG);
    assert_eq!(state.queue.upcoming, queue);
    assert!(matches!(decide_play_start(&state), PlayStartDecision::Reload(_)));
}

#[tokio::test]
async fn stale_key_failure_cannot_stop_a_newer_song() {
    let service = LibrespotService::new(PathBuf::from("stale-audio-key-test"));
    let session = Session::new(SessionConfig::default(), None);
    {
        let mut state = service.shared.playback.write().await;
        state.current_item = Some(loading_item(NEXT));
        state.current_player_request_id = Some(8);
        state.is_playing = true;
        state.audio_started = true;
    }
    let epoch = service.shared.session_epoch.load(Ordering::SeqCst);
    apply_player_event(&service.shared, &session, PlayerEvent::AudioKeyFailed {
        play_request_id: 7, track_id: SpotifyUri::from_uri(SONG).unwrap(),
    }, epoch, Instant::now()).await;
    let state = service.shared.playback.read().await;
    assert!(state.is_playing);
    assert!(state.audio_started);
    assert_eq!(state.current_player_request_id, Some(8));
}
