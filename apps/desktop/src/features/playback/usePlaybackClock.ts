import type { RepeatMode } from "@luft/protocol-types";
import { useEffect, useRef, useState } from "react";
import {
  PLAYBACK_CLOCK_TICK_MS,
  advancePlaybackClock,
  initialPlaybackClock,
  synchronizePlaybackClock,
  type PlaybackClockState,
} from "./playbackClock";

export interface PlaybackClockOptions {
  positionMs: number;
  durationMs: number;
  repeatMode: RepeatMode;
  playing: boolean;
  suspended: boolean;
  trackKey?: string;
  /**
   * Re-render only when the position crosses a multiple of this (e.g. 1000
   * for an mm:ss label). The clock itself keeps running at full precision;
   * 0 re-renders on every 100 ms tick (lyrics need that).
   */
  resolutionMs?: number;
}

export function usePlaybackClock(options: PlaybackClockOptions): PlaybackClockState {
  const [clock, setClock] = useState(() => initialPlaybackClock(options.positionMs, options.trackKey));
  const precise = useRef(clock);
  const lastTickAt = useRef(performance.now());
  const resolutionMs = useRef(0);
  resolutionMs.current = options.resolutionMs ?? 0;

  const publish = (next: PlaybackClockState) => {
    precise.current = next;
    setClock((current) => sameStep(current, next, resolutionMs.current) ? current : next);
  };

  useEffect(() => {
    lastTickAt.current = performance.now();
    const next = synchronizePlaybackClock(precise.current, options.positionMs, options.trackKey, options);
    precise.current = next;
    // An authoritative position (seek, new track) always shows at once.
    setClock(next);
  // A repeat-mode change changes wrapping, not the authoritative position.
  }, [options.playing, options.positionMs, options.suspended, options.trackKey]);

  useEffect(() => {
    lastTickAt.current = performance.now();
    if (!options.playing || options.suspended) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsedMs = Math.max(0, now - lastTickAt.current);
      lastTickAt.current = now;
      publish(advancePlaybackClock(precise.current, elapsedMs, options));
    }, PLAYBACK_CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [options.durationMs, options.playing, options.repeatMode, options.suspended, options.trackKey]);

  return clock;
}

function sameStep(current: PlaybackClockState, next: PlaybackClockState, resolutionMs: number): boolean {
  if (current === next) return true;
  if (resolutionMs <= 0) return false;
  return current.cycle === next.cycle
    && current.trackKey === next.trackKey
    && Math.floor(current.positionMs / resolutionMs) === Math.floor(next.positionMs / resolutionMs);
}
