use super::*;

#[async_trait]
impl PlaybackProvider for LibrespotService {
    async fn set_room_queue(
        &self,
        active: bool,
        next_uri: Option<&str>,
    ) -> Result<(), ProviderError> {
        let next = next_uri
            .filter(|uri| is_playable_item_uri(uri))
            .map(str::to_owned);
        let mut snapshot = self.shared.playback.write().await;
        snapshot.room_queue_active = active;
        snapshot.room_queue_next = if active { next } else { None };
        if active {
            snapshot.pending_auto_advance = None;
        }
        drop(snapshot);
        notify_playback(&self.shared).await;
        Ok(())
    }
    async fn get_state(&self) -> Result<PlaybackState, ProviderError> {
        if self.shared.status.read().await.phase != LibrespotPhase::Ready {
            return Err(not_ready());
        }
        let snapshot = self.shared.playback.read().await;
        Ok(snapshot_to_state(&snapshot))
    }

    async fn toggle(&self) -> Result<(), ProviderError> {
        self.cancel_session_recovery().await;
        self.shared
            .playback
            .write()
            .await
            .diagnostics
            .reset_unavailable_streak();
        {
            let snapshot = self.shared.playback.read().await;
            log_transition(
                &snapshot,
                "command-toggle",
                if snapshot.is_playing {
                    "request-pause"
                } else {
                    "request-play"
                },
                snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
                None,
            );
        }
        self.release_handoff_hold().await;
        self.with_spirc(Spirc::play_pause).await?;
        Ok(())
    }

    async fn play(&self) -> Result<(), ProviderError> {
        self.cancel_session_recovery().await;
        self.shared
            .playback
            .write()
            .await
            .diagnostics
            .reset_unavailable_streak();
        let (
            audio_started,
            context_uri,
            current_uri,
            expected_uri,
            hold,
            player_request_id,
            player_reported_uri,
            start_decision,
            expected_elapsed_ms,
        ) = {
            let snapshot = self.shared.playback.read().await;
            (
                snapshot.audio_started,
                snapshot.context_uri.clone(),
                snapshot.current_item.as_ref().map(|item| item.uri.clone()),
                snapshot.expected_track_uri.clone(),
                snapshot.handoff_hold,
                snapshot.current_player_request_id,
                snapshot.current_player_reported_uri.clone(),
                decide_play_start(&snapshot),
                snapshot.expected_elapsed_ms(),
            )
        };
        let track_uri = expected_uri
            .as_ref()
            .filter(|uri| is_playable_item_uri(uri))
            .cloned()
            .or(current_uri.clone());
        let pending_mismatch = expected_uri.as_deref().is_some_and(|expected| {
            current_uri
                .as_deref()
                .is_none_or(|current| !same_item_uri(current, expected))
        });
        info!(
            adapter = "librespot",
            phase = "play",
            audio_started,
            handoff_hold = hold,
            track_uri = track_uri.as_deref().map(uri_tail),
            current_uri = current_uri.as_deref().map(uri_tail),
            expected_uri = expected_uri.as_deref().map(uri_tail),
            pending_mismatch,
            expected_elapsed_ms,
            context_uri = context_uri.as_deref(),
            player_request_id = ?player_request_id,
            player_reported_uri = player_reported_uri.as_deref().map(uri_tail),
            start_mode = start_decision.mode(),
            start_reason = start_decision.reason(),
            "play requested"
        );
        {
            let snapshot = self.shared.playback.read().await;
            log_transition(
                &snapshot,
                "command-play",
                if start_decision.should_reload() {
                    "request-reload"
                } else if start_decision.keeps_pending() {
                    "keep-pending"
                } else {
                    "request-resume"
                },
                track_uri.as_deref(),
                None,
            );
        }
        if start_decision.should_reload() {
            if let Some(track_uri) = track_uri.as_deref().filter(|uri| is_playable_item_uri(uri)) {
                if let Some(context_uri) =
                    context_uri.filter(|uri| is_context_uri(uri) && !same_item_uri(uri, &track_uri))
                {
                    info!(
                        adapter = "librespot",
                        phase = "play",
                        track_uri = uri_tail(&track_uri),
                        context_uri = %context_uri,
                        "play reloads the restored context"
                    );
                    return self
                        .play_context_start(&context_uri, Some(track_uri), Vec::new())
                        .await;
                }
                info!(
                    adapter = "librespot",
                    phase = "play",
                    track_uri = uri_tail(track_uri),
                    "play reloads the restored track"
                );
                let intent = reserve_load_intent(&self.shared).await;
                let (generation, rollback) = {
                    let mut snapshot = self.shared.playback.write().await;
                    if !load_intent_is_current(&snapshot, intent) {
                        return Ok(());
                    }
                    let mut rollback = PlaybackRollback::capture(&snapshot, intent);
                    snapshot.handoff_hold = false;
                    snapshot.queue.clear_context();
                    snapshot.context_uri = None;
                    let generation = begin_expected_track(&mut snapshot, track_uri);
                    rollback.seal(&snapshot);
                    (generation, rollback)
                };
                if self
                    .load_tracks(
                        vec![track_uri.to_string()],
                        None,
                        generation,
                        Some(rollback),
                    )
                    .await?
                {
                    self.publish_loaded_item(track_uri, None, Some(generation))
                        .await;
                }
                return Ok(());
            }
        }
        if start_decision.keeps_pending() {
            info!(
                adapter = "librespot",
                phase = "play",
                expected_uri = expected_uri.as_deref().map(uri_tail),
                current_uri = current_uri.as_deref().map(uri_tail),
                expected_elapsed_ms,
                "play keeps the pending expected load"
            );
        } else {
            info!(
                adapter = "librespot",
                phase = "play",
                track_uri = track_uri.as_deref().map(uri_tail),
                "play resumes at the current position"
            );
        }
        self.release_handoff_hold().await;
        self.with_spirc(Spirc::play).await?;
        Ok(())
    }

