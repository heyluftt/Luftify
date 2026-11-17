use std::collections::HashMap;

use bytes::Bytes;
use http::{Method, Request};
use librespot::core::Session;
use serde_json::{Value, json};
use tracing::warn;

use crate::queue::canonicalize_item_uri;

const PARTNER_HOST: &str = "https://api-partner.spotify.com";
const SPCLIENT_HOST: &str = "https://spclient.wg.spotify.com";

/// Current Pathfinder persisted-query hashes from the Spotify web client.
const ARTIST_OVERVIEW_HASH: &str =
    "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a";
const GET_ALBUM_HASH: &str = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10";
const GET_TRACK_HASH: &str = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294";

pub(crate) async fn apply_album_play_counts(
    session: &Session,
    album_uri: &str,
    tracks: &mut [luft_core::MediaItem],
) {
    let embed = load_embed(session, album_uri).await;
    let mut tokens = bearer_tokens(session).await;
    prefer_token(&mut tokens, embed.token.clone());
    let mut counts = pathfinder_play_counts(
        session,
        "getAlbum",
        json!({
            "uri": album_uri,
            "locale": "",
            "offset": 0,
            "limit": 50,
        }),
        GET_ALBUM_HASH,
        &tokens,
    )
    .await;
    counts.extend(embed.counts);
    if counts.is_empty()
        && let Some(id) = entity_id(album_uri)
    {
        counts.extend(legacy_album_play_counts(session, id).await);
    }
    apply_counts(tracks, &counts);
    if still_missing(tracks, &counts) {
        apply_counts(tracks, &track_play_counts(session, tracks, &tokens).await);
    }
}

pub(crate) async fn apply_artist_play_counts(
    session: &Session,
    artist_uri: &str,
    tracks: &mut [luft_core::MediaItem],
) {
    let embed = load_embed(session, artist_uri).await;
    let mut tokens = bearer_tokens(session).await;
    prefer_token(&mut tokens, embed.token.clone());
    let mut counts = pathfinder_play_counts(
        session,
        "queryArtistOverview",
        json!({
            "uri": artist_uri,
            "locale": "",
            "includePrerelease": false,
        }),
        ARTIST_OVERVIEW_HASH,
        &tokens,
    )
    .await;
    counts.extend(embed.counts);
    if still_missing(tracks, &counts) {
        let mut albums = Vec::new();
        for album_uri in tracks.iter().filter_map(|track| track.album_uri.clone()) {
            if !albums.contains(&album_uri) {
                albums.push(album_uri);
            }
        }
        for album_uri in albums {
            counts.extend(
                pathfinder_play_counts(
                    session,
                    "getAlbum",
                    json!({
                        "uri": album_uri,
                        "locale": "",
                        "offset": 0,
                        "limit": 50,
                    }),
                    GET_ALBUM_HASH,
                    &tokens,
                )
                .await,
            );
        }
    }
    apply_counts(tracks, &counts);
    if still_missing(tracks, &counts) {
        apply_counts(tracks, &track_play_counts(session, tracks, &tokens).await);
    }
}

async fn track_play_counts(
    session: &Session,
    tracks: &[luft_core::MediaItem],
    tokens: &[String],
) -> HashMap<String, u64> {
    let mut counts = HashMap::new();
    for track in tracks.iter().filter(|track| track.play_count.is_none()) {
        let Some(uri) = canonicalize_track_uri(&track.uri) else {
            continue;
        };
        counts.extend(
            pathfinder_play_counts(
                session,
                "getTrack",
                json!({ "uri": uri }),
                GET_TRACK_HASH,
                tokens,
            )
            .await,
        );
        if counts.len() >= tracks.len() {
            break;
        }
    }
    counts
}

async fn pathfinder_play_counts(
    session: &Session,
    operation: &str,
    variables: Value,
    hash: &str,
    tokens: &[String],
) -> HashMap<String, u64> {
    let path = pathfinder_path(operation, &variables, hash);

    for host in [PARTNER_HOST, SPCLIENT_HOST] {
        for token in tokens {
            let url = format!("{host}{path}");
            if let Some(counts) = request_url(session, &url, Some(token)).await
                && !counts.is_empty()
            {
                return counts;
            }
        }
    }

    request_resolved(session, &path).await.unwrap_or_default()
}

struct EmbedPage {
    token: Option<String>,
    counts: HashMap<String, u64>,
}

