use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    time::Duration,
};

use luft_listen_together::{
    server_now_ms,
    social::{FriendPresence, RecentTrack},
};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use tokio::sync::Mutex;

use super::ApiResult;

pub struct Store {
    pub(super) pool: SqlitePool,
    pub(super) mutations: Mutex<()>,
    pub(super) presence: Mutex<HashMap<String, TimedPresence>>,
    /// Recently played tracks, newest first. In memory only, like presence.
    pub(super) recent: Mutex<HashMap<String, VecDeque<RecentTrack>>>,
    /// Profile media files (media.rs), next to the database on the same volume.
    pub(super) media_dir: PathBuf,
    /// Who listens along with whom: friend → follower → last ask. In memory only.
    pub(super) listeners: Mutex<HashMap<String, HashMap<String, i64>>>,
    /// App version of each running session, for Luft only. In memory only.
    pub(super) versions: Mutex<HashMap<String, String>>,
    /// The database file, for its size and backups; none in tests.
    pub(super) database_path: Option<PathBuf>,
    pub(super) started_at_ms: i64,
    /// When the last backup was made, so they cannot be requested in a loop.
    pub(super) last_backup: Mutex<Option<std::time::Instant>>,
    /// Link codes for more devices: code → profile and expiry. In memory only.
    pub(super) links: Mutex<HashMap<String, (String, i64)>>,
    /// Each device's last report, per profile (device_presence.rs).
    pub(super) device_presence: Mutex<HashMap<String, HashMap<String, super::device_presence::DeviceReport>>>,
}

/// Recent tracks older than this are forgotten.
const RECENT_TTL_MS: i64 = 24 * 60 * 60_000;

pub(super) struct TimedPresence {
    pub updated_at: i64,
    pub value: FriendPresence,
}

impl Store {
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let media_dir = path.parent().unwrap_or(Path::new(".")).join("media");
        let mut store = Self::connect(options, media_dir).await?;
        store.database_path = Some(path.to_path_buf());
        Ok(store)
    }

    async fn connect(options: SqliteConnectOptions, media_dir: PathBuf) -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        sqlx::raw_sql(SCHEMA).execute(&pool).await?;
        migrate(&pool).await?;
        // Listening rooms are in memory and cannot survive a process restart.
        sqlx::query("DELETE FROM invitations")
            .execute(&pool)
            .await?;
        Ok(Self {
            pool,
            mutations: Mutex::new(()),
            presence: Mutex::new(HashMap::new()),
            recent: Mutex::new(HashMap::new()),
            media_dir,
            listeners: Mutex::new(HashMap::new()),
            versions: Mutex::new(HashMap::new()),
            database_path: None,
            started_at_ms: server_now_ms(),
            last_backup: Mutex::new(None),
            links: Mutex::new(HashMap::new()),
            device_presence: Mutex::new(HashMap::new()),
        })
    }

    #[cfg(test)]
    pub(super) async fn memory() -> Self {
        Self::connect(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
            std::env::temp_dir().join(format!("luft-media-test-{}", uuid::Uuid::new_v4().simple())),
        )
        .await
        .unwrap()
    }

    pub async fn cleanup(&self) -> ApiResult<()> {
        let now = server_now_ms();
        sqlx::query("DELETE FROM invitations WHERE expires_at <= ?")
            .bind(now)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM requests WHERE created_at < ?")
            .bind(now - 30 * 24 * 60 * 60_000_i64)
            .execute(&self.pool)
            .await?;
        self.forget_old_reports().await?;
        self.forget_old_playlist_shares(now).await?;
        self.trim_admin_log().await?;
        self.forget_unused_media().await?;
        self.forget_old_listeners().await;
        self.prune_device_presence(now).await;
        self.recent.lock().await.retain(|_, tracks| {
            tracks.retain(|entry| now - entry.played_at_ms < RECENT_TTL_MS);
            !tracks.is_empty()
        });
        Ok(())
    }
}

