import { hitUri, matchKey, type SearchHit } from "./searchRanking";

const STORAGE_KEY = "luftplayer.search-history.v1";
const PICKS_KEY = "luftplayer.search-picks.v1";
const HISTORY_LIMIT = 8;
const PICKS_LIMIT = 8;

export function readSearchHistory(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/**
 * Remembers `query` at the top. `previous` is the query remembered just
 * before in this session: while typing "kan", "kany", "kanye" only the last
 * one should stay, so a previous prefix (or extension) is replaced.
 */
export function rememberSearchQuery(query: string, previous?: string): string[] {
  const key = matchKey(query);
  const previousKey = previous ? matchKey(previous) : "";
  const replacesPrevious = previousKey !== ""
    && (key.startsWith(previousKey) || previousKey.startsWith(key));
  const next = [
    query,
    ...readSearchHistory().filter((entry) => {
      const entryKey = matchKey(entry);
      return entryKey !== key && !(replacesPrevious && entryKey === previousKey);
    }),
  ].slice(0, HISTORY_LIMIT);
  return write(STORAGE_KEY, next) ? next : readSearchHistory();
}

export function forgetSearchQuery(query: string): string[] {
  const next = readSearchHistory().filter((entry) => entry !== query);
  return write(STORAGE_KEY, next) ? next : readSearchHistory();
}

/** Results opened or played from search, newest first. */
export function readSearchPicks(): SearchHit[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PICKS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isHit).slice(0, PICKS_LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberSearchPick(hit: SearchHit): SearchHit[] {
  const uri = hitUri(hit);
  const next = [hit, ...readSearchPicks().filter((entry) => hitUri(entry) !== uri)].slice(0, PICKS_LIMIT);
  return write(PICKS_KEY, next) ? next : readSearchPicks();
}

export function forgetSearchPick(uri: string): SearchHit[] {
  const next = readSearchPicks().filter((entry) => hitUri(entry) !== uri);
  return write(PICKS_KEY, next) ? next : readSearchPicks();
}

export function clearSearchHistory(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PICKS_KEY);
  } catch {
    // Search remains usable even when local storage is unavailable.
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function isHit(value: unknown): value is SearchHit {
  if (!value || typeof value !== "object") return false;
  const hit = value as Partial<{ kind: string; track: { uri?: unknown }; entry: { uri?: unknown } }>;
  if (hit.kind === "tracks") return typeof hit.track?.uri === "string";
  return (hit.kind === "artists" || hit.kind === "albums" || hit.kind === "playlists")
    && typeof hit.entry?.uri === "string";
}
