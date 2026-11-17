import { describe, expect, it } from "vitest";

import {
  DEFAULT_LYRICS_VISUAL_SETTINGS,
  lyricsAmbientMetrics,
  normalizeLyricsVisualSettings,
} from "../src/features/lyrics/lyricsVisualSettings";

describe("lyrics visual settings", () => {
  it("keeps the ambient pulse disabled by default", () => {
    expect(DEFAULT_LYRICS_VISUAL_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_LYRICS_VISUAL_SETTINGS.visualizerEnabled).toBe(false);
    expect(DEFAULT_LYRICS_VISUAL_SETTINGS.visualizerSensitivityPercent).toBe(62);
    expect(DEFAULT_LYRICS_VISUAL_SETTINGS.mode).toBe("pulse");
  });

  it("uses pulse for legacy settings without a persisted mode", () => {
    expect(normalizeLyricsVisualSettings({
      enabled: true,
      spreadPercent: 48,
      colorStrengthPercent: 42,
    }).mode).toBe("pulse");
    expect(normalizeLyricsVisualSettings({
      enabled: true,
      spreadPercent: 48,
      colorStrengthPercent: 42,
    }).visualizerEnabled).toBe(false);
  });

  it("keeps an explicitly enabled audio visualizer", () => {
    expect(normalizeLyricsVisualSettings({
      enabled: true,
      visualizerEnabled: true,
      mode: "waves",
      spreadPercent: 40,
      colorStrengthPercent: 80,
    }).visualizerEnabled).toBe(true);
  });

  it("clamps persisted percentages to the supported range", () => {
    expect(normalizeLyricsVisualSettings({
      enabled: true,
      mode: "waves",
      spreadPercent: 130,
      colorStrengthPercent: -20,
    })).toEqual({
      enabled: true,
      mode: "waves",
      spreadPercent: 100,
      colorStrengthPercent: 0,
      visualizerEnabled: false,
      visualizerSensitivityPercent: 62,
    });

    expect(normalizeLyricsVisualSettings({
      enabled: true,
      spreadPercent: 100,
      colorStrengthPercent: 260,
    }).colorStrengthPercent).toBe(200);

    expect(normalizeLyricsVisualSettings({
      enabled: true,
      visualizerSensitivityPercent: 180,
    }).visualizerSensitivityPercent).toBe(100);
  });

  it("maps stronger settings to a wider and more visible aura", () => {
    const zeroStrength = lyricsAmbientMetrics({
      enabled: true,
      spreadPercent: 100,
      colorStrengthPercent: 0,
    });
    const quiet = lyricsAmbientMetrics({
      enabled: true,
      spreadPercent: 0,
      colorStrengthPercent: 10,
    });
    const strong = lyricsAmbientMetrics({
      enabled: true,
      spreadPercent: 100,
      colorStrengthPercent: 100,
    });
    const boosted = lyricsAmbientMetrics({
      enabled: true,
      spreadPercent: 100,
      colorStrengthPercent: 200,
    });

    expect(zeroStrength.maxOpacity).toBe(0);
    expect(zeroStrength.ringOpacity).toBe(0);
    // 100 % stays a soft glow; the range above 100 % is the explicit boost.
    expect(strong.scaleMax).toBeGreaterThan(quiet.scaleMax);
    expect(strong.maxOpacity).toBeGreaterThan(quiet.maxOpacity);
    expect(strong.ringOpacity).toBeGreaterThan(quiet.ringOpacity);
    expect(strong.waveMaxOpacity).toBeGreaterThanOrEqual(0.65);
    expect(boosted.maxOpacity).toBeLessThanOrEqual(1);
    expect(strong.saturation).toBeGreaterThan(quiet.saturation);
    expect(boosted.saturation).toBeGreaterThan(strong.saturation);
    expect(boosted.maxOpacity).toBeGreaterThan(strong.maxOpacity);
    expect(boosted.waveMaxOpacity).toBeGreaterThan(strong.waveMaxOpacity);
    expect(boosted.ringOpacity).toBeGreaterThan(strong.ringOpacity);
    expect(strong.blurPx).toBeLessThanOrEqual(60);
  });
});
