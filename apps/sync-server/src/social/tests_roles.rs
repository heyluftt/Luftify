use luft_listen_together::social::SocialRole;

use super::*;

fn share_listening() -> SocialAction {
    SocialAction::UpdateOptions {
        options: SocialOptions {
            share_listening: true,
            ..Default::default()
        },
    }
}

fn playing(uri: &str) -> PresenceUpdate {
    PresenceUpdate {
        online: true,
        track: TrackRef::new("spotify", uri),
        is_playing: true,
        room: None,
        away: false,
        position_ms: None,
        app_version: None,
        app_platform: None,
    }
}

#[tokio::test]
async fn only_luft_grants_roles_and_only_to_friends() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let friend = user(&store, "Friend").await;
    let stranger = user(&store, "Stranger").await;
    befriend(&store, &luft, &friend).await;
    let grant = |id: &str, enabled| SocialAction::SetRole {
        profile_id: id.into(),
        role: SocialRole::Heart,
        enabled,
    };
    // Nobody is Luft before the configured code is confirmed.
    let denied = store.action(&luft.snapshot.me.id, grant(&friend.snapshot.me.id, true)).await.unwrap_err();
    assert_eq!(denied.code, "notAllowed");
    assert!(store.grant_owner(&luft.snapshot.me.friend_code.to_lowercase()).await.unwrap());
    assert!(!store.grant_owner("LF-NOBODY").await.unwrap());

    let me = store.action(&luft.snapshot.me.id, grant(&friend.snapshot.me.id, true)).await.unwrap();
    assert_eq!(me.me.roles, vec![SocialRole::Luft]);
    assert_eq!(me.friends[0].profile.roles, vec![SocialRole::Heart]);
    assert!(me.friends[0].since_ms.is_some());
    let seen = store.snapshot(&friend.snapshot.me.id).await.unwrap();
    assert_eq!(seen.me.roles, vec![SocialRole::Heart]);
    assert_eq!(seen.friends[0].profile.roles, vec![SocialRole::Luft]);

    let not_friends = store.action(&luft.snapshot.me.id, grant(&stranger.snapshot.me.id, true)).await.unwrap_err();
    assert_eq!(not_friends.code, "notFriends");
    let luft_role = SocialAction::SetRole {
        profile_id: friend.snapshot.me.id.clone(),
        role: SocialRole::Luft,
        enabled: true,
    };
    assert_eq!(store.action(&luft.snapshot.me.id, luft_role).await.unwrap_err().code, "invalidRole");
    // Other role holders cannot pass roles on.
    let passed = store.action(&friend.snapshot.me.id, grant(&luft.snapshot.me.id, true)).await.unwrap_err();
    assert_eq!(passed.code, "notAllowed");

    // Taking a role back works even after the friendship ended.
    store
        .action(&luft.snapshot.me.id, SocialAction::RemoveFriend { profile_id: friend.snapshot.me.id.clone() })
        .await
        .unwrap();
    store.action(&luft.snapshot.me.id, grant(&friend.snapshot.me.id, false)).await.unwrap();
    assert!(store.snapshot(&friend.snapshot.me.id).await.unwrap().me.roles.is_empty());
}

#[tokio::test]
async fn luft_chooses_a_custom_code_that_others_can_use() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let other = user(&store, "Other").await;
    let set = |code: &str| SocialAction::SetFriendCode { code: code.into() };
    assert_eq!(store.action(&other.snapshot.me.id, set("OTHER")).await.unwrap_err().code, "notAllowed");
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();
    assert_eq!(store.action(&luft.snapshot.me.id, set("a b")).await.unwrap_err().code, "invalidCode");
    assert_eq!(
        store.action(&luft.snapshot.me.id, set(&other.snapshot.me.friend_code)).await.unwrap_err().code,
        "codeTaken"
    );
    let me = store.action(&luft.snapshot.me.id, set("luft")).await.unwrap();
    assert_eq!(me.me.friend_code, "LF-LUFT");
    // The role stays with the profile, not with the configured code.
    assert!(!store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap());
    assert_eq!(me.me.roles, vec![SocialRole::Luft]);

    store
        .action(&other.snapshot.me.id, SocialAction::Request { friend_code: "lf-luft".into() })
        .await
        .unwrap();
    assert_eq!(store.snapshot(&luft.snapshot.me.id).await.unwrap().incoming_requests.len(), 1);
    assert_eq!(store.search(&other.snapshot.me.id, "LF-LUFT").await.unwrap()[0].id, luft.snapshot.me.id);
}

#[tokio::test]
async fn recent_tracks_are_shared_only_while_listening_is_shared() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    befriend(&store, &one, &two).await;
    let id = &one.snapshot.me.id;
    store.update_presence(id, playing("spotify:track:hidden")).await.unwrap();
    store.action(id, share_listening()).await.unwrap();
    for uri in ["spotify:track:a", "spotify:track:a", "spotify:track:b", "spotify:track:a"] {
        store.update_presence(id, playing(uri)).await.unwrap();
    }
    let recent = store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].recent.clone();
    let uris: Vec<_> = recent.iter().map(|entry| entry.track.uri.as_str()).collect();
    assert_eq!(uris, ["spotify:track:a", "spotify:track:b"]);
    // The owner sees the same list on their own profile.
    assert_eq!(store.snapshot(id).await.unwrap().recent.len(), 2);

    store
        .action(id, SocialAction::UpdateOptions { options: SocialOptions::default() })
        .await
        .unwrap();
    assert!(store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].recent.is_empty());
    store.action(id, share_listening()).await.unwrap();
    assert!(store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].recent.is_empty());
}

