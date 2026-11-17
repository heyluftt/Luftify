use std::collections::HashSet;

use super::uri::{canonicalize_item_uri, same_item_uri};

/// How Libre should rebuild the remaining context queue.
///
/// Spirc never owns shuffle. The local upcoming list is the permutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShuffleCommit {
    /// Catalog order after the current track.
    Off,
    /// New mix of everything not yet played.
    Fresh,
    /// Keep the current mix; only append newly appeared unplayed tracks.
    Preserve,
}

impl ShuffleCommit {
    #[must_use]
    pub(crate) fn from_enabled(shuffle: bool) -> Self {
        if shuffle { Self::Fresh } else { Self::Off }
    }

    #[must_use]
    pub(crate) fn preserve_if(shuffle: bool) -> Self {
        if shuffle { Self::Preserve } else { Self::Off }
    }
}

/// Remaining context URIs for the visible queue.
#[must_use]
pub(crate) fn plan_upcoming(
    context_uris: &[String],
    current_uri: &str,
    history: &[String],
    existing_upcoming: &[String],
    commit: ShuffleCommit,
    seed: u64,
) -> Vec<String> {
    match commit {
        ShuffleCommit::Off => linear_remaining(context_uris, current_uri),
        ShuffleCommit::Fresh => {
            let mut remaining = unplayed(context_uris, current_uri, history);
            shuffle_uris(&mut remaining, seed);
            remaining
        }
        ShuffleCommit::Preserve => {
            preserve_remaining(context_uris, current_uri, history, existing_upcoming, seed)
        }
    }
}

#[must_use]
pub(crate) fn pick_random_context_start(uris: &[String], seed: u64) -> Option<&str> {
    if uris.is_empty() {
        return None;
    }
    Some(uris[(seed as usize) % uris.len()].as_str())
}

#[must_use]
pub(crate) fn should_pick_random_context_start(track_uri: Option<&str>, shuffle: bool) -> bool {
    shuffle
        && track_uri
            .and_then(|uri| canonicalize_item_uri(uri.trim()))
            .is_none()
}

