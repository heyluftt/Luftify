use super::*;

pub(super) fn is_discovery_context(uri: &str) -> bool {
    uri == "spotify:search:luftify-discovery"
        || uri.starts_with("spotify:search:luftify-discovery-")
}

pub(super) fn replace_discovery_queue(
    snapshot: &mut PlaybackSnapshot,
    catalog: &[MediaItem],
    uris: Vec<String>,
    current: &str,
) {
    snapshot.queue.explicit.clear();
    snapshot.queue.clear_context();
    for item in catalog {
        snapshot.queue.remember_item(item);
    }
    snapshot
        .queue
        .replace_upcoming(uris, current, snapshot.shuffle_enabled);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_queue_replaces_old_context_and_explicit_tracks() {
        let a = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
        let b = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
        let c = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
        let mut snapshot = PlaybackSnapshot::default();
        snapshot.queue.push_explicit(loading_item(a));
        snapshot
            .queue
            .replace_upcoming(vec![a.into(), b.into()], a, false);
        let catalog = vec![loading_item(b), loading_item(c)];
        replace_discovery_queue(&mut snapshot, &catalog, vec![b.into(), c.into()], b);
        assert!(snapshot.queue.explicit.is_empty());
        assert_eq!(snapshot.queue.upcoming.len(), 1);
        assert_eq!(snapshot.queue.upcoming[0].item.uri, c);
        assert!(!is_discovery_context("spotify:playlist:test"));
        assert!(is_discovery_context(
            "spotify:search:luftify-discovery-test"
        ));
    }
}
