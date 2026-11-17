//! Remote control between the devices of one friends profile, like Spotify
//! Connect: every device announces itself, a player shares what it plays,
//! and another device sends it commands. The server only relays inside one
//! profile (`/social/v1/remote`); field names are camelCase throughout.
use serde::{Deserialize, Serialize};

use crate::TrackRef;

pub const MAX_REMOTE_DEVICES: usize = 6;
/// A list started from the phone: what it shows, not a whole library.
pub const MAX_REMOTE_TRACKS: usize = 100;
pub const MAX_REMOTE_MESSAGE_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Desktop,
    Phone,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDevice {
    /// The device handle (devices.rs), "main" for the profile's first device.
    pub id: String,
    pub label: String,
    pub kind: DeviceKind,
    /// Plays music and takes commands.
    pub player: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track: Option<TrackRef>,
    pub is_playing: bool,
    pub position_ms: u64,
    #[serde(default)]
    pub duration_ms: u64,
    /// Server time the position was true at; the relay sets it on arrival.
    #[serde(default)]
    pub at_ms: i64,
    /// 0.0–1.0
    #[serde(default)]
    pub volume: f64,
    #[serde(default)]
    pub liked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RemoteCommand {
    Play,
    Pause,
    Next,
    Previous,
    Seek { position_ms: u64 },
    /// Plays `uris[index]`, from its list (`context_uri`) where known, at `position_ms`.
    PlayTracks {
        uris: Vec<String>,
        index: usize,
        #[serde(default)]
        context_uri: Option<String>,
        #[serde(default)]
        position_ms: Option<u64>,
    },
    Queue { uris: Vec<String> },
    SetVolume { volume: f64 },
    ToggleLike,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RemoteClientMessage {
    Hello { label: String, kind: DeviceKind, player: bool },
    State { state: RemoteState },
    Command { target: String, command: RemoteCommand },
    Ping { client_time_ms: i64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RemoteServerMessage {
    /// Who is online, sent to everyone whenever it changes.
    Devices { you: String, devices: Vec<RemoteDevice> },
    State { device: String, state: RemoteState },
    Command { from: String, from_label: String, command: RemoteCommand },
    Pong { client_time_ms: i64, server_time_ms: i64 },
    Error { code: String },
    /// The conversation with `peer` changed (a message or a read): the app
    /// fetches it now instead of at its next poll. Older apps ignore it.
    Chat { peer: String },
}

fn valid_track_uri(uri: &str) -> bool {
    uri.strip_prefix("spotify:track:")
        .is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

fn valid_context_uri(uri: &str) -> bool {
    uri.starts_with("spotify:") && uri.len() <= 200 && !uri.chars().any(char::is_control)
}

impl RemoteCommand {
    /// Only Spotify tracks, a short list and sane numbers.
    #[must_use]
    pub fn valid(&self) -> bool {
        match self {
            Self::PlayTracks { uris, index, context_uri, .. } => {
                !uris.is_empty()
                    && uris.len() <= MAX_REMOTE_TRACKS
                    && *index < uris.len()
                    && uris.iter().all(|uri| valid_track_uri(uri))
                    && context_uri.as_deref().is_none_or(valid_context_uri)
            }
            Self::Queue { uris } => !uris.is_empty() && uris.len() <= MAX_REMOTE_TRACKS && uris.iter().all(|uri| valid_track_uri(uri)),
            Self::SetVolume { volume } => (0.0..=1.0).contains(volume),
            _ => true,
        }
    }
}

impl RemoteState {
    /// Keeps what friends' apps can show; drops a bad track or context.
    #[must_use]
    pub fn sanitize(mut self) -> Self {
        self.track = self.track.and_then(TrackRef::sanitize);
        self.context_uri = self.context_uri.filter(|uri| valid_context_uri(uri));
        self.volume = if self.volume.is_finite() { self.volume.clamp(0.0, 1.0) } else { 0.0 };
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_tagged_camel_case_and_commands_checked() {
        let seek = serde_json::to_string(&RemoteClientMessage::Command {
            target: "main".into(),
            command: RemoteCommand::Seek { position_ms: 5_000 },
        })
        .unwrap();
        assert_eq!(seek, r#"{"type":"command","target":"main","command":{"type":"seek","positionMs":5000}}"#);
        let track = "spotify:track:4uLU6hMCjMI75M1A2tKUQC".to_owned();
        assert!(RemoteCommand::PlayTracks { uris: vec![track.clone()], index: 0, context_uri: Some("spotify:playlist:x".into()), position_ms: None }.valid());
        assert!(!RemoteCommand::PlayTracks { uris: vec![track.clone()], index: 1, context_uri: None, position_ms: None }.valid());
        assert!(!RemoteCommand::Queue { uris: vec!["spotify:episode:1".into()] }.valid());
        assert!(!RemoteCommand::SetVolume { volume: 1.5 }.valid());
        let parsed: RemoteClientMessage = serde_json::from_str(r#"{"type":"hello","label":"PC","kind":"desktop","player":true}"#).unwrap();
        assert_eq!(parsed, RemoteClientMessage::Hello { label: "PC".into(), kind: DeviceKind::Desktop, player: true });
    }
}
