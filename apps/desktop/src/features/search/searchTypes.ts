import type { SearchResult } from "@luft/protocol-types";

export const SEARCH_CATEGORIES = [
  "all",
  "tracks",
  "artists",
  "albums",
  "playlists",
] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export type SearchCounts = Record<Exclude<SearchCategory, "all">, number> & {
  all: number;
};

export function isSearchCategory(value: string | null): value is SearchCategory {
  return SEARCH_CATEGORIES.includes(value as SearchCategory);
}

export function searchCounts(result: SearchResult | undefined): SearchCounts {
  const tracks = result?.tracks.length ?? 0;
  const artists = result?.artists.length ?? 0;
  const albums = result?.albums.length ?? 0;
  const playlists = result?.playlists.length ?? 0;

  return {
    all: tracks + artists + albums + playlists,
    tracks,
    artists,
    albums,
    playlists,
  };
}

export function normalizeSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
