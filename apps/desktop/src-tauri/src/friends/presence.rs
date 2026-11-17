use luft_core::{MediaSource, PlaybackState};
use luft_listen_together::{PresenceUpdate, SocialOptions, TrackRef};

pub(super) fn presence(
    options: &SocialOptions,
    playback: Option<&PlaybackState>,
) -> PresenceUpdate {
    let mut result = PresenceUpdate {
        // This describes a live session. The server applies share_online separately.
        online: true,
        track: None,
        is_playing: false,
        away: false,
        room: None,
        position_ms: None,
        app_version: None,
        app_platform: None,
    };
    if !options.share_listening {
        return result;
    }
    let Some(playback) = playback else {
        return result;
    };
    let Some(item) = playback
        .current_item
        .as_ref()
        .filter(|item| item.source == MediaSource::Spotify && item.uri.starts_with("spotify:"))
    else {
        return result;
    };
    if let Some(mut track) = TrackRef::new("spotify", &item.uri) {
        track.title = Some(item.title.clone());
        track.artists = item
            .creators
            .iter()
            .map(|creator| creator.name.clone())
            .collect();
        track.cover_uri = item.cover_uri.clone();
        track.duration_ms = item.duration_ms;
        result.track = track.sanitize();
        result.is_playing = playback.is_playing;
        result.position_ms = result.track.is_some().then_some(playback.position_ms);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_disconnected_sessions_publish_no_track() {
        let mut options = SocialOptions::default();
        let private = presence(&options, None);
        assert!(private.online);
        assert!(private.track.is_none());
        options.share_online = false;
        options.share_listening = true;
        let missing = presence(&options, None);
        assert!(missing.online);
        assert!(!missing.is_playing);
        assert!(missing.track.is_none());
    }

    fn playback(uri: &str, source: &str) -> PlaybackState {
        serde_json::from_value(serde_json::json!({
            "currentItem": { "uri": uri, "source": source, "itemType": "track",
                "title": "A song", "creators": [{ "name": "An artist" }],
                "coverUri": "https://example.com/cover.jpg", "explicit": false, "playable": true },
            "isPlaying": true, "positionMs": 0, "durationMs": 180000, "volume": 0.5,
            "isMuted": false, "shuffleEnabled": false, "repeatMode": "off",
            "isSaved": false, "updatedAt": "2026-09-30T12:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn listening_privacy_is_independent_of_online_badge_and_local_files_are_never_shared() {
        let mut options = SocialOptions {
            share_online: false,
            share_listening: true,
            ..SocialOptions::default()
        };
        let spotify = playback("spotify:track:example", "spotify");
        let shared = presence(&options, Some(&spotify));
        assert!(shared.online);
        assert!(shared.is_playing);
        assert_eq!(shared.track.unwrap().uri, "spotify:track:example");
        options.share_listening = false;
        assert!(presence(&options, Some(&spotify)).track.is_none());
        options.share_listening = true;
        let local = playback("C:/Private/Music/example.mp3", "local");
        assert!(presence(&options, Some(&local)).track.is_none());
    }
}
