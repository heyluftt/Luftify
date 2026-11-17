import { describe, expect, it } from "vitest";
import {
  formatTrackDuration,
  shareCopy,
  spotifyOpenUrl,
} from "../src/features/entities/spotifyLinks";

describe("spotify links", () => {
  it("builds public Spotify URLs only for real spotify URIs", () => {
    expect(spotifyOpenUrl("spotify:track:abc123")).toBe(
      "https://open.spotify.com/track/abc123",
    );
    expect(spotifyOpenUrl("spotify:album:glass")).toBe(
      "https://open.spotify.com/album/glass",
    );
    expect(spotifyOpenUrl("mock:track:abc123")).toBeUndefined();
    expect(spotifyOpenUrl("spotify:local:file")).toBeUndefined();
  });

  it("formats a share line and duration", () => {
    expect(
      shareCopy({
        title: "Airborne",
        creators: [{ name: "Atlas" }, { name: "Nocturne" }],
      }),
    ).toBe("Airborne · Atlas, Nocturne");
    expect(formatTrackDuration(185_000)).toBe("3:05");
  });
});
