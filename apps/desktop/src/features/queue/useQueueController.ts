import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueueState } from "@luft/protocol-types";
import { useCallback, useEffect, useMemo } from "react";

import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { usePlayback } from "../playback/usePlayback";
import {
  QUEUE_QUERY_KEY,
  useClearQueue,
  useQueueQuery,
  useRemoveQueueItem,
  useReorderQueue,
} from "./queueQueries";
import {
  hasIncompleteQueueItems,
  sanitizeQueueState,
} from "./sanitizeQueue";
import { formatQueueCount } from "./queuePresentation";
import { growQueueWindow } from "./queueWindow";

export function useQueueController(
  enabled = true,
  refetchIntervalMs = 3_000,
) {
  const queryClient = useQueryClient();
  const playback = usePlayback();
  const { engineReady, localReady: librespotReady } = usePlaybackEngine();
  const connected = engineReady;
  const canRead = engineReady;
  const canClear = engineReady;
  const canRemove = engineReady;
  const canReorder = engineReady;

  const currentUri = playback.playback?.currentItem?.uri;
  const contextUri = playback.playback?.contextUri;
  useEffect(() => {
    if (!enabled || !connected || !canRead) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
  }, [canRead, connected, contextUri, currentUri, enabled, queryClient]);

  const queue = useQueueQuery(
    enabled && connected && canRead,
    refetchIntervalMs,
  );
  const clear = useClearQueue(connected && canClear);
  const remove = useRemoveQueueItem(connected && canRemove);
  const reorder = useReorderQueue(connected && canReorder);
  const queueView = useMemo(
    () => queue.data
      ? sanitizeQueueState(queue.data, playback.playback?.currentItem)
      : queue.data,
    [playback.playback?.currentItem, queue.data],
  );
  // A windowed queue is complete as far as the list is concerned: it loads
  // further pages while scrolling.
  const windowed = queue.data?.totalItems !== undefined;
  const totalItems = queue.data?.totalItems ?? queue.data?.items.length ?? 0;
  const visibleItems = windowed ? totalItems : queueView?.items.length ?? 0;
  const loadMore = useCallback(() => {
    const data = queryClient.getQueryData<QueueState>(QUEUE_QUERY_KEY);
    if (data?.totalItems === undefined) return;
    if (growQueueWindow(data.items.length, data.totalItems)) {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    }
  }, [queryClient]);
  const loadTitles = useCallback((uris: string[]) => {
    void desktopApi.hydrateQueueItems(uris).catch(() => undefined);
  }, []);
  const hydrating = Boolean(
    queue.data && hasIncompleteQueueItems(queue.data),
  );

  return {
    connected,
    canRead,
    canClear,
    canRemove,
    canReorder,
    hydrating,
    itemCountLabel: formatQueueCount(visibleItems, totalItems),
    queue: {
      ...queue,
      data: queueView,
    },
    clear,
    remove,
    reorder,
    loadMore: windowed ? loadMore : undefined,
    loadTitles: windowed ? loadTitles : undefined,
    play: (uri: string) => {
      if (librespotReady) {
        return playback.playUri(uri, undefined, true);
      }
      const contextUri = playback.playback?.contextUri;
      if (contextUri) {
        return playback.playContext(contextUri, uri);
      }
      return playback.playUri(uri);
    },
  };
}
