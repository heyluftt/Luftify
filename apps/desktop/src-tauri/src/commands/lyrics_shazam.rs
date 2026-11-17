use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use luft_infrastructure::{LyricsDocument, LyricsError, LyricsLine, LyricsRequest};
use reqwest::redirect::Policy;
use serde::Deserialize;
use tauri::{
    AppHandle, WebviewUrl,
    webview::{NewWindowResponse, WebviewWindowBuilder},
};
use tokio::sync::oneshot;
use tracing::debug;
use url::Url;

const ITUNES_SEARCH_ENDPOINT: &str = "https://itunes.apple.com/search";
const ITUNES_TIMEOUT: Duration = Duration::from_secs(3);
const SHAZAM_PAGE_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_CATALOG_RESPONSE_BYTES: usize = 512_000;
const MAX_LYRICS_PAYLOAD_BYTES: usize = 512_000;
const SHAZAM_RESULT_SCHEME: &str = "luftplayer-lyrics";
const SHAZAM_HOST: &str = "www.shazam.com";
const MATCH_DURATION_TOLERANCE_MS: u64 = 15_000;

static WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

// Closing on Drop also covers cancellation by the command-wide deadline.
// Without this guard a timed-out lookup could leave its hidden fallback
// WebView alive even though the request itself was already finished.
struct HiddenLyricsWindow(tauri::WebviewWindow);

impl Drop for HiddenLyricsWindow {
    fn drop(&mut self) {
        let _ = self.0.close();
    }
}

struct PublicPageRequest {
    url: Url,
    resolve_with_music_kit: bool,
}

pub(super) async fn get(
    app: &AppHandle,
    request: &LyricsRequest,
) -> Result<Option<LyricsDocument>, LyricsError> {
    let page = find_public_page(request).await?;
    load_public_shazam_page(app, request, page).await
}

async fn find_public_page(request: &LyricsRequest) -> Result<PublicPageRequest, LyricsError> {
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .user_agent("Luftify/0.1 (local desktop lyrics client)")
        .build()
        .map_err(|_| LyricsError::Unavailable)?;

    if let Ok(Some(track_id)) = find_apple_track_id(&client, request).await {
        return Ok(PublicPageRequest {
            url: shazam_song_url(request, track_id)?,
            resolve_with_music_kit: false,
        });
    }

    Ok(PublicPageRequest {
        url: Url::parse("https://www.shazam.com/de-de").map_err(|_| LyricsError::InvalidRequest)?,
        resolve_with_music_kit: true,
    })
}

async fn find_apple_track_id(
    client: &reqwest::Client,
    request: &LyricsRequest,
) -> Result<Option<u64>, LyricsError> {
    let query = format!(
        "{} {}",
        request.track_name.trim(),
        request.artist_name.trim()
    );
    let response = client
        .get(ITUNES_SEARCH_ENDPOINT)
        .query(&[
            ("term", query.as_str()),
            ("entity", "song"),
            ("limit", "25"),
            ("country", "DE"),
        ])
        .timeout(ITUNES_TIMEOUT)
        .send()
        .await
        .map_err(|_| LyricsError::Unavailable)?;
    if !response.status().is_success() {
        return Err(LyricsError::Unavailable);
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_RESPONSE_BYTES as u64)
    {
        return Err(LyricsError::InvalidResponse);
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| LyricsError::Unavailable)?;
    if bytes.len() > MAX_CATALOG_RESPONSE_BYTES {
        return Err(LyricsError::InvalidResponse);
    }
    let response: ItunesSearchResponse =
        serde_json::from_slice(&bytes).map_err(|_| LyricsError::InvalidResponse)?;
    Ok(select_track_id(request, response.results))
}

fn select_track_id(request: &LyricsRequest, tracks: Vec<ItunesTrack>) -> Option<u64> {
    tracks
        .into_iter()
        .filter_map(|track| {
            if !metadata_matches(request, &track.track_name, &track.artist_name) {
                return None;
            }

            let duration_delta = track.track_time_millis.abs_diff(request.duration_ms);
            (duration_delta <= MATCH_DURATION_TOLERANCE_MS)
                .then_some((duration_delta, track.track_id))
        })
        .min_by_key(|(duration_delta, _)| *duration_delta)
        .map(|(_, track_id)| track_id)
}

fn metadata_matches(request: &LyricsRequest, title: &str, artist: &str) -> bool {
    if normalize(title) != normalize(&request.track_name) {
        return false;
    }

    let candidate = normalize(artist);
    requested_artists(request).into_iter().any(|requested| {
        candidate == requested || candidate.contains(&requested) || requested.contains(&candidate)
    })
}

fn requested_artists(request: &LyricsRequest) -> Vec<String> {
    let mut artists = vec![normalize(&request.artist_name)];
    if let Some(additional) = &request.artist_names {
        artists.extend(additional.iter().map(|artist| normalize(artist)));
    }
    artists.retain(|artist| !artist.is_empty());
    artists.sort();
    artists.dedup();
    artists
}

