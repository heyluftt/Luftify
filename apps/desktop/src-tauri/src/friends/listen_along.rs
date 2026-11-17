//! Listening along: following a friend's playback without a room. Every two
//! seconds the follower asks the server what the friend plays and where, and
//! steers its own player to the same song and position. The friend's player
//! is never touched. It ends when the follower plays something else or
//! pauses, joins a room, or the friend goes offline or stays paused.
use std::time::Duration;

use luft_core::PlaybackState;
use luft_listen_together::social::{FriendPresence, LISTEN_ALONG_POLL_MS, ListenAlongState};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::time::Instant;

use super::{
    http,
    service::{FriendsService, authenticated},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenAlongStatus {
    pub profile_id: String,
    /// "connecting", "following", "paused" (the friend paused) or "ended".
    pub phase: String,
    /// Why it ended, as a text key.
    pub reason: Option<String>,
}

/// A local drift above this is corrected by seeking.
const DRIFT_SEEK_MS: i64 = 2_500;
/// After our own command the player needs a moment before its state counts.
const SETTLE: Duration = Duration::from_secs(3);
const OFFLINE_AFTER: Duration = Duration::from_secs(30);
const PAUSED_AFTER: Duration = Duration::from_secs(10 * 60);
const FAILURES: u32 = 5;
/// Near its end a song may stop or move on by itself; that is no takeover.
const END_MARGIN_MS: u64 = 4_000;
/// Our copy of a song can end before the friend's; this long we wait for
/// their next one instead of replaying the end.
const NEXT_SONG_WAIT: Duration = Duration::from_secs(20);

/// A repeated song has the same URI but its reported clock is no longer at
/// the end. Do not keep waiting for a different URI in that case.
fn wait_for_next_song(
    same_song: bool,
    expected_ms: Option<u64>,
    duration_ms: Option<u64>,
    elapsed: Duration,
) -> bool {
    let friend_still_at_end = match (expected_ms, duration_ms.filter(|duration| *duration > 0)) {
        (Some(position), Some(duration)) => position.saturating_add(END_MARGIN_MS) >= duration,
        _ => true,
    };
    same_song && friend_still_at_end && elapsed < NEXT_SONG_WAIT
}

/// Profile ids are server UUIDs; anything else never becomes part of a URL.
fn route(profile_id: &str) -> Result<String, String> {
    if profile_id.len() == 36 && profile_id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        Ok(format!("listen-along/{profile_id}"))
    } else {
        Err("friends.error.invalidRequest".into())
    }
}

/// Where the friend is now, from the reported position and its age.
fn expected_position(presence: &FriendPresence, server_time_ms: i64, since_response: Duration) -> Option<u64> {
    let position = presence.position_ms?;
    let age = server_time_ms.saturating_sub(presence.position_at_ms?).max(0) as u64 + since_response.as_millis() as u64;
    let expected = position.saturating_add(age);
    let duration = presence.track.as_ref().and_then(|track| track.duration_ms).unwrap_or(u64::MAX);
    Some(expected.min(duration.saturating_sub(1_000)))
}

/// What the follower's own player did since the last command. A pause only
/// counts once the song has played: a slow load also reports "not playing".
fn took_over(local: &PlaybackState, applied: &str, friend_uri: Option<&str>, paused_by_us: bool, seen_playing: bool) -> bool {
    let near_end = local.duration_ms > 0 && local.position_ms + END_MARGIN_MS >= local.duration_ms;
    // When the friend moved on, the next poll follows them; nothing to judge.
    if friend_uri != Some(applied) || near_end {
        return false;
    }
    let local_uri = local.current_item.as_ref().map(|item| item.uri.as_str());
    local_uri != Some(applied) || (!local.is_playing && !paused_by_us && seen_playing)
}

/// The song we follow ran out by itself: last time it was near its end, now
/// it stopped, started over or the player moved on to something else.
#[cfg(test)]
fn ended_naturally(previous: Option<&PlaybackState>, applied: &str, local: &PlaybackState) -> bool {
    ended_between_polls(previous, applied, local, Duration::ZERO)
}

fn ended_between_polls(previous: Option<&PlaybackState>, applied: &str, local: &PlaybackState, elapsed: Duration) -> bool {
    previous.is_some_and(|previous| {
        // HTTP polling may miss the last seconds entirely. Advance only a
        // running, established clock; a paused/loading song cannot run out.
        let elapsed_ms = if previous.is_playing && previous.clock_ready {
            elapsed.min(NEXT_SONG_WAIT).as_millis() as u64
        } else { 0 };
        previous.current_item.as_ref().is_some_and(|item| item.uri == applied)
            && previous.duration_ms > 0
            && previous.position_ms.saturating_add(elapsed_ms).saturating_add(END_MARGIN_MS) >= previous.duration_ms
            && (local.current_item.as_ref().is_none_or(|item| item.uri != applied)
                || !local.is_playing
                || local.position_ms < previous.position_ms)
    })
}

