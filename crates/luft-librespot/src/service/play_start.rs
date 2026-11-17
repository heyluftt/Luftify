use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PlayStartDecision {
    Resume,
    KeepPending,
    Reload(PlayReloadReason),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PlayReloadReason {
    HandoffHold,
    LocalPlayerMissing,
    PlayerTrackMismatch,
}

impl PlayStartDecision {
    pub(super) fn should_reload(self) -> bool {
        matches!(self, Self::Reload(_))
    }

    pub(super) fn keeps_pending(self) -> bool {
        matches!(self, Self::KeepPending)
    }

    pub(super) fn mode(self) -> &'static str {
        match self {
            Self::Resume => "resume",
            Self::KeepPending => "keep-pending",
            Self::Reload(_) => "reload",
        }
    }

    pub(super) fn reason(self) -> &'static str {
        match self {
            Self::Resume => "local-player-ready",
            Self::KeepPending => "pending-expected-load",
            Self::Reload(PlayReloadReason::HandoffHold) => "handoff-hold",
            Self::Reload(PlayReloadReason::LocalPlayerMissing) => "local-player-missing",
            Self::Reload(PlayReloadReason::PlayerTrackMismatch) => "local-player-track-mismatch",
        }
    }
}

pub(super) fn pending_expected_differs(snapshot: &PlaybackSnapshot) -> bool {
    let Some(expected) = snapshot
        .expected_track_uri
        .as_deref()
        .filter(|uri| is_playable_item_uri(uri))
    else {
        return false;
    };
    snapshot
        .current_item
        .as_ref()
        .is_none_or(|item| !same_item_uri(&item.uri, expected))
}

pub(super) fn decide_play_start(snapshot: &PlaybackSnapshot) -> PlayStartDecision {
    // A context/uri play already owns the next track. Reloading `current_item`
    // would restart the restored title and fight the in-flight load.
    if pending_expected_differs(snapshot) {
        return PlayStartDecision::KeepPending;
    }
    if snapshot.handoff_hold {
        return PlayStartDecision::Reload(PlayReloadReason::HandoffHold);
    }
    let Some(current_uri) = snapshot
        .current_item
        .as_ref()
        .map(|item| item.uri.as_str())
        .filter(|uri| is_playable_item_uri(uri))
    else {
        return PlayStartDecision::Resume;
    };
    if snapshot.current_player_request_id.is_none()
        || snapshot.current_player_reported_uri.is_none()
    {
        return PlayStartDecision::Reload(PlayReloadReason::LocalPlayerMissing);
    }
    if snapshot
        .current_player_reported_uri
        .as_deref()
        .is_some_and(|reported| !same_item_uri(reported, current_uri))
    {
        return PlayStartDecision::Reload(PlayReloadReason::PlayerTrackMismatch);
    }
    PlayStartDecision::Resume
}
