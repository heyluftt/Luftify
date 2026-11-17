use axum::http::HeaderMap;
use luft_listen_together::{
    server_now_ms,
    social::{
        MAX_RECENT_TRACKS, RecentTrack, SocialOptions, SocialProfile, SocialProfileInput,
        SocialRegistration, parse_roles,
    },
};
use sha2::{Digest, Sha256};
use sqlx::{Row, sqlite::SqliteRow};
use uuid::Uuid;

use super::{ApiError, ApiResult, Store};

pub(super) fn profile(row: &SqliteRow) -> SocialProfile {
    SocialProfile {
        id: row.get("id"),
        friend_code: row.get("friend_code"),
        display_name: row.get("display_name"),
        avatar_uri: row.get("avatar_uri"),
        roles: parse_roles(row.get("roles")),
        badges: luft_listen_together::badges::parse_badge_ids(row.get("badges")),
        bio: row.get("bio"),
        style: style(row),
        // Stored as JSON; anything unreadable just shows no song.
        favorite: row
            .get::<Option<String>, _>("favorite")
            .and_then(|json| serde_json::from_str(&json).ok()),
        achievements: super::achievements::unlocked(row).into_iter().map(|(id, _)| id).collect(),
    }
}

/// The full look as JSON; profiles from before only have accent and banner.
fn style(row: &SqliteRow) -> Option<luft_listen_together::ProfileStyle> {
    if let Some(look) = row
        .get::<Option<String>, _>("look")
        .and_then(|json| serde_json::from_str::<luft_listen_together::ProfileStyle>(&json).ok())
    {
        return Some(look).filter(|style| style.valid());
    }
    let accent: Option<String> = row.get("accent");
    let banner: Option<String> = row.get("banner");
    Some(luft_listen_together::ProfileStyle { accent: accent?, banner: banner?, ..Default::default() }).filter(|style| style.valid())
}

pub(super) fn options(row: &SqliteRow) -> SocialOptions {
    SocialOptions {
        discoverable: row.get("discoverable"),
        share_online: row.get("share_online"),
        share_listening: row.get("share_listening"),
        allow_invites: row.get("allow_invites"),
        presence_mode: luft_listen_together::social::PresenceMode::from_key(
            row.get::<Option<String>, _>("presence_mode").as_deref().unwrap_or("auto"),
        ),
    }
}

pub(super) fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

impl Store {
    #[cfg(test)]
    pub async fn register(&self, input: SocialProfileInput) -> ApiResult<SocialRegistration> {
        self.register_with_key(input, None).await
    }

