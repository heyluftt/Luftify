mod icons;

#[cfg(windows)]
mod native;

#[cfg(windows)]
pub use native::{attach, set_playing};

#[cfg(not(windows))]
pub fn attach(_app: &tauri::AppHandle) {}

#[cfg(not(windows))]
pub fn set_playing(_app: &tauri::AppHandle, _playing: bool) {}
