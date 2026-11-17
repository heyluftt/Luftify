import type { EntitySummary, Page } from "@luft/protocol-types";
import { useQuery } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";

export function useHomeNewReleases(enabled = true, pollEmpty = true) {
  const { engineReady } = usePlaybackEngine();
  const canFetch = engineReady;
  const sourceKey = "librespot";

  return useQuery({
    queryKey: ["home", "new-releases", sourceKey],
    queryFn: desktopApi.newReleases,
    enabled: canFetch && enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    refetchInterval: (query) => {
      const page = query.state.data as Page<EntitySummary> | undefined;
      if (!pollEmpty || (page && page.items.length > 0)) return false;
      // A rate-limited request fails instead of returning an empty page;
      // counting only empty answers kept the retry at 10 s forever.
      return emptyReleasesRetryMs(query.state.dataUpdateCount + query.state.errorUpdateCount);
    },
    select: (page: Page<EntitySummary>) => page.items.slice(0, 12),
  });
}

const EMPTY_RETRY_BASE_MS = 10_000;
const EMPTY_RETRY_MAX_MS = 10 * 60_000;

/**
 * An empty page usually means Spotify rate-limited the catalog search (429).
 * Retrying every 10 s kept that limit hot and slowed playback requests on the
 * same session, so each further empty answer doubles the wait.
 */
export function emptyReleasesRetryMs(emptyAnswers: number): number {
  const doublings = Math.min(Math.max(emptyAnswers - 1, 0), 6);
  return Math.min(EMPTY_RETRY_BASE_MS * 2 ** doublings, EMPTY_RETRY_MAX_MS);
}
