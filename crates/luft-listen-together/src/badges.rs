//! Badges Luft creates on the server, in addition to the fixed roles. Profiles
//! carry badge ids; every snapshot carries the server's badge catalog.
use serde::{Deserialize, Serialize};

pub const BADGE_ICONS: [&str; 16] = [
    "star", "heart", "music", "headphones", "crown", "flame", "zap", "moon", "sun", "sparkles",
    "gamepad", "coffee", "gem", "rocket", "flower", "ghost",
];
pub const BADGE_COLORS: [&str; 8] = ["sky", "violet", "rose", "amber", "mint", "coral", "gold", "slate"];
pub const MAX_BADGES: usize = 24;
pub const MAX_BADGES_PER_PROFILE: usize = 6;
pub const MAX_BADGE_LABEL: usize = 20;
pub const MAX_BIO: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeDefinition {
    /// Empty when creating; the server assigns it.
    #[serde(default)]
    pub id: String,
    pub label: String,
    pub icon: String,
    pub color: String,
}

impl BadgeDefinition {
    pub fn validate(&mut self) -> bool {
        self.label = self.label.trim().to_owned();
        (1..=MAX_BADGE_LABEL).contains(&self.label.chars().count())
            && !self.label.chars().any(char::is_control)
            && BADGE_ICONS.contains(&self.icon.as_str())
            && BADGE_COLORS.contains(&self.color.as_str())
    }
}

/// A short status line on a profile; `None` clears it.
pub fn clean_bio(bio: Option<String>) -> Result<Option<String>, ()> {
    let Some(bio) = bio else { return Ok(None) };
    let bio = bio.trim().to_owned();
    if bio.is_empty() {
        return Ok(None);
    }
    if bio.chars().count() > MAX_BIO || bio.chars().any(char::is_control) {
        return Err(());
    }
    Ok(Some(bio))
}

/// Stored as a comma list of ids, in the order they were given.
pub fn parse_badge_ids(stored: &str) -> Vec<String> {
    stored.split(',').filter(|id| !id.is_empty()).map(str::to_owned).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badges_use_known_icons_and_colours_and_bios_stay_short() {
        let mut badge = BadgeDefinition { id: String::new(), label: "  DJ  ".into(), icon: "music".into(), color: "gold".into() };
        assert!(badge.validate());
        assert_eq!(badge.label, "DJ");
        badge.icon = "skull".into();
        assert!(!badge.validate());
        badge.icon = "music".into();
        badge.label = "x".repeat(MAX_BADGE_LABEL + 1);
        assert!(!badge.validate());
        assert_eq!(clean_bio(Some("  ".into())), Ok(None));
        assert_eq!(clean_bio(Some(" Hört gerade viel Jazz ".into())), Ok(Some("Hört gerade viel Jazz".into())));
        assert!(clean_bio(Some("a\nb".into())).is_err());
        assert_eq!(parse_badge_ids("a,,b"), ["a", "b"]);
    }
}
