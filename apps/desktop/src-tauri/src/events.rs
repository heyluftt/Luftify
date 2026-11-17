use std::sync::Arc;
use std::time::Duration;

use luft_core::{PlaybackProvider, PlaybackState};
use luft_infrastructure::DatabaseHandle;
use luft_librespot::LibrespotService;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::listening_analytics::ListeningAnalyticsService;

/// Between state changes the engine only ticks for analytics and for the
/// clock resync below; the UI interpolates on its own in between.
const LIBRESPOT_PROGRESS_TICK: Duration = Duration::from_secs(2);

/// A light clock sample for the window. Unlike a full state event it carries
/// no metadata, so the store treats it as a position update only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    position_ms: u64,
    duration_ms: u64,
    track_uri: Option<String>,
    event_timestamp_ms: u64,
}

fn record_playlist_usage(
    app: &AppHandle,
    database: &DatabaseHandle,
    name: &str,
    payload: &serde_json::Value,
) {
    if name != "player.stateChanged"
        && name != "player.trackChanged"
        && name != "player.playbackChanged"
    {
        return;
    }
    let Some((context_uri, track_uri)) = playlist_context(payload) else {
        return;
    };

    let database = database.clone();
    let app = app.clone();
    let context_uri = context_uri.to_owned();
    let track_uri = track_uri.to_owned();
    tauri::async_runtime::spawn(async move {
        if let Ok(database) = database.get().await
            && database
                .record_playlist_play(&context_uri, &track_uri)
                .await
                .is_ok()
        {
            let _ = app.emit("home://playlist-usage-changed", ());
        }
    });
}

fn playlist_context(payload: &serde_json::Value) -> Option<(&str, &str)> {
    if payload
        .get("isPlaying")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return None;
    }
    let context_uri = payload.get("contextUri")?.as_str()?;
    let track_uri = payload
        .get("currentItem")
        .and_then(|item| item.get("uri"))
        .and_then(serde_json::Value::as_str)?;
    if !context_uri.starts_with("spotify:playlist:") {
        return None;
    }
    Some((context_uri, track_uri))
}

fn playback_tooltip(payload: &serde_json::Value) -> Option<String> {
    let item = payload.get("currentItem")?;
    let title = item.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }
    let artist = item
        .get("creators")
        .and_then(serde_json::Value::as_array)
        .and_then(|creators| creators.first())
        .and_then(|creator| creator.get("name"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim();
    Some(if artist.is_empty() {
        title.to_owned()
    } else {
        format!("{title} – {artist}")
    })
}

/// A song waits for Spotify's audio key limit until `ready_at_ms` (Unix ms);
/// `None` once nothing waits. The window says so instead of seeming to hang.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyWaitEvent {
    ready_at_ms: Option<u64>,
}

pub fn forward_key_waits(app: AppHandle) {
    luft_librespot::observe_key_waits(move |until| {
        let ready_at_ms = until
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|since| since.as_millis() as u64);
        let _ = app.emit("player://key-wait", KeyWaitEvent { ready_at_ms });
    });
}

/// Pushes every Librespot status change to the window. The window polled
/// every 2 s before, so library, home and search waited up to 2 s after the
/// session was already ready (typically ready at 0.5 s, noticed at 2.3 s).
pub fn forward_librespot_status(app: AppHandle, librespot: Arc<LibrespotService>) {
    tauri::async_runtime::spawn(async move {
        let mut status = librespot.subscribe_status();
        loop {
            let current = status.borrow_and_update().clone();
            let _ = app.emit("librespot://status", &current);
            if status.changed().await.is_err() {
                break;
            }
        }
    });
}

