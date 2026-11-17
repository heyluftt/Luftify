// Per-viewer conveniences only: without storage the notices simply show again.
const LATER_KEY = "luftify.update.later";
const SEEN_KEY = "luftify.version.seen";
const LATER_MS = 24 * 60 * 60_000;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* see above */ }
}

/** "Later" hides a version for a day, so nobody stays on an old one by accident. */
export function postponedUntil(version: string): number {
  try {
    const later = JSON.parse(read(LATER_KEY) ?? "null") as { version?: string; until?: number } | null;
    return later?.version === version && typeof later.until === "number" ? later.until : 0;
  } catch {
    return 0;
  }
}

export function postpone(version: string): number {
  const until = Date.now() + LATER_MS;
  write(LATER_KEY, JSON.stringify({ version, until }));
  return until;
}

/** The version whose "what's new" was last shown. */
export const seenVersion = () => read(SEEN_KEY);
export const markSeen = (version: string) => write(SEEN_KEY, version);
