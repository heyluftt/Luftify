use serde::{Deserialize, Serialize};

pub const MAX_PROVIDER_LEN: usize = 32;
pub const MAX_URI_LEN: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRef {
    pub provider: String,
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artists: Vec<String>,
}

impl TrackRef {
    pub fn new(provider: impl Into<String>, uri: impl Into<String>) -> Option<Self> {
        let provider = normalize_provider(&provider.into())?;
        let uri = uri.into();
        let uri = uri.trim();
        if uri.is_empty() || uri.chars().count() > MAX_URI_LEN {
            return None;
        }
        Some(Self {
            provider,
            uri: uri.to_owned(),
            title: None,
            duration_ms: None,
            context_uri: None,
            cover_uri: None,
            artists: Vec::new(),
        })
    }

    #[must_use]
    pub fn key(&self) -> String {
        track_key(&self.provider, &self.uri)
    }

    pub fn sanitize(self) -> Option<Self> {
        let mut track = Self::new(self.provider, self.uri)?;
        track.title = self
            .title
            .map(|title| title.chars().take(200).collect::<String>())
            .filter(|title| !title.trim().is_empty());
        track.duration_ms = self
            .duration_ms
            .filter(|ms| *ms > 0 && *ms < 24 * 60 * 60 * 1_000);
        track.artists = self
            .artists
            .into_iter()
            .take(12)
            .map(|name| name.trim().chars().take(120).collect::<String>())
            .filter(|name| !name.is_empty())
            .collect();
        track.cover_uri = self.cover_uri.filter(|uri| {
            uri.len() <= 2048
                && uri.starts_with("https://")
                && !uri[8..].split('/').next().unwrap_or_default().contains('@')
        });
        track.context_uri = self.context_uri.and_then(|uri| {
            let uri = uri.trim();
            (!uri.is_empty() && uri.chars().count() <= MAX_URI_LEN).then(|| uri.to_owned())
        });
        Some(track)
    }
}

#[must_use]
pub fn normalize_provider(provider: &str) -> Option<String> {
    let provider = provider.trim().to_ascii_lowercase();
    if provider.is_empty() || provider.len() > MAX_PROVIDER_LEN {
        return None;
    }
    if !provider
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return None;
    }
    Some(provider)
}

#[must_use]
pub fn track_key(provider: &str, uri: &str) -> String {
    format!("{provider}:{uri}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_or_oversized_identity() {
        assert!(TrackRef::new("", "spotify:track:one").is_none());
        assert!(TrackRef::new("spotify", "").is_none());
        assert!(TrackRef::new("spotify!", "spotify:track:one").is_none());
        assert!(TrackRef::new("spotify", "x".repeat(MAX_URI_LEN + 1)).is_none());
    }

    #[test]
    fn keys_are_provider_plus_uri() {
        let track = TrackRef::new("Spotify", "spotify:track:one").expect("track");
        assert_eq!(track.provider, "spotify");
        assert_eq!(track.key(), "spotify:spotify:track:one");
    }
}
