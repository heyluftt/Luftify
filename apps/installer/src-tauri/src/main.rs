#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod setup;

use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

fn main() {
    setup::clear_old_scratch();
    // Needs WebView2. Without it, run the plain NSIS installer, which installs it.
    if tauri::webview_version().is_err() {
        let _ = setup::run_classic();
        return;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            setup::info,
            setup::pick_folder,
            setup::install,
            setup::launch,
            setup::classic
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Luftify Setup")
                .inner_size(720.0, 440.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .data_directory(setup::scratch_dir().join("webview"))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("setup window")
        .run(|_, event| {
            if matches!(event, RunEvent::Exit) {
                setup::clear_scratch_after_exit();
            }
        });
}
