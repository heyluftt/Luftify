use std::time::{Duration, Instant};

pub const MAX_MESSAGE_BYTES: usize = luft_listen_together::MAX_MESSAGE_BYTES;
pub const MAX_CONNECTIONS: usize = luft_listen_together::MAX_CONNECTIONS;
const RATE_WINDOW: Duration = Duration::from_secs(1);
const RATE_LIMIT: u32 = 40;

#[derive(Debug)]
pub struct RateLimit {
    window_start: Instant,
    count: u32,
}

impl RateLimit {
    #[must_use]
    pub fn new() -> Self {
        Self {
            window_start: Instant::now(),
            count: 0,
        }
    }

    pub fn allow(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_start) >= RATE_WINDOW {
            self.window_start = now;
            self.count = 0;
        }
        self.count += 1;
        self.count <= RATE_LIMIT
    }
}

#[derive(Debug)]
pub struct ConnectionBudget {
    active: usize,
}

impl ConnectionBudget {
    pub const fn new() -> Self {
        Self { active: 0 }
    }

    pub fn try_acquire(&mut self) -> bool {
        if self.active >= MAX_CONNECTIONS {
            return false;
        }
        self.active += 1;
        true
    }

    pub fn release(&mut self) {
        self.active = self.active.saturating_sub(1);
    }
}
