import { useEffect } from "react";
import { usePlayerStore } from "../../stores/playerStore";
import { loadPlaybackStateOnce } from "./playbackStateLoader";

const LYRICS_TRUTH_REFRESH_MS = 5_000;

/**
 * Libre pushes a clock sample every two seconds; this slower request-driven
 * read only catches a lost sample on the timing-sensitive lyrics view and
 * deliberately avoids reconnect/resume side effects.
 */
export function usePlaybackTruthRefresh(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(refresh, LYRICS_TRUTH_REFRESH_MS);
    };

    const refresh = async () => {
      const before = usePlayerStore.getState();
      if (
        before.connection !== "online"
        || before.seek.phase !== "idle"
        || before.transportPending.count > 0
      ) {
        schedule();
        return;
      }

      const connectionEpoch = before.connectionEpoch;
      const generation = before.generation;
      try {
        const actual = await loadPlaybackStateOnce();
        if (disposed) return;
        const current = usePlayerStore.getState();
        if (
          current.connection === "online"
          && current.connectionEpoch === connectionEpoch
          && current.generation === generation
          && current.seek.phase === "idle"
          && current.transportPending.count === 0
        ) {
          current.setPlayback(actual);
        }
      } catch {
        // The normal connection lifecycle owns offline/reconnect transitions.
      } finally {
        schedule();
      }
    };

    void refresh();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active]);
}
