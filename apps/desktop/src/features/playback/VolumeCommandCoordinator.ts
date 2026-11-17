import type { PlaybackState } from "@luft/protocol-types";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import type {
  VolumeCommandRequest,
  VolumeCurve,
  VolumeEventTrace,
  VolumePreviewReceipt,
  VolumePreviewRequest,
} from "../../types/tauri";
import { loadPlaybackStateOnce } from "./playbackStateLoader";

export const VOLUME_PREVIEW_INTERVAL_MS = 32;
export const VOLUME_CONFIRMATION_TOLERANCE = 0.015;

export interface VolumeSnapshot {
  connection: "offline" | "connecting" | "online";
  connectionEpoch: number;
  volume: number;
  confirmedVolume: number;
  isMuted: boolean;
}

export interface MappedVolumeTarget {
  uiValue: number;
  spotifyValue: number;
  curve: VolumeCurve;
}

export interface VolumeDiagnostic {
  lastIntent?: {
    requestId: string;
    sequence: number;
    target: number;
    uiTarget: number;
    spotifyTarget: number;
    curve: VolumeCurve;
    createdAtMs: number;
    final: boolean;
  };
  uiToCoordinatorLatencyMs?: number;
  coordinatorWaitLatencyMs?: number;
  coordinatorToRustLatencyMs?: number;
  lastSendLatencyMs?: number;
  lastConfirmationLatencyMs?: number;
  activeRequestId?: string | undefined;
  livePreviewActive: boolean;
  previewIntervalMs: number;
  sentPreviewValues: number;
  droppedPreviewValues: number;
  mergedIntermediateValues: number;
  lastFinalCommit?: { requestId: string; sequence: number; uiTarget: number; spotifyTarget: number };
  confirmedSpotifyValue?: number;
  lastMismatchDifference?: number;
  adapter: string;
  volumeEventAvailable: boolean;
  lastResyncReason: string;
}

interface VolumeIntent extends MappedVolumeTarget {
  requestId: string;
  sequence: number;
  connectionEpoch: number;
  uiCreatedAtMs: number;
  coordinatorReceivedAtMs: number;
  final: boolean;
}

export interface VolumeCoordinatorDependencies {
  now: () => number;
  snapshot: () => VolumeSnapshot;
  preview: (request: VolumePreviewRequest) => Promise<VolumePreviewReceipt>;
  send: (request: VolumeCommandRequest) => Promise<PlaybackState>;
  sendMute: () => Promise<PlaybackState>;
  verify: () => Promise<PlaybackState>;
  optimistic: (requestId: string, volume: number, isMuted: boolean) => void;
  confirm: (requestId: string, volume: number, isMuted: boolean) => void;
  applyExternal: (volume: number, isMuted: boolean) => void;
  rollback: (requestId: string) => void;
  markUserAction: () => void;
  setTimer: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  log?: (phase: string, values: Record<string, unknown>) => void;
}

export class VolumeCommandCoordinator {
  private sequence = 0;
  private latestSequence = 0;
  private latestRequestId: string | undefined;
  private latestTarget: MappedVolumeTarget | undefined;
  private pendingPreview: VolumeIntent | undefined;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private finalActive: VolumeIntent | undefined;
  private dragging = false;
  private lastPreviewSentAt = 0;
  private latestFinalSentAt = 0;
  private lastTimingSequence = 0;
  private epochStartedAt = 0;
  private nativeMuteAvailable = true;
  private rememberBeforeMute = true;
  private lastNonZeroVolume = 0.5;
  private idleWaiters: Array<() => void> = [];
  private listeners = new Set<() => void>();
  private diagnostic: VolumeDiagnostic = initialDiagnostic();

  constructor(private readonly dependencies: VolumeCoordinatorDependencies) {
    // A WebView reload can recreate the coordinator while Spotify keeps the same
    // bridge connection. A time-based seed keeps the new sequence ahead of every
    // command emitted by the previous page without weakening epoch validation.
    this.sequence = Math.floor(dependencies.now()) * 1_000;
    this.latestSequence = this.sequence;
  }

