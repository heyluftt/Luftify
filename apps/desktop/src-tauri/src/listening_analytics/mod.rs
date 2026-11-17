mod persistence;
mod tracker;

use std::{
    process,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use chrono::Utc;
use luft_infrastructure::DatabaseHandle;
use serde_json::Value;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};

use persistence::{clear_database, persist};
use tracker::ListeningTracker;

const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct ListeningAnalyticsService {
    tx: mpsc::Sender<AnalyticsMessage>,
    enabled: Arc<AtomicBool>,
}

enum AnalyticsMessage {
    PlaybackEvent {
        name: String,
        payload: Value,
    },
    SetEnabled {
        enabled: bool,
        completion: oneshot::Sender<Result<(), String>>,
    },
    Clear {
        completion: oneshot::Sender<Result<(), String>>,
    },
    Shutdown {
        completion: oneshot::Sender<()>,
    },
}

impl ListeningAnalyticsService {
    #[must_use]
    pub fn start(app: AppHandle, database: DatabaseHandle) -> Self {
        let (tx, receiver) = mpsc::channel(256);
        let enabled = Arc::new(AtomicBool::new(false));
        let prefix = format!("{}-{}", Utc::now().timestamp_millis(), process::id());
        tauri::async_runtime::spawn(run_actor(
            app,
            database,
            receiver,
            ListeningTracker::new(prefix, false),
        ));
        Self { tx, enabled }
    }

    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    /// A playback observation from the engine (`player.trackChanged` or `player.playbackChanged`).
    pub async fn playback_event(&self, name: &str, payload: &Value) {
        let _ = self
            .tx
            .send(AnalyticsMessage::PlaybackEvent {
                name: name.to_owned(),
                payload: payload.clone(),
            })
            .await;
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.enabled.store(enabled, Ordering::Release);
        let (completion, receiver) = oneshot::channel();
        let result = async {
            self.tx
                .send(AnalyticsMessage::SetEnabled {
                    enabled,
                    completion,
                })
                .await
                .map_err(|_| "listening analytics service is unavailable".to_owned())?;
            receiver
                .await
                .map_err(|_| "listening analytics service stopped unexpectedly".to_owned())?
        }
        .await;
        if result.is_err() {
            self.enabled.store(false, Ordering::Release);
        }
        result
    }

    pub async fn clear(&self) -> Result<(), String> {
        let (completion, receiver) = oneshot::channel();
        self.tx
            .send(AnalyticsMessage::Clear { completion })
            .await
            .map_err(|_| "listening analytics service is unavailable".to_owned())?;
        receiver
            .await
            .map_err(|_| "listening analytics service stopped unexpectedly".to_owned())?
    }

    pub async fn shutdown(&self) {
        let (completion, receiver) = oneshot::channel();
        if self
            .tx
            .send(AnalyticsMessage::Shutdown { completion })
            .await
            .is_ok()
        {
            let _ = receiver.await;
        }
    }
}

async fn run_actor(
    app: AppHandle,
    database: DatabaseHandle,
    mut receiver: mpsc::Receiver<AnalyticsMessage>,
    mut tracker: ListeningTracker,
) {
    let mut last_persisted = None;
    let mut checkpoint = tokio::time::interval(CHECKPOINT_INTERVAL);
    checkpoint.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = checkpoint.tick() => {
                if let Some(session) = tracker.checkpoint(std::time::Instant::now()) {
                    persist(&app, &database, session, &mut last_persisted).await;
                }
            }
            message = receiver.recv() => {
                let Some(message) = message else {
                    if let Some(session) = tracker.shutdown(std::time::Instant::now(), now_ms()) {
                        persist(&app, &database, session, &mut last_persisted).await;
                    }
                    break;
                };
                match message {
                    AnalyticsMessage::PlaybackEvent { name, payload } => {
                        for session in tracker.on_message(
                            &name,
                            &payload,
                            std::time::Instant::now(),
                            now_ms(),
                        ) {
                            persist(&app, &database, session, &mut last_persisted).await;
                        }
                    }
                    AnalyticsMessage::SetEnabled { enabled, completion } => {
                        if let Some(session) = tracker.set_enabled(
                            enabled,
                            std::time::Instant::now(),
                            now_ms(),
                        ) {
                            persist(&app, &database, session, &mut last_persisted).await;
                        }
                        let _ = completion.send(Ok(()));
                    }
                    AnalyticsMessage::Clear { completion } => {
                        tracker.clear();
                        last_persisted = None;
                        let result = clear_database(&app, &database).await;
                        let _ = completion.send(result);
                    }
                    AnalyticsMessage::Shutdown { completion } => {
                        if let Some(session) = tracker.shutdown(std::time::Instant::now(), now_ms()) {
                            persist(&app, &database, session, &mut last_persisted).await;
                        }
                        let _ = completion.send(());
                        break;
                    }
                }
            }
        }
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}
