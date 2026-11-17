use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use http::{HeaderMap, HeaderValue, Method};
use librespot::{
    core::Session,
    protocol::{
        extended_metadata::{
            BatchedEntityRequest, BatchedEntityRequestHeader, EntityRequest, ExtensionQuery,
        },
        extension_kind::ExtensionKind,
    },
};
use protobuf::{EnumOrUnknown, MessageField};
use serde_json::{Value, json};
use tracing::{debug, info, warn};

use crate::pathfinder;
use crate::proto_wire::write_len_field;

const LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);
/// Answers per track (video or definitely none), so skipping back or a
/// repeated track does not ask again; canvas URLs are stable CDN links.
const KNOWN_MAX: usize = 400;

static KNOWN: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Mutex::default);

fn known_answer(uri: &str) -> Option<Option<String>> {
    KNOWN.lock().ok()?.get(uri).cloned()
}

fn remember_answer(uri: &str, answer: Option<String>) {
    if let Ok(mut known) = KNOWN.lock() {
        if known.len() >= KNOWN_MAX {
            known.clear();
        }
        known.insert(uri.to_owned(), answer);
    }
}

pub(crate) async fn fetch_canvas_url(
    session: &Session,
    track_uri: &str,
    still_wanted: impl Fn() -> bool + Send,
) -> Option<String> {
    let uri = canonicalize_track_uri(track_uri)?;
    if let Some(answer) = known_answer(&uri) {
        return answer;
    }
    match tokio::time::timeout(
        LOOKUP_TIMEOUT,
        fetch_canvas_url_inner(session, &uri, &still_wanted),
    )
    .await
    {
        Ok(url) => url,
        Err(_) => {
            warn!(
                adapter = "librespot-canvas",
                track_uri = uri_tail(&uri),
                "experimental canvas lookup timed out"
            );
            None
        }
    }
}

enum Lookup {
    Found(String),
    /// Spotify answered: this track has no canvas video.
    Absent,
    /// No answer; another source may still know.
    Unknown,
}

/// Pathfinder answers for every track, `canvas: null` included, so its
/// answer ends the lookup. Asking every older endpoint per track (about 15
/// requests, none ever returned a video) only fed the rate limit that
/// playback shares; they remain a fallback for when Pathfinder is silent.
async fn fetch_canvas_url_inner(
    session: &Session,
    uri: &str,
    still_wanted: &impl Fn() -> bool,
) -> Option<String> {
    if !still_wanted() {
        return None;
    }
    match pathfinder_canvas(session, uri).await {
        Lookup::Found(url) => {
            info!(
                adapter = "librespot-canvas",
                track_uri = uri_tail(uri),
                source = "pathfinder",
                "canvas video found"
            );
            remember_answer(uri, Some(url.clone()));
            return Some(url);
        }
        Lookup::Absent => {
            debug!(
                adapter = "librespot-canvas",
                track_uri = uri_tail(uri),
                "track has no canvas video"
            );
            remember_answer(uri, None);
            return None;
        }
        Lookup::Unknown => {}
    }
    for kind in [ExtensionKind::CANVAZ, ExtensionKind::CANVAS_V1] {
        if !still_wanted() {
            return None;
        }
        if let Some(url) = request_extended_metadata(session, uri, kind).await {
            info!(
                adapter = "librespot-canvas",
                track_uri = uri_tail(uri),
                source = "extended-metadata",
                "canvas video found"
            );
            remember_answer(uri, Some(url.clone()));
            return Some(url);
        }
    }
    if !still_wanted() {
        return None;
    }
    if let Some(url) = fetch_canvaz_cache(session, uri).await {
        info!(
            adapter = "librespot-canvas",
            track_uri = uri_tail(uri),
            source = "canvaz-cache",
            "canvas video found"
        );
        remember_answer(uri, Some(url.clone()));
        return Some(url);
    }
    if still_wanted() {
        info!(
            adapter = "librespot-canvas",
            track_uri = uri_tail(uri),
            "experimental canvas lookup found no trusted video"
        );
    }
    None
}