#[tokio::test]
async fn overview_lists_role_holders() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let tester = user(&store, "Tester").await;
    befriend(&store, &luft, &tester).await;
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();
    store
        .action(
            &luft.snapshot.me.id,
            SocialAction::SetRole { profile_id: tester.snapshot.me.id.clone(), role: SocialRole::Tester, enabled: true },
        )
        .await
        .unwrap();
    store.update_presence(&tester.snapshot.me.id, playing("spotify:track:a")).await.unwrap();
    let overview = store.overview().await.unwrap();
    assert_eq!((overview.profiles, overview.online, overview.listening), (2, 1, 0));
    assert_eq!(overview.team.len(), 2);
}

#[tokio::test]
async fn luft_creates_gives_and_deletes_badges_and_everyone_sets_a_bio() {
    use luft_listen_together::BadgeDefinition;
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let friend = user(&store, "Friend").await;
    befriend(&store, &luft, &friend).await;
    let badge = |label: &str| SocialAction::SaveBadge {
        badge: BadgeDefinition { id: String::new(), label: label.into(), icon: "music".into(), color: "gold".into() },
    };
    assert_eq!(store.action(&friend.snapshot.me.id, badge("DJ")).await.unwrap_err().code, "notAllowed");
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();
    let invalid = SocialAction::SaveBadge {
        badge: BadgeDefinition { id: String::new(), label: "DJ".into(), icon: "skull".into(), color: "gold".into() },
    };
    assert_eq!(store.action(&luft.snapshot.me.id, invalid).await.unwrap_err().code, "invalidBadge");
    let snapshot = store.action(&luft.snapshot.me.id, badge("DJ")).await.unwrap();
    let id = snapshot.badges[0].id.clone();
    let give = |enabled| SocialAction::SetBadge { profile_id: friend.snapshot.me.id.clone(), badge_id: id.clone(), enabled };
    store.action(&luft.snapshot.me.id, give(true)).await.unwrap();
    let seen = store.snapshot(&friend.snapshot.me.id).await.unwrap();
    assert_eq!(seen.me.badges, vec![id.clone()]);
    assert_eq!(seen.badges[0].label, "DJ");

    store
        .action(&friend.snapshot.me.id, SocialAction::SetBio { bio: Some("  Nur Jazz heute ".into()) })
        .await
        .unwrap();
    assert_eq!(store.snapshot(&luft.snapshot.me.id).await.unwrap().friends[0].profile.bio.as_deref(), Some("Nur Jazz heute"));
    let long = SocialAction::SetBio { bio: Some("x".repeat(81)) };
    assert_eq!(store.action(&friend.snapshot.me.id, long).await.unwrap_err().code, "invalidBio");

    store.action(&luft.snapshot.me.id, SocialAction::DeleteBadge { id }).await.unwrap();
    let after = store.snapshot(&friend.snapshot.me.id).await.unwrap();
    assert!(after.badges.is_empty());
    assert!(after.me.badges.is_empty());
}

#[tokio::test]
async fn everyone_styles_their_profile_and_pins_a_song() {
    use luft_listen_together::ProfileStyle;
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    befriend(&store, &one, &two).await;
    let id = &one.snapshot.me.id;
    let style = ProfileStyle { accent: "rose".into(), banner: "cover".into(), effect: "stars".into(), emoji: Some("🎧".into()), ..Default::default() };
    store.action(id, SocialAction::SetStyle { style: Some(style.clone()) }).await.unwrap();
    let invalid = ProfileStyle { accent: "neon".into(), banner: "aurora".into(), ..Default::default() };
    assert_eq!(store.action(id, SocialAction::SetStyle { style: Some(invalid) }).await.unwrap_err().code, "invalidStyle");
    let mut song = TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap();
    song.title = Some("Song".into());
    store.action(id, SocialAction::SetFavorite { track: Some(song) }).await.unwrap();
    let bad = TrackRef::new("spotify", "spotify:episode:nope").unwrap();
    assert_eq!(store.action(id, SocialAction::SetFavorite { track: Some(bad) }).await.unwrap_err().code, "invalidTrack");

    let seen = store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].profile.clone();
    assert_eq!(seen.style, Some(style));
    assert_eq!(seen.favorite.unwrap().title.as_deref(), Some("Song"));
    store.action(id, SocialAction::SetStyle { style: None }).await.unwrap();
    store.action(id, SocialAction::SetFavorite { track: None }).await.unwrap();
    let cleared = store.snapshot(id).await.unwrap().me;
    assert!(cleared.style.is_none() && cleared.favorite.is_none());
}

#[tokio::test]
async fn only_owned_badges_can_be_shown() {
    use luft_listen_together::ProfileStyle;
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let id = &one.snapshot.me.id;
    let look = |keys: &[&str]| ProfileStyle {
        accent: "rose".into(), banner: "".into(),
        shown_badges: Some(keys.iter().map(|key| key.to_string()).collect()), ..Default::default()
    };
    assert_eq!(store.action(id, SocialAction::SetStyle { style: Some(look(&["role:tester"])) }).await.unwrap_err().code, "invalidStyle");
    sqlx::query("UPDATE profiles SET roles = 'tester', badges = 'b1' WHERE id = ?").bind(id).execute(&store.pool).await.unwrap();
    store.action(id, SocialAction::SetStyle { style: Some(look(&["badge:b1", "role:tester"])) }).await.unwrap();
    assert_eq!(store.snapshot(id).await.unwrap().me.style.unwrap().shown_badges.unwrap(), ["badge:b1", "role:tester"]);
    assert_eq!(store.action(id, SocialAction::SetStyle { style: Some(look(&["badge:b2"])) }).await.unwrap_err().code, "invalidStyle");
    // Showing none at all is a choice too.
    store.action(id, SocialAction::SetStyle { style: Some(look(&[])) }).await.unwrap();
}
