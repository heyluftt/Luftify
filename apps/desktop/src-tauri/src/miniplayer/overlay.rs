//! Keeps the mini player usable over games (Windows).
//!
//! One thread with a message loop does three things:
//! - "Always on top" is asserted again whenever another window (a game in
//!   borderless mode) takes the foreground, and every 1.5 s: a single
//!   `HWND_TOPMOST` at show time lost against games that raise themselves.
//! - While click-through is on, the hotkeys (Ctrl+Alt+M, Ctrl+Shift+F10)
//!   end it, and the same keys are polled for games that swallow hotkeys.
//! - Resting a visible pointer on the lock badge for two seconds ends it
//!   as well. It needs no click (a click would reach the game) and no keys
//!   (which an elevated game can keep from us).

use std::sync::{
    Mutex,
    atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering},
};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tracing::warn;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Threading::{GetCurrentThreadId, INFINITE};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey, VK_CONTROL,
    VK_F10, VK_M, VK_MENU, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CURSOR_SHOWING, CURSORINFO, EVENT_SYSTEM_FOREGROUND, GetCursorInfo, HWND_TOPMOST,
    IsWindowVisible, MSG, MsgWaitForMultipleObjects, PM_REMOVE, PeekMessageW, PostThreadMessageW,
    QS_ALLINPUT, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    SetWindowPos, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP, WM_HOTKEY,
};

/// How long the pointer rests on the lock before click-through ends.
const DWELL: Duration = Duration::from_millis(2_000);
const TOPMOST_REFRESH: Duration = Duration::from_millis(1_500);
const LOCKED_TICK_MS: u32 = 40;
const TOPMOST_TICK_MS: u32 = 1_500;
const WM_WAKE: u32 = WM_APP + 0x4c;
const HOTKEY_ID: i32 = 0x4c46;
const ALTERNATE_HOTKEY_ID: i32 = 0x4c47;
pub const UNLOCK_PROGRESS_EVENT: &str = "miniplayer://unlock-progress";

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static TOPMOST: AtomicBool = AtomicBool::new(false);
static LOCKED: AtomicBool = AtomicBool::new(false);
static THREAD: AtomicU32 = AtomicU32::new(0);
static ZONE: Mutex<Option<UnlockZone>> = Mutex::new(None);

/// The lock badge in the webview's CSS pixels; `scale` is devicePixelRatio.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnlockZone {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || run(app));
}

/// The shown window and whether it should stay above everything.
pub fn track_window(hwnd: HWND, topmost: bool) {
    WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
    TOPMOST.store(topmost, Ordering::SeqCst);
    wake();
}

pub fn forget_window() {
    WINDOW.store(0, Ordering::SeqCst);
    TOPMOST.store(false, Ordering::SeqCst);
    LOCKED.store(false, Ordering::SeqCst);
    set_zone(None);
    wake();
}

pub fn set_locked(locked: bool) {
    LOCKED.store(locked, Ordering::SeqCst);
    wake();
}

pub fn set_zone(zone: Option<UnlockZone>) {
    let valid = zone.filter(|zone| {
        [zone.x, zone.y, zone.width, zone.height, zone.scale]
            .iter()
            .all(|value| value.is_finite())
            && zone.width > 0.0
            && zone.height > 0.0
            && zone.scale > 0.0
    });
    if let Ok(mut current) = ZONE.lock() {
        *current = valid;
    }
}

fn wake() {
    let thread = THREAD.load(Ordering::SeqCst);
    if thread != 0 {
        unsafe {
            let _ = PostThreadMessageW(thread, WM_WAKE, WPARAM(0), LPARAM(0));
        }
    }
}

fn window() -> Option<HWND> {
    let raw = WINDOW.load(Ordering::SeqCst);
    (raw != 0).then(|| HWND(raw as *mut _))
}

