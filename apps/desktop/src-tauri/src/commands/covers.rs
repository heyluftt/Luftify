use tauri::State;

use crate::{error::CommandError, state::AppState};

#[tauri::command]
pub async fn resolve_cover(
    cover_uri: String,
    state: State<'_, AppState>,
) -> Result<String, CommandError> {
    if cover_uri.chars().count() > 2_048 {
        return Err(CommandError::internal("cover URL is too long"));
    }
    state
        .cover_cache
        .resolve_data_uri(&cover_uri)
        .await
        .map_err(|_| CommandError {
            code: "COVER_UNAVAILABLE",
            message: "Das Cover konnte nicht sicher geladen werden.".into(),
            retryable: true,
        })
}
