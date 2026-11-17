use super::*;

fn playing(track: &str, is_playing: bool) -> PresenceUpdate {
    PresenceUpdate {
        online: true,
        track: TrackRef::new("spotify", track),
        is_playing,
        room: None,
        away: false,
        position_ms: None,
        app_version: None,
        app_platform: None,
    }
}

#[tokio::test]
async fn a_link_code_adds_a_second_device_and_the_playing_one_shows() {
    let store = Store::memory().await;
    let pc = user(&store, "Sam").await;
    let friend = user(&store, "Mika").await;
    befriend(&store, &pc, &friend).await;
    let id = pc.snapshot.me.id.clone();
    let phone_key = "e".repeat(64);
    store.action(&id, SocialAction::UpdateOptions { options: SocialOptions { share_listening: true, ..pc.snapshot.options.clone() } }).await.unwrap();

    let link = store.new_link_code(&id).await.unwrap();
    assert_eq!(store.redeem_link_code(&link.code, "Pixel", None).await.err().unwrap().code, "invalidProfile");
    // A failed attempt with a bad label does not use the code up.
    assert_eq!(store.redeem_link_code(&link.code, "", Some(&phone_key)).await.err().unwrap().code, "invalidDevice");
    let typed = link.code.to_lowercase().replace('-', "");
    let phone = store.redeem_link_code(&typed, "Pixel", Some(&phone_key)).await.unwrap();
    assert_eq!(phone.snapshot.me.id, id);
    assert_eq!(store.redeem_link_code(&link.code, "Pixel", Some(&"f".repeat(64))).await.err().unwrap().code, "invalidLinkCode");

    // Both stay signed in.
    let (main, main_device) = store.authenticate_device(&headers(&pc.token)).await.unwrap();
    let (other, phone_device) = store.authenticate_device(&headers(&phone_key)).await.unwrap();
    assert_eq!((main.as_str(), main_device.as_str()), (id.as_str(), "main"));
    assert_eq!(other, id);
    let devices = store.devices(&id, &phone_device).await.unwrap();
    assert_eq!(devices.len(), 1);
    assert!(devices[0].current && devices[0].label == "Pixel");

    // The phone plays; the idle PC does not hide it, and going offline on the PC keeps it.
    store.update_presence_from(&id, &phone_device, playing("spotify:track:phone", true)).await.unwrap();
    store.update_presence_from(&id, "main", playing("spotify:track:pc", false)).await.unwrap();
    let seen = |snapshot: SocialSnapshot| snapshot.friends[0].presence.track.as_ref().map(|t| t.uri.clone());
    assert_eq!(seen(store.snapshot(&friend.snapshot.me.id).await.unwrap()).as_deref(), Some("spotify:track:phone"));
    store.update_presence_from(&id, "main", PresenceUpdate { online: false, ..playing("spotify:track:pc", false) }).await.unwrap();
    assert_eq!(seen(store.snapshot(&friend.snapshot.me.id).await.unwrap()).as_deref(), Some("spotify:track:phone"));
    // Once the PC plays, it is the one friends see.
    store.update_presence_from(&id, "main", playing("spotify:track:pc", true)).await.unwrap();
    assert_eq!(seen(store.snapshot(&friend.snapshot.me.id).await.unwrap()).as_deref(), Some("spotify:track:pc"));

    // Removing the phone signs it out; its handle is not a secret but only works for its owner.
    assert_eq!(store.remove_device(&friend.snapshot.me.id, &devices[0].id).await.unwrap_err().code, "invalidDevice");
    store.remove_device(&id, &devices[0].id).await.unwrap();
    assert_eq!(store.authenticate(&headers(&phone_key)).await.unwrap_err().code, "unauthorized");
    assert_eq!(store.authenticate(&headers(&pc.token)).await.unwrap(), id);
}

