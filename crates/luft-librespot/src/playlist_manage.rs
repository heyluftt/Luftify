//! Creating, renaming, sharing and removing playlists, the way the web player
//! does it: JSON deltas to the playlist service (the same path that adds and
//! removes songs). Scoped Web API tokens are refused for this client.
use http::Method;
use librespot::core::Session;
use luft_core::ProviderError;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::playlist::playlist_id;
use crate::session_http;

const HOST: &str = "https://spclient.wg.spotify.com";
const MAX_PLAYLIST_NAME: usize = 100;

const OP_ADD: u8 = 2;
const OP_REM: u8 = 3;
const OP_UPDATE_LIST_ATTRIBUTES: u8 = 6;

/// A new, empty playlist at the top of the library; returns its URI.
pub(crate) async fn create(session: &Session, name: &str) -> Result<String, ProviderError> {
    let name = clean_name(name)?;
    let body = json!({ "ops": [list_attributes(json!({ "name": name }))] }).to_string();
    let bytes = session_http::request(session, &Method::POST, &format!("{HOST}/playlist/v2/playlist"), Some(&body))
        .await
        .ok_or_else(|| rejected("Die Playlist konnte nicht erstellt werden."))?;
    let uri = created_uri(&bytes).ok_or_else(|| rejected("Die Playlist konnte nicht erstellt werden."))?;
    follow(session, &uri).await?;
    info!(adapter = "librespot-playlist", "playlist created");
    Ok(uri)
}

pub(crate) async fn rename(session: &Session, playlist_uri: &str, name: &str) -> Result<(), ProviderError> {
    let name = clean_name(name)?;
    change_attributes(session, playlist_uri, json!({ "name": name }), "Die Playlist konnte nicht umbenannt werden.").await
}

/// Collaborative: everyone who follows it may add and remove songs.
pub(crate) async fn set_collaborative(session: &Session, playlist_uri: &str, collaborative: bool) -> Result<(), ProviderError> {
    change_attributes(
        session,
        playlist_uri,
        json!({ "collaborative": collaborative }),
        "Die Playlist konnte nicht geändert werden.",
    )
    .await
}

/// Adds someone else's playlist to the library, e.g. one a friend sent.
pub(crate) async fn follow(session: &Session, playlist_uri: &str) -> Result<(), ProviderError> {
    require_id(playlist_uri)?;
    let op = json!({
        "kind": OP_ADD,
        "add": {
            "items": [{
                "uri": playlist_uri,
                "attributes": { "timestamp": chrono::Utc::now().timestamp_millis().to_string() }
            }],
            "addFirst": true
        }
    });
    change_rootlist(session, op, "Die Playlist konnte nicht zur Bibliothek hinzugefügt werden.").await
}

/// Takes a playlist out of the library. For the owner this is deleting it,
/// as in Spotify: followers keep their copy until they remove it too.
pub(crate) async fn unfollow(session: &Session, playlist_uri: &str) -> Result<(), ProviderError> {
    require_id(playlist_uri)?;
    let op = json!({ "kind": OP_REM, "rem": { "items": [{ "uri": playlist_uri }], "itemsAsKey": true } });
    change_rootlist(session, op, "Die Playlist konnte nicht entfernt werden.").await
}

/// The picture is the id Spotify's image service returned, as protobuf bytes (base64 in JSON).
pub(crate) async fn set_picture(session: &Session, playlist_uri: &str, picture: &str) -> Result<(), ProviderError> {
    change_attributes(session, playlist_uri, json!({ "picture": picture }), "playlistCoverRejected").await
}

async fn change_attributes(session: &Session, playlist_uri: &str, values: Value, failure: &str) -> Result<(), ProviderError> {
    let id = require_id(playlist_uri)?;
    let url = format!("{HOST}/playlist/v2/playlist/{id}/changes");
    send_delta(session, &url, list_attributes(values), failure).await
}

async fn change_rootlist(session: &Session, op: Value, failure: &str) -> Result<(), ProviderError> {
    let user = session.username();
    if user.is_empty() {
        return Err(rejected(failure));
    }
    let url = format!("{HOST}/playlist/v2/user/{user}/rootlist/changes");
    send_delta(session, &url, op, failure).await
}

async fn send_delta(session: &Session, url: &str, op: Value, failure: &str) -> Result<(), ProviderError> {
    let body = delta_body(op);
    match session_http::request(session, &Method::POST, url, Some(&body)).await {
        Some(bytes) if accepted(&bytes) => Ok(()),
        answer => {
            warn!(
                adapter = "librespot-playlist",
                answered = answer.is_some(),
                "playlist change was not accepted"
            );
            Err(rejected(failure))
        }
    }
}

fn list_attributes(values: Value) -> Value {
    json!({
        "kind": OP_UPDATE_LIST_ATTRIBUTES,
        "updateListAttributes": { "newAttributes": { "values": values, "noValue": [] } }
    })
}

fn delta_body(op: Value) -> String {
    json!({
        "deltas": [{ "ops": [op], "info": { "source": { "client": 5 } } }],
        "wantResultingRevisions": false,
        "wantSyncResult": false,
        "nonces": []
    })
    .to_string()
}

fn created_uri(bytes: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let uri = value.get("uri")?.as_str()?;
    playlist_id(uri).map(|id| format!("spotify:playlist:{id}"))
}

fn accepted(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    serde_json::from_slice::<Value>(bytes)
        .map(|value| value.get("error").is_none() && value.get("errorType").is_none())
        .unwrap_or(true)
}

fn clean_name(name: &str) -> Result<String, ProviderError> {
    let name = name.trim().chars().take(MAX_PLAYLIST_NAME).collect::<String>();
    if name.is_empty() {
        return Err(ProviderError::InvalidRequest("Die Playlist braucht einen Namen.".into()));
    }
    Ok(name)
}

fn require_id(playlist_uri: &str) -> Result<&str, ProviderError> {
    playlist_id(playlist_uri).ok_or_else(|| ProviderError::InvalidRequest("Ungültige Playlist-URI.".into()))
}

fn rejected(message: &str) -> ProviderError {
    ProviderError::ActionRejected { message: message.into(), retryable: true }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deltas_use_numeric_ops_like_the_song_changes() {
        let body = delta_body(list_attributes(json!({ "name": "Roadtrip" })));
        assert!(body.contains(r#""kind":6"#));
        assert!(body.contains(r#""updateListAttributes":{"newAttributes":{"noValue":[],"values":{"name":"Roadtrip"}}}"#));
        assert!(body.contains(r#""client":5"#));
    }

    #[test]
    fn reads_the_created_playlist_and_checks_names() {
        assert_eq!(
            created_uri(br#"{"uri":"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M","revision":"AAA"}"#).as_deref(),
            Some("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M")
        );
        assert_eq!(created_uri(br#"{"revision":"AAA"}"#), None);
        assert!(clean_name("  ").is_err());
        assert_eq!(clean_name(" Roadtrip ").unwrap(), "Roadtrip");
        assert!(!accepted(br#"{"error":{"status":403}}"#));
    }
}
