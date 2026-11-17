import { t, appLanguage } from "../../i18n";
import type { EntitySummary } from "@luft/protocol-types";
import type { PlaylistUsage } from "../../types/tauri";
import { matchesEveryWord } from "../textMatch";

export const LIKED_COLLECTION_URI = "spotify:collection:tracks";

const usageDateFormatter = new Intl.DateTimeFormat(appLanguage(), {
  day: "2-digit",
  month: "2-digit",
});
const usageCountFormatter = new Intl.NumberFormat(appLanguage(), {
  maximumFractionDigits: 0,
});

const relative = new Intl.RelativeTimeFormat(appLanguage(), { style: "short" });

export const LIBRARY_PLAYLIST_SORTS = [
  "smart",
  "recent",
  "most-played",
  "added",
  "library",
  "name-asc",
  "name-desc",
  "size",
] as const;

export type LibraryPlaylistSort = (typeof LIBRARY_PLAYLIST_SORTS)[number];

/** Who a library playlist belongs to, for the owner chips. */
export type PlaylistOwnerGroup = "mine" | "followed" | "spotify";

export function playlistOwnerGroup(item: EntitySummary): PlaylistOwnerGroup {
  const owner = item.library?.owner;
  if (owner === "spotify") return "spotify";
  if (owner === "me") return "mine";
  if (owner === "other") return "followed";
  // Older caches carry no owner; editable playlists are the listener's.
  return item.canModify ? "mine" : "followed";
}

/** Every word in name, owner or folder; case and accents do not matter. */
export function filterPlaylists(
  items: EntitySummary[],
  query: string,
): EntitySummary[] {
  if (!query.trim()) return items;
  return items.filter((item) =>
    matchesEveryWord(query, item.name, item.subtitle, item.library?.folder),
  );
}

/** "Von dir · 42 Titel", "Spotify · 50 Titel" or just the size. */
export function playlistDetail(item: EntitySummary): string {
  const owner = item.library?.owner === "spotify"
    ? "Spotify"
    : playlistOwnerGroup(item) === "mine" && item.library?.owner !== undefined
      ? t("libraryUi.byYou")
      : undefined;
  const count = item.library?.trackCount;
  const size = count === undefined ? undefined : formatTrackCount(count);
  return [owner, size].filter(Boolean).join(" · ") || t("search.kind.playlist");
}

export function formatPlaylistCount(
  visible: number,
  total: number,
  filtering: boolean,
): string {
  const count = usageCountFormatter.format(total);
  if (filtering) {
    return t(total === 1 ? "libraryUi.filteredPlaylistsOne" : "libraryUi.filteredPlaylists", {
      visible: usageCountFormatter.format(visible), count,
    });
  }
  return t(total === 1 ? "libraryUi.playlistCountOne" : "libraryUi.playlistCount", { count });
}

export function formatTrackCount(count: number): string {
  return t(count === 1 ? "libraryUi.trackCountOne" : "libraryUi.trackCount", {
    count: usageCountFormatter.format(count),
  });
}

export function formatFilteredTrackCount(visible: number, total: number): string {
  return t(total === 1 ? "libraryUi.filteredTracksOne" : "libraryUi.filteredTracks", {
    visible: usageCountFormatter.format(visible),
    count: usageCountFormatter.format(total),
  });
}

export function isWritableLibraryPlaylist(playlist: {
  uri: string;
  canModify?: boolean;
}): boolean {
  if (playlist.canModify === false) return false;
  if (playlist.canModify === true) return true;
  const id = playlist.uri.split(":").pop() ?? "";
  return playlist.uri.includes(":playlist:") && !id.startsWith("37i9dQZF");
}

