import { listen } from "@tauri-apps/api/event";
import type { PlaybackState } from "@luft/protocol-types";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlayerStore } from "../../stores/playerStore";
import { queryClient } from "../../queryClient";
import { desktopApi } from "../../services/desktopApi";
import { resyncPlayback, retainPlaybackEvents } from "./playbackEvents";
import { invalidatePlaybackStateLoader } from "./playbackStateLoader";
import { volumeCoordinator } from "./VolumeCommandCoordinator";
import { usePlaybackEngine } from "./usePlaybackEngine";
import { QUEUE_QUERY_KEY, useQueueQuery } from "../queue/queueQueries";

/**
 * Libre pushes every state change and a clock sample every two seconds.
 * The periodic full read only catches a lost event; it must not become the
 * clock source again, which is why it is far slower than the samples.
 */
const PLAYBACK_RESYNC_INTERVAL_MS = 6_000;
/** The demo provider pushes nothing, so the window keeps polling it. */
const MOCK_RESYNC_INTERVAL_MS = 1_000;
const QUEUE_SAFETY_POLL_MS = 15_000;
const QUEUE_MOCK_POLL_MS = 4_000;

interface PlaybackPollResult {
  playback: PlaybackState;
  connectionEpoch: number;
  generation: number;
}

export function playbackPollMatches(
  poll: Pick<PlaybackPollResult, "connectionEpoch" | "generation">,
  current: Pick<ReturnType<typeof usePlayerStore.getState>, "connectionEpoch" | "generation">,
): boolean {
  return poll.connectionEpoch === current.connectionEpoch
    && poll.generation === current.generation;
}

export function PlaybackSync({ mode = "full" }: { mode?: "full" | "compact" }) {
  const setPlayback = usePlayerStore((store) => store.setPlayback);
  const setConnection = usePlayerStore((store) => store.setConnection);
  const connectionEpoch = usePlayerStore((store) => store.connectionEpoch);
  const { localReady, engineReady, mockMode } = usePlaybackEngine();
  const wasReady = useRef<boolean | undefined>(undefined);

  useEffect(() => retainPlaybackEvents(), []);

  // A cached last state shows the previous title while Libre still connects.
  useEffect(() => {
    void resyncPlayback("startup");
  }, []);

  // Session lost: freeze the clock and keep the reconnect snapshot. Session
  // back: read the truth once and let the resume policy decide.
  useEffect(() => {
    if (mockMode) return;
    const previous = wasReady.current;
    wasReady.current = localReady;
    if (previous === undefined) return;
    if (localReady && !previous) {
      invalidatePlaybackStateLoader();
      volumeCoordinator.abort("engine-ready");
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
      void resyncPlayback("engine-ready");
    } else if (!localReady && previous) {
      volumeCoordinator.abort("engine-lost");
      invalidatePlaybackStateLoader();
      usePlayerStore.getState().disconnect();
    }
  }, [localReady, mockMode]);

  const query = useQuery({
    queryKey: ["playback", connectionEpoch],
    queryFn: async (): Promise<PlaybackPollResult> => {
      const generation = usePlayerStore.getState().generation;
      const playback = await desktopApi.playbackState();
      return { playback, connectionEpoch, generation };
    },
    enabled: mode === "full" && engineReady,
    retry: 1,
    refetchInterval: mockMode ? MOCK_RESYNC_INTERVAL_MS : PLAYBACK_RESYNC_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
  // Libre announces every queue revision through queue://changed; the
  // periodic read only covers a lost event. The demo provider pushes nothing.
  useQueueQuery(mode === "full" && engineReady, mockMode ? QUEUE_MOCK_POLL_MS : QUEUE_SAFETY_POLL_MS);

  useEffect(() => {
    if (mode !== "full") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("queue://changed", () => {
      void queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mode]);
  useEffect(() => {
    if (!query.data) return;
    const current = usePlayerStore.getState();
    if (!playbackPollMatches(query.data, current)) return;
    if (current.seek.phase !== "idle" || current.transportPending.count > 0) return;
    if (performance.getEntriesByName("luft:engine-ready").length === 0) performance.mark("luft:engine-ready");
    setPlayback(query.data.playback);
    if (current.connection !== "online") setConnection("online");
  }, [query.data, setConnection, setPlayback]);
  return null;
}
