//! Rooms across a server restart (a deploy): the server writes them to disk
//! and reads them back on start. Everyone then counts as briefly
//! disconnected and returns with their resume token, as after a network drop.
use super::*;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// A restart that took longer than the reconnect grace closes the rooms anyway.
const MAX_SAVED_AGE_MS: i64 = 120_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRooms {
    saved_at_ms: i64,
    rooms: Vec<SavedRoom>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedRoom {
    id: String,
    code: String,
    host_id: String,
    control: ControlMode,
    queue_policy: crate::QueuePolicy,
    members: Vec<SavedMember>,
    playback: AuthoritativePlayback,
    queue: QueueSnapshot,
    queue_operations: Vec<String>,
    resume_playing: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedMember {
    participant: Participant,
    // Secret: lets its owner back in. Lives only on the server volume.
    resume_token: String,
    /// Keeps the order for a host handover.
    joined_ago_ms: u64,
}

impl Hub {
    #[must_use]
    pub fn save(&self) -> SavedRooms {
        let now = Instant::now();
        SavedRooms {
            saved_at_ms: server_now_ms(),
            rooms: self
                .rooms
                .values()
                .map(|room| SavedRoom {
                    id: room.id.clone(),
                    code: room.code.clone(),
                    host_id: room.host_id.clone(),
                    control: room.control,
                    queue_policy: room.queue_policy,
                    members: room
                        .members
                        .values()
                        .map(|member| SavedMember {
                            participant: member.participant.clone(),
                            resume_token: member.resume_token.clone(),
                            joined_ago_ms: now.duration_since(member.joined_at).as_millis() as u64,
                        })
                        .collect(),
                    playback: room.playback.clone(),
                    queue: room.queue.clone(),
                    queue_operations: room.queue_operations.iter().cloned().collect(),
                    resume_playing: room.resume_playing,
                })
                .collect(),
        }
    }

    /// Takes rooms back from `save`; returns how many. The music keeps its
    /// clock (positions follow server time), nobody is connected yet, and a
    /// host who does not return is replaced after `HOST_HANDOFF_AFTER`.
    pub fn restore(&mut self, saved: SavedRooms) -> usize {
        let age = server_now_ms() - saved.saved_at_ms;
        if !(0..MAX_SAVED_AGE_MS).contains(&age) {
            return 0;
        }
        let now = Instant::now();
        let mut restored = 0;
        for room in saved.rooms {
            let taken = self.rooms.contains_key(&room.id)
                || self.codes.contains_key(&room.code)
                || room.members.iter().any(|member| self.tokens.contains_key(&member.resume_token));
            if taken || room.members.is_empty() || normalize_join_code(&room.code).as_deref() != Some(room.code.as_str()) {
                continue;
            }
            let members: HashMap<String, Member> = room
                .members
                .into_iter()
                .map(|saved| {
                    let mut participant = saved.participant;
                    participant.connected = false;
                    let joined_at = now.checked_sub(Duration::from_millis(saved.joined_ago_ms)).unwrap_or(now);
                    (participant.id.clone(), Member { participant, resume_token: saved.resume_token, joined_at })
                })
                .collect();
            for member in members.values() {
                self.tokens.insert(member.resume_token.clone(), room.id.clone());
            }
            self.codes.insert(room.code.clone(), room.id.clone());
            self.rooms.insert(
                room.id.clone(),
                Room {
                    id: room.id,
                    code: room.code,
                    host_id: room.host_id,
                    control: room.control,
                    queue_policy: room.queue_policy,
                    members,
                    playback: room.playback,
                    queue: room.queue,
                    queue_operations: room.queue_operations.into(),
                    resume_playing: room.resume_playing,
                    disconnected_at: Some(now),
                    host_lost_at: Some(now),
                },
            );
            restored += 1;
        }
        restored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rooms_come_back_after_a_restart_with_their_music_and_tokens() {
        let mut hub = Hub::new();
        let HubEvent::Created { room, resume_token: host_token, .. } = hub.create_room("host", "Host").unwrap() else { panic!() };
        let HubEvent::Joined { resume_token: guest_token, .. } = hub.join_room("guest", &room.code, "Guest", None).unwrap() else { panic!() };
        hub.replace_queue("host", 1, vec![TrackRef::new("spotify", "spotify:track:one").unwrap()]).unwrap();
        hub.advance_queue("host", &room.id, None).unwrap();
        let before = hub.snapshot_for("host").unwrap();

        let json = serde_json::to_string(&hub.save()).unwrap();
        let mut restarted = Hub::new();
        assert_eq!(restarted.restore(serde_json::from_str(&json).unwrap()), 1);
        assert_eq!(restarted.room_count(), 1);

        // The guest is back first and the music did not stop.
        let HubEvent::Joined { room: back, you, .. } = restarted.join_room("guest-2", &room.code, "Guest", Some(&guest_token)).unwrap() else { panic!() };
        assert!(!you.is_host);
        assert!(back.playback.is_playing);
        assert_eq!(back.queue.current.as_ref().map(|entry| &entry.id), before.queue.current.as_ref().map(|entry| &entry.id));
        assert!(!back.host_connected);
        let HubEvent::Joined { you, .. } = restarted.join_room("host-2", &room.code, "Host", Some(&host_token)).unwrap() else { panic!() };
        assert!(you.is_host);
        assert!(restarted.hand_over_lost_hosts().is_empty());

        // Too old: a restart longer than the grace closes the rooms.
        let mut stale: SavedRooms = serde_json::from_str(&json).unwrap();
        stale.saved_at_ms -= MAX_SAVED_AGE_MS;
        assert_eq!(Hub::new().restore(stale), 0);
    }
}
