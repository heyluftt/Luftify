use super::*;

impl LibrespotService {
    pub async fn play_context_from_catalog(
        &self,
        context_uri: &str,
        track_uri: Option<&str>,
        catalog: Vec<MediaItem>,
    ) -> Result<(), ProviderError> {
        if let Some(track_uri) = track_uri.map(str::trim)
            && !is_playable_item_uri(track_uri)
        {
            return Err(invalid_playable_uri(track_uri));
        }
        self.play_context_start(context_uri, track_uri, catalog)
            .await
    }

    /// Restore the last playlist queue without starting playback.
    pub async fn seed_context_queue(
        &self,
        context_uri: &str,
        track_uri: Option<&str>,
        catalog: Vec<MediaItem>,
    ) {
        if self.shared.status.read().await.phase != LibrespotPhase::Ready {
            warn!(
                adapter = "librespot",
                phase = "queue-restore",
                context_uri,
                "queue seed skipped, librespot is not ready"
            );
            return;
        }
        self.seed_playlist_playback_cache(context_uri, &catalog)
            .await;
        let catalog_order = catalog_uris(&catalog);
        let uris = if !catalog_order.is_empty() {
            catalog_order
        } else {
            let existing_uris = self.context_uris_for(context_uri).await;
            let remote = self.load_remote_play_entries(context_uri).await;
            play_order(&[], &existing_uris, &remote)
        };
        let order = uris.len();
        let (shuffle, next, expected_elapsed_ms) = {
            let mut snapshot = self.shared.playback.write().await;
            if !startup_seed_is_safe(
                snapshot.handoff_hold,
                snapshot.is_playing,
                snapshot.play_generation,
                snapshot.startup_play_generation,
            ) {
                info!(
                    adapter = "librespot",
                    phase = "queue-restore",
                    context_uri,
                    play_generation = snapshot.play_generation,
                    is_playing = snapshot.is_playing,
                    "queue seed skipped, playback is already live"
                );
                return;
            }
            snapshot.context_uri = Some(context_uri.to_string());
            for item in &catalog {
                snapshot.queue.remember_item(item);
            }
            if snapshot.current_item.is_none() {
                if let Some(track) = track_uri.filter(|uri| is_playable_item_uri(uri)) {
                    snapshot.current_item = Some(catalog_current_item(&catalog, track));
                    snapshot.expected_track_uri = Some(track.to_string());
                    snapshot.expected_item = Some(catalog_current_item(&catalog, track));
                    snapshot.expected_started_at = Some(Instant::now());
                    snapshot.expected_player_request_id = None;
                    snapshot.expected_player_baseline_request_id = None;
                }
            }
            let shuffle = if !uris.is_empty() {
                let current = snapshot
                    .current_item
                    .as_ref()
                    .map(|item| item.uri.clone())
                    .or_else(|| track_uri.map(str::to_string))
                    .unwrap_or_default();
                replace_startup_context_queue(&mut snapshot, uris, current.as_str())
            } else {
                snapshot.shuffle_enabled
            };
            let next = snapshot
                .queue
                .upcoming
                .first()
                .map(|entry| entry.item.uri.clone());
            log_transition(
                &snapshot,
                "startup-queue-seed",
                if order == 0 { "empty" } else { "restored" },
                track_uri,
                None,
            );
            (shuffle, next, snapshot.expected_elapsed_ms())
        };
        info!(
            adapter = "librespot",
            phase = "queue-restore",
            context_uri,
            track_uri = track_uri.map(uri_tail),
            catalog = catalog.len(),
            order,
            shuffle,
            next = next.as_deref().map(uri_tail),
            expected_elapsed_ms,
            "startup queue seeded"
        );
        notify_playback(&self.shared).await;
        self.spawn_playlist_queue_expand();
    }

    pub async fn claim_startup_queue_restore(&self) -> bool {
        !self.shared.queue_restored.swap(true, Ordering::SeqCst)
    }

