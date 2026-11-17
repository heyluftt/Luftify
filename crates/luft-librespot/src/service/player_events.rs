use super::*;

/// Above this, a player event waited or took long enough to desync the UI clock.
const SLOW_PLAYER_EVENT: Duration = Duration::from_millis(750);

/// Receives Librespot's player events in order. A separate forwarder stamps
/// each event on arrival, so a handler that waits on a lock or I/O can no
/// longer age the positions the following events carry: a `Playing` handled
/// seconds late still lands the clock where the audio really is.
pub(super) fn spawn_player_events(
    shared: Arc<Shared>,
    mut events: librespot::playback::player::PlayerEventChannel,
    session: Session,
    session_epoch: u64,
) {
    let (stamped_tx, mut stamped) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            if stamped_tx.send((event, Instant::now())).is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some((event, received_at)) = stamped.recv().await {
            if shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
                break;
            }
            let kind = player_event_kind(&event);
            let queued = received_at.elapsed();
            let started = Instant::now();
            apply_player_event(&shared, &session, event, session_epoch, received_at).await;
            log_slow_player_event(kind, queued, started.elapsed());
        }
    });
}

/// Position the player reported at `received_at`, carried forward to now.
pub(super) fn position_since(position_ms: u32, received_at: Instant) -> u32 {
    let waited = u32::try_from(received_at.elapsed().as_millis()).unwrap_or(u32::MAX);
    position_ms.saturating_add(waited)
}

/// `queued_ms` names the victim, `handle_ms` the culprit: a slow handler
/// shows up with a large `handle_ms`, the events behind it with `queued_ms`.
fn log_slow_player_event(kind: &'static str, queued: Duration, handled: Duration) {
    if queued < SLOW_PLAYER_EVENT && handled < SLOW_PLAYER_EVENT {
        return;
    }
    warn!(
        target: "luft_librespot::diagnostics",
        adapter = "librespot",
        phase = "player-event",
        event = kind,
        queued_ms = queued.as_millis(),
        handle_ms = handled.as_millis(),
        "libre player event delayed"
    );
}

fn player_event_kind(event: &PlayerEvent) -> &'static str {
    match event {
        PlayerEvent::PlayRequestIdChanged { .. } => "play-request-id-changed",
        PlayerEvent::Stopped { .. } => "stopped",
        PlayerEvent::Loading { .. } => "loading",
        PlayerEvent::Preloading { .. } => "preloading",
        PlayerEvent::Playing { .. } => "playing",
        PlayerEvent::Paused { .. } => "paused",
        PlayerEvent::TimeToPreloadNextTrack { .. } => "time-to-preload",
        PlayerEvent::EndOfTrack { .. } => "end-of-track",
        PlayerEvent::Unavailable { .. } => "unavailable",
        PlayerEvent::AudioKeyFailed { .. } => "audio-key-failed",
        PlayerEvent::VolumeChanged { .. } => "volume-changed",
        PlayerEvent::PositionCorrection { .. } => "position-correction",
        PlayerEvent::PositionChanged { .. } => "position-changed",
        PlayerEvent::Seeked { .. } => "seeked",
        PlayerEvent::TrackChanged { .. } => "track-changed",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_late_handled_position_is_carried_forward() {
        let received_at = Instant::now() - Duration::from_millis(6_000);
        let position = position_since(10, received_at);
        assert!((6_010..6_500).contains(&position));
    }
}
