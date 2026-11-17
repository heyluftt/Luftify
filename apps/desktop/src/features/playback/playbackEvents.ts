import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MediaItem, PlaybackState, PlaybackStatePatch, RepeatMode } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import { playbackCommands } from "./playbackCommands";
import {
  loadPlaybackStateOnce,
  resetPlaybackStateLoaderForTests,
} from "./playbackStateLoader";
import type { VolumeEventTrace } from "../../types/tauri";
import { volumeCoordinator } from "./VolumeCommandCoordinator";

let retainCount = 0;
let listenerGeneration = 0;
let activeUnlisteners: UnlistenFn[] = [];
let resyncOperation: { connectionEpoch: number; promise: Promise<void> } | undefined;
const RESYNC_RETRY_DELAYS_MS = [125, 375] as const;

export function retainPlaybackEvents(): () => void {
  retainCount += 1;
  if (retainCount === 1) startListeners();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    retainCount = Math.max(0, retainCount - 1);
    if (retainCount === 0) stopListeners();
  };
}

function startListeners(): void {
  const generation = ++listenerGeneration;
  const listeners = [
    listen<unknown>("player://state-changed", ({ payload }) => {
      if (isPlaybackState(payload)) {
        const store = usePlayerStore.getState();
        if (store.connection !== "offline") store.setPlayback(payload);
      } else {
        void resyncPlayback("invalid-state-event");
      }
    }),
    listen<unknown>("player://track-changed", ({ payload }) => {
      const patch = playbackPatch(payload);
      if (patch) usePlayerStore.getState().applyPatch(patch);
    }),
    listen<unknown>("player://playback-changed", ({ payload }) => {
      const patch = playbackPatch(payload);
      if (patch) usePlayerStore.getState().applyPatch(patch);
    }),
    listen<unknown>("player://progress-changed", ({ payload }) => {
      if (!isRecord(payload) || typeof payload.positionMs !== "number" || typeof payload.eventTimestampMs !== "number") return;
      usePlayerStore.getState().applyProgress({
        positionMs: payload.positionMs,
        ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
        ...(typeof payload.trackUri === "string" ? { trackUri: payload.trackUri } : {}),
        eventTimestampMs: payload.eventTimestampMs,
      });
    }),
    listen<unknown>("player://shuffle-changed", ({ payload }) => {
      if (isRecord(payload) && typeof payload.enabled === "boolean") usePlayerStore.getState().applyShuffle(payload.enabled);
    }),
    listen<unknown>("player://repeat-changed", ({ payload }) => {
      if (isRecord(payload) && isRepeatMode(payload.mode)) usePlayerStore.getState().applyRepeat(payload.mode);
    }),
    listen<unknown>("player://volume-changed", ({ payload }) => {
      const event = volumeEvent(payload);
      if (event) volumeCoordinator.handleVolumeEvent(event);
    }),
  ];

  void Promise.allSettled(listeners).then((results) => {
    const unlisteners = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []);
    if (generation !== listenerGeneration || retainCount === 0) {
      for (const unlisten of unlisteners) unlisten();
      return;
    }
    activeUnlisteners = unlisteners;
    if (import.meta.env.DEV && results.some((result) => result.status === "rejected")) {
      console.warn("[Luftify] Some playback event listeners could not be registered.");
    }
  });
}

function stopListeners(): void {
  listenerGeneration += 1;
  for (const unlisten of activeUnlisteners.splice(0)) unlisten();
}

export async function resyncPlayback(reason: string): Promise<void> {
  const connectionEpoch = usePlayerStore.getState().connectionEpoch;
  if (resyncOperation?.connectionEpoch === connectionEpoch) {
    return resyncOperation.promise;
  }
  const promise = loadPlaybackStateWithRetry(connectionEpoch)
    .then(async (state) => {
      if (!state) return;
      const store = usePlayerStore.getState();
      if (store.connectionEpoch !== connectionEpoch) return;
      store.setPlayback(state, true);
      usePlayerStore.getState().setConnection("online");
      volumeCoordinator.reconnect(state, reason);
      if (!playbackCommands.flushDeferredIntent()) await resumeAfterReconnect(state);
      if (import.meta.env.DEV && import.meta.env.MODE !== "test") console.debug("[Luftify]", { phase: "resynced", reason, generation: usePlayerStore.getState().generation });
    })
    .catch(() => {
      const store = usePlayerStore.getState();
      if (store.connectionEpoch === connectionEpoch) store.setConnection("offline");
    })
    .finally(() => {
      if (resyncOperation?.promise === promise) resyncOperation = undefined;
    });
  resyncOperation = { connectionEpoch, promise };
  return promise;
}

