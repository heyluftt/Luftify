use super::*;

#[tokio::test]
async fn playlist_account_keys_are_validated_and_only_visible_to_current_friends() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let stranger = user(&store, "Stranger").await;
    let id = &one.snapshot.me.id;
    for invalid in ["Spotify name".to_owned(), "z".repeat(64), "a".repeat(65)] {
        assert!(store.action(id, SocialAction::BindPlaylistAccount { account_key: invalid }).await.is_err());
    }
    let key = "a".repeat(64);
    let result = store.action(id, SocialAction::BindPlaylistAccount { account_key: key.clone() }).await.unwrap();
    assert_eq!(result.playlist_accounts.len(), 1);
    assert_eq!(result.playlist_accounts[0].account_key, key);
    assert!(store.snapshot(&stranger.snapshot.me.id).await.unwrap().playlist_accounts.is_empty());
    befriend(&store, &one, &two).await;
    let accounts = store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_accounts;
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].profile_id, *id);
    store.action(id, SocialAction::BindPlaylistAccount { account_key: "b".repeat(64) }).await.unwrap();
    assert_eq!(store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_accounts[0].account_key, "b".repeat(64));
    store.action(&two.snapshot.me.id, SocialAction::RemoveFriend { profile_id: id.clone() }).await.unwrap();
    assert!(store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_accounts.is_empty());
}
