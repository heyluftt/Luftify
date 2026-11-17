//! Who may steer the room, and steering by anyone allowed to.

use super::*;
use crate::protocol::RoomControl;

impl Room {
    /// The host always; guests once the host allows everyone.
    pub(super) fn may_control(&self, participant: &str) -> bool {
        self.host_id == participant || self.control == ControlMode::Everyone
    }

    /// Moving or removing a waiting song.
    pub(super) fn may_edit(&self, participant: &str, entry: &crate::QueueEntry) -> bool {
        self.host_id == participant
            || self.queue_policy == crate::QueuePolicy::Open
            || entry.added_by_id.as_deref() == Some(participant)
    }
}

impl Hub {
    pub fn set_control(&mut self, participant: &str, mode: ControlMode) -> Result<HubEvent, RoomError> {
        let room_id = self.room_id_for(participant).ok_or(RoomError::NotInRoom)?;
        let room = self.rooms.get_mut(&room_id).ok_or(RoomError::RoomNotFound)?;
        if room.host_id != participant {
            return Err(RoomError::HostOnly);
        }
        room.control = mode;
        Ok(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }

    pub fn set_queue_policy(&mut self, participant: &str, policy: crate::QueuePolicy) -> Result<HubEvent, RoomError> {
        let room_id = self.room_id_for(participant).ok_or(RoomError::NotInRoom)?;
        let room = self.rooms.get_mut(&room_id).ok_or(RoomError::RoomNotFound)?;
        if room.host_id != participant {
            return Err(RoomError::HostOnly);
        }
        room.queue_policy = policy;
        Ok(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }

    /// Play, pause or seek the playing occurrence. The relay computes the
    /// new position from its own clock, so a guest needs no revision base.
    pub fn control(&mut self, participant: &str, action: RoomControl) -> Result<HubEvent, RoomError> {
        let room_id = self.room_id_for(participant).ok_or(RoomError::NotInRoom)?;
        let room = self.rooms.get_mut(&room_id).ok_or(RoomError::RoomNotFound)?;
        if !room.may_control(participant) {
            return Err(RoomError::HostOnly);
        }
        if room.queue.current.is_none() || room.playback.track.is_none() {
            return Err(RoomError::InvalidQueue);
        }
        let now = server_now_ms();
        let duration = room.playback.track.as_ref().and_then(|track| track.duration_ms);
        let position = crate::expected_position_ms(
            room.playback.position_ms,
            room.playback.is_playing,
            room.playback.server_time_ms,
            now,
            duration,
        );
        let (position, playing) = match action {
            RoomControl::Play => (position, true),
            RoomControl::Pause => (position, false),
            RoomControl::Seek { position_ms } => (
                duration.map_or(position_ms.min(24 * 60 * 60 * 1_000), |d| position_ms.min(d)),
                room.playback.is_playing,
            ),
        };
        let host_here = room
            .members
            .get(&room.host_id)
            .is_some_and(|member| member.participant.connected);
        // Without the host nobody plays; the wish to play waits for them.
        room.resume_playing = playing && !host_here;
        room.playback.is_playing = playing && host_here;
        room.playback.position_ms = position;
        room.playback.server_time_ms = now;
        room.playback.revision = room.playback.revision.saturating_add(1);
        room.playback.origin_id = participant.to_owned();
        Ok(HubEvent::Playback {
            participant_ids: room.member_ids(),
            room_id,
            state: room.playback.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing_room() -> (Hub, String) {
        let mut hub = Hub::new();
        let HubEvent::Created { room, .. } = hub.create_room("host", "Host").unwrap() else {
            panic!()
        };
        hub.join_room("guest", &room.code, "Guest", None).unwrap();
        hub.replace_queue(
            "host",
            1,
            vec![TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap()],
        )
        .unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        (hub, room.id)
    }

    #[test]
    fn guests_steer_only_after_the_host_allows_it() {
        let (mut hub, _) = playing_room();
        assert_eq!(hub.control("guest", RoomControl::Pause), Err(RoomError::HostOnly));
        assert_eq!(hub.set_control("guest", ControlMode::Everyone), Err(RoomError::HostOnly));

        hub.set_control("host", ControlMode::Everyone).unwrap();
        let HubEvent::Playback { state, .. } = hub.control("guest", RoomControl::Pause).unwrap() else {
            panic!("expected playback")
        };
        assert!(!state.is_playing);
        assert_eq!(state.origin_id, "guest");

        let HubEvent::Playback { state, .. } = hub
            .control("guest", RoomControl::Seek { position_ms: 30_000 })
            .unwrap()
        else {
            panic!("expected playback")
        };
        assert_eq!(state.position_ms, 30_000);
        assert!(!state.is_playing);
    }

    #[test]
    fn playing_waits_for_a_missing_host() {
        let (mut hub, _) = playing_room();
        hub.set_control("host", ControlMode::Everyone).unwrap();
        hub.control("guest", RoomControl::Pause).unwrap();
        hub.disconnect("host");
        let HubEvent::Playback { state, .. } = hub.control("guest", RoomControl::Play).unwrap() else {
            panic!("expected playback")
        };
        assert!(!state.is_playing);
    }
}
