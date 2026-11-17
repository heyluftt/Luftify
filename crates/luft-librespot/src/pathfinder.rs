//! Spotify's GraphQL gateway ("Pathfinder"), called the way the web player
//! calls it. Queries are persisted: the server only knows them by a SHA-256
//! hash that changes with web-player releases. Known hashes ship as defaults;
//! when one stops working, the current ones are read from the web player's
//! own JavaScript bundles, so a rotated hash heals without an app update.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use http::Method;
use librespot::core::Session;
use serde_json::{Value, json};
use tracing::{debug, info, warn};

use crate::session_http;

const QUERY_URL: &str = "https://api-partner.spotify.com/pathfinder/v2/query";
const WEB_PLAYER_URL: &str = "https://open.spotify.com/";
const BUNDLE_BASE: &str = "https://open.spotifycdn.com/cdn/build/web-player/";
const BUNDLE_MARKER: &str = "/cdn/build/web-player/web-player.";
const BROWSER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/// Rediscovery downloads several megabytes; a failing gateway must not
/// trigger it on every keystroke.
const REDISCOVERY_COOLDOWN: Duration = Duration::from_secs(30 * 60);
const BUNDLE_TIMEOUT: Duration = Duration::from_secs(12);

pub(crate) struct Operation {
    pub name: &'static str,
    hash: &'static str,
    /// Lazy web-player chunk that defines the query when the main bundle
    /// does not.
    chunk: Option<&'static str>,
}

pub(crate) const SEARCH_DESKTOP: Operation = Operation {
    name: "searchDesktop",
    hash: "1148393611bbc58e84e47aed35ecc731275df9f9eb660956962e352dd3631d89",
    chunk: Some("xpui-routes-search"),
};

pub(crate) const CANVAS: Operation = Operation {
    name: "canvas",
    hash: "575138ab27cd5c1b3e54da54d0a7cc8d85485402de26340c2145f0f6bb5e7a9f",
    chunk: None,
};

#[derive(Default)]
struct Registry {
    discovered: HashMap<String, String>,
    last_discovery: Option<Instant>,
}

static REGISTRY: LazyLock<Mutex<Registry>> = LazyLock::new(Mutex::default);

/// Runs a persisted query and returns its `data` object.
pub(crate) async fn query(
    session: &Session,
    operation: &Operation,
    variables: Value,
) -> Option<Value> {
    let hash = current_hash(operation);
    if let Some(data) = post(session, operation, &hash, &variables).await {
        return Some(data);
    }
    let fresh = rediscover(operation).await?;
    if fresh == hash {
        return None;
    }
    info!(
        adapter = "librespot",
        operation = operation.name,
        "pathfinder query hash rotated; retrying with the web player's current one"
    );
    post(session, operation, &fresh, &variables).await
}

fn current_hash(operation: &Operation) -> String {
    REGISTRY
        .lock()
        .ok()
        .and_then(|registry| registry.discovered.get(operation.name).cloned())
        .unwrap_or_else(|| operation.hash.to_owned())
}

