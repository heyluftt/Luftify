import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { canonicalPlaylistUri } from "../entities/playlistSnapshot";
import { usePlaylistLibrary } from "../library/libraryQueries";
import type { ListeningOverview } from "./analyticsTypes";

export type PlaylistDetail = { name?: string; coverUri?: string };

const FIRST_TRACK = { offset: 0, limit: 1 };

/**
 * Name and cover of the most played playlists: from the library first; a
 * playlist that is not saved there (a friend's, a mix opened by link) is
 * loaded once, from the cache if it is there. Liked songs get their name.
 */
export function useTopPlaylistDetails(overview: ListeningOverview | undefined, enabled: boolean) {
  const library = usePlaylistLibrary(enabled);
  const known = useMemo(() => new Map<string, PlaylistDetail>(
    (library.view.data?.items ?? []).map((playlist) => [canonicalPlaylistUri(playlist.uri), { name: playlist.name, ...(playlist.coverUri ? { coverUri: playlist.coverUri } : {}) }]),
  ), [library.view.data?.items]);
  const missing = (overview?.topPlaylists ?? [])
    .slice(0, 10)
    .map((entry) => entry.playlistUri)
    .filter((uri) => !known.has(canonicalPlaylistUri(uri)) && !uri.includes(":collection"));
  const loaded = useQueries({
    queries: missing.map((uri) => ({
      queryKey: ["analytics-playlist-detail", uri],
      enabled: enabled && Boolean(library.view.data),
      staleTime: 60 * 60_000,
      retry: false,
      queryFn: async (): Promise<PlaylistDetail | null> => {
        const details = await desktopApi.cachedPlaylist(uri, FIRST_TRACK).catch(() => null)
          ?? await desktopApi.playlist(uri, FIRST_TRACK).catch(() => null);
        if (!details) return null;
        const cover = details.coverUri ?? details.tracks[0]?.coverUri;
        return { name: details.name, ...(cover ? { coverUri: cover } : {}) };
      },
    })),
  });
  return useMemo(() => {
    // Keyed by the overview's own URIs; the library may write the same playlist as spotify:user:…:playlist:…
    const all = new Map<string, PlaylistDetail>();
    for (const entry of overview?.topPlaylists ?? []) {
      const detail = known.get(canonicalPlaylistUri(entry.playlistUri));
      if (detail) all.set(entry.playlistUri, detail);
    }
    missing.forEach((uri, index) => {
      const detail = loaded[index]?.data;
      if (detail) all.set(uri, detail);
    });
    for (const entry of overview?.topPlaylists ?? []) {
      if (entry.playlistUri.includes(":collection")) all.set(entry.playlistUri, { name: t("library.liked") });
    }
    return all;
    // `loaded` changes identity on every render; its data is what matters.
  }, [known, overview?.topPlaylists, loaded.map((query) => query.dataUpdatedAt).join(",")]);
}
