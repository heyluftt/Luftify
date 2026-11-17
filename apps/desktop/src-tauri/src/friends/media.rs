//! Profile media on the friends server: uploading the own moving picture or
//! banner, and loading everyone's through a disk cache. Ids name the
//! content, so a cached file never goes stale.
use std::{
    path::Path,
    time::{Duration, SystemTime},
};

use luft_listen_together::media::{MediaKind, MediaUpload, valid_media_id};
use reqwest::{Method, header};
use url::Url;
use zeroize::Zeroizing;

use super::{
    http,
    service::{FriendsService, authenticated},
};

/// Files of a few MB over a slow line take longer than the usual requests.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(60);
/// The cache keeps the most recently used files up to this size.
const CACHE_BUDGET: u64 = 300 * 1024 * 1024;

impl FriendsService {
    pub async fn upload_media(&self, kind: MediaKind, bytes: Vec<u8>, cache: &Path) -> Result<String, String> {
        if bytes.len() > kind.max_bytes() {
            return Err("friends.error.mediaTooLarge".into());
        }
        let (url, token) = self.media_url(&format!("media?kind={}", kind.key())).await?;
        let response = self.runtime.client.request(Method::POST, url)
            .bearer_auth(token.as_str())
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .timeout(TRANSFER_TIMEOUT)
            .body(bytes.clone())
            .send().await
            .map_err(|_| "friends.error.unreachable")?;
        let status = response.status();
        let body = response.bytes().await.map_err(|_| "friends.error.unreachable")?;
        if !status.is_success() {
            return Err(http::error_key(status, &body));
        }
        let upload: MediaUpload = serde_json::from_slice(&body).map_err(|_| "friends.error.protocol")?;
        if !valid_media_id(&upload.id) {
            return Err("friends.error.protocol".into());
        }
        // The own file is shown right away, without loading it back.
        store(cache, &upload.id, &bytes).await;
        Ok(upload.id)
    }

    pub async fn media(&self, id: &str, cache: &Path) -> Result<Vec<u8>, String> {
        if !valid_media_id(id) {
            return Err("friends.error.invalidRequest".into());
        }
        let path = cache.join(id);
        if let Ok(bytes) = tokio::fs::read(&path).await {
            // Recently used files survive pruning.
            if let Ok(file) = std::fs::File::options().write(true).open(&path) {
                let _ = file.set_modified(SystemTime::now());
            }
            return Ok(bytes);
        }
        let (url, token) = self.media_url(&format!("media/{id}")).await?;
        let mut response = self.runtime.client.request(Method::GET, url)
            .bearer_auth(token.as_str())
            .timeout(TRANSFER_TIMEOUT)
            .send().await
            .map_err(|_| "friends.error.unreachable")?;
        let status = response.status();
        let limit = MediaKind::Banner.max_bytes();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "friends.error.unreachable")? {
            if bytes.len() + chunk.len() > limit {
                return Err("friends.error.protocol".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            return Err(http::error_key(status, &bytes));
        }
        store(cache, id, &bytes).await;
        Ok(bytes)
    }

    /// Endpoint and token copied out, so transfers never hold the session.
    pub(super) async fn media_url(&self, route: &str) -> Result<(Url, Zeroizing<String>), String> {
        let session = self.runtime.session.lock().await;
        let (endpoint, credential) = authenticated(&session)?;
        let url = endpoint.join(route).map_err(|_| "friends.error.invalidUrl")?;
        Ok((url, Zeroizing::new(credential.token.clone())))
    }
}

/// Best effort: without the cache, files are simply loaded again.
async fn store(cache: &Path, id: &str, bytes: &[u8]) {
    if tokio::fs::create_dir_all(cache).await.is_err() {
        return;
    }
    let temp = cache.join(format!(".{id}.part"));
    if tokio::fs::write(&temp, bytes).await.is_ok() && tokio::fs::rename(&temp, cache.join(id)).await.is_ok() {
        prune(cache).await;
    } else {
        let _ = tokio::fs::remove_file(&temp).await;
    }
}

async fn prune(cache: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(cache).await else { return };
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(meta) = entry.metadata().await {
            files.push((meta.modified().unwrap_or(SystemTime::UNIX_EPOCH), meta.len(), entry.path()));
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut kept = 0u64;
    for (_, size, path) in files {
        kept += size;
        if kept > CACHE_BUDGET {
            let _ = tokio::fs::remove_file(path).await;
        }
    }
}
