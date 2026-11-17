use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Weak},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::{Mutex, Semaphore};
use url::Url;

const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_CACHE_BYTES: u64 = 128 * 1024 * 1024;
const ALLOWED_HOSTS: &[&str] = &[
    "i.scdn.co",
    "mosaic.scdn.co",
    "image-cdn-ak.spotifycdn.com",
    "image-cdn-fa.spotifycdn.com",
    "pickasso.spotifycdn.com",
    "lexicon-assets.spotifycdn.com",
    "wrapped-images.spotifycdn.com",
    "lineup-images.scdn.co",
    "seed-mix-image.spotifycdn.com",
    "blend-playlist-covers.spotifycdn.com",
];

#[derive(Debug, Error)]
pub enum CoverError {
    #[error("cover URL is not allowed")]
    UrlRejected,
    #[error("cover request failed")]
    Request,
    #[error("cover image is too large")]
    TooLarge,
    #[error("cover MIME type is not allowed")]
    MimeRejected,
    #[error("cover cache failed")]
    Cache,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct CoverCacheUsage {
    pub bytes: u64,
    pub entries: u64,
}

#[derive(Clone)]
pub struct CoverCache {
    root: PathBuf,
    client: reqwest::Client,
    concurrency: Arc<Semaphore>,
    locks: Arc<Mutex<HashMap<String, Weak<Mutex<()>>>>>,
}

impl CoverCache {
    pub fn new(root: PathBuf) -> Result<Self, CoverError> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(10))
            .user_agent("Luftify/0.1 cover-cache")
            .build()
            .map_err(|_| CoverError::Request)?;
        Ok(Self {
            root,
            client,
            concurrency: Arc::new(Semaphore::new(8)),
            locks: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn resolve_data_uri(&self, input: &str) -> Result<String, CoverError> {
        let (mime, bytes) = self.resolve_image(input).await?;
        Ok(data_uri(mime, &bytes))
    }

    /// The cover as raw bytes and MIME type, from the disk cache or the
    /// network (allow-listed hosts only). Served to the webview through the
    /// `luftcover` protocol, so covers no longer cross the bridge as base64.
    pub async fn resolve_image(&self, input: &str) -> Result<(&'static str, Vec<u8>), CoverError> {
        let url = validate_url(input)?;
        let key = format!("{:x}", Sha256::digest(url.as_str().as_bytes()));
        let path = self.root.join(&key);
        let lock = self.url_lock(&key).await;
        let _guard = lock.lock().await;
        if let Ok(bytes) = tokio::fs::read(&path).await {
            if bytes.len() <= MAX_IMAGE_BYTES
                && let Some(mime) = sniff_mime(&bytes)
            {
                return Ok((mime, bytes));
            }
            // A terminated write must not poison this URL permanently.
            let _ = tokio::fs::remove_file(&path).await;
        }
        let _permit = self
            .concurrency
            .acquire()
            .await
            .map_err(|_| CoverError::Request)?;
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| CoverError::Request)?;
        if !response.status().is_success() {
            return Err(CoverError::Request);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_IMAGE_BYTES as u64)
        {
            return Err(CoverError::TooLarge);
        }
        let declared_mime = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("");
        if !matches!(declared_mime, "image/jpeg" | "image/png" | "image/webp") {
            return Err(CoverError::MimeRejected);
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| CoverError::Request)?;
            if bytes.len().saturating_add(chunk.len()) > MAX_IMAGE_BYTES {
                return Err(CoverError::TooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        let mime = sniff_mime(&bytes).ok_or(CoverError::MimeRejected)?;
        tokio::fs::create_dir_all(&self.root)
            .await
            .map_err(|_| CoverError::Cache)?;
        tokio::fs::write(&path, &bytes)
            .await
            .map_err(|_| CoverError::Cache)?;
        let root = self.root.clone();
        tokio::spawn(async move {
            let _ = trim_cache(root).await;
        });
        Ok((mime, bytes))
    }

    pub async fn clear(&self) -> Result<u64, CoverError> {
        let mut directory = match tokio::fs::read_dir(&self.root).await {
            Ok(directory) => directory,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(_) => return Err(CoverError::Cache),
        };
        let mut removed = 0_u64;
        while let Some(entry) = directory
            .next_entry()
            .await
            .map_err(|_| CoverError::Cache)?
        {
            let path = entry.path();
            if entry
                .file_type()
                .await
                .map_err(|_| CoverError::Cache)?
                .is_file()
            {
                tokio::fs::remove_file(path)
                    .await
                    .map_err(|_| CoverError::Cache)?;
                removed = removed.saturating_add(1);
            }
        }
        Ok(removed)
    }

    pub async fn usage(&self) -> Result<CoverCacheUsage, CoverError> {
        let mut directory = match tokio::fs::read_dir(&self.root).await {
            Ok(directory) => directory,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CoverCacheUsage::default());
            }
            Err(_) => return Err(CoverError::Cache),
        };
        let mut usage = CoverCacheUsage::default();
        while let Some(entry) = directory
            .next_entry()
            .await
            .map_err(|_| CoverError::Cache)?
        {
            let metadata = match entry.metadata().await {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err(CoverError::Cache),
            };
            if metadata.is_file() {
                usage.entries = usage.entries.saturating_add(1);
                usage.bytes = usage.bytes.saturating_add(metadata.len());
            }
        }
        Ok(usage)
    }

    async fn url_lock(&self, key: &str) -> Arc<Mutex<()>> {
        let mut locks = self.locks.lock().await;
        locks.retain(|_, value| value.strong_count() > 0);
        if let Some(lock) = locks.get(key).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(key.into(), Arc::downgrade(&lock));
        lock
    }
}

fn validate_url(input: &str) -> Result<Url, CoverError> {
    let url = Url::parse(input).map_err(|_| CoverError::UrlRejected)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(CoverError::UrlRejected);
    }
    if !url.host_str().is_some_and(|host| {
        ALLOWED_HOSTS
            .iter()
            .any(|allowed| host.eq_ignore_ascii_case(allowed))
    }) {
        return Err(CoverError::UrlRejected);
    }
    Ok(url)
}

fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

fn data_uri(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

async fn trim_cache(root: PathBuf) -> Result<(), std::io::Error> {
    let mut directory = tokio::fs::read_dir(&root).await?;
    let mut entries = Vec::new();
    let mut total = 0_u64;
    while let Some(entry) = directory.next_entry().await? {
        let metadata = entry.metadata().await?;
        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
            entries.push((metadata.modified().ok(), metadata.len(), entry.path()));
        }
    }
    entries.sort_by_key(|entry| entry.0);
    for (_, length, path) in entries {
        if total <= MAX_CACHE_BYTES {
            break;
        }
        tokio::fs::remove_file(path).await?;
        total = total.saturating_sub(length);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_http_credentials_ports_and_unlisted_hosts() {
        assert!(validate_url("http://i.scdn.co/image").is_err());
        assert!(validate_url("https://user@i.scdn.co/image").is_err());
        assert!(validate_url("https://i.scdn.co:444/image").is_err());
        assert!(validate_url("https://example.com/image").is_err());
        assert!(validate_url("https://i.scdn.co/image").is_ok());
    }

    #[test]
    fn allows_personalized_playlist_cover_hosts_without_allowing_other_hosts() {
        for host in [
            "wrapped-images.spotifycdn.com",
            "lineup-images.scdn.co",
            "seed-mix-image.spotifycdn.com",
            "blend-playlist-covers.spotifycdn.com",
        ] {
            assert!(validate_url(&format!("https://{host}/image.jpg")).is_ok());
            assert!(validate_url(&format!("https://{host}.example.com/image.jpg")).is_err());
            assert!(validate_url(&format!("https://untrusted.{host}/image.jpg")).is_err());
        }
    }
    #[tokio::test]
    async fn reports_the_number_and_size_of_cached_cover_files() {
        let directory = tempfile::tempdir().expect("tempdir");
        let root = directory.path().join("covers");
        tokio::fs::create_dir_all(&root)
            .await
            .expect("cover directory");
        tokio::fs::write(root.join("first"), [1_u8, 2, 3])
            .await
            .expect("first cover");
        tokio::fs::write(root.join("second"), [4_u8, 5, 6, 7])
            .await
            .expect("second cover");
        tokio::fs::create_dir(root.join("ignored-directory"))
            .await
            .expect("nested directory");

        let cache = CoverCache::new(root).expect("cover cache");
        assert_eq!(
            cache.usage().await.expect("usage"),
            CoverCacheUsage {
                bytes: 7,
                entries: 2,
            }
        );
    }
}
