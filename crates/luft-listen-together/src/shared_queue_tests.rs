use super::*;

fn setup() -> (Hub, String) {
    let mut hub = Hub::new();
    let HubEvent::Created { room, .. } = hub.create_room("host", "Host").unwrap() else {
        panic!()
    };
    hub.join_room("guest", &room.code, "Guest", None).unwrap();
    (hub, room.id)
}
fn add(hub: &mut Hub, room: &str, person: &str) -> String {
    hub.edit_queue(
        person,
        room,
        &Uuid::new_v4().to_string(),
        QueueEdit::Add {
            track: TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap(),
        },
    )
    .unwrap();
    hub.snapshot_for(person)
        .unwrap()
        .queue
        .items
        .last()
        .unwrap()
        .id
        .clone()
}
fn edit(hub: &mut Hub, room: &str, edit: QueueEdit) -> Result<HubEvent, RoomError> {
    hub.edit_queue("guest", room, &Uuid::new_v4().to_string(), edit)
}
#[test]
fn both_members_add_duplicate_tracks_as_distinct_occurrences() {
    let (mut hub, room) = setup();
    let a = add(&mut hub, &room, "host");
    let b = add(&mut hub, &room, "guest");
    assert_ne!(a, b);
    let entries = hub.snapshot_for("host").unwrap().queue.items;
    assert_eq!(entries[0].added_by_name.as_deref(), Some("Host"));
    assert_eq!(entries[1].added_by_name.as_deref(), Some("Guest"));
    edit(&mut hub, &room, QueueEdit::Remove { id: a }).unwrap();
    assert_eq!(hub.snapshot_for("host").unwrap().queue.items[0].id, b);
}
#[test]
fn moves_and_advances_resolve_by_server_order() {
    let (mut hub, room) = setup();
    let a = add(&mut hub, &room, "host");
    let b = add(&mut hub, &room, "guest");
    edit(
        &mut hub,
        &room,
        QueueEdit::Move {
            id: b.clone(),
            before_id: Some(a.clone()),
        },
    )
    .unwrap();
    hub.advance_queue("host", &room, None).unwrap();
    assert_eq!(
        hub.snapshot_for("guest").unwrap().queue.current.unwrap().id,
        b
    );
    assert_eq!(
        edit(
            &mut hub,
            &room,
            QueueEdit::Move {
                id: a.clone(),
                before_id: Some(b.clone())
            }
        ),
        Err(RoomError::StaleRevision)
    );
    assert_eq!(hub.snapshot_for("guest").unwrap().queue.items[0].id, a);
    assert_eq!(
        hub.advance_queue("host", &room, None),
        Err(RoomError::StaleRevision)
    );
    edit(&mut hub, &room, QueueEdit::Remove { id: b.clone() }).unwrap();
    assert_eq!(
        hub.snapshot_for("guest").unwrap().queue.current.unwrap().id,
        a
    );
    edit(&mut hub, &room, QueueEdit::Remove { id: b }).unwrap();
    assert_eq!(
        hub.snapshot_for("guest").unwrap().queue.current.unwrap().id,
        a
    );
}
#[test]
fn repeated_operation_is_not_applied_twice_and_nonmembers_are_rejected() {
    let (mut hub, room) = setup();
    let id = Uuid::new_v4().to_string();
    let op = QueueEdit::Add {
        track: TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap(),
    };
    hub.edit_queue("guest", &room, &id, op.clone()).unwrap();
    hub.edit_queue("guest", &room, &id, op.clone()).unwrap();
    assert_eq!(hub.snapshot_for("guest").unwrap().queue.items.len(), 1);
    assert_eq!(
        hub.edit_queue("stranger", &room, &id, op),
        Err(RoomError::NotInRoom)
    );
    assert_eq!(
        hub.advance_queue("guest", &room, None),
        Err(RoomError::HostOnly)
    );
}
#[test]
fn empty_queue_stops_and_late_move_cannot_resurrect_consumed_entry() {
    let (mut hub, room) = setup();
    let a = add(&mut hub, &room, "host");
    hub.advance_queue("host", &room, None).unwrap();
    hub.advance_queue("host", &room, Some(&a)).unwrap();
    let snapshot = hub.snapshot_for("host").unwrap();
    assert!(snapshot.queue.current.is_none());
    assert!(!snapshot.playback.is_playing);
    assert_eq!(
        edit(
            &mut hub,
            &room,
            QueueEdit::Move {
                id: a,
                before_id: None
            }
        ),
        Err(RoomError::StaleRevision)
    );
}

