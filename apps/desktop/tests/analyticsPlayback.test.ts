import { describe, expect, it, vi } from "vitest";
import { playAnalyticsTrack } from "../src/features/analytics/analyticsPlayback";
import type { AnalyticsTrack } from "../src/features/analytics/analyticsTypes";

function track(albumUri?: string): AnalyticsTrack {
  return {
    uri: "spotify:track:track1",
    itemType: "track",
    title: "Test Track",
    creators: [{ name: "Test Artist" }],
    ...(albumUri ? { albumUri } : {}),
  };
}

describe("analytics playback", () => {
  it("starts a ranked song inside its album context", () => {
    const playContext = vi.fn();
    const playUri = vi.fn();

    playAnalyticsTrack(track("spotify:album:album1"), { playContext, playUri });

    expect(playContext).toHaveBeenCalledWith(
      "spotify:album:album1",
      "spotify:track:track1",
    );
    expect(playUri).not.toHaveBeenCalled();
  });

  it("falls back to an isolated track only without a valid album", () => {
    const playContext = vi.fn();
    const playUri = vi.fn();

    playAnalyticsTrack(track(), { playContext, playUri });

    expect(playUri).toHaveBeenCalledWith("spotify:track:track1");
    expect(playContext).not.toHaveBeenCalled();
  });
});