    pub async fn restore_last_context_once(
        &self,
        context_uri: &str,
        track_uri: Option<&str>,
        catalog: Vec<MediaItem>,
    ) {
        if !self.claim_startup_queue_restore().await {
            if self.shared.playback.read().await.queue.context_uris.len() < 8 {
                self.spawn_playlist_queue_expand();
            }
            return;
        }
        self.seed_context_queue(context_uri, track_uri, catalog)
            .await;
    }

    pub(super) async fn play_context_start(
        &self,
        context_uri: &str,
        track_uri: Option<&str>,
        catalog: Vec<MediaItem>,
    ) -> Result<(), ProviderError> {
        let started = Instant::now();
        let context_uri = context_uri.trim();
        let discovery = super::discovery_queue::is_discovery_context(context_uri);
        if !is_context_uri(context_uri) {
            return Err(invalid_context_uri(context_uri));
        }
        if let Some(track_uri) = track_uri.map(str::trim)
            && !is_playable_item_uri(track_uri)
        {
            return Err(invalid_playable_uri(track_uri));
        }
        let cache_worker = self.clone();
        let cache_context = context_uri.to_string();
        let cache_catalog = catalog.clone();
        tokio::spawn(async move {
            cache_worker
                .seed_playlist_playback_cache(&cache_context, &cache_catalog)
                .await;
        });
        let intent = reserve_load_intent(&self.shared).await;
        let shuffle = self.shared.playback.read().await.shuffle_enabled;
        let mut start_track = track_uri.map(str::trim).map(str::to_string);
        let catalog_order = catalog_uris(&catalog);
        let mut local_uris = if catalog_order.len() > 1
            || (!catalog_order.is_empty() && !context_owns_remote_queue(context_uri))
        {
            catalog_order
        } else {
            let existing = self.context_uris_for(context_uri).await;
            if existing.len() > 1 {
                existing
            } else {
                self.shared
                    .playlist_cache
                    .cached_play_uris(context_uri)
                    .await
            }
        };
        if local_uris.is_empty() {
            local_uris = self
                .shared
                .playlist_cache
                .cached_play_uris(context_uri)
                .await;
        }
        local_uris.retain(|uri| is_playable_item_uri(uri));
        if local_uris.is_empty() && start_track.is_none() {
            let remote = self.load_remote_play_entries(context_uri).await;
            local_uris = play_order(&[], &[], &remote);
        }
        if start_track.is_none() {
            start_track = if should_pick_random_context_start(track_uri, shuffle) {
                let seed = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos() as u64)
                    .unwrap_or(1);
                pick_random_context_start(&local_uris, seed).map(str::to_string)
            } else {
                local_uris.first().cloned()
            };
        }
        let Some(start_track) = start_track else {
            return Err(ProviderError::ActionRejected {
                message: "Der Kontext enthält keine abspielbaren Titel.".into(),
                retryable: true,
            });
        };
        if local_uris.is_empty() {
            local_uris.push(start_track.clone());
        }
        info!(
            adapter = "librespot",
            phase = "play-context",
            context_uri,
            start_track = uri_tail(&start_track),
            catalog = catalog.len(),
            preloaded = local_uris.len(),
            shuffle,
            elapsed_ms = started.elapsed().as_millis(),
            "context play starting"
        );
        let expected_lock_started = Instant::now();
        let (generation, rollback) = {
            let mut snapshot = self.shared.playback.write().await;
            let lock_wait_ms = expected_lock_started.elapsed().as_millis();
            if !load_intent_is_current(&snapshot, intent) {
                info!(
                    adapter = "librespot",
                    phase = "play-context",
                    context_uri,
                    start_track = uri_tail(&start_track),
                    elapsed_ms = started.elapsed().as_millis(),
                    lock_wait_ms,
                    "context play superseded before expected commit"
                );
                return Ok(());
            }
            let mut rollback = PlaybackRollback::capture(&snapshot, intent);
            snapshot.handoff_hold = false;
            let generation = begin_expected_track(&mut snapshot, &start_track);
            if let Some(current) = snapshot.current_item.clone() {
                snapshot.queue.remember_item(&current);
            }
            snapshot.queue.interrupted = false;
            snapshot.context_uri = Some(context_uri.to_string());
            if discovery {
                super::discovery_queue::replace_discovery_queue(
                    &mut snapshot,
                    &catalog,
                    local_uris.clone(),
                    &start_track,
                );
            }
            // The play request carries the list the listener sees; its titles
            // label the whole queue without per-track metadata lookups.
            for item in &catalog {
                snapshot.queue.remember_item(item);
            }
            let mut expected_item = catalog_current_item(&catalog, &start_track);
            if let Some(known) = snapshot.queue.known.get(&start_track).cloned() {
                expected_item = merge_media_items(Some(&expected_item), known);
            }
            if let Some(duration_ms) = expected_item.duration_ms.filter(|ms| *ms > 0) {
                snapshot.duration_ms = duration_ms;
            }
            snapshot.expected_item = Some(expected_item);
            rollback.seal(&snapshot);
            log_transition(
                &snapshot,
                "command-play-context",
                "expected-committed",
                Some(&start_track),
                None,
            );
            info!(
                adapter = "librespot",
                phase = "play-context",
                context_uri,
                start_track = uri_tail(&start_track),
                generation,
                elapsed_ms = started.elapsed().as_millis(),
                lock_wait_ms,
                "context play expected committed"
            );
            (generation, rollback)
        };
        notify_playback(&self.shared).await;
        let metadata_worker = self.clone();
        let metadata_uri = start_track.clone();
        let metadata_context = context_uri.to_string();
        tokio::spawn(async move {
            metadata_worker
                .publish_loaded_item(&metadata_uri, Some(metadata_context), Some(generation))
                .await;
        });
        let loaded = match send_expected_track_load(&self.shared, &start_track, generation).await {
            Ok(loaded) => loaded,
            Err(error) => {
                fail_expected_load(&self.shared, generation, &start_track, Some(&rollback)).await;
                notify_playback(&self.shared).await;
                return Err(error);
            }
        };
        info!(
            adapter = "librespot",
            phase = "play-context",
            context_uri,
            start_track = uri_tail(&start_track),
            generation,
            loaded,
            elapsed_ms = started.elapsed().as_millis(),
            "context play load sent"
        );
        if !loaded {
            return Ok(());
        }
        notify_playback(&self.shared).await;
        let worker = self.clone();
        let context_uri = context_uri.to_string();
        let skip_remote_seed = local_uris.len() >= 8 || !context_owns_remote_queue(&context_uri);
        tokio::spawn(async move {
            if !discovery {
                worker
                    .commit_prepared_context_queue(
                        &context_uri,
                        &start_track,
                        local_uris.clone(),
                        generation,
                    )
                    .await;
            }
            if skip_remote_seed {
                spawn_queue_hydrate(Arc::clone(&worker.shared));
            } else {
                worker
                    .seed_context_playback(
                        &context_uri,
                        Some(&start_track),
                        Some(local_uris),
                        generation,
                    )
                    .await;
            }
        });
        Ok(())
    }

    async fn commit_prepared_context_queue(
        &self,
        context_uri: &str,
        start_track: &str,
        local_uris: Vec<String>,
        generation: u64,
    ) {
        let started = Instant::now();
        let planned = {
            let mut snapshot = self.shared.playback.write().await;
            if snapshot.play_generation != generation
                || snapshot.context_uri.as_deref() != Some(context_uri)
            {
                info!(
                    adapter = "librespot",
                    phase = "play-context",
                    context_uri,
                    start_track = uri_tail(start_track),
                    generation,
                    elapsed_ms = started.elapsed().as_millis(),
                    "context play superseded before queue commit"
                );
                return;
            }
            let shuffle = snapshot.shuffle_enabled;
            let current = start_track.to_string();
            let history = snapshot.queue.history.clone();
            let existing: Vec<String> = snapshot
                .queue
                .upcoming
                .iter()
                .map(|entry| entry.item.uri.clone())
                .collect();
            let commit = ShuffleCommit::from_enabled(shuffle);
            let seed = snapshot.queue.take_mix_seed(&current, commit);
            (shuffle, current, history, existing, seed, commit)
        };
        let (shuffle, current, history, existing, seed, commit) = planned;
        let remaining = plan_upcoming(&local_uris, &current, &history, &existing, commit, seed);
        {
            let mut snapshot = self.shared.playback.write().await;
            if snapshot.play_generation != generation
                || snapshot.context_uri.as_deref() != Some(context_uri)
            {
                return;
            }
            snapshot
                .queue
                .apply_planned_upcoming(local_uris, start_track, remaining);
            log_transition(
                &snapshot,
                "command-play-context",
                "prepared",
                Some(start_track),
                None,
            );
            info!(
                adapter = "librespot",
                phase = "play-context",
                context_uri,
                start_track = uri_tail(start_track),
                generation,
                shuffle,
                upcoming = snapshot.queue.upcoming.len(),
                elapsed_ms = started.elapsed().as_millis(),
                "context play prepared"
            );
        }
        notify_playback(&self.shared).await;
    }

    async fn context_uris_for(&self, context_uri: &str) -> Vec<String> {
        let snapshot = self.shared.playback.read().await;
        if snapshot.context_uri.as_deref() == Some(context_uri) {
            snapshot.queue.context_uris.clone()
        } else {
            Vec::new()
        }
    }

    async fn seed_playlist_playback_cache(&self, context_uri: &str, catalog: &[MediaItem]) {
        if !context_uri.contains(":playlist:") || catalog.is_empty() {
            return;
        }
        let entries = self
            .shared
            .playlist_cache
            .seed_playback_entries(context_uri, catalog)
            .await;
        if entries > 0 {
            info!(
                adapter = "librespot",
                phase = "playlist-play-cache",
                outcome = "seeded",
                context_uri,
                entries,
                "playlist playback entries cached from play request"
            );
        }
    }

    async fn load_remote_play_entries(&self, context_uri: &str) -> Vec<crate::queue::DatedUri> {
        let Some(session) = self
            .shared
            .session
            .lock()
            .await
            .as_ref()
            .map(|active| active.session.clone())
        else {
            return Vec::new();
        };
        let started = Instant::now();
        match tokio::time::timeout(
            CONTEXT_RESOLVE_TIMEOUT,
            load_context_play_entries(&session, context_uri, &self.shared.playlist_cache),
        )
        .await
        {
            Ok(entries) => {
                info!(
                    adapter = "librespot",
                    phase = "queue-resolve",
                    context_uri,
                    entries = entries.len(),
                    dated = entries
                        .iter()
                        .filter(|entry| entry.added_at.is_some())
                        .count(),
                    elapsed_ms = started.elapsed().as_millis(),
                    "playlist entries resolved"
                );
                entries
            }
            Err(_) => {
                warn!(
                    adapter = "librespot",
                    phase = "queue-resolve",
                    context_uri,
                    elapsed_ms = started.elapsed().as_millis(),
                    "playlist context did not resolve in time"
                );
                Vec::new()
            }
        }
    }

    async fn seed_context_playback(
        &self,
        context_uri: &str,
        track_uri: Option<&str>,
        preloaded_uris: Option<Vec<String>>,
        generation: u64,
    ) {
        let started = Instant::now();
        if self.shared.session.lock().await.is_none() {
            return;
        }
        let locked = preloaded_uris.unwrap_or_default();
        let remote = self.load_remote_play_entries(context_uri).await;
        let uris = play_order(&[], &locked, &remote);
        if uris.is_empty() {
            warn!(
                adapter = "librespot",
                context_uri, "playlist context returned no playable tracks"
            );
            return;
        }
        let order = uris.len();
        let (current, already_named, shuffle, next) = {
            let mut snapshot = self.shared.playback.write().await;
            if snapshot.play_generation != generation
                || snapshot.context_uri.as_deref() != Some(context_uri)
            {
                info!(
                    adapter = "librespot",
                    phase = "queue-seed",
                    context_uri,
                    generation,
                    live_generation = snapshot.play_generation,
                    elapsed_ms = started.elapsed().as_millis(),
                    "queue seed skipped because playback moved on"
                );
                return;
            }
            let (current, already_named, shuffle) =
                apply_context_seed_queue(&mut snapshot, track_uri, uris);
            let next = snapshot
                .queue
                .upcoming
                .first()
                .map(|entry| entry.item.uri.clone());
            log_transition(
                &snapshot,
                "context-queue-seed",
                "resolved",
                current.as_deref(),
                None,
            );
            (current, already_named, shuffle, next)
        };
        info!(
            adapter = "librespot",
            phase = "queue-seed",
            context_uri,
            locked = locked.len(),
            remote = remote.len(),
            order,
            shuffle,
            next = next.as_deref().map(uri_tail),
            elapsed_ms = started.elapsed().as_millis(),
            "queue order seeded after play"
        );
        if let Some(current) = current.as_deref() {
            if !already_named {
                self.publish_loaded_item(current, Some(context_uri.to_string()), Some(generation))
                    .await;
            }
        } else if let Some(playing) = self
            .wait_for_playable_current(Duration::from_millis(1_200))
            .await
        {
            self.publish_loaded_item(&playing, Some(context_uri.to_string()), Some(generation))
                .await;
        }
        spawn_queue_hydrate(Arc::clone(&self.shared));
    }

    fn spawn_playlist_queue_expand(&self) {
        let shared = Arc::clone(&self.shared);
        tokio::spawn(async move {
            let context_uri = {
                let snapshot = shared.playback.read().await;
                let Some(context_uri) = snapshot.context_uri.clone() else {
                    return;
                };
                if !context_uri.contains(":playlist:") {
                    return;
                }
                context_uri
            };
            let session = shared
                .session
                .lock()
                .await
                .as_ref()
                .map(|active| active.session.clone());
            let Some(session) = session else {
                return;
            };
            let remote =
                load_context_play_entries(&session, &context_uri, &shared.playlist_cache).await;
            {
                let mut snapshot = shared.playback.write().await;
                if snapshot.context_uri.as_deref() != Some(context_uri.as_str()) {
                    return;
                }
                let shuffle = snapshot.shuffle_enabled;
                let current = snapshot
                    .current_item
                    .as_ref()
                    .map(|item| item.uri.clone())
                    .unwrap_or_default();
                let previous = snapshot.queue.context_uris.len();
                let uris = play_order(&[], &snapshot.queue.context_uris, &remote);
                if uris == snapshot.queue.context_uris {
                    return;
                }
                info!(
                    adapter = "librespot",
                    phase = "queue-expand",
                    context_uri = context_uri.as_str(),
                    previous,
                    remote = remote.len(),
                    order = uris.len(),
                    current = uri_tail(&current),
                    shuffle,
                    next = uris
                        .iter()
                        .find(|uri| !same_item_uri(uri, &current))
                        .map(String::as_str)
                        .map(uri_tail),
                    "queue expanded"
                );
                snapshot
                    .queue
                    .replace_upcoming_preserving(uris, current.as_str(), shuffle);
            }
            spawn_queue_hydrate(Arc::clone(&shared));
            notify_playback(&shared).await;
        });
    }
}
