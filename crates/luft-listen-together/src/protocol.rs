use serde::{Deserialize, Serialize};
use serde_json::Error as JsonError;

use crate::{MAX_MESSAGE_BYTES, TrackRef};

/// 3: guests may be allowed to steer (`SetControl`, `Control`).
pub const PROTOCOL_VERSION: u16 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

impl Default for RepeatMode {
    fn default() -> Self {
        Self::Off
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlMode {
    /// Only the host plays, pauses, seeks and skips others' songs.
    HostOnly,
    /// The host lets every guest steer too.
    Everyone,
}

impl Default for ControlMode {
    fn default() -> Self {
        Self::HostOnly
    }
}

/// Who may move and remove waiting songs. Adding is always open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueuePolicy {
    /// Everyone edits every waiting song.
    #[default]
    Open,
    /// Guests edit only the songs they added; the host edits all.
    OwnSongs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidMessage,
    InvalidCode,
    RoomNotFound,
    RoomFull,
    NotInRoom,
    HostOnly,
    StaleRevision,
    RateLimited,
    Unauthorized,
    Protocol,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_uri: Option<String>,
    pub id: String,
    pub display_name: String,
    pub is_host: bool,
    pub connected: bool,
    /// Set by the server from the member's verified friends profile.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<crate::SocialRole>,
    /// Badge ids, verified like the roles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoritativePlayback {
    pub revision: u64,
    pub origin_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackRef>,
    pub position_ms: u64,
    pub is_playing: bool,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub server_time_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub revision: u64,
    pub current: Option<QueueEntry>,
    pub items: Vec<QueueEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub track: TrackRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by_name: Option<String>,
    /// The playlist or album this song came in with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<QueueGroup>,
}

/// Songs added together keep a shared id and the collection's name, so the
/// queue shows them as one block that can be moved or trimmed at once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueGroup {
    pub id: String,
    pub name: String,
}

/// Anchors refer to occurrences, never indices or track URIs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum QueueEdit {
    /// Select one song immediately without replacing the waiting playlist.
    PlayNow { track: TrackRef },
    /// Play an exact waiting occurrence, preserving all other occurrences.
    PlayQueued { id: String },
    Add {
        track: TrackRef,
    },
    Remove {
        id: String,
    },
    Move {
        id: String,
        before_id: Option<String>,
    },
    /// A playlist, an album or a selection in one operation, so every member
    /// receives one queue update instead of one per song. `next` puts them
    /// before everything already waiting, in their order.
    AddMany {
        tracks: Vec<TrackRef>,
        #[serde(default)]
        next: bool,
        /// Several batches of one playlist carry the same group.
        #[serde(default)]
        group: Option<QueueGroup>,
    },
    /// Waiting songs only; already removed ids are ignored.
    RemoveMany {
        ids: Vec<String>,
    },
    /// Moves the listed waiting songs, in queue order, before `before_id`
    /// (or to the end).
    MoveMany {
        ids: Vec<String>,
        before_id: Option<String>,
    },
    /// Steering: host, or everyone when the room allows it.
    Shuffle,
    Clear,
}

/// A transport change asked for by anyone allowed to steer; the relay turns
/// it into the next authoritative playback.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RoomControl {
    Play,
    Pause,
    Seek { position_ms: u64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomSnapshot {
    pub id: String,
    pub code: String,
    pub host_id: String,
    pub control: ControlMode,
    #[serde(default)]
    pub queue_policy: QueuePolicy,
    pub participants: Vec<Participant>,
    pub playback: AuthoritativePlayback,
    pub queue: QueueSnapshot,
    pub host_connected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackIntent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackRef>,
    pub position_ms: u64,
    pub is_playing: bool,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    Profile {
        display_name: String,
        avatar_uri: Option<String>,
    },
    Hello {
        protocol: u16,
        display_name: String,
        client_id: String,
    },
    CreateRoom {
        display_name: String,
    },
    JoinRoom {
        code: String,
        display_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resume_token: Option<String>,
    },
    LeaveRoom,
    PlaybackIntent {
        revision_base: u64,
        intent: PlaybackIntent,
    },
    QueueReplace {
        revision_base: u64,
        items: Vec<TrackRef>,
    },
    QueueEdit {
        room_id: String,
        operation_id: String,
        edit: QueueEdit,
    },
    QueueAdvance {
        room_id: String,
        current_id: Option<String>,
    },
    RequestState,
    SetControl {
        mode: ControlMode,
    },
    SetQueuePolicy {
        policy: QueuePolicy,
    },
    Control {
        action: RoomControl,
    },
    Ping {
        client_time_ms: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    QueueAck {
        operation_id: String,
        error: Option<String>,
    },
    HelloOk {
        client_id: String,
        server_time_ms: i64,
        protocol: u16,
    },
    RoomCreated {
        room: RoomSnapshot,
        resume_token: String,
        you: Participant,
    },
    Joined {
        room: RoomSnapshot,
        resume_token: String,
        you: Participant,
    },
    RoomUpdated {
        room: RoomSnapshot,
    },
    Playback {
        state: AuthoritativePlayback,
    },
    Queue {
        queue: QueueSnapshot,
    },
    Pong {
        client_time_ms: i64,
        server_time_ms: i64,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
}

pub fn parse_client_message(raw: &str) -> Result<ClientMessage, JsonError> {
    if raw.len() > MAX_MESSAGE_BYTES {
        return Err(serde::de::Error::custom("message too large"));
    }
    serde_json::from_str(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tagged_json_roundtrips() {
        let message = ClientMessage::Ping { client_time_ms: 12 };
        let encoded = serde_json::to_string(&message).expect("json");
        assert!(encoded.contains("\"type\":\"ping\""));
        let parsed = parse_client_message(&encoded).expect("parse");
        assert_eq!(parsed, message);
    }

    #[test]
    fn control_messages_use_camel_case_tags() {
        let seek = serde_json::to_string(&ClientMessage::Control {
            action: RoomControl::Seek { position_ms: 90_000 },
        })
        .expect("json");
        assert_eq!(seek, r#"{"type":"control","action":{"type":"seek","positionMs":90000}}"#);
        let mode = serde_json::to_string(&ClientMessage::SetControl { mode: ControlMode::Everyone })
            .expect("json");
        assert_eq!(mode, r#"{"type":"setControl","mode":"everyone"}"#);
    }

    #[test]
    fn oversized_payloads_are_rejected() {
        let raw = "x".repeat(MAX_MESSAGE_BYTES + 1);
        assert!(parse_client_message(&raw).is_err());
    }
}
