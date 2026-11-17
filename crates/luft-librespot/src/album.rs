use librespot::{
    core::{Session, SpotifyUri},
    metadata::{Album, Metadata},
};
use luft_core::{AlbumDetails, EntitySummary, MediaItem, PageRequest, ProviderError};
use crate::metadata::cover_from_images;

pub(crate) async fn load_album_details(
    session: &Session,
    uri: &str,
    request: PageRequest,
) -> Result<AlbumDetails, ProviderError> {
    let parsed = SpotifyUri::from_uri(uri)
        .map_err(|error| ProviderError::InvalidRequest(format!("Ungültige Album-URI: {error}")))?;
    let album = Album::get(session, &parsed).await.map_err(|error| {
        ProviderError::Internal(format!("Album konnte nicht geladen werden: {error}"))
    })?;
    let album_uri = album.id.to_uri().unwrap_or_else(|_| uri.to_string());
    let track_uris: Vec<String> = album
        .tracks()
        .filter_map(|track| track.to_uri().ok())
        .collect();
    let total = track_uris.len() as u32;
    let offset = request.offset.min(total);
    let limit = request.limit.max(1);
    let page: Vec<String> = track_uris
        .into_iter()
        .skip(offset as usize)
        .take(limit as usize)
        .collect();
    let mut tracks = hydrate_tracks(session, &page).await;
    crate::playcount::apply_album_play_counts(session, &album_uri, &mut tracks).await;
    let artists = album
        .artists
        .iter()
        .filter_map(|artist| {
            let name = artist.name.trim();
            if name.is_empty() {
                return None;
            }
            Some(EntitySummary {
                uri: artist.id.to_uri().unwrap_or_default(),
                name: name.to_string(),
                subtitle: None,
                cover_uri: None,
                can_modify: None,
                library: None,
            })
        })
        .collect();

    Ok(AlbumDetails {
        uri: album_uri,
        name: album.name,
        artists,
        year: u32::try_from(album.date.year()).ok(),
        cover_uri: cover_from_images(&album.cover_group)
            .or_else(|| cover_from_images(&album.covers)),
        tracks,
        offset,
        limit,
        total: Some(total),
        has_more: offset.saturating_add(limit) < total,
    })
}

/// Track metadata for `uris` in their order, a few at a time.
/// Songs of an album, liked songs or an artist, in their order (see metadata_batch).
pub(crate) async fn hydrate_tracks(session: &Session, uris: &[String]) -> Vec<MediaItem> {
    crate::metadata_batch::tracks_in_order(session, uris).await
}

#[cfg(test)]
mod tests {
    use luft_core::PageRequest;

    #[test]
    fn album_pages_stay_inside_the_requested_window() {
        let request = PageRequest {
            offset: 40,
            limit: 10,
        };
        let total = 47_u32;
        let offset = request.offset.min(total);
        let end = offset.saturating_add(request.limit).min(total);
        assert_eq!(offset, 40);
        assert_eq!(end, 47);
        assert!(!((offset.saturating_add(request.limit)) < total));
    }
}
