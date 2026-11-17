//! Presence with several devices of one profile. Each device reports on its
//! own; friends see one of them: among the devices that play, the one that
//! started playing last (a song change while playing does not count, so the
//! next song on the other device does not take over); without music, the
//! one heard from last. In memory only, like presence itself.
use std::{
    collections::HashMap,
    sync::atomic::{AtomicU64, Ordering},
};

use luft_listen_together::{
    server_now_ms,
    social::{FriendPresence, PRESENCE_TTL_MS},
};

use super::{Store, db::TimedPresence};

pub(super) struct DeviceReport {
    pub updated_at: i64,
    pub value: FriendPresence,
    /// Report order, so two reports in the same millisecond still have one.
    pub seq: u64,
    /// The report in which this device went from not playing to playing.
    pub playing_since: Option<u64>,
}

static SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// The device friends see, if any is fresh.
fn choose(reports: &HashMap<String, DeviceReport>) -> Option<(&String, &DeviceReport)> {
    let playing = reports
        .iter()
        .filter(|(_, report)| report.value.is_playing)
        .max_by_key(|(_, report)| report.playing_since.unwrap_or(0));
    playing.or_else(|| reports.iter().max_by_key(|(_, report)| report.seq))
}

impl Store {
    /// Takes a device's report and returns the device friends see now.
    pub(super) async fn report_device(&self, me: &str, device: &str, online: bool, value: FriendPresence) -> Option<String> {
        let now = server_now_ms();
        let mut all = self.device_presence.lock().await;
        let reports = all.entry(me.to_owned()).or_default();
        if online {
            let since = reports
                .get(device)
                .and_then(|previous| previous.playing_since.filter(|_| previous.value.is_playing));
            let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let playing_since = value.is_playing.then(|| since.unwrap_or(seq));
            reports.insert(device.to_owned(), DeviceReport { updated_at: now, value, seq, playing_since });
        } else {
            reports.remove(device);
        }
        reports.retain(|_, report| now - report.updated_at < PRESENCE_TTL_MS);
        let chosen = choose(reports).map(|(id, report)| (id.clone(), report.updated_at, report.value.clone()));
        if reports.is_empty() {
            all.remove(me);
        }
        drop(all);
        let mut presence = self.presence.lock().await;
        match &chosen {
            Some((_, updated_at, value)) => {
                presence.insert(me.to_owned(), TimedPresence { updated_at: *updated_at, value: value.clone() });
            }
            None => {
                presence.remove(me);
            }
        }
        chosen.map(|(id, ..)| id)
    }

    /// One device signed out (`Some`) or all of them (recovery, suspension).
    pub(super) async fn forget_device_presence(&self, me: &str, device: Option<&str>) {
        match device {
            Some(device) => {
                let mut all = self.device_presence.lock().await;
                let Some(reports) = all.get_mut(me) else { return };
                reports.remove(device);
                let chosen = choose(reports).map(|(id, report)| (id.clone(), report.updated_at, report.value.clone()));
                drop(all);
                let mut presence = self.presence.lock().await;
                match chosen {
                    Some((_, updated_at, value)) => {
                        presence.insert(me.to_owned(), TimedPresence { updated_at, value });
                    }
                    None => {
                        presence.remove(me);
                    }
                }
            }
            None => {
                self.device_presence.lock().await.remove(me);
                self.presence.lock().await.remove(me);
            }
        }
    }

    /// New options apply to every device's last report at once.
    pub(super) async fn hide_on_devices(&self, me: &str, hide_online: bool, hide_listening: bool) {
        let hide = |value: &mut FriendPresence| {
            if hide_online {
                value.online = false;
            }
            if hide_listening {
                value.track = None;
                value.is_playing = false;
                value.position_ms = None;
                value.position_at_ms = None;
            }
        };
        if let Some(reports) = self.device_presence.lock().await.get_mut(me) {
            reports.values_mut().for_each(|report| hide(&mut report.value));
        }
        if let Some(stored) = self.presence.lock().await.get_mut(me) {
            hide(&mut stored.value);
        }
    }

    /// The regular cleanup: stale devices go, the shown one is chosen again.
    pub(super) async fn prune_device_presence(&self, now: i64) {
        let mut all = self.device_presence.lock().await;
        let mut presence = self.presence.lock().await;
        all.retain(|profile, reports| {
            reports.retain(|_, report| now - report.updated_at < PRESENCE_TTL_MS);
            match choose(reports) {
                Some((_, report)) => {
                    presence.insert(profile.clone(), TimedPresence { updated_at: report.updated_at, value: report.value.clone() });
                }
                None => {
                    presence.remove(profile);
                }
            }
            !reports.is_empty()
        });
        presence.retain(|_, stored| now - stored.updated_at < PRESENCE_TTL_MS);
    }
}
