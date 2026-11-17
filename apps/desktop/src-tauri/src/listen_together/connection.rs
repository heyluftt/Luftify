//! WebSocket liveness must not depend on Spotify responding to player commands.
use futures_util::{SinkExt, StreamExt};
use luft_listen_together::{ClientMessage, ServerMessage, server_now_ms};
use std::time::Duration;
use tokio::{
    sync::{mpsc, oneshot},
    time::{Instant, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const WRITE_TIMEOUT: Duration = Duration::from_secs(3);
const HEARTBEAT: Duration = Duration::from_secs(5);
const IDLE_TIMEOUT: Duration = Duration::from_secs(20);

pub(super) struct Received {
    pub message: ServerMessage,
    pub at_ms: i64,
}
struct Outgoing {
    message: ClientMessage,
    done: oneshot::Sender<Result<(), String>>,
}
pub(super) struct Sender(mpsc::Sender<Outgoing>);
/// An open socket: what to send on, and what arrives.
pub(super) type Connection = (Sender, mpsc::Receiver<Received>);

impl Sender {
    pub async fn send(&self, message: ClientMessage) -> Result<(), String> {
        let (done, result) = oneshot::channel();
        self.0
            .send(Outgoing { message, done })
            .await
            .map_err(|_| "not connected")?;
        result.await.map_err(|_| "connection closed")?
    }
}

pub(super) async fn open(url: &str) -> Result<Connection, String> {
    let (socket, _) = timeout(Duration::from_secs(8), connect_async(url))
        .await
        .map_err(|_| "sync server connection timed out".to_owned())?
        .map_err(|error| format!("could not reach sync server: {error}"))?;
    let (mut writer, mut reader) = socket.split();
    let (outgoing, mut commands) = mpsc::channel::<Outgoing>(32);
    let (events, incoming) = mpsc::channel(128);
    tokio::spawn(async move {
        let mut heartbeat = tokio::time::interval(HEARTBEAT);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut negotiated = false;
        let mut last_received = Instant::now();
        loop {
            tokio::select! {
                _ = events.closed() => break,
                command = commands.recv() => {
                    let Some(command) = command else { break };
                    let hello = matches!(command.message, ClientMessage::Hello { .. });
                    let result = match serde_json::to_string(&command.message) {
                        Ok(payload) => match timeout(WRITE_TIMEOUT, writer.send(Message::Text(payload.into()))).await {
                            Ok(Ok(())) => Ok(()),
                            Ok(Err(error)) => Err(error.to_string()),
                            Err(_) => Err("sync server write timed out".into()),
                        },
                        Err(error) => Err(error.to_string()),
                    };
                    let failed = result.is_err();
                    let _ = command.done.send(result);
                    if failed { break; }
                    negotiated |= hello;
                }
                frame = reader.next() => {
                    match frame {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(message) = serde_json::from_str::<ServerMessage>(&text) {
                                last_received = Instant::now();
                                // Timestamp at the socket, before slow player work can delay delivery.
                                if events.try_send(Received { message, at_ms: server_now_ms() }).is_err() {
                                    break;
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                        _ => {}
                    }
                }
                _ = heartbeat.tick(), if negotiated => {
                    if last_received.elapsed() >= IDLE_TIMEOUT { break; }
                    let payload = serde_json::to_string(&ClientMessage::Ping { client_time_ms: server_now_ms() }).unwrap();
                    if !matches!(timeout(WRITE_TIMEOUT, writer.send(Message::Text(payload.into()))).await, Ok(Ok(()))) { break; }
                }
            }
        }
        let _ = timeout(WRITE_TIMEOUT, writer.close()).await;
    });
    Ok((Sender(outgoing), incoming))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn heartbeat_and_receive_timestamps_do_not_wait_for_player() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
            let hello = socket.next().await.unwrap().unwrap();
            assert!(matches!(
                serde_json::from_str::<ClientMessage>(hello.to_text().unwrap()).unwrap(),
                ClientMessage::Hello { .. }
            ));
            let mut pings = 0;
            while pings < 2 {
                let frame = socket.next().await.unwrap().unwrap();
                if let ClientMessage::Ping { client_time_ms } =
                    serde_json::from_str::<ClientMessage>(frame.to_text().unwrap()).unwrap()
                {
                    let pong = ServerMessage::Pong {
                        client_time_ms,
                        server_time_ms: server_now_ms(),
                    };
                    socket
                        .send(Message::Text(serde_json::to_string(&pong).unwrap().into()))
                        .await
                        .unwrap();
                    pings += 1;
                }
            }
        });
        let (sender, mut events) = open(&url).await.unwrap();
        sender
            .send(ClientMessage::Hello {
                protocol: luft_listen_together::PROTOCOL_VERSION,
                display_name: "Test".into(),
                client_id: "test".into(),
            })
            .await
            .unwrap();
        // Deliberately do not consume events: Spotify may be busy loading.
        timeout(Duration::from_secs(8), server)
            .await
            .unwrap()
            .unwrap();
        let first = events.recv().await.unwrap();
        assert!(matches!(first.message, ServerMessage::Pong { .. }));
        assert!(server_now_ms() - first.at_ms >= 4_000);
    }
}
