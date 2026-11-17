import { describe, expect, it } from "vitest";
import {
  MAX_VOLUME_BOOST_PERCENT,
  volumeBoostDbFromPercent,
  volumeBoostPercentFromDb,
} from "../src/features/audio-control/volumeBoost";

describe("volume boost", () => {
  it("maps 300 percent to a threefold output gain", () => {
    const db = volumeBoostDbFromPercent(MAX_VOLUME_BOOST_PERCENT);
    expect(Math.pow(10, db / 20)).toBeCloseTo(3, 5);
    expect(volumeBoostPercentFromDb(db)).toBe(300);
  });

  it("keeps imported values within the 100 to 300 percent range", () => {
    expect(volumeBoostPercentFromDb(-4)).toBe(100);
    expect(volumeBoostPercentFromDb(20)).toBe(300);
  });
});
