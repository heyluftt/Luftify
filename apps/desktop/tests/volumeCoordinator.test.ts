import type { PlaybackState } from "@luft/protocol-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  differenceInSpotifyDomain,
  VOLUME_PREVIEW_INTERVAL_MS,
  VolumeCommandCoordinator,
  type VolumeSnapshot,
} from "../src/features/playback/VolumeCommandCoordinator";
import type { VolumeCommandRequest, VolumePreviewRequest } from "../src/types/tauri";

const playback = (volume: number, isMuted = false): PlaybackState => ({
  isPlaying: false, positionMs: 0, durationMs: 100_000, volume, isMuted,
  shuffleEnabled: false, repeatMode: "off", isSaved: false, updatedAt: new Date().toISOString(),
});

function harness() {
  let snapshot: VolumeSnapshot = { connection: "online", connectionEpoch: 1, volume: 0.7, confirmedVolume: 0.7, isMuted: false };
  const preview = vi.fn<(request: VolumePreviewRequest) => Promise<{ requestId: string; sequence: number; rustReceivedAtMs: number; rustQueuedAtMs: number }>>(async (request) => ({
    requestId: request.requestId,
    sequence: request.sequence,
    rustReceivedAtMs: request.sentAtMs + 2,
    rustQueuedAtMs: request.sentAtMs + 3,
  }));
  const send = vi.fn<(request: VolumeCommandRequest) => Promise<PlaybackState>>(async (request) => playback(request.volume));
  const optimistic = vi.fn((_requestId: string, volume: number, isMuted: boolean) => { snapshot = { ...snapshot, volume, isMuted }; });
  const confirm = vi.fn((_requestId: string, volume: number, isMuted: boolean) => { snapshot = { ...snapshot, volume, confirmedVolume: volume, isMuted }; });
  const external = vi.fn((volume: number, isMuted: boolean) => { snapshot = { ...snapshot, volume, confirmedVolume: volume, isMuted }; });
  const rollback = vi.fn();
  const verify = vi.fn(async () => playback(snapshot.confirmedVolume, snapshot.isMuted));
  const sendMute = vi.fn(async () => playback(snapshot.volume, !snapshot.isMuted));
  const coordinator = new VolumeCommandCoordinator({
    now: Date.now,
    snapshot: () => snapshot,
    preview,
    send,
    sendMute,
    verify,
    optimistic,
    confirm,
    applyExternal: external,
    rollback,
    markUserAction: vi.fn(),
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: clearTimeout,
  });
  return {
    coordinator, preview, send, sendMute, optimistic, confirm, external, rollback, verify,
    get snapshot() { return snapshot; },
    setSnapshot: (value: VolumeSnapshot) => { snapshot = value; },
  };
}

