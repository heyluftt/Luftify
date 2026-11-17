//! App updates for testers: the Tauri updater reads `/updates/latest.json`
//! and downloads the signed installer from `/updates/files/<name>`. The
//! Android app has the same under `/updates/android/`, in its own folder, so
//! a desktop release never prunes a phone's APK and the other way round. All
//! of it lives on the data volume. Uploading needs `LUFTIFY_UPDATE_TOKEN`;
//! without it the server only serves what is already there.
use std::path::{Path, PathBuf};

use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Path as UrlPath, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use futures_util::StreamExt;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::io::ReaderStream;

/// Installers are ~20–40 MB; this leaves room without inviting abuse.
const MAX_UPLOAD_BYTES: usize = 300 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;

#[derive(Clone)]
struct Updates {
    dir: PathBuf,
    token_hash: Option<[u8; 32]>,
}

pub fn router() -> Router {
    let dir = std::env::var_os("LUFTIFY_UPDATES_DIR").map(PathBuf::from).unwrap_or_else(|| {
        // Next to the social database, so both end up on the same volume.
        std::env::var_os("LUFTIFY_SOCIAL_DATABASE")
            .map(PathBuf::from)
            .and_then(|db| db.parent().map(|dir| dir.join("updates")))
            .unwrap_or_else(|| PathBuf::from("data/updates"))
    });
    let token_hash = std::env::var("LUFTIFY_UPDATE_TOKEN")
        .ok()
        .map(|token| token.trim().to_owned())
        .filter(|token| token.len() >= 32)
        .map(|token| Sha256::digest(token.as_bytes()).into());
    if token_hash.is_none() {
        tracing::info!("update uploads disabled (LUFTIFY_UPDATE_TOKEN not set)");
    }
    let channel = |dir: PathBuf| {
        Router::new()
            .route("/latest.json", get(manifest).put(upload_manifest))
            .route("/files/{name}", get(download).put(upload_file))
            .with_state(Updates { dir, token_hash })
    };
    Router::new()
        .nest("/updates/android", channel(dir.join("android")))
        .nest("/updates", channel(dir))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
}

fn authorized(state: &Updates, headers: &HeaderMap) -> bool {
    let Some(expected) = state.token_hash else { return false };
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|token| <[u8; 32]>::from(Sha256::digest(token.trim().as_bytes())) == expected)
}

/// Plain file names only: no paths, no dot files.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._- ".contains(&b))
}

async fn manifest(State(state): State<Updates>) -> Response {
    match tokio::fs::read(state.dir.join("latest.json")).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-cache")], bytes).into_response(),
        // No release yet: the updater reads 204 as "nothing new".
        Err(_) => StatusCode::NO_CONTENT.into_response(),
    }
}

async fn download(State(state): State<Updates>, UrlPath(name): UrlPath<String>) -> Response {
    if !valid_name(&name) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(file) = tokio::fs::File::open(state.dir.join("files").join(&name)).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let length = file.metadata().await.map(|meta| meta.len()).ok();
    let mut response = Body::from_stream(ReaderStream::new(file)).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    if let Some(length) = length.and_then(|len| HeaderValue::from_str(&len.to_string()).ok()) {
        headers.insert(header::CONTENT_LENGTH, length);
    }
    response
}

async fn upload_file(State(state): State<Updates>, UrlPath(name): UrlPath<String>, headers: HeaderMap, body: Body) -> Response {
    if !authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !valid_name(&name) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let dir = state.dir.join("files");
    match write_atomically(&dir, &name, body, MAX_UPLOAD_BYTES).await {
        Ok(()) => StatusCode::CREATED.into_response(),
        Err(status) => status.into_response(),
    }
}