impl FriendsService {
    pub async fn start_listen_along(&self, profile_id: String) -> Result<(), String> {
        let _control = self.runtime.along_control.lock().await;
        route(&profile_id)?;
        let shared = self.status().snapshot.as_ref().is_some_and(|snapshot| {
            snapshot.friends.iter().any(|friend| friend.profile.id == profile_id && friend.presence.track.is_some())
        });
        if !shared {
            return Err("friends.error.notListening".into());
        }
        if self.runtime.room.status().await.room_id.is_some() {
            return Err("friends.error.alreadyInRoom".into());
        }
        self.stop_along_locked(None).await;
        self.set_listen_along(Some(ListenAlongStatus { profile_id: profile_id.clone(), phase: "connecting".into(), reason: None }));
        let service = self.clone();
        let mut handle = self.runtime.listen_along.lock().await;
        *handle = Some(tauri::async_runtime::spawn(async move { service.follow(profile_id).await }));
        Ok(())
    }

    /// Ends listening along; `reason` keeps a short note for the page, none clears it.
    pub async fn stop_listen_along(&self, reason: Option<&str>) {
        let _control = self.runtime.along_control.lock().await;
        self.stop_along_locked(reason).await;
    }

    /// App transport actions are explicit intent, including during a friend's
    /// pause or the initial loading window; they must never be undone by a poll.
    pub async fn take_over_playback(&self) {
        let _control = self.runtime.along_control.lock().await;
        if self.status().listen_along.is_some_and(|along| along.phase != "ended") {
            self.stop_along_locked(Some("listenAlong.ended.tookOver")).await;
        }
    }

