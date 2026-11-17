import type {
  PlaybackState,
  PlaybackStatePatch,
  PlayerProgressEvent,
  RepeatMode,
} from "@luft/protocol-types";
import { create } from "zustand";

export const SEEK_CONFIRM_TOLERANCE_MS = 1_800;

export type SerializedControl = "seek" | "shuffle" | "repeat" | "volume";
export type SeekPhase = "idle" | "dragging" | "confirming";

interface OptimisticPlayback {
  positionMs?: number;
  shuffleEnabled?: boolean;
  repeatMode?: RepeatMode;
  volume?: number;
  isMuted?: boolean;
}

export interface SeekStatus {
  phase: SeekPhase;
  generation: number;
  targetMs?: number;
}

export interface PendingControls {
  seek: string | null;
  shuffle: string | null;
  repeat: string | null;
  volume: string | null;
}

export interface ReconnectSnapshot {
  trackUri?: string;
  positionMs: number;
  wasPlaying: boolean;
  contextUri?: string;
  disconnectedAt: number;
  connectionEpoch: number;
  userActionRevision: number;
}

export type TransportAction = "next" | "previous";

export interface TransportPendingState {
  count: number;
  activeAction?: TransportAction;
}

interface PlayerStore {
  confirmed: PlaybackState | undefined;
  playback: PlaybackState | undefined;
  optimistic: OptimisticPlayback;
  connection: "offline" | "connecting" | "online";
  generation: number;
  connectionEpoch: number;
  lastProgressEventTimestampMs: number;
  userActionRevision: number;
  reconnectSnapshot: ReconnectSnapshot | undefined;
  resumeAttempted: boolean;
  transportPending: TransportPendingState;
  seek: SeekStatus;
  pending: PendingControls;
  setPlayback: (playback: PlaybackState, forceSeek?: boolean) => void;
  applyPatch: (patch: PlaybackStatePatch) => void;
  applyProgress: (event: PlayerProgressEvent) => void;
  applyShuffle: (enabled: boolean) => void;
  applyRepeat: (mode: RepeatMode) => void;
  applyVolume: (volume: number, isMuted: boolean) => void;
  setVolumeOptimistic: (requestId: string, volume: number, isMuted: boolean) => void;
  confirmVolume: (requestId: string, volume: number, isMuted: boolean) => void;
  beginSeek: () => void;
  previewSeek: (positionMs: number) => void;
  commitSeek: (requestId: string) => number | undefined;
  setControlOptimistic: (control: Exclude<SerializedControl, "seek">, requestId: string, value: boolean | number | RepeatMode) => void;
  confirmControl: (control: Exclude<SerializedControl, "seek">, requestId: string, playback: PlaybackState) => void;
  rollbackControl: (control: SerializedControl, requestId: string) => void;
  setConnection: (connection: PlayerStore["connection"]) => void;
  disconnect: () => void;
  markUserAction: () => number;
  claimResume: () => ReconnectSnapshot | undefined;
  setTransportPending: (count: number, activeAction?: TransportAction) => void;
}

