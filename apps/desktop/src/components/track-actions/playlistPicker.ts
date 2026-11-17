import type {
  EntitySummary,
  Page,
  PlaylistDetails,
} from "@luft/protocol-types";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { isWritableLibraryPlaylist } from "../../features/library/libraryPresentation";
import { canonicalPlaylistUri } from "../../features/entities/playlistSnapshot";
import { desktopApi } from "../../services/desktopApi";

const PAGE_SIZE = 50;

export function rememberPlaylistPickerItems(items: EntitySummary[], verifiedOnly = false): EntitySummary[] {
  return writablePlaylists(items, verifiedOnly);
}

export function initialPlaylistPickerItems(queryClient: QueryClient): EntitySummary[] {
  const cached = queryClient.getQueryData<Page<EntitySummary> | null>([
    "library-cache",
    "playlists",
    0,
    50,
  ]);
  const remote = [
    queryClient.getQueryData<InfiniteData<Page<EntitySummary>>>(["library", "playlists"]),
    queryClient.getQueryData<InfiniteData<Page<EntitySummary>>>(["library", "playlists", "librespot"]),
    queryClient.getQueryData<InfiniteData<Page<EntitySummary>>>(["library", "playlists", "desktop"]),
  ];

  return writablePlaylists([
    ...(cached?.items ?? []),
    ...remote.flatMap((entry) => entry?.pages.flatMap((page) => page.items) ?? []),
  ]);
}

export async function streamPlaylistPages(
  publish: (items: EntitySummary[]) => void,
  verifiedOnly = false,
  isDisposed: () => boolean = () => false,
): Promise<void> {
  // Older Libre caches contain guessed canModify=true; only fresh rights are trusted.
  const cached = verifiedOnly ? null : await desktopApi
    .cachedPlaylists({ offset: 0, limit: PAGE_SIZE })
    .catch(() => null);
  if (isDisposed()) return;
  publish(cached?.items ?? []);

  let page;
  try {
    page = await desktopApi.playlists({
      offset: 0,
      limit: PAGE_SIZE,
    });
  } catch (error) {
    if ((cached?.items.length ?? 0) === 0) {
      throw error;
    }
    return;
  }
  if (isDisposed()) return;
  publish(page.items);

  for (
    let pageNumber = 1;
    pageNumber < 100 && page.hasMore && !isDisposed();
    pageNumber += 1
  ) {
    try {
      page = await desktopApi.playlists({
        // Rootlist limit counts consumed rows, including folders/unresolved entries.
        offset: page.offset + Math.max(page.limit, page.items.length, 1),
        limit: PAGE_SIZE,
      });
    } catch {
      return;
    }
    if (isDisposed()) return;
    publish(page.items);
  }
}

export function filterPickerPlaylists(
  playlists: EntitySummary[],
  query: string,
): EntitySummary[] {
  const normalized = query.trim().toLocaleLowerCase("de");
  if (!normalized) return playlists;
  return playlists.filter((playlist) =>
    `${playlist.name} ${playlist.subtitle ?? ""}`
      .toLocaleLowerCase("de")
      .includes(normalized),
  );
}

function uniquePlaylists(items: EntitySummary[]): EntitySummary[] {
  return Array.from(
    new Map(items.map((playlist) => [playlist.uri, playlist])).values(),
  );
}

function writablePlaylists(items: EntitySummary[], verifiedOnly = false): EntitySummary[] {
  return uniquePlaylists(items).filter((item) => verifiedOnly ? item.canModify === true : isWritableLibraryPlaylist(item));
}

/**
 * Playlists already known to contain the track, from snapshots that are in
 * the query cache anyway. Unknown playlists are simply not marked.
 */
export function playlistsContainingTrack(queryClient: QueryClient, trackUri: string): Set<string> {
  const containing = new Set<string>();
  const snapshots = queryClient.getQueriesData<PlaylistDetails | null>({
    predicate: (query) =>
      query.queryKey[0] === "playlist-snapshot" || query.queryKey[0] === "playlist-snapshot-cache",
  });
  for (const [, details] of snapshots) {
    if (details?.tracks.some((track) => track.uri === trackUri)) {
      containing.add(canonicalPlaylistUri(details.uri));
    }
  }
  return containing;
}
