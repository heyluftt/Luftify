use super::*;
use crate::{MAX_BATCH_TRACKS, QueueEdit, QueueEntry, QueueGroup};
use rand::seq::SliceRandom;

#[path = "queue_selection.rs"]
mod selection;

impl Hub {
    pub fn edit_queue(
        &mut self,
        participant: &str,
        room_id: &str,
        operation_id: &str,
        edit: QueueEdit,
    ) -> Result<HubEvent, RoomError> {
        if self.room_id_for(participant).as_deref() != Some(room_id) {
            return Err(RoomError::NotInRoom);
        }
        if Uuid::parse_str(operation_id).is_err() {
            return Err(RoomError::InvalidQueue);
        }
        let room = self.rooms.get_mut(room_id).ok_or(RoomError::RoomNotFound)?;
        let key = format!("{participant}:{operation_id}");
        let mut advanced = false;
        if !room.queue_operations.contains(&key) {
            match edit {
                QueueEdit::PlayNow { track } => {
                    selection::play_now(room, participant, track)?;
                    advanced = true;
                }
                QueueEdit::PlayQueued { id } => {
                    selection::play_queued(room, participant, &id)?;
                    advanced = true;
                }
                QueueEdit::Add { track } => {
                    let track = track
                        .sanitize()
                        .filter(valid_track)
                        .ok_or(RoomError::InvalidQueue)?;
                    if room.queue.items.len() >= MAX_QUEUE_ITEMS {
                        return Err(RoomError::InvalidQueue);
                    }
                    room.queue.items.push(QueueEntry {
                        id: Uuid::new_v4().to_string(),
                        track,
                        added_by_id: Some(participant.to_owned()),
                        added_by_name: room
                            .members
                            .get(participant)
                            .map(|member| member.participant.display_name.clone()),
                        group: None,
                    });
                }
                QueueEdit::AddMany { tracks, next, group } => {
                    let group = group.and_then(sanitize_group);
                    if tracks.len() > MAX_BATCH_TRACKS {
                        return Err(RoomError::InvalidQueue);
                    }
                    let free = MAX_QUEUE_ITEMS.saturating_sub(room.queue.items.len());
                    let name = room
                        .members
                        .get(participant)
                        .map(|member| member.participant.display_name.clone());
                    // Unplayable songs are skipped; a full queue takes what fits.
                    let entries: Vec<_> = tracks
                        .into_iter()
                        .filter_map(|track| track.sanitize().filter(valid_track))
                        .take(free)
                        .map(|track| QueueEntry {
                            id: Uuid::new_v4().to_string(),
                            track,
                            added_by_id: Some(participant.to_owned()),
                            added_by_name: name.clone(),
                            group: group.clone(),
                        })
                        .collect();
                    if entries.is_empty() {
                        return Err(RoomError::InvalidQueue);
                    }
                    if next {
                        room.queue.items.splice(0..0, entries);
                    } else {
                        room.queue.items.extend(entries);
                    }
                }
                QueueEdit::Shuffle | QueueEdit::Clear if !room.may_control(participant) => {
                    return Err(RoomError::HostOnly);
                }
                QueueEdit::Shuffle => {
                    room.queue.items.shuffle(&mut rand::rng());
                    // Shuffled songs no longer form playlist blocks.
                    room.queue.items.iter_mut().for_each(|entry| entry.group = None);
                }
                QueueEdit::Clear => room.queue.items.clear(),
                QueueEdit::Remove { id } => {
                    // Explicitly removing the playing occurrence advances once.
                    // A delayed repeated removal can never skip its successor.
                    if let Some(current) = room.queue.current.as_ref().filter(|e| e.id == id) {
                        // Skipping someone else's song is steering; a guest may
                        // always drop their own.
                        let own = current.added_by_id.as_deref() == Some(participant);
                        if !own && !room.may_control(participant) {
                            return Err(RoomError::HostOnly);
                        }
                        start_next(room, participant);
                        advanced = true;
                    } else {
                        if room.queue.items.iter().any(|e| e.id == id && !room.may_edit(participant, e)) {
                            return Err(RoomError::HostOnly);
                        }
                        room.queue.items.retain(|entry| entry.id != id);
                    }
                }
                QueueEdit::RemoveMany { ids } => {
                    if ids.len() > MAX_QUEUE_ITEMS {
                        return Err(RoomError::InvalidQueue);
                    }
                    let ids: std::collections::HashSet<_> = ids.into_iter().collect();
                    // All or nothing: one protected song keeps the whole edit out.
                    if room.queue.items.iter().any(|e| ids.contains(&e.id) && !room.may_edit(participant, e)) {
                        return Err(RoomError::HostOnly);
                    }
                    room.queue.items.retain(|entry| !ids.contains(&entry.id));
                }
                QueueEdit::MoveMany { ids, before_id } => {
                    if ids.len() > MAX_QUEUE_ITEMS {
                        return Err(RoomError::InvalidQueue);
                    }
                    let ids: std::collections::HashSet<_> = ids.into_iter().collect();
                    if before_id.as_ref().is_some_and(|id| ids.contains(id)) {
                        return Err(RoomError::InvalidQueue);
                    }
                    if before_id.as_ref().is_some_and(|id| !room.queue.items.iter().any(|e| &e.id == id)) {
                        return Err(RoomError::StaleRevision);
                    }
                    if room.queue.items.iter().any(|e| ids.contains(&e.id) && !room.may_edit(participant, e)) {
                        return Err(RoomError::HostOnly);
                    }
                    if !room.queue.items.iter().any(|e| ids.contains(&e.id)) {
                        return Err(RoomError::StaleRevision);
                    }
                    let (moved, mut rest): (Vec<_>, Vec<_>) =
                        std::mem::take(&mut room.queue.items).into_iter().partition(|e| ids.contains(&e.id));
                    let at = before_id
                        .and_then(|id| rest.iter().position(|e| e.id == id))
                        .unwrap_or(rest.len());
                    rest.splice(at..at, moved);
                    room.queue.items = rest;
                }
                QueueEdit::Move { id, before_id } => {
                    let source = room
                        .queue
                        .items
                        .iter()
                        .position(|e| e.id == id)
                        .ok_or(RoomError::StaleRevision)?;
                    if !room.may_edit(participant, &room.queue.items[source]) {
                        return Err(RoomError::HostOnly);
                    }
                    if before_id.as_deref() == Some(&id) {
                        return Err(RoomError::InvalidQueue);
                    }
                    // Validate the anchor before removing anything. A consumed/removed
                    // anchor is a conflict, not permission to move to an arbitrary index.
                    if before_id
                        .as_ref()
                        .is_some_and(|id| !room.queue.items.iter().any(|e| &e.id == id))
                    {
                        return Err(RoomError::StaleRevision);
                    }
                    let entry = room.queue.items.remove(source);
                    let destination = before_id
                        .and_then(|id| room.queue.items.iter().position(|e| e.id == id))
                        .unwrap_or(room.queue.items.len());
                    room.queue.items.insert(destination, entry);
                }
            }
            room.queue.revision += 1;
            room.queue_operations.push_back(key);
            if room.queue_operations.len() > 256 {
                room.queue_operations.pop_front();
            }
        }
        if advanced {
            Ok(HubEvent::RoomUpdated {
                room: room.snapshot(),
            })
        } else {
            Ok(HubEvent::Queue {
                room_id: room.id.clone(),
                participant_ids: room.member_ids(),
                queue: room.queue.clone(),
            })
        }
    }

