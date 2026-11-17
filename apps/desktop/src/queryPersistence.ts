import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Keeps a few small, network-only Home sections across restarts, so Home is
 * complete at once instead of filling in once the engine is ready (and
 * staying empty while Spotify rate-limits the catalog). Everything else
 * already has a durable cache in the backend (library, playlists, mixes).
 *
 * Restored entries keep their original timestamp: once older than the
 * query's staleTime they are refreshed in the background as usual.
 */
const STORAGE_KEY = "luftify.query-cache.v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const SAVE_DELAY_MS = 2_000;

interface PersistedEntry {
  key: QueryKey;
  data: unknown;
  updatedAt: number;
}

function isPersisted(key: QueryKey): boolean {
  return key[0] === "home" && (key[1] === "new-releases" || key[1] === "release-radar-releases");
}

export function restorePersistedQueries(client: QueryClient): void {
  const now = Date.now();
  for (const entry of readEntries()) {
    if (!isPersisted(entry.key) || now - entry.updatedAt > MAX_AGE_MS) continue;
    client.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
  }
}

/** Saves the persisted queries shortly after one of them has new data. */
export function persistQueries(client: QueryClient): () => void {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    const entries: PersistedEntry[] = client.getQueryCache().getAll()
      .filter((query) => isPersisted(query.queryKey) && query.state.status === "success" && query.state.data !== undefined)
      .map((query) => ({ key: query.queryKey, data: query.state.data, updatedAt: query.state.dataUpdatedAt }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Storage full or blocked: Home simply loads these sections again.
    }
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!isPersisted(event.query.queryKey)) return;
    if (timer === undefined) timer = window.setTimeout(save, SAVE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

function readEntries(): PersistedEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function isEntry(value: unknown): value is PersistedEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PersistedEntry>;
  return Array.isArray(entry.key) && typeof entry.updatedAt === "number" && entry.data !== undefined;
}
