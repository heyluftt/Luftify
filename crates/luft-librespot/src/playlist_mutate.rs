use http::{HeaderMap, HeaderValue, Method};
use librespot::core::Session;
use luft_core::ProviderError;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::playback::is_playable_item_uri;
use crate::playlist::playlist_id;
use crate::session_http;

const PLAYLIST_WRITE_SCOPES: &str = "playlist-modify-private,playlist-modify-public";

pub(crate) async fn add_track(
    session: &Session,
    playlist_uri: &str,
    track_uri: &str,
) -> Result<(), ProviderError> {
    let playlist_id = require_playlist_id(playlist_uri)?;
    if !is_playable_item_uri(track_uri) {
        return Err(ProviderError::InvalidRequest(
            "Nur Titel können zur Playlist hinzugefügt werden.".into(),
        ));
    }
    let uris_body = json!({ "uris": [track_uri], "position": 0 }).to_string();
    let items_body = json!({ "uris": [track_uri] }).to_string();
    let delta_body = add_delta_body(track_uri);
    write_playlist(
        session,
        playlist_id,
        // The playlist delta is what Spotify accepts today; the others stay as fallback.
        &[
            public(Method::POST, "changes", &delta_body),
            web(Method::POST, "tracks", &uris_body),
            spclient(Method::POST, "items", &items_body),
            public(Method::POST, "items", &items_body),
        ],
        "Der Titel konnte nicht zur Playlist hinzugefügt werden.",
    )
    .await
}

pub(crate) async fn remove_track(
    session: &Session,
    playlist_uri: &str,
    track_uri: &str,
) -> Result<(), ProviderError> {
    let playlist_id = require_playlist_id(playlist_uri)?;
    let uris_body = json!({ "uris": [track_uri] }).to_string();
    let web_items_body = json!({ "items": [{ "uri": track_uri }] }).to_string();
    let web_tracks_body = json!({ "tracks": [{ "uri": track_uri }] }).to_string();
    let delta_body = remove_delta_body(track_uri);
    let items_query = format!("items?uris={}", query_encode(track_uri));
    write_playlist(
        session,
        playlist_id,
        &[
            spclient(Method::POST, "changes", &delta_body),
            public(Method::POST, "changes", &delta_body),
            web(Method::DELETE, "items", &web_items_body),
            web(Method::DELETE, "tracks", &web_tracks_body),
            spclient(Method::DELETE, "items", &uris_body),
            public(Method::DELETE, "items", &uris_body),
            spclient(Method::DELETE, &items_query, ""),
            public(Method::DELETE, &items_query, ""),
        ],
        "Der Titel konnte nicht aus der Playlist entfernt werden.",
    )
    .await
}

fn require_playlist_id(playlist_uri: &str) -> Result<&str, ProviderError> {
    playlist_id(playlist_uri)
        .ok_or_else(|| ProviderError::InvalidRequest("Ungültige Playlist-URI.".into()))
}

fn web<'a>(method: Method, path: &'a str, body: &'a str) -> WriteAttempt<'a> {
    WriteAttempt::WebApi { method, path, body }
}

fn spclient<'a>(method: Method, path: &'a str, body: &'a str) -> WriteAttempt<'a> {
    WriteAttempt::Spclient { method, path, body }
}

fn public<'a>(method: Method, path: &'a str, body: &'a str) -> WriteAttempt<'a> {
    WriteAttempt::Public { method, path, body }
}

enum WriteAttempt<'a> {
    WebApi {
        method: Method,
        path: &'a str,
        body: &'a str,
    },
    Spclient {
        method: Method,
        path: &'a str,
        body: &'a str,
    },
    Public {
        method: Method,
        path: &'a str,
        body: &'a str,
    },
}

impl WriteAttempt<'_> {
    fn method(&self) -> &Method {
        match self {
            Self::WebApi { method, .. }
            | Self::Spclient { method, .. }
            | Self::Public { method, .. } => method,
        }
    }

    fn path(&self) -> &str {
        match self {
            Self::WebApi { path, .. } | Self::Spclient { path, .. } | Self::Public { path, .. } => {
                path
            }
        }
    }
}

enum WriteOutcome {
    Accepted,
    Rejected,
    Missed,
}

