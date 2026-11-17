const STORAGE_KEY = "luftplayer.lyrics.fallbacks.v1";
const MAX_ENTRIES = 256;

const NOT_FOUND_TTL_MS = 14 * 24 * 60 * 60_000;
const TEMPORARILY_UNAVAILABLE_TTL_MS = 30 * 60_000;

export type LyricsFallbackReason =
  | "not-found"
  | "temporarily-unavailable";

interface LyricsFallbackEntry {
  expiresAtMs: number;
  key: string;
  reason: LyricsFallbackReason;
}

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function lyricsFallbackCacheKey(
  trackUri: string | undefined,
): string | undefined {
  const normalized = trackUri?.trim();
  if (!normalized) {
    return undefined;
  }

  // Track URIs can contain local paths. Persist only a compact fingerprint so
  // the availability hint does not copy those paths into localStorage.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }

  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function readLyricsFallback(
  key: string | undefined,
  now = Date.now(),
  storage = browserStorage(),
): LyricsFallbackReason | undefined {
  if (!key || !storage) {
    return undefined;
  }

  const entries = readEntries(storage);
  return entries.find(
    (entry) => entry.key === key && entry.expiresAtMs > now,
  )?.reason;
}

export function rememberLyricsFallback(
  key: string | undefined,
  reason: LyricsFallbackReason,
  now = Date.now(),
  storage = browserStorage(),
): void {
  if (!key || !storage) {
    return;
  }

  const lifetime = reason === "not-found"
    ? NOT_FOUND_TTL_MS
    : TEMPORARILY_UNAVAILABLE_TTL_MS;
  const entry: LyricsFallbackEntry = {
    expiresAtMs: now + lifetime,
    key,
    reason,
  };
  const entries = readEntries(storage)
    .filter((candidate) =>
      candidate.key !== key && candidate.expiresAtMs > now
    );

  writeEntries(storage, [entry, ...entries].slice(0, MAX_ENTRIES));
}

export function forgetLyricsFallback(
  key: string | undefined,
  storage = browserStorage(),
): void {
  if (!key || !storage) {
    return;
  }

  const entries = readEntries(storage);
  const next = entries.filter((entry) => entry.key !== key);
  if (next.length !== entries.length) {
    writeEntries(storage, next);
  }
}

export function clearLyricsFallbacks(
  storage = browserStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Availability hints are optional and may live in blocked storage.
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readEntries(storage: StorageLike): LyricsFallbackEntry[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(isLyricsFallbackEntry);
  } catch {
    return [];
  }
}

function writeEntries(
  storage: StorageLike,
  entries: LyricsFallbackEntry[],
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Availability hints are optional and must never block the lyrics page.
  }
}

function isLyricsFallbackEntry(
  value: unknown,
): value is LyricsFallbackEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<LyricsFallbackEntry>;
  return typeof entry.key === "string" &&
    typeof entry.expiresAtMs === "number" &&
    Number.isFinite(entry.expiresAtMs) &&
    (entry.reason === "not-found" ||
      entry.reason === "temporarily-unavailable");
}
