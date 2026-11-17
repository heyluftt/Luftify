//! `luftcover` URI scheme: covers straight from the disk cache as image
//! responses. Before, every cover crossed the IPC bridge as a base64 data
//! URI and lived as a string in the webview's JS heap; now the webview
//! loads, decodes and caches it like any image.
//!
//! Request: `…/cover?src=<https cover URL>&fallback=<original URL>`.
//! `src` may be a smaller size variant; if Spotify does not have it, the
//! original in `fallback` is served. Both go through the cover cache's host
//! allow-list, so the scheme cannot be used to fetch anything else.

use tauri::{
    Manager, Runtime, UriSchemeContext, UriSchemeResponder,
    http::{Request, Response, StatusCode, header},
};

use crate::state::AppState;

pub const SCHEME: &str = "luftcover";

pub fn handle<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let (source, fallback) = cover_params(request.uri().query().unwrap_or(""));
    tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            responder.respond(status(StatusCode::SERVICE_UNAVAILABLE));
            return;
        };
        let cache = &state.cover_cache;
        let mut image = match source.as_deref() {
            Some(source) => cache.resolve_image(source).await.ok(),
            None => None,
        };
        if image.is_none()
            && let Some(fallback) = fallback.as_deref()
            && Some(fallback) != source.as_deref()
        {
            image = cache.resolve_image(fallback).await.ok();
        }
        responder.respond(match image {
            Some((mime, bytes)) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime)
                // Same URL, same image: let the webview keep it.
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .body(bytes)
                .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR)),
            None => status(StatusCode::NOT_FOUND),
        });
    });
}

fn cover_params(query: &str) -> (Option<String>, Option<String>) {
    let mut source = None;
    let mut fallback = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        match key.as_ref() {
            "src" => source = Some(value.into_owned()),
            "fallback" => fallback = Some(value.into_owned()),
            _ => {}
        }
    }
    (source, fallback)
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}

#[cfg(test)]
mod tests {
    use super::cover_params;

    #[test]
    fn reads_encoded_source_and_fallback() {
        let (source, fallback) = cover_params(
            "src=https%3A%2F%2Fi.scdn.co%2Fimage%2Fsmall&fallback=https%3A%2F%2Fi.scdn.co%2Fimage%2Fbig",
        );
        assert_eq!(source.as_deref(), Some("https://i.scdn.co/image/small"));
        assert_eq!(fallback.as_deref(), Some("https://i.scdn.co/image/big"));
        assert_eq!(cover_params(""), (None, None));
    }
}
