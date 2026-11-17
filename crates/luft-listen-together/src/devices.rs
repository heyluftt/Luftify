//! More devices for one friends profile: the first device shows a short
//! link code, another device redeems it once within a few minutes and gets
//! its own token. Both stay signed in; each can be removed on its own.
use rand::Rng;
use serde::{Deserialize, Serialize};

/// Eight characters of 5 bits: guessing within the short lifetime is out of
/// reach with the redeem rate limit.
pub const LINK_CODE_LEN: usize = 8;
pub const LINK_CODE_TTL_MS: i64 = 10 * 60_000;
/// Devices besides the first one.
pub const MAX_LINKED_DEVICES: usize = 5;
pub const MAX_DEVICE_LABEL: usize = 32;
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLink {
    // Secret while it is valid: never log it.
    pub code: String,
    pub expires_at_ms: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRedeem {
    pub code: String,
    /// What the device is called in the list, e.g. "Pixel 8".
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedDevice {
    /// Not the token: a short public handle derived from it.
    pub id: String,
    pub label: String,
    pub created_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<i64>,
    /// The device asking.
    #[serde(default)]
    pub current: bool,
}

/// A new code, e.g. `ABCD-EFGH`.
#[must_use]
pub fn generate_link_code() -> String {
    let mut rng = rand::rng();
    let plain: String = (0..LINK_CODE_LEN)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect();
    format!("{}-{}", &plain[..4], &plain[4..])
}

/// Any case, with or without the dash or spaces.
#[must_use]
pub fn normalize_link_code(code: &str) -> Option<String> {
    if code.len() > 24 {
        return None;
    }
    let plain: String = code
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '-')
        .map(|ch| ch.to_ascii_uppercase())
        .collect();
    (plain.len() == LINK_CODE_LEN && plain.bytes().all(|byte| ALPHABET.contains(&byte)))
        .then(|| format!("{}-{}", &plain[..4], &plain[4..]))
}

/// A short readable name, or none.
#[must_use]
pub fn clean_device_label(label: &str) -> Option<String> {
    let label = label.trim();
    (!label.is_empty() && label.chars().count() <= MAX_DEVICE_LABEL && !label.chars().any(char::is_control))
        .then(|| label.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_codes_survive_typing_and_labels_stay_short() {
        let code = generate_link_code();
        assert_eq!(code.len(), LINK_CODE_LEN + 1);
        assert_eq!(normalize_link_code(&code.to_lowercase().replace('-', " ")).as_deref(), Some(code.as_str()));
        assert!(normalize_link_code("ABCD-EFG0").is_none());
        assert!(normalize_link_code("ABCD").is_none());
        assert_eq!(clean_device_label("  Pixel 8 ").as_deref(), Some("Pixel 8"));
        assert!(clean_device_label("").is_none());
        assert!(clean_device_label("a\nb").is_none());
        assert!(clean_device_label(&"x".repeat(33)).is_none());
    }
}
