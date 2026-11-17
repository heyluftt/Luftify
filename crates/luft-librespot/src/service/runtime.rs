use super::*;
#[path = "metadata_enrichment.rs"]
mod metadata_enrichment;
use metadata_enrichment::update_track_snapshot;
#[path = "room_end.rs"]
mod room_end;
#[cfg(test)]
#[path = "audio_key_failure_tests.rs"]
mod audio_key_failure_tests;

pub(super) async fn suppress_handoff_autoplay(
    shared: &Shared,
    _session: &Session,
    _track_id: &SpotifyUri,
    _position_ms: u32,
    session_epoch: u64,
) -> bool {
    if shared.session_epoch.load(Ordering::SeqCst) != session_epoch
        || !shared.playback.read().await.handoff_hold
    {
        return false;
    }
    {
        let mut snapshot = shared.playback.write().await;
        if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
            return false;
        }
        snapshot.is_playing = false;
        snapshot.audio_started = false;
        snapshot.position_updated_at = Instant::now();
    }
    {
        let active = shared.session.lock().await;
        if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
            return false;
        }
        if let Some(active) = active.as_ref()
            && shared.playback.read().await.handoff_hold
            && shared.session_epoch.load(Ordering::SeqCst) == session_epoch
            && let Err(error) = active.spirc.pause()
        {
            warn!(
                error = %error,
                adapter = "librespot",
                "handoff autoplay could not be paused"
            );
        }
    }
    notify_playback(shared).await;
    true
}

