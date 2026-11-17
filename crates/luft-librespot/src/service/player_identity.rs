use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PlayerIdentityDecision {
    /// The event belongs to the latest local load. A different audio URI is
    /// valid here because Spotify can relink the requested track.
    Confirmed {
        replaced_expected_uri: Option<String>,
        prepared_transport: bool,
    },
    /// The player is finishing an older load while a newer transport command
    /// is pending. This event must not change current item, clock, or queue.
    Superseded {
        expected_uri: String,
    },
    Rejected,
}

impl PlayerIdentityDecision {
    pub(super) fn confirmed_mismatch(&self) -> Option<&str> {
        match self {
            Self::Confirmed {
                replaced_expected_uri: Some(uri),
                ..
            } => Some(uri),
            _ => None,
        }
    }

    pub(super) fn is_confirmed(&self) -> bool {
        matches!(self, Self::Confirmed { .. })
    }

    pub(super) fn prepared_transport(&self) -> bool {
        matches!(
            self,
            Self::Confirmed {
                prepared_transport: true,
                ..
            }
        )
    }
}

pub(super) fn confirmed_player_item(
    snapshot: &PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> Option<MediaItem> {
    let expected = snapshot
        .expected_item
        .as_ref()
        .filter(|item| same_item_uri(&item.uri, uri))
        .cloned();
    let candidate = snapshot
        .player_item_candidate
        .as_ref()
        .filter(|candidate| {
            same_item_uri(&candidate.item.uri, uri)
                && candidate
                    .request_id
                    .is_none_or(|candidate_request_id| candidate_request_id == request_id)
        })
        .map(|candidate| {
            let mut item = candidate.item.clone();
            item.uri = uri.to_string();
            item
        });
    match (expected, candidate) {
        (Some(expected), Some(candidate)) => Some(merge_media_items(Some(&expected), candidate)),
        (Some(expected), None) => Some(expected),
        (None, Some(candidate)) => Some(candidate),
        (None, None) => None,
    }
}

pub(super) fn confirmed_player_audio_uri(
    snapshot: &PlaybackSnapshot,
    request_id: u64,
    reported_uri: &str,
) -> String {
    snapshot
        .player_item_candidate
        .as_ref()
        .filter(|candidate| candidate.request_id == Some(request_id))
        .map(|candidate| candidate.item.uri.clone())
        .unwrap_or_else(|| reported_uri.to_string())
}

pub(super) fn clear_player_item_candidate(snapshot: &mut PlaybackSnapshot, request_id: u64) {
    if snapshot
        .player_item_candidate
        .as_ref()
        .is_some_and(|candidate| candidate.request_id == Some(request_id))
    {
        snapshot.player_item_candidate = None;
    }
}

pub(super) fn begin_expected_track(snapshot: &mut PlaybackSnapshot, uri: &str) -> u64 {
    snapshot.play_generation = snapshot.play_generation.saturating_add(1);
    // A matching in-memory look-ahead is consumed by this load. Clear the
    // marker so a rollback can schedule the same title again.
    snapshot.audio_lookahead_uri = None;
    // Show the next title immediately, but keep the clock frozen until the
    // player reports Playing. Starting interpolation at load-send time makes
    // lyrics run ahead of audio on tracks that still have to fetch keys/CDN.
    snapshot.is_playing = true;
    snapshot.audio_started = false;
    snapshot.position_ms = 0;
    snapshot.clock_track_uri = Some(uri.to_string());
    snapshot.position_updated_at = Instant::now();
    snapshot.expected_track_uri = Some(uri.to_string());
    snapshot.expected_item = Some(loading_item(uri));
    snapshot.expected_started_at = Some(Instant::now());
    snapshot.expected_player_request_id = None;
    snapshot.expected_player_baseline_request_id = snapshot.current_player_request_id;
    snapshot.player_item_candidate = None;
    snapshot.pending_auto_advance = None;
    snapshot.play_generation
}

pub(super) fn clear_expected_track(snapshot: &mut PlaybackSnapshot) {
    snapshot.expected_track_uri = None;
    snapshot.expected_item = None;
    snapshot.expected_started_at = None;
    snapshot.expected_player_request_id = None;
    snapshot.expected_player_baseline_request_id = None;
}

pub(super) fn expected_load_is_current(
    snapshot: &PlaybackSnapshot,
    generation: u64,
    uri: &str,
) -> bool {
    expected_generation_matches(snapshot, generation, uri)
}

pub(super) fn expected_generation_matches(
    snapshot: &PlaybackSnapshot,
    generation: u64,
    uri: &str,
) -> bool {
    snapshot.play_generation == generation
        && snapshot
            .expected_track_uri
            .as_deref()
            .is_some_and(|expected| same_item_uri(expected, uri))
}

pub(super) fn register_player_request(snapshot: &mut PlaybackSnapshot, request_id: u64) -> bool {
    if snapshot
        .current_player_request_id
        .is_some_and(|current| request_id <= current)
    {
        return false;
    }
    let keep_candidate = snapshot.player_item_candidate.take().filter(|candidate| {
        snapshot
            .expected_track_uri
            .as_deref()
            .is_some_and(|expected| same_item_uri(&candidate.item.uri, expected))
    });
    snapshot.current_player_request_id = Some(request_id);
    snapshot.current_player_reported_uri = None;
    snapshot.player_item_candidate = keep_candidate.map(|candidate| PlayerItemCandidate {
        request_id: Some(request_id),
        item: candidate.item,
    });
    snapshot.pending_auto_advance = None;
    true
}

/// Bind a player request to the latest local generation only when its reported
/// URI is the URI we actually sent. A bare request-id change is not enough.
pub(super) fn correlate_player_request(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> bool {
    if !player_request_is_current(snapshot, request_id) {
        return false;
    }
    if snapshot.expected_player_request_id == Some(request_id) {
        return true;
    }

    let generation = snapshot.play_generation;
    let expected = snapshot.expected_track_uri.clone();
    snapshot.sent_player_loads.retain(|sent| {
        expected.as_deref().is_some_and(|expected| {
            sent.generation == generation && same_item_uri(&sent.uri, expected)
        })
    });

    if snapshot.expected_player_request_id.is_none()
        && snapshot.expected_player_baseline_request_id != Some(request_id)
        && expected
            .as_deref()
            .is_some_and(|expected| same_item_uri(expected, uri))
        && let Some(index) = snapshot
            .sent_player_loads
            .iter()
            .position(|sent| sent.generation == generation && same_item_uri(&sent.uri, uri))
    {
        snapshot.sent_player_loads.remove(index);
        snapshot.expected_player_request_id = Some(request_id);
        return true;
    }

    // Once our current generation was bound, a newer non-matching request is
    // an external takeover. Before it is bound, a mismatch is commonly just a
    // late request from a superseded rapid skip and must leave the intent live.
    if snapshot.expected_player_request_id.is_some() {
        clear_expected_track(snapshot);
    }
    false
}

pub(super) fn player_request_is_current(snapshot: &PlaybackSnapshot, request_id: u64) -> bool {
    snapshot.current_player_request_id == Some(request_id)
}

pub(super) fn player_event_matches(
    snapshot: &PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> bool {
    if !player_request_is_current(snapshot, request_id) {
        return false;
    }
    if snapshot.expected_track_uri.is_some() {
        return snapshot.expected_player_request_id == Some(request_id)
            && snapshot.expected_player_baseline_request_id != Some(request_id);
    }
    snapshot
        .current_player_reported_uri
        .as_deref()
        .is_some_and(|reported| same_item_uri(reported, uri))
        || snapshot
            .current_item
            .as_ref()
            .is_none_or(|item| same_item_uri(&item.uri, uri))
}

/// Skip/load is still waiting for Playing. Stopped/Paused at 0 is the player
/// swapping the previous decoder and must not confirm pause or drop the new
/// request id — otherwise Playing is rejected and the UI stays at 0:00 paused.
pub(super) fn ignore_transport_halt_during_pending_load(snapshot: &PlaybackSnapshot) -> bool {
    snapshot
        .expected_track_uri
        .as_deref()
        .is_some_and(is_playable_item_uri)
}

pub(super) fn player_position_event_allowed(
    snapshot: &PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> bool {
    player_event_matches(snapshot, request_id, uri)
}

/// Decide ownership for a URI-bearing Playing/Paused event. Only the request
/// bound to the latest generation may commit playback state. This keeps rapid
/// Next and Previous clicks symmetric and prevents late events from rewriting
/// queue history or the visible title.
pub(super) fn accept_player_identity(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> PlayerIdentityDecision {
    let Some(expected) = snapshot.expected_track_uri.clone() else {
        return if player_request_is_current(snapshot, request_id) {
            PlayerIdentityDecision::Confirmed {
                replaced_expected_uri: None,
                prepared_transport: false,
            }
        } else {
            PlayerIdentityDecision::Rejected
        };
    };

    let Some(expected_request_id) = snapshot.expected_player_request_id else {
        return if player_request_is_current(snapshot, request_id) {
            PlayerIdentityDecision::Superseded {
                expected_uri: expected,
            }
        } else {
            PlayerIdentityDecision::Rejected
        };
    };
    if snapshot.expected_player_baseline_request_id == Some(expected_request_id)
        || snapshot.current_player_request_id != Some(expected_request_id)
        || request_id != expected_request_id
    {
        return PlayerIdentityDecision::Rejected;
    }

    let replaced_expected_uri = (!same_item_uri(&expected, uri)).then_some(expected);
    clear_expected_track(snapshot);
    PlayerIdentityDecision::Confirmed {
        replaced_expected_uri,
        prepared_transport: true,
    }
}

pub(super) fn accept_unavailable(
    snapshot: &mut PlaybackSnapshot,
    request_id: u64,
    uri: &str,
) -> bool {
    if !player_event_matches(snapshot, request_id, uri) {
        return false;
    }
    let expected_matches = snapshot
        .expected_track_uri
        .as_deref()
        .is_some_and(|expected| same_item_uri(expected, uri));
    let current_matches = snapshot
        .current_item
        .as_ref()
        .is_some_and(|item| same_item_uri(&item.uri, uri));
    let reported_matches = snapshot
        .current_player_reported_uri
        .as_deref()
        .is_some_and(|reported| same_item_uri(reported, uri));
    expected_matches || current_matches || reported_matches
}
