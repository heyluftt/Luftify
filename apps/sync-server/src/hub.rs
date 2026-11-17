use std::{collections::HashMap, sync::Arc};

use luft_listen_together::{Hub, HubEvent, RoomError, RoomSnapshot, SavedRooms, ServerMessage, SocialRole};
use tokio::sync::{Mutex, Notify, mpsc};

pub type Outbound = mpsc::Sender<ServerMessage>;

/// A socket's outbox and the signal that ends it.
struct Peer {
    outbox: Outbound,
    close: Arc<Notify>,
}

pub struct AppHub {
    pub transaction: Mutex<()>,
    inner: Mutex<Hub>,
    sockets: Mutex<HashMap<String, Peer>>,
}

impl AppHub {
    #[must_use]
    pub fn new() -> Self {
        Self {
            transaction: Mutex::new(()),
            inner: Mutex::new(Hub::new()),
            sockets: Mutex::new(HashMap::new()),
        }
    }

    /// Closes rooms nobody returned to and hands rooms of a lost host to a guest.
    pub async fn expire_disconnected(&self) {
        let _transaction = self.transaction.lock().await;
        let events = {
            let mut hub = self.inner.lock().await;
            hub.expire_disconnected();
            hub.hand_over_lost_hosts()
        };
        if !events.is_empty() {
            tracing::info!(rooms = events.len(), "listen-together host handed over");
        }
        for event in events {
            self.dispatch(event).await;
        }
    }

    pub async fn register(&self, participant_id: String, outbox: Outbound, close: Arc<Notify>) {
        self.sockets
            .lock()
            .await
            .insert(participant_id, Peer { outbox, close });
    }

    /// Rooms for a restart (rooms.rs); under the transaction, so nothing is half applied.
    pub async fn save_rooms(&self) -> SavedRooms {
        let _transaction = self.transaction.lock().await;
        self.inner.lock().await.save()
    }

    pub async fn restore_rooms(&self, saved: SavedRooms) -> usize {
        let _transaction = self.transaction.lock().await;
        self.inner.lock().await.restore(saved)
    }

    pub async fn connected_member_count(&self) -> usize {
        self.inner.lock().await.connected_member_count()
    }

    pub async fn room_count(&self) -> usize {
        self.inner.lock().await.room_count()
    }

    pub async fn connected_members(&self, join_code: &str, room_token: &str) -> Option<usize> {
        self.inner.lock().await.connected_members(join_code, room_token)
    }

    pub async fn valid_invitation(&self, join_code: &str, room_token: &str) -> bool {
        self.inner
            .lock()
            .await
            .valid_invitation(join_code, room_token)
    }

    pub async fn link_roles(&self, join_code: &str, room_token: &str, roles: &[SocialRole], badges: &[String]) {
        // Same ordering as socket messages: apply and send under the transaction.
        let _ordered = self.transaction.lock().await;
        let event = self.inner.lock().await.link_roles(join_code, room_token, roles, badges);
        if let Some(event) = event {
            self.dispatch(event).await;
        }
    }

    pub async fn unregister(&self, participant_id: &str) -> Option<HubEvent> {
        self.sockets.lock().await.remove(participant_id);
        self.inner.lock().await.disconnect(participant_id)
    }

    pub async fn apply<F>(&self, op: F) -> Result<HubEvent, RoomError>
    where
        F: FnOnce(&mut Hub) -> Result<HubEvent, RoomError>,
    {
        op(&mut *self.inner.lock().await)
    }

    pub async fn snapshot(&self, participant_id: &str) -> Option<RoomSnapshot> {
        self.inner.lock().await.snapshot_for(participant_id)
    }

    pub async fn dispatch(&self, event: HubEvent) {
        match event {
            HubEvent::Created {
                room,
                you,
                resume_token,
            } => {
                let id = you.id.clone();
                self.send(
                    &id,
                    ServerMessage::RoomCreated {
                        room,
                        resume_token,
                        you,
                    },
                )
                .await;
            }
            HubEvent::Joined {
                room,
                you,
                resume_token,
            } => {
                let id = you.id.clone();
                let others = room
                    .participants
                    .iter()
                    .filter(|participant| participant.id != id)
                    .map(|participant| participant.id.clone())
                    .collect::<Vec<_>>();
                let playback = room.playback.clone();
                self.send(
                    &id,
                    ServerMessage::Joined {
                        room: room.clone(),
                        resume_token,
                        you,
                    },
                )
                .await;
                self.send_many(&others, ServerMessage::RoomUpdated { room })
                    .await;
                if playback.track.is_some() || playback.is_playing || playback.revision > 1 {
                    self.send(&id, ServerMessage::Playback { state: playback })
                        .await;
                }
            }
            HubEvent::RoomUpdated { room } => {
                let ids = room
                    .participants
                    .iter()
                    .map(|participant| participant.id.clone())
                    .collect::<Vec<_>>();
                self.send_many(&ids, ServerMessage::RoomUpdated { room })
                    .await;
            }
            HubEvent::Playback {
                participant_ids,
                state,
                ..
            } => {
                self.send_many(&participant_ids, ServerMessage::Playback { state })
                    .await;
            }
            HubEvent::Queue {
                participant_ids,
                queue,
                ..
            } => {
                self.send_many(&participant_ids, ServerMessage::Queue { queue })
                    .await;
            }
            HubEvent::Closed {
                participant_ids, ..
            } => {
                self.send_many(
                    &participant_ids,
                    ServerMessage::Error {
                        code: luft_listen_together::ErrorCode::RoomNotFound,
                        message: "room closed".into(),
                    },
                )
                .await;
            }
        }
    }

    pub async fn send_to(&self, participant_id: &str, message: ServerMessage) {
        self.send(participant_id, message).await;
    }

    async fn send(&self, participant_id: &str, message: ServerMessage) {
        let sockets = self.sockets.lock().await;
        let Some(peer) = sockets.get(participant_id) else {
            return;
        };
        // A stalled peer must not hold up the room. Dropping it from the
        // outbox map alone left a member that looked online but never heard
        // anything again; closing the socket makes it disconnect properly,
        // and the client comes back with its resume token.
        if let Err(mpsc::error::TrySendError::Full(_)) = peer.outbox.try_send(message) {
            peer.close.notify_one();
        }
    }

    async fn send_many(&self, ids: &[String], message: ServerMessage) {
        for id in ids {
            self.send(id, message.clone()).await;
        }
    }
}

pub type SharedHub = Arc<AppHub>;
