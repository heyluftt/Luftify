#[path = "connection.rs"]
mod connection;
#[path = "playback_sync.rs"]
mod playback_sync;
use playback_sync::{apply_playback, apply_queue};
#[path = "shared_queue.rs"]
mod shared_queue;
#[path = "room_seed.rs"]
mod room_seed;
use luft_listen_together::{QueueEdit, QueuePolicy};
use shared_queue::{QueueRuntime, accept_room, release_room, release_room_playing, room_tick};

use std::{sync::Arc, time::Duration};

use luft_core::{PlaybackState, RepeatMode as CoreRepeat, SpotifyProvider};
use luft_listen_together::{
    AuthoritativePlayback, ClientMessage, ControlMode, DriftAction, ErrorCode, PROTOCOL_VERSION,
    Participant, PlaybackIntent, QueueSnapshot, RepeatMode, RoomControl, RoomSnapshot,
    ServerMessage, TrackRef, classify_drift, clock_offset_ms, expected_position_ms,
    should_apply_revision,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{
    sync::{mpsc, oneshot},
    time::Instant,
};
use tracing::warn;
use url::Url;
use uuid::Uuid;

const PUBLISH_INTERVAL: Duration = Duration::from_millis(400);
const PUBLISH_HEARTBEAT: Duration = Duration::from_secs(2);
/// Waits between reconnect attempts: 1, 2, 4, 8, then every 15 s.
const RECONNECT_STEPS_S: [u64; 5] = [1, 2, 4, 8, 15];
const SEEK_COOLDOWN: Duration = Duration::from_secs(2);
const TRACK_WAIT_ATTEMPTS: u32 = 12;
const TRACK_WAIT_STEP: Duration = Duration::from_millis(120);

#[cfg(test)]
#[path = "sync_tests.rs"]
mod sync_tests;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenTogetherStatus {
    pub connection: String,
    pub server_url: String,
    pub role: String,
    pub room_id: Option<String>,
    pub join_code: Option<String>,
    pub host_name: Option<String>,
    pub host_connected: bool,
    pub participants: Vec<Participant>,
    pub control: ControlMode,
    pub queue_policy: QueuePolicy,
    pub ping_ms: Option<u64>,
    pub revision: u64,
    pub drift_ms: i64,
    pub last_sync_ms: Option<i64>,
    pub reconnect_attempts: u32,
    pub error: Option<String>,
    pub queue: Option<QueueSnapshot>,
    /// Your participant id in the room, to tell your own songs apart.
    pub you_id: Option<String>,
    /// Whether you may play, pause, seek and skip others' songs.
    pub can_control: bool,
}

enum Command {
    Profile {
        name: String,
        avatar: Option<String>,
        completion: oneshot::Sender<()>,
    },
    Edit {
        room_id: String,
        edit: QueueEdit,
        completion: oneshot::Sender<Result<(), String>>,
    },
    Create(oneshot::Sender<Result<ListenTogetherStatus, String>>),
    Join {
        code: String,
        completion: oneshot::Sender<Result<ListenTogetherStatus, String>>,
    },
    Leave(oneshot::Sender<Result<ListenTogetherStatus, String>>),
    SetUrl {
        url: String,
        completion: oneshot::Sender<ListenTogetherStatus>,
    },
    Status(oneshot::Sender<ListenTogetherStatus>),
    InvitationProof(oneshot::Sender<Option<(String, String, String)>>),
    Control {
        action: RoomControl,
        completion: oneshot::Sender<Result<(), String>>,
    },
    SetControl {
        mode: ControlMode,
        completion: oneshot::Sender<Result<(), String>>,
    },
    SetQueuePolicy {
        policy: QueuePolicy,
        completion: oneshot::Sender<Result<(), String>>,
    },
    Shutdown(oneshot::Sender<()>),
}

#[derive(Clone)]
pub struct ListenTogetherService {
    tx: mpsc::Sender<Command>,
}

impl ListenTogetherService {
    /// Private proof stays inside Rust; the frontend only receives public room state.
    pub(crate) async fn invitation_proof(&self) -> Option<(String, String, String)> {
        let (tx, rx) = oneshot::channel();
        self.tx.send(Command::InvitationProof(tx)).await.ok()?;
        rx.await.ok().flatten()
    }
    pub async fn set_profile(&self, name: String, avatar: Option<String>) {
        let (tx, rx) = oneshot::channel();
        if self
            .tx
            .send(Command::Profile {
                name,
                avatar,
                completion: tx,
            })
            .await
            .is_ok()
        {
            let _ = rx.await;
        }
    }
    pub async fn edit_queue(&self, room_id: String, edit: QueueEdit) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::Edit {
                room_id,
                edit,
                completion: tx,
            })
            .await
            .map_err(|_| "listen.queueUnavailable".to_owned())?;
        rx.await.map_err(|_| "listen.queueUnavailable".to_owned())?
    }
    pub fn start(app: AppHandle, provider: Arc<dyn SpotifyProvider>, server_url: String) -> Self {
        let (tx, rx) = mpsc::channel(32);
        tauri::async_runtime::spawn(run(app, provider, server_url, rx));
        Self { tx }
    }

    pub async fn create_room(&self) -> Result<ListenTogetherStatus, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::Create(tx))
            .await
            .map_err(|_| "listen-together unavailable".to_owned())?;
        rx.await.map_err(|_| "listen-together stopped".to_owned())?
    }

    pub async fn join_room(&self, code: String) -> Result<ListenTogetherStatus, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::Join {
                code,
                completion: tx,
            })
            .await
            .map_err(|_| "listen-together unavailable".to_owned())?;
        rx.await.map_err(|_| "listen-together stopped".to_owned())?
    }

    pub async fn leave(&self) -> Result<ListenTogetherStatus, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::Leave(tx))
            .await
            .map_err(|_| "listen-together unavailable".to_owned())?;
        rx.await.map_err(|_| "listen-together stopped".to_owned())?
    }

    pub async fn set_server_url(&self, url: String) -> ListenTogetherStatus {
        let (tx, rx) = oneshot::channel();
        if self
            .tx
            .send(Command::SetUrl {
                url,
                completion: tx,
            })
            .await
            .is_err()
        {
            return idle_status(String::new());
        }
        rx.await.unwrap_or_else(|_| idle_status(String::new()))
    }

    /// Play, pause or seek the room (guests once the host allows it).
    pub async fn control(&self, action: RoomControl) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::Control { action, completion: tx })
            .await
            .map_err(|_| "listen.error.generic".to_owned())?;
        rx.await.map_err(|_| "listen.error.generic".to_owned())?
    }

    /// Host only: let every guest steer, or only the host.
    pub async fn set_control(&self, mode: ControlMode) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::SetControl { mode, completion: tx })
            .await
            .map_err(|_| "listen.error.generic".to_owned())?;
        rx.await.map_err(|_| "listen.error.generic".to_owned())?
    }

    /// Host only: whether guests may move and remove others' songs.
    pub async fn set_queue_policy(&self, policy: QueuePolicy) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(Command::SetQueuePolicy { policy, completion: tx })
            .await
            .map_err(|_| "listen.error.generic".to_owned())?;
        rx.await.map_err(|_| "listen.error.generic".to_owned())?
    }

    pub async fn status(&self) -> ListenTogetherStatus {
        let (tx, rx) = oneshot::channel();
        if self.tx.send(Command::Status(tx)).await.is_err() {
            return idle_status(String::new());
        }
        rx.await.unwrap_or_else(|_| idle_status(String::new()))
    }

    pub async fn shutdown(&self) {
        let (tx, rx) = oneshot::channel();
        if self.tx.send(Command::Shutdown(tx)).await.is_ok() {
            let _ = rx.await;
        }
    }
}

