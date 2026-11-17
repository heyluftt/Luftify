use luft_core::MediaItem;

use super::uri::{canonicalize_item_uri, same_item_uri};

const CONNECT_STUB_MAX: usize = 16;
const CACHED_STUB_MAX: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DatedUri {
    pub uri: String,
    pub added_at: Option<String>,
}

/// Play order for a Libre context, shuffle off.
///
/// 1. A catalog from the play request is the play order. Always.
/// 2. Otherwise a locked context stays locked; remote entries may only append
///    missing URIs, never change the order.
/// 3. A short Connect leftover may be replaced.
/// 4. A freshly resolved playlist is newest-added first.
pub(crate) fn play_order(
    catalog: &[String],
    existing: &[String],
    remote: &[DatedUri],
) -> Vec<String> {
    if !catalog.is_empty() {
        return catalog.to_vec();
    }
    let remote_uris = newest_first(remote);
    extend_play_order(existing, &remote_uris)
}

pub(crate) fn extend_play_order(existing: &[String], incoming: &[String]) -> Vec<String> {
    if incoming.is_empty() {
        return existing.to_vec();
    }
    if existing.is_empty() || is_replaceable_stub(existing, incoming) {
        return incoming.to_vec();
    }
    if is_same_uri_prefix(existing, incoming) {
        return incoming.to_vec();
    }
    if is_same_uri_prefix(incoming, existing) {
        return existing.to_vec();
    }
    append_missing(existing, incoming)
}

pub(crate) fn newest_first(entries: &[DatedUri]) -> Vec<String> {
    let mut dated = entries
        .iter()
        .filter_map(|entry| {
            canonicalize_item_uri(&entry.uri)
                .map(|uri| (uri, added_at_ms(entry.added_at.as_deref())))
        })
        .collect::<Vec<_>>();
    if dated.iter().any(|(_, added_at)| added_at.is_some()) {
        dated.sort_by(|left, right| match (left.1, right.1) {
            (Some(left), Some(right)) => right.cmp(&left),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        });
    }
    dated.into_iter().map(|(uri, _)| uri).collect()
}

pub(crate) fn catalog_uris(items: &[MediaItem]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| canonicalize_item_uri(&item.uri))
        .collect()
}

pub(crate) fn sort_media_newest_first(mut items: Vec<MediaItem>) -> Vec<MediaItem> {
    if items
        .iter()
        .any(|item| added_at_ms(item.added_at.as_deref()).is_some())
    {
        items.sort_by(|left, right| {
            match (
                added_at_ms(left.added_at.as_deref()),
                added_at_ms(right.added_at.as_deref()),
            ) {
                (Some(left), Some(right)) => right.cmp(&left),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            }
        });
    }
    items
}

fn is_replaceable_stub(existing: &[String], incoming: &[String]) -> bool {
    incoming.len() >= 20
        && incoming.len() >= existing.len().saturating_mul(3)
        && (existing.len() < CONNECT_STUB_MAX || existing.len() <= CACHED_STUB_MAX)
}

fn is_same_uri_prefix(prefix: &[String], full: &[String]) -> bool {
    prefix.len() <= full.len()
        && prefix
            .iter()
            .zip(full)
            .all(|(left, right)| same_item_uri(left, right))
}

fn append_missing(existing: &[String], incoming: &[String]) -> Vec<String> {
    let mut merged = existing.to_vec();
    for uri in incoming {
        if !merged.iter().any(|have| same_item_uri(have, uri)) {
            merged.push(uri.clone());
        }
    }
    merged
}

fn added_at_ms(value: Option<&str>) -> Option<i64> {
    crate::playlist::added_at_from_raw(value?).and_then(|raw| {
        chrono::DateTime::parse_from_rfc3339(&raw)
            .ok()
            .map(|time| time.timestamp_millis())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dated(uri: &str, added_at: &str) -> DatedUri {
        DatedUri {
            uri: uri.into(),
            added_at: Some(added_at.into()),
        }
    }

    #[test]
    fn catalog_from_the_play_request_wins_over_oldest_storage_order() {
        let catalog = vec![
            "spotify:track:new".into(),
            "spotify:track:mid".into(),
            "spotify:track:old".into(),
        ];
        let existing = vec![
            "spotify:track:old".into(),
            "spotify:track:mid".into(),
            "spotify:track:new".into(),
        ];
        assert_eq!(play_order(&catalog, &existing, &[]), catalog);
    }

    #[test]
    fn resolved_playlists_play_newest_added_first() {
        let remote = vec![
            dated(
                "spotify:track:0000000000000000000001",
                "2020-01-01T00:00:00Z",
            ),
            dated(
                "spotify:track:0000000000000000000002",
                "2024-01-01T00:00:00Z",
            ),
            dated(
                "spotify:track:0000000000000000000003",
                "2026-08-19T00:00:00Z",
            ),
        ];
        assert_eq!(
            play_order(&[], &[], &remote),
            vec![
                "spotify:track:0000000000000000000003".to_string(),
                "spotify:track:0000000000000000000002".to_string(),
                "spotify:track:0000000000000000000001".to_string(),
            ]
        );
    }

    #[test]
    fn upcoming_after_a_recent_track_is_the_next_newest() {
        let order = vec![
            "spotify:track:new".to_string(),
            "spotify:track:mid".to_string(),
            "spotify:track:old".to_string(),
        ];
        let remaining = crate::queue::upcoming_uris(&order, "spotify:track:new", false);
        assert_eq!(
            remaining,
            vec![
                "spotify:track:mid".to_string(),
                "spotify:track:old".to_string()
            ]
        );
    }

    #[test]
    fn expand_keeps_a_locked_newest_first_order() {
        let existing = vec![
            "spotify:track:new".to_string(),
            "spotify:track:mid".to_string(),
        ];
        let incoming = vec![
            "spotify:track:old".to_string(),
            "spotify:track:mid".to_string(),
            "spotify:track:new".to_string(),
        ];
        assert_eq!(
            extend_play_order(&existing, &incoming),
            vec![
                "spotify:track:new".to_string(),
                "spotify:track:mid".to_string(),
                "spotify:track:old".to_string(),
            ]
        );
    }

    #[test]
    fn a_three_song_connect_stub_is_replaced() {
        let stub = vec![
            "spotify:track:a".to_string(),
            "spotify:track:b".to_string(),
            "spotify:track:c".to_string(),
        ];
        let remote = (0..24)
            .map(|index| {
                dated(
                    &format!("spotify:track:{index:022}"),
                    &format!("2026-01-{:02}T00:00:00Z", index + 1),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            play_order(&[], &stub, &remote)[0],
            "spotify:track:0000000000000000000023"
        );
    }
}
