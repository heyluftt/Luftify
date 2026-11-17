/// Ignore engine jitter and local clock grain.
pub const DRIFT_IGNORE_MS: i64 = 250;
/// Seek once the gap is large enough to hear.
pub const DRIFT_SEEK_MS: i64 = 1_500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriftAction {
    Ignore,
    Seek,
}

#[must_use]
pub fn classify_drift(drift_ms: i64) -> DriftAction {
    if drift_ms.abs() < DRIFT_IGNORE_MS {
        DriftAction::Ignore
    } else {
        DriftAction::Seek
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_gaps_are_left_alone() {
        assert_eq!(classify_drift(80), DriftAction::Ignore);
        assert_eq!(classify_drift(-240), DriftAction::Ignore);
    }

    #[test]
    fn audible_gaps_seek() {
        assert_eq!(classify_drift(250), DriftAction::Seek);
        assert_eq!(classify_drift(-2_000), DriftAction::Seek);
    }
}
