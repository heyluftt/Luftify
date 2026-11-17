use super::*;

const TRACK_URI: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";

#[tokio::test]
async fn stale_failure_does_not_block_metadata_in_the_new_queue() {
    let service = LibrespotService::new(PathBuf::from("queue-hydration-test"));
    let stale_epoch = {
        let mut snapshot = service.shared.playback.write().await;
        snapshot.queue.push_explicit(loading_item(TRACK_URI));
        let epoch = snapshot.queue.begin_hydrate();
        snapshot.queue.begin_hydrate();
        epoch
    };

    let mut changed = false;
    let processed = apply_hydrate_result(
        &service.shared,
        stale_epoch,
        Some(Ok((TRACK_URI.into(), None))),
        &mut changed,
    )
    .await;

    let snapshot = service.shared.playback.read().await;
    assert_eq!(snapshot.queue.next_placeholders(12, 6), vec![TRACK_URI]);
    assert!(snapshot.queue.failed.is_empty());
    assert!(!changed);
    assert_eq!(processed, None);
}

#[tokio::test]
async fn stale_metadata_does_not_overwrite_a_newer_result() {
    let service = LibrespotService::new(PathBuf::from("queue-hydration-test"));
    let stale_epoch = {
        let mut snapshot = service.shared.playback.write().await;
        snapshot.queue.push_explicit(loading_item(TRACK_URI));
        let epoch = snapshot.queue.begin_hydrate();
        snapshot.queue.begin_hydrate();
        let mut current = loading_item(TRACK_URI);
        current.title = "Current title".into();
        snapshot.queue.apply_metadata(current);
        epoch
    };

    let mut stale = loading_item(TRACK_URI);
    stale.title = "Outdated title".into();
    let mut changed = false;
    let processed = apply_hydrate_result(
        &service.shared,
        stale_epoch,
        Some(Ok((TRACK_URI.into(), Some(stale)))),
        &mut changed,
    )
    .await;

    let snapshot = service.shared.playback.read().await;
    assert_eq!(snapshot.queue.explicit[0].item.title, "Current title");
    assert_eq!(snapshot.queue.known[TRACK_URI].title, "Current title");
    assert!(!changed);
    assert_eq!(processed, None);
}

#[tokio::test]
async fn current_hydration_tracks_failures_and_applies_recovered_metadata() {
    let service = LibrespotService::new(PathBuf::from("queue-hydration-test"));
    let epoch = {
        let mut snapshot = service.shared.playback.write().await;
        snapshot.queue.push_explicit(loading_item(TRACK_URI));
        snapshot.queue.begin_hydrate()
    };
    let mut changed = false;
    let failed = apply_hydrate_result(
        &service.shared,
        epoch,
        Some(Ok((TRACK_URI.into(), None))),
        &mut changed,
    )
    .await;
    assert_eq!(failed, Some(1));
    assert!(
        service
            .shared
            .playback
            .read()
            .await
            .queue
            .failed
            .contains(TRACK_URI)
    );
    assert!(!changed);

    let mut item = loading_item(TRACK_URI);
    item.title = "Loaded title".into();
    let processed = apply_hydrate_result(
        &service.shared,
        epoch,
        Some(Ok((TRACK_URI.into(), Some(item)))),
        &mut changed,
    )
    .await;

    let snapshot = service.shared.playback.read().await;
    assert_eq!(snapshot.queue.explicit[0].item.title, "Loaded title");
    assert_eq!(snapshot.queue.known[TRACK_URI].title, "Loaded title");
    assert!(snapshot.queue.failed.is_empty());
    assert!(changed);
    assert_eq!(processed, Some(1));
}
