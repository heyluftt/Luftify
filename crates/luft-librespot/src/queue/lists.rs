use std::collections::{HashMap, HashSet};

use luft_core::{MediaItem, QueueItem, QueueReorderRequest};

use super::shuffle::{ShuffleCommit, plan_upcoming, shuffle_seed};
use super::uri::same_item_uri;
use crate::metadata::{is_placeholder_title, loading_item};
use crate::playback::apply_queue_reorder;

pub(crate) const EXPLICIT_QUEUE_PREFIX: &str = "q";
pub(crate) const CONTEXT_QUEUE_PREFIX: &str = "c";

#[derive(Debug, Clone, Default)]
pub(crate) struct QueueLists {
    pub explicit: Vec<QueueItem>,
    pub upcoming: Vec<QueueItem>,
    pub context_uris: Vec<String>,
    pub history: Vec<String>,
    pub known: HashMap<String, MediaItem>,
    pub failed: HashSet<String>,
    pub hydrate_epoch: u64,
    pub revision: u64,
    pub interrupted: bool,
    /// Placeholder rows the listener scrolled to, resolved after the head.
    pub focus_wanted: Vec<String>,
    pub focus_running: bool,
    shuffle_generation: u64,
    /// Now-playing URI the lists already exclude. Later occurrences of the
    /// same title (queued twice, playlist duplicates) are real entries.
    synced_current: Option<String>,
}

impl QueueLists {
    pub(crate) fn visible(&self) -> Vec<QueueItem> {
        self.explicit
            .iter()
            .cloned()
            .chain(self.upcoming.iter().cloned())
            .collect()
    }

    pub(crate) fn bump(&mut self) {
        self.revision = self.revision.saturating_add(1);
    }

    pub(crate) fn push_explicit(&mut self, item: luft_core::MediaItem) {
        self.bump();
        let uid = format!("{EXPLICIT_QUEUE_PREFIX}{}", self.revision);
        self.explicit.push(QueueItem {
            item,
            uid: Some(uid),
        });
    }

    pub(crate) fn replace_upcoming(&mut self, uris: Vec<String>, current_uri: &str, shuffle: bool) {
        self.replace_upcoming_with(uris, current_uri, ShuffleCommit::from_enabled(shuffle));
    }

    pub(crate) fn replace_upcoming_preserving(
        &mut self,
        uris: Vec<String>,
        current_uri: &str,
        shuffle: bool,
    ) {
        self.replace_upcoming_with(uris, current_uri, ShuffleCommit::preserve_if(shuffle));
    }

