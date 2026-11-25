import { describe, expect, it } from "vitest";

import {
  EMPTY_VISUALIZER_FRAME,
  clampVisualizer,
  createVisualizerFollower,
  frameFromAnalysis,
  hasVisualizerSignal,
  shapeVisualizerFrame,
  smoothVisualizerFrame,
  waveVisualizerVars,
} from "../src/features/lyrics/ambientVisualizer";
import { createHaloMotion } from "../src/features/lyrics/haloVisualizer";
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

  it("keeps the rest between hits dark at full recognition", () => {
    const rest = shapeVisualizerFrame(
      { energy: 0.85, bass: 0.03, mid: 0.04, high: 0.05, beat: 0.02 },
      100,
    );
    const hit = shapeVisualizerFrame({ ...EMPTY_VISUALIZER_FRAME, bass: 0.9 }, 0);

    expect(rest.bass).toBeLessThan(0.15);
    expect(rest.high).toBeLessThan(0.15);
    expect(hit.bass).toBeGreaterThan(0.7);
  });

  it("follows a hit within a few screen frames and lets go again", () => {
    const follower = createVisualizerFollower();
    const frameMs = 1_000 / 240;
    let now = 0;
    follower.step(now);
    follower.push(HIT, 62);
    let frame = follower.step(now);
    for (let index = 0; index < 10; index += 1) frame = follower.step((now += frameMs));
    expect(frame.bass).toBeGreaterThan(0.75);

    follower.push(REST, 62);
    for (let index = 0; index < 36; index += 1) frame = follower.step((now += frameMs));
    expect(frame.bass).toBeLessThan(0.1);
  });

  it("only latches once the signal is audible", () => {
    expect(hasVisualizerSignal(EMPTY_VISUALIZER_FRAME)).toBe(false);
    expect(hasVisualizerSignal({ ...EMPTY_VISUALIZER_FRAME, beat: 0.2 })).toBe(true);
  });

  const REST = { energy: 0.7, bass: 0.04, mid: 0.05, high: 0.06, beat: 0.03 };
  const HIT = { energy: 0.8, bass: 0.9, mid: 0.4, high: 0.3, beat: 0.9 };

  it("writes wave css variables", () => {
    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode: "waves",
      spreadPercent: 80,
      colorStrengthPercent: 90,
    });
    const waves = waveVisualizerVars(HIT, metrics, 1_200);

    expect(waves["--lyrics-viz-wave-one-transform"]).toContain("scale(");
    expect(Number(waves["--lyrics-viz-ribbon-one-opacity"])).toBeGreaterThan(0);
    expect(clampVisualizer(2)).toBe(1);
  });

  it("moves the waves much more on a bass hit than in the rest between hits", () => {
    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode: "waves",
      spreadPercent: 48,
      colorStrengthPercent: 42,
    });
    const rest = waveVisualizerVars(REST, metrics, 0);
    const hit = waveVisualizerVars(HIT, metrics, 0);

    expect(Number(hit["--lyrics-viz-wave-one-opacity"]))
      .toBeGreaterThan(Number(rest["--lyrics-viz-wave-one-opacity"]) * 2);
    expect(scaleFrom(hit["--lyrics-viz-wave-one-transform"] ?? ""))
      .toBeGreaterThan(scaleFrom(rest["--lyrics-viz-wave-one-transform"] ?? ""));
  });

  it("flares the halo on a hit and lets it fall back afterwards", () => {
    const metrics = lyricsAmbientMetrics({
      enabled: true,
      mode: "pulse",
      spreadPercent: 48,
      colorStrengthPercent: 42,
    });
    const halo = createHaloMotion(metrics);
    const rest = halo(REST, 0);
    const hit = halo(HIT, 16);
    let later = hit;
    for (let now = 32; now <= 616; now += 16) later = halo(REST, now);

    expect(Number(hit["--lyrics-viz-halo-opacity"]))
      .toBeGreaterThan(Number(rest["--lyrics-viz-halo-opacity"]) * 2);
    expect(Number(hit["--lyrics-viz-halo-scale"]))
      .toBeGreaterThan(Number(rest["--lyrics-viz-halo-scale"]));
    expect(parseFloat(hit["--lyrics-viz-near-width"] ?? ""))
      .toBeGreaterThan(parseFloat(rest["--lyrics-viz-near-width"] ?? "") * 1.5);
    expect(Number(later["--lyrics-viz-halo-opacity"]))
      .toBeLessThan(Number(hit["--lyrics-viz-halo-opacity"]) * 0.6);
  });

  it("glows with a loud song that has no hits, and rests dark between hits", () => {
    const metrics = lyricsAmbientMetrics({ enabled: true, mode: "pulse" });
    const restOpacity = (hitEveryMs: number | null) => {
      const halo = createHaloMotion(metrics);
      let lowest = 1;
      for (let now = 0; now <= 4_000; now += 16) {
        const vars = halo(hitEveryMs !== null && now % hitEveryMs < 16 ? HIT : REST, now);
        if (now > 3_000) lowest = Math.min(lowest, Number(vars["--lyrics-viz-halo-opacity"]));
      }
      return lowest;
    };

    expect(restOpacity(null)).toBeGreaterThan(restOpacity(496) * 1.5);
  });

  it("turns the beams faster while the music hits", () => {
    const metrics = lyricsAmbientMetrics({ enabled: true, mode: "pulse" });
    const turned = (frame: typeof REST) => {
      const halo = createHaloMotion(metrics);
      halo(frame, 0);
      return parseFloat(halo(frame, 100)["--lyrics-viz-near-turn"] ?? "");
    };

    expect(turned(HIT)).toBeGreaterThan(turned(REST) * 2.5);
    expect(turned(REST)).toBeGreaterThan(0);
  });
});

function scaleFrom(transform: string): number {
  const match = /scale\(([-0-9.]+)/.exec(transform);
  return Number(match?.[1] ?? 0);
}
