//! Did the last session end unexpectedly? A marker file lives while the app
//! runs (marker.rs), a watchdog notes when the window stops responding
//! (watchdog.rs), and a panic notes where. At the next start the page offers
//! "Report a problem" with these facts in the diagnostics.
mod marker;
mod watchdog;

use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}},
};

pub use watchdog::start_watchdog;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousSession {
    pub version: String,
    pub started_at_ms: i64,
    /// The last sign of life; the end lies at most half a minute later.
    pub ended_at_ms: i64,
    /// "hang", "panic" or "unknown".
    pub cause: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hang_ms: Option<i64>,
    /// Only for the diagnostics; the page does not show it.
    #[serde(skip)]
    pub panic: Option<String>,
}

pub struct SessionGuard {
    path: PathBuf,
    current: Mutex<marker::Marker>,
    previous: Option<PreviousSession>,
    dismissed: AtomicBool,
    finished: AtomicBool,
}

static GUARD: OnceLock<Arc<SessionGuard>> = OnceLock::new();

impl SessionGuard {
    pub fn start(data: &std::path::Path, version: String) -> Arc<Self> {
        let path = marker::marker_path(data);
        let previous = marker::read(&path).and_then(|old| classify(old, boot_time_ms()));
        if let Some(previous) = &previous {
            tracing::warn!(cause = previous.cause, version = %previous.version, hang_ms = previous.hang_ms, "previous session ended unexpectedly");
        }
        let now = now_ms();
        let current = marker::Marker { started_at_ms: now, alive_at_ms: now, version, ..Default::default() };
        marker::write(&path, &current);
        let guard = Arc::new(Self {
            path,
            current: Mutex::new(current),
            previous,
            dismissed: AtomicBool::new(false),
            finished: AtomicBool::new(false),
        });
        if GUARD.set(Arc::clone(&guard)).is_ok() {
            install_panic_hook();
        }
        guard
    }

    /// For the page, until it is dismissed or reported.
    pub fn previous(&self) -> Option<PreviousSession> {
        self.previous.clone().filter(|_| !self.dismissed.load(Ordering::Acquire))
    }

    pub fn dismiss(&self) {
        self.dismissed.store(true, Ordering::Release);
    }

    /// For the diagnostics, also after the prompt was dismissed.
    pub fn diagnostics(&self) -> serde_json::Value {
        match &self.previous {
            Some(previous) => serde_json::json!({
                "endedUnexpectedly": true,
                "cause": previous.cause,
                "version": previous.version,
                "durationMs": previous.ended_at_ms - previous.started_at_ms,
                "endedAgoMs": now_ms() - previous.ended_at_ms,
                "hangMs": previous.hang_ms,
                "panic": previous.panic,
            }),
            None => serde_json::json!({ "endedUnexpectedly": false }),
        }
    }

    /// A clean exit: no marker, no prompt next time.
    pub fn finish(&self) {
        self.finished.store(true, Ordering::Release);
        marker::remove(&self.path);
    }

    fn update(&self, change: impl FnOnce(&mut marker::Marker)) {
        if self.finished.load(Ordering::Acquire) {
            return;
        }
        let Ok(mut current) = self.current.lock() else { return };
        change(&mut current);
        current.alive_at_ms = now_ms();
        marker::write(&self.path, &current);
    }
}

/// What the old marker says. A PC that restarted since its last sign of life
/// was shut down, not crashed, unless a hang or panic was noted.
fn classify(old: marker::Marker, boot_ms: Option<i64>) -> Option<PreviousSession> {
    let cause = if old.panic.is_some() {
        "panic"
    } else if old.hung_since_ms.is_some() {
        "hang"
    } else if boot_ms.is_some_and(|boot| old.alive_at_ms < boot) {
        return None;
    } else {
        "unknown"
    };
    let hang_ms = match old.hung_since_ms {
        Some(since) => Some(old.alive_at_ms - since),
        None => (old.longest_hang_ms > 0).then_some(old.longest_hang_ms),
    };
    Some(PreviousSession {
        version: old.version,
        started_at_ms: old.started_at_ms,
        ended_at_ms: old.alive_at_ms,
        cause,
        hang_ms,
        panic: old.panic,
    })
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(guard) = GUARD.get() {
            // Only where: the message can carry names, paths or track titles.
            let place = info
                .location()
                .map(|location| format!("{}:{}", location.file(), location.line()))
                .unwrap_or_else(|| "unknown".into());
            let thread = std::thread::current().name().unwrap_or("unnamed").to_owned();
            guard.update(|marker| marker.panic = Some(format!("{place} on thread {thread}")));
        }
        previous(info);
    }));
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(windows)]
fn boot_time_ms() -> Option<i64> {
    let uptime = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() } as i64;
    Some(now_ms() - uptime)
}

#[cfg(not(windows))]
fn boot_time_ms() -> Option<i64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn old(alive: i64) -> marker::Marker {
        marker::Marker { started_at_ms: 1_000, alive_at_ms: alive, version: "0.1.12".into(), ..Default::default() }
    }

    #[test]
    fn a_restarted_pc_is_no_crash_but_a_hang_or_panic_is() {
        assert!(classify(old(5_000), Some(9_000)).is_none());
        assert_eq!(classify(old(5_000), Some(2_000)).unwrap().cause, "unknown");
        let hung = marker::Marker { hung_since_ms: Some(4_000), ..old(5_000) };
        let hung = classify(hung, Some(9_000)).unwrap();
        assert_eq!((hung.cause, hung.hang_ms), ("hang", Some(1_000)));
        let panicked = marker::Marker { panic: Some("src/x.rs:1 on thread main".into()), ..old(5_000) };
        assert_eq!(classify(panicked, None).unwrap().cause, "panic");
    }
}
