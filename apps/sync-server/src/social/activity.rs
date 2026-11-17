//! What friends see of a session: online, away, do not disturb or offline,
//! the playing track and when the friend was last online.
use luft_listen_together::social::{Activity, FriendPresence, PresenceMode, SocialOptions};

/// `live` is the stored heartbeat, if it is still fresh. It keeps the raw
/// state (session running, idle, track); the friend's current options decide
/// what is shown, so changing a mode takes effect at once.
pub(super) fn visible_presence(options: &SocialOptions, live: Option<&FriendPresence>, last_seen: Option<i64>) -> FriendPresence {
    let invisible = options.presence_mode == PresenceMode::Invisible;
    let hidden = invisible || !options.share_online;
    // Listening is shared independently of the online badge, but never while invisible.
    let track = live
        .filter(|value| options.share_listening && !invisible && value.is_playing)
        .and_then(|value| value.track.clone());
    let online = live.is_some() && !hidden;
    let activity = match (online, options.presence_mode) {
        (false, _) => Activity::Offline,
        (true, PresenceMode::Busy) => Activity::Busy,
        (true, PresenceMode::Away) => Activity::Away,
        (true, _) if live.is_some_and(|value| value.activity == Activity::Away) && track.is_none() => Activity::Away,
        (true, _) => Activity::Online,
    };
    // The position belongs to the shared track and goes only with it.
    let position = live.filter(|_| track.is_some());
    FriendPresence {
        online,
        is_playing: track.is_some(),
        track,
        activity,
        last_seen_ms: if online || hidden { None } else { last_seen },
        position_ms: position.and_then(|value| value.position_ms),
        position_at_ms: position.and_then(|value| value.position_at_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_listen_together::TrackRef;

    fn live(away: bool, playing: bool) -> FriendPresence {
        FriendPresence {
            online: true,
            track: playing.then(|| TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap()),
            is_playing: playing,
            activity: if away { Activity::Away } else { Activity::Online },
            last_seen_ms: None,
            position_ms: playing.then_some(61_000),
            position_at_ms: playing.then_some(1),
        }
    }

    #[test]
    fn modes_and_idleness_decide_the_visible_activity() {
        let mut options = SocialOptions { share_listening: true, ..SocialOptions::default() };
        assert_eq!(visible_presence(&options, Some(&live(false, false)), None).activity, Activity::Online);
        assert_eq!(visible_presence(&options, Some(&live(true, false)), None).activity, Activity::Away);
        // Music playing is not away.
        assert_eq!(visible_presence(&options, Some(&live(true, true)), None).activity, Activity::Online);
        options.presence_mode = PresenceMode::Busy;
        assert_eq!(visible_presence(&options, Some(&live(false, true)), None).activity, Activity::Busy);
        options.presence_mode = PresenceMode::Away;
        assert_eq!(visible_presence(&options, Some(&live(false, false)), None).activity, Activity::Away);

        options.presence_mode = PresenceMode::Invisible;
        let hidden = visible_presence(&options, Some(&live(false, true)), Some(5));
        assert_eq!((hidden.online, hidden.activity, hidden.track.is_none(), hidden.last_seen_ms), (false, Activity::Offline, true, None));
    }

    #[test]
    fn last_seen_only_for_friends_sharing_their_online_status() {
        let mut options = SocialOptions::default();
        assert_eq!(visible_presence(&options, None, Some(42)).last_seen_ms, Some(42));
        assert_eq!(visible_presence(&options, Some(&live(false, false)), Some(42)).last_seen_ms, None);
        options.share_online = false;
        assert_eq!(visible_presence(&options, None, Some(42)).last_seen_ms, None);
    }
}
