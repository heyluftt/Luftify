import type {
  AnalyticsTrack,
  ArtistListeningStat,
  ListeningOverview,
} from "../analytics/analyticsTypes";

/** A look back: a week, a month, a year, a season or a milestone. */
export type RecapKind = "week" | "month" | "year" | "season" | "milestone";

export interface RecapPeriod {
  /** Stable across sessions: "week:2026-09-21", "month:2026-09" … */
  id: string;
  kind: RecapKind;
  fromMs: number;
  toMs: number;
  /** The span right before, for "more than last week". */
  previousFromMs?: number;
  /** "September 2026", "Woche vom 21. September", "100 Stunden Luftify" … */
  title: string;
  /** "Dein Monatsrückblick" … */
  eyebrow: string;
  /** The date range, written out. */
  dates: string;
  listeningMs: number;
  playCount: number;
  /** Finished recently and still worth pointing out. */
  fresh: boolean;
  /** The year so far (December): the final one follows in January. */
  provisional?: boolean;
}

export interface RecapTrackDay {
  track: AnalyticsTrack;
  dayStartMs: number;
  playCount: number;
}

export interface RecapDiscovery {
  track: AnalyticsTrack;
  playCount: number;
}

export interface RecapAlbum {
  albumUri?: string | null;
  albumName: string;
  coverUri?: string | null;
  artistName?: string | null;
  listeningMs: number;
  playCount: number;
}

export interface ListeningRecap {
  overview: ListeningOverview;
  previousListeningMs?: number | null;
  previousPlayCount?: number | null;
  newArtistCount: number;
  newTrackCount: number;
  topNewArtist?: ArtistListeningStat | null;
  topDiscovery?: RecapDiscovery | null;
  /** When the top song was heard for the very first time. */
  topTrackFirstHeardMs?: number | null;
  onRepeat?: RecapTrackDay | null;
  topAlbum?: RecapAlbum | null;
  historyStartedAtMs?: number | null;
}

/** What a period card shows before the story is opened. */
export interface RecapPreview {
  id: string;
  coverUris: string[];
  topTrackTitle?: string | null;
  topArtistName?: string | null;
}

export interface RecapPreviewRange {
  id: string;
  fromUnixMs: number;
  toUnixMs: number;
}

export interface RecapRequest {
  fromUnixMs: number;
  toUnixMs: number;
  previousFromUnixMs: number | null;
  timezoneOffsetMinutes: number;
}
