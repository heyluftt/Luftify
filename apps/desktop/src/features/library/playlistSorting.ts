import { appLanguage } from "../../i18n";
import type { MediaItem, PlaylistDetails } from "@luft/protocol-types";

export type PlaylistSortField = "addedAt" | "playlistOrder" | "title" | "artist" | "album" | "duration";
export type PlaylistSortDirection = "asc" | "desc";

export interface PlaylistSort {
  field: PlaylistSortField;
  direction: PlaylistSortDirection;
}

export const DEFAULT_PLAYLIST_SORT: PlaylistSort = { field: "addedAt", direction: "desc" };

const STORAGE_KEY = "luft.playlist-sort.v1";
const MAX_SAVED_PLAYLISTS = 200;
const SORT_FIELDS = new Set<PlaylistSortField>(["addedAt", "playlistOrder", "title", "artist", "album", "duration"]);

interface StoredSort extends PlaylistSort {
  updatedAt: number;
}

export function sortPlaylistTracks(tracks: MediaItem[], sort: PlaylistSort): MediaItem[] {
  if (sort.field === "playlistOrder") return sort.direction === "asc" ? [...tracks] : [...tracks].reverse();
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      const comparison = compareTracks(left.track, right.track, sort);
      if (comparison !== 0) return comparison;
      return left.index - right.index;
    })
    .map(({ track }) => track);
}

export function playlistPlaybackTracks(
  details: Pick<PlaylistDetails, "tracks" | "total" | "hasMore">,
  sort: PlaylistSort,
): MediaItem[] | undefined {
  // A partial catalog would replace the full remote queue with only this page.
  if (details.hasMore || details.tracks.length < (details.total ?? details.tracks.length)) return undefined;
  return sortPlaylistTracks(details.tracks, sort);
}

export function readPlaylistSort(uri: string, storage: Pick<Storage, "getItem"> | undefined = browserStorage()): PlaylistSort {
  if (!storage) return DEFAULT_PLAYLIST_SORT;
  try {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return parseSort(stored[uri]) ?? DEFAULT_PLAYLIST_SORT;
  } catch {
    return DEFAULT_PLAYLIST_SORT;
  }
}

export function savePlaylistSort(uri: string, sort: PlaylistSort, storage: Pick<Storage, "getItem" | "setItem"> | undefined = browserStorage()): void {
  if (!storage || !uri) return;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    const entries = Object.entries(parsed)
      .filter(([key, value]) => key !== uri && parseSort(value))
      .sort(([, left], [, right]) => storedUpdatedAt(right) - storedUpdatedAt(left))
      .slice(0, MAX_SAVED_PLAYLISTS - 1);
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries([
      [uri, { ...sort, updatedAt: Date.now() } satisfies StoredSort],
      ...entries,
    ])));
  } catch {
    // A blocked or full WebView storage must never prevent playlist playback.
  }
}

export function formatAddedAt(value: string | undefined, now = new Date()): string {
  const timestamp = addedAtTimestamp(value);
  if (timestamp === undefined) return "—";
  const date = new Date(timestamp);
  const today = startOfLocalDay(now);
  const target = startOfLocalDay(date);
  const days = Math.round((today - target) / 86_400_000);
  if (days >= 0 && days < 7) {
    // Column cells start a line: "Heute", "Vor 3 Tagen" rather than "heute".
    const label = new Intl.RelativeTimeFormat(appLanguage(), { numeric: "auto" }).format(-days, "day");
    return label.charAt(0).toLocaleUpperCase(appLanguage()) + label.slice(1);
  }
  return new Intl.DateTimeFormat(appLanguage(), { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function compareTracks(left: MediaItem, right: MediaItem, sort: PlaylistSort): number {
  if (sort.field === "playlistOrder") return 0;
  const leftValue = sortValue(left, sort.field);
  const rightValue = sortValue(right, sort.field);
  if (leftValue === undefined && rightValue === undefined) return 0;
  if (leftValue === undefined) return 1;
  if (rightValue === undefined) return -1;
  const comparison = typeof leftValue === "number"
    ? leftValue - (rightValue as number)
    : leftValue.localeCompare(rightValue as string, "de", { sensitivity: "base", numeric: true });
  return sort.direction === "asc" ? comparison : -comparison;
}

const EARLIEST_ADDED_AT = Date.UTC(2008, 0, 1);

export function addedAtTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = /^\d{10,16}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  const timestamp =
    parsed >= 100_000_000_000_000
      ? Math.floor(parsed / 1_000)
      : parsed < 100_000_000_000
        ? Math.floor(parsed * 1_000)
        : parsed;
  const latest = Date.now() + 7 * 86_400_000;
  return timestamp >= EARLIEST_ADDED_AT && timestamp <= latest
    ? timestamp
    : undefined;
}

function sortValue(track: MediaItem, field: Exclude<PlaylistSortField, "playlistOrder">): string | number | undefined {
  switch (field) {
    case "addedAt":
      return addedAtTimestamp(track.addedAt);
    case "title": return track.title;
    case "artist": return track.creators[0]?.name;
    case "album": return track.albumName;
    case "duration": return track.durationMs;
  }
}

function parseSort(value: unknown): PlaylistSort | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.field !== "string" || !SORT_FIELDS.has(record.field as PlaylistSortField)) return undefined;
  if (record.direction !== "asc" && record.direction !== "desc") return undefined;
  return { field: record.field as PlaylistSortField, direction: record.direction };
}

function storedUpdatedAt(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const updatedAt = (value as Record<string, unknown>).updatedAt;
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}
