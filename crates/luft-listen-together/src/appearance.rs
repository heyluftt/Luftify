//! How a profile looks to friends: accent colour, banner and a pinned song.
use serde::{Deserialize, Serialize};

use crate::TrackRef;

/// Same keys as the badge colours, so the app shares one palette.
pub const PROFILE_ACCENTS: [&str; 8] = ["sky", "violet", "rose", "amber", "mint", "coral", "gold", "slate"];
/// `cover` shows the profile song's cover; an empty banner keeps the standard look.
pub const PROFILE_BANNERS: [&str; 9] = ["aurora", "sunset", "ocean", "nebula", "mono", "cover", "midnight", "candy", "city"];
/// Avatar ring; empty keeps the role's ring. New keys only at the end:
/// older apps show unknown ones as no ring.
pub const PROFILE_FRAMES: [&str; 8] = ["", "accent", "glow", "none", "prism", "orbit", "aurum", "pulse"];
/// A calm animated layer over the banner; unknown keys show nothing in older apps.
pub const PROFILE_EFFECTS: [&str; 7] = ["", "stars", "sparkle", "waves", "veil", "lights", "petals"];
/// The emoji in front of the status line.
pub const PROFILE_EMOJIS: [&str; 24] = [
    "🎧", "🎶", "🔥", "✨", "💜", "💙", "🖤", "🌙", "☀️", "🌊", "🌸", "🍀",
    "☕", "🎮", "📚", "💤", "🚗", "🏋️", "🎉", "😎", "🥲", "🤍", "⚡", "🌈",
];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStyle {
    pub accent: String,
    pub banner: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub frame: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub effect: String,
    /// The name drawn in the accent colours.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub name_gradient: bool,
    /// The row of achievements under the bio; off keeps the profile calm.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub show_trophies: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    /// An own colour, `#rrggbb`. `accent` stays the nearest preset for older apps.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Where the name gradient runs to, `#rrggbb`; it starts at `name_from`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color: Option<String>,
    /// Where the name gradient starts, `#rrggbb`; without it the profile colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_from: Option<String>,
    /// A moving picture (media id); the still one remains `avatar_uri`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_media: Option<String>,
    /// An own banner (media id) over `banner`, which older apps show instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_media: Option<String>,
    /// The badges shown, in order: `role:<key>` or `badge:<id>`. The rest stay
    /// in the inventory; `None` shows everything, as older apps always do.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shown_badges: Option<Vec<String>>,
}

/// At most this many badges are shown at once; cards fit about three.
pub const MAX_SHOWN_BADGES: usize = 6;

