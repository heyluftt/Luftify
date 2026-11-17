use serde_json::Value;

const SENSITIVE_MARKERS: &[&str] = &[
    "pairingkey",
    "access_token",
    "refresh_token",
    "authorization",
    "cookie",
    "password",
    "client_secret",
    "bearer ",
];
const REDACTED: &str = "[REDACTED]";
/// Query parameters that name the device or what the user searched for.
const PRIVATE_PARAMS: &[&str] = &["device_id", "client_id", "q", "query", "searchTerm"];

/// Remove the entire free-form value: truncating a byte offset from a
/// lowercased Unicode string is unsafe and can retain an earlier secret.
pub(super) fn sanitize_text(text: &str) -> String {
    let lower = text.to_lowercase();
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
    {
        REDACTED.to_owned()
    } else {
        text.to_owned()
    }
}

/// Masks what identifies the person in otherwise useful text: the Spotify
/// username, the Windows profile path, device ids, search terms and the
/// Spotify ids that would spell out the listening history.
pub(super) struct Redactor {
    replacements: Vec<(String, &'static str)>,
}

impl Redactor {
    pub(super) fn new(username: Option<&str>) -> Self {
        let mut replacements = Vec::new();
        if let Some(username) = username.map(str::trim).filter(|name| name.len() >= 3) {
            replacements.push((username.to_owned(), "<user>"));
        }
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()
            .filter(|home| home.len() > 3);
        if let Some(home) = home {
            replacements.push((home.replace('\\', "\\\\"), "~"));
            replacements.push((home.replace('\\', "/"), "~"));
            replacements.push((home, "~"));
        }
        Self { replacements }
    }

    pub(super) fn text(&self, text: &str) -> String {
        let mut text = sanitize_text(text);
        if text == REDACTED {
            return text;
        }
        for (secret, mask) in &self.replacements {
            text = text.replace(secret.as_str(), mask);
        }
        for param in PRIVATE_PARAMS {
            text = mask_param(&text, param);
        }
        // librespot writes `spotify:track:<id>`; keep one pair of brackets.
        mask_ids(&text).replace("<<id>>", "<id>")
    }

    pub(super) fn report(&self, value: &mut Value) {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields {
                    let key = key.to_ascii_lowercase();
                    if key == "username" || SENSITIVE_MARKERS.iter().any(|marker| key.contains(marker))
                    {
                        *value = Value::String(REDACTED.to_owned());
                    } else {
                        self.report(value);
                    }
                }
            }
            Value::Array(values) => values.iter_mut().for_each(|value| self.report(value)),
            Value::String(text) => *text = self.text(text),
            _ => {}
        }
    }
}

/// `name=value` after `?`, `&` or a space becomes `name=<redacted>`.
fn mask_param(text: &str, name: &str) -> String {
    let needle = format!("{name}=");
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(&needle) {
        let boundary = rest[..at]
            .chars()
            .next_back()
            .is_some_and(|before| matches!(before, '?' | '&' | ' '));
        let value_start = at + needle.len();
        out.push_str(&rest[..value_start]);
        rest = &rest[value_start..];
        if !boundary {
            continue;
        }
        let end = rest
            .find(|character: char| matches!(character, '&' | '"' | '\'' | ' ' | '}' | ')' | ','))
            .unwrap_or(rest.len());
        if end > 0 {
            out.push_str("<redacted>");
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// Spotify ids (22 base62 characters) and 32-digit hex ids become `<id>`.
fn mask_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut token = String::new();
    let flush = |token: &mut String, out: &mut String| {
        if is_opaque_id(token) {
            out.push_str("<id>");
        } else {
            out.push_str(token);
        }
        token.clear();
    };
    for character in text.chars() {
        if character.is_ascii_alphanumeric() {
            token.push(character);
        } else {
            flush(&mut token, &mut out);
            out.push(character);
        }
    }
    flush(&mut token, &mut out);
    out
}

fn is_opaque_id(token: &str) -> bool {
    let has_digit = token.chars().any(|character| character.is_ascii_digit());
    match token.len() {
        22 => {
            has_digit
                || (token.chars().any(|character| character.is_ascii_uppercase())
                    && token.chars().any(|character| character.is_ascii_lowercase()))
        }
        32 => has_digit && token.chars().all(|character| character.is_ascii_hexdigit()),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitizes_nested_status_and_error_strings() {
        let mut report = json!({
            "librespot": {"username": "private-user", "phase": "ready"},
            "events": [{"error": "İ Authorization: Bearer secret", "count": 3}],
            "refresh_token": "private-token"
        });
        Redactor::new(None).report(&mut report);
        assert_eq!(report["librespot"]["username"], "[REDACTED]");
        assert_eq!(report["librespot"]["phase"], "ready");
        assert_eq!(report["events"][0]["error"], "[REDACTED]");
        assert_eq!(report["events"][0]["count"], 3);
        assert_eq!(report["refresh_token"], "[REDACTED]");
    }

    #[test]
    fn redacts_multiple_markers_and_preserves_safe_diagnostics() {
        assert_eq!(
            sanitize_text("refresh_token=first pairingKey=second"),
            "[REDACTED]"
        );
        assert_eq!(
            sanitize_text("playlist request timed out after 4000ms"),
            "playlist request timed out after 4000ms"
        );
    }

    #[test]
    fn masks_user_device_search_and_spotify_ids() {
        let redactor = Redactor::new(Some("k3vq8zt2wmd61rx9pfhb4ycn0"));
        assert_eq!(
            redactor.text("Authenticated as 'k3vq8zt2wmd61rx9pfhb4ycn0' !"),
            "Authenticated as '<user>' !"
        );
        assert_eq!(
            redactor.text("hm://keymaster/token?scope=a&client_id=65b708073fc0480ea92a077233ca87bd&device_id=db7b8682-eab2"),
            "hm://keymaster/token?scope=a&client_id=<redacted>&device_id=<redacted>"
        );
        assert_eq!(
            redactor.text("https://api.spotify.com/v1/search?q=my%20song&type=album"),
            "https://api.spotify.com/v1/search?q=<redacted>&type=album"
        );
        assert_eq!(
            redactor.text("spotify:track:1AtVFx9tRuBBWUp8NkWe8H is not available"),
            "spotify:track:<id> is not available"
        );
        assert_eq!(redactor.text("unique=1 rootlist request failed"), "unique=1 rootlist request failed");
    }
}
