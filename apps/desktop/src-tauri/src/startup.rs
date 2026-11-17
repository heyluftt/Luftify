use std::{
    io::Write,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use luft_infrastructure::DatabaseHandle;
use luft_librespot::{LibrespotPhase, LibrespotService};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupPhase {
    AppInitializing,
    CacheLoading,
    Ready,
    Degraded,
}

impl StartupPhase {
    fn log_name(self) -> &'static str {
        match self {
            Self::AppInitializing => "app-initializing",
            Self::CacheLoading => "cache-loading",
            Self::Ready => "ready",
            Self::Degraded => "degraded",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupEvent {
    pub phase: StartupPhase,
    pub elapsed_ms: u64,
    pub sequence: u64,
}

#[derive(Clone)]
pub struct StartupServices {
    pub librespot: Arc<LibrespotService>,
    pub database: DatabaseHandle,
    pub lifecycle: Arc<crate::lifecycle::AppLifecycle>,
    pub listening_analytics: crate::listening_analytics::ListeningAnalyticsService,
    pub mock_mode: bool,
    pub autostart_launch: bool,
}

pub struct StartupCoordinator {
    started_at: Instant,
    metrics_path: PathBuf,
    sequence: AtomicU64,
    status_tx: watch::Sender<StartupEvent>,
}

impl StartupCoordinator {
    #[must_use]
    pub fn new(started_at: Instant, metrics_path: PathBuf) -> Arc<Self> {
        let (status_tx, _) = watch::channel(StartupEvent {
            phase: StartupPhase::AppInitializing,
            elapsed_ms: 0,
            sequence: 0,
        });
        Arc::new(Self {
            started_at,
            metrics_path,
            sequence: AtomicU64::new(0),
            status_tx,
        })
    }

    #[must_use]
    pub fn current(&self) -> StartupEvent {
        self.status_tx.borrow().clone()
    }

    pub fn reset_metrics(&self, window_visible_ms: u128) {
        let _ = std::fs::create_dir_all(
            self.metrics_path
                .parent()
                .unwrap_or_else(|| std::path::Path::new(".")),
        );
        let _ = std::fs::write(&self.metrics_path, []);
        self.record_metric("window-visible", window_visible_ms, "shown", "tauri-window");
    }

    /// Opens the local cache, applies the saved settings and starts the Libre
    /// session in the background. The window is already visible; Libre reports
    /// its own connection phases through `librespot://status`.
    pub async fn run(self: Arc<Self>, app: AppHandle, services: StartupServices) {
        self.transition(&app, StartupPhase::AppInitializing);
        self.transition(&app, StartupPhase::CacheLoading);
        let database = services.database.clone();
        let settings_task = tokio::spawn(async move {
            database.initialize().await?;
            database.get().await?.settings().await
        });
        let mut degraded = false;
        let settings = match settings_task.await {
            Ok(Ok(settings)) => {
                self.record_metric(
                    "cache-ready",
                    self.started_at.elapsed().as_millis(),
                    "opened",
                    "sqlite",
                );
                info!(
                    phase = "cache-ready",
                    duration_ms = self.started_at.elapsed().as_millis(),
                    status = "opened",
                    adapter = "sqlite",
                    "startup timing"
                );
                settings
            }
            _ => {
                degraded = true;
                warn!(
                    phase = "cache-loading",
                    status = "database-failed",
                    adapter = "sqlite",
                    "startup cache unavailable"
                );
                luft_infrastructure::Settings::default()
            }
        };
        let mut live_dsp = settings.audio_control.dsp.clone();
        live_dsp.enabled &= settings.audio_control.enabled;
        live_dsp.spatial.enabled &= settings.audio_control.enabled;
        live_dsp.volume_boost_enabled &= settings.audio_control.enabled;
        services.librespot.set_dsp_settings(live_dsp);
        services
            .librespot
            .set_experimental_canvas(settings.experimental_libre_canvas);
        if let Err(error) = services
            .listening_analytics
            .set_enabled(settings.listening_analytics_enabled)
            .await
        {
            warn!(
                error,
                "listening analytics could not apply startup settings"
            );
        }
        services.lifecycle.apply_settings(settings.clone()).await;
        if settings.windows_autostart {
            match std::env::current_exe() {
                Ok(executable) => {
                    if let Err(error) = luft_setup::WindowsAutostartService
                        .ensure_enabled(&executable)
                        .await
                    {
                        warn!(error = %error, adapter = "windows-run-key", "autostart entry could not be reconciled");
                    }
                }
                Err(error) => {
                    warn!(error = %error, adapter = "current-executable", "autostart executable could not be resolved")
                }
            }
        }
        if services.autostart_launch && !settings.start_in_tray_on_autostart {
            crate::lifecycle::show_main_window(&app);
        }

        if !services.mock_mode {
            let librespot = Arc::clone(&services.librespot);
            let database = services.database.clone();
            let player_setup = settings.librespot_player_setup();
            tokio::spawn(async move {
                librespot.set_player_setup(player_setup).await;
                match librespot.connect_if_possible().await {
                    Ok(_) => {
                        crate::commands::playback::restore_librespot_startup_queue(
                            &database, &librespot,
                        )
                        .await;
                    }
                    Err(error) => {
                        warn!(
                            error = %error,
                            adapter = "librespot",
                            "librespot startup connect failed"
                        );
                        // Libre keeps reconnecting in the background; the saved
                        // queue still comes back if that succeeds later.
                        if wait_until_ready(&librespot).await {
                            crate::commands::playback::restore_librespot_startup_queue(
                                &database, &librespot,
                            )
                            .await;
                        }
                    }
                }
            });
        }
        self.transition(
            &app,
            if degraded {
                StartupPhase::Degraded
            } else {
                StartupPhase::Ready
            },
        );
    }

    pub(crate) fn transition(&self, app: &AppHandle, phase: StartupPhase) {
        let event = StartupEvent {
            phase,
            elapsed_ms: u64::try_from(self.started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed) + 1,
        };
        self.status_tx.send_replace(event.clone());
        let _ = app.emit("startup://phase", event);
        self.record_metric(
            phase.log_name(),
            self.started_at.elapsed().as_millis(),
            phase_status(phase),
            "startup-coordinator",
        );
        info!(
            phase = phase.log_name(),
            duration_ms = self.started_at.elapsed().as_millis(),
            status = phase_status(phase),
            adapter = "startup-coordinator",
            "startup timing"
        );
    }

    fn record_metric(&self, phase: &str, duration_ms: u128, status: &str, adapter: &str) {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Metric<'a> {
            phase: &'a str,
            duration_ms: u128,
            status: &'a str,
            adapter: &'a str,
        }

        let Ok(line) = serde_json::to_string(&Metric {
            phase,
            duration_ms,
            status,
            adapter,
        }) else {
            return;
        };
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.metrics_path)
        {
            let _ = writeln!(file, "{line}");
        }
    }
}

/// How long a late reconnect still restores the saved queue.
const LATE_RESTORE_WINDOW: Duration = Duration::from_secs(3 * 60 * 60);

async fn wait_until_ready(librespot: &LibrespotService) -> bool {
    let mut status = librespot.subscribe_status();
    tokio::time::timeout(LATE_RESTORE_WINDOW, async {
        loop {
            if status.borrow_and_update().phase == LibrespotPhase::Ready {
                return true;
            }
            if status.changed().await.is_err() {
                return false;
            }
        }
    })
    .await
    .unwrap_or(false)
}

fn phase_status(phase: StartupPhase) -> &'static str {
    match phase {
        StartupPhase::Ready => "ready",
        StartupPhase::Degraded => "degraded",
        _ => "active",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_events_use_typed_camel_case_phases() {
        let event = StartupEvent {
            phase: StartupPhase::CacheLoading,
            elapsed_ms: 25,
            sequence: 4,
        };
        let value = serde_json::to_value(event).expect("event");
        assert_eq!(value["phase"], "cacheLoading");
    }

    #[test]
    fn terminal_phase_statuses_are_stable() {
        assert_eq!(phase_status(StartupPhase::Ready), "ready");
        assert_eq!(phase_status(StartupPhase::Degraded), "degraded");
        assert_eq!(phase_status(StartupPhase::CacheLoading), "active");
    }
}
