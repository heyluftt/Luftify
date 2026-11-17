use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http::{Method, Request};
use librespot::core::Session;
use tracing::{debug, warn};

mod web_api;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const WEB_API: &str = "https://api.spotify.com/";
const WEB_API_FIRST_PAUSE: Duration = Duration::from_secs(30);
const WEB_API_LONGEST_PAUSE: Duration = Duration::from_secs(10 * 60);

/// The Web API rate-limits librespot's shared client id for minutes at a
/// time. Asking again every few seconds (new releases polled every 10 s)
/// only kept the limit alive and filled the log; after a 429 an endpoint
/// rests, doubling from 30 s to 10 min, until an answer comes through.
/// The limit is per endpoint: a working `/v1/playlists` call used to reset
/// the shared pause, so the limited search was asked again every 30 s.
/// Callers already fall back (pathfinder, search context) when it is silent.
#[derive(Default)]
struct WebApiPause {
    until: Option<Instant>,
    strikes: u32,
}

static WEB_API_PAUSES: LazyLock<Mutex<HashMap<String, WebApiPause>>> =
    LazyLock::new(Mutex::default);

/// `https://api.spotify.com/v1/search?q=…` → `v1/search`.
fn web_api_endpoint(url: &str) -> Option<String> {
    let path = url.strip_prefix(WEB_API)?;
    let path = path.split(['?', '#']).next().unwrap_or_default();
    Some(path.split('/').take(2).collect::<Vec<_>>().join("/"))
}

fn web_api_resting(url: &str) -> bool {
    let Some(endpoint) = web_api_endpoint(url) else {
        return false;
    };
    let resting = WEB_API_PAUSES
        .lock()
        .ok()
        .and_then(|pauses| pauses.get(&endpoint).and_then(|pause| pause.until))
        .is_some_and(|until| Instant::now() < until);
    if resting {
        debug!(
            adapter = "librespot",
            url, "web api resting after a rate limit"
        );
    }
    resting
}

fn note_web_api(url: &str, rate_limited: bool) {
    note_web_api_retry(url, rate_limited, None);
}

fn note_web_api_retry(url: &str, rate_limited: bool, retry_after: Option<Duration>) {
    let Some(endpoint) = web_api_endpoint(url) else {
        return;
    };
    let Ok(mut pauses) = WEB_API_PAUSES.lock() else {
        return;
    };
    if !rate_limited {
        // A request already in flight may succeed after another one was limited.
        if !pauses.get(&endpoint).and_then(|pause| pause.until).is_some_and(|until| Instant::now() < until) {
            pauses.remove(&endpoint);
        }
        return;
    }
    let pause = pauses.entry(endpoint.clone()).or_default();
    pause.strikes = pause.strikes.saturating_add(1);
    let rest = web_api_rest(pause.strikes).max(retry_after.unwrap_or_default());
    let now = Instant::now();
    let until = now.checked_add(rest).unwrap_or(now + WEB_API_LONGEST_PAUSE);
    let until = pause.until.map_or(until, |old| old.max(until));
    pause.until = Some(until);
    let rest = until.saturating_duration_since(now);
    warn!(
        adapter = "librespot",
        endpoint,
        rest_seconds = rest.as_secs(),
        strikes = pause.strikes,
        "web api rate limited; resting before the next request"
    );
}

/// 30 s after the first 429, doubling with every further one, at most 10 min.
fn web_api_rest(strikes: u32) -> Duration {
    WEB_API_FIRST_PAUSE
        .saturating_mul(1 << strikes.saturating_sub(1).min(5))
        .min(WEB_API_LONGEST_PAUSE)
}

/// Keymaster refuses scoped tokens for librespot's client id (403 "Invalid
/// request"). Asking again for every fallback only doubled each miss with a
/// librespot ERROR line, so after a refusal scoped requests rest for an hour.
const KEYMASTER_REST: Duration = Duration::from_secs(60 * 60);
/// A token request that failed for another reason (network) rests briefly.
const KEYMASTER_SHORT_REST: Duration = Duration::from_secs(60);

static KEYMASTER_PAUSE: Mutex<Option<Instant>> = Mutex::new(None);

fn keymaster_resting() -> bool {
    KEYMASTER_PAUSE
        .lock()
        .ok()
        .and_then(|pause| *pause)
        .is_some_and(|until| Instant::now() < until)
}

