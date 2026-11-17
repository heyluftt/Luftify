use super::*;
use librespot::playback::mixer::{Mixer, VolumeGetter};
use std::sync::Mutex as SyncMutex;

struct VolumeState {
    reported: u16,
    desired: u16,
    pending: bool,
    in_flight: Option<u16>,
}

/// Audio gain changes locally; Connect receives at most one outstanding update.
pub(super) struct LocalVolume {
    inner: Arc<dyn Mixer>,
    state: SyncMutex<VolumeState>,
    changed: watch::Sender<()>,
}

impl LocalVolume {
    pub(super) fn new(inner: Arc<dyn Mixer>) -> Self {
        let volume = inner.volume();
        let (changed, _) = watch::channel(());
        Self {
            inner,
            state: SyncMutex::new(VolumeState {
                reported: volume,
                desired: volume,
                pending: false,
                in_flight: None,
            }),
            changed,
        }
    }

    pub(super) fn request(&self, volume: u16) {
        let mut state = self.state.lock().unwrap();
        state.desired = volume;
        state.pending = state.in_flight.is_some() || state.reported != volume;
        self.inner.set_volume(volume);
        drop(state);
        self.changed.send_replace(());
    }

    pub(super) fn audible_volume(&self) -> u16 {
        self.inner.volume()
    }

    fn take_sync_target(&self) -> Option<u16> {
        let mut state = self.state.lock().unwrap();
        if !state.pending || state.in_flight.is_some() {
            return None;
        }
        let target = state.desired;
        state.in_flight = Some(target);
        Some(target)
    }
}

impl Mixer for LocalVolume {
    fn open(config: MixerConfig) -> Result<Self, librespot::core::Error> {
        Ok(Self::new(Arc::new(mixer::softmixer::SoftMixer::open(
            config,
        )?)))
    }

    // Connect compares against its last applied value, not the local preview.
    // Otherwise it could skip the final acknowledgement as an apparent no-op.
    fn volume(&self) -> u16 {
        self.state.lock().unwrap().reported
    }

    fn set_volume(&self, volume: u16) {
        let mut state = self.state.lock().unwrap();
        state.reported = volume;
        if state.in_flight == Some(volume) {
            state.in_flight = None;
            state.pending = state.desired != volume;
        }
        if !state.pending {
            state.desired = volume;
        }
        self.inner.set_volume(state.desired);
        drop(state);
        self.changed.send_replace(());
    }

    fn get_soft_volume(&self) -> Box<dyn VolumeGetter + Send> {
        self.inner.get_soft_volume()
    }
}

pub(super) fn spawn_volume_sync(
    shared: Arc<Shared>,
    mixer: Arc<LocalVolume>,
    epoch: u64,
) -> tokio::task::JoinHandle<()> {
    let mut changed = mixer.changed.subscribe();
    tokio::spawn(async move {
        loop {
            if shared.session_epoch.load(Ordering::SeqCst) != epoch {
                break;
            }
            if let Some(target) = mixer.take_sync_target() {
                let session = shared.session.lock().await;
                if shared.session_epoch.load(Ordering::SeqCst) != epoch {
                    break;
                }
                let Some(active) = session.as_ref() else {
                    break;
                };
                if let Err(error) = active.spirc.set_volume(target) {
                    warn!(%error, adapter = "librespot", "local volume applied but Connect sync stopped");
                    break;
                }
            }
            if changed.changed().await.is_err() {
                break;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mixer() -> LocalVolume {
        LocalVolume::open(MixerConfig::default()).unwrap()
    }

    #[test]
    fn local_volume_coalesces_while_connect_is_stalled() {
        let mixer = mixer();
        mixer.set_volume(10_000);
        mixer.request(20_000);
        assert_eq!(mixer.take_sync_target(), Some(20_000));
        mixer.request(30_000);
        mixer.request(40_000);
        assert_eq!(mixer.audible_volume(), 40_000);
        assert_eq!(mixer.take_sync_target(), None);
        mixer.set_volume(20_000); // Delayed response must not lower audible gain.
        assert_eq!(mixer.audible_volume(), 40_000);
        assert_eq!(mixer.take_sync_target(), Some(40_000));
        mixer.set_volume(40_000);
        assert_eq!(mixer.take_sync_target(), None);
        mixer.set_volume(15_000); // Remote changes still work after local delivery.
        assert_eq!(mixer.audible_volume(), 15_000);
    }

    #[test]
    fn local_volume_mute_and_return_to_original_survive_old_ack() {
        let mixer = mixer();
        mixer.set_volume(10_000);
        mixer.request(20_000);
        assert_eq!(mixer.take_sync_target(), Some(20_000));
        mixer.request(0);
        assert_eq!(mixer.audible_volume(), 0);
        mixer.request(10_000);
        mixer.set_volume(20_000);
        assert_eq!(mixer.audible_volume(), 10_000);
        assert_eq!(mixer.take_sync_target(), Some(10_000));
        mixer.set_volume(10_000);
        mixer.request(10_000);
        assert_eq!(mixer.take_sync_target(), None);
    }
}