async fn load_public_shazam_page(
    app: &AppHandle,
    request: &LyricsRequest,
    page: PublicPageRequest,
) -> Result<Option<LyricsDocument>, LyricsError> {
    let initialization_script = extraction_script(request, page.resolve_with_music_kit)?;
    let label = format!(
        "lyrics-shazam-{}",
        WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let (sender, receiver) = oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let navigation_sender = Arc::clone(&sender);

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::External(page.url));
    if let Some(directory) = super::accounts::webview_directory(app) {
        builder = builder.data_directory(directory);
    }
    let _window_guard = HiddenLyricsWindow(
        builder
            .title("")
            .visible(false)
            .focused(false)
            .focusable(false)
            .skip_taskbar(true)
            .decorations(false)
            .resizable(false)
            .inner_size(1.0, 1.0)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .on_navigation(move |url| {
                if url.scheme() == SHAZAM_RESULT_SCHEME {
                    let result = parse_navigation_result(url);
                    if let Ok(mut guard) = navigation_sender.lock()
                        && let Some(sender) = guard.take()
                    {
                        let _ = sender.send(result);
                    }
                    return false;
                }

                url.as_str() == "about:blank"
                    || (url.scheme() == "https" && url.host_str() == Some(SHAZAM_HOST))
            })
            .initialization_script(initialization_script)
            .build()
            .map_err(|_| LyricsError::Unavailable)?,
    );

    let result = match tokio::time::timeout(SHAZAM_PAGE_TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) | Err(_) => Err(LyricsError::Unavailable),
    };
    if result.is_ok() {
        debug!("public Shazam lyrics fallback completed");
    }
    result
}

fn shazam_song_url(request: &LyricsRequest, track_id: u64) -> Result<Url, LyricsError> {
    let slug = slugify(&request.track_name);
    Url::parse(&format!(
        "https://www.shazam.com/de-de/song/{track_id}/{slug}"
    ))
    .map_err(|_| LyricsError::InvalidRequest)
}

fn parse_navigation_result(url: &Url) -> Result<Option<LyricsDocument>, LyricsError> {
    match url.host_str() {
        Some("not-found") => Ok(None),
        Some("unavailable") => Err(LyricsError::Unavailable),
        Some("result") => {
            let encoded = url.path().trim_start_matches('/');
            if encoded.is_empty() || encoded.len() > MAX_LYRICS_PAYLOAD_BYTES * 2 {
                return Err(LyricsError::InvalidResponse);
            }
            let bytes = URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| LyricsError::InvalidResponse)?;
            if bytes.len() > MAX_LYRICS_PAYLOAD_BYTES {
                return Err(LyricsError::InvalidResponse);
            }
            let payload: ShazamPayload =
                serde_json::from_slice(&bytes).map_err(|_| LyricsError::InvalidResponse)?;
            let lines = normalize_lines(payload.lines);
            if lines.is_empty() {
                return Err(LyricsError::InvalidResponse);
            }
            Ok(Some(LyricsDocument {
                provider: "Shazam / Apple Music".into(),
                synced: false,
                instrumental: false,
                lines,
            }))
        }
        _ => Err(LyricsError::InvalidResponse),
    }
}