    async fn pause(&self) -> Result<(), ProviderError> {
        self.cancel_session_recovery().await;
        {
            let snapshot = self.shared.playback.read().await;
            log_transition(
                &snapshot,
                "command-pause",
                "requested",
                snapshot.current_item.as_ref().map(|item| item.uri.as_str()),
                None,
            );
        }
        self.with_spirc(Spirc::pause).await?;
        Ok(())
    }

    async fn next(&self) -> Result<(), ProviderError> {
        let started = Instant::now();
        let intent = reserve_load_intent(&self.shared).await;
        let prepared = {
            let mut snapshot = self.shared.playback.write().await;
            if !load_intent_is_current(&snapshot, intent) {
                return Ok(());
            }
            let prepared = prepare_next_load(&mut snapshot, intent);
            arm_pending_next_load(&mut snapshot, prepared.as_ref());
            let (outcome, target) = match prepared.as_ref() {
                Some(prepared) if prepared.explicit => {
                    ("prepared-explicit", Some(prepared.item.uri.as_str()))
                }
                Some(prepared) => ("prepared-context", Some(prepared.item.uri.as_str())),
                None => ("queue-empty", None),
            };
            log_transition(&snapshot, "command-next", outcome, target, None);
            prepared
        };
        if let Some(prepared) = prepared {
            let result = self.finish_prepared_load(prepared).await;
            info!(
                adapter = "librespot",
                phase = "command-next",
                elapsed_ms = started.elapsed().as_millis(),
                "libre next returned"
            );
            return result;
        }
        // Spirc has no reliable local queue after single-track loads. Avoid
        // calling next() there — it either no-ops or reloads the current song.
        notify_playback(&self.shared).await;
        info!(
            adapter = "librespot",
            phase = "command-next",
            elapsed_ms = started.elapsed().as_millis(),
            "libre next returned empty"
        );
        Ok(())
    }

    async fn previous(&self) -> Result<(), ProviderError> {
        let intent = reserve_load_intent(&self.shared).await;
        let (restart, prepared) = {
            let mut snapshot = self.shared.playback.write().await;
            if !load_intent_is_current(&snapshot, intent) {
                return Ok(());
            }
            let (restart, prepared) =
                if let Some(restart) = prepare_previous_restart(&mut snapshot, intent) {
                    (Some(restart), None)
                } else {
                    (None, prepare_previous_load(&mut snapshot, intent))
                };
            let (outcome, target) = if let Some(restart) = restart.as_ref() {
                ("restart-current", restart.uri())
            } else if let Some(prepared) = prepared.as_ref() {
                ("prepared-history", Some(prepared.item.uri.as_str()))
            } else {
                ("history-empty", None)
            };
            log_transition(&snapshot, "command-previous", outcome, target, None);
            (restart, prepared)
        };
        if let Some(prepared) = prepared {
            return self.finish_prepared_load(prepared).await;
        }
        let Some(restart) = restart else {
            notify_playback(&self.shared).await;
            return Ok(());
        };
        notify_playback(&self.shared).await;
        let intent_is_current = {
            let snapshot = self.shared.playback.read().await;
            load_intent_is_current(&snapshot, intent)
        };
        if !intent_is_current {
            return Ok(());
        }
        if let Err(error) = self.with_spirc(|spirc| spirc.set_position_ms(0)).await {
            let rolled_back = {
                let mut snapshot = self.shared.playback.write().await;
                rollback_previous_restart(&mut snapshot, &restart)
            };
            if rolled_back {
                notify_playback(&self.shared).await;
            }
            return Err(error);
        }
        Ok(())
    }

    async fn seek(&self, position_ms: u64) -> Result<(), ProviderError> {
        self.cancel_session_recovery().await;
        let position = u32::try_from(position_ms).unwrap_or(u32::MAX);
        self.with_spirc(|spirc| spirc.set_position_ms(position))
            .await?;
        let mut snapshot = self.shared.playback.write().await;
        snapshot.position_ms = position_ms;
        snapshot.position_updated_at = Instant::now();
        drop(snapshot);
        notify_playback(&self.shared).await;
        Ok(())
    }

