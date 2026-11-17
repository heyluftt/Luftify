//! Recovery code: a profile moves to a new device. Only a hash is stored;
//! the code itself is returned once to its owner and never logged.
use luft_listen_together::{
    recovery::{generate_recovery_code, normalize_recovery_code},
    social::SocialRegistration,
};
use sha2::{Digest, Sha256};

use super::{ApiError, ApiResult, Store};

fn recovery_hash(code: &str) -> String {
    format!("{:x}", Sha256::digest(format!("luftify-recovery:{code}").as_bytes()))
}

impl Store {
    /// A new code for this profile; the previous one stops working.
    pub async fn new_recovery_code(&self, me: &str) -> ApiResult<String> {
        let code = generate_recovery_code();
        let _lock = self.mutations.lock().await;
        sqlx::query("UPDATE profiles SET recovery_hash = ? WHERE id = ?")
            .bind(recovery_hash(&code))
            .bind(me)
            .execute(&self.pool)
            .await?;
        Ok(code)
    }

    /// The profile with this code now signs in with `key`; the old device is
    /// signed out. The code stays valid until a new one is made.
    pub async fn restore(&self, code: &str, key: Option<&str>) -> ApiResult<SocialRegistration> {
        let key = key
            .filter(|v| v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| ApiError::bad("invalidProfile"))?;
        let code = normalize_recovery_code(code).ok_or_else(|| ApiError::bad("invalidRecoveryCode"))?;
        let _lock = self.mutations.lock().await;
        let row: Option<(String, i64)> = sqlx::query_as("SELECT id, suspended FROM profiles WHERE recovery_hash = ?")
            .bind(recovery_hash(&code))
            .fetch_optional(&self.pool)
            .await?;
        let id = match row {
            Some((_, suspended)) if suspended != 0 => return Err(ApiError::denied("suspended")),
            Some((id, _)) => id,
            None => return Err(ApiError::missing("invalidRecoveryCode")),
        };
        let hash = super::profiles::token_hash(key);
        let taken: Option<String> = sqlx::query_scalar("SELECT id FROM profiles WHERE token_hash = ?")
            .bind(&hash)
            .fetch_optional(&self.pool)
            .await?;
        if taken.is_some_and(|other| other != id) {
            return Err(ApiError::bad("invalidProfile"));
        }
        sqlx::query("UPDATE profiles SET token_hash = ? WHERE id = ?")
            .bind(&hash)
            .bind(&id)
            .execute(&self.pool)
            .await?;
        // The old device's session is gone.
        self.forget_device_presence(&id, None).await;
        self.versions.lock().await.remove(&id);
        Ok(SocialRegistration { token: key.into(), snapshot: self.snapshot_unlocked(&id).await? })
    }
}
