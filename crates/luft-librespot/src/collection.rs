use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use http::{HeaderMap, HeaderValue, Method};
use librespot::core::Session;
use serde_json::{Value, json};
use tracing::warn;

use crate::proto_wire::{write_len_field, write_varint_field};
use crate::queue::canonicalize_item_uri;
use crate::session_http;

const LIBRARY_READ: &str = "user-library-read";
const LIBRARY_WRITE: &str = "user-library-modify";
const LIBRARY_BOTH: &str = "user-library-read,user-library-modify";
/// The collection set that holds the liked songs.
const LIKED_SET: &str = "collection";
const COLLECTION_PROTO: &str = "application/vnd.collection-v2.spotify.proto";

/// Spotify's liked-songs context trails a write by up to a few minutes and
/// meanwhile still lists a removed song: the heart flipped back and the
/// library kept the row. Own writes overlay the context for that long.
const RECENT_WRITE_WINDOW: Duration = Duration::from_secs(5 * 60);

/// (username, track uri) → (saved, when).
static RECENT_WRITES: LazyLock<Mutex<HashMap<(String, String), (bool, Instant)>>> =
    LazyLock::new(Mutex::default);

fn remember_write(username: &str, uri: &str, saved: bool) {
    if let Ok(mut writes) = RECENT_WRITES.lock() {
        writes.insert(
            (username.to_owned(), uri.to_owned()),
            (saved, Instant::now()),
        );
    }
}

/// This account's writes of the last minutes, newest first.
pub(crate) fn recent_writes(username: &str) -> Vec<(String, bool)> {
    let Ok(mut writes) = RECENT_WRITES.lock() else {
        return Vec::new();
    };
    writes.retain(|_, (_, at)| at.elapsed() < RECENT_WRITE_WINDOW);
    let mut own = writes
        .iter()
        .filter(|((user, _), _)| user == username)
        .map(|((_, uri), (saved, at))| (uri.clone(), *saved, *at))
        .collect::<Vec<_>>();
    own.sort_by(|left, right| right.2.cmp(&left.2));
    own.into_iter()
        .map(|(uri, saved, _)| (uri, saved))
        .collect()
}

/// Liked URIs as the context lists them, corrected by recent own writes.
pub(crate) fn apply_recent_writes(uris: &mut Vec<String>, writes: &[(String, bool)]) {
    uris.retain(|uri| {
        !writes
            .iter()
            .any(|(written, saved)| !saved && written == uri)
    });
    for (uri, _) in writes.iter().rev().filter(|(_, saved)| *saved) {
        if !uris.contains(uri) {
            uris.insert(0, uri.clone());
        }
    }
}

/// The liked-songs context resolves reliably; every collection "contains"
/// endpoint answered 404, 405 or 400 for each variant tried.
pub(crate) async fn is_saved(session: &Session, uri: &str) -> Option<bool> {
    let wanted = canonicalize_item_uri(uri)?;
    if let Some(liked) = crate::catalog::liked_track_uris(session).await {
        return Some(liked.contains(&wanted));
    }
    web_api_contains(session, uri).await
}

pub(crate) async fn set_saved(session: &Session, uri: &str, saved: bool) -> bool {
    let written =
        collection_write(session, uri, saved).await || web_api_set(session, uri, saved).await;
    if written && let Some(uri) = canonicalize_item_uri(uri) {
        remember_write(&session.username(), &uri, saved);
    }
    written
}

/// Writes the way the desktop client does: a collection2 v2 `WriteRequest`.
/// The JSON item endpoints tried before all answered 404.
async fn collection_write(session: &Session, uri: &str, saved: bool) -> bool {
    let Some(uri) = canonicalize_item_uri(uri) else {
        return false;
    };
    let body = encode_write_request(
        &session.username(),
        &uri,
        saved,
        chrono::Utc::now().timestamp(),
    );
    let mut headers = HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_static(COLLECTION_PROTO));
    headers.insert("accept", HeaderValue::from_static(COLLECTION_PROTO));
    match session
        .spclient()
        .request(
            &Method::POST,
            "/collection/v2/write",
            Some(headers),
            Some(&body),
        )
        .await
    {
        Ok(_) => true,
        Err(error) => {
            warn!(
                adapter = "librespot",
                phase = "collection-write",
                saved,
                error = %error,
                "liked songs write was rejected"
            );
            false
        }
    }
}

