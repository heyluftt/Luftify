//! New releases from the artists the listener actually has in the library.
//! The Web API search for new albums is refused for this client (429), so
//! this asks the same internal metadata the artist and album pages use:
//! the most common artists among the remembered songs, their newest albums
//! and singles, both in batches.
use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use librespot::{
    core::Session,
    metadata::{Album, Artist},
    protocol::{
        extension_kind::ExtensionKind,
        metadata::{Album as AlbumMessage, Artist as ArtistMessage},
    },
};
use luft_core::{EntitySummary, Page, PageRequest};
use protobuf::Message;
use tracing::info;

use crate::{metadata::cover_from_images, metadata_batch};

use super::page_from_items;

/// Artists asked; one batch.
const ARTISTS: usize = 60;
/// Newest releases looked at per artist and kind (albums, singles).
const PER_KIND: usize = 3;
const MAX_AGE_DAYS: i64 = 120;
/// Fewer known artists than this means the library is not read yet.
const MIN_ARTISTS: usize = 3;
const FRESH_FOR: Duration = Duration::from_secs(60 * 60);

struct Remembered {
    account: String,
    at: Instant,
    items: Vec<EntitySummary>,
}

static LAST: LazyLock<Mutex<Option<Remembered>>> = LazyLock::new(Mutex::default);
static FIRST_LOOKUP: Mutex<Option<(String, Instant)>> = Mutex::new(None);
const LIBRARY_WARMUP: Duration = Duration::from_secs(60);

/// The first home request often beats playlist hydration. Keep the Web API
/// fallback available for small/empty libraries once the bounded grace ends.
pub(crate) fn warming_up(session: &Session) -> bool {
    let Ok(mut first) = FIRST_LOOKUP.lock() else { return false };
    let account = session.username();
    if first.as_ref().is_none_or(|(previous, _)| previous != &account) {
        *first = Some((account, Instant::now()));
    }
    wait_for_library(metadata_batch::top_artists(MIN_ARTISTS).len(), first.as_ref().unwrap().1.elapsed())
}

fn wait_for_library(artists: usize, elapsed: Duration) -> bool {
    artists < MIN_ARTISTS && elapsed < LIBRARY_WARMUP
}

pub(crate) async fn new_releases(session: &Session, request: &PageRequest) -> Option<Page<EntitySummary>> {
    let account = session.username();
    let remembered = LAST.lock().ok().and_then(|last| {
        last.as_ref().filter(|last| last.account == account && last.at.elapsed() < FRESH_FOR).map(|last| last.items.clone())
    });
    let items = match remembered {
        Some(items) => items,
        None => {
            let items = load(session).await?;
            if let Ok(mut last) = LAST.lock() {
                *last = Some(Remembered { account, at: Instant::now(), items: items.clone() });
            }
            items
        }
    };
    let page: Vec<EntitySummary> = items.into_iter().skip(request.offset as usize).take(request.limit.max(1) as usize).collect();
    (!page.is_empty()).then(|| page_from_items(*request, page, None))
}

async fn load(session: &Session) -> Option<Vec<EntitySummary>> {
    let started = Instant::now();
    let artists = metadata_batch::top_artists(ARTISTS);
    if artists.len() < MIN_ARTISTS {
        return None;
    }
    let mut release_uris = Vec::new();
    let mut seen = HashSet::new();
    for (_, bytes) in metadata_batch::entities(session, ExtensionKind::ARTIST_V4, &artists).await {
        let Some(artist) = ArtistMessage::parse_from_bytes(&bytes).ok().and_then(|message| Artist::try_from(&message).ok()) else { continue };
        for uri in newest(artist.albums_current().collect()).chain(newest(artist.singles_current().collect())) {
            if let Ok(uri) = uri.to_uri()
                && seen.insert(uri.clone())
            {
                release_uris.push(uri);
            }
        }
    }
    let today = chrono::Utc::now().date_naive();
    let mut releases: Vec<(chrono::NaiveDate, EntitySummary)> = metadata_batch::entities(session, ExtensionKind::ALBUM_V4, &release_uris).await
        .into_iter()
        .filter_map(|(uri, bytes)| {
            let album = Album::try_from(&AlbumMessage::parse_from_bytes(&bytes).ok()?).ok()?;
            let date = release_date(&album)?;
            recent(date, today).then(|| (date, summary(uri, &album)))
        })
        .collect();
    releases.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.name.cmp(&b.1.name)));
    // The same release under two ids (clean and explicit) shows once.
    let mut titles = HashSet::new();
    let items: Vec<EntitySummary> = releases.into_iter()
        .map(|(_, item)| item)
        .filter(|item| titles.insert((item.name.to_lowercase(), item.subtitle.clone())))
        .collect();
    info!(
        adapter = "librespot",
        phase = "new-releases",
        artists = artists.len(),
        releases = release_uris.len(),
        recent = items.len(),
        elapsed_ms = started.elapsed().as_millis(),
        "new releases from library artists"
    );
    Some(items)
}

/// Spotify lists an artist's releases newest first; the end is kept as well
/// in case an older answer comes the other way round.
fn newest<T>(all: Vec<T>) -> impl Iterator<Item = T> {
    let len = all.len();
    all.into_iter().enumerate().filter(move |(index, _)| *index < PER_KIND || *index + 1 >= len.max(1)).map(|(_, item)| item)
}

fn release_date(album: &Album) -> Option<chrono::NaiveDate> {
    let year = album.date.year();
    chrono::NaiveDate::from_ymd_opt(year, u32::from(u8::from(album.date.month())), u32::from(album.date.day()))
}

fn recent(date: chrono::NaiveDate, today: chrono::NaiveDate) -> bool {
    let age = today.signed_duration_since(date).num_days();
    (-1..=MAX_AGE_DAYS).contains(&age)
}

fn summary(uri: String, album: &Album) -> EntitySummary {
    let artists: Vec<&str> = album.artists.iter().map(|artist| artist.name.trim()).filter(|name| !name.is_empty()).collect();
    EntitySummary {
        uri,
        name: album.name.clone(),
        subtitle: (!artists.is_empty()).then(|| artists.join(", ")),
        cover_uri: cover_from_images(&album.cover_group).or_else(|| cover_from_images(&album.covers)),
        can_modify: None,
        library: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_warmup_ends_when_ready_or_after_a_bounded_wait() {
        assert!(wait_for_library(0, Duration::ZERO));
        assert!(wait_for_library(2, Duration::from_secs(59)));
        assert!(!wait_for_library(3, Duration::ZERO));
        assert!(!wait_for_library(0, Duration::from_secs(60)));
    }

    #[test]
    fn keeps_the_newest_few_and_the_last_one() {
        assert_eq!(newest((0..10).collect()).collect::<Vec<_>>(), vec![0, 1, 2, 9]);
        assert_eq!(newest(vec![7]).collect::<Vec<_>>(), vec![7]);
    }

    #[test]
    fn only_recent_releases_count() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 6).unwrap();
        assert!(recent(today, today));
        assert!(recent(today - chrono::Duration::days(MAX_AGE_DAYS), today));
        assert!(!recent(today - chrono::Duration::days(MAX_AGE_DAYS + 1), today));
        assert!(!recent(today + chrono::Duration::days(5), today));
    }
}
