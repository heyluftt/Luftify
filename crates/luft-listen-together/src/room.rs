#[path = "control.rs"]
mod control;
#[path = "reconnect.rs"]
mod reconnect;
#[path = "persist.rs"]
mod persist;
pub use persist::SavedRooms;
use std::collections::HashMap;

#[path = "profile.rs"]
mod profile;
#[path = "shared_queue.rs"]
mod shared_queue;
pub use profile::valid_avatar;

use thiserror::Error;
use uuid::Uuid;

use crate::{
    MAX_DISPLAY_NAME, MAX_QUEUE_ITEMS, TrackRef, generate_join_code, normalize_join_code,
    protocol::{
        AuthoritativePlayback, ControlMode, Participant, PlaybackIntent, QueueSnapshot, RepeatMode,
        RoomSnapshot,
    },
    server_now_ms,
};

const MAX_ROOM_PARTICIPANTS: usize = 8;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RoomError {
    #[error("invalid queue operation")]
    InvalidQueue,
    #[error("invalid join code")]
    InvalidCode,
    #[error("room not found")]
    RoomNotFound,
    #[error("room is full")]
    RoomFull,
    #[error("not in a room")]
    NotInRoom,
    #[error("only the host can do that")]
    HostOnly,
    #[error("stale revision")]
    StaleRevision,
    #[error("unauthorized")]
    Unauthorized,
}

#[derive(Debug, Clone)]
struct Member {
    participant: Participant,
    resume_token: String,
    /// The longest-present member takes over when the host is gone.
    joined_at: std::time::Instant,
}

#[derive(Debug, Clone)]
struct Room {
    id: String,
    code: String,
    host_id: String,
    control: ControlMode,
    queue_policy: crate::QueuePolicy,
    members: HashMap<String, Member>,
    playback: AuthoritativePlayback,
    queue: QueueSnapshot,
    queue_operations: std::collections::VecDeque<String>,
    resume_playing: bool,
    disconnected_at: Option<std::time::Instant>,
    /// The host's socket dropped; after a grace period another member takes over.
    host_lost_at: Option<std::time::Instant>,
}

#[derive(Debug, Default)]
pub struct Hub {
    rooms: HashMap<String, Room>,
    codes: HashMap<String, String>,
    tokens: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HubEvent {
    Created {
        room: RoomSnapshot,
        you: Participant,
        resume_token: String,
    },
    Joined {
        room: RoomSnapshot,
        you: Participant,
        resume_token: String,
    },
    RoomUpdated {
        room: RoomSnapshot,
    },
    Playback {
        room_id: String,
        participant_ids: Vec<String>,
        state: AuthoritativePlayback,
    },
    Queue {
        room_id: String,
        participant_ids: Vec<String>,
        queue: QueueSnapshot,
    },
    Closed {
        room_id: String,
        participant_ids: Vec<String>,
    },
}

impl Hub {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_room(
        &mut self,
        participant_id: &str,
        display_name: &str,
    ) -> Result<HubEvent, RoomError> {
        self.expire_disconnected();
        let display_name = sanitize_display_name(display_name);
        let id = Uuid::new_v4().to_string();
        let mut code = generate_join_code();
        while self.codes.contains_key(&code) {
            code = generate_join_code();
        }
        let resume_token = new_token();
        let now = server_now_ms();
        let participant = Participant {
            avatar_uri: None,
            id: participant_id.to_owned(),
            display_name,
            is_host: true,
            connected: true,
            roles: Vec::new(),
            badges: Vec::new(),
        };
        let playback = AuthoritativePlayback {
            revision: 1,
            origin_id: participant_id.to_owned(),
            track: None,
            position_ms: 0,
            is_playing: false,
            shuffle: false,
            repeat: RepeatMode::Off,
            server_time_ms: now,
        };
        let mut members = HashMap::new();
        members.insert(
            participant_id.to_owned(),
            Member {
                participant: participant.clone(),
                resume_token: resume_token.clone(),
                joined_at: std::time::Instant::now(),
            },
        );
        let room = Room {
            id: id.clone(),
            code: code.clone(),
            host_id: participant_id.to_owned(),
            control: ControlMode::HostOnly,
            queue_policy: crate::QueuePolicy::Open,
            members,
            playback,
            queue: QueueSnapshot {
                revision: 1,
                current: None,
                items: Vec::new(),
            },
            queue_operations: Default::default(),
            resume_playing: false,
            disconnected_at: None,
            host_lost_at: None,
        };
        self.codes.insert(code, id.clone());
        self.tokens.insert(resume_token.clone(), id.clone());
        let snapshot = room.snapshot();
        self.rooms.insert(id, room);
        Ok(HubEvent::Created {
            room: snapshot,
            you: participant,
            resume_token,
        })
    }

