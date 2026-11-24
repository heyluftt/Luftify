mod canvas_runtime;
mod clock;
mod context_playback;
mod diagnostics;
mod discovery_queue;
mod library;
mod local_volume;
mod lookahead;
use local_volume::{LocalVolume, spawn_volume_sync};
mod next_transition;
mod output_switch;
mod play_start;
mod playback_provider;
mod player_events;
mod player_identity;
mod queue_focus;
mod queue_hydration;
mod queue_playback;
mod runtime;
mod session_runtime;
mod pending_recovery;
mod session_start;
mod track_previews;
pub use track_previews::TrackPreview;
use session_start::SessionStartError;
#[cfg(test)]
mod tests;
mod transport;

use canvas_runtime::*;
use clock::*;
use diagnostics::*;
use lookahead::*;
use next_transition::*;
use play_start::*;
use player_events::*;
use player_identity::*;
use queue_hydration::*;
use runtime::*;
use session_runtime::*;
use pending_recovery::cancel_session_recovery;
use transport::*;

use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use crate::metadata::{
    is_placeholder_title, item_from_audio_item, load_metadata, load_metadata_resilient,
    loading_item, merge_media_items,
};
use crate::playback::{
    context_owns_remote_queue, is_context_uri, is_playable_item_uri, load_request_options,
    pick_random_context_start, should_pick_random_context_start,
};
use crate::queue::{
    QueueLists, ShuffleCommit, canonicalize_item_uri, catalog_uris, load_context_play_entries,
    plan_upcoming, play_order, same_context_uris, same_item_uri,
};
use async_trait::async_trait;
use chrono::Utc;
use librespot::{
    connect::{ConnectConfig, LoadRequest, LoadRequestOptions, Spirc},
    core::{Session, SpotifyUri, authentication::Credentials, cache::Cache, config::SessionConfig},
    playback::{
        audio_backend,
        config::{AudioFormat, PlayerConfig},
        mixer::{self, Mixer, MixerConfig},
        player::{Player, PlayerEvent},
    },
};
use luft_audio::{DspControl, DspSettings, VisualizerControl, VisualizerFrame};
use luft_core::{
    MediaItem, PlaybackProvider, PlaybackState, ProviderError, QueueItem, QueueProvider,
    QueueReorderRequest, QueueState, RepeatMode,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock, watch};
use tracing::{info, warn};