pub(crate) fn shuffle_uris(uris: &mut [String], seed: u64) {
    let mut state = seed;
    for index in (1..uris.len()).rev() {
        // SplitMix64 mixes the low bits too: modulo on an LCG's low bits
        // otherwise forces predictable swaps, especially for short queues.
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut random = state;
        random = (random ^ (random >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        random = (random ^ (random >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        random ^= random >> 31;
        let swap = (random % (index as u64 + 1)) as usize;
        uris.swap(index, swap);
    }
}

#[must_use]
pub(crate) fn shuffle_seed(current_uri: &str, len: usize, generation: u64) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325;
    for byte in current_uri.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash ^ (len as u64).wrapping_shl(32) ^ generation.wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

fn linear_remaining(context_uris: &[String], current_uri: &str) -> Vec<String> {
    let current = current_uri.trim();
    match context_uris
        .iter()
        .position(|uri| same_item_uri(uri, current))
    {
        Some(index) => context_uris
            .iter()
            .skip(index.saturating_add(1))
            .cloned()
            .collect(),
        None => context_uris
            .iter()
            .filter(|uri| !same_item_uri(uri, current))
            .cloned()
            .collect(),
    }
}

fn unplayed(context_uris: &[String], current_uri: &str, history: &[String]) -> Vec<String> {
    let mut excluded = history
        .iter()
        .map(|uri| shuffle_identity(uri))
        .collect::<HashSet<_>>();
    excluded.insert(shuffle_identity(current_uri));
    let mut scheduled = HashSet::new();

    context_uris
        .iter()
        .filter(|uri| {
            let identity = shuffle_identity(uri);
            !excluded.contains(&identity) && scheduled.insert(identity)
        })
        .cloned()
        .collect()
}

fn shuffle_identity(uri: &str) -> String {
    canonicalize_item_uri(uri).unwrap_or_else(|| uri.trim().to_string())
}

fn preserve_remaining(
    context_uris: &[String],
    current_uri: &str,
    history: &[String],
    existing_upcoming: &[String],
    seed: u64,
) -> Vec<String> {
    let available = unplayed(context_uris, current_uri, history);
    let mut kept: Vec<String> = Vec::new();
    for uri in existing_upcoming {
        if available
            .iter()
            .any(|candidate| same_item_uri(candidate, uri))
            && !kept.iter().any(|have| same_item_uri(have, uri))
        {
            kept.push(uri.clone());
        }
    }
    let mut newcomers = available
        .into_iter()
        .filter(|uri| !kept.iter().any(|have| same_item_uri(have, uri)))
        .collect::<Vec<_>>();
    shuffle_uris(&mut newcomers, seed);
    kept.extend(newcomers);
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uris(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| (*id).to_string()).collect()
    }

    #[test]
    fn two_track_shuffle_can_produce_both_orders() {
        let original = uris(&["spotify:track:one", "spotify:track:two"]);
        let mut orders = HashSet::new();
        for seed in 0..64 {
            let mut shuffled = original.clone();
            shuffle_uris(&mut shuffled, seed);
            orders.insert(shuffled.clone());
            shuffled.sort();
            assert_eq!(shuffled, original);
        }
        assert_eq!(orders.len(), 2);
    }

    #[test]
    fn linear_plan_keeps_the_rest_of_the_catalog() {
        let context = uris(&[
            "spotify:track:one",
            "spotify:track:two",
            "spotify:track:three",
        ]);
        assert_eq!(
            plan_upcoming(
                &context,
                "spotify:track:one",
                &[],
                &[],
                ShuffleCommit::Off,
                1
            ),
            uris(&["spotify:track:two", "spotify:track:three"])
        );
    }

    #[test]
    fn fresh_shuffle_drops_current_and_history() {
        let context = uris(&[
            "spotify:track:now",
            "spotify:track:one",
            "spotify:track:two",
            "spotify:track:played",
        ]);
        let history = uris(&["spotify:track:played"]);
        let upcoming = plan_upcoming(
            &context,
            "spotify:track:now",
            &history,
            &[],
            ShuffleCommit::Fresh,
            7,
        );
        assert_eq!(upcoming.len(), 2);
        assert!(upcoming.iter().all(|uri| uri != "spotify:track:now"));
        assert!(upcoming.iter().all(|uri| uri != "spotify:track:played"));
    }

    #[test]
    fn fresh_shuffle_schedules_duplicate_playlist_tracks_only_once() {
        let context = uris(&[
            "spotify:track:now",
            "spotify:track:one",
            "spotify:track:two",
            "spotify:track:one",
            "spotify:track:two",
        ]);
        let mut upcoming = plan_upcoming(
            &context,
            "spotify:track:now",
            &[],
            &[],
            ShuffleCommit::Fresh,
            7,
        );
        upcoming.sort();

        assert_eq!(upcoming, uris(&["spotify:track:one", "spotify:track:two"]));
    }

    #[test]
    fn preserve_keeps_the_live_mix_and_appends_new_tracks() {
        let context = uris(&[
            "spotify:track:now",
            "spotify:track:one",
            "spotify:track:two",
            "spotify:track:new",
        ]);
        let existing = uris(&["spotify:track:two", "spotify:track:one"]);
        let upcoming = plan_upcoming(
            &context,
            "spotify:track:now",
            &[],
            &existing,
            ShuffleCommit::Preserve,
            3,
        );
        assert_eq!(upcoming[0], "spotify:track:two");
        assert_eq!(upcoming[1], "spotify:track:one");
        assert_eq!(upcoming.len(), 3);
        assert_eq!(upcoming[2], "spotify:track:new");
    }

    #[test]
    fn preserve_does_not_bring_history_back() {
        let context = uris(&[
            "spotify:track:now",
            "spotify:track:played",
            "spotify:track:one",
            "spotify:track:new",
        ]);
        let upcoming = plan_upcoming(
            &context,
            "spotify:track:now",
            &uris(&["spotify:track:played"]),
            &uris(&["spotify:track:one", "spotify:track:played"]),
            ShuffleCommit::Preserve,
            9,
        );
        assert_eq!(upcoming, uris(&["spotify:track:one", "spotify:track:new"]));
    }

    #[test]
    fn playlist_play_without_a_track_picks_a_random_start_only_when_shuffling() {
        assert!(!should_pick_random_context_start(None, false));
        assert!(should_pick_random_context_start(None, true));
        assert!(!should_pick_random_context_start(
            Some("spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"),
            true
        ));
        assert_eq!(
            pick_random_context_start(&uris(&["spotify:track:one", "spotify:track:two"]), 0),
            Some("spotify:track:one")
        );
    }
}
