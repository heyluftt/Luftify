import type { MediaItem } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import type { DiscoverySeed } from "./discoverySeeds";
import { artistKey, type DiscoveryCandidate } from "./discoveryRanking";

// Per-generation caches and a hard network budget, including failed requests.
export function discoverySources(signal: AbortSignal) {
  const candidates: DiscoveryCandidate[] = [];
  const playlists = new Map<string, MediaItem[]>();
  const searches = new Map<string, string[]>();
  const processed = new Map<string, Set<string>>();
  const playlistCandidates = new Map<string, DiscoveryCandidate[]>();
  const artists = new Set<string>();
  let incomplete = false;
  const check = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  async function collect(seed: DiscoverySeed, depth = 2) {
    check();
    const weight = 1 + Math.min(3, Math.log2(1 + seed.completedCount));
    const key = artistKey(seed.creator);
    if (!artists.has(key)) {
      artists.add(key);
      if (seed.creator.uri?.startsWith("spotify:artist:")) {
        try {
          const artist = await desktopApi.artist(seed.creator.uri);
          check();
          for (const track of artist.popularTracks) candidates.push({ track, source: artist.uri, weight });
        } catch { check(); incomplete = true; }
      }
    }
    if (!searches.has(key)) {
      searches.set(key, []);
      try {
        const result = await desktopApi.search({ query: seed.creator.name, offset: 0, limit: 12 }, signal);
        check();
        searches.set(key, [...new Set(result.playlists.map((item) => item.uri))]);
      } catch { check(); incomplete = true; }
    }
    const visited = processed.get(key) ?? new Set<string>();
    processed.set(key, visited);
    for (const uri of searches.get(key)!.slice(0, depth)) {
      if (visited.has(uri)) continue;
      visited.add(uri);
      check();
      try {
        let tracks = playlists.get(uri);
        if (!tracks) {
          if (playlists.size >= 12) continue;
          playlists.set(uri, []);
          tracks = (await desktopApi.playlist(uri, { offset: 0, limit: 100 })).tracks;
          playlists.set(uri, tracks);
        }
        check();
        const matches = tracks.some((track) => track.creators.some((creator) =>
          artistKey(creator) === key || creator.name.trim().toLowerCase() === seed.creator.name.trim().toLowerCase()));
        if (matches) {
          const existing = playlistCandidates.get(uri);
          if (existing) {
            // Ranking uses the strongest weight per source, not repeated copies.
            for (const candidate of existing) candidate.weight = Math.max(candidate.weight, weight);
          } else {
            const added = tracks.map((track) => ({ track, source: uri, weight }));
            playlistCandidates.set(uri, added);
            candidates.push(...added);
          }
        }
      } catch { check(); incomplete = true; }
    }
  }
  return { candidates, collect, get incomplete() { return incomplete; } };
}
