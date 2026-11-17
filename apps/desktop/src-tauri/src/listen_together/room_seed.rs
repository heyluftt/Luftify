//! A new room starts with what the host is listening to: the current song,
//! where it is, and the next songs of the host's queue. Guests who join hear
//! it at once instead of an empty room, and the host's music keeps playing.
use super::*;
use luft_core::MediaItem;
use luft_listen_together::{MAX_BATCH_TRACKS, MAX_QUEUE_ITEMS, QueueEdit};

pub(super) struct Seed {
    pub uri: String,
    track: TrackRef,
    upcoming: Vec<TrackRef>,
    pub at: Instant,
    sent: bool,
}

/// Until the room has taken the song, the host must not pause for an empty queue.
pub(super) const SEED_PATIENCE: Duration = Duration::from_secs(5);

fn track_ref(item: &MediaItem) -> Option<TrackRef> {
    if !item.uri.starts_with("spotify:track:") {
        return None;
    }
    let mut track = TrackRef::new("spotify", item.uri.clone())?;
    track.title = Some(item.title.clone());
    track.cover_uri = item.cover_uri.clone();
    track.artists = item.creators.iter().map(|artist| artist.name.clone()).collect();
    track.duration_ms = item.duration_ms.filter(|duration| *duration > 0);
    track.sanitize()
}

/// What the host plays right now, if anything; read before the room pauses it.
pub(super) async fn prepare(provider: &dyn SpotifyProvider) -> Option<Seed> {
    let state = provider.get_state().await.ok().filter(|state| state.is_playing)?;
    let mut track = track_ref(state.current_item.as_ref()?)?;
    track.duration_ms = track.duration_ms.or(Some(state.duration_ms).filter(|duration| *duration > 0));
    let upcoming = match tokio::time::timeout(Duration::from_secs(2), provider.get_queue()).await {
        Ok(Ok(queue)) => queue.items.iter().filter_map(|entry| track_ref(&entry.item)).take(MAX_QUEUE_ITEMS).collect(),
        _ => Vec::new(),
    };
    Some(Seed { uri: track.uri.clone(), track, upcoming, at: Instant::now(), sent: false })
}

#[cfg(test)]
impl Seed {
    /// The mock player's songs are no Spotify tracks, so tests seed directly.
    pub fn sent_for(uri: &str) -> Self {
        Seed { uri: uri.into(), track: TrackRef::new("spotify", uri).unwrap(), upcoming: Vec::new(), at: Instant::now(), sent: true }
    }
}

/// Hands the song and the queue to the room, once.
pub(super) async fn send(sink: &mut Option<connection::Sender>, session: &mut Session) {
    let Some(room_id) = session.room.as_ref().map(|room| room.id.clone()) else { return };
    let Some(seed) = session.queue_runtime.seed.as_mut().filter(|seed| !seed.sent) else { return };
    seed.sent = true;
    let play = ClientMessage::QueueEdit {
        room_id: room_id.clone(),
        operation_id: Uuid::new_v4().to_string(),
        edit: QueueEdit::PlayNow { track: seed.track.clone() },
    };
    if send_msg(sink, play).await.is_err() {
        session.queue_runtime.seed = None;
        return;
    }
    let upcoming = std::mem::take(&mut seed.upcoming);
    for tracks in upcoming.chunks(MAX_BATCH_TRACKS) {
        if send_msg(sink, ClientMessage::QueueEdit {
            room_id: room_id.clone(),
            operation_id: Uuid::new_v4().to_string(),
            edit: QueueEdit::AddMany { tracks: tracks.to_vec(), next: false, group: None },
        }).await.is_err() { break; }
    }
}

/// The room now plays the song the host already plays: keep it running
/// where it is instead of starting it over; the next publish sends the
/// real position. Clears the seed either way once the room has a song.
pub(super) fn keeps_playing(session: &mut Session, room: &RoomSnapshot) -> bool {
    let Some(current) = room.queue.current.as_ref() else { return false };
    let Some(seed) = session.queue_runtime.seed.take() else { return false };
    current.track.uri == seed.uri
}
