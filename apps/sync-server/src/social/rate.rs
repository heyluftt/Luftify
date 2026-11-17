use std::{
    collections::HashMap,
    net::IpAddr,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

/// Bounded per-connection-IP budget; request contents and credentials are never retained.
#[derive(Default)]
pub struct RateBudgets(Mutex<HashMap<IpAddr, Window>>);

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Budget {
    Request,
    Registration,
    /// Restoring with a recovery code: the strictest, against guessing.
    Restore,
}

struct Window {
    started: Instant,
    requests: u32,
    registrations: u32,
    restores: u32,
}

impl RateBudgets {
    pub async fn allow(&self, address: IpAddr, kind: Budget) -> bool {
        let now = Instant::now();
        let mut windows = self.0.lock().await;
        windows.retain(|_, entry| now.duration_since(entry.started) < Duration::from_secs(60));
        if windows.len() >= 4096 && !windows.contains_key(&address) {
            return false;
        }
        let entry = windows.entry(address).or_insert(Window {
            started: now,
            requests: 0,
            registrations: 0,
            restores: 0,
        });
        entry.requests = entry.requests.saturating_add(1);
        match kind {
            Budget::Request => {}
            Budget::Registration => entry.registrations = entry.registrations.saturating_add(1),
            Budget::Restore => entry.restores = entry.restores.saturating_add(1),
        }
        entry.requests <= 1000
            && (kind != Budget::Registration || entry.registrations <= 10)
            && (kind != Budget::Restore || entry.restores <= 5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn registrations_and_restores_have_separate_bounds() {
        let budget = RateBudgets::default();
        let address = "127.0.0.1".parse().unwrap();
        for _ in 0..10 {
            assert!(budget.allow(address, Budget::Registration).await);
        }
        assert!(!budget.allow(address, Budget::Registration).await);
        assert!(budget.allow(address, Budget::Request).await);
        for _ in 0..5 {
            assert!(budget.allow(address, Budget::Restore).await);
        }
        assert!(!budget.allow(address, Budget::Restore).await);
        assert!(budget.allow("127.0.0.2".parse().unwrap(), Budget::Registration).await);
    }
}
