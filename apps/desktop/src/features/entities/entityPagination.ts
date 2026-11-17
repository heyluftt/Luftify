import type { AlbumDetails, PlaylistDetails } from "@luft/protocol-types";

export function combinePlaylistPages(
  pages: PlaylistDetails[] | undefined,
): PlaylistDetails | undefined {
  if (!pages?.length) return undefined;

  const first = pages[0]!;
  const last = pages.at(-1)!;

  return {
    ...first,
    tracks: pages.flatMap((page) => page.tracks),
    limit: pages.reduce((sum, page) => sum + page.limit, 0),
    hasMore: last.hasMore,
  };
}

export function combineAlbumPages(
  pages: AlbumDetails[] | undefined,
): AlbumDetails | undefined {
  if (!pages?.length) return undefined;

  const first = pages[0]!;
  const last = pages.at(-1)!;

  return {
    ...first,
    tracks: pages.flatMap((page) => page.tracks),
    limit: pages.reduce((sum, page) => sum + page.limit, 0),
    hasMore: last.hasMore,
  };
}
