use url::{Host, Url};

/// Bearer credentials may travel over TLS, or loopback HTTP during local development.
pub(super) fn social_endpoint(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "friends.error.invalidUrl")?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host().is_none()
    {
        return Err("friends.error.invalidUrl".into());
    }
    let loopback = match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    let scheme = match url.scheme() {
        "wss" => "https",
        "ws" if loopback => "http",
        _ => return Err("friends.error.invalidUrl".into()),
    };
    url.set_scheme(scheme)
        .map_err(|_| "friends.error.invalidUrl")?;
    let base = url
        .path()
        .trim_end_matches('/')
        .strip_suffix("/ws")
        .unwrap_or(url.path().trim_end_matches('/'))
        .to_owned();
    url.set_path(&format!("{base}/social/v1/"));
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_proxy_prefix_and_isolates_server_identities() {
        assert_eq!(
            social_endpoint("wss://example.com/music/ws")
                .unwrap()
                .as_str(),
            "https://example.com/music/social/v1/"
        );
        assert_eq!(
            social_endpoint("ws://[::1]:7421/ws").unwrap().as_str(),
            "http://[::1]:7421/social/v1/"
        );
    }

    #[test]
    fn never_sends_credentials_to_remote_plaintext_or_embedded_authorities() {
        for url in [
            "ws://example.com/ws",
            "wss://user:secret@example.com/ws",
            "wss://example.com/ws?token=secret",
            "wss://example.com/ws#secret",
            "https://example.com/ws",
            "ws://localhost.evil.com/ws",
        ] {
            assert!(social_endpoint(url).is_err(), "{url}");
        }
    }
}