/// Columns added after the first release. `ADD COLUMN` keeps existing rows.
async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for (table, column, definition) in [
        ("profiles", "roles", "TEXT NOT NULL DEFAULT ''"),
        ("friendships", "since", "INTEGER"),
        ("profiles", "badges", "TEXT NOT NULL DEFAULT ''"),
        ("profiles", "bio", "TEXT"),
        ("profiles", "accent", "TEXT"),
        ("profiles", "banner", "TEXT"),
        ("profiles", "favorite", "TEXT"),
        ("profiles", "presence_mode", "TEXT"),
        ("profiles", "last_seen", "INTEGER"),
        ("profiles", "look", "TEXT"),
        ("profiles", "achievements", "TEXT NOT NULL DEFAULT ''"),
        ("profiles", "suspended", "INTEGER NOT NULL DEFAULT 0"),
        ("profiles", "recovery_hash", "TEXT"),
        ("profiles", "playlist_account", "TEXT"),
        ("profiles", "app_version", "TEXT"),
        ("profiles", "phone_version", "TEXT"),
    ] {
        let columns: Vec<String> =
            sqlx::query_scalar(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .fetch_all(pool)
                .await?;
        if !columns.iter().any(|name| name == column) {
            sqlx::raw_sql(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))
                .execute(pool)
                .await?;
        }
    }
    sqlx::raw_sql("CREATE INDEX IF NOT EXISTS profiles_recovery ON profiles(recovery_hash)")
        .execute(pool)
        .await?;
    Ok(())
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS profiles (
 id TEXT PRIMARY KEY, friend_code TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL, search_name TEXT NOT NULL, avatar_uri TEXT, token_hash TEXT NOT NULL UNIQUE,
 discoverable INTEGER NOT NULL DEFAULT 1, share_online INTEGER NOT NULL DEFAULT 1,
 share_listening INTEGER NOT NULL DEFAULT 0, allow_invites INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS profiles_name ON profiles(display_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS friendships (
 a TEXT NOT NULL REFERENCES profiles(id), b TEXT NOT NULL REFERENCES profiles(id),
 PRIMARY KEY(a,b), CHECK(a < b)
);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES profiles(id),
 recipient TEXT NOT NULL REFERENCES profiles(id), created_at INTEGER NOT NULL,
 UNIQUE(sender,recipient), CHECK(sender != recipient)
);
CREATE INDEX IF NOT EXISTS requests_recipient ON requests(recipient);
CREATE TABLE IF NOT EXISTS blocks (
 blocker TEXT NOT NULL REFERENCES profiles(id), blocked TEXT NOT NULL REFERENCES profiles(id),
 PRIMARY KEY(blocker,blocked), CHECK(blocker != blocked)
);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES profiles(id),
 recipient TEXT NOT NULL REFERENCES profiles(id), join_code TEXT NOT NULL,
 expires_at INTEGER NOT NULL, UNIQUE(sender,recipient), CHECK(sender != recipient)
);
CREATE INDEX IF NOT EXISTS invitations_recipient ON invitations(recipient);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, reporter TEXT NOT NULL REFERENCES profiles(id), message TEXT NOT NULL,
 app_version TEXT NOT NULL, diagnostics TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_reporter ON reports(reporter, created_at);
CREATE TABLE IF NOT EXISTS media (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES profiles(id), kind TEXT NOT NULL,
 bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_owner ON media(owner);
CREATE TABLE IF NOT EXISTS media_uploads (owner TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS media_uploads_owner ON media_uploads(owner, created_at);
CREATE TABLE IF NOT EXISTS listening_hidden (
 owner TEXT NOT NULL REFERENCES profiles(id), viewer TEXT NOT NULL REFERENCES profiles(id),
 PRIMARY KEY(owner,viewer), CHECK(owner != viewer)
);
CREATE TABLE IF NOT EXISTS admin_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, actor_name TEXT NOT NULL,
 target TEXT, target_name TEXT, action TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
 token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 label TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER
);
CREATE INDEX IF NOT EXISTS devices_profile ON devices(profile_id);
CREATE TABLE IF NOT EXISTS playlist_shares (
 id TEXT PRIMARY KEY, sender TEXT NOT NULL REFERENCES profiles(id), recipient TEXT NOT NULL REFERENCES profiles(id),
 playlist_uri TEXT NOT NULL, name TEXT NOT NULL, cover_uri TEXT, created_at INTEGER NOT NULL,
 UNIQUE(sender,recipient,playlist_uri), CHECK(sender != recipient)
);
CREATE INDEX IF NOT EXISTS playlist_shares_recipient ON playlist_shares(recipient, created_at);
CREATE TABLE IF NOT EXISTS chat_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender TEXT NOT NULL REFERENCES profiles(id), recipient TEXT NOT NULL REFERENCES profiles(id),
 a TEXT NOT NULL, b TEXT NOT NULL, client_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(sender,client_id), CHECK(sender != recipient), CHECK(a < b)
);
CREATE INDEX IF NOT EXISTS chat_pair ON chat_messages(a,b,id);
CREATE INDEX IF NOT EXISTS chat_sender_time ON chat_messages(sender,created_at);
CREATE TABLE IF NOT EXISTS chat_reads (
 profile_id TEXT NOT NULL REFERENCES profiles(id), peer_id TEXT NOT NULL REFERENCES profiles(id),
 last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id,peer_id)
);
CREATE TABLE IF NOT EXISTS badges (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL
);
";
