use tauri::{
    AppHandle, Wry,
    menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder},
};

use super::view::{LibreTrayAction, TrayView};

pub(super) struct MenuItems {
    pub now_playing: MenuItem<Wry>,
    pub play_pause: MenuItem<Wry>,
    pub previous: MenuItem<Wry>,
    pub next: MenuItem<Wry>,
    pub engine_status: MenuItem<Wry>,
    pub miniplayer_unlock: MenuItem<Wry>,
    pub kind: LibreTrayAction,
}

pub(super) fn build_menu(
    app: &AppHandle,
    view: &TrayView,
) -> tauri::Result<(Menu<Wry>, MenuItems)> {
    let open = item(app, "app-open", "Öffnen", true)?;
    let hide = item(app, "app-hide", "Ausblenden", true)?;
    let miniplayer_unlock = item(
        app,
        "miniplayer-unlock",
        "Miniplayer wieder bedienbar",
        view.miniplayer_locked,
    )?;
    let now_playing = item(app, "now-playing", &view.now_playing_label(), false)?;
    let play_pause = item(
        app,
        "player-play-pause",
        view.play_pause_label(),
        view.playback_enabled(),
    )?;
    let previous = item(
        app,
        "player-previous",
        "Vorheriger Titel",
        view.playback_enabled(),
    )?;
    let next = item(
        app,
        "player-next",
        "Nächster Titel",
        view.playback_enabled(),
    )?;
    let engine_status = item(app, "engine-status", &view.engine_status_label(), false)?;
    let settings = item(app, "app-settings", "Einstellungen", true)?;
    let quit = item(app, "app-quit", "Beenden", true)?;

    let mut menu = MenuBuilder::new(app)
        .item(&open)
        .item(&hide)
        .item(&miniplayer_unlock)
        .separator()
        .item(&now_playing)
        .item(&play_pause)
        .item(&previous)
        .item(&next)
        .separator()
        .item(&engine_status);

    if let Some(label) = view.libre_action_label() {
        let id = match view.libre_action() {
            LibreTrayAction::Login => "librespot-login",
            _ => "librespot-reconnect",
        };
        let action_item = item(app, id, label, true)?;
        menu = menu.item(&action_item);
    }

    let menu = menu.separator().item(&settings).item(&quit).build()?;
    Ok((
        menu,
        MenuItems {
            now_playing,
            play_pause,
            previous,
            next,
            engine_status,
            miniplayer_unlock,
            kind: view.libre_action(),
        },
    ))
}

pub(super) fn patch_items(items: &MenuItems, view: &TrayView) {
    let _ = items.now_playing.set_text(view.now_playing_label());
    let _ = items.play_pause.set_text(view.play_pause_label());
    let playback = view.playback_enabled();
    let _ = items.play_pause.set_enabled(playback);
    let _ = items.previous.set_enabled(playback);
    let _ = items.next.set_enabled(playback);
    let _ = items.engine_status.set_text(view.engine_status_label());
    let _ = items.miniplayer_unlock.set_enabled(view.miniplayer_locked);
}

fn item(app: &AppHandle, id: &str, text: &str, enabled: bool) -> tauri::Result<MenuItem<Wry>> {
    MenuItemBuilder::with_id(id, text)
        .enabled(enabled)
        .build(app)
}
