//! Profile media: a moving picture (GIF, WebP or short video) and a custom
//! banner. Files live on the friends server; a profile only names them by id,
//! `<32 hex>.<ext>`, so snapshots stay small. The still picture stays inline
//! in `avatar_uri`, so lists and older apps keep working without the file.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Avatar,
    Banner,
}

impl MediaKind {
    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "avatar" => Some(Self::Avatar),
            "banner" => Some(Self::Banner),
            _ => None,
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Banner => "banner",
        }
    }

    /// The app shrinks pictures and re-encodes videos well below this.
    pub fn max_bytes(self) -> usize {
        match self {
            Self::Avatar => 2 * 1024 * 1024,
            Self::Banner => 4 * 1024 * 1024,
        }
    }

    /// A moving picture only; a still one is the inline avatar.
    pub fn allows(self, extension: &str) -> bool {
        match self {
            Self::Avatar => matches!(extension, "gif" | "webp" | "webm" | "mp4"),
            Self::Banner => matches!(extension, "jpg" | "png" | "gif" | "webp" | "webm" | "mp4"),
        }
    }
}

/// Uploads per profile and day, and all media together on the server.
pub const MEDIA_UPLOADS_PER_DAY: i64 = 12;
pub const MAX_MEDIA_TOTAL_BYTES: i64 = 250 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUpload {
    pub id: String,
}

/// The file type from its first bytes; the name a client sends is never trusted.
pub fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        Some("webm")
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        Some("mp4")
    } else {
        None
    }
}

pub fn content_type(extension: &str) -> &'static str {
    match extension {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "application/octet-stream",
    }
}

/// `<32 lowercase hex>.<known extension>`; nothing else becomes a path or URL.
pub fn valid_media_id(id: &str) -> bool {
    let Some((hash, extension)) = id.split_once('.') else { return false };
    hash.len() == 32
        && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && content_type(extension) != "application/octet-stream"
}

pub fn media_extension(id: &str) -> Option<&str> {
    valid_media_id(id).then(|| id.split_once('.').map(|(_, extension)| extension)).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_types_and_checks_ids() {
        assert_eq!(sniff_extension(b"GIF89a...."), Some("gif"));
        assert_eq!(sniff_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(sniff_extension(&[0x1A, 0x45, 0xDF, 0xA3, 1]), Some("webm"));
        assert_eq!(sniff_extension(b"\0\0\0\x18ftypmp42"), Some("mp4"));
        assert_eq!(sniff_extension(b"<svg onload=alert(1)>"), None);
        assert!(valid_media_id("0123456789abcdef0123456789abcdef.webm"));
        assert!(!valid_media_id("0123456789ABCDEF0123456789abcdef.webm"));
        assert!(!valid_media_id("../../social.sqlite"));
        assert!(!valid_media_id("0123456789abcdef0123456789abcdef.svg"));
        assert!(MediaKind::Avatar.allows("webm") && !MediaKind::Avatar.allows("jpg") && MediaKind::Banner.allows("jpg"));
    }
}
