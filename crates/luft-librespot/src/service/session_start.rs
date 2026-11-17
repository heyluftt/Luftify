use super::*;

use librespot::core::error::ErrorKind;

/// Waits between quick retries while the caller is still waiting (≈17 s).
const QUICK_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];
/// Waits between background retries once the caller gave up; afterwards
/// every ten minutes for as long as Spotify refuses. Outages can take hours.
const BACKGROUND_RETRY_DELAYS: [Duration; 5] = [
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
    Duration::from_secs(600),
];

/// Why a session did not start. `transient` marks failures worth trying
/// again unchanged: Spotify-side hiccups (503, timeouts, rate limits) and a
/// network that is not there yet (DNS failing right after boot or wake-up).
#[derive(Debug, Clone)]
pub(super) struct SessionStartError {
    pub(super) message: String,
    pub(super) transient: bool,
}

impl SessionStartError {
    pub(super) fn transient(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            transient: true,
        }
    }

    pub(super) fn from_connect(error: &librespot::core::error::Error) -> Self {
        Self {
            message: format!("Spotify Connect konnte nicht starten: {error}"),
            transient: is_transient_kind(error.kind),
        }
    }
}

impl From<String> for SessionStartError {
    fn from(message: String) -> Self {
        Self {
            message,
            transient: false,
        }
    }
}

impl From<&str> for SessionStartError {
    fn from(message: &str) -> Self {
        Self::from(message.to_string())
    }
}

impl std::fmt::Display for SessionStartError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// Only a refusal is final. Network failures arrive as `Unknown` or
/// `NotFound` (Windows: "os error 11004" while DNS was not up at 03:38 on
/// 27 Oct 2026); treated as final, Libre stayed in its error state until a
/// restart. Background retries back off to ten minutes, so retrying a
/// failure that does not pass costs little.
pub(super) fn is_transient_kind(kind: ErrorKind) -> bool {
    !matches!(
        kind,
        ErrorKind::Unauthenticated
            | ErrorKind::PermissionDenied
            | ErrorKind::InvalidArgument
            | ErrorKind::Unimplemented
    )
}

impl LibrespotService {
    /// Starts a session and retries a few times when Spotify answers with a
    /// temporary error. A single 503 from Spotify Connect left Libre
    /// disconnected until the next app start.
    pub(super) async fn start_session_patiently(
        self: &Arc<Self>,
        credentials: Credentials,
    ) -> Result<Option<String>, SessionStartError> {
        let mut attempt = 0;
        loop {
            match self.start_session(credentials.clone()).await {
                Ok(username) => return Ok(username),
                Err(error) if error.transient && attempt < QUICK_RETRY_DELAYS.len() => {
                    let delay = QUICK_RETRY_DELAYS[attempt];
                    attempt += 1;
                    warn!(
                        error = %error,
                        adapter = "librespot",
                        phase = "session-start-retry",
                        attempt,
                        delay_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX),
                        "spotify refused the session for now; retrying"
                    );
                    self.set_status(
                        LibrespotPhase::Connecting,
                        true,
                        None,
                        Some("Spotify antwortet gerade nicht. Neuer Versuch …"),
                    )
                    .await;
                    tokio::time::sleep(delay).await;
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// Keeps trying with saved credentials after a temporary failure, until a
    /// session runs, the user signs out or connects by hand, or time runs out.
    pub(super) fn schedule_background_reconnect(self: &Arc<Self>) {
        if self
            .shared
            .background_reconnect
            .swap(true, Ordering::SeqCst)
        {
            return;
        }
        let service = Arc::clone(self);
        tokio::spawn(async move {
            for attempt in 1.. {
                let delay =
                    BACKGROUND_RETRY_DELAYS[(attempt - 1).min(BACKGROUND_RETRY_DELAYS.len() - 1)];
                tokio::time::sleep(delay).await;
                if !service.background_reconnect_step(attempt).await {
                    break;
                }
            }
            service
                .shared
                .background_reconnect
                .store(false, Ordering::SeqCst);
        });
    }

    /// One background attempt. Returns whether another attempt makes sense.
    async fn background_reconnect_step(self: &Arc<Self>, attempt: usize) -> bool {
        let _guard = self.shared.connect_lock.lock().await;
        let phase = self.shared.status.read().await.phase;
        if phase != LibrespotPhase::Error || self.shared.session.lock().await.is_some() {
            return false;
        }
        let Some(credentials) = open_cache(&self.shared.cache_dir)
            .ok()
            .and_then(|cache| cache.credentials())
        else {
            self.cancel_session_recovery().await;
            return false;
        };
        self.set_status(
            LibrespotPhase::Connecting,
            true,
            None,
            Some("Libre verbindet sich neu …"),
        )
        .await;
        match self.start_session(credentials).await {
            Ok(username) => {
                if let Err(error) = self.restore_pending_session_recovery().await {
                    warn!(error = %error, adapter = "librespot", phase = "background-reconnect", "reconnected but playback could not be restored");
                }
                info!(
                    adapter = "librespot",
                    phase = "background-reconnect",
                    attempt,
                    "librespot reconnected"
                );
                self.set_status(
                    LibrespotPhase::Ready,
                    true,
                    username,
                    Some("Libre wurde automatisch wieder verbunden."),
                )
                .await;
                false
            }
            Err(error) => {
                if !error.transient {
                    self.cancel_session_recovery().await;
                }
                warn!(error = %error, adapter = "librespot", phase = "background-reconnect", attempt, "librespot reconnect failed");
                self.set_status(
                    LibrespotPhase::Error,
                    credentials_exist(&self.shared.cache_dir),
                    None,
                    Some(error.message.as_str()),
                )
                .await;
                error.transient
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spotify_hiccups_are_retried_but_refusals_are_not() {
        let unavailable = librespot::core::error::Error::unavailable("503");
        assert!(SessionStartError::from_connect(&unavailable).transient);
        assert!(is_transient_kind(ErrorKind::DeadlineExceeded));
        assert!(!is_transient_kind(ErrorKind::Unauthenticated));
        assert!(!is_transient_kind(ErrorKind::PermissionDenied));
        assert!(!SessionStartError::from("Anmeldung abgelehnt").transient);
    }

    #[test]
    fn a_network_that_is_not_up_yet_is_retried() {
        let dns = std::io::Error::other("os error 11004");
        assert!(SessionStartError::from_connect(&dns.into()).transient);
        assert!(is_transient_kind(ErrorKind::NotFound));
    }
}
