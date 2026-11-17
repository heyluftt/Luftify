//! Persistent social profiles are independent of ephemeral listening-room identities.
use serde::{Deserialize, Serialize};

pub use crate::roles::{
    GRANTABLE_ROLES, SocialRole, normalize_custom_code, parse_roles, store_roles, valid_friend_code,
};
use crate::{TrackRef, MAX_DISPLAY_NAME, valid_avatar};

/// 2: roles, custom friend codes, recent tracks, room badges and the server overview.
/// 3: custom badges and a profile status line.
/// 4: profile accent, banner and profile song.
/// 5: activity (online, away, do not disturb), status mode and last seen.
/// 6: avatar frame, banner effect, name gradient and status emoji.
/// 7: problem reports to Luft (`/social/v1/reports`).
/// 8: frames prism/orbit and effects veil/lights.
/// 9: banners midnight and candy.
/// 10: own profile colour, name gradient colour, moving picture and own banner (`/social/v1/media`).
/// 11: listening along (`/social/v1/listen-along/{id}`), playback position in presence, `listeners`.
/// 12: a badge inventory: the look chooses which owned badges are shown (`shownBadges`).
/// 13: achievements (`achievements`, `achievementProgress`, `quest:` badges, frame "aurum"),
///     Luft's user overview (`/social/v1/admin/users`), moderation, app version in presence.
/// 14: recovery code (`/social/v1/recovery`, `/social/v1/restore`).
/// 15: hide listening from single friends (`setListeningHidden`, `listeningHidden`).
/// 16: own start colour of the name gradient (`nameFrom`), Luft tools (audit log, server state, backup, announcement, sign-ups).
/// 17: achievements in the profile only when chosen (`showTrophies`).
/// 18: more devices per profile (`/social/v1/devices`, link codes); a playing device keeps the presence.
/// 19: presence per device (the one that started playing last is shown), remote control (`/social/v1/remote`).
/// 20: shared playlists (`sharePlaylist`, `dismissPlaylistShare`, `playlistShares`).
/// 21: frame "pulse", banner "city", effect "petals".
/// 22: private playlist account keys for matching contributions to Luftify friends.
/// 23: private friend chats (`/social/v1/chats`), idempotent sending and read cursors.
/// 24: chat inbox tells how far the friend has read (`peerRead`).
pub const SOCIAL_PROTOCOL_VERSION: u32 = 26;
/// A follower asks this often; the server forgets one after `LISTENER_TTL_MS` without asking.
pub const LISTEN_ALONG_POLL_MS: u64 = 2_000;
pub const LISTENER_TTL_MS: i64 = 10_000;
/// Without input for this long and without music, a session counts as away.
pub const AWAY_AFTER_MS: u64 = 10 * 60_000;
pub const PRESENCE_TTL_MS: i64 = 45_000;
pub const INVITATION_TTL_MS: i64 = 10 * 60_000;
pub const MAX_FRIENDS: usize = 200;
/// Recently played tracks kept per profile, in memory only.
pub const MAX_RECENT_TRACKS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialProfileInput {
    pub display_name: String,
    pub avatar_uri: Option<String>,
}

