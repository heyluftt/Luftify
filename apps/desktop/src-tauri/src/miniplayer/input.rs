use tauri::{Manager, WebviewWindow};

use crate::error::CommandError;

/// Finish the native input change on the window thread before acknowledging it.
pub async fn apply(window: &WebviewWindow, click_through: bool) -> Result<(), CommandError> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = apply_on_window_thread(&target, click_through);
            if result.is_err() && click_through {
                let _ = target.set_ignore_cursor_events(false);
                let _ = target.set_focusable(true);
            }
            let locked = click_through && result.is_ok();
            #[cfg(windows)]
            super::overlay::set_locked(locked);
            crate::tray::set_miniplayer_locked(target.app_handle(), locked);
            let _ = send.send(result);
        })
        .map_err(|error| CommandError::internal(error.to_string()))?;
    receive
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?
        .map_err(CommandError::internal)
}

fn apply_on_window_thread(window: &WebviewWindow, click_through: bool) -> Result<(), String> {
    window
        .set_focusable(!click_through)
        .map_err(|error| error.to_string())?;
    window
        .set_ignore_cursor_events(click_through)
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if click_through {
        use windows::Win32::Foundation::COLORREF;
        use windows::Win32::UI::WindowsAndMessaging::{
            GWL_EXSTYLE, GetWindowLongPtrW, LWA_ALPHA, SetLayeredWindowAttributes, WS_EX_LAYERED,
            WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            // Tao sets the styles; initialize the layered window for Windows hit testing.
            // Keep native alpha opaque: the webview already renders the selected opacity.
            SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA)
                .map_err(|error| error.to_string())?;
            let required = (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE).0;
            if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & required != required {
                return Err("miniplayer click-through window styles were not applied".into());
            }
        }
    }
    Ok(())
}