    pub fn join_room(
        &mut self,
        participant_id: &str,
        code: &str,
        display_name: &str,
        resume_token: Option<&str>,
    ) -> Result<HubEvent, RoomError> {
        self.expire_disconnected();
        if let Some(token) = resume_token.filter(|token| !token.is_empty()) {
            return self.resume(participant_id, token, display_name);
        }
        let code = normalize_join_code(code).ok_or(RoomError::InvalidCode)?;
        let room_id = self
            .codes
            .get(&code)
            .cloned()
            .ok_or(RoomError::RoomNotFound)?;
        let display_name = sanitize_display_name(display_name);
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        if room.members.len() >= MAX_ROOM_PARTICIPANTS && !room.members.contains_key(participant_id)
        {
            return Err(RoomError::RoomFull);
        }
        let resume_token = new_token();
        let participant = Participant {
            id: participant_id.to_owned(),
            display_name,
            is_host: room.host_id == participant_id,
            avatar_uri: None,
            connected: true,
            roles: Vec::new(),
            badges: Vec::new(),
        };
        if let Some(existing) = room.members.get_mut(participant_id) {
            self.tokens.remove(&existing.resume_token);
            let roles = std::mem::take(&mut existing.participant.roles);
            let badges = std::mem::take(&mut existing.participant.badges);
            existing.participant = Participant { roles, badges, ..participant.clone() };
            existing.resume_token = resume_token.clone();
        } else {
            room.members.insert(
                participant_id.to_owned(),
                Member {
                    participant: participant.clone(),
                    resume_token: resume_token.clone(),
                    joined_at: std::time::Instant::now(),
                },
            );
        }
        room.disconnected_at = None;
        self.tokens.insert(resume_token.clone(), room_id);
        Ok(HubEvent::Joined {
            room: room.snapshot(),
            you: participant,
            resume_token,
        })
    }

