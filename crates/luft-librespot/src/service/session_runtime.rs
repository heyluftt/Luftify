use super::*;

use std::future::Future;

const STABLE_SESSION_UPTIME: Duration = Duration::from_secs(30);
const MAX_AUTOMATIC_RECOVERIES: u64 = 3;

#[derive(Debug, Clone)]
pub(super) struct SessionRecoverySnapshot {
    resume: bool,
    track_uri: Option<String>,
    context_uri: Option<String>,
    pub(super) position_ms: u64,
    /// `output_sink::heard_ms` at capture: the old player plays on from its
    /// buffer while the session reconnects, so the restore adds what was heard.
    heard_ms: u64,
    duration_ms: u64,
    volume: f64,
    is_muted: bool,
    load_intent: u64,
}

pub(super) fn spawn_spirc_supervisor(
    service: Arc<LibrespotService>,
    spirc_task: impl Future<Output = ()> + Send + 'static,
    session_epoch: u64,
) {
    tokio::spawn(async move {
        let started_at = Instant::now();
        spirc_task.await;
        service
            .recover_after_spirc_exit(session_epoch, started_at.elapsed())
            .await;
    });
}

impl LibrespotService {
    async fn recover_after_spirc_exit(self: &Arc<Self>, session_epoch: u64, uptime: Duration) {
        let _guard = self.shared.connect_lock.lock().await;
        if self.shared.session_epoch.load(Ordering::SeqCst) != session_epoch {
            return;
        }

        let attempt = if uptime >= STABLE_SESSION_UPTIME {
            self.shared
                .session_recovery_attempts
                .store(1, Ordering::SeqCst);
            1
        } else {
            self.shared
                .session_recovery_attempts
                .fetch_add(1, Ordering::SeqCst)
                .saturating_add(1)
        };
        let recovery = self.capture_session_recovery().await;

        warn!(
            adapter = "librespot",
            phase = "session-recovery",
            session_epoch,
            uptime_ms = u64::try_from(uptime.as_millis()).unwrap_or(u64::MAX),
            attempt,
            resume = recovery.resume,
            track_uri = recovery.track_uri.as_deref().map(uri_tail),
            "librespot session task ended unexpectedly"
        );

        self.shutdown_session_keep_playback().await;
        self.freeze_interrupted_playback(recovery.position_ms).await;
        {
            let mut snapshot = self.shared.playback.write().await;
            // Shutdown advances the intent once. Do not replace a newer request.
            if snapshot.load_intent_epoch == recovery.load_intent.saturating_add(1) {
                snapshot.pending_session_recovery = Some((snapshot.load_intent_epoch, recovery.clone()));
            }
        }
        notify_playback(&self.shared).await;

        let credentials_present = credentials_exist(&self.shared.cache_dir);
        if attempt > MAX_AUTOMATIC_RECOVERIES {
            self.cancel_session_recovery().await;
            self.set_status(
                LibrespotPhase::Error,
                credentials_present,
                None,
                Some("Libre wurde mehrfach getrennt. Bitte die Verbindung erneut starten."),
            )
            .await;
            warn!(
                adapter = "librespot",
                phase = "session-recovery",
                attempt,
                "automatic librespot recovery stopped after repeated disconnects"
            );
            return;
        }

        let credentials = match open_cache(&self.shared.cache_dir) {
            Ok(cache) => cache.credentials(),
            Err(error) => {
                self.cancel_session_recovery().await;
                self.set_status(
                    LibrespotPhase::Error,
                    credentials_present,
                    None,
                    Some("Die gespeicherte Libre-Sitzung konnte nicht geöffnet werden."),
                )
                .await;
                warn!(
                    error = %error,
                    adapter = "librespot",
                    phase = "session-recovery",
                    "automatic librespot recovery could not open the cache"
                );
                return;
            }
        };
        let Some(credentials) = credentials else {
            self.cancel_session_recovery().await;
            self.set_status(
                LibrespotPhase::NeedsLogin,
                false,
                None,
                Some("Libre wurde getrennt. Bitte erneut anmelden."),
            )
            .await;
            return;
        };

        self.set_status(
            LibrespotPhase::Connecting,
            true,
            None,
            Some("Libre wurde getrennt und verbindet sich neu …"),
        )
        .await;
        tokio::time::sleep(recovery_delay(attempt)).await;

        match self.start_session(credentials).await {
            Ok(username) => {
                let restore_result = self.restore_pending_session_recovery().await;
                self.set_status(
                    LibrespotPhase::Ready,
                    true,
                    username,
                    Some("Libre wurde automatisch wieder verbunden."),
                )
                .await;
                match restore_result {
                    Ok(()) => info!(
                        adapter = "librespot",
                        phase = "session-recovery",
                        attempt,
                        resumed = recovery.resume,
                        track_uri = recovery.track_uri.as_deref().map(uri_tail),
                        "librespot session recovered"
                    ),
                    Err(error) => warn!(
                        error = %error,
                        adapter = "librespot",
                        phase = "session-recovery",
                        attempt,
                        "librespot reconnected but playback could not be restored"
                    ),
                }
            }
            Err(error) => {
                self.set_status(
                    LibrespotPhase::Error,
                    true,
                    None,
                    Some("Libre konnte nicht automatisch wieder verbunden werden."),
                )
                .await;
                warn!(
                    error = %error,
                    adapter = "librespot",
                    phase = "session-recovery",
                    attempt,
                    "automatic librespot recovery failed"
                );
                if error.transient {
                    self.schedule_background_reconnect();
                } else {
                    self.cancel_session_recovery().await;
                }
            }
        }
    }

