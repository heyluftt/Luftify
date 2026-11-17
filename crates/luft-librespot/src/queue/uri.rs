use librespot::core::SpotifyUri;

pub(crate) fn same_item_uri(left: &str, right: &str) -> bool {
    if left == right {
        return true;
    }
    match (canonicalize_item_uri(left), canonicalize_item_uri(right)) {
        (Some(left), Some(right)) if left == right => true,
        _ => {
            let left_key = item_uri_key(left);
            let right_key = item_uri_key(right);
            left_key.len() == 22 && left_key == right_key
        }
    }
}

#[must_use]
pub(crate) fn canonicalize_item_uri(uri: &str) -> Option<String> {
    let base = uri.split(['?', '#']).next().unwrap_or(uri).trim();
    match SpotifyUri::from_uri(base).ok()? {
        parsed @ (SpotifyUri::Track { .. }
        | SpotifyUri::Episode { .. }
        | SpotifyUri::Local { .. }) => parsed.to_uri().ok(),
        SpotifyUri::Unknown { .. } => {
            let id = base.strip_prefix("spotify:unknown:")?;
            let track_uri = format!("spotify:track:{id}");
            matches!(
                SpotifyUri::from_uri(&track_uri),
                Ok(SpotifyUri::Track { .. })
            )
            .then_some(track_uri)
        }
        _ => None,
    }
}

fn item_uri_key(uri: &str) -> &str {
    let base = uri.split(['?', '#']).next().unwrap_or(uri).trim();
    base.rsplit(':').next().unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalize_turns_unknown_and_query_uris_into_tracks() {
        assert_eq!(
            canonicalize_item_uri("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp?context=1").as_deref(),
            Some("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp")
        );
        assert_eq!(
            canonicalize_item_uri("spotify:unknown:3n3Ppam7vgaVa1iaRUc9Lp").as_deref(),
            Some("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp")
        );
        assert_eq!(canonicalize_item_uri("spotify:playlist:abc"), None);
    }

    #[test]
    fn canonicalize_rejects_malformed_playable_uris() {
        assert_eq!(canonicalize_item_uri("spotify:track:123"), None);
        assert_eq!(canonicalize_item_uri("spotify:episode:123"), None);
        assert_eq!(
            canonicalize_item_uri("spotify:track:3n3Ppam7vgaVa1iaRUc9L!"),
            None
        );
        assert_eq!(canonicalize_item_uri("spotify:unknown:123"), None);
        assert_eq!(
            canonicalize_item_uri("spotify:local:Artist:Album:Track:not-a-duration"),
            None
        );
    }

    #[test]
    fn canonicalize_keeps_valid_episode_and_local_uris() {
        assert_eq!(
            canonicalize_item_uri("spotify:episode:3n3Ppam7vgaVa1iaRUc9Lp#fragment").as_deref(),
            Some("spotify:episode:3n3Ppam7vgaVa1iaRUc9Lp")
        );
        assert_eq!(
            canonicalize_item_uri("spotify:local:Artist:Album:Track:127").as_deref(),
            Some("spotify:local:Artist:Album:Track:127")
        );
    }
}
