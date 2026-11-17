//! Remote control relay (`/social/v1/remote`): the devices of one profile
//! see each other, a player shares its state, another device steers it.
//! Only within one profile; nothing is stored, it lives as long as the
//! connections do.
use std::{collections::HashMap, sync::atomic::{AtomicU64, Ordering}, time::Duration};

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use luft_listen_together::{
    devices::clean_device_label,
    remote::{
        MAX_REMOTE_DEVICES, MAX_REMOTE_MESSAGE_BYTES, RemoteClientMessage, RemoteDevice, RemoteServerMessage, RemoteState,
    },
    server_now_ms,
};
use tokio::sync::{Mutex, mpsc};

use super::SharedState;

/// Clients ping every 10 s; silence this long means the device is gone.
const IDLE_TIMEOUT: Duration = Duration::from_secs(35);
const OUTBOX: usize = 64;
/// Enough for seeking by dragging, not for flooding the others.
const MESSAGES_PER_SECOND: u32 = 20;

static CONNECTION: AtomicU64 = AtomicU64::new(1);

struct Peer {
    connection: u64,
    device: RemoteDevice,
    tx: mpsc::Sender<RemoteServerMessage>,
    state: Option<RemoteState>,
}

#[derive(Default)]
pub(super) struct RemoteHub {
    /// profile → device → peer
    peers: Mutex<HashMap<String, HashMap<String, Peer>>>,
}

pub(super) async fn upgrade(State(state): State<SharedState>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let (profile, device) = match state.store.authenticate_device(&headers).await {
        Ok(found) => found,
        Err(error) => return error.into_response(),
    };
    ws.max_message_size(MAX_REMOTE_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move { run(state, profile, device, socket).await })
}

async fn run(state: SharedState, profile: String, device: String, socket: WebSocket) {
    let connection = CONNECTION.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<RemoteServerMessage>(OUTBOX);
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let Ok(text) = serde_json::to_string(&message) else { continue };
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });
    let hub = &state.remote;
    let mut budget = (std::time::Instant::now(), 0u32);
    let mut joined = false;
    loop {
        let Ok(Some(Ok(frame))) = tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await else { break };
        let Message::Text(text) = frame else { continue };
        if budget.0.elapsed() >= Duration::from_secs(1) {
            budget = (std::time::Instant::now(), 0);
        }
        budget.1 += 1;
        if budget.1 > MESSAGES_PER_SECOND {
            continue;
        }
        let Ok(message) = serde_json::from_str::<RemoteClientMessage>(&text) else {
            let _ = tx.try_send(RemoteServerMessage::Error { code: "invalidMessage".into() });
            continue;
        };
        match message {
            RemoteClientMessage::Ping { client_time_ms } => {
                let _ = tx.try_send(RemoteServerMessage::Pong { client_time_ms, server_time_ms: server_now_ms() });
            }
            RemoteClientMessage::Hello { label, kind, player } => {
                let label = clean_device_label(&label).unwrap_or_else(|| "Luftify".into());
                let entry = RemoteDevice { id: device.clone(), label, kind, player };
                if !hub.join(&profile, connection, entry, tx.clone()).await {
                    let _ = tx.try_send(RemoteServerMessage::Error { code: "tooManyDevices".into() });
                    break;
                }
                joined = true;
            }
            _ if !joined => {
                let _ = tx.try_send(RemoteServerMessage::Error { code: "helloFirst".into() });
            }
            RemoteClientMessage::State { state: shared } => {
                let mut shared = shared.sanitize();
                shared.at_ms = server_now_ms();
                hub.share(&profile, &device, shared).await;
            }
            RemoteClientMessage::Command { target, command } => {
                if !command.valid() {
                    let _ = tx.try_send(RemoteServerMessage::Error { code: "invalidCommand".into() });
                } else if !hub.forward(&profile, &device, &target, command).await {
                    let _ = tx.try_send(RemoteServerMessage::Error { code: "deviceOffline".into() });
                }
            }
        }
    }
    hub.leave(&profile, &device, connection).await;
    writer.abort();
}

impl RemoteHub {
    fn devices_message(peers: &HashMap<String, Peer>, you: &str) -> RemoteServerMessage {
        let mut devices: Vec<_> = peers.values().map(|peer| peer.device.clone()).collect();
        devices.sort_by(|a, b| a.label.cmp(&b.label).then(a.id.cmp(&b.id)));
        RemoteServerMessage::Devices { you: you.to_owned(), devices }
    }

