use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU8, Ordering},
};

use luft_infrastructure::{CloseBehavior, Settings};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};

use crate::state::AppState;

#[derive(Debug)]
pub struct AppLifecycle {
    close_behavior: AtomicU8,
    exit_requested: AtomicBool,
}

impl AppLifecycle {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            close_behavior: AtomicU8::new(close_behavior_value(CloseBehavior::default())),
            exit_requested: AtomicBool::new(false),
        })
    }

    pub async fn apply_settings(&self, settings: Settings) {
        self.close_behavior.store(
            close_behavior_value(settings.close_behavior),
            Ordering::Release,
        );
    }

    #[must_use]
    pub fn close_behavior(&self) -> CloseBehavior {
        match self.close_behavior.load(Ordering::Acquire) {
            0 => CloseBehavior::Exit,
            2 => CloseBehavior::Ask,
            _ => CloseBehavior::MinimizeToTray,
        }
    }

    #[must_use]
    pub fn is_exiting(&self) -> bool {
        self.exit_requested.load(Ordering::Acquire)
    }

    pub fn request_shutdown(&self) {
        self.exit_requested.store(true, Ordering::Release);
    }
}

fn close_behavior_value(value: CloseBehavior) -> u8 {
    match value {
        CloseBehavior::Exit => 0,
        CloseBehavior::MinimizeToTray => 1,
        CloseBehavior::Ask => 2,
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == crate::miniplayer::MINIPLAYER_LABEL
        && matches!(event, WindowEvent::Destroyed)
    {
        crate::miniplayer::on_closed(window.app_handle());
        return;
    }
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    // Auxiliary WebViews (for example the hidden Shazam lyrics reader) must
    // close normally. Applying the tray policy to them would prevent their
    // cleanup and hide the real application window instead.
    if window.label() != "main" {
        return;
    }
    let state = window.state::<AppState>();
    if state.lifecycle.is_exiting() {
        return;
    }
    api.prevent_close();
    match state.lifecycle.close_behavior() {
        CloseBehavior::Exit => request_full_exit(window.app_handle().clone()),
        CloseBehavior::MinimizeToTray => hide_main_window(window.app_handle()),
        CloseBehavior::Ask => {
            let _ = window.emit("app://confirm-close", ());
        }
    }
}

pub fn request_full_exit(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.lifecycle.is_exiting() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        prepare_exit(&app).await;
        app.exit(0);
    });
}

/// Everything a full exit closes before the process ends; also used before
/// an update installer takes over.
pub async fn prepare_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.lifecycle.request_shutdown();
    let database = state.database.clone();
    let listening_analytics = state.listening_analytics.clone();
    let listen_together = state.listen_together.clone();
    let friends = state.friends.clone();
    let librespot = Arc::clone(&state.librespot);
    listening_analytics.shutdown().await;
    friends.shutdown().await;
    listen_together.shutdown().await;
    librespot.shutdown().await;
    database.close().await;
    state.session.finish();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_close_behavior_is_tray() {
        let lifecycle = AppLifecycle::new();
        assert_eq!(lifecycle.close_behavior(), CloseBehavior::MinimizeToTray);
        assert!(!lifecycle.is_exiting());
    }

    #[test]
    fn full_exit_marks_the_lifecycle_as_exiting() {
        let lifecycle = AppLifecycle::new();
        lifecycle.request_shutdown();
        assert!(lifecycle.is_exiting());
    }
}