#[test]
fn host_disconnect_freezes_position_and_resume_keeps_current_occurrence() {
    let mut hub = Hub::new();
    let HubEvent::Created {
        room, resume_token, ..
    } = hub.create_room("host", "Host").unwrap()
    else {
        panic!()
    };
    hub.join_room("guest", &room.code, "Guest", None).unwrap();
    let id = add(&mut hub, &room.id, "guest");
    hub.advance_queue("host", &room.id, None).unwrap();
    hub.disconnect("host").unwrap();
    let paused = hub.snapshot_for("guest").unwrap();
    assert!(!paused.playback.is_playing);
    assert!(!paused.host_connected);
    hub.join_room("host-new", &room.code, "Host", Some(&resume_token))
        .unwrap();
    let resumed = hub.snapshot_for("host-new").unwrap();
    assert!(resumed.playback.is_playing);
    assert_eq!(resumed.playback.position_ms, paused.playback.position_ms);
    assert_eq!(resumed.queue.current.unwrap().id, id);
}
fn tracks(ids: &[&str]) -> Vec<TrackRef> {
    ids.iter().map(|id| TrackRef::new("spotify", format!("spotify:track:{id:0>22}")).unwrap()).collect()
}
fn uris(hub: &Hub) -> Vec<String> {
    hub.snapshot_for("host").unwrap().queue.items.iter().map(|e| e.track.uri[14..].trim_start_matches('0').to_owned()).collect()
}
#[test]
fn batches_add_in_order_skip_bad_songs_and_stop_at_capacity() {
    let (mut hub, room) = setup();
    edit(&mut hub, &room, QueueEdit::AddMany { tracks: tracks(&["a", "b"]), next: false, group: None }).unwrap();
    let mut batch = tracks(&["c", "d"]);
    batch.insert(1, TrackRef::new("spotify", "spotify:episode:nope").unwrap());
    let event = edit(&mut hub, &room, QueueEdit::AddMany { tracks: batch, next: true, group: None }).unwrap();
    // One operation, one queue update for everyone.
    assert!(matches!(event, HubEvent::Queue { .. }));
    assert_eq!(uris(&hub), ["c", "d", "a", "b"]);
    assert_eq!(hub.snapshot_for("host").unwrap().queue.items[0].added_by_name.as_deref(), Some("Guest"));
    let too_many = tracks(&["x"; MAX_BATCH_TRACKS + 1]);
    assert!(edit(&mut hub, &room, QueueEdit::AddMany { tracks: too_many, next: false, group: None }).is_err());
    for _ in 0..4 {
        let _ = edit(&mut hub, &room, QueueEdit::AddMany { tracks: tracks(&["f"; MAX_BATCH_TRACKS]), next: false, group: None });
    }
    assert_eq!(hub.snapshot_for("host").unwrap().queue.items.len(), MAX_QUEUE_ITEMS);
    assert!(edit(&mut hub, &room, QueueEdit::AddMany { tracks: tracks(&["g"]), next: false, group: None }).is_err());
}
#[test]
fn shuffle_and_clear_are_steering() {
    let (mut hub, room) = setup();
    edit(&mut hub, &room, QueueEdit::AddMany { tracks: tracks(&["a", "b", "c", "d", "e", "f"]), next: false, group: None }).unwrap();
    assert_eq!(edit(&mut hub, &room, QueueEdit::Clear).unwrap_err(), RoomError::HostOnly);
    hub.edit_queue("host", &room, &Uuid::new_v4().to_string(), QueueEdit::Shuffle).unwrap();
    let mut shuffled = uris(&hub);
    shuffled.sort();
    assert_eq!(shuffled, ["a", "b", "c", "d", "e", "f"]);
    hub.edit_queue("host", &room, &Uuid::new_v4().to_string(), QueueEdit::Clear).unwrap();
    assert!(uris(&hub).is_empty());
}
#[test]
fn a_playlist_block_moves_and_trims_as_one_and_guests_keep_to_their_own() {
    let (mut hub, room) = setup();
    let group = QueueGroup { id: Uuid::new_v4().to_string(), name: " Late\nNight ".into() };
    hub.edit_queue("host", &room, &Uuid::new_v4().to_string(), QueueEdit::AddMany { tracks: tracks(&["a"]), next: false, group: None }).unwrap();
    edit(&mut hub, &room, QueueEdit::AddMany { tracks: tracks(&["b", "c", "d"]), next: false, group: Some(group.clone()) }).unwrap();
    let items = hub.snapshot_for("host").unwrap().queue.items;
    assert_eq!(items[1].group.as_ref().unwrap().name, "LateNight");
    let block: Vec<_> = items[1..].iter().map(|e| e.id.clone()).collect();
    edit(&mut hub, &room, QueueEdit::MoveMany { ids: block.clone(), before_id: Some(items[0].id.clone()) }).unwrap();
    assert_eq!(uris(&hub), ["b", "c", "d", "a"]);
    // Keep only the first song of the block.
    edit(&mut hub, &room, QueueEdit::RemoveMany { ids: block[1..].to_vec() }).unwrap();
    assert_eq!(uris(&hub), ["b", "a"]);

    hub.set_queue_policy("host", crate::QueuePolicy::OwnSongs).unwrap();
    assert_eq!(hub.set_queue_policy("guest", crate::QueuePolicy::Open).unwrap_err(), RoomError::HostOnly);
    let host_song = hub.snapshot_for("host").unwrap().queue.items[1].id.clone();
    assert_eq!(edit(&mut hub, &room, QueueEdit::Remove { id: host_song.clone() }).unwrap_err(), RoomError::HostOnly);
    assert_eq!(edit(&mut hub, &room, QueueEdit::RemoveMany { ids: vec![block[0].clone(), host_song.clone()] }).unwrap_err(), RoomError::HostOnly);
    edit(&mut hub, &room, QueueEdit::Remove { id: block[0].clone() }).unwrap();
    hub.edit_queue("host", &room, &Uuid::new_v4().to_string(), QueueEdit::Remove { id: host_song }).unwrap();
    assert!(uris(&hub).is_empty());
}
