import type { MediaItem } from "@luft/protocol-types";
import { useEffect, useMemo, useState } from "react";

const key = (uri: string) => `luftify.playlist-seen.v1.${uri}`;
/** A short look is enough to count as seen; a misclick past the page is not. */
const SEEN_AFTER_MS = 4_000;

function read(uri: string): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(key(uri)));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function write(uri: string, at: number) {
  try {
    window.localStorage.setItem(key(uri), String(at));
  } catch {
    // Remembering visits is a convenience only.
  }
}

export const trackEntryKey = (track: Pick<MediaItem, "uri" | "playlistEntryId">) => track.playlistEntryId ?? track.uri;

/**
 * In a shared playlist: songs others added since your last visit. The first
 * visit marks nothing; the marks stay while you are on the page.
 */
export function usePlaylistNews(uri: string, tracks: MediaItem[], active: boolean) {
  const [since, setSince] = useState<number | undefined>(undefined);
  useEffect(() => {
    setSince(read(uri));
    if (!active) return;
    const timer = window.setTimeout(() => write(uri, Date.now()), SEEN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [uri, active]);
  const fresh = useMemo(() => {
    if (!active || !since) return new Set<string>();
    return new Set(tracks
      .filter((track) => track.addedBy && !track.addedBy.isSelf && track.addedAt && Date.parse(track.addedAt) > since)
      .map(trackEntryKey));
  }, [active, since, tracks]);
  return fresh;
}
