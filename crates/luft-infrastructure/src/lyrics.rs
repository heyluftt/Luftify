mod lyrics_ovh;
mod matching;
mod parser;

use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use thiserror::Error;
use url::Url;

use matching::select_best_response;
use parser::normalize_response;

const LRCLIB_GET_CACHED_ENDPOINT: &str = "https://lrclib.net/api/get-cached";
const LRCLIB_SEARCH_ENDPOINT: &str = "https://lrclib.net/api/search";
const MAX_RESPONSE_BYTES: usize = 1_000_000;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(3);
const EXACT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsRequest {
    #[serde(default)]
    pub track_uri: Option<String>,
    pub track_name: String,
    pub artist_name: String,
    #[serde(default)]
    pub artist_names: Option<Vec<String>>,
    pub album_name: String,
    pub duration_ms: u64,
    #[serde(default)]
    pub cover_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub start_ms: Option<u64>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsDocument {
    pub provider: String,
    pub synced: bool,
    pub instrumental: bool,
    pub lines: Vec<LyricsLine>,
}

#[derive(Debug, Error)]
pub enum LyricsError {
    #[error("lyrics request is invalid")]
    InvalidRequest,
    #[error("lyrics were not found")]
    NotFound,
    #[error("lyrics provider is temporarily unavailable")]
    Unavailable,
    #[error("lyrics provider returned an invalid response")]
    InvalidResponse,
    #[error("lyrics lookup is still pending")]
    LookupPending,
}

#[derive(Debug, Clone)]
pub struct LyricsService {
    client: reqwest::Client,
}

impl LyricsService {
    pub fn new() -> Result<Self, LyricsError> {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .user_agent("Luftify/0.1 (local desktop lyrics client)")
            .build()
            .map_err(|_| LyricsError::Unavailable)?;
        Ok(Self { client })
    }

    pub async fn get(&self, request: LyricsRequest) -> Result<LyricsDocument, LyricsError> {
        validate_request(&request)?;

        match self.get_from_lrclib(&request).await {
            Ok(document) => return Ok(document),
            Err(LyricsError::InvalidRequest) => return Err(LyricsError::InvalidRequest),
            Err(_) => {}
        }

        lyrics_ovh::get(&self.client, &request).await
    }

    async fn get_from_lrclib(
        &self,
        request: &LyricsRequest,
    ) -> Result<LyricsDocument, LyricsError> {
        // LRCLIB /api/get can start a slow external-provider lookup. Search the
        // existing LRCLIB index first so known lyrics normally return at once.
        match self.search(request).await {
            Ok(candidates) => {
                if let Some(candidate) = select_best_response(request, candidates) {
                    return Ok(normalize_response(candidate));
                }
            }
            Err(LyricsError::NotFound) => {}
            Err(error) => return Err(error),
        }

        self.get_exact(request).await.map(normalize_response)
    }

    async fn search(&self, request: &LyricsRequest) -> Result<Vec<LrcLibResponse>, LyricsError> {
        let mut url =
            Url::parse(LRCLIB_SEARCH_ENDPOINT).map_err(|_| LyricsError::InvalidRequest)?;
        url.query_pairs_mut()
            .append_pair("track_name", request.track_name.trim())
            .append_pair("artist_name", request.artist_name.trim());
        self.fetch(url, SEARCH_TIMEOUT).await
    }

    async fn get_exact(&self, request: &LyricsRequest) -> Result<LrcLibResponse, LyricsError> {
        let mut url =
            Url::parse(LRCLIB_GET_CACHED_ENDPOINT).map_err(|_| LyricsError::InvalidRequest)?;
        url.query_pairs_mut()
            .append_pair("track_name", request.track_name.trim())
            .append_pair("artist_name", request.artist_name.trim())
            .append_pair("album_name", request.album_name.trim())
            // The cached endpoint never starts LRCLIB's slower external
            // discovery process; it only returns an existing indexed match.
            .append_pair("duration", &(request.duration_ms / 1_000).to_string());
        self.fetch(url, EXACT_TIMEOUT).await
    }

    async fn fetch<T: DeserializeOwned>(
        &self,
        url: Url,
        timeout: Duration,
    ) -> Result<T, LyricsError> {
        let response = self
            .client
            .get(url)
            .timeout(timeout)
            .send()
            .await
            .map_err(|_| LyricsError::Unavailable)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(LyricsError::NotFound);
        }
        if response.status() == reqwest::StatusCode::ACCEPTED {
            return Err(LyricsError::LookupPending);
        }
        if !response.status().is_success() {
            return Err(LyricsError::Unavailable);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err(LyricsError::InvalidResponse);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| LyricsError::Unavailable)?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(LyricsError::InvalidResponse);
        }
        serde_json::from_slice(&bytes).map_err(|_| LyricsError::InvalidResponse)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrcLibResponse {
    #[serde(default)]
    instrumental: bool,
    track_name: Option<String>,
    artist_name: Option<String>,
    album_name: Option<String>,
    duration: Option<f64>,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

fn validate_request(request: &LyricsRequest) -> Result<(), LyricsError> {
    let valid_text = |value: &str| !value.trim().is_empty() && value.chars().count() <= 300;
    let valid_optional = |value: &Option<String>, maximum: usize| {
        value
            .as_deref()
            .is_none_or(|value| !value.trim().is_empty() && value.chars().count() <= maximum)
    };
    let valid_artists = request.artist_names.as_ref().is_none_or(|artists| {
        artists.len() <= 50 && artists.iter().all(|artist| valid_text(artist))
    });
    if !valid_text(&request.track_name)
        || !valid_text(&request.artist_name)
        || !valid_text(&request.album_name)
        || !valid_optional(&request.track_uri, 512)
        || !valid_optional(&request.cover_uri, 4_096)
        || !valid_artists
        || !(1_000..=24 * 60 * 60 * 1_000).contains(&request.duration_ms)
    {
        return Err(LyricsError::InvalidRequest);
    }
    Ok(())
}
