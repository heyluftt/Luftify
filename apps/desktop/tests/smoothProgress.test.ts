import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  advancePlaybackClock,
  isPlaybackClockLive,
  sanitizePlaybackPositionMs,
} from "../src/features/playback/playbackClock";
import {
  applyProgressTransform,
  progressRatio,
  resolveVisualProgress,
  useSmoothProgress,
} from "../src/features/playback/useSmoothProgress";

describe("playback clock liveness", () => {
  it("treats a missing clockReady flag as live for desktop states", () => {
    expect(isPlaybackClockLive(undefined)).toBe(true);
    expect(isPlaybackClockLive(true)).toBe(true);
    expect(isPlaybackClockLive(false)).toBe(false);
  });

  it("does not let a missing duration invent a multi-year timestamp", () => {
    expect(sanitizePlaybackPositionMs(1_247_139_360_000, 0)).toBe(0);
    expect(sanitizePlaybackPositionMs(54_000, 200_000)).toBe(54_000);
    const running = advancePlaybackClock(
      { positionMs: 12_000, cycle: 0 },
      5_000,
      { durationMs: 0, repeatMode: "off", playing: true, suspended: false },
    );
    expect(running.positionMs).toBe(17_000);
  });
});

describe("smooth collapsed progress", () => {
  it("clamps the visible ratio", () => {
    expect(progressRatio(0, 180_000)).toBe(0);
    expect(progressRatio(45_000, 180_000)).toBe(0.25);
    expect(progressRatio(200_000, 180_000)).toBe(1);
    expect(progressRatio(20_000, 0)).toBe(0);
  });

  it("keeps interpolating when the authoritative position lags behind", () => {
    expect(progressRatio(90_000, 180_000)).toBe(0.5);
    expect(progressRatio(88_000, 180_000)).toBeLessThan(0.5);
  });

  it("writes a compositor-friendly scale instead of a width jump", () => {
    const node = document.createElement("span");
    applyProgressTransform(node, 30_000, 120_000);
    expect(node.style.transform).toBe("scaleX(0.25)");
  });

  it("does not let a stalled animation fill the bar ahead of the thumb", () => {
    const drifted = resolveVisualProgress(10_000, 0, 170_000, 12_000, 180_000);
    expect(drifted.visualMs).toBe(12_000);
    expect(drifted.startMs).toBe(12_000);

    const live = resolveVisualProgress(10_000, 1_000, 1_120, 10_000, 180_000);
    expect(live.visualMs).toBe(10_120);
  });
});

describe("smooth progress with a position that comes once a second", () => {
  afterEach(() => vi.useRealTimers());

  it("runs evenly instead of stalling and stepping back", () => {
    vi.useFakeTimers();
    const durationMs = 115_000;
    const node = document.createElement("span");
    const shownMs = () => Number(/scaleX\(([0-9.e-]+)\)/.exec(node.style.transform)?.[1]) * durationMs;
    const startedAt = performance.now();
    const clockMs = () => 43_030 + Math.floor((performance.now() - startedAt) / 100) * 100;
    let positionMs = clockMs();
    const { rerender } = renderHook(
      (position: number) => useSmoothProgress({ current: node }, {
        positionMs: position,
        durationMs,
        running: true,
        trackKey: "track",
      }),
      { initialProps: positionMs },
    );

    let last = shownMs();
    const steps: number[] = [];
    for (let frame = 0; frame < 180; frame += 1) {
      vi.advanceTimersByTime(16);
      const clock = clockMs();
      if (Math.floor(clock / 1_000) !== Math.floor(positionMs / 1_000)) {
        positionMs = clock;
        rerender(positionMs);
      }
      steps.push(shownMs() - last);
      last = shownMs();
    }

    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps)).toBeLessThan(40);
    expect(last - 43_030).toBeGreaterThan(2_700);
  });
});