struct Session {
    avatar_uri: Option<String>,
    server_url: String,
    display_name: String,
    client_id: String,
    connection: String,
    role: String,
    room: Option<RoomSnapshot>,
    resume_token: Option<String>,
    ping_ms: Option<u64>,
    clock_offset_ms: i64,
    last_applied_revision: u64,
    last_applied_queue: u64,
    last_sync_ms: Option<i64>,
    drift_ms: i64,
    reconnect_attempts: u32,
    error: Option<String>,
    last_seek: Option<Instant>,
    last_publish: Option<PublishMemo>,
    queue_runtime: QueueRuntime,
    pending: Option<Pending>,
    last_emitted: Option<ListenTogetherStatus>,
    /// The relay rejected a stale publish; fetch its state quietly.
    request_state: bool,
}

struct PublishMemo {
    track_uri: Option<String>,
    is_playing: bool,
    position_ms: u64,
    shuffle: bool,
    repeat: CoreRepeat,
    at: Instant,
}

enum Pending {
    Create(oneshot::Sender<Result<ListenTogetherStatus, String>>),
    Join(oneshot::Sender<Result<ListenTogetherStatus, String>>),
}

fn idle_status(server_url: String) -> ListenTogetherStatus {
    ListenTogetherStatus {
        connection: "idle".into(),
        server_url,
        role: "none".into(),
        room_id: None,
        join_code: None,
        host_name: None,
        host_connected: false,
        participants: Vec::new(),
        control: ControlMode::HostOnly,
        queue_policy: QueuePolicy::Open,
        ping_ms: None,
        revision: 0,
        drift_ms: 0,
        last_sync_ms: None,
        reconnect_attempts: 0,
        error: None,
        queue: None,
        you_id: None,
        can_control: false,
    }
}