    async fn set_volume(&self, volume: f64) -> Result<(), ProviderError> {
        let clamped = volume.clamp(0.0, 1.0);
        let mixer = {
            let session = self.shared.session.lock().await;
            let active = session.as_ref().ok_or_else(not_ready)?;
            active.local_volume.request(volume_to_connect(clamped));
            Arc::clone(&active.local_volume)
        };
        let mut snapshot = self.shared.playback.write().await;
        // Another slider request may have arrived while this write lock waited.
        let audible = connect_volume_to_unit(mixer.audible_volume());
        snapshot.volume = audible;
        snapshot.is_muted = audible == 0.0;
        if audible > 0.0 {
            snapshot.last_unmuted_volume = audible;
        }
        Ok(())
    }

    async fn toggle_mute(&self) -> Result<(), ProviderError> {
        let (next, previous) = {
            let snapshot = self.shared.playback.read().await;
            if snapshot.is_muted || snapshot.volume == 0.0 {
                (snapshot.last_unmuted_volume.max(0.05), snapshot.volume)
            } else {
                (0.0, snapshot.volume)
            }
        };
        match self.set_volume(next).await {
            Ok(()) => Ok(()),
            Err(error) => {
                let mut snapshot = self.shared.playback.write().await;
                snapshot.volume = previous;
                snapshot.is_muted = previous == 0.0;
                Err(error)
            }
        }
    }

    async fn set_shuffle(&self, enabled: bool) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let mut snapshot = self.shared.playback.write().await;
        snapshot.shuffle_enabled = enabled;
        let current = effective_cursor_item(&snapshot);
        let current_uri = current
            .as_ref()
            .map(|item| item.uri.clone())
            .unwrap_or_default();
        if let Some(current) = current {
            snapshot.queue.remember_item(&current);
        }
        snapshot.queue.reshuffle_upcoming(&current_uri, enabled);
        log_transition(
            &snapshot,
            "command-shuffle",
            if enabled { "enabled" } else { "disabled" },
            (!current_uri.is_empty()).then_some(current_uri.as_str()),
            None,
        );
        drop(snapshot);
        spawn_queue_hydrate(Arc::clone(&self.shared));
        notify_playback(&self.shared).await;
        Ok(())
    }

    async fn set_repeat(&self, mode: RepeatMode) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        // The local queue is the sole transition planner. Enabling Spirc repeat
        // would make its one-track context race the local EndOfTrack handler.
        self.shared.playback.write().await.repeat_mode = mode;
        notify_playback(&self.shared).await;
        Ok(())
    }

    async fn toggle_like(&self) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let (uri, next) = {
            let snapshot = self.shared.playback.read().await;
            let uri = snapshot
                .current_item
                .as_ref()
                .map(|item| item.uri.clone())
                .ok_or_else(|| ProviderError::ActionRejected {
                    message: "Kein Titel zum Speichern.".into(),
                    retryable: false,
                })?;
            (uri, !snapshot.is_saved)
        };
        {
            let mut snapshot = self.shared.playback.write().await;
            if snapshot
                .current_item
                .as_ref()
                .is_some_and(|item| same_item_uri(&item.uri, &uri))
            {
                snapshot.is_saved = next;
            }
        }
        notify_playback(&self.shared).await;
        if crate::collection::set_saved(&self.session_clone().await?, &uri, next).await {
            return Ok(());
        }
        {
            let mut snapshot = self.shared.playback.write().await;
            if snapshot
                .current_item
                .as_ref()
                .is_some_and(|item| same_item_uri(&item.uri, &uri))
            {
                snapshot.is_saved = !next;
            }
        }
        notify_playback(&self.shared).await;
        Err(ProviderError::ActionRejected {
            message: "Der Titel konnte nicht in der Bibliothek gespeichert werden.".into(),
            retryable: true,
        })
    }

    async fn play_uri(&self, uri: &str) -> Result<(), ProviderError> {
        let uri = uri.trim();
        if is_context_uri(uri) {
            return self.play_context_start(uri, None, Vec::new()).await;
        }
        if !is_playable_item_uri(uri) {
            return Err(invalid_playable_uri(uri));
        }
        let intent = reserve_load_intent(&self.shared).await;
        let (generation, rollback) = {
            let mut snapshot = self.shared.playback.write().await;
            if !load_intent_is_current(&snapshot, intent) {
                return Ok(());
            }
            let mut rollback = PlaybackRollback::capture(&snapshot, intent);
            snapshot.handoff_hold = false;
            snapshot.queue.clear_context();
            snapshot.context_uri = None;
            let generation = begin_expected_track(&mut snapshot, uri);
            rollback.seal(&snapshot);
            log_transition(&snapshot, "command-play-uri", "prepared", Some(uri), None);
            (generation, rollback)
        };
        if self
            .load_tracks(vec![uri.to_string()], None, generation, Some(rollback))
            .await?
        {
            self.publish_loaded_item(uri, None, Some(generation)).await;
        }
        Ok(())
    }

    async fn play_context(&self, context_uri: &str, track_uri: &str) -> Result<(), ProviderError> {
        let track_uri = track_uri.trim();
        if !is_playable_item_uri(track_uri) {
            return Err(invalid_playable_uri(track_uri));
        }
        self.play_context_start(context_uri, Some(track_uri), Vec::new())
            .await
    }
}
