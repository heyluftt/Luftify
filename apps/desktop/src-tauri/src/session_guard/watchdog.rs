//! Notices when the main thread stops handling events, the state Windows
//! reports as "not responding", and logs it with its length. The log then
//! shows which step was running (see miniplayer::show).
use std::{
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    time::Duration,
};
use tauri::AppHandle;

use super::{GUARD, now_ms};

const CHECK_EVERY: Duration = Duration::from_secs(2);
/// Windows itself calls a window hung after 5 s without messages.
const HUNG_AFTER_MS: i64 = 8_000;
const ALIVE_EVERY_MS: i64 = 30_000;

pub fn start_watchdog(app: AppHandle) {
    let _ = std::thread::Builder::new().name("luftify-watchdog".into()).spawn(move || {
        let pending = Arc::new(AtomicBool::new(false));
        let mut posted_at = 0;
        let mut hung_since: Option<i64> = None;
        let mut alive_at = now_ms();
        loop {
            std::thread::sleep(CHECK_EVERY);
            let Some(guard) = GUARD.get() else { return };
            if guard.finished.load(Ordering::Acquire) {
                return;
            }
            let now = now_ms();
            if pending.load(Ordering::Acquire) {
                let waiting = now - posted_at;
                if waiting > HUNG_AFTER_MS && hung_since.is_none() {
                    hung_since = Some(posted_at);
                    tracing::warn!(waiting_ms = waiting, "main thread not responding");
                    guard.update(|marker| marker.hung_since_ms = Some(posted_at));
                    alive_at = now;
                }
                continue;
            }
            if let Some(since) = hung_since.take() {
                let length = now - since;
                tracing::warn!(hang_ms = length, "main thread responding again");
                guard.update(|marker| {
                    marker.hung_since_ms = None;
                    marker.longest_hang_ms = marker.longest_hang_ms.max(length);
                });
                alive_at = now;
            } else if now - alive_at >= ALIVE_EVERY_MS {
                guard.update(|_| {});
                alive_at = now;
            }
            pending.store(true, Ordering::Release);
            posted_at = now;
            let answered = Arc::clone(&pending);
            if app.run_on_main_thread(move || answered.store(false, Ordering::Release)).is_err() {
                return;
            }
        }
    });
}
