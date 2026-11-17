//! Luft's view of the server: every profile with what an admin needs, and
//! the moderation steps. Only Luft reads or acts; the server checks.
use serde::{Deserialize, Serialize};

use crate::social::SocialProfile;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub profile: SocialProfile,
    /// A session is running right now, whatever the profile shows friends.
    pub online: bool,
    /// Music is playing and shared with friends.
    pub listening: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<i64>,
    /// The PC app's version, running now or last seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    /// The phone app's version, running now or last seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone_version: Option<String>,
    pub friends: u32,
    pub media_bytes: u64,
    pub suspended: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOverview {
    pub users: Vec<AdminUser>,
    pub media_bytes: u64,
    pub media_limit_bytes: u64,
    pub rooms: u32,
    /// The server process: when it started, its version, the database size.
    #[serde(default)]
    pub server: ServerState,
    /// Recent admin actions, newest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<AdminLogEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    pub started_at_ms: i64,
    pub version: String,
    pub database_bytes: u64,
    pub settings: ServerSettings,
    /// People in listening rooms right now.
    pub room_members: u32,
    /// Problem reports waiting.
    pub reports: u32,
    /// Daily copies of the database on the server (newest seven kept).
    #[serde(default)]
    pub backups: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_backup_ms: Option<i64>,
}

/// Switches for the whole server; only Luft changes them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    /// New profiles may be created. Existing ones and restores always work.
    pub signups_open: bool,
    /// A short line every app shows, e.g. before maintenance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announcement: Option<String>,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self { signups_open: true, announcement: None }
    }
}

pub const MAX_ANNOUNCEMENT: usize = 200;

/// A trimmed announcement without control characters; empty means none.
pub fn clean_announcement(text: Option<String>) -> Result<Option<String>, ()> {
    let Some(text) = text.map(|text| text.trim().to_owned()).filter(|text| !text.is_empty()) else { return Ok(None) };
    if text.chars().count() > MAX_ANNOUNCEMENT || text.chars().any(char::is_control) {
        return Err(());
    }
    Ok(Some(text))
}

/// One admin action as the log shows it; names as they were at the time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLogEntry {
    pub at_ms: i64,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// A key such as `suspend`, `role`, `badge`, `code`, `signups`, `announcement`, `backup`.
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// What Luft can do to another profile. Never to Luft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Moderation {
    /// The profile can no longer use friends features until unsuspended.
    Suspend,
    Unsuspend,
    /// Removes picture, status, look and profile song; name and friends stay.
    ClearProfile,
    /// Replaces the display name with a neutral one ("Person 1A2B").
    ResetName,
}

impl Moderation {
    pub fn key(self) -> &'static str {
        match self {
            Self::Suspend => "suspend",
            Self::Unsuspend => "unsuspend",
            Self::ClearProfile => "clearProfile",
            Self::ResetName => "resetName",
        }
    }
}

/// Versions like `0.1.12`, nothing else, so the field cannot carry text.
pub fn clean_app_version(version: Option<String>) -> Option<String> {
    version.filter(|version| {
        (1..=16).contains(&version.len()) && version.bytes().all(|b| b.is_ascii_digit() || b == b'.')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn announcements_are_short_plain_lines() {
        assert_eq!(clean_announcement(Some("  Update um 20 Uhr ".into())), Ok(Some("Update um 20 Uhr".into())));
        assert_eq!(clean_announcement(Some("   ".into())), Ok(None));
        assert!(clean_announcement(Some("a
b".into())).is_err());
        assert!(clean_announcement(Some("x".repeat(MAX_ANNOUNCEMENT + 1))).is_err());
    }

    #[test]
    fn app_versions_are_plain_numbers() {
        assert_eq!(clean_app_version(Some("0.1.12".into())).as_deref(), Some("0.1.12"));
        assert_eq!(clean_app_version(Some("<b>hi</b>".into())), None);
        assert_eq!(clean_app_version(Some(String::new())), None);
    }
}
