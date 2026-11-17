use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    time::{Duration, Instant},
};

use luft_infrastructure::{LyricsDocument, LyricsError, LyricsLine, LyricsRequest};
use tauri::{AppHandle, State};
use tracing::{debug, warn};

use crate::{commands::lyrics_shazam, error::CommandError, state::AppState};

const LIBRESPOT_LYRICS_TIMEOUT: Duration = Duration::from_secs(2);
const TOTAL_LYRICS_TIMEOUT: Duration = Duration::from_secs(18);

#[tauri::command]
pub async fn get_lyrics(
    request: LyricsRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<LyricsDocument, CommandError> {
    match tokio::time::timeout(
        TOTAL_LYRICS_TIMEOUT,
        get_lyrics_bounded(request, &app, state.inner()),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            warn!(
                elapsed_ms = TOTAL_LYRICS_TIMEOUT.as_millis(),
                "lyrics lookup exceeded its total deadline"
            );
            Err(CommandError {
                code: "LYRICS_LOOKUP_TIMEOUT",
                message: "Die Songtextsuche hat zu lange gedauert.".into(),
                retryable: true,
            })
        }
    }
}

async fn get_lyrics_bounded(
    request: LyricsRequest,
    app: &AppHandle,
    state: &AppState,
) -> Result<LyricsDocument, CommandError> {
    let started_at = Instant::now();
    let cache_key = lyrics_cache_key(&request);
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;

    match database.cached::<LyricsDocument>(&cache_key).await {
        Ok(Some(document)) if cacheable(&document) => {
            debug!(provider = %document.provider, elapsed_ms = started_at.elapsed().as_millis(), "lyrics cache hit");
            return Ok(document);
        }
        Ok(_) => {}
        Err(error) => warn!(error = %error, "lyrics cache read failed"),
    }

    // Keep already downloaded v1 entries useful after the URI-based key
    // migration. A valid hit is promoted to v2 without delaying the response.
    let legacy_key = legacy_lyrics_cache_key(&request);
    match database.cached::<LyricsDocument>(&legacy_key).await {
        Ok(Some(document)) if cacheable(&document) => {
            if let Err(error) = database
                .cache_persistent(&cache_key, &document.provider, &document)
                .await
            {
                warn!(error = %error, "lyrics cache promotion failed");
            }
            debug!(provider = %document.provider, elapsed_ms = started_at.elapsed().as_millis(), "legacy lyrics cache hit");
            return Ok(document);
        }
        Ok(_) => {}
        Err(error) => warn!(error = %error, "legacy lyrics cache read failed"),
    }

    if let Some(document) = librespot_lyrics(&request, state).await {
        persist_document(database, &cache_key, &document).await;
        debug!(provider = %document.provider, elapsed_ms = started_at.elapsed().as_millis(), "librespot lyrics resolved");
        return Ok(document);
    }

    match public_fallback_lyrics(&request, app, state).await {
        Ok(document) => {
            persist_document(database, &cache_key, &document).await;
            debug!(provider = %document.provider, elapsed_ms = started_at.elapsed().as_millis(), "fallback lyrics resolved");
            Ok(document)
        }
        Err(error) => {
            let error = map_lyrics_error(error);
            debug!(
                code = error.code,
                elapsed_ms = started_at.elapsed().as_millis(),
                "lyrics lookup completed without a document"
            );
            Err(error)
        }
    }
}