    pub fn advance_queue(
        &mut self,
        participant: &str,
        room_id: &str,
        current_id: Option<&str>,
    ) -> Result<HubEvent, RoomError> {
        if self.room_id_for(participant).as_deref() != Some(room_id) {
            return Err(RoomError::NotInRoom);
        }
        let room = self.rooms.get_mut(room_id).ok_or(RoomError::RoomNotFound)?;
        if room.host_id != participant {
            return Err(RoomError::HostOnly);
        }
        // Atomic compare-and-swap against the playing occurrence. Rapid moves
        // commit before or after this boundary; they cannot change its result.
        if room.queue.current.as_ref().map(|e| e.id.as_str()) != current_id {
            return Err(RoomError::StaleRevision);
        }
        room.queue.revision += 1;
        start_next(room, participant);
        Ok(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }
}

fn start_next(room: &mut Room, participant: &str) {
    let next = if room.queue.items.is_empty() {
        None
    } else {
        Some(room.queue.items.remove(0))
    };
    start_entry(room, participant, next);
}

fn start_entry(room: &mut Room, participant: &str, entry: Option<QueueEntry>) {
    room.queue.current = entry;
    room.playback.revision += 1;
    room.playback.track = room.queue.current.as_ref().map(|e| e.track.clone());
    room.playback.position_ms = 0;
    room.playback.is_playing = room.queue.current.is_some();
    if !room
        .members
        .get(&room.host_id)
        .is_some_and(|m| m.participant.connected)
    {
        room.resume_playing = room.playback.is_playing;
        room.playback.is_playing = false;
    }
    room.playback.shuffle = false;
    room.playback.repeat = RepeatMode::One;
    room.playback.origin_id = participant.to_owned();
    room.playback.server_time_ms = server_now_ms();
}

fn sanitize_group(group: QueueGroup) -> Option<QueueGroup> {
    let name: String = group.name.trim().chars().filter(|c| !c.is_control()).take(100).collect();
    (Uuid::parse_str(&group.id).is_ok() && !name.is_empty()).then_some(QueueGroup { id: group.id, name })
}

fn valid_track(track: &TrackRef) -> bool {
    track.provider == "spotify"
        && track
            .uri
            .strip_prefix("spotify:track:")
            .is_some_and(|id| id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

#[cfg(test)]
#[path = "shared_queue_tests.rs"]
mod tests;
