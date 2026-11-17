use crate::{Hub, HubEvent, RoomError};

pub fn valid_avatar(value: Option<&str>) -> bool {
    value.is_none_or(|value| {
        value.len() <= 20_000
            && value
                .strip_prefix("data:image/jpeg;base64,")
                .is_some_and(|data| {
                    !data.is_empty()
                        && data
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
                })
    })
}

impl Hub {
    pub fn update_profile(
        &mut self,
        participant: &str,
        name: String,
        avatar: Option<String>,
    ) -> Result<HubEvent, RoomError> {
        let name = name.trim();
        if name.is_empty()
            || name.chars().count() > 32
            || name.chars().any(char::is_control)
            || !valid_avatar(avatar.as_deref())
        {
            return Err(RoomError::Unauthorized);
        }
        let room_id = self.room_id_for(participant).ok_or(RoomError::NotInRoom)?;
        let room = self
            .rooms
            .get_mut(&room_id)
            .ok_or(RoomError::RoomNotFound)?;
        let member = room
            .members
            .get_mut(participant)
            .ok_or(RoomError::NotInRoom)?;
        member.participant.display_name = name.into();
        member.participant.avatar_uri = avatar;
        for entry in room
            .queue
            .items
            .iter_mut()
            .chain(room.queue.current.iter_mut())
        {
            if entry.added_by_id.as_deref() == Some(participant) {
                entry.added_by_name = Some(name.into());
            }
        }
        Ok(HubEvent::RoomUpdated {
            room: room.snapshot(),
        })
    }
}
