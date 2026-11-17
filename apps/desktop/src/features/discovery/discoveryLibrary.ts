import { desktopApi } from "../../services/desktopApi";
import { isReleaseRadar, isWeeklyMix } from "../home/homeNames";
import type { DiscoveryCandidate } from "./discoveryRanking";
import type { MediaCreator, MediaItem } from "@luft/protocol-types";

// Optional local enrichment: never populate missing library caches over the network.
export async function readDiscoveryLibrary(signal: AbortSignal) {
  const excluded = new Set<string>();
  const candidates: DiscoveryCandidate[] = [];
  const artists = new Map<string, MediaCreator>();
  const remember = (track: MediaItem) => {
    excluded.add(track.uri);
    for (const creator of track.creators) {
      const name = creator.name.normalize("NFKC").trim().toLowerCase();
      if (name && (!artists.has(name) || creator.uri)) artists.set(name, creator);
    }
  };
  let incomplete = false;
  const check = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  check();
  try {
    const liked = await desktopApi.cachedLikedTracks({ offset: 0, limit: 50 });
    check();
    for (const track of liked?.items ?? []) remember(track);
  } catch { check(); incomplete = true; }
  try {
    const page = await desktopApi.cachedPlaylists({ offset: 0, limit: 50 });
    check();
    const items = [...new Map((page?.items ?? []).map((item) => [item.uri, item])).values()];
    const editable = items.filter((item) => item.canModify === true);
    const offset = Math.floor(Math.random() * editable.length);
    const owned = [...editable.slice(offset), ...editable.slice(0, offset)].slice(0, 6);
    // Reuse the app's name recognition, but don't mistake editable user playlists
    // with these names for Spotify discovery sources.
    const discovery = items.filter((item) => item.canModify === false && (isWeeklyMix(item) || isReleaseRadar(item))).slice(0, 2);
    for (const item of [...owned, ...discovery]) {
      check();
      try {
        const snapshot = await desktopApi.cachedPlaylistSnapshot(item.uri);
        check();
        if (item.canModify) {
          for (const track of snapshot?.tracks ?? []) remember(track);
        } else {
          for (const track of (snapshot?.tracks ?? []).slice(0, 100)) {
            candidates.push({ track, source: item.uri, weight: 2 });
          }
        }
      } catch { check(); incomplete = true; }
    }
  } catch { check(); incomplete = true; }
  return { excluded, candidates, artists: [...artists.values()], incomplete };
}
