use super::*;

fn playing_at(position_ms: u64) -> PresenceUpdate {
    PresenceUpdate {
        online: true,
        track: TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"),
        is_playing: true,
        room: None,
        away: false,
        position_ms: Some(position_ms),
        app_version: None,
        app_platform: None,
    }
}

async fn share_listening(store: &Store, user: &SocialRegistration) {
    let options = SocialOptions { share_listening: true, ..Default::default() };
    store.action(&user.snapshot.me.id, SocialAction::UpdateOptions { options }).await.unwrap();
}

#[tokio::test]
async fn friends_listen_along_with_what_is_shared_and_are_seen() {
    let store = Store::memory().await;
    let host = user(&store, "Host").await;
    let friend = user(&store, "Friend").await;
    let stranger = user(&store, "Stranger").await;
    befriend(&store, &host, &friend).await;
    let (host_id, friend_id) = (&host.snapshot.me.id, &friend.snapshot.me.id);

    // Without shared listening, a follower sees no track and no position.
    store.update_presence(host_id, playing_at(42_000)).await.unwrap();
    let hidden = store.listen_along(friend_id, host_id).await.unwrap();
    assert!(hidden.presence.track.is_none() && hidden.presence.position_ms.is_none());
    assert!(store.snapshot(host_id).await.unwrap().listeners.is_empty());

    share_listening(&store, &host).await;
    store.update_presence(host_id, playing_at(42_000)).await.unwrap();
    let state = store.listen_along(friend_id, host_id).await.unwrap();
    assert_eq!(state.presence.position_ms, Some(42_000));
    assert!(state.presence.position_at_ms.is_some_and(|at| at <= state.server_time_ms));
    assert_eq!(store.snapshot(host_id).await.unwrap().listeners, vec![friend_id.clone()]);
    // The position also reaches the friends list, only with the track.
    assert_eq!(store.snapshot(friend_id).await.unwrap().friends[0].presence.position_ms, Some(42_000));

    assert_eq!(store.listen_along(&stranger.snapshot.me.id, host_id).await.unwrap_err().code, "notFriends");
    assert_eq!(store.listen_along(host_id, host_id).await.unwrap_err().code, "invalidRequest");

    store.stop_listening_along(friend_id, host_id).await;
    assert!(store.snapshot(host_id).await.unwrap().listeners.is_empty());

    // A follower who stops asking is forgotten.
    store.listen_along(friend_id, host_id).await.unwrap();
    store.listeners.lock().await.get_mut(host_id.as_str()).unwrap().insert(friend_id.clone(), 0);
    assert!(store.snapshot(host_id).await.unwrap().listeners.is_empty());
    store.forget_old_listeners().await;
    assert!(store.listeners.lock().await.is_empty());
}

#[tokio::test]
async fn listening_without_online_badge_works_but_invisible_and_private_do_not() {
    let store = Store::memory().await;
    let host = user(&store, "Host").await;
    let friend = user(&store, "Friend").await;
    befriend(&store, &host, &friend).await;
    let (host_id, friend_id) = (&host.snapshot.me.id, &friend.snapshot.me.id);
    let mut options = SocialOptions { share_listening: true, share_online: false, ..Default::default() };
    store.action(host_id, SocialAction::UpdateOptions { options: options.clone() }).await.unwrap();
    store.update_presence(host_id, playing_at(42_000)).await.unwrap();
    let shared = store.listen_along(friend_id, host_id).await.unwrap();
    assert!(!shared.presence.online);
    assert!(shared.presence.track.is_some());
    assert_eq!(store.snapshot(host_id).await.unwrap().listeners, vec![friend_id.clone()]);

    options.presence_mode = luft_listen_together::social::PresenceMode::Invisible;
    store.action(host_id, SocialAction::UpdateOptions { options: options.clone() }).await.unwrap();
    assert!(store.listen_along(friend_id, host_id).await.unwrap().presence.track.is_none());
    assert!(store.snapshot(host_id).await.unwrap().listeners.is_empty());

    options.presence_mode = luft_listen_together::social::PresenceMode::Auto;
    options.share_online = true;
    options.share_listening = false;
    store.action(host_id, SocialAction::UpdateOptions { options }).await.unwrap();
    assert!(store.listen_along(friend_id, host_id).await.unwrap().presence.position_ms.is_none());
    assert!(store.snapshot(host_id).await.unwrap().listeners.is_empty());
}

#[tokio::test]
async fn listening_can_be_hidden_from_one_friend() {
    let store = Store::memory().await;
    let host = user(&store, "Host").await;
    let hidden_from = user(&store, "Hidden").await;
    let other = user(&store, "Other").await;
    befriend(&store, &host, &hidden_from).await;
    befriend(&store, &host, &other).await;
    let (host_id, hidden_id, other_id) = (&host.snapshot.me.id, &hidden_from.snapshot.me.id, &other.snapshot.me.id);
    share_listening(&store, &host).await;
    store.update_presence(host_id, playing_at(10_000)).await.unwrap();
    store.listen_along(hidden_id, host_id).await.unwrap();
    assert_eq!(store.snapshot(host_id).await.unwrap().listeners, vec![hidden_id.clone()]);

    let hide = |hidden| SocialAction::SetListeningHidden { profile_id: hidden_id.clone(), hidden };
    let mine = store.action(host_id, hide(true)).await.unwrap();
    assert!(mine.friends.iter().any(|entry| entry.profile.id == *hidden_id && entry.listening_hidden));
    assert!(mine.listeners.is_empty(), "listening along ends at once");

    // The one friend sees no track, no history and cannot follow; still online.
    let seen = store.snapshot(hidden_id).await.unwrap().friends.remove(0);
    assert!(seen.presence.online && seen.presence.track.is_none() && seen.recent.is_empty() && !seen.listening_hidden);
    assert!(store.listen_along(hidden_id, host_id).await.unwrap().presence.track.is_none());
    // Everyone else still does.
    let other_view = store.snapshot(other_id).await.unwrap();
    assert!(other_view.friends.iter().find(|entry| entry.profile.id == *host_id).unwrap().presence.track.is_some());

    store.action(host_id, hide(false)).await.unwrap();
    assert!(store.snapshot(hidden_id).await.unwrap().friends[0].presence.track.is_some());
    assert_eq!(store.action(other_id, SocialAction::SetListeningHidden { profile_id: hidden_id.clone(), hidden: true }).await.unwrap_err().code, "notFriends");
}
