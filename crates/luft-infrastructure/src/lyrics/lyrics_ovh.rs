use std::time::Duration;

use reqwest::StatusCode;
use serde::Deserialize;
use url::Url;

use super::{LyricsDocument, LyricsError, LyricsLine, LyricsRequest, MAX_RESPONSE_BYTES};

const ENDPOINT: &str = "https://api.lyrics.ovh/v1";
const TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize)]
struct Response {
    lyrics: String,
}

pub(super) async fn get(
    client: &reqwest::Client,
    request: &LyricsRequest,
) -> Result<LyricsDocument, LyricsError> {
    let url = build_url(request)?;
    let response = client
        .get(url)
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|_| LyricsError::Unavailable)?;

    if response.status() == StatusCode::NOT_FOUND {
        return Err(LyricsError::NotFound);
    }
    if !response.status().is_success() {
        return Err(LyricsError::Unavailable);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(LyricsError::InvalidResponse);
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|_| LyricsError::Unavailable)?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(LyricsError::InvalidResponse);
    }

    let payload: Response =
        serde_json::from_slice(&bytes).map_err(|_| LyricsError::InvalidResponse)?;
    normalize(payload)
}

fn build_url(request: &LyricsRequest) -> Result<Url, LyricsError> {
    let mut url = Url::parse(ENDPOINT).map_err(|_| LyricsError::InvalidRequest)?;
    url.path_segments_mut()
        .map_err(|_| LyricsError::InvalidRequest)?
        .push(request.artist_name.trim())
        .push(request.track_name.trim());
    Ok(url)
}

fn normalize(payload: Response) -> Result<LyricsDocument, LyricsError> {
    let lines = payload
        .lyrics
        .lines()
        .filter_map(|line| {
            let text = line.trim();
            (!text.is_empty()).then(|| LyricsLine {
                start_ms: None,
                text: text.to_owned(),
            })
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        return Err(LyricsError::NotFound);
    }

    Ok(LyricsDocument {
        provider: "lyrics.ovh".into(),
        synced: false,
        instrumental: false,
        lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LyricsRequest {
        LyricsRequest {
            track_uri: Some("spotify:track:test".into()),
            track_name: "A/B + C".into(),
            artist_name: "Artist Name".into(),
            artist_names: Some(vec!["Artist Name".into()]),
            album_name: "Album".into(),
            duration_ms: 180_000,
            cover_uri: None,
        }
    }

    #[test]
    fn builds_an_encoded_artist_and_title_path() {
        let url = build_url(&request()).expect("lyrics.ovh URL");
        assert_eq!(
            url.as_str(),
            "https://api.lyrics.ovh/v1/Artist%20Name/A%2FB%20+%20C"
        );
    }

    #[test]
    fn normalizes_plain_lyrics_without_inventing_timestamps() {
        let document = normalize(Response {
            lyrics: "First line\n\n Second line ".into(),
        })
        .expect("plain lyrics");

        assert_eq!(document.provider, "lyrics.ovh");
        assert!(!document.synced);
        assert_eq!(document.lines.len(), 2);
        assert!(document.lines.iter().all(|line| line.start_ms.is_none()));
    }

    #[test]
    fn rejects_an_empty_plain_response() {
        assert!(matches!(
            normalize(Response {
                lyrics: " \n\t ".into()
            }),
            Err(LyricsError::NotFound)
        ));
    }
}
