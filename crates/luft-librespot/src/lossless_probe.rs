//! Lossless, phase 0: does Spotify hand this account its FLAC files and their
//! keys over the same channel librespot already uses for Ogg Vorbis?
//!
//! librespot 0.8 knows the FLAC file ids (`AudioFileFormat::FLAC_FLAC*`) and
//! ships the FLAC decoder, but its player never picks FLAC. Before changing
//! that, this asks, per song and file: (1) does storage-resolve give a CDN
//! address, (2) does the audio-key channel answer with a key, (3) do the first
//! bytes decrypt to a FLAC header. A normal Vorbis file of the same song is
//! the control. Nothing is played and nothing is stored; keys and addresses
//! never leave this module, only whether each step worked.
use std::{io::Read, time::Duration};

use librespot::{
    audio::AudioDecrypt,
    core::{Error, FileId, Session, SpotifyId, SpotifyUri, audio_key::AudioKey, cdn_url::CdnUrl, error::ErrorKind},
    metadata::{Metadata, Track, audio::AudioFileFormat},
    protocol::extension_kind::ExtensionKind,
};
use serde::Serialize;
use tracing::info;

/// Songs looked at; each costs a few small requests.
pub const MAX_TRACKS: usize = 3;
const KEY_ATTEMPTS: usize = 3;
const HEAD_BYTES: usize = 4096;
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
/// Account attributes worth showing; product flags only, nothing personal.
const ATTRIBUTE_HINTS: [&str; 8] = ["type", "lossless", "quality", "hifi", "flac", "audio", "streaming", "bitrate"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Ok,
    /// Spotify answered no (no key, restricted file).
    Refused,
    Timeout,
    Failed,
    /// An earlier step failed.
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub outcome: Outcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Step {
    fn ok(detail: impl Into<String>) -> Self { Self { outcome: Outcome::Ok, detail: Some(detail.into()) } }
    fn skipped() -> Self { Self { outcome: Outcome::Skipped, detail: None } }
    fn from_error(error: &Error) -> Self {
        let outcome = match error.kind {
            ErrorKind::DeadlineExceeded | ErrorKind::Aborted => Outcome::Timeout,
            ErrorKind::Unavailable | ErrorKind::PermissionDenied | ErrorKind::NotFound | ErrorKind::FailedPrecondition => Outcome::Refused,
            _ => Outcome::Failed,
        };
        Self { outcome, detail: Some(short(&error.to_string())) }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProbe {
    pub format: String,
    pub storage: Step,
    pub key: Step,
    pub header: Step,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackProbe {
    pub uri: String,
    pub title: String,
    /// Every format the song record (`TRACK_V4`, what librespot reads) lists, e.g. `FLAC_FLAC_24BIT`.
    pub formats: Vec<String>,
    /// The formats the `AUDIO_FILES` extension lists, which the Spotify client asks.
    pub extension_formats: Vec<String>,
    /// Loudness and true peak (dB) from the extension.
    pub loudness_db: Option<(f32, f32)>,
    /// The 24-bit FLAC file (or 16-bit if there is no 24-bit), if the song has one.
    pub lossless: Option<FileProbe>,
    /// The 16-bit FLAC file next to a 24-bit one: its own file, its own key.
    pub lossless_16: Option<FileProbe>,
    /// The Vorbis file librespot plays today, as the control.
    pub reference: Option<FileProbe>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LosslessProbe {
    pub account_type: Option<String>,
    pub attributes: Vec<(String, String)>,
    pub tracks: Vec<TrackProbe>,
    /// Lossless files decrypted to a FLAC header for at least one song.
    pub lossless_works: bool,
}

pub(crate) async fn probe(session: &Session, uris: &[String]) -> LosslessProbe {
    let mut tracks = Vec::new();
    for uri in uris.iter().take(MAX_TRACKS) {
        if let Some(track) = probe_track(session, uri).await {
            tracks.push(track);
        }
    }
    let lossless_works = tracks.iter().any(|track| [&track.lossless, &track.lossless_16].into_iter().flatten().any(|file| file.header.outcome == Outcome::Ok));
    let attributes = account_attributes(session);
    let result = LosslessProbe { account_type: session.get_user_attribute("type"), attributes, tracks, lossless_works };
    info!(
        adapter = "librespot",
        phase = "lossless-probe",
        account_type = result.account_type.as_deref().unwrap_or("-"),
        songs = result.tracks.len(),
        with_flac = result.tracks.iter().filter(|track| track.lossless.is_some()).count(),
        lossless_works,
        "lossless probe finished"
    );
    result
}

async fn probe_track(session: &Session, uri: &str) -> Option<TrackProbe> {
    let parsed = SpotifyUri::from_uri(uri).ok()?;
    let track = Track::get(session, &parsed).await.ok()?;
    // A song unavailable here plays from one of its alternatives; so does its file list.
    let source = if track.files.is_empty() { track.alternatives.first().cloned() } else { Some(track.id.clone()) };
    let (id, files) = match source {
        Some(alternative) if alternative != track.id => {
            let other = Track::get(session, &alternative).await.ok()?;
            (other.id.clone(), other.files.0.clone())
        }
        _ => (track.id.clone(), track.files.0.clone()),
    };
    let SpotifyUri::Track { id: track_id } = id.clone() else { return None };
    let mut formats: Vec<String> = files.keys().map(|format| format!("{format:?}")).collect();
    formats.sort();
    // What the Spotify client itself asks for the files; may list more than the song record.
    let extension = match id.to_uri() {
        Ok(entity) => crate::metadata_batch::entities(session, ExtensionKind::AUDIO_FILES, &[entity]).await
            .into_iter().next().and_then(|(_, bytes)| crate::audio_files_extension::parse(&bytes)),
        Err(_) => None,
    };
    let mut extension_formats: Vec<String> = extension.iter().flat_map(|found| found.files.iter())
        .map(|file| match file.average_bitrate {
            Some(rate) if rate > 0 => format!("{:?} ({} kbit/s)", file.format, rate / 1000),
            _ => format!("{:?}", file.format),
        })
        .collect();
    extension_formats.sort();
    let mut files = files;
    for file in extension.iter().flat_map(|found| found.files.iter()) {
        files.entry(file.format).or_insert(file.file);
    }
    let pick = |wanted: &[AudioFileFormat]| wanted.iter().find_map(|format| files.get(format).map(|file| (*format, *file)));
    let lossless = match pick(&[AudioFileFormat::FLAC_FLAC_24BIT, AudioFileFormat::FLAC_FLAC]) {
        Some((format, file)) => Some(probe_file(session, track_id, format, file).await),
        None => None,
    };
    let lossless_16 = match (&lossless, files.get(&AudioFileFormat::FLAC_FLAC)) {
        (Some(first), Some(file)) if first.format != "FLAC_FLAC" => Some(probe_file(session, track_id, AudioFileFormat::FLAC_FLAC, *file).await),
        _ => None,
    };
    let reference = match pick(&[AudioFileFormat::OGG_VORBIS_320, AudioFileFormat::OGG_VORBIS_160, AudioFileFormat::OGG_VORBIS_96]) {
        Some((format, file)) => Some(probe_file(session, track_id, format, file).await),
        None => None,
    };
    info!(
        adapter = "librespot",
        phase = "lossless-probe",
        track = uri.rsplit(':').next().unwrap_or(uri),
        record_formats = %formats.join(","),
        extension_formats = %extension_formats.join(","),
        extension_answered = extension.is_some(),
        "lossless probe formats"
    );
    let loudness_db = extension.as_ref().and_then(|found| found.loudness);
    let probe = TrackProbe { uri: uri.to_owned(), title: track.name.clone(), formats, extension_formats, loudness_db, lossless, lossless_16, reference };
    for file in [&probe.lossless, &probe.lossless_16, &probe.reference].into_iter().flatten() {
        info!(
            adapter = "librespot",
            phase = "lossless-probe",
            track = uri.rsplit(':').next().unwrap_or(uri),
            format = %file.format,
            storage = ?file.storage.outcome,
            key = ?file.key.outcome,
            header = ?file.header.outcome,
            header_detail = file.header.detail.as_deref().unwrap_or("-"),
            "lossless probe file"
        );
    }
    Some(probe)
}

async fn probe_file(session: &Session, track: SpotifyId, format: AudioFileFormat, file: FileId) -> FileProbe {
    let format_name = format!("{format:?}");
    let urls = match CdnUrl::new(file).resolve_audio(session).await {
        Ok(resolved) => resolved.try_get_urls().map(|urls| urls.into_iter().map(str::to_owned).collect::<Vec<_>>()),
        Err(error) => Err(error),
    };
    let (storage, urls) = match urls {
        Ok(urls) if !urls.is_empty() => (Step::ok(format!("{} CDN", urls.len())), urls),
        Ok(_) => (Step { outcome: Outcome::Refused, detail: Some("no CDN address".into()) }, Vec::new()),
        Err(error) => (Step::from_error(&error), Vec::new()),
    };
    let (key, key_step) = request_key(session, track, file).await;
    let header = match (urls.first(), key) {
        (Some(url), Some(key)) => read_header(url, key).await,
        _ => Step::skipped(),
    };
    FileProbe { format: format_name, storage, key: key_step, header }
}

/// The key channel answers within 1.5 s or librespot gives up; here a
/// timeout is retried, so a refusal and a slow answer can be told apart.
async fn request_key(session: &Session, track: SpotifyId, file: FileId) -> (Option<AudioKey>, Step) {
    let mut last = Step::skipped();
    for attempt in 1..=KEY_ATTEMPTS {
        match session.audio_key().request(track, file).await {
            Ok(key) => return (Some(key), Step::ok(format!("attempt {attempt}"))),
            Err(error) => {
                last = Step::from_error(&error);
                if last.outcome != Outcome::Timeout {
                    break;
                }
            }
        }
    }
    (None, last)
}

/// The first bytes of the file, decrypted: `fLaC` for FLAC, `OggS` for Vorbis.
async fn read_header(url: &str, key: AudioKey) -> Step {
    let response = reqwest::Client::new()
        .get(url)
        .header(reqwest::header::RANGE, format!("bytes=0-{}", HEAD_BYTES - 1))
        .timeout(HEAD_TIMEOUT)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status);
    let bytes = match response {
        Ok(response) => match response.bytes().await {
            Ok(bytes) => bytes,
            Err(error) => return Step { outcome: Outcome::Failed, detail: Some(short(&error.to_string())) },
        },
        Err(error) => {
            let outcome = if error.status().is_some_and(|status| status.as_u16() == 403) { Outcome::Refused } else { Outcome::Failed };
            return Step { outcome, detail: Some(error.status().map_or_else(|| short(&error.to_string()), |status| status.to_string())) };
        }
    };
    let mut head = [0u8; 4];
    if AudioDecrypt::new(Some(key), std::io::Cursor::new(bytes.to_vec())).read_exact(&mut head).is_err() {
        return Step { outcome: Outcome::Failed, detail: Some("too short".into()) };
    }
    match &head {
        b"fLaC" => Step::ok("fLaC"),
        b"OggS" => Step::ok("OggS"),
        other => Step { outcome: Outcome::Failed, detail: Some(format!("unknown start {:02x}{:02x}{:02x}{:02x}", other[0], other[1], other[2], other[3])) },
    }
}

fn account_attributes(session: &Session) -> Vec<(String, String)> {
    let mut found: Vec<(String, String)> = session.user_data().attributes.iter()
        .filter(|(key, _)| ATTRIBUTE_HINTS.iter().any(|hint| key.to_lowercase().contains(hint)))
        .map(|(key, value)| (key.clone(), short(value)))
        .collect();
    found.sort();
    found
}

fn short(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default();
    line.chars().take(120).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_sort_into_refused_timeout_and_failed() {
        assert_eq!(Step::from_error(&Error::unavailable("no key")).outcome, Outcome::Refused);
        assert_eq!(Step::from_error(&Error::aborted("audio key response timeout")).outcome, Outcome::Timeout);
        assert_eq!(Step::from_error(&Error::internal("odd")).outcome, Outcome::Failed);
    }

    #[test]
    fn details_stay_one_short_line() {
        let long = format!("{}\nsecond line", "x".repeat(300));
        assert_eq!(short(&long).len(), 120);
    }
}
