use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MediaSource {
    Spotify,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MediaItemType {
    Track,
    Episode,
    LocalTrack,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaCreator {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

/// Spotify identity from an existing playlist entry, not a Luftify friend id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlaylistContributor {
    pub username: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_uri: Option<String>,
    #[serde(default)]
    pub is_self: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaItem {
    pub uri: String,
    pub source: MediaSource,
    pub item_type: MediaItemType,
    pub title: String,
    pub creators: Vec<MediaCreator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist_entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_by: Option<PlaylistContributor>,
    pub explicit: bool,
    pub playable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RepeatMode {
    Off,
    All,
    One,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlaybackState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_item: Option<MediaItem>,
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f64,
    pub is_muted: bool,
    pub shuffle_enabled: bool,
    pub repeat_mode: RepeatMode,
    pub is_saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_uri: Option<String>,
    pub updated_at: String,
    /// False while a load is in flight so the UI clock does not run ahead of audio.
    #[serde(default = "default_clock_ready")]
    pub clock_ready: bool,
}

fn default_clock_ready() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EntitySummary {
    pub uri: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_modify: Option<bool>,
    /// Only on playlists from the listener's own library.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub library: Option<PlaylistLibraryInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlaylistOwner {
    Me,
    Spotify,
    Other,
}

/// What the library list knows about a playlist beyond its name and cover.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlaylistLibraryInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub track_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub owner: Option<PlaylistOwner>,
    /// When it entered the library, epoch milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub added_at: Option<i64>,
    /// Folder path in the listener's library ("Sport / Laufen").
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub folder: Option<String>,
    /// Everyone who follows it may add songs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub collaborative: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ArtistReleaseType {
    Album,
    Single,
    Ep,
    Compilation,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ArtistRelease {
    pub uri: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(default)]
    pub release_type: ArtistReleaseType,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artists: Vec<EntitySummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ArtistDiscographyCategoryStatus {
    Loaded,
    Failed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ArtistDiscographyStatus {
    pub albums: ArtistDiscographyCategoryStatus,
    pub singles: ArtistDiscographyCategoryStatus,
    pub compilations: ArtistDiscographyCategoryStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchRequest {
    pub query: String,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SearchResult {
    pub query: String,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
    pub tracks: Vec<MediaItem>,
    pub artists: Vec<EntitySummary>,
    pub albums: Vec<EntitySummary>,
    pub playlists: Vec<EntitySummary>,
    /// Spotify's best match on the first page; one of the listed URIs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub top_result_uri: Option<String>,
    pub unavailable: Vec<Capability>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PageRequest {
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub offset: u32,
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueueItem {
    pub item: MediaItem,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueueItemReference {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QueuePlacement {
    Before,
    After,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueueReorderRequest {
    pub moved: QueueItemReference,
    pub anchor: QueueItemReference,
    pub placement: QueuePlacement,
    pub expected_revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueueState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_item: Option<MediaItem>,
    pub items: Vec<QueueItem>,
    pub revision: u64,
    /// Full queue length when `items` is only the leading window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_items: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlaylistDetails {
    pub uri: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<PlaylistContributor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collaborative: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_modify: Option<bool>,
    pub tracks: Vec<MediaItem>,
    pub offset: u32,
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AlbumDetails {
    pub uri: String,
    pub name: String,
    pub artists: Vec<EntitySummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_uri: Option<String>,
    pub tracks: Vec<MediaItem>,
    pub offset: u32,
    pub limit: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u32>,
    pub has_more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ArtistDetails {
    pub uri: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_uri: Option<String>,
    pub popular_tracks: Vec<MediaItem>,
    pub albums: Vec<ArtistRelease>,
    pub singles: Vec<ArtistRelease>,
    #[serde(default)]
    pub compilations: Vec<ArtistRelease>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discography_status: Option<ArtistDiscographyStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Capability {
    #[serde(rename = "player.basic")]
    PlayerBasic,
    #[serde(rename = "player.seek")]
    PlayerSeek,
    #[serde(rename = "player.volume")]
    PlayerVolume,
    #[serde(rename = "player.mute")]
    PlayerMute,
    #[serde(rename = "player.shuffle")]
    PlayerShuffle,
    #[serde(rename = "player.repeat")]
    PlayerRepeat,
    #[serde(rename = "player.like")]
    PlayerLike,
    #[serde(rename = "queue.read")]
    QueueRead,
    #[serde(rename = "queue.add")]
    QueueAdd,
    #[serde(rename = "queue.remove")]
    QueueRemove,
    #[serde(rename = "queue.clear")]
    QueueClear,
    #[serde(rename = "queue.reorder")]
    QueueReorder,
    #[serde(rename = "search.tracks")]
    SearchTracks,
    #[serde(rename = "search.artists")]
    SearchArtists,
    #[serde(rename = "search.albums")]
    SearchAlbums,
    #[serde(rename = "search.playlists")]
    SearchPlaylists,
    #[serde(rename = "library.playlists")]
    LibraryPlaylists,
    #[serde(rename = "library.likedTracks")]
    LibraryLikedTracks,
    #[serde(rename = "library.savedAlbums")]
    LibrarySavedAlbums,
    #[serde(rename = "library.followedArtists")]
    LibraryFollowedArtists,
    #[serde(rename = "library.recent")]
    LibraryRecent,
    #[serde(rename = "playlist.read")]
    PlaylistRead,
    #[serde(rename = "playlist.play")]
    PlaylistPlay,
    #[serde(rename = "playlist.modify")]
    PlaylistModify,
    #[serde(rename = "artist.read")]
    ArtistRead,
    #[serde(rename = "album.read")]
    AlbumRead,
    #[serde(rename = "lyrics.read")]
    LyricsRead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PlayerCommand {
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
    Seek,
    SetVolume,
    ToggleMute,
    SetShuffle,
    SetRepeat,
    ToggleLike,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerCommandRequest {
    pub command: PlayerCommand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_mode: Option<RepeatMode>,
}

#[cfg(test)]
mod tests {
    use super::{ArtistDetails, ArtistDiscographyCategoryStatus, ArtistReleaseType};
    use serde_json::json;

    #[test]
    fn legacy_artist_releases_deserialize_without_new_discography_fields() {
        let details: ArtistDetails = serde_json::from_value(json!({
            "uri": "spotify:artist:legacy",
            "name": "Legacy Artist",
            "popularTracks": [],
            "albums": [{
                "uri": "spotify:album:legacy",
                "name": "Legacy Album",
                "coverUri": "spotify:image:legacy"
            }],
            "singles": []
        }))
        .expect("legacy artist details should remain readable");

        assert_eq!(details.albums[0].release_type, ArtistReleaseType::Unknown);
        assert!(details.compilations.is_empty());
        assert!(details.discography_status.is_none());
    }

    #[test]
    fn artist_discography_deserializes_release_metadata_and_partial_status() {
        let details: ArtistDetails = serde_json::from_value(json!({
            "uri": "spotify:artist:current",
            "name": "Current Artist",
            "popularTracks": [],
            "albums": [],
            "singles": [{
                "uri": "spotify:album:single",
                "name": "A Single",
                "releaseDate": "2026-08-08",
                "year": 2026,
                "releaseType": "ep",
                "artists": [{
                    "uri": "spotify:artist:current",
                    "name": "Current Artist"
                }]
            }],
            "compilations": [],
            "discographyStatus": {
                "albums": "failed",
                "singles": "loaded",
                "compilations": "unavailable"
            }
        }))
        .expect("current artist details should deserialize");

        assert_eq!(details.singles[0].release_type, ArtistReleaseType::Ep);
        let status = details
            .discography_status
            .expect("discography status should be retained");
        assert_eq!(status.albums, ArtistDiscographyCategoryStatus::Failed);
        assert_eq!(status.singles, ArtistDiscographyCategoryStatus::Loaded);
        assert_eq!(
            status.compilations,
            ArtistDiscographyCategoryStatus::Unavailable
        );
    }
}
