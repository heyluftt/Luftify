use luft_core::{SearchRequest, SearchResult};
use tauri::State;

use crate::{error::CommandError, state::AppState};

const MAX_SEARCH_QUERY_LENGTH: usize = 200;

#[tauri::command]
pub async fn search(
    mut request: SearchRequest,
    state: State<'_, AppState>,
) -> Result<SearchResult, CommandError> {
    request.query = request
        .query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if request.query.is_empty() || request.query.chars().count() > MAX_SEARCH_QUERY_LENGTH {
        return Err(CommandError {
            code: "INVALID_QUERY",
            message: "Die Suche muss zwischen 1 und 200 Zeichen enthalten.".into(),
            retryable: false,
        });
    }
    request.limit = request.limit.clamp(1, 50);
    state.provider.search(request).await.map_err(Into::into)
}
