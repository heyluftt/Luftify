//! Explicit Spotify consent with PKCE and a bounded, state-checked loopback callback.
mod callback_http;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope,
    TokenResponse, TokenUrl, basic::BasicClient,
};
use std::time::Duration;
use tokio::net::TcpListener;

pub(crate) async fn request(
    client_id: &str,
    redirect: &str,
    scopes: &[&str],
) -> Result<String, String> {
    let redirect_url =
        reqwest::Url::parse(redirect).map_err(|_| "Ungültige lokale Login-Adresse.")?;
    let port = redirect_url
        .port()
        .ok_or("Ungültiger lokaler Login-Port.")?;
    let listener = TcpListener::bind(("127.0.0.1", port)).await.map_err(
        |_| "Der lokale Login-Port ist belegt. Bitte eine andere laufende Anmeldung schließen.",
    )?;
    let client = BasicClient::new(ClientId::new(client_id.into()))
        .set_auth_uri(
            AuthUrl::new("https://accounts.spotify.com/authorize".into())
                .map_err(|_| "Ungültiger Login-Endpunkt.")?,
        )
        .set_token_uri(
            TokenUrl::new("https://accounts.spotify.com/api/token".into())
                .map_err(|_| "Ungültiger Token-Endpunkt.")?,
        )
        .set_redirect_uri(
            RedirectUrl::new(redirect.into()).map_err(|_| "Ungültige Login-Adresse.")?,
        );
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state) = client
        .authorize_url(CsrfToken::new_random)
        .add_scopes(scopes.iter().map(|scope| Scope::new((*scope).into())))
        .set_pkce_challenge(challenge)
        .add_extra_param("show_dialog", "true")
        .url();
    open::that(url.as_str()).map_err(|_| "Der Browser konnte nicht geöffnet werden.")?;
    let code = tokio::time::timeout(
        Duration::from_secs(180),
        callback_http::receive(&listener, redirect_url.path(), state.secret()),
    )
    .await
    .map_err(|_| "Die Anmeldung wurde nach drei Minuten beendet. Bitte erneut versuchen.")??;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Login-Verbindung konnte nicht vorbereitet werden.")?;
    let token = client
        .exchange_code(AuthorizationCode::new(code))
        .set_pkce_verifier(verifier)
        .request_async(&http)
        .await
        .map_err(|_| "Spotify hat die Anmeldung nicht abgeschlossen. Bitte erneut versuchen.")?;
    Ok(token.access_token().secret().clone())
}

// Invalid/unrelated requests do not consume the login. Explicit denial does.
fn callback(target: &str, path: &str, expected_state: &str) -> Option<Result<String, String>> {
    if !target.starts_with('/') || target.starts_with("//") {
        return None;
    }
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != path {
        return None;
    }
    let states: Vec<_> = url
        .query_pairs()
        .filter(|(key, _)| key == "state")
        .collect();
    if states.len() != 1 || states[0].1 != expected_state {
        return None;
    }
    if url.query_pairs().any(|(key, _)| key == "error") {
        return Some(Err("Die Spotify-Anmeldung wurde abgebrochen.".into()));
    }
    let codes: Vec<_> = url.query_pairs().filter(|(key, _)| key == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() {
        return None;
    }
    Some(Ok(codes[0].1.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn callback_requires_matching_state_path_and_one_code() {
        assert_eq!(
            callback("/login?state=s&code=c", "/login", "s"),
            Some(Ok("c".into()))
        );
        assert!(callback("/login?state=wrong&code=c", "/login", "s").is_none());
        assert!(callback("/other?state=s&code=c", "/login", "s").is_none());
        assert!(callback("/login?state=s&code=a&code=b", "/login", "s").is_none());
        assert!(
            callback("/login?state=s&error=access_denied", "/login", "s")
                .unwrap()
                .is_err()
        );
    }
}
