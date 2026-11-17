use super::playback_sync::wait_for_current_uri;
use super::*;
use luft_core::{MockSpotifyProvider, PlaybackProvider};

fn guest() -> Session {
    Session {
        avatar_uri: None,
        server_url: String::new(),
        display_name: "Guest".into(),
        client_id: "guest".into(),
        connection: "online".into(),
        role: "guest".into(),
        room: None,
        resume_token: None,
        ping_ms: None,
        clock_offset_ms: 0,
        last_applied_revision: 0,
        last_applied_queue: 0,
        last_sync_ms: None,
        drift_ms: 0,
        reconnect_attempts: 0,
        error: None,
        last_seek: None,
        last_publish: None,
        queue_runtime: QueueRuntime::default(),
        pending: None,
        last_emitted: None,
        request_state: false,
    }
}

fn remote(uri: &str, playing: bool) -> AuthoritativePlayback {
    AuthoritativePlayback {
        revision: 2,
        origin_id: "host".into(),
        track: TrackRef::new("spotify", uri),
        position_ms: 12_000,
        is_playing: playing,
        shuffle: false,
        repeat: RepeatMode::Off,
        server_time_ms: now_ms(),
    }
}

fn room_with_track(uri: &str, entry_id: &str, revision: u64) -> RoomSnapshot {
    let mut hub = luft_listen_together::Hub::new();
    let luft_listen_together::HubEvent::Created { mut room, .. } =
        hub.create_room("host", "Host").unwrap()
    else {
        panic!()
    };
    let track = TrackRef::new("spotify", uri).unwrap();
    room.queue.current = Some(luft_listen_together::QueueEntry {
        added_by_id: None,
        added_by_name: None,
        id: entry_id.into(),
        track,
        group: None,
    });
    room.queue.revision = revision;
    room.playback = remote(uri, false);
    room.playback.revision = revision;
    room.playback.position_ms = 0;
    room
}

#[tokio::test]
async fn consecutive_duplicate_occurrence_restarts_despite_seek_cooldown() {
    let provider = MockSpotifyProvider::new();
    provider.pause().await.unwrap();
    let uri = provider
        .get_state()
        .await
        .unwrap()
        .current_item
        .unwrap()
        .uri;
    let mut session = guest();
    accept_room(&provider, &mut session, room_with_track(&uri, "first", 2)).await;
    provider.seek(12_000).await.unwrap();
    session.last_seek = Some(Instant::now());
    let mut next = session.room.clone().unwrap();
    next.queue.current.as_mut().unwrap().id = "second".into();
    next.queue.revision += 1;
    next.playback.revision += 1;
    accept_room(&provider, &mut session, next).await;
    assert_eq!(provider.get_state().await.unwrap().position_ms, 0);
    assert_eq!(session.last_applied_revision, 3);
}

#[tokio::test]
async fn leaving_restores_local_controls_without_autoplay() {
    let provider = MockSpotifyProvider::new();
    provider.set_shuffle(true).await.unwrap();
    provider.set_repeat(CoreRepeat::All).await.unwrap();
    let uri = provider
        .get_state()
        .await
        .unwrap()
        .current_item
        .unwrap()
        .uri;
    let mut session = guest();
    accept_room(&provider, &mut session, room_with_track(&uri, "first", 2)).await;
    release_room(&provider, &mut session).await;
    let state = provider.get_state().await.unwrap();
    assert!(state.shuffle_enabled);
    assert_eq!(state.repeat_mode, CoreRepeat::All);
    assert!(!state.is_playing);
}

#[tokio::test]
async fn uncertain_queue_edits_fail_without_automatic_replay() {
    let mut runtime = QueueRuntime::default();
    let (tx, rx) = oneshot::channel();
    runtime
        .edits
        .insert("operation".into(), (Instant::now(), tx));
    runtime.fail_edits();
    assert_eq!(rx.await.unwrap(), Err("listen.queueUncertain".into()));
    assert!(runtime.edits.is_empty());
}

#[tokio::test]
async fn wrong_track_is_never_returned_after_confirmation_timeout() {
    let provider = MockSpotifyProvider::new();
    assert!(
        wait_for_current_uri(&provider, "spotify:track:missing")
            .await
            .is_none()
    );
}

#[tokio::test]
async fn failed_load_does_not_consume_revision_or_seek_the_previous_song() {
    let provider = MockSpotifyProvider::new();
    provider.pause().await.unwrap();
    let before = provider.get_state().await.unwrap();
    let mut session = guest();
    apply_playback(
        &provider,
        &mut session,
        remote("spotify:track:missing", true),
    )
    .await;
    let after = provider.get_state().await.unwrap();
    assert_eq!(after.current_item, before.current_item);
    assert_eq!(after.position_ms, before.position_ms);
    assert!(!after.is_playing);
    assert_eq!(session.last_applied_revision, 0);
    assert!(session.error.is_some());
}

#[tokio::test]
async fn paused_host_sets_position_and_ignores_older_revisions() {
    let provider = MockSpotifyProvider::new();
    provider.pause().await.unwrap();
    let uri = provider
        .get_state()
        .await
        .unwrap()
        .current_item
        .unwrap()
        .uri;
    let mut session = guest();
    let state = remote(&uri, false);
    apply_playback(&provider, &mut session, state.clone()).await;
    assert_eq!(provider.get_state().await.unwrap().position_ms, 12_000);
    assert_eq!(session.last_applied_revision, 2);
    assert!(session.last_sync_ms.is_some());
    let mut stale = state;
    stale.revision = 1;
    stale.position_ms = 1_000;
    apply_playback(&provider, &mut session, stale).await;
    assert_eq!(provider.get_state().await.unwrap().position_ms, 12_000);
}