#[tokio::test]
async fn link_codes_expire_are_replaced_and_are_limited() {
    let store = Store::memory().await;
    let pc = user(&store, "Sam").await;
    let id = pc.snapshot.me.id.clone();
    let first = store.new_link_code(&id).await.unwrap();
    let second = store.new_link_code(&id).await.unwrap();
    assert_eq!(store.redeem_link_code(&first.code, "Alt", Some(&"1".repeat(64))).await.err().unwrap().code, "invalidLinkCode");
    store.links.lock().await.get_mut(&second.code).unwrap().1 = server_now_ms() - 1;
    assert_eq!(store.redeem_link_code(&second.code, "Alt", Some(&"1".repeat(64))).await.err().unwrap().code, "invalidLinkCode");
    // A key that already belongs to a profile cannot become a device.
    let code = store.new_link_code(&id).await.unwrap();
    assert_eq!(store.redeem_link_code(&code.code, "Doppelt", Some(&pc.token)).await.err().unwrap().code, "invalidProfile");

    for n in 0..luft_listen_together::devices::MAX_LINKED_DEVICES {
        let code = store.new_link_code(&id).await.unwrap();
        store.redeem_link_code(&code.code, &format!("Gerät {n}"), Some(&format!("{n:0>64}"))).await.unwrap();
    }
    assert_eq!(store.new_link_code(&id).await.err().unwrap().code, "tooManyDevices");
}

#[tokio::test]
async fn with_two_playing_devices_the_one_started_last_stays_shown() {
    let store = Store::memory().await;
    let pc = user(&store, "Sam").await;
    let friend = user(&store, "Mika").await;
    befriend(&store, &pc, &friend).await;
    let id = pc.snapshot.me.id.clone();
    store.action(&id, SocialAction::UpdateOptions { options: SocialOptions { share_listening: true, ..pc.snapshot.options.clone() } }).await.unwrap();
    let link = store.new_link_code(&id).await.unwrap();
    store.redeem_link_code(&link.code, "Handy", Some(&"e".repeat(64))).await.unwrap();
    let (_, phone) = store.authenticate_device(&headers(&"e".repeat(64))).await.unwrap();
    let seen = || async { store.snapshot(&friend.snapshot.me.id).await.unwrap().friends[0].presence.track.as_ref().map(|t| t.uri.clone()) };

    store.update_presence_from(&id, &phone, playing("spotify:track:phone1", true)).await.unwrap();
    store.update_presence_from(&id, "main", playing("spotify:track:pc1", true)).await.unwrap();
    assert_eq!(seen().await.as_deref(), Some("spotify:track:pc1"));
    // The phone goes on to its next song and keeps reporting: the PC stays shown, no flipping.
    for _ in 0..3 {
        store.update_presence_from(&id, &phone, playing("spotify:track:phone2", true)).await.unwrap();
        store.update_presence_from(&id, "main", playing("spotify:track:pc1", true)).await.unwrap();
        store.update_presence_from(&id, &phone, playing("spotify:track:phone2", true)).await.unwrap();
        assert_eq!(seen().await.as_deref(), Some("spotify:track:pc1"));
    }
    // Recent tracks only from the shown device: phone1 while it was the only one, then pc1; never phone2.
    let recent = store.snapshot(&friend.snapshot.me.id).await.unwrap().friends[0].recent.iter().map(|r| r.track.uri.clone()).collect::<Vec<_>>();
    assert_eq!(recent, ["spotify:track:pc1", "spotify:track:phone1"]);
    // The PC pauses: the phone, still playing, is what friends see.
    store.update_presence_from(&id, "main", playing("spotify:track:pc1", false)).await.unwrap();
    assert_eq!(seen().await.as_deref(), Some("spotify:track:phone2"));
    // Pausing and playing again on the phone makes it the latest start.
    store.update_presence_from(&id, "main", playing("spotify:track:pc2", true)).await.unwrap();
    assert_eq!(seen().await.as_deref(), Some("spotify:track:pc2"));
    store.update_presence_from(&id, &phone, playing("spotify:track:phone2", false)).await.unwrap();
    store.update_presence_from(&id, &phone, playing("spotify:track:phone3", true)).await.unwrap();
    assert_eq!(seen().await.as_deref(), Some("spotify:track:phone3"));
}
