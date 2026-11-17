use luft_infrastructure::CacheStorageUsage;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{error::CommandError, state::AppState};

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheScope {
    Lyrics,
    Playlists,
    Covers,
    All,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheClearResult {
    pub removed_entries: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsageSection {
    pub bytes: u64,
    pub entries: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsageResult {
    pub lyrics: CacheUsageSection,
    pub playlists: CacheUsageSection,
    pub covers: CacheUsageSection,
    pub total: CacheUsageSection,
}

#[tauri::command]
pub async fn get_cache_usage(state: State<'_, AppState>) -> Result<CacheUsageResult, CommandError> {
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let lyrics = database
        .cache_storage_usage(&["lyrics."])
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let playlists = database
        .cache_storage_usage(&[
            "spotify.playlist-v2.",
            "spotify.playlists-v2.",
            "spotify.playlist.",
            "spotify.playlists.",
            "spotify.liked-tracks.",
        ])
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let database_total = database
        .cache_storage_usage(&[""])
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let covers = state.cover_cache.usage().await.map_err(|_| {
        CommandError::internal("Die Cover-Cache-Größe konnte nicht ermittelt werden.")
    })?;
    let total = CacheStorageUsage {
        bytes: database_total.bytes.saturating_add(covers.bytes),
        entries: database_total.entries.saturating_add(covers.entries),
    };

    Ok(CacheUsageResult {
        lyrics: lyrics.into(),
        playlists: playlists.into(),
        covers: CacheUsageSection {
            bytes: covers.bytes,
            entries: covers.entries,
        },
        total: total.into(),
    })
}

#[tauri::command]
pub async fn clear_cache(
    scope: CacheScope,
    state: State<'_, AppState>,
) -> Result<CacheClearResult, CommandError> {
    let removed_entries = match scope {
        CacheScope::Lyrics => clear_database_prefix(state.inner(), "lyrics.").await?,
        CacheScope::Playlists => clear_playlist_cache(state.inner()).await?,
        CacheScope::Covers => clear_cover_cache(state.inner()).await?,
        CacheScope::All => {
            clear_database_prefix(state.inner(), "").await?
                + clear_cover_cache(state.inner()).await?
        }
    };
    Ok(CacheClearResult { removed_entries })
}

async fn clear_playlist_cache(state: &AppState) -> Result<u64, CommandError> {
    let mut removed = 0_u64;
    for prefix in [
        "spotify.playlist-v2.",
        "spotify.playlists-v2.",
        "spotify.playlist.snapshot.",
        "spotify.playlist.",
        "spotify.playlists.",
        "spotify.liked-tracks.",
    ] {
        removed = removed.saturating_add(clear_database_prefix(state, prefix).await?);
    }
    Ok(removed)
}

impl From<CacheStorageUsage> for CacheUsageSection {
    fn from(value: CacheStorageUsage) -> Self {
        Self {
            bytes: value.bytes,
            entries: value.entries,
        }
    }
}

async fn clear_database_prefix(state: &AppState, prefix: &str) -> Result<u64, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .clear_cache_prefix(prefix)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}

async fn clear_cover_cache(state: &AppState) -> Result<u64, CommandError> {
    state
        .cover_cache
        .clear()
        .await
        .map_err(|_| CommandError::internal("Der Cover-Cache konnte nicht gelöscht werden."))
}
