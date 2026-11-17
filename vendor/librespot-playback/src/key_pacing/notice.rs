//! Tells the app while a song waits for a key and until when, so the
//! listener sees why it does not start yet.
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, OnceLock},
    time::{Instant, SystemTime},
};

type WaitObserver = Box<dyn Fn(Option<SystemTime>) + Send + Sync>;

#[derive(Default)]
struct Waits {
    /// Songs waiting for a key and when each expects one.
    ready_at: HashMap<u64, Instant>,
    next: u64,
}

static WAITS: LazyLock<Mutex<Waits>> = LazyLock::new(Mutex::default);
static OBSERVER: OnceLock<WaitObserver> = OnceLock::new();

fn with<T>(f: impl FnOnce(&mut Waits) -> T) -> T {
    f(&mut WAITS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

/// Called with the time the last waiting song expects its key, and with
/// `None` once no song waits any more. Set once per process.
pub fn observe_key_waits(observer: impl Fn(Option<SystemTime>) + Send + Sync + 'static) {
    let _ = OBSERVER.set(Box::new(observer));
}

/// One song's wait for a key; dropping it (key asked, or the load given up
/// by a skip) ends the wait.
pub(super) struct WaitNotice(u64);

impl WaitNotice {
    pub(super) fn begin(ready_at: Instant) -> Self {
        let id = with(|waits| {
            waits.next += 1;
            waits.ready_at.insert(waits.next, ready_at);
            waits.next
        });
        announce();
        Self(id)
    }
}

impl Drop for WaitNotice {
    fn drop(&mut self) {
        with(|waits| waits.ready_at.remove(&self.0));
        announce();
    }
}

/// Outside the lock: the observer may take its time.
fn announce() {
    let Some(observer) = OBSERVER.get() else {
        return;
    };
    let latest = with(|waits| waits.ready_at.values().max().copied());
    observer(latest.map(|ready_at| SystemTime::now() + ready_at.saturating_duration_since(Instant::now())));
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use super::*;

    #[test]
    fn a_wait_is_announced_until_it_ends() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        observe_key_waits(move |until| record.lock().unwrap().push(until.is_some()));
        let notice = WaitNotice::begin(Instant::now() + Duration::from_secs(5));
        drop(notice);
        assert_eq!(*seen.lock().unwrap(), vec![true, false]);
    }
}
