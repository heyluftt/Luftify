use librespot::{
    connect::{LoadContextOptions, LoadRequestOptions, Options, PlayingTrack},
    core::SpotifyUri,
};
use luft_core::{QueueItem, QueueItemReference, QueuePlacement, QueueReorderRequest, RepeatMode};

pub(crate) use crate::queue::{pick_random_context_start, should_pick_random_context_start};

#[must_use]
pub(crate) fn is_playable_item_uri(uri: &str) -> bool {
    matches!(
        SpotifyUri::from_uri(uri.trim()),
        Ok(SpotifyUri::Track { .. } | SpotifyUri::Episode { .. })
    )
}

#[must_use]
pub(crate) fn is_context_uri(uri: &str) -> bool {
    let uri = uri.trim();
    if is_playable_item_uri(uri) {
        return false;
    }
    uri.starts_with("spotify:playlist:")
        || uri.starts_with("spotify:album:")
        || uri.starts_with("spotify:artist:")
        || uri.starts_with("spotify:show:")
        || uri.starts_with("spotify:search:")
        || uri.starts_with("spotify:collection:")
        || uri.contains(":collection")
        || (uri.starts_with("spotify:user:") && uri.contains(":playlist:"))
}

/// Playlists and albums have a remote linear catalog. Artist top tracks, liked
/// songs and search results are local lists we already seeded — fetching
/// `get_context` for those replaces the queue with a different Spotify order.
#[must_use]
pub(crate) fn context_owns_remote_queue(uri: &str) -> bool {
    let uri = uri.trim();
    if uri.contains(":collection") {
        return false;
    }
    uri.contains(":playlist:") || uri.starts_with("spotify:album:")
}

#[must_use]
pub(crate) fn load_request_options(
    shuffle: bool,
    repeat: RepeatMode,
    playing_track: Option<&str>,
) -> LoadRequestOptions {
    LoadRequestOptions {
        start_playing: true,
        seek_to: 0,
        context_options: Some(LoadContextOptions::Options(Options {
            shuffle,
            repeat: repeat == RepeatMode::All,
            repeat_track: repeat == RepeatMode::One,
        })),
        playing_track: playing_track
            .map(str::trim)
            .filter(|uri| !uri.is_empty())
            .map(|uri| PlayingTrack::Uri(uri.to_string())),
    }
}

pub(crate) fn apply_queue_reorder(
    items: &mut Vec<QueueItem>,
    request: &QueueReorderRequest,
) -> Result<(), String> {
    let moved_index = items
        .iter()
        .position(|entry| queue_item_matches(entry, &request.moved))
        .ok_or_else(|| "Der verschobene Queue-Eintrag fehlt.".to_string())?;
    let anchor_index = items
        .iter()
        .position(|entry| queue_item_matches(entry, &request.anchor))
        .ok_or_else(|| "Der Queue-Anker fehlt.".to_string())?;
    if moved_index == anchor_index {
        return Err("Verschobener Eintrag und Anker müssen verschieden sein.".into());
    }

    let moved = items.remove(moved_index);
    let anchor_index = if moved_index < anchor_index {
        anchor_index.saturating_sub(1)
    } else {
        anchor_index
    };
    let insertion_index = match request.placement {
        QueuePlacement::Before => anchor_index,
        QueuePlacement::After => anchor_index.saturating_add(1),
    };
    let insertion_index = insertion_index.min(items.len());
    items.insert(insertion_index, moved);
    Ok(())
}

