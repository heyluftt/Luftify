import type { RepeatMode } from "@luft/protocol-types";

export const PLAYBACK_CLOCK_TICK_MS = 100;
const STALE_TERMINAL_WINDOW_MS = 1_000;
const DELAYED_START_REWIND_MS = 400;
export const MAX_PLAYBACK_POSITION_MS = 24 * 60 * 60 * 1_000;

export function sanitizePlaybackPositionMs(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  if (durationMs > 0) return Math.min(positionMs, durationMs);
  return positionMs > MAX_PLAYBACK_POSITION_MS ? 0 : positionMs;
}

export interface PlaybackClockState {
  positionMs: number;
  cycle: number;
  trackKey?: string;
}

export interface PlaybackClockMode {
  durationMs: number;
  repeatMode: RepeatMode;
  playing: boolean;
  suspended: boolean;
}

export function isPlaybackClockLive(clockReady: boolean | undefined): boolean {
  return clockReady !== false;
}

export function resolvePlaybackDurationMs(
  durationMs: number | undefined,
  itemDurationMs: number | undefined,
): number {
  if (typeof durationMs === "number" && durationMs > 0) return durationMs;
  if (typeof itemDurationMs === "number" && itemDurationMs > 0) return itemDurationMs;
  return 0;
}

export function initialPlaybackClock(positionMs: number, trackKey?: string): PlaybackClockState {
  return {
    positionMs: Math.max(0, positionMs),
    cycle: 0,
    ...(trackKey ? { trackKey } : {}),
  };
}

export function advancePlaybackClock(
  state: PlaybackClockState,
  elapsedMs: number,
  mode: PlaybackClockMode,
): PlaybackClockState {
  if (!mode.playing || mode.suspended || elapsedMs <= 0) return state;
  const durationMs = Math.max(0, mode.durationMs);
  const nextPosition = state.positionMs + elapsedMs;
  if (durationMs <= 0) {
    return {
      ...state,
      positionMs: nextPosition > MAX_PLAYBACK_POSITION_MS ? state.positionMs : nextPosition,
    };
  }
  if (mode.repeatMode === "one" && durationMs > 0 && nextPosition >= durationMs) {
    const wraps = Math.max(1, Math.floor(nextPosition / durationMs));
    return {
      ...state,
      positionMs: nextPosition % durationMs,
      cycle: state.cycle + wraps,
    };
  }
  return { ...state, positionMs: durationMs > 0 ? Math.min(nextPosition, durationMs) : nextPosition };
}

export function synchronizePlaybackClock(
  state: PlaybackClockState,
  positionMs: number,
  trackKey: string | undefined,
  mode: PlaybackClockMode,
): PlaybackClockState {
  const durationMs = Math.max(0, mode.durationMs);
  const nextPosition = sanitizePlaybackPositionMs(positionMs, durationMs);
  const trackChanged = state.trackKey !== trackKey;
  if (trackChanged) return initialPlaybackClock(nextPosition, trackKey);

  const delayedStartRewind = mode.playing
    && !mode.suspended
    && mode.repeatMode !== "one"
    && nextPosition <= DELAYED_START_REWIND_MS
    && state.positionMs > nextPosition + DELAYED_START_REWIND_MS;
  if (delayedStartRewind) return state;

  const repeatOnePlaying = mode.repeatMode === "one" && mode.playing && !mode.suspended && durationMs > 0;
  const stateIsInNewCycle = state.cycle > 0 && state.positionMs < durationMs / 2;
  const incomingIsStaleTerminal = nextPosition >= durationMs - STALE_TERMINAL_WINDOW_MS;
  if (repeatOnePlaying && stateIsInNewCycle && incomingIsStaleTerminal) return state;

  const authoritativeWrap = repeatOnePlaying
    && state.positionMs >= durationMs * 0.75
    && nextPosition <= durationMs * 0.25;
  return {
    ...state,
    positionMs: nextPosition,
    cycle: state.cycle + (authoritativeWrap ? 1 : 0),
  };
}
