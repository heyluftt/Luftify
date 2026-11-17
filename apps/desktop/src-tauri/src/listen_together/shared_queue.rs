use super::*;
use std::collections::HashMap;

type Sink = connection::Sender;

#[derive(Default)]
pub(super) struct QueueRuntime {
    pub restart_occurrence: bool,
    pub edits: HashMap<String, (Instant, oneshot::Sender<Result<(), String>>)>,
    pub advance_pending: Option<Instant>,
    pub publish_pending: Option<Instant>,
    restore: Option<(bool, CoreRepeat)>,
    observed_next: Option<String>,
    preload_changed: Option<Instant>,
    paused_for_host: bool,
    last_reconcile: Option<Instant>,
    /// What a new room takes over from the host (room_seed.rs).
    pub seed: Option<super::room_seed::Seed>,
}

impl QueueRuntime {
    pub fn fail_edits(&mut self) {
        for (_, (_, completion)) in self.edits.drain() {
            // Do not automatically retry: the server may already have committed.
            let _ = completion.send(Err("listen.queueUncertain".into()));
        }
    }
}

pub(super) async fn release_room(provider: &dyn SpotifyProvider, session: &mut Session) {
    release(provider, session, false).await;
}

/// Leaving on purpose: the song goes on, only the room's settings are undone.
pub(super) async fn release_room_playing(provider: &dyn SpotifyProvider, session: &mut Session) {
    release(provider, session, true).await;
}

async fn release(provider: &dyn SpotifyProvider, session: &mut Session, keep_playing: bool) {
    if session.room.is_some() {
        if !keep_playing {
            let _ = provider.pause().await;
        }
        let _ = provider.set_room_queue(false, None).await;
        if let Some((shuffle, repeat)) = session.queue_runtime.restore.take() {
            let _ = provider.set_shuffle(shuffle).await;
            let _ = provider.set_repeat(repeat).await;
        }
    }
    session.queue_runtime.fail_edits();
    session.queue_runtime = QueueRuntime::default();
}

pub(super) async fn accept_room(
    provider: &dyn SpotifyProvider,
    session: &mut Session,
    room: RoomSnapshot,
) {
    if session.room.as_ref().is_some_and(|old| {
        old.id == room.id
            && (old.queue.revision > room.queue.revision
                || old.playback.revision > room.playback.revision)
    }) {
        return;
    }
    if session.queue_runtime.restore.is_none() {
        if let Ok(state) = provider.get_state().await {
            session.queue_runtime.restore = Some((state.shuffle_enabled, state.repeat_mode));
        }
        let _ = provider.set_room_queue(true, None).await;
        let _ = provider.set_shuffle(false).await;
        // Desktop Spotify cannot suppress its own transition callback. Repeat
        // One confines it to the current track until the server selects another.
        let _ = provider.set_repeat(CoreRepeat::One).await;
    }
    let changed = session
        .room
        .as_ref()
        .and_then(|r| r.queue.current.as_ref())
        .map(|e| &e.id)
        != room.queue.current.as_ref().map(|e| &e.id);
    if changed {
        session.queue_runtime.restart_occurrence = true;
        session.last_seek = None;
        session.last_publish = None;
        session.queue_runtime.advance_pending = None;
        session.queue_runtime.publish_pending = None;
    }
    let playback = room.playback.clone();
    session.queue_runtime.advance_pending = None;
    session.queue_runtime.publish_pending = None;
    let seeded = session.role == "host" && super::room_seed::keeps_playing(session, &room);
    let waiting_for_seed = session.queue_runtime.seed.is_some();
    session.room = Some(room);
    if seeded {
        // Already playing this song: no restart, the next tick publishes where it is.
        session.queue_runtime.restart_occurrence = false;
        session.last_applied_revision = playback.revision;
        session.last_publish = None;
    } else if playback.track.is_none() || !session.room.as_ref().is_some_and(|r| r.host_connected) {
        if !waiting_for_seed {
            let _ = provider.pause().await;
        }
        session.last_applied_revision = playback.revision;
    } else {
        apply_playback(provider, session, playback).await;
    }
}