/// `received_at` is when the event left Librespot; positions it carries are
/// carried forward by the time it waited behind earlier events.
pub(super) async fn apply_player_event(
    shared: &Arc<Shared>,
    session: &Session,
    event: PlayerEvent,
    session_epoch: u64,
    received_at: Instant,
) {
    if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
        return;
    }
    match event {
        PlayerEvent::PlayRequestIdChanged { play_request_id } => {
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            register_player_request(&mut snapshot, play_request_id);
            return;
        }
        PlayerEvent::Loading {
            play_request_id,
            track_id,
            ..
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            correlate_player_request(&mut snapshot, play_request_id, &uri);
            return;
        }
        PlayerEvent::Playing {
            play_request_id,
            track_id,
            position_ms,
        } => {
            if suppress_handoff_autoplay(shared, session, &track_id, position_ms, session_epoch)
                .await
            {
                warn!(
                    adapter = "librespot",
                    phase = "play",
                    track_uri = uri_tail(&spotify_uri_to_string(&track_id)),
                    position_ms,
                    "audio start suppressed by handoff hold"
                );
                return;
            }
            let reported_uri = spotify_uri_to_string(&track_id);
            let (acceptance, audio_uri, expected_elapsed_ms, duration_ms) = {
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                correlate_player_request(&mut snapshot, play_request_id, &reported_uri);
                let audio_uri =
                    confirmed_player_audio_uri(&snapshot, play_request_id, &reported_uri);
                let pending_item = confirmed_player_item(&snapshot, play_request_id, &audio_uri);
                let expected_elapsed_ms = snapshot.expected_elapsed_ms();
                let decision = accept_player_identity(&mut snapshot, play_request_id, &audio_uri);
                if decision.is_confirmed() {
                    let record_previous_in_history = !decision.prepared_transport();
                    if snapshot.expected_track_uri.is_none() {
                        complete_pending_next_load(&mut snapshot, &audio_uri);
                    }
                    snapshot.current_player_reported_uri = Some(reported_uri.clone());
                    clear_player_item_candidate(&mut snapshot, play_request_id);
                    apply_confirmed_player_state(
                        &mut snapshot,
                        &audio_uri,
                        pending_item,
                        record_previous_in_history,
                        true,
                        position_since(position_ms, received_at),
                    );
                    let outcome = if decision.confirmed_mismatch().is_some() {
                        "accepted-fallback"
                    } else {
                        "accepted"
                    };
                    log_transition(
                        &snapshot,
                        "player-playing",
                        outcome,
                        Some(&audio_uri),
                        Some(play_request_id),
                    );
                    if let Some(recovery) = snapshot.diagnostics.finish_unavailable_streak() {
                        log_unavailable_recovery(&snapshot, &audio_uri, play_request_id, recovery);
                    }
                } else if matches!(&decision, PlayerIdentityDecision::Superseded { .. }) {
                    clear_player_item_candidate(&mut snapshot, play_request_id);
                    log_transition(
                        &snapshot,
                        "player-playing",
                        "ignored-superseded",
                        Some(&audio_uri),
                        Some(play_request_id),
                    );
                }
                (
                    decision,
                    audio_uri,
                    expected_elapsed_ms,
                    snapshot.duration_ms,
                )
            };
            let PlayerIdentityDecision::Confirmed {
                replaced_expected_uri,
                ..
            } = acceptance
            else {
                return;
            };
            if let Some(expected) = replaced_expected_uri {
                warn!(
                    adapter = "librespot",
                    phase = "play",
                    expected = uri_tail(&expected),
                    actual = uri_tail(&audio_uri),
                    request_id = play_request_id,
                    expected_elapsed_ms,
                    "player started a fallback track"
                );
            }
            info!(
                adapter = "librespot",
                phase = "play",
                track_uri = uri_tail(&audio_uri),
                player_reported_uri = uri_tail(&reported_uri),
                request_id = play_request_id,
                position_ms,
                event_wait_ms = received_at.elapsed().as_millis(),
                expected_elapsed_ms,
                duration_ms,
                "audio started"
            );
            notify_playback(shared).await;
            schedule_experimental_canvas(shared, &audio_uri);
            if apply_pending_seek(shared).await {
                notify_playback(shared).await;
            }
            let enrich_shared = Arc::clone(shared);
            let enrich_session = session.clone();
            let enrich_track_id = SpotifyUri::from_uri(&audio_uri).unwrap_or(track_id);
            tokio::spawn(async move {
                if update_track_snapshot(
                    &enrich_shared,
                    &enrich_session,
                    Some(&enrich_track_id),
                    play_request_id,
                    session_epoch,
                )
                .await
                {
                    notify_playback(&enrich_shared).await;
                }
            });
            return;
        }
        PlayerEvent::Paused {
            play_request_id,
            track_id,
            position_ms,
        } => {
            let reported_uri = spotify_uri_to_string(&track_id);
            let (accepted, audio_uri) = {
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                correlate_player_request(&mut snapshot, play_request_id, &reported_uri);
                if ignore_transport_halt_during_pending_load(&snapshot) {
                    log_transition(
                        &snapshot,
                        "player-paused",
                        "ignored-pending-load",
                        Some(&reported_uri),
                        Some(play_request_id),
                    );
                    return;
                }
                let audio_uri =
                    confirmed_player_audio_uri(&snapshot, play_request_id, &reported_uri);
                let pending_item = confirmed_player_item(&snapshot, play_request_id, &audio_uri);
                let decision = accept_player_identity(&mut snapshot, play_request_id, &audio_uri);
                if decision.is_confirmed() {
                    let record_previous_in_history = !decision.prepared_transport();
                    if snapshot.expected_track_uri.is_none() {
                        complete_pending_next_load(&mut snapshot, &audio_uri);
                    }
                    snapshot.current_player_reported_uri = Some(reported_uri.clone());
                    clear_player_item_candidate(&mut snapshot, play_request_id);
                    apply_confirmed_player_state(
                        &mut snapshot,
                        &audio_uri,
                        pending_item,
                        record_previous_in_history,
                        false,
                        position_ms,
                    );
                    log_transition(
                        &snapshot,
                        "player-paused",
                        "accepted",
                        Some(&audio_uri),
                        Some(play_request_id),
                    );
                    if let Some(recovery) = snapshot.diagnostics.finish_unavailable_streak() {
                        log_unavailable_recovery(&snapshot, &audio_uri, play_request_id, recovery);
                    }
                } else if matches!(&decision, PlayerIdentityDecision::Superseded { .. }) {
                    clear_player_item_candidate(&mut snapshot, play_request_id);
                    log_transition(
                        &snapshot,
                        "player-paused",
                        "ignored-superseded",
                        Some(&audio_uri),
                        Some(play_request_id),
                    );
                }
                (decision.is_confirmed(), audio_uri)
            };
            if !accepted {
                return;
            }
            notify_playback(shared).await;
            let enrich_shared = Arc::clone(shared);
            let enrich_session = session.clone();
            let enrich_track_id = SpotifyUri::from_uri(&audio_uri).unwrap_or(track_id);
            tokio::spawn(async move {
                if update_track_snapshot(
                    &enrich_shared,
                    &enrich_session,
                    Some(&enrich_track_id),
                    play_request_id,
                    session_epoch,
                )
                .await
                {
                    notify_playback(&enrich_shared).await;
                }
            });
            return;
        }
        PlayerEvent::Stopped {
            play_request_id,
            track_id,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let pending_advance = {
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                if ignore_transport_halt_during_pending_load(&snapshot) {
                    log_transition(
                        &snapshot,
                        "player-stopped",
                        "ignored-pending-load",
                        Some(&uri),
                        Some(play_request_id),
                    );
                    return;
                }
                if let Some(pending) =
                    take_pending_auto_advance(&mut snapshot, play_request_id, &uri)
                {
                    Some(pending)
                } else {
                    if !player_event_matches(&snapshot, play_request_id, &uri) {
                        log_transition(
                            &snapshot,
                            "player-stopped",
                            "ignored-superseded",
                            Some(&uri),
                            Some(play_request_id),
                        );
                        return;
                    }
                    snapshot.is_playing = false;
                    snapshot.audio_started = false;
                    snapshot.current_player_request_id = None;
                    snapshot.current_player_reported_uri = None;
                    clear_player_item_candidate(&mut snapshot, play_request_id);
                    snapshot.position_updated_at = Instant::now();
                    log_transition(
                        &snapshot,
                        "player-stopped",
                        "local-player-reload-required",
                        Some(&uri),
                        Some(play_request_id),
                    );
                    None
                }
            };
            if let Some((repeat_current, load_intent)) = pending_advance {
                play_next_from_queue_or_idle(shared, repeat_current, load_intent).await;
                notify_playback(shared).await;
                return;
            }
        }
        PlayerEvent::EndOfTrack {
            play_request_id,
            track_id,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            {
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                if !player_event_matches(&snapshot, play_request_id, &uri) {
                    return;
                }
                if snapshot.handoff_hold || snapshot.room_queue_active {
                    room_end::finish_managed_track(&mut snapshot);
                    drop(snapshot);
                    notify_playback(shared).await;
                    return;
                }
                if !mark_pending_auto_advance(&mut snapshot, play_request_id, &uri, true) {
                    return;
                }
                // The tail still plays and the next song follows in the same
                // stream (vendor/librespot-playback/LUFTIFY.md); the bar
                // flipped to Play for the whole gap before.
                snapshot.is_playing = true;
                log_transition(
                    &snapshot,
                    "player-end-of-track",
                    "waiting-for-stop",
                    Some(&uri),
                    Some(play_request_id),
                );
            }
            notify_playback(shared).await;
            return;
        }
        PlayerEvent::AudioKeyFailed {
            play_request_id,
            track_id,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            correlate_player_request(&mut snapshot, play_request_id, &uri);
            if !accept_unavailable(&mut snapshot, play_request_id, &uri) {
                return;
            }
            // A missing decryption key is not proof the song is unavailable.
            // Stop this request, preserving the queue and allowing Play to retry.
            let item = visible_playback_item(&snapshot);
            snapshot.duration_ms = published_duration_ms(&snapshot, item.as_ref());
            snapshot.current_item = item;
            halt_unavailable_auto_advance(&mut snapshot);
            log_transition(&snapshot, "player-audio-key-failed", "stopped-without-skipping", Some(&uri), Some(play_request_id));
            drop(snapshot);
            notify_playback(shared).await;
            return;
        }
        PlayerEvent::Unavailable {
            play_request_id,
            track_id,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let pending_next = {
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                correlate_player_request(&mut snapshot, play_request_id, &uri);
                if !accept_unavailable(&mut snapshot, play_request_id, &uri) {
                    // Nothing advances on this event; if playback then hangs,
                    // this line is the only trace of why.
                    log_transition(
                        &snapshot,
                        "player-unavailable",
                        "ignored-unmatched",
                        Some(&uri),
                        Some(play_request_id),
                    );
                    return;
                }
                handle_pending_next_unavailable(&mut snapshot, play_request_id, &uri)
            };
            match pending_next {
                NextUnavailableDecision::Retry { generation, uri } => {
                    notify_playback(shared).await;
                    spawn_pending_next_retry(Arc::clone(shared), generation, uri);
                    return;
                }
                NextUnavailableDecision::SkipToNext | NextUnavailableDecision::Unrelated => {}
            }
            let should_advance = {
                let mut snapshot = shared.playback.write().await;
                let sample = snapshot.diagnostics.record_unavailable(&uri);
                let should_advance = if sample.auto_advance_allowed {
                    mark_pending_auto_advance(&mut snapshot, play_request_id, &uri, false)
                } else {
                    halt_unavailable_auto_advance(&mut snapshot);
                    false
                };
                log_unavailable(
                    &snapshot,
                    &uri,
                    play_request_id,
                    if should_advance {
                        "auto-advance-pending"
                    } else {
                        "auto-advance-circuit-open"
                    },
                    sample,
                );
                should_advance
            };
            notify_playback(shared).await;
            if !should_advance {
                return;
            }
            return;
        }
        PlayerEvent::TrackChanged { audio_item } => {
            if !shared.playback.read().await.handoff_hold {
                let mut incoming = item_from_audio_item(&audio_item);
                let duration_ms = u64::from(audio_item.duration_ms);
                let mut snapshot = shared.playback.write().await;
                if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                    return;
                }
                let request_id = snapshot.current_player_request_id;
                if let Some(pending_item) = snapshot
                    .expected_item
                    .as_ref()
                    .filter(|item| same_item_uri(&item.uri, &incoming.uri))
                {
                    incoming = merge_media_items(Some(pending_item), incoming);
                }
                let current_matches = snapshot
                    .current_item
                    .as_ref()
                    .is_some_and(|item| same_item_uri(&item.uri, &incoming.uri));
                let incoming_uri = incoming.uri.clone();
                if current_matches {
                    let current = merge_media_items(snapshot.current_item.as_ref(), incoming);
                    if duration_ms > 0 {
                        snapshot.duration_ms = duration_ms;
                    }
                    snapshot.queue.remember_item(&current);
                    snapshot.current_item = Some(current);
                    log_transition(
                        &snapshot,
                        "player-track-changed",
                        "enriched-confirmed-current",
                        Some(&incoming_uri),
                        request_id,
                    );
                    drop(snapshot);
                    notify_playback(shared).await;
                    schedule_experimental_canvas(shared, &incoming_uri);
                    return;
                }
                snapshot.queue.remember_item(&incoming);
                if duration_ms > 0 {
                    snapshot.duration_ms = duration_ms;
                    if snapshot
                        .expected_track_uri
                        .as_deref()
                        .is_some_and(|expected| same_item_uri(expected, &incoming_uri))
                    {
                        if let Some(expected_item) = snapshot.expected_item.as_mut() {
                            expected_item.duration_ms = expected_item
                                .duration_ms
                                .filter(|ms| *ms > 0)
                                .or(Some(duration_ms));
                        }
                    }
                }
                snapshot.player_item_candidate = Some(PlayerItemCandidate {
                    request_id,
                    item: incoming,
                });
                let started_pending_audio = start_pending_audio_from_loaded_track(
                    &mut snapshot,
                    &incoming_uri,
                    duration_ms,
                );
                log_transition(
                    &snapshot,
                    "player-track-changed",
                    if started_pending_audio {
                        "audio-starting"
                    } else {
                        "staged-until-audio-confirmed"
                    },
                    Some(&incoming_uri),
                    request_id,
                );
                drop(snapshot);
                notify_playback(shared).await;
                schedule_experimental_canvas(shared, &incoming_uri);
                return;
            }
        }
        PlayerEvent::VolumeChanged { volume } => {
            // Connect may be acknowledging an older drag value. Publish the
            // current audible gain rather than rolling back the local preview.
            let mixer = shared
                .session
                .lock()
                .await
                .as_ref()
                .map(|active| Arc::clone(&active.local_volume));
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            let volume = mixer
                .as_ref()
                .map(|mixer| mixer.audible_volume())
                .unwrap_or(volume);
            snapshot.volume = connect_volume_to_unit(volume);
            snapshot.is_muted = volume == 0;
            if volume > 0 {
                snapshot.last_unmuted_volume = snapshot.volume;
            }
        }
        // Spirc always receives neutral shuffle/repeat load options. The local
        // snapshot and QueueLists own both settings and all track transitions.
        PlayerEvent::ShuffleChanged { .. } | PlayerEvent::RepeatChanged { .. } => return,
        PlayerEvent::Seeked {
            play_request_id,
            track_id,
            position_ms,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            if !player_position_event_allowed(&snapshot, play_request_id, &uri) {
                return;
            }
            let position_ms = if snapshot.is_playing {
                position_since(position_ms, received_at)
            } else {
                position_ms
            };
            apply_seeked_position(&mut snapshot, &uri, position_ms);
        }
        PlayerEvent::PositionChanged {
            play_request_id,
            track_id,
            position_ms,
        }
        | PlayerEvent::PositionCorrection {
            play_request_id,
            track_id,
            position_ms,
        } => {
            let uri = spotify_uri_to_string(&track_id);
            let mut snapshot = shared.playback.write().await;
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                return;
            }
            if !player_position_event_allowed(&snapshot, play_request_id, &uri) {
                return;
            }
            let position_ms = if snapshot.is_playing {
                position_since(position_ms, received_at)
            } else {
                position_ms
            };
            apply_reported_position(&mut snapshot, &uri, position_ms);
        }
        _ => {}
    }
    notify_playback(shared).await;
}

