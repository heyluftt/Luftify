use super::*;
use std::time::{Duration, Instant};

const RECONNECT_GRACE: Duration = Duration::from_secs(120);
/// How long guests wait for a host whose connection dropped (sleep, Wi-Fi,
/// crash) before one of them takes over.
pub const HOST_HANDOFF_AFTER: Duration = Duration::from_secs(45);

impl Hub {
    /// Rooms whose host has been gone for HOST_HANDOFF_AFTER while others
    /// are still connected get a new host; the old one rejoins as a guest.
    pub fn hand_over_lost_hosts(&mut self) -> Vec<HubEvent> {
        let now = Instant::now();
        self.rooms
            .values_mut()
            .filter(|room| room.host_lost_at.is_some_and(|at| now.duration_since(at) >= HOST_HANDOFF_AFTER))
            .filter_map(|room| room.hand_over(false).then(|| HubEvent::RoomUpdated { room: room.snapshot() }))
            .collect()
    }

    /// Retain room and tokens briefly when all sockets disconnect together.
    pub fn expire_disconnected(&mut self) {
        let now = Instant::now();
        let expired: Vec<_> = self
            .rooms
            .iter()
            .filter(|(_, room)| {
                room.disconnected_at
                    .is_some_and(|at| now.duration_since(at) >= RECONNECT_GRACE)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            self.close_room(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn everyone_can_resume_after_simultaneous_disconnect() {
        let mut hub = Hub::new();
        let HubEvent::Created {
            room,
            resume_token: host_token,
            ..
        } = hub.create_room("host", "Host").unwrap()
        else {
            panic!()
        };
        let HubEvent::Joined {
            resume_token: guest_token,
            ..
        } = hub.join_room("guest", &room.code, "Guest", None).unwrap()
        else {
            panic!()
        };
        hub.replace_queue(
            "host",
            1,
            vec![TrackRef::new("spotify", "spotify:track:one").unwrap()],
        )
        .unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        let occurrence = hub.snapshot_for("host").unwrap().queue.current.unwrap().id;
        hub.disconnect("host");
        hub.disconnect("guest");
        assert!(hub.snapshot_for("host").is_some());
        hub.join_room("guest-new", &room.code, "Guest", Some(&guest_token))
            .unwrap();
        let HubEvent::Joined { room: restored, .. } = hub
            .join_room("host-new", &room.code, "Host", Some(&host_token))
            .unwrap()
        else {
            panic!()
        };
        assert_eq!(restored.id, room.id);
        assert_eq!(restored.queue.current.unwrap().id, occurrence);
        assert!(restored.host_connected);
        assert!(restored.playback.is_playing);
        assert_eq!(restored.participants.len(), 2);
    }

    #[test]
    fn expired_room_removes_code_and_resume_tokens() {
        let mut hub = Hub::new();
        let HubEvent::Created {
            room, resume_token, ..
        } = hub.create_room("host", "Host").unwrap()
        else {
            panic!()
        };
        hub.disconnect("host");
        hub.rooms.get_mut(&room.id).unwrap().disconnected_at =
            Some(Instant::now() - RECONNECT_GRACE);
        hub.expire_disconnected();
        assert!(hub.rooms.is_empty());
        assert!(hub.codes.is_empty());
        assert!(hub.tokens.is_empty());
        assert_eq!(
            hub.join_room("new", &room.code, "Host", Some(&resume_token)),
            Err(RoomError::Unauthorized)
        );
    }

    #[test]
    fn host_leaving_alone_closes_the_room() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, .. } = hub.create_room("host", "Host").unwrap() else { panic!() };
        hub.join_room("guest", &room.code, "Guest", None).unwrap();
        hub.disconnect("guest");
        // Nobody connected to take over.
        assert!(matches!(hub.leave_room("host").unwrap(), HubEvent::Closed { .. }));
        assert!(hub.rooms.is_empty());
        assert!(hub.tokens.is_empty());
    }

    fn playing_room(hub: &mut Hub) -> RoomSnapshot {
        let HubEvent::Created { room, .. } = hub.create_room("host", "Host").unwrap() else { panic!() };
        hub.join_room("first", &room.code, "First", None).unwrap();
        hub.join_room("second", &room.code, "Second", None).unwrap();
        hub.replace_queue(
            "host",
            1,
            vec![
                TrackRef::new("spotify", "spotify:track:one").unwrap(),
                TrackRef::new("spotify", "spotify:track:two").unwrap(),
            ],
        )
        .unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        hub.snapshot_for("host").unwrap()
    }

    #[test]
    fn leaving_host_hands_the_room_to_the_longest_present_guest() {
        let mut hub = Hub::new();
        let before = playing_room(&mut hub);
        assert!(before.playback.is_playing);
        let HubEvent::RoomUpdated { room } = hub.leave_room("host").unwrap() else { panic!() };
        assert_eq!(room.host_id, "first");
        assert!(room.host_connected);
        assert!(room.playback.is_playing, "the music keeps going");
        assert!(room.playback.revision > before.playback.revision);
        assert_eq!(room.queue.current.as_ref().map(|e| &e.id), before.queue.current.as_ref().map(|e| &e.id));
        assert_eq!(room.queue.items.len(), before.queue.items.len());
        assert_eq!(room.participants.len(), 2);
        assert!(room.participants.iter().all(|p| p.is_host == (p.id == "first")));
        // The new host steers; the others still cannot.
        assert_eq!(hub.advance_queue("second", &room.id, None), Err(RoomError::HostOnly));
        let current = room.queue.current.as_ref().map(|entry| entry.id.as_str());
        assert!(hub.advance_queue("first", &room.id, current).is_ok());
    }

    #[test]
    fn lost_host_is_replaced_after_the_grace_and_rejoins_as_guest() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, resume_token, .. } = hub.create_room("host", "Host").unwrap() else { panic!() };
        hub.join_room("guest", &room.code, "Guest", None).unwrap();
        hub.replace_queue("host", 1, vec![TrackRef::new("spotify", "spotify:track:one").unwrap()]).unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        hub.disconnect("host");
        assert!(!hub.snapshot_for("guest").unwrap().playback.is_playing, "guests wait for the host");
        assert!(hub.hand_over_lost_hosts().is_empty(), "not before the grace");

        hub.rooms.get_mut(&room.id).unwrap().host_lost_at = Some(Instant::now() - HOST_HANDOFF_AFTER);
        let events = hub.hand_over_lost_hosts();
        let [HubEvent::RoomUpdated { room: updated }] = events.as_slice() else { panic!("{events:?}") };
        assert_eq!(updated.host_id, "guest");
        assert!(updated.playback.is_playing, "what was playing resumes");
        assert!(hub.hand_over_lost_hosts().is_empty(), "only once");

        let HubEvent::Joined { you, room: back, .. } = hub.join_room("host-again", &room.code, "Host", Some(&resume_token)).unwrap() else { panic!() };
        assert!(!you.is_host);
        assert_eq!(back.host_id, "guest");
    }

    #[test]
    fn a_host_back_within_the_grace_keeps_the_room() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, resume_token, .. } = hub.create_room("host", "Host").unwrap() else { panic!() };
        hub.join_room("guest", &room.code, "Guest", None).unwrap();
        hub.disconnect("host");
        let HubEvent::Joined { you, .. } = hub.join_room("host-2", &room.code, "Host", Some(&resume_token)).unwrap() else { panic!() };
        assert!(you.is_host);
        hub.rooms.get_mut(&room.id).unwrap().members.values_mut().for_each(|m| m.joined_at -= HOST_HANDOFF_AFTER);
        assert!(hub.hand_over_lost_hosts().is_empty());
    }
}
