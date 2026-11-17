//! When the update server does not answer: the newest release on GitHub.
//! Nothing is downloaded here; the window offers the release page instead.
use std::{io, process::Command, time::Duration};

/// `owner/repository` whose releases carry the installers.
const REPOSITORY: &str = "heyluftt/Luftify";

pub struct Release {
    pub version: String,
    /// German and English points of the release text.
    pub notes: Option<String>,
    pub notes_en: Option<String>,
}

/// `Ok(None)` when the installed version is the newest; `Err` when GitHub
/// could not be asked either.
pub async fn newer_release(current: &str) -> Result<Option<Release>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Luftify")
        .build()
        .map_err(|error| error.to_string())?;
    let body = client
        .get(format!("https://api.github.com/repos/{REPOSITORY}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    let release: serde_json::Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let version = release["tag_name"].as_str().unwrap_or_default().trim_start_matches('v');
    if !is_newer(version, current) {
        return Ok(None);
    }
    let (notes_en, notes) = split_notes(release["body"].as_str().unwrap_or_default());
    Ok(Some(Release { version: version.to_owned(), notes, notes_en }))
}

/// Opens the page of the newest release in the default browser.
pub fn open() -> io::Result<()> {
    let url = format!("https://github.com/{REPOSITORY}/releases/latest");
    Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map(|_| ())
}

/// The release text holds the English points, a `---` line and the German
/// points (scripts/Publish-GitHub.ps1). A text without the line is shown as is.
fn split_notes(body: &str) -> (Option<String>, Option<String>) {
    let text = |part: &str| Some(part.trim().to_owned()).filter(|part| !part.is_empty());
    let body = body.replace("\r\n", "\n");
    match body.split_once("\n---\n") {
        Some((english, german)) => (text(english), text(german)),
        None => (None, text(&body)),
    }
}

/// Compares dotted version numbers; anything unreadable is not newer.
fn is_newer(candidate: &str, current: &str) -> bool {
    let numbers = |version: &str| {
        version.split('.').map(|part| part.parse::<u64>().ok()).collect::<Option<Vec<_>>>()
    };
    match (numbers(candidate), numbers(current)) {
        (Some(candidate), Some(current)) if !candidate.is_empty() => candidate > current,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_newer, split_notes};

    #[test]
    fn the_release_text_splits_into_english_and_german() {
        let (english, german) = split_notes("- New\r\n\r\n---\r\n\r\n- Neu\r\n");
        assert_eq!(english.as_deref(), Some("- New"));
        assert_eq!(german.as_deref(), Some("- Neu"));
        assert_eq!(split_notes("- Nur so"), (None, Some("- Nur so".into())));
        assert_eq!(split_notes(""), (None, None));
    }

    #[test]
    fn only_a_higher_readable_version_is_newer() {
        assert!(is_newer("0.1.37", "0.1.36"));
        assert!(is_newer("0.2.0", "0.1.99"));
        assert!(!is_newer("0.1.36", "0.1.36"));
        assert!(!is_newer("0.1.9", "0.1.36"));
        assert!(!is_newer("", "0.1.36"));
        assert!(!is_newer("nightly", "0.1.36"));
    }
}