async fn post(
    session: &Session,
    operation: &Operation,
    hash: &str,
    variables: &Value,
) -> Option<Value> {
    let body = json!({
        "operationName": operation.name,
        "variables": variables,
        "extensions": { "persistedQuery": { "version": 1, "sha256Hash": hash } },
    })
    .to_string();
    let bytes = session_http::request_raw(
        session,
        &Method::POST,
        QUERY_URL,
        body.as_bytes(),
        "application/json",
        "application/json",
        &[
            ("origin", "https://open.spotify.com"),
            ("referer", "https://open.spotify.com/"),
        ],
    )
    .await?;
    let mut value = serde_json::from_slice::<Value>(&bytes).ok()?;
    if let Some(errors) = value.get("errors").and_then(Value::as_array)
        && !errors.is_empty()
    {
        let messages = errors
            .iter()
            .filter_map(|error| error.get("message").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("; ");
        warn!(
            adapter = "librespot",
            operation = operation.name,
            errors = %messages,
            "pathfinder query returned errors"
        );
    }
    match value.get_mut("data").map(Value::take) {
        Some(data) if data.is_object() => Some(data),
        _ => None,
    }
}

/// Reads the current hash of `operation` from the web player, at most once
/// per cooldown. Every hash found on the way is kept for later queries.
async fn rediscover(operation: &Operation) -> Option<String> {
    {
        let mut registry = REGISTRY.lock().ok()?;
        if registry
            .last_discovery
            .is_some_and(|at| at.elapsed() < REDISCOVERY_COOLDOWN)
        {
            return registry.discovered.get(operation.name).cloned();
        }
        registry.last_discovery = Some(Instant::now());
    }
    let started = Instant::now();
    let found = tokio::time::timeout(BUNDLE_TIMEOUT * 3, discover(operation))
        .await
        .unwrap_or_default();
    let hash = found.get(operation.name).cloned();
    info!(
        adapter = "librespot",
        operation = operation.name,
        operations = found.len(),
        found = hash.is_some(),
        elapsed_ms = started.elapsed().as_millis(),
        "pathfinder hashes read from the web player"
    );
    if let Ok(mut registry) = REGISTRY.lock() {
        registry.discovered.extend(found);
    }
    hash
}

async fn discover(operation: &Operation) -> HashMap<String, String> {
    let Ok(client) = reqwest::Client::builder()
        .user_agent(BROWSER_AGENT)
        .timeout(BUNDLE_TIMEOUT)
        .build()
    else {
        return HashMap::new();
    };
    let Some(html) = fetch_text(&client, WEB_PLAYER_URL).await else {
        return HashMap::new();
    };
    let Some(bundle_url) = main_bundle_url(&html) else {
        debug!(adapter = "librespot", "web player page had no main bundle");
        return HashMap::new();
    };
    let Some(bundle) = fetch_text(&client, &bundle_url).await else {
        return HashMap::new();
    };
    let mut found = operation_hashes(&bundle);
    if found.contains_key(operation.name) {
        return found;
    }
    let Some(chunk) = operation.chunk else {
        return found;
    };
    for url in chunk_urls(&bundle, chunk) {
        if let Some(script) = fetch_text(&client, &url).await {
            let hashes = operation_hashes(&script);
            let done = hashes.contains_key(operation.name);
            found.extend(hashes);
            if done {
                break;
            }
        }
    }
    found
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Option<String> {
    match client
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
    {
        Ok(response) => response.text().await.ok(),
        Err(error) => {
            debug!(adapter = "librespot", url, error = %error, "web player asset unavailable");
            None
        }
    }
}

fn main_bundle_url(html: &str) -> Option<String> {
    let start = html.find(BUNDLE_MARKER)? + BUNDLE_MARKER.len();
    let rest = &html[start..];
    let end = rest.find(".js")?;
    let version = &rest[..end];
    version
        .chars()
        .all(|character| character.is_ascii_alphanumeric())
        .then(|| format!("{BUNDLE_BASE}web-player.{version}.js"))
}

/// Every `"name","query","<sha256>"` definition in a web-player script.
fn operation_hashes(script: &str) -> HashMap<String, String> {
    let mut found = HashMap::new();
    for kind in ["\",\"query\",\"", "\",\"mutation\",\""] {
        let mut from = 0;
        while let Some(offset) = script[from..].find(kind) {
            let at = from + offset;
            from = at + kind.len();
            let Some(name_start) = script[..at].rfind('"') else {
                continue;
            };
            let name = &script[name_start + 1..at];
            let hash = script.get(from..from + 64).unwrap_or_default();
            let closed = script.as_bytes().get(from + 64) == Some(&b'"');
            if closed
                && !name.is_empty()
                && name
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
                && hash.chars().all(|character| character.is_ascii_hexdigit())
            {
                found.insert(name.to_owned(), hash.to_owned());
            }
        }
    }
    found
}

/// Candidate URLs of a lazy chunk. The bundle maps chunk ids to names and,
/// separately, to content hashes for JS and CSS; the JS map comes first, but
/// trying each hash keeps this independent of that order.
fn chunk_urls(bundle: &str, chunk: &str) -> Vec<String> {
    let needle = format!(":\"{chunk}\"");
    let Some(at) = bundle.find(&needle) else {
        return Vec::new();
    };
    let id_start = bundle[..at]
        .rfind(|character: char| !character.is_ascii_digit())
        .map_or(0, |index| index + 1);
    let id = &bundle[id_start..at];
    if id.is_empty() {
        return Vec::new();
    }
    let key = format!("{id}:\"");
    let mut urls = Vec::new();
    let mut from = 0;
    while let Some(offset) = bundle[from..].find(&key) {
        let start = from + offset + key.len();
        from = start;
        let preceded_by_digit = bundle[..from - key.len()]
            .chars()
            .next_back()
            .is_some_and(|character| character.is_ascii_digit());
        let hash = bundle.get(start..start + 8).unwrap_or_default();
        if !preceded_by_digit
            && bundle.as_bytes().get(start + 8) == Some(&b'"')
            && hash.chars().all(|character| character.is_ascii_hexdigit())
        {
            urls.push(format!("{BUNDLE_BASE}{chunk}.{hash}.js"));
        }
        if urls.len() == 3 {
            break;
        }
    }
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "1148393611bbc58e84e47aed35ecc731275df9f9eb660956962e352dd3631d89";

    #[test]
    fn reads_operation_hashes_from_bundle_source() {
        let script = format!(
            r#"si=new _.l("searchDesktop","query","{HASH}",null);x=new _.l("addToLibrary","mutation","{HASH}",null);y=f("a","query","short")"#
        );
        let found = operation_hashes(&script);
        assert_eq!(found.get("searchDesktop").map(String::as_str), Some(HASH));
        assert!(found.contains_key("addToLibrary"));
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn finds_the_search_chunk_behind_its_id() {
        let bundle = r#"u.u=e=>""+({1328:"xpui-pip",4406:"xpui-routes-search"})[e]+"."+({14406:"deadbeef",4406:"96d81afe",1328:"0badf00d"})[e]+".js",u.miniCssF=e=>({4406:"973a0279"})"#;
        assert_eq!(
            chunk_urls(bundle, "xpui-routes-search"),
            vec![
                format!("{BUNDLE_BASE}xpui-routes-search.96d81afe.js"),
                format!("{BUNDLE_BASE}xpui-routes-search.973a0279.js"),
            ]
        );
    }

    #[test]
    fn finds_the_main_bundle_in_the_page() {
        let html = r#"<script src="https://open.spotifycdn.com/cdn/build/web-player/web-player.da8b87c8.js"></script>"#;
        assert_eq!(
            main_bundle_url(html).as_deref(),
            Some("https://open.spotifycdn.com/cdn/build/web-player/web-player.da8b87c8.js")
        );
    }
}