/// Until a profile name is saved. Not the Windows user name: that is often
/// the real name, and the relay shows it to strangers with the code.
fn display_name() -> String {
    "Hörer".into()
}

fn reconnect_delay(attempts: u32) -> Duration {
    let step = (attempts as usize).min(RECONNECT_STEPS_S.len() - 1);
    Duration::from_secs(RECONNECT_STEPS_S[step])
}

fn websocket_url(raw: &str) -> Result<String, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "invalid sync server URL".to_owned())?;
    if url.scheme() != "ws" && url.scheme() != "wss" {
        return Err("sync server URL must start with ws:// or wss://".into());
    }
    if url.path() == "/" || url.path().is_empty() {
        url.set_path("/ws");
    }
    Ok(url.to_string())
}

async fn run(
    app: AppHandle,
    provider: Arc<dyn SpotifyProvider>,
    server_url: String,
    mut commands: mpsc::Receiver<Command>,
) {
    let mut session = Session {
        avatar_uri: None,
        server_url,
        display_name: display_name(),
        client_id: Uuid::new_v4().to_string(),
        connection: "idle".into(),
        role: "none".into(),
        room: None,
        resume_token: None,
        ping_ms: None,
        clock_offset_ms: 0,
        last_applied_revision: 0,
        last_applied_queue: 0,
        last_sync_ms: None,
        drift_ms: 0,
        reconnect_attempts: 0,
        error: None,
        last_seek: None,
        last_publish: None,
        queue_runtime: QueueRuntime::default(),
        pending: None,
        last_emitted: None,
        request_state: false,
    };
    let mut sink: Option<connection::Sender> = None;
    let mut incoming: Option<mpsc::Receiver<connection::Received>> = None;
    // Reconnecting runs beside the loop: a dead relay must not freeze
    // leaving, status polls or queue edits for the connect timeout.
    let mut reconnect_at: Option<Instant> = None;
    let mut connecting: Option<tokio::task::JoinHandle<Result<connection::Connection, String>>> =
        None;
    let mut publish = tokio::time::interval(PUBLISH_INTERVAL);
    publish.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { break; };
                match command {
                    Command::Profile { name, avatar, completion } => {
                        session.display_name = name;
                        session.avatar_uri = avatar;
                        if session.room.is_some() {
                            let _ = send_msg(&mut sink, ClientMessage::Profile { display_name: session.display_name.clone(), avatar_uri: session.avatar_uri.clone() }).await;
                        }
                        let _ = completion.send(());
                    }
                    Command::Edit { room_id, edit, completion } => {
                        if session.connection != "online" || session.room.as_ref().map(|r| &r.id) != Some(&room_id) || session.queue_runtime.edits.len() >= 16 {
                            let _ = completion.send(Err("listen.queueUnavailable".into()));
                        } else {
                            let operation_id = Uuid::new_v4().to_string();
                            match send_msg(&mut sink, ClientMessage::QueueEdit { room_id, operation_id: operation_id.clone(), edit }).await {
                                Ok(()) => { session.queue_runtime.edits.insert(operation_id, (Instant::now(), completion)); }
                                Err(_) => { let _ = completion.send(Err("listen.queueUnavailable".into())); }
                            }
                        }
                    }
                    Command::Status(reply) => {
                        let _ = reply.send(session.status());
                    }
                    Command::InvitationProof(reply) => {
                        let proof = if session.connection == "online" {
                            session.room.as_ref().zip(session.resume_token.as_ref())
                                .map(|(room, token)| (room.code.clone(), token.clone(), session.server_url.clone()))
                        } else { None };
                        let _ = reply.send(proof);
                    }
                    Command::Control { action, completion } => {
                        let result = if session.room.is_none() || session.connection != "online" {
                            Err("listen.error.offline".into())
                        } else if session.role == "host" {
                            // The host's own player is the room's source.
                            match action {
                                RoomControl::Play => provider.play().await,
                                RoomControl::Pause => provider.pause().await,
                                RoomControl::Seek { position_ms } => provider.seek(position_ms).await,
                            }
                            .map_err(|error| error.to_string())
                        } else if !session.status().can_control {
                            Err("listen.controlLocked".into())
                        } else {
                            send_msg(&mut sink, ClientMessage::Control { action }).await
                        };
                        let _ = completion.send(result);
                    }
                    Command::SetControl { mode, completion } => {
                        let result = if session.role != "host" {
                            Err("listen.controlLocked".into())
                        } else {
                            send_msg(&mut sink, ClientMessage::SetControl { mode }).await
                        };
                        let _ = completion.send(result);
                    }
                    Command::SetQueuePolicy { policy, completion } => {
                        let result = if session.role != "host" {
                            Err("listen.controlLocked".into())
                        } else {
                            send_msg(&mut sink, ClientMessage::SetQueuePolicy { policy }).await
                        };
                        let _ = completion.send(result);
                    }
                    Command::Shutdown(reply) => {
                        if let Some(task) = connecting.take() { task.abort(); }
                        release_room(provider.as_ref(), &mut session).await;
                        let _ = send_msg(&mut sink, ClientMessage::LeaveRoom).await;
                        let _ = reply.send(());
                        break;
                    }
                    Command::Leave(reply) => {
                        if let Some(task) = connecting.take() { task.abort(); }
                        reconnect_at = None;
                        session.reconnect_attempts = 0;
                        // Leaving keeps the current song playing, on its own.
                        release_room_playing(provider.as_ref(), &mut session).await;
                        session.pending = None;
                        session.resume_token = None;
                        session.room = None;
                        session.role = "none".into();
                        let _ = send_msg(&mut sink, ClientMessage::LeaveRoom).await;
                        incoming = None;
                        sink = None;
                        session.connection = "idle".into();
                        emit(&app, &mut session);
                        let _ = reply.send(Ok(session.status()));
                    }
                    Command::SetUrl { url, completion } => {
                        if session.server_url != url {
                            if let Some(task) = connecting.take() { task.abort(); }
                            reconnect_at = None;
                            if session.room.is_some() || sink.is_some() {
                                release_room(provider.as_ref(), &mut session).await;
                                session.pending = None;
                                session.resume_token = None;
                                session.room = None;
                                session.role = "none".into();
                                let _ = send_msg(&mut sink, ClientMessage::LeaveRoom).await;
                            }
                            incoming = None;
                            sink = None;
                            session.server_url = url;
                            session.connection = "idle".into();
                            session.error = None;
                            session.reconnect_attempts = 0;
                            emit(&app, &mut session);
                        }
                        let _ = completion.send(session.status());
                    }
                    Command::Create(reply) => {
                        session.pending = Some(Pending::Create(reply));
                        if let Err(error) = ensure_connected(&mut session, &mut sink, &mut incoming).await {
                            finish_pending(&mut session, Err(error));
                        } else {
                            let _ = send_msg(&mut sink, ClientMessage::CreateRoom { display_name: session.display_name.clone() }).await;
                        }
                    }
                    Command::Join { code, completion } => {
                        session.pending = Some(Pending::Join(completion));
                        if let Err(error) = ensure_connected(&mut session, &mut sink, &mut incoming).await {
                            finish_pending(&mut session, Err(error));
                        } else {
                            let _ = send_msg(&mut sink, ClientMessage::JoinRoom {
                                code,
                                display_name: session.display_name.clone(),
                                resume_token: session.resume_token.clone(),
                            }).await;
                        }
                    }
                }
            }
            frame = async {
                match incoming.as_mut() {
                    Some(stream) => stream.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                match frame {
                    Some(connection::Received { message, at_ms }) => {
                        {
                            let host_should_publish = matches!(
                                message,
                                ServerMessage::RoomCreated { .. }
                                    | ServerMessage::Joined { .. }
                                    | ServerMessage::RoomUpdated { .. }
                            );
                            let joined = matches!(message, ServerMessage::RoomCreated { .. } | ServerMessage::Joined { .. });
                            let created = matches!(message, ServerMessage::RoomCreated { .. });
                            if created {
                                // Read before the room is accepted, which pauses an empty room.
                                session.queue_runtime.seed = room_seed::prepare(provider.as_ref()).await;
                            }
                            handle_server(&app, provider.as_ref(), &mut session, message, at_ms).await;
                            if joined {
                                reconnect_at = None;
                                session.reconnect_attempts = 0;
                            }
                            if std::mem::take(&mut session.request_state) {
                                let _ = send_msg(&mut sink, ClientMessage::RequestState).await;
                            }
                            if joined {
                                let _ = send_msg(&mut sink, ClientMessage::Profile { display_name: session.display_name.clone(), avatar_uri: session.avatar_uri.clone() }).await;
                            }
                            if created {
                                room_seed::send(&mut sink, &mut session).await;
                            }
                            if session.role == "host" && host_should_publish {
                                room_tick(provider.as_ref(), &mut sink, &mut session).await;
                            }
                        }
                    }
                    None => {
                        finish_pending(&mut session, Err("listen.error.unreachable".into()));
                        // Guests lose the beat and wait; the host keeps playing
                        // and the room picks it up again after the resume.
                        if session.room.is_some() && session.role != "host" {
                            let _ = provider.pause().await;
                        }
                        session.queue_runtime.fail_edits();
                        incoming = None;
                        sink = None;
                        if session.room.is_some() {
                            session.connection = "reconnecting".into();
                            reconnect_at = Some(Instant::now() + reconnect_delay(session.reconnect_attempts));
                        } else {
                            session.connection = "idle".into();
                        }
                        emit(&app, &mut session);
                    }
                }
            }
            () = async {
                match reconnect_at {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending().await,
                }
            } => {
                reconnect_at = None;
                if sink.is_none() && session.room.is_some() && connecting.is_none() {
                    session.reconnect_attempts = session.reconnect_attempts.saturating_add(1);
                    match websocket_url(&session.server_url) {
                        Ok(url) => connecting = Some(tokio::spawn(async move { connection::open(&url).await })),
                        Err(_) => session.error = Some("listen.invalidUrl".into()),
                    }
                    emit(&app, &mut session);
                }
            }
            result = async {
                match connecting.as_mut() {
                    Some(task) => task.await,
                    None => std::future::pending().await,
                }
            } => {
                connecting = None;
                match result {
                    Ok(Ok((writer, reader))) if session.room.is_some() => {
                        sink = Some(writer);
                        incoming = Some(reader);
                        let resumed = match handshake(&mut session, &mut sink).await {
                            // "Online" only once the relay confirms the resume.
                            Ok(()) => { session.connection = "reconnecting".into(); send_msg(&mut sink, ClientMessage::JoinRoom {
                                code: session.room.as_ref().map(|room| room.code.clone()).unwrap_or_default(),
                                display_name: session.display_name.clone(),
                                resume_token: session.resume_token.clone(),
                            }).await }
                            Err(error) => Err(error),
                        };
                        if resumed.is_err() {
                            sink = None;
                            incoming = None;
                            reconnect_at = Some(Instant::now() + reconnect_delay(session.reconnect_attempts));
                        }
                    }
                    Ok(Ok(_)) => {}
                    Ok(Err(error)) => {
                        warn!(%error, attempt = session.reconnect_attempts, "listen-together reconnect failed");
                        reconnect_at = Some(Instant::now() + reconnect_delay(session.reconnect_attempts));
                    }
                    Err(_) => {
                        reconnect_at = Some(Instant::now() + reconnect_delay(session.reconnect_attempts));
                    }
                }
                emit(&app, &mut session);
            }
            // Outside a room there is nothing to publish or follow.
            _ = publish.tick(), if session.room.is_some() => {
                room_tick(provider.as_ref(), &mut sink, &mut session).await;
                emit(&app, &mut session);
            }
        }
    }
}

