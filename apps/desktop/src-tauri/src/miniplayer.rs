use luft_infrastructure::{MiniPlayerSettings, Settings};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tracing::{info, warn};

use crate::{error::CommandError, state::AppState};

mod input;
#[cfg(windows)]
mod overlay;

#[cfg(windows)]
pub use overlay::UnlockZone;

pub const MINIPLAYER_LABEL: &str = "miniplayer";
const MINIPLAYER_WIDTH: f64 = 390.0;
/// Two rows of controls plus the timed progress line.
const MINIPLAYER_HEIGHT: f64 = 116.0;
/// Room for the queue or playlist panel below the player.
const MINIPLAYER_PANEL_HEIGHT: f64 = 228.0;
static EXPANDED: AtomicBool = AtomicBool::new(false);

pub async fn set_expanded(app: &AppHandle, expanded: bool) -> Result<(), CommandError> {
    let settings = load_settings(app).await?;
    EXPANDED.store(expanded, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(MINIPLAYER_LABEL) {
        apply_window_settings(app, &window, &settings.miniplayer, false)
            .map_err(|error| CommandError::internal(error.to_string()))?;
        if expanded {
            if let (Ok(position), Ok(size), Ok(Some(monitor))) = (
                window.outer_position(),
                window.outer_size(),
                window.current_monitor(),
            ) {
                let top = monitor.position().y;
                let bottom = top + monitor.size().height as i32;
                let y = position
                    .y
                    .clamp(top, (bottom - size.height as i32).max(top));
                if y != position.y {
                    window
                        .set_position(PhysicalPosition::new(position.x, y))
                        .map_err(|error| CommandError::internal(error.to_string()))?;
                }
            }
        }
    }
    Ok(())
}
const MIN_VISIBLE_EDGE: i32 = 72;

/// Each step is logged: a freeze on opening (once seen as "not responding")
/// then shows in the log where it stopped.
pub async fn show(app: &AppHandle) -> Result<(), CommandError> {
    let started = std::time::Instant::now();
    let step = |name: &str| info!(step = name, elapsed_ms = started.elapsed().as_millis() as u64, "miniplayer opening");
    let settings = load_settings(app).await?;
    let window = match app.get_webview_window(MINIPLAYER_LABEL) {
        Some(window) => window,
        None => {
            step("create");
            let mut builder = WebviewWindowBuilder::new(
                app,
                MINIPLAYER_LABEL,
                WebviewUrl::App("index.html".into()),
            );
            if let Some(directory) = crate::commands::accounts::webview_directory(app) {
                builder = builder.data_directory(directory);
            }
            builder
                .title("Luftify")
                .decorations(false)
                .shadow(false)
                .transparent(true)
                .resizable(false)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build()
                .map_err(|error| CommandError::internal(error.to_string()))?
        }
    };
    step("settings");
    apply_window_settings(app, &window, &settings.miniplayer, true)
        .map_err(|error| CommandError::internal(error.to_string()))?;
    step("input");
    input::apply(&window, settings.miniplayer.click_through).await?;
    step("show");
    window
        .show()
        .map_err(|error| CommandError::internal(error.to_string()))?;
    step("shown");
    Ok(())
}

pub fn hide(app: &AppHandle) -> Result<(), CommandError> {
    if let Some(window) = app.get_webview_window(MINIPLAYER_LABEL) {
        // Release the WebView just like Alt+F4; hiding keeps its runtime alive.
        window
            .close()
            .map_err(|error| CommandError::internal(error.to_string()))?;
    }
    Ok(())
}

pub fn on_closed(app: &AppHandle) {
    EXPANDED.store(false, Ordering::SeqCst);
    #[cfg(windows)]
    overlay::forget_window();
    crate::tray::set_miniplayer_locked(app, false);
}

/// Where the lock badge sits, so resting the pointer there can unlock.
#[cfg(windows)]
pub fn set_unlock_zone(zone: Option<UnlockZone>) {
    overlay::set_zone(zone);
}

pub async fn apply_saved_settings(
    app: &AppHandle,
    settings: &MiniPlayerSettings,
) -> Result<(), CommandError> {
    let Some(window) = app.get_webview_window(MINIPLAYER_LABEL) else {
        return Ok(());
    };
    apply_window_settings(app, &window, settings, false)
        .map_err(|error| CommandError::internal(error.to_string()))?;
    input::apply(&window, settings.click_through).await
}

pub async fn save_position(app: &AppHandle, x: i32, y: i32) -> Result<(), CommandError> {
    let state = app.state::<AppState>();
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut settings = database
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    settings.miniplayer.position_x = Some(x);
    settings.miniplayer.position_y = Some(y);
    database
        .save_settings(&settings)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let _ = app.emit("settings://changed", ());
    Ok(())
}

pub async fn save_settings(
    app: &AppHandle,
    mut settings: MiniPlayerSettings,
) -> Result<MiniPlayerSettings, CommandError> {
    if !settings.scale.is_finite()
        || !(0.75..=1.5).contains(&settings.scale)
        || !(35..=100).contains(&settings.opacity_percent)
    {
        return Err(CommandError::internal("miniplayer settings are invalid"));
    }
    let state = app.state::<AppState>();
    let database = state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let mut current = database
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    settings.position_x = current.miniplayer.position_x;
    settings.position_y = current.miniplayer.position_y;
    apply_saved_settings(app, &settings).await?;
    current.miniplayer = settings.clone();
    database
        .save_settings(&current)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let _ = app.emit("settings://changed", ());
    Ok(settings)
}

pub async fn disable_click_through(app: AppHandle) {
    // Restore interaction even if storage is slow or unavailable.
    if let Some(window) = app.get_webview_window(MINIPLAYER_LABEL) {
        if let Err(error) = input::apply(&window, false).await {
            warn!(error = ?error, "could not restore miniplayer interaction");
        }
    }
    let state = app.state::<AppState>();
    let Ok(database) = state.database.get().await else {
        return;
    };
    let Ok(mut settings) = database.settings().await else {
        return;
    };
    if !settings.miniplayer.click_through {
        return;
    }
    settings.miniplayer.click_through = false;
    if database.save_settings(&settings).await.is_ok() {
        let _ = app.emit("settings://changed", ());
    }
}

/// Hotkeys, topmost upkeep and the lock badge (see `overlay`).
pub fn start_overlay_watch(app: AppHandle) {
    #[cfg(windows)]
    overlay::start(app);
    #[cfg(not(windows))]
    let _ = app;
}

fn apply_window_settings(
    app: &AppHandle,
    window: &WebviewWindow,
    settings: &MiniPlayerSettings,
    restore_position: bool,
) -> tauri::Result<()> {
    window.set_always_on_top(settings.always_on_top)?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        overlay::track_window(hwnd, settings.always_on_top);
    }
    window.set_size(tauri::LogicalSize::new(
        MINIPLAYER_WIDTH * settings.scale,
        (MINIPLAYER_HEIGHT
            + if EXPANDED.load(Ordering::SeqCst) {
                MINIPLAYER_PANEL_HEIGHT
            } else {
                0.0
            })
            * settings.scale,
    ))?;
    if restore_position {
        window.set_position(bounded_position(app, settings))?;
    }
    Ok(())
}

fn bounded_position(app: &AppHandle, settings: &MiniPlayerSettings) -> PhysicalPosition<i32> {
    let desired = PhysicalPosition::new(
        settings.position_x.unwrap_or(40),
        settings.position_y.unwrap_or(40),
    );
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|mut monitors| monitors.drain(..).next())
        });
    let Some(monitor) = monitor else {
        return desired;
    };
    let position = monitor.position();
    let size = monitor.size();
    let right = position.x + i32::try_from(size.width).unwrap_or(i32::MAX);
    let bottom = position.y + i32::try_from(size.height).unwrap_or(i32::MAX);
    PhysicalPosition::new(
        desired.x.clamp(position.x - 300, right - MIN_VISIBLE_EDGE),
        desired.y.clamp(position.y - 90, bottom - MIN_VISIBLE_EDGE),
    )
}

async fn load_settings(app: &AppHandle) -> Result<Settings, CommandError> {
    let state = app.state::<AppState>();
    state
        .database
        .get()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .settings()
        .await
        .map_err(|error| CommandError::internal(error.to_string()))
}
