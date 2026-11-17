//! More devices for one profile. The profile's own token stays its first
//! device; further devices have their own tokens in `devices`, each added
//! with a one-time link code that lives only in memory for ten minutes.
use luft_listen_together::{
    devices::{
        DeviceLink, LINK_CODE_TTL_MS, LinkedDevice, MAX_LINKED_DEVICES, clean_device_label, generate_link_code,
        normalize_link_code,
    },
    server_now_ms,
    social::SocialRegistration,
};
use sqlx::Row;

use super::{ApiError, ApiResult, Store, profiles::token_hash};

/// The first device in presence and in the list.
pub(super) const MAIN_DEVICE: &str = "main";
/// The public handle of a device: the start of its token hash.
const HANDLE_LEN: usize = 12;

fn handle(hash: &str) -> String {
    hash[..HANDLE_LEN].to_owned()
}

impl Store {
    /// A linked device's profile and handle, if the token is one; the last
    /// sighting is written at most once a minute.
    pub(super) async fn linked_device(&self, token: &str) -> ApiResult<Option<(String, bool, String)>> {
        let hash = token_hash(token);
        let row = sqlx::query("SELECT p.id, p.suspended, d.last_seen FROM devices d JOIN profiles p ON p.id = d.profile_id WHERE d.token_hash = ?")
            .bind(&hash).fetch_optional(&self.pool).await?;
        let Some(row) = row else { return Ok(None) };
        let now = server_now_ms();
        if row.get::<Option<i64>, _>("last_seen").is_none_or(|seen| seen < now - 60_000) {
            sqlx::query("UPDATE devices SET last_seen = ? WHERE token_hash = ?").bind(now).bind(&hash).execute(&self.pool).await?;
        }
        Ok(Some((row.get("id"), row.get::<i64, _>("suspended") != 0, handle(&hash))))
    }

    /// A fresh code for this profile; an older one stops working.
    pub async fn new_link_code(&self, me: &str) -> ApiResult<DeviceLink> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE profile_id = ?").bind(me).fetch_one(&self.pool).await?;
        if count as usize >= MAX_LINKED_DEVICES {
            return Err(ApiError::denied("tooManyDevices"));
        }
        let code = generate_link_code();
        let expires_at_ms = server_now_ms() + LINK_CODE_TTL_MS;
        let mut links = self.links.lock().await;
        links.retain(|_, (owner, until)| owner != me && *until > server_now_ms());
        links.insert(code.clone(), (me.to_owned(), expires_at_ms));
        Ok(DeviceLink { code, expires_at_ms })
    }

    /// Redeems a code once: the new device signs in with `key` as its token.
    pub async fn redeem_link_code(&self, code: &str, label: &str, key: Option<&str>) -> ApiResult<SocialRegistration> {
        let key = key
            .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| ApiError::bad("invalidProfile"))?;
        let label = clean_device_label(label).ok_or_else(|| ApiError::bad("invalidDevice"))?;
        let code = normalize_link_code(code).ok_or_else(|| ApiError::bad("invalidLinkCode"))?;
        let profile = {
            let mut links = self.links.lock().await;
            match links.remove(&code) {
                Some((profile, until)) if until > server_now_ms() => profile,
                _ => return Err(ApiError::missing("invalidLinkCode")),
            }
        };
        let _lock = self.mutations.lock().await;
        let suspended: Option<i64> = sqlx::query_scalar("SELECT suspended FROM profiles WHERE id = ?").bind(&profile).fetch_optional(&self.pool).await?;
        match suspended {
            None => return Err(ApiError::missing("invalidLinkCode")),
            Some(value) if value != 0 => return Err(ApiError::denied("suspended")),
            Some(_) => {}
        }
        let hash = token_hash(key);
        let taken: i64 = sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM profiles WHERE token_hash = ?1) + (SELECT COUNT(*) FROM devices WHERE token_hash = ?1)")
            .bind(&hash).fetch_one(&self.pool).await?;
        if taken > 0 {
            return Err(ApiError::bad("invalidProfile"));
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE profile_id = ?").bind(&profile).fetch_one(&self.pool).await?;
        if count as usize >= MAX_LINKED_DEVICES {
            return Err(ApiError::denied("tooManyDevices"));
        }
        let now = server_now_ms();
        sqlx::query("INSERT INTO devices (token_hash, profile_id, label, created_at, last_seen) VALUES (?, ?, ?, ?, ?)")
            .bind(&hash).bind(&profile).bind(&label).bind(now).bind(now).execute(&self.pool).await?;
        Ok(SocialRegistration { token: key.into(), snapshot: self.snapshot_unlocked(&profile).await? })
    }

    /// The other devices of this profile, newest first, and which one asks.
    pub async fn devices(&self, me: &str, current: &str) -> ApiResult<Vec<LinkedDevice>> {
        let rows = sqlx::query("SELECT token_hash, label, created_at, last_seen FROM devices WHERE profile_id = ? ORDER BY created_at DESC")
            .bind(me).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(|row| {
            let id = handle(&row.get::<String, _>("token_hash"));
            LinkedDevice {
                current: id == current,
                id,
                label: row.get("label"),
                created_at_ms: row.get("created_at"),
                last_seen_ms: row.get("last_seen"),
            }
        }).collect())
    }

    /// Signs one linked device out; it can remove itself, too.
    pub async fn remove_device(&self, me: &str, id: &str) -> ApiResult<()> {
        if id.len() != HANDLE_LEN || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(ApiError::bad("invalidDevice"));
        }
        let done = sqlx::query("DELETE FROM devices WHERE profile_id = ? AND substr(token_hash, 1, ?) = ?")
            .bind(me).bind(HANDLE_LEN as i64).bind(id.to_ascii_lowercase()).execute(&self.pool).await?;
        if done.rows_affected() == 0 {
            return Err(ApiError::missing("invalidDevice"));
        }
        self.forget_device_presence(me, Some(&id.to_ascii_lowercase())).await;
        Ok(())
    }
}
