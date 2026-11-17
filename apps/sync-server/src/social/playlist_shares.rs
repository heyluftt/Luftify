//! Playlists sent to friends to join (`sharePlaylist`); they wait in the
//! recipient's snapshot until joined, dismissed or expired.
use luft_listen_together::{
    PlaylistShare, SharedPlaylist, server_now_ms,
    playlists::{MAX_PLAYLIST_SHARES, PLAYLIST_SHARE_TTL_MS},
};
use sqlx::{Row, SqliteConnection};
use uuid::Uuid;

use super::{ApiError, ApiResult, Store, profiles, relations};

pub(super) async fn share(conn: &mut SqliteConnection, me: &str, other: &str, playlist: SharedPlaylist) -> ApiResult<()> {
    let playlist = playlist.sanitize().ok_or_else(|| ApiError::bad("invalidPlaylist"))?;
    if relations::blocked(conn, me, other).await? {
        return Err(ApiError::denied("blocked"));
    }
    if !relations::friends(conn, me, other).await? {
        return Err(ApiError::denied("notFriends"));
    }
    let row = sqlx::query("SELECT * FROM profiles WHERE id = ?").bind(other).fetch_one(&mut *conn).await?;
    if !profiles::options(&row).allow_invites {
        return Err(ApiError::denied("invitesDisabled"));
    }
    sqlx::query("INSERT INTO playlist_shares (id,sender,recipient,playlist_uri,name,cover_uri,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(sender,recipient,playlist_uri) DO UPDATE SET id = excluded.id, name = excluded.name, cover_uri = excluded.cover_uri, created_at = excluded.created_at")
        .bind(Uuid::new_v4().to_string()).bind(me).bind(other).bind(&playlist.uri).bind(&playlist.name)
        .bind(&playlist.cover_uri).bind(server_now_ms())
        .execute(&mut *conn).await?;
    // Only the newest ones stay, so nobody can fill another's list.
    sqlx::query("DELETE FROM playlist_shares WHERE recipient = ? AND id NOT IN (SELECT id FROM playlist_shares WHERE recipient = ? ORDER BY created_at DESC LIMIT ?)")
        .bind(other).bind(other).bind(MAX_PLAYLIST_SHARES as i64)
        .execute(conn).await?;
    Ok(())
}

pub(super) async fn dismiss(conn: &mut SqliteConnection, me: &str, share_id: &str) -> ApiResult<()> {
    sqlx::query("DELETE FROM playlist_shares WHERE id = ? AND recipient = ?")
        .bind(share_id).bind(me).execute(conn).await?;
    Ok(())
}

/// Both directions end with the friendship.
pub(super) async fn forget_between(conn: &mut SqliteConnection, me: &str, other: &str) -> ApiResult<()> {
    sqlx::query("DELETE FROM playlist_shares WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)")
        .bind(me).bind(other).bind(other).bind(me).execute(conn).await?;
    Ok(())
}

impl Store {
    pub(super) async fn playlist_shares(&self, me: &str, allow_invites: bool) -> ApiResult<Vec<PlaylistShare>> {
        if !allow_invites {
            return Ok(Vec::new());
        }
        let rows = sqlx::query("SELECT p.*,s.id AS share_id,s.playlist_uri,s.name AS playlist_name,s.cover_uri AS playlist_cover,s.created_at AS shared_at FROM playlist_shares s JOIN profiles p ON p.id = s.sender WHERE s.recipient = ? AND s.created_at > ? AND EXISTS(SELECT 1 FROM friendships f WHERE (f.a = s.sender AND f.b = s.recipient) OR (f.a = s.recipient AND f.b = s.sender)) ORDER BY s.created_at DESC LIMIT ?")
            .bind(me).bind(server_now_ms() - PLAYLIST_SHARE_TTL_MS).bind(MAX_PLAYLIST_SHARES as i64)
            .fetch_all(&self.pool).await?;
        Ok(rows
            .iter()
            .map(|row| PlaylistShare {
                id: row.get("share_id"),
                from: profiles::profile(row),
                playlist: SharedPlaylist {
                    uri: row.get("playlist_uri"),
                    name: row.get("playlist_name"),
                    cover_uri: row.get("playlist_cover"),
                },
                created_at_ms: row.get("shared_at"),
            })
            .collect())
    }

    pub(super) async fn forget_old_playlist_shares(&self, now: i64) -> ApiResult<()> {
        sqlx::query("DELETE FROM playlist_shares WHERE created_at <= ?")
            .bind(now - PLAYLIST_SHARE_TTL_MS)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