/// `role:<known role>`, `quest:<achievement>` or `badge:<server id>`.
pub fn valid_badge_key(key: &str) -> bool {
    if let Some(role) = key.strip_prefix("role:") {
        return crate::SocialRole::from_key(role).is_some();
    }
    if let Some(quest) = key.strip_prefix("quest:") {
        return crate::achievements::known(quest);
    }
    key.strip_prefix("badge:").is_some_and(|id| {
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// `#rrggbb` in lowercase.
pub fn valid_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl ProfileStyle {
    pub fn valid(&self) -> bool {
        PROFILE_ACCENTS.contains(&self.accent.as_str())
            && (self.banner.is_empty() || PROFILE_BANNERS.contains(&self.banner.as_str()))
            && PROFILE_FRAMES.contains(&self.frame.as_str())
            && PROFILE_EFFECTS.contains(&self.effect.as_str())
            && self.emoji.as_deref().is_none_or(|emoji| PROFILE_EMOJIS.contains(&emoji))
            && self.color.as_deref().is_none_or(valid_hex_color)
            && self.name_color.as_deref().is_none_or(valid_hex_color)
            && self.name_from.as_deref().is_none_or(valid_hex_color)
            && self.avatar_media.as_deref().is_none_or(|id| crate::media::media_extension(id).is_some_and(|ext| crate::media::MediaKind::Avatar.allows(ext)))
            && self.banner_media.as_deref().is_none_or(|id| crate::media::media_extension(id).is_some_and(|ext| crate::media::MediaKind::Banner.allows(ext)))
            && self.shown_badges.as_ref().is_none_or(|keys| {
                keys.len() <= MAX_SHOWN_BADGES
                    && keys.iter().all(|key| valid_badge_key(key))
                    && keys.iter().enumerate().all(|(index, key)| !keys[..index].contains(key))
            })
    }

    /// The owned roles and badges this look shows, in its order; all of them without a choice.
    pub fn visible_badges(&self, roles: &[crate::SocialRole], badges: &[String]) -> (Vec<crate::SocialRole>, Vec<String>) {
        let Some(keys) = &self.shown_badges else { return (roles.to_vec(), badges.to_vec()) };
        let roles = keys.iter()
            .filter_map(|key| key.strip_prefix("role:").and_then(crate::SocialRole::from_key))
            .filter(|role| roles.contains(role))
            .collect();
        let badges = keys.iter()
            .filter_map(|key| key.strip_prefix("badge:"))
            .filter(|id| badges.iter().any(|owned| owned == id))
            .map(str::to_owned)
            .collect();
        (roles, badges)
    }

    /// The media ids this look refers to.
    pub fn media(&self) -> impl Iterator<Item = (&str, crate::media::MediaKind)> {
        self.avatar_media.as_deref().map(|id| (id, crate::media::MediaKind::Avatar)).into_iter()
            .chain(self.banner_media.as_deref().map(|id| (id, crate::media::MediaKind::Banner)))
    }
}

/// A playable Spotify track with its display data, or nothing.
pub fn clean_favorite(track: Option<TrackRef>) -> Result<Option<TrackRef>, ()> {
    let Some(track) = track else { return Ok(None) };
    let track = track.sanitize().ok_or(())?;
    let id = track.uri.strip_prefix("spotify:track:").ok_or(())?;
    if track.provider != "spotify" || id.len() != 22 || !id.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(());
    }
    Ok(Some(TrackRef { context_uri: None, ..track }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn styles_use_known_keys_and_favorites_are_spotify_tracks() {
        let style = |accent: &str, banner: &str| ProfileStyle { accent: accent.into(), banner: banner.into(), ..Default::default() };
        assert!(style("rose", "cover").valid());
        assert!(!style("neon", "aurora").valid());
        assert!(!style("rose", "video").valid());
        assert!(style("rose", "").valid());
        assert!(style("rose", "midnight").valid() && style("violet", "candy").valid());
        let full = ProfileStyle { frame: "glow".into(), effect: "stars".into(), name_gradient: true, emoji: Some("🎧".into()), ..style("mint", "ocean") };
        assert!(full.valid());
        assert!(!ProfileStyle { effect: "fire".into(), ..full.clone() }.valid());
        assert!(ProfileStyle { frame: "orbit".into(), effect: "lights".into(), ..full.clone() }.valid());
        assert!(ProfileStyle { frame: "prism".into(), effect: "veil".into(), ..full.clone() }.valid());
        assert!(!ProfileStyle { emoji: Some("💩".into()), ..full.clone() }.valid());
        let own = ProfileStyle { color: Some("#ff8800".into()), name_color: Some("#00aaff".into()), name_from: Some("#ff4ecd".into()),
            avatar_media: Some("0123456789abcdef0123456789abcdef.webm".into()),
            banner_media: Some("0123456789abcdef0123456789abcdef.jpg".into()), ..full.clone() };
        assert!(own.valid());
        assert_eq!(own.media().count(), 2);
        assert!(!ProfileStyle { color: Some("red".into()), ..full.clone() }.valid());
        assert!(!ProfileStyle { name_from: Some("pink".into()), ..full.clone() }.valid());
        assert!(!ProfileStyle { color: Some("#FF8800".into()), ..full.clone() }.valid());
        // A still JPEG is no moving picture.
        assert!(!ProfileStyle { avatar_media: Some("0123456789abcdef0123456789abcdef.jpg".into()), ..full.clone() }.valid());
        // A badge selection: known keys only, no repeats, at most six.
        let shown = |keys: &[&str]| ProfileStyle { shown_badges: Some(keys.iter().map(|key| key.to_string()).collect()), ..full.clone() };
        assert!(shown(&["role:tester", "badge:0b1f8f3e-6a5e"]).valid());
        assert!(shown(&[]).valid());
        assert!(!shown(&["role:king"]).valid() && !shown(&["badge:../x"]).valid() && !shown(&["star"]).valid());
        assert!(!shown(&["role:dev", "role:dev"]).valid());
        assert!(!shown(&["badge:a", "badge:b", "badge:c", "badge:d", "badge:e", "badge:f", "badge:g"]).valid());
        let (roles, badges) = shown(&["badge:b2", "role:tester", "badge:gone"])
            .visible_badges(&[crate::SocialRole::Tester, crate::SocialRole::Dev], &["b1".into(), "b2".into()]);
        assert_eq!((roles, badges), (vec![crate::SocialRole::Tester], vec!["b2".to_string()]));
        // Older looks without the new fields read as before.
        let old: ProfileStyle = serde_json::from_str(r#"{"accent":"rose","banner":"ocean"}"#).unwrap();
        assert!(old.valid() && old.color.is_none());
        let good = TrackRef::new("spotify", "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp").unwrap();
        assert_eq!(clean_favorite(Some(good.clone())).unwrap().unwrap().uri, good.uri);
        assert!(clean_favorite(Some(TrackRef::new("spotify", "spotify:episode:x").unwrap())).is_err());
        assert_eq!(clean_favorite(None), Ok(None));
    }
}
