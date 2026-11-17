import type { PlaybackState } from "@luft/protocol-types";
import { useShallow } from "zustand/react/shallow";
import { usePlayerStore } from "../../stores/playerStore";
import { playbackCommands } from "./playbackCommands";

/**
 * Everything about playback, including the position. The position changes
 * with every progress event, so this re-renders its caller on each tick:
 * use it only where the time is shown. Pages that only start playback or
 * read a few fields use the narrow hooks below.
 */
export function usePlayback() {
  const playback = usePlayerStore((store) => store.playback);
  const connection = usePlayerStore((store) => store.connection);
  const pending = usePlayerStore((store) => store.pending);
  const seekStatus = usePlayerStore((store) => store.seek);
  const transportPending = usePlayerStore((store) => store.transportPending);
  return {
    playback,
    command: playbackCommands.send,
    playUri: playbackCommands.playUri,
    playContext: playbackCommands.playContext,
    seek: {
      begin: playbackCommands.beginSeek,
      preview: playbackCommands.previewSeek,
      commit: playbackCommands.commitSeek,
      status: seekStatus,
    },
    pending,
    commandPending: Object.values(pending).some((requestId) => requestId !== null),
    connected: connection === "online",
    connection,
    transportPending,
    isError: connection === "offline" && playback === undefined,
  };
}

const PLAYBACK_ACTIONS = {
  command: playbackCommands.send,
  playUri: playbackCommands.playUri,
  playContext: playbackCommands.playContext,
} as const;

/** Start or steer playback without subscribing to any playback state. */
export function usePlaybackActions() {
  return PLAYBACK_ACTIONS;
}

export function usePlaybackConnected(): boolean {
  return usePlayerStore((store) => store.connection === "online");
}

/**
 * A few playback fields, compared shallowly: re-renders only when one of
 * them changes, not on every progress tick. Return plain values or stable
 * references (e.g. `currentItem`), never a freshly built object or array.
 */
export function usePlaybackSelect<T extends Record<string, unknown>>(
  select: (playback: PlaybackState | undefined) => T,
): T {
  return usePlayerStore(useShallow((store) => select(store.playback)));
}
