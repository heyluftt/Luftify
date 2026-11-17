//! Luft's safety net: a log of every admin action, the server-wide switches
//! (sign-ups, announcement) and a database backup. Nothing here changes or
//! removes user data.
use luft_listen_together::{
    admin::{AdminLogEntry, ServerSettings, clean_announcement},
    server_now_ms,
};
use sqlx::{Row, SqliteConnection};

use super::{ApiError, ApiResult, Store, roles::require_luft};

/// The log keeps this many entries; older ones go with the regular cleanup.
const LOG_KEPT: i64 = 2_000;
const LOG_SHOWN: i64 = 80;
/// One backup per this many seconds.
const BACKUP_PAUSE_SECS: u64 = 30;

/// Notes an admin action with the names as they are now, so the log stays
/// readable after a rename or a reset.
pub(super) async fn log(conn: &mut SqliteConnection, actor: &str, target: Option<&str>, action: &str, detail: Option<&str>) -> ApiResult<()> {
    let actor_name = profile_name(conn, actor).await?.unwrap_or_default();
    let target_name = match target {
        Some(id) => profile_name(conn, id).await?,
        None => None,
    };
    sqlx::query("INSERT INTO admin_log (at, actor, actor_name, target, target_name, action, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(server_now_ms()).bind(actor).bind(actor_name).bind(target).bind(target_name).bind(action).bind(detail)
        .execute(conn).await?;
    Ok(())
}

async fn profile_name(conn: &mut SqliteConnection, id: &str) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar("SELECT display_name FROM profiles WHERE id = ?").bind(id).fetch_optional(conn).await?)
}

pub(super) async fn settings(conn: &mut SqliteConnection) -> ApiResult<ServerSettings> {
    let rows = sqlx::query("SELECT key, value FROM server_settings").fetch_all(conn).await?;
    let mut settings = ServerSettings::default();
    for row in rows {
        let value: String = row.get("value");
        match row.get::<String, _>("key").as_str() {
            "signups_open" => settings.signups_open = value != "0",
            "announcement" => settings.announcement = clean_announcement(Some(value)).ok().flatten(),
            _ => {}
        }
    }
    Ok(settings)
}

pub(super) async fn set_settings(conn: &mut SqliteConnection, me: &str, next: ServerSettings) -> ApiResult<()> {
    require_luft(conn, me).await?;
    let announcement = clean_announcement(next.announcement).map_err(|()| ApiError::bad("invalidAnnouncement"))?;
    let before = settings(conn).await?;
    let upsert = "INSERT INTO server_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
    if before.signups_open != next.signups_open {
        sqlx::query(upsert).bind("signups_open").bind(if next.signups_open { "1" } else { "0" }).execute(&mut *conn).await?;
        log(conn, me, None, "signups", Some(if next.signups_open { "open" } else { "closed" })).await?;
    }
    if before.announcement != announcement {
        match &announcement {
            Some(text) => { sqlx::query(upsert).bind("announcement").bind(text).execute(&mut *conn).await?; }
            None => { sqlx::query("DELETE FROM server_settings WHERE key = 'announcement'").execute(&mut *conn).await?; }
        }
        log(conn, me, None, "announcement", announcement.as_deref()).await?;
    }
    Ok(())
}

impl Store {
    pub(super) async fn recent_log(&self) -> ApiResult<Vec<AdminLogEntry>> {
        let rows = sqlx::query("SELECT at, actor_name, target_name, action, detail FROM admin_log ORDER BY id DESC LIMIT ?")
            .bind(LOG_SHOWN).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|row| AdminLogEntry {
            at_ms: row.get("at"),
            actor: row.get("actor_name"),
            target: row.get("target_name"),
            action: row.get("action"),
            detail: row.get("detail"),
        }).collect())
    }

    pub(super) async fn trim_admin_log(&self) -> ApiResult<()> {
        sqlx::query("DELETE FROM admin_log WHERE id <= (SELECT COALESCE(MAX(id), 0) - ? FROM admin_log)")
            .bind(LOG_KEPT).execute(&self.pool).await?;
        Ok(())
    }

    pub async fn server_settings(&self) -> ApiResult<ServerSettings> {
        let mut conn = self.pool.acquire().await?;
        settings(&mut conn).await
    }

    /// The database as one consistent SQLite file (VACUUM INTO), for Luft to keep.
    pub async fn backup(&self, me: &str) -> ApiResult<Vec<u8>> {
        let mut conn = self.pool.acquire().await?;
        require_luft(&mut conn, me).await?;
        let path = self.database_path.as_ref().ok_or_else(|| ApiError::missing("unavailable"))?;
        {
            let mut last = self.last_backup.lock().await;
            if last.is_some_and(|at| at.elapsed().as_secs() < BACKUP_PAUSE_SECS) {
                return Err(ApiError::limited());
            }
            *last = Some(std::time::Instant::now());
        }
        let temporary = path.with_extension(format!("backup-{}.sqlite", uuid::Uuid::new_v4().simple()));
        let target = temporary.to_string_lossy().replace('\'', "''");
        let statement = format!("VACUUM INTO '{target}'");
        sqlx::query(&statement).execute(&mut *conn).await?;
        let bytes = tokio::fs::read(&temporary).await.map_err(|_| ApiError::missing("unavailable"));
        let _ = tokio::fs::remove_file(&temporary).await;
        let bytes = bytes?;
        log(&mut *conn, me, None, "backup", Some(&format!("{} KB", bytes.len() / 1024))).await?;
        Ok(bytes)
    }

    /// Size of the database file and its write-ahead log.
    pub(super) async fn database_bytes(&self) -> u64 {
        let Some(path) = &self.database_path else { return 0 };
        let mut total = 0;
        for file in [path.clone(), path.with_extension("sqlite-wal")] {
            if let Ok(meta) = tokio::fs::metadata(&file).await {
                total += meta.len();
            }
        }
        total
    }
}

