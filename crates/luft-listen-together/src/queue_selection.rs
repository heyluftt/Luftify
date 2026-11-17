//! A deliberate song switch is one authoritative operation, never add + skip.
use super::*;

pub(super) fn play_now(
    room: &mut Room,
    participant: &str,
    track: TrackRef,
) -> Result<(), RoomError> {
    if !room.may_control(participant) {
        return Err(RoomError::HostOnly);
    }
    let track = track
        .sanitize()
        .filter(valid_track)
        .ok_or(RoomError::InvalidQueue)?;
    // A search hit already in the playlist consumes its first occurrence. Other
    // duplicates and the remaining playlist keep their order and attribution.
    let entry = if let Some(at) = room
        .queue
        .items
        .iter()
        .position(|entry| entry.track.key() == track.key())
    {
        room.queue.items.remove(at)
    } else {
        QueueEntry {
            id: Uuid::new_v4().to_string(),
            track,
            added_by_id: Some(participant.to_owned()),
            added_by_name: room
                .members
                .get(participant)
                .map(|member| member.participant.display_name.clone()),
            group: None,
        }
    };
    // The new song becomes current directly, including when all 200 waiting
    // slots are occupied. The old current is skipped; no playlist is cleared.
    start_entry(room, participant, Some(entry));
    Ok(())
}

pub(super) fn play_queued(room: &mut Room, participant: &str, id: &str) -> Result<(), RoomError> {
    if !room.may_control(participant) {
        return Err(RoomError::HostOnly);
    }
    let at = room
        .queue
        .items
        .iter()
        .position(|entry| entry.id == id)
        .ok_or(RoomError::StaleRevision)?;
    let entry = room.queue.items.remove(at);
    start_entry(room, participant, Some(entry));
    Ok(())
}

#[cfg(test)]
#[path = "queue_selection_tests.rs"]
mod tests;