    fn announce(peers: &HashMap<String, Peer>) {
        for (id, peer) in peers {
            let _ = peer.tx.try_send(Self::devices_message(peers, id));
        }
    }

    /// A device (again): the newest connection of a device replaces the old one.
    async fn join(&self, profile: &str, connection: u64, device: RemoteDevice, tx: mpsc::Sender<RemoteServerMessage>) -> bool {
        let mut all = self.peers.lock().await;
        let peers = all.entry(profile.to_owned()).or_default();
        if !peers.contains_key(&device.id) && peers.len() >= MAX_REMOTE_DEVICES {
            return false;
        }
        let id = device.id.clone();
        let previous_state = peers.remove(&id).and_then(|peer| peer.state);
        // What the others play right now, so a new controller has it at once.
        for (other, peer) in peers.iter() {
            if let Some(state) = &peer.state {
                let _ = tx.try_send(RemoteServerMessage::State { device: other.clone(), state: state.clone() });
            }
        }
        peers.insert(id, Peer { connection, device, tx, state: previous_state });
        Self::announce(peers);
        true
    }

    async fn leave(&self, profile: &str, device: &str, connection: u64) {
        let mut all = self.peers.lock().await;
        let Some(peers) = all.get_mut(profile) else { return };
        if peers.get(device).is_some_and(|peer| peer.connection == connection) {
            peers.remove(device);
            Self::announce(peers);
        }
        if peers.is_empty() {
            all.remove(profile);
        }
    }

    async fn share(&self, profile: &str, device: &str, state: RemoteState) {
        let mut all = self.peers.lock().await;
        let Some(peers) = all.get_mut(profile) else { return };
        let Some(peer) = peers.get_mut(device) else { return };
        peer.state = Some(state.clone());
        for (id, other) in peers.iter() {
            if id != device {
                let _ = other.tx.try_send(RemoteServerMessage::State { device: device.to_owned(), state: state.clone() });
            }
        }
    }

    async fn forward(&self, profile: &str, from: &str, target: &str, command: luft_listen_together::remote::RemoteCommand) -> bool {
        let all = self.peers.lock().await;
        let Some(peers) = all.get(profile) else { return false };
        let from_label = peers.get(from).map(|peer| peer.device.label.clone()).unwrap_or_default();
        let Some(peer) = peers.get(target).filter(|peer| peer.device.player) else { return false };
        peer.tx.try_send(RemoteServerMessage::Command { from: from.to_owned(), from_label, command }).is_ok()
    }

    /// Tells every connected device of `profile` that a conversation changed.
    pub(super) async fn chat_changed(&self, profile: &str, peer: &str) {
        let all = self.peers.lock().await;
        for device in all.get(profile).into_iter().flat_map(HashMap::values) {
            let _ = device.tx.try_send(RemoteServerMessage::Chat { peer: peer.to_owned() });
        }
    }

    /// A device was signed out: its connection ends.
    pub(super) async fn drop_device(&self, profile: &str, device: &str) {
        let mut all = self.peers.lock().await;
        if let Some(peers) = all.get_mut(profile) {
            if peers.remove(device).is_some() {
                Self::announce(peers);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use luft_listen_together::remote::DeviceKind;

    use super::*;

    #[tokio::test]
    async fn chat_news_reaches_only_that_profiles_devices() {
        let hub = RemoteHub::default();
        let device = |id: &str| RemoteDevice { id: id.into(), label: id.into(), kind: DeviceKind::Desktop, player: true };
        let (pc, mut pc_rx) = mpsc::channel(8);
        let (other, mut other_rx) = mpsc::channel(8);
        assert!(hub.join("jess", 1, device("main"), pc).await);
        assert!(hub.join("luft", 2, device("main"), other).await);
        while pc_rx.try_recv().is_ok() {}
        while other_rx.try_recv().is_ok() {}
        hub.chat_changed("jess", "luft").await;
        assert_eq!(pc_rx.try_recv().ok(), Some(RemoteServerMessage::Chat { peer: "luft".into() }));
        assert!(other_rx.try_recv().is_err());
    }
}
