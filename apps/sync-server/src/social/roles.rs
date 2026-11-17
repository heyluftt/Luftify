//! Roles and custom friend codes. Only the server grants them; Luft is set
//! through the server configuration and manages everything else.
use luft_listen_together::{
    server_now_ms,
    social::{
        PRESENCE_TTL_MS, ServerOverview, SocialRole, normalize_custom_code, parse_roles,
        store_roles,
    },
};
use sqlx::SqliteConnection;

use super::{ApiError, ApiResult, Store, profiles::profile, relations};

pub(super) async fn roles_of(conn: &mut SqliteConnection, id: &str) -> ApiResult<Vec<SocialRole>> {
    let stored: String = sqlx::query_scalar("SELECT roles FROM profiles WHERE id = ?")
        .bind(id)
        .fetch_optional(conn)
        .await?
        .ok_or_else(|| ApiError::missing("notFound"))?;
    Ok(parse_roles(&stored))
}

pub(super) async fn require_luft(conn: &mut SqliteConnection, me: &str) -> ApiResult<()> {
    if roles_of(conn, me).await?.contains(&SocialRole::Luft) {
        Ok(())
    } else {
        Err(ApiError::denied("notAllowed"))
    }
}

/// Granting needs a confirmed friendship; taking a role back never does.
pub(super) async fn set_role(
    conn: &mut SqliteConnection,
    me: &str,
    other: &str,
    role: SocialRole,
    enabled: bool,
) -> ApiResult<()> {
    require_luft(conn, me).await?;
    if !role.grantable() {
        return Err(ApiError::bad("invalidRole"));
    }
    if enabled && me != other && !relations::friends(conn, me, other).await? {
        return Err(ApiError::denied("notFriends"));
    }
    let mut roles = roles_of(conn, other).await?;
    roles.retain(|held| *held != role);
    if enabled {
        roles.push(role);
    }
    sqlx::query("UPDATE profiles SET roles = ? WHERE id = ?")
        .bind(store_roles(&roles))
        .bind(other)
        .execute(conn)
        .await?;
    Ok(())
}

pub(super) async fn set_friend_code(conn: &mut SqliteConnection, me: &str, code: &str) -> ApiResult<()> {
    require_luft(conn, me).await?;
    let code = normalize_custom_code(code).ok_or_else(|| ApiError::bad("invalidCode"))?;
    let taken = sqlx::query_scalar::<_, i64>("SELECT 1 FROM profiles WHERE friend_code = ? AND id != ?")
        .bind(&code)
        .bind(me)
        .fetch_optional(&mut *conn)
        .await?
        .is_some();
    if taken {
        return Err(ApiError::bad("codeTaken"));
    }
    sqlx::query("UPDATE profiles SET friend_code = ? WHERE id = ?")
        .bind(code)
        .bind(me)
        .execute(conn)
        .await?;
    Ok(())
}

impl Store {
    /// `LUFTIFY_OWNER_CODE`: the friend code that receives the Luft role on
    /// start. The role stays in the database, also after a custom code.
    pub async fn grant_owner(&self, code: &str) -> ApiResult<bool> {
        let _lock = self.mutations.lock().await;
        let code = code.trim().to_ascii_uppercase();
        let Some(stored) = sqlx::query_scalar::<_, String>("SELECT roles FROM profiles WHERE friend_code = ?")
            .bind(&code)
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(false);
        };
        let mut roles = parse_roles(&stored);
        if !roles.contains(&SocialRole::Luft) {
            roles.push(SocialRole::Luft);
            sqlx::query("UPDATE profiles SET roles = ? WHERE friend_code = ?")
                .bind(store_roles(&roles))
                .bind(&code)
                .execute(&self.pool)
                .await?;
        }
        Ok(true)
    }

    pub(super) async fn overview(&self) -> ApiResult<ServerOverview> {
        let profiles: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
            .fetch_one(&self.pool)
            .await?;
        let team = sqlx::query("SELECT * FROM profiles WHERE roles != '' OR badges != '' ORDER BY display_name COLLATE NOCASE,id LIMIT 100")
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(profile)
            .collect();
        let now = server_now_ms();
        let presence = self.presence.lock().await;
        let fresh = || presence.values().filter(|p| now - p.updated_at < PRESENCE_TTL_MS);
        Ok(ServerOverview {
            profiles: profiles as u32,
            online: fresh().count() as u32,
            listening: fresh().filter(|p| p.value.is_playing).count() as u32,
            rooms: 0,
            team,
        })
    }
}
