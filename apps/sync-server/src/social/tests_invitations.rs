use super::*;

#[tokio::test]
async fn invitations_require_friend_permission_and_live_private_room_proof() {
    let state = Arc::new(SocialState {
        store: Store::memory().await,
        hub: Arc::new(crate::hub::AppHub::new()),
        rate: rate::RateBudgets::default(),
        remote: remote::RemoteHub::default(),
    });
    let one = user(&state.store, "One").await;
    let two = user(&state.store, "Two").await;
    let outsider = user(&state.store, "Outsider").await;
    befriend(&state.store, &one, &two).await;
    let HubEvent::Created {
        room, resume_token, ..
    } = state
        .hub
        .apply(|hub| hub.create_room("member", "One"))
        .await
        .unwrap()
    else {
        panic!("room");
    };
    let invite = |token: String| SocialAction::Invite {
        profile_id: two.snapshot.me.id.clone(),
        join_code: room.code.clone(),
        room_token: token,
    };
    assert_eq!(
        action(
            State(state.clone()),
            headers(&one.token),
            Json(invite("wrong".into()))
        )
        .await
        .unwrap_err()
        .code,
        "roomUnavailable"
    );
    let outsider_invite = SocialAction::Invite {
        profile_id: outsider.snapshot.me.id,
        join_code: room.code.clone(),
        room_token: resume_token.clone(),
    };
    assert_eq!(
        action(
            State(state.clone()),
            headers(&one.token),
            Json(outsider_invite)
        )
        .await
        .unwrap_err()
        .code,
        "notFriends"
    );
    let _ = action(
        State(state.clone()),
        headers(&one.token),
        Json(invite(resume_token.clone())),
    )
    .await
    .unwrap();
    assert_eq!(
        state
            .store
            .snapshot(&two.snapshot.me.id)
            .await
            .unwrap()
            .invitations
            .len(),
        1
    );
    let _ = action(
        State(state.clone()),
        headers(&one.token),
        Json(invite(resume_token.clone())),
    )
    .await
    .unwrap();
    assert_eq!(
        state
            .store
            .snapshot(&two.snapshot.me.id)
            .await
            .unwrap()
            .invitations
            .len(),
        1
    );
    state
        .store
        .action(
            &two.snapshot.me.id,
            SocialAction::UpdateOptions {
                options: SocialOptions {
                    allow_invites: false,
                    ..Default::default()
                },
            },
        )
        .await
        .unwrap();
    assert!(
        state
            .store
            .snapshot(&two.snapshot.me.id)
            .await
            .unwrap()
            .invitations
            .is_empty()
    );
    assert_eq!(
        action(
            State(state.clone()),
            headers(&one.token),
            Json(invite(resume_token))
        )
        .await
        .unwrap_err()
        .code,
        "invitesDisabled"
    );
}

#[tokio::test]
async fn relationships_survive_restart_but_rooms_and_presence_do_not() {
    let path = std::env::temp_dir().join(format!(
        "luftify-social-test-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let store = Store::open(&path).await.unwrap();
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    befriend(&store, &one, &two).await;
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::Invite {
                profile_id: two.snapshot.me.id.clone(),
                join_code: generate_join_code(),
                room_token: "test-handler-proof".into(),
            },
        )
        .await
        .unwrap();
    store
        .update_presence(
            &one.snapshot.me.id,
            PresenceUpdate {
                online: true,
                track: None,
                is_playing: false,
                room: None,
        away: false,
        position_ms: None,
        app_version: None,
        app_platform: None,
            },
        )
        .await
        .unwrap();
    store.pool.close().await;
    drop(store);
    let reopened = Store::open(&path).await.unwrap();
    assert_eq!(
        reopened.authenticate(&headers(&one.token)).await.unwrap(),
        one.snapshot.me.id
    );
    let snapshot = reopened.snapshot(&two.snapshot.me.id).await.unwrap();
    assert_eq!(snapshot.friends.len(), 1);
    assert!(!snapshot.friends[0].presence.online);
    assert!(snapshot.invitations.is_empty());
    reopened.pool.close().await;
    drop(reopened);
    for file in [
        path.clone(),
        path.with_extension("sqlite-wal"),
        path.with_extension("sqlite-shm"),
    ] {
        let _ = std::fs::remove_file(file);
    }
}
