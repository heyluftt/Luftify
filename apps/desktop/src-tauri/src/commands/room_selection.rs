//! Normal play clicks and explicit queue additions have different room intent.
use crate::{error::CommandError, state::AppState};
use luft_core::MediaItem;
use luft_listen_together::{QueueEdit, TrackRef};

pub(crate) async fn select_in_room(
    state: &AppState,
    uri: &str,
    tracks: Option<&[MediaItem]>,
) -> Result<bool, CommandError> {
    edit_in_room(state, uri, tracks, true).await
}

pub(crate) async fn enqueue_in_room(
    state: &AppState,
    uri: &str,
    tracks: Option<&[MediaItem]>,
) -> Result<bool, CommandError> {
    edit_in_room(state, uri, tracks, false).await
}

async fn edit_in_room(
    state: &AppState,
    uri: &str,
    tracks: Option<&[MediaItem]>,
    select: bool,
) -> Result<bool, CommandError> {
    let status = state.listen_together.status().await;
    let Some(room_id) = status.room_id else {
        return Ok(false);
    };
    let track = selection_track(uri, tracks)?;
    let edit = selection_edit(track, select, status.can_control);
    state
        .listen_together
        .edit_queue(room_id, edit)
        .await
        .map_err(CommandError::internal)?;
    Ok(true)
}

fn selection_edit(track: TrackRef, select: bool, can_control: bool) -> QueueEdit {
    if select && can_control {
        QueueEdit::PlayNow { track }
    } else {
        QueueEdit::Add { track }
    }
}

fn selection_track(uri: &str, tracks: Option<&[MediaItem]>) -> Result<TrackRef, CommandError> {
    let mut track = TrackRef::new("spotify", uri)
        .ok_or_else(|| CommandError::internal("listen.queueConflict"))?;
    if let Some(item) = tracks.and_then(|tracks| tracks.iter().find(|item| item.uri == uri)) {
        track.title = Some(item.title.clone());
        track.cover_uri = item.cover_uri.clone();
        track.artists = item
            .creators
            .iter()
            .map(|artist| artist.name.clone())
            .collect();
        track.duration_ms = item.duration_ms;
    }
    Ok(track)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_clicks_steer_but_explicit_adds_and_locked_guests_only_queue() {
        let track = TrackRef::new("spotify", "spotify:track:0000000000000000000001").unwrap();
        assert!(matches!(
            selection_edit(track.clone(), true, true),
            QueueEdit::PlayNow { .. }
        ));
        assert!(matches!(
            selection_edit(track.clone(), false, true),
            QueueEdit::Add { .. }
        ));
        assert!(matches!(
            selection_edit(track, true, false),
            QueueEdit::Add { .. }
        ));
    }
}