    pub fn leave_room(&mut self, participant_id: &str) -> Result<HubEvent, RoomError> {
        let Some(room_id) = self.room_id_for(participant_id) else {
            return Err(RoomError::NotInRoom);
        };
        let is_host = self
            .rooms
            .get(&room_id)
            .is_some_and(|room| room.host_id == participant_id);
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        if is_host && !room.hand_over(true) {
            return Ok(self.close_room(&room_id));
        }
        if let Some(member) = room.members.remove(participant_id) {
            self.tokens.remove(&member.resume_token);
        }
        if room.members.is_empty() {
            return Ok(self.close_room(&room_id));
        }
        if room
            .members
            .values()
            .all(|member| !member.participant.connected)
        {
            room.disconnected_at
                .get_or_insert_with(std::time::Instant::now);
        }
        Ok(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }

    pub fn disconnect(&mut self, participant_id: &str) -> Option<HubEvent> {
        let room_id = self.room_id_for(participant_id)?;
        let room = self.rooms.get_mut(&room_id)?;
        let member = room.members.get_mut(participant_id)?;
        if !member.participant.connected {
            return None;
        }
        member.participant.connected = false;
        if participant_id == room.host_id {
            let now = server_now_ms();
            room.resume_playing = room.playback.is_playing;
            room.playback.position_ms = crate::expected_position_ms(
                room.playback.position_ms,
                room.playback.is_playing,
                room.playback.server_time_ms,
                now,
                room.playback.track.as_ref().and_then(|t| t.duration_ms),
            );
            room.playback.server_time_ms = now;
            room.playback.is_playing = false;
            room.playback.revision += 1;
            room.host_lost_at = Some(std::time::Instant::now());
        }
        if room
            .members
            .values()
            .all(|member| !member.participant.connected)
        {
            room.disconnected_at
                .get_or_insert_with(std::time::Instant::now);
        }
        Some(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }

    pub fn apply_intent(
        &mut self,
        participant_id: &str,
        revision_base: u64,
        intent: PlaybackIntent,
    ) -> Result<HubEvent, RoomError> {
        let room_id = self
            .room_id_for(participant_id)
            .ok_or(RoomError::NotInRoom)?;
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        if room.host_id != participant_id {
            return Err(RoomError::HostOnly);
        }
        if revision_base != room.playback.revision {
            return Err(RoomError::StaleRevision);
        }
        let track = intent.track.and_then(TrackRef::sanitize);
        if track.as_ref().map(|t| &t.uri) != room.queue.current.as_ref().map(|e| &e.track.uri) {
            return Err(RoomError::InvalidQueue);
        }
        room.playback.revision = room.playback.revision.saturating_add(1);
        room.playback.origin_id = participant_id.to_owned();
        room.playback.track = track;
        room.playback.position_ms = intent.position_ms.min(24 * 60 * 60 * 1_000);
        room.playback.is_playing = intent.is_playing;
        room.playback.shuffle = false;
        room.playback.repeat = RepeatMode::One;
        room.playback.server_time_ms = server_now_ms();
        Ok(HubEvent::Playback {
            participant_ids: room.member_ids(),
            room_id,
            state: room.playback.clone(),
        })
    }

    pub fn replace_queue(
        &mut self,
        participant_id: &str,
        revision_base: u64,
        items: Vec<TrackRef>,
    ) -> Result<HubEvent, RoomError> {
        let room_id = self
            .room_id_for(participant_id)
            .ok_or(RoomError::NotInRoom)?;
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        if room.host_id != participant_id {
            return Err(RoomError::HostOnly);
        }
        // Legacy replacement is a one-time seed only; it can never overwrite edits.
        if revision_base != 1 || room.queue.revision != 1 {
            return Err(RoomError::StaleRevision);
        }
        let items = items
            .into_iter()
            .filter_map(TrackRef::sanitize)
            .take(MAX_QUEUE_ITEMS)
            .map(|track| crate::QueueEntry {
                added_by_id: Some(participant_id.to_owned()),
                added_by_name: room
                    .members
                    .get(participant_id)
                    .map(|member| member.participant.display_name.clone()),
                id: Uuid::new_v4().to_string(),
                track,
                group: None,
            })
            .collect();
        room.queue.revision = room.queue.revision.saturating_add(1);
        room.queue.items = items;
        Ok(HubEvent::Queue {
            participant_ids: room.member_ids(),
            room_id,
            queue: room.queue.clone(),
        })
    }

    #[must_use]
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    /// Everyone connected to a room right now.
    pub fn connected_member_count(&self) -> usize {
        self.rooms.values().map(|room| room.members.values().filter(|member| member.participant.connected).count()).sum()
    }

    pub fn snapshot_for(&self, participant_id: &str) -> Option<RoomSnapshot> {
        let room_id = self.room_id_for(participant_id)?;
        self.rooms.get(&room_id).map(Room::snapshot)
    }

    /// Proves that the inviter currently belongs to this room without exposing identities.
    #[must_use]
    pub fn valid_invitation(&self, join_code: &str, resume_token: &str) -> bool {
        let Some(code) = normalize_join_code(join_code) else {
            return false;
        };
        let Some(room_id) = self.codes.get(&code) else {
            return false;
        };
        self.tokens.get(resume_token) == Some(room_id)
            && self.rooms.get(room_id).is_some_and(|room| {
                room.members.values().any(|member| {
                    member.resume_token == resume_token && member.participant.connected
                })
            })
    }

    /// Connected members of the room this private proof belongs to.
    pub fn connected_members(&self, join_code: &str, resume_token: &str) -> Option<usize> {
        if !self.valid_invitation(join_code, resume_token) {
            return None;
        }
        let room = self.rooms.get(self.tokens.get(resume_token)?)?;
        Some(room.members.values().filter(|member| member.participant.connected).count())
    }

    /// Shows a member's verified profile roles. `None` when nothing changed.
    pub fn link_roles(
        &mut self,
        join_code: &str,
        resume_token: &str,
        roles: &[crate::SocialRole],
        badges: &[String],
    ) -> Option<HubEvent> {
        if !self.valid_invitation(join_code, resume_token) {
            return None;
        }
        let room_id = self.tokens.get(resume_token)?.clone();
        let room = self.rooms.get_mut(&room_id)?;
        let member = room.members.values_mut().find(|m| m.resume_token == resume_token)?;
        if member.participant.roles == roles && member.participant.badges == badges {
            return None;
        }
        member.participant.roles = roles.to_vec();
        member.participant.badges = badges.to_vec();
        Some(HubEvent::RoomUpdated { room: room.snapshot() })
    }

    fn resume(
        &mut self,
        participant_id: &str,
        resume_token: &str,
        display_name: &str,
    ) -> Result<HubEvent, RoomError> {
        let room_id = self
            .tokens
            .get(resume_token)
            .cloned()
            .ok_or(RoomError::Unauthorized)?;
        let display_name = sanitize_display_name(display_name);
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        let Some(member) = room
            .members
            .values_mut()
            .find(|member| member.resume_token == resume_token)
        else {
            return Err(RoomError::Unauthorized);
        };
        room.disconnected_at = None;
        let old_id = member.participant.id.clone();
        member.participant.id = participant_id.to_owned();
        member.participant.display_name = display_name;
        member.participant.connected = true;
        member.participant.is_host = old_id == room.host_id || participant_id == room.host_id;
        if member.participant.is_host {
            room.host_id = participant_id.to_owned();
            room.host_lost_at = None;
        }
        let you = member.participant.clone();
        let resume_token = member.resume_token.clone();
        if you.is_host && room.resume_playing {
            room.playback.is_playing = room.queue.current.is_some();
            room.playback.server_time_ms = server_now_ms();
            room.playback.revision += 1;
            room.resume_playing = false;
        }
        if old_id != participant_id {
            for entry in room
                .queue
                .items
                .iter_mut()
                .chain(room.queue.current.iter_mut())
            {
                if entry.added_by_id.as_deref() == Some(&old_id) {
                    entry.added_by_id = Some(participant_id.to_owned());
                }
            }
            if let Some(member) = room.members.remove(&old_id) {
                room.members.insert(participant_id.to_owned(), member);
            }
        }
        Ok(HubEvent::Joined {
            room: room.snapshot(),
            you,
            resume_token,
        })
    }

    fn close_room(&mut self, room_id: &str) -> HubEvent {
        let Some(room) = self.rooms.remove(room_id) else {
            return HubEvent::Closed {
                room_id: room_id.to_owned(),
                participant_ids: Vec::new(),
            };
        };
        self.codes.remove(&room.code);
        let mut participant_ids = Vec::new();
        for (id, member) in room.members {
            self.tokens.remove(&member.resume_token);
            participant_ids.push(id);
        }
        HubEvent::Closed {
            room_id: room_id.to_owned(),
            participant_ids,
        }
    }

    fn room_id_for(&self, participant_id: &str) -> Option<String> {
        self.rooms.iter().find_map(|(id, room)| {
            room.members
                .contains_key(participant_id)
                .then(|| id.clone())
        })
    }
}

impl Room {
    /// Makes the longest-present connected member the host. The position
    /// carries on from where the room is; `leaving` keeps it playing (the
    /// guests still are), a lost host resumes what was playing before.
    /// False when nobody else is connected.
    fn hand_over(&mut self, leaving: bool) -> bool {
        let Some(next) = self
            .members
            .values()
            .filter(|member| member.participant.connected && member.participant.id != self.host_id)
            .min_by_key(|member| member.joined_at)
            .map(|member| member.participant.id.clone())
        else {
            return false;
        };
        if let Some(old) = self.members.get_mut(&self.host_id) {
            old.participant.is_host = false;
        }
        if let Some(new) = self.members.get_mut(&next) {
            new.participant.is_host = true;
        }
        let now = server_now_ms();
        self.playback.position_ms = crate::expected_position_ms(
            self.playback.position_ms,
            self.playback.is_playing,
            self.playback.server_time_ms,
            now,
            self.playback.track.as_ref().and_then(|t| t.duration_ms),
        );
        if !leaving {
            self.playback.is_playing = self.resume_playing && self.queue.current.is_some();
        }
        self.playback.server_time_ms = now;
        self.playback.origin_id = next.clone();
        self.playback.revision += 1;
        self.resume_playing = false;
        self.host_lost_at = None;
        self.host_id = next;
        true
    }

    fn member_ids(&self) -> Vec<String> {
        self.members.keys().cloned().collect()
    }

    fn snapshot(&self) -> RoomSnapshot {
        let mut participants = self
            .members
            .values()
            .map(|member| member.participant.clone())
            .collect::<Vec<_>>();
        participants.sort_by(|left, right| left.id.cmp(&right.id));
        RoomSnapshot {
            id: self.id.clone(),
            code: self.code.clone(),
            host_id: self.host_id.clone(),
            control: self.control,
            queue_policy: self.queue_policy,
            host_connected: self
                .members
                .get(&self.host_id)
                .is_some_and(|member| member.participant.connected),
            participants,
            playback: self.playback.clone(),
            queue: self.queue.clone(),
        }
    }
}

fn sanitize_display_name(name: &str) -> String {
    let name = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(MAX_DISPLAY_NAME)
        .collect::<String>()
        .trim()
        .to_owned();
    if name.is_empty() {
        "Hörer".into()
    } else {
        name
    }
}

fn new_token() -> String {
    Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invitation_requires_connected_member_of_exact_room() {
        let mut hub = Hub::new();
        let HubEvent::Created {
            room, resume_token, ..
        } = hub.create_room("one", "One").unwrap()
        else {
            panic!("room");
        };
        let HubEvent::Created { room: other, .. } = hub.create_room("two", "Two").unwrap() else {
            panic!("room");
        };
        assert!(hub.valid_invitation(&room.code, &resume_token));
        assert!(!hub.valid_invitation(&other.code, &resume_token));
        assert!(!hub.valid_invitation(&room.code, "not-the-token"));
        hub.disconnect("one");
        assert!(!hub.valid_invitation(&room.code, &resume_token));
        hub.leave_room("one").unwrap();
        assert!(!hub.valid_invitation(&room.code, &resume_token));
    }

    #[test]
    fn roles_need_the_members_own_proof_and_survive_a_rejoin() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, resume_token, .. } = hub.create_room("one", "One").unwrap() else {
            panic!("room");
        };
        let roles = [crate::SocialRole::Luft];
        assert!(hub.link_roles(&room.code, "forged", &roles, &[]).is_none());
        let Some(HubEvent::RoomUpdated { room: linked }) = hub.link_roles(&room.code, &resume_token, &roles, &[]) else {
            panic!("linked");
        };
        assert_eq!(linked.participants[0].roles, roles);
        // Unchanged roles send nothing.
        assert!(hub.link_roles(&room.code, &resume_token, &roles, &[]).is_none());
        let HubEvent::Joined { room: again, .. } = hub.join_room("one", &room.code, "One", None).unwrap() else {
            panic!("joined");
        };
        assert_eq!(again.participants[0].roles, roles);
    }