fn normalize_lines(lines: Vec<String>) -> Vec<LyricsLine> {
    lines
        .into_iter()
        .flat_map(|line| {
            line.replace("\r\n", "\n")
                .replace('\r', "\n")
                .split('\n')
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| LyricsLine {
                    start_ms: None,
                    text: line.to_owned(),
                })
                .collect::<Vec<_>>()
        })
        .take(2_000)
        .collect()
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn slugify(value: &str) -> String {
    let slug = normalize(value).replace(' ', "-");
    if slug.is_empty() { "song".into() } else { slug }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItunesSearchResponse {
    #[serde(default)]
    results: Vec<ItunesTrack>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItunesTrack {
    track_id: u64,
    track_name: String,
    artist_name: String,
    track_time_millis: u64,
}

#[derive(Debug, Deserialize)]
struct ShazamPayload {
    #[serde(default)]
    lines: Vec<String>,
}

fn extraction_script(
    request: &LyricsRequest,
    resolve_with_music_kit: bool,
) -> Result<String, LyricsError> {
    let configuration = serde_json::json!({
        "resolveWithMusicKit": resolve_with_music_kit,
        "query": format!("{} {}", request.track_name.trim(), request.artist_name.trim()),
        "title": request.track_name,
        "artists": requested_artists(request),
        "durationMs": request.duration_ms,
        "slug": slugify(&request.track_name),
    });
    let configuration =
        serde_json::to_string(&configuration).map_err(|_| LyricsError::InvalidRequest)?;
    Ok(SHAZAM_EXTRACTION_SCRIPT.replace("__LUFT_CONFIG__", &configuration))
}

const SHAZAM_EXTRACTION_SCRIPT: &str = r#"
(() => {
  if (window.location.hostname !== "www.shazam.com" || window.__luftLyricsReader) return;
  window.__luftLyricsReader = true;

  const config = __LUFT_CONFIG__;
  let attempts = 0;
  let finished = false;

  const navigateResult = (host, payload) => {
    if (finished) return;
    finished = true;
    let path = "";
    if (payload) {
      const json = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(json);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      path = "/" + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }
    window.location.href = "luftplayer-lyrics://" + host + path;
  };

  const normalize = (value) => String(value || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  const artistMatches = (candidate) => {
    const normalized = normalize(candidate);
    return config.artists.some((artist) =>
      normalized === artist || normalized.includes(artist) || artist.includes(normalized)
    );
  };

  const resolveFromAppleMusic = async () => {
    if (finished) return;
    attempts += 1;

    const musicKit = window.MusicKit?.getInstance?.();
    if (!musicKit?.api?.music) {
      if (attempts < 80) {
        setTimeout(resolveFromAppleMusic, 100);
      } else {
        navigateResult("unavailable");
      }
      return;
    }

    try {
      const response = await musicKit.api.music("/v1/catalog/de/search", {
        term: config.query,
        types: "songs",
        limit: 10,
        l: "de-DE",
      });
      const songs = response?.data?.results?.songs?.data || [];
      const matches = songs
        .filter((song) =>
          normalize(song?.attributes?.name) === normalize(config.title)
          && artistMatches(song?.attributes?.artistName)
        )
        .map((song) => ({
          id: String(song?.id || ""),
          durationDelta: Math.abs(
            Number(song?.attributes?.durationInMillis || config.durationMs) - config.durationMs
          ),
        }))
        .filter((song) => /^\d+$/.test(song.id))
        .sort((left, right) => left.durationDelta - right.durationDelta);

      const closeDurationMatch = matches.find((song) => song.durationDelta <= 15000);
      const selected = closeDurationMatch || (matches.length === 1 ? matches[0] : null);
      if (!selected) {
        navigateResult("not-found");
        return;
      }

      window.location.replace(
        "/de-de/song/" + encodeURIComponent(selected.id) + "/" + encodeURIComponent(config.slug)
      );
    } catch (_) {
      navigateResult("unavailable");
    }
  };

  const inspect = () => {
    if (finished) return;
    attempts += 1;

    const root = document.querySelector('[class*="AppleMusicLyrics_lyrics"]');
    const lineNodes = root
      ? root.querySelectorAll('[class*="LyricsContent_lyricLine"]')
      : [];
    const lines = Array.from(lineNodes)
      .map((node) => (node.innerText || node.textContent || "").trim())
      .filter(Boolean);

    if (lines.length > 0) {
      navigateResult("result", { lines });
      return;
    }

    const visibleText = (document.body && document.body.innerText) || "";
    if (/we don.?t have any lyrics for this song|no lyrics for this song/i.test(visibleText)) {
      navigateResult("not-found");
      return;
    }

    if (attempts < 50) {
      setTimeout(inspect, 200);
    }
  };

  if (config.resolveWithMusicKit && !/\/(?:song|track)\//.test(window.location.pathname)) {
    setTimeout(resolveFromAppleMusic, 100);
  } else {
    setTimeout(inspect, 100);
  }
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LyricsRequest {
        LyricsRequest {
            track_uri: Some("spotify:track:test".into()),
            track_name: "Hudson Bay Floater".into(),
            artist_name: "Sewerperson".into(),
            artist_names: Some(vec!["Sewerperson".into()]),
            album_name: "a ritual killing on 70mm".into(),
            duration_ms: 177_966,
            cover_uri: None,
        }
    }

    #[test]
    fn selects_the_exact_apple_catalog_track() {
        let tracks = vec![
            ItunesTrack {
                track_id: 1,
                track_name: "Hudson Bay Floater".into(),
                artist_name: "Different Artist".into(),
                track_time_millis: 177_966,
            },
            ItunesTrack {
                track_id: 2,
                track_name: "Hudson Bay Floater".into(),
                artist_name: "Sewerperson".into(),
                track_time_millis: 177_900,
            },
        ];

        assert_eq!(select_track_id(&request(), tracks), Some(2));
    }

    #[test]
    fn rejects_a_large_duration_mismatch() {
        let tracks = vec![ItunesTrack {
            track_id: 2,
            track_name: "Hudson Bay Floater".into(),
            artist_name: "Sewerperson".into(),
            track_time_millis: 240_000,
        }];

        assert_eq!(select_track_id(&request(), tracks), None);
    }

    #[test]
    fn parses_url_safe_unicode_payload() {
        let json = serde_json::json!({ "lines": ["Erste Zeile", "Hörbar"] }).to_string();
        let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
        let url =
            Url::parse(&format!("{SHAZAM_RESULT_SCHEME}://result/{encoded}")).expect("result URL");

        let document = parse_navigation_result(&url)
            .expect("valid payload")
            .expect("lyrics");
        assert_eq!(document.provider, "Shazam / Apple Music");
        assert_eq!(document.lines[1].text, "Hörbar");
    }
}
