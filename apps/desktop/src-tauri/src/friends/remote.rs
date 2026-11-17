//! Remote control (`/social/v1/remote`): this PC shows up as a player for
//! the other devices of the friends profile (a phone), shares what it plays
//! and takes their commands. Commands go to the frontend, which runs them
//! through the same path as a click, so the player stays consistent.
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use luft_listen_together::remote::{DeviceKind, RemoteClientMessage, RemoteServerMessage, RemoteState};
use serde::Serialize;
use tauri::Emitter;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest, http::HeaderValue},
};

use super::service::{FriendsService, authenticated};

const PING_EVERY: Duration = Duration::from_secs(10);
const BACKOFF_SECS: [u64; 5] = [2, 4, 8, 15, 30];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteCommandEvent {
    from_label: String,
    command: luft_listen_together::remote::RemoteCommand,
}

/// What the frontend shows: which other devices are there.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteDevicesEvent {
    you: String,
    devices: Vec<luft_listen_together::remote::RemoteDevice>,
}

#[derive(Clone, Serialize)]
struct ChatChangedEvent {
    peer: String,
}

fn device_label() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|name| name.trim().chars().take(32).collect::<String>())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "PC".into())
}

impl FriendsService {
    /// Keeps the connection while a friends profile is on this PC.
    pub(super) fn start_remote(&self, mut stop: watch::Receiver<bool>) {
        let service = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut attempt = 0usize;
            loop {
                if *stop.borrow() {
                    return;
                }
                let target = {
                    let session = service.runtime.session.lock().await;
                    authenticated(&session)
                        .ok()
                        .filter(|(_, credential)| credential.profile_id.is_some())
                        .and_then(|(endpoint, credential)| endpoint.join("remote").ok().map(|url| (url, credential.token.clone())))
                };
                let wait = match target {
                    Some((url, token)) => {
                        let connected = service.remote_session(url, &token, &mut stop).await;
                        attempt = if connected { 0 } else { attempt + 1 };
                        Duration::from_secs(BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)])
                    }
                    // No profile (yet): look again in a while.
                    None => Duration::from_secs(15),
                };
                tokio::select! {
                    () = tokio::time::sleep(wait) => {}
                    _ = stop.changed() => {}
                }
            }
        });
    }

    /// One connection; true if it got as far as the hello.
    async fn remote_session(&self, mut url: url::Url, token: &str, stop: &mut watch::Receiver<bool>) -> bool {
        let scheme = if url.scheme() == "http" { "ws" } else { "wss" };
        if url.set_scheme(scheme).is_err() {
            return false;
        }
        let Ok(mut request) = url.as_str().into_client_request() else { return false };
        let Ok(header) = HeaderValue::from_str(&format!("Bearer {token}")) else { return false };
        request.headers_mut().insert("Authorization", header);
        let Ok(Ok((socket, _))) = tokio::time::timeout(Duration::from_secs(8), connect_async(request)).await else {
            return false;
        };
        let (mut sink, mut stream) = socket.split();
        let hello = RemoteClientMessage::Hello { label: device_label(), kind: DeviceKind::Desktop, player: true };
        let Ok(text) = serde_json::to_string(&hello) else { return false };
        if sink.send(Message::Text(text.into())).await.is_err() {
            return false;
        }
        let (tx, mut rx) = mpsc::unbounded_channel::<RemoteClientMessage>();
        *self.runtime.remote.lock().await = Some(tx);
        let mut ping = tokio::time::interval(PING_EVERY);
        let app = self.runtime.app.clone();
        loop {
            tokio::select! {
                frame = stream.next() => {
                    let Some(Ok(frame)) = frame else { break };
                    let Message::Text(text) = frame else { continue };
                    match serde_json::from_str::<RemoteServerMessage>(&text) {
                        Ok(RemoteServerMessage::Command { from_label, command, .. }) => {
                            let _ = app.emit("friends://remote-command", RemoteCommandEvent { from_label, command });
                        }
                        Ok(RemoteServerMessage::Devices { you, devices }) => {
                            let _ = app.emit("friends://remote-devices", RemoteDevicesEvent { you, devices });
                        }
                        // The same connection brings chat news, so messages show without waiting for a poll.
                        Ok(RemoteServerMessage::Chat { peer }) => {
                            let _ = app.emit("friends://chat-changed", ChatChangedEvent { peer });
                        }
                        _ => {}
                    }
                }
                outgoing = rx.recv() => {
                    let Some(message) = outgoing else { break };
                    let Ok(text) = serde_json::to_string(&message) else { continue };
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                _ = ping.tick() => {
                    let message = RemoteClientMessage::Ping { client_time_ms: luft_listen_together::server_now_ms() };
                    let Ok(text) = serde_json::to_string(&message) else { continue };
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                _ = stop.changed() => break,
            }
        }
        *self.runtime.remote.lock().await = None;
        let _ = app.emit("friends://remote-devices", RemoteDevicesEvent { you: String::new(), devices: Vec::new() });
        true
    }

    /// From the frontend: what this PC plays now, for the other devices.
    pub async fn remote_state(&self, state: RemoteState) {
        if let Some(tx) = self.runtime.remote.lock().await.as_ref() {
            let _ = tx.send(RemoteClientMessage::State { state });
        }
    }
}
