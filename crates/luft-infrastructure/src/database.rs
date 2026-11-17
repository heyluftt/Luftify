use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::Utc;
use luft_audio::{DspSettings, LoudnessNormalization, PlayerSetup, StreamingQuality};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sqlx::{SqlitePool, sqlite::SqliteConnectOptions};
use thiserror::Error;
use tokio::sync::OnceCell;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("database operation failed: {0}")]
    Sql(#[from] sqlx::Error),
    #[error("database directory could not be prepared: {0}")]
    Io(#[from] std::io::Error),
    #[error("database migration failed: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("invalid listening analytics data: {0}")]
    InvalidAnalytics(&'static str),
}

#[derive(Debug, Clone)]
pub struct Database {
    pool: SqlitePool,
}

#[derive(Debug, Clone)]
pub struct DatabaseHandle {
    path: PathBuf,
    database: Arc<OnceCell<Database>>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CacheStorageUsage {
    pub bytes: u64,
    pub entries: u64,
}

impl CacheStorageUsage {
    #[must_use]
    pub fn saturating_add(self, other: Self) -> Self {
        Self {
            bytes: self.bytes.saturating_add(other.bytes),
            entries: self.entries.saturating_add(other.entries),
        }
    }
}

impl DatabaseHandle {
    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            database: Arc::new(OnceCell::new()),
        }
    }

    pub async fn get(&self) -> Result<&Database, DatabaseError> {
        self.database
            .get_or_try_init(|| Database::open(&self.path))
            .await
    }

    pub async fn initialize(&self) -> Result<(), DatabaseError> {
        self.get().await.map(|_| ())
    }

    pub async fn close(&self) {
        if let Some(database) = self.database.get() {
            database.pool.close().await;
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReconnectResumeMode {
    Never,
    #[default]
    IfWasPlaying,
    Always,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CloseBehavior {
    Exit,
    #[default]
    MinimizeToTray,
    Ask,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HomeFeatureMode {
    #[default]
    LastPlayed,
    MostPlayed,
    Personalized,
    Fixed,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VolumeCurve {
    #[default]
    Linear,
    Perceptual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AudioControlSettings {
    pub enabled: bool,
    pub presets: Vec<u8>,
    pub step_percent: u8,
    pub wheel_enabled: bool,
    pub restore_on_start: bool,
    pub remember_before_mute: bool,
    pub show_percentage: bool,
    pub curve: VolumeCurve,
    pub shortcuts_enabled: bool,
    pub volume_up_shortcut: String,
    pub volume_down_shortcut: String,
    pub mute_shortcut: String,
    pub dsp: DspSettings,
}

impl Default for AudioControlSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            presets: vec![20, 40, 60, 80, 100],
            step_percent: 5,
            wheel_enabled: true,
            restore_on_start: true,
            remember_before_mute: true,
            show_percentage: true,
            curve: VolumeCurve::Linear,
            shortcuts_enabled: true,
            volume_up_shortcut: "Ctrl+ArrowUp".into(),
            volume_down_shortcut: "Ctrl+ArrowDown".into(),
            mute_shortcut: "Ctrl+M".into(),
            dsp: DspSettings::default(),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LyricsVisualMode {
    #[default]
    Pulse,
    Waves,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct LyricsVisualSettings {
    pub enabled: bool,
    pub mode: LyricsVisualMode,
    pub spread_percent: u8,
    pub color_strength_percent: u8,
    pub visualizer_enabled: bool,
    pub visualizer_sensitivity_percent: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct MiniPlayerSettings {
    pub scale: f64,
    pub opacity_percent: u8,
    pub always_on_top: bool,
    pub click_through: bool,
    pub position_x: Option<i32>,
    pub position_y: Option<i32>,
}

impl Default for MiniPlayerSettings {
    fn default() -> Self {
        Self {
            scale: 1.0,
            opacity_percent: 94,
            always_on_top: true,
            click_through: false,
            position_x: None,
            position_y: None,
        }
    }
}

impl Default for LyricsVisualSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: LyricsVisualMode::Pulse,
            spread_percent: 48,
            color_strength_percent: 42,
            visualizer_enabled: false,
            visualizer_sensitivity_percent: 62,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistUsage {
    pub playlist_uri: String,
    pub play_count: u64,
    pub last_played_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct Settings {
    pub theme: String,
    pub reconnect_resume_mode: ReconnectResumeMode,
    pub close_behavior: CloseBehavior,
    pub windows_autostart: bool,
    pub start_in_tray_on_autostart: bool,
    pub last_route: String,
    pub search_history_enabled: bool,
    pub now_playing_list_navigation_enabled: bool,
    pub home_feature_mode: HomeFeatureMode,
    pub home_feature_playlist_uri: Option<String>,
    pub lyrics_enabled: bool,
    pub song_videos_enabled: bool,
    pub experimental_libre_canvas: bool,
    pub listening_analytics_enabled: bool,
    pub lyrics_visuals: LyricsVisualSettings,
    pub audio_control: AudioControlSettings,
    pub miniplayer: MiniPlayerSettings,
    pub librespot_audio_device: Option<String>,
    pub librespot_streaming_quality: StreamingQuality,
    pub librespot_loudness: LoudnessNormalization,
    #[serde(default)]
    pub listen_together: ListenTogetherSettings,
    #[serde(default)]
    pub notifications: NotificationSettings,
}

/// Which in-app notices show; all of them unless switched off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct NotificationSettings {
    pub messages: bool,
    pub friends: bool,
    pub invites: bool,
    pub rooms: bool,
    pub listen_along: bool,
    pub achievements: bool,
    pub reports: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self { messages: true, friends: true, invites: true, rooms: true, listen_along: true, achievements: true, reports: true }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenTogetherSettings {
    pub server_url: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub avatar_uri: Option<String>,
}

impl Default for ListenTogetherSettings {
    fn default() -> Self {
        Self {
            server_url: luft_listen_together::DEFAULT_SYNC_URL.into(),
            display_name: String::new(),
            avatar_uri: None,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            reconnect_resume_mode: ReconnectResumeMode::IfWasPlaying,
            close_behavior: CloseBehavior::MinimizeToTray,
            windows_autostart: false,
            start_in_tray_on_autostart: false,
            last_route: "/".into(),
            search_history_enabled: true,
            now_playing_list_navigation_enabled: true,
            home_feature_mode: HomeFeatureMode::LastPlayed,
            home_feature_playlist_uri: None,
            lyrics_enabled: true,
            song_videos_enabled: false,
            experimental_libre_canvas: false,
            listening_analytics_enabled: true,
            lyrics_visuals: LyricsVisualSettings::default(),
            audio_control: AudioControlSettings::default(),
            miniplayer: MiniPlayerSettings::default(),
            librespot_audio_device: None,
            librespot_streaming_quality: StreamingQuality::default(),
            librespot_loudness: LoudnessNormalization::default(),
            listen_together: ListenTogetherSettings::default(),
            notifications: NotificationSettings::default(),
        }
    }
}

impl Settings {
    /// What Libre fixes when it opens its player.
    #[must_use]
    pub fn librespot_player_setup(&self) -> PlayerSetup {
        PlayerSetup {
            audio_device: self.librespot_audio_device.clone(),
            streaming_quality: self.librespot_streaming_quality,
            loudness: self.librespot_loudness,
        }
    }
}

fn is_local_sync_url(url: &str) -> bool {
    let rest = url.trim().trim_start_matches("ws://").trim_start_matches("wss://");
    ["localhost", "127.0.0.1", "[::1]"].iter().any(|host| rest == *host || rest.starts_with(&format!("{host}:")) || rest.starts_with(&format!("{host}/")))
}

/// Migrations only ever add, so a database that a newer Luftify already
/// migrated (a local dev build, or a later version) must stay usable by an
/// older build: unknown applied migrations are skipped instead of failing
/// the start, which would leave settings and library unloaded.
async fn migrate(pool: &SqlitePool) -> Result<(), DatabaseError> {
    let mut migrator = sqlx::migrate!("./migrations");
    migrator.set_ignore_missing(true);
    migrator.run(pool).await?;
    Ok(())
}

impl Database {
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn open(path: &Path) -> Result<Self, DatabaseError> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePool::connect_with(options).await?;
        migrate(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn open_memory() -> Result<Self, DatabaseError> {
        let pool = SqlitePool::connect("sqlite::memory:").await?;
        migrate(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn settings(&self) -> Result<Settings, DatabaseError> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = 'app'")
            .fetch_optional(&self.pool)
            .await?;
        let mut settings = match row {
            Some((value,)) => serde_json::from_str::<Settings>(&value).unwrap_or_default(),
            None => Settings::default(),
        };
        let dsp = &mut settings.audio_control.dsp;
        *dsp = std::mem::take(dsp).with_current_presets();
        // The Luftify server is the only one; an own address from older
        // versions goes back to it. A local server stays for development.
        let url = settings.listen_together.server_url.as_str();
        if url == luft_listen_together::LEGACY_SYNC_URL || !is_local_sync_url(url) {
            settings.listen_together.server_url = luft_listen_together::DEFAULT_SYNC_URL.into();
        }
        Ok(settings)
    }

    pub async fn save_settings(&self, settings: &Settings) -> Result<(), DatabaseError> {
        let value = serde_json::to_string(settings)
            .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
        sqlx::query("INSERT INTO settings(key, value, updated_at) VALUES('app', ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
            .bind(value).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn record_playlist_play(
        &self,
        playlist_uri: &str,
        track_uri: &str,
    ) -> Result<(), DatabaseError> {
        if !playlist_uri.starts_with("spotify:playlist:")
            || playlist_uri.chars().count() > 512
            || track_uri.is_empty()
            || track_uri.chars().count() > 512
        {
            return Ok(());
        }
        let now = Utc::now().timestamp();
        sqlx::query(
            "INSERT INTO playlist_usage(playlist_uri, play_count, last_played_at, last_track_uri) VALUES(?, 1, ?, ?) ON CONFLICT(playlist_uri) DO UPDATE SET play_count = playlist_usage.play_count + CASE WHEN playlist_usage.last_track_uri <> excluded.last_track_uri OR playlist_usage.last_played_at < excluded.last_played_at - 1800 THEN 1 ELSE 0 END, last_played_at = excluded.last_played_at, last_track_uri = excluded.last_track_uri",
        )
        .bind(playlist_uri)
        .bind(now)
        .bind(track_uri)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn playlist_usage(&self, limit: u32) -> Result<Vec<PlaylistUsage>, DatabaseError> {
        let rows: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT playlist_uri, play_count, last_played_at FROM playlist_usage ORDER BY last_played_at DESC, play_count DESC LIMIT ?",
        )
        .bind(i64::from(limit.clamp(1, 100)))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(playlist_uri, play_count, last_played_at)| PlaylistUsage {
                playlist_uri,
                play_count: u64::try_from(play_count).unwrap_or_default(),
                last_played_at,
            })
            .collect())
    }

    pub async fn clear_playlist_usage(&self) -> Result<(), DatabaseError> {
        sqlx::query("DELETE FROM playlist_usage")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn cached<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, DatabaseError> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT payload FROM cache_entries WHERE cache_key = ? AND expires_at > unixepoch()",
        )
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|(payload,)| {
            serde_json::from_str(&payload)
                .map_err(|error| DatabaseError::Sql(sqlx::Error::Decode(Box::new(error))))
        })
        .transpose()
    }

    /// The newest valid entries whose key starts with `prefix`; unreadable ones are skipped.
    pub async fn cached_by_prefix<T: DeserializeOwned>(&self, prefix: &str, limit: i64) -> Result<Vec<T>, DatabaseError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT payload FROM cache_entries WHERE substr(cache_key, 1, length(?)) = ? AND expires_at > unixepoch() ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(prefix)
        .bind(prefix)
        .bind(limit.max(1))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().filter_map(|(payload,)| serde_json::from_str(&payload).ok()).collect())
    }

    pub async fn cache<T: Serialize>(
        &self,
        key: &str,
        source: &str,
        value: &T,
        ttl_seconds: i64,
    ) -> Result<(), DatabaseError> {
        let payload = serde_json::to_string(value)
            .map_err(|error| DatabaseError::Sql(sqlx::Error::Encode(Box::new(error))))?;
        let now = Utc::now().timestamp();
        let expires_at = now.saturating_add(ttl_seconds.max(1));
        sqlx::query(
            "INSERT INTO cache_entries(cache_key, source, schema_version, created_at, updated_at, expires_at, payload) VALUES(?, ?, 1, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET source = excluded.source, schema_version = excluded.schema_version, updated_at = excluded.updated_at, expires_at = excluded.expires_at, payload = excluded.payload",
        )
        .bind(key)
        .bind(source)
        .bind(now)
        .bind(now)
        .bind(expires_at)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn cache_persistent<T: Serialize>(
        &self,
        key: &str,
        source: &str,
        value: &T,
    ) -> Result<(), DatabaseError> {
        self.cache(key, source, value, i64::MAX).await
    }

    pub async fn clear_cache_prefix(&self, prefix: &str) -> Result<u64, DatabaseError> {
        let result =
            sqlx::query("DELETE FROM cache_entries WHERE substr(cache_key, 1, length(?)) = ?")
                .bind(prefix)
                .bind(prefix)
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected())
    }

    pub async fn cache_storage_usage(
        &self,
        prefixes: &[&str],
    ) -> Result<CacheStorageUsage, DatabaseError> {
        let mut usage = CacheStorageUsage::default();
        for prefix in prefixes {
            let (entries, bytes): (i64, i64) = sqlx::query_as(
                "SELECT COUNT(*), COALESCE(SUM(length(CAST(cache_key AS BLOB)) + length(CAST(source AS BLOB)) + length(CAST(payload AS BLOB))), 0) FROM cache_entries WHERE substr(cache_key, 1, length(?)) = ?",
            )
            .bind(prefix)
            .bind(prefix)
            .fetch_one(&self.pool)
            .await?;
            usage = usage.saturating_add(CacheStorageUsage {
                bytes: u64::try_from(bytes).unwrap_or_default(),
                entries: u64::try_from(entries).unwrap_or_default(),
            });
        }
        Ok(usage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_and_settings_round_trip() {
        let database = Database::open_memory().await.expect("database");
        let settings = Settings {
            theme: "light".into(),
            ..Settings::default()
        };
        database.save_settings(&settings).await.expect("save");
        assert_eq!(database.settings().await.expect("load").theme, "light");
    }

    #[tokio::test]
    async fn restore_volume_turns_on_once_for_existing_settings() {
        let database = Database::open_memory().await.expect("database");
        let mut settings = Settings::default();
        settings.audio_control.restore_on_start = false;
        database.save_settings(&settings).await.expect("save");
        // What migration 0006 does to settings saved by an older version.
        sqlx::raw_sql(include_str!("../migrations/0006_restore_volume_on_start.sql"))
            .execute(database.pool())
            .await
            .expect("migration");
        let loaded = database.settings().await.expect("load");
        assert!(loaded.audio_control.restore_on_start);
        assert_eq!(loaded.audio_control.step_percent, settings.audio_control.step_percent);
        assert!(Settings::default().audio_control.restore_on_start);
    }

    #[tokio::test]
    async fn bernstein_users_move_to_dark() {
        let database = Database::open_memory().await.expect("database");
        for (theme, expected) in [("bernstein", "dark"), ("luft.bernstein", "dark"), ("polaris", "polaris")] {
            database.save_settings(&Settings { theme: theme.into(), ..Settings::default() }).await.expect("save");
            sqlx::raw_sql(include_str!("../migrations/0007_bernstein_removed.sql"))
                .execute(database.pool())
                .await
                .expect("migration");
            assert_eq!(database.settings().await.expect("load").theme, expected);
        }
    }

    #[tokio::test]
    async fn opens_a_database_migrated_by_a_newer_version() {
        let database = Database::open_memory().await.expect("database");
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (9999, 'from a newer build', 1, x'00', 0)")
            .execute(database.pool())
            .await
            .expect("newer migration");
        migrate(database.pool()).await.expect("older build still starts");
        database.settings().await.expect("settings load");
    }

    #[tokio::test]
    async fn cache_round_trip_returns_valid_payload() {
        let database = Database::open_memory().await.expect("database");
        database
            .cache("library", "mock", &vec!["playlist"], 60)
            .await
            .expect("cache");
        let value: Option<Vec<String>> = database.cached("library").await.expect("read");
        assert_eq!(value, Some(vec!["playlist".into()]));
    }

    #[tokio::test]
    async fn expired_cache_entries_are_not_returned() {
        let database = Database::open_memory().await.expect("database");
        database
            .cache("expired", "mock", &vec!["stale"], 60)
            .await
            .expect("cache");
        sqlx::query("UPDATE cache_entries SET expires_at = unixepoch() - 1 WHERE cache_key = ?")
            .bind("expired")
            .execute(database.pool())
            .await
            .expect("expire fixture");

        let value: Option<Vec<String>> = database.cached("expired").await.expect("read");
        assert_eq!(value, None);
    }

    #[tokio::test]
    async fn cache_prefix_clear_only_removes_the_selected_cache() {
        let database = Database::open_memory().await.expect("database");
        database
            .cache_persistent("lyrics.first.v1", "test", &"lyrics")
            .await
            .expect("lyrics cache");
        database
            .cache_persistent("spotify.playlist.first.v1", "test", &"playlist")
            .await
            .expect("playlist cache");

        assert_eq!(
            database.clear_cache_prefix("lyrics.").await.expect("clear"),
            1
        );
        assert_eq!(
            database
                .cached::<String>("lyrics.first.v1")
                .await
                .expect("read"),
            None
        );
        assert_eq!(
            database
                .cached::<String>("spotify.playlist.first.v1")
                .await
                .expect("read"),
            Some("playlist".into())
        );
    }

    #[tokio::test]
    async fn cache_storage_usage_counts_only_matching_persisted_rows() {
        let database = Database::open_memory().await.expect("database");
        database
            .cache_persistent("lyrics.first.v1", "test", &"first lyrics")
            .await
            .expect("lyrics cache");
        database
            .cache_persistent("lyrics.second.v1", "test", &"second lyrics")
            .await
            .expect("lyrics cache");
        database
            .cache_persistent("spotify.playlist-v2.one", "test", &"playlist")
            .await
            .expect("playlist cache");

        let lyrics = database
            .cache_storage_usage(&["lyrics."])
            .await
            .expect("lyrics usage");
        let all = database
            .cache_storage_usage(&[""])
            .await
            .expect("total usage");

        assert_eq!(lyrics.entries, 2);
        assert!(lyrics.bytes > 0);
        assert_eq!(all.entries, 3);
        assert!(all.bytes > lyrics.bytes);
    }

    #[tokio::test]
    async fn playlist_usage_tracks_recency_and_distinct_tracks_locally() {
        let database = Database::open_memory().await.expect("database");
        database
            .record_playlist_play("spotify:playlist:luft", "spotify:track:one")
            .await
            .expect("first play");
        database
            .record_playlist_play("spotify:playlist:luft", "spotify:track:one")
            .await
            .expect("duplicate state event");
        database
            .record_playlist_play("spotify:playlist:luft", "spotify:track:two")
            .await
            .expect("next track");
        database
            .record_playlist_play("spotify:album:not-a-playlist", "spotify:track:three")
            .await
            .expect("ignored album");

        let usage = database.playlist_usage(10).await.expect("usage");
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].playlist_uri, "spotify:playlist:luft");
        assert_eq!(usage[0].play_count, 2);
        database.clear_playlist_usage().await.expect("clear");
        assert!(database.playlist_usage(10).await.expect("empty").is_empty());
    }

    #[tokio::test]
    async fn own_sync_servers_go_back_to_luftify_but_local_ones_stay() {
        let database = Database::open_memory().await.expect("database");
        for (saved, expected) in [
            ("wss://my-own.example.com", luft_listen_together::DEFAULT_SYNC_URL),
            (luft_listen_together::LEGACY_SYNC_URL, luft_listen_together::DEFAULT_SYNC_URL),
            ("ws://localhost:7421", "ws://localhost:7421"),
            ("ws://127.0.0.1:7500", "ws://127.0.0.1:7500"),
        ] {
            let mut settings = Settings::default();
            settings.listen_together.server_url = saved.into();
            database.save_settings(&settings).await.expect("save");
            assert_eq!(database.settings().await.expect("load").listen_together.server_url, expected);
        }
    }

    #[test]
    fn notification_switches_default_on_and_keep_what_is_saved() {
        let old: Settings = serde_json::from_str(r#"{"theme":"dark"}"#).expect("old settings");
        assert_eq!(old.notifications, NotificationSettings::default());
        assert!(old.notifications.invites && old.notifications.reports);
        let partial: Settings = serde_json::from_str(r#"{"notifications":{"achievements":false}}"#).expect("partial");
        assert!(!partial.notifications.achievements);
        assert!(partial.notifications.friends);
    }

    #[test]
    fn lifecycle_defaults_are_safe() {
        let settings = Settings::default();
        assert_eq!(settings.theme, "dark");
        assert_eq!(
            settings.reconnect_resume_mode,
            ReconnectResumeMode::IfWasPlaying
        );
        assert_eq!(settings.close_behavior, CloseBehavior::MinimizeToTray);
        assert!(!settings.windows_autostart);
        assert!(!settings.start_in_tray_on_autostart);
        assert_eq!(settings.home_feature_mode, HomeFeatureMode::LastPlayed);
        assert!(settings.home_feature_playlist_uri.is_none());
        assert!(settings.lyrics_enabled);
        assert!(!settings.song_videos_enabled);
        assert!(!settings.experimental_libre_canvas);
        assert!(settings.now_playing_list_navigation_enabled);
        assert!(settings.listening_analytics_enabled);
        assert!(!settings.lyrics_visuals.enabled);
        assert!(!settings.lyrics_visuals.visualizer_enabled);
        assert_eq!(settings.lyrics_visuals.visualizer_sensitivity_percent, 62);
        assert_eq!(settings.lyrics_visuals.mode, LyricsVisualMode::Pulse);
        assert_eq!(settings.lyrics_visuals.spread_percent, 48);
        assert_eq!(settings.lyrics_visuals.color_strength_percent, 42);
        assert!(settings.audio_control.enabled);
        assert_eq!(settings.audio_control.presets, vec![20, 40, 60, 80, 100]);
        assert_eq!(settings.audio_control.step_percent, 5);
        assert_eq!(settings.audio_control.curve, VolumeCurve::Linear);
    }

    #[tokio::test]
    async fn lazy_database_initializes_once_and_preserves_settings() {
        let dir = tempfile::tempdir().expect("tempdir");
        let handle = DatabaseHandle::new(dir.path().join("lazy.db"));
        handle.initialize().await.expect("initialize");
        handle
            .get()
            .await
            .expect("database")
            .save_settings(&Settings {
                close_behavior: CloseBehavior::Ask,
                ..Settings::default()
            })
            .await
            .expect("save");
        assert_eq!(
            handle
                .get()
                .await
                .expect("database")
                .settings()
                .await
                .expect("settings")
                .close_behavior,
            CloseBehavior::Ask
        );
    }

    #[test]
    fn existing_settings_without_newer_fields_use_defaults() {
        let value = r#"{"theme":"dark","autoStartSpotify":false,"lastRoute":"/","searchHistoryEnabled":true}"#;
        let settings: Settings = serde_json::from_str(value).expect("legacy settings");
        assert!(!settings.song_videos_enabled);
        assert!(!settings.experimental_libre_canvas);
        assert!(settings.now_playing_list_navigation_enabled);
    }

    #[test]
    fn existing_lyrics_visual_settings_without_mode_use_pulse() {
        let value =
            r#"{"lyricsVisuals":{"enabled":true,"spreadPercent":64,"colorStrengthPercent":58}}"#;
        let settings: Settings = serde_json::from_str(value).expect("legacy lyrics visuals");

        assert!(settings.lyrics_visuals.enabled);
        assert!(!settings.lyrics_visuals.visualizer_enabled);
        assert_eq!(settings.lyrics_visuals.visualizer_sensitivity_percent, 62);
        assert_eq!(settings.lyrics_visuals.mode, LyricsVisualMode::Pulse);
        assert_eq!(settings.lyrics_visuals.spread_percent, 64);
        assert_eq!(settings.lyrics_visuals.color_strength_percent, 58);
    }
}
