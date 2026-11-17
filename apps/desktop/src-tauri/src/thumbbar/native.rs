use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tracing::{info, warn};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateBitmap, CreateDIBSection, DIB_RGB_COLORS,
    DeleteObject,
};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, THB_FLAGS, THB_ICON,
    THB_TOOLTIP, THBF_ENABLED, THBN_CLICKED, THUMBBUTTON, TaskbarList,
};
use windows::Win32::UI::WindowsAndMessaging::{
    ChangeWindowMessageFilterEx, CreateIconIndirect, DestroyIcon, HICON, ICONINFO, MSGFLT_ALLOW,
    PostMessageW, RegisterWindowMessageW, WM_APP, WM_COMMAND, WM_NCDESTROY,
};
use windows::core::w;

use super::icons::{self, Glyph, SIZE};
use crate::tray::{TrayPlayerAction, emit_player_action};

const ID_PREV: u32 = 1;
const ID_PLAY: u32 = 2;
const ID_NEXT: u32 = 3;
const SUBCLASS_ID: usize = 0x4C55_4654;
const WM_THUMBBAR_PLAYING: u32 = WM_APP + 0x71;

struct ThumbBarState {
    hwnd: isize,
}

struct Icons {
    previous: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}

impl Drop for Icons {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.previous);
            let _ = DestroyIcon(self.play);
            let _ = DestroyIcon(self.pause);
            let _ = DestroyIcon(self.next);
        }
    }
}

struct Host {
    app: AppHandle,
    hwnd: HWND,
    taskbar: ITaskbarList3,
    icons: Icons,
    playing: AtomicBool,
    added: AtomicBool,
    created_msg: u32,
}

pub fn attach(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        warn!("thumbnail toolbar skipped: no main window");
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        warn!("thumbnail toolbar skipped: no hwnd");
        return;
    };
    if let Err(error) = attach_hwnd(app.clone(), hwnd) {
        warn!(%error, "thumbnail toolbar failed to attach");
        return;
    }
    app.manage(ThumbBarState {
        hwnd: hwnd.0 as isize,
    });
    info!(phase = "thumbbar", "taskbar media buttons ready");
}

pub fn set_playing(app: &AppHandle, playing: bool) {
    let Some(state) = app.try_state::<ThumbBarState>() else {
        return;
    };
    let hwnd = HWND(state.hwnd as *mut core::ffi::c_void);
    let _ = unsafe {
        PostMessageW(
            Some(hwnd),
            WM_THUMBBAR_PLAYING,
            WPARAM(usize::from(playing)),
            LPARAM(0),
        )
    };
}

fn attach_hwnd(app: AppHandle, hwnd: HWND) -> windows::core::Result<()> {
    let created_msg = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
    if created_msg != 0 {
        let _ = unsafe { ChangeWindowMessageFilterEx(hwnd, created_msg, MSGFLT_ALLOW, None) };
    }
    let taskbar: ITaskbarList3 =
        unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)? };
    unsafe { taskbar.HrInit()? };
    let host = Box::new(Host {
        app,
        hwnd,
        taskbar,
        icons: Icons {
            previous: icon_from_glyph(Glyph::Previous)?,
            play: icon_from_glyph(Glyph::Play)?,
            pause: icon_from_glyph(Glyph::Pause)?,
            next: icon_from_glyph(Glyph::Next)?,
        },
        playing: AtomicBool::new(false),
        added: AtomicBool::new(false),
        created_msg,
    });
    let _ = host.add_buttons();
    let ptr = Box::into_raw(host);
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, ptr as usize) };
    if !ok.as_bool() {
        drop(unsafe { Box::from_raw(ptr) });
        return Err(windows::core::Error::from_win32());
    }
    Ok(())
}

impl Host {
    fn add_buttons(&self) -> windows::core::Result<()> {
        if self.added.load(Ordering::Acquire) {
            return Ok(());
        }
        let buttons = self.buttons();
        unsafe { self.taskbar.ThumbBarAddButtons(self.hwnd, &buttons)? };
        self.added.store(true, Ordering::Release);
        Ok(())
    }

    fn update_play(&self, playing: bool) {
        self.playing.store(playing, Ordering::Release);
        if !self.added.load(Ordering::Acquire) {
            return;
        }
        let buttons = [self.play_button()];
        let _ = unsafe { self.taskbar.ThumbBarUpdateButtons(self.hwnd, &buttons) };
    }

    fn buttons(&self) -> [THUMBBUTTON; 3] {
        [
            button(ID_PREV, self.icons.previous, "Vorheriger Titel"),
            self.play_button(),
            button(ID_NEXT, self.icons.next, "Nächster Titel"),
        ]
    }

    fn play_button(&self) -> THUMBBUTTON {
        if self.playing.load(Ordering::Acquire) {
            button(ID_PLAY, self.icons.pause, "Pause")
        } else {
            button(ID_PLAY, self.icons.play, "Wiedergeben")
        }
    }
}

fn button(id: u32, icon: HICON, tip: &str) -> THUMBBUTTON {
    let mut sz_tip = [0u16; 260];
    for (slot, unit) in sz_tip.iter_mut().zip(tip.encode_utf16().take(259)) {
        *slot = unit;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: sz_tip,
        dwFlags: THBF_ENABLED,
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    ref_data: usize,
) -> LRESULT {
    let host = unsafe { &*(ref_data as *const Host) };
    if msg == host.created_msg && host.created_msg != 0 {
        host.added.store(false, Ordering::Release);
        if let Err(error) = host.add_buttons() {
            warn!(%error, "thumbnail toolbar add failed");
        }
        return unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
    }
    if msg == WM_THUMBBAR_PLAYING {
        host.update_play(wparam.0 != 0);
        return LRESULT(0);
    }
    if msg == WM_COMMAND {
        let value = wparam.0 as u32;
        let id = value & 0xffff;
        let code = value >> 16;
        if code == THBN_CLICKED {
            let action = match id {
                ID_PREV => Some(TrayPlayerAction::Previous),
                ID_PLAY => Some(TrayPlayerAction::PlayPause),
                ID_NEXT => Some(TrayPlayerAction::Next),
                _ => None,
            };
            if let Some(action) = action {
                emit_player_action(&host.app, action);
            }
            return LRESULT(0);
        }
    }
    if msg == WM_NCDESTROY {
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
        }
        drop(unsafe { Box::from_raw(ref_data as *mut Host) });
        return unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn icon_from_glyph(glyph: Glyph) -> windows::core::Result<HICON> {
    let pixels = icons::render(glyph);
    let size = SIZE as i32;
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let color = unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? };
    if bits.is_null() {
        unsafe {
            let _ = DeleteObject(color.into());
        };
        return Err(windows::core::Error::from_win32());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u32>(), pixels.len());
    }
    let mask_bytes = vec![0u8; (((SIZE + 31) / 32) * 4) * SIZE];
    let mask = unsafe { CreateBitmap(size, size, 1, 1, Some(mask_bytes.as_ptr().cast())) };
    if mask.is_invalid() {
        unsafe {
            let _ = DeleteObject(color.into());
        };
        return Err(windows::core::Error::from_win32());
    }
    let icon_info = ICONINFO {
        fIcon: TRUE,
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let icon = unsafe { CreateIconIndirect(&icon_info) };
    unsafe {
        let _ = DeleteObject(color.into());
        let _ = DeleteObject(mask.into());
    }
    icon
}
