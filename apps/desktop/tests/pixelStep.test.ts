import { describe, expect, it } from "vitest";
import { pixelStepMs } from "../src/features/playback/useSmoothProgress";

describe("pixel-stepped progress", () => {
  it("moves once per device pixel, within sane bounds", () => {
    expect(pixelStepMs(180_000, 300)).toBe(600);
    expect(pixelStepMs(10_000, 600)).toBe(100);
    expect(pixelStepMs(3_600_000, 300)).toBe(1_000);
    expect(pixelStepMs(0, 300)).toBe(1_000);
  });
});
