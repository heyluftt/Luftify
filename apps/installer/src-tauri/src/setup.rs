use std::{
    env, fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{self, Command},
};

use serde::Serialize;
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

include!(concat!(env!("OUT_DIR"), "/payload.rs"));

const PRODUCT: &str = "Luftify";
const APP_EXE: &str = "luft-desktop.exe";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Luftify";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInfo {
    version: String,
    size_mb: f64,
    folder: String,
    installed: bool,
    /// Built without the real installer inside: everything is only shown.
    preview: bool,
}

const SCRATCH_PREFIX: &str = "luftify-setup-";

pub fn scratch_dir() -> PathBuf {
    env::temp_dir().join(format!("{SCRATCH_PREFIX}{}", process::id()))
}

/// WebView2 keeps its files locked on exit, so leftovers are removed on the next start.
pub fn clear_old_scratch() {
    let Ok(entries) = fs::read_dir(env::temp_dir()) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(SCRATCH_PREFIX) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn clear_scratch_after_exit() {
    let dir = scratch_dir();
    let _ = Command::new("cmd")
        .raw_arg(format!("/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"{}\"", dir.display()))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn default_folder() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join(PRODUCT)
}

fn installed_folder() -> Option<PathBuf> {
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()?;
    let location: String = key.get_value("InstallLocation").ok()?;
    let folder = PathBuf::from(location.trim_matches('"'));
    folder.join(APP_EXE).is_file().then_some(folder)
}

fn extract_payload() -> Result<PathBuf, String> {
    let dir = scratch_dir();
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("Luftify-setup.exe");
    fs::write(&path, PAYLOAD).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Fallback: the plain NSIS installer with its own window.
pub fn run_classic() -> Result<(), String> {
    if PAYLOAD.is_empty() {
        return Err("no installer inside".into());
    }
    Command::new(extract_payload()?)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn info() -> SetupInfo {
    let installed = installed_folder();
    SetupInfo {
        version: env!("LUFTIFY_SETUP_VERSION").to_string(),
        size_mb: PAYLOAD.len() as f64 / 1_048_576.0,
        folder: installed
            .clone()
            .unwrap_or_else(default_folder)
            .display()
            .to_string(),
        installed: installed.is_some(),
        preview: PAYLOAD.is_empty(),
    }
}

#[tauri::command]
pub async fn pick_folder(current: String) -> Option<String> {
    let start = Path::new(&current)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_folder);
    let picked = rfd::AsyncFileDialog::new().set_directory(start).pick_folder().await?;
    let mut folder = picked.path().to_path_buf();
    if folder.file_name().is_none_or(|name| name != PRODUCT) {
        folder.push(PRODUCT);
    }
    Some(folder.display().to_string())
}

#[tauri::command]
pub async fn install(folder: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if PAYLOAD.is_empty() {
            std::thread::sleep(std::time::Duration::from_secs(4));
            return Ok(());
        }
        let installer = extract_payload()?;
        let mut command = Command::new(&installer);
        command.arg("/S").creation_flags(CREATE_NO_WINDOW);
        // NSIS takes the folder unquoted and as its last argument.
        if Path::new(&folder) != default_folder() {
            command.raw_arg(format!("/D={folder}"));
        }
        let status = command.status().map_err(|error| error.to_string())?;
        let _ = fs::remove_file(&installer);
        if status.success() {
            Ok(())
        } else {
            Err(format!("exit code {}", status.code().unwrap_or(-1)))
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn launch(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let folder = installed_folder().unwrap_or_else(|| PathBuf::from(folder));
    if !PAYLOAD.is_empty() {
        Command::new(folder.join(APP_EXE))
            .current_dir(&folder)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn classic(app: tauri::AppHandle) -> Result<(), String> {
    run_classic()?;
    app.exit(0);
    Ok(())
}
