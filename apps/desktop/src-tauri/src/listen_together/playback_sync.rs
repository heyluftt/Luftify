use super::*;

pub(super) async fn apply_playback(
    provider: &dyn SpotifyProvider,
    session: &mut Session,
    state: AuthoritativePlayback,
) {
    if is_placeholder_playback(&state) {
        return;
    }
    if !should_apply_revision(state.revision, session.last_applied_revision) {
        return;
    }
    if state.track.is_none() {
        // An empty host player must not seek or resume the guest's previous song.
        if let Err(error) = provider.pause().await {
            session.error = Some(error.to_string());
            return;
        }
        session.last_applied_revision = state.revision;
        session.last_sync_ms = Some(now_ms());
        session.error = None;
        return;
    }
    let local = provider.get_state().await.ok();
    let remote_uri = state.track.as_ref().map(|track| track.uri.as_str());
    let local_uri = local
        .as_ref()
        .and_then(|state| state.current_item.as_ref().map(|item| item.uri.as_str()));
    let track_changed = session.queue_runtime.restart_occurrence
        || match (remote_uri, local_uri) {
            (Some(remote), Some(local)) => remote != local,
            (Some(_), None) => true,
            (None, _) => false,
        };

    // Always start the exact track URI. play_context starts a playlist/album and
    // often lands on the first item at 0:00 instead of the host's current track.
    if track_changed {
        if let Some(uri) = remote_uri {
            if let Err(error) = provider.play_uri(uri).await {
                warn!(error = %error, uri, "listen-together track apply failed");
                session.error = Some(format!("Titel konnte nicht gestartet werden: {error}"));
                return;
            }
            session.queue_runtime.restart_occurrence = false;
        }
    }

    let fresh = if let Some(uri) = remote_uri
        .filter(|_| track_changed || local.as_ref().is_some_and(|state| !state.clock_ready))
    {
        wait_for_current_uri(provider, uri).await
    } else {
        local
    };
    let Some(mut fresh) = fresh else {
        session.error = Some("listen.trackPending".into());
        return;
    };
    // Transport commands can take time. Confirm them before calculating the seek.
    let transport_changed = fresh.is_playing != state.is_playing;
    if transport_changed {
        let result = if state.is_playing {
            provider.play().await
        } else {
            provider.pause().await
        };
        if let Err(error) = result {
            session.error = Some(error.to_string());
            return;
        }
        let Some(confirmed) = provider.get_state().await.ok().filter(|local| {
            local.clock_ready
                && local.is_playing == state.is_playing
                && local.current_item.as_ref().map(|item| item.uri.as_str()) == remote_uri
        }) else {
            session.error = Some("listen.trackPending".into());
            return;
        };
        fresh = confirmed;
    }
    // Account for time spent waiting for the exact track to load.
    let expected = expected_position_ms(
        state.position_ms,
        state.is_playing,
        state.server_time_ms,
        now_ms().saturating_add(session.clock_offset_ms),
        state.track.as_ref().and_then(|track| track.duration_ms),
    );
    let local_pos = fresh.position_ms;
    session.drift_ms = local_pos as i64 - expected as i64;
    let can_seek = session
        .last_seek
        .is_none_or(|at| at.elapsed() >= SEEK_COOLDOWN);
    // A newly selected occurrence starts at its exact target, including a
    // duplicate URI. The normal drift tolerance only applies while it runs.
    let must_seek = (track_changed && local_pos != expected)
        || (transport_changed && classify_drift(session.drift_ms) == DriftAction::Seek);
    if must_seek || (classify_drift(session.drift_ms) == DriftAction::Seek && can_seek) {
        if let Err(error) = provider.seek(expected).await {
            warn!(error = %error, "listen-together seek failed");
            session.error = Some(error.to_string());
            return;
        } else {
            session.last_seek = Some(Instant::now());
        }
    }

    {
        let local = fresh;
        if local.shuffle_enabled != state.shuffle {
            let _ = provider.set_shuffle(state.shuffle).await;
        }
        let repeat = match state.repeat {
            RepeatMode::Off => CoreRepeat::Off,
            RepeatMode::All => CoreRepeat::All,
            RepeatMode::One => CoreRepeat::One,
        };
        if local.repeat_mode != repeat {
            let _ = provider.set_repeat(repeat).await;
        }
    }
    session.last_applied_revision = state.revision;
    session.last_sync_ms = Some(now_ms());
    session.error = None;
}

pub(super) fn apply_queue(session: &mut Session, queue: QueueSnapshot) {
    if !should_apply_revision(queue.revision, session.last_applied_queue) {
        return;
    }
    session.last_applied_queue = queue.revision;
    // Do not clear/rebuild the guest queue. That interrupts the current track
    // (wrong song, pause, or restart at 0:00). Track sync is the source of truth.
}

pub(super) async fn wait_for_current_uri(
    provider: &dyn SpotifyProvider,
    uri: &str,
) -> Option<PlaybackState> {
    let deadline = Instant::now() + Duration::from_secs(3);
    for _ in 0..TRACK_WAIT_ATTEMPTS {
        tokio::time::sleep(TRACK_WAIT_STEP).await;
        let result = tokio::time::timeout_at(deadline, provider.get_state()).await;
        let Ok(result) = result else {
            return None;
        };
        let Ok(state) = result else {
            continue;
        };
        if state.clock_ready
            && state
                .current_item
                .as_ref()
                .is_some_and(|item| item.uri == uri)
        {
            return Some(state);
        }
    }
    None
}

fn is_placeholder_playback(state: &AuthoritativePlayback) -> bool {
    state.revision <= 1 && state.track.is_none() && !state.is_playing && state.position_ms == 0
}
