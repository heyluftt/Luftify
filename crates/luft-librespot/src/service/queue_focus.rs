use super::*;

/// Upper bound for one queue window; the UI grows it page by page.
const QUEUE_WINDOW_MAX: usize = 5_000;
const QUEUE_FOCUS_MAX_ITEMS: usize = 48;
/// Rows looked up together; the shared song service batches them in one request.
const QUEUE_FOCUS_BATCH: usize = 48;

impl LibrespotService {
    /// The leading `limit` rows of the queue and its full length. Long
    /// contexts (liked songs) would otherwise cross IPC on every refresh.
    pub async fn queue_window(&self, limit: usize) -> Result<QueueState, ProviderError> {
        self.ensure_ready().await?;
        let snapshot = self.shared.playback.read().await;
        let cursor = effective_cursor_uri(&snapshot);
        let (items, total) = snapshot
            .queue
            .visible_window(cursor.as_deref(), limit.clamp(1, QUEUE_WINDOW_MAX));
        Ok(QueueState {
            current_item: snapshot.current_item.clone(),
            items,
            revision: snapshot.queue.revision,
            total_items: Some(u32::try_from(total).unwrap_or(u32::MAX)),
        })
    }

    /// Resolves the placeholder rows currently on screen. A newer request
    /// replaces the pending one, so fast scrolling only loads where it stops.
    pub async fn hydrate_queue_items(&self, uris: Vec<String>) {
        let start = {
            let mut snapshot = self.shared.playback.write().await;
            let wanted = snapshot
                .queue
                .placeholders_among(&uris, QUEUE_FOCUS_MAX_ITEMS);
            snapshot.queue.focus_wanted = wanted;
            !snapshot.queue.focus_wanted.is_empty()
                && !std::mem::replace(&mut snapshot.queue.focus_running, true)
        };
        if start {
            tokio::spawn(run_focus_hydrate(Arc::clone(&self.shared)));
        }
    }
}

async fn run_focus_hydrate(shared: Arc<Shared>) {
    let session = shared
        .session
        .lock()
        .await
        .as_ref()
        .map(|active| active.session.clone());
    let Some(session) = session else {
        let mut snapshot = shared.playback.write().await;
        snapshot.queue.focus_wanted.clear();
        snapshot.queue.focus_running = false;
        return;
    };
    loop {
        let (batch, context_uri) = {
            let mut snapshot = shared.playback.write().await;
            let take = snapshot.queue.focus_wanted.len().min(QUEUE_FOCUS_BATCH);
            if take == 0 {
                snapshot.queue.focus_wanted.clear();
                snapshot.queue.focus_running = false;
                return;
            }
            let batch: Vec<String> = snapshot.queue.focus_wanted.drain(..take).collect();
            (batch, snapshot.context_uri.clone())
        };
        let catalog = match context_uri.as_deref() {
            Some(uri) if uri.contains(":playlist:") => shared.playlist_cache.catalog(uri).await,
            _ => None,
        };
        // The rows on screen in one batched lookup instead of four at a time.
        let missing = batch.iter()
            .filter(|uri| catalog.as_ref().is_none_or(|items| !items.contains_key(*uri)))
            .cloned()
            .collect::<Vec<_>>();
        let fetched = crate::metadata_batch::tracks(&session, &missing).await;
        let resolved = batch.into_iter().map(|uri| {
            let item = catalog.as_ref().and_then(|items| items.get(&uri)).or_else(|| fetched.get(&uri)).cloned();
            (uri, item)
        }).collect::<Vec<_>>();
        let changed = {
            let mut snapshot = shared.playback.write().await;
            let mut changed = false;
            for (uri, item) in resolved {
                match item {
                    Some(item) => changed |= snapshot.queue.apply_metadata(item),
                    None => snapshot.queue.mark_failed(uri),
                }
            }
            if changed {
                snapshot.queue.bump();
            }
            changed
        };
        if changed {
            notify_playback(&shared).await;
        }
    }
}