const emptyPending = (): PendingControls => ({ seek: null, shuffle: null, repeat: null, volume: null });
const idleSeek = (generation: number): SeekStatus => ({ phase: "idle", generation });

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  confirmed: undefined,
  playback: undefined,
  optimistic: {},
  connection: "connecting",
  generation: 0,
  connectionEpoch: 0,
  lastProgressEventTimestampMs: 0,
  userActionRevision: 0,
  reconnectSnapshot: undefined,
  resumeAttempted: false,
  transportPending: { count: 0 },
  seek: idleSeek(0),
  pending: emptyPending(),

  setPlayback: (playback, forceSeek = false) => set((state) => {
    if (isOlderLocalPlayback(state, playback.updatedAt)) return state;
    const incoming = playback;
    const previousUri = state.confirmed?.currentItem?.uri;
    const nextUri = incoming.currentItem?.uri;
    const trackChanged = previousUri !== nextUri && (previousUri !== undefined || nextUri !== undefined);
    const generation = trackChanged ? state.generation + 1 : state.generation;
    const cancelSeek = trackChanged || forceSeek;
    const optimistic = cancelSeek ? omitOptimistic(state.optimistic, "positionMs") : state.optimistic;
    const pending = cancelSeek ? { ...state.pending, seek: null } : state.pending;
    const seek = cancelSeek ? idleSeek(generation) : state.seek;
    return {
      confirmed: incoming,
      playback: composePlayback(incoming, optimistic),
      optimistic,
      generation,
      lastProgressEventTimestampMs: trackChanged ? 0 : state.lastProgressEventTimestampMs,
      seek,
      pending,
    };
  }),

  applyPatch: (patch) => set((state) => {
    if (!state.confirmed || state.connection !== "online") return state;
    if (isOlderLocalPlayback(state, patch.updatedAt)) return state;
    const confirmed = mergeDefined(state.confirmed, patch);
    const patchUri = confirmed.currentItem?.uri;
    const currentUri = state.confirmed.currentItem?.uri;
    const trackChanged = patchUri !== undefined && patchUri !== currentUri;
    const generation = trackChanged ? state.generation + 1 : state.generation;
    const optimistic = trackChanged ? omitOptimistic(state.optimistic, "positionMs") : state.optimistic;
    return {
      confirmed,
      playback: composePlayback(confirmed, optimistic),
      optimistic,
      generation,
      lastProgressEventTimestampMs: trackChanged ? 0 : state.lastProgressEventTimestampMs,
      ...(trackChanged ? {
        seek: idleSeek(generation),
        pending: { ...state.pending, seek: null },
      } : {}),
    };
  }),

  applyProgress: (event) => set((state) => {
    if (!state.confirmed || state.connection !== "online") return state;
    if (event.eventTimestampMs <= state.lastProgressEventTimestampMs) return state;
    const currentUri = state.confirmed.currentItem?.uri;
    if (event.trackUri !== undefined && event.trackUri !== currentUri) return state;

    const basePatch: PlaybackStatePatch = {};
    if (event.durationMs !== undefined) basePatch.durationMs = Math.max(0, event.durationMs);
    let confirmed = mergeDefined(state.confirmed, basePatch);
    if (state.seek.phase === "dragging") {
      return {
        confirmed,
        playback: composePlayback(confirmed, state.optimistic),
        lastProgressEventTimestampMs: event.eventTimestampMs,
      };
    }
    if (state.seek.phase === "confirming") {
      const target = state.seek.targetMs;
      const confirmedSeek = target !== undefined
        && state.seek.generation === state.generation
        && Math.abs(event.positionMs - target) <= SEEK_CONFIRM_TOLERANCE_MS;
      if (!confirmedSeek) {
        return {
          confirmed,
          playback: composePlayback(confirmed, state.optimistic),
          lastProgressEventTimestampMs: event.eventTimestampMs,
        };
      }
      confirmed = mergeDefined(confirmed, { positionMs: Math.max(0, event.positionMs) });
      const optimistic = omitOptimistic(state.optimistic, "positionMs");
      return {
        confirmed,
        playback: composePlayback(confirmed, optimistic),
        optimistic,
        lastProgressEventTimestampMs: event.eventTimestampMs,
        seek: idleSeek(state.generation),
        pending: { ...state.pending, seek: null },
      };
    }
    confirmed = mergeDefined(confirmed, { positionMs: Math.max(0, event.positionMs) });
    return {
      confirmed,
      playback: composePlayback(confirmed, state.optimistic),
      lastProgressEventTimestampMs: event.eventTimestampMs,
    };
  }),

  applyShuffle: (enabled) => set((state) => state.connection === "online" ? applyIndependentConfirmation(state, "shuffle", enabled) : state),
  applyRepeat: (mode) => set((state) => state.connection === "online" ? applyIndependentConfirmation(state, "repeat", mode) : state),
  applyVolume: (volume, isMuted) => set((state) => {
    if (!state.confirmed || state.connection !== "online") return state;
    const confirmed = mergeDefined(state.confirmed, { volume: clampVolume(volume), isMuted });
    return { confirmed, playback: composePlayback(confirmed, state.optimistic) };
  }),

  setVolumeOptimistic: (requestId, volume, isMuted) => set((state) => {
    const optimistic = { ...state.optimistic, volume: clampVolume(volume), isMuted };
    return {
      optimistic,
      playback: composePlayback(state.confirmed, optimistic),
      pending: { ...state.pending, volume: requestId },
    };
  }),

  confirmVolume: (requestId, volume, isMuted) => set((state) => {
    if (state.pending.volume !== requestId || !state.confirmed) return state;
    const confirmed = mergeDefined(state.confirmed, { volume: clampVolume(volume), isMuted });
    const optimistic = omitOptimistic(omitOptimistic(state.optimistic, "volume"), "isMuted");
    return {
      confirmed,
      playback: composePlayback(confirmed, optimistic),
      optimistic,
      pending: { ...state.pending, volume: null },
    };
  }),

  beginSeek: () => set((state) => {
    if (!state.playback || state.connection !== "online") return state;
    return {
      seek: { phase: "dragging", generation: state.generation, targetMs: state.playback.positionMs },
      optimistic: { ...state.optimistic, positionMs: state.playback.positionMs },
    };
  }),

  previewSeek: (positionMs) => set((state) => {
    if (!state.playback || state.seek.phase === "idle") return state;
    const targetMs = Math.min(Math.max(0, Math.round(positionMs)), state.playback.durationMs);
    const optimistic = { ...state.optimistic, positionMs: targetMs };
    return {
      optimistic,
      playback: composePlayback(state.confirmed, optimistic),
      seek: { ...state.seek, targetMs },
    };
  }),

  commitSeek: (requestId) => {
    const state = get();
    if (state.seek.phase !== "dragging" || state.seek.targetMs === undefined) return undefined;
    const targetMs = state.seek.targetMs;
    set({
      seek: { phase: "confirming", generation: state.generation, targetMs },
      pending: { ...state.pending, seek: requestId },
    });
    return targetMs;
  },

  setControlOptimistic: (control, requestId, value) => set((state) => {
    const optimistic = setOptimisticValue(state.optimistic, control, value);
    return {
      optimistic,
      playback: composePlayback(state.confirmed, optimistic),
      pending: { ...state.pending, [control]: requestId },
    };
  }),

  confirmControl: (control, requestId, playback) => set((state) => {
    if (state.pending[control] !== requestId || !state.confirmed) return state;
    const confirmed = mergeDefined(state.confirmed, controlPatch(control, playback));
    const optimistic = omitControl(state.optimistic, control);
    return {
      confirmed,
      playback: composePlayback(confirmed, optimistic),
      optimistic,
      pending: { ...state.pending, [control]: null },
    };
  }),

  rollbackControl: (control, requestId) => set((state) => {
    if (state.pending[control] !== requestId) return state;
    const optimistic = control === "seek"
      ? omitOptimistic(state.optimistic, "positionMs")
      : omitControl(state.optimistic, control);
    return {
      optimistic,
      playback: composePlayback(state.confirmed, optimistic),
      pending: { ...state.pending, [control]: null },
      ...(control === "seek" ? { seek: idleSeek(state.generation) } : {}),
    };
  }),

  setConnection: (connection) => set({ connection }),

  disconnect: () => set((state) => {
    if (state.connection === "offline") return state;
    const confirmed = state.confirmed
      ? { ...state.confirmed, isPlaying: false }
      : undefined;
    const connectionEpoch = state.connectionEpoch + 1;
    const reconnectSnapshot: ReconnectSnapshot | undefined = state.confirmed ? {
      ...(state.confirmed.currentItem?.uri ? { trackUri: state.confirmed.currentItem.uri } : {}),
      positionMs: state.confirmed.positionMs,
      wasPlaying: state.confirmed.isPlaying,
      ...(state.confirmed.contextUri ? { contextUri: state.confirmed.contextUri } : {}),
      disconnectedAt: Date.now(),
      connectionEpoch,
      userActionRevision: state.userActionRevision,
    } : undefined;
    return {
      confirmed,
      playback: confirmed,
      optimistic: {},
      connection: "offline",
      connectionEpoch,
      lastProgressEventTimestampMs: 0,
      reconnectSnapshot,
      resumeAttempted: false,
      transportPending: { count: 0 },
      seek: idleSeek(state.generation),
      pending: emptyPending(),
    };
  }),

  markUserAction: () => {
    const next = get().userActionRevision + 1;
    set({ userActionRevision: next });
    return next;
  },

  claimResume: () => {
    const state = get();
    if (!state.reconnectSnapshot
      || state.resumeAttempted
      || state.userActionRevision !== state.reconnectSnapshot.userActionRevision) return undefined;
    set({ resumeAttempted: true });
    return state.reconnectSnapshot;
  },

  setTransportPending: (count, activeAction) => set({
    transportPending: {
      count: Math.max(0, Math.floor(count)),
      ...(activeAction ? { activeAction } : {}),
    },
  }),
}));

