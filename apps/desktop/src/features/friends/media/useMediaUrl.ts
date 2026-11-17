import { useEffect, useState } from "react";
import { mediaApi, mediaType } from "./mediaApi";

interface Entry { url?: string; promise: Promise<string>; refs: number; timer?: number }

/** One object URL per media id, shared by everything showing it. */
const entries = new Map<string, Entry>();
/** Kept a little after the last use, so switching views does not reload. */
const LINGER_MS = 30_000;

function acquire(id: string): Entry {
  let entry = entries.get(id);
  if (!entry) {
    const created: Entry = {
      refs: 0,
      promise: mediaApi.load(id).then((bytes) => {
        created.url = URL.createObjectURL(new Blob([bytes], { type: mediaType(id) }));
        return created.url;
      }),
    };
    // A failed load is tried again next time.
    created.promise.catch(() => { if (entries.get(id) === created && !created.refs) entries.delete(id); });
    entries.set(id, created);
    entry = created;
  }
  window.clearTimeout(entry.timer);
  entry.refs++;
  return entry;
}

function release(id: string) {
  const entry = entries.get(id);
  if (!entry || --entry.refs > 0) return;
  entry.timer = window.setTimeout(() => {
    if (entry.refs > 0) return;
    entries.delete(id);
    if (entry.url) URL.revokeObjectURL(entry.url);
  }, LINGER_MS);
}

/** The playable URL of a profile media file, once it is loaded. */
export function useMediaUrl(id: string | null | undefined): string | undefined {
  const [loaded, setLoaded] = useState<{ id: string; url: string }>();
  useEffect(() => {
    if (!id) return;
    const entry = acquire(id);
    let live = true;
    entry.promise.then((url) => { if (live) setLoaded({ id, url }); }).catch(() => undefined);
    return () => { live = false; release(id); };
  }, [id]);
  return id && loaded?.id === id ? loaded.url : id ? entries.get(id)?.url : undefined;
}
