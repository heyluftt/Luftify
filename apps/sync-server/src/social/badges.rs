//! Luft's own badges and everyone's profile status line.
use luft_listen_together::{
    BadgeDefinition, server_now_ms,
    badges::{MAX_BADGES, MAX_BADGES_PER_PROFILE, clean_bio, parse_badge_ids},
};
use sqlx::{Row, SqliteConnection};
use uuid::Uuid;

use super::{ApiError, ApiResult, Store, relations, roles::require_luft};

pub(super) async fn save_badge(conn: &mut SqliteConnection, me: &str, mut badge: BadgeDefinition) -> ApiResult<()> {
    require_luft(conn, me).await?;
    if !badge.validate() {
        return Err(ApiError::bad("invalidBadge"));
    }
    if !badge.id.is_empty() {
        let changed = sqlx::query("UPDATE badges SET label = ?, icon = ?, color = ? WHERE id = ?")
            .bind(&badge.label).bind(&badge.icon).bind(&badge.color).bind(&badge.id)
            .execute(conn).await?.rows_affected();
        return if changed == 0 { Err(ApiError::missing("notFound")) } else { Ok(()) };
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM badges").fetch_one(&mut *conn).await?;
    if count as usize >= MAX_BADGES {
        return Err(ApiError::limited());
    }
    sqlx::query("INSERT INTO badges (id,label,icon,color,created_at) VALUES(?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string()).bind(&badge.label).bind(&badge.icon).bind(&badge.color).bind(server_now_ms())
        .execute(conn).await?;
    Ok(())
}

pub(super) async fn delete_badge(conn: &mut SqliteConnection, me: &str, id: &str) -> ApiResult<()> {
    require_luft(conn, me).await?;
    let holders = sqlx::query("SELECT id,badges FROM profiles WHERE badges != ''").fetch_all(&mut *conn).await?;
    for row in holders {
        let ids = parse_badge_ids(row.get("badges"));
        if ids.iter().any(|held| held == id) {
            let kept: Vec<_> = ids.into_iter().filter(|held| held != id).collect();
            sqlx::query("UPDATE profiles SET badges = ? WHERE id = ?")
                .bind(kept.join(",")).bind(row.get::<String, _>("id"))
                .execute(&mut *conn).await?;
        }
    }
    sqlx::query("DELETE FROM badges WHERE id = ?").bind(id).execute(conn).await?;
    Ok(())
}

pub(super) async fn set_badge(conn: &mut SqliteConnection, me: &str, other: &str, badge: &str, enabled: bool) -> ApiResult<()> {
    require_luft(conn, me).await?;
    let known = sqlx::query_scalar::<_, i64>("SELECT 1 FROM badges WHERE id = ?").bind(badge).fetch_optional(&mut *conn).await?.is_some();
    if !known {
        return Err(ApiError::missing("notFound"));
    }
    if enabled && me != other && !relations::friends(conn, me, other).await? {
        return Err(ApiError::denied("notFriends"));
    }
    let stored: String = sqlx::query_scalar("SELECT badges FROM profiles WHERE id = ?")
        .bind(other).fetch_optional(&mut *conn).await?.ok_or_else(|| ApiError::missing("notFound"))?;
    let mut ids = parse_badge_ids(&stored);
    ids.retain(|held| held != badge);
    if enabled {
        if ids.len() >= MAX_BADGES_PER_PROFILE {
            return Err(ApiError::limited());
        }
        ids.push(badge.to_owned());
    }
    sqlx::query("UPDATE profiles SET badges = ? WHERE id = ?").bind(ids.join(",")).bind(other).execute(conn).await?;
    Ok(())
}

pub(super) async fn set_bio(conn: &mut SqliteConnection, me: &str, bio: Option<String>) -> ApiResult<()> {
    let bio = clean_bio(bio).map_err(|_| ApiError::bad("invalidBio"))?;
    sqlx::query("UPDATE profiles SET bio = ? WHERE id = ?").bind(bio).bind(me).execute(conn).await?;
    Ok(())
}

pub(super) async fn set_style(
    conn: &mut SqliteConnection,
    me: &str,
    style: Option<luft_listen_together::ProfileStyle>,
) -> ApiResult<()> {
    if style.as_ref().is_some_and(|style| !style.valid()) {
        return Err(ApiError::bad("invalidStyle"));
    }
    if let Some(style) = &style {
        super::media::check_owned(conn, me, style).await?;
        check_shown_badges(conn, me, style).await?;
    }
    let look = style.as_ref().map(serde_json::to_string).transpose().map_err(|_| ApiError::bad("invalidStyle"))?;
    sqlx::query("UPDATE profiles SET accent = ?, banner = ?, look = ? WHERE id = ?")
        .bind(style.as_ref().map(|style| style.accent.clone()))
        .bind(style.map(|style| style.banner))
        .bind(look)
        .bind(me)
        .execute(conn)
        .await?;
    Ok(())
}

pub(super) async fn set_favorite(
    conn: &mut SqliteConnection,
    me: &str,
    track: Option<luft_listen_together::TrackRef>,
) -> ApiResult<()> {
    let track = luft_listen_together::appearance::clean_favorite(track).map_err(|_| ApiError::bad("invalidTrack"))?;
    let json = track.map(|track| serde_json::to_string(&track)).transpose().map_err(|_| ApiError::bad("invalidTrack"))?;
    sqlx::query("UPDATE profiles SET favorite = ? WHERE id = ?").bind(json).bind(me).execute(conn).await?;
    Ok(())
}

impl Store {
    pub(super) async fn badge_catalog(&self) -> ApiResult<Vec<BadgeDefinition>> {
        Ok(sqlx::query("SELECT * FROM badges ORDER BY created_at,id")
            .fetch_all(&self.pool)
            .await?
            .iter()
            .map(|row| BadgeDefinition {
                id: row.get("id"),
                label: row.get("label"),
                icon: row.get("icon"),
                color: row.get("color"),
            })
            .collect())
    }
}

/// Only badges the profile owns can be shown; a revoked one simply stops showing.
async fn check_shown_badges(
    conn: &mut SqliteConnection,
    me: &str,
    style: &luft_listen_together::ProfileStyle,
) -> ApiResult<()> {
    let row = sqlx::query("SELECT roles, badges, achievements FROM profiles WHERE id = ?").bind(me).fetch_one(&mut *conn).await?;
    let reached: Vec<String> = super::achievements::unlocked(&row).into_iter().map(|(id, _)| id).collect();
    if style.frame == luft_listen_together::achievements::REWARD_FRAME && !reached.iter().any(|id| id == "collector") {
        return Err(ApiError::bad("invalidStyle"));
    }
    let Some(keys) = &style.shown_badges else { return Ok(()) };
    let roles = luft_listen_together::social::parse_roles(row.get("roles"));
    let badges = luft_listen_together::badges::parse_badge_ids(row.get("badges"));
    let (shown_roles, shown_badges) = style.visible_badges(&roles, &badges);
    let shown_quests = keys.iter().filter_map(|key| key.strip_prefix("quest:")).filter(|id| reached.iter().any(|known| known == id)).count();
    if shown_roles.len() + shown_badges.len() + shown_quests != keys.len() {
        return Err(ApiError::bad("invalidStyle"));
    }
    Ok(())
}