impl Session {
    fn status(&self) -> ListenTogetherStatus {
        let room = self.room.as_ref();
        ListenTogetherStatus {
            connection: self.connection.clone(),
            server_url: self.server_url.clone(),
            role: self.role.clone(),
            room_id: room.map(|room| room.id.clone()),
            join_code: room.map(|room| room.code.clone()),
            host_name: room.and_then(|room| {
                room.participants
                    .iter()
                    .find(|participant| participant.id == room.host_id)
                    .map(|participant| participant.display_name.clone())
            }),
            host_connected: room.is_some_and(|room| room.host_connected),
            participants: room
                .map(|room| room.participants.clone())
                .unwrap_or_default(),
            control: room
                .map(|room| room.control)
                .unwrap_or(ControlMode::HostOnly),
            queue_policy: room.map(|room| room.queue_policy).unwrap_or_default(),
            ping_ms: self.ping_ms,
            revision: room
                .map(|room| room.playback.revision)
                .unwrap_or(self.last_applied_revision),
            drift_ms: self.drift_ms,
            last_sync_ms: self.last_sync_ms,
            reconnect_attempts: self.reconnect_attempts,
            error: self.error.clone(),
            queue: room.map(|room| room.queue.clone()),
            you_id: room.map(|_| self.client_id.clone()),
            can_control: room.is_some_and(|room| {
                self.role == "host" || room.control == ControlMode::Everyone
            }),
        }
    }
}

