//! Engine-independent listen-together protocol and room logic.
//! The sync server never carries audio.

pub mod achievements;
pub mod admin;
pub mod appearance;
pub mod badges;
pub mod chat;
pub mod devices;
pub mod media;
pub mod playlists;
mod clock;
mod codes;
mod drift;
mod identity;
mod protocol;
pub mod recovery;
pub mod remote;
pub mod reports;
mod revision;
mod roles;
mod room;
pub mod social;

pub use appearance::ProfileStyle;
pub use badges::BadgeDefinition;
pub use playlists::{PlaylistShare, SharedPlaylist};
pub use reports::{ProblemReport, ProblemReportInput, ProblemReportSummary};
pub use social::{
    Activity, FriendEntry, FriendInvitation, FriendPresence, FriendRequest, ListenAlongState, PresenceMode, PresenceUpdate, RecentTrack,
    RoomProof, ServerOverview, SocialAction, SocialError, SocialOptions, SocialProfile,
    SocialProfileInput, SocialRegistration, SocialRole, SocialSnapshot,
};

pub use clock::{clock_offset_ms, expected_position_ms, server_now_ms};
pub use codes::{JOIN_CODE_LEN, generate_join_code, normalize_join_code};
pub use drift::{DRIFT_IGNORE_MS, DRIFT_SEEK_MS, DriftAction, classify_drift};
pub use identity::{TrackRef, normalize_provider, track_key};
pub use protocol::{
    AuthoritativePlayback, ClientMessage, ControlMode, ErrorCode, QueueGroup, QueuePolicy, Participant, PROTOCOL_VERSION,
    PlaybackIntent, QueueSnapshot, QueueEntry, QueueEdit, RepeatMode, RoomControl, RoomSnapshot, ServerMessage, parse_client_message,
};
pub use revision::should_apply_revision;
pub use room::{Hub, HubEvent, RoomError, SavedRooms, valid_avatar};

/// The hosted Luftify sync server; nobody has to enter it.
pub const DEFAULT_SYNC_URL: &str = "wss://luftify-server.invalid";
/// The default before the hosted server. Stored settings with it move to
/// DEFAULT_SYNC_URL; a local server stays reachable as `ws://localhost:7421`.
pub const LEGACY_SYNC_URL: &str = "ws://127.0.0.1:7421";
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_QUEUE_ITEMS: usize = 200;
/// Songs per `AddMany`; clients split larger selections.
pub const MAX_BATCH_TRACKS: usize = 50;
pub const MAX_DISPLAY_NAME: usize = 32;
pub const MAX_CONNECTIONS: usize = 32;