pub fn forward_librespot_playback(
    app: AppHandle,
    librespot: Arc<LibrespotService>,
    listening_analytics: ListeningAnalyticsService,
    database: DatabaseHandle,
) {
    tauri::async_runtime::spawn(async move {
        let mut playback = librespot.subscribe_playback();
        let mut last_uri: Option<String> = None;
        let mut last_queue_revision: Option<u64> = None;
        let mut progress = tokio::time::interval(LIBRESPOT_PROGRESS_TICK);
        progress.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        progress.tick().await;
        let state = playback.borrow().clone();
        publish_librespot_observation(&app, &database, &listening_analytics, &mut last_uri, state)
            .await;
        emit_queue_if_changed(&app, &librespot, &mut last_queue_revision).await;
        loop {
            tokio::select! {
                changed = playback.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    let state = playback.borrow().clone();
                    publish_librespot_observation(
                        &app,
                        &database,
                        &listening_analytics,
                        &mut last_uri,
                        state,
                    )
                    .await;
                    emit_queue_if_changed(&app, &librespot, &mut last_queue_revision).await;
                }
                _ = progress.tick() => {
                    let Ok(state) = librespot.get_state().await else {
                        continue;
                    };
                    emit_progress(&app, &state);
                    if let Ok(payload) = serde_json::to_value(&state) {
                        listening_analytics.playback_event("player.playbackChanged", &payload).await;
                    }
                }
            }
        }
    });
}

/// Only a live clock is worth a sample: a paused or still loading player
/// would otherwise drag the window clock back to a stale position.
fn emit_progress(app: &AppHandle, state: &PlaybackState) {
    if !state.is_playing || !state.clock_ready {
        return;
    }
    let _ = app.emit(
        "player://progress-changed",
        ProgressEvent {
            position_ms: state.position_ms,
            duration_ms: state.duration_ms,
            track_uri: state.current_item.as_ref().map(|item| item.uri.clone()),
            event_timestamp_ms: timestamp_ms(),
        },
    );
}

fn timestamp_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}

async fn emit_queue_if_changed(
    app: &AppHandle,
    librespot: &LibrespotService,
    last_revision: &mut Option<u64>,
) {
    let revision = librespot.queue_revision().await;
    if *last_revision == Some(revision) {
        return;
    }
    *last_revision = Some(revision);
    let _ = app.emit("queue://changed", ());
}

async fn publish_librespot_observation(
    app: &AppHandle,
    database: &DatabaseHandle,
    listening_analytics: &ListeningAnalyticsService,
    last_uri: &mut Option<String>,
    state: PlaybackState,
) {
    let uri = state.current_item.as_ref().map(|item| item.uri.clone());
    let Ok(payload) = serde_json::to_value(&state) else {
        return;
    };
    let track_changed = uri != *last_uri;
    let event_name = if track_changed {
        "player.trackChanged"
    } else {
        "player.playbackChanged"
    };
    crate::thumbbar::set_playing(app, state.is_playing);
    crate::tray::set_playing(app, state.is_playing);
    crate::tray::set_tooltip(app, playback_tooltip(&payload).as_deref().unwrap_or(""));
    if track_changed {
        let _ = app.emit("player://track-changed", &payload);
    }
    let _ = app.emit("player://state-changed", &payload);
    *last_uri = uri;
    listening_analytics
        .playback_event(event_name, &payload)
        .await;
    if listening_analytics.is_enabled() {
        record_playlist_usage(app, database, event_name, &payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_uses_track_and_artist_only() {
        let payload =
            serde_json::json!({"currentItem":{"title":"Song","creators":[{"name":"Artist"}]}});
        assert_eq!(playback_tooltip(&payload).as_deref(), Some("Song – Artist"));
    }

    #[test]
    fn playlist_usage_requires_a_playlist_context_and_track() {
        let playlist = serde_json::json!({
            "contextUri": "spotify:playlist:luft",
            "isPlaying": true,
            "currentItem": { "uri": "spotify:track:one" }
        });
        let album = serde_json::json!({
            "contextUri": "spotify:album:test",
            "isPlaying": true,
            "currentItem": { "uri": "spotify:track:one" }
        });
        assert!(playlist_context(&playlist).is_some());
        assert!(playlist_context(&album).is_none());
    }

    #[test]
    fn progress_samples_are_camel_case() {
        let value = serde_json::to_value(ProgressEvent {
            position_ms: 12_000,
            duration_ms: 200_000,
            track_uri: Some("spotify:track:one".into()),
            event_timestamp_ms: 5,
        })
        .expect("event");
        assert_eq!(value["positionMs"], 12_000);
        assert_eq!(value["eventTimestampMs"], 5);
    }
}
