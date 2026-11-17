use librespot::{
    core::{Session, SpotifyUri},
    metadata::{Album, Artist, Metadata, album::AlbumType},
};
use luft_core::{
    ArtistDetails, ArtistDiscographyCategoryStatus, ArtistDiscographyStatus, ArtistRelease,
    ArtistReleaseType, EntitySummary, MediaItem, ProviderError,
};
use tokio::task::JoinSet;

use crate::metadata::cover_from_images;

const POPULAR_TRACK_LIMIT: usize = 10;
const RELEASE_LIMIT: usize = 40;
const RELEASE_CONCURRENCY: usize = 6;

pub(crate) async fn load_artist_details(
    session: &Session,
    uri: &str,
) -> Result<ArtistDetails, ProviderError> {
    let parsed = SpotifyUri::from_uri(uri).map_err(|error| {
        ProviderError::InvalidRequest(format!("Ungültige Künstler-URI: {error}"))
    })?;
    let artist = Artist::get(session, &parsed).await.map_err(|error| {
        ProviderError::Internal(format!(
            "Künstlerprofil konnte nicht geladen werden: {error}"
        ))
    })?;
    let artist_uri = artist.id.to_uri().unwrap_or_else(|_| uri.to_string());
    let image_uri =
        cover_from_images(&artist.portrait_group).or_else(|| cover_from_images(&artist.portraits));
    let popular_uris = popular_track_uris(&artist, &session.country());
    let mut popular_tracks = hydrate_tracks(session, &popular_uris).await;
    crate::playcount::apply_artist_play_counts(session, &artist_uri, &mut popular_tracks).await;
    let albums = hydrate_releases(
        session,
        artist.albums_current().cloned().collect(),
        ArtistReleaseType::Album,
    )
    .await;
    let singles = hydrate_releases(
        session,
        artist.singles_current().cloned().collect(),
        ArtistReleaseType::Single,
    )
    .await;
    let compilations = hydrate_releases(
        session,
        artist.compilations_current().cloned().collect(),
        ArtistReleaseType::Compilation,
    )
    .await;

    Ok(ArtistDetails {
        uri: artist_uri,
        name: artist.name,
        image_uri,
        popular_tracks,
        discography_status: Some(ArtistDiscographyStatus {
            albums: ArtistDiscographyCategoryStatus::Loaded,
            singles: ArtistDiscographyCategoryStatus::Loaded,
            compilations: ArtistDiscographyCategoryStatus::Loaded,
        }),
        albums,
        singles,
        compilations,
    })
}

/// Name and picture of several artists in one batch, e.g. for the top artists
/// in the listening analysis; artists without an answer are left out.
pub(crate) async fn load_artist_portraits(session: &Session, uris: &[String]) -> Vec<EntitySummary> {
    use librespot::protocol::{extension_kind::ExtensionKind, metadata::Artist as ArtistMessage};
    use protobuf::Message;
    crate::metadata_batch::entities(session, ExtensionKind::ARTIST_V4, uris).await
        .into_iter()
        .filter_map(|(uri, bytes)| {
            let artist = Artist::try_from(&ArtistMessage::parse_from_bytes(&bytes).ok()?).ok()?;
            Some(EntitySummary {
                uri,
                name: artist.name,
                subtitle: None,
                cover_uri: cover_from_images(&artist.portrait_group).or_else(|| cover_from_images(&artist.portraits)),
                can_modify: None,
                library: None,
            })
        })
        .collect()
}

fn popular_track_uris(artist: &Artist, country: &str) -> Vec<String> {
    artist
        .top_tracks
        .for_country(country)
        .iter()
        .filter_map(|uri| uri.to_uri().ok())
        .take(POPULAR_TRACK_LIMIT)
        .collect()
}

/// The top songs in one go instead of one after the other.
async fn hydrate_tracks(session: &Session, uris: &[String]) -> Vec<MediaItem> {
    crate::metadata_batch::tracks_in_order(session, uris).await
}

async fn hydrate_releases(
    session: &Session,
    uris: Vec<SpotifyUri>,
    fallback_type: ArtistReleaseType,
) -> Vec<ArtistRelease> {
    let selected: Vec<SpotifyUri> = uris.into_iter().take(RELEASE_LIMIT).collect();
    let mut join_set = JoinSet::new();
    let mut releases = Vec::new();
    for (index, uri) in selected.into_iter().enumerate() {
        if join_set.len() >= RELEASE_CONCURRENCY
            && let Some(release) = join_next_release(&mut join_set).await
        {
            releases.push(release);
        }
        let session = session.clone();
        join_set.spawn(async move {
            load_release(&session, uri, fallback_type)
                .await
                .map(|release| (index, release))
        });
    }
    while let Some(release) = join_next_release(&mut join_set).await {
        releases.push(release);
    }
    sort_releases_newest_first(&mut releases);
    releases.into_iter().map(|(_, release)| release).collect()
}

