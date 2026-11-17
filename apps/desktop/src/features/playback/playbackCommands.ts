import type { MediaItem, PlaybackState, PlayerCommandRequest, RepeatMode } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import {
  usePlayerStore,
  type ReconnectSnapshot,
  type TransportAction,
} from "../../stores/playerStore";
import type { TransportCommandRequest } from "../../types/tauri";
import {
  invalidatePlaybackStateLoader,
  loadPlaybackStateOnce,
  resetPlaybackStateLoaderForTests,
} from "./playbackStateLoader";
import { volumeCoordinator } from "./VolumeCommandCoordinator";
import { isListenTogetherGuestLock } from "../listen-together/guestLock";
import { controlRoom, currentRoomTransport, skipRoomTrack } from "../listen-together/roomTransport";
import { deferredPlaybackIntent } from "./DeferredPlaybackIntent";

const SEEK_TIMEOUT_MS = 3_500;
const VERIFY_DELAY_MS = 225;
/** A skip the backend has not answered by then is logged as stale, not retried. */
export const TRANSPORT_INTENT_TTL_MS = 4_500;
let commandSequence = 0;

interface QueuedCommand<T> {
  requestId: string;
  value: T;
  connectionEpoch: number;
}

export class LatestCommandQueue<T> {
  private queued: T | undefined;
  private active = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly worker: (value: T) => Promise<void>) {}

  enqueue(value: T): void {
    this.queued = value;
    if (!this.active) void this.drain();
  }

  whenIdle(): Promise<void> {
    if (!this.active && this.queued === undefined) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.active = true;
    while (this.queued !== undefined) {
      const value = this.queued;
      this.queued = undefined;
      await this.worker(value);
    }
    this.active = false;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

const seekQueue = new LatestCommandQueue<QueuedCommand<number>>(executeSeek);
let generalTransportChain = Promise.resolve();
const transportInFlight = new Set<Promise<void>>();

export const playbackCommands = {
  send(request: PlayerCommandRequest): void {
    const store = usePlayerStore.getState();
    store.markUserAction();
    if (isListenTogetherGuestLock() && !roomAllowsLocally(request)) return;
    if (store.connection !== "online") return;
    const connectionEpoch = store.connectionEpoch;
    switch (request.command) {
      case "next":
      case "previous":
        dispatchTransport(request.command, connectionEpoch);
        return;
      case "setShuffle":
        if (typeof request.enabled === "boolean") setShuffle(request.enabled);
        return;
      case "setRepeat":
        if (request.repeatMode !== undefined) setRepeat(request.repeatMode);
        return;
      case "setVolume":
        if (request.value !== undefined) volumeCoordinator.set(request.value);
        return;
      case "toggleMute":
        void volumeCoordinator.toggleMute();
        return;
      case "seek":
        return;
      default:
        generalTransportChain = generalTransportChain.then(
          () => executeTransport(request, connectionEpoch),
          () => executeTransport(request, connectionEpoch),
        );
    }
  },

  beginSeek(): void {
    if (isListenTogetherGuestLock() && !currentRoomTransport().canControl) return;
    const store = usePlayerStore.getState();
    store.markUserAction();
    if (store.connection === "online") store.beginSeek();
  },

  previewSeek(positionMs: number): void {
    usePlayerStore.getState().previewSeek(positionMs);
  },

  commitSeek(): void {
    const room = currentRoomTransport();
    if (room.inRoom && !room.canControl) return;
    const requestId = nextRequestId("seek");
    const targetMs = usePlayerStore.getState().commitSeek(requestId);
    if (targetMs === undefined) return;
    if (room.inRoom) {
      // Seeking steers the room: the host's player directly, guests via the relay.
      void controlRoom({ type: "seek", positionMs: Math.round(targetMs) });
      globalThis.setTimeout(() => void resyncSeek(requestId, "timeout"), SEEK_TIMEOUT_MS);
      return;
    }
    diagnose("sent", "seek", requestId, targetMs);
    seekQueue.enqueue({ requestId, value: targetMs, connectionEpoch: usePlayerStore.getState().connectionEpoch });
    globalThis.setTimeout(() => void resyncSeek(requestId, "timeout"), SEEK_TIMEOUT_MS);
  },

  playUri(uri: string, contextTracks?: MediaItem[], preserveQueue = false): void {
    const store = usePlayerStore.getState();
    store.markUserAction();
    if (store.connection !== "online") {
      if (!preserveQueue) deferredPlaybackIntent.enqueueUri(uri);
      return;
    }
    const connectionEpoch = store.connectionEpoch;
    generalTransportChain = generalTransportChain.then(
      () => executePlayUri(uri, connectionEpoch, contextTracks, preserveQueue),
      () => executePlayUri(uri, connectionEpoch, contextTracks, preserveQueue),
    );
  },

  playContext(contextUri: string, trackUri: string, contextTracks?: MediaItem[]): void {
    const store = usePlayerStore.getState();
    store.markUserAction();
    if (store.connection !== "online") {
      deferredPlaybackIntent.enqueueContext(contextUri, trackUri);
      return;
    }
    const connectionEpoch = store.connectionEpoch;
    generalTransportChain = generalTransportChain.then(
      () => executePlayContext(contextUri, trackUri, connectionEpoch, contextTracks),
      () => executePlayContext(contextUri, trackUri, connectionEpoch, contextTracks),
    );
  },

  resume(snapshot: ReconnectSnapshot, actual: PlaybackState): void {
    if (isListenTogetherGuestLock()) return;
    generalTransportChain = generalTransportChain.then(
      () => executeResume(snapshot, actual),
      () => executeResume(snapshot, actual),
    );
  },

  flushDeferredIntent(): boolean {
    if (isListenTogetherGuestLock()) { deferredPlaybackIntent.clear(); return false; }
    const store = usePlayerStore.getState();
    if (store.connection !== "online") return false;
    const intent = deferredPlaybackIntent.take();
    if (!intent) return false;
    const connectionEpoch = store.connectionEpoch;
    generalTransportChain = generalTransportChain.then(
      () => intent.kind === "uri"
        ? executePlayUri(intent.uri, connectionEpoch)
        : executePlayContext(intent.contextUri, intent.trackUri, connectionEpoch),
      () => intent.kind === "uri"
        ? executePlayUri(intent.uri, connectionEpoch)
        : executePlayContext(intent.contextUri, intent.trackUri, connectionEpoch),
    );
    return true;
  },
};

export async function waitForPlaybackCommandsForTests(): Promise<void> {
  await Promise.all([
    seekQueue.whenIdle(),
    volumeCoordinator.whenIdle(),
    generalTransportChain,
    ...transportInFlight,
  ]);
}

export function resetPlaybackCommandsForTests(): void {
  commandSequence = 0;
  generalTransportChain = Promise.resolve();
  transportInFlight.clear();
  volumeCoordinator.resetForTests();
  deferredPlaybackIntent.clear();
  resetPlaybackStateLoaderForTests();
}

/**
 * Next/Previous go straight to the engine, one request per click. Libre
 * advances its queue and history synchronously for every click and merges a
 * burst into a single stream load, so nothing here serializes or blocks
 * skips. The store's clock ordering drops answers overtaken by newer events.
 */
function dispatchTransport(action: TransportAction, connectionEpoch: number): void {
  const store = usePlayerStore.getState();
  const createdAtMs = Date.now();
  const confirmed = store.confirmed;
  const request: TransportCommandRequest = {
    requestId: nextRequestId(action),
    action,
    createdAtMs,
    sentAtMs: createdAtMs,
    expiresAtMs: createdAtMs + TRANSPORT_INTENT_TTL_MS,
    connectionEpoch,
    createdTrackGeneration: store.generation,
    trackGeneration: store.generation,
    ...(confirmed?.currentItem?.uri ? { trackUriBefore: confirmed.currentItem.uri } : {}),
    positionBeforeMs: confirmed?.positionMs ?? 0,
  };
  diagnose("sent", action, request.requestId, request.trackUriBefore);
  const pending = desktopApi.transportCommand(request)
    .then((state) => {
      if (!commandCanApply(connectionEpoch)) return;
      applyTrackResponse(state);
      diagnose("confirmed", action, request.requestId, state.currentItem?.uri);
    })
    .catch((error: unknown) => {
      diagnose("failed", action, request.requestId, safeMessage(error));
      invalidatePlaybackStateLoader();
    })
    .finally(() => {
      transportInFlight.delete(pending);
      const current = usePlayerStore.getState();
      current.setTransportPending(
        transportInFlight.size,
        transportInFlight.size > 0 ? current.transportPending.activeAction : undefined,
      );
    });
  transportInFlight.add(pending);
  store.setTransportPending(transportInFlight.size, action);
}

function setShuffle(enabled: boolean): void {
  const store = usePlayerStore.getState();
  if (store.pending.shuffle !== null) return;
  const requestId = nextRequestId("shuffle");
  store.setControlOptimistic("shuffle", requestId, enabled);
  diagnose("sent", "shuffle", requestId, enabled);
  void executeConfirmedControl("shuffle", requestId, enabled, {
    command: "setShuffle",
    enabled,
  }, store.connectionEpoch);
}

function setRepeat(mode: RepeatMode): void {
  const store = usePlayerStore.getState();
  if (store.pending.repeat !== null) return;
  const requestId = nextRequestId("repeat");
  store.setControlOptimistic("repeat", requestId, mode);
  diagnose("sent", "repeat", requestId, mode);
  void executeConfirmedControl("repeat", requestId, mode, {
    command: "setRepeat",
    repeatMode: mode,
  }, store.connectionEpoch);
}

async function executeConfirmedControl(
  control: "shuffle" | "repeat",
  requestId: string,
  target: boolean | RepeatMode,
  request: PlayerCommandRequest,
  connectionEpoch: number,
): Promise<void> {
  if (!commandCanRun(connectionEpoch)) return;
  try {
    let state = await desktopApi.playerCommand(request);
    if (!commandCanApply(connectionEpoch)) return;
    if (usePlayerStore.getState().pending[control] !== requestId) return;
    if (!controlMatches(state, control, target)) {
      await delay(VERIFY_DELAY_MS);
      state = await loadPlaybackStateOnce();
      if (!commandCanApply(connectionEpoch)) return;
    }
    if (!controlMatches(state, control, target)) throw new Error("Engine state did not match the requested target");
    usePlayerStore.getState().confirmControl(control, requestId, state);
    diagnose("confirmed", control, requestId, target);
  } catch (error: unknown) {
    usePlayerStore.getState().rollbackControl(control, requestId);
    diagnose("failed", control, requestId, safeMessage(error));
  }
}

async function executeSeek(command: QueuedCommand<number>): Promise<void> {
  if (!commandCanRun(command.connectionEpoch)) return;
  try {
    const state = await desktopApi.playerCommand({ command: "seek", value: command.value });
    if (!commandCanApply(command.connectionEpoch)) return;
    if (usePlayerStore.getState().pending.seek !== command.requestId) return;
    usePlayerStore.getState().applyProgress({
      positionMs: state.positionMs,
      durationMs: state.durationMs,
      ...(state.currentItem?.uri ? { trackUri: state.currentItem.uri } : {}),
      eventTimestampMs: Date.now(),
    });
    if (usePlayerStore.getState().pending.seek === null) {
      diagnose("confirmed", "seek", command.requestId, state.positionMs);
    }
  } catch (error: unknown) {
    diagnose("failed", "seek", command.requestId, safeMessage(error));
    await resyncSeek(command.requestId, "error");
  }
}

async function resyncSeek(requestId: string, reason: "error" | "timeout"): Promise<void> {
  if (usePlayerStore.getState().pending.seek !== requestId) return;
  diagnose("resync", "seek", requestId, reason);
  try {
    const connectionEpoch = usePlayerStore.getState().connectionEpoch;
    if (!commandCanRun(connectionEpoch)) return;
    const state = await loadPlaybackStateOnce();
    if (commandCanApply(connectionEpoch) && usePlayerStore.getState().pending.seek === requestId) {
      usePlayerStore.getState().setPlayback(state, true);
    }
  } catch (error: unknown) {
    usePlayerStore.getState().rollbackControl("seek", requestId);
    diagnose("failed", "seek", requestId, safeMessage(error));
  }
}

async function executeTransport(request: PlayerCommandRequest, connectionEpoch: number): Promise<void> {
  if (!commandCanRun(connectionEpoch)) return;
  const requestId = nextRequestId("transport");
  diagnose("sent", request.command, requestId);
  try {
    const state = await desktopApi.playerCommand(request);
    if (!commandCanApply(connectionEpoch)) return;
    applyTransportResponse(request.command, state);
    diagnose("confirmed", request.command, requestId);
  } catch (error: unknown) {
    diagnose("failed", request.command, requestId, safeMessage(error));
  }
}

async function executePlayUri(uri: string, connectionEpoch: number, contextTracks?: MediaItem[], preserveQueue = false): Promise<void> {
  if (!commandCanRun(connectionEpoch)) return;
  const requestId = nextRequestId("play-uri");
  diagnose("sent", "playUri", requestId);
  try {
    const state = preserveQueue
      ? await desktopApi.playUri(uri, undefined, true)
      : contextTracks?.length
      ? await desktopApi.playUri(uri, contextTracks)
      : await desktopApi.playUri(uri);
    if (!commandCanApply(connectionEpoch)) return;
    applyTrackResponse(state);
    diagnose("confirmed", "playUri", requestId);
  } catch (error: unknown) {
    diagnose("failed", "playUri", requestId, safeMessage(error));
  }
}

async function executePlayContext(contextUri: string, trackUri: string, connectionEpoch: number, contextTracks?: MediaItem[]): Promise<void> {
  if (!commandCanRun(connectionEpoch)) return;
  const requestId = nextRequestId("play-context");
  diagnose("sent", "playContext", requestId);
  try {
    const state = await desktopApi.playContext(contextUri, trackUri, contextTracks);
    if (!commandCanApply(connectionEpoch)) return;
    applyTrackResponse(state);
    diagnose("confirmed", "playContext", requestId);
  } catch (error: unknown) {
    diagnose("failed", "playContext", requestId, safeMessage(error));
  }
}

async function executeResume(snapshot: ReconnectSnapshot, actual: PlaybackState): Promise<void> {
  const store = usePlayerStore.getState();
  if (store.connection !== "online"
    || store.connectionEpoch !== snapshot.connectionEpoch
    || store.userActionRevision !== snapshot.userActionRevision
    || !snapshot.trackUri) return;
  const requestId = nextRequestId("resume");
  diagnose("sent", "resume", requestId);
  try {
    let state = actual;
    if (actual.currentItem?.uri !== snapshot.trackUri) {
      state = snapshot.contextUri
        ? await desktopApi.playContext(snapshot.contextUri, snapshot.trackUri)
        : await desktopApi.playUri(snapshot.trackUri);
      if (!resumeCanApply(snapshot)) return;
      if (snapshot.positionMs > 0) {
        state = await desktopApi.playerCommand({ command: "seek", value: snapshot.positionMs });
      }
    }
    if (!resumeCanApply(snapshot)) return;
    if (!state.isPlaying) state = await desktopApi.playerCommand({ command: "play" });
    if (!resumeCanApply(snapshot)) return;
    usePlayerStore.getState().setPlayback(state, true);
    diagnose("confirmed", "resume", requestId);
  } catch (error: unknown) {
    diagnose("failed", "resume", requestId, safeMessage(error));
  }
}

function applyTransportResponse(command: PlayerCommandRequest["command"], state: PlaybackState): void {
  if (command === "next" || command === "previous") {
    applyTrackResponse(state);
    return;
  }
  if (command === "toggleMute") {
    usePlayerStore.getState().applyPatch({ isMuted: state.isMuted, updatedAt: state.updatedAt });
    return;
  }
  if (command === "toggleLike") {
    usePlayerStore.getState().applyPatch({ isSaved: state.isSaved, updatedAt: state.updatedAt });
    return;
  }
  usePlayerStore.getState().applyPatch({
    isPlaying: state.isPlaying,
    ...(state.clockReady !== undefined ? { clockReady: state.clockReady } : {}),
    positionMs: state.positionMs,
    durationMs: state.durationMs,
    updatedAt: state.updatedAt,
  });
}

function applyTrackResponse(state: PlaybackState): void {
  const store = usePlayerStore.getState();
  const confirmed = store.confirmed;
  store.setPlayback({
    ...state,
    ...(confirmed ? {
      shuffleEnabled: confirmed.shuffleEnabled,
      repeatMode: confirmed.repeatMode,
      volume: confirmed.volume,
      isMuted: confirmed.isMuted,
    } : {}),
  });
}

function controlMatches(state: PlaybackState, control: "shuffle" | "repeat", target: boolean | RepeatMode): boolean {
  return control === "shuffle" ? state.shuffleEnabled === target : state.repeatMode === target;
}

function nextRequestId(control: string): string {
  commandSequence += 1;
  return `${control}-${commandSequence}`;
}

function diagnose(phase: string, control: string, requestId: string, value?: unknown): void {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  console.debug("[Luftify]", {
    phase,
    control,
    requestId,
    ...(value !== undefined ? { value } : {}),
    generation: usePlayerStore.getState().generation,
  });
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : "unknown player error";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function commandCanRun(connectionEpoch: number): boolean {
  const state = usePlayerStore.getState();
  return state.connection === "online" && state.connectionEpoch === connectionEpoch;
}

function commandCanApply(connectionEpoch: number): boolean {
  return commandCanRun(connectionEpoch);
}

function resumeCanApply(snapshot: ReconnectSnapshot): boolean {
  const state = usePlayerStore.getState();
  return state.connection === "online"
    && state.connectionEpoch === snapshot.connectionEpoch
    && state.userActionRevision === snapshot.userActionRevision;
}

/**
 * In a room the shared queue picks the music. Like and volume stay local,
 * skip removes the playing occurrence, and play/pause/seek go to the room
 * (Rust plays them on the host's player; guests ask the relay once the host
 * allows it). Returns whether the normal local path should run.
 */
function roomAllowsLocally(request: PlayerCommandRequest): boolean {
  const room = currentRoomTransport();
  switch (request.command) {
    case "toggleLike":
    case "setVolume":
    case "toggleMute":
      return true;
    case "next":
      void skipRoomTrack();
      return false;
    case "play":
    case "pause":
      void controlRoom({ type: request.command });
      return false;
    case "previous":
      // No history in a shared queue: start the song again.
      if (room.canControl) void controlRoom({ type: "seek", positionMs: 0 });
      return false;
    default:
      return false;
  }
}
