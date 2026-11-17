use super::*;

fn track(number: u32) -> TrackRef {
    TrackRef::new("spotify", format!("spotify:track:{number:022}")).unwrap()
}

fn room() -> (Hub, String) {
    let mut hub = Hub::new();
    let HubEvent::Created { room, .. } = hub.create_room("host", "Host").unwrap() else {
        panic!()
    };
    hub.join_room("guest", &room.code, "Guest", None).unwrap();
    hub.edit_queue(
        "host",
        &room.id,
        &Uuid::new_v4().to_string(),
        QueueEdit::AddMany {
            tracks: (0..4).map(track).collect(),
            next: false,
            group: Some(QueueGroup {
                id: Uuid::new_v4().to_string(),
                name: "Playlist".into(),
            }),
        },
    )
    .unwrap();
    hub.advance_queue("host", &room.id, None).unwrap();
    (hub, room.id)
}

#[test]
fn immediate_selection_preserves_playlist_and_duplicate_operations_do_not_restart() {
    let (mut hub, id) = room();
    let before = hub.snapshot_for("host").unwrap().queue.items;
    let operation = Uuid::new_v4().to_string();
    let edit = QueueEdit::PlayNow { track: track(99) };
    assert!(matches!(
        hub.edit_queue("host", &id, &operation, edit.clone())
            .unwrap(),
        HubEvent::RoomUpdated { .. }
    ));
    let after = hub.snapshot_for("host").unwrap();
    assert_eq!(after.queue.current.as_ref().unwrap().track, track(99));
    assert_eq!(after.queue.items, before);
    assert_eq!(after.playback.position_ms, 0);
    assert!(after.playback.is_playing);
    hub.edit_queue("host", &id, &operation, edit).unwrap();
    assert_eq!(hub.snapshot_for("host").unwrap(), after);
    hub.advance_queue(
        "host",
        &id,
        after.queue.current.as_ref().map(|entry| entry.id.as_str()),
    )
    .unwrap();
    assert_eq!(
        hub.snapshot_for("host")
            .unwrap()
            .queue
            .current
            .as_ref()
            .unwrap(),
        &before[0]
    );
}

#[test]
fn selecting_exact_duplicate_keeps_other_occurrences_and_requires_steering_permission() {
    let (mut hub, id) = room();
    hub.edit_queue(
        "host",
        &id,
        &Uuid::new_v4().to_string(),
        QueueEdit::Add { track: track(1) },
    )
    .unwrap();
    let before = hub.snapshot_for("host").unwrap();
    let selected = before.queue.items.last().unwrap().clone();
    let edit = QueueEdit::PlayQueued {
        id: selected.id.clone(),
    };
    assert_eq!(
        hub.edit_queue("guest", &id, &Uuid::new_v4().to_string(), edit.clone())
            .unwrap_err(),
        RoomError::HostOnly
    );
    assert_eq!(hub.snapshot_for("host").unwrap(), before);
    hub.set_control("host", crate::ControlMode::Everyone)
        .unwrap();
    hub.edit_queue("guest", &id, &Uuid::new_v4().to_string(), edit)
        .unwrap();
    let after = hub.snapshot_for("host").unwrap();
    assert_eq!(after.queue.current.unwrap(), selected);
    assert_eq!(after.queue.items, before.queue.items[..3]);
    assert_eq!(
        hub.edit_queue(
            "host",
            &id,
            &Uuid::new_v4().to_string(),
            QueueEdit::PlayQueued {
                id: "removed".into()
            }
        )
        .unwrap_err(),
        RoomError::StaleRevision
    );
}

#[test]
fn search_selection_consumes_one_existing_song_and_works_with_full_queue() {
    let (mut hub, id) = room();
    let expected = hub.snapshot_for("host").unwrap().queue.items[1].clone();
    hub.edit_queue(
        "host",
        &id,
        &Uuid::new_v4().to_string(),
        QueueEdit::PlayNow { track: track(2) },
    )
    .unwrap();
    assert_eq!(
        hub.snapshot_for("host").unwrap().queue.current.unwrap(),
        expected
    );
    for number in 0..4 {
        hub.edit_queue(
            "host",
            &id,
            &Uuid::new_v4().to_string(),
            QueueEdit::AddMany {
                tracks: (0..50).map(|i| track(100 + number * 50 + i)).collect(),
                next: false,
                group: None,
            },
        )
        .unwrap();
    }
    assert_eq!(
        hub.snapshot_for("host").unwrap().queue.items.len(),
        MAX_QUEUE_ITEMS
    );
    hub.edit_queue(
        "host",
        &id,
        &Uuid::new_v4().to_string(),
        QueueEdit::PlayNow { track: track(999) },
    )
    .unwrap();
    assert_eq!(
        hub.snapshot_for("host").unwrap().queue.items.len(),
        MAX_QUEUE_ITEMS
    );
    assert_eq!(
        hub.snapshot_for("host")
            .unwrap()
            .queue
            .current
            .unwrap()
            .track,
        track(999)
    );
}