  configure(options: { nativeMuteAvailable: boolean; rememberBeforeMute: boolean; adapter?: string; volumeEventAvailable?: boolean }): void {
    this.nativeMuteAvailable = options.nativeMuteAvailable;
    this.rememberBeforeMute = options.rememberBeforeMute;
    this.patchDiagnostic({
      ...(options.adapter ? { adapter: options.adapter } : {}),
      ...(options.volumeEventAvailable !== undefined ? { volumeEventAvailable: options.volumeEventAvailable } : {}),
    });
  }

  beginDrag(): void {
    if (this.dependencies.snapshot().connection !== "online") return;
    this.dragging = true;
    this.patchDiagnostic({ livePreviewActive: true });
  }

  change(volume: number, mapped?: Partial<MappedVolumeTarget>, uiCreatedAtMs = this.dependencies.now()): void {
    this.changeMapped(normalizeTarget(volume, mapped), uiCreatedAtMs);
  }

  changeMapped(target: MappedVolumeTarget, uiCreatedAtMs = this.dependencies.now()): void {
    if (this.dragging) this.enqueuePreview(target, uiCreatedAtMs);
    else this.commitFinal(target, uiCreatedAtMs);
  }

  commit(): void {
    if (!this.dragging) return;
    const target = this.latestTarget ?? normalizeTarget(this.dependencies.snapshot().volume);
    this.flushPreview();
    this.commitFinal(target, this.dependencies.now());
    this.dragging = false;
    this.patchDiagnostic({ livePreviewActive: false });
  }

  cancelDrag(): void {
    this.commit();
  }

  set(volume: number, mapped?: Partial<MappedVolumeTarget>, uiCreatedAtMs = this.dependencies.now()): void {
    this.setMapped(normalizeTarget(volume, mapped), uiCreatedAtMs);
  }

  setMapped(target: MappedVolumeTarget, uiCreatedAtMs = this.dependencies.now()): void {
    if (this.dragging) this.flushPreview();
    this.commitFinal(target, uiCreatedAtMs);
    this.dragging = false;
    this.patchDiagnostic({ livePreviewActive: false });
  }

  step(delta: number): void {
    this.set(this.dependencies.snapshot().volume + delta);
  }

  async toggleMute(): Promise<void> {
    let snapshot = this.dependencies.snapshot();
    if (snapshot.connection !== "online") return;
    this.dependencies.markUserAction();
    if (!snapshot.isMuted && snapshot.volume > VOLUME_CONFIRMATION_TOLERANCE && this.rememberBeforeMute) {
      this.lastNonZeroVolume = snapshot.volume;
    }
    if (!this.nativeMuteAvailable) {
      this.set(snapshot.isMuted || snapshot.volume <= VOLUME_CONFIRMATION_TOLERANCE ? this.lastNonZeroVolume : 0);
      return;
    }
    this.clearPreview();
    snapshot = this.dependencies.snapshot();
    const sequence = ++this.sequence;
    const requestId = `mute-${sequence}`;
    this.latestSequence = sequence;
    this.latestRequestId = requestId;
    this.finalActive = undefined;
    this.patchDiagnostic({ activeRequestId: requestId });
    this.dependencies.optimistic(requestId, snapshot.volume, !snapshot.isMuted);
    try {
      const state = await this.dependencies.sendMute();
      if (!this.canApply(sequence, snapshot.connectionEpoch)) return;
      this.rememberConfirmed(state.volume);
      this.dependencies.confirm(requestId, state.volume, state.isMuted);
      this.patchDiagnostic({ activeRequestId: undefined });
    } catch {
      if (this.canApply(sequence, snapshot.connectionEpoch)) {
        this.dependencies.rollback(requestId);
        this.patchDiagnostic({ activeRequestId: undefined });
      }
    }
  }

