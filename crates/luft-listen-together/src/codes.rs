use rand::Rng;

pub const JOIN_CODE_LEN: usize = 6;
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[must_use]
pub fn generate_join_code() -> String {
    let mut rng = rand::rng();
    (0..JOIN_CODE_LEN)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect()
}

#[must_use]
pub fn normalize_join_code(code: &str) -> Option<String> {
    let code = code
        .chars()
        .filter(|ch| !ch.is_whitespace() && *ch != '-')
        .map(|ch| ch.to_ascii_uppercase())
        .collect::<String>();
    (code.len() == JOIN_CODE_LEN && code.bytes().all(|byte| ALPHABET.contains(&byte)))
        .then_some(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_codes_match_the_alphabet() {
        let code = generate_join_code();
        assert_eq!(code.len(), JOIN_CODE_LEN);
        assert!(code.bytes().all(|byte| ALPHABET.contains(&byte)));
    }

    #[test]
    fn join_codes_ignore_spacing_and_ambiguous_glyphs() {
        assert_eq!(normalize_join_code("ab-cd ef").as_deref(), Some("ABCDEF"));
        assert!(normalize_join_code("short").is_none());
        assert!(normalize_join_code("00O111").is_none());
    }
}
