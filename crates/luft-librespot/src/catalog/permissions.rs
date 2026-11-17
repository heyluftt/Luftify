//! Playlist edit rights from the current user's library response.
use serde_json::Value;

pub(super) fn playlist_write_access(value: &Value, username: &str) -> Option<bool> {
    // An explicit denial must take precedence over ownership or metadata rights.
    for path in ["/capabilities/canEditItems", "/capabilities/can_edit_items"] {
        if let Some(allowed) = value.pointer(path).and_then(Value::as_bool) {
            return Some(allowed);
        }
    }
    let owner = value
        .get("ownerUsername")
        .or_else(|| value.get("owner_username"))
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/owner/id").and_then(Value::as_str));
    if !username.is_empty() && owner == Some(username) {
        return Some(true);
    }
    // "Collaborative" alone does not establish that this user has edit rights.
    for key in [
        "playlist",
        "playlistMetadata",
        "playlist_metadata",
        "metadata",
    ] {
        if let Some(nested) = value.get(key)
            && let Some(allowed) = playlist_write_access(nested, username)
        {
            return Some(allowed);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn playlist_rights_require_evidence_and_honor_denials() {
        assert_eq!(
            playlist_write_access(&json!({"owner":{"id":"me"}}), "me"),
            Some(true)
        );
        assert_eq!(
            playlist_write_access(&json!({"owner":{"id":"other"},"collaborative":true}), "me"),
            None
        );
        assert_eq!(
            playlist_write_access(
                &json!({"ownerUsername":"me","capabilities":{"canEditItems":false}}),
                "me"
            ),
            Some(false)
        );
        assert_eq!(
            playlist_write_access(&json!({"capabilities":{"can_edit_items":true}}), "me"),
            Some(true)
        );
        assert_eq!(
            playlist_write_access(&json!({"capabilities":{"canEditMetadata":true}}), "me"),
            None
        );
    }
}
