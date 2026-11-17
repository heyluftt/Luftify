use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{error::CommandError, startup::StartupEvent, state::AppState};

/// What the window needs to know about the process it talks to: whether the
/// demo provider is active and how far the startup got.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub mock_mode: bool,
    pub startup: StartupEvent,
}

#[tauri::command]
pub async fn get_connection_info(
    state: State<'_, AppState>,
) -> Result<ConnectionInfo, CommandError> {
    Ok(ConnectionInfo {
        mock_mode: state.mock_mode,
        startup: state.startup.current(),
    })
}

#[tauri::command]
pub fn get_startup_status(state: State<'_, AppState>) -> StartupEvent {
    state.startup.current()
}

#[tauri::command]
pub fn respond_close_prompt(action: String, app: AppHandle) {
    match action.as_str() {
        "exit" => crate::lifecycle::request_full_exit(app),
        "tray" => crate::lifecycle::hide_main_window(&app),
        _ => {}
    }
}

#[tauri::command]
pub fn hide_luftplayer(app: AppHandle) {
    crate::lifecycle::hide_main_window(&app);
}

#[tauri::command]
pub fn exit_luftplayer(app: AppHandle) {
    crate::lifecycle::request_full_exit(app);
}
