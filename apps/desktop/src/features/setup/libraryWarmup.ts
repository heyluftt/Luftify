import type { EntitySummary, PlaylistDetails } from "@luft/protocol-types";
import type { PlaylistUsage } from "../../types/tauri";
import { desktopApi } from "../../services/desktopApi";
import { canonicalPlaylistUri, playlistPlaceholderCount } from "../entities/playlistSnapshot";

/** How far setting up got; shown on the setup screen. */
export interface WarmupProgress { done: number; total: number; current?: string | undefined }

/** One playlist is filled in a few passes at most; the backend fetches songs in batches. */
const MAX_PASSES = 4;

/** Every song is there; a few Spotify has no details for may stay open. */
const loaded = (snapshot: PlaylistDetails | null | undefined): snapshot is PlaylistDetails =>
  Boolean(snapshot && !snapshot.hasMore && snapshot.tracks.length >= (snapshot.total ?? 0));
const complete = (snapshot: PlaylistDetails | null | undefined) =>
  loaded(snapshot) && playlistPlaceholderCount(snapshot) === 0;

/**
 * The playlists worth having ready: most played first, then the rest of the
 * library in its own order. Liked songs have their own path and are left out.
 */
export function warmupOrder(library: EntitySummary[], usage: PlaylistUsage[], limit: number): EntitySummary[] {
  const byUri = new Map(library.map((entry) => [canonicalPlaylistUri(entry.uri), entry]));
  const ordered: EntitySummary[] = [];
  const seen = new Set<string>();
  const add = (uri: string) => {
    const canonical = canonicalPlaylistUri(uri);
    const entry = byUri.get(canonical);
    if (!entry || seen.has(canonical) || canonical.includes(":collection")) return;
    seen.add(canonical);
    ordered.push(entry);
  };
  [...usage].sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt).forEach((entry) => add(entry.playlistUri));
  library.forEach((entry) => add(entry.uri));
  return ordered.slice(0, limit);
}

/**
 * Fills and stores the given playlists one after the other, so opening and
 * playing them later needs no waiting. Already complete ones are skipped.
 */
export async function warmPlaylists(playlists: EntitySummary[], options: {
  signal: AbortSignal;
  onProgress?: ((progress: WarmupProgress) => void) | undefined;
  onSnapshot?: (uri: string, snapshot: PlaylistDetails) => void;
  /** A pause between playlists, so Spotify is never asked too much at once. */
  pauseMs: number;
}): Promise<number> {
  let warmed = 0;
  for (const [index, playlist] of playlists.entries()) {
    if (options.signal.aborted) break;
    options.onProgress?.({ done: index, total: playlists.length, current: playlist.name });
    const stored = await desktopApi.cachedPlaylistSnapshot(playlist.uri).catch(() => null);
    // A stored, fully loaded playlist is ready; opening it refreshes it anyway.
    if (!loaded(stored)) {
      let previous: PlaylistDetails | undefined;
      for (let pass = 0; pass < MAX_PASSES && !options.signal.aborted; pass += 1) {
        const snapshot = await desktopApi.playlistSnapshot(playlist.uri).catch(() => null);
        if (!snapshot) break;
        options.onSnapshot?.(playlist.uri, snapshot);
        if (complete(snapshot) || (previous && !improved(previous, snapshot))) break;
        previous = snapshot;
      }
      warmed += 1;
      if (options.pauseMs > 0) await pause(options.pauseMs, options.signal);
    }
  }
  options.onProgress?.({ done: playlists.length, total: playlists.length });
  return warmed;
}

/** Another pass is only worth it while the last one brought songs or details. */
function improved(before: PlaylistDetails, after: PlaylistDetails) {
  return after.tracks.length > before.tracks.length || playlistPlaceholderCount(after) < playlistPlaceholderCount(before);
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  });
}
