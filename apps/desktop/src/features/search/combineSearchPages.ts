import type { SearchResult } from "@luft/protocol-types";

export function combineSearchPages(
  pages: SearchResult[] | undefined,
): SearchResult | undefined {
  if (!pages?.length) {
    return undefined;
  }

  const last = pages.at(-1)!;

  return {
    ...pages[0]!,
    tracks: unique(
      pages.flatMap((page) => page.tracks),
    ),
    artists: unique(
      pages.flatMap((page) => page.artists),
    ),
    albums: unique(
      pages.flatMap((page) => page.albums),
    ),
    playlists: unique(
      pages.flatMap((page) => page.playlists),
    ),
    limit: pages.reduce(
      (sum, page) => sum + page.limit,
      0,
    ),
    hasMore: last.hasMore,
    unavailable: [
      ...new Set(
        pages.flatMap(
          (page) => page.unavailable,
        ),
      ),
    ],
  };
}

function unique<T extends { uri: string }>(
  items: T[],
): T[] {
  const seen = new Set<string>();

  return items.filter(
    (item) =>
      !seen.has(item.uri) &&
      Boolean(seen.add(item.uri)),
  );
}

/**
 * Whether the next page can still add to `category`. `hasMore` alone is true
 * while any kind has more, so the artist view would keep loading pages of
 * tracks; a kind is done once its part of the last page came back short.
 */
export function categoryHasMore(
  pages: SearchResult[] | undefined,
  category: "all" | "tracks" | "artists" | "albums" | "playlists",
): boolean {
  const last = pages?.at(-1);
  if (!last?.hasMore) return false;
  if (category === "all") return true;
  return last[category].length >= last.limit;
}
