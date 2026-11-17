use std::time::Instant;

use serde_json::Value;

// The analytics task checkpoints active playback every 15 seconds. Keeping the
// same upper bound avoids dropping ten seconds from otherwise healthy periods
// that happen to have no progress event between two checkpoints.
const MAX_ACCUMULATED_GAP_MS: u64 = 15_000;
const SEEK_TOLERANCE_MS: i128 = 4_000;
const REPEAT_RESET_POSITION_MS: u64 = 5_000;
const REPEAT_MIN_PREVIOUS_POSITION_MS: u64 = 30_000;
const REPEAT_TIMING_TOLERANCE_MS: u64 = 5_000;
/// A restart jumps back clearly, not the jitter of a late progress event.
const RESTART_MIN_JUMP_MS: u64 = 10_000;
const MAX_REPEAT_OBSERVATION_GAP_MS: u64 = 20_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CreatorData {
    pub name: String,
    pub uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TrackData {
    pub uri: String,
    pub source: String,
    pub item_type: String,
    pub title: String,
    pub creators: Vec<CreatorData>,
    pub album_uri: Option<String>,
    pub album_name: Option<String>,
    pub duration_ms: Option<u64>,
    pub cover_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SessionData {
    pub id: String,
    pub track: TrackData,
    pub context_uri: Option<String>,
    pub context_name: Option<String>,
    pub context_type: String,
    pub source: String,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub start_position_ms: Option<u64>,
    pub end_position_ms: Option<u64>,
    pub listened_ms: u64,
    pub qualified_play: bool,
    pub completed: bool,
    pub seek_count: u32,
    pub pause_count: u32,
    pub repeat_cycle: u32,
    pub end_reason: Option<String>,
}

#[derive(Debug)]
struct ActiveSession {
    id: String,
    track: TrackData,
    context_uri: Option<String>,
    context_name: Option<String>,
    context_type: String,
    started_at_ms: i64,
    start_position_ms: u64,
    last_position_ms: u64,
    max_position_ms: u64,
    listened_ms: u64,
    is_playing: bool,
    seek_count: u32,
    pause_count: u32,
    repeat_cycle: u32,
    last_observed_at: Instant,
    last_position_observed_at: Instant,
    repeat_one: bool,
    persist_pending: bool,
}

impl ActiveSession {
    fn advance(&mut self, now: Instant) -> u64 {
        let elapsed_ms = duration_millis(now.saturating_duration_since(self.last_observed_at));
        self.last_observed_at = now;
        if !self.is_playing {
            return 0;
        }
        let accumulated = elapsed_ms.min(MAX_ACCUMULATED_GAP_MS);
        if accumulated > 0 {
            self.listened_ms = self.listened_ms.saturating_add(accumulated);
            self.persist_pending = true;
        }
        accumulated
    }

    /// Heard long enough to count as a play (30 s, or half of a short song).
    fn qualifies(&self) -> bool {
        let qualified_threshold = self
            .track
            .duration_ms
            .filter(|duration| *duration > 0)
            .map(|duration| 30_000_u64.min(duration / 2))
            .unwrap_or(30_000);
        self.listened_ms >= qualified_threshold
    }

    fn snapshot(&self, ended_at_ms: Option<i64>, end_reason: Option<&str>) -> SessionData {
        let duration_ms = self.track.duration_ms.filter(|duration| *duration > 0);
        let qualified_play = self.qualifies();
        let reached_end = duration_ms.is_some_and(|duration| {
            self.max_position_ms.saturating_mul(100) >= duration.saturating_mul(90)
        });
        let completed = qualified_play && (end_reason == Some("repeat") || reached_end);
        SessionData {
            id: self.id.clone(),
            track: self.track.clone(),
            context_uri: self.context_uri.clone(),
            context_name: self.context_name.clone(),
            context_type: self.context_type.clone(),
            source: self.track.source.clone(),
            started_at_ms: self.started_at_ms,
            ended_at_ms,
            start_position_ms: Some(self.start_position_ms),
            end_position_ms: Some(self.last_position_ms),
            listened_ms: self.listened_ms,
            qualified_play,
            completed,
            seek_count: self.seek_count,
            pause_count: self.pause_count,
            repeat_cycle: self.repeat_cycle,
            end_reason: end_reason.map(str::to_owned),
        }
    }
}

pub(super) struct ListeningTracker {
    enabled: bool,
    session_prefix: String,
    next_session: u64,
    active: Option<ActiveSession>,
}

impl ListeningTracker {
    pub fn new(session_prefix: String, enabled: bool) -> Self {
        Self {
            enabled,
            session_prefix,
            next_session: 0,
            active: None,
        }
    }

    pub fn set_enabled(
        &mut self,
        enabled: bool,
        now: Instant,
        wall_clock_ms: i64,
    ) -> Option<SessionData> {
        if self.enabled == enabled {
            return None;
        }
        self.enabled = enabled;
        if enabled {
            None
        } else {
            self.finish(now, wall_clock_ms, "disabled")
        }
    }

    #[cfg(test)]
    pub fn on_disconnected(&mut self, now: Instant, wall_clock_ms: i64) -> Option<SessionData> {
        self.finish(now, wall_clock_ms, "bridge-disconnected")
    }

    #[cfg(test)]
    pub fn on_source_lost(
        &mut self,
        now: Instant,
        wall_clock_ms: i64,
        reason: &str,
    ) -> Option<SessionData> {
        self.finish(now, wall_clock_ms, reason)
    }

    pub fn on_message(
        &mut self,
        name: &str,
        payload: &Value,
        now: Instant,
        wall_clock_ms: i64,
    ) -> Vec<SessionData> {
        if !self.enabled {
            return Vec::new();
        }
        match name {
            "player.stateChanged" | "player.trackChanged" | "player.playbackChanged" => {
                self.on_state(payload, now, wall_clock_ms)
            }
            "player.progressChanged" => self.on_progress(payload, now, wall_clock_ms),
            _ => Vec::new(),
        }
    }

    pub fn checkpoint(&mut self, now: Instant) -> Option<SessionData> {
        let active = self.active.as_mut()?;
        if active.is_playing {
            active.advance(now);
        } else {
            active.last_observed_at = now;
        }
        if !active.persist_pending || active.listened_ms == 0 {
            return None;
        }
        active.persist_pending = false;
        Some(active.snapshot(None, None))
    }

    pub fn shutdown(&mut self, now: Instant, wall_clock_ms: i64) -> Option<SessionData> {
        self.finish(now, wall_clock_ms, "app-shutdown")
    }

    pub fn clear(&mut self) {
        self.active = None;
    }

    fn on_state(&mut self, payload: &Value, now: Instant, wall_clock_ms: i64) -> Vec<SessionData> {
        let mut completed = Vec::new();
        let item_field = payload.get("currentItem");
        let parsed_track = item_field.and_then(parse_track);

        if item_field.is_some_and(Value::is_null) {
            if let Some(session) = self.finish(now, wall_clock_ms, "player-empty") {
                completed.push(session);
            }
            return completed;
        }

        if let Some(track) = parsed_track {
            let changed = self
                .active
                .as_ref()
                .is_some_and(|active| active.track.uri != track.uri);
            if changed && let Some(session) = self.finish(now, wall_clock_ms, "track-changed") {
                completed.push(session);
            }
            if self.active.is_none() {
                self.start(
                    track,
                    state_position(payload).unwrap_or_default(),
                    state_is_playing(payload).unwrap_or(false),
                    payload_context_uri(payload),
                    payload_context_name(payload),
                    0,
                    state_repeat_one(payload).unwrap_or(false),
                    now,
                    wall_clock_ms,
                );
            } else if let Some(active) = self.active.as_mut() {
                active.track = track;
            }
        }

        completed.extend(self.update_active_from_payload(payload, now, wall_clock_ms));
        completed
    }

    fn on_progress(
        &mut self,
        payload: &Value,
        now: Instant,
        wall_clock_ms: i64,
    ) -> Vec<SessionData> {
        let Some(active) = self.active.as_ref() else {
            return Vec::new();
        };
        let Some(track_uri) = payload.get("trackUri").and_then(Value::as_str) else {
            return Vec::new();
        };
        if track_uri != active.track.uri {
            // Stale or reordered progress for another track. Ending the active
            // session here would treat a technical mismatch as a user skip.
            return Vec::new();
        }
        self.update_active_from_payload(payload, now, wall_clock_ms)
    }

    fn update_active_from_payload(
        &mut self,
        payload: &Value,
        now: Instant,
        wall_clock_ms: i64,
    ) -> Vec<SessionData> {
        let Some(active) = self.active.as_mut() else {
            return Vec::new();
        };
        let position_ms = state_position(payload);
        let position_elapsed_ms = position_ms.map(|_| {
            duration_millis(now.saturating_duration_since(active.last_position_observed_at))
        });
        active.advance(now);

        if let Some(duration_ms) = state_duration(payload).filter(|duration| *duration > 0) {
            active.track.duration_ms = Some(duration_ms);
        }
        if payload.get("contextUri").is_some() {
            active.context_uri = payload_context_uri(payload);
            active.context_type = context_type(active.context_uri.as_deref()).to_owned();
        }
        if payload.get("contextName").is_some() {
            active.context_name = payload_context_name(payload);
        }
        if let Some(repeat_one) = state_repeat_one(payload) {
            active.repeat_one = repeat_one;
        }

        let Some(position_ms) = position_ms else {
            if let Some(is_playing) = state_is_playing(payload) {
                update_playing(active, is_playing);
            }
            return take_pending_snapshot(active);
        };
        let position_elapsed_ms = position_elapsed_ms.unwrap_or_default();

        let repeat = is_repeat_reset(active, position_ms, position_elapsed_ms);
        if repeat || is_restart(active, position_ms) {
            let track = active.track.clone();
            let context_uri = active.context_uri.clone();
            let context_name = active.context_name.clone();
            let is_playing = state_is_playing(payload).unwrap_or(active.is_playing);
            let repeat_one = active.repeat_one;
            // In repeat-one every start from the top is the next cycle, even
            // when the wrap came too late or too early for `is_repeat_reset`.
            let cycle = repeat || repeat_one;
            let repeat_cycle = if cycle { active.repeat_cycle.saturating_add(1) } else { 0 };
            let completed = self.finish_without_advance(wall_clock_ms, if cycle { "repeat" } else { "restart" });
            self.start(
                track,
                position_ms,
                is_playing,
                context_uri,
                context_name,
                repeat_cycle,
                repeat_one,
                now,
                wall_clock_ms,
            );
            return completed.into_iter().collect();
        }

        if is_seek(
            active.last_position_ms,
            position_ms,
            position_elapsed_ms,
            active.is_playing,
        ) {
            active.seek_count = active.seek_count.saturating_add(1);
            active.persist_pending = true;
        }
        active.last_position_ms = position_ms;
        active.max_position_ms = active.max_position_ms.max(position_ms);
        active.last_position_observed_at = now;
        if let Some(is_playing) = state_is_playing(payload) {
            update_playing(active, is_playing);
        }
        take_pending_snapshot(active)
    }

    #[allow(clippy::too_many_arguments)]
    fn start(
        &mut self,
        track: TrackData,
        position_ms: u64,
        is_playing: bool,
        context_uri: Option<String>,
        context_name: Option<String>,
        repeat_cycle: u32,
        repeat_one: bool,
        now: Instant,
        wall_clock_ms: i64,
    ) {
        self.next_session = self.next_session.saturating_add(1);
        let id = format!("{}-{}", self.session_prefix, self.next_session);
        self.active = Some(ActiveSession {
            id,
            context_type: context_type(context_uri.as_deref()).to_owned(),
            context_uri,
            context_name,
            track,
            started_at_ms: wall_clock_ms,
            start_position_ms: position_ms,
            last_position_ms: position_ms,
            max_position_ms: position_ms,
            listened_ms: 0,
            is_playing,
            seek_count: 0,
            pause_count: 0,
            repeat_cycle,
            last_observed_at: now,
            last_position_observed_at: now,
            repeat_one,
            persist_pending: false,
        });
    }

    fn finish(&mut self, now: Instant, wall_clock_ms: i64, reason: &str) -> Option<SessionData> {
        self.active.as_mut()?.advance(now);
        self.finish_without_advance(wall_clock_ms, reason)
    }

    fn finish_without_advance(&mut self, wall_clock_ms: i64, reason: &str) -> Option<SessionData> {
        let active = self.active.take()?;
        (active.listened_ms > 0).then(|| active.snapshot(Some(wall_clock_ms), Some(reason)))
    }
}

fn update_playing(active: &mut ActiveSession, is_playing: bool) {
    if active.is_playing && !is_playing {
        active.pause_count = active.pause_count.saturating_add(1);
        active.persist_pending = true;
    }
    active.is_playing = is_playing;
}

fn take_pending_snapshot(active: &mut ActiveSession) -> Vec<SessionData> {
    if !active.persist_pending || active.listened_ms == 0 || active.is_playing {
        return Vec::new();
    }
    active.persist_pending = false;
    vec![active.snapshot(None, None)]
}

fn is_repeat_reset(active: &ActiveSession, position_ms: u64, position_elapsed_ms: u64) -> bool {
    if !active.is_playing
        || !active.repeat_one
        || position_ms > REPEAT_RESET_POSITION_MS
        || active.last_position_ms < REPEAT_MIN_PREVIOUS_POSITION_MS
        || position_elapsed_ms > MAX_REPEAT_OBSERVATION_GAP_MS
    {
        return false;
    }
    let Some(duration_ms) = active.track.duration_ms.filter(|duration| *duration > 0) else {
        return false;
    };
    let expected_position_ms = active
        .last_position_ms
        .saturating_add(position_elapsed_ms)
        .checked_sub(duration_ms);
    let Some(expected_position_ms) = expected_position_ms else {
        return false;
    };
    let expected_position_ms = expected_position_ms % duration_ms;
    expected_position_ms.abs_diff(position_ms) <= REPEAT_TIMING_TOLERANCE_MS
}

/// Back to the top of the same song after it already counted as a play:
/// repeat-one wraps the timing check missed, or "previous" restarting it.
/// Each is a new play; before, they stayed one long session with "seeks".
/// A jump back before the song counted stays a seek.
fn is_restart(active: &ActiveSession, position_ms: u64) -> bool {
    active.is_playing
        && position_ms <= REPEAT_RESET_POSITION_MS
        && active.last_position_ms >= position_ms.saturating_add(RESTART_MIN_JUMP_MS)
        && active.qualifies()
}

fn is_seek(previous: u64, current: u64, elapsed_ms: u64, was_playing: bool) -> bool {
    let expected_delta = if was_playing {
        i128::from(elapsed_ms)
    } else {
        0
    };
    let actual_delta = i128::from(current) - i128::from(previous);
    (actual_delta - expected_delta).abs() > SEEK_TOLERANCE_MS
}

fn parse_track(item: &Value) -> Option<TrackData> {
    let uri = item.get("uri")?.as_str()?.trim();
    if uri.is_empty() || uri.chars().count() > 512 {
        return None;
    }
    let title = item
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Unbekannter Titel")
        .trim();
    let creators = item
        .get("creators")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|creator| {
            let name = creator.get("name")?.as_str()?.trim();
            (!name.is_empty()).then(|| CreatorData {
                name: name.to_owned(),
                uri: optional_string(creator.get("uri")),
            })
        })
        .collect();
    Some(TrackData {
        uri: uri.to_owned(),
        source: item
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("spotify")
            .to_owned(),
        item_type: item
            .get("itemType")
            .and_then(Value::as_str)
            .unwrap_or("track")
            .to_owned(),
        title: if title.is_empty() {
            "Unbekannter Titel".to_owned()
        } else {
            title.to_owned()
        },
        creators,
        album_uri: optional_string(item.get("albumUri")),
        album_name: optional_string(item.get("albumName")),
        duration_ms: item.get("durationMs").and_then(Value::as_u64),
        cover_uri: optional_string(item.get("coverUri")),
    })
}

fn state_is_playing(payload: &Value) -> Option<bool> {
    payload.get("isPlaying").and_then(Value::as_bool)
}

fn state_position(payload: &Value) -> Option<u64> {
    payload.get("positionMs").and_then(Value::as_u64)
}

fn state_duration(payload: &Value) -> Option<u64> {
    payload.get("durationMs").and_then(Value::as_u64)
}

fn state_repeat_one(payload: &Value) -> Option<bool> {
    payload
        .get("repeatMode")
        .and_then(Value::as_str)
        .map(|mode| mode == "one")
}

fn payload_context_uri(payload: &Value) -> Option<String> {
    optional_string(payload.get("contextUri"))
}

fn payload_context_name(payload: &Value) -> Option<String> {
    optional_string(payload.get("contextName"))
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= 512)
        .map(str::to_owned)
}

fn context_type(uri: Option<&str>) -> &'static str {
    match uri {
        Some(uri) if uri.starts_with("spotify:playlist:") => "playlist",
        Some(uri) if uri.starts_with("spotify:album:") => "album",
        Some(uri) if uri.starts_with("spotify:artist:") => "artist",
        Some(uri) if uri.starts_with("spotify:collection:") => "collection",
        Some(_) => "other",
        None => "unknown",
    }
}

fn duration_millis(duration: std::time::Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
#[path = "tracker_tests.rs"]
mod tests;