async fn load_embed(session: &Session, uri: &str) -> EmbedPage {
    let kind = if uri.contains(":artist:") {
        "artist"
    } else if uri.contains(":album:") {
        "album"
    } else if uri.contains(":track:") {
        "track"
    } else {
        return EmbedPage {
            token: None,
            counts: HashMap::new(),
        };
    };
    let Some(id) = entity_id(uri) else {
        return EmbedPage {
            token: None,
            counts: HashMap::new(),
        };
    };
    let url = format!("https://open.spotify.com/embed/{kind}/{id}");
    let Some(bytes) = fetch_bytes(session, &url, None).await else {
        return EmbedPage {
            token: None,
            counts: HashMap::new(),
        };
    };
    let html = String::from_utf8_lossy(&bytes);
    let Some(next_data) = extract_next_data(&html) else {
        return EmbedPage {
            token: None,
            counts: HashMap::new(),
        };
    };
    EmbedPage {
        token: next_data
            .pointer("/props/pageProps/state/settings/session/accessToken")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(ToOwned::to_owned),
        counts: parse_play_counts(&next_data.to_string().into_bytes()),
    }
}

fn extract_next_data(html: &str) -> Option<Value> {
    let marker = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let start = html.find(marker)? + marker.len();
    let end = html[start..].find("</script>")? + start;
    serde_json::from_str(&html[start..end]).ok()
}

async fn bearer_tokens(session: &Session) -> Vec<String> {
    let mut tokens = Vec::new();
    if let Ok(token) = session.login5().auth_token().await {
        push_token(&mut tokens, token.access_token);
    }
    tokens
}

fn push_token(tokens: &mut Vec<String>, token: String) {
    if !token.is_empty() && !tokens.iter().any(|existing| existing == &token) {
        tokens.push(token);
    }
}

fn prefer_token(tokens: &mut Vec<String>, token: Option<String>) {
    let Some(token) = token.filter(|value| !value.is_empty()) else {
        return;
    };
    tokens.retain(|existing| existing != &token);
    tokens.insert(0, token);
}

async fn request_url(
    session: &Session,
    url: &str,
    bearer: Option<&str>,
) -> Option<HashMap<String, u64>> {
    match fetch_bytes(session, url, bearer).await {
        Some(bytes) => {
            let counts = parse_play_counts(&bytes);
            if counts.is_empty() {
                warn!(
                    adapter = "librespot",
                    url,
                    bytes = bytes.len(),
                    preview = %response_preview(&bytes),
                    "playcount response contained no usable counts"
                );
            }
            Some(counts)
        }
        None => None,
    }
}

async fn request_resolved(session: &Session, path: &str) -> Option<HashMap<String, u64>> {
    match session
        .spclient()
        .request_as_json(&Method::GET, path, Some(pathfinder_headers()), None)
        .await
    {
        Ok(bytes) => {
            let counts = parse_play_counts(&bytes);
            if counts.is_empty() {
                warn!(
                    adapter = "librespot",
                    endpoint = path,
                    bytes = bytes.len(),
                    preview = %response_preview(&bytes),
                    "playcount response contained no usable counts"
                );
            }
            Some(counts)
        }
        Err(error) => {
            warn!(
                adapter = "librespot",
                endpoint = path,
                error = %error,
                "playcount request failed"
            );
            None
        }
    }
}

async fn legacy_album_play_counts(session: &Session, album_id: &str) -> HashMap<String, u64> {
    let endpoint = format!("/track-playcount/v1/album/{album_id}");
    request_resolved(session, &endpoint)
        .await
        .unwrap_or_default()
}

async fn fetch_bytes(session: &Session, url: &str, bearer: Option<&str>) -> Option<Bytes> {
    let mut builder = Request::builder()
        .method(&Method::GET)
        .uri(url)
        .header("accept", "application/json, text/html;q=0.9")
        .header("app-platform", "WebPlayer")
        .header("origin", "https://open.spotify.com")
        .header("referer", "https://open.spotify.com/");
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    if let Ok(client_token) = session.spclient().client_token().await
        && let Ok(value) = http::HeaderValue::from_str(&client_token)
    {
        builder = builder.header("client-token", value);
    }
    let request = builder.body(Bytes::new()).ok()?;
    match session.http_client().request_body(request).await {
        Ok(bytes) => Some(bytes),
        Err(error) => {
            warn!(
                adapter = "librespot",
                url,
                error = %error,
                "playcount http request failed"
            );
            None
        }
    }
}

fn pathfinder_headers() -> http::HeaderMap {
    let mut headers = http::HeaderMap::new();
    headers.insert("app-platform", http::HeaderValue::from_static("WebPlayer"));
    headers.insert(
        "content-type",
        http::HeaderValue::from_static("application/json"),
    );
    headers
}

fn pathfinder_path(operation: &str, variables: &Value, hash: &str) -> String {
    let extensions = json!({
        "persistedQuery": {
            "version": 1,
            "sha256Hash": hash,
        }
    });
    format!(
        "/pathfinder/v1/query?operationName={operation}&variables={}&extensions={}",
        encode_query_json(variables),
        encode_query_json(&extensions)
    )
}

fn apply_counts(tracks: &mut [luft_core::MediaItem], counts: &HashMap<String, u64>) {
    if counts.is_empty() {
        return;
    }
    for track in tracks {
        if track.play_count.is_some() {
            continue;
        }
        if let Some(count) = lookup_count(counts, &track.uri) {
            track.play_count = Some(count);
        }
    }
}