fn run(app: AppHandle) {
    unsafe {
        THREAD.store(GetCurrentThreadId(), Ordering::SeqCst);
        let original = RegisterHotKey(
            None,
            HOTKEY_ID,
            MOD_ALT | MOD_CONTROL | MOD_NOREPEAT,
            u32::from(VK_M.0),
        );
        let alternate = RegisterHotKey(
            None,
            ALTERNATE_HOTKEY_ID,
            MOD_SHIFT | MOD_CONTROL | MOD_NOREPEAT,
            u32::from(VK_F10.0),
        );
        if let Err(error) = &original {
            warn!(%error, "could not register Ctrl+Alt+M for miniplayer");
        }
        if let Err(error) = &alternate {
            warn!(%error, "could not register Ctrl+Shift+F10 for miniplayer");
        }
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(on_foreground),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        );
        if hook.is_invalid() {
            warn!("could not watch foreground changes for the miniplayer");
        }

        let mut dwell = Dwell::default();
        let mut last_topmost = Instant::now();
        let mut message = MSG::default();
        loop {
            let locked = LOCKED.load(Ordering::SeqCst) && window().is_some();
            let topmost = TOPMOST.load(Ordering::SeqCst) && window().is_some();
            let timeout = if locked {
                LOCKED_TICK_MS
            } else if topmost {
                TOPMOST_TICK_MS
            } else {
                INFINITE
            };
            MsgWaitForMultipleObjects(None, false, timeout, QS_ALLINPUT);
            // WinEvent callbacks run while messages are retrieved here.
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                if message.message == WM_HOTKEY
                    && (message.wParam.0 == HOTKEY_ID as usize
                        || message.wParam.0 == ALTERNATE_HOTKEY_ID as usize)
                {
                    unlock(&app, &mut dwell);
                }
            }
            if topmost && last_topmost.elapsed() >= TOPMOST_REFRESH {
                last_topmost = Instant::now();
                assert_topmost();
            }
            if LOCKED.load(Ordering::SeqCst) && window().is_some() {
                if unlock_keys_down() {
                    unlock(&app, &mut dwell);
                } else {
                    dwell.tick(&app);
                }
            } else {
                dwell.reset(&app);
            }
        }
    }
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK,
    _event: u32,
    _hwnd: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _time: u32,
) {
    if TOPMOST.load(Ordering::SeqCst) {
        assert_topmost();
    }
}

fn assert_topmost() {
    let Some(hwnd) = window() else {
        return;
    };
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return;
        }
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
        );
    }
}

fn unlock_keys_down() -> bool {
    unsafe {
        let down = |key: u16| GetAsyncKeyState(i32::from(key)) < 0;
        down(VK_CONTROL.0)
            && ((down(VK_SHIFT.0) && down(VK_F10.0)) || (down(VK_MENU.0) && down(VK_M.0)))
    }
}

fn unlock(app: &AppHandle, dwell: &mut Dwell) {
    // Stop polling at once; input::apply confirms the state again.
    LOCKED.store(false, Ordering::SeqCst);
    dwell.reset(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move { super::disable_click_through(app).await });
}

#[derive(Default)]
struct Dwell {
    since: Option<Instant>,
    reported: f64,
}

impl Dwell {
    fn tick(&mut self, app: &AppHandle) {
        if !pointer_on_lock() {
            self.reset(app);
            return;
        }
        let since = *self.since.get_or_insert_with(Instant::now);
        let progress = (since.elapsed().as_secs_f64() / DWELL.as_secs_f64()).min(1.0);
        if progress >= 1.0 {
            unlock(app, self);
            return;
        }
        if progress - self.reported >= 0.04 {
            self.reported = progress;
            let _ = app.emit(UNLOCK_PROGRESS_EVENT, progress);
        }
    }

    fn reset(&mut self, app: &AppHandle) {
        if self.since.take().is_some() || self.reported > 0.0 {
            self.reported = 0.0;
            let _ = app.emit(UNLOCK_PROGRESS_EVENT, 0.0);
        }
    }
}

/// Only a visible pointer counts: a game that hides and centres it must
/// not unlock the player by chance.
fn pointer_on_lock() -> bool {
    let (Some(hwnd), Some(zone)) = (window(), ZONE.lock().ok().and_then(|zone| *zone)) else {
        return false;
    };
    unsafe {
        let mut cursor = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut cursor).is_err() || cursor.flags.0 & CURSOR_SHOWING.0 == 0 {
            return false;
        }
        let mut origin = POINT::default();
        if !ClientToScreen(hwnd, &mut origin).as_bool() {
            return false;
        }
        zone_contains(zone, origin, cursor.ptScreenPos)
    }
}

fn zone_contains(zone: UnlockZone, origin: POINT, point: POINT) -> bool {
    let left = f64::from(origin.x) + zone.x * zone.scale;
    let top = f64::from(origin.y) + zone.y * zone.scale;
    let x = f64::from(point.x);
    let y = f64::from(point.y);
    x >= left
        && x <= left + zone.width * zone.scale
        && y >= top
        && y <= top + zone.height * zone.scale
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_zone_follows_window_origin_and_display_scale() {
        let zone = UnlockZone {
            x: 340.0,
            y: 8.0,
            width: 30.0,
            height: 30.0,
            scale: 1.5,
        };
        let origin = POINT { x: 100, y: 200 };
        assert!(zone_contains(
            zone,
            origin,
            POINT {
                x: 100 + 520,
                y: 200 + 20
            }
        ));
        assert!(!zone_contains(
            zone,
            origin,
            POINT {
                x: 100 + 500,
                y: 200 + 20
            }
        ));
        assert!(!zone_contains(
            zone,
            origin,
            POINT {
                x: 100 + 520,
                y: 200 + 60
            }
        ));
    }
}
