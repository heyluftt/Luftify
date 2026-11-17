use super::*;

const NEXT_RETRY_DELAY: Duration = Duration::from_secs(3);

#[derive(Debug, Clone)]
pub(super) struct PendingNextLoad {
    generation: u64,
    uri: String,
    retried: bool,
}

pub(super) enum NextUnavailableDecision {
    Unrelated,
    Retry {
        generation: u64,
        uri: String,
    },
    /// The retry failed too. Continue like an automatic transition so the
    /// shared unavailable circuit decides whether the next title may load.
    SkipToNext,
}

pub(super) fn arm_pending_next_load(
    snapshot: &mut PlaybackSnapshot,
    prepared: Option<&PreparedTrackLoad>,
) {
    snapshot.pending_next_load = prepared.map(|prepared| PendingNextLoad {
        generation: prepared.generation,
        uri: prepared.item.uri.clone(),
        retried: false,
    });
}

pub(super) fn cancel_pending_next_load(snapshot: &mut PlaybackSnapshot) {
    snapshot.pending_next_load = None;
}

pub(super) fn complete_pending_next_load(snapshot: &mut PlaybackSnapshot, uri: &str) {
    if snapshot
        .pending_next_load
        .as_ref()
        .is_some_and(|pending| same_item_uri(&pending.uri, uri))
    {
        snapshot.pending_next_load = None;
    }
}

pub(super) fn handle_pending_next_unavailable(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> NextUnavailableDecision {
    let Some(pending) = snapshot.pending_next_load.as_ref() else {
        return NextUnavailableDecision::Unrelated;
    };
    if pending.generation != snapshot.play_generation
        || !same_item_uri(&pending.uri, uri)
        || !player_event_matches(snapshot, request_id, uri)
    {
        return NextUnavailableDecision::Unrelated;
    }

    if pending.retried {
        snapshot.pending_next_load = None;
        log_transition(
            snapshot,
            "player-unavailable",
            "next-load-skipping",
            Some(uri),
            Some(request_id),
        );
        return NextUnavailableDecision::SkipToNext;
    }

    let generation = pending.generation;
    let uri = pending.uri.clone();
    snapshot
        .pending_next_load
        .as_mut()
        .expect("pending next load was present")
        .retried = true;
    clear_failed_next_request(snapshot);
    snapshot.expected_started_at = Some(Instant::now());
    snapshot.is_playing = true;
    snapshot.audio_started = false;
    snapshot.position_ms = 0;
    snapshot.position_updated_at = Instant::now();
    log_transition(
        snapshot,
        "player-unavailable",
        "next-load-cooling-down",
        Some(&uri),
        Some(request_id),
    );
    NextUnavailableDecision::Retry { generation, uri }
}

pub(super) fn spawn_pending_next_retry(shared: Arc<Shared>, generation: u64, uri: String) {
    tokio::spawn(async move {
        tokio::time::sleep(NEXT_RETRY_DELAY).await;
        match send_expected_track_load(&shared, &uri, generation).await {
            Ok(_) => {}
            Err(error) => {
                warn!(
                    error = %error,
                    adapter = "librespot",
                    phase = "play",
                    track_uri = uri_tail(&uri),
                    generation,
                    "next track retry could not be sent"
                );
                if finish_pending_next_failure_if_current(&shared, generation, &uri).await {
                    notify_playback(&shared).await;
                }
            }
        }
    });
}

async fn finish_pending_next_failure_if_current(
    shared: &Shared,
    generation: u64,
    uri: &str,
) -> bool {
    let mut snapshot = shared.playback.write().await;
    if snapshot
        .pending_next_load
        .as_ref()
        .is_none_or(|pending| pending.generation != generation || !same_item_uri(&pending.uri, uri))
    {
        return false;
    }
    finish_pending_next_failure(&mut snapshot, uri);
    log_transition(
        &snapshot,
        "spirc-load-error",
        "next-load-failed",
        Some(uri),
        None,
    );
    true
}

fn finish_pending_next_failure(snapshot: &mut PlaybackSnapshot, uri: &str) {
    let item = snapshot
        .expected_item
        .take()
        .filter(|item| same_item_uri(&item.uri, uri))
        .or_else(|| snapshot.queue.known.get(uri).cloned())
        .unwrap_or_else(|| loading_item(uri));
    clear_expected_track(snapshot);
    clear_failed_next_request(snapshot);
    snapshot.queue.remember_item(&item);
    snapshot.queue.sync_current(uri);
    snapshot.duration_ms = item
        .duration_ms
        .filter(|duration| *duration > 0)
        .unwrap_or(0);
    snapshot.current_item = Some(item);
    snapshot.pending_next_load = None;
    snapshot.is_saved = false;
    snapshot.is_playing = false;
    snapshot.audio_started = false;
    snapshot.position_ms = 0;
    snapshot.clock_track_uri = Some(uri.to_string());
    snapshot.position_updated_at = Instant::now();
}

fn clear_failed_next_request(snapshot: &mut PlaybackSnapshot) {
    snapshot.current_player_request_id = None;
    snapshot.current_player_reported_uri = None;
    snapshot.expected_player_request_id = None;
    snapshot.expected_player_baseline_request_id = None;
    snapshot.sent_player_loads.clear();
    snapshot.player_item_candidate = None;
    snapshot.pending_auto_advance = None;
}
