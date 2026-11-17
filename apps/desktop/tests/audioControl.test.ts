import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_CONTROL_SETTINGS, getRuntimeAudioControlSettings, mappedVolume, setAudioPreset, setRuntimeAudioControlSettings, shortcutMatches, spotifyToUi, uiToSpotify } from "../src/features/audio-control/audioControl";
import { volumeCoordinator } from "../src/features/playback/VolumeCommandCoordinator";

describe("Audio Control mapping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setRuntimeAudioControlSettings(DEFAULT_AUDIO_CONTROL_SETTINGS);
  });
  it("keeps the linear curve unchanged", () => {
    expect(uiToSpotify(0.42, "linear")).toBe(0.42);
    expect(spotifyToUi(0.42, "linear")).toBe(0.42);
  });

  it("round-trips the perceptual curve consistently without exceeding one", () => {
    for (const value of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const spotify = uiToSpotify(value, "perceptual");
      expect(spotify).toBeGreaterThanOrEqual(0);
      expect(spotify).toBeLessThanOrEqual(1);
      expect(spotifyToUi(spotify, "perceptual")).toBeCloseTo(value, 8);
    }
    expect(uiToSpotify(2, "perceptual")).toBe(1);
  });

  it("raises low UI values with the gamma 0.5 compensation curve", () => {
    expect(uiToSpotify(0.25, "perceptual")).toBe(0.5);
    expect(uiToSpotify(0.1, "perceptual")).toBeGreaterThan(uiToSpotify(0.1, "linear"));
    expect(mappedVolume(0.25, "perceptual")).toEqual({ uiValue: 0.25, spotifyValue: 0.5, curve: "perceptual" });
  });

  it("matches configurable volume shortcuts exactly", () => {
    const event = new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true });
    expect(shortcutMatches(event, "Ctrl+ArrowUp")).toBe(true);
    expect(shortcutMatches(event, "Ctrl+ArrowDown")).toBe(false);
  });

  it("routes presets through the central VolumeCommandCoordinator", () => {
    const set = vi.spyOn(volumeCoordinator, "setMapped").mockImplementation(() => undefined);
    setAudioPreset(40, "linear");
    expect(set).toHaveBeenCalledWith({ uiValue: 0.4, spotifyValue: 0.4, curve: "linear" }, expect.any(Number));
  });

  it("publishes saved settings to keyboard and player consumers immediately", () => {
    const saved = { ...DEFAULT_AUDIO_CONTROL_SETTINGS, curve: "perceptual" as const, stepPercent: 2 as const };
    setRuntimeAudioControlSettings(saved);
    expect(getRuntimeAudioControlSettings()).toBe(saved);
  });
});
