use luft_core::SpotifyProvider;
use luft_infrastructure::DatabaseHandle;
use luft_listen_together::SocialSnapshot;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, watch};
use url::Url;

use crate::listen_together::ListenTogetherService;

use super::{
    credentials::{Credential, CredentialStore},
    endpoint::social_endpoint,
    http,
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsStatus {
    pub server_url: String,
    pub connection: String,
    pub snapshot: Option<SocialSnapshot>,
    pub error: Option<String>,
    /// Listening along with a friend (listen_along.rs).
    #[serde(default)]
    pub listen_along: Option<super::listen_along::ListenAlongStatus>,
}

/// What the last presence said, to send the next one early when it changes.
#[derive(Clone)]
pub(super) struct PresenceMemo {
    pub uri: Option<String>,
    pub is_playing: bool,
    pub position_ms: u64,
    pub at: std::time::Instant,
}

pub(super) struct Session {
    pub server_url: String,
    pub endpoint: Option<Url>,
    pub credential: Option<Credential>,
    pub snapshot: Option<SocialSnapshot>,
    pub credential_error: Option<String>,
}

pub(super) struct Runtime {
    pub app: AppHandle,
    pub provider: Arc<dyn SpotifyProvider>,
    pub room: ListenTogetherService,
    pub database: DatabaseHandle,
    pub store: CredentialStore,
    pub client: Client,
    pub session: Mutex<Session>,
    pub status: watch::Sender<FriendsStatus>,
    pub stop: watch::Sender<bool>,
    pub listen_along: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub along_control: Mutex<()>,
    pub presence_memo: std::sync::Mutex<Option<PresenceMemo>>,
    /// The open remote-control connection (remote.rs).
    pub remote: Mutex<Option<tokio::sync::mpsc::UnboundedSender<luft_listen_together::remote::RemoteClientMessage>>>,
}

#[derive(Clone)]
pub struct FriendsService {
    pub(super) runtime: Arc<Runtime>,
}

impl FriendsService {
    pub fn start(
        app: AppHandle,
        provider: Arc<dyn SpotifyProvider>,
        room: ListenTogetherService,
        database: DatabaseHandle,
        data: &std::path::Path,
        server_url: String,
    ) -> Result<Self, String> {
        let (status, _) = watch::channel(FriendsStatus {
            server_url: server_url.clone(),
            connection: "inactive".into(),
            snapshot: None,
            error: None,
            listen_along: None,
        });
        let (stop, stop_rx) = watch::channel(false);
        let service = Self {
            runtime: Arc::new(Runtime {
                app,
                provider,
                room,
                database,
                store: CredentialStore::new(data),
                client: http::client()?,
                status,
                stop,
                listen_along: Mutex::new(None),
                along_control: Mutex::new(()),
                presence_memo: std::sync::Mutex::new(None),
                remote: Mutex::new(None),
                session: Mutex::new(Session {
                    server_url: server_url.clone(),
                    endpoint: None,
                    credential: None,
                    snapshot: None,
                    credential_error: None,
                }),
            }),
        };
        service.start_remote(stop_rx.clone());
        let background = service.clone();
        tauri::async_runtime::spawn(async move {
            background.run(server_url, stop_rx).await;
        });
        Ok(service)
    }

    pub fn status(&self) -> FriendsStatus {
        self.runtime.status.borrow().clone()
    }

    pub async fn refresh_now(&self) -> FriendsStatus {
        let mut session = self.runtime.session.lock().await;
        if !session
            .credential
            .as_ref()
            .is_some_and(|credential| credential.profile_id.is_some())
            || session.credential_error.is_some()
        {
            return self.status();
        }
        if let Err(error) = self.refresh(&mut session).await {
            self.publish(&session, false, Some(error));
        }
        self.status()
    }

    /// A new room shows this profile's roles with the next heartbeat; this
    /// sends it right away instead of up to 12 s later.
    pub fn announce_room(&self) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            service.refresh_now().await;
        });
    }

    pub async fn set_server_url(&self, server_url: String) {
        {
            let session = self.runtime.session.lock().await;
            if session.server_url == server_url && session.endpoint.is_some() { return; }
        }
        self.stop_listen_along(None).await;
        let mut session = self.runtime.session.lock().await;
        if session.server_url == server_url && session.endpoint.is_some() {
            return;
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), self.offline(&session)).await;
        session.server_url = server_url.clone();
        session.snapshot = None;
        session.credential = None;
        session.credential_error = None;
        session.endpoint = None;
        match social_endpoint(&server_url) {
            Ok(endpoint) => {
                match self.runtime.store.load(endpoint.as_str()).await {
                    Ok(credential) => session.credential = credential,
                    Err(error) => session.credential_error = Some(error),
                }
                session.endpoint = Some(endpoint);
            }
            Err(error) => session.credential_error = Some(error),
        }
        self.publish(&session, false, session.credential_error.clone());
    }

    pub async fn shutdown(&self) {
        self.runtime.stop.send_replace(true);
        self.stop_listen_along(None).await;
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            let session = self.runtime.session.lock().await;
            self.offline(&session).await
        })
        .await;
    }

    pub(super) fn publish(&self, session: &Session, online: bool, error: Option<String>) {
        let mut snapshot = session.snapshot.clone();
        if !online {
            if let Some(snapshot) = &mut snapshot {
                for friend in &mut snapshot.friends {
                    friend.presence = Default::default();
                }
            }
        }
        let mut status = FriendsStatus {
            server_url: session.server_url.clone(),
            connection: if online {
                "online"
            } else if session.credential.is_some() || session.credential_error.is_some() {
                "offline"
            } else {
                "inactive"
            }
            .into(),
            snapshot,
            error,
            listen_along: self.runtime.status.borrow().listen_along.clone(),
        };
        // The follower updates independently of the heartbeat. Preserve its
        // current state atomically instead of restoring an earlier snapshot.
        let changed = self.runtime.status.send_if_modified(|current| {
            status.listen_along = current.listen_along.clone();
            if *current == status { return false; }
            *current = status.clone();
            true
        });
        if changed { let _ = self.runtime.app.emit("friends://status", self.status()); }
    }
}

pub(super) fn authenticated(session: &Session) -> Result<(&Url, &Credential), String> {
    if let Some(error) = &session.credential_error {
        return Err(error.clone());
    }
    Ok((
        session
            .endpoint
            .as_ref()
            .ok_or("friends.error.invalidUrl")?,
        session
            .credential
            .as_ref()
            .ok_or("friends.error.inactive")?,
    ))
}

pub(super) fn is_connection_error(error: &str) -> bool {
    matches!(
        error,
        "friends.error.unreachable"
            | "friends.error.protocol"
            | "friends.error.unauthorized"
            | "friends.error.serverUpdateRequired"
    )
}