export function sortPlaylists(
  items: EntitySummary[],
  sort: LibraryPlaylistSort,
  usage: PlaylistUsage[] = [],
  nowUnixSeconds = Math.floor(Date.now() / 1_000),
): EntitySummary[] {
  if (sort === "library") return items;
  if (sort === "added") {
    // Unknown dates keep their library position after the dated ones.
    return items
      .map((item, index) => ({ item, index, at: item.library?.addedAt ?? -1 }))
      .sort((left, right) => right.at - left.at || left.index - right.index)
      .map(({ item }) => item);
  }
  if (sort === "size") {
    return items
      .map((item, index) => ({ item, index, size: item.library?.trackCount ?? -1 }))
      .sort((left, right) => right.size - left.size || left.index - right.index)
      .map(({ item }) => item);
  }
  const usageByUri = new Map(usage.map((entry) => [entry.playlistUri, entry]));
  const ranked = items
    .map((item, index) => ({ item, index, usage: usageByUri.get(item.uri) }))
    .sort((left, right) => {
      if (sort === "smart") {
        const difference = smartUsageScore(right.usage, nowUnixSeconds)
          - smartUsageScore(left.usage, nowUnixSeconds);
        if (difference !== 0) return difference;
        const recency = (right.usage?.lastPlayedAt ?? 0) - (left.usage?.lastPlayedAt ?? 0);
        if (recency !== 0) return recency;
      }
      if (sort === "recent") {
        const recency = (right.usage?.lastPlayedAt ?? 0) - (left.usage?.lastPlayedAt ?? 0);
        if (recency !== 0) return recency;
        const frequency = (right.usage?.playCount ?? 0) - (left.usage?.playCount ?? 0);
        if (frequency !== 0) return frequency;
      }
      if (sort === "most-played") {
        const frequency = (right.usage?.playCount ?? 0) - (left.usage?.playCount ?? 0);
        if (frequency !== 0) return frequency;
        const recency = (right.usage?.lastPlayedAt ?? 0) - (left.usage?.lastPlayedAt ?? 0);
        if (recency !== 0) return recency;
      }
      if (sort === "smart" || sort === "recent" || sort === "most-played") {
        return left.index - right.index;
      }
      const comparison = left.item.name.localeCompare(right.item.name, appLanguage(), {
        sensitivity: "base",
        numeric: true,
      });
      if (comparison !== 0) {
        return sort === "name-desc" ? -comparison : comparison;
      }
      return left.index - right.index;
    });
  return ranked.map(({ item }) => item);
}

export function playlistUsageDescription(
  playlistUri: string,
  usage: PlaylistUsage[],
  nowUnixSeconds = Math.floor(Date.now() / 1_000),
): string | undefined {
  const entry = usage.find((item) => item.playlistUri === playlistUri);
  if (!entry) return undefined;
  const count = Math.max(0, entry.playCount);
  const countLabel = t(count === 1 ? "libraryUi.playCountOne" : "libraryUi.playCount", {
    count: usageCountFormatter.format(count),
  });
  if (entry.lastPlayedAt <= 0) return countLabel;

  const elapsed = Math.max(0, nowUnixSeconds - entry.lastPlayedAt);
  const day = 24 * 60 * 60;
  let recency: string;
  if (elapsed < 5 * 60) recency = t("libraryUi.justPlayed");
  else if (elapsed < 60 * 60) recency = relative.format(-Math.max(1, Math.floor(elapsed / 60)), "minute");
  else if (elapsed < day) recency = relative.format(-Math.max(1, Math.floor(elapsed / (60 * 60))), "hour");
  else if (elapsed < 7 * day) recency = relative.format(-Math.max(1, Math.floor(elapsed / day)), "day");
  else recency = t("libraryUi.lastPlayed", { date: usageDateFormatter.format(new Date(entry.lastPlayedAt * 1_000)) });
  return `${recency} · ${countLabel}`;
}

function smartUsageScore(
  usage: PlaylistUsage | undefined,
  nowUnixSeconds: number,
): number {
  if (!usage) return -1;
  const playCount = Math.max(0, usage.playCount);
  const ageDays = usage.lastPlayedAt > 0
    ? Math.max(0, nowUnixSeconds - usage.lastPlayedAt) / (24 * 60 * 60)
    : 365;
  const recency = Math.max(0, 1 - ageDays / 90) * 85;
  const frequency = Math.min(95, Math.log2(playCount + 1) * 24);
  const activeHabit = playCount >= 3 && ageDays <= 30 ? 15 : 0;
  return recency + frequency + activeHabit;
}
