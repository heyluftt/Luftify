use super::{
    http,
    presence::presence,
    service::{FriendsService, Session, authenticated},
};
use luft_listen_together::{
    PresenceUpdate, RoomProof, SocialAction, SocialProfileInput, SocialSnapshot,
};
use reqwest::Method;
use std::time::Duration;
use tokio::sync::watch;

impl FriendsService {
    pub(super) async fn run(&self, server_url: String, mut stop: watch::Receiver<bool>) {
        self.set_server_url(server_url).await;
        let mut timer = tokio::time::interval(Duration::from_secs(12));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // While friends listen along, a changed song, pause or jump goes out
        // within about a second instead of with the next heartbeat.
        let mut quick = tokio::time::interval(Duration::from_secs(1));
        quick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                biased;
                _ = stop.changed() => break,
                _ = quick.tick() => {
                    if !self.status().snapshot.as_ref().is_some_and(|snapshot| !snapshot.listeners.is_empty()) { continue; }
                    let Ok(Ok(playback)) = tokio::time::timeout(Duration::from_secs(1), self.runtime.provider.get_state()).await else { continue; };
                    if !self.presence_changed(&playback) { continue; }
                    let mut session = self.runtime.session.lock().await;
                    if let Err(error) = self.refresh(&mut session).await {
                        self.publish(&session, false, Some(error));
                    }
                }
                _ = timer.tick() => {
                    let refresh = async {
                        let mut session = self.runtime.session.lock().await;
                        if !session.credential.as_ref().is_some_and(|credential| credential.profile_id.is_some())
                            || session.credential_error.is_some() { return; }
                        if let Err(error) = self.refresh(&mut session).await {
                            self.publish(&session, false, Some(error));
                        }
                    };
                    tokio::select! { biased; _ = stop.changed() => break, _ = refresh => {} }
                }
            }
        }
    }

    pub(super) async fn refresh(&self, session: &mut Session) -> Result<(), String> {
        if session.snapshot.is_none() {
            let (endpoint, credential) = authenticated(session)?;
            let snapshot: SocialSnapshot = http::request(
                &self.runtime.client,
                endpoint,
                Method::GET,
                "me",
                Some(&credential.token),
                None::<&()>,
                None,
            )
            .await?;
            if Some(&snapshot.me.id) != credential.profile_id.as_ref() {
                return Err("friends.error.protocol".into());
            }
            session.snapshot = Some(snapshot);
        }
        let saved_profile = match self.runtime.database.get().await {
            Ok(database) => database
                .settings()
                .await
                .ok()
                .map(|settings| SocialProfileInput {
                    display_name: settings.listen_together.display_name,
                    avatar_uri: settings.listen_together.avatar_uri,
                }),
            Err(_) => None,
        };
        if let Some(mut profile) = saved_profile {
            let snapshot = session.snapshot.as_ref().unwrap();
            if profile.validate()
                && (profile.display_name != snapshot.me.display_name
                    || profile.avatar_uri != snapshot.me.avatar_uri)
            {
                let action = SocialAction::UpdateProfile { profile };
                let (endpoint, credential) = authenticated(session)?;
                session.snapshot = Some(
                    http::request(
                        &self.runtime.client,
                        endpoint,
                        Method::POST,
                        "action",
                        Some(&credential.token),
                        Some(&action),
                        None,
                    )
                    .await?,
                );
            }
        }
        let options = &session.snapshot.as_ref().unwrap().options;
        // Read locally for idleness too; only presence() decides what is sent.
        let playback = tokio::time::timeout(Duration::from_secs(2), self.runtime.provider.get_state())
            .await
            .ok()
            .and_then(Result::ok);
        let mut update = presence(options, playback.as_ref());
        // Only Luft sees it, to know who still runs an old version.
        update.app_version = Some(self.runtime.app.package_info().version.to_string());
        *self.runtime.presence_memo.lock().unwrap() = Some(super::service::PresenceMemo {
            uri: update.track.as_ref().map(|track| track.uri.clone()),
            is_playing: update.is_playing,
            position_ms: update.position_ms.unwrap_or(0),
            at: std::time::Instant::now(),
        });
        update.away = super::idle::is_away(super::idle::idle_ms(), playback.as_ref().is_some_and(|state| state.is_playing));
        // The room only accepts roles with the member's private proof, and only
        // for a room on this same server.
        let proof = tokio::time::timeout(Duration::from_secs(1), self.runtime.room.invitation_proof())
            .await
            .ok()
            .flatten();
        update.room = proof
            .filter(|(_, _, server_url)| *server_url == session.server_url)
            .map(|(join_code, room_token, _)| RoomProof { join_code, room_token });
        let (endpoint, credential) = authenticated(session)?;
        session.snapshot = Some(
            http::request(
                &self.runtime.client,
                endpoint,
                Method::POST,
                "presence",
                Some(&credential.token),
                Some(&update),
                None,
            )
            .await?,
        );
        self.publish(session, true, None);
        Ok(())
    }

    /// Whether the song, play/pause or the position moved away from the last presence.
    fn presence_changed(&self, playback: &luft_core::PlaybackState) -> bool {
        let memo = self.runtime.presence_memo.lock().unwrap().clone();
        let Some(memo) = memo else { return true };
        let uri = playback.current_item.as_ref().map(|item| item.uri.as_str());
        if uri != memo.uri.as_deref() || playback.is_playing != memo.is_playing {
            return true;
        }
        let expected = memo.position_ms as i64 + if memo.is_playing { memo.at.elapsed().as_millis() as i64 } else { 0 };
        playback.is_playing && (playback.position_ms as i64 - expected).abs() > 2_000
    }

    pub(super) async fn offline(&self, session: &Session) -> Result<(), String> {
        let (endpoint, credential) = authenticated(session)?;
        let update = PresenceUpdate {
            online: false,
            track: None,
            is_playing: false,
            away: false,
            room: None,
            position_ms: None,
            app_version: None,
            app_platform: None,
        };
        let _: SocialSnapshot = http::request(
            &self.runtime.client,
            endpoint,
            Method::POST,
            "presence",
            Some(&credential.token),
            Some(&update),
            None,
        )
        .await?;
        Ok(())
    }
}
