//! Achievements: small goals around friends, the profile and listening
//! together. The server decides when one is reached; each gives a badge for
//! the badge inventory (`quest:<id>`), the collector also the frame "aurum".
use serde::{Deserialize, Serialize};

/// In display order. New ones only at the end; ids never change.
pub const ACHIEVEMENTS: [&str; 8] = ["first_friend", "circle", "styled", "song", "together", "along", "host", "collector"];
/// Friends for "circle", and other achievements for "collector".
pub const CIRCLE_GOAL: u32 = 5;
pub const COLLECTOR_GOAL: u32 = 5;
/// The frame only collectors may wear.
pub const REWARD_FRAME: &str = "aurum";

/// One achievement as its owner sees it: reached when, and how far along.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementState {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unlocked_at_ms: Option<i64>,
    pub progress: u32,
    pub goal: u32,
}

pub fn known(id: &str) -> bool {
    ACHIEVEMENTS.contains(&id)
}

/// Stored as `id:ms` pairs, comma separated; unknown or broken entries are dropped.
pub fn parse_unlocked(stored: &str) -> Vec<(String, i64)> {
    stored
        .split(',')
        .filter_map(|entry| {
            let (id, at) = entry.split_once(':')?;
            Some((id.to_owned(), at.parse().ok()?)).filter(|(id, _)| known(id))
        })
        .collect()
}

pub fn store_unlocked(unlocked: &[(String, i64)]) -> String {
    unlocked.iter().map(|(id, at)| format!("{id}:{at}")).collect::<Vec<_>>().join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unlocked_achievements_round_trip_and_ignore_unknown_ones() {
        let stored = store_unlocked(&[("first_friend".into(), 10), ("along".into(), 20)]);
        assert_eq!(stored, "first_friend:10,along:20");
        assert_eq!(parse_unlocked(&format!("{stored},dragon:5,broken")), vec![("first_friend".into(), 10), ("along".into(), 20)]);
        assert!(parse_unlocked("").is_empty());
    }
}