fn queue_item_matches(item: &QueueItem, reference: &QueueItemReference) -> bool {
    match reference.uid.as_deref() {
        Some(uid) => item.uid.as_deref() == Some(uid),
        None => item.item.uri == reference.uri,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_core::{MediaCreator, MediaItem, MediaItemType, MediaSource};

    fn track(uri: &str, title: &str) -> MediaItem {
        MediaItem {
            uri: uri.to_string(),
            source: MediaSource::Spotify,
            item_type: MediaItemType::Track,
            title: title.to_string(),
            creators: vec![MediaCreator {
                name: "Kavinsky".into(),
                uri: None,
            }],
            album_name: Some("OutRun".into()),
            album_uri: None,
            duration_ms: Some(180_000),
            play_count: None,
            cover_uri: None,
            canvas_url: None,
            added_at: None,
            playlist_entry_id: None,
            added_by: None,
            explicit: false,
            playable: true,
        }
    }

    fn queued(uri: &str, title: &str, uid: &str) -> QueueItem {
        QueueItem {
            item: track(uri, title),
            uid: Some(uid.to_string()),
        }
    }

    #[test]
    fn random_context_start_stays_inside_the_playlist() {
        let uris = vec![
            "spotify:track:one".into(),
            "spotify:track:two".into(),
            "spotify:track:three".into(),
        ];
        assert_eq!(
            pick_random_context_start(&uris, 0),
            Some("spotify:track:one")
        );
        assert_eq!(
            pick_random_context_start(&uris, 4),
            Some("spotify:track:two")
        );
        assert_eq!(pick_random_context_start(&[], 9), None);
    }

    #[test]
    fn playlist_play_without_a_track_stays_linear_when_shuffle_is_off() {
        assert!(!should_pick_random_context_start(None, false));
        assert!(!should_pick_random_context_start(Some(""), false));
        assert!(!should_pick_random_context_start(
            Some("spotify:playlist:abc"),
            false
        ));
        assert!(should_pick_random_context_start(None, true));
        assert!(should_pick_random_context_start(Some(""), true));
        assert!(!should_pick_random_context_start(
            Some("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"),
            true
        ));
    }

    #[test]
    fn playlist_uris_are_contexts_not_playable_items() {
        assert!(is_context_uri("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"));
        assert!(is_context_uri("spotify:album:outrun"));
        assert!(is_context_uri("spotify:user:me:collection"));
        assert!(is_context_uri("spotify:user:me:playlist:mine"));
        assert!(!is_context_uri("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"));
        assert!(context_owns_remote_queue(
            "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        ));
        assert!(context_owns_remote_queue("spotify:album:outrun"));
        assert!(context_owns_remote_queue("spotify:user:me:playlist:mine"));
        assert!(!context_owns_remote_queue("spotify:artist:kavinsky"));
        assert!(!context_owns_remote_queue("spotify:user:me:collection"));
        assert!(is_playable_item_uri("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"));
        assert!(!is_playable_item_uri(
            "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        ));
    }

    #[test]
    fn playable_item_uris_require_valid_spotify_ids() {
        assert!(is_playable_item_uri("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"));
        assert!(is_playable_item_uri(
            "spotify:episode:3n3Ppam7vgaVa1iaRUc9Lp"
        ));
        assert!(!is_playable_item_uri(
            "spotify:local:Artist:Album:Track:127"
        ));
        assert!(!is_playable_item_uri("spotify:track:123"));
        assert!(!is_playable_item_uri(
            "spotify:episode:3n3Ppam7vgaVa1iaRUc9L!"
        ));
        assert!(!is_playable_item_uri(
            "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp?context=playlist"
        ));
        assert!(!is_playable_item_uri(
            "spotify:local:Artist:Album:Track:not-a-duration"
        ));
    }

    #[test]
    fn load_options_keep_shuffle_and_repeat_on_a_new_context() {
        let options = load_request_options(true, RepeatMode::All, Some("spotify:track:nightcall"));
        let Some(LoadContextOptions::Options(flags)) = options.context_options else {
            panic!("load must pass shuffle/repeat into the new context");
        };
        assert!(flags.shuffle);
        assert!(flags.repeat);
        assert!(!flags.repeat_track);
        assert!(
            matches!(options.playing_track, Some(PlayingTrack::Uri(uri)) if uri == "spotify:track:nightcall")
        );
    }

    #[test]
    fn load_options_map_repeat_one_without_context_repeat() {
        let options = load_request_options(false, RepeatMode::One, None);
        let Some(LoadContextOptions::Options(flags)) = options.context_options else {
            panic!("repeat one must be part of the load options");
        };
        assert!(!flags.shuffle);
        assert!(!flags.repeat);
        assert!(flags.repeat_track);
        assert!(options.playing_track.is_none());
    }

    #[test]
    fn queue_reorder_moves_an_item_before_the_anchor() {
        let mut items = vec![
            queued("spotify:track:one", "One", "q1"),
            queued("spotify:track:two", "Two", "q2"),
            queued("spotify:track:three", "Three", "q3"),
        ];
        apply_queue_reorder(
            &mut items,
            &QueueReorderRequest {
                moved: QueueItemReference {
                    uri: "spotify:track:three".into(),
                    uid: Some("q3".into()),
                },
                anchor: QueueItemReference {
                    uri: "spotify:track:one".into(),
                    uid: Some("q1".into()),
                },
                placement: QueuePlacement::Before,
                expected_revision: 3,
            },
        )
        .expect("reorder");
        assert_eq!(
            items
                .iter()
                .map(|entry| entry.item.title.as_str())
                .collect::<Vec<_>>(),
            ["Three", "One", "Two"]
        );
    }
}
