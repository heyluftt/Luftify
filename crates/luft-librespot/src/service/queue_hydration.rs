use super::*;

#[cfg(test)]
mod tests;

const QUEUE_HYDRATE_BATCH: usize = 12;
const QUEUE_HYDRATE_MAX_ITEMS: usize = 12;

/// Refill the metadata window at the front of the live queue.
///
/// Queue reads remain side-effect free. Callers schedule this after queue
/// creation, shuffle changes and every committed transport step instead.
pub(super) fn spawn_queue_hydrate(shared: Arc<Shared>) {
    tokio::spawn(async move {
        let session = shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone());
        let Some(session) = session else {
            return;
        };
        let epoch = shared.playback.write().await.queue.begin_hydrate();
        hydrate_queue_metadata(&shared, &session, epoch).await;
    });
}

async fn hydrate_queue_metadata(shared: &Shared, session: &Session, epoch: u64) {
    let started = Instant::now();
    let mut attempted_total = 0usize;
    let mut processed_total = 0usize;
    let log_summary = !shared
        .playback
        .read()
        .await
        .diagnostics
        .unavailable_streak_active();
    loop {
        let remaining_budget = QUEUE_HYDRATE_MAX_ITEMS.saturating_sub(attempted_total);
        if remaining_budget == 0 {
            break;
        }
        if !shared.playback.read().await.queue.is_hydrate_current(epoch) {
            if log_summary {
                info!(
                    target: "luft_librespot::diagnostics",
                    adapter = "librespot",
                    phase = "queue-hydrate",
                    epoch,
                    attempted = attempted_total,
                    processed = processed_total,
                    elapsed_ms = started.elapsed().as_millis(),
                    "libre queue hydration superseded"
                );
            }
            return;
        }
        let uris = shared.playback.read().await.queue.next_placeholders(
            QUEUE_HYDRATE_MAX_ITEMS,
            QUEUE_HYDRATE_BATCH.min(remaining_budget),
        );
        if uris.is_empty() {
            break;
        }
        attempted_total = attempted_total.saturating_add(uris.len());
        let mut changed = false;
        let mut resolved = 0usize;
        // One batched lookup for the next rows (see metadata_batch).
        let found = tokio::time::timeout(
            QUEUE_HYDRATE_TRACK_TIMEOUT * 2,
            crate::metadata_batch::tracks(&session, &uris),
        )
        .await
        .unwrap_or_default();
        for uri in uris {
            let item = found.get(&uri).cloned();
            let Some(processed) = apply_hydrate_result(shared, epoch, Some(Ok((uri, item))), &mut changed).await else {
                return;
            };
            resolved += processed;
        }
        processed_total = processed_total.saturating_add(resolved);
        {
            let mut snapshot = shared.playback.write().await;
            if !snapshot.queue.is_hydrate_current(epoch) {
                if log_summary {
                    info!(
                        target: "luft_librespot::diagnostics",
                        adapter = "librespot",
                        phase = "queue-hydrate",
                        epoch,
                        attempted = attempted_total,
                        processed = processed_total,
                        elapsed_ms = started.elapsed().as_millis(),
                        "libre queue hydration superseded after batch"
                    );
                }
                return;
            }
            if changed {
                snapshot.queue.bump();
            }
        }
        if changed {
            notify_playback(shared).await;
        }
        if resolved == 0 {
            break;
        }
    }
    if log_summary {
        let snapshot = shared.playback.read().await;
        info!(
            target: "luft_librespot::diagnostics",
            adapter = "librespot",
            phase = "queue-hydrate",
            epoch,
            attempted = attempted_total,
            processed = processed_total,
            failed = snapshot.queue.failed.len(),
            known = snapshot.queue.known.len(),
            queue_explicit = snapshot.queue.explicit.len(),
            queue_upcoming = snapshot.queue.upcoming.len(),
            elapsed_ms = started.elapsed().as_millis(),
            "libre queue hydration completed"
        );
    }
}

// None stops a superseded worker and drops its JoinSet, aborting pending lookups.
async fn apply_hydrate_result(
    shared: &Shared,
    epoch: u64,
    result: Option<Result<(String, Option<luft_core::MediaItem>), tokio::task::JoinError>>,
    changed: &mut bool,
) -> Option<usize> {
    let mut snapshot = shared.playback.write().await;
    if !snapshot.queue.is_hydrate_current(epoch) {
        return None;
    }
    let Some(Ok((uri, item))) = result else {
        return Some(0);
    };
    if let Some(item) = item {
        if snapshot.queue.apply_metadata(item) {
            *changed = true;
        }
    } else {
        snapshot.queue.mark_failed(uri);
    }
    Some(1)
}
