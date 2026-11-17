import type { MediaItem } from "@luft/protocol-types";
import type { TrackListeningStat } from "../analytics/analyticsTypes";

export interface RecentEntry {
  item: MediaItem;
  playedAt: Date;
  plays: number;
}

export interface RecentDay {
  key: string;
  date: Date;
  entries: RecentEntry[];
}

export function recentTrackDays(stats: TrackListeningStat[]): RecentDay[] {
  const days = new Map<string, RecentDay>();
  for (const stat of stats) {
    const date = new Date(stat.lastPlayedAtMs);
    const key = dayKey(date);
    let group = days.get(key);
    if (!group) { group = { key, date, entries: [] }; days.set(key, group); }
    const track = stat.track;
    group.entries.push({
      item: {
        uri: track.uri, title: track.title, source: "spotify", itemType: "track",
        creators: track.creators.map(({ name, uri }) => ({ name, ...(uri ? { uri } : {}) })),
        ...(track.albumUri ? { albumUri: track.albumUri } : {}),
        ...(track.albumName ? { albumName: track.albumName } : {}),
        ...(track.coverUri ? { coverUri: track.coverUri } : {}),
        ...(track.durationMs != null ? { durationMs: track.durationMs } : {}),
        // The analytics snapshot does not retain the explicit flag.
        explicit: false, playable: true,
      },
      playedAt: date,
      plays: Math.max(stat.playCount, 1),
    });
  }
  return [...days.values()];
}

export type RecentDayLabel =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "weekday"; date: Date }
  | { kind: "date"; date: Date };

/** "Today", "Yesterday", the weekday within the last week, else the date. */
export function recentDayLabel(date: Date, now = new Date()): RecentDayLabel {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  if (days < 7) return { kind: "weekday", date };
  return { kind: "date", date };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