    pub async fn register_with_key(
        &self,
        mut input: SocialProfileInput,
        key: Option<&str>,
    ) -> ApiResult<SocialRegistration> {
        if !input.validate() {
            return Err(ApiError::bad("invalidProfile"));
        }
        if key.is_some_and(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit())) {
            return Err(ApiError::bad("invalidProfile"));
        }
        let _lock = self.mutations.lock().await;
        if let Some(token) = key {
            if let Some(id) =
                sqlx::query_scalar::<_, String>("SELECT id FROM profiles WHERE token_hash = ?")
                    .bind(token_hash(token))
                    .fetch_optional(&self.pool)
                    .await?
            {
                return Ok(SocialRegistration {
                    token: token.into(),
                    snapshot: self.snapshot_unlocked(&id).await?,
                });
            }
        }
        // Luft can close sign-ups; the very first profile (Luft's own) always works.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
            .fetch_one(&self.pool)
            .await?;
        if count > 0 && !self.server_settings().await?.signups_open {
            return Err(ApiError::denied("signupsClosed"));
        }
        if count >= 10_000 {
            return Err(ApiError::limited());
        }
        let id = Uuid::new_v4().to_string();
        // Separate 256-bit credential. Codes and UUIDs cannot authenticate a profile.
        let token = key
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));
        let hash = token_hash(&token);
        loop {
            let code = format!(
                "LF-{}",
                &Uuid::new_v4().simple().to_string()[..10].to_ascii_uppercase()
            );
            let inserted = sqlx::query("INSERT OR IGNORE INTO profiles (id,friend_code,display_name,search_name,avatar_uri,token_hash) VALUES(?,?,?,?,?,?)")
                .bind(&id).bind(code).bind(&input.display_name).bind(input.display_name.to_lowercase()).bind(&input.avatar_uri).bind(&hash)
                .execute(&self.pool).await?.rows_affected();
            if inserted != 0 {
                break;
            }
        }
        Ok(SocialRegistration {
            token,
            snapshot: self.snapshot_unlocked(&id).await?,
        })
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> ApiResult<String> {
        Ok(self.authenticate_device(headers).await?.0)
    }

    /// The profile and which of its devices asks (`main` for the first one).
    pub async fn authenticate_device(&self, headers: &HeaderMap) -> ApiResult<(String, String)> {
        let token = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(ApiError::unauthorized)?;
        let row: Option<(String, i64)> = sqlx::query_as("SELECT id, suspended FROM profiles WHERE token_hash = ?")
            .bind(token_hash(token))
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some((_, suspended)) if suspended != 0 => Err(ApiError::denied("suspended")),
            Some((id, _)) => Ok((id, super::devices::MAIN_DEVICE.into())),
            None => match self.linked_device(token).await? {
                Some((_, true, _)) => Err(ApiError::denied("suspended")),
                Some((id, false, device)) => Ok((id, device)),
                None => Err(ApiError::unauthorized()),
            },
        }
    }

    pub async fn search(&self, me: &str, text: &str) -> ApiResult<Vec<SocialProfile>> {
        let text = text.trim();
        if !(2..=32).contains(&text.chars().count()) || text.chars().any(char::is_control) {
            return Err(ApiError::bad("invalidQuery"));
        }
        let escaped = text
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let rows = sqlx::query("SELECT p.* FROM profiles p WHERE p.id != ? AND p.discoverable = 1 AND (p.search_name LIKE ? ESCAPE '\\' OR p.friend_code = ?) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker = ? AND b.blocked = p.id) OR (b.blocker = p.id AND b.blocked = ?)) ORDER BY p.display_name COLLATE NOCASE,p.id LIMIT 20")
            .bind(me).bind(format!("%{escaped}%")).bind(text.to_ascii_uppercase()).bind(me).bind(me).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(profile).collect())
    }

    #[cfg(test)]
    pub async fn update_presence(
        &self,
        me: &str,
        update: luft_listen_together::social::PresenceUpdate,
    ) -> ApiResult<luft_listen_together::social::SocialSnapshot> {
        self.update_presence_from(me, super::devices::MAIN_DEVICE, update).await
    }

    /// With several devices, friends see the one chosen in device_presence.rs.
    pub async fn update_presence_from(
        &self,
        me: &str,
        device: &str,
        update: luft_listen_together::social::PresenceUpdate,
    ) -> ApiResult<luft_listen_together::social::SocialSnapshot> {
        let _lock = self.mutations.lock().await;
        let row = sqlx::query("SELECT * FROM profiles WHERE id = ?")
            .bind(me)
            .fetch_one(&self.pool)
            .await?;
        let options = options(&row);
        let shared = update.online && update.is_playing && options.share_listening;
        let value = luft_listen_together::social::FriendPresence {
            online: update.online && options.share_online,
            position_ms: update.position_ms.filter(|_| shared).map(|position| position.min(24 * 60 * 60 * 1_000)),
            position_at_ms: shared.then(server_now_ms),
            track: if shared {
                update
                    .track
                    .and_then(luft_listen_together::TrackRef::sanitize)
            } else {
                None
            },
            is_playing: update.online && update.is_playing && options.share_listening,
            // Raw idleness; the options decide at read time what friends see.
            activity: if update.away {
                luft_listen_together::social::Activity::Away
            } else {
                luft_listen_together::social::Activity::Online
            },
            last_seen_ms: None,
        };
        // Written at most once a minute while online, and once on going offline.
        let now = server_now_ms();
        sqlx::query("UPDATE profiles SET last_seen = ? WHERE id = ? AND (? OR last_seen IS NULL OR last_seen < ?)")
            .bind(now)
            .bind(me)
            .bind(!update.online)
            .bind(now - 60_000)
            .execute(&self.pool)
            .await?;
        if let Some(version) = luft_listen_together::admin::clean_app_version(update.app_version.clone()) {
            self.remember_version(me, update.app_platform.as_deref() == Some("android"), version).await?;
        }
        let shown = self.report_device(me, device, update.online, value.clone()).await;
        // Recent tracks come only from the device friends see.
        if shown.as_deref() == Some(device) {
            self.remember_track(me, &options, &value).await;
        }
        self.snapshot_unlocked(me).await
    }

    /// The last version per app stays for Luft's overview, also offline;
    /// written only when it changes.
    async fn remember_version(&self, me: &str, phone: bool, version: String) -> ApiResult<()> {
        let key = if phone { format!("{me}:android") } else { me.to_string() };
        let mut versions = self.versions.lock().await;
        if versions.get(&key) == Some(&version) {
            return Ok(());
        }
        let query = if phone { "UPDATE profiles SET phone_version = ? WHERE id = ?" } else { "UPDATE profiles SET app_version = ? WHERE id = ?" };
        sqlx::query(query).bind(&version).bind(me).execute(&self.pool).await?;
        versions.insert(key, version);
        Ok(())
    }

    /// Keeps the last few shared tracks; a paused or repeated track adds nothing.
    async fn remember_track(
        &self,
        me: &str,
        options: &SocialOptions,
        value: &luft_listen_together::social::FriendPresence,
    ) {
        let mut recent = self.recent.lock().await;
        if !options.share_listening {
            recent.remove(me);
            return;
        }
        let Some(track) = value.track.as_ref().filter(|_| value.is_playing) else {
            return;
        };
        let tracks = recent.entry(me.into()).or_default();
        if tracks.front().is_some_and(|last| last.track.uri == track.uri) {
            return;
        }
        tracks.retain(|entry| entry.track.uri != track.uri);
        tracks.push_front(RecentTrack {
            track: track.clone(),
            played_at_ms: server_now_ms(),
        });
        tracks.truncate(MAX_RECENT_TRACKS);
    }
}
