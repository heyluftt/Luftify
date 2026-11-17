import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { desktopApi } from "../../services/desktopApi";
import { canonicalPlaylistUri } from "../entities/playlistSnapshot";
import { usePlaylistLibrary } from "../library/libraryQueries";

/** Where a playlist stands in the own library. */
export interface PlaylistStanding {
  inLibrary: boolean;
  own: boolean;
  collaborative: boolean;
}

export function usePlaylistStanding(uri: string): PlaylistStanding {
  const library = usePlaylistLibrary();
  const canonical = canonicalPlaylistUri(uri);
  return useMemo(() => {
    const entry = library.view.data?.items.find((item) => canonicalPlaylistUri(item.uri) === canonical);
    return {
      inLibrary: Boolean(entry),
      own: entry?.library?.owner === "me",
      collaborative: entry?.library?.collaborative === true,
    };
  }, [canonical, library.view.data?.items]);
}

/** Create, rename, make collaborative, follow and delete; the library follows. */
export function usePlaylistActions() {
  const client = useQueryClient();
  const settled = (uri?: string) => () => refreshPlaylists(client, uri);
  return {
    create: useMutation({
      mutationFn: async ({ name, collaborative }: { name: string; collaborative: boolean }) => {
        const uri = await desktopApi.createPlaylist(name);
        // The playlist exists either way; a failed switch can be redone on its page.
        if (collaborative) await desktopApi.setPlaylistCollaborative(uri, true).catch(() => undefined);
        return uri;
      },
      onSettled: settled(),
    }),
    rename: useMutation({
      mutationFn: ({ uri, name }: { uri: string; name: string }) => desktopApi.renamePlaylist(uri, name),
      onSettled: (_data, _error, { uri }) => refreshPlaylists(client, uri),
    }),
    collaborative: useMutation({
      mutationFn: ({ uri, collaborative }: { uri: string; collaborative: boolean }) => desktopApi.setPlaylistCollaborative(uri, collaborative),
      onSettled: (_data, _error, { uri }) => refreshPlaylists(client, uri),
    }),
    followed: useMutation({
      mutationFn: ({ uri, followed }: { uri: string; followed: boolean }) => desktopApi.setPlaylistFollowed(uri, followed),
      onSettled: (_data, _error, { uri }) => refreshPlaylists(client, uri),
    }),
  };
}

export function refreshPlaylists(client: QueryClient, uri?: string): Promise<unknown> {
  const canonical = uri ? canonicalPlaylistUri(uri) : undefined;
  return Promise.all([
    client.invalidateQueries({ queryKey: ["library", "playlists"] }),
    client.invalidateQueries({ queryKey: ["library-cache", "playlists"] }),
    ...(canonical ? [
      client.invalidateQueries({ queryKey: ["playlist-snapshot-cache", canonical] }),
      client.invalidateQueries({ predicate: (query) => query.queryKey[0] === "playlist-snapshot" && query.queryKey.includes(canonical) }),
    ] : []),
  ]);
}
