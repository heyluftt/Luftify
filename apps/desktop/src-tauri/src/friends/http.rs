use luft_listen_together::SocialError;
use reqwest::{Client, Method};
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;
use url::Url;
use zeroize::Zeroizing;

const MAX_RESPONSE_BYTES: usize = 24 * 1024 * 1024;

pub(super) fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "friends.error.unreachable".into())
}

pub(super) async fn request<T: DeserializeOwned>(
    client: &Client,
    endpoint: &Url,
    method: Method,
    route: &str,
    token: Option<&str>,
    body: Option<&impl Serialize>,
    query: Option<&str>,
) -> Result<T, String> {
    let mut url = endpoint
        .join(route)
        .map_err(|_| "friends.error.invalidUrl")?;
    if let Some(query) = query {
        url.query_pairs_mut().append_pair("q", query);
    }
    let mut request = client.request(method, url);
    if let Some(token) = token {
        request = if route == "register" || route == "restore" {
            request.header("X-Luftify-Registration-Key", token)
        } else {
            request.bearer_auth(token)
        };
    }
    if let Some(body) = body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(serde_json::to_vec(body).map_err(|_| "friends.error.invalidMessage")?);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "friends.error.unreachable")?;
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err("friends.error.protocol".into());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "friends.error.unreachable")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("friends.error.protocol".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if status.is_success() {
        return serde_json::from_slice(&bytes).map_err(|_| "friends.error.protocol".into());
    }
    Err(error_key(status, &bytes))
}

pub(super) fn error_key(status: reqwest::StatusCode, bytes: &[u8]) -> String {
    let code = serde_json::from_slice::<SocialError>(&bytes)
        .ok()
        .map(|error| error.code)
        .filter(|code| {
            !code.is_empty()
                && code.len() <= 48
                && code.chars().all(|char| char.is_ascii_alphanumeric())
        });
    if let Some(code) = code {
        return format!("friends.error.{code}");
    }
    if status.as_u16() == 404 {
        return "friends.error.serverUpdateRequired".into();
    }
    "friends.error.generic".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_requests_are_distinct_from_an_old_server() {
        assert_eq!(
            error_key(
                reqwest::StatusCode::NOT_FOUND,
                br#"{"code":"invalidRequest"}"#
            ),
            "friends.error.invalidRequest"
        );
        assert_eq!(
            error_key(reqwest::StatusCode::NOT_FOUND, b""),
            "friends.error.serverUpdateRequired"
        );
    }
}
