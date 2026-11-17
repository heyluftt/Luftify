use std::sync::Arc;

use std::time::Instant;

use luft_core::{EntitySummary, Page, PageRequest, SpotifyProvider};
use luft_infrastructure::{AppPaths, CoverCache, DatabaseHandle, LoggingGuard, LyricsService};
use luft_librespot::LibrespotService;
use luft_setup::WindowsAutostartService;
use tokio::sync::Mutex;

use crate::{
    lifecycle::AppLifecycle,
    friends::FriendsService,
    listen_together::ListenTogetherService,
    listening_analytics::ListeningAnalyticsService,
    startup::{StartupCoordinator, StartupServices},
};

pub struct PlaylistRefreshState {
    pub request: Option<PageRequest>,
    pub completed_at: Option<Instant>,
    pub page: Option<Page<EntitySummary>>,
}

pub struct AppState {
    /// The active engine behind every provider call: Libre, or the mock in `--mock` mode.
    pub provider: Arc<dyn SpotifyProvider>,
    pub librespot: Arc<LibrespotService>,
    pub database: DatabaseHandle,
    pub paths: AppPaths,
    pub cover_cache: CoverCache,
    pub lyrics: LyricsService,
    pub autostart: WindowsAutostartService,
    pub startup: Arc<StartupCoordinator>,
    pub lifecycle: Arc<AppLifecycle>,
    pub listening_analytics: ListeningAnalyticsService,
    pub listen_together: ListenTogetherService,
    pub friends: FriendsService,
    /// Whether the last session ended unexpectedly (session_guard).
    pub session: Arc<crate::session_guard::SessionGuard>,
    pub mock_mode: bool,
    pub playlist_refresh: Mutex<PlaylistRefreshState>,
    pub _logging_guard: LoggingGuard,
}

impl AppState {
    /// Libre-specific commands must not touch the local engine while the mock provider plays.
    #[must_use]
    pub fn uses_librespot(&self) -> bool {
        !self.mock_mode
    }

    pub fn startup_services(&self, autostart_launch: bool) -> StartupServices {
        StartupServices {
            librespot: Arc::clone(&self.librespot),
            database: self.database.clone(),
            lifecycle: Arc::clone(&self.lifecycle),
            listening_analytics: self.listening_analytics.clone(),
            mock_mode: self.mock_mode,
            autostart_launch,
        }
    }
}