#[tokio::test]
async fn empty_host_pauses_without_seeking_or_resuming_previous_track() {
    let provider = MockSpotifyProvider::new();
    provider.pause().await.unwrap();
    let before = provider.get_state().await.unwrap();
    let mut state = remote("spotify:track:unused", false);
    state.track = None;
    let mut session = guest();
    apply_playback(&provider, &mut session, state).await;
    let after = provider.get_state().await.unwrap();
    assert_eq!(after.position_ms, before.position_ms);
    assert!(!after.is_playing);
}

#[tokio::test]
async fn changing_track_accounts_for_loading_time() {
    let provider = MockSpotifyProvider::new();
    provider.next().await.unwrap();
    let uri = provider
        .get_state()
        .await
        .unwrap()
        .current_item
        .unwrap()
        .uri;
    provider.previous().await.unwrap();
    let mut session = guest();
    let state = remote(&uri, true);
    let sent_at = state.server_time_ms;
    apply_playback(&provider, &mut session, state).await;
    let actual = provider.get_state().await.unwrap();
    assert_eq!(actual.current_item.unwrap().uri, uri);
    assert!(actual.is_playing);
    let expected = 12_000 + now_ms().saturating_sub(sent_at) as u64;
    assert!(
        actual.position_ms.abs_diff(expected) < 100,
        "actual={}, expected={expected}",
        actual.position_ms
    );
}

#[tokio::test]
async fn pausing_bypasses_seek_cooldown_and_keeps_exact_host_position() {
    let provider = MockSpotifyProvider::new();
    let uri = provider
        .get_state()
        .await
        .unwrap()
        .current_item
        .unwrap()
        .uri;
    let mut session = guest();
    session.last_seek = Some(Instant::now());
    apply_playback(&provider, &mut session, remote(&uri, false)).await;
    let actual = provider.get_state().await.unwrap();
    assert!(!actual.is_playing);
    assert_eq!(actual.position_ms, 12_000);
    assert_eq!(session.last_applied_revision, 2);
}

#[tokio::test]
async fn confirmed_song_end_advances_even_when_room_clock_lags_or_is_paused() {
    let provider = MockSpotifyProvider::new();
    let mut local = provider.get_state().await.unwrap();
    local.duration_ms = 180_000;
    local.position_ms = 180_000;
    local.is_playing = false;
    let mut state = remote("spotify:track:test", true);
    state.position_ms = 179_700;
    state.server_time_ms = 1_000;
    assert!(shared_queue::track_finished(&state, &local, 1_000));
    state.is_playing = false;
    assert!(shared_queue::track_finished(&state, &local, 1_000));
    // An ordinary pause before the endpoint must remain a pause.
    local.position_ms = 179_700;
    assert!(!shared_queue::track_finished(&state, &local, 1_000));
    state.is_playing = true;
    assert!(!shared_queue::track_finished(&state, &local, 1_000));
    assert!(shared_queue::track_finished(&state, &local, 1_300));
    local.duration_ms = 0;
    assert!(!shared_queue::track_finished(&state, &local, 2_000));
}

#[tokio::test]
async fn a_guest_handed_the_room_becomes_host_and_plays_on() {
    let provider = MockSpotifyProvider::new();
    provider.pause().await.unwrap();
    let uri = provider.get_state().await.unwrap().current_item.unwrap().uri;
    let mut session = guest();
    session.room = Some(room_with_track(&uri, "entry", 2));
    let mut handed = room_with_track(&uri, "entry", 2);
    handed.host_id = "guest".into();
    handed.host_connected = true;
    handed.playback = remote(&uri, true);
    handed.playback.revision = 3;
    follow_host(&mut session, &handed);
    assert_eq!(session.role, "host");
    accept_room(&provider, &mut session, handed.clone()).await;
    assert!(provider.get_state().await.unwrap().is_playing, "the new host keeps the music going");

    // Handed on again: back to guest.
    let mut onward = handed;
    onward.host_id = "someone".into();
    follow_host(&mut session, &onward);
    assert_eq!(session.role, "guest");
    // Not in a room: nothing changes.
    session.role = "none".into();
    follow_host(&mut session, &onward);
    assert_eq!(session.role, "none");
}

#[tokio::test]
async fn a_new_room_takes_over_the_hosts_song_without_restarting_it() {
    let provider = MockSpotifyProvider::new();
    provider.play().await.unwrap();
    provider.seek(30_000).await.unwrap();
    let uri = provider.get_state().await.unwrap().current_item.unwrap().uri;
    let mut session = guest();
    session.role = "host".into();
    session.queue_runtime.seed = Some(super::room_seed::Seed::sent_for(&uri));
    // The empty new room must not pause the song on its way into the room.
    let mut empty = room_with_track(&uri, "seed", 1);
    empty.queue.current = None;
    empty.playback.track = None;
    accept_room(&provider, &mut session, empty).await;
    assert!(provider.get_state().await.unwrap().is_playing);
    // The room now plays it: no restart from 0, the seed is used up.
    let mut seeded = room_with_track(&uri, "seed", 2);
    seeded.playback.is_playing = true;
    accept_room(&provider, &mut session, seeded).await;
    let state = provider.get_state().await.unwrap();
    assert!(state.is_playing && state.position_ms >= 30_000);
    assert!(session.queue_runtime.seed.is_none());
    assert!(session.last_publish.is_none());
}
