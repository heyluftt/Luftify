//! Luft's user overview and moderation. Luft sees every profile with its
//! session, version, friends and stored media; listening shows only when the
//! profile shares it with friends anyway. Moderation never touches Luft.
use luft_listen_together::{
    admin::{AdminOverview, AdminUser, Moderation, ServerState},
    media::MAX_MEDIA_TOTAL_BYTES,
    server_now_ms,
    social::{PRESENCE_TTL_MS, SocialRole, parse_roles},
};
use sqlx::{Row, SqliteConnection};

use super::{ApiError, ApiResult, Store, profiles::{options, profile}, roles::require_luft};

/// The newest profiles first would hide old testers; names read best.
const MAX_LISTED: i64 = 500;

impl Store {
    pub async fn admin_overview(&self, me: &str) -> ApiResult<AdminOverview> {
        let mut conn = self.pool.acquire().await?;
        require_luft(&mut conn, me).await?;
        let rows = sqlx::query("SELECT p.*, (SELECT COUNT(*) FROM friendships f WHERE f.a = p.id OR f.b = p.id) AS friend_count, (SELECT COALESCE(SUM(bytes), 0) FROM media m WHERE m.owner = p.id) AS media_bytes FROM profiles p ORDER BY p.display_name COLLATE NOCASE, p.id LIMIT ?")
            .bind(MAX_LISTED).fetch_all(&mut *conn).await?;
        drop(conn);
        let now = server_now_ms();
        let presence = self.presence.lock().await;
        let users = rows.iter().map(|row| {
            let profile = profile(row);
            let live = presence.get(&profile.id).filter(|value| now - value.updated_at < PRESENCE_TTL_MS);
            let visible = super::activity::visible_presence(&options(row), live.map(|value| &value.value), row.get("last_seen"));
            AdminUser {
                online: live.is_some(),
                listening: visible.is_playing,
                last_seen_ms: row.get("last_seen"),
                app_version: row.get("app_version"),
                phone_version: row.get("phone_version"),
                friends: row.get::<i64, _>("friend_count") as u32,
                media_bytes: row.get::<i64, _>("media_bytes") as u64,
                suspended: row.get::<i64, _>("suspended") != 0,
                profile,
            }
        }).collect::<Vec<_>>();
        drop(presence);
        let media_bytes = users.iter().map(|user| user.media_bytes).sum();
        let mut conn = self.pool.acquire().await?;
        let reports: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM reports").fetch_one(&mut *conn).await?;
        let settings = super::admin_tools::settings(&mut conn).await?;
        drop(conn);
        let (backups, last_backup_ms) = self.backup_status().await;
        let server = ServerState {
            started_at_ms: self.started_at_ms,
            version: env!("CARGO_PKG_VERSION").into(),
            database_bytes: self.database_bytes().await,
            settings,
            room_members: 0,
            reports: reports as u32,
            backups,
            last_backup_ms,
        };
        Ok(AdminOverview { users, media_bytes, media_limit_bytes: MAX_MEDIA_TOTAL_BYTES as u64, rooms: 0, server, log: self.recent_log().await? })
    }
}

pub(super) async fn moderate(conn: &mut SqliteConnection, me: &str, target: &str, moderation: Moderation) -> ApiResult<()> {
    require_luft(conn, me).await?;
    let roles: Option<String> = sqlx::query_scalar("SELECT roles FROM profiles WHERE id = ?").bind(target).fetch_optional(&mut *conn).await?;
    let roles = roles.ok_or_else(|| ApiError::missing("notFound"))?;
    if target == me || parse_roles(&roles).contains(&SocialRole::Luft) {
        return Err(ApiError::denied("notAllowed"));
    }
    // Logged first, with the name before a reset.
    super::admin_tools::log(conn, me, Some(target), moderation.key(), None).await?;
    if moderation == Moderation::ResetName {
        let code: String = sqlx::query_scalar("SELECT friend_code FROM profiles WHERE id = ?").bind(target).fetch_one(&mut *conn).await?;
        let suffix: String = code.trim_start_matches("LF-").chars().take(4).collect();
        let name = format!("Person {suffix}");
        sqlx::query("UPDATE profiles SET display_name = ?, search_name = ? WHERE id = ?")
            .bind(&name).bind(name.to_lowercase()).bind(target).execute(conn).await?;
        return Ok(());
    }
    let query = match moderation {
        Moderation::Suspend => "UPDATE profiles SET suspended = 1 WHERE id = ?",
        Moderation::Unsuspend => "UPDATE profiles SET suspended = 0 WHERE id = ?",
        Moderation::ClearProfile => "UPDATE profiles SET avatar_uri = NULL, bio = NULL, look = NULL, accent = NULL, banner = NULL, favorite = NULL WHERE id = ?",
        Moderation::ResetName => unreachable!("handled above"),
    };
    sqlx::query(query).bind(target).execute(conn).await?;
    Ok(())
}