async fn ensure_connected(
    session: &mut Session,
    sink: &mut Option<connection::Sender>,
    incoming: &mut Option<mpsc::Receiver<connection::Received>>,
) -> Result<(), String> {
    if sink.is_some() {
        return Ok(());
    }
    session.connection = "connecting".into();
    let url = websocket_url(&session.server_url).map_err(|_| "listen.invalidUrl".to_owned())?;
    let (writer, reader) = connection::open(&url).await.map_err(|error| {
        warn!(%error, "listen-together server unreachable");
        session.connection = "idle".into();
        "listen.error.unreachable".to_owned()
    })?;
    *sink = Some(writer);
    *incoming = Some(reader);
    handshake(session, sink).await
}

/// Hello, then a first ping so the clock offset is known before a room
/// message starts guest playback.
async fn handshake(
    session: &mut Session,
    sink: &mut Option<connection::Sender>,
) -> Result<(), String> {
    session.connection = "online".into();
    session.error = None;
    send_msg(
        sink,
        ClientMessage::Hello {
            protocol: PROTOCOL_VERSION,
            display_name: session.display_name.clone(),
            client_id: session.client_id.clone(),
        },
    )
    .await?;
    // Establish clock offset before room messages start guest playback.
    send_msg(
        sink,
        ClientMessage::Ping {
            client_time_ms: now_ms(),
        },
    )
    .await
}