    async fn stop_along_locked(&self, reason: Option<&str>) {
        let task = self.runtime.listen_along.lock().await.take();
        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }
        let Some(current) = self.status().listen_along else { return };
        if current.phase != "ended" {
            // Local controls must remain responsive even when the relay is down.
            // A missed cleanup expires on the server after ten seconds.
            let _ = tokio::time::timeout(Duration::from_millis(250), self.along_request::<()>(Method::DELETE, &current.profile_id)).await;
        }
        self.set_listen_along(reason.map(|reason| ListenAlongStatus {
            profile_id: current.profile_id,
            phase: "ended".into(),
            reason: Some(reason.into()),
        }));
    }

    fn set_listen_along(&self, value: Option<ListenAlongStatus>) {
        let mut changed = false;
        self.runtime.status.send_if_modified(|status| {
            changed = status.listen_along != value;
            status.listen_along = value.clone();
            changed
        });
        if changed {
            let _ = self.runtime.app.emit("friends://status", self.status());
        }
    }

    async fn along_request<T: serde::de::DeserializeOwned>(&self, method: Method, profile_id: &str) -> Result<T, String> {
        let (endpoint, token) = {
            let session = self.runtime.session.lock().await;
            let (endpoint, credential) = authenticated(&session)?;
            (endpoint.clone(), zeroize::Zeroizing::new(credential.token.clone()))
        };
        http::request(&self.runtime.client, &endpoint, method, &route(profile_id)?, Some(token.as_str()), None::<&()>, None).await
    }

    async fn follow(&self, friend: String) {
        let provider = self.runtime.provider.clone();
        let mut timer = tokio::time::interval(Duration::from_millis(LISTEN_ALONG_POLL_MS));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut failures = 0;
        let mut last_online = Instant::now();
        let mut applied: Option<String> = None;
        let mut commanded = Instant::now() - SETTLE;
        let mut paused_by_us = false;
        let mut paused_since: Option<Instant> = None;
        let mut previous_local: Option<PlaybackState> = None;
        let mut previous_local_at = Instant::now();
        let mut seen_playing = false;
        let mut song_ended: Option<Instant> = None;
        let end = |reason: &'static str| async move { self.finish(reason).await };
        loop {
            timer.tick().await;
            if self.runtime.room.status().await.room_id.is_some() {
                return end("listenAlong.ended.friend").await;
            }
            let asked = Instant::now();
            let state: ListenAlongState = match self.along_request(Method::GET, &friend).await {
                Ok(state) => { failures = 0; state }
                Err(error) if error == "friends.error.notFriends" => return end("listenAlong.ended.friend").await,
                Err(error) if error == "friends.error.serverUpdateRequired" => return end("listenAlong.ended.serverUpdateRequired").await,
                Err(_) => {
                    failures += 1;
                    if failures >= FAILURES { return end("listenAlong.ended.unreachable").await; }
                    continue;
                }
            };
            let presence = state.presence;
            // Sharing music is independent of showing the online badge.
            if !presence.online && presence.track.is_none() {
                if last_online.elapsed() > OFFLINE_AFTER { return end("listenAlong.ended.offline").await; }
                continue;
            }
            last_online = Instant::now();
            let local = provider.get_state().await.ok();
            let settled = commanded.elapsed() >= SETTLE;
            let friend_uri = presence.track.as_ref().filter(|_| presence.is_playing).map(|track| track.uri.clone());
            let expected = expected_position(&presence, state.server_time_ms, asked.elapsed());
            if let (Some(applied), Some(local)) = (applied.as_deref(), local.as_ref()) {
                if local.is_playing && local.current_item.as_ref().is_some_and(|item| item.uri == applied) {
                    seen_playing = true;
                }
                if settled && ended_between_polls(previous_local.as_ref(), applied, local, previous_local_at.elapsed()) {
                    song_ended.get_or_insert_with(Instant::now);
                } else if settled && song_ended.is_none()
                    && took_over(local, applied, friend_uri.as_deref(), paused_by_us, seen_playing) {
                    return end("listenAlong.ended.tookOver").await;
                }
            }
            previous_local = local.clone();
            previous_local_at = Instant::now();
            let mut restart_ended = false;
            if let Some(at) = song_ended {
                if wait_for_next_song(
                    friend_uri.is_some() && friend_uri == applied,
                    expected,
                    presence.track.as_ref().and_then(|track| track.duration_ms),
                    at.elapsed(),
                ) {
                    // Ours ended first: hold still until the friend's next song.
                    if local.as_ref().is_some_and(|local| local.is_playing) {
                        let _ = provider.pause().await;
                        paused_by_us = true;
                        commanded = Instant::now();
                    }
                    self.set_phase(&friend, "following");
                    continue;
                }
                song_ended = None;
                restart_ended = friend_uri.is_some();
            }
            let Some(uri) = friend_uri else {
                // The friend paused or stopped sharing: hold still and wait.
                if applied.is_some() && local.as_ref().is_some_and(|local| local.is_playing) {
                    let _ = provider.pause().await;
                    paused_by_us = true;
                    commanded = Instant::now();
                }
                if paused_since.get_or_insert_with(Instant::now).elapsed() > PAUSED_AFTER {
                    return end("listenAlong.ended.paused").await;
                }
                self.set_phase(&friend, "paused");
                continue;
            };
            paused_since = None;
            let local_uri = local.as_ref().and_then(|local| local.current_item.as_ref()).map(|item| item.uri.clone());
            if restart_ended || applied.as_deref() != Some(uri.as_str()) || local_uri.as_deref() != Some(uri.as_str()) {
                if provider.play_uri(&uri).await.is_err() {
                    return end("listenAlong.ended.playback").await;
                }
                wait_for(&*provider, &uri).await;
                if let Some(position) = expected_position(&presence, state.server_time_ms, asked.elapsed()) {
                    let _ = provider.seek(position).await;
                }
                applied = Some(uri);
                paused_by_us = false;
                seen_playing = false;
                commanded = Instant::now();
            } else if let Some(local) = local.as_ref() {
                if !local.is_playing {
                    let _ = provider.play().await;
                    paused_by_us = false;
                    seen_playing = false;
                    commanded = Instant::now();
                } else if let Some(expected) = expected.filter(|_| settled && local.clock_ready) {
                    if (local.position_ms as i64 - expected as i64).abs() > DRIFT_SEEK_MS {
                        let _ = provider.seek(expected).await;
                        commanded = Instant::now();
                    }
                }
            }
            self.set_phase(&friend, "following");
        }
    }

    fn set_phase(&self, friend: &str, phase: &str) {
        self.set_listen_along(Some(ListenAlongStatus { profile_id: friend.into(), phase: phase.into(), reason: None }));
    }

    /// From inside the task: no abort of itself, just the note and the server.
    async fn finish(&self, reason: &str) {
        // Keep the handle until completion so stop/start can abort and join this
        // task even while the cleanup request is in flight.
        if let Some(current) = self.status().listen_along {
            let _ = self.along_request::<()>(Method::DELETE, &current.profile_id).await;
            self.set_listen_along(Some(ListenAlongStatus { profile_id: current.profile_id, phase: "ended".into(), reason: Some(reason.into()) }));
        }
    }
}