/// Official Spotify desktop client ID, the unofficial convention used by librespot
/// for Access-Point login. This is not a Luftify developer-dashboard app.
const SPOTIFY_DESKTOP_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
const OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:5588/login";
const OAUTH_SCOPES: &[&str] = &[
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-private",
    "user-read-email",
    "user-library-read",
    "user-library-modify",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-private",
    "playlist-modify-public",
];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(45);
const METADATA_TIMEOUT: Duration = Duration::from_millis(900);
const CONTEXT_RESOLVE_TIMEOUT: Duration = Duration::from_secs(8);
const QUEUE_HYDRATE_TRACK_TIMEOUT: Duration = Duration::from_millis(1_800);
const PREVIOUS_RESTART_MS: u64 = 3_000;
const DEVICE_NAME: &str = "Luftify";
const AUDIO_CACHE_LIMIT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LibrespotPhase {
    Disconnected,
    NeedsLogin,
    Authenticating,
    Connecting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrespotStatus {
    pub phase: LibrespotPhase,
    pub credentials_present: bool,
    pub username: Option<String>,
    pub message: Option<String>,
}

impl LibrespotStatus {
    #[must_use]
    pub fn needs_login() -> Self {
        Self {
            phase: LibrespotPhase::NeedsLogin,
            credentials_present: false,
            username: None,
            message: Some("Melde dich einmal an. Danach spielt Librespot lokal.".into()),
        }
    }
}

struct PlaybackSnapshot {
    current_item: Option<MediaItem>,
    is_playing: bool,
    position_ms: u64,
    duration_ms: u64,
    volume: f64,
    is_muted: bool,
    last_unmuted_volume: f64,
    shuffle_enabled: bool,
    repeat_mode: RepeatMode,
    context_uri: Option<String>,
    queue: QueueLists,
    position_updated_at: Instant,
    play_generation: u64,
    startup_play_generation: u64,
    load_intent_epoch: u64,
    pending_session_recovery: Option<(u64, SessionRecoverySnapshot)>,
    last_transport_load_sent_at: Option<Instant>,
    expected_track_uri: Option<String>,
    expected_item: Option<MediaItem>,
    expected_started_at: Option<Instant>,
    current_player_request_id: Option<u64>,
    current_player_reported_uri: Option<String>,
    expected_player_request_id: Option<u64>,
    expected_player_baseline_request_id: Option<u64>,
    sent_player_loads: VecDeque<PlayerLoadIntent>,
    player_item_candidate: Option<PlayerItemCandidate>,
    pending_auto_advance: Option<PendingAutoAdvance>,
    pending_next_load: Option<PendingNextLoad>,
    is_saved: bool,
    pending_seek: Option<PendingSeek>,
    audio_started: bool,
    clock_track_uri: Option<String>,
    audio_lookahead_uri: Option<String>,
    room_queue_active: bool,
    room_queue_next: Option<String>,
    handoff_hold: bool,
    diagnostics: PlaybackDiagnostics,
}

impl Default for PlaybackSnapshot {
    fn default() -> Self {
        Self {
            current_item: None,
            is_playing: false,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.5,
            is_muted: false,
            last_unmuted_volume: 0.5,
            shuffle_enabled: false,
            repeat_mode: RepeatMode::Off,
            context_uri: None,
            queue: QueueLists::default(),
            position_updated_at: Instant::now(),
            play_generation: 0,
            startup_play_generation: 0,
            load_intent_epoch: 0,
            pending_session_recovery: None,
            last_transport_load_sent_at: None,
            expected_track_uri: None,
            expected_item: None,
            expected_started_at: None,
            current_player_request_id: None,
            current_player_reported_uri: None,
            expected_player_request_id: None,
            expected_player_baseline_request_id: None,
            sent_player_loads: VecDeque::new(),
            player_item_candidate: None,
            pending_auto_advance: None,
            pending_next_load: None,
            is_saved: false,
            pending_seek: None,
            audio_started: false,
            clock_track_uri: None,
            audio_lookahead_uri: None,
            room_queue_active: false,
            room_queue_next: None,
            handoff_hold: false,
            diagnostics: PlaybackDiagnostics::default(),
        }
    }
}

impl PlaybackSnapshot {
    fn expected_elapsed_ms(&self) -> Option<u128> {
        self.expected_started_at
            .map(|started| started.elapsed().as_millis())
    }
}

#[derive(Debug, Clone)]
struct PlayerLoadIntent {
    generation: u64,
    uri: String,
}

/// A start position for the load of one generation (session recovery).
#[derive(Debug, Clone, Copy)]
struct PendingSeek {
    generation: u64,
    position_ms: u64,
}

#[derive(Debug, Clone)]
struct PlayerItemCandidate {
    request_id: Option<u64>,
    item: MediaItem,
}

#[derive(Debug, Clone)]
struct PendingAutoAdvance {
    generation: u64,
    load_intent: u64,
    request_id: u64,
    uri: String,
    repeat_current: bool,
}

struct ActiveSession {
    session: Session,
    spirc: Spirc,
    player: Arc<Player>,
    local_volume: Arc<LocalVolume>,
    volume_sync: tokio::task::JoinHandle<()>,
}

impl Drop for ActiveSession {
    fn drop(&mut self) {
        self.volume_sync.abort();
    }
}

struct Shared {
    cache_dir: PathBuf,
    status: RwLock<LibrespotStatus>,
    /// Shared with delayed tasks such as the audio look-ahead (lookahead.rs).
    playback: Arc<RwLock<PlaybackSnapshot>>,
    playback_tx: watch::Sender<PlaybackState>,
    session: Mutex<Option<ActiveSession>>,
    connect_lock: Mutex<()>,
    load_gate: Mutex<()>,
    native_lyrics_misses: Mutex<crate::lyrics::NativeLyricsMissCache>,
    playlist_cache: Arc<crate::playlist::PlaylistIndexCache>,
    queue_restored: AtomicBool,
    session_epoch: AtomicU64,
    session_recovery_attempts: AtomicU64,
    /// A background reconnect loop is running after a temporary failure.
    background_reconnect: AtomicBool,
    /// Output device, bitrate and loudness; fixed while a player runs.
    player_setup: Mutex<luft_audio::PlayerSetup>,
    dsp_control: DspControl,
    visualizer_control: VisualizerControl,
    experimental_canvas: AtomicBool,
    canvas_lookup: CanvasLookupTracker,
}

#[derive(Clone)]
pub struct LibrespotService {
    shared: Arc<Shared>,
    status_tx: watch::Sender<LibrespotStatus>,
}

impl LibrespotService {
    #[must_use]
    pub fn new(cache_dir: PathBuf) -> Arc<Self> {
        crate::key_budget::attach(&cache_dir);
        let credentials_present = credentials_exist(&cache_dir);
        let initial = if credentials_present {
            LibrespotStatus {
                phase: LibrespotPhase::Disconnected,
                credentials_present: true,
                username: None,
                message: Some("Gespeicherte Sitzung vorhanden. Verbindung wird aufgebaut …".into()),
            }
        } else {
            LibrespotStatus::needs_login()
        };
        let (status_tx, _) = watch::channel(initial.clone());
        let (playback_tx, _) = watch::channel(empty_playback_state());
        Arc::new(Self {
            shared: Arc::new(Shared {
                cache_dir,
                status: RwLock::new(initial),
                playback: Arc::new(RwLock::new(PlaybackSnapshot::default())),
                playback_tx,
                session: Mutex::new(None),
                connect_lock: Mutex::new(()),
                load_gate: Mutex::new(()),
                native_lyrics_misses: Mutex::new(crate::lyrics::NativeLyricsMissCache::default()),
                playlist_cache: Arc::new(crate::playlist::PlaylistIndexCache::new()),
                queue_restored: AtomicBool::new(false),
                session_epoch: AtomicU64::new(0),
                session_recovery_attempts: AtomicU64::new(0),
                background_reconnect: AtomicBool::new(false),
                player_setup: Mutex::new(luft_audio::PlayerSetup::default()),
                dsp_control: DspControl::default(),
                visualizer_control: VisualizerControl::default(),
                experimental_canvas: AtomicBool::new(false),
                canvas_lookup: CanvasLookupTracker::default(),
            }),
            status_tx,
        })
    }

    #[must_use]
    pub fn subscribe_status(&self) -> watch::Receiver<LibrespotStatus> {
        self.status_tx.subscribe()
    }

    #[must_use]
    pub fn subscribe_playback(&self) -> watch::Receiver<PlaybackState> {
        self.shared.playback_tx.subscribe()
    }

    pub async fn queue_revision(&self) -> u64 {
        self.shared.playback.read().await.queue.revision
    }

    pub async fn status(&self) -> LibrespotStatus {
        self.shared.status.read().await.clone()
    }

    pub fn set_experimental_canvas(&self, enabled: bool) {
        let previous = self
            .shared
            .experimental_canvas
            .swap(enabled, Ordering::SeqCst);
        if !enabled {
            cancel_experimental_canvas(&self.shared);
            return;
        }
        if !previous {
            let this = self.clone();
            tokio::spawn(async move {
                this.refresh_experimental_canvas().await;
            });
        }
    }

    async fn refresh_experimental_canvas(&self) {
        let uri = self
            .shared
            .playback
            .read()
            .await
            .current_item
            .as_ref()
            .map(|item| item.uri.clone());
        let Some(uri) = uri else {
            return;
        };
        self.enrich_current_canvas(uri).await;
    }

    async fn enrich_current_canvas(&self, uri: String) {
        schedule_experimental_canvas(&self.shared, &uri);
    }

    pub fn set_dsp_settings(&self, settings: DspSettings) {
        let previous = self.shared.dsp_control.settings();
        if previous.enabled != settings.enabled
            || previous.preset_id != settings.preset_id
            || previous.volume_boost_enabled != settings.volume_boost_enabled
            || previous.volume_boost_db != settings.volume_boost_db
            || previous.spatial.enabled != settings.spatial.enabled
            || previous.spatial.preset_id != settings.spatial.preset_id
        {
            info!(
                adapter = "librespot",
                equalizer_enabled = settings.enabled,
                equalizer_preset = %settings.preset_id,
                space_enabled = settings.spatial.enabled,
                space_preset = %settings.spatial.preset_id,
                auto_headroom = settings.auto_headroom,
                limiter = settings.limiter_enabled,
                volume_boost_enabled = settings.volume_boost_enabled,
                volume_boost_db = settings.volume_boost_db,
                "libre dsp settings changed"
            );
        }
        self.shared.dsp_control.update(settings);
    }

    #[must_use]
    pub fn dsp_settings(&self) -> DspSettings {
        self.shared.dsp_control.settings()
    }

    #[must_use]
    pub fn visualizer_frame(&self) -> VisualizerFrame {
        self.shared.visualizer_control.frame()
    }

    /// Stores the setup for the next player start without restarting one.
    pub async fn set_player_setup(&self, setup: luft_audio::PlayerSetup) {
        *self.shared.player_setup.lock().await = sanitize_player_setup(setup);
    }

    pub async fn login_and_connect(self: &Arc<Self>) -> Result<LibrespotStatus, ProviderError> {
        let _guard = self.shared.connect_lock.lock().await;
        self.set_status(
            LibrespotPhase::Authenticating,
            credentials_exist(&self.shared.cache_dir),
            None,
            Some("Browser wird für die Spotify-Anmeldung geöffnet …"),
        )
        .await;
        let token = match request_access_token().await {
            Ok(token) => token,
            Err(error) => {
                warn!(error = %error, adapter = "librespot", "oauth login failed");
                let credentials_present = credentials_exist(&self.shared.cache_dir);
                let active_user = self
                    .shared
                    .session
                    .lock()
                    .await
                    .as_ref()
                    .filter(|active| !active.session.is_invalid())
                    .and_then(|active| nonempty_username(active.session.username()));
                self.set_status(
                    if active_user.is_some() {
                        LibrespotPhase::Ready
                    } else if credentials_present {
                        LibrespotPhase::Error
                    } else {
                        LibrespotPhase::NeedsLogin
                    },
                    credentials_present,
                    active_user,
                    Some(error.as_str()),
                )
                .await;
                return Err(ProviderError::ActionRejected {
                    message: error,
                    retryable: true,
                });
            }
        };
        let credentials = Credentials::with_access_token(token);
        self.connect_with_credentials(credentials).await
    }

    pub async fn connect_if_possible(self: &Arc<Self>) -> Result<LibrespotStatus, ProviderError> {
        let _guard = self.shared.connect_lock.lock().await;
        if self.shared.status.read().await.phase == LibrespotPhase::Ready
            && self.shared.session.lock().await.is_some()
        {
            return Ok(self.status().await);
        }
        let cache = open_cache(&self.shared.cache_dir)?;
        let Some(credentials) = cache.credentials() else {
            self.set_status(
                LibrespotPhase::NeedsLogin,
                false,
                None,
                Some("Melde dich einmal an. Danach spielt Librespot lokal."),
            )
            .await;
            return Err(ProviderError::ActionRejected {
                message: "Librespot ist nicht angemeldet.".into(),
                retryable: false,
            });
        };
        self.connect_with_credentials(credentials).await
    }

    pub async fn logout(&self) -> Result<LibrespotStatus, ProviderError> {
        let _guard = self.shared.connect_lock.lock().await;
        self.shutdown_session().await;
        if let Err(message) =
            crate::account_binding::clear_credentials(&self.shared.cache_dir).await
        {
            self.set_status(
                LibrespotPhase::Error,
                credentials_exist(&self.shared.cache_dir),
                None,
                Some(&message),
            )
            .await;
            return Err(ProviderError::ActionRejected {
                message,
                retryable: true,
            });
        }
        if let Err(error) = tokio::fs::remove_dir_all(&self.shared.cache_dir).await
            && error.kind() != std::io::ErrorKind::NotFound
        {
            warn!(error = %error, "librespot cache could not be cleared");
        }
        self.set_status(
            LibrespotPhase::NeedsLogin,
            false,
            None,
            Some("Die lokale Librespot-Sitzung wurde entfernt."),
        )
        .await;
        Ok(self.status().await)
    }

    pub async fn shutdown(&self) {
        let _guard = self.shared.connect_lock.lock().await;
        self.shutdown_session().await;
        self.mark_disconnected().await;
    }

    /// Clears what a failed takeover left behind. A failed connect keeps its
    /// error status, so a background reconnect after a temporary Spotify error
    /// goes on; a session that was already up counts as disconnected.
    pub async fn release_failed_connect(&self) {
        let _guard = self.shared.connect_lock.lock().await;
        self.shutdown_session().await;
        if self.shared.status.read().await.phase != LibrespotPhase::Error {
            self.mark_disconnected().await;
        }
    }

    async fn mark_disconnected(&self) {
        let credentials_present = credentials_exist(&self.shared.cache_dir);
        self.set_status(
            if credentials_present {
                LibrespotPhase::Disconnected
            } else {
                LibrespotPhase::NeedsLogin
            },
            credentials_present,
            None,
            Some("Librespot ist getrennt."),
        )
        .await;
    }

    /// Keep the previous engine's track visible while Librespot starts.
    /// `connect_if_possible` clears the snapshot, so this must run after connect.
    pub async fn adopt_playback(&self, state: &PlaybackState) {
        self.write_adopted_playback(state).await;
        notify_playback(&self.shared).await;
    }

    /// Restore the last session only if the user has not already started playback.
    pub async fn adopt_playback_if_idle(&self, state: &PlaybackState) -> bool {
        {
            let snapshot = self.shared.playback.read().await;
            if !startup_adopt_is_safe(
                snapshot.is_playing,
                snapshot.audio_started,
                snapshot.play_generation,
                snapshot.startup_play_generation,
            ) {
                info!(
                    adapter = "librespot",
                    phase = "queue-restore",
                    play_generation = snapshot.play_generation,
                    is_playing = snapshot.is_playing,
                    audio_started = snapshot.audio_started,
                    "startup adopt skipped, playback is already live"
                );
                return false;
            }
        }
        self.write_adopted_playback(state).await;
        notify_playback(&self.shared).await;
        true
    }

    async fn write_adopted_playback(&self, state: &PlaybackState) {
        let mut snapshot = self.shared.playback.write().await;
        if snapshot.play_generation != snapshot.startup_play_generation
            || snapshot.is_playing
            || snapshot.audio_started
        {
            return;
        }
        snapshot.current_item = state.current_item.clone();
        snapshot.context_uri = state.context_uri.clone();
        snapshot.position_ms = 0;
        snapshot.duration_ms = state.duration_ms;
        snapshot.volume = state.volume.clamp(0.0, 1.0);
        snapshot.is_muted = state.is_muted || state.volume == 0.0;
        if snapshot.volume > 0.0 {
            snapshot.last_unmuted_volume = snapshot.volume;
        }
        snapshot.shuffle_enabled = state.shuffle_enabled;
        snapshot.repeat_mode = state.repeat_mode;
        snapshot.is_saved = state.is_saved;
        snapshot.is_playing = false;
        snapshot.audio_started = false;
        snapshot.handoff_hold = true;
        snapshot.position_updated_at = Instant::now();
        snapshot.expected_track_uri = state.current_item.as_ref().map(|item| item.uri.clone());
        snapshot.expected_item = state.current_item.clone();
        snapshot.expected_started_at = snapshot.expected_track_uri.as_ref().map(|_| Instant::now());
        snapshot.current_player_reported_uri = None;
        snapshot.expected_player_request_id = None;
        snapshot.expected_player_baseline_request_id = None;
        snapshot.player_item_candidate = None;
        snapshot.pending_auto_advance = None;
        snapshot.pending_seek = None;
    }

    async fn release_handoff_hold(&self) {
        self.shared.playback.write().await.handoff_hold = false;
    }

    async fn connect_with_credentials(
        self: &Arc<Self>,
        credentials: Credentials,
    ) -> Result<LibrespotStatus, ProviderError> {
        self.shared
            .session_recovery_attempts
            .store(0, Ordering::SeqCst);
        self.shutdown_session().await;
        self.set_status(
            LibrespotPhase::Connecting,
            true,
            None,
            Some("Librespot verbindet sich …"),
        )
        .await;
        match self.start_session_patiently(credentials).await {
            Ok(username) => {
                self.set_status(
                    LibrespotPhase::Ready,
                    true,
                    username,
                    Some("Librespot ist bereit. Spotify Desktop bleibt unberührt."),
                )
                .await;
                Ok(self.status().await)
            }
            Err(error) => {
                warn!(error = %error, transient = error.transient, adapter = "librespot", "session start failed");
                let credentials_present = credentials_exist(&self.shared.cache_dir);
                self.set_status(
                    LibrespotPhase::Error,
                    credentials_present,
                    None,
                    Some(error.message.as_str()),
                )
                .await;
                if error.transient && credentials_present {
                    self.schedule_background_reconnect();
                }
                Err(ProviderError::ActionRejected {
                    message: error.message,
                    retryable: true,
                })
            }
        }
    }

    async fn start_session(
        self: &Arc<Self>,
        credentials: Credentials,
    ) -> Result<Option<String>, SessionStartError> {
        let previous_cache =
            open_cache(&self.shared.cache_dir).map_err(|error| error.to_string())?;
        if let Some(previous_user) = previous_cache
            .credentials()
            .and_then(|saved| saved.username)
        {
            crate::account_binding::bind(&self.shared.cache_dir, &previous_user).await?;
        }
        // Spirc writes credentials while connecting; only promote a verified identity.
        let pending_dir = self.shared.cache_dir.join("PendingLogin");
        let cache = Cache::new(
            Some(pending_dir.clone()),
            Some(self.shared.cache_dir.clone()),
            Some(self.shared.cache_dir.join("Audio")),
            Some(AUDIO_CACHE_LIMIT_BYTES),
        )
        .map_err(|_| "Der Login-Zwischenspeicher konnte nicht angelegt werden.")?;
        let mut session_config = SessionConfig::default();
        session_config.client_id = SPOTIFY_DESKTOP_CLIENT_ID.to_string();
        // Spirc::new connects the session itself. A prior connect consumes the
        // access token and misses dealer messages, so login then looks failed.
        let session = Session::new(session_config, Some(cache));
        let mixer_builder = mixer::find(None).ok_or_else(|| {
            "Kein Audio-Mixer gefunden. Softvol wird unter Windows erwartet.".to_string()
        })?;
        let mixer = mixer_builder(MixerConfig::default())
            .map_err(|error| format!("Audio-Mixer konnte nicht geöffnet werden: {error}"))?;
        let mixer = Arc::new(LocalVolume::new(mixer));
        let backend = audio_backend::find(None).ok_or_else(|| {
            "Kein Audio-Backend gefunden. Rodio/WASAPI wird unter Windows erwartet.".to_string()
        })?;
        let setup = self.shared.player_setup.lock().await.clone();
        let requested = setup.audio_device.clone();
        let initial_volume = {
            let snapshot = self.shared.playback.read().await;
            if snapshot.is_muted {
                0.0
            } else if snapshot.volume.is_finite() {
                snapshot.volume.clamp(0.0, 1.0)
            } else {
                0.5
            }
        };
        let dsp_control = self.shared.dsp_control.clone();
        let visualizer_control = self.shared.visualizer_control.clone();
        let player = Player::new(
            player_config(&setup),
            session.clone(),
            mixer.get_soft_volume(),
            move || {
                // Resolve on each sink opening so device availability is not frozen
                // for the lifetime of the Spotify session.
                let output_device =
                    crate::audio_output::resolve_output_device(requested.as_deref());
                if requested.is_some() && output_device.is_none() {
                    warn!(
                        adapter = "librespot",
                        requested = requested.as_deref().unwrap_or(""),
                        "audio device missing, falling back to Windows default"
                    );
                }
                info!(
                    adapter = "librespot",
                    device = output_device.as_deref().unwrap_or("windows-default"),
                    "opening rodio sink"
                );
                let output: Box<dyn librespot::playback::audio_backend::Sink> =
                    match crate::output_sink::DeviceSink::open(
                        output_device.as_deref(),
                        visualizer_control.clone(),
                    ) {
                        Ok(sink) => Box::new(sink),
                        Err(error) => {
                            warn!(
                                adapter = "librespot",
                                %error,
                                "float output unavailable, using librespot's rodio sink"
                            );
                            backend(output_device, AudioFormat::F32)
                        }
                    };
                crate::dsp_output::DspSink::boxed(
                    output,
                    dsp_control.clone(),
                    visualizer_control.clone(),
                )
            },
        );
        let connect_config = ConnectConfig {
            name: DEVICE_NAME.into(),
            initial_volume: volume_to_connect(initial_volume),
            ..ConnectConfig::default()
        };
        let connection = tokio::time::timeout(
            CONNECT_TIMEOUT,
            Spirc::new(
                connect_config,
                session.clone(),
                credentials,
                player.clone(),
                mixer.clone(),
            ),
        )
        .await;
        let (spirc, spirc_task) = match connection {
            Ok(Ok(connected)) => connected,
            failed => {
                session.shutdown();
                let _ = tokio::fs::remove_file(pending_dir.join("credentials.json")).await;
                return Err(match failed {
                    Err(_) => SessionStartError::transient("Spotify Connect hat nicht rechtzeitig geantwortet. Bitte die Anmeldung erneut versuchen."),
                    Ok(Err(error)) => SessionStartError::from_connect(&error),
                    Ok(Ok(_)) => unreachable!(),
                });
            }
        };
        let event_channel = player.get_player_event_channel();
        let username = nonempty_username(session.username());
        if let Err(error) =
            crate::account_binding::bind(&self.shared.cache_dir, username.as_deref().unwrap_or(""))
                .await
        {
            let _ = spirc.shutdown();
            session.shutdown();
            let _ = tokio::fs::remove_file(pending_dir.join("credentials.json")).await;
            return Err(error.into());
        }
        if tokio::fs::rename(
            pending_dir.join("credentials.json"),
            self.shared.cache_dir.join("credentials.json"),
        )
        .await
        .is_err()
        {
            let _ = spirc.shutdown();
            session.shutdown();
            return Err("Die bestätigte Anmeldung konnte nicht gespeichert werden.".into());
        }
        let session_epoch = self.shared.session_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        *self.shared.session.lock().await = Some(ActiveSession {
            session: session.clone(),
            spirc,
            player,
            local_volume: Arc::clone(&mixer),
            volume_sync: spawn_volume_sync(Arc::clone(&self.shared), mixer, session_epoch),
        });
        {
            let mut snapshot = self.shared.playback.write().await;
            snapshot.current_player_request_id = None;
            snapshot.current_player_reported_uri = None;
            snapshot.expected_player_request_id = None;
            snapshot.expected_player_baseline_request_id = None;
            snapshot.sent_player_loads.clear();
            snapshot.player_item_candidate = None;
            snapshot.pending_auto_advance = None;
        }
        spawn_player_events(
            Arc::clone(&self.shared),
            event_channel,
            session,
            session_epoch,
        );
        spawn_spirc_supervisor(Arc::clone(self), spirc_task, session_epoch);
        info!(adapter = "librespot", "librespot session ready");
        Ok(username)
    }

    async fn shutdown_session(&self) {
        self.shutdown_session_keep_playback().await;
        let mut snapshot = self.shared.playback.write().await;
        *snapshot = reset_playback(&snapshot);
        self.shared.queue_restored.store(false, Ordering::SeqCst);
    }

    async fn shutdown_session_keep_playback(&self) {
        self.shared.session_epoch.fetch_add(1, Ordering::SeqCst);
        {
            let mut snapshot = self.shared.playback.write().await;
            // Keep both counters monotone across session restarts. Besides
            // invalidating in-flight loads, this prevents an old async context
            // resolver from matching a freshly reset `intent = 1` (ABA).
            snapshot.play_generation = snapshot.play_generation.saturating_add(1);
            snapshot.load_intent_epoch = snapshot.load_intent_epoch.saturating_add(1);
            snapshot.pending_session_recovery = None;
            clear_expected_track(&mut snapshot);
            snapshot.current_player_request_id = None;
            snapshot.current_player_reported_uri = None;
            snapshot.expected_player_request_id = None;
            snapshot.expected_player_baseline_request_id = None;
            snapshot.sent_player_loads.clear();
            snapshot.player_item_candidate = None;
            snapshot.pending_auto_advance = None;
        }
        let active = self.shared.session.lock().await.take();
        if let Some(active) = active {
            let _ = active.spirc.shutdown();
            active.session.shutdown();
        }
    }

    async fn set_status(
        &self,
        phase: LibrespotPhase,
        credentials_present: bool,
        username: Option<String>,
        message: Option<&str>,
    ) {
        let status = LibrespotStatus {
            phase,
            credentials_present,
            username,
            message: message.map(str::to_string),
        };
        *self.shared.status.write().await = status.clone();
        self.status_tx.send_replace(status);
    }

    async fn with_spirc<T>(
        &self,
        action: impl FnOnce(&Spirc) -> Result<T, librespot::core::error::Error>,
    ) -> Result<T, ProviderError> {
        let session = self.shared.session.lock().await;
        let active = session.as_ref().ok_or_else(not_ready)?;
        action(&active.spirc).map_err(|error| ProviderError::ActionRejected {
            message: format!("Librespot hat die Aktion abgelehnt: {error}"),
            retryable: true,
        })
    }
}

#[async_trait]
impl QueueProvider for LibrespotService {
    async fn get_queue(&self) -> Result<QueueState, ProviderError> {
        self.ensure_ready().await?;
        let snapshot = self.shared.playback.read().await;
        let cursor = effective_cursor_uri(&snapshot);
        Ok(QueueState {
            current_item: snapshot.current_item.clone(),
            items: snapshot.queue.visible_excluding(cursor.as_deref()),
            revision: snapshot.queue.revision,
            total_items: None,
        })
    }

    async fn add_to_queue(&self, uri: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let uri = uri.trim();
        if !is_playable_item_uri(uri) {
            return Err(invalid_playable_uri(uri));
        }
        let item = self.resolve_queue_item(uri).await;
        {
            let mut snapshot = self.shared.playback.write().await;
            snapshot.queue.push_explicit(item);
        }
        // The desktop forwards this update as queue://changed. Without it,
        // queue additions from track lists remain invisible until polling runs.
        notify_playback(&self.shared).await;
        Ok(())
    }

    async fn remove_from_queue(&self, uri: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        self.shared.playback.write().await.queue.remove_uri(uri);
        Ok(())
    }

    async fn clear_queue(&self) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        self.shared.playback.write().await.queue.clear_explicit();
        Ok(())
    }

    async fn reorder_queue(
        &self,
        request: QueueReorderRequest,
    ) -> Result<QueueState, ProviderError> {
        self.ensure_ready().await?;
        let mut snapshot = self.shared.playback.write().await;
        if snapshot.queue.revision != request.expected_revision {
            return Err(ProviderError::ActionRejected {
                message: "Die Queue hat sich geändert. Bitte erneut anordnen.".into(),
                retryable: true,
            });
        }
        snapshot
            .queue
            .apply_visible_reorder(&request)
            .map_err(ProviderError::InvalidRequest)?;
        let cursor = effective_cursor_uri(&snapshot);
        Ok(QueueState {
            current_item: snapshot.current_item.clone(),
            items: snapshot.queue.visible_excluding(cursor.as_deref()),
            revision: snapshot.queue.revision,
            total_items: None,
        })
    }
}

