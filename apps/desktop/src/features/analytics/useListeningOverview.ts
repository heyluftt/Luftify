import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { desktopApi } from "../../services/desktopApi";
import { createAnalyticsRange, previousAnalyticsRangeRequest } from "./analyticsRanges";
import type { AnalyticsRangeKey } from "./analyticsTypes";

export const LISTENING_OVERVIEW_QUERY_KEY = "listening-overview";

export function useListeningOverview(
  rangeKey: AnalyticsRangeKey,
  enabled: boolean,
) {
  const client = useQueryClient();
  const range = useMemo(() => createAnalyticsRange(rangeKey), [rangeKey]);
  const query = useQuery({
    queryKey: [LISTENING_OVERVIEW_QUERY_KEY, rangeKey],
    queryFn: () => desktopApi.getListeningOverview(
      createAnalyticsRange(rangeKey).request,
    ),
    enabled,
    staleTime: 30_000,
    retry: 1,
    refetchInterval: enabled ? 60_000 : false,
  });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    void listen("analytics://changed", () => {
      void client.invalidateQueries({
        queryKey: [LISTENING_OVERVIEW_QUERY_KEY],
      });
    }).then((listener) => {
      if (disposed) listener();
      else unlisten = listener;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, enabled]);

  return { query, range };
}

/** The period before, for the changes shown beside each number; none for "all". */
export function usePreviousOverview(rangeKey: AnalyticsRangeKey, enabled: boolean) {
  return useQuery({
    queryKey: [LISTENING_OVERVIEW_QUERY_KEY, rangeKey, "previous"],
    queryFn: () => desktopApi.getListeningOverview(previousAnalyticsRangeRequest(rangeKey)!),
    enabled: enabled && rangeKey !== "all",
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
