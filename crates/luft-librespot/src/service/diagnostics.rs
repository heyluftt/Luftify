use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

use super::*;

const UNAVAILABLE_LOG_INTERVAL: Duration = Duration::from_secs(5);
const UNAVAILABLE_STREAK_RESET_AFTER: Duration = Duration::from_secs(10);
const MAX_CONSECUTIVE_UNAVAILABLE_AUTO_ADVANCES: u64 = 3;

#[derive(Default)]
pub(super) struct PlaybackDiagnostics {
    unavailable_count: u64,
    unavailable_started_at: Option<Instant>,
    unavailable_last_seen_at: Option<Instant>,
    unavailable_last_log_at: Option<Instant>,
    unavailable_suppressed_since_log: u64,
    unavailable_uris: HashSet<String>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct UnavailableSample {
    pub(super) count: u64,
    pub(super) unique_tracks: usize,
    pub(super) elapsed_ms: u128,
    pub(super) suppressed_since_log: u64,
    pub(super) should_log: bool,
    pub(super) auto_advance_allowed: bool,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct UnavailableRecovery {
    pub(super) count: u64,
    pub(super) unique_tracks: usize,
    pub(super) elapsed_ms: u128,
}

impl PlaybackDiagnostics {
    pub(super) fn unavailable_streak_active(&self) -> bool {
        self.unavailable_count > 0
    }

    pub(super) fn record_unavailable(&mut self, uri: &str) -> UnavailableSample {
        let now = Instant::now();
        if self
            .unavailable_last_seen_at
            .is_some_and(|last| now.duration_since(last) >= UNAVAILABLE_STREAK_RESET_AFTER)
        {
            *self = Self::default();
        }
        let started_at = *self.unavailable_started_at.get_or_insert(now);
        self.unavailable_last_seen_at = Some(now);
        self.unavailable_count = self.unavailable_count.saturating_add(1);
        self.unavailable_uris.insert(uri.to_string());

        let should_log = self.unavailable_count <= 3
            || self.unavailable_count.is_power_of_two()
            || self
                .unavailable_last_log_at
                .is_none_or(|last| now.duration_since(last) >= UNAVAILABLE_LOG_INTERVAL);
        let suppressed_since_log = if should_log {
            let suppressed = self.unavailable_suppressed_since_log;
            self.unavailable_suppressed_since_log = 0;
            self.unavailable_last_log_at = Some(now);
            suppressed
        } else {
            self.unavailable_suppressed_since_log =
                self.unavailable_suppressed_since_log.saturating_add(1);
            self.unavailable_suppressed_since_log
        };

        UnavailableSample {
            count: self.unavailable_count,
            unique_tracks: self.unavailable_uris.len(),
            elapsed_ms: now.duration_since(started_at).as_millis(),
            suppressed_since_log,
            should_log,
            auto_advance_allowed: self.unavailable_count
                <= MAX_CONSECUTIVE_UNAVAILABLE_AUTO_ADVANCES,
        }
    }

    pub(super) fn reset_unavailable_streak(&mut self) {
        *self = Self::default();
    }

    pub(super) fn finish_unavailable_streak(&mut self) -> Option<UnavailableRecovery> {
        if self.unavailable_count == 0 {
            return None;
        }
        let recovery = UnavailableRecovery {
            count: self.unavailable_count,
            unique_tracks: self.unavailable_uris.len(),
            elapsed_ms: self
                .unavailable_started_at
                .map(|started| started.elapsed().as_millis())
                .unwrap_or_default(),
        };
        *self = Self::default();
        Some(recovery)
    }
}

struct QueueDiagnostics {
    context_tracks: usize,
    unique_context_tracks: usize,
    current_context_position: Option<usize>,
    explicit_tracks: usize,
    upcoming_tracks: usize,
    unique_upcoming_tracks: usize,
    history_tracks: usize,
    queue_revision: u64,
    next_uri: Option<String>,
}

impl QueueDiagnostics {
    fn capture(snapshot: &PlaybackSnapshot) -> Self {
        let cursor = snapshot
            .expected_track_uri
            .as_deref()
            .or_else(|| snapshot.current_item.as_ref().map(|item| item.uri.as_str()));
        Self {
            context_tracks: snapshot.queue.context_uris.len(),
            unique_context_tracks: unique_uri_count(
                snapshot.queue.context_uris.iter().map(String::as_str),
            ),
            current_context_position: cursor.and_then(|cursor| {
                snapshot
                    .queue
                    .context_uris
                    .iter()
                    .position(|uri| same_item_uri(uri, cursor))
                    .map(|index| index + 1)
            }),
            explicit_tracks: snapshot.queue.explicit.len(),
            upcoming_tracks: snapshot.queue.upcoming.len(),
            unique_upcoming_tracks: unique_uri_count(
                snapshot
                    .queue
                    .upcoming
                    .iter()
                    .map(|entry| entry.item.uri.as_str()),
            ),
            history_tracks: snapshot.queue.history.len(),
            queue_revision: snapshot.queue.revision,
            next_uri: snapshot
                .queue
                .explicit
                .first()
                .or_else(|| snapshot.queue.upcoming.first())
                .map(|entry| entry.item.uri.clone()),
        }
    }
}

fn unique_uri_count<'a>(uris: impl Iterator<Item = &'a str>) -> usize {
    uris.filter_map(canonicalize_item_uri)
        .collect::<HashSet<_>>()
        .len()
}

pub(super) fn log_transition(
    snapshot: &PlaybackSnapshot,
    event: &str,
    outcome: &str,
    target_uri: Option<&str>,
    request_id: Option<u64>,
) {
    let queue = QueueDiagnostics::capture(snapshot);
    let current_uri = snapshot.current_item.as_ref().map(|item| item.uri.as_str());
    let candidate_uri = snapshot
        .player_item_candidate
        .as_ref()
        .map(|candidate| candidate.item.uri.as_str());
    let candidate_request_id = snapshot
        .player_item_candidate
        .as_ref()
        .and_then(|candidate| candidate.request_id);
    let current_placeholder = snapshot
        .current_item
        .as_ref()
        .is_some_and(|item| is_placeholder_title(&item.title, &item.uri));
    let expected_placeholder = snapshot
        .expected_item
        .as_ref()
        .is_some_and(|item| is_placeholder_title(&item.title, &item.uri));
    let pending = pending_expected_differs(snapshot);
    let published_position_ms = if pending {
        0
    } else {
        interpolated_position(snapshot)
    };
    let clock_ready = snapshot.audio_started || !snapshot.is_playing;
    info!(
        target: "luft_librespot::diagnostics",
        adapter = "librespot",
        phase = "transition",
        event,
        outcome,
        target_uri = target_uri.map(uri_tail),
        current_uri = current_uri.map(uri_tail),
        player_reported_uri = snapshot.current_player_reported_uri.as_deref().map(uri_tail),
        expected_uri = snapshot.expected_track_uri.as_deref().map(uri_tail),
        expected_elapsed_ms = snapshot.expected_elapsed_ms(),
        pending_mismatch = pending,
        context_uri = snapshot.context_uri.as_deref(),
        request_id = ?request_id,
        player_request_id = ?snapshot.current_player_request_id,
        expected_request_id = ?snapshot.expected_player_request_id,
        candidate_request_id = ?candidate_request_id,
        candidate_uri = candidate_uri.map(uri_tail),
        generation = snapshot.play_generation,
        load_intent = snapshot.load_intent_epoch,
        shuffle = snapshot.shuffle_enabled,
        repeat = ?snapshot.repeat_mode,
        playing = snapshot.is_playing,
        audio_started = snapshot.audio_started,
        clock_ready,
        position_ms = published_position_ms,
        duration_ms = snapshot.duration_ms,
        current_placeholder,
        expected_placeholder,
        queue_revision = queue.queue_revision,
        queue_context = queue.context_tracks,
        queue_context_unique = queue.unique_context_tracks,
        current_context_position = ?queue.current_context_position,
        queue_explicit = queue.explicit_tracks,
        queue_upcoming = queue.upcoming_tracks,
        queue_upcoming_unique = queue.unique_upcoming_tracks,
        queue_history = queue.history_tracks,
        next_uri = queue.next_uri.as_deref().map(uri_tail),
        "libre playback transition"
    );
}

pub(super) fn log_unavailable(
    snapshot: &PlaybackSnapshot,
    uri: &str,
    request_id: u64,
    outcome: &str,
    sample: UnavailableSample,
) {
    if !sample.should_log {
        return;
    }
    let queue = QueueDiagnostics::capture(snapshot);
    warn!(
        target: "luft_librespot::diagnostics",
        adapter = "librespot",
        phase = "unavailable-streak",
        outcome,
        track_uri = uri_tail(uri),
        request_id,
        player_request_id = ?snapshot.current_player_request_id,
        expected_request_id = ?snapshot.expected_player_request_id,
        generation = snapshot.play_generation,
        load_intent = snapshot.load_intent_epoch,
        consecutive = sample.count,
        unique_tracks = sample.unique_tracks,
        elapsed_ms = sample.elapsed_ms,
        suppressed_since_log = sample.suppressed_since_log,
        shuffle = snapshot.shuffle_enabled,
        repeat = ?snapshot.repeat_mode,
        queue_context = queue.context_tracks,
        current_context_position = ?queue.current_context_position,
        queue_upcoming = queue.upcoming_tracks,
        queue_history = queue.history_tracks,
        next_uri = queue.next_uri.as_deref().map(uri_tail),
        "libre track unavailable streak"
    );
}

pub(super) fn log_unavailable_recovery(
    snapshot: &PlaybackSnapshot,
    uri: &str,
    request_id: u64,
    recovery: UnavailableRecovery,
) {
    let queue = QueueDiagnostics::capture(snapshot);
    warn!(
        target: "luft_librespot::diagnostics",
        adapter = "librespot",
        phase = "unavailable-recovery",
        track_uri = uri_tail(uri),
        request_id,
        consecutive = recovery.count,
        unique_tracks = recovery.unique_tracks,
        elapsed_ms = recovery.elapsed_ms,
        generation = snapshot.play_generation,
        queue_upcoming = queue.upcoming_tracks,
        queue_history = queue.history_tracks,
        current_context_position = ?queue.current_context_position,
        "libre recovered after unavailable streak"
    );
}