/// The player reports a started song a moment later.
async fn wait_for(provider: &dyn luft_core::SpotifyProvider, uri: &str) {
    for _ in 0..15 {
        if provider.get_state().await.ok()
            .is_some_and(|state| state.clock_ready && state.current_item.as_ref().is_some_and(|item| item.uri == uri))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_listen_together::TrackRef;

    fn local(uri: &str, playing: bool, position_ms: u64) -> PlaybackState {
        serde_json::from_value(serde_json::json!({
            "currentItem": { "uri": uri, "source": "spotify", "itemType": "track",
                "title": "A song", "creators": [], "explicit": false, "playable": true },
            "isPlaying": playing, "positionMs": position_ms, "durationMs": 200000, "volume": 0.5,
            "isMuted": false, "shuffleEnabled": false, "repeatMode": "off",
            "isSaved": false, "updatedAt": "2026-10-01T12:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn position_runs_on_from_the_report_and_stops_short_of_the_end() {
        let mut track = TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap();
        track.duration_ms = Some(100_000);
        let presence = FriendPresence { online: true, is_playing: true, track: Some(track), position_ms: Some(40_000), position_at_ms: Some(1_000), ..Default::default() };
        assert_eq!(expected_position(&presence, 3_000, Duration::from_millis(500)), Some(42_500));
        assert_eq!(expected_position(&presence, 90_000, Duration::ZERO), Some(99_000));
        assert_eq!(expected_position(&FriendPresence::default(), 0, Duration::ZERO), None);
    }

    #[test]
    fn only_own_changes_end_listening_along() {
        let song = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
        let other = "spotify:track:bbbbbbbbbbbbbbbbbbbbbb";
        assert!(!took_over(&local(song, true, 10_000), song, Some(song), false, true));
        assert!(took_over(&local(other, true, 10_000), song, Some(song), false, true));
        assert!(took_over(&local(song, false, 10_000), song, Some(song), false, true));
        // Our own pause, the friend moving on, or the song ending is no takeover.
        assert!(!took_over(&local(song, false, 10_000), song, Some(song), true, true));
        assert!(!took_over(&local(other, true, 10_000), song, Some(other), false, true));
        assert!(!took_over(&local(other, true, 198_000), song, Some(song), false, true));
        assert!(!took_over(&local(song, false, 199_000), song, Some(song), false, true));
        // A song still loading was not paused by hand.
        assert!(!took_over(&local(song, false, 0), song, Some(song), false, false));
    }

    #[test]
    fn a_song_running_out_is_not_a_manual_takeover() {
        let song = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
        let other = "spotify:track:bbbbbbbbbbbbbbbbbbbbbb";
        let near_end = local(song, true, 198_000);
        // Moved on to the queue, stopped at the start, or stopped in place.
        assert!(ended_naturally(Some(&near_end), song, &local(other, true, 500)));
        assert!(ended_naturally(Some(&near_end), song, &local(song, false, 0)));
        assert!(ended_naturally(Some(&near_end), song, &local(song, false, 200_000)));
        assert!(!ended_naturally(Some(&near_end), song, &local(song, true, 199_500)));
        assert!(!ended_naturally(Some(&local(song, true, 10_000)), song, &local(other, true, 500)));
        assert!(!ended_naturally(None, song, &local(other, true, 500)));
    }

    #[test]
    fn repeat_one_releases_the_end_wait_without_a_new_uri() {
        // The follower finishes first; the host is still in the old cycle.
        assert!(wait_for_next_song(true, Some(199_000), Some(200_000), Duration::from_secs(2)));
        // Same URI, new cycle: reload and align instead of requiring a rejoin.
        assert!(!wait_for_next_song(true, Some(1_500), Some(200_000), Duration::from_secs(4)));
        // Also works when the next presence arrives well into the new cycle.
        assert!(!wait_for_next_song(true, Some(14_000), Some(200_000), Duration::from_secs(16)));
    }

    #[test]
    fn delayed_poll_does_not_mistake_repeat_loading_for_takeover() {
        let song = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
        let mut previous = local(song, true, 192_000);
        previous.clock_ready = true;
        let loading = local(song, false, 0);
        assert!(ended_between_polls(Some(&previous), song, &loading, Duration::from_secs(8)));
        assert!(ended_between_polls(Some(&previous), song, &local("other", true, 1_000), Duration::from_secs(8)));
        assert!(!ended_between_polls(Some(&previous), song, &loading, Duration::from_secs(1)));
        previous.is_playing = false;
        assert!(!ended_between_polls(Some(&previous), song, &loading, Duration::from_secs(8)));
        previous.is_playing = true;
        previous.clock_ready = false;
        assert!(!ended_between_polls(Some(&previous), song, &loading, Duration::from_secs(8)));
    }

    #[test]
    fn end_wait_remains_bounded_and_does_not_block_a_different_song() {
        assert!(!wait_for_next_song(false, Some(199_000), Some(200_000), Duration::ZERO));
        assert!(!wait_for_next_song(true, Some(199_000), Some(200_000), NEXT_SONG_WAIT));
        assert!(wait_for_next_song(true, None, None, Duration::from_secs(2)));
        assert!(!wait_for_next_song(true, None, None, NEXT_SONG_WAIT));
    }
}
