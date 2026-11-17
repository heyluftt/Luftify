//! Listening rooms across a restart: written next to the database every few
//! seconds and when the server is asked to stop (a deploy), read back once
//! at start. Apps reconnect with their resume tokens as after a network drop.
use std::{path::PathBuf, time::Duration};

use luft_listen_together::SavedRooms;

use crate::hub::SharedHub;

const SAVE_EVERY: Duration = Duration::from_secs(5);

fn path() -> PathBuf {
    std::env::var_os("LUFTIFY_ROOMS_FILE").map(PathBuf::from).unwrap_or_else(|| {
        // Next to the social database, on the same volume.
        std::env::var_os("LUFTIFY_SOCIAL_DATABASE")
            .map(PathBuf::from)
            .and_then(|db| db.parent().map(|dir| dir.join("rooms.json")))
            .unwrap_or_else(|| PathBuf::from("data/rooms.json"))
    })
}

/// Once at start; the file is removed so it never applies twice.
pub async fn restore(hub: &SharedHub) {
    let path = path();
    let Ok(bytes) = tokio::fs::read(&path).await else { return };
    let _ = tokio::fs::remove_file(&path).await;
    match serde_json::from_slice::<SavedRooms>(&bytes) {
        Ok(saved) => {
            let count = hub.restore_rooms(saved).await;
            tracing::info!(rooms = count, "listen-together rooms restored after restart");
        }
        Err(_) => tracing::warn!("saved listen-together rooms unreadable"),
    }
}

async fn save(hub: &SharedHub, had_rooms: &mut bool) {
    let path = path();
    if hub.room_count().await == 0 {
        if std::mem::take(had_rooms) {
            let _ = tokio::fs::remove_file(&path).await;
        }
        return;
    }
    *had_rooms = true;
    let Ok(bytes) = serde_json::to_vec(&hub.save_rooms().await) else { return };
    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    // Renamed into place: a stop mid-write keeps the previous file.
    let temporary = path.with_extension("pending");
    if tokio::fs::write(&temporary, bytes).await.is_ok() && tokio::fs::rename(&temporary, &path).await.is_err() {
        tracing::warn!("listen-together rooms not saved");
    }
}

/// Saves regularly, and once more when asked to stop; then the process ends
/// (open sockets would otherwise hold a graceful shutdown).
pub fn keep_saved(hub: SharedHub) {
    tokio::spawn(async move {
        let mut had_rooms = true;
        let mut timer = tokio::time::interval(SAVE_EVERY);
        // Listening from the start, so a stop between two saves is not missed.
        let stop = stop_requested();
        tokio::pin!(stop);
        loop {
            tokio::select! {
                _ = timer.tick() => save(&hub, &mut had_rooms).await,
                () = &mut stop => {
                    save(&hub, &mut had_rooms).await;
                    tracing::info!("listen-together server stopping");
                    std::process::exit(0);
                }
            }
        }
    });
}

#[cfg(unix)]
async fn stop_requested() {
    use tokio::signal::unix::{SignalKind, signal};
    match signal(SignalKind::terminate()) {
        Ok(mut terminate) => {
            tokio::select! {
                _ = terminate.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
        }
        Err(_) => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

#[cfg(not(unix))]
async fn stop_requested() {
    let _ = tokio::signal::ctrl_c().await;
}