    fn replace_upcoming_with(
        &mut self,
        uris: Vec<String>,
        current_uri: &str,
        commit: ShuffleCommit,
    ) {
        if !context_is_same_or_expanded(&self.context_uris, &uris) {
            self.history.clear();
        }
        let existing: Vec<String> = self
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.clone())
            .collect();
        self.context_uris = uris;
        let shuffle = commit != ShuffleCommit::Off;
        let current = effective_current_uri(&self.context_uris, current_uri, shuffle).to_string();
        let seed = self.shuffle_seed_for(&current, commit);
        let remaining = plan_upcoming(
            &self.context_uris,
            &current,
            &self.history,
            &existing,
            commit,
            seed,
        );
        self.upcoming = upcoming_items(remaining, &self.known);
        self.synced_current = Some(current_uri.trim())
            .filter(|uri| !uri.is_empty())
            .map(str::to_string);
        self.bump();
    }

    pub(crate) fn take_mix_seed(&mut self, current_uri: &str, commit: ShuffleCommit) -> u64 {
        self.shuffle_seed_for(current_uri, commit)
    }

    pub(crate) fn apply_planned_upcoming(
        &mut self,
        context_uris: Vec<String>,
        current_uri: &str,
        remaining: Vec<String>,
    ) {
        if !context_is_same_or_expanded(&self.context_uris, &context_uris) {
            self.history.clear();
        }
        self.context_uris = context_uris;
        self.upcoming = upcoming_items(remaining, &self.known);
        self.synced_current = Some(current_uri.trim())
            .filter(|uri| !uri.is_empty())
            .map(str::to_string);
        self.bump();
    }

    pub(crate) fn clear_context(&mut self) {
        if self.upcoming.is_empty() && self.context_uris.is_empty() && !self.interrupted {
            return;
        }
        self.upcoming.clear();
        self.context_uris.clear();
        self.history.clear();
        self.interrupted = false;
        self.bump();
    }

    pub(crate) fn pop_explicit(&mut self) -> Option<QueueItem> {
        if self.explicit.is_empty() {
            return None;
        }
        let entry = self.explicit.remove(0);
        self.interrupted = true;
        self.bump();
        Some(entry)
    }

    /// The transition already consumed this title's own queue entry. A title
    /// played from the explicit queue also replaces its context occurrence.
    pub(crate) fn mark_current_consumed(&mut self, uri: &str, explicit: bool) {
        if explicit
            && let Some(index) = self
                .upcoming
                .iter()
                .position(|entry| same_item_uri(&entry.item.uri, uri))
        {
            self.upcoming.remove(index);
            self.bump();
        }
        self.synced_current = Some(uri.to_string());
    }

    fn is_synced_current(&self, uri: &str) -> bool {
        self.synced_current
            .as_deref()
            .is_some_and(|synced| same_item_uri(synced, uri))
    }

    /// Drop one leftover entry of an externally started title. Idempotent per
    /// title: publish, player confirmation and pause/resume enrichment all call
    /// this for the same track and must not eat its later occurrences.
    pub(crate) fn sync_current(&mut self, uri: &str) {
        if self.is_synced_current(uri) {
            return;
        }
        self.synced_current = Some(uri.to_string());
        let mut changed = false;
        if self
            .explicit
            .first()
            .is_some_and(|entry| same_item_uri(&entry.item.uri, uri))
        {
            self.explicit.remove(0);
            changed = true;
        }
        if let Some(index) = self
            .upcoming
            .iter()
            .position(|entry| same_item_uri(&entry.item.uri, uri))
        {
            self.upcoming.remove(index);
            changed = true;
        }
        if changed {
            self.bump();
        }
    }

    pub(crate) fn remove_uri(&mut self, uri: &str) -> bool {
        if let Some(index) = self.explicit.iter().position(|entry| entry.item.uri == uri) {
            self.explicit.remove(index);
            self.bump();
            return true;
        }
        if let Some(index) = self.upcoming.iter().position(|entry| entry.item.uri == uri) {
            self.upcoming.remove(index);
            self.bump();
            return true;
        }
        false
    }

    /// Removes exactly the clicked row. The URI alone is ambiguous when the
    /// same title is queued manually and also comes up in the context.
    pub(crate) fn remove_entry(&mut self, uid: &str, uri: &str) -> bool {
        let matches =
            |entry: &QueueItem| entry.uid.as_deref() == Some(uid) && entry.item.uri == uri;
        if let Some(index) = self.explicit.iter().position(matches) {
            self.explicit.remove(index);
            self.bump();
            return true;
        }
        if let Some(index) = self.upcoming.iter().position(matches) {
            self.upcoming.remove(index);
            self.bump();
            return true;
        }
        false
    }

    pub(crate) fn clear_explicit(&mut self) -> bool {
        if self.explicit.is_empty() {
            return false;
        }
        self.explicit.clear();
        self.bump();
        true
    }

    pub(crate) fn apply_visible_reorder(
        &mut self,
        request: &QueueReorderRequest,
    ) -> Result<(), String> {
        let mut visible = self.visible();
        apply_queue_reorder(&mut visible, request)?;
        let mut explicit = Vec::new();
        let mut upcoming = Vec::new();
        for entry in visible {
            if entry
                .uid
                .as_deref()
                .is_some_and(|uid| uid.starts_with(CONTEXT_QUEUE_PREFIX))
            {
                upcoming.push(entry);
            } else {
                explicit.push(entry);
            }
        }
        self.explicit = explicit;
        self.upcoming = upcoming;
        self.bump();
        Ok(())
    }

    pub(crate) fn push_history(&mut self, uri: &str) {
        let uri = uri.trim();
        if uri.is_empty() || self.history.last().is_some_and(|last| last == uri) {
            return;
        }
        self.history.push(uri.to_string());
        if self.history.len() > 200 {
            self.history.remove(0);
        }
    }

    pub(crate) fn take_previous(&mut self, current: Option<&MediaItem>) -> Option<QueueItem> {
        let previous_uri = self.history.pop()?;
        Some(self.restore_previous(current, &previous_uri))
    }

    pub(crate) fn take_previous_or_wrap(
        &mut self,
        current: Option<&MediaItem>,
        repeat_all: bool,
        shuffle: bool,
    ) -> Option<QueueItem> {
        if let Some(entry) = self.take_previous(current) {
            return Some(entry);
        }
        // Shuffle only has a reliable previous after Next/EndOfTrack wrote history.
        if shuffle {
            return None;
        }
        let current_uri = current.map(|item| item.uri.as_str());
        if let Some(previous_uri) = self.peek_context_previous_uri(current_uri) {
            return Some(self.restore_previous(current, &previous_uri));
        }
        if !repeat_all || self.context_uris.is_empty() {
            return None;
        }
        let last = self.context_uris.last()?.clone();
        if current_uri.is_some_and(|uri| same_item_uri(uri, &last)) {
            return None;
        }
        self.replace_upcoming(self.context_uris.clone(), &last, false);
        Some(self.restore_previous(current, &last))
    }

    fn restore_previous(&mut self, current: Option<&MediaItem>, previous_uri: &str) -> QueueItem {
        if let Some(current) = current.filter(|item| !item.uri.is_empty()) {
            self.remember_item(current);
            let already_queued = self
                .upcoming
                .first()
                .is_some_and(|entry| same_item_uri(&entry.item.uri, &current.uri));
            if !already_queued {
                self.upcoming.insert(
                    0,
                    QueueItem {
                        item: current.clone(),
                        uid: Some(format!("{CONTEXT_QUEUE_PREFIX}-back-{}", self.revision)),
                    },
                );
            }
        }
        let item = self
            .known
            .get(previous_uri)
            .cloned()
            .or_else(|| {
                self.known
                    .values()
                    .find(|item| same_item_uri(&item.uri, previous_uri))
                    .cloned()
            })
            .unwrap_or_else(|| loading_item(previous_uri));
        self.bump();
        QueueItem { item, uid: None }
    }

    pub(crate) fn take_next(&mut self) -> Option<QueueItem> {
        if self.upcoming.is_empty() {
            return None;
        }
        let entry = self.upcoming.remove(0);
        self.bump();
        Some(entry)
    }

    pub(crate) fn drop_current(&mut self, current_uri: Option<&str>) -> usize {
        let Some(current) = current_uri.map(str::trim).filter(|uri| !uri.is_empty()) else {
            return 0;
        };
        if self.is_synced_current(current) {
            return 0;
        }
        if let Some(index) = self
            .upcoming
            .iter()
            .position(|entry| same_item_uri(&entry.item.uri, current))
        {
            self.upcoming.remove(index);
            self.bump();
            return 1;
        }
        0
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn take_next_skipping(&mut self, current_uri: Option<&str>) -> Option<QueueItem> {
        self.drop_current(current_uri);
        if let Some(entry) = self.take_next() {
            return Some(entry);
        }
        let uri = self.peek_context_next_uri(current_uri)?;
        let item = self
            .known
            .get(&uri)
            .cloned()
            .unwrap_or_else(|| loading_item(&uri));
        Some(QueueItem { item, uid: None })
    }

    pub(crate) fn take_next_or_wrap(
        &mut self,
        current_uri: Option<&str>,
        repeat_all: bool,
        shuffle: bool,
    ) -> Option<QueueItem> {
        self.drop_current(current_uri);
        if let Some(entry) = self.take_next() {
            return Some(entry);
        }
        if shuffle {
            if !repeat_all || self.context_uris.is_empty() {
                return None;
            }
            return self.wrap_shuffled(current_uri);
        }
        if let Some(uri) = self.peek_context_next_uri(current_uri) {
            let item = self
                .known
                .get(&uri)
                .cloned()
                .unwrap_or_else(|| loading_item(&uri));
            return Some(QueueItem { item, uid: None });
        }
        if !repeat_all || self.context_uris.is_empty() {
            return None;
        }
        let start = self.context_uris.first()?.clone();
        let item = self
            .known
            .get(&start)
            .cloned()
            .unwrap_or_else(|| loading_item(&start));
        self.replace_upcoming(self.context_uris.clone(), &start, false);
        Some(QueueItem { item, uid: None })
    }

    fn wrap_shuffled(&mut self, current_uri: Option<&str>) -> Option<QueueItem> {
        self.history.clear();
        let current = current_uri.map(str::trim).unwrap_or_default().to_string();
        let seed = self.shuffle_seed_for(&current, ShuffleCommit::Fresh);
        let mut remaining = plan_upcoming(
            &self.context_uris,
            &current,
            &[],
            &[],
            ShuffleCommit::Fresh,
            seed,
        );
        if remaining.is_empty() {
            let only = self.context_uris.first()?.clone();
            let item = self
                .known
                .get(&only)
                .cloned()
                .unwrap_or_else(|| loading_item(&only));
            self.upcoming.clear();
            self.bump();
            return Some(QueueItem { item, uid: None });
        }
        let next = remaining.remove(0);
        self.upcoming = upcoming_items(remaining, &self.known);
        self.bump();
        let item = self
            .known
            .get(&next)
            .cloned()
            .unwrap_or_else(|| loading_item(&next));
        Some(QueueItem { item, uid: None })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn peek_next_uri(&self, current_uri: Option<&str>) -> Option<String> {
        self.upcoming
            .iter()
            .find(|entry| {
                current_uri.is_none_or(|current| !same_item_uri(&entry.item.uri, current))
            })
            .map(|entry| entry.item.uri.clone())
            .or_else(|| self.peek_context_next_uri(current_uri))
    }

    pub(crate) fn peek_context_previous_uri(&self, current_uri: Option<&str>) -> Option<String> {
        let current = current_uri.map(str::trim).filter(|uri| !uri.is_empty())?;
        let index = self
            .context_uris
            .iter()
            .position(|uri| same_item_uri(uri, current))?;
        self.context_uris
            .iter()
            .take(index)
            .rev()
            .find(|uri| !same_item_uri(uri, current))
            .cloned()
    }

    fn peek_context_next_uri(&self, current_uri: Option<&str>) -> Option<String> {
        let current = current_uri.map(str::trim).filter(|uri| !uri.is_empty())?;
        let index = self
            .context_uris
            .iter()
            .position(|uri| same_item_uri(uri, current))?;
        self.context_uris
            .iter()
            .skip(index.saturating_add(1))
            .find(|uri| !same_item_uri(uri, current))
            .cloned()
    }

    pub(crate) fn visible_excluding(&self, current_uri: Option<&str>) -> Vec<QueueItem> {
        self.explicit
            .iter()
            .cloned()
            .chain(
                self.upcoming
                    .iter()
                    .filter(|entry| {
                        current_uri.is_none_or(|current| !same_item_uri(&entry.item.uri, current))
                    })
                    .cloned(),
            )
            .collect()
    }

    /// Leading `limit` rows of [`Self::visible_excluding`] plus the full
    /// length, without cloning the tail of long contexts.
    pub(crate) fn visible_window(
        &self,
        current_uri: Option<&str>,
        limit: usize,
    ) -> (Vec<QueueItem>, usize) {
        let rows = self
            .explicit
            .iter()
            .chain(self.upcoming.iter().filter(|entry| {
                current_uri.is_none_or(|current| !same_item_uri(&entry.item.uri, current))
            }));
        let mut items = Vec::with_capacity(limit.min(self.explicit.len() + self.upcoming.len()));
        let mut total = 0usize;
        for entry in rows {
            if total < limit {
                items.push(entry.clone());
            }
            total += 1;
        }
        (items, total)
    }

    /// The requested URIs that are still unresolved queue rows.
    pub(crate) fn placeholders_among(&self, uris: &[String], limit: usize) -> Vec<String> {
        let mut wanted = Vec::new();
        for uri in uris {
            if wanted.len() >= limit {
                break;
            }
            if wanted.contains(uri) || self.failed.contains(uri) {
                continue;
            }
            let unresolved = self
                .explicit
                .iter()
                .chain(self.upcoming.iter())
                .any(|entry| {
                    entry.item.uri == *uri
                        && is_placeholder_title(&entry.item.title, &entry.item.uri)
                });
            if unresolved {
                wanted.push(uri.clone());
            }
        }
        wanted
    }

    pub(crate) fn reshuffle_upcoming(&mut self, current_uri: &str, shuffle: bool) {
        if self.context_uris.is_empty() {
            return;
        }
        self.remember_visible();
        let existing: Vec<String> = self
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.clone())
            .collect();
        let commit = ShuffleCommit::from_enabled(shuffle);
        let seed = self.shuffle_seed_for(current_uri, commit);
        // Linear order resumes where the context was left: a manually queued
        // title outside the context must not restart the playlist at track 1.
        let anchor = if shuffle {
            current_uri.to_string()
        } else {
            self.context_anchor(current_uri)
        };
        let remaining = plan_upcoming(
            &self.context_uris,
            &anchor,
            &self.history,
            &existing,
            commit,
            seed,
        );
        self.upcoming = upcoming_items(remaining, &self.known);
        self.bump();
    }

    /// The current title if it belongs to the context, otherwise the most
    /// recently played context title.
    fn context_anchor(&self, current_uri: &str) -> String {
        let in_context = |uri: &str| {
            self.context_uris
                .iter()
                .any(|candidate| same_item_uri(candidate, uri))
        };
        if current_uri.trim().is_empty() || in_context(current_uri) {
            return current_uri.to_string();
        }
        self.history
            .iter()
            .rev()
            .find(|uri| in_context(uri))
            .cloned()
            .unwrap_or_else(|| current_uri.to_string())
    }

    fn shuffle_seed_for(&mut self, current_uri: &str, commit: ShuffleCommit) -> u64 {
        if commit != ShuffleCommit::Fresh {
            return shuffle_seed(
                current_uri,
                self.context_uris.len(),
                self.shuffle_generation,
            );
        }
        self.shuffle_generation = self.shuffle_generation.saturating_add(1);
        shuffle_seed(
            current_uri,
            self.context_uris.len(),
            self.shuffle_generation,
        )
    }

    pub(crate) fn begin_hydrate(&mut self) -> u64 {
        self.hydrate_epoch = self.hydrate_epoch.saturating_add(1);
        self.failed.clear();
        self.hydrate_epoch
    }

    pub(crate) fn is_hydrate_current(&self, epoch: u64) -> bool {
        self.hydrate_epoch == epoch
    }

    pub(crate) fn next_placeholders(&self, window_size: usize, limit: usize) -> Vec<String> {
        self.explicit
            .iter()
            .chain(self.upcoming.iter())
            .take(window_size)
            .filter(|entry| {
                is_placeholder_title(&entry.item.title, &entry.item.uri)
                    && !self.failed.contains(&entry.item.uri)
            })
            .take(limit)
            .map(|entry| entry.item.uri.clone())
            .collect()
    }

    pub(crate) fn mark_failed(&mut self, uri: String) {
        self.failed.insert(uri);
    }

    pub(crate) fn remember_item(&mut self, item: &MediaItem) {
        if !is_placeholder_title(&item.title, &item.uri) {
            self.known.insert(item.uri.clone(), item.clone());
        }
    }

    fn remember_visible(&mut self) {
        let items: Vec<MediaItem> = self
            .explicit
            .iter()
            .map(|entry| entry.item.clone())
            .collect();
        for item in items {
            self.remember_item(&item);
        }
    }

    pub(crate) fn apply_metadata(&mut self, item: MediaItem) -> bool {
        self.failed.remove(&item.uri);
        self.remember_item(&item);
        let mut changed = false;
        for entry in self.explicit.iter_mut().chain(self.upcoming.iter_mut()) {
            if entry.item.uri == item.uri {
                entry.item = crate::metadata::merge_media_items(Some(&entry.item), item.clone());
                changed = true;
            }
        }
        changed
    }
}