describe("VolumeCommandCoordinator", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-18T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("updates the slider synchronously and sends the first preview without a 500 ms debounce", () => {
    const test = harness();
    test.coordinator.beginDrag();
    test.coordinator.change(0.32);
    expect(test.optimistic).toHaveBeenLastCalledWith(expect.any(String), 0.32, false);
    expect(test.snapshot.volume).toBe(0.32);
    expect(test.preview).toHaveBeenCalledOnce();
    expect(test.coordinator.getDiagnostics().lastSendLatencyMs).toBe(0);
  });

  it("seeds sequences above a previous WebView instance after reload", () => {
    const beforeReload = harness();
    beforeReload.coordinator.set(0.2);
    const previousSequence = beforeReload.send.mock.calls[0]?.[0].sequence ?? 0;
    vi.setSystemTime(new Date("2026-07-18T12:00:00.010Z"));
    const afterReload = harness();
    afterReload.coordinator.set(0.8);
    const reloadedSequence = afterReload.send.mock.calls[0]?.[0].sequence ?? 0;
    expect(reloadedSequence).toBeGreaterThan(previousSequence);
  });

  it("does not wait for the previous preview response", async () => {
    const test = harness();
    const first = deferred<{ requestId: string; sequence: number; rustReceivedAtMs: number; rustQueuedAtMs: number }>();
    test.preview.mockReturnValueOnce(first.promise);
    test.coordinator.beginDrag();
    test.coordinator.change(0.2);
    test.coordinator.change(0.8);
    await vi.advanceTimersByTimeAsync(VOLUME_PREVIEW_INTERVAL_MS);
    expect(test.preview).toHaveBeenCalledTimes(2);
    expect(test.preview.mock.calls[1]?.[0].volume).toBe(0.8);
  });

  it("keeps only the latest not-yet-sent preview value", async () => {
    const test = harness();
    test.coordinator.beginDrag();
    test.coordinator.change(0.1);
    test.coordinator.change(0.2);
    test.coordinator.change(0.4);
    test.coordinator.change(0.9);
    await vi.advanceTimersByTimeAsync(VOLUME_PREVIEW_INTERVAL_MS);
    expect(test.preview).toHaveBeenCalledTimes(2);
    expect(test.preview.mock.calls[1]?.[0].volume).toBe(0.9);
    expect(test.coordinator.getDiagnostics().droppedPreviewValues).toBe(2);
  });

  it("flushes the latest preview and prioritizes the final commit", () => {
    const test = harness();
    const first = deferred<{ requestId: string; sequence: number; rustReceivedAtMs: number; rustQueuedAtMs: number }>();
    test.preview.mockReturnValueOnce(first.promise);
    test.coordinator.beginDrag();
    test.coordinator.change(0.2);
    test.coordinator.change(0.9);
    test.coordinator.commit();
    expect(test.preview).toHaveBeenCalledTimes(2);
    expect(test.preview.mock.calls[1]?.[0].volume).toBe(0.9);
    expect(test.send).toHaveBeenCalledOnce();
    expect(test.send.mock.calls[0]?.[0]).toMatchObject({ volume: 0.9 });
  });

  it("does not let an old preview event overwrite a final commit", async () => {
    const test = harness();
    const final = deferred<PlaybackState>();
    test.send.mockReturnValueOnce(final.promise);
    test.coordinator.beginDrag();
    test.coordinator.change(0.2);
    test.coordinator.commit();
    const finalRequest = test.send.mock.calls[0]?.[0];
    test.coordinator.handleVolumeEvent({
      volume: 0.2,
      isMuted: false,
      eventTimestampMs: Date.now() + 1,
      connectionEpoch: 1,
      sequence: (finalRequest?.sequence ?? 1) - 1,
      preview: true,
    });
    expect(test.external).not.toHaveBeenCalledWith(0.2, false);
    final.resolve(playback(0.2));
    await Promise.resolve();
  });

  it("does not mix stale event timings into diagnostics for a newer intent", () => {
    const test = harness();
    const first = deferred<PlaybackState>();
    test.send.mockReturnValueOnce(first.promise);
    test.coordinator.set(0.2);
    const staleRequest = test.send.mock.calls[0]?.[0];
    expect(staleRequest).toBeDefined();
    if (!staleRequest) throw new Error("Expected the first volume request");
    test.coordinator.set(0.8);
    test.coordinator.handleVolumeEvent({
      volume: 0.2,
      isMuted: false,
      eventTimestampMs: Date.now() + 90,
      connectionEpoch: 1,
      requestId: staleRequest.requestId,
      sequence: staleRequest.sequence,
      rustQueuedAtMs: Date.now() + 10,
    });
    expect(test.coordinator.getDiagnostics().confirmedSpotifyValue).not.toBe(0.2);
    expect(test.coordinator.getDiagnostics().lastConfirmationLatencyMs).toBeUndefined();
  });

  it("accepts small Spotify-domain rounding differences without a mismatch resync", async () => {
    const test = harness();
    test.send.mockResolvedValueOnce(playback(0.611));
    test.coordinator.set(0.6, { uiValue: 0.36, spotifyValue: 0.6, curve: "perceptual" });
    await test.coordinator.whenIdle();
    expect(test.confirm).toHaveBeenCalledOnce();
    expect(test.verify).not.toHaveBeenCalled();
    expect(test.coordinator.getDiagnostics().lastResyncReason).toBe("confirmed");
  });

  it("compares confirmation values only in the Spotify domain", () => {
    expect(differenceInSpotifyDomain(0.51, 0.5)).toBeCloseTo(0.01, 8);
    expect(differenceInSpotifyDomain(0.51, 0.25)).toBeGreaterThan(0.015);
  });

  it("bounds five seconds of continuous preview traffic", async () => {
    const test = harness();
    test.coordinator.beginDrag();
    for (let index = 0; index < 500; index += 1) {
      test.coordinator.change(index / 500);
      await vi.advanceTimersByTimeAsync(10);
    }
    test.coordinator.commit();
    await vi.runAllTimersAsync();
    await test.coordinator.whenIdle();
    expect(test.preview.mock.calls.length).toBeLessThanOrEqual(158);
    expect(test.coordinator.getDiagnostics().droppedPreviewValues).toBeGreaterThan(300);
    expect(test.send).toHaveBeenCalledOnce();
  });

  it("aborts preview and final work on bridge disconnect", async () => {
    const test = harness();
    const request = deferred<PlaybackState>();
    test.send.mockReturnValue(request.promise);
    test.coordinator.beginDrag();
    test.coordinator.change(0.2);
    test.coordinator.change(0.8);
    test.coordinator.commit();
    test.setSnapshot({ ...test.snapshot, connection: "offline", connectionEpoch: 2 });
    test.coordinator.abort("bridge-disconnected");
    request.resolve(playback(0.8));
    await Promise.resolve();
    expect(test.confirm).not.toHaveBeenCalled();
    expect(test.coordinator.getDiagnostics()).toMatchObject({ livePreviewActive: false, lastResyncReason: "bridge-disconnected" });
  });

  it("loads the real reconnect value before accepting new events", () => {
    const test = harness();
    test.coordinator.reconnect(playback(0.44, true), "bridge-connected");
    expect(test.external).toHaveBeenLastCalledWith(0.44, true);
    expect(test.snapshot).toMatchObject({ volume: 0.44, isMuted: true });
  });

  it("emulated mute remembers and restores the last non-zero value", async () => {
    const test = harness();
    test.coordinator.configure({ nativeMuteAvailable: false, rememberBeforeMute: true });
    await test.coordinator.toggleMute();
    await test.coordinator.whenIdle();
    expect(test.snapshot.volume).toBe(0);
    await test.coordinator.toggleMute();
    await test.coordinator.whenIdle();
    expect(test.snapshot.volume).toBe(0.7);
  });

  it("reports a native mute request as active only while it is running", async () => {
    const test = harness();
    const response = deferred<PlaybackState>();
    test.sendMute.mockReturnValueOnce(response.promise);
    const pending = test.coordinator.toggleMute();
    expect(test.coordinator.getDiagnostics().activeRequestId).toMatch(/^mute-/);
    response.resolve(playback(0.7, true));
    await pending;
    expect(test.coordinator.getDiagnostics().activeRequestId).toBeUndefined();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
