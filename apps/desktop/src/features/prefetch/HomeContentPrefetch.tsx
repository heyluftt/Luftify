import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { discoveryQuery } from "../discovery/discoveryQuery";
import { useHomeNewReleases } from "../home/useHomeNewReleases";
import { initializeMixLibrary, useMixLibrary } from "../discovery/mixLibrary";

// Runs only in the main window and shares the page's cache/in-flight requests.
export function HomeContentPrefetch() {
  useEffect(() => { void initializeMixLibrary().catch(() => {}); }, []);
  const libraryReady = useMixLibrary((store) => store.ready);
  const client = useQueryClient();
  // Retain an observer outside the route: consuming the query's AbortSignal
  // otherwise makes leaving Home cancel both manual and prefetched mixes.
  useQuery({ ...discoveryQuery(client), enabled: false });
  const { localReady, engineReady } = usePlaybackEngine();
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings, staleTime: 30_000 });
  const [settled, setSettled] = useState(false);
  const ready = engineReady;
  useEffect(() => {
    setSettled(false);
    if (!ready) return;
    const timer = window.setTimeout(() => setSettled(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const releases = useHomeNewReleases(settled, false);
  const canDiscover = libraryReady && localReady && settings.data?.listeningAnalyticsEnabled === true;
  useEffect(() => {
    if (!canDiscover) {
      void client.cancelQueries({ queryKey: ["discovery-mix"] });
      return;
    }
    // Let releases finish first; no automatic retry loop, even after failure.
    if (!settled || releases.isFetching) return;
    // The query cache is empty after restart even when the durable collection
    // is full. Only a deliberate "New mix" may evict a saved mix.
    if (useMixLibrary.getState().mixes.length >= 5) return;
    const mix = client.getQueryState(["discovery-mix"]);
    if (mix && (mix.data !== undefined || mix.status === "error" || mix.fetchStatus !== "idle")) return;
    void client.prefetchQuery(discoveryQuery(client));
  }, [canDiscover, settled, releases.isFetching, client]);
  return null;
}
