//! A chosen JPEG is uploaded to Spotify, never to the social server.
//!
//! First the way the web player does it: the image goes to Spotify's image
//! service, is registered with the playlist and set as its picture through
//! the same playlist deltas that rename it. The public Web API is only the
//! fallback: for this client it answers 429 or refuses the scoped token.
use crate::{
    playlist::{fetch_metadata_playlist, playlist_id},
    session_http,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use http::Method;
use librespot::core::{Session, SpotifyUri};
use luft_core::ProviderError;
use serde_json::{Value, json};
use tracing::{info, warn};

const IMAGE_UPLOAD: &str = "https://image-upload.spotify.com/v4/playlist";
const PLAYLIST_HOST: &str = "https://spclient.wg.spotify.com";

const MAX_PAYLOAD: usize = 256 * 1024;
const SCOPES: &str = "ugc-image-upload,playlist-modify-private,playlist-modify-public";

pub(crate) async fn set(session: &Session, uri: &str, jpeg: &str) -> Result<(), ProviderError> {
    validate_jpeg(jpeg)?;
    let id = playlist_id(uri)
        .filter(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
        .ok_or_else(|| ProviderError::InvalidRequest("playlistCoverInvalid".into()))?;
    let parsed = SpotifyUri::from_uri(uri)
        .map_err(|_| ProviderError::InvalidRequest("playlistCoverInvalid".into()))?;
    let playlist = fetch_metadata_playlist(session, &parsed).await?;
    if !playlist.capabilities.can_edit_metadata {
        return Err(ProviderError::ActionRejected {
            message: "playlistCoverPermission".into(),
            retryable: false,
        });
    }
    let bytes = STANDARD.decode(jpeg).map_err(|_| ProviderError::InvalidRequest("playlistCoverInvalid".into()))?;
    if upload_like_web_player(session, uri, id, &bytes).await {
        return Ok(());
    }
    let url = format!("https://api.spotify.com/v1/playlists/{id}/images");
    // Use the existing authenticated session first, then the standard scoped token.
    // Empty 202 responses count as success, unlike errors or timeouts.
    let accepted = session_http::request_raw(
        session,
        &Method::PUT,
        &url,
        jpeg.as_bytes(),
        "image/jpeg",
        "application/json",
        &[],
    )
    .await;
    if accepted.is_some()
        || session_http::request_web_api_with_type(
            session,
            &Method::PUT,
            &url,
            Some(jpeg),
            SCOPES,
            "image/jpeg",
        )
        .await
        .is_some()
    {
        Ok(())
    } else {
        Err(ProviderError::ActionRejected {
            message: "playlistCoverRejected".into(),
            retryable: true,
        })
    }
}

/// Upload, register, set: each step logs how far it got, never a token.
async fn upload_like_web_player(session: &Session, uri: &str, id: &str, jpeg: &[u8]) -> bool {
    let Some(uploaded) = session_http::request_raw(session, &Method::POST, IMAGE_UPLOAD, jpeg, "image/jpeg", "application/json", &[]).await else {
        warn!(adapter = "librespot-playlist", step = "upload", "playlist image upload got no answer");
        return false;
    };
    let Some(token) = string_field(&uploaded, "uploadToken") else {
        warn!(adapter = "librespot-playlist", step = "upload", "playlist image upload answer had no token");
        return false;
    };
    let body = json!({ "uploadToken": token }).to_string();
    let register = format!("{PLAYLIST_HOST}/playlist/v2/playlist/{id}/register-image");
    let Some(registered) = session_http::request(session, &Method::POST, &register, Some(&body)).await else {
        warn!(adapter = "librespot-playlist", step = "register", "playlist image was not registered");
        return false;
    };
    let Some(picture) = string_field(&registered, "picture").and_then(|picture| picture_bytes(&picture)) else {
        warn!(adapter = "librespot-playlist", step = "register", "registered playlist image had no picture id");
        return false;
    };
    match crate::playlist_manage::set_picture(session, uri, &picture).await {
        Ok(()) => {
            info!(adapter = "librespot-playlist", "playlist image set");
            true
        }
        Err(_) => {
            warn!(adapter = "librespot-playlist", step = "set", "playlist image was not set");
            false
        }
    }
}

fn string_field(bytes: &[u8], name: &str) -> Option<String> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    value.get(name)?.as_str().filter(|text| !text.is_empty()).map(str::to_owned)
}

/// The picture id as base64 bytes for the playlist delta; Spotify may answer in hex or base64.
fn picture_bytes(picture: &str) -> Option<String> {
    if picture.is_empty() {
        return None;
    }
    let hex = picture.len() % 2 == 0 && picture.bytes().all(|b| b.is_ascii_hexdigit());
    if hex {
        let bytes = (0..picture.len()).step_by(2)
            .map(|at| u8::from_str_radix(&picture[at..at + 2], 16).ok())
            .collect::<Option<Vec<u8>>>()?;
        return Some(STANDARD.encode(bytes));
    }
    STANDARD.decode(picture).ok().filter(|bytes| !bytes.is_empty()).map(|_| picture.to_owned())
}

fn validate_jpeg(jpeg: &str) -> Result<(), ProviderError> {
    if jpeg.len() > MAX_PAYLOAD || jpeg.len() < 8 {
        return Err(ProviderError::InvalidRequest("playlistCoverInvalid".into()));
    }
    let bytes = STANDARD
        .decode(jpeg)
        .map_err(|_| ProviderError::InvalidRequest("playlistCoverInvalid".into()))?;
    if !bytes.starts_with(&[0xff, 0xd8, 0xff]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return Err(ProviderError::InvalidRequest("playlistCoverInvalid".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_wrong_format_and_oversized_encoded_payload() {
        assert!(validate_jpeg("data:image/jpeg;base64,abc").is_err());
        assert!(validate_jpeg(&STANDARD.encode(b"not a JPEG")).is_err());
        assert!(validate_jpeg(&STANDARD.encode(vec![0; MAX_PAYLOAD])).is_err());
        assert!(validate_jpeg(&STANDARD.encode([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])).is_ok());
    }

    #[test]
    fn picture_ids_become_base64_bytes() {
        assert_eq!(picture_bytes("ab67").as_deref(), Some("q2c="));
        assert_eq!(picture_bytes("q2c=").as_deref(), Some("q2c="));
        assert_eq!(picture_bytes(""), None);
        assert_eq!(string_field(br#"{"uploadToken":"t1"}"#, "uploadToken").as_deref(), Some("t1"));
        assert_eq!(string_field(br#"{"uploadToken":""}"#, "uploadToken"), None);
    }
}