  handleVolumeEvent(event: VolumeEventTrace): void {
    const snapshot = this.dependencies.snapshot();
    if (snapshot.connection !== "online") return;
    if (event.connectionEpoch !== undefined && event.connectionEpoch !== snapshot.connectionEpoch) return;
    if (event.eventTimestampMs < this.epochStartedAt) return;
    if (event.sequence !== undefined && event.sequence < this.latestSequence) return;
    this.recordBridgeTiming(event);

    if (event.preview === true) return;
    if (event.eventTimestampMs < this.latestFinalSentAt) return;

    const tracedCurrent = event.requestId !== undefined
      && event.requestId === this.latestRequestId
      && (event.sequence === undefined || event.sequence === this.latestSequence);
    if (this.dragging && !tracedCurrent) return;
    if (this.finalActive && !tracedCurrent) return;

    if (tracedCurrent && this.finalActive) {
      const difference = differenceInSpotifyDomain(event.volume, this.finalActive.spotifyValue);
      this.patchDiagnostic({ confirmedSpotifyValue: event.volume, lastMismatchDifference: difference });
      if (difference <= VOLUME_CONFIRMATION_TOLERANCE) {
        this.rememberConfirmed(event.volume);
        this.confirmFinal(this.finalActive, event.volume, event.isMuted, event.eventTimestampMs);
      }
      return;
    }

    if (!this.dragging && !this.finalActive) {
      this.rememberConfirmed(event.volume);
      this.dependencies.applyExternal(event.volume, event.isMuted);
      this.patchDiagnostic({ confirmedSpotifyValue: event.volume });
    }
  }

  reconnect(state: PlaybackState, reason: string): void {
    this.abort(reason);
    this.epochStartedAt = this.dependencies.now();
    this.rememberConfirmed(state.volume);
    this.dependencies.applyExternal(state.volume, state.isMuted);
    this.patchDiagnostic({ confirmedSpotifyValue: state.volume, lastResyncReason: reason });
  }

  abort(reason: string): void {
    this.dragging = false;
    this.latestTarget = undefined;
    this.clearPreview();
    this.finalActive = undefined;
    this.latestSequence = ++this.sequence;
    this.patchDiagnostic({ activeRequestId: undefined, livePreviewActive: false, lastResyncReason: reason });
    this.dependencies.log?.("aborted", { reason, connectionEpoch: this.dependencies.snapshot().connectionEpoch });
    this.resolveIdleIfNeeded();
  }

