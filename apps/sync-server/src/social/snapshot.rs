use luft_listen_together::{
    server_now_ms,
    social::{
        FriendEntry, FriendInvitation, FriendRequest, PRESENCE_TTL_MS,
        SocialProfile, SocialSnapshot,
    },
};
use sqlx::Row;

use super::{
    ApiResult, Store,
    profiles::{options, profile},
};

impl Store {
    pub async fn snapshot(&self, me: &str) -> ApiResult<SocialSnapshot> {
        let _lock = self.mutations.lock().await;
        self.snapshot_unlocked(me).await
    }

    pub(super) async fn snapshot_unlocked(&self, me: &str) -> ApiResult<SocialSnapshot> {
        let own = sqlx::query("SELECT * FROM profiles WHERE id = ?")
            .bind(me)
            .fetch_one(&self.pool)
            .await?;
        let friend_rows = sqlx::query("SELECT p.*,f.since AS friend_since FROM friendships f JOIN profiles p ON p.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END WHERE f.a = ? OR f.b = ? ORDER BY p.display_name COLLATE NOCASE,p.id")
            .bind(me).bind(me).bind(me).fetch_all(&self.pool).await?;
        // Pairs where listening is hidden: from me (my choice) or towards me.
        let hidden: Vec<(String, String)> = sqlx::query_as("SELECT owner, viewer FROM listening_hidden WHERE owner = ? OR viewer = ?")
            .bind(me).bind(me).fetch_all(&self.pool).await?;
        let now = server_now_ms();
        let presence = self.presence.lock().await;
        let recent = self.recent.lock().await;
        let friends = friend_rows
            .iter()
            .map(|row| {
                let p = profile(row);
                let mut opts = options(row);
                // This friend hides their listening from me: as if they shared none.
                if hidden.iter().any(|(owner, viewer)| *owner == p.id && viewer == me) {
                    opts.share_listening = false;
                }
                let listening_hidden = hidden.iter().any(|(owner, viewer)| owner == me && *viewer == p.id);
                let fresh = presence
                    .get(&p.id)
                    .filter(|v| now - v.updated_at < PRESENCE_TTL_MS);
                let value = super::activity::visible_presence(&opts, fresh.map(|v| &v.value), row.get("last_seen"));
                let recent = if opts.share_listening {
                    recent.get(&p.id).map(|tracks| tracks.iter().cloned().collect()).unwrap_or_default()
                } else {
                    Vec::new()
                };
                FriendEntry {
                    profile: p,
                    presence: value,
                    recent,
                    since_ms: row.get("friend_since"),
                    listening_hidden,
                }
            })
            .collect();
        let friend_ids: Vec<String> = friend_rows.iter().map(|row| row.get("id")).collect();
        let own_recent = if options(&own).share_listening {
            recent.get(me).map(|tracks| tracks.iter().cloned().collect()).unwrap_or_default()
        } else {
            Vec::new()
        };
        drop(recent);
        drop(presence);
        let incoming_requests = self.requests(me, true).await?;
        let outgoing_requests = self.requests(me, false).await?;
        let rows = sqlx::query("SELECT p.*,i.id AS invitation_id,i.join_code,i.expires_at FROM invitations i JOIN profiles p ON p.id = i.sender WHERE i.recipient = ? AND i.expires_at > ? AND EXISTS(SELECT 1 FROM friendships f WHERE (f.a = i.sender AND f.b = i.recipient) OR (f.a = i.recipient AND f.b = i.sender)) ORDER BY i.expires_at DESC LIMIT 200")
            .bind(me).bind(now).fetch_all(&self.pool).await?;
        let invitations = if options(&own).allow_invites {
            rows.iter()
                .map(|row| FriendInvitation {
                    id: row.get("invitation_id"),
                    from: profile(row),
                    join_code: row.get("join_code"),
                    expires_at_ms: row.get("expires_at"),
                })
                .collect()
        } else {
            Vec::new()
        };
        let blocked = sqlx::query("SELECT p.* FROM blocks b JOIN profiles p ON p.id = b.blocked WHERE b.blocker = ? ORDER BY p.display_name COLLATE NOCASE,p.id")
            .bind(me).fetch_all(&self.pool).await?.iter().map(profile).collect();
        let (achievements, achievement_progress) = self.review_achievements(me, &own, friend_ids.len()).await?;
        Ok(SocialSnapshot {
            playlist_accounts: std::iter::once(&own).chain(friend_rows.iter()).filter_map(|row| {
                let account_key: Option<String> = row.get("playlist_account");
                account_key.map(|account_key| luft_listen_together::social::PlaylistAccount { profile_id: row.get("id"), account_key })
            }).collect(),
            me: SocialProfile { achievements, ..profile(&own) },
            achievement_progress,
            options: options(&own),
            friends,
            incoming_requests,
            outgoing_requests,
            invitations,
            blocked,
            server: None,
            badges: self.badge_catalog().await?,
            recent: own_recent,
            listeners: self.listeners_of(me, &friend_ids).await,
            announcement: self.server_settings().await?.announcement,
            playlist_shares: self.playlist_shares(me, options(&own).allow_invites).await?,
        })
    }

    async fn requests(&self, me: &str, incoming: bool) -> ApiResult<Vec<FriendRequest>> {
        let query = if incoming {
            "SELECT p.*,r.id AS request_id,r.created_at FROM requests r JOIN profiles p ON p.id = r.sender WHERE r.recipient = ? AND r.created_at > ? ORDER BY r.created_at DESC LIMIT 100"
        } else {
            "SELECT p.*,r.id AS request_id,r.created_at FROM requests r JOIN profiles p ON p.id = r.recipient WHERE r.sender = ? AND r.created_at > ? ORDER BY r.created_at DESC LIMIT 100"
        };
        let rows = sqlx::query(query)
            .bind(me)
            .bind(server_now_ms() - 30 * 24 * 60 * 60_000_i64)
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|row| FriendRequest {
                id: row.get("request_id"),
                profile: profile(row),
                created_at_ms: row.get("created_at"),
            })
            .collect())
    }
}