async fn pathfinder_canvas(session: &Session, uri: &str) -> Lookup {
    let Some(data) =
        pathfinder::query(session, &pathfinder::CANVAS, json!({ "trackUri": uri })).await
    else {
        return Lookup::Unknown;
    };
    if data.get("trackUnion").is_none_or(Value::is_null) {
        return Lookup::Unknown;
    }
    let answer = json!({ "data": data }).to_string();
    match take_canvas_url(answer.as_bytes(), "pathfinder") {
        Some(url) => Lookup::Found(url),
        None => Lookup::Absent,
    }
}

async fn request_extended_metadata(
    session: &Session,
    uri: &str,
    kind: ExtensionKind,
) -> Option<String> {
    let request = BatchedEntityRequest {
        header: MessageField::some(BatchedEntityRequestHeader {
            country: session.country(),
            catalogue: "premium".into(),
            ..Default::default()
        }),
        entity_request: vec![EntityRequest {
            entity_uri: uri.to_string(),
            query: vec![ExtensionQuery {
                extension_kind: EnumOrUnknown::new(kind),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    match session
        .spclient()
        .request_with_protobuf(
            &Method::POST,
            "/extended-metadata/v0/extended-metadata",
            None,
            &request,
        )
        .await
    {
        Ok(bytes) => take_canvas_url(&bytes, "extended-metadata"),
        Err(error) => {
            debug!(
                adapter = "librespot-canvas",
                kind = ?kind,
                error = %error,
                "extended metadata canvas protobuf request failed"
            );
            None
        }
    }
}

/// Only v0 still exists; v1 answers 404.
async fn fetch_canvaz_cache(session: &Session, uri: &str) -> Option<String> {
    let body = encode_canvas_request(uri);
    let mut headers = HeaderMap::new();
    headers.insert(
        "content-type",
        HeaderValue::from_static("application/x-protobuf"),
    );
    headers.insert("accept", HeaderValue::from_static("application/protobuf"));
    match session
        .spclient()
        .request(
            &Method::POST,
            "/canvaz-cache/v0/canvases",
            Some(headers),
            Some(&body),
        )
        .await
    {
        Ok(bytes) => take_canvas_url(&bytes, "canvaz-cache"),
        Err(error) => {
            debug!(
                adapter = "librespot-canvas",
                error = %error,
                "canvaz-cache request failed"
            );
            None
        }
    }
}

fn take_canvas_url(bytes: &[u8], source: &str) -> Option<String> {
    if let Some(url) = parse_extension_canvas(bytes) {
        return Some(url);
    }
    if !bytes.is_empty() {
        debug!(
            adapter = "librespot-canvas",
            source,
            bytes = bytes.len(),
            preview = %response_preview(bytes),
            "experimental canvas response had no trusted video"
        );
    }
    None
}

fn parse_extension_canvas(bytes: &[u8]) -> Option<String> {
    parse_canvas_url(bytes)
        .or_else(|| parse_canvas_protobuf(bytes))
        .or_else(|| {
            collect_https_urls(bytes)
                .into_iter()
                .find_map(|value| normalize_canvas_url(&value))
        })
}

pub fn parse_canvas_url(bytes: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    if let Some(url) = value
        .pointer("/data/trackUnion/canvas/url")
        .and_then(Value::as_str)
        .and_then(normalize_canvas_url)
    {
        return Some(url);
    }
    collect_canvas_url(&value)
}

pub fn normalize_canvas_url(value: &str) -> Option<String> {
    if value.len() > 2_048 || !value.starts_with("https://") || value.contains('@') {
        return None;
    }
    let host = value
        .strip_prefix("https://")?
        .split(['/', '?', '#'])
        .next()?
        .to_ascii_lowercase();
    let trusted = host == "scdn.co"
        || host.ends_with(".scdn.co")
        || host == "spotifycdn.com"
        || host.ends_with(".spotifycdn.com");
    if !trusted || !is_canvas_media(value) {
        return None;
    }
    Some(value.to_string())
}

fn collect_canvas_url(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => normalize_canvas_url(text),
        Value::Array(items) => items.iter().find_map(collect_canvas_url),
        Value::Object(object) => {
            for key in ["canvasUrl", "canvas_url", "mp4Url", "mp4_url"] {
                if let Some(url) = object
                    .get(key)
                    .and_then(Value::as_str)
                    .and_then(normalize_canvas_url)
                {
                    return Some(url);
                }
            }
            if let Some(url) = object
                .get("url")
                .and_then(Value::as_str)
                .and_then(normalize_canvas_url)
            {
                return Some(url);
            }
            object.values().find_map(collect_canvas_url)
        }
        _ => None,
    }
}

fn is_canvas_media(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("canvaz")
        || lower.contains(".mp4")
        || lower.contains(".webm")
        || lower.contains(".cnvs")
}

fn canonicalize_track_uri(uri: &str) -> Option<String> {
    let trimmed = uri.split(['?', '#']).next().unwrap_or(uri).trim();
    if let Some(id) = trimmed.strip_prefix("spotify:track:")
        && !id.is_empty()
        && !id.contains(':')
    {
        return Some(format!("spotify:track:{id}"));
    }
    None
}

fn encode_canvas_request(track_uri: &str) -> Vec<u8> {
    let uri = track_uri.as_bytes();
    let mut track = Vec::new();
    write_len_field(&mut track, 1, uri);
    let mut request = Vec::new();
    write_len_field(&mut request, 1, &track);
    request
}

pub fn parse_canvas_protobuf(bytes: &[u8]) -> Option<String> {
    collect_protobuf_strings(bytes)
        .into_iter()
        .find_map(|value| normalize_canvas_url(&value))
}

fn collect_protobuf_strings(bytes: &[u8]) -> Vec<String> {
    let mut values = Vec::new();
    let mut rest = bytes;
    while let Some((_field, wire, payload, next)) = read_protobuf_field(rest) {
        rest = next;
        if wire != 2 {
            continue;
        }
        if let Ok(text) = std::str::from_utf8(payload)
            && text.starts_with("https://")
        {
            values.push(text.to_string());
        }
        values.extend(collect_protobuf_strings(payload));
    }
    values
}

fn collect_https_urls(bytes: &[u8]) -> Vec<String> {
    let needle = b"https://";
    let mut urls = Vec::new();
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        let Some(relative) = find_slice(&bytes[index..], needle) else {
            break;
        };
        let start = index + relative;
        let rest = &bytes[start..];
        let len = rest.iter().take_while(|&&byte| is_url_byte(byte)).count();
        if let Ok(text) = std::str::from_utf8(&rest[..len]) {
            let trimmed = text.trim_end_matches(['\\', '"', '\'', '>', '<']);
            if !trimmed.is_empty() {
                urls.push(trimmed.to_string());
            }
        }
        index = start + needle.len();
    }
    urls
}

fn find_slice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn is_url_byte(byte: u8) -> bool {
    matches!(
        byte,
        b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b':'
            | b'/'
            | b'.'
            | b'-'
            | b'_'
            | b'~'
            | b'%'
            | b'?'
            | b'='
            | b'&'
            | b'+'
    )
}

fn read_protobuf_field(bytes: &[u8]) -> Option<(u32, u32, &[u8], &[u8])> {
    let (key, rest) = read_varint(bytes)?;
    let field = (key >> 3) as u32;
    let wire = (key & 7) as u32;
    match wire {
        0 => {
            let (_, rest) = read_varint(rest)?;
            Some((field, wire, &[], rest))
        }
        1 if rest.len() >= 8 => Some((field, wire, &rest[..8], &rest[8..])),
        2 => {
            let (len, rest) = read_varint(rest)?;
            let len = usize::try_from(len).ok()?;
            if rest.len() < len {
                return None;
            }
            Some((field, wire, &rest[..len], &rest[len..]))
        }
        5 if rest.len() >= 4 => Some((field, wire, &rest[..4], &rest[4..])),
        _ => None,
    }
}

fn read_varint(bytes: &[u8]) -> Option<(u64, &[u8])> {
    let mut value = 0_u64;
    let mut shift = 0;
    for (index, byte) in bytes.iter().copied().enumerate() {
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, &bytes[index + 1..]));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
    None
}

fn response_preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).chars().take(240).collect()
}

