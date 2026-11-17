//! Recovery code: brings a friends profile to a new device. The server keeps
//! only a hash; the code is shown to its owner and never logged.
use rand::Rng;
use serde::{Deserialize, Serialize};

/// 20 characters of 5 bits each: 100 bits, far beyond guessing.
pub const RECOVERY_CODE_LEN: usize = 20;
// The join code alphabet: no 0/O or 1/I to mix up when writing it down.
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCode {
    // Secret: never include in diagnostics or logs.
    pub code: String,
}

/// A new code in groups of four, e.g. `ABCD-EFGH-JKLM-NPQR-STUV`.
#[must_use]
pub fn generate_recovery_code() -> String {
    let mut rng = rand::rng();
    let plain: String = (0..RECOVERY_CODE_LEN)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect();
    format_recovery_code(&plain)
}

/// Accepts what people type: any case, spaces or dashes, O for 0 and I/L for 1
/// are not in the alphabet and so simply fail.
#[must_use]
pub fn normalize_recovery_code(code: &str) -> Option<String> {
    if code.len() > 64 {
        return None;
    }
    let plain: String = code
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '-')
        .map(|ch| ch.to_ascii_uppercase())
        .collect();
    (plain.len() == RECOVERY_CODE_LEN && plain.bytes().all(|byte| ALPHABET.contains(&byte)))
        .then(|| format_recovery_code(&plain))
}

fn format_recovery_code(plain: &str) -> String {
    plain
        .as_bytes()
        .chunks(4)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip_through_what_people_type() {
        let code = generate_recovery_code();
        assert_eq!(code.len(), RECOVERY_CODE_LEN + 4);
        assert_eq!(normalize_recovery_code(&code).as_deref(), Some(code.as_str()));
        let typed = code.to_lowercase().replace('-', " ");
        assert_eq!(normalize_recovery_code(&typed).as_deref(), Some(code.as_str()));
        assert!(normalize_recovery_code("ABCD-EFGH").is_none());
        assert!(normalize_recovery_code("ABCD-EFGH-JKLM-NPQR-STU0").is_none());
        assert_ne!(generate_recovery_code(), code);
    }
}
