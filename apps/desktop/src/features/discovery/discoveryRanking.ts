import type { MediaItem } from "@luft/protocol-types";
import type { ListeningOverview } from "../analytics/analyticsTypes";
import { selectDiscovery } from "./discoverySelection";

export interface DiscoveryCandidate { track: MediaItem; source: string; weight: number }
export interface DiscoveryPick { track: MediaItem; novel: boolean; sources: number }
const normalize = (name: string) => name.normalize("NFKC").trim().toLowerCase();
export const artistKey = (artist: { name: string; uri?: string }) =>
  artist.uri || normalize(artist.name);

export function rankDiscovery(candidates: DiscoveryCandidate[], profile: ListeningOverview,
  previousTracks: ReadonlySet<string> = new Set(), random: () => number = Math.random,
  trackPenalty: (uri: string) => number = () => 0): DiscoveryPick[] {
  const aliases = new Map<string, string>();

  for (const { track } of candidates) for (const artist of track.creators) {
    if (artist.uri) aliases.set(normalize(artist.name), artist.uri);
  }
  const identity = (artist: { name: string; uri?: string }) => artist.uri || aliases.get(normalize(artist.name)) || normalize(artist.name);
  const knownNames = new Set(profile.topArtists.map(({ creator }) => normalize(creator.name)));
  const known = new Set(profile.topArtists.map(({ creator }) => artistKey(creator)));
  const heard = new Set(profile.topTracks.map(({ track }) => track.uri));
  for (const { track } of profile.topTracks) for (const artist of track.creators) {
    known.add(artistKey(artist)); knownNames.add(normalize(artist.name));
  }
  const pooled = new Map<string, { track: MediaItem; weights: Map<string, number> }>();
  for (const candidate of candidates) {
    if (!candidate.track.playable || !candidate.track.uri.startsWith("spotify:track:")
      || heard.has(candidate.track.uri) || !candidate.track.creators.length) continue;
    const entry = pooled.get(candidate.track.uri) ?? { track: candidate.track, weights: new Map() };
    entry.weights.set(candidate.source, Math.max(entry.weights.get(candidate.source) ?? 0, candidate.weight));
    pooled.set(candidate.track.uri, entry);
  }
  // A new artist that turns up across several taste sources is a stronger
  // lead than one lucky playlist hit.
  const artistSources = new Map<string, Set<string>>();
  for (const { track, weights } of pooled.values()) for (const artist of new Set(track.creators.map(identity))) {
    const seen = artistSources.get(artist) ?? new Set<string>();
    for (const source of weights.keys()) seen.add(source);
    artistSources.set(artist, seen);
  }
  const affinity = (artists: string[]) =>
    Math.min(2, Math.log2(Math.max(1, ...artists.map((artist) => artistSources.get(artist)?.size ?? 1))));
  const scored = [...pooled.values()].map(({ track, weights }) => {
    const novel = track.creators.every((artist) => !known.has(artistKey(artist)) && !knownNames.has(normalize(artist.name)));
    const artists = [...new Set(track.creators.map(identity))];
    return { track, novel, sources: weights.size, artists,
      score: [...weights.values()].reduce((a, b) => a + b, 0) + (novel ? 4 + affinity(artists) : 0)
        - (previousTracks.has(track.uri) ? 3 : 0) - trackPenalty(track.uri) + random() * .5 };
  });
  return selectDiscovery(scored, previousTracks);
}