type StoreSnapshot = ReturnType<typeof usePlayerStore.getState>;

function applyIndependentConfirmation(
  state: StoreSnapshot,
  control: "shuffle" | "repeat",
  value: boolean | RepeatMode,
): Partial<PlayerStore> | StoreSnapshot {
  if (!state.confirmed) return state;
  const patch: PlaybackStatePatch = control === "shuffle"
    ? { shuffleEnabled: value as boolean }
    : { repeatMode: value as RepeatMode };
  const confirmed = mergeDefined(state.confirmed, patch);
  const optimisticValue = control === "shuffle" ? state.optimistic.shuffleEnabled : state.optimistic.repeatMode;
  const matches = optimisticValue !== undefined && optimisticValue === value;
  const optimistic = matches ? omitControl(state.optimistic, control) : state.optimistic;
  const pending = matches ? { ...state.pending, [control]: null } : state.pending;
  return { confirmed, playback: composePlayback(confirmed, optimistic), optimistic, pending };
}

function composePlayback(confirmed: PlaybackState | undefined, optimistic: OptimisticPlayback): PlaybackState | undefined {
  return confirmed ? { ...confirmed, ...optimistic } : undefined;
}

export function sameTrackUri(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftKey = trackUriKey(left);
  const rightKey = trackUriKey(right);
  return leftKey.length === 22 && leftKey === rightKey;
}

