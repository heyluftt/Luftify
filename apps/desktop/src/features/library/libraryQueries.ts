import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EntitySummary, MediaItem, Page } from "@luft/protocol-types";
import { useEffect, useMemo } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { nextPageOffset, shouldPrefetchNextPage } from "../pagination";
import { libraryRemoteEnabled, libraryViewState } from "./libraryState";

export const LIBRARY_FIRST_PAGE = { offset: 0, limit: 50 } as const;
const startupMark = performance.now();
const LIBRE_STARTUP_RETRIES = 5;
/** Sorting and filtering need the whole library; 2,000 is 40 small pages. */
const PLAYLIST_PREFETCH_MAX_OFFSET = 2_000;
/** Query key segment for remote library pages; the cache keys stay engine-free. */
export const LIBRARY_SOURCE = "librespot";

export function usePlaylistLibrary(enabled = true) {
  const { localReady, engineReady, mockMode, localPhase } = usePlaybackEngine();
  const cache = useQuery({
    queryKey: ["library-cache", "playlists", 0, 50],
    queryFn: () => desktopApi.cachedPlaylists(LIBRARY_FIRST_PAGE),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    enabled,
  });
  const remoteEnabled = libraryRemoteEnabled({ enabled, mockMode, localReady });
  const remote = useInfiniteQuery({
    queryKey: ["library", "playlists", LIBRARY_SOURCE],
    queryFn: ({ pageParam }) => desktopApi.playlists({ offset: pageParam, limit: 50 }),
    initialPageParam: 0,
    getNextPageParam: nextPageOffset,
    enabled: remoteEnabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: mockMode ? false : LIBRE_STARTUP_RETRIES,
    retryDelay: libraryRetryDelay,
    refetchInterval: mockMode ? false : libraryErrorRefetch,
  });
  const remotePage = useMemo(() => combinePages(remote.data?.pages), [remote.data]);
  const view = useMemo(() => libraryViewState<EntitySummary>({
    engineReady,
    localPhase,
    cached: cache.data,
    remote: remotePage,
    remoteLoading: remote.isLoading,
    remoteFetching: remote.isFetching,
    remoteError: remote.isError,
  }), [cache.data, engineReady, localPhase, remote.isError, remote.isFetching, remote.isLoading, remotePage]);
  useLibraryTiming("playlists", view.data, view.cached);
  useEffect(() => {
    if (remote.isFetchingNextPage) return;
    if (shouldPrefetchNextPage(remotePage, PLAYLIST_PREFETCH_MAX_OFFSET)) {
      void remote.fetchNextPage();
    }
  }, [remote.fetchNextPage, remote.isFetchingNextPage, remotePage]);
  return { view, remote, cache };
}

export function useLikedLibrary() {
  const { localReady, engineReady, mockMode, localPhase } = usePlaybackEngine();
  const cache = useQuery({
    queryKey: ["library-cache", "liked", 0, 50],
    queryFn: () => desktopApi.cachedLikedTracks(LIBRARY_FIRST_PAGE),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const remoteEnabled = libraryRemoteEnabled({ mockMode, localReady });
  const remote = useInfiniteQuery({
    queryKey: ["library", "liked", LIBRARY_SOURCE],
    queryFn: ({ pageParam }) => desktopApi.likedTracks({ offset: pageParam, limit: 50 }),
    initialPageParam: 0,
    getNextPageParam: nextPageOffset,
    enabled: remoteEnabled,
    staleTime: 2 * 60_000,
    gcTime: 30 * 60_000,
    retry: mockMode ? false : LIBRE_STARTUP_RETRIES,
    retryDelay: libraryRetryDelay,
    refetchInterval: mockMode ? false : libraryErrorRefetch,
  });
  const remotePage = useMemo(() => combinePages(remote.data?.pages), [remote.data]);
  const view = useMemo(() => libraryViewState<MediaItem>({
    engineReady,
    localPhase,
    cached: cache.data,
    remote: remotePage,
    remoteLoading: remote.isLoading,
    remoteFetching: remote.isFetching,
    remoteError: remote.isError,
  }), [cache.data, engineReady, localPhase, remote.isError, remote.isFetching, remote.isLoading, remotePage]);
  useLibraryTiming("liked", view.data, view.cached);
  return { view, remote, cache };
}

/**
 * Every liked track URI (Librespot lists them in one cheap call), so saved
 * state and the liked count are right beyond the loaded pages.
 */
export function useLikedTrackUris(enabled = true) {
  return useQuery({
    queryKey: ["library", "liked", "uris"],
    queryFn: desktopApi.likedTrackUris,
    staleTime: 5 * 60_000,
    retry: 1,
    enabled,
  });
}

export function useRefreshLibrary() {
  const client = useQueryClient();
  return (likedOnly: boolean) => client.invalidateQueries({ queryKey: likedOnly ? ["library", "liked"] : ["library"] });
}

function useLibraryTiming(kind: string, data: Page<unknown> | undefined, cached: boolean): void {
  useEffect(() => {
    if (!data?.items.length || !import.meta.env.DEV || import.meta.env.MODE === "test") return;
    const mark = `luft:${cached ? "cache-visible" : "first-page-visible"}:${kind}`;
    if (performance.getEntriesByName(mark).length === 0) performance.mark(mark);
    console.info("[Luft Library] timing", {
      phase: cached ? "cache-visible" : "first-page-visible",
      durationMs: Math.round(performance.now() - startupMark),
      status: "rendered",
      adapter: cached ? "sqlite" : LIBRARY_SOURCE,
      kind,
    });
  }, [cached, data, kind]);
}

function combinePages<T>(pages: Page<T>[] | undefined): Page<T> | undefined {
  if (!pages?.length) return undefined;
  const last = pages.at(-1)!;
  return {
    items: pages.flatMap((page) => page.items),
    offset: 0,
    limit: pages.reduce((total, page) => total + page.limit, 0),
    ...(last.total !== undefined ? { total: last.total } : {}),
    hasMore: last.hasMore,
  };
}

/**
 * While Spotify fails (a 502 outage lasted eleven minutes), asking every 6 s
 * kept hammering it; the pause doubles with every failed round up to 2 min.
 */
export function libraryErrorRefetchMs(failedRounds: number): number {
  return Math.min(2 * 60_000, 6_000 * 2 ** Math.min(Math.max(failedRounds - 1, 0), 5));
}

function libraryErrorRefetch(query: { state: { status: string; errorUpdateCount: number } }): number | false {
  return query.state.status === "error" ? libraryErrorRefetchMs(query.state.errorUpdateCount) : false;
}

function libraryRetryDelay(attempt: number): number {
  return Math.min(8_000, 1_000 * (2 ** Math.min(attempt, 3)));
}