pub(super) async fn room_tick(
    provider: &dyn SpotifyProvider,
    sink: &mut Option<Sink>,
    session: &mut Session,
) {
    let expired: Vec<_> = session
        .queue_runtime
        .edits
        .iter()
        .filter(|(_, (at, _))| at.elapsed() > Duration::from_secs(10))
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        if let Some((_, completion)) = session.queue_runtime.edits.remove(&id) {
            let _ = completion.send(Err("listen.queueUncertain".into()));
        }
    }
    if session.connection != "online" {
        return;
    }
    let Some(room) = session.room.clone() else {
        return;
    };
    if !room.host_connected {
        if !session.queue_runtime.paused_for_host {
            let _ = provider.pause().await;
            session.queue_runtime.paused_for_host = true;
        }
        return;
    }
    session.queue_runtime.paused_for_host = false;
    let next = room.queue.items.first().map(|e| e.track.uri.clone());
    if next != session.queue_runtime.observed_next {
        session.queue_runtime.observed_next = next.clone();
        session.queue_runtime.preload_changed = Some(Instant::now());
        // Invalidate the old speculative selection immediately. Rapid edits
        // settle for 600 ms before spending audio I/O on the final head.
        let _ = provider.set_room_queue(true, None).await;
    }
    if session
        .queue_runtime
        .preload_changed
        .is_some_and(|at| at.elapsed() >= Duration::from_millis(600))
    {
        if provider.set_room_queue(true, next.as_deref()).await.is_ok() {
            session.queue_runtime.preload_changed = None;
        }
    }
    if room.playback.revision > session.last_applied_revision {
        apply_playback(provider, session, room.playback.clone()).await;
        if room.playback.revision > session.last_applied_revision {
            return;
        }
    }
    if session.role != "host" {
        // Also recover from external Spotify controls, without 400-ms polling.
        if session
            .queue_runtime
            .last_reconcile
            .is_none_or(|at| at.elapsed() >= PUBLISH_HEARTBEAT)
        {
            session.queue_runtime.last_reconcile = Some(Instant::now());
            session.last_applied_revision = room.playback.revision.saturating_sub(1);
            apply_playback(provider, session, room.playback).await;
        }
        return;
    }
    if session.queue_runtime.advance_pending.is_some()
        || session.queue_runtime.publish_pending.is_some()
    {
        let overdue = session
            .queue_runtime
            .advance_pending
            .or(session.queue_runtime.publish_pending)
            .is_some_and(|at| at.elapsed() > Duration::from_secs(5));
        if overdue {
            // Fetch committed state instead of replaying an uncertain advance.
            let _ = send_msg(sink, ClientMessage::RequestState).await;
            session.queue_runtime.advance_pending = Some(Instant::now());
            session.queue_runtime.publish_pending = None;
        }
        return;
    }
    if room.queue.current.is_none() {
        // A seed on its way: the song keeps playing until the room has it.
        if session.queue_runtime.seed.as_ref().is_some_and(|seed| seed.at.elapsed() < super::room_seed::SEED_PATIENCE) {
            return;
        }
        if session
            .queue_runtime
            .last_reconcile
            .is_none_or(|at| at.elapsed() >= PUBLISH_HEARTBEAT)
        {
            session.queue_runtime.last_reconcile = Some(Instant::now());
            if provider
                .get_state()
                .await
                .is_ok_and(|state| state.is_playing)
            {
                let _ = provider.pause().await;
            }
        }
        if !room.queue.items.is_empty() {
            advance(sink, session, &room).await;
        }
        return;
    }
    let Ok(state) = provider.get_state().await else {
        return;
    };
    let wanted = room.queue.current.as_ref().map(|e| e.track.uri.as_str());
    if state.current_item.as_ref().map(|i| i.uri.as_str()) != wanted {
        session.last_applied_revision = room.playback.revision.saturating_sub(1);
        apply_playback(provider, session, room.playback).await;
        return;
    }
    let duration = state.duration_ms;
    if track_finished(
        &room.playback,
        &state,
        now_ms().saturating_add(session.clock_offset_ms),
    ) {
        advance(sink, session, &room).await;
        return;
    }
    if !state.clock_ready {
        return;
    }
    if !host_should_publish(session.last_publish.as_ref(), &state) {
        return;
    }
    let track = state.current_item.as_ref().and_then(|item| {
        let mut track = TrackRef::new("spotify", item.uri.clone())?;
        track.title = Some(item.title.clone());
        track.cover_uri = item.cover_uri.clone();
        track.artists = item
            .creators
            .iter()
            .map(|artist| artist.name.clone())
            .collect();
        track.duration_ms = Some(duration).filter(|d| *d > 0);
        Some(track)
    });
    let message = ClientMessage::PlaybackIntent {
        revision_base: room.playback.revision,
        intent: PlaybackIntent {
            track,
            position_ms: expected_position_ms(
                state.position_ms,
                state.is_playing,
                0,
                (session.ping_ms.unwrap_or(0).min(2_000) / 2) as i64,
                Some(duration).filter(|d| *d > 0),
            ),
            is_playing: state.is_playing,
            shuffle: false,
            repeat: RepeatMode::One,
        },
    };
    if send_msg(sink, message).await.is_ok() {
        session.queue_runtime.publish_pending = Some(Instant::now());
        session.last_publish = Some(PublishMemo {
            track_uri: state.current_item.map(|i| i.uri),
            is_playing: state.is_playing,
            position_ms: state.position_ms,
            shuffle: state.shuffle_enabled,
            repeat: state.repeat_mode,
            at: Instant::now(),
        });
    }
}

async fn advance(sink: &mut Option<Sink>, session: &mut Session, room: &RoomSnapshot) {
    if send_msg(
        sink,
        ClientMessage::QueueAdvance {
            room_id: room.id.clone(),
            current_id: room.queue.current.as_ref().map(|e| e.id.clone()),
        },
    )
    .await
    .is_ok()
    {
        session.queue_runtime.advance_pending = Some(Instant::now());
    }
}

pub(super) fn track_finished(
    remote: &AuthoritativePlayback,
    local: &PlaybackState,
    now: i64,
) -> bool {
    let duration = local.duration_ms;
    if duration == 0 {
        return false;
    }
    let expected = expected_position_ms(
        remote.position_ms,
        remote.is_playing,
        remote.server_time_ms,
        now,
        Some(duration),
    );
    // Librespot's confirmed EOF can arrive before the server clock reaches the
    // endpoint, including just after a final paused snapshot was published.
    let local_ended = !local.is_playing && local.position_ms >= duration;
    local_ended || (remote.is_playing && expected >= duration)
}
