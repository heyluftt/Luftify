export type AnalyticsRangeKey =
  | "today"
  | "sevenDays"
  | "thisMonth"
  | "ninetyDays"
  | "thisYear"
  | "all";

export interface AnalyticsRangeRequest {
  fromUnixMs: number;
  toUnixMs: number;
  limit: number;
  timezoneOffsetMinutes: number;
}

export interface AnalyticsCreator {
  name: string;
  uri?: string;
}

export interface AnalyticsTrack {
  uri: string;
  itemType: string;
  title: string;
  creators: AnalyticsCreator[];
  albumUri?: string;
  albumName?: string;
  durationMs?: number;
  coverUri?: string;
}

export interface TrackListeningStat {
  track: AnalyticsTrack;
  listeningMs: number;
  sessionCount: number;
  playCount: number;
  completedCount: number;
  lastPlayedAtMs: number;
}

export interface ArtistListeningStat {
  creator: AnalyticsCreator;
  listeningMs: number;
  sessionCount: number;
  playCount: number;
  completedCount: number;
  lastPlayedAtMs: number;
}

export interface PlaylistListeningStat {
  playlistUri: string;
  playlistName?: string;
  listeningMs: number;
  sessionCount: number;
  playCount: number;
  completedCount: number;
  lastPlayedAtMs: number;
}

export interface DailyListeningActivity {
  dayStartMs: number;
  listeningMs: number;
  sessionCount: number;
  playCount: number;
}

/** Listening time by local hour of day, summed over the range. */
export interface HourlyListeningActivity {
  hour: number;
  listeningMs: number;
  playCount: number;
}

export interface ListeningBehavior {
  /** Listening time per started title, early skips included. */
  averageSessionMs: number;
  /** Listening time per counted play; early skips do not dilute it. */
  averagePlayMs?: number;
  longestSessionMs: number;
  skipCount: number;
  seekCount: number;
  pauseCount: number;
  repeatCount: number;
  activeDayCount: number;
  completionRate: number;
}

/** Raw local signals per title; only titles with stored sessions are returned. */
export interface TrackListeningFeedback {
  uri: string;
  qualifiedPlayCount: number;
  completedCount: number;
  /** Early exits; pass-through clicks of a few seconds are not counted. */
  skipCount: number;
  lastQualifiedAtMs?: number | null;
  lastSkippedAtMs?: number | null;
  maxListenedMs: number;
  durationMs?: number | null;
}

export interface ListeningOverview {
  fromUnixMs: number;
  toUnixMs: number;
  totalListeningMs: number;
  sessionCount: number;
  qualifiedPlayCount: number;
  completedPlayCount: number;
  uniqueTrackCount: number;
  uniqueArtistCount: number;
  uniquePlaylistCount: number;
  topTracks: TrackListeningStat[];
  topArtists: ArtistListeningStat[];
  topPlaylists: PlaylistListeningStat[];
  dailyActivity: DailyListeningActivity[];
  hourlyActivity?: HourlyListeningActivity[];
  behavior: ListeningBehavior;
}

export interface AnalyticsRange {
  key: AnalyticsRangeKey;
  label: string;
  request: AnalyticsRangeRequest;
}
