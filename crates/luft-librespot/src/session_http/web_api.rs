//! Observe Web API 429 headers before the outer timeout can cancel an internal retry.
//! Playback/CDN and internal Spotify requests retain librespot's original handling.
use std::time::Duration;

use bytes::Bytes;
use http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use librespot::core::{Error, Session, http_client::HttpClientError};

use super::{note_web_api, note_web_api_retry, rate_limited, web_api_endpoint};

pub(super) async fn request_body(session: &Session, url: &str, request: Request<Bytes>) -> Result<Bytes, Error> {
    if web_api_endpoint(url).is_none() {
        return session.http_client().request_body(request).await;
    }
    let pending = match session.http_client().request_fut(request) {
        Ok(pending) => pending,
        Err(error) => {
            if rate_limited(&error) { note_web_api(url, true); }
            return Err(error);
        }
    };
    let response = pending.await?;
    let status = response.status();
    if status == StatusCode::TOO_MANY_REQUESTS {
        note_web_api_retry(url, true, retry_after(response.headers(), chrono::Utc::now()));
    }
    if !status.is_success() {
        return Err(HttpClientError::StatusCode(status).into());
    }
    Ok(response.into_body().collect().await?.to_bytes())
}

fn retry_after(headers: &HeaderMap, now: chrono::DateTime<chrono::Utc>) -> Option<Duration> {
    let value = headers.get(http::header::RETRY_AFTER)?.to_str().ok()?.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    Some(date.signed_duration_since(now).to_std().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn accepts_server_waits_longer_than_our_default_and_http_dates() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-07T08:30:00Z").unwrap().to_utc();
        let mut headers = HeaderMap::new();
        for (value, expected) in [("1200", Some(1200)), ("Wed, 07 Oct 2026 08:32:00 GMT", Some(120)), ("-1", None), ("invalid", None)] {
            headers.insert(http::header::RETRY_AFTER, value.parse().unwrap());
            assert_eq!(retry_after(&headers, now).map(|wait| wait.as_secs()), expected);
        }
    }

    #[tokio::test]
    async fn records_429_without_retrying_or_waiting_inside_the_request() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            socket.read(&mut bytes).await.unwrap();
            socket.write_all(b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1200\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let session = Session::new(Default::default(), None);
        let request = Request::builder().uri(format!("http://{address}/")).body(Bytes::new()).unwrap();
        let url = "https://api.spotify.com/v1/test-retry-after";
        let result = tokio::time::timeout(Duration::from_secs(3), request_body(&session, url, request)).await.unwrap();
        assert!(rate_limited(&result.unwrap_err()));
        let pauses = super::super::WEB_API_PAUSES.lock().unwrap();
        let pause = &pauses["v1/test-retry-after"];
        assert_eq!(pause.strikes, 1);
        assert!(pause.until.unwrap().saturating_duration_since(std::time::Instant::now()) > Duration::from_secs(1190));
        drop(pauses);
        server.await.unwrap();
    }
}