/// `WriteRequest { username = 1, set = 2, items = 3 }` with one
/// `CollectionItem { uri = 1, added_at = 2, is_removed = 3 }`.
fn encode_write_request(username: &str, uri: &str, saved: bool, now_seconds: i64) -> Vec<u8> {
    let mut item = Vec::new();
    write_len_field(&mut item, 1, uri.as_bytes());
    write_varint_field(
        &mut item,
        2,
        now_seconds.clamp(0, i64::from(i32::MAX)) as u64,
    );
    if !saved {
        write_varint_field(&mut item, 3, 1);
    }
    let mut request = Vec::new();
    write_len_field(&mut request, 1, username.as_bytes());
    write_len_field(&mut request, 2, LIKED_SET.as_bytes());
    write_len_field(&mut request, 3, &item);
    request
}

async fn web_api_contains(session: &Session, uri: &str) -> Option<bool> {
    let id = track_id(uri)?;
    let url = format!("https://api.spotify.com/v1/me/tracks/contains?ids={id}");
    for scopes in [LIBRARY_READ, LIBRARY_BOTH] {
        if let Some(bytes) =
            session_http::request_web_api(session, &Method::GET, &url, None, scopes).await
            && let Some(saved) = parse_contains(&bytes)
        {
            return Some(saved);
        }
    }
    None
}

async fn web_api_set(session: &Session, uri: &str, saved: bool) -> bool {
    let Some(id) = track_id(uri) else {
        return false;
    };
    let body = json!({ "ids": [id] }).to_string();
    let method = if saved { Method::PUT } else { Method::DELETE };
    for scopes in [LIBRARY_WRITE, LIBRARY_BOTH] {
        if session_http::request_web_api(
            session,
            &method,
            "https://api.spotify.com/v1/me/tracks",
            Some(&body),
            scopes,
        )
        .await
        .is_some()
        {
            return true;
        }
    }
    false
}

fn parse_contains(bytes: &[u8]) -> Option<bool> {
    if bytes.is_empty() {
        return None;
    }
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    match value {
        Value::Bool(saved) => Some(saved),
        Value::Array(items) => items.first().and_then(Value::as_bool),
        Value::Object(object) => object
            .get("items")
            .or_else(|| object.get("found"))
            .or_else(|| object.get("contains"))
            .or_else(|| object.get("results"))
            .and_then(|items| match items {
                Value::Array(values) => values.first().and_then(|item| {
                    item.as_bool().or_else(|| {
                        item.get("found")
                            .or_else(|| item.get("contains"))
                            .and_then(Value::as_bool)
                    })
                }),
                Value::Bool(saved) => Some(*saved),
                _ => None,
            }),
        _ => None,
    }
}

fn track_id(uri: &str) -> Option<&str> {
    let id = uri.rsplit(':').next()?.trim();
    (id.len() == 22).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_collection_contains_shapes() {
        assert_eq!(parse_contains(br#"[true]"#), Some(true));
        assert_eq!(parse_contains(br#"{"items":[false]}"#), Some(false));
        assert_eq!(parse_contains(br#"{"found":[{"found":true}]}"#), Some(true));
        assert_eq!(parse_contains(br#"{"unknown":1}"#), None);
    }

    #[test]
    fn recent_writes_correct_a_lagging_context() {
        let mut uris = vec!["spotify:track:a".to_owned(), "spotify:track:b".to_owned()];
        let writes = vec![
            ("spotify:track:c".to_owned(), true),
            ("spotify:track:a".to_owned(), false),
            ("spotify:track:b".to_owned(), true),
        ];
        apply_recent_writes(&mut uris, &writes);
        assert_eq!(uris, ["spotify:track:c", "spotify:track:b"]);
    }

    #[test]
    fn encodes_a_liked_songs_write_request() {
        let saved = encode_write_request("me", "spotify:track:a", true, 300);
        assert_eq!(
            saved,
            [
                &[0x0a, 2][..],
                b"me",
                &[0x12, 10],
                b"collection",
                &[0x1a, 20, 0x0a, 15],
                b"spotify:track:a",
                &[0x10, 0xac, 0x02],
            ]
            .concat()
        );
        let removed = encode_write_request("me", "spotify:track:a", false, 300);
        assert_eq!(removed.len(), saved.len() + 2);
        assert_eq!(&removed[removed.len() - 2..], &[0x18, 1]);
    }
}