function trackUriKey(uri: string): string {
  const base = uri.split(/[?#]/, 1)[0]?.trim() ?? uri;
  return base.split(":").pop() ?? base;
}

function mergeDefined(current: PlaybackState, patch: PlaybackStatePatch): PlaybackState {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as PlaybackStatePatch;
  return { ...current, ...defined };
}

function omitOptimistic<K extends keyof OptimisticPlayback>(optimistic: OptimisticPlayback, key: K): OptimisticPlayback {
  const next = { ...optimistic };
  delete next[key];
  return next;
}

function omitControl(optimistic: OptimisticPlayback, control: Exclude<SerializedControl, "seek">): OptimisticPlayback {
  if (control === "shuffle") return omitOptimistic(optimistic, "shuffleEnabled");
  if (control === "repeat") return omitOptimistic(optimistic, "repeatMode");
  return omitOptimistic(omitOptimistic(optimistic, "volume"), "isMuted");
}

function setOptimisticValue(
  optimistic: OptimisticPlayback,
  control: Exclude<SerializedControl, "seek">,
  value: boolean | number | RepeatMode,
): OptimisticPlayback {
  if (control === "shuffle") return { ...optimistic, shuffleEnabled: value as boolean };
  if (control === "repeat") return { ...optimistic, repeatMode: value as RepeatMode };
  const volume = clampVolume(value as number);
  return { ...optimistic, volume, ...(volume > 0 ? { isMuted: false } : {}) };
}

function controlPatch(control: Exclude<SerializedControl, "seek">, playback: PlaybackState): PlaybackStatePatch {
  if (control === "shuffle") return { shuffleEnabled: playback.shuffleEnabled };
  if (control === "repeat") return { repeatMode: playback.repeatMode };
  return { volume: playback.volume, isMuted: playback.isMuted };
}

function isOlderLocalPlayback(
  state: Pick<PlayerStore, "connection" | "confirmed">,
  updatedAt: string | undefined,
): boolean {
  // Engine events and query replies share the backend clock, but can arrive out of order.
  if (state.connection !== "online" || !state.confirmed || !updatedAt) return false;
  return Date.parse(updatedAt) < Date.parse(state.confirmed.updatedAt);
}

function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off";
}

export function resetPlayerStore(): void {
  usePlayerStore.setState({
    confirmed: undefined,
    playback: undefined,
    optimistic: {},
    connection: "connecting",
    generation: 0,
    connectionEpoch: 0,
    lastProgressEventTimestampMs: 0,
    userActionRevision: 0,
    reconnectSnapshot: undefined,
    resumeAttempted: false,
    transportPending: { count: 0 },
    seek: idleSeek(0),
    pending: emptyPending(),
  });
}
