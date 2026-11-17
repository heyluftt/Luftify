mod menu;
mod view;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::{lifecycle, state::AppState};

use self::menu::{MenuItems, build_menu, patch_items};
use self::view::TrayView;

const TRAY_ID: &str = "luft-player-tray";

pub struct TrayState {
    inner: Mutex<Inner>,
}

struct Inner {
    view: TrayView,
    items: Option<MenuItems>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum TrayPlayerAction {
    PlayPause,
    Previous,
    Next,
}

pub fn create(app: &AppHandle) -> tauri::Result<TrayState> {
    let view = TrayView::default();
    let (menu, items) = build_menu(app, &view)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(view.tooltip())
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                lifecycle::show_main_window(tray.app_handle());
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    Ok(TrayState {
        inner: Mutex::new(Inner {
            view,
            items: Some(items),
        }),
    })
}

pub fn spawn_watchers(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut libre = app.state::<AppState>().librespot.subscribe_status();
        loop {
            sync_from_app(&app).await;
            if libre.changed().await.is_err() {
                break;
            }
        }
    });
}

pub async fn sync_from_app(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let librespot_phase = if state.mock_mode {
        luft_librespot::LibrespotPhase::Ready
    } else {
        state.librespot.status().await.phase
    };
    update(app, |view| {
        view.librespot_phase = librespot_phase;
    });
}

pub fn set_tooltip(app: &AppHandle, text: &str) {
    let trimmed = text.trim();
    update(app, |view| {
        view.now_playing = (!trimmed.is_empty()).then(|| trimmed.to_owned());
    });
}

pub fn set_miniplayer_locked(app: &AppHandle, locked: bool) {
    update(app, |view| view.miniplayer_locked = locked);
}

pub fn set_playing(app: &AppHandle, playing: bool) {
    update(app, |view| {
        view.is_playing = playing;
    });
}

pub(crate) fn emit_player_action(app: &AppHandle, action: TrayPlayerAction) {
    // React remains alive while the window is hidden, so this deliberately enters the same
    // command queues used by the visible player controls.
    let _ = app.emit("tray://player-action", action);
}

fn update(app: &AppHandle, patch: impl FnOnce(&mut TrayView)) {
    let Some(state) = app.try_state::<TrayState>() else {
        return;
    };
    let mut inner = state
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    patch(&mut inner.view);
    let view = inner.view.clone();
    let rebuild = inner
        .items
        .as_ref()
        .is_none_or(|items| items.kind != view.libre_action());
    if rebuild {
        if let Ok((menu, items)) = build_menu(app, &view) {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_menu(Some(menu));
            }
            inner.items = Some(items);
        }
    } else if let Some(items) = inner.items.as_ref() {
        patch_items(items, &view);
    }
    drop(inner);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(view.tooltip()));
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "app-open" => lifecycle::show_main_window(app),
        "app-hide" => lifecycle::hide_main_window(app),
        "miniplayer-unlock" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::miniplayer::disable_click_through(app).await;
            });
        }
        "player-play-pause" => emit_player_action(app, TrayPlayerAction::PlayPause),
        "player-previous" => emit_player_action(app, TrayPlayerAction::Previous),
        "player-next" => emit_player_action(app, TrayPlayerAction::Next),
        "librespot-login" => spawn_librespot_login(app.clone()),
        "librespot-reconnect" => spawn_librespot_reconnect(app.clone()),
        "app-settings" => {
            lifecycle::show_main_window(app);
            let _ = app.emit("app://navigate", "/settings");
        }
        "app-quit" => lifecycle::request_full_exit(app.clone()),
        _ => {}
    }
}

fn spawn_librespot_login(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let _ = state.librespot.login_and_connect().await;
    });
}

fn spawn_librespot_reconnect(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let _ = state.librespot.connect_if_possible().await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_player_actions_serialize_as_camel_case() {
        assert_eq!(
            serde_json::to_string(&TrayPlayerAction::PlayPause).expect("json"),
            "\"playPause\""
        );
    }
}
