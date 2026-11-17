use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use librespot::core::Session;
use serde_json::Value;

use crate::session_http;

const MAX_LINES: usize = 1_500;
const MAX_LINE_CHARS: usize = 2_000;
const NATIVE_MISS_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_NATIVE_MISSES: usize = 512;

#[derive(Default)]
pub(crate) struct NativeLyricsMissCache {
    entries: HashMap<String, Instant>,
}

impl NativeLyricsMissCache {
    pub(crate) fn begin_lookup(&mut self, key: &str) -> bool {
        let now = Instant::now();
        self.entries
            .retain(|_, checked_at| now.duration_since(*checked_at) < NATIVE_MISS_TTL);

        if self.entries.contains_key(key) {
            return false;
        }

        if self.entries.len() >= MAX_NATIVE_MISSES
            && let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, checked_at)| **checked_at)
                .map(|(key, _)| key.clone())
        {
            self.entries.remove(&oldest);
        }

        // Reserve the key before the request starts so two overlapping UI
        // queries cannot send the same pair of native requests.
        self.entries.insert(key.to_owned(), now);
        true
    }

    pub(crate) fn forget(&mut self, key: &str) {
        self.entries.remove(key);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackLyrics {
    pub provider: String,
    pub synced: bool,
    pub instrumental: bool,
    pub lines: Vec<TrackLyricLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackLyricLine {
    pub start_ms: Option<u64>,
    pub text: String,
}

pub(crate) async fn load_track_lyrics(session: &Session, uri: &str) -> Option<TrackLyrics> {
    let id = track_id(uri)?;
    for host in [
        "https://spclient.wg.spotify.com",
        "https://api-partner.spotify.com",
    ] {
        let url = format!(
            "{host}/color-lyrics/v2/track/{id}?format=json&vocalRemoval=false&market=from_token"
        );
        if let Some(bytes) = session_http::get_json(session, &url).await
            && let Some(lyrics) = parse_color_lyrics(&bytes)
        {
            return Some(lyrics);
        }
    }
    None
}

pub(crate) fn parse_color_lyrics(bytes: &[u8]) -> Option<TrackLyrics> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    let lyrics = value.get("lyrics").unwrap_or(&value);
    let cap = lyrics
        .get("capStatus")
        .or_else(|| value.get("capStatus"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    if cap == "CAPPED" {
        return None;
    }
    let sync_type = lyrics
        .get("syncType")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_uppercase();
    let synced = sync_type == "LINE_SYNCED" || sync_type == "SYLLABLE_SYNCED";
    let instrumental = lyrics
        .get("isInstrumental")
        .or_else(|| value.get("isInstrumental"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let lines = lyrics
        .get("lines")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(MAX_LINES)
        .filter_map(|line| normalize_line(line, synced))
        .collect::<Vec<_>>();
    if lines.is_empty() && !instrumental {
        return None;
    }
    let provider = lyrics
        .get("providerDisplayName")
        .or_else(|| lyrics.get("provider"))
        .and_then(Value::as_str)
        .unwrap_or("Spotify")
        .trim()
        .to_string();
    Some(TrackLyrics {
        provider: if provider.is_empty() {
            "Spotify".into()
        } else {
            provider
        },
        synced,
        instrumental,
        lines,
    })
}

fn normalize_line(value: &Value, synced: bool) -> Option<TrackLyricLine> {
    let text = value
        .get("words")
        .or_else(|| value.get("text"))
        .and_then(Value::as_str)?
        .trim();
    if text.is_empty() {
        return None;
    }
    let start_ms = if synced {
        value
            .get("startTimeMs")
            .and_then(as_millis)
            .or_else(|| value.get("startMs").and_then(as_millis))
    } else {
        None
    };
    Some(TrackLyricLine {
        start_ms,
        text: text.chars().take(MAX_LINE_CHARS).collect(),
    })
}

fn as_millis(value: &Value) -> Option<u64> {
    match value {
        Value::Number(number) => number.as_u64().or_else(|| {
            number
                .as_f64()
                .and_then(|ms| (ms >= 0.0).then_some(ms as u64))
        }),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn track_id(uri: &str) -> Option<&str> {
    let id = uri.rsplit(':').next()?.trim();
    (id.len() == 22).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_line_synced_color_lyrics() {
        let lyrics = parse_color_lyrics(
            br#"{
              "lyrics": {
                "syncType": "LINE_SYNCED",
                "providerDisplayName": "Musixmatch",
                "lines": [
                  { "words": "Nightcall", "startTimeMs": "1200" },
                  { "words": " ", "startTimeMs": "2400" }
                ]
              }
            }"#,
        )
        .expect("lyrics");
        assert!(lyrics.synced);
        assert_eq!(lyrics.provider, "Musixmatch");
        assert_eq!(lyrics.lines.len(), 1);
        assert_eq!(lyrics.lines[0].start_ms, Some(1_200));
        assert_eq!(lyrics.lines[0].text, "Nightcall");
    }

    #[test]
    fn ignores_capped_lyrics() {
        assert!(
            parse_color_lyrics(br#"{"lyrics":{"capStatus":"CAPPED","lines":[{"words":"x"}]}}"#)
                .is_none()
        );
    }
}