impl SocialProfileInput {
    pub fn validate(&mut self) -> bool {
        self.display_name = self.display_name.trim().to_owned();
        !self.display_name.is_empty()
            && self.display_name.chars().count() <= MAX_DISPLAY_NAME
            && !self.display_name.chars().any(char::is_control)
            && valid_avatar(self.avatar_uri.as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialProfile {
    pub id: String,
    pub friend_code: String,
    pub display_name: String,
    pub avatar_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<SocialRole>,
    /// Ids from the snapshot's badge catalog, in the order Luft gave them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<crate::ProfileStyle>,
    /// The song pinned to the profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite: Option<TrackRef>,
    /// Ids of the achievements reached; each is a badge in the inventory.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub achievements: Vec<String>,
}

impl SocialProfile {
    pub fn has(&self, role: SocialRole) -> bool {
        self.roles.contains(&role)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialOptions {
    pub discoverable: bool,
    pub share_online: bool,
    pub share_listening: bool,
    pub allow_invites: bool,
    #[serde(default)]
    pub presence_mode: PresenceMode,
}

impl Default for SocialOptions {
    fn default() -> Self {
        Self {
            discoverable: true,
            share_online: true,
            share_listening: false,
            allow_invites: true,
            presence_mode: PresenceMode::Auto,
        }
    }
}

/// What the listener chose; `Auto` follows activity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceMode {
    #[default]
    Auto,
    Away,
    Busy,
    /// Looks offline to friends; nothing is shared.
    Invisible,
}

impl PresenceMode {
    pub fn key(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Away => "away",
            Self::Busy => "busy",
            Self::Invisible => "invisible",
        }
    }

    pub fn from_key(key: &str) -> Self {
        [Self::Away, Self::Busy, Self::Invisible].into_iter().find(|mode| mode.key() == key).unwrap_or(Self::Auto)
    }
}

/// What friends see.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Activity {
    #[default]
    Offline,
    Online,
    Away,
    Busy,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendPresence {
    pub online: bool,
    pub track: Option<TrackRef>,
    pub is_playing: bool,
    #[serde(default)]
    pub activity: Activity,
    /// When the friend was last online, if they share their online status.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<i64>,
    /// Where the shared track was at `position_at_ms` (server time), for listening along.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_at_ms: Option<i64>,
}

/// A friend's playback for listening along, with the server clock to place it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenAlongState {
    pub presence: FriendPresence,
    pub server_time_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendEntry {
    pub profile: SocialProfile,
    pub presence: FriendPresence,
    /// Only while the friend shares their listening status, newest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent: Vec<RecentTrack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_ms: Option<i64>,
    /// I hide my listening from this friend; they are not told.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub listening_hidden: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTrack {
    pub track: TrackRef,
    pub played_at_ms: i64,
}

/// For Luft and developers only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOverview {
    pub profiles: u32,
    pub online: u32,
    pub listening: u32,
    pub rooms: u32,
    /// Everyone holding a grantable role, for the role overview.
    #[serde(default)]
    pub team: Vec<SocialProfile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequest {
    pub id: String,
    pub profile: SocialProfile,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendInvitation {
    pub id: String,
    pub from: SocialProfile,
    pub join_code: String,
    pub expires_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialSnapshot {
    pub me: SocialProfile,
    pub options: SocialOptions,
    pub friends: Vec<FriendEntry>,
    pub incoming_requests: Vec<FriendRequest>,
    pub outgoing_requests: Vec<FriendRequest>,
    pub invitations: Vec<FriendInvitation>,
    pub blocked: Vec<SocialProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<ServerOverview>,
    /// Every badge on this server, to show the ids on profiles.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub badges: Vec<crate::BadgeDefinition>,
    /// Your own recent tracks, as friends see them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent: Vec<RecentTrack>,
    /// Friends listening along with you right now (profile ids).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub listeners: Vec<String>,
    /// Your achievements with their progress.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub achievement_progress: Vec<crate::achievements::AchievementState>,
    /// A line from Luft for everyone, e.g. before maintenance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announcement: Option<String>,
    /// Playlists friends sent to join, newest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub playlist_shares: Vec<crate::PlaylistShare>,
    /// Only the viewer's and their friends' comparison keys, never Spotify names.
    #[serde(default)]
    pub playlist_accounts: Vec<PlaylistAccount>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistAccount { pub profile_id: String, pub account_key: String }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialRegistration {
    // Private credential: never include in desktop status, diagnostics or logs.
    pub token: String,
    pub snapshot: SocialSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SocialAction {
    Request { friend_code: String },
    RespondRequest { request_id: String, accept: bool },
    CancelRequest { request_id: String },
    RemoveFriend { profile_id: String },
    Block { profile_id: String },
    Unblock { profile_id: String },
    UpdateProfile { profile: SocialProfileInput },
    BindPlaylistAccount { account_key: String },
    UpdateOptions { options: SocialOptions },
    Invite { profile_id: String, join_code: String, room_token: String },
    DismissInvite { invitation_id: String },
    /// Luft only; the other person must be a confirmed friend.
    SetRole { profile_id: String, role: SocialRole, enabled: bool },
    /// Luft only: a short custom code such as `LF-LUFT`.
    SetFriendCode { code: String },
    /// Luft only: create (empty id) or change a badge.
    SaveBadge { badge: crate::BadgeDefinition },
    /// Luft only; also takes it off every profile.
    DeleteBadge { id: String },
    /// Luft only; giving needs a confirmed friend, taking back never does.
    SetBadge { profile_id: String, badge_id: String, enabled: bool },
    SetBio { bio: Option<String> },
    /// `None` returns to the default look.
    SetStyle { style: Option<crate::ProfileStyle> },
    SetFavorite { track: Option<TrackRef> },
    /// Luft only: suspend, unsuspend or clear another profile (never Luft).
    Moderate { profile_id: String, moderation: crate::admin::Moderation },
    /// This one friend no longer sees what I play or played (`FriendEntry.listening_hidden`).
    SetListeningHidden { profile_id: String, hidden: bool },
    /// Luft only: the server-wide switches (sign-ups, announcement).
    SetServerSettings { settings: crate::admin::ServerSettings },
    /// Sends a playlist to a friend to join; again for the same one renews it.
    SharePlaylist { profile_id: String, playlist: crate::SharedPlaylist },
    /// Joined or not wanted: it leaves the recipient's list.
    DismissPlaylistShare { share_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUpdate {
    pub online: bool,
    pub track: Option<TrackRef>,
    pub is_playing: bool,
    /// No input for AWAY_AFTER_MS and nothing playing.
    #[serde(default)]
    pub away: bool,
    /// Where the track is now; friends listening along start there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    /// The running app's version; only Luft sees it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    /// `"android"` from the phone app; missing means the PC app.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_platform: Option<String>,
    /// Proof of the current room membership, so the room shows this profile's roles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room: Option<RoomProof>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomProof {
    pub join_code: String,
    // Private room credential: never log.
    pub room_token: String,
}

impl std::fmt::Debug for RoomProof {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RoomProof").field("join_code", &self.join_code).finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialError {
    pub code: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_and_privacy_defaults_are_bounded() {
        assert!(!SocialOptions::default().share_listening);
        let mut profile = SocialProfileInput { display_name: " Sam ".into(), avatar_uri: None };
        assert!(profile.validate());
        assert_eq!(profile.display_name, "Sam");
        profile.display_name = "\n".into();
        assert!(!profile.validate());
        profile.display_name = "a".repeat(33);
        assert!(!profile.validate());
        profile.display_name = "Sam".into();
        profile.avatar_uri = Some("https://example.com/avatar".into());
        assert!(!profile.validate());
    }
}
