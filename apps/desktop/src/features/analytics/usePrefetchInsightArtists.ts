import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { coverProtocolUrl } from "../../components/coverQuery";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { DEFAULT_ANALYTICS_RANGE } from "./analyticsRanges";
import { useListeningOverview } from "./useListeningOverview";
import { artistPortraitsQuery, portraitUris } from "./useAnalyticsArtistDisplays";

/** A little after start, so the first screen does not wait for it. */
const DELAY_MS = 6_000;
/** Pictures fetched into the browser cache, the number one first. */
const PRELOADED_IMAGES = 3;

/**
 * Prepares the listening analysis' artist pictures in the background, so the
 * top artist (and the top song's cover) are there the moment the page opens.
 */
export function usePrefetchInsightArtists(enabled: boolean) {
  const client = useQueryClient();
  const { localReady } = usePlaybackEngine();
  const ready = enabled && localReady;
  const { query } = useListeningOverview(DEFAULT_ANALYTICS_RANGE, ready);
  const uris = query.data ? portraitUris(query.data.topArtists.slice(0, 10)) : [];
  const key = uris.join(",");
  useEffect(() => {
    if (!ready || !uris.length) return;
    const timer = window.setTimeout(() => {
      const topSong = query.data?.topTracks[0]?.track.coverUri;
      if (topSong) new Image().src = coverProtocolUrl(topSong, "large") ?? topSong;
      void client.prefetchQuery(artistPortraitsQuery(uris)).then(() => {
        const portraits = client.getQueryData<{ uri: string; coverUri?: string | null }[]>(artistPortraitsQuery(uris).queryKey) ?? [];
        const order = new Map(query.data!.topArtists.map((artist, index) => [artist.creator.uri, index]));
        [...portraits].sort((a, b) => (order.get(a.uri) ?? 99) - (order.get(b.uri) ?? 99))
          .slice(0, PRELOADED_IMAGES)
          .forEach((portrait) => { if (portrait.coverUri) new Image().src = coverProtocolUrl(portrait.coverUri, "large") ?? portrait.coverUri; });
      });
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [ready, key, client]);
}
