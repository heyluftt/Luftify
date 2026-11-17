use luft_listen_together::admin::{Moderation, ServerSettings};

use super::*;

fn moderate(profile_id: &str, moderation: Moderation) -> SocialAction {
    SocialAction::Moderate { profile_id: profile_id.into(), moderation }
}

#[tokio::test]
async fn only_luft_sees_users_and_moderates_others() {
    let store = Store::memory().await;
    let luft = user(&store, "Luft").await;
    let tester = user(&store, "Tester").await;
    befriend(&store, &luft, &tester).await;
    let (luft_id, tester_id) = (&luft.snapshot.me.id, &tester.snapshot.me.id);
    assert_eq!(store.admin_overview(luft_id).await.unwrap_err().code, "notAllowed");
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();
    assert_eq!(store.admin_overview(tester_id).await.unwrap_err().code, "notAllowed");

    let mut update = PresenceUpdate { online: true, track: None, is_playing: false, away: false, position_ms: None, room: None, app_version: Some("0.1.12".into()), app_platform: None };
    store.update_presence(tester_id, update.clone()).await.unwrap();
    let overview = store.admin_overview(luft_id).await.unwrap();
    let seen = overview.users.iter().find(|entry| entry.profile.id == *tester_id).unwrap();
    assert!(seen.online && !seen.suspended);
    assert_eq!((seen.friends, seen.app_version.as_deref()), (1, Some("0.1.12")));
    // The phone reports its own version; nonsense and going offline keep the last one.
    store.update_presence(tester_id, PresenceUpdate { app_version: Some("0.2.3".into()), app_platform: Some("android".into()), ..update.clone() }).await.unwrap();
    update.app_version = Some("<script>".into());
    update.online = false;
    store.update_presence(tester_id, update).await.unwrap();
    let overview = store.admin_overview(luft_id).await.unwrap();
    let seen = overview.users.iter().find(|entry| entry.profile.id == *tester_id).unwrap();
    assert_eq!((seen.app_version.as_deref(), seen.phone_version.as_deref()), (Some("0.1.12"), Some("0.2.3")));

    // Others cannot moderate, and nobody moderates Luft.
    assert_eq!(store.action(tester_id, moderate(luft_id, Moderation::Suspend)).await.unwrap_err().code, "notAllowed");
    assert_eq!(store.action(luft_id, moderate(luft_id, Moderation::ClearProfile)).await.unwrap_err().code, "notAllowed");

    store.action(tester_id, SocialAction::SetBio { bio: Some("Hallo".into()) }).await.unwrap();
    store.action(luft_id, moderate(tester_id, Moderation::ClearProfile)).await.unwrap();
    let cleared = store.snapshot(tester_id).await.unwrap().me;
    assert!(cleared.bio.is_none() && cleared.display_name == "Tester");

    // A suspended profile is turned away until unsuspended.
    store.action(luft_id, moderate(tester_id, Moderation::Suspend)).await.unwrap();
    assert_eq!(store.authenticate(&headers(&tester.token)).await.unwrap_err().code, "suspended");
    assert!(store.admin_overview(luft_id).await.unwrap().users.iter().any(|entry| entry.profile.id == *tester_id && entry.suspended));
    store.action(luft_id, moderate(tester_id, Moderation::Unsuspend)).await.unwrap();
    assert_eq!(store.authenticate(&headers(&tester.token)).await.unwrap(), *tester_id);
}

#[tokio::test]
async fn luft_tools_log_switch_announce_and_back_up() {
    let directory = std::env::temp_dir().join(format!("luft-admin-{}", uuid::Uuid::new_v4().simple()));
    let store = Store::open(&directory.join("social.sqlite")).await.unwrap();
    let luft = user(&store, "Luft").await;
    let tester = user(&store, "Tester").await;
    befriend(&store, &luft, &tester).await;
    let (luft_id, tester_id) = (&luft.snapshot.me.id, &tester.snapshot.me.id);
    store.grant_owner(&luft.snapshot.me.friend_code).await.unwrap();

    // Only Luft changes the switches.
    let closed = ServerSettings { signups_open: false, announcement: Some("Update um 20 Uhr".into()) };
    let set = |settings: ServerSettings| SocialAction::SetServerSettings { settings };
    assert_eq!(store.action(tester_id, set(closed.clone())).await.unwrap_err().code, "notAllowed");
    store.action(luft_id, set(closed)).await.unwrap();
    assert_eq!(store.snapshot(tester_id).await.unwrap().announcement.as_deref(), Some("Update um 20 Uhr"));
    let input = SocialProfileInput { display_name: "Neu".into(), avatar_uri: None };
    assert_eq!(store.register(input.clone()).await.err().unwrap().code, "signupsClosed");
    store.action(luft_id, set(ServerSettings::default())).await.unwrap();
    assert!(store.register(input).await.is_ok());
    assert!(store.snapshot(tester_id).await.unwrap().announcement.is_none());

    store.action(luft_id, moderate(tester_id, Moderation::ResetName)).await.unwrap();
    assert!(store.snapshot(tester_id).await.unwrap().me.display_name.starts_with("Person "));

    let backup = store.backup(luft_id).await.unwrap();
    assert!(backup.starts_with(b"SQLite format 3"));
    assert_eq!(store.backup(luft_id).await.err().unwrap().code, "limitReached");
    assert_eq!(store.backup(tester_id).await.err().unwrap().code, "notAllowed");

    let overview = store.admin_overview(luft_id).await.unwrap();
    let actions: Vec<_> = overview.log.iter().map(|entry| entry.action.as_str()).collect();
    assert_eq!(actions[..5], ["backup", "resetName", "announcement", "signups", "announcement"]);
    // The name before the reset stays in the log.
    assert_eq!(overview.log[1].target.as_deref(), Some("Tester"));
    assert!(overview.server.database_bytes > 0 && overview.server.started_at_ms > 0);
    drop(store);
    let _ = std::fs::remove_dir_all(directory);
}
