const STORAGE_KEY = "luftify.recaps.seen.v1";
const LIMIT = 200;

/** Recaps already watched on this device; a convenience, so storage may fail. */
export function seenRecaps(): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function markRecapSeen(id: string): void {
  try {
    const seen = [id, ...[...seenRecaps()].filter((entry) => entry !== id)].slice(0, LIMIT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
    window.dispatchEvent(new Event("luftify:recaps-seen"));
  } catch {
    // Without storage the recap simply stays marked as new.
  }
}