fn note_keymaster_failure(refused: bool) {
    if let Ok(mut pause) = KEYMASTER_PAUSE.lock() {
        let rest = if refused {
            KEYMASTER_REST
        } else {
            KEYMASTER_SHORT_REST
        };
        *pause = Some(Instant::now() + rest);
    }
}

/// Why a scoped Web API request to `url` would not go out right now.
pub(crate) fn scoped_web_api_blocked(url: &str) -> Option<&'static str> {
    if web_api_resting(url) {
        Some("rate-limit-rest")
    } else if keymaster_resting() {
        Some("token-refused")
    } else {
        None
    }
}

/// Mercury errors print their payload as a list of bytes; the JSON inside
/// is what explains a refusal.
fn readable_error(text: &str) -> String {
    const MARKER: &str = "payload: [[";
    let Some(start) = text.find(MARKER) else {
        return text.to_owned();
    };
    let body = start + MARKER.len();
    let Some(length) = text[body..].find("]]") else {
        return text.to_owned();
    };
    let decoded = text[body..body + length]
        .split(',')
        .map(|byte| byte.trim().parse::<u8>().ok())
        .collect::<Option<Vec<_>>>()
        .and_then(|bytes| String::from_utf8(bytes).ok());
    match decoded {
        Some(payload) => format!(
            "{}payload: {payload}{}",
            &text[..start],
            &text[body + length + 2..]
        ),
        None => text.to_owned(),
    }
}

fn rate_limited(error: &librespot::core::Error) -> bool {
    error.kind == librespot::core::error::ErrorKind::ResourceExhausted
}

pub(crate) async fn get_json(session: &Session, url: &str) -> Option<Bytes> {
    request(session, &Method::GET, url, None).await
}

pub(crate) async fn request(
    session: &Session,
    method: &Method,
    url: &str,
    body: Option<&str>,
) -> Option<Bytes> {
    request_raw(
        session,
        method,
        url,
        body.unwrap_or_default().as_bytes(),
        "application/json",
        "application/json",
        &[],
    )
    .await
}

pub(crate) async fn request_raw(
    session: &Session,
    method: &Method,
    url: &str,
    body: &[u8],
    content_type: &str,
    accept: &str,
    extra_headers: &[(&str, &str)],
) -> Option<Bytes> {
    match tokio::time::timeout(
        REQUEST_TIMEOUT,
        request_inner(
            session,
            method,
            url,
            body,
            content_type,
            accept,
            extra_headers,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            warn!(adapter = "librespot", url, "session http request timed out");
            None
        }
    }
}

async fn request_inner(
    session: &Session,
    method: &Method,
    url: &str,
    body: &[u8],
    content_type: &str,
    accept: &str,
    extra_headers: &[(&str, &str)],
) -> Option<Bytes> {
    if web_api_resting(url) {
        return None;
    }
    let token = session.login5().auth_token().await.ok()?;
    let mut builder = Request::builder()
        .method(method)
        .uri(url)
        .header("accept", accept)
        .header("app-platform", "WebPlayer")
        .header(
            "authorization",
            format!("{} {}", token.token_type, token.access_token),
        )
        .header("content-type", content_type);
    for (name, value) in extra_headers {
        builder = builder.header(*name, *value);
    }
    if let Ok(client_token) = session.spclient().client_token().await
        && let Ok(value) = http::HeaderValue::from_str(&client_token)
    {
        builder = builder.header("client-token", value);
    }
    let request = builder.body(Bytes::copy_from_slice(body)).ok()?;
    match web_api::request_body(session, url, request).await {
        Ok(bytes) => {
            note_web_api(url, false);
            Some(bytes)
        }
        Err(error) => {
            // 404 is an answer (no lyrics, no canvas for this track), not a fault.
            if error.kind == librespot::core::error::ErrorKind::NotFound {
                debug!(
                    adapter = "librespot",
                    url, "session http resource not found"
                );
            } else {
                warn!(
                    adapter = "librespot",
                    url,
                    error = %error,
                    "session http request failed"
                );
            }
            None
        }
    }
}

pub(crate) async fn request_web_api(
    session: &Session,
    method: &Method,
    url: &str,
    body: Option<&str>,
    scopes: &str,
) -> Option<Bytes> {
    request_web_api_with_type(session, method, url, body, scopes, "application/json").await
}