impl LibrespotService {
    async fn session_clone(&self) -> Result<Session, ProviderError> {
        self.shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone())
            .ok_or_else(not_ready)
    }

    async fn ensure_ready(&self) -> Result<(), ProviderError> {
        if self.shared.status.read().await.phase != LibrespotPhase::Ready {
            return Err(not_ready());
        }
        Ok(())
    }

    async fn wait_until_ready(&self, timeout: Duration) -> Result<(), ProviderError> {
        if self.shared.status.read().await.phase == LibrespotPhase::Ready {
            return Ok(());
        }
        let mut status = self.status_tx.subscribe();
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if self.shared.status.read().await.phase == LibrespotPhase::Ready {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            tokio::select! {
                changed = status.changed() => {
                    if changed.is_err() {
                        break;
                    }
                }
                _ = tokio::time::sleep(remaining) => break,
            }
        }
        self.ensure_ready().await
    }

    async fn finish_prepared_load(&self, prepared: PreparedTrackLoad) -> Result<(), ProviderError> {
        let started = Instant::now();
        let PreparedTrackLoad {
            item,
            context_uri,
            generation,
            rollback,
            ..
        } = prepared;
        notify_playback(&self.shared).await;
        let settle_delay = {
            let snapshot = self.shared.playback.read().await;
            transport_settle_delay(&snapshot)
        };
        if !settle_delay.is_zero() {
            tokio::time::sleep(settle_delay).await;
        }
        let settle_ms = started.elapsed().as_millis();
        let claimed = {
            let mut snapshot = self.shared.playback.write().await;
            let claimed = claim_transport_load(&mut snapshot, generation, &item.uri);
            if !claimed {
                log_transition(
                    &snapshot,
                    "transport-load",
                    "coalesced-superseded",
                    Some(&item.uri),
                    None,
                );
            }
            claimed
        };
        if !claimed {
            info!(
                adapter = "librespot",
                phase = "skip-load",
                track_uri = uri_tail(&item.uri),
                generation,
                settle_ms,
                elapsed_ms = started.elapsed().as_millis(),
                "libre skip coalesced"
            );
            return Ok(());
        }
        let load_started = Instant::now();
        if self
            .load_tracks(vec![item.uri.clone()], None, generation, Some(rollback))
            .await?
        {
            // Queue metadata is a moving window. Every committed transport
            // step must refill it so long shuffled playlists do not degrade
            // into hidden placeholders after the initial batch was consumed.
            spawn_queue_hydrate(Arc::clone(&self.shared));
            schedule_experimental_canvas(&self.shared, &item.uri);
            let this = self.clone();
            let uri = item.uri.clone();
            tokio::spawn(async move {
                this.publish_loaded_item(&uri, context_uri, Some(generation))
                    .await;
            });
            info!(
                adapter = "librespot",
                phase = "skip-load",
                track_uri = uri_tail(&item.uri),
                generation,
                settle_ms,
                load_ms = load_started.elapsed().as_millis(),
                elapsed_ms = started.elapsed().as_millis(),
                "libre skip load sent"
            );
        }
        Ok(())
    }

    async fn wait_for_playable_current(&self, limit: Duration) -> Option<String> {
        let deadline = Instant::now() + limit;
        loop {
            let uri = self
                .shared
                .playback
                .read()
                .await
                .current_item
                .as_ref()
                .and_then(|item| is_playable_item_uri(&item.uri).then(|| item.uri.clone()));
            if uri.is_some() {
                return uri;
            }
            if Instant::now() >= deadline {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }

    async fn load_tracks(
        &self,
        tracks: Vec<String>,
        playing_track: Option<&str>,
        generation: u64,
        rollback: Option<PlaybackRollback>,
    ) -> Result<bool, ProviderError> {
        let target = playing_track
            .map(str::trim)
            .filter(|uri| !uri.is_empty())
            .map(str::to_string)
            .or_else(|| tracks.first().map(|uri| uri.trim().to_string()))
            .ok_or_else(|| invalid_playable_uri(""))?;
        if !is_playable_item_uri(&target) {
            return Err(invalid_playable_uri(&target));
        }
        self.release_handoff_hold().await;
        info!(
            adapter = "librespot",
            phase = "play",
            track_uri = uri_tail(&target),
            "loading single local-queue track"
        );
        let loaded = match send_expected_track_load(&self.shared, &target, generation).await {
            Ok(loaded) => loaded,
            Err(error) => {
                fail_expected_load(&self.shared, generation, &target, rollback.as_ref()).await;
                notify_playback(&self.shared).await;
                return Err(error);
            }
        };
        Ok(loaded)
    }

    async fn resolve_queue_item(&self, uri: &str) -> MediaItem {
        let session = self
            .shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone());
        let Some(session) = session else {
            return loading_item(uri);
        };
        tokio::time::timeout(METADATA_TIMEOUT, load_metadata(&session, uri))
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| loading_item(uri))
    }

    async fn publish_loaded_item(
        &self,
        uri: &str,
        context_uri: Option<String>,
        expected_generation: Option<u64>,
    ) {
        {
            let mut snapshot = self.shared.playback.write().await;
            if apply_publish_loading_item(&mut snapshot, uri, context_uri, expected_generation)
                .is_none()
            {
                return;
            }
        }
        let session = self
            .shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone());
        let Some(session) = session else {
            return;
        };
        let Ok(Some(item)) =
            tokio::time::timeout(METADATA_TIMEOUT, load_metadata(&session, uri)).await
        else {
            return;
        };
        let mut snapshot = self.shared.playback.write().await;
        let Some(disposition) = publish_disposition(&snapshot, uri, expected_generation) else {
            return;
        };
        let refresh_saved = match disposition {
            PublishDisposition::Pending => {
                snapshot.queue.remember_item(&item);
                snapshot.expected_item =
                    Some(merge_media_items(snapshot.expected_item.as_ref(), item));
                false
            }
            PublishDisposition::Confirmed => {
                snapshot.current_item =
                    Some(merge_media_items(snapshot.current_item.as_ref(), item));
                if let Some(duration_ms) = snapshot
                    .current_item
                    .as_ref()
                    .and_then(|current| current.duration_ms)
                {
                    snapshot.duration_ms = duration_ms;
                }
                true
            }
        };
        drop(snapshot);
        notify_playback(&self.shared).await;
        if refresh_saved {
            refresh_saved_state(&self.shared, uri, None).await;
        }
        schedule_experimental_canvas(&self.shared, uri);
    }
}

