//! Luftify: audio keys asked sparingly (see LUFTIFY.md).
//!
//! A key once received is kept for the session (`cache.rs`). New requests
//! follow Spotify's allowance (`allowance.rs`), so none is refused: a song
//! without a key waits for the next one, at most one refill, and tells the
//! app until when (`notice.rs`). The app keeps the allowance across restarts
//! (`observe_key_budget`, `restore_key_budget`); Spotify does not forget it
//! either.
mod allowance;
mod cache;
mod notice;

use std::{
    sync::{LazyLock, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

use allowance::{Allowance, CAPACITY, PRELOAD_RESERVE, REFILL};
use notice::WaitNotice;

pub(crate) use cache::{known, remember};
pub use notice::observe_key_waits;

/// The allowance at a moment, for the app to keep across restarts.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KeyBudget {
    pub keys: f64,
    pub at: SystemTime,
}

/// What a key is asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Purpose {
    /// A song the listener started: it waits for a key if none is left.
    Play,
    /// The next song, fetched ahead: it leaves the last keys alone.
    Preload,
}

type BudgetObserver = Box<dyn Fn(KeyBudget) + Send + Sync>;

static ALLOWANCE: LazyLock<Mutex<Allowance>> =
    LazyLock::new(|| Mutex::new(Allowance::new(CAPACITY, Instant::now())));
static BUDGET_OBSERVER: OnceLock<BudgetObserver> = OnceLock::new();

fn with<T>(f: impl FnOnce(&mut Allowance) -> T) -> T {
    f(&mut ALLOWANCE.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

/// Called whenever the allowance changes. Set once per process.
pub fn observe_key_budget(observer: impl Fn(KeyBudget) + Send + Sync + 'static) {
    let _ = BUDGET_OBSERVER.set(Box::new(observer));
}

/// Continues from an allowance kept by an earlier run of the app.
pub fn restore_key_budget(budget: KeyBudget) {
    let since = SystemTime::now().duration_since(budget.at).unwrap_or_default();
    let keys = budget.keys + since.as_secs_f64() / REFILL.as_secs_f64();
    with(|allowance| *allowance = Allowance::new(keys, Instant::now()));
}

/// Outside the lock: the observer may write a file.
fn publish() {
    if let Some(observer) = BUDGET_OBSERVER.get() {
        let keys = with(|allowance| allowance.keys(Instant::now()));
        observer(KeyBudget { keys, at: SystemTime::now() });
    }
}

/// Takes one key of the allowance and returns how long that took. A song to
/// play waits for the next key; a preload gets `None` instead.
pub(crate) async fn take_key(purpose: Purpose) -> Option<Duration> {
    let started = Instant::now();
    let reserve = if purpose == Purpose::Preload { PRELOAD_RESERVE } else { 0.0 };
    let mut notice = None;
    loop {
        match with(|allowance| allowance.take(Instant::now(), reserve)) {
            Ok(()) => {
                drop(notice);
                publish();
                return Some(started.elapsed());
            }
            Err(_) if purpose == Purpose::Preload => return None,
            Err(wait) => {
                notice.get_or_insert_with(|| WaitNotice::begin(Instant::now() + wait));
                tokio::time::sleep(wait.max(Duration::from_millis(50))).await;
            }
        }
    }
}

/// Spotify refused a key because the allowance is used up.
pub(crate) fn note_limit() {
    with(|allowance| allowance.empty(Instant::now()));
    publish();
}
