use luft_infrastructure::{Creator, DatabaseHandle, ListeningSessionRecord, TrackSnapshot};
use tauri::{AppHandle, Emitter};
use tracing::warn;

use super::tracker::SessionData;
pub(super) async fn persist(
    app: &AppHandle,
    database: &DatabaseHandle,
    session: SessionData,
    last_persisted: &mut Option<ListeningSessionRecord>,
) {
    let record = session_record(session);
    if checkpoint_is_unchanged(last_persisted, &record) {
        return;
    }
    let result = match database.get().await {
        Ok(database) => database.upsert_listening_session(&record).await,
        Err(error) => {
            warn!(error = %error, "listening analytics database unavailable");
            return;
        }
    };
    match result {
        Ok(()) => {
            // Only acknowledge successful writes: failures retry on the next checkpoint.
            *last_persisted = Some(record);
            let _ = app.emit("analytics://changed", ());
        }
        Err(error) => warn!(error = %error, "listening analytics checkpoint failed"),
    }
}

pub(super) async fn clear_database(
    app: &AppHandle,
    database: &DatabaseHandle,
) -> Result<(), String> {
    let database = database.get().await.map_err(|error| error.to_string())?;
    database
        .clear_listening_analytics()
        .await
        .map_err(|error| error.to_string())?;
    let _ = app.emit("analytics://changed", ());
    Ok(())
}

pub(super) fn checkpoint_is_unchanged(
    last: &Option<ListeningSessionRecord>,
    next: &ListeningSessionRecord,
) -> bool {
    last.as_ref() == Some(next)
}

fn session_record(session: SessionData) -> ListeningSessionRecord {
    ListeningSessionRecord {
        id: session.id,
        track: TrackSnapshot {
            uri: session.track.uri,
            item_type: session.track.item_type,
            title: session.track.title,
            creators: session
                .track
                .creators
                .into_iter()
                .map(|creator| Creator {
                    name: creator.name,
                    uri: creator.uri,
                })
                .collect(),
            album_uri: session.track.album_uri,
            album_name: session.track.album_name,
            duration_ms: session.track.duration_ms,
            cover_uri: session.track.cover_uri,
        },
        context_uri: session.context_uri,
        context_name: session.context_name,
        context_type: session.context_type,
        source: session.source,
        started_at_ms: session.started_at_ms,
        ended_at_ms: session.ended_at_ms,
        start_position_ms: session.start_position_ms,
        end_position_ms: session.end_position_ms,
        listened_ms: session.listened_ms,
        qualified_play: session.qualified_play,
        completed: session.completed,
        seek_count: session.seek_count,
        pause_count: session.pause_count,
        repeat_cycle: session.repeat_cycle,
        end_reason: session.end_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::checkpoint_is_unchanged;
    use luft_infrastructure::{Creator, ListeningSessionRecord, TrackSnapshot};

    fn record(listened_ms: u64, pause_count: u32) -> ListeningSessionRecord {
        ListeningSessionRecord {
            id: "session-1".into(),
            track: TrackSnapshot {
                uri: "spotify:track:one".into(),
                item_type: "track".into(),
                title: "Track".into(),
                creators: vec![Creator {
                    name: "Artist".into(),
                    uri: None,
                }],
                album_uri: None,
                album_name: None,
                duration_ms: Some(180_000),
                cover_uri: None,
            },
            context_uri: None,
            context_name: None,
            context_type: "unknown".into(),
            source: "spotifyInternal".into(),
            started_at_ms: 1_000,
            ended_at_ms: None,
            start_position_ms: Some(0),
            end_position_ms: Some(listened_ms),
            listened_ms,
            qualified_play: false,
            completed: false,
            seek_count: 0,
            pause_count,
            repeat_cycle: 0,
            end_reason: None,
        }
    }

    #[test]
    fn unchanged_paused_checkpoint_is_ignored() {
        let first = record(12_000, 1);
        assert!(checkpoint_is_unchanged(&Some(first.clone()), &first));
        assert!(!checkpoint_is_unchanged(&None, &first));
        assert!(!checkpoint_is_unchanged(
            &Some(first.clone()),
            &record(12_000, 2)
        ));
    }
}