async fn upload_manifest(State(state): State<Updates>, headers: HeaderMap, body: Body) -> Response {
    if !authorized(&state, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(bytes) = axum::body::to_bytes(body, MAX_MANIFEST_BYTES).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };
    // The manifest may only point at files that were uploaded before it.
    let Some(files) = manifest_files(&bytes) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    for file in &files {
        if !state.dir.join("files").join(file).is_file() {
            return (StatusCode::CONFLICT, format!("missing file {file}")).into_response();
        }
    }
    let previous = tokio::fs::read(state.dir.join("latest.json")).await.ok().and_then(|old| manifest_files(&old)).unwrap_or_default();
    if let Err(status) = write_atomically(&state.dir, "latest.json", Body::from(bytes), MAX_MANIFEST_BYTES).await {
        return status.into_response();
    }
    prune(&state.dir.join("files"), &files, &previous).await;
    StatusCode::CREATED.into_response()
}

/// The installer names a manifest refers to, or None if it is no manifest:
/// the Tauri form (`platforms` with signatures) or the Android one (one APK
/// with its `versionCode` and SHA-256; Android checks the signature itself).
fn manifest_files(bytes: &[u8]) -> Option<Vec<String>> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    value.get("version")?.as_str()?;
    let urls: Vec<&str> = match value.get("platforms") {
        Some(platforms) => platforms
            .as_object()?
            .values()
            .map(|platform| platform.get("signature")?.as_str().and(platform.get("url")?.as_str()))
            .collect::<Option<_>>()?,
        None => {
            value.get("versionCode")?.as_u64()?;
            let sha = value.get("sha256")?.as_str()?;
            if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            vec![value.get("url")?.as_str()?]
        }
    };
    let mut files = Vec::new();
    for url in urls {
        let name = url.rsplit('/').next()?.replace("%20", " ");
        if !valid_name(&name) {
            return None;
        }
        files.push(name);
    }
    (!files.is_empty()).then_some(files)
}

/// Keeps the current and the previous release; the volume stays small.
async fn prune(dir: &Path, current: &[String], previous: &[String]) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else { return };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !current.contains(&name) && !previous.contains(&name) {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

async fn write_atomically(dir: &Path, name: &str, body: Body, limit: usize) -> Result<(), StatusCode> {
    tokio::fs::create_dir_all(dir).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let temp = dir.join(format!(".{name}.upload"));
    let mut file = tokio::fs::File::create(&temp).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stream = body.into_data_stream();
    let mut written = 0usize;
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(StatusCode::BAD_REQUEST);
        };
        written += chunk.len();
        if written > limit {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(StatusCode::PAYLOAD_TOO_LARGE);
        }
        if file.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
    file.flush().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(file);
    tokio::fs::rename(&temp, dir.join(name)).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifests_name_plain_files_only() {
        let good = br#"{"version":"0.1.2","platforms":{"windows-x86_64":{"signature":"s","url":"https://x/updates/files/Luftify_0.1.2_x64-setup.exe"}}}"#;
        assert_eq!(manifest_files(good).unwrap(), ["Luftify_0.1.2_x64-setup.exe"]);
        let escape = br#"{"version":"1","platforms":{"w":{"signature":"s","url":"https://x/updates/files/..%2Fsocial.sqlite"}}}"#;
        assert!(manifest_files(escape).is_none());
        assert!(manifest_files(br#"{"version":"1","platforms":{}}"#).is_none());
        assert!(!valid_name("../x") && !valid_name(".hidden") && valid_name("Luftify_0.1.2_x64-setup.exe"));
    }

    #[test]
    fn android_manifests_name_one_apk_with_its_hash() {
        let sha = "a".repeat(64);
        let good = format!(r#"{{"version":"0.2.1","versionCode":201,"sha256":"{sha}","url":"https://x/updates/android/files/Luftify-0.2.1.apk"}}"#);
        assert_eq!(manifest_files(good.as_bytes()).unwrap(), ["Luftify-0.2.1.apk"]);
        let no_code = format!(r#"{{"version":"0.2.1","sha256":"{sha}","url":"https://x/a.apk"}}"#);
        assert!(manifest_files(no_code.as_bytes()).is_none());
        assert!(manifest_files(br#"{"version":"0.2.1","versionCode":1,"sha256":"short","url":"https://x/a.apk"}"#).is_none());
    }
}
