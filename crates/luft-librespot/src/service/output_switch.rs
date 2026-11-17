use super::*;

impl LibrespotService {
    /// Applies a new output device, bitrate or loudness setting. These are
    /// fixed when Librespot opens its player, so a running session restarts
    /// and resumes where it was; on failure the previous setup is restored.
    pub async fn apply_player_setup(
        self: &Arc<Self>,
        setup: luft_audio::PlayerSetup,
    ) -> Result<LibrespotStatus, ProviderError> {
        // Serialize the entire decision with login, recovery and other switches.
        let _guard = self.shared.connect_lock.lock().await;
        let next = sanitize_player_setup(setup);
        let previous = self.shared.player_setup.lock().await.clone();
        if previous == next {
            return Ok(self.status().await);
        }
        if self.status().await.phase != LibrespotPhase::Ready {
            *self.shared.player_setup.lock().await = next;
            return Ok(self.status().await);
        }
        let credentials = open_cache(&self.shared.cache_dir)?
            .credentials()
            .ok_or_else(not_ready)?;
        let recovery = self.capture_session_recovery().await;
        *self.shared.player_setup.lock().await = next;
        self.shared
            .session_recovery_attempts
            .store(0, Ordering::SeqCst);
        self.set_status(LibrespotPhase::Connecting, true, None, None)
            .await;
        self.shutdown_session_keep_playback().await;
        self.freeze_interrupted_playback(recovery.position_ms).await;
        notify_playback(&self.shared).await;

        match self
            .reopen_output_session(credentials.clone(), &recovery)
            .await
        {
            Ok(()) => Ok(self.status().await),
            Err(error) => {
                // Restore the working output as well as the saved preference.
                // Reuse the pre-switch snapshot, not the partially started session.
                warn!(%error, adapter = "librespot", "player setup switch failed; restoring previous setup");
                *self.shared.player_setup.lock().await = previous;
                self.shutdown_session_keep_playback().await;
                self.freeze_interrupted_playback(recovery.position_ms).await;
                if let Err(rollback_error) =
                    self.reopen_output_session(credentials, &recovery).await
                {
                    self.shutdown_session_keep_playback().await;
                    self.freeze_interrupted_playback(recovery.position_ms).await;
                    self.set_status(
                        LibrespotPhase::Error,
                        true,
                        None,
                        Some(&rollback_error.to_string()),
                    )
                    .await;
                    warn!(%rollback_error, adapter = "librespot", "previous audio output could not be restored");
                }
                notify_playback(&self.shared).await;
                Err(error)
            }
        }
    }

    async fn reopen_output_session(
        self: &Arc<Self>,
        credentials: Credentials,
        recovery: &SessionRecoverySnapshot,
    ) -> Result<(), ProviderError> {
        let username = self.start_session(credentials).await.map_err(|error| {
            ProviderError::ActionRejected {
                message: error.message,
                retryable: true,
            }
        })?;
        self.restore_recovered_playback(recovery).await?;
        self.set_status(LibrespotPhase::Ready, true, username, None)
            .await;
        notify_playback(&self.shared).await;
        Ok(())
    }
}
