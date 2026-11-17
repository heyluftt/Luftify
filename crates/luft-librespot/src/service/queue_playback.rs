use super::*;

impl LibrespotService {
    pub async fn play_queue_item(&self, uri: &str) -> Result<(), ProviderError> {
        self.ensure_ready().await?;
        let uri = uri.trim();
        if !is_playable_item_uri(uri) {
            return Err(invalid_playable_uri(uri));
        }
        let is_current = {
            let snapshot = self.shared.playback.read().await;
            effective_cursor_uri(&snapshot).is_some_and(|current| same_item_uri(&current, uri))
        };
        if is_current {
            return self.play().await;
        }
        let intent = reserve_load_intent(&self.shared).await;
        let prepared = {
            let mut snapshot = self.shared.playback.write().await;
            if !load_intent_is_current(&snapshot, intent) {
                return Ok(());
            }
            prepare_queue_jump(&mut snapshot, uri).ok_or_else(|| ProviderError::ActionRejected {
                message: "Der Titel ist nicht mehr in der Warteschlange.".into(),
                retryable: false,
            })?
        };
        self.finish_prepared_load(prepared).await
    }
}

fn prepare_queue_jump(snapshot: &mut PlaybackSnapshot, uri: &str) -> Option<PreparedTrackLoad> {
    let position = snapshot
        .queue
        .explicit
        .iter()
        .chain(&snapshot.queue.upcoming)
        .position(|entry| same_item_uri(&entry.item.uri, uri))?;
    let mut queue = snapshot.queue.clone();
    if let Some(current) = effective_cursor_item(snapshot) {
        queue.push_history(&current.uri);
        queue.remember_item(&current);
    }
    // Consume the visible prefix, but commit only once so a failed load can
    // roll back the entire jump, not just its last step.
    for _ in 0..position {
        let skipped = queue.pop_explicit().or_else(|| queue.take_next())?;
        queue.push_history(&skipped.item.uri);
        queue.remember_item(&skipped.item);
    }
    let explicit = !queue.explicit.is_empty();
    let entry = queue.pop_explicit().or_else(|| queue.take_next())?;
    commit_prepared_load(snapshot, queue, entry, explicit)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp";
    const B: &str = "spotify:track:4cOdK2wGLETKBW3PvgPWqT";
    const C: &str = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
    const D: &str = "spotify:track:6habFhsOp2NvshLv26DqMb";

    fn snapshot() -> PlaybackSnapshot {
        let mut snapshot = PlaybackSnapshot {
            current_item: Some(loading_item(A)),
            context_uri: Some("spotify:playlist:test".into()),
            shuffle_enabled: true,
            ..PlaybackSnapshot::default()
        };
        snapshot
            .queue
            .replace_upcoming(vec![A.into(), B.into(), C.into(), D.into()], A, false);
        snapshot
    }

    #[test]
    fn jump_preserves_the_remaining_mix_and_context() {
        let mut snapshot = snapshot();
        let catalog = snapshot.queue.context_uris.clone();
        let prepared = prepare_queue_jump(&mut snapshot, C).unwrap();
        assert_eq!(prepared.item.uri, C);
        assert_eq!(
            prepared.context_uri.as_deref(),
            Some("spotify:playlist:test")
        );
        assert!(snapshot.shuffle_enabled);
        assert_eq!(snapshot.queue.context_uris, catalog);
        assert_eq!(
            snapshot
                .queue
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.as_str())
                .collect::<Vec<_>>(),
            vec![D]
        );
        assert_eq!(snapshot.queue.history, vec![A, B]);
    }

    #[test]
    fn explicit_jump_preserves_other_context_tracks() {
        let mut snapshot = snapshot();
        snapshot.queue.push_explicit(loading_item(D));
        snapshot.queue.push_explicit(loading_item(C));
        let before = snapshot
            .queue
            .upcoming
            .iter()
            .filter(|entry| entry.item.uri != D)
            .map(|entry| entry.item.uri.clone())
            .collect::<Vec<_>>();
        let prepared = prepare_queue_jump(&mut snapshot, D).unwrap();
        assert!(prepared.explicit);
        assert_eq!(snapshot.queue.explicit[0].item.uri, C);
        assert_eq!(
            snapshot
                .queue
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.clone())
                .collect::<Vec<_>>(),
            before
        );
    }

    #[test]
    fn stale_target_does_not_replace_the_queue() {
        let mut snapshot = snapshot();
        let revision = snapshot.queue.revision;
        assert!(prepare_queue_jump(&mut snapshot, "spotify:track:missing").is_none());
        assert_eq!(snapshot.queue.revision, revision);
        assert!(snapshot.queue.history.is_empty());
    }
}
