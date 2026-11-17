use std::path::Path;

use thiserror::Error;

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME: &str = "Luftify";
const LEGACY_VALUE_NAME: &str = "LuftSpotPlayer";

#[derive(Debug, Error)]
pub enum AutostartError {
    #[error("Windows autostart could not be changed: {0}")]
    Native(#[source] std::io::Error),
    #[error("the autostart worker stopped unexpectedly")]
    Worker,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsAutostartService;

impl WindowsAutostartService {
    pub async fn set_enabled(
        &self,
        executable: &Path,
        enabled: bool,
    ) -> Result<(), AutostartError> {
        let executable = executable.to_path_buf();
        tokio::task::spawn_blocking(move || set_enabled_sync(&executable, enabled))
            .await
            .map_err(|_| AutostartError::Worker)?
    }

    pub async fn is_enabled(&self) -> Result<bool, AutostartError> {
        tokio::task::spawn_blocking(is_enabled_sync)
            .await
            .map_err(|_| AutostartError::Worker)?
    }

    pub async fn ensure_enabled(&self, executable: &Path) -> Result<(), AutostartError> {
        let executable = executable.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let expected = command_for(&executable);
            if get_command_sync()?.is_some_and(|actual| actual.eq_ignore_ascii_case(&expected)) {
                Ok(())
            } else {
                set_enabled_sync(&executable, true)
            }
        })
        .await
        .map_err(|_| AutostartError::Worker)?
    }
}

#[cfg(windows)]
fn set_enabled_sync(executable: &Path, enabled: bool) -> Result<(), AutostartError> {
    use std::mem::size_of;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RegCloseKey,
            RegCreateKeyExW, RegDeleteKeyValueW, RegSetValueExW,
        },
    };
    let key = wide(RUN_KEY);
    let name = wide(VALUE_NAME);
    let result = if enabled {
        let command = wide(&command_for(executable));
        let mut handle: HKEY = std::ptr::null_mut();
        // SAFETY: the subkey is nul-terminated and the returned handle is closed below.
        let create_result = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                0,
                std::ptr::null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut handle,
                std::ptr::null_mut(),
            )
        };
        if create_result != ERROR_SUCCESS {
            create_result
        } else {
            // SAFETY: the value name and command are nul-terminated, and the data length
            // includes the UTF-16 terminator.
            let set_result = unsafe {
                RegSetValueExW(
                    handle,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    command.as_ptr().cast::<u8>(),
                    (command.len() * size_of::<u16>()) as u32,
                )
            };
            // SAFETY: handle was returned by RegCreateKeyExW above.
            let _ = unsafe { RegCloseKey(handle) };
            set_result
        }
    } else {
        // SAFETY: all strings are nul-terminated and HKCU is process-owned by Windows.
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) }
    };
    let legacy = wide(LEGACY_VALUE_NAME);
    // SAFETY: the legacy autostart value is optional and missing keys are ignored.
    let _ = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), legacy.as_ptr()) };
    if result == ERROR_SUCCESS || !enabled && result == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(AutostartError::Native(std::io::Error::from_raw_os_error(
            result as i32,
        )))
    }
}

#[cfg(windows)]
fn is_enabled_sync() -> Result<bool, AutostartError> {
    get_command_sync().map(|command| command.is_some())
}

#[cfg(windows)]
fn get_command_sync() -> Result<Option<String>, AutostartError> {
    use std::ffi::c_void;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW},
    };
    let key = wide(RUN_KEY);
    let name = wide(VALUE_NAME);
    let mut bytes = 0_u32;
    // SAFETY: this first query only requests the required buffer size.
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut::<c_void>(),
            &mut bytes,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    if result != ERROR_SUCCESS || bytes == 0 {
        return Err(AutostartError::Native(std::io::Error::from_raw_os_error(
            result as i32,
        )));
    }
    let mut buffer = vec![0_u16; (bytes as usize).div_ceil(std::mem::size_of::<u16>())];
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast::<c_void>(),
            &mut bytes,
        )
    };
    if result != ERROR_SUCCESS {
        return Err(AutostartError::Native(std::io::Error::from_raw_os_error(
            result as i32,
        )));
    }
    let end = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16(&buffer[..end])
        .map(Some)
        .map_err(|error| {
            AutostartError::Native(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
        })
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn set_enabled_sync(_executable: &Path, _enabled: bool) -> Result<(), AutostartError> {
    Ok(())
}
#[cfg(not(windows))]
fn is_enabled_sync() -> Result<bool, AutostartError> {
    Ok(false)
}

#[cfg(not(windows))]
fn get_command_sync() -> Result<Option<String>, AutostartError> {
    Ok(None)
}

fn command_for(executable: &Path) -> String {
    format!("\"{}\" --autostart", executable.display())
}

#[cfg(test)]
mod tests {
    #[test]
    fn run_key_is_current_user_scoped() {
        assert!(super::RUN_KEY.ends_with("CurrentVersion\\Run"));
        assert_eq!(super::VALUE_NAME, "Luftify");
    }

    #[test]
    fn command_quotes_paths_and_marks_autostart_launch() {
        let command =
            super::command_for(std::path::Path::new("C:/Program Files/Luftify/Luftify.exe"));
        assert_eq!(
            command,
            "\"C:/Program Files/Luftify/Luftify.exe\" --autostart"
        );
    }
}