pub(super) struct PreparedTrackLoad {
    pub(super) item: MediaItem,
    pub(super) context_uri: Option<String>,
    pub(super) generation: u64,
    pub(super) explicit: bool,
    pub(super) refresh_context: bool,
    pub(super) rollback: PlaybackRollback,
}

#[derive(Debug, Clone)]
pub(super) struct PlaybackRollback {
    load_intent: u64,
    queue: QueueLists,
    context_uri: Option<String>,
    handoff_hold: bool,
    is_playing: bool,
    audio_started: bool,
    position_ms: u64,
    clock_track_uri: Option<String>,
    position_updated_at: Instant,
    committed_queue_revision: u64,
    committed_context_uri: Option<String>,
}

impl PlaybackRollback {
    pub(super) fn capture(snapshot: &PlaybackSnapshot, load_intent: u64) -> Self {
        Self {
            load_intent,
            queue: snapshot.queue.clone(),
            context_uri: snapshot.context_uri.clone(),
            handoff_hold: snapshot.handoff_hold,
            is_playing: snapshot.is_playing,
            audio_started: snapshot.audio_started,
            position_ms: snapshot.position_ms,
            clock_track_uri: snapshot.clock_track_uri.clone(),
            position_updated_at: snapshot.position_updated_at,
            committed_queue_revision: snapshot.queue.revision,
            committed_context_uri: snapshot.context_uri.clone(),
        }
    }

