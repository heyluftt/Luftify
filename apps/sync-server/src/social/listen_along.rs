//! Listening along: a friend follows someone's playback without a room. The
//! follower asks every couple of seconds for what the friend plays and where;
//! the server answers only between friends and only what the friend shares,
//! and remembers who is listening along, so the friend can see it.
use luft_listen_together::{
    server_now_ms,
    social::{LISTENER_TTL_MS, ListenAlongState, PRESENCE_TTL_MS},
};
use sqlx::Row;

use super::{ApiError, ApiResult, Store, profiles::options, relations};

impl Store {
    pub async fn listen_along(&self, me: &str, friend: &str) -> ApiResult<ListenAlongState> {
        if me == friend {
            return Err(ApiError::bad("invalidRequest"));
        }
        let mut conn = self.pool.acquire().await?;
        if !relations::friends(&mut conn, me, friend).await? {
            return Err(ApiError::denied("notFriends"));
        }
        let row = sqlx::query("SELECT * FROM profiles WHERE id = ?").bind(friend).fetch_one(&mut *conn).await?;
        let mut shared = options(&row);
        // Hidden from me alone: nothing to follow.
        if relations::listening_hidden(&mut conn, friend, me).await? {
            shared.share_listening = false;
        }
        drop(conn);
        let now = server_now_ms();
        let presence = {
            let live = self.presence.lock().await;
            let fresh = live.get(friend).filter(|value| now - value.updated_at < PRESENCE_TTL_MS);
            super::activity::visible_presence(&shared, fresh.map(|value| &value.value), row.get("last_seen"))
        };
        if presence.track.is_some() {
            self.listeners.lock().await.entry(friend.to_owned()).or_default().insert(me.to_owned(), now);
            // Listening along, for both sides.
            self.unlock(me, "along").await?;
            self.unlock(friend, "host").await?;
        } else if !presence.online || !shared.share_listening {
            self.stop_listening_along(me, friend).await;
        }
        Ok(ListenAlongState { presence, server_time_ms: now })
    }

    pub async fn stop_listening_along(&self, me: &str, friend: &str) {
        let mut listeners = self.listeners.lock().await;
        if let Some(followers) = listeners.get_mut(friend) {
            followers.remove(me);
            if followers.is_empty() {
                listeners.remove(friend);
            }
        }
    }

    /// Who listens along with `me` right now; `friends` drops anyone no longer a friend.
    pub(super) async fn listeners_of(&self, me: &str, friends: &[String]) -> Vec<String> {
        let now = server_now_ms();
        let listeners = self.listeners.lock().await;
        let mut ids: Vec<String> = listeners
            .get(me)
            .map(|followers| followers.iter()
                .filter(|(id, at)| now - **at < LISTENER_TTL_MS && friends.contains(id))
                .map(|(id, _)| id.clone())
                .collect())
            .unwrap_or_default();
        ids.sort();
        ids
    }

    pub(super) async fn forget_old_listeners(&self) {
        let now = server_now_ms();
        self.listeners.lock().await.retain(|_, followers| {
            followers.retain(|_, at| now - *at < LISTENER_TTL_MS);
            !followers.is_empty()
        });
    }
}