async function loadPlaybackStateWithRetry(
  connectionEpoch: number,
): Promise<PlaybackState | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await loadPlaybackStateOnce();
    } catch (error) {
      const store = usePlayerStore.getState();
      if (store.connectionEpoch !== connectionEpoch) {
        return undefined;
      }
      const delayMs = RESYNC_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) throw error;
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }
}

function volumeEvent(value: unknown): VolumeEventTrace | undefined {
  if (!isRecord(value)
    || typeof value.volume !== "number"
    || typeof value.isMuted !== "boolean"
    || typeof value.eventTimestampMs !== "number") return undefined;
  return {
    volume: value.volume,
    isMuted: value.isMuted,
    eventTimestampMs: value.eventTimestampMs,
    ...(typeof value.preview === "boolean" ? { preview: value.preview } : {}),
    ...(typeof value.requestId === "string" ? { requestId: value.requestId } : {}),
    ...(typeof value.sequence === "number" ? { sequence: value.sequence } : {}),
    ...(typeof value.connectionEpoch === "number" ? { connectionEpoch: value.connectionEpoch } : {}),
    ...(typeof value.createdAtMs === "number" ? { createdAtMs: value.createdAtMs } : {}),
    ...(typeof value.rustQueuedAtMs === "number" ? { rustQueuedAtMs: value.rustQueuedAtMs } : {}),
  };
}

async function resumeAfterReconnect(actual: PlaybackState): Promise<void> {
  const snapshot = usePlayerStore.getState().claimResume();
  if (!snapshot?.trackUri) return;
  const settings = await desktopApi.settings().catch(() => undefined);
  if (!settings || settings.reconnectResumeMode === "never") return;
  if (settings.reconnectResumeMode === "ifWasPlaying" && !snapshot.wasPlaying) return;
  playbackCommands.resume(snapshot, actual);
}

function playbackPatch(value: unknown): PlaybackStatePatch | undefined {
  if (!isRecord(value)) return undefined;
  const patch: PlaybackStatePatch = {};
  if (isRecord(value.currentItem)
    && typeof value.currentItem.uri === "string"
    && typeof value.currentItem.title === "string"
    && Array.isArray(value.currentItem.creators)) {
    patch.currentItem = value.currentItem as unknown as MediaItem;
  }
  if (typeof value.isPlaying === "boolean") patch.isPlaying = value.isPlaying;
  if (typeof value.positionMs === "number") patch.positionMs = value.positionMs;
  if (typeof value.durationMs === "number") patch.durationMs = value.durationMs;
  if (typeof value.volume === "number") patch.volume = value.volume;
  if (typeof value.isMuted === "boolean") patch.isMuted = value.isMuted;
  if (typeof value.shuffleEnabled === "boolean") patch.shuffleEnabled = value.shuffleEnabled;
  if (isRepeatMode(value.repeatMode)) patch.repeatMode = value.repeatMode;
  if (typeof value.isSaved === "boolean") patch.isSaved = value.isSaved;
  if (typeof value.contextUri === "string") patch.contextUri = value.contextUri;
  if (typeof value.updatedAt === "string") patch.updatedAt = value.updatedAt;
  if (typeof value.clockReady === "boolean") patch.clockReady = value.clockReady;
  return Object.keys(patch).length ? patch : undefined;
}

function isPlaybackState(value: unknown): value is PlaybackState {
  if (!isRecord(value)) return false;
  return typeof value.isPlaying === "boolean"
    && typeof value.positionMs === "number"
    && typeof value.durationMs === "number"
    && typeof value.volume === "number"
    && typeof value.isMuted === "boolean"
    && typeof value.shuffleEnabled === "boolean"
    && isRepeatMode(value.repeatMode)
    && typeof value.isSaved === "boolean"
    && typeof value.updatedAt === "string";
}

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === "off" || value === "all" || value === "one";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resetPlaybackEventSubscriptionForTests(): void {
  retainCount = 0;
  stopListeners();
  resyncOperation = undefined;
  resetPlaybackStateLoaderForTests();
}