    pub(super) fn seal(&mut self, snapshot: &PlaybackSnapshot) {
        self.committed_queue_revision = snapshot.queue.revision;
        self.committed_context_uri = snapshot.context_uri.clone();
    }
}

pub(super) fn prepare_next_load(
    snapshot: &mut PlaybackSnapshot,
    intent: u64,
) -> Option<PreparedTrackLoad> {
    if !load_intent_is_current(snapshot, intent) {
        return None;
    }
    let mut queue = snapshot.queue.clone();
    retain_libre_playable_queue(&mut queue);
    let current_item = effective_cursor_item(snapshot);
    let current_uri = current_item.as_ref().map(|item| item.uri.clone());
    if let Some(current) = current_item {
        queue.push_history(&current.uri);
        queue.remember_item(&current);
    }
    let (entry, explicit) = if let Some(entry) = queue.pop_explicit() {
        (entry, true)
    } else {
        let entry = queue.take_next_or_wrap(
            current_uri.as_deref(),
            snapshot.repeat_mode == RepeatMode::All,
            snapshot.shuffle_enabled,
        )?;
        (entry, false)
    };
    commit_prepared_load(snapshot, queue, entry, explicit)
}

fn retain_libre_playable_queue(queue: &mut QueueLists) {
    queue
        .explicit
        .retain(|entry| is_playable_item_uri(&entry.item.uri));
    queue
        .upcoming
        .retain(|entry| is_playable_item_uri(&entry.item.uri));
    queue.context_uris.retain(|uri| is_playable_item_uri(uri));
}

pub(super) fn prepare_previous_load(
    snapshot: &mut PlaybackSnapshot,
    intent: u64,
) -> Option<PreparedTrackLoad> {
    if !load_intent_is_current(snapshot, intent) {
        return None;
    }
    let mut queue = snapshot.queue.clone();
    let current = effective_cursor_item(snapshot);
    let entry = queue.take_previous_or_wrap(
        current.as_ref(),
        snapshot.repeat_mode == RepeatMode::All,
        snapshot.shuffle_enabled,
    )?;
    commit_prepared_load(snapshot, queue, entry, false)
}

pub(super) fn commit_prepared_load(
    snapshot: &mut PlaybackSnapshot,
    mut queue: QueueLists,
    entry: QueueItem,
    explicit: bool,
) -> Option<PreparedTrackLoad> {
    if !is_playable_item_uri(&entry.item.uri) {
        return None;
    }
    let mut rollback = PlaybackRollback::capture(snapshot, snapshot.load_intent_epoch);
    let context_uri = snapshot.context_uri.clone();
    snapshot.handoff_hold = false;
    queue.remember_item(&entry.item);
    // Every prepared path already took this entry out of the lists. Later
    // syncs must not drop a title queued twice or a playlist repeat.
    queue.mark_current_consumed(&entry.item.uri, explicit);
    snapshot.queue = queue;
    commit_expected_item(snapshot, entry.item.clone());
    rollback.seal(snapshot);
    Some(PreparedTrackLoad {
        item: entry.item,
        context_uri,
        generation: snapshot.play_generation,
        explicit,
        refresh_context: false,
        rollback,
    })
}

pub(super) fn prepare_auto_advance_load(
    snapshot: &mut PlaybackSnapshot,
    repeat_current: bool,
    intent: u64,
) -> Option<PreparedTrackLoad> {
    if !load_intent_is_current(snapshot, intent) {
        return None;
    }
    if repeat_current && snapshot.repeat_mode == RepeatMode::One {
        let item = effective_cursor_item(snapshot)?;
        let queue = snapshot.queue.clone();
        return commit_prepared_load(snapshot, queue, QueueItem { item, uid: None }, false);
    }
    let mut prepared = prepare_next_load(snapshot, intent)?;
    prepared.refresh_context = !prepared.explicit
        && prepared
            .context_uri
            .as_deref()
            .is_some_and(context_owns_remote_queue);
    Some(prepared)
}

