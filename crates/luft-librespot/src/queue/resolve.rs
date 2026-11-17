use std::sync::Arc;

use librespot::{
    core::{Session, SpotifyUri},
    metadata::{Album, Metadata, Playlist},
};

use super::order::DatedUri;
use super::uri::canonicalize_item_uri;
use crate::playlist::PlaylistIndexCache;

pub(crate) async fn load_context_play_entries(
    session: &Session,
    context_uri: &str,
    playlist_cache: &Arc<PlaylistIndexCache>,
) -> Vec<DatedUri> {
    if !crate::playback::context_owns_remote_queue(context_uri) {
        return Vec::new();
    }
    if context_uri.contains(":playlist:") {
        let entries =
            crate::playlist::load_playlist_play_entries(session, context_uri, playlist_cache).await;
        if !entries.is_empty() {
            return entries;
        }
    }
    load_context_uris(session, context_uri)
        .await
        .into_iter()
        .map(|uri| DatedUri {
            uri,
            added_at: None,
        })
        .collect()
}

pub(crate) async fn load_context_uris(session: &Session, context_uri: &str) -> Vec<String> {
    if let Some(uris) = metadata_context_uris(session, context_uri).await
        && !uris.is_empty()
    {
        return uris;
    }
    resolve_context_uris(session, context_uri)
        .await
        .unwrap_or_default()
}

async fn metadata_context_uris(session: &Session, context_uri: &str) -> Option<Vec<String>> {
    let parsed = SpotifyUri::from_uri(context_uri).ok()?;
    match parsed {
        SpotifyUri::Playlist { .. } => {
            let playlist = Playlist::get(session, &parsed).await.ok()?;
            Some(
                playlist
                    .tracks()
                    .filter_map(|uri| uri.to_uri().ok())
                    .filter_map(|uri| canonicalize_item_uri(&uri))
                    .collect(),
            )
        }
        SpotifyUri::Album { .. } => {
            let album = Album::get(session, &parsed).await.ok()?;
            Some(
                album
                    .tracks()
                    .filter_map(|uri| uri.to_uri().ok())
                    .filter_map(|uri| canonicalize_item_uri(&uri))
                    .collect(),
            )
        }
        _ => None,
    }
}

async fn resolve_context_uris(session: &Session, context_uri: &str) -> Option<Vec<String>> {
    let context = session.spclient().get_context(context_uri).await.ok()?;
    let mut uris = Vec::new();
    for page in context.pages {
        for track in page.tracks {
            if let Some(uri) = track.uri
                && let Some(uri) = canonicalize_item_uri(&uri)
            {
                uris.push(uri);
            }
        }
    }
    (!uris.is_empty()).then_some(uris)
}
