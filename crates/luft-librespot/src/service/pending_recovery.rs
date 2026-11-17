use super::*;

/// Cancels only recovery work, including a restore currently preparing its load.
/// Ordinary playback commands retain their existing behavior outside recovery.
pub(super) fn cancel_session_recovery(snapshot: &mut PlaybackSnapshot) {
    if snapshot.pending_session_recovery.take().is_some() {
        snapshot.load_intent_epoch = snapshot.load_intent_epoch.saturating_add(1);
        snapshot.play_generation = snapshot.play_generation.saturating_add(1);
        snapshot.pending_seek_ms = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn interrupted_service() -> Arc<LibrespotService> {
        let service = LibrespotService::new(PathBuf::from("missing-recovery-test-cache"));
        let recovery = service.capture_session_recovery().await;
        service.shared.playback.write().await.pending_session_recovery = Some((0, recovery));
        service
    }

    #[tokio::test]
    async fn pending_recovery_reaches_restore_and_is_consumed_even_if_it_fails() {
        let service = interrupted_service().await;
        // No real session: reaching Spirc yields NotReady, proving this is not
        // silently treated as a successful reconnect without restoration.
        assert!(service.restore_pending_session_recovery().await.is_err());
        assert!(service.shared.playback.read().await.pending_session_recovery.is_none());
        assert!(service.restore_pending_session_recovery().await.is_ok());
    }

    #[tokio::test]
    async fn newer_intent_does_not_restore_an_old_song() {
        let service = interrupted_service().await;
        service.shared.playback.write().await.load_intent_epoch = 1;
        assert!(service.restore_pending_session_recovery().await.is_ok());
        assert!(service.shared.playback.read().await.pending_session_recovery.is_none());
    }

    #[tokio::test]
    async fn pause_cancels_recovery_even_without_a_connection() {
        let service = interrupted_service().await;
        assert!(service.pause().await.is_err());
        let snapshot = service.shared.playback.read().await;
        assert!(snapshot.pending_session_recovery.is_none());
        assert!(snapshot.play_generation > 0);
        assert!(snapshot.load_intent_epoch > 0);
    }

    #[tokio::test]
    async fn new_load_and_session_shutdown_cancel_recovery() {
        let service = interrupted_service().await;
        reserve_load_intent(&service.shared).await;
        assert!(service.shared.playback.read().await.pending_session_recovery.is_none());
        let service = interrupted_service().await;
        service.shutdown_session_keep_playback().await;
        assert!(service.shared.playback.read().await.pending_session_recovery.is_none());
    }

    #[tokio::test]
    async fn ordinary_login_has_nothing_to_resume() {
        let service = LibrespotService::new(PathBuf::from("missing-recovery-test-cache"));
        assert!(service.restore_pending_session_recovery().await.is_ok());
        let mut snapshot = service.shared.playback.write().await;
        cancel_session_recovery(&mut snapshot);
        assert_eq!(snapshot.load_intent_epoch, 0);
        assert_eq!(snapshot.play_generation, 0);
    }
}

impl LibrespotService {
    pub(super) async fn cancel_session_recovery(&self) {
        cancel_session_recovery(&mut *self.shared.playback.write().await);
    }

    pub(super) async fn restore_pending_session_recovery(&self) -> Result<(), ProviderError> {
        let pending = self.shared.playback.read().await.pending_session_recovery.clone();
        let Some((intent, recovery)) = pending else { return Ok(()); };
        // Keep the marker while restoring: Pause/new tracks can invalidate the
        // generation even after this clone, before a delayed load is sent.
        let result = self.restore_recovered_playback_guarded(&recovery, Some(intent)).await;
        let mut snapshot = self.shared.playback.write().await;
        if snapshot.pending_session_recovery.as_ref().is_some_and(|(id, _)| *id == intent) {
            snapshot.pending_session_recovery = None;
        }
        result
    }
}
