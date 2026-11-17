use super::*;

use librespot::metadata::{Metadata, Track};
use serde::Serialize;

/// A recap story needs a handful of songs; more is never requested.
const MAX_PREVIEW_TRACKS: usize = 16;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(6);
/// Spotify's public 30-second clips, the same the web player used.
const PREVIEW_CDN: &str = "https://p.scdn.co/mp3-preview/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPreview {
    pub uri: String,
    /// Missing when Spotify has no clip for the song.
    pub url: Option<String>,
}

impl LibrespotService {
    /// Short clips for songs, played apart from the player (recap story).
    /// Needs a running Libre session for the metadata; the clip itself is an
    /// unencrypted MP3 on Spotify's CDN, so playback never touches the queue.
    pub async fn track_previews(&self, uris: Vec<String>) -> Result<Vec<TrackPreview>, ProviderError> {
        let session = self.session_clone().await?;
        let mut lookups = tokio::task::JoinSet::new();
        for (index, uri) in uris.into_iter().take(MAX_PREVIEW_TRACKS).enumerate() {
            let session = session.clone();
            lookups.spawn(async move {
                let url = tokio::time::timeout(PREVIEW_TIMEOUT, preview_url(&session, &uri))
                    .await
                    .ok()
                    .flatten();
                (index, TrackPreview { uri, url })
            });
        }
        let mut previews = Vec::new();
        while let Some(result) = lookups.join_next().await {
            if let Ok(preview) = result {
                previews.push(preview);
            }
        }
        previews.sort_by_key(|(index, _)| *index);
        info!(
            adapter = "librespot",
            phase = "track-previews",
            requested = previews.len(),
            found = previews.iter().filter(|(_, preview)| preview.url.is_some()).count(),
            "track previews resolved"
        );
        Ok(previews.into_iter().map(|(_, preview)| preview).collect())
    }
}

async fn preview_url(session: &Session, uri: &str) -> Option<String> {
    let parsed = SpotifyUri::from_uri(uri).ok()?;
    if !matches!(parsed, SpotifyUri::Track { .. }) {
        return None;
    }
    let track = Track::get(session, &parsed).await.ok()?;
    let file = track.previews.values().next()?;
    preview_cdn_url(file.to_base16().ok()?)
}

fn preview_cdn_url(file_hex: String) -> Option<String> {
    (file_hex.len() == 40 && file_hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| format!("{PREVIEW_CDN}{file_hex}"))
}

#[cfg(test)]
mod tests {
    use super::preview_cdn_url;

    #[test]
    fn preview_links_only_carry_a_file_id() {
        let id = "a".repeat(40);
        assert_eq!(preview_cdn_url(id.clone()).as_deref(), Some(format!("https://p.scdn.co/mp3-preview/{id}").as_str()));
        assert_eq!(preview_cdn_url("../evil".into()), None);
        assert_eq!(preview_cdn_url("b".repeat(39)), None);
    }
}
