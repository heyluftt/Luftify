use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicU64, Ordering},
};

use tracing::warn;

use crate::queue::same_item_uri;

use super::{Shared, notify_playback, uri_tail};

#[derive(Debug, Default)]
pub(super) struct CanvasLookupTracker {
    epoch: AtomicU64,
    uri: StdMutex<Option<String>>,
}

impl CanvasLookupTracker {
    fn claim(&self, uri: &str) -> Option<u64> {
        let mut claimed_uri = self.locked_uri();
        if claimed_uri
            .as_deref()
            .is_some_and(|current| same_item_uri(current, uri))
        {
            return None;
        }
        *claimed_uri = Some(uri.to_string());
        Some(self.epoch.fetch_add(1, Ordering::SeqCst) + 1)
    }

    fn cancel(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        *self.locked_uri() = None;
    }

    fn is_current(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::SeqCst) == epoch
    }

    fn release_failed(&self, uri: &str, epoch: u64) {
        if !self.is_current(epoch) {
            return;
        }
        let mut claimed_uri = self.locked_uri();
        if claimed_uri
            .as_deref()
            .is_some_and(|current| same_item_uri(current, uri))
        {
            *claimed_uri = None;
        }
    }

    fn locked_uri(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.uri
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(in crate::service) fn schedule_experimental_canvas(shared: &Arc<Shared>, uri: &str) {
    if !shared.experimental_canvas.load(Ordering::SeqCst) || uri.trim().is_empty() {
        return;
    }
    let Some(epoch) = shared.canvas_lookup.claim(uri) else {
        return;
    };
    let uri = uri.to_string();
    let shared = Arc::clone(shared);
    tokio::spawn(async move {
        enrich_shared_canvas(shared, uri, epoch).await;
    });
}

pub(super) fn cancel_experimental_canvas(shared: &Shared) {
    shared.canvas_lookup.cancel();
}

fn canvas_lookup_current(shared: &Shared, epoch: u64) -> bool {
    shared.experimental_canvas.load(Ordering::SeqCst) && shared.canvas_lookup.is_current(epoch)
}

fn release_failed_lookup(shared: &Shared, uri: &str, epoch: u64) {
    shared.canvas_lookup.release_failed(uri, epoch);
}

async fn enrich_shared_canvas(shared: Arc<Shared>, uri: String, epoch: u64) {
    if !canvas_lookup_current(&shared, epoch) {
        return;
    }
    let session = shared
        .session
        .lock()
        .await
        .as_ref()
        .map(|active| active.session.clone());
    let Some(session) = session else {
        release_failed_lookup(&shared, &uri, epoch);
        warn!(
            adapter = "librespot-canvas",
            track_uri = uri_tail(&uri),
            "experimental canvas skipped: no session"
        );
        return;
    };
    let Some(canvas_url) =
        crate::canvas::fetch_canvas_url(&session, &uri, || canvas_lookup_current(&shared, epoch))
            .await
    else {
        release_failed_lookup(&shared, &uri, epoch);
        return;
    };
    apply_canvas_url(shared, uri, epoch, canvas_url).await;
}

async fn apply_canvas_url(shared: Arc<Shared>, uri: String, epoch: u64, canvas_url: String) {
    if !canvas_lookup_current(&shared, epoch) {
        return;
    }
    let applied = {
        let mut snapshot = shared.playback.write().await;
        let mut applied = false;
        if let Some(expected) = snapshot.expected_item.as_mut()
            && same_item_uri(&expected.uri, &uri)
            && expected.canvas_url.as_deref() != Some(canvas_url.as_str())
        {
            expected.canvas_url = Some(canvas_url.clone());
            applied = true;
        }
        if let Some(current) = snapshot.current_item.as_mut()
            && same_item_uri(&current.uri, &uri)
            && current.canvas_url.as_deref() != Some(canvas_url.as_str())
        {
            current.canvas_url = Some(canvas_url);
            applied = true;
        }
        applied
    };
    if applied {
        notify_playback(&shared).await;
    } else {
        release_failed_lookup(&shared, &uri, epoch);
    }
}

#[cfg(test)]
mod tests {
    use super::CanvasLookupTracker;

    const TRACK: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";

    #[test]
    fn failed_lookup_releases_track_for_retry() {
        let tracker = CanvasLookupTracker::default();
        let first_epoch = tracker.claim(TRACK).expect("first lookup is claimed");

        assert!(tracker.claim(TRACK).is_none());

        tracker.release_failed(TRACK, first_epoch);

        assert!(tracker.claim(TRACK).is_some());
    }
}
