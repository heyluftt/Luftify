//! The app session: an unexpected end of the last one ("Report a problem")
//! and whether the window is seen right now.
use tauri::State;

use crate::{error::CommandError, session_guard::PreviousSession, state::AppState};

#[tauri::command]
pub fn previous_session(state: State<'_, AppState>) -> Result<Option<PreviousSession>, CommandError> {
    Ok(state.session.previous())
}

/// The page reports when nobody sees it (features/motion/windowActivity.ts).
#[tauri::command]
pub fn set_window_idle(window: tauri::WebviewWindow, idle: bool) {
    crate::webview_memory::set_idle(&window, idle);
}

#[tauri::command]
pub fn dismiss_previous_session(state: State<'_, AppState>) {
    state.session.dismiss();
}