async fn send_msg(
    sink: &mut Option<connection::Sender>,
    message: ClientMessage,
) -> Result<(), String> {
    let Some(sink) = sink.as_mut() else {
        return Err("not connected".into());
    };
    sink.send(message).await
}

async fn handle_server(
    app: &AppHandle,
    provider: &dyn SpotifyProvider,
    session: &mut Session,
    message: ServerMessage,
    received: i64,
) {
    match message {
        ServerMessage::QueueAck {
            operation_id,
            error,
        } => {
            if let Some((_, completion)) = session.queue_runtime.edits.remove(&operation_id) {
                let _ = completion.send(error.map_or(Ok(()), Err));
            }
        }
        ServerMessage::HelloOk { .. } => {}
        ServerMessage::Pong {
            client_time_ms,
            server_time_ms,
        } => {
            session.ping_ms = Some(received.saturating_sub(client_time_ms).max(0) as u64);
            session.clock_offset_ms = clock_offset_ms(client_time_ms, server_time_ms, received);
        }
        ServerMessage::RoomCreated {
            room,
            resume_token,
            you,
        }
        | ServerMessage::Joined {
            room,
            resume_token,
            you,
        } => {
            session.last_applied_revision = 0;
            session.last_applied_queue = 0;
            session.last_seek = None;
            session.last_publish = None;
            session.client_id = you.id.clone();
            session.resume_token = Some(resume_token);
            session.role = if you.is_host {
                "host".into()
            } else {
                "guest".into()
            };
            session.connection = "online".into();
            session.error = None;
            accept_room(provider, session, room).await;
            finish_pending(session, Ok(session.status()));
            emit(app, session);
        }
        ServerMessage::RoomUpdated { room } => {
            follow_host(session, &room);
            accept_room(provider, session, room).await;
            emit(app, session);
        }
        ServerMessage::Playback { state } => {
            if let Some(room) = session.room.as_mut() {
                if state.revision <= room.playback.revision {
                    return;
                }
                room.playback = state.clone();
                if let (Some(entry), Some(track)) =
                    (room.queue.current.as_mut(), state.track.as_ref())
                {
                    if entry.track.uri == track.uri {
                        entry.track = track.clone();
                    }
                }
            }
            if session.role != "host" {
                apply_playback(provider, session, state).await;
            } else {
                session.queue_runtime.publish_pending = None;
                if state.origin_id == session.client_id {
                    session.last_applied_revision = state.revision;
                } else {
                    // A guest steered: the host's player follows, then keeps
                    // publishing from the new state instead of the old one.
                    apply_playback(provider, session, state.clone()).await;
                    session.last_publish = Some(PublishMemo {
                        track_uri: state.track.as_ref().map(|track| track.uri.clone()),
                        is_playing: state.is_playing,
                        position_ms: expected_position_ms(
                            state.position_ms,
                            state.is_playing,
                            state.server_time_ms,
                            now_ms().saturating_add(session.clock_offset_ms),
                            state.track.as_ref().and_then(|track| track.duration_ms),
                        ),
                        shuffle: false,
                        repeat: CoreRepeat::One,
                        at: Instant::now(),
                    });
                }
            }
            emit(app, session);
        }
        ServerMessage::Queue { queue } => {
            if let Some(room) = session.room.as_mut() {
                if queue.revision <= room.queue.revision {
                    return;
                }
                room.queue = queue.clone();
            }
            if session.role != "host" {
                apply_queue(session, queue);
            }
            emit(app, session);
        }
        ServerMessage::Error { code, message } => {
            if code == ErrorCode::StaleRevision {
                // A publish crossed a guest's change; not the user's problem.
                session.queue_runtime.publish_pending = None;
                session.queue_runtime.advance_pending = None;
                session.request_state = true;
                return;
            }
            let message = error_key(code, &message).to_owned();
            session.error = Some(message.clone());
            if matches!(code, ErrorCode::RoomNotFound | ErrorCode::Unauthorized) {
                release_room(provider, session).await;
                session.room = None;
                session.resume_token = None;
                session.role = "none".into();
            }
            session.queue_runtime.publish_pending = None;
            session.queue_runtime.advance_pending = None;
            finish_pending(session, Err(message));
            emit(app, session);
        }
    }
}