pub(super) async fn play_next_from_queue_or_idle(
    shared: &Arc<Shared>,
    repeat_current: bool,
    intent: u64,
) {
    let prepared = {
        let mut snapshot = shared.playback.write().await;
        if !load_intent_is_current(&snapshot, intent) {
            return;
        }
        if snapshot.handoff_hold || snapshot.room_queue_active {
            snapshot.is_playing = false;
            snapshot.audio_started = false;
            snapshot.position_updated_at = Instant::now();
            return;
        }
        let prepared = prepare_auto_advance_load(&mut snapshot, repeat_current, intent);
        if prepared.is_none() {
            snapshot.is_playing = false;
            snapshot.audio_started = false;
            snapshot.position_updated_at = Instant::now();
        }
        prepared
    };
    let Some(prepared) = prepared else {
        notify_playback(shared).await;
        return;
    };
    notify_playback(shared).await;
    let uri = prepared.item.uri.clone();
    match send_expected_track_load(shared, &uri, prepared.generation).await {
        Ok(true) => {
            schedule_experimental_canvas(shared, &uri);
            if prepared.refresh_context
                && let Some(context_uri) = prepared.context_uri
            {
                let refresh_shared = Arc::clone(shared);
                let refresh_uri = uri.clone();
                let refresh_generation = prepared.generation;
                tokio::spawn(async move {
                    // Remote playlist I/O may take seconds. Keep the PlayerEvent
                    // loop free to accept the incoming TrackChanged/Playing pair;
                    // refresh_context_queue guards against stale generations.
                    refresh_context_queue(
                        &refresh_shared,
                        &context_uri,
                        &refresh_uri,
                        refresh_generation,
                    )
                    .await;
                    spawn_queue_hydrate(refresh_shared);
                });
            } else {
                spawn_queue_hydrate(Arc::clone(shared));
            }
        }
        Ok(false) => {}
        Err(error) => {
            warn!(error = %error, adapter = "librespot", "automatic queue track could not start");
            fail_expected_load(shared, prepared.generation, &uri, Some(&prepared.rollback)).await;
            notify_playback(shared).await;
        }
    }
}

pub(super) async fn refresh_context_queue(
    shared: &Shared,
    context_uri: &str,
    current_uri: &str,
    generation: u64,
) {
    let started = Instant::now();
    let session = shared
        .session
        .lock()
        .await
        .as_ref()
        .map(|active| active.session.clone());
    let Some(session) = session else {
        return;
    };
    if !context_owns_remote_queue(context_uri) {
        return;
    }
    let remote = load_context_play_entries(&session, context_uri, &shared.playlist_cache).await;
    if remote.is_empty() {
        return;
    }
    {
        let mut snapshot = shared.playback.write().await;
        if snapshot.play_generation != generation
            || snapshot.context_uri.as_deref() != Some(context_uri)
        {
            return;
        }
        let shuffle = snapshot.shuffle_enabled;
        let uris = play_order(&[], &snapshot.queue.context_uris, &remote);
        if same_context_uris(&snapshot.queue.context_uris, &uris) {
            if !snapshot.diagnostics.unavailable_streak_active() {
                log_transition(
                    &snapshot,
                    "context-refresh",
                    "preserved-existing-order",
                    Some(current_uri),
                    None,
                );
                info!(
                    target: "luft_librespot::diagnostics",
                    adapter = "librespot",
                    phase = "context-refresh",
                    context_uri,
                    track_uri = uri_tail(current_uri),
                    generation,
                    remote_tracks = remote.len(),
                    elapsed_ms = started.elapsed().as_millis(),
                    "libre context refresh preserved the active queue order"
                );
            }
            return;
        }
        let current = context_seed_current_uri(&snapshot, Some(current_uri), &uris, shuffle);
        snapshot
            .queue
            .replace_upcoming_preserving(uris, current.as_deref().unwrap_or(""), shuffle);
        if !snapshot.diagnostics.unavailable_streak_active() {
            log_transition(
                &snapshot,
                "context-refresh",
                "rebuilt",
                Some(current_uri),
                None,
            );
            info!(
                target: "luft_librespot::diagnostics",
                adapter = "librespot",
                phase = "context-refresh",
                context_uri,
                track_uri = uri_tail(current_uri),
                generation,
                remote_tracks = remote.len(),
                elapsed_ms = started.elapsed().as_millis(),
                "libre context refresh completed"
            );
        }
    }
}

pub(super) async fn apply_pending_seek(shared: &Shared) -> bool {
    let Some(position_ms) = shared.playback.write().await.pending_seek_ms.take() else {
        return false;
    };
    let position = u32::try_from(position_ms).unwrap_or(u32::MAX);
    {
        let session = shared.session.lock().await;
        let Some(active) = session.as_ref() else {
            return false;
        };
        if let Err(error) = active.spirc.set_position_ms(position) {
            warn!(
                error = %error,
                position_ms,
                adapter = "librespot",
                "pending seek could not be applied"
            );
            return false;
        }
    }
    let mut snapshot = shared.playback.write().await;
    snapshot.position_ms = position_ms;
    snapshot.position_updated_at = Instant::now();
    true
}

pub(super) fn commit_expected_item(snapshot: &mut PlaybackSnapshot, item: MediaItem) {
    begin_expected_track(snapshot, &item.uri);
    snapshot.expected_item = Some(merge_media_items(snapshot.expected_item.as_ref(), item));
}

pub(super) async fn reserve_load_intent(shared: &Shared) -> u64 {
    let mut snapshot = shared.playback.write().await;
    snapshot.diagnostics.reset_unavailable_streak();
    cancel_pending_next_load(&mut snapshot);
    // Foreground playback must win over bulk metadata hydration. Incrementing
    // the epoch makes an active hydration loop stop after its current batch.
    snapshot.queue.begin_hydrate();
    reserve_snapshot_load_intent(&mut snapshot)
}

pub(super) fn reserve_snapshot_load_intent(snapshot: &mut PlaybackSnapshot) -> u64 {
    cancel_session_recovery(snapshot);
    snapshot.load_intent_epoch = snapshot.load_intent_epoch.saturating_add(1);
    snapshot.pending_auto_advance = None;
    snapshot.load_intent_epoch
}

pub(super) fn load_intent_is_current(snapshot: &PlaybackSnapshot, intent: u64) -> bool {
    snapshot.load_intent_epoch == intent
}

