use luft_listen_together::{
    normalize_join_code, server_now_ms,
    social::{INVITATION_TTL_MS, SocialAction, SocialSnapshot},
};
use sqlx::SqliteConnection;
use uuid::Uuid;

use super::{ApiError, ApiResult, Store, admin_tools, badges, profiles, relations, roles};

impl Store {
    /// All relationship mutations are serialized and committed together.
    pub async fn action(&self, me: &str, action: SocialAction) -> ApiResult<SocialSnapshot> {
        let _lock = self.mutations.lock().await;
        let mut tx = self.pool.begin().await?;
        match action {
            SocialAction::BindPlaylistAccount { account_key } => {
                if account_key.len() != 64 || !account_key.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
                    return Err(ApiError::bad("invalidProfile"));
                }
                sqlx::query("UPDATE profiles SET playlist_account = ? WHERE id = ?")
                    .bind(account_key).bind(me).execute(&mut *tx).await?;
            }
            SocialAction::Request { friend_code } => {
                relations::request(&mut tx, me, &friend_code).await?
            }
            SocialAction::RespondRequest { request_id, accept } => {
                relations::respond(&mut tx, me, &request_id, accept).await?
            }
            SocialAction::CancelRequest { request_id } => {
                let result = sqlx::query("DELETE FROM requests WHERE id = ? AND sender = ?")
                    .bind(request_id)
                    .bind(me)
                    .execute(&mut *tx)
                    .await?;
                if result.rows_affected() == 0 {
                    return Err(ApiError::missing("invalidRequest"));
                }
            }
            SocialAction::RemoveFriend { profile_id } => {
                if !relations::friends(&mut tx, me, &profile_id).await? {
                    return Err(ApiError::bad("notFriends"));
                }
                relations::remove(&mut tx, me, &profile_id).await?;
            }
            SocialAction::Block { profile_id } => {
                relations::block(&mut tx, me, &profile_id).await?
            }
            SocialAction::Unblock { profile_id } => {
                sqlx::query("DELETE FROM blocks WHERE blocker = ? AND blocked = ?")
                    .bind(me)
                    .bind(profile_id)
                    .execute(&mut *tx)
                    .await?;
            }
            SocialAction::UpdateProfile { mut profile } => {
                if !profile.validate() {
                    return Err(ApiError::bad("invalidProfile"));
                }
                sqlx::query("UPDATE profiles SET display_name = ?, search_name = ?, avatar_uri = ? WHERE id = ?")
                    .bind(&profile.display_name).bind(profile.display_name.to_lowercase()).bind(profile.avatar_uri).bind(me).execute(&mut *tx).await?;
            }
            SocialAction::UpdateOptions { options } => {
                sqlx::query("UPDATE profiles SET discoverable = ?, share_online = ?, share_listening = ?, allow_invites = ?, presence_mode = ? WHERE id = ?")
                    .bind(options.discoverable).bind(options.share_online).bind(options.share_listening).bind(options.allow_invites)
                    .bind(options.presence_mode.key()).bind(me).execute(&mut *tx).await?;
                if !options.allow_invites {
                    sqlx::query("DELETE FROM invitations WHERE recipient = ?")
                        .bind(me)
                        .execute(&mut *tx)
                        .await?;
                }
                if !options.share_listening {
                    self.recent.lock().await.remove(me);
                }
                self.hide_on_devices(me, !options.share_online, !options.share_listening).await;
            }
            SocialAction::Invite {
                profile_id,
                join_code,
                room_token: _,
            } => {
                // The HTTP handler has checked the current connected room member's private token.
                invite(&mut tx, me, &profile_id, &join_code).await?;
            }
            SocialAction::SetRole {
                profile_id,
                role,
                enabled,
            } => {
                roles::set_role(&mut tx, me, &profile_id, role, enabled).await?;
                admin_tools::log(&mut tx, me, Some(&profile_id), "role", Some(&format!("{} {}", if enabled { "+" } else { "-" }, role.key()))).await?;
            }
            SocialAction::SetFriendCode { code } => {
                roles::set_friend_code(&mut tx, me, &code).await?;
                admin_tools::log(&mut tx, me, None, "code", Some(&code)).await?;
            }
            SocialAction::SaveBadge { badge } => {
                let label = badge.label.clone();
                badges::save_badge(&mut tx, me, badge).await?;
                admin_tools::log(&mut tx, me, None, "badgeSaved", Some(&label)).await?;
            }
            SocialAction::DeleteBadge { id } => {
                badges::delete_badge(&mut tx, me, &id).await?;
                admin_tools::log(&mut tx, me, None, "badgeDeleted", Some(&id)).await?;
            }
            SocialAction::SetBadge {
                profile_id,
                badge_id,
                enabled,
            } => {
                badges::set_badge(&mut tx, me, &profile_id, &badge_id, enabled).await?;
                admin_tools::log(&mut tx, me, Some(&profile_id), "badge", Some(&format!("{} {badge_id}", if enabled { "+" } else { "-" }))).await?;
            }
            SocialAction::SetServerSettings { settings } => admin_tools::set_settings(&mut tx, me, settings).await?,
            SocialAction::SetBio { bio } => badges::set_bio(&mut tx, me, bio).await?,
            SocialAction::SetStyle { style } => badges::set_style(&mut tx, me, style).await?,
            SocialAction::SetFavorite { track } => badges::set_favorite(&mut tx, me, track).await?,
            SocialAction::Moderate { profile_id, moderation } => {
                super::admin::moderate(&mut tx, me, &profile_id, moderation).await?;
                if moderation == luft_listen_together::admin::Moderation::Suspend {
                    // Gone for friends at once, not only after the presence expires.
                    self.forget_device_presence(&profile_id, None).await;
                    self.listeners.lock().await.remove(&profile_id);
                }
            }
            SocialAction::SetListeningHidden { profile_id, hidden } => {
                if !relations::friends(&mut tx, me, &profile_id).await? {
                    return Err(ApiError::bad("notFriends"));
                }
                let query = if hidden {
                    "INSERT OR IGNORE INTO listening_hidden (owner,viewer) VALUES(?,?)"
                } else {
                    "DELETE FROM listening_hidden WHERE owner = ? AND viewer = ?"
                };
                sqlx::query(query).bind(me).bind(&profile_id).execute(&mut *tx).await?;
                if hidden {
                    // Listening along ends at once, not after the next poll.
                    self.stop_listening_along(&profile_id, me).await;
                }
            }
            SocialAction::SharePlaylist { profile_id, playlist } => {
                super::playlist_shares::share(&mut tx, me, &profile_id, playlist).await?;
            }
            SocialAction::DismissPlaylistShare { share_id } => {
                super::playlist_shares::dismiss(&mut tx, me, &share_id).await?;
            }
            SocialAction::DismissInvite { invitation_id } => {
                sqlx::query("DELETE FROM invitations WHERE id = ? AND recipient = ?")
                    .bind(invitation_id)
                    .bind(me)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        tx.commit().await?;
        self.snapshot_unlocked(me).await
    }
}

async fn invite(conn: &mut SqliteConnection, me: &str, other: &str, code: &str) -> ApiResult<()> {
    if relations::blocked(conn, me, other).await? {
        return Err(ApiError::denied("blocked"));
    }
    if !relations::friends(conn, me, other).await? {
        return Err(ApiError::denied("notFriends"));
    }
    let row = sqlx::query("SELECT * FROM profiles WHERE id = ?")
        .bind(other)
        .fetch_one(&mut *conn)
        .await?;
    if !profiles::options(&row).allow_invites {
        return Err(ApiError::denied("invitesDisabled"));
    }
    let code = normalize_join_code(code).ok_or_else(|| ApiError::bad("roomUnavailable"))?;
    sqlx::query("INSERT INTO invitations (id,sender,recipient,join_code,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(sender,recipient) DO UPDATE SET id = excluded.id, join_code = excluded.join_code, expires_at = excluded.expires_at")
        .bind(Uuid::new_v4().to_string()).bind(me).bind(other).bind(code).bind(server_now_ms() + INVITATION_TTL_MS)
        .execute(conn).await?;
    Ok(())
}