async fn write_playlist(
    session: &Session,
    playlist_id: &str,
    attempts: &[WriteAttempt<'_>],
    failure: &str,
) -> Result<(), ProviderError> {
    if write_once(session, playlist_id, attempts).await {
        return Ok(());
    }
    Err(ProviderError::ActionRejected {
        message: failure.into(),
        retryable: true,
    })
}

async fn write_once(session: &Session, playlist_id: &str, attempts: &[WriteAttempt<'_>]) -> bool {
    for attempt in attempts {
        match send_write(session, playlist_id, attempt).await {
            WriteOutcome::Accepted => {
                info!(
                    adapter = "librespot-playlist",
                    method = attempt.method().as_str(),
                    path = attempt.path(),
                    playlist_id,
                    "playlist write accepted"
                );
                return true;
            }
            WriteOutcome::Rejected => {
                warn!(
                    adapter = "librespot-playlist",
                    method = attempt.method().as_str(),
                    path = attempt.path(),
                    playlist_id,
                    "playlist write was rejected, trying next endpoint"
                );
            }
            WriteOutcome::Missed => {}
        }
    }
    false
}

async fn send_write(
    session: &Session,
    playlist_id: &str,
    attempt: &WriteAttempt<'_>,
) -> WriteOutcome {
    match attempt {
        WriteAttempt::WebApi { method, path, body } => {
            let url = format!("https://api.spotify.com/v1/playlists/{playlist_id}/{path}");
            match session_http::request_web_api(
                session,
                method,
                &url,
                Some(body),
                PLAYLIST_WRITE_SCOPES,
            )
            .await
            {
                Some(bytes) => outcome_from_body(&bytes),
                None => WriteOutcome::Missed,
            }
        }
        WriteAttempt::Spclient { method, path, body } => {
            let endpoint = format!("/playlist/v2/playlist/{playlist_id}/{path}");
            let mut headers = HeaderMap::new();
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            let payload = (!body.is_empty()).then_some(body.as_bytes());
            match session
                .spclient()
                .request(method, &endpoint, Some(headers), payload)
                .await
            {
                Ok(bytes) => outcome_from_body(&bytes),
                Err(_) => WriteOutcome::Missed,
            }
        }
        WriteAttempt::Public { method, path, body } => {
            let payload = (!body.is_empty()).then_some(*body);
            for host in [
                "https://spclient.wg.spotify.com",
                "https://api-partner.spotify.com",
            ] {
                let url = format!("{host}/playlist/v2/playlist/{playlist_id}/{path}");
                match session_http::request(session, method, &url, payload).await {
                    Some(bytes) => return outcome_from_body(&bytes),
                    None => {}
                }
            }
            WriteOutcome::Missed
        }
    }
}

fn outcome_from_body(bytes: &[u8]) -> WriteOutcome {
    if write_accepted(bytes) {
        WriteOutcome::Accepted
    } else {
        WriteOutcome::Rejected
    }
}

fn write_accepted(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return true;
    };
    value.get("error").is_none() && value.get("errorType").is_none()
}

fn add_delta_body(track_uri: &str) -> String {
    json!({
        "deltas": [{
            "ops": [{
                "kind": "ADD",
                "add": {
                    "fromIndex": 0,
                    "items": [{ "uri": track_uri }]
                }
            }]
        }]
    })
    .to_string()
}

fn remove_delta_body(track_uri: &str) -> String {
    json!({
        "deltas": [{
            "ops": [{
                "kind": 3,
                "rem": {
                    "items": [{ "uri": track_uri }],
                    "itemsAsKey": true
                }
            }],
            "info": { "source": { "client": 5 } }
        }],
        "wantResultingRevisions": false,
        "wantSyncResult": false,
        "nonces": []
    })
    .to_string()
}

fn query_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_and_snapshot_json_count_as_success() {
        assert!(write_accepted(b""));
        assert!(write_accepted(br#"{"snapshot_id":"abc"}"#));
        assert!(!write_accepted(br#"{"error":{"status":403}}"#));
        assert!(!write_accepted(br#"{"errorType":"INVALID_REQUEST"}"#));
    }

    #[test]
    fn remove_mirrors_add_item_uris_and_uses_numeric_rem() {
        let delta = remove_delta_body("spotify:track:abc");
        assert!(delta.contains(r#""kind":3"#));
        assert!(delta.contains(r#""itemsAsKey":true"#));
        assert!(delta.contains(r#""uri":"spotify:track:abc""#));
        assert!(!delta.contains("uid"));
        assert_eq!(query_encode("spotify:track:abc"), "spotify%3Atrack%3Aabc");
    }
}
