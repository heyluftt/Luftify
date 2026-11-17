//! Minimised or in the tray, nobody sees the page: WebView2 may trim caches
//! and memory (`MemoryUsageTargetLevel` low). Back in view it returns to
//! normal. Only a hint: rendering, playback and events keep running.
use tauri::WebviewWindow;

pub fn set_idle(window: &WebviewWindow, idle: bool) {
    #[cfg(windows)]
    {
        let result = window.with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
                ICoreWebView2_19,
            };
            use windows::core::Interface;
            let level = if idle { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
            // Older WebView2 runtimes lack the interface; then nothing changes.
            let applied = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_19>())
                    .and_then(|core| core.SetMemoryUsageTargetLevel(level))
            };
            if applied.is_err() {
                tracing::debug!(idle, "webview memory target unavailable");
            }
        });
        if result.is_err() {
            tracing::debug!(idle, "webview memory target not applied");
        }
    }
    #[cfg(not(windows))]
    let _ = (window, idle);
}
