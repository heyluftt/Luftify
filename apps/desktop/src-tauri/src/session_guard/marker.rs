//! The session marker: written while the app runs, removed on a clean exit.
//! Finding it at start means the last session ended unexpectedly.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub started_at_ms: i64,
    /// Updated every half minute while the app runs.
    pub alive_at_ms: i64,
    pub version: String,
    /// Set while the main thread does not respond (watchdog.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hung_since_ms: Option<i64>,
    /// The longest unresponsive stretch that recovered.
    #[serde(default)]
    pub longest_hang_ms: i64,
    /// Where a panic happened, if one did; never the payload with user data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panic: Option<String>,
}

/// Debug builds share the data folder with the installed app;
/// a stopped dev session must not look like a crash of the installed one.
pub fn marker_path(data: &Path) -> PathBuf {
    data.join(if cfg!(debug_assertions) { "session-dev.json" } else { "session.json" })
}

pub fn read(path: &Path) -> Option<Marker> {
    let bytes = std::fs::read(path).ok().filter(|bytes| bytes.len() <= 16_384)?;
    serde_json::from_slice(&bytes).ok()
}

/// Written next to the target and renamed, so a crash mid-write leaves the old marker.
pub fn write(path: &Path, marker: &Marker) {
    let Ok(bytes) = serde_json::to_vec(marker) else { return };
    let temporary = path.with_extension("pending");
    if std::fs::write(&temporary, bytes).is_ok() {
        let _ = std::fs::rename(&temporary, path);
    }
}

pub fn remove(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_round_trip_and_garbage_is_ignored() {
        let directory = std::env::temp_dir().join(format!("luftify-session-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = marker_path(&directory);
        assert!(read(&path).is_none());
        let marker = Marker { started_at_ms: 1, alive_at_ms: 2, version: "0.1.13".into(), hung_since_ms: Some(2), ..Default::default() };
        write(&path, &marker);
        assert_eq!(read(&path), Some(marker));
        std::fs::write(&path, b"not json").unwrap();
        assert!(read(&path).is_none());
        remove(&path);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