async fn public_fallback_lyrics(
    request: &LyricsRequest,
    app: &AppHandle,
    state: &AppState,
) -> Result<LyricsDocument, LyricsError> {
    let indexed = state.lyrics.get(request.clone());
    let shazam = lyrics_shazam::get(app, request);
    tokio::pin!(indexed, shazam);

    tokio::select! {
        indexed_result = &mut indexed => match indexed_result {
            Ok(document) => Ok(document),
            Err(LyricsError::InvalidRequest) => Err(LyricsError::InvalidRequest),
            Err(indexed_error) => match shazam.await {
                Ok(Some(document)) => Ok(document),
                Ok(None) => Err(merge_fallback_errors(indexed_error, LyricsError::NotFound)),
                Err(shazam_error) => Err(merge_fallback_errors(indexed_error, shazam_error)),
            },
        },
        shazam_result = &mut shazam => match shazam_result {
            Ok(Some(document)) => Ok(document),
            shazam_result => {
                let shazam_error = match shazam_result {
                    Ok(None) => LyricsError::NotFound,
                    Err(error) => error,
                    Ok(Some(_)) => unreachable!(),
                };
                match indexed.await {
                    Ok(document) => Ok(document),
                    Err(indexed_error) => {
                        Err(merge_fallback_errors(indexed_error, shazam_error))
                    }
                }
            }
        },
    }
}

fn merge_fallback_errors(previous: LyricsError, shazam: LyricsError) -> LyricsError {
    match (previous, shazam) {
        (LyricsError::InvalidRequest, _) | (_, LyricsError::InvalidRequest) => {
            LyricsError::InvalidRequest
        }
        (LyricsError::NotFound, LyricsError::NotFound) => LyricsError::NotFound,
        (_, LyricsError::InvalidResponse) => LyricsError::InvalidResponse,
        _ => LyricsError::Unavailable,
    }
}

async fn librespot_lyrics(request: &LyricsRequest, state: &AppState) -> Option<LyricsDocument> {
    if !state.uses_librespot() {
        return None;
    }
    let track_uri = request
        .track_uri
        .as_deref()
        .filter(|uri| uri.starts_with("spotify:track:"))?;
    let result = match tokio::time::timeout(
        LIBRESPOT_LYRICS_TIMEOUT,
        state.librespot.get_lyrics(track_uri),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            debug!(
                elapsed_ms = LIBRESPOT_LYRICS_TIMEOUT.as_millis(),
                "librespot lyrics lookup timed out; using fallback"
            );
            return None;
        }
    };
    match result {
        Ok(Some(lyrics)) => normalize_document(LyricsDocument {
            provider: lyrics.provider,
            synced: lyrics.synced,
            instrumental: lyrics.instrumental,
            lines: lyrics
                .lines
                .into_iter()
                .map(|line| LyricsLine {
                    start_ms: line.start_ms,
                    text: line.text,
                })
                .collect(),
        }),
        Ok(None) => None,
        Err(error) => {
            debug!(error = %error, "librespot lyrics lookup unavailable; using fallback");
            None
        }
    }
}

fn normalize_document(mut document: LyricsDocument) -> Option<LyricsDocument> {
    document.lines.retain(|line| !line.text.trim().is_empty());
    if document.provider.trim().is_empty() || document.provider.chars().count() > 100 {
        document.provider = "Spotify".into();
    }
    cacheable(&document).then_some(document)
}

async fn persist_document(
    database: &luft_infrastructure::Database,
    cache_key: &str,
    document: &LyricsDocument,
) {
    if !cacheable(document) {
        return;
    }
    if let Err(error) = database
        .cache_persistent(cache_key, &document.provider, document)
        .await
    {
        // A cache write must never turn valid live lyrics into a page error.
        warn!(error = %error, provider = %document.provider, "lyrics cache write failed");
    }
}

fn cacheable(document: &LyricsDocument) -> bool {
    document.instrumental
        || document
            .lines
            .iter()
            .any(|line| !line.text.trim().is_empty())
}

fn lyrics_cache_key(request: &LyricsRequest) -> String {
    let mut hasher = DefaultHasher::new();
    "lyrics.v2".hash(&mut hasher);
    if let Some(track_uri) = request
        .track_uri
        .as_deref()
        .filter(|uri| uri.starts_with("spotify:track:"))
    {
        // Spotify's Base62 ids are case-sensitive. Normalizing their case can
        // alias two different tracks and serve the wrong cached lyrics.
        track_uri.trim().hash(&mut hasher);
    } else {
        hash_metadata(request, &mut hasher);
    }
    format!("lyrics.{:016x}.v2", hasher.finish())
}

