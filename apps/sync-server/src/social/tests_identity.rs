use super::*;

#[tokio::test]
async fn tokens_are_private_and_registration_is_idempotent() {
    let store = Store::memory().await;
    let key = "a".repeat(64);
    let input = SocialProfileInput {
        display_name: "Sam".into(),
        avatar_uri: None,
    };
    let one = store
        .register_with_key(input.clone(), Some(&key))
        .await
        .unwrap();
    let again = store.register_with_key(input, Some(&key)).await.unwrap();
    assert_eq!(one.snapshot.me.id, again.snapshot.me.id);
    assert_eq!(one.token, key);
    assert_eq!(
        store.authenticate(&headers(&key)).await.unwrap(),
        one.snapshot.me.id
    );
    assert_eq!(
        store
            .authenticate(&headers(&"b".repeat(64)))
            .await
            .unwrap_err()
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        store
            .authenticate(&headers(&one.snapshot.me.friend_code))
            .await
            .unwrap_err()
            .code,
        "unauthorized"
    );
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM profiles")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_ne!(stored, key);
    let wire = serde_json::to_string(&one.snapshot).unwrap();
    assert!(!wire.contains(&key));
    assert!(!wire.contains("tokenHash"));
}

#[tokio::test]
async fn only_recipient_accepts_and_blocking_removes_both_sides() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let intruder = user(&store, "Other").await;
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::Request {
                friend_code: two.snapshot.me.friend_code.clone(),
            },
        )
        .await
        .unwrap();
    let request = store
        .snapshot(&two.snapshot.me.id)
        .await
        .unwrap()
        .incoming_requests[0]
        .id
        .clone();
    assert_eq!(
        store
            .action(
                &intruder.snapshot.me.id,
                SocialAction::RespondRequest {
                    request_id: request.clone(),
                    accept: true
                }
            )
            .await
            .unwrap_err()
            .code,
        "invalidRequest"
    );
    assert_eq!(
        store
            .action(
                &two.snapshot.me.id,
                SocialAction::CancelRequest {
                    request_id: request.clone()
                }
            )
            .await
            .unwrap_err()
            .code,
        "invalidRequest"
    );
    store
        .action(
            &two.snapshot.me.id,
            SocialAction::RespondRequest {
                request_id: request,
                accept: true,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .snapshot(&one.snapshot.me.id)
            .await
            .unwrap()
            .friends
            .len(),
        1
    );
    store
        .action(
            &two.snapshot.me.id,
            SocialAction::Block {
                profile_id: one.snapshot.me.id.clone(),
            },
        )
        .await
        .unwrap();
    assert!(
        store
            .snapshot(&one.snapshot.me.id)
            .await
            .unwrap()
            .friends
            .is_empty()
    );
    assert!(
        store
            .snapshot(&two.snapshot.me.id)
            .await
            .unwrap()
            .friends
            .is_empty()
    );
    assert_eq!(
        store
            .action(
                &one.snapshot.me.id,
                SocialAction::Request {
                    friend_code: two.snapshot.me.friend_code.clone()
                }
            )
            .await
            .unwrap_err()
            .code,
        "blocked"
    );
    assert!(
        store
            .search(&one.snapshot.me.id, "Two")
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        store
            .search(&two.snapshot.me.id, "One")
            .await
            .unwrap()
            .is_empty()
    );
    store
        .action(
            &two.snapshot.me.id,
            SocialAction::Unblock {
                profile_id: one.snapshot.me.id.clone(),
            },
        )
        .await
        .unwrap();
    assert!(
        store
            .snapshot(&two.snapshot.me.id)
            .await
            .unwrap()
            .friends
            .is_empty()
    );
}

#[tokio::test]
async fn search_is_literal_and_visibility_does_not_prevent_code_requests() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let sam = user(&store, "Sam_100%").await;
    user(&store, "Sam other").await;
    user(&store, "ÖZGÜR").await;
    assert_eq!(
        store
            .search(&one.snapshot.me.id, "özgür")
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store
            .search(&one.snapshot.me.id, "sam_100%")
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        store
            .search(&one.snapshot.me.id, "%%")
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        store
            .search(&one.snapshot.me.id, "a")
            .await
            .unwrap_err()
            .code,
        "invalidQuery"
    );
    assert_eq!(
        store
            .search(&one.snapshot.me.id, &sam.snapshot.me.friend_code)
            .await
            .unwrap()
            .len(),
        1
    );
    let options = SocialOptions {
        discoverable: false,
        ..Default::default()
    };
    store
        .action(
            &sam.snapshot.me.id,
            SocialAction::UpdateOptions { options },
        )
        .await
        .unwrap();
    assert!(
        store
            .search(&one.snapshot.me.id, &sam.snapshot.me.friend_code)
            .await
            .unwrap()
            .is_empty()
    );
    store
        .action(
            &one.snapshot.me.id,
            SocialAction::Request {
                friend_code: sam.snapshot.me.friend_code,
            },
        )
        .await
        .unwrap();
}