fn uri_tail(uri: &str) -> &str {
    uri.rsplit(':')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or(uri)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_trusted_https_cdn_videos() {
        assert_eq!(
            normalize_canvas_url("https://canvaz.scdn.co/upload/example/video.mp4").as_deref(),
            Some("https://canvaz.scdn.co/upload/example/video.mp4")
        );
        assert_eq!(
            normalize_canvas_url(
                "https://canvaz.scdn.co/upload/licensor/abc/video/32b57cbf.cnvs.mp4"
            )
            .as_deref(),
            Some("https://canvaz.scdn.co/upload/licensor/abc/video/32b57cbf.cnvs.mp4")
        );
        assert_eq!(
            normalize_canvas_url("https://i.scdn.co/image/example"),
            None
        );
        assert_eq!(normalize_canvas_url("https://example.com/video.mp4"), None);
    }

    #[test]
    fn reads_canvas_url_from_web_player_pathfinder_json() {
        let json = br#"{
            "data": {
                "trackUnion": {
                    "canvas": {
                        "url": "https://canvaz.scdn.co/upload/example/video.mp4",
                        "uri": "spotify:canvas:abc"
                    }
                }
            }
        }"#;
        assert_eq!(
            parse_canvas_url(json).as_deref(),
            Some("https://canvaz.scdn.co/upload/example/video.mp4")
        );
    }

    #[test]
    fn ignores_cover_images_in_json() {
        let json = br#"{ "url": "https://i.scdn.co/image/example" }"#;
        assert_eq!(parse_canvas_url(json), None);
    }

    #[test]
    fn parses_mobile_canvaz_protobuf() {
        let url = "https://canvaz.scdn.co/upload/example/video.mp4";
        let bytes = encode_canvas_response(url);
        assert_eq!(parse_canvas_protobuf(&bytes).as_deref(), Some(url));
    }

    #[test]
    fn parses_canvas_url_from_non_field_two_protobuf() {
        let url = "https://canvaz.scdn.co/upload/example/video.mp4";
        let mut canvas = Vec::new();
        write_len_field(&mut canvas, 11, url.as_bytes());
        let mut response = Vec::new();
        write_len_field(&mut response, 1, &canvas);
        assert_eq!(parse_canvas_protobuf(&response).as_deref(), Some(url));
    }

    #[test]
    fn scans_raw_https_urls_inside_opaque_bytes() {
        let url = "https://canvaz.scdn.co/upload/example/video.mp4";
        let mut bytes = b"noise".to_vec();
        bytes.extend_from_slice(url.as_bytes());
        bytes.extend_from_slice(b" tail");
        assert_eq!(parse_extension_canvas(&bytes).as_deref(), Some(url));
    }

    #[test]
    fn rejects_non_track_uris() {
        assert_eq!(canonicalize_track_uri("spotify:album:abc"), None);
        assert_eq!(
            canonicalize_track_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC"),
            Some("spotify:track:4uLU6hMCjMI75M1A2tKUQC".into())
        );
    }

    fn encode_canvas_response(url: &str) -> Vec<u8> {
        let mut canvas = Vec::new();
        write_len_field(&mut canvas, 2, url.as_bytes());
        let mut response = Vec::new();
        write_len_field(&mut response, 1, &canvas);
        response
    }
}
