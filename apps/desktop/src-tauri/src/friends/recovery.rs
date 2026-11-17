//! Recovery code: show it to write down, make a new one, or bring a profile
//! to this device. The code is a secret: never logged, never in diagnostics.
use luft_listen_together::{
    SocialRegistration,
    recovery::{RecoveryCode, normalize_recovery_code},
};
use reqwest::Method;

use super::{
    credentials::Credential,
    http,
    service::{FriendsService, FriendsStatus, authenticated},
};

impl FriendsService {
    /// The code kept on this device, or a new one when there is none yet or
    /// `renew` asks for it (the old one then stops working).
    pub async fn recovery_code(&self, renew: bool) -> Result<String, String> {
        let mut session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        if credential.profile_id.is_none() {
            return Err("friends.error.inactive".into());
        }
        if let Some(code) = credential.recovery.clone().filter(|_| !renew) {
            return Ok(code);
        }
        let created: RecoveryCode = http::request(
            &self.runtime.client,
            endpoint,
            Method::POST,
            "recovery",
            Some(&credential.token),
            None::<&()>,
            None,
        )
        .await?;
        let code = normalize_recovery_code(&created.code).ok_or("friends.error.protocol")?;
        let credential = session.credential.as_mut().ok_or("friends.error.inactive")?;
        credential.recovery = Some(code.clone());
        self.runtime.store.save(credential).await?;
        Ok(code)
    }

    /// Signs this device in to the profile with `code`. A profile already on
    /// this device stays on the server and needs its own code to come back.
    pub async fn restore(&self, code: String) -> Result<FriendsStatus, String> {
        let code = normalize_recovery_code(&code).ok_or("friends.error.invalidRecoveryCode")?;
        self.stop_listen_along(None).await;
        let mut session = self.runtime.session.lock().await;
        let endpoint = session.endpoint.clone().ok_or("friends.error.invalidUrl")?;
        let key = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let registration: SocialRegistration = http::request(
            &self.runtime.client,
            &endpoint,
            Method::POST,
            "restore",
            Some(&key),
            Some(&RecoveryCode { code: code.clone() }),
            None,
        )
        .await?;
        if registration.token != key {
            return Err("friends.error.protocol".into());
        }
        if session.credential.as_ref().is_some_and(|old| old.profile_id.as_deref() != Some(&registration.snapshot.me.id)) {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(2), self.offline(&session)).await;
        }
        let credential = Credential {
            endpoint: endpoint.to_string(),
            profile_id: Some(registration.snapshot.me.id.clone()),
            token: key,
            recovery: Some(code),
        };
        self.runtime.store.save(&credential).await?;
        // Before the next heartbeat: it would otherwise send this device's old
        // name and picture to the restored profile.
        self.adopt_profile(&registration.snapshot.me).await;
        session.credential = Some(credential);
        session.credential_error = None;
        session.snapshot = Some(registration.snapshot);
        self.publish(&session, true, None);
        Ok(self.status())
    }

    async fn adopt_profile(&self, me: &luft_listen_together::SocialProfile) {
        let Ok(database) = self.runtime.database.get().await else { return };
        let Ok(mut settings) = database.settings().await else { return };
        settings.listen_together.display_name = me.display_name.clone();
        settings.listen_together.avatar_uri = me.avatar_uri.clone();
        let _ = database.save_settings(&settings).await;
    }
}
