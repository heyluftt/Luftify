import { describe, expect, it } from "vitest";

import { playbackPollMatches } from "../src/features/playback/PlaybackSync";

const current = {
  connectionEpoch: 4,
  generation: 12,
};

describe("playback polling identity", () => {
  it("accepts a poll from the current connection and track generation", () => {
    expect(playbackPollMatches({ connectionEpoch: 4, generation: 12 }, current)).toBe(true);
  });

  it("rejects a poll that started before the track changed", () => {
    expect(playbackPollMatches({ connectionEpoch: 4, generation: 11 }, current)).toBe(false);
  });

  it("rejects poll results from another connection epoch", () => {
    expect(playbackPollMatches({ connectionEpoch: 3, generation: 12 }, current)).toBe(false);
  });
});
