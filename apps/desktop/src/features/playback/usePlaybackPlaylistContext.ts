import { useQuery } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import { canonicalPlaylistUri } from "../entities/playlistSnapshot";

const SEARCH_CONTEXT_PREFIX = "spotify:search:";
const PLAYLIST_PREFIX = "spotify:playlist:";

/**
 * The playlist behind a playback context. Playing a filtered playlist uses
 * `spotify:search:<encoded playlist uri>`; legacy `spotify:user:…:playlist:`
 * URIs are canonicalized. Other search contexts (Luftify mixes) have none.
 */
export function playbackContextPlaylistUri(contextUri: string | undefined): string | undefined {
  let candidate = contextUri?.trim();
  if (!candidate) return undefined;
  if (candidate.startsWith(SEARCH_CONTEXT_PREFIX)) {
    try {
      candidate = decodeURIComponent(candidate.slice(SEARCH_CONTEXT_PREFIX.length));
    } catch {
      return undefined;
    }
  }
  const canonical = canonicalPlaylistUri(candidate);
  const id = canonical.startsWith(PLAYLIST_PREFIX) ? canonical.slice(PLAYLIST_PREFIX.length) : "";
  return id && !id.includes(":") ? canonical : undefined;
}

const PLAYLIST_HEAD_REQUEST = { offset: 0, limit: 1 } as const;

export interface PlaybackPlaylistContext {
  uri: string;
  name: string;
}

export function usePlaybackPlaylistContext(
  contextUri: string | undefined,
  connected: boolean,
): PlaybackPlaylistContext | undefined {
  const uri = playbackContextPlaylistUri(contextUri);
  const cached = useQuery({
    queryKey: ["playback-context-playlist-cache", uri],
    queryFn: () => desktopApi.cachedPlaylist(uri!, PLAYLIST_HEAD_REQUEST),
    enabled: uri !== undefined,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
  const remote = useQuery({
    queryKey: ["playback-context-playlist", uri],
    queryFn: () => desktopApi.playlist(uri!, PLAYLIST_HEAD_REQUEST),
    enabled: uri !== undefined && connected,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });

  if (!uri) return undefined;
  return {
    uri,
    name: remote.data?.name ?? cached.data?.name ?? t("player.currentPlaylist"),
  };
}
