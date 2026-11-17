//! Shared playlists: a friend sends a collaborative Spotify playlist to join.
use serde::{Deserialize, Serialize};

use crate::social::SocialProfile;

/// A sent playlist waits this long, unless it is joined or dismissed first.
pub const PLAYLIST_SHARE_TTL_MS: i64 = 14 * 24 * 60 * 60_000;
/// Newest ones a profile keeps; older ones fall away.
pub const MAX_PLAYLIST_SHARES: usize = 30;
pub const MAX_PLAYLIST_NAME: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedPlaylist {
    pub uri: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
}

impl SharedPlaylist {
    /// Only a plain Spotify playlist with a name; a cover only over https.
    pub fn sanitize(self) -> Option<Self> {
        let uri = self.uri.trim();
        let id = uri.strip_prefix("spotify:playlist:")?;
        if id.len() != 22 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
            return None;
        }
        let name = self.name.trim().chars().take(MAX_PLAYLIST_NAME).collect::<String>();
        if name.is_empty() {
            return None;
        }
        let cover_uri = self.cover_uri.filter(|cover| {
            cover.len() <= 2048
                && cover.starts_with("https://")
                && !cover[8..].split('/').next().unwrap_or_default().contains('@')
        });
        Some(Self { uri: uri.to_owned(), name, cover_uri })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistShare {
    pub id: String,
    pub from: SocialProfile,
    pub playlist: SharedPlaylist,
    pub created_at_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playlist(uri: &str, name: &str, cover: Option<&str>) -> SharedPlaylist {
        SharedPlaylist { uri: uri.into(), name: name.into(), cover_uri: cover.map(Into::into) }
    }

    #[test]
    fn only_named_spotify_playlists_pass() {
        let ok = playlist(" spotify:playlist:37i9dQZF1DXcBWIGoYBM5M ", "  Roadtrip ", Some("https://i.scdn.co/image/ab"));
        let clean = ok.sanitize().expect("playlist");
        assert_eq!(clean.uri, "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
        assert_eq!(clean.name, "Roadtrip");
        assert!(clean.cover_uri.is_some());
        assert!(playlist("spotify:album:37i9dQZF1DXcBWIGoYBM5M", "x", None).sanitize().is_none());
        assert!(playlist("spotify:playlist:short", "x", None).sanitize().is_none());
        assert!(playlist("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", " ", None).sanitize().is_none());
        let cover = playlist("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", "x", Some("http://a/b")).sanitize();
        assert_eq!(cover.and_then(|p| p.cover_uri), None);
    }
}
