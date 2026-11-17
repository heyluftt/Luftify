use luft_listen_together::SharedPlaylist;

use super::*;

fn playlist(name: &str) -> SharedPlaylist {
    SharedPlaylist { uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into(), name: name.into(), cover_uri: None }
}

#[tokio::test]
async fn friends_receive_shared_playlists_until_dismissed() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let outsider = user(&store, "Outsider").await;
    let share = |to: &SocialRegistration, name: &str| SocialAction::SharePlaylist {
        profile_id: to.snapshot.me.id.clone(),
        playlist: playlist(name),
    };
    assert_eq!(store.action(&one.snapshot.me.id, share(&outsider, "Roadtrip")).await.unwrap_err().code, "notFriends");
    befriend(&store, &one, &two).await;
    let bad = SocialAction::SharePlaylist { profile_id: two.snapshot.me.id.clone(), playlist: playlist(" ") };
    assert_eq!(store.action(&one.snapshot.me.id, bad).await.unwrap_err().code, "invalidPlaylist");

    store.action(&one.snapshot.me.id, share(&two, "Roadtrip")).await.unwrap();
    store.action(&one.snapshot.me.id, share(&two, "Roadtrip 2")).await.unwrap();
    let shares = store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_shares;
    assert_eq!(shares.len(), 1, "sending again renews the one share");
    assert_eq!(shares[0].playlist.name, "Roadtrip 2");
    assert_eq!(shares[0].from.id, one.snapshot.me.id);
    assert!(store.snapshot(&one.snapshot.me.id).await.unwrap().playlist_shares.is_empty());

    // Only the recipient can dismiss it.
    let dismiss = SocialAction::DismissPlaylistShare { share_id: shares[0].id.clone() };
    store.action(&one.snapshot.me.id, dismiss.clone()).await.unwrap();
    assert_eq!(store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_shares.len(), 1);
    store.action(&two.snapshot.me.id, dismiss).await.unwrap();
    assert!(store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_shares.is_empty());

    // Ending the friendship takes waiting ones along.
    store.action(&one.snapshot.me.id, share(&two, "Roadtrip")).await.unwrap();
    store.action(&two.snapshot.me.id, SocialAction::RemoveFriend { profile_id: one.snapshot.me.id.clone() }).await.unwrap();
    befriend(&store, &one, &two).await;
    assert!(store.snapshot(&two.snapshot.me.id).await.unwrap().playlist_shares.is_empty());
}