pub(super) fn context_seed_current_uri(
    snapshot: &PlaybackSnapshot,
    requested_uri: Option<&str>,
    uris: &[String],
    shuffle: bool,
) -> Option<String> {
    let player_confirmed = snapshot
        .expected_track_uri
        .is_none()
        .then(|| snapshot.current_item.as_ref())
        .flatten()
        .map(|item| item.uri.trim())
        .filter(|uri| is_playable_item_uri(uri))
        .map(str::to_string);
    player_confirmed
        .or_else(|| {
            requested_uri
                .map(str::trim)
                .filter(|uri| is_playable_item_uri(uri))
                .map(str::to_string)
        })
        .or_else(|| if shuffle { None } else { uris.first().cloned() })
}

pub(super) fn apply_context_seed_queue(
    snapshot: &mut PlaybackSnapshot,
    track_uri: Option<&str>,
    uris: Vec<String>,
) -> (Option<String>, bool, bool) {
    // Shuffle may have changed while the remote playlist was resolving. Read
    // it only under the same write lock that commits the resulting queue.
    let shuffle = snapshot.shuffle_enabled;
    let current = context_seed_current_uri(snapshot, track_uri, &uris, shuffle);
    snapshot
        .queue
        .replace_upcoming_preserving(uris, current.as_deref().unwrap_or(""), shuffle);
    let already_named = current.as_ref().is_some_and(|current| {
        snapshot.current_item.as_ref().is_some_and(|item| {
            same_item_uri(&item.uri, current) && !is_placeholder_title(&item.title, &item.uri)
        })
    });
    (current, already_named, shuffle)
}

pub(super) fn replace_startup_context_queue(
    snapshot: &mut PlaybackSnapshot,
    uris: Vec<String>,
    current_uri: &str,
) -> bool {
    let shuffle = snapshot.shuffle_enabled;
    snapshot
        .queue
        .replace_upcoming_preserving(uris, current_uri, shuffle);
    shuffle
}

pub(super) fn visible_playback_item(snapshot: &PlaybackSnapshot) -> Option<MediaItem> {
    if let Some(expected_uri) = snapshot.expected_track_uri.as_deref() {
        let current_is_expected = snapshot
            .current_item
            .as_ref()
            .is_some_and(|item| same_item_uri(&item.uri, expected_uri));
        if !current_is_expected {
            return snapshot
                .expected_item
                .clone()
                .or_else(|| Some(loading_item(expected_uri)));
        }
    }
    snapshot.current_item.clone()
}

pub(super) fn effective_cursor_item(snapshot: &PlaybackSnapshot) -> Option<MediaItem> {
    snapshot
        .expected_item
        .clone()
        .or_else(|| snapshot.expected_track_uri.as_deref().map(loading_item))
        .or_else(|| snapshot.current_item.clone())
}

pub(super) fn effective_cursor_uri(snapshot: &PlaybackSnapshot) -> Option<String> {
    snapshot
        .expected_track_uri
        .clone()
        .or_else(|| snapshot.current_item.as_ref().map(|item| item.uri.clone()))
}

