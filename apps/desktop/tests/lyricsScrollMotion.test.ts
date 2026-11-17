import { describe, expect, it } from "vitest";
import {
  advanceLyricsSpring,
  lyricsScrollTarget,
} from "../src/features/lyrics/lyricsScrollMotion";

describe("lyrics scroll motion", () => {
  it("places the active line on the reading anchor", () => {
    expect(
      lyricsScrollTarget({
        readerScrollTop: 100,
        readerScrollHeight: 2_000,
        readerClientHeight: 800,
        readerTop: 100,
        lineTop: 500,
        lineHeight: 60,
      }),
    ).toBe(186);
  });

  it("keeps an opening line at the top of the reader", () => {
    expect(
      lyricsScrollTarget({
        readerScrollTop: 0,
        readerScrollHeight: 2_400,
        readerClientHeight: 720,
        readerTop: 80,
        lineTop: 104,
        lineHeight: 48,
      }),
    ).toBe(0);
  });

  it("clamps targets to the available scroll range", () => {
    expect(
      lyricsScrollTarget({
        readerScrollTop: 0,
        readerScrollHeight: 1_000,
        readerClientHeight: 600,
        readerTop: 100,
        lineTop: 0,
        lineHeight: 40,
      }),
    ).toBe(0);

    expect(
      lyricsScrollTarget({
        readerScrollTop: 350,
        readerScrollHeight: 1_000,
        readerClientHeight: 600,
        readerTop: 0,
        lineTop: 900,
        lineHeight: 60,
      }),
    ).toBe(400);
  });

  it("keeps velocity while smoothly approaching a retargeted line", () => {
    const first = advanceLyricsSpring(
      { position: 0, velocity: 0 },
      80,
      1 / 60,
    );
    const retargeted = advanceLyricsSpring(
      first,
      140,
      1 / 60,
    );

    expect(first.position).toBeGreaterThan(0);
    expect(retargeted.position).toBeGreaterThan(first.position);
    expect(retargeted.position).toBeLessThan(140);
    expect(retargeted.velocity).toBeGreaterThan(0);
  });
});
