import type {
  QueueItem,
  QueueReorderRequest,
  QueueState,
} from "@luft/protocol-types";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { desktopApi } from "../../services/desktopApi";
import { hasIncompleteQueueItems } from "./sanitizeQueue";
import { splitQueueSections } from "./queuePresentation";
import { applyQueueReorder } from "./queueReorder";
import { queueWindowLimit } from "./queueWindow";

export const QUEUE_QUERY_KEY = ["queue"] as const;

const DEFAULT_REFETCH_INTERVAL_MS = 3_000;
const HYDRATING_REFETCH_INTERVAL_MS = 650;

interface ClearQueueContext {
  previous: QueueState | undefined;
  optimistic: boolean;
}

interface ReorderQueueContext {
  previous: QueueState | undefined;
  optimistic: boolean;
}

export function useQueueQuery(
  enabled: boolean,
  intervalMs = DEFAULT_REFETCH_INTERVAL_MS,
) {
  return useQuery<QueueState>({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: () => desktopApi.queue(queueWindowLimit()),
    enabled,
    staleTime: 750,
    refetchInterval: enabled
      ? (query) =>
          query.state.data && hasIncompleteQueueItems(query.state.data)
            ? HYDRATING_REFETCH_INTERVAL_MS
            : intervalMs
      : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function useClearQueue(enabled: boolean) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, void, ClearQueueContext>({
    mutationFn: async () => {
      assertQueueMutationEnabled(enabled);
      await desktopApi.clearQueue();
    },
    onMutate: async () => {
      if (!enabled) {
        return {
          previous: undefined,
          optimistic: false,
        };
      }

      await queryClient.cancelQueries({
        queryKey: QUEUE_QUERY_KEY,
      });

      const previous =
        queryClient.getQueryData<QueueState>(QUEUE_QUERY_KEY);

      queryClient.setQueryData<QueueState>(
        QUEUE_QUERY_KEY,
        (current) =>
          current ? withoutQueuedRows(current) : current,
      );

      return {
        previous,
        optimistic: true,
      };
    },
    onError: (_error, _variables, context) => {
      if (!context?.optimistic) {
        return;
      }

      queryClient.setQueryData(
        QUEUE_QUERY_KEY,
        context.previous,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: QUEUE_QUERY_KEY,
      });
    },
    retry: false,
  });
}

export function useRemoveQueueItem(enabled: boolean) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, QueueItem>({
    mutationFn: async (entry) => {
      assertQueueMutationEnabled(enabled);
      // The uid targets the exact row (Libre); the URI stays the fallback.
      await desktopApi.removeFromQueue(entry.item.uri, entry.uid);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: QUEUE_QUERY_KEY,
      });
    },
    retry: false,
  });
}

export function useReorderQueue(enabled: boolean) {
  const queryClient = useQueryClient();

  return useMutation<
    QueueState,
    Error,
    QueueReorderRequest,
    ReorderQueueContext
  >({
    mutationFn: async (request) => {
      assertQueueMutationEnabled(enabled);
      return desktopApi.reorderQueue(request);
    },
    onMutate: async (request) => {
      if (!enabled) {
        return {
          previous: undefined,
          optimistic: false,
        };
      }

      await queryClient.cancelQueries({
        queryKey: QUEUE_QUERY_KEY,
      });
      const previous =
        queryClient.getQueryData<QueueState>(QUEUE_QUERY_KEY);

      queryClient.setQueryData<QueueState>(
        QUEUE_QUERY_KEY,
        (current) =>
          current
            ? {
                ...current,
                items: applyQueueReorder(
                  current.items,
                  request,
                ),
              }
            : current,
      );

      return {
        previous,
        optimistic: true,
      };
    },
    onError: (_error, _request, context) => {
      if (context?.optimistic) {
        queryClient.setQueryData(
          QUEUE_QUERY_KEY,
          context.previous,
        );
      }
    },
    onSuccess: (queue, _request, context) => {
      // Reorder answers with the full queue; keep the windowed shape the
      // list was built from.
      const windowed = context?.previous?.totalItems !== undefined
        && queue.totalItems === undefined;
      queryClient.setQueryData(
        QUEUE_QUERY_KEY,
        windowed
          ? {
              ...queue,
              items: queue.items.slice(0, queueWindowLimit()),
              totalItems: queue.items.length,
            }
          : queue,
      );
    },
    retry: false,
  });
}

// "Clear" only drops manually queued titles; the context stays. Engines
// without that split clear everything.
function withoutQueuedRows(current: QueueState): QueueState {
  const sections = splitQueueSections(current.items);
  if (!sections) return { ...current, items: [] };
  const removed = sections.queued.length;
  return {
    ...current,
    items: sections.context,
    ...(current.totalItems !== undefined
      ? { totalItems: Math.max(0, current.totalItems - removed) }
      : {}),
  };
}

function assertQueueMutationEnabled(enabled: boolean): asserts enabled {
  if (!enabled) {
    throw new Error(
      "Diese Aktion ist gerade nicht verfügbar.",
    );
  }
}
