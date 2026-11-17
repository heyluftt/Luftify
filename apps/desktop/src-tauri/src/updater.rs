//! In-app updates from the Luftify server (`/updates/latest.json`). Checking
//! and downloading stay in Rust; the webview only asks and shows progress.
//! Without the server, a newer release on GitHub is offered for download
//! by hand (`release_page.rs`).
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

use crate::error::CommandError;

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    /// None when this version is the newest.
    pub version: Option<String>,
    pub notes: Option<String>,
    /// English notes (`notesEn` in latest.json), published from 0.1.11 on.
    pub notes_en: Option<String>,
    pub date: Option<String>,
    /// Found on the release page: to download by hand, not installable here.
    pub manual: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn app_update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<UpdateInfo, CommandError> {
    let current_version = app.package_info().version.to_string();
    let checked = app
        .updater()
        .map_err(|_| CommandError::internal("update.error.unavailable"))?
        .check()
        .await;
    let update = match checked {
        Ok(update) => update,
        Err(error) => {
            tracing::warn!(%error, "update check failed");
            let release = crate::release_page::newer_release(&current_version).await.map_err(|error| {
                tracing::warn!(%error, "release page check failed");
                CommandError::internal("update.error.check")
            })?;
            *pending.0.lock().await = None;
            return Ok(UpdateInfo {
                current_version,
                version: release.as_ref().map(|release| release.version.clone()),
                notes: release.as_ref().and_then(|release| release.notes.clone()),
                notes_en: release.and_then(|release| release.notes_en),
                date: None,
                manual: true,
            });
        }
    };
    let info = UpdateInfo {
        current_version,
        version: update.as_ref().map(|update| update.version.clone()),
        notes: update.as_ref().and_then(|update| update.body.clone()).filter(|notes| !notes.trim().is_empty()),
        notes_en: update.as_ref()
            .and_then(|update| update.raw_json.get("notesEn")?.as_str().map(str::to_owned))
            .filter(|notes| !notes.trim().is_empty()),
        date: update.as_ref().and_then(|update| update.date.map(|date| date.to_string())),
        manual: false,
    };
    *pending.0.lock().await = update;
    Ok(info)
}

/// Downloads and verifies the signed installer, closes Luftify cleanly and
/// starts the installer, which opens the new version when it is done.
#[tauri::command]
pub async fn app_update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<(), CommandError> {
    // Kept until it is installed, so a failed download can simply be retried.
    let Some(update) = pending.0.lock().await.clone() else {
        return Err(CommandError::internal("update.error.none"));
    };
    let mut downloaded = 0u64;
    let progress = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit("update://progress", UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|error| {
            tracing::warn!(%error, "update download failed");
            CommandError::internal("update.error.download")
        })?;
    // Rooms, friends presence, analytics and the database close first, as on a normal exit.
    crate::lifecycle::prepare_exit(&app).await;
    update.install(bytes).map_err(|error| {
        tracing::warn!(%error, "update install failed");
        CommandError::internal("update.error.install")
    })?;
    // Only reached where the installer does not end this process itself.
    app.restart();
}

/// Opens the release page for an update that has to be downloaded by hand.
#[tauri::command]
pub fn app_update_open_page() -> Result<(), CommandError> {
    crate::release_page::open().map_err(|error| {
        tracing::warn!(%error, "release page could not be opened");
        CommandError::internal("update.error.install")
    })
}

pub fn manage(app: &AppHandle) {
    app.manage(PendingUpdate::default());
}
