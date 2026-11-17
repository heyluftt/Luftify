use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::{
        ConnectInfo, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use luft_listen_together::{
    ClientMessage, ErrorCode, HubEvent, RoomError, ServerMessage, parse_client_message,
    server_now_ms,
};
use tokio::sync::{Notify, mpsc};
use uuid::Uuid;

use crate::{
    hub::SharedHub,
    limits::{ConnectionBudget, MAX_MESSAGE_BYTES, RateLimit},
};

static BUDGET: Mutex<ConnectionBudget> = Mutex::new(ConnectionBudget::new());
/// Clients ping every 5 s. Silence this long means the connection is gone
/// (sleeping laptop, dead Wi-Fi) even though TCP never said so; without it
/// such members stayed "online" and rooms never expired.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// Room snapshots carry avatars; a few seconds of backlog is plenty.
const OUTBOX: usize = 64;

pub async fn upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    State(hub): State<SharedHub>,
) -> impl IntoResponse {
    let allowed = BUDGET
        .lock()
        .map(|mut budget| budget.try_acquire())
        .unwrap_or(false);
    ws.max_message_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| async move {
            if allowed {
                handle_socket(socket, hub).await;
                if let Ok(mut budget) = BUDGET.lock() {
                    budget.release();
                }
            }
        })
}

async fn handle_socket(socket: WebSocket, hub: SharedHub) {
    let participant_id = Uuid::new_v4().to_string();
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(OUTBOX);
    let close = Arc::new(Notify::new());
    hub.register(participant_id.clone(), tx, close.clone()).await;
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let Ok(payload) = serde_json::to_string(&message) else {
                continue;
            };
            if sink.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    let mut rate = RateLimit::new();
    let mut negotiated = false;
    loop {
        let frame = tokio::select! {
            frame = tokio::time::timeout(IDLE_TIMEOUT, stream.next()) => frame,
            () = close.notified() => break,
        };
        let Ok(Some(Ok(frame))) = frame else {
            break;
        };
        let Message::Text(text) = frame else {
            continue;
        };
        if !rate.allow() {
            send_error(
                &hub,
                &participant_id,
                ErrorCode::RateLimited,
                "too many messages",
            )
            .await;
            continue;
        }
        match parse_client_message(&text) {
            Ok(message) => {
                if !negotiated {
                    if matches!(&message, ClientMessage::Hello { protocol, .. } if *protocol == luft_listen_together::PROTOCOL_VERSION)
                    {
                        negotiated = true;
                    } else {
                        send_error(
                            &hub,
                            &participant_id,
                            ErrorCode::Protocol,
                            "listen.protocolMismatch",
                        )
                        .await;
                        continue;
                    }
                }
                let _ordered = hub.transaction.lock().await;
                if let Some(event) = handle_message(&hub, &participant_id, message).await {
                    hub.dispatch(event).await;
                }
            }
            Err(_) => {
                send_error(
                    &hub,
                    &participant_id,
                    ErrorCode::InvalidMessage,
                    "invalid json",
                )
                .await;
            }
        }
    }

    let _ordered = hub.transaction.lock().await;
    if let Some(event) = hub.unregister(&participant_id).await {
        hub.dispatch(event).await;
    }
    writer.abort();
}