  getDiagnostics(): VolumeDiagnostic {
    return this.diagnostic;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  whenIdle(): Promise<void> {
    if (!this.finalActive && !this.pendingPreview && !this.previewTimer) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  resetForTests(): void {
    this.abort("test-reset");
    this.sequence = 0;
    this.latestSequence = 0;
    this.latestRequestId = undefined;
    this.lastPreviewSentAt = 0;
    this.latestFinalSentAt = 0;
    this.diagnostic = initialDiagnostic("test");
    this.emit();
  }

  private enqueuePreview(target: MappedVolumeTarget, uiCreatedAtMs: number): void {
    const intent = this.createIntent(target, false, uiCreatedAtMs);
    if (!intent) return;
    if (this.pendingPreview) {
      this.patchDiagnostic({
        droppedPreviewValues: this.diagnostic.droppedPreviewValues + 1,
        mergedIntermediateValues: this.diagnostic.mergedIntermediateValues + 1,
      });
    }
    this.pendingPreview = intent;
    this.schedulePreview();
  }

  private commitFinal(target: MappedVolumeTarget, uiCreatedAtMs: number): void {
    const intent = this.createIntent(target, true, uiCreatedAtMs);
    if (!intent) return;
    this.clearPreview();
    this.finalActive = intent;
    this.latestFinalSentAt = this.dependencies.now();
    this.patchDiagnostic({
      activeRequestId: intent.requestId,
      lastFinalCommit: {
        requestId: intent.requestId,
        sequence: intent.sequence,
        uiTarget: intent.uiValue,
        spotifyTarget: intent.spotifyValue,
      },
    });
    void this.sendFinal(intent);
  }

  private createIntent(targetValue: MappedVolumeTarget, final: boolean, uiCreatedAtMs: number): VolumeIntent | undefined {
    const snapshot = this.dependencies.snapshot();
    if (snapshot.connection !== "online") return undefined;
    this.dependencies.markUserAction();
    const target = normalizeTarget(targetValue.spotifyValue, targetValue);
    if (target.spotifyValue > VOLUME_CONFIRMATION_TOLERANCE) this.lastNonZeroVolume = target.spotifyValue;
    const sequence = ++this.sequence;
    const coordinatorReceivedAtMs = this.dependencies.now();
    const intent: VolumeIntent = {
      ...target,
      requestId: `${final ? "volume" : "volume-preview"}-${sequence}`,
      sequence,
      connectionEpoch: snapshot.connectionEpoch,
      uiCreatedAtMs,
      coordinatorReceivedAtMs,
      final,
    };
    if (this.finalActive) {
      this.finalActive = undefined;
      this.patchDiagnostic({ activeRequestId: undefined });
    }
    this.latestSequence = sequence;
    this.latestRequestId = intent.requestId;
    this.latestTarget = target;
    this.dependencies.optimistic(intent.requestId, target.spotifyValue, target.spotifyValue <= VOLUME_CONFIRMATION_TOLERANCE ? snapshot.isMuted : false);
    this.patchDiagnostic({
      lastIntent: {
        requestId: intent.requestId,
        sequence,
        target: target.spotifyValue,
        uiTarget: target.uiValue,
        spotifyTarget: target.spotifyValue,
        curve: target.curve,
        createdAtMs: uiCreatedAtMs,
        final,
      },
      uiToCoordinatorLatencyMs: Math.max(0, coordinatorReceivedAtMs - uiCreatedAtMs),
    });
    this.dependencies.log?.("created", safeIntentLog(intent));
    return intent;
  }

  private schedulePreview(): void {
    if (this.previewTimer || !this.pendingPreview) return;
    const wait = Math.max(0, VOLUME_PREVIEW_INTERVAL_MS - (this.dependencies.now() - this.lastPreviewSentAt));
    if (wait === 0) {
      this.flushPreview();
      return;
    }
    this.previewTimer = this.dependencies.setTimer(() => {
      this.previewTimer = undefined;
      this.flushPreview();
    }, wait);
  }

  private flushPreview(): void {
    if (this.previewTimer) {
      this.dependencies.clearTimer(this.previewTimer);
      this.previewTimer = undefined;
    }
    const intent = this.pendingPreview;
    if (!intent) return;
    this.pendingPreview = undefined;
    const snapshot = this.dependencies.snapshot();
    if (snapshot.connection !== "online" || snapshot.connectionEpoch !== intent.connectionEpoch) {
      this.resolveIdleIfNeeded();
      return;
    }
    const sentAtMs = this.dependencies.now();
    this.lastPreviewSentAt = sentAtMs;
    this.patchDiagnostic({
      coordinatorWaitLatencyMs: Math.max(0, sentAtMs - intent.coordinatorReceivedAtMs),
      lastSendLatencyMs: Math.max(0, sentAtMs - intent.uiCreatedAtMs),
      sentPreviewValues: this.diagnostic.sentPreviewValues + 1,
    });
    this.dependencies.log?.("preview-sent", { ...safeIntentLog(intent), sentAtMs });
    void this.dependencies.preview({
      requestId: intent.requestId,
      sequence: intent.sequence,
      connectionEpoch: intent.connectionEpoch,
      createdAtMs: intent.uiCreatedAtMs,
      sentAtMs,
      uiVolume: intent.uiValue,
      volume: intent.spotifyValue,
      curve: intent.curve,
      unmute: intent.spotifyValue > VOLUME_CONFIRMATION_TOLERANCE,
    }).then((receipt) => {
      if (!this.sameEpoch(intent)) return;
      this.patchDiagnostic({
        coordinatorToRustLatencyMs: Math.max(0, receipt.rustReceivedAtMs - sentAtMs),
      });
    }).catch(() => {
      if (this.sameEpoch(intent)) this.patchDiagnostic({ lastResyncReason: "preview-error" });
    });
    this.resolveIdleIfNeeded();
  }

  private async sendFinal(intent: VolumeIntent): Promise<void> {
    const sentAtMs = this.dependencies.now();
    this.latestFinalSentAt = sentAtMs;
    this.patchDiagnostic({
      coordinatorWaitLatencyMs: Math.max(0, sentAtMs - intent.coordinatorReceivedAtMs),
      lastSendLatencyMs: Math.max(0, sentAtMs - intent.uiCreatedAtMs),
    });
    this.dependencies.log?.("final-sent", { ...safeIntentLog(intent), sentAtMs });
    try {
      const state = await this.dependencies.send({
        requestId: intent.requestId,
        sequence: intent.sequence,
        connectionEpoch: intent.connectionEpoch,
        createdAtMs: intent.uiCreatedAtMs,
        sentAtMs,
        uiVolume: intent.uiValue,
        volume: intent.spotifyValue,
        curve: intent.curve,
        unmute: intent.spotifyValue > VOLUME_CONFIRMATION_TOLERANCE,
      });
      if (!this.isLatestFinal(intent)) return;
      let actual = state;
      let difference = differenceInSpotifyDomain(actual.volume, intent.spotifyValue);
      this.patchDiagnostic({ confirmedSpotifyValue: actual.volume, lastMismatchDifference: difference });
      if (difference > VOLUME_CONFIRMATION_TOLERANCE) {
        this.patchDiagnostic({ lastResyncReason: "confirmation-mismatch" });
        actual = await this.dependencies.verify();
        if (!this.isLatestFinal(intent)) return;
        difference = differenceInSpotifyDomain(actual.volume, intent.spotifyValue);
        this.patchDiagnostic({ confirmedSpotifyValue: actual.volume, lastMismatchDifference: difference });
      }
      if (difference > VOLUME_CONFIRMATION_TOLERANCE) throw new Error("Spotify volume did not confirm target");
      this.rememberConfirmed(actual.volume);
      this.confirmFinal(intent, actual.volume, actual.isMuted, this.dependencies.now());
    } catch {
      if (!this.isLatestFinal(intent)) return;
      this.patchDiagnostic({ lastResyncReason: "command-error" });
      try {
        const state = await this.dependencies.verify();
        if (!this.isLatestFinal(intent)) return;
        const difference = differenceInSpotifyDomain(state.volume, intent.spotifyValue);
        this.patchDiagnostic({ confirmedSpotifyValue: state.volume, lastMismatchDifference: difference });
        if (difference <= VOLUME_CONFIRMATION_TOLERANCE) this.confirmFinal(intent, state.volume, state.isMuted, this.dependencies.now());
        else this.rollbackFinal(intent);
      } catch {
        this.rollbackFinal(intent);
      }
    }
  }

  private confirmFinal(intent: VolumeIntent, volume: number, isMuted: boolean, confirmedAtMs: number): void {
    if (!this.isLatestFinal(intent)) return;
    this.dependencies.confirm(intent.requestId, volume, isMuted);
    this.finalActive = undefined;
    const latency = Math.max(0, confirmedAtMs - intent.uiCreatedAtMs);
    this.patchDiagnostic({
      activeRequestId: undefined,
      confirmedSpotifyValue: volume,
      lastConfirmationLatencyMs: latency,
      lastResyncReason: "confirmed",
    });
    this.dependencies.log?.("confirmed", {
      ...safeIntentLog(intent),
      confirmedAtMs,
      returnedSpotifyValue: volume,
      difference: differenceInSpotifyDomain(volume, intent.spotifyValue),
      confirmationLatencyMs: latency,
    });
    this.resolveIdleIfNeeded();
  }

  private rollbackFinal(intent: VolumeIntent): void {
    if (!this.isLatestFinal(intent)) return;
    this.dependencies.rollback(intent.requestId);
    this.finalActive = undefined;
    this.patchDiagnostic({ activeRequestId: undefined, lastResyncReason: "final-rollback" });
    this.resolveIdleIfNeeded();
  }

  private recordBridgeTiming(event: VolumeEventTrace): void {
    if (event.sequence !== undefined && event.sequence < this.lastTimingSequence) return;
    if (event.sequence !== undefined) this.lastTimingSequence = event.sequence;
    this.patchDiagnostic({ confirmedSpotifyValue: event.volume });
  }

  private isLatestFinal(intent: VolumeIntent): boolean {
    return this.finalActive?.requestId === intent.requestId && this.canApply(intent.sequence, intent.connectionEpoch);
  }

  private canApply(sequence: number, connectionEpoch: number): boolean {
    const snapshot = this.dependencies.snapshot();
    return snapshot.connection === "online"
      && snapshot.connectionEpoch === connectionEpoch
      && sequence === this.latestSequence;
  }

  private sameEpoch(intent: VolumeIntent): boolean {
    const snapshot = this.dependencies.snapshot();
    return snapshot.connection === "online" && snapshot.connectionEpoch === intent.connectionEpoch;
  }

  private rememberConfirmed(volume: number): void {
    if (volume > VOLUME_CONFIRMATION_TOLERANCE) this.lastNonZeroVolume = clamp(volume);
  }

  private clearPreview(): void {
    this.pendingPreview = undefined;
    if (this.previewTimer) {
      this.dependencies.clearTimer(this.previewTimer);
      this.previewTimer = undefined;
    }
  }

  private patchDiagnostic(patch: Partial<VolumeDiagnostic>): void {
    this.diagnostic = { ...this.diagnostic, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private resolveIdleIfNeeded(): void {
    if (this.finalActive || this.pendingPreview || this.previewTimer) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

export const volumeCoordinator = new VolumeCommandCoordinator({
  now: Date.now,
  snapshot: () => {
    const state = usePlayerStore.getState();
    return {
      connection: state.connection,
      connectionEpoch: state.connectionEpoch,
      volume: state.playback?.volume ?? 0,
      confirmedVolume: state.confirmed?.volume ?? 0,
      isMuted: state.playback?.isMuted ?? false,
    };
  },
  preview: desktopApi.previewVolume,
  send: desktopApi.volumeCommand,
  sendMute: () => desktopApi.playerCommand({ command: "toggleMute" }),
  verify: loadPlaybackStateOnce,
  optimistic: (requestId, volume, isMuted) => usePlayerStore.getState().setVolumeOptimistic(requestId, volume, isMuted),
  confirm: (requestId, volume, isMuted) => usePlayerStore.getState().confirmVolume(requestId, volume, isMuted),
  applyExternal: (volume, isMuted) => usePlayerStore.getState().applyVolume(volume, isMuted),
  rollback: (requestId) => usePlayerStore.getState().rollbackControl("volume", requestId),
  markUserAction: () => { usePlayerStore.getState().markUserAction(); },
  setTimer: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimer: (timer) => globalThis.clearTimeout(timer),
  log: (phase, values) => {
    if (import.meta.env.DEV && import.meta.env.MODE !== "test") console.debug("[Luft Volume]", { phase, ...values });
  },
});

export function differenceInSpotifyDomain(actual: number, target: number): number {
  return Math.abs(clamp(actual) - clamp(target));
}

function normalizeTarget(spotifyValue: number, mapped?: Partial<MappedVolumeTarget>): MappedVolumeTarget {
  const spotify = clamp(mapped?.spotifyValue ?? spotifyValue);
  return {
    uiValue: clamp(mapped?.uiValue ?? spotify),
    spotifyValue: spotify,
    curve: mapped?.curve ?? "linear",
  };
}

function safeIntentLog(intent: VolumeIntent): Record<string, unknown> {
  return {
    requestId: intent.requestId,
    sequence: intent.sequence,
    connectionEpoch: intent.connectionEpoch,
    createdAtMs: intent.uiCreatedAtMs,
    uiValue: intent.uiValue,
    spotifyTarget: intent.spotifyValue,
    curve: intent.curve,
    final: intent.final,
  };
}

function initialDiagnostic(adapter = "librespot"): VolumeDiagnostic {
  return {
    livePreviewActive: false,
    previewIntervalMs: VOLUME_PREVIEW_INTERVAL_MS,
    sentPreviewValues: 0,
    droppedPreviewValues: 0,
    mergedIntermediateValues: 0,
    adapter,
    volumeEventAvailable: true,
    lastResyncReason: "initial",
  };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