/// Relay errors as texts the page can translate.
fn error_key(code: ErrorCode, message: &str) -> &'static str {
    match code {
        ErrorCode::Protocol => "listen.protocolMismatch",
        ErrorCode::RoomNotFound if message == "room closed" => "listen.error.roomClosed",
        ErrorCode::RoomNotFound => "listen.error.roomNotFound",
        ErrorCode::InvalidCode => "listen.error.invalidCode",
        ErrorCode::RoomFull => "listen.error.roomFull",
        ErrorCode::HostOnly => "listen.controlLocked",
        ErrorCode::Unauthorized => "listen.error.sessionExpired",
        ErrorCode::RateLimited => "listen.error.rateLimited",
        ErrorCode::InvalidMessage | ErrorCode::NotInRoom | ErrorCode::StaleRevision => {
            "listen.error.generic"
        }
    }
}

/// The relay hands the room over when the host leaves or stays gone.
fn follow_host(session: &mut Session, room: &RoomSnapshot) {
    let host = room.host_id == session.client_id;
    if session.role != "none" && host != (session.role == "host") {
        session.role = if host { "host".into() } else { "guest".into() };
        // Publish from the room's state once applied, not from an old memo.
        session.last_publish = None;
        session.last_seek = None;
    }
}

fn host_should_publish(last: Option<&PublishMemo>, state: &PlaybackState) -> bool {
    let Some(last) = last else {
        return true;
    };
    let uri = state.current_item.as_ref().map(|item| item.uri.as_str());
    if uri != last.track_uri.as_deref()
        || state.is_playing != last.is_playing
        || state.shuffle_enabled != last.shuffle
        || state.repeat_mode != last.repeat
    {
        return true;
    }
    let elapsed = last.at.elapsed().as_millis() as i64;
    let expected = if last.is_playing {
        last.position_ms as i64 + elapsed
    } else {
        last.position_ms as i64
    };
    (state.position_ms as i64 - expected).abs() >= luft_listen_together::DRIFT_SEEK_MS
        || last.at.elapsed() >= PUBLISH_HEARTBEAT
}

fn finish_pending(session: &mut Session, result: Result<ListenTogetherStatus, String>) {
    if let Some(pending) = session.pending.take() {
        let tx = match pending {
            Pending::Create(tx) | Pending::Join(tx) => tx,
        };
        let _ = tx.send(result);
    }
}

fn emit(app: &AppHandle, session: &mut Session) {
    let status = session.status();
    if session.last_emitted.as_ref() == Some(&status) {
        return;
    }
    let _ = app.emit("listen-together://status", &status);
    session.last_emitted = Some(status);
}

fn now_ms() -> i64 {
    luft_listen_together::server_now_ms()
}
