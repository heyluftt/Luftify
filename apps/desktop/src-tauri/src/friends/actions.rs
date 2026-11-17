use super::{
    credentials::Credential,
    http,
    service::{FriendsService, FriendsStatus, authenticated, is_connection_error},
};
use luft_listen_together::{
    SocialAction, SocialProfile, SocialProfileInput, SocialRegistration, SocialSnapshot,
};
use reqwest::Method;

impl FriendsService {
    pub async fn activate(&self, mut profile: SocialProfileInput) -> Result<FriendsStatus, String> {
        if !profile.validate() {
            return Err("friends.error.invalidProfile".into());
        }
        let mut session = self.runtime.session.lock().await;
        if session
            .credential
            .as_ref()
            .is_some_and(|credential| credential.profile_id.is_some())
        {
            let credential = session.credential.as_ref().unwrap();
            self.runtime.store.save(credential).await?;
            session.credential_error = None;
            match self.refresh(&mut session).await {
                Ok(()) => return Ok(self.status()),
                // The server no longer knows this profile (e.g. its database was
                // replaced): register again below with the same private key.
                Err(error) if error == "friends.error.unauthorized" => {
                    session.snapshot = None;
                    session.credential.as_mut().unwrap().profile_id = None;
                }
                Err(error) => return Err(error),
            }
        }
        if let Some(error) = &session.credential_error {
            return Err(error.clone());
        }
        let endpoint = session
            .endpoint
            .as_ref()
            .ok_or("friends.error.invalidUrl")?
            .clone();
        // Check compatibility/reachability before provisioning a durable identity.
        let probe: Result<SocialSnapshot, String> = http::request(
            &self.runtime.client,
            &endpoint,
            Method::GET,
            "me",
            None,
            None::<&()>,
            None,
        )
        .await;
        match probe {
            Err(error) if error == "friends.error.unauthorized" => {}
            Err(error) => {
                self.publish(&session, false, Some(error.clone()));
                return Err(error);
            }
            Ok(_) => return Err("friends.error.protocol".into()),
        }
        if session.credential.is_none() {
            let credential = Credential {
                endpoint: endpoint.to_string(),
                profile_id: None,
                token: format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                ),
                recovery: None,
            };
            self.runtime.store.save(&credential).await?;
            session.credential = Some(credential);
        }
        let registration: Result<SocialRegistration, String> = http::request(
            &self.runtime.client,
            &endpoint,
            Method::POST,
            "register",
            Some(&session.credential.as_ref().unwrap().token),
            Some(&profile),
            None,
        )
        .await;
        let registration = match registration {
            Ok(registration) => registration,
            Err(error) => {
                self.publish(&session, false, Some(error.clone()));
                return Err(error);
            }
        };
        if registration.token != session.credential.as_ref().unwrap().token {
            return Err("friends.error.protocol".into());
        }
        session.credential.as_mut().unwrap().profile_id = Some(registration.snapshot.me.id.clone());
        if let Err(error) = self
            .runtime
            .store
            .save(session.credential.as_ref().unwrap())
            .await
        {
            session.credential_error = Some(error.clone());
            self.publish(&session, false, Some(error.clone()));
            return Err(error);
        }
        session.snapshot = Some(registration.snapshot);
        self.publish(&session, true, None);
        Ok(self.status())
    }

    pub async fn search(&self, query: String) -> Result<Vec<SocialProfile>, String> {
        let query = query.trim();
        if query.chars().count() < 2
            || query.chars().count() > 32
            || query.chars().any(char::is_control)
        {
            return Err("friends.error.invalidSearch".into());
        }
        let session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        http::request(
            &self.runtime.client,
            endpoint,
            Method::GET,
            "search",
            Some(&credential.token),
            None::<&()>,
            Some(query),
        )
        .await
    }

    pub async fn action(&self, action: SocialAction) -> Result<FriendsStatus, String> {
        if matches!(action, SocialAction::Invite { .. }) {
            return Err("friends.error.invalidMessage".into());
        }
        self.trusted_action(action).await
    }

    pub(crate) async fn trusted_action(
        &self,
        action: SocialAction,
    ) -> Result<FriendsStatus, String> {
        let mut session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        let result = http::request(
            &self.runtime.client,
            endpoint,
            Method::POST,
            "action",
            Some(&credential.token),
            Some(&action),
            None,
        )
        .await;
        match result {
            Ok(snapshot) => {
                session.snapshot = Some(snapshot);
                self.publish(&session, true, None);
                Ok(self.status())
            }
            Err(error) => {
                // Validation errors don't turn a reachable server into an offline server.
                if is_connection_error(&error) {
                    self.publish(&session, false, Some(error.clone()));
                }
                Err(error)
            }
        }
    }
}
