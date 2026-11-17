import type { EntitySummary, MediaItem, SearchResult } from "@luft/protocol-types";
import { matchKey, matchesEveryWord } from "../textMatch";
import type { SearchEntityCategory } from "./searchEntityKind";

export type SearchHit =
  | { kind: "tracks"; track: MediaItem }
  | { kind: SearchEntityCategory; entry: EntitySummary };

export { matchKey } from "../textMatch";

/**
 * Spotify's own top hit when it sent one. Otherwise an exact name match
 * (artist before album before playlist before track), then the first track.
 */
export function pickTopResult(data: SearchResult): SearchHit | undefined {
  const hits = allHits(data);
  if (data.topResultUri) {
    const top = hits.find((hit) => hitUri(hit) === data.topResultUri);
    if (top) return top;
  }
  const needle = matchKey(data.query);
  return hits.find((hit) => matchKey(hitName(hit)) === needle)
    ?? (data.tracks[0] ? { kind: "tracks", track: data.tracks[0] } : undefined)
    ?? hits[0];
}

/** Own playlists whose name contains every word of the query. */
export function matchLibraryPlaylists(
  playlists: readonly EntitySummary[],
  query: string,
  limit = 6,
): EntitySummary[] {
  if (!matchKey(query)) return [];
  return playlists
    .filter((playlist) => matchesEveryWord(query, playlist.name))
    .slice(0, limit);
}

export function hitUri(hit: SearchHit): string {
  return hit.kind === "tracks" ? hit.track.uri : hit.entry.uri;
}

export function hitName(hit: SearchHit): string {
  return hit.kind === "tracks" ? hit.track.title : hit.entry.name;
}

function allHits(data: SearchResult): SearchHit[] {
  return [
    ...data.artists.map((entry) => ({ kind: "artists", entry }) as const),
    ...data.albums.map((entry) => ({ kind: "albums", entry }) as const),
    ...data.playlists.map((entry) => ({ kind: "playlists", entry }) as const),
    ...data.tracks.map((track) => ({ kind: "tracks", track }) as const),
  ];
}
