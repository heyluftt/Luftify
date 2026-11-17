use super::*;

const TRANSPORT_BURST_WINDOW: Duration = Duration::from_millis(400);
const TRANSPORT_SETTLE_DELAY: Duration = Duration::from_millis(200);

#[derive(Debug, Clone)]
pub(super) struct PreparedPreviousRestart {
    load_intent: u64,
    uri: Option<String>,
    previous_position_ms: u64,
}

impl PreparedPreviousRestart {
    pub(super) fn uri(&self) -> Option<&str> {
        self.uri.as_deref()
    }
}

/// A normal isolated Next/Previous remains immediate. Once a burst has begun,
/// its intermediate targets wait briefly so only the newest generation reaches
/// Libre. Queue and history are already updated synchronously for every click.
pub(super) fn transport_settle_delay(snapshot: &PlaybackSnapshot) -> Duration {
    snapshot
        .last_transport_load_sent_at
        .filter(|sent_at| sent_at.elapsed() < TRANSPORT_BURST_WINDOW)
        .map(|_| TRANSPORT_SETTLE_DELAY)
        .unwrap_or(Duration::ZERO)
}

/// Atomically claim the physical load for the latest prepared generation.
/// A superseded waiter exits without sending another stream request.
pub(super) fn claim_transport_load(
    snapshot: &mut PlaybackSnapshot,
    generation: u64,
    uri: &str,
) -> bool {
    if !expected_generation_matches(snapshot, generation, uri) {
        return false;
    }
    snapshot.last_transport_load_sent_at = Some(Instant::now());
    true
}

/// Reserve the first Previous click as an immediate restart in snapshot state.
/// A second click can therefore traverse history even if the physical seek of
/// the first command has not reached Libre yet.
pub(super) fn prepare_previous_restart(
    snapshot: &mut PlaybackSnapshot,
    load_intent: u64,
) -> Option<PreparedPreviousRestart> {
    if !load_intent_is_current(snapshot, load_intent) || !should_restart_previous(snapshot) {
        return None;
    }
    let prepared = PreparedPreviousRestart {
        load_intent,
        uri: snapshot.current_item.as_ref().map(|item| item.uri.clone()),
        previous_position_ms: interpolated_position(snapshot),
    };
    snapshot.position_ms = 0;
    snapshot.position_updated_at = Instant::now();
    Some(prepared)
}

pub(super) fn rollback_previous_restart(
    snapshot: &mut PlaybackSnapshot,
    prepared: &PreparedPreviousRestart,
) -> bool {
    if !load_intent_is_current(snapshot, prepared.load_intent)
        || snapshot.expected_track_uri.is_some()
        || prepared.uri.as_deref().is_some_and(|uri| {
            snapshot
                .current_item
                .as_ref()
                .is_none_or(|current| !same_item_uri(&current.uri, uri))
        })
    {
        return false;
    }
    snapshot.position_ms = prepared.previous_position_ms;
    snapshot.position_updated_at = Instant::now();
    true
}