#[cfg(test)]
#[must_use]
pub(crate) fn upcoming_uris(
    context_uris: &[String],
    current_uri: &str,
    shuffle: bool,
) -> Vec<String> {
    plan_upcoming(
        context_uris,
        current_uri,
        &[],
        &[],
        ShuffleCommit::from_enabled(shuffle),
        shuffle_seed(current_uri, context_uris.len(), 1),
    )
}

#[cfg(test)]
#[must_use]
pub(crate) fn upcoming_from_context(
    context_uris: &[String],
    current_uri: &str,
    shuffle: bool,
    known: &HashMap<String, MediaItem>,
) -> Vec<QueueItem> {
    upcoming_items(upcoming_uris(context_uris, current_uri, shuffle), known)
}

fn upcoming_items(uris: Vec<String>, known: &HashMap<String, MediaItem>) -> Vec<QueueItem> {
    uris.into_iter()
        .enumerate()
        .map(|(index, uri)| QueueItem {
            item: known
                .get(&uri)
                .cloned()
                .unwrap_or_else(|| loading_item(&uri)),
            uid: Some(format!("{CONTEXT_QUEUE_PREFIX}{index}")),
        })
        .collect()
}

pub(crate) fn same_context_uris(left: &[String], right: &[String]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(first, second)| same_item_uri(first, second))
}