fn legacy_lyrics_cache_key(request: &LyricsRequest) -> String {
    let mut hasher = DefaultHasher::new();
    hash_metadata(request, &mut hasher);
    format!("lyrics.{:016x}.v1", hasher.finish())
}

fn hash_metadata(request: &LyricsRequest, hasher: &mut DefaultHasher) {
    request.track_name.trim().to_lowercase().hash(hasher);
    request.artist_name.trim().to_lowercase().hash(hasher);
    request.album_name.trim().to_lowercase().hash(hasher);
    (request.duration_ms / 1_000).hash(hasher);
}

fn map_lyrics_error(error: LyricsError) -> CommandError {
    match error {
        LyricsError::InvalidRequest => CommandError {
            code: "INVALID_REQUEST",
            message: "Für diesen Titel fehlen gültige Metadaten.".into(),
            retryable: false,
        },
        LyricsError::NotFound => CommandError {
            code: "LYRICS_NOT_FOUND",
            message: "Für diesen Titel wurde noch kein Songtext gefunden.".into(),
            retryable: false,
        },
        LyricsError::Unavailable => CommandError {
            code: "LYRICS_PROVIDER_UNAVAILABLE",
            message: "Der Songtext-Dienst ist gerade nicht erreichbar.".into(),
            retryable: true,
        },
        LyricsError::InvalidResponse => {
            CommandError::internal("Der Songtext-Dienst hat eine ungültige Antwort geliefert.")
        }
        LyricsError::LookupPending => CommandError {
            code: "LYRICS_LOOKUP_PENDING",
            message: "Der Songtext wird beim Provider noch vorbereitet.".into(),
            retryable: true,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(uri: Option<&str>) -> LyricsRequest {
        LyricsRequest {
            track_uri: uri.map(str::to_owned),
            track_name: " Airborne ".into(),
            artist_name: "Atlas".into(),
            artist_names: Some(vec!["Atlas".into()]),
            album_name: "Clouds".into(),
            duration_ms: 123_456,
            cover_uri: None,
        }
    }

    #[test]
    fn not_found_is_a_stable_non_retryable_state() {
        let error = map_lyrics_error(LyricsError::NotFound);
        assert_eq!(error.code, "LYRICS_NOT_FOUND");
        assert!(!error.retryable);
    }

    #[test]
    fn cache_key_prefers_the_stable_spotify_uri() {
        let first = request(Some("spotify:track:abc"));
        let mut second = request(Some("spotify:track:abc"));
        second.track_name = "Different display title".into();
        second.duration_ms = 999_999;
        assert_eq!(lyrics_cache_key(&first), lyrics_cache_key(&second));
    }

    #[test]
    fn cache_key_preserves_spotify_id_case() {
        let upper = request(Some("spotify:track:AbCdEf0123456789012345"));
        let lower = request(Some("spotify:track:abcdef0123456789012345"));
        assert_ne!(lyrics_cache_key(&upper), lyrics_cache_key(&lower));
    }

    #[test]
    fn legacy_cache_key_is_stable_for_equivalent_metadata() {
        let first = request(None);
        let mut second = request(None);
        second.track_name = "airborne".into();
        second.artist_name = "ATLAS".into();
        second.album_name = "clouds".into();
        second.duration_ms = 123_999;
        assert_eq!(
            legacy_lyrics_cache_key(&first),
            legacy_lyrics_cache_key(&second)
        );
    }

    #[test]
    fn empty_non_instrumental_documents_are_not_cacheable() {
        assert!(!cacheable(&LyricsDocument {
            provider: "Spotify".into(),
            synced: false,
            instrumental: false,
            lines: Vec::new(),
        }));
    }
}