pub(super) fn should_restart_previous(snapshot: &PlaybackSnapshot) -> bool {
    // Once a new track is pending, its logical position is zero even though the
    // last confirmed/audible item may still expose a late clock position.
    snapshot.expected_track_uri.is_none() && interpolated_position(snapshot) >= PREVIOUS_RESTART_MS
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PublishDisposition {
    Pending,
    Confirmed,
}

pub(super) fn publish_disposition(
    snapshot: &PlaybackSnapshot,
    uri: &str,
    expected_generation: Option<u64>,
) -> Option<PublishDisposition> {
    if expected_generation.is_some_and(|generation| snapshot.play_generation != generation) {
        return None;
    }
    match snapshot.expected_track_uri.as_deref() {
        Some(expected) if same_item_uri(expected, uri) => Some(PublishDisposition::Pending),
        Some(_) => None,
        None if snapshot
            .current_item
            .as_ref()
            .is_some_and(|current| same_item_uri(&current.uri, uri)) =>
        {
            Some(PublishDisposition::Confirmed)
        }
        None => None,
    }
}

pub(super) fn apply_publish_loading_item(
    snapshot: &mut PlaybackSnapshot,
    uri: &str,
    context_uri: Option<String>,
    expected_generation: Option<u64>,
) -> Option<PublishDisposition> {
    let disposition = publish_disposition(snapshot, uri, expected_generation)?;
    if disposition == PublishDisposition::Pending {
        snapshot.expected_item = Some(merge_media_items(
            snapshot.expected_item.as_ref(),
            loading_item(uri),
        ));
        snapshot.context_uri = context_uri;
        snapshot.queue.sync_current(uri);
    }
    Some(disposition)
}

pub(super) fn single_track_load_request(uri: &str) -> LoadRequest {
    LoadRequest::from_tracks(vec![uri.to_string()], single_track_load_options(uri))
}

pub(super) fn single_track_load_options(uri: &str) -> LoadRequestOptions {
    load_request_options(false, RepeatMode::Off, Some(uri))
}

pub(super) async fn send_expected_track_load(
    shared: &Shared,
    uri: &str,
    generation: u64,
) -> Result<bool, ProviderError> {
    let started = Instant::now();
    let _load_guard = shared.load_gate.lock().await;
    let load_gate_wait_ms = started.elapsed().as_millis();
    let is_current = {
        let snapshot = shared.playback.read().await;
        expected_load_is_current(&snapshot, generation, uri)
    };
    if !is_current {
        info!(
            adapter = "librespot",
            phase = "play",
            track_uri = uri_tail(uri),
            generation,
            load_gate_wait_ms,
            elapsed_ms = started.elapsed().as_millis(),
            "expected track load skipped, intent moved on"
        );
        return Ok(false);
    }

    let session_wait = Instant::now();
    let session = shared.session.lock().await;
    let session_lock_wait_ms = session_wait.elapsed().as_millis();
    let active = session.as_ref().ok_or_else(not_ready)?;
    active.spirc.activate().map_err(spirc_action_rejected)?;

    let mut snapshot = shared.playback.write().await;
    if !expected_load_is_current(&snapshot, generation, uri) {
        info!(
            adapter = "librespot",
            phase = "play",
            track_uri = uri_tail(uri),
            generation,
            load_gate_wait_ms,
            session_lock_wait_ms,
            elapsed_ms = started.elapsed().as_millis(),
            "expected track load skipped after session lock"
        );
        return Ok(false);
    }
    snapshot.sent_player_loads.push_back(PlayerLoadIntent {
        generation,
        uri: uri.to_string(),
    });
    if let Err(error) = active.spirc.load(single_track_load_request(uri)) {
        snapshot
            .sent_player_loads
            .retain(|sent| sent.generation != generation || !same_item_uri(&sent.uri, uri));
        return Err(spirc_action_rejected(error));
    }
    info!(
        adapter = "librespot",
        phase = "play",
        track_uri = uri_tail(uri),
        generation,
        load_gate_wait_ms,
        session_lock_wait_ms,
        expected_elapsed_ms = snapshot.expected_elapsed_ms(),
        elapsed_ms = started.elapsed().as_millis(),
        "expected track load sent"
    );
    Ok(true)
}

pub(super) fn spirc_action_rejected(error: librespot::core::error::Error) -> ProviderError {
    ProviderError::ActionRejected {
        message: format!("Librespot hat die Aktion abgelehnt: {error}"),
        retryable: true,
    }
}

pub(super) async fn fail_expected_load(
    shared: &Shared,
    generation: u64,
    uri: &str,
    rollback: Option<&PlaybackRollback>,
) {
    let mut snapshot = shared.playback.write().await;
    let rejected = reject_expected_load_with_rollback(&mut snapshot, generation, uri, rollback);
    log_transition(
        &snapshot,
        "spirc-load-error",
        if rejected {
            if rollback.is_some() {
                "rolled-back"
            } else {
                "cleared"
            }
        } else {
            "ignored-stale"
        },
        Some(uri),
        None,
    );
}

#[cfg(test)]
pub(super) fn reject_expected_load(
    snapshot: &mut PlaybackSnapshot,
    generation: u64,
    uri: &str,
) -> bool {
    reject_expected_load_with_rollback(snapshot, generation, uri, None)
}

pub(super) fn reject_expected_load_with_rollback(
    snapshot: &mut PlaybackSnapshot,
    generation: u64,
    uri: &str,
    rollback: Option<&PlaybackRollback>,
) -> bool {
    if !expected_generation_matches(snapshot, generation, uri) {
        return false;
    }
    clear_expected_track(snapshot);
    let rollback = rollback.filter(|rollback| rollback.load_intent == snapshot.load_intent_epoch);
    if let Some(rollback) = rollback {
        if snapshot.queue.revision == rollback.committed_queue_revision
            && snapshot.context_uri == rollback.committed_context_uri
        {
            snapshot.queue = rollback.queue.clone();
            snapshot.context_uri = rollback.context_uri.clone();
        }
        snapshot.handoff_hold = rollback.handoff_hold;
        snapshot.is_playing = rollback.is_playing;
        snapshot.audio_started = rollback.audio_started;
        snapshot.position_ms = rollback.position_ms;
        snapshot.clock_track_uri = rollback.clock_track_uri.clone();
        snapshot.position_updated_at = rollback.position_updated_at;
    } else {
        snapshot.is_playing = false;
        snapshot.audio_started = false;
        snapshot.position_updated_at = Instant::now();
    }
    true
}

#[cfg(test)]
pub(super) fn should_ignore_track_event(expected: Option<&str>, event_uri: &str) -> bool {
    expected.is_some_and(|expected| !same_item_uri(expected, event_uri))
}

pub(super) fn mark_pending_auto_advance(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
    repeat_current: bool,
) -> bool {
    if !player_event_matches(snapshot, request_id, uri) {
        return false;
    }
    clear_expected_track(snapshot);
    snapshot.is_playing = false;
    snapshot.audio_started = false;
    snapshot.position_updated_at = Instant::now();
    match snapshot.pending_auto_advance.as_mut() {
        Some(pending)
            if pending.generation == snapshot.play_generation
                && pending.request_id == request_id
                && same_item_uri(&pending.uri, uri) =>
        {
            // Unavailable must win over EndOfTrack so Repeat One does not loop
            // forever on a track the player cannot open.
            pending.repeat_current &= repeat_current;
        }
        _ => {
            let generation = snapshot.play_generation;
            let load_intent = reserve_snapshot_load_intent(snapshot);
            snapshot.pending_auto_advance = Some(PendingAutoAdvance {
                generation,
                load_intent,
                request_id,
                uri: uri.to_string(),
                repeat_current,
            });
        }
    }
    true
}

pub(super) fn halt_unavailable_auto_advance(snapshot: &mut PlaybackSnapshot) {
    clear_expected_track(snapshot);
    reserve_snapshot_load_intent(snapshot);
    snapshot.current_player_request_id = None;
    snapshot.current_player_reported_uri = None;
    snapshot.player_item_candidate = None;
    snapshot.is_playing = false;
    snapshot.audio_started = false;
    snapshot.position_updated_at = Instant::now();
}

pub(super) fn take_pending_auto_advance(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> Option<(bool, u64)> {
    let pending = snapshot.pending_auto_advance.as_ref()?;
    if pending.generation != snapshot.play_generation
        || pending.request_id != request_id
        || !same_item_uri(&pending.uri, uri)
        || !player_request_is_current(snapshot, request_id)
    {
        return None;
    }
    snapshot
        .pending_auto_advance
        .take()
        .map(|pending| (pending.repeat_current, pending.load_intent))
}

pub(super) fn catalog_current_item(catalog: &[MediaItem], track_uri: &str) -> MediaItem {
    let incoming = loading_item(track_uri);
    catalog
        .iter()
        .find(|item| {
            item.uri == track_uri
                || canonicalize_item_uri(&item.uri) == canonicalize_item_uri(track_uri)
        })
        .cloned()
        .map(|item| merge_media_items(Some(&item), incoming.clone()))
        .unwrap_or(incoming)
}

pub(super) fn empty_playback_state() -> PlaybackState {
    PlaybackState {
        current_item: None,
        is_playing: false,
        position_ms: 0,
        duration_ms: 0,
        volume: 0.5,
        is_muted: false,
        shuffle_enabled: false,
        repeat_mode: RepeatMode::Off,
        is_saved: false,
        context_uri: None,
        updated_at: Utc::now().to_rfc3339(),
        clock_ready: true,
    }
}

pub(super) fn snapshot_to_state(snapshot: &PlaybackSnapshot) -> PlaybackState {
    let current_item = visible_playback_item(snapshot);
    let pending = pending_expected_differs(snapshot);
    let duration_ms = published_duration_ms(snapshot, current_item.as_ref());
    PlaybackState {
        current_item,
        is_playing: snapshot.is_playing,
        position_ms: if pending {
            0
        } else {
            interpolated_position(snapshot)
        },
        duration_ms,
        volume: snapshot.volume,
        is_muted: snapshot.is_muted,
        shuffle_enabled: snapshot.shuffle_enabled,
        repeat_mode: snapshot.repeat_mode,
        is_saved: snapshot.is_saved,
        context_uri: snapshot.context_uri.clone(),
        updated_at: Utc::now().to_rfc3339(),
        clock_ready: snapshot.audio_started || !snapshot.is_playing,
    }
}

pub(super) fn published_duration_ms(
    snapshot: &PlaybackSnapshot,
    visible_item: Option<&MediaItem>,
) -> u64 {
    let item_duration = visible_item
        .and_then(|item| item.duration_ms)
        .filter(|ms| *ms > 0);
    if pending_expected_differs(snapshot) {
        return item_duration.unwrap_or(0);
    }
    item_duration.unwrap_or(snapshot.duration_ms)
}

pub(super) async fn refresh_saved_state(shared: &Shared, uri: &str, session_epoch: Option<u64>) {
    if session_epoch.is_some_and(|epoch| shared.session_epoch.load(Ordering::SeqCst) != epoch) {
        return;
    }
    let session = {
        shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone())
    };
    let Some(session) = session else {
        return;
    };
    let Some(saved) = crate::collection::is_saved(&session, uri).await else {
        return;
    };
    let mut snapshot = shared.playback.write().await;
    if session_epoch.is_some_and(|epoch| shared.session_epoch.load(Ordering::SeqCst) != epoch) {
        return;
    }
    if snapshot
        .current_item
        .as_ref()
        .is_some_and(|item| same_item_uri(&item.uri, uri))
    {
        snapshot.is_saved = saved;
    }
}

pub(super) async fn notify_playback(shared: &Shared) {
    let (state, lookahead) = {
        let mut snapshot = shared.playback.write().await;
        let state = snapshot_to_state(&snapshot);
        let lookahead = take_audio_lookahead_request(&mut snapshot);
        (state, lookahead)
    };
    shared.playback_tx.send_replace(state);
    if let Some(uri) = lookahead {
        dispatch_audio_lookahead(shared, uri).await;
    }
}

pub(super) fn spotify_uri_to_string(uri: &SpotifyUri) -> String {
    uri.to_uri().unwrap_or_else(|_| uri.to_string())
}

pub(super) fn uri_tail(uri: &str) -> &str {
    uri.rsplit(':')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(uri)
}

pub(super) fn startup_adopt_is_safe(
    is_playing: bool,
    audio_started: bool,
    play_generation: u64,
    startup_play_generation: u64,
) -> bool {
    !is_playing && !audio_started && play_generation == startup_play_generation
}

pub(super) fn startup_seed_is_safe(
    handoff_hold: bool,
    is_playing: bool,
    play_generation: u64,
    startup_play_generation: u64,
) -> bool {
    handoff_hold && !is_playing && play_generation == startup_play_generation
}

pub(super) fn nonempty_username(username: String) -> Option<String> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(super) fn not_ready() -> ProviderError {
    ProviderError::ActionRejected {
        message: "Librespot ist noch nicht bereit. Melde dich in den Einstellungen an.".into(),
        retryable: true,
    }
}

pub(super) fn invalid_playable_uri(uri: &str) -> ProviderError {
    ProviderError::ActionRejected {
        message: format!("Ungültige oder nicht abspielbare Spotify-URI: {uri}"),
        retryable: false,
    }
}

pub(super) fn invalid_context_uri(uri: &str) -> ProviderError {
    ProviderError::ActionRejected {
        message: format!("Ungültige Spotify-Kontext-URI: {uri}"),
        retryable: false,
    }
}

pub(super) fn sanitize_player_setup(setup: luft_audio::PlayerSetup) -> luft_audio::PlayerSetup {
    luft_audio::PlayerSetup {
        audio_device: sanitize_output_device(setup.audio_device),
        ..setup
    }
}

/// Librespot player options for the chosen quality and loudness.
pub(super) fn player_config(setup: &luft_audio::PlayerSetup) -> PlayerConfig {
    use librespot::playback::config::{Bitrate, NormalisationMethod};
    use luft_audio::StreamingQuality;
    let pregain = setup.loudness.pregain_db();
    PlayerConfig {
        bitrate: match setup.streaming_quality {
            StreamingQuality::Low => Bitrate::Bitrate96,
            StreamingQuality::Normal => Bitrate::Bitrate160,
            StreamingQuality::High => Bitrate::Bitrate320,
        },
        normalisation: pregain.is_some(),
        normalisation_pregain_db: pregain.unwrap_or(0.0),
        // Quiet tracks are raised toward the target; the dynamic method
        // limits them instead of letting them clip.
        normalisation_method: NormalisationMethod::Dynamic,
        ..PlayerConfig::default()
    }
}

pub(super) fn sanitize_output_device(device: Option<String>) -> Option<String> {
    device.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}