fn still_missing(tracks: &[luft_core::MediaItem], counts: &HashMap<String, u64>) -> bool {
    tracks
        .iter()
        .any(|track| track.play_count.is_none() && lookup_count(counts, &track.uri).is_none())
}

fn lookup_count(counts: &HashMap<String, u64>, uri: &str) -> Option<u64> {
    if let Some(count) = counts.get(uri) {
        return Some(*count);
    }
    let canonical = canonicalize_track_uri(uri)?;
    counts.get(&canonical).copied().or_else(|| {
        counts.iter().find_map(|(key, count)| {
            canonicalize_track_uri(key)
                .filter(|item| item == &canonical)
                .map(|_| *count)
        })
    })
}

pub(crate) fn parse_play_counts(bytes: &[u8]) -> HashMap<String, u64> {
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return HashMap::new();
    };
    let mut counts = HashMap::new();
    collect_play_counts(&value, &mut counts);
    counts
}

fn collect_play_counts(value: &Value, counts: &mut HashMap<String, u64>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_play_counts(item, counts);
            }
        }
        Value::Object(object) => {
            let uri = object
                .get("uri")
                .and_then(Value::as_str)
                .or_else(|| object.get("gid").and_then(Value::as_str));
            if let (Some(uri), Some(count)) = (uri, play_count_value(object))
                && let Some(uri) = canonicalize_track_uri(uri)
            {
                counts.insert(uri, count);
            }
            for nested in object.values() {
                collect_play_counts(nested, counts);
            }
        }
        _ => {}
    }
}

fn play_count_value(object: &serde_json::Map<String, Value>) -> Option<u64> {
    for key in ["count", "playcount", "playCount", "play_count"] {
        if let Some(count) = object.get(key).and_then(as_count) {
            return Some(count);
        }
    }
    None
}

fn as_count(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number
            .as_u64()
            .or_else(|| number.as_i64().and_then(|value| u64::try_from(value).ok()))
            .or_else(|| number.to_string().trim().parse().ok()),
        Value::String(text) => text.trim().parse().ok(),
        Value::Object(object) => object.get("value").and_then(as_count),
        _ => None,
    }
}

fn canonicalize_track_uri(uri: &str) -> Option<String> {
    canonicalize_item_uri(uri).or_else(|| {
        let trimmed = uri.trim();
        trimmed
            .starts_with("spotify:track:")
            .then(|| trimmed.to_string())
    })
}

fn entity_id(uri: &str) -> Option<&str> {
    let id = uri.rsplit(':').next()?.trim();
    (!id.is_empty()).then_some(id)
}

fn encode_query_json(value: &Value) -> String {
    urlencoding_lite(&value.to_string())
}

fn urlencoding_lite(value: &str) -> String {
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

fn response_preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_album_playcount_payloads() {
        let counts = parse_play_counts(
            br#"{
              "data": {
                "artistUnion": {
                  "discography": {
                    "topTracks": {
                      "items": [
                        { "track": { "uri": "spotify:track:nightcall", "playcount": "222793148" } },
                        { "track": { "uri": "spotify:track:oddlook", "playcount": { "value": 1234 } } }
                      ]
                    }
                  }
                }
              }
            }"#,
        );
        assert_eq!(
            counts.get("spotify:track:nightcall"),
            Some(&222_793_148),
            "{counts:?}"
        );
        assert_eq!(
            counts.get("spotify:track:oddlook"),
            Some(&1_234),
            "{counts:?}"
        );
    }

    #[test]
    fn extracts_embed_session_and_playcounts() {
        let html = r#"<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"settings":{"session":{"accessToken":"embed-token"}},"data":{"entity":{"uri":"spotify:track:nightcall","playcount":"99"}}}}}}</script></html>"#;
        let next = extract_next_data(html).expect("next data");
        assert_eq!(
            next.pointer("/props/pageProps/state/settings/session/accessToken")
                .and_then(Value::as_str),
            Some("embed-token")
        );
        let counts = parse_play_counts(&next.to_string().into_bytes());
        assert_eq!(counts.get("spotify:track:nightcall"), Some(&99));
    }

    #[test]
    fn attaches_counts_by_canonical_track_uri() {
        let mut tracks = vec![luft_core::MediaItem {
            uri: "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp?context=artist".to_string(),
            source: luft_core::MediaSource::Spotify,
            item_type: luft_core::MediaItemType::Track,
            title: "Nightcall".to_string(),
            creators: Vec::new(),
            album_name: None,
            album_uri: None,
            duration_ms: None,
            play_count: None,
            cover_uri: None,
            canvas_url: None,
            added_at: None,
            playlist_entry_id: None,
            added_by: None,
            explicit: false,
            playable: true,
        }];
        let mut counts = HashMap::new();
        counts.insert("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp".to_string(), 42);
        apply_counts(&mut tracks, &counts);
        assert_eq!(tracks[0].play_count, Some(42));
    }
}
