//! Preserve contributor identities from already loaded Spotify playlist data.
//! No additional network requests and no inferred Luftify friendships.
use luft_core::PlaylistContributor;
use serde_json::Value;

pub(crate) fn person(raw: &str, session: &str) -> Option<PlaylistContributor> {
    let username = raw.trim().strip_prefix("spotify:user:").unwrap_or(raw.trim());
    if username.is_empty() || username.len() > 200 || username.chars().any(char::is_control) { return None; }
    Some(PlaylistContributor { username: username.into(), display_name: None, avatar_uri: None,
        is_self: !session.is_empty() && username == session })
}

pub(crate) fn entry_author(value: &Value) -> Option<PlaylistContributor> {
    ["/added_by", "/addedBy", "/attributes/added_by", "/attributes/addedBy", "/item/attributes/addedBy", "/item/attributes/added_by", "/item/added_by"]
        .iter().find_map(|path| {
            let raw = value.pointer(path)?;
            let username = raw.as_str().or_else(|| raw.get("id")?.as_str())
                .or_else(|| raw.get("username")?.as_str()).or_else(|| raw.get("uri")?.as_str())?;
            let mut result = person(username, "")?;
            result.display_name = text(raw, "display_name").or_else(|| text(raw, "displayName")).or_else(|| text(raw, "name"));
            result.avatar_uri = raw.get("images").and_then(Value::as_array).and_then(|images| images.iter().find_map(|image|
                image.get("url")?.as_str().filter(|url| url.starts_with("https://") && url.len() <= 2048).map(str::to_owned)));
            Some(result)
        })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::trim).filter(|value| !value.is_empty()).map(|value| value.chars().take(100).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authors_are_not_guessed_and_json_forms_agree() {
        let web = serde_json::json!({"added_by":{"id":"alice", "display_name":"Alice"}});
        assert_eq!(entry_author(&web).unwrap().display_name.as_deref(), Some("Alice"));
        let internal = serde_json::json!({"attributes":{"addedBy":"spotify:user:bob"}});
        assert_eq!(entry_author(&internal).unwrap().username, "bob");
        assert!(person("alice", "alice").unwrap().is_self);
        assert!(entry_author(&serde_json::json!({"track":{"uri":"spotify:track:abc"}})).is_none());
    }
}
