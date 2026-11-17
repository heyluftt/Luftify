import type { SearchResult } from "@luft/protocol-types";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { usePlaylistUsage } from "../home/usePlaylistUsage";
import { LIKED_COLLECTION_URI, sortPlaylists } from "../library/libraryPresentation";
import { useLikedLibrary, useLikedTrackUris, usePlaylistLibrary } from "../library/libraryQueries";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { matchKey, matchesEveryWord } from "../textMatch";
import { matchScore } from "./commandPaletteModel";
import { entityItem, likedItem, trackItem } from "./paletteMediaItems";
import type { PaletteItem } from "./paletteTypes";

const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_LIMIT = 6;
const SUGGESTED = 4;
const LIBRARY_LIMIT = 5;

/**
 * Music for the palette: own playlists and liked songs match instantly from
 * what the library already loaded, Spotify's catalog follows debounced.
 */
export function usePaletteMedia(query: string, open: boolean, connected: boolean) {
  const { view } = usePlaylistLibrary(open);
  const usage = usePlaylistUsage(open);
  const liked = useLikedLibrary();
  const likedUris = useLikedTrackUris(open);
  const { localReady } = usePlaybackEngine();
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const searchable = open && connected && debounced.length >= 2 && !/^[+\-\d:% ]+$/.test(debounced);

  const search = useQuery({
    queryKey: ["command-palette", "search", localReady ? "librespot" : "desktop", debounced],
    queryFn: ({ signal }) => desktopApi.search({ query: debounced, offset: 0, limit: SEARCH_LIMIT }, signal),
    enabled: searchable,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });

  const playlists = view.data?.items;
  const likedTracks = liked.view.data?.items;
  const likedCount = likedUris.data?.length ?? liked.view.data?.total;

  const suggested = useMemo(() => {
    if (!playlists?.length) return [];
    return sortPlaylists(playlists, "smart", usage.data ?? [])
      .slice(0, SUGGESTED)
      .map((entry) => entityItem("suggested", "playlists", entry));
  }, [playlists, usage.data]);

  const library = useMemo(() => {
    if (!trimmed) return [];
    const items: PaletteItem[] = [];
    if (likedCount !== 0 && matchesEveryWord(trimmed, t("library.liked"), "liked favoriten lieblingssongs")) {
      items.push(likedItem(likedCount));
    }
    const ownPlaylists = (playlists ?? [])
      .map((entry) => ({ entry, score: matchScore(trimmed, { label: entry.name, keywords: [] }) }))
      .filter(({ score }) => score >= 35)
      .sort((left, right) => right.score - left.score)
      .slice(0, LIBRARY_LIMIT)
      .map(({ entry }) => entityItem("library", "playlists", entry));
    items.push(...ownPlaylists);
    const context = likedTracks?.length ? { uri: LIKED_COLLECTION_URI, tracks: likedTracks } : undefined;
    const songs = (likedTracks ?? [])
      .filter((track) => matchesEveryWord(trimmed, track.title, ...track.creators.map((creator) => creator.name)))
      .slice(0, Math.max(0, LIBRARY_LIMIT + 1 - items.length))
      .map((track) => trackItem("library", track, context));
    return [...items, ...songs];
  }, [likedCount, likedTracks, playlists, trimmed]);

  const spotify = useMemo(() => {
    const data = search.data;
    if (!data || !trimmed || matchKey(data.query) !== matchKey(debounced)) return [];
    const known = new Set(library.map((item) => item.id));
    return spotifyItems(data).filter((item) => !known.has(item.id));
  }, [debounced, library, search.data, trimmed]);

  return {
    suggested,
    library,
    spotify,
    searching: searchable && search.isFetching,
    pending: trimmed.length >= 2 && trimmed !== debounced,
  };
}

/** Spotify's top hit first, then songs before artists, albums and playlists. */
function spotifyItems(data: SearchResult): PaletteItem[] {
  const items = [
    ...data.tracks.slice(0, 4).map((track) => trackItem("spotify", track)),
    ...data.artists.slice(0, 2).map((entry) => entityItem("spotify", "artists", entry)),
    ...data.albums.slice(0, 2).map((entry) => entityItem("spotify", "albums", entry)),
    ...data.playlists.slice(0, 2).map((entry) => entityItem("spotify", "playlists", entry)),
  ];
  const top = data.topResultUri ? items.findIndex((item) => item.id.endsWith(`:${data.topResultUri}`)) : -1;
  if (top > 0) items.unshift(...items.splice(top, 1));
  return items;
}