    #[test]
    fn host_is_authoritative_and_guests_cannot_steer() {
        let mut hub = Hub::new();
        let created = hub.create_room("host", "Sam").expect("room");
        let HubEvent::Created { room, .. } = created else {
            panic!("expected create");
        };
        hub.join_room("guest", &room.code, "Tester", None)
            .expect("join");
        let denied = hub.apply_intent(
            "guest",
            1,
            PlaybackIntent {
                track: TrackRef::new("spotify", "spotify:track:one"),
                position_ms: 0,
                is_playing: true,
                shuffle: false,
                repeat: RepeatMode::Off,
            },
        );
        assert_eq!(denied, Err(RoomError::HostOnly));
        hub.replace_queue(
            "host",
            1,
            vec![TrackRef::new("spotify", "spotify:track:one").unwrap()],
        )
        .unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        let applied = hub
            .apply_intent(
                "host",
                2,
                PlaybackIntent {
                    track: TrackRef::new("spotify", "spotify:track:one"),
                    position_ms: 1_200,
                    is_playing: true,
                    shuffle: false,
                    repeat: RepeatMode::Off,
                },
            )
            .expect("host intent");
        let HubEvent::Playback {
            state,
            participant_ids,
            ..
        } = applied
        else {
            panic!("expected playback");
        };
        assert!(participant_ids.contains(&"host".to_owned()));
        assert!(participant_ids.contains(&"guest".to_owned()));
        assert_eq!(state.revision, 3);
        assert_eq!(state.position_ms, 1_200);
        assert!(state.is_playing);
    }

