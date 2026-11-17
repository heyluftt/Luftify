use super::*;

#[tokio::test]
async fn presence_is_friends_only_opt_in_and_expires() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let outsider = user(&store, "Outside").await;
    befriend(&store, &one, &two).await;
    let update = PresenceUpdate {
        online: true,
        track: TrackRef::new("spotify", "spotify:track:one"),
        is_playing: true,
        room: None,
        away: false,
        position_ms: None,
        app_version: None,
        app_platform: None,
    };
    store
        .update_presence(&one.snapshot.me.id, update.clone())
        .await
        .unwrap();
    assert!(
        store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0]
            .presence
            .track
            .is_none()
    );
    assert!(
        store
            .snapshot(&outsider.snapshot.me.id)
            .await
            .unwrap()
            .friends
            .is_empty()
    );
    let mut options = SocialOptions {
        share_listening: true,
        ..Default::default()
    };
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::UpdateOptions {
                options: options.clone(),
            },
        )
        .await
        .unwrap();
    store
        .update_presence(&one.snapshot.me.id, update.clone())
        .await
        .unwrap();
    assert!(
        store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0]
            .presence
            .track
            .is_some()
    );
    options.share_listening = false;
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::UpdateOptions {
                options: options.clone(),
            },
        )
        .await
        .unwrap();
    assert!(
        store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0]
            .presence
            .track
            .is_none()
    );
    options.share_listening = true;
    options.share_online = false;
    store
        .action(&one.snapshot.me.id, SocialAction::UpdateOptions { options })
        .await
        .unwrap();
    store
        .update_presence(&one.snapshot.me.id, update.clone())
        .await
        .unwrap();
    let presence = store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0]
        .presence
        .clone();
    assert!(!presence.online);
    assert!(presence.is_playing);
    store
        .update_presence(
            &one.snapshot.me.id,
            PresenceUpdate {
                is_playing: false,
                ..update.clone()
            },
        )
        .await
        .unwrap();
    assert!(
        store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0]
            .presence
            .track
            .is_none()
    );
    store
        .update_presence(&one.snapshot.me.id, update)
        .await
        .unwrap();
    store
        .presence
        .lock()
        .await
        .get_mut(&one.snapshot.me.id)
        .unwrap()
        .updated_at = server_now_ms() - 46_000;
    assert_eq!(
        store.snapshot(&two.snapshot.me.id).await.unwrap().friends[0].presence,
        Default::default()
    );
}