pub(crate) async fn request_web_api_with_type(
    session: &Session,
    method: &Method,
    url: &str,
    body: Option<&str>,
    scopes: &str,
    content_type: &str,
) -> Option<Bytes> {
    match tokio::time::timeout(
        REQUEST_TIMEOUT,
        request_web_api_inner(session, method, url, body, scopes, content_type),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            warn!(
                adapter = "librespot",
                url, scopes, "web api request timed out"
            );
            None
        }
    }
}

async fn request_web_api_inner(
    session: &Session,
    method: &Method,
    url: &str,
    body: Option<&str>,
    scopes: &str,
    content_type: &str,
) -> Option<Bytes> {
    if web_api_resting(url) {
        return None;
    }
    if keymaster_resting() {
        debug!(
            adapter = "librespot",
            scopes, "scoped web api token resting after a refusal"
        );
        return None;
    }
    let token = match session.token_provider().get_token(scopes).await {
        Ok(token) => token,
        Err(error) => {
            let error = readable_error(&error.to_string());
            let refused = error.contains("status_code: 403");
            note_keymaster_failure(refused);
            warn!(
                adapter = "librespot",
                phase = "web-api-token",
                scopes,
                refused,
                error = %error,
                "librespot could not obtain a scoped web api token"
            );
            return None;
        }
    };
    let bytes = body.unwrap_or_default().as_bytes();
    let request = match Request::builder()
        .method(method)
        .uri(url)
        .header("accept", "application/json")
        .header("authorization", format!("Bearer {}", token.access_token))
        .header("content-type", content_type)
        .body(Bytes::copy_from_slice(bytes))
    {
        Ok(request) => request,
        Err(error) => {
            warn!(
                adapter = "librespot",
                phase = "web-api-request",
                error = %error,
                "librespot could not build a web api request"
            );
            return None;
        }
    };
    match web_api::request_body(session, url, request).await {
        Ok(bytes) => {
            note_web_api(url, false);
            Some(bytes)
        }
        Err(error) => {
            warn!(
                adapter = "librespot",
                url,
                scopes,
                error = %error,
                "web api request failed"
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_api_rests_longer_after_each_rate_limit() {
        let rests: Vec<u64> = (1..=7)
            .map(|strikes| web_api_rest(strikes).as_secs())
            .collect();
        assert_eq!(rests, vec![30, 60, 120, 240, 480, 600, 600]);
        assert!(!web_api_resting("https://spclient.wg.spotify.com/anything"));
    }

    #[test]
    fn rate_limits_rest_per_endpoint() {
        assert_eq!(
            web_api_endpoint("https://api.spotify.com/v1/search?q=tag%3Anew").as_deref(),
            Some("v1/search")
        );
        assert_eq!(
            web_api_endpoint("https://api.spotify.com/v1/playlists/abc/items").as_deref(),
            Some("v1/playlists")
        );
        note_web_api("https://api.spotify.com/v1/browse?x=1", true);
        note_web_api("https://api.spotify.com/v1/artists/a", false);
        assert!(web_api_resting(
            "https://api.spotify.com/v1/browse/new-releases"
        ));
        assert!(!web_api_resting("https://api.spotify.com/v1/artists/b"));
    }

    #[test]
    fn decodes_mercury_payload_bytes() {
        let text = "Service unavailable { MercuryResponse { status_code: 403, payload: [[123, 34, 99, 34, 58, 52, 125]] } }";
        assert_eq!(
            readable_error(text),
            "Service unavailable { MercuryResponse { status_code: 403, payload: {\"c\":4} } }"
        );
        assert_eq!(readable_error("plain"), "plain");
    }

    #[test]
    fn concurrent_success_and_shorter_limits_do_not_erase_server_wait() {
        let url = "https://api.spotify.com/v1/test-overlap";
        note_web_api_retry(url, true, Some(Duration::from_secs(1200)));
        let before = WEB_API_PAUSES.lock().unwrap()["v1/test-overlap"].until.unwrap();
        note_web_api(url, false);
        assert!(web_api_resting(url));
        note_web_api(url, true);
        assert!(WEB_API_PAUSES.lock().unwrap()["v1/test-overlap"].until.unwrap() >= before);
    }
}