    pub(super) async fn capture_session_recovery(&self) -> SessionRecoverySnapshot {
        let snapshot = self.shared.playback.read().await;
        SessionRecoverySnapshot {
            resume: snapshot.is_playing,
            track_uri: snapshot.current_item.as_ref().map(|item| item.uri.clone()),
            context_uri: snapshot.context_uri.clone(),
            position_ms: interpolated_position(&snapshot),
            heard_ms: crate::output_sink::heard_ms(),
            duration_ms: snapshot.duration_ms,
            volume: snapshot.volume,
            is_muted: snapshot.is_muted,
            load_intent: snapshot.load_intent_epoch,
        }
    }

    pub(super) async fn freeze_interrupted_playback(&self, position_ms: u64) {
        let mut snapshot = self.shared.playback.write().await;
        snapshot.is_playing = false;
        snapshot.audio_started = false;
        snapshot.position_ms = position_ms;
        snapshot.position_updated_at = Instant::now();
        snapshot.pending_seek_ms = None;
    }

    pub(super) async fn restore_recovered_playback(
        &self,
        recovery: &SessionRecoverySnapshot,
    ) -> Result<(), ProviderError> {
        self.restore_recovered_playback_guarded(recovery, None).await
    }

    pub(super) async fn restore_recovered_playback_guarded(
        &self,
        recovery: &SessionRecoverySnapshot,
        expected_intent: Option<u64>,
    ) -> Result<(), ProviderError> {
        if let Some(intent) = expected_intent {
            if !load_intent_is_current(&*self.shared.playback.read().await, intent) {
                return Ok(());
            }
        }
        let output_volume = if recovery.is_muted {
            0.0
        } else {
            recovery.volume
        };
        self.with_spirc(|spirc| spirc.set_volume(volume_to_connect(output_volume)))
            .await?;

        if !recovery.resume {
            return Ok(());
        }
        let Some(track_uri) = recovery
            .track_uri
            .as_deref()
            .filter(|uri| is_playable_item_uri(uri))
        else {
            return Ok(());
        };

        // Where the listener really is: the frozen position plus what the old
        // player still played from its buffer (it went on up to 5 s).
        let played_on = resume_offset(recovery.heard_ms, crate::output_sink::heard_ms());
        let position_ms = resume_position(recovery.position_ms, played_on, recovery.duration_ms);
        let intent = match expected_intent {
            Some(intent) => intent,
            None => reserve_load_intent(&self.shared).await,
        };
        let generation = {
            let mut snapshot = self.shared.playback.write().await;
            if !load_intent_is_current(&snapshot, intent) {
                return Ok(());
            }
            snapshot.handoff_hold = false;
            let current_item = snapshot.current_item.clone();
            let generation = begin_expected_track(&mut snapshot, track_uri);
            if let Some(current_item) = current_item {
                snapshot.expected_item = Some(current_item);
            }
            snapshot.context_uri = recovery.context_uri.clone();
            snapshot.pending_seek_ms = (position_ms > 0).then_some(position_ms);
            info!(
                adapter = "librespot",
                phase = "session-recovery",
                frozen_ms = recovery.position_ms,
                played_on_ms = played_on,
                resume_ms = position_ms,
                "session recovery resumes where the audio got to"
            );
            log_transition(
                &snapshot,
                "session-recovery-load",
                "prepared",
                Some(track_uri),
                None,
            );
            generation
        };

        match self
            .load_tracks(vec![track_uri.to_string()], None, generation, None)
            .await
        {
            Ok(true) => {
                self.publish_loaded_item(track_uri, recovery.context_uri.clone(), Some(generation))
                    .await;
                Ok(())
            }
            Ok(false) => Ok(()),
            Err(error) => {
                self.shared.playback.write().await.pending_seek_ms = None;
                Err(error)
            }
        }
    }
}

/// What reached the speaker between capture and restore; a reconnect lasts
/// seconds, so anything beyond a minute is not trusted.
fn resume_offset(heard_at_capture: u64, heard_now: u64) -> u64 {
    let played_on = heard_now.saturating_sub(heard_at_capture);
    if played_on > 60_000 { 0 } else { played_on }
}

/// Never past the end: a song that finished meanwhile starts its last second.
fn resume_position(frozen_ms: u64, played_on_ms: u64, duration_ms: u64) -> u64 {
    let position = frozen_ms.saturating_add(played_on_ms);
    if duration_ms == 0 { position } else { position.min(duration_ms.saturating_sub(1_000)) }
}

fn recovery_delay(attempt: u64) -> Duration {
    match attempt {
        1 => Duration::from_millis(350),
        2 => Duration::from_millis(1_200),
        _ => Duration::from_secs(3),
    }
}

#[cfg(test)]
mod resume_tests {
    use super::*;

    #[test]
    fn resumes_after_what_the_old_player_still_played() {
        // Frozen at 0.4 s, the buffer played on for 4.7 s: continue at 5.1 s, not at the start.
        assert_eq!(resume_position(400, resume_offset(10_000, 14_700), 112_976), 5_100);
        assert_eq!(resume_offset(10_000, 9_000), 0, "a counter that went back is ignored");
        assert_eq!(resume_offset(0, 90_000), 0, "minutes are not a reconnect");
        assert_eq!(resume_position(110_000, 5_000, 112_976), 111_976);
    }
}
