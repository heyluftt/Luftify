import type { PlaylistDetails } from "@luft/protocol-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { prefetchCover } from "../../components/coverQuery";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import {
  ARTIST_PROFILE_QUERY_VERSION,
  normalizeArtistDetails,
} from "../entities/artist/artistProfileModel";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { requestLyrics } from "../lyrics/lyricsRequest";
import {
  lyricsFallbackCacheKey,
  readLyricsFallback,
} from "../lyrics/lyricsFallbackCache";
import { useQueueQuery } from "../queue/queueQueries";
import {
  collectPrefetchTargets,
  collectSnapshotCoverUrls,
  coverQueryKey,
  lyricsPrefetchKey,
  PREFETCH_CATALOG_STALE_TIME,
  PREFETCH_LYRICS_STALE_TIME,
  type PrefetchTarget,
} from "./prefetchTargets";

export function MediaPrefetch() {
  const queryClient = useQueryClient();
  const currentItem = usePlayerStore((store) => store.playback?.currentItem);
  const durationMs = usePlayerStore((store) => store.playback?.durationMs);
  const contextUri = usePlayerStore((store) => store.playback?.contextUri);
  const connectionEpoch = usePlayerStore((store) => store.connectionEpoch);
  const { localReady: librespotReady, engineReady } = usePlaybackEngine();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: desktopApi.settings,
    staleTime: 60_000,
  });
  // PlaybackSync owns global queue polling and queue://changed invalidation.
  // Observe its shared result without creating another polling timer.
  const queue = useQueueQuery(false);
  const catalogReady = engineReady;
  const source: "librespot" | "desktop" = librespotReady ? "librespot" : "desktop";
  const lyricsEnabled = settings.data?.lyricsEnabled !== false;
  const targets = useMemo(
    () =>
      collectPrefetchTargets({
        current: currentItem,
        upcoming: queue.data?.items.map((entry) => entry.item),
        durationMs: durationMs,
        contextUri: contextUri,
      }),
    [contextUri, currentItem, durationMs, queue.data?.items],
  );
  const immediateTargets = useMemo(
    () =>
      targets.filter(
        (target) => target.kind === "cover" || target.kind === "playlist",
      ),
    [targets],
  );
  const deferredTargets = useMemo(
    () =>
      targets.filter(
        (target) => target.kind !== "cover" && target.kind !== "playlist",
      ),
    [targets],
  );
  // Page chunks are preloaded by pages/lazyPages (prefetchPages).

  useEffect(() => {
    if (!settings.isSuccess) return;
    const options = {
      catalogReady,
      connectionEpoch,
      lyricsEnabled,
      queryClient,
      source,
    };
    for (const target of immediateTargets) {
      void prefetchTarget(target, options);
    }
  }, [
    catalogReady,
    connectionEpoch,
    immediateTargets,
    lyricsEnabled,
    queryClient,
    settings.isSuccess,
    source,
  ]);

  useEffect(() => {
    if (!settings.isSuccess) return;
    const options = {
      catalogReady,
      connectionEpoch,
      lyricsEnabled,
      queryClient,
      source,
    };
    return scheduleIdlePrefetchSequence(
      deferredTargets,
      (target) => prefetchTarget(target, options),
    );
  }, [
    catalogReady,
    connectionEpoch,
    deferredTargets,
    lyricsEnabled,
    queryClient,
    settings.isSuccess,
    source,
  ]);

  return null;
}

function prefetchTarget(
  target: PrefetchTarget,
  options: {
    catalogReady: boolean;
    connectionEpoch: number;
    lyricsEnabled: boolean;
    queryClient: ReturnType<typeof useQueryClient>;
    source: "librespot" | "desktop";
  },
) {
  const { queryClient } = options;
  switch (target.kind) {
    case "cover": {
      if (!coverQueryKey(target.url)) return;
      return Promise.all(target.sizes.map((size) => prefetchCover(queryClient, target.url, size)));
    }
    case "lyrics": {
      // The current title is looked up in the background for both engines so
      // opening the page never starts the first search. Libre deliberately
      // skips upcoming tracks to keep its playback session free for audio.
      if (
        !options.lyricsEnabled ||
        (options.source === "librespot" && !target.current) ||
        readLyricsFallback(
          lyricsFallbackCacheKey(target.request.trackUri),
        ) !== undefined
      ) return;
      return queryClient.prefetchQuery({
        queryKey: lyricsPrefetchKey(target.request),
        queryFn: () => requestLyrics(target.request),
        // A failed background lookup must become a stable query result. The
        // lyrics page can then show it immediately instead of inheriting the
        // query client's otherwise invisible retry cycle.
        retry: false,
        staleTime: PREFETCH_LYRICS_STALE_TIME,
      });
    }
    case "album": {
      if (!options.catalogReady || options.source === "librespot") return;
      return queryClient.prefetchInfiniteQuery({
        queryKey: ["album", options.source, target.uri],
        queryFn: ({ pageParam }) =>
          desktopApi.album(target.uri, { offset: pageParam, limit: 50 }),
        initialPageParam: 0,
        staleTime: PREFETCH_CATALOG_STALE_TIME,
      });
    }
    case "artist": {
      if (!options.catalogReady || options.source === "librespot") return;
      return queryClient.prefetchQuery({
        queryKey: [
          "artist-profile",
          ARTIST_PROFILE_QUERY_VERSION,
          options.connectionEpoch,
          options.source,
          target.uri,
        ],
        queryFn: async () =>
          normalizeArtistDetails(await desktopApi.artist(target.uri), target.uri),
        staleTime: PREFETCH_CATALOG_STALE_TIME,
      });
    }
    case "playlist": {
      if (!options.catalogReady) return;
      if (options.source === "librespot") {
        return desktopApi
          .cachedPlaylistSnapshot(target.uri)
          .then((snapshot) => prefetchSnapshotCovers(queryClient, snapshot));
      }
      const snapshotKey = [
        "playlist-snapshot",
        options.source,
        target.uri,
      ] as const;
      return queryClient
        .prefetchQuery({
          queryKey: snapshotKey,
          queryFn: () => desktopApi.playlistSnapshot(target.uri),
          staleTime: PREFETCH_CATALOG_STALE_TIME,
        })
        .then(() => {
          const snapshot = queryClient.getQueryData<PlaylistDetails>(snapshotKey);
          prefetchSnapshotCovers(queryClient, snapshot);
        });
    }
  }
}

function prefetchSnapshotCovers(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshot: PlaylistDetails | null | undefined,
) {
  // Rows show these as thumbnails; the 640 px originals are not needed.
  for (const url of collectSnapshotCoverUrls(snapshot?.tracks)) {
    if (!coverQueryKey(url)) continue;
    void prefetchCover(queryClient, url, "tiny");
  }
}

function scheduleIdle(work: () => void) {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(work, { timeout: 1_500 });
    return () => cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(work, 180);
  return () => window.clearTimeout(timer);
}

function scheduleIdlePrefetchSequence(
  targets: readonly PrefetchTarget[],
  prefetch: (target: PrefetchTarget) => void | Promise<unknown>,
) {
  let disposed = false;
  let cancelScheduled: (() => void) | undefined;
  let index = 0;

  const prefetchNext = () => {
    if (disposed || index >= targets.length) return;
    const target = targets[index++];
    if (!target) return;
    void Promise.resolve(prefetch(target))
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) cancelScheduled = scheduleIdle(prefetchNext);
      });
  };

  cancelScheduled = scheduleIdle(prefetchNext);
  return () => {
    disposed = true;
    cancelScheduled?.();
  };
}
