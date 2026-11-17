//! Keeps Spotify's audio key allowance across app restarts.
//!
//! Spotify counts keys per account and does not forget them when Luftify
//! restarts. A restart used to start with a full allowance on our side: it
//! asked freely again and Spotify refused (18 Nov 2026, two restarts in a
//! burst of skips). The allowance itself lives in
//! `vendor/librespot-playback/src/key_pacing`.
use std::{
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use librespot::playback::{KeyBudget, observe_key_budget, restore_key_budget};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

const FILE: &str = "key-budget.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    keys: f64,
    at_ms: u64,
}

/// Continues from the stored allowance and stores every change from now on.
pub(crate) fn attach(cache_dir: &Path) {
    let _ = std::fs::create_dir_all(cache_dir);
    let path = cache_dir.join(FILE);
    if let Some(budget) = read(&path) {
        info!(adapter = "librespot", phase = "key-budget", keys = budget.keys, "audio key allowance continued");
        restore_key_budget(budget);
    }
    observe_key_budget(move |budget| write(&path, budget));
}

fn read(path: &Path) -> Option<KeyBudget> {
    let stored: Stored = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    stored.keys.is_finite().then(|| KeyBudget {
        keys: stored.keys,
        at: UNIX_EPOCH + Duration::from_millis(stored.at_ms),
    })
}

fn write(path: &PathBuf, budget: KeyBudget) {
    let at_ms = budget.at.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let stored = Stored { keys: budget.keys, at_ms };
    let written = serde_json::to_string(&stored).map_err(|error| error.to_string())
        .and_then(|text| std::fs::write(path, text).map_err(|error| error.to_string()));
    if let Err(error) = written {
        warn!(adapter = "librespot", phase = "key-budget", %error, "audio key allowance could not be stored");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allowance_survives_a_round_trip_and_nonsense_is_ignored() {
        let dir = std::env::temp_dir().join(format!("luftify-key-budget-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE);
        let at = UNIX_EPOCH + Duration::from_millis(1_763_000_000_000);
        write(&path, KeyBudget { keys: 3.5, at });
        assert_eq!(read(&path), Some(KeyBudget { keys: 3.5, at }));
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read(&path), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
