import type { PaletteItem } from "./paletteTypes";

const STORAGE_KEY = "luftify.command-palette.history.v1";
const LIMIT = 40;

type Entry = {
  id: string;
  count: number;
  at: number;
  /** Songs, playlists and artists keep their row; commands are looked up again. */
  media?: PaletteItem;
};

function read(): Entry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((entry): entry is Entry => typeof entry?.id === "string" && typeof entry.count === "number")
      : [];
  } catch {
    return [];
  }
}

function write(entries: Entry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // Remembering is a convenience; the palette works without it.
  }
}

/** Values typed into the query ("laut 40"), the search fallback and unread links are not worth remembering. */
export function rememberPaletteRun(item: PaletteItem): void {
  if (item.group === "intent" || item.action.kind === "search" || item.action.kind === "link") return;
  const entries = read();
  const previous = entries.find((entry) => entry.id === item.id);
  const media = item.action.kind === "media" ? { ...item, group: "recent" as const } : undefined;
  write([
    { id: item.id, count: (previous?.count ?? 0) + 1, at: Date.now(), ...(media ? { media } : {}) },
    ...entries.filter((entry) => entry.id !== item.id),
  ]);
}

/** The latest runs, resolved against the current catalog so labels stay current. */
export function recentPaletteItems(catalog: PaletteItem[], limit = 5): PaletteItem[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return read()
    .sort((left, right) => right.at - left.at)
    .flatMap((entry) => {
      const item = entry.media ?? byId.get(entry.id);
      return item ? [{ ...item, group: "recent" as const, id: `recent:${item.id}` }] : [];
    })
    .slice(0, limit);
}

/**
 * Ranking bonus for often and recently used entries: at most 15 points.
 * `_revision` only ties a memo to the latest run.
 */
export function paletteUsageBoost(_revision?: number): (id: string) => number {
  const now = Date.now();
  const scores = new Map(read().map((entry) => {
    const days = (now - entry.at) / 86_400_000;
    return [entry.id, Math.min(15, Math.log2(1 + entry.count) * 4 + (days < 1 ? 4 : days < 7 ? 2 : 0))];
  }));
  return (id) => scores.get(id) ?? 0;
}

/** The id a recent row stands for, so running it counts for the original. */
export function originalPaletteId(id: string): string {
  return id.startsWith("recent:") ? id.slice("recent:".length) : id;
}