async fn join_next_release(
    join_set: &mut JoinSet<Option<(usize, ArtistRelease)>>,
) -> Option<(usize, ArtistRelease)> {
    loop {
        let result = join_set.join_next().await?;
        if let Ok(Some(release)) = result {
            return Some(release);
        }
        if join_set.is_empty() {
            return None;
        }
    }
}

async fn load_release(
    session: &Session,
    uri: SpotifyUri,
    fallback_type: ArtistReleaseType,
) -> Option<ArtistRelease> {
    let album = Album::get(session, &uri).await.ok()?;
    let album_uri = album.id.to_uri().ok()?;
    let (release_date, year) = album_release_fields(&album.date);
    Some(ArtistRelease {
        uri: album_uri,
        name: album.name,
        subtitle: None,
        cover_uri: cover_from_images(&album.cover_group)
            .or_else(|| cover_from_images(&album.covers)),
        release_date,
        year,
        release_type: release_type_from_album(album.album_type, fallback_type),
        artists: album
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
            .collect(),
    })
}

fn album_release_fields(date: &librespot::core::date::Date) -> (Option<String>, Option<u32>) {
    let year = u32::try_from(date.year()).ok().filter(|year| *year >= 1000);
    let Some(year) = year else {
        return (None, None);
    };
    let month = u8::from(date.month());
    let day = date.day();
    (Some(format!("{year:04}-{month:02}-{day:02}")), Some(year))
}

fn sort_releases_newest_first(releases: &mut [(usize, ArtistRelease)]) {
    releases.sort_by(|(left_index, left), (right_index, right)| {
        release_recency_key(right)
            .cmp(&release_recency_key(left))
            .then(left_index.cmp(right_index))
    });
}

fn release_recency_key(release: &ArtistRelease) -> (u32, u32, u32) {
    if let Some(date) = release.release_date.as_deref() {
        let mut parts = date.split('-');
        let year = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
        let month = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
        let day = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
        return (year, month, day);
    }
    (release.year.unwrap_or(0), 0, 0)
}

fn release_type_from_album(
    album_type: AlbumType,
    fallback: ArtistReleaseType,
) -> ArtistReleaseType {
    match album_type {
        AlbumType::ALBUM => ArtistReleaseType::Album,
        AlbumType::SINGLE => ArtistReleaseType::Single,
        AlbumType::COMPILATION => ArtistReleaseType::Compilation,
        AlbumType::EP => ArtistReleaseType::Ep,
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_fetch_marks_empty_categories_as_loaded() {
        let status = ArtistDiscographyStatus {
            albums: ArtistDiscographyCategoryStatus::Loaded,
            singles: ArtistDiscographyCategoryStatus::Loaded,
            compilations: ArtistDiscographyCategoryStatus::Loaded,
        };
        assert_eq!(status.compilations, ArtistDiscographyCategoryStatus::Loaded);
    }

    #[test]
    fn album_types_map_to_artist_releases() {
        assert_eq!(
            release_type_from_album(AlbumType::SINGLE, ArtistReleaseType::Album),
            ArtistReleaseType::Single
        );
        assert_eq!(
            release_type_from_album(AlbumType::EP, ArtistReleaseType::Single),
            ArtistReleaseType::Ep
        );
    }

    #[test]
    fn singles_are_ordered_newest_first() {
        let dinner = ArtistRelease {
            uri: "spotify:album:dinner".into(),
            name: "dinner party fun".into(),
            subtitle: None,
            cover_uri: None,
            release_date: Some("2026-06-20".into()),
            year: Some(2026),
            release_type: ArtistReleaseType::Single,
            artists: Vec::new(),
        };
        let pier = ArtistRelease {
            uri: "spotify:album:pier".into(),
            name: "santa monica pier pressure".into(),
            subtitle: None,
            cover_uri: None,
            release_date: Some("2026-08-14".into()),
            year: Some(2026),
            release_type: ArtistReleaseType::Single,
            artists: Vec::new(),
        };
        let mut releases = vec![(0, dinner), (1, pier.clone())];
        sort_releases_newest_first(&mut releases);
        assert_eq!(releases[0].1.name, "santa monica pier pressure");
        assert_eq!(releases[1].1.name, "dinner party fun");
    }
}
