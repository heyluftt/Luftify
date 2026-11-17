use crate::{error::CommandError, state::AppState};
use tauri::State;

#[tauri::command]
pub async fn get_mix_library(state: State<'_, AppState>) -> Result<Option<String>, CommandError> {
    state
        .database
        .get()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
        .mix_library()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn save_mix_library(
    value: String,
    expected: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    if value.len() > 4_000_000 || expected.as_ref().is_some_and(|s| s.len() > 4_000_000) {
        return Err(CommandError::internal("mix library too large"));
    }
    let parsed: serde_json::Value =
        serde_json::from_str(&value).map_err(|e| CommandError::internal(e.to_string()))?;
    if parsed["version"] != 1
        || !parsed["mixes"].is_array()
        || !parsed["importedOrigins"].is_array()
    {
        return Err(CommandError::internal("invalid mix library"));
    }
    state
        .database
        .get()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
        .save_mix_library(&value, expected.as_deref())
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}