    #[test]
    fn stale_queue_revisions_are_rejected() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, .. } = hub.create_room("host", "Sam").expect("room") else {
            panic!("create");
        };
        hub.replace_queue(
            "host",
            1,
            vec![TrackRef::new("spotify", "spotify:track:one").expect("track")],
        )
        .expect("first queue");
        let stale = hub.replace_queue("host", 1, Vec::new());
        assert_eq!(stale, Err(RoomError::StaleRevision));
        assert_eq!(hub.snapshot_for("host").expect("room").queue.revision, 2);
        assert_eq!(room.queue.revision, 1);
    }

    #[test]
    fn reconnect_with_token_restores_host() {
        let mut hub = Hub::new();
        let HubEvent::Created {
            resume_token, room, ..
        } = hub.create_room("host-a", "Sam").expect("room")
        else {
            panic!("create");
        };
        hub.join_room("guest", &room.code, "Tester", None)
            .expect("join");
        hub.disconnect("host-a");
        let HubEvent::Joined {
            you,
            room: restored,
            ..
        } = hub
            .join_room("host-b", &room.code, "Sam", Some(&resume_token))
            .expect("resume")
        else {
            panic!("resume");
        };
        assert!(you.is_host);
        assert_eq!(restored.host_id, "host-b");
        assert!(restored.host_connected);
    }
}
