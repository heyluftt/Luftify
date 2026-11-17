use futures_util::{StreamExt, stream};
use luft_core::{MediaItem, MediaItemType};
use luft_infrastructure::{
    AnalyticsRangeRequest, Creator, Database, ListeningOverview, MAX_FEEDBACK_URIS,
    TrackListeningFeedback, TrackSnapshot,
};
use tauri::State;
use tracing::{info, warn};

use crate::{error::CommandError, state::AppState};

const ANALYTICS_METADATA_REPAIR_LIMIT: usize = 8;
const ANALYTICS_METADATA_REPAIR_CONCURRENCY: usize = 3;

#[tauri::command]
pub async fn get_recently_played(
    state: State<'_, AppState>,
) -> Result<Vec<luft_infrastructure::TrackListeningStat>, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .recently_played_tracks()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn get_listening_overview(
    request: AnalyticsRangeRequest,
    state: State<'_, AppState>,
) -> Result<ListeningOverview, CommandError> {
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut overview = database
        .listening_overview(request)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    if repair_placeholder_tracks(state.inner(), database, &overview).await > 0 {
        overview = database
            .listening_overview(request)
            .await
            .map_err(|error| CommandError::internal(error.to_string()))?;
    }
    Ok(overview)
}

/// Local listening signals for discovery candidates. Only stored sessions are
/// read; nothing is requested from Spotify.
#[tauri::command]
pub async fn get_track_listening_feedback(
    uris: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<TrackListeningFeedback>, CommandError> {
    let mut seen = std::collections::HashSet::new();
    let uris = uris
        .into_iter()
        .map(|uri| uri.trim().to_string())
        .filter(|uri| uri.starts_with("spotify:track:") && seen.insert(uri.clone()))
        .take(MAX_FEEDBACK_URIS)
        .collect::<Vec<_>>();
    if uris.is_empty() {
        return Ok(Vec::new());
    }
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    database
        .track_listening_feedback(&uris)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

async fn repair_placeholder_tracks(
    state: &AppState,
    database: &Database,
    overview: &ListeningOverview,
) -> usize {
    let uris = overview
        .top_tracks
        .iter()
        .filter(|entry| entry.track.has_placeholder_title())
        .take(ANALYTICS_METADATA_REPAIR_LIMIT)
        .map(|entry| entry.track.uri.clone())
        .collect::<Vec<_>>();
    if uris.is_empty() {
        return 0;
    }

    let librespot = state.librespot.clone();
    let resolved = stream::iter(uris.iter().cloned())
        .map(|uri| {
            let librespot = librespot.clone();
            async move { librespot.resolve_item_metadata(&uri).await }
        })
        .buffer_unordered(ANALYTICS_METADATA_REPAIR_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let mut repaired = 0_usize;
    for item in resolved.into_iter().flatten() {
        let track = analytics_snapshot(item);
        match database.repair_analytics_track_metadata(&track).await {
            Ok(true) => repaired += 1,
            Ok(false) => {}
            Err(error) => warn!(
                adapter = "sqlite",
                phase = "analytics-metadata-repair",
                error = %error,
                "analytics track metadata repair failed"
            ),
        }
    }
    info!(
        adapter = "librespot",
        phase = "analytics-metadata-repair",
        attempted = uris.len(),
        repaired,
        "analytics placeholder metadata repair completed"
    );
    repaired
}

fn analytics_snapshot(item: MediaItem) -> TrackSnapshot {
    TrackSnapshot {
        uri: item.uri,
        item_type: match item.item_type {
            MediaItemType::Track => "track",
            MediaItemType::Episode => "episode",
            MediaItemType::LocalTrack => "localTrack",
        }
        .into(),
        title: item.title,
        creators: item
            .creators
            .into_iter()
            .map(|creator| Creator {
                name: creator.name,
                uri: creator.uri,
            })
            .collect(),
        album_uri: item.album_uri,
        album_name: item.album_name,
        duration_ms: item.duration_ms,
        cover_uri: item.cover_uri,
    }
}

#[tauri::command]
pub async fn clear_listening_analytics(state: State<'_, AppState>) -> Result<(), CommandError> {
    state
        .listening_analytics
        .clear()
        .await
        .map_err(CommandError::internal)
}

#[tauri::command]
pub async fn get_listening_recap(
    request: luft_infrastructure::RecapRequest,
    state: State<'_, AppState>,
) -> Result<luft_infrastructure::ListeningRecap, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .listening_recap(request)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

/// Covers, top song and top artist per recap period, for the overview.
#[tauri::command]
pub async fn get_recap_previews(
    ranges: Vec<luft_infrastructure::RecapPreviewRange>,
    state: State<'_, AppState>,
) -> Result<Vec<luft_infrastructure::RecapPreview>, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .recap_previews(ranges)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

/// Every day with listening; the page finds the weeks, months and occasions
/// worth a recap from these.
#[tauri::command]
pub async fn get_listening_days(
    timezone_offset_minutes: i32,
    state: State<'_, AppState>,
) -> Result<Vec<luft_infrastructure::DailyListeningActivity>, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .listening_days(timezone_offset_minutes)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

/// Saves a recap card (PNG) to Pictures\Luftify and returns its path.
#[tauri::command]
pub async fn save_recap_image(png_base64: String, file_name: String) -> Result<String, CommandError> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim())
        .map_err(|_| CommandError::internal("recap.imageInvalid"))?;
    if bytes.len() > 20 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(CommandError::internal("recap.imageInvalid"));
    }
    let directory = pictures_dir()
        .ok_or_else(|| CommandError::internal("recap.imageSaveFailed"))?
        .join("Luftify");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| CommandError::internal("recap.imageSaveFailed"))?;
    let path = directory.join(safe_file_name(&file_name));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| CommandError::internal("recap.imageSaveFailed"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Letters, digits, dashes and spaces only, always `.png`.
fn safe_file_name(name: &str) -> String {
    let stem: String = name
        .trim_end_matches(".png")
        .chars()
        .map(|character| if character.is_alphanumeric() || matches!(character, '-' | '_' | ' ') { character } else { '-' })
        .take(80)
        .collect();
    let stem = stem.trim();
    format!("{}.png", if stem.is_empty() { "Luftify Rückblick" } else { stem })
}

/// The user's Documents folder.
#[cfg(windows)]
pub(crate) fn documents_dir() -> Option<std::path::PathBuf> {
    use windows::Win32::UI::Shell::{FOLDERID_Documents, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Documents, KF_FLAG_DEFAULT, None).ok()?;
        let text = path.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as *const _));
        text.map(std::path::PathBuf::from)
    }
}

#[cfg(not(windows))]
pub(crate) fn documents_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join("Documents"))
}

#[cfg(windows)]
fn pictures_dir() -> Option<std::path::PathBuf> {
    use windows::Win32::UI::Shell::{FOLDERID_Pictures, KF_FLAG_DEFAULT, SHGetKnownFolderPath};
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Pictures, KF_FLAG_DEFAULT, None).ok()?;
        let text = path.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as *const _));
        text.map(std::path::PathBuf::from)
    }
}

#[cfg(not(windows))]
fn pictures_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join("Pictures"))
}

#[cfg(test)]
mod recap_tests {
    use super::safe_file_name;

    #[test]
    fn recap_file_names_stay_inside_the_folder() {
        assert_eq!(safe_file_name("Rückblick September 2026"), "Rückblick September 2026.png");
        assert_eq!(safe_file_name(r"..\..\evil"), "------evil.png");
        assert_eq!(safe_file_name(""), "Luftify Rückblick.png");
    }
}
