// Versioned contract mirror exported from the Rust protocol crate.
export const MAX_SEARCH_QUERY_LENGTH = 200;

export type MediaSource = "spotify" | "local";
export type MediaItemType = "track" | "episode" | "localTrack";
export type RepeatMode = "off" | "all" | "one";
export type Capability =
  | "player.basic" | "player.seek" | "player.volume" | "player.mute"
  | "player.shuffle" | "player.repeat" | "player.like"
  | "queue.read" | "queue.add" | "queue.remove" | "queue.clear" | "queue.reorder"
  | "search.tracks" | "search.artists" | "search.albums" | "search.playlists"
  | "library.playlists" | "library.likedTracks" | "library.savedAlbums"
  | "library.followedArtists" | "library.recent" | "playlist.read"
  | "playlist.play" | "playlist.modify" | "artist.read" | "album.read" | "lyrics.read";

export interface MediaCreator { name: string; uri?: string }
export interface PlaylistContributor {
  username: string;
  displayName?: string;
  avatarUri?: string;
  isSelf: boolean;
}
export interface MediaItem {
  uri: string;
  source: MediaSource;
  itemType: MediaItemType;
  title: string;
  creators: MediaCreator[];
  albumName?: string;
  albumUri?: string;
  durationMs?: number;
  playCount?: number;
  coverUri?: string;
  canvasUrl?: string;
  addedAt?: string;
  playlistEntryId?: string;
  addedBy?: PlaylistContributor;
  explicit: boolean;
  playable: boolean;
}
export interface PlaybackState {
  currentItem?: MediaItem;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  isMuted: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  isSaved: boolean;
  contextUri?: string;
  updatedAt: string;
  clockReady?: boolean;
}
export type PlaybackStatePatch = Partial<PlaybackState>;
export interface PlayerProgressEvent {
  positionMs: number;
  durationMs?: number;
  trackUri?: string;
  eventTimestampMs: number;
}
export interface PlayerShuffleChangedEvent {
  enabled: boolean;
  eventTimestampMs: number;
}
export interface PlayerRepeatChangedEvent {
  mode: RepeatMode;
  eventTimestampMs: number;
}
export interface PlayerVolumeChangedEvent {
  volume: number;
  isMuted: boolean;
  eventTimestampMs: number;
}
export interface EntitySummary {
  uri: string;
  name: string;
  subtitle?: string;
  coverUri?: string;
  canModify?: boolean;
  /** Only on playlists from the listener's own library. */
  library?: PlaylistLibraryInfo;
}
export type PlaylistOwner = "me" | "spotify" | "other";
export interface PlaylistLibraryInfo {
  trackCount?: number;
  owner?: PlaylistOwner;
  /** When it entered the library, epoch milliseconds. */
  addedAt?: number;
  /** Folder path in the listener's library ("Sport / Laufen"). */
  folder?: string;
  /** Everyone who follows it may add songs. */
  collaborative?: boolean;
}
export type ArtistReleaseType =
  | "album"
  | "single"
  | "ep"
  | "compilation"
  | "unknown";
export interface ArtistRelease extends EntitySummary {
  releaseDate?: string;
  year?: number;
  releaseType: ArtistReleaseType;
  artists?: EntitySummary[];
}
export type ArtistDiscographyCategoryStatus =
  | "loaded"
  | "failed"
  | "unavailable";
export interface ArtistDiscographyStatus {
  albums: ArtistDiscographyCategoryStatus;
  singles: ArtistDiscographyCategoryStatus;
  compilations: ArtistDiscographyCategoryStatus;
}
export interface SearchRequest { query: string; offset: number; limit: number }
export interface SearchResult {
  query: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  tracks: MediaItem[];
  artists: EntitySummary[];
  albums: EntitySummary[];
  playlists: EntitySummary[];
  /** Spotify's best match on the first page; one of the listed URIs. */
  topResultUri?: string;
  unavailable: Capability[];
}
export interface PageRequest { offset: number; limit: number }
export interface Page<T> { items: T[]; offset: number; limit: number; total?: number; hasMore: boolean }
export interface QueueItem {
  item: MediaItem;
  uid?: string;
}
export interface QueueItemReference {
  uri: string;
  uid?: string;
}
export type QueuePlacement = "before" | "after";
export interface QueueReorderRequest {
  moved: QueueItemReference;
  anchor: QueueItemReference;
  placement: QueuePlacement;
  expectedRevision: number;
}
export interface QueueState {
  currentItem?: MediaItem;
  items: QueueItem[];
  revision: number;
  /** Full length when `items` is only the leading window (Libre). */
  totalItems?: number;
}
export interface PlaylistDetails {
  uri: string;
  name: string;
  ownerName?: string;
  owner?: PlaylistContributor;
  collaborative?: boolean;
  description?: string;
  coverUri?: string;
  canModify?: boolean;
  tracks: MediaItem[];
  offset: number;
  limit: number;
  total?: number;
  hasMore: boolean;
}
export interface AlbumDetails {
  uri: string;
  name: string;
  artists: EntitySummary[];
  year?: number;
  coverUri?: string;
  tracks: MediaItem[];
  offset: number;
  limit: number;
  total?: number;
  hasMore: boolean;
}
export interface ArtistDetails {
  uri: string;
  name: string;
  imageUri?: string;
  popularTracks: MediaItem[];
  albums: ArtistRelease[];
  singles: ArtistRelease[];
  compilations: ArtistRelease[];
  discographyStatus?: ArtistDiscographyStatus;
}
export type PlayerCommand = "toggle" | "play" | "pause" | "next" | "previous" | "seek" | "setVolume" | "toggleMute" | "setShuffle" | "setRepeat" | "toggleLike";
export interface PlayerCommandRequest {
  command: PlayerCommand;
  value?: number;
  enabled?: boolean;
  repeatMode?: RepeatMode;
}