async fn handle_message(
    hub: &SharedHub,
    participant_id: &str,
    message: ClientMessage,
) -> Option<HubEvent> {
    match message {
        ClientMessage::Profile {
            display_name,
            avatar_uri,
        } => {
            result_event(hub, participant_id, |inner| {
                inner.update_profile(participant_id, display_name, avatar_uri)
            })
            .await
        }
        ClientMessage::Hello { protocol, .. } => {
            if protocol != luft_listen_together::PROTOCOL_VERSION {
                send_error(
                    hub,
                    participant_id,
                    ErrorCode::Protocol,
                    "unsupported protocol",
                )
                .await;
                return None;
            }
            send_error_or_ok(
                hub,
                participant_id,
                ServerMessage::HelloOk {
                    client_id: participant_id.to_owned(),
                    server_time_ms: server_now_ms(),
                    protocol: luft_listen_together::PROTOCOL_VERSION,
                },
            )
            .await;
            None
        }
        ClientMessage::CreateRoom { display_name } => {
            result_event(hub, participant_id, |inner| {
                inner.create_room(participant_id, &display_name)
            })
            .await
        }
        ClientMessage::JoinRoom {
            code,
            display_name,
            resume_token,
        } => {
            result_event(hub, participant_id, |inner| {
                inner.join_room(
                    participant_id,
                    &code,
                    &display_name,
                    resume_token.as_deref(),
                )
            })
            .await
        }
        ClientMessage::LeaveRoom => {
            result_event(hub, participant_id, |inner| {
                inner.leave_room(participant_id)
            })
            .await
        }
        ClientMessage::PlaybackIntent {
            revision_base,
            intent,
        } => {
            result_event(hub, participant_id, |inner| {
                inner.apply_intent(participant_id, revision_base, intent)
            })
            .await
        }
        ClientMessage::QueueReplace {
            revision_base,
            items,
        } => {
            result_event(hub, participant_id, |inner| {
                inner.replace_queue(participant_id, revision_base, items)
            })
            .await
        }
        ClientMessage::QueueEdit {
            room_id,
            operation_id,
            edit,
        } => {
            let result = hub
                .apply(|inner| inner.edit_queue(participant_id, &room_id, &operation_id, edit))
                .await;
            let error = result.as_ref().err().map(|error| {
                match error {
                    RoomError::HostOnly => "listen.controlLocked",
                    _ => "listen.queueConflict",
                }
                .to_owned()
            });
            if let Ok(event) = result {
                hub.dispatch(event).await;
            }
            hub.send_to(
                participant_id,
                ServerMessage::QueueAck {
                    operation_id,
                    error,
                },
            )
            .await;
            None
        }
        ClientMessage::QueueAdvance {
            room_id,
            current_id,
        } => {
            result_event(hub, participant_id, |inner| {
                inner.advance_queue(participant_id, &room_id, current_id.as_deref())
            })
            .await
        }
        ClientMessage::SetControl { mode } => {
            result_event(hub, participant_id, |inner| inner.set_control(participant_id, mode)).await
        }
        ClientMessage::SetQueuePolicy { policy } => {
            result_event(hub, participant_id, |inner| inner.set_queue_policy(participant_id, policy)).await
        }
        ClientMessage::Control { action } => {
            result_event(hub, participant_id, |inner| inner.control(participant_id, action)).await
        }
        ClientMessage::RequestState => {
            if let Some(room) = hub.snapshot(participant_id).await {
                send_error_or_ok(hub, participant_id, ServerMessage::RoomUpdated { room }).await;
            } else {
                send_error(hub, participant_id, ErrorCode::NotInRoom, "not in a room").await;
            }
            None
        }
        ClientMessage::Ping { client_time_ms } => {
            send_error_or_ok(
                hub,
                participant_id,
                ServerMessage::Pong {
                    client_time_ms,
                    server_time_ms: server_now_ms(),
                },
            )
            .await;
            None
        }
    }
}

async fn result_event(
    hub: &SharedHub,
    participant_id: &str,
    op: impl FnOnce(&mut luft_listen_together::Hub) -> Result<HubEvent, RoomError>,
) -> Option<HubEvent> {
    match hub.apply(op).await {
        Ok(event) => Some(event),
        Err(error) => {
            send_room_error(hub, participant_id, error).await;
            None
        }
    }
}

async fn send_error_or_ok(hub: &SharedHub, participant_id: &str, message: ServerMessage) {
    hub.send_to(participant_id, message).await;
}

async fn send_error(hub: &SharedHub, participant_id: &str, code: ErrorCode, message: &str) {
    hub.send_to(
        participant_id,
        ServerMessage::Error {
            code,
            message: message.to_owned(),
        },
    )
    .await;
}

async fn send_room_error(hub: &SharedHub, participant_id: &str, error: RoomError) {
    let code = match error {
        RoomError::InvalidQueue => ErrorCode::InvalidMessage,
        RoomError::InvalidCode => ErrorCode::InvalidCode,
        RoomError::RoomNotFound => ErrorCode::RoomNotFound,
        RoomError::RoomFull => ErrorCode::RoomFull,
        RoomError::NotInRoom => ErrorCode::NotInRoom,
        RoomError::HostOnly => ErrorCode::HostOnly,
        RoomError::StaleRevision => ErrorCode::StaleRevision,
        RoomError::Unauthorized => ErrorCode::Unauthorized,
    };
    send_error(hub, participant_id, code, &error.to_string()).await;
}