#[must_use]
/// A fresh playback state for a new session. Volume and mute are the
/// listener's setting, not playback: a reconnect (for example after Spotify
/// dropped an idle session) used to start the new session at 50 %.
fn reset_playback(previous: &PlaybackSnapshot) -> PlaybackSnapshot {
    let play_generation = previous.play_generation.saturating_add(1);
    PlaybackSnapshot {
        play_generation,
        startup_play_generation: play_generation,
        load_intent_epoch: previous.load_intent_epoch.saturating_add(1),
        volume: previous.volume,
        is_muted: previous.is_muted,
        last_unmuted_volume: previous.last_unmuted_volume,
        ..PlaybackSnapshot::default()
    }
}

pub fn volume_to_connect(volume: f64) -> u16 {
    (volume.clamp(0.0, 1.0) * f64::from(u16::MAX)).round() as u16
}

fn connect_volume_to_unit(volume: u16) -> f64 {
    f64::from(volume) / f64::from(u16::MAX)
}

fn credentials_exist(cache_dir: &Path) -> bool {
    open_cache(cache_dir)
        .ok()
        .and_then(|cache| cache.credentials())
        .is_some()
}

fn open_cache(cache_dir: &Path) -> Result<Cache, ProviderError> {
    std::fs::create_dir_all(cache_dir).map_err(|error| {
        ProviderError::Internal(format!(
            "Librespot-Cache konnte nicht angelegt werden: {error}"
        ))
    })?;
    Cache::new(
        Some(cache_dir.to_path_buf()),
        Some(cache_dir.to_path_buf()),
        Some(cache_dir.join("Audio")),
        Some(AUDIO_CACHE_LIMIT_BYTES),
    )
    .map_err(|error| ProviderError::Internal(format!("Librespot-Cache ist ungültig: {error}")))
}

async fn request_access_token() -> Result<String, String> {
    crate::oauth::request(SPOTIFY_DESKTOP_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPES).await
}
