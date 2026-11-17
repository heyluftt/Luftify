use luft_infrastructure::MiniPlayerSettings;
use tauri::AppHandle;

use crate::{error::CommandError, miniplayer};

#[tauri::command]
pub async fn set_miniplayer_expanded(app: AppHandle, expanded: bool) -> Result<(), CommandError> {
    miniplayer::set_expanded(&app, expanded).await
}

#[tauri::command]
pub async fn show_miniplayer(app: AppHandle) -> Result<(), CommandError> {
    miniplayer::show(&app).await
}

/// The mini player's way back to the full window.
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    crate::lifecycle::show_main_window(&app);
}

#[tauri::command]
pub fn hide_miniplayer(app: AppHandle) -> Result<(), CommandError> {
    miniplayer::hide(&app)
}

#[tauri::command]
pub async fn save_miniplayer_position(app: AppHandle, x: i32, y: i32) -> Result<(), CommandError> {
    miniplayer::save_position(&app, x, y).await
}

#[tauri::command]
pub async fn save_miniplayer_settings(
    app: AppHandle,
    settings: MiniPlayerSettings,
) -> Result<MiniPlayerSettings, CommandError> {
    miniplayer::save_settings(&app, settings).await
}

/// The lock badge's place in the mini player (CSS pixels), or `None`
/// while click-through is off.
#[cfg(windows)]
#[tauri::command]
pub fn set_miniplayer_unlock_zone(zone: Option<miniplayer::UnlockZone>) {
    miniplayer::set_unlock_zone(zone);
}

#[cfg(not(windows))]
#[tauri::command]
pub fn set_miniplayer_unlock_zone(zone: Option<serde_json::Value>) {
    let _ = zone;
}
