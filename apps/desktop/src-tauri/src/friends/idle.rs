//! Time since the last keyboard or mouse input anywhere in Windows, so a
//! listener at another app still counts as active.

#[cfg(windows)]
pub(super) fn idle_ms() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a valid, initialised LASTINPUTINFO with its size set.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    // Both are milliseconds since boot and wrap after ~49 days together.
    let now = unsafe { GetTickCount() };
    Some(u64::from(now.wrapping_sub(info.dwTime)))
}

#[cfg(not(windows))]
pub(super) fn idle_ms() -> Option<u64> {
    None
}

/// Away: nothing playing and no input for a while.
pub(super) fn is_away(idle_ms: Option<u64>, playing: bool) -> bool {
    !playing && idle_ms.is_some_and(|idle| idle >= luft_listen_together::social::AWAY_AFTER_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn music_or_recent_input_keeps_a_listener_active() {
        let long = Some(luft_listen_together::social::AWAY_AFTER_MS + 1);
        assert!(is_away(long, false));
        assert!(!is_away(long, true));
        assert!(!is_away(Some(1_000), false));
        assert!(!is_away(None, false));
    }
}
