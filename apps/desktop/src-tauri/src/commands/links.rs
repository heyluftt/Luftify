use luft_core::MediaItem;
use tauri::State;

use crate::{error::CommandError, state::AppState};

/// Title, artists and cover of one song, for a pasted Spotify link. Only the
/// Librespot session can look it up; without one the link still plays.
#[tauri::command]
pub async fn get_track(uri: String, state: State<'_, AppState>) -> Result<Option<MediaItem>, CommandError> {
    if !is_track_uri(&uri) {
        return Ok(None);
    }
    Ok(state.librespot.resolve_item_metadata(&uri).await)
}

fn is_track_uri(uri: &str) -> bool {
    uri.strip_prefix("spotify:track:")
        .is_some_and(|id| id.len() == 22 && id.chars().all(|c| c.is_ascii_alphanumeric()))
}

#[cfg(test)]
mod tests {
    use super::is_track_uri;

    #[test]
    fn only_plain_track_uris_are_looked_up() {
        assert!(is_track_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!is_track_uri("spotify:album:4uLU6hMCjMI75M1A2tKUQC"));
        assert!(!is_track_uri("spotify:track:short"));
        assert!(!is_track_uri("spotify:track:4uLU6hMCjMI75M1A2tKUQ/"));
    }
}
