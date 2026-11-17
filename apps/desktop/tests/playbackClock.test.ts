import { describe, expect, it } from "vitest";
import {
  advancePlaybackClock,
  initialPlaybackClock,
  resolvePlaybackDurationMs,
  synchronizePlaybackClock,
} from "../src/features/playback/playbackClock";

const mode = (repeatMode: "off" | "all" | "one") => ({
  durationMs: 142_000,
  repeatMode,
  playing: true,
  suspended: false,
});

describe("playback duration fallback", () => {
  it("uses the track duration when the published clock duration is still zero", () => {
    expect(resolvePlaybackDurationMs(0, 181_000)).toBe(181_000);
    expect(resolvePlaybackDurationMs(200_000, 181_000)).toBe(200_000);
    expect(resolvePlaybackDurationMs(undefined, undefined)).toBe(0);
  });

  it("starts a new clock from the incoming position when the track changes", () => {
    const previous = initialPlaybackClock(87_000, "spotify:track:one");
    expect(synchronizePlaybackClock(previous, 0, "spotify:track:two", mode("off")).positionMs).toBe(0);
    expect(synchronizePlaybackClock(previous, 1_200, "spotify:track:two", mode("off")).positionMs).toBe(1_200);
  });

  it("ignores a delayed zero while the same track is already running", () => {
    const running = initialPlaybackClock(3_200, "spotify:track:one");
    expect(synchronizePlaybackClock(running, 0, "spotify:track:one", mode("off"))).toBe(running);
    const seeking = synchronizePlaybackClock(running, 0, "spotify:track:one", {
      ...mode("off"),
      suspended: true,
    });
    expect(seeking.positionMs).toBe(0);
  });

  it("keeps counting elapsed time before duration is known", () => {
    const running = advancePlaybackClock(
      { positionMs: 0, cycle: 0 },
      1_200,
      { durationMs: 0, repeatMode: "off", playing: true, suspended: false },
    );
    expect(running.positionMs).toBe(1_200);
  });
});

describe("repeat-aware playback clock", () => {
  it("wraps repeat-one immediately instead of sticking at the duration", () => {
    const state = initialPlaybackClock(141_900, "spotify:track:one");
    expect(advancePlaybackClock(state, 250, mode("one"))).toMatchObject({
      positionMs: 150,
      cycle: 1,
    });
  });

  it("does not invent a same-track wrap for repeat-all, shuffle or repeat-off", () => {
    const state = initialPlaybackClock(141_900, "spotify:track:one");
    expect(advancePlaybackClock(state, 250, mode("all")).positionMs).toBe(142_000);
    expect(advancePlaybackClock(state, 250, mode("off")).positionMs).toBe(142_000);
  });

  it("ignores a stale terminal getter after a locally predicted cycle", () => {
    const wrapped = { ...initialPlaybackClock(4_000, "spotify:track:one"), cycle: 1 };
    expect(synchronizePlaybackClock(wrapped, 142_000, "spotify:track:one", mode("one"))).toBe(wrapped);
  });

  it("recognizes an authoritative same-track backward jump as a new cycle", () => {
    const state = initialPlaybackClock(141_900, "spotify:track:one");
    expect(synchronizePlaybackClock(state, 100, "spotify:track:one", mode("one"))).toMatchObject({
      positionMs: 100,
      cycle: 1,
    });
  });
});
