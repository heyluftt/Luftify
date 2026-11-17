//! Profile roles are assigned by the server only; clients merely display them.
use serde::{Deserialize, Serialize};

/// Ordered by rank: the first role of a profile is its main badge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SocialRole {
    /// The operator of Luftify. Set only through the server configuration.
    Luft,
    Dev,
    Heart,
    Crew,
    Tester,
    /// A role from a newer server. Never stored, never shown.
    #[serde(other)]
    Unknown,
}

pub const GRANTABLE_ROLES: [SocialRole; 4] =
    [SocialRole::Dev, SocialRole::Heart, SocialRole::Crew, SocialRole::Tester];

impl SocialRole {
    pub fn key(self) -> &'static str {
        match self {
            Self::Luft => "luft",
            Self::Dev => "dev",
            Self::Heart => "heart",
            Self::Crew => "crew",
            Self::Tester => "tester",
            Self::Unknown => "",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        [Self::Luft, Self::Dev, Self::Heart, Self::Crew, Self::Tester]
            .into_iter()
            .find(|role| role.key() == key)
    }

    pub fn grantable(self) -> bool {
        GRANTABLE_ROLES.contains(&self)
    }

    /// Luft manages roles and chooses a custom friend code.
    pub fn manages(self) -> bool {
        self == Self::Luft
    }

    /// Luft and developers see the server overview.
    pub fn sees_server(self) -> bool {
        matches!(self, Self::Luft | Self::Dev)
    }
}

/// Stored as a sorted comma list, e.g. `dev,tester`.
pub fn parse_roles(stored: &str) -> Vec<SocialRole> {
    let mut roles: Vec<_> = stored.split(',').filter_map(SocialRole::from_key).collect();
    roles.sort();
    roles.dedup();
    roles
}

pub fn store_roles(roles: &[SocialRole]) -> String {
    let mut roles: Vec<_> = roles.iter().copied().filter(|r| *r != SocialRole::Unknown).collect();
    roles.sort();
    roles.dedup();
    roles.iter().map(|role| role.key()).collect::<Vec<_>>().join(",")
}

/// `LUFT` or `lf-luft` → `LF-LUFT`. Custom codes use 3–10 letters or digits.
pub fn normalize_custom_code(input: &str) -> Option<String> {
    let upper = input.trim().to_ascii_uppercase();
    let body = upper.strip_prefix("LF-").unwrap_or(&upper);
    ((3..=10).contains(&body.len()) && body.bytes().all(|b| b.is_ascii_alphanumeric()))
        .then(|| format!("LF-{body}"))
}

/// Any code a profile can carry: generated (10 hex) or custom.
pub fn valid_friend_code(code: &str) -> bool {
    normalize_custom_code(code).is_some_and(|normalized| normalized == code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_round_trip_sorted_and_unknown_roles_are_dropped() {
        assert_eq!(parse_roles("tester,luft,nope,tester"), vec![SocialRole::Luft, SocialRole::Tester]);
        assert_eq!(store_roles(&[SocialRole::Tester, SocialRole::Heart, SocialRole::Unknown]), "heart,tester");
        assert!(parse_roles("").is_empty());
        let json: Vec<SocialRole> = serde_json::from_str(r#"["crew","future"]"#).unwrap();
        assert_eq!(json, vec![SocialRole::Crew, SocialRole::Unknown]);
        assert!(!SocialRole::Luft.grantable());
        assert!(SocialRole::Heart.grantable());
    }

    #[test]
    fn custom_codes_are_short_and_plain() {
        assert_eq!(normalize_custom_code(" luft ").as_deref(), Some("LF-LUFT"));
        assert_eq!(normalize_custom_code("LF-dev1").as_deref(), Some("LF-DEV1"));
        assert!(normalize_custom_code("LF").is_none());
        assert!(normalize_custom_code("LU FT").is_none());
        assert!(normalize_custom_code("ÄÖÜ").is_none());
        assert!(normalize_custom_code("ABCDEFGHIJK").is_none());
        assert!(valid_friend_code("LF-0A1B2C3D4E"));
        assert!(!valid_friend_code("lf-luft"));
    }
}
