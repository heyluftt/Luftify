use std::time::{SystemTime, UNIX_EPOCH};

#[must_use]
pub fn server_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// NTP-style offset: server_now ≈ local_now + offset.
#[must_use]
pub fn clock_offset_ms(ping_sent_ms: i64, pong_server_ms: i64, pong_received_ms: i64) -> i64 {
    let rtt = pong_received_ms.saturating_sub(ping_sent_ms);
    pong_server_ms.saturating_sub(ping_sent_ms.saturating_add(rtt / 2))
}

#[must_use]
pub fn expected_position_ms(
    position_ms: u64,
    is_playing: bool,
    state_server_ms: i64,
    now_server_ms: i64,
    duration_ms: Option<u64>,
) -> u64 {
    if !is_playing {
        return position_ms;
    }
    let elapsed = now_server_ms.saturating_sub(state_server_ms).max(0) as u64;
    let next = position_ms.saturating_add(elapsed);
    match duration_ms.filter(|duration| *duration > 0) {
        Some(duration) => next.min(duration),
        None => next,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paused_state_keeps_the_stored_position() {
        assert_eq!(
            expected_position_ms(12_000, false, 1_000, 1_400, Some(180_000)),
            12_000
        );
    }

    #[test]
    fn playing_state_adds_elapsed_server_time() {
        assert_eq!(
            expected_position_ms(10_000, true, 1_000, 1_400, Some(180_000)),
            10_400
        );
    }

    #[test]
    fn clock_offset_uses_half_the_round_trip() {
        // ping at 1000, server 1500, reply at 1100 → RTT 100, offset 450
        assert_eq!(clock_offset_ms(1_000, 1_500, 1_100), 450);
    }
}
