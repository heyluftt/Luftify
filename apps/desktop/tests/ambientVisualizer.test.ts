import { describe, expect, it } from "vitest";

import {
  EMPTY_VISUALIZER_FRAME,
  ambientVisualizerVars,
  clampVisualizer,
  frameFromAnalysis,
  hasVisualizerSignal,
  shapeVisualizerFrame,
  smoothVisualizerFrame,
} from "../src/features/lyrics/ambientVisualizer";
import { lyricsAmbientMetrics } from "../src/features/lyrics/lyricsVisualSettings";
import type { VisualizerAnalysis } from "../src/types/tauri";

const analysis = (overrides: Partial<VisualizerAnalysis> = {}): VisualizerAnalysis => ({
  available: true,
  source: "spotifyAnalysis",
  durationMs: 180_000,
  tempo: 120,
  beats: [
    { startMs: 1_000, strength: 1 },
    { startMs: 1_500, strength: 0.7 },
  ],
  energy: [
    { startMs: 0, durationMs: 800, energy: 0.2 },
    { startMs: 800, durationMs: 400, energy: 0.8 },
    { startMs: 1_200, durationMs: 300, energy: 0.45 },
  ],
  ...overrides,
});

describe("ambient visualizer analysis", () => {
  it("stays silent when analysis is missing", () => {
    expect(frameFromAnalysis(undefined, 1_000)).toEqual(EMPTY_VISUALIZER_FRAME);
    expect(frameFromAnalysis({ ...analysis(), available: false }, 1_000)).toEqual(
      EMPTY_VISUALIZER_FRAME,
    );
  });

  it("reads the current energy segment and punches on a beat", () => {
    const onBeat = frameFromAnalysis(analysis(), 1_000);
    const afterBeat = frameFromAnalysis(analysis(), 1_140);
    const quiet = frameFromAnalysis(analysis(), 200);

    expect(onBeat.energy).toBeGreaterThan(0.7);
    expect(onBeat.beat).toBeGreaterThan(0.9);
    expect(onBeat.bass).toBeGreaterThan(afterBeat.bass);
    expect(afterBeat.beat).toBeLessThan(onBeat.beat);
    expect(quiet.energy).toBeLessThan(0.3);
    expect(quiet.beat).toBeLessThan(0.02);
  });

  it("decays energy after a segment ends instead of dropping to zero", () => {
    const atEnd = frameFromAnalysis(analysis(), 1_500);
    const later = frameFromAnalysis(analysis(), 1_650);

    expect(atEnd.energy).toBeGreaterThan(later.energy);
    expect(later.energy).toBeGreaterThan(0);
  });

  it("turns loudness jumps into bass hits even off the beat grid", () => {
    const onset = frameFromAnalysis(analysis(), 820);
    const later = frameFromAnalysis(analysis(), 1_050);

    expect(onset.beat).toBeGreaterThan(0.4);
    expect(onset.bass).toBeGreaterThan(0.5);
    expect(onset.bass).toBeGreaterThan(later.energy * 0.4);
  });
});

describe("ambient visualizer motion", () => {
  it("attacks faster than it releases", () => {
    const rising = smoothVisualizerFrame(
      EMPTY_VISUALIZER_FRAME,
      { energy: 1, bass: 1, mid: 1, high: 1, beat: 1 },
      0.05,
    );
    const falling = smoothVisualizerFrame(
      { energy: 1, bass: 1, mid: 1, high: 1, beat: 1 },
      EMPTY_VISUALIZER_FRAME,
      0.05,
    );

    expect(rising.energy).toBeGreaterThan(1 - falling.energy);
    expect(rising.beat).toBeGreaterThan(rising.energy);
  });

  it("lifts quiet bass more as recognition increases", () => {
    const quiet = { energy: 0.22, bass: 0.24, mid: 0.18, high: 0.12, beat: 0.2 };
    const low = shapeVisualizerFrame(quiet, 25);
    const high = shapeVisualizerFrame(quiet, 100);

    expect(high.bass).toBeGreaterThan(low.bass);
    expect(high.beat).toBeGreaterThan(low.beat);
    expect(shapeVisualizerFrame(EMPTY_VISUALIZER_FRAME, 100)).toEqual(EMPTY_VISUALIZER_FRAME);
  });

  it("only latches once the signal is audible", () => {
    expect(hasVisualizerSignal(EMPTY_VISUALIZER_FRAME)).toBe(false);
    expect(hasVisualizerSignal({ ...EMPTY_VISUALIZER_FRAME, beat: 0.2 })).toBe(true);
  });

  it("writes pulse and wave css variables from the same frame", () => {
    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode: "pulse",
      spreadPercent: 80,
      colorStrengthPercent: 90,
    });
    const frame = {
      energy: 0.7,
      bass: 0.8,
      mid: 0.4,
      high: 0.3,
      beat: 0.9,
    };
    const pulse = ambientVisualizerVars(frame, metrics, "pulse", 1_200);
    const waves = ambientVisualizerVars(frame, metrics, "waves", 1_200);

    expect(Number(pulse["--lyrics-viz-pulse-opacity"])).toBeGreaterThan(0.3);
    expect(pulse["--lyrics-viz-pulse-transform"]).toContain("scale(");
    expect(waves["--lyrics-viz-wave-one-transform"]).toContain("scale(");
    expect(Number(waves["--lyrics-viz-ribbon-one-opacity"])).toBeGreaterThan(0);
    expect(clampVisualizer(2)).toBe(1);
  });

  it("blooms much more on a bass hit than in the rest between hits", () => {
    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode: "pulse",
      spreadPercent: 48,
      colorStrengthPercent: 42,
    });
    const rest = ambientVisualizerVars({
      energy: 0.22,
      bass: 0.18,
      mid: 0.2,
      high: 0.12,
      beat: 0.04,
    }, metrics, "pulse", 0);
    const hit = ambientVisualizerVars({
      energy: 0.58,
      bass: 0.86,
      mid: 0.36,
      high: 0.28,
      beat: 0.92,
    }, metrics, "pulse", 0);
    const restWaves = ambientVisualizerVars({
      energy: 0.22,
      bass: 0.18,
      mid: 0.2,
      high: 0.12,
      beat: 0.04,
    }, metrics, "waves", 0);
    const hitWaves = ambientVisualizerVars({
      energy: 0.58,
      bass: 0.86,
      mid: 0.36,
      high: 0.28,
      beat: 0.92,
    }, metrics, "waves", 0);

    expect(Number(hit["--lyrics-viz-pulse-opacity"]))
      .toBeGreaterThan(Number(rest["--lyrics-viz-pulse-opacity"]) * 2.2);
    expect(scaleFrom(hit["--lyrics-viz-pulse-transform"] ?? ""))
      .toBeGreaterThan(scaleFrom(rest["--lyrics-viz-pulse-transform"] ?? "") + 0.16);
    expect(Number(hit["--lyrics-viz-pulse-brightness"]))
      .toBeGreaterThan(Number(rest["--lyrics-viz-pulse-brightness"]));
    expect(Number(hitWaves["--lyrics-viz-wave-one-opacity"]))
      .toBeGreaterThan(Number(restWaves["--lyrics-viz-wave-one-opacity"]) * 2);
  });
});

function scaleFrom(transform: string): number {
  const match = /scale\(([-0-9.]+)/.exec(transform);
  return Number(match?.[1] ?? 0);
}