fn context_is_same_or_expanded(existing: &[String], incoming: &[String]) -> bool {
    existing.is_empty()
        || existing
            .iter()
            .all(|have| incoming.iter().any(|uri| same_item_uri(have, uri)))
}

fn effective_current_uri<'a>(uris: &'a [String], current_uri: &'a str, shuffle: bool) -> &'a str {
    let current = current_uri.trim();
    if !current.is_empty() {
        return current;
    }
    if shuffle {
        return "";
    }
    uris.first().map(String::as_str).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use luft_core::{
        MediaCreator, MediaItem, MediaItemType, MediaSource, QueueItemReference, QueuePlacement,
    };

    fn track(uri: &str, title: &str) -> MediaItem {
        MediaItem {
            uri: uri.to_string(),
            source: MediaSource::Spotify,
            item_type: MediaItemType::Track,
            title: title.to_string(),
            creators: vec![MediaCreator {
                name: "Kavinsky".into(),
                uri: None,
            }],
            album_name: Some("OutRun".into()),
            album_uri: None,
            duration_ms: Some(180_000),
            play_count: None,
            cover_uri: None,
            canvas_url: None,
            added_at: None,
            playlist_entry_id: None,
            added_by: None,
            explicit: false,
            playable: true,
        }
    }

    #[test]
    fn previous_uses_the_playlist_context_when_history_is_empty() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:three".into(),
            ],
            "spotify:track:two",
            false,
        );
        lists.apply_metadata(track("spotify:track:one", "One"));
        lists.apply_metadata(track("spotify:track:two", "Two"));
        let previous = lists
            .take_previous_or_wrap(Some(&track("spotify:track:two", "Two")), false, false)
            .expect("previous");
        assert_eq!(previous.item.uri, "spotify:track:one");
        assert_eq!(previous.item.title, "One");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:two");
    }

    #[test]
    fn previous_wraps_to_the_last_context_track_when_repeat_all_is_on() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:three".into(),
            ],
            "spotify:track:one",
            false,
        );
        lists.apply_metadata(track("spotify:track:three", "Three"));
        let previous = lists
            .take_previous_or_wrap(Some(&track("spotify:track:one", "One")), true, false)
            .expect("wrap");
        assert_eq!(previous.item.uri, "spotify:track:three");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:one");
    }

    #[test]
    fn shuffled_previous_does_not_invent_a_context_neighbor() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:three".into(),
            ],
            "spotify:track:two",
            true,
        );
        assert!(
            lists
                .take_previous_or_wrap(Some(&track("spotify:track:two", "Two")), false, true)
                .is_none()
        );
    }

    #[test]
    fn reseeding_the_same_playlist_keeps_skip_history() {
        let uris = vec![
            "spotify:track:one".to_string(),
            "spotify:track:two".to_string(),
            "spotify:track:three".to_string(),
        ];
        let mut lists = QueueLists::default();
        lists.replace_upcoming(uris.clone(), "spotify:track:one", false);
        lists.push_history("spotify:track:one");
        lists.replace_upcoming(uris, "spotify:track:two", false);
        let previous = lists
            .take_previous_or_wrap(Some(&track("spotify:track:two", "Two")), false, false)
            .expect("history");
        assert_eq!(previous.item.uri, "spotify:track:one");
    }

    #[test]
    fn previous_restores_history_and_puts_the_current_track_back() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:next".into(),
                "spotify:track:later".into(),
            ],
            "spotify:track:now",
            false,
        );
        lists.apply_metadata(track("spotify:track:now", "Now"));
        lists.apply_metadata(track("spotify:track:next", "Next"));
        lists.push_history("spotify:track:now");
        let previous = lists
            .take_previous(Some(&track("spotify:track:next", "Next")))
            .expect("previous");
        assert_eq!(previous.item.uri, "spotify:track:now");
        assert_eq!(previous.item.title, "Now");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:next");
    }

    #[test]
    fn next_skips_the_currently_playing_track() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:next".into(),
                "spotify:track:later".into(),
            ],
            "",
            false,
        );
        lists.upcoming.insert(
            0,
            QueueItem {
                item: track("spotify:track:now", "Now"),
                uid: Some("c-now".into()),
            },
        );
        let next = lists
            .take_next_skipping(Some("spotify:track:now"))
            .expect("next");
        assert_eq!(next.item.uri, "spotify:track:next");
        assert!(
            lists
                .upcoming
                .iter()
                .all(|entry| entry.item.uri != "spotify:track:now")
        );
        assert_eq!(
            lists
                .visible_excluding(Some("spotify:track:now"))
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            ["spotify:track:later"]
        );
    }

    #[test]
    fn next_wraps_to_the_first_context_track_when_repeating() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec!["spotify:track:now".into(), "spotify:track:next".into()],
            "spotify:track:next",
            false,
        );
        lists.apply_metadata(track("spotify:track:now", "Now"));
        let wrapped = lists
            .take_next_or_wrap(Some("spotify:track:next"), true, false)
            .expect("wrap");
        assert_eq!(wrapped.item.uri, "spotify:track:now");
        assert_eq!(wrapped.item.title, "Now");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:next");
    }

    #[test]
    fn take_next_removes_the_first_upcoming_item() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:next".into(),
                "spotify:track:later".into(),
            ],
            "spotify:track:now",
            false,
        );
        let next = lists.take_next().expect("next");
        assert_eq!(next.item.uri, "spotify:track:next");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:later");
    }

    #[test]
    fn peek_next_falls_back_to_the_remaining_context() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:0000000000000000000001".into(),
                "spotify:track:0000000000000000000002".into(),
                "spotify:track:0000000000000000000003".into(),
            ],
            "spotify:track:0000000000000000000001",
            false,
        );
        assert_eq!(
            lists
                .peek_next_uri(Some("spotify:track:0000000000000000000001"))
                .as_deref(),
            Some("spotify:track:0000000000000000000002")
        );
        lists.upcoming.clear();
        assert_eq!(
            lists
                .peek_next_uri(Some("spotify:track:0000000000000000000001"))
                .as_deref(),
            Some("spotify:track:0000000000000000000002")
        );
        assert_eq!(
            lists
                .peek_next_uri(Some(
                    "spotify:track:0000000000000000000001?context=playlist",
                ))
                .as_deref(),
            Some("spotify:track:0000000000000000000002")
        );
    }

    #[test]
    fn visible_queue_puts_explicit_items_before_context() {
        let mut lists = QueueLists::default();
        lists.push_explicit(track("spotify:track:queued", "Queued"));
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:next".into(),
                "spotify:track:later".into(),
            ],
            "spotify:track:now",
            false,
        );
        let titles: Vec<_> = lists
            .visible()
            .into_iter()
            .map(|entry| entry.item.uri)
            .collect();
        assert_eq!(
            titles,
            [
                "spotify:track:queued",
                "spotify:track:next",
                "spotify:track:later"
            ]
        );
    }

    #[test]
    fn sync_only_removes_the_now_playing_track() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:a".into(),
                "spotify:track:b".into(),
                "spotify:track:c".into(),
            ],
            "spotify:track:a",
            false,
        );
        lists.sync_current("spotify:track:c");
        assert_eq!(
            lists
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            ["spotify:track:b"]
        );
    }

    #[test]
    fn shuffle_off_during_a_queued_title_resumes_after_the_last_context_track() {
        let context: Vec<String> = ["a", "b", "c", "d", "e"]
            .iter()
            .map(|id| format!("spotify:track:{id}"))
            .collect();
        let mut lists = QueueLists::default();
        lists.replace_upcoming(context, "spotify:track:c", true);
        lists.push_history("spotify:track:c");
        // A manually queued title outside the playlist is playing now.
        lists.reshuffle_upcoming("spotify:track:queued", false);
        assert_eq!(
            lists
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            ["spotify:track:d", "spotify:track:e"]
        );
    }

    #[test]
    fn queue_window_labels_known_titles_and_reports_the_full_length() {
        let mut lists = QueueLists::default();
        let uris: Vec<String> = (0..80)
            .map(|index| format!("spotify:track:t{index}"))
            .collect();
        lists.remember_item(&track("spotify:track:t60", "Far away"));
        lists.replace_upcoming(uris.clone(), "spotify:track:t0", false);

        let (items, total) = lists.visible_window(Some("spotify:track:t0"), 70);
        assert_eq!(total, 79);
        assert_eq!(items.len(), 70);
        assert_eq!(items[59].item.title, "Far away");
        assert_eq!(
            lists.placeholders_among(&uris[58..62], 10),
            [
                "spotify:track:t58",
                "spotify:track:t59",
                "spotify:track:t61"
            ]
        );
    }

    #[test]
    fn remove_entry_targets_the_clicked_row_not_the_first_uri_match() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec!["spotify:track:now".into(), "spotify:track:x".into()],
            "spotify:track:now",
            false,
        );
        lists.push_explicit(track("spotify:track:x", "X"));
        let context_uid = lists.upcoming[0].uid.clone().expect("context uid");
        assert!(lists.remove_entry(&context_uid, "spotify:track:x"));
        assert_eq!(lists.explicit.len(), 1, "the manually queued copy stays");
        assert!(lists.upcoming.is_empty());
        assert!(!lists.remove_entry(&context_uid, "spotify:track:x"));
    }

    #[test]
    fn repeated_sync_keeps_a_title_queued_twice() {
        let mut lists = QueueLists::default();
        lists.push_explicit(track("spotify:track:x", "X"));
        lists.push_explicit(track("spotify:track:x", "X"));
        let first = lists.pop_explicit().expect("first");
        lists.mark_current_consumed(&first.item.uri, true);
        // Publish, Playing and pause/resume enrichment all sync again.
        lists.sync_current("spotify:track:x");
        lists.sync_current("spotify:track:x");
        assert_eq!(lists.explicit.len(), 1);
    }

    #[test]
    fn next_keeps_later_playlist_duplicates_of_the_current_track() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:one".into(),
            ],
            "spotify:track:one",
            false,
        );
        lists.sync_current("spotify:track:one");
        let next = lists
            .take_next_or_wrap(Some("spotify:track:one"), false, false)
            .expect("next");
        assert_eq!(next.item.uri, "spotify:track:two");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:one");
    }

    #[test]
    fn clicking_another_playlist_track_rebuilds_the_remainder() {
        let playlist = vec![
            "spotify:track:one".into(),
            "spotify:track:two".into(),
            "spotify:track:three".into(),
            "spotify:track:four".into(),
        ];
        let mut lists = QueueLists::default();
        lists.replace_upcoming(playlist.clone(), "spotify:track:one", false);
        lists.apply_metadata(track("spotify:track:one", "Nightcall"));
        lists.remember_item(&track("spotify:track:one", "Nightcall"));
        assert_eq!(
            lists
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            [
                "spotify:track:two",
                "spotify:track:three",
                "spotify:track:four"
            ]
        );

        lists.replace_upcoming(playlist, "spotify:track:two", false);
        assert_eq!(
            lists
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            ["spotify:track:three", "spotify:track:four"]
        );
        assert!(
            lists
                .upcoming
                .iter()
                .all(|entry| entry.item.uri != "spotify:track:one")
        );
    }

    #[test]
    fn failed_context_rebuild_does_not_keep_the_previous_song() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec!["spotify:track:one".into(), "spotify:track:two".into()],
            "spotify:track:one",
            false,
        );
        lists.apply_metadata(track("spotify:track:one", "Nightcall"));
        lists.clear_context();
        assert!(lists.upcoming.is_empty());
        assert!(lists.context_uris.is_empty());
    }

    #[test]
    fn clicking_a_playlist_track_keeps_the_remaining_queue() {
        let upcoming = upcoming_from_context(
            &[
                "spotify:track:0000000000000000000001".into(),
                "spotify:track:0000000000000000000002".into(),
                "spotify:track:0000000000000000000003".into(),
            ],
            "spotify:track:0000000000000000000002?context=playlist",
            false,
            &HashMap::new(),
        );
        assert_eq!(
            upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            ["spotify:track:0000000000000000000003"]
        );
    }

    #[test]
    fn placeholders_skip_failed_uris_so_hydrate_can_continue() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
            ],
            "spotify:track:now",
            false,
        );
        lists.mark_failed("spotify:track:one".into());
        assert_eq!(
            lists.next_placeholders(8, 8),
            vec!["spotify:track:two".to_string()]
        );
        let epoch = lists.begin_hydrate();
        assert!(lists.is_hydrate_current(epoch));
        assert_eq!(
            lists.next_placeholders(8, 8),
            vec![
                "spotify:track:one".to_string(),
                "spotify:track:two".to_string()
            ]
        );
    }

    #[test]
    fn hydration_candidates_follow_the_leading_queue_window_after_skips() {
        let mut lists = QueueLists::default();
        let context = (0..20)
            .map(|index| format!("spotify:track:{index:022}"))
            .collect::<Vec<_>>();
        lists.replace_upcoming(context.clone(), &context[0], true);

        let first_window = lists.next_placeholders(6, 6);
        assert_eq!(first_window.len(), 6);
        for (index, uri) in first_window.iter().enumerate() {
            lists.apply_metadata(track(uri, &format!("Resolved {index}")));
        }
        assert!(lists.next_placeholders(6, 6).is_empty());

        let played = lists.take_next().expect("first shuffled track");
        lists.push_history(&played.item.uri);

        let shifted_window = lists.next_placeholders(6, 6);
        assert_eq!(shifted_window.len(), 1);
        assert_eq!(
            shifted_window[0], lists.upcoming[5].item.uri,
            "only the newly exposed queue row should need metadata"
        );
    }

    #[test]
    fn reshuffle_keeps_already_loaded_titles() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
            ],
            "spotify:track:now",
            false,
        );
        lists.apply_metadata(track("spotify:track:one", "Nightcall"));
        lists.apply_metadata(track("spotify:track:two", "Pacific Coast Highway"));
        lists.reshuffle_upcoming("spotify:track:now", true);
        let titles: Vec<_> = lists
            .upcoming
            .iter()
            .map(|entry| entry.item.title.as_str())
            .collect();
        assert_eq!(lists.upcoming.len(), 2);
        assert!(titles.contains(&"Nightcall"));
        assert!(titles.contains(&"Pacific Coast Highway"));
        assert!(!titles.contains(&crate::metadata::LOADING_TITLE));
        lists.reshuffle_upcoming("spotify:track:now", false);
        assert_eq!(
            lists
                .upcoming
                .iter()
                .map(|entry| entry.item.title.as_str())
                .collect::<Vec<_>>(),
            ["Nightcall", "Pacific Coast Highway"]
        );
    }

    #[test]
    fn linear_queue_keeps_later_duplicates_of_the_current_track() {
        let upcoming = upcoming_from_context(
            &[
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:one".into(),
                "spotify:track:three".into(),
            ],
            "spotify:track:one",
            false,
            &HashMap::new(),
        );
        assert_eq!(
            upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            [
                "spotify:track:two",
                "spotify:track:one",
                "spotify:track:three"
            ]
        );
    }

    #[test]
    fn shuffle_expand_keeps_the_live_mix() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:played".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
            ],
            "spotify:track:now",
            true,
        );
        lists
            .upcoming
            .retain(|entry| entry.item.uri != "spotify:track:played");
        lists.push_history("spotify:track:played");
        let live: Vec<String> = lists
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.clone())
            .collect();
        lists.replace_upcoming_preserving(
            vec![
                "spotify:track:now".into(),
                "spotify:track:played".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:new".into(),
            ],
            "spotify:track:now",
            true,
        );
        let upcoming: Vec<_> = lists
            .upcoming
            .iter()
            .map(|entry| entry.item.uri.as_str())
            .collect();
        assert_eq!(upcoming[0], live[0]);
        assert_eq!(upcoming[1], live[1]);
        assert_eq!(upcoming.last().copied(), Some("spotify:track:new"));
        assert!(!upcoming.contains(&"spotify:track:now"));
        assert!(!upcoming.contains(&"spotify:track:played"));
    }

    #[test]
    fn reshuffle_does_not_bring_played_tracks_back() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:played".into(),
            ],
            "spotify:track:now",
            true,
        );
        lists.push_history("spotify:track:played");
        lists.reshuffle_upcoming("spotify:track:now", true);
        assert_eq!(lists.upcoming.len(), 2);
        assert!(
            lists
                .upcoming
                .iter()
                .all(|entry| entry.item.uri != "spotify:track:played"
                    && entry.item.uri != "spotify:track:now")
        );
    }

    #[test]
    fn shuffled_next_does_not_replay_catalog_neighbors_when_the_mix_is_empty() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
                "spotify:track:three".into(),
            ],
            "spotify:track:now",
            true,
        );
        while let Some(entry) = lists.take_next() {
            lists.push_history(&entry.item.uri);
        }
        lists.push_history("spotify:track:now");
        assert!(
            lists
                .take_next_or_wrap(Some("spotify:track:now"), false, true)
                .is_none(),
            "an exhausted shuffle mix must not fall back to playlist order"
        );
        let wrapped = lists
            .take_next_or_wrap(Some("spotify:track:now"), true, true)
            .expect("repeat-all wrap");
        assert_ne!(wrapped.item.uri, "spotify:track:now");
        assert!(lists.upcoming.iter().all(
            |entry| entry.item.uri != "spotify:track:now" && entry.item.uri != wrapped.item.uri
        ));
    }

    #[test]
    fn shuffled_repeat_wrap_starts_a_new_mix_without_the_current_track() {
        let mut lists = QueueLists::default();
        lists.replace_upcoming(
            vec![
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
            ],
            "spotify:track:two",
            true,
        );
        lists.upcoming.clear();
        let wrapped = lists
            .take_next_or_wrap(Some("spotify:track:two"), true, true)
            .expect("wrap");
        assert_ne!(wrapped.item.uri, "spotify:track:two");
        assert!(lists.upcoming.iter().all(
            |entry| entry.item.uri != wrapped.item.uri && entry.item.uri != "spotify:track:two"
        ));
        assert_eq!(lists.upcoming.len(), 1);
        assert!(lists.history.is_empty());
    }

    #[test]
    fn shuffle_keeps_the_current_track_out_of_upcoming() {
        let upcoming = upcoming_from_context(
            &[
                "spotify:track:now".into(),
                "spotify:track:one".into(),
                "spotify:track:two".into(),
            ],
            "spotify:track:now",
            true,
            &HashMap::new(),
        );
        assert_eq!(upcoming.len(), 2);
        assert!(
            upcoming
                .iter()
                .all(|entry| entry.item.uri != "spotify:track:now")
        );
    }

    #[test]
    fn reorder_keeps_explicit_items_ahead_of_context() {
        let mut lists = QueueLists::default();
        lists.push_explicit(track("spotify:track:queued", "Queued"));
        lists.replace_upcoming(
            vec!["spotify:track:now".into(), "spotify:track:next".into()],
            "spotify:track:now",
            false,
        );
        let visible = lists.visible();
        lists
            .apply_visible_reorder(&QueueReorderRequest {
                moved: QueueItemReference {
                    uri: visible[0].item.uri.clone(),
                    uid: visible[0].uid.clone(),
                },
                anchor: QueueItemReference {
                    uri: visible[1].item.uri.clone(),
                    uid: visible[1].uid.clone(),
                },
                placement: QueuePlacement::After,
                expected_revision: lists.revision,
            })
            .expect("reorder");
        assert_eq!(lists.visible()[0].item.uri, "spotify:track:queued");
        assert_eq!(lists.upcoming[0].item.uri, "spotify:track:next");
    }
}
