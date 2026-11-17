import type { MediaItem } from "@luft/protocol-types";
import { describe, expect, it } from "vitest";
import {
  buildLyricsRequest,
  lyricsQueryKey,
} from "../src/features/lyrics/useLyricsQuery";

const track: MediaItem = {
  uri: "spotify:track:lyrics-test",
  source: "spotify",
  itemType: "track",
  title: "  A Song  ",
  creators: [
    { name: "First Artist" },
    { name: "Second Artist" },
    { name: " first artist " },
  ],
  albumName: "Album",
  durationMs: 179_600,
  coverUri: "spotify:image:cover",
  explicit: false,
  playable: true,
};

describe("lyrics request metadata", () => {
  it("waits for a real creator and a plausible duration", () => {
    expect(buildLyricsRequest({
      ...track,
      creators: [],
    })).toBeUndefined();
    expect(buildLyricsRequest({
      ...track,
      durationMs: 14_999,
    })).toBeUndefined();
  });

  it("sends stable track metadata and every unique artist", () => {
    expect(buildLyricsRequest(track)).toEqual({
      trackUri: "spotify:track:lyrics-test",
      trackName: "A Song",
      artistName: "First Artist",
      artistNames: ["First Artist", "Second Artist"],
      albumName: "Album",
      durationMs: 180_000,
      coverUri: "spotify:image:cover",
    });
  });

  it("uses the live playback duration when the media item has none", () => {
    const trackWithoutDuration: MediaItem = { ...track };
    delete trackWithoutDuration.durationMs;

    expect(
      buildLyricsRequest(
        trackWithoutDuration,
        179_600,
      )?.durationMs,
    ).toBe(180_000);
  });

  it("keeps the query key stable while Spotify metadata is enriched", () => {
    const first = buildLyricsRequest(track);
    const renamed = buildLyricsRequest({
      ...track,
      title: "Another Song",
    });

    expect(lyricsQueryKey(first)).toEqual(lyricsQueryKey(renamed));
    expect(lyricsQueryKey(first)).toEqual([
      "lyrics",
      "spotify:track:lyrics-test",
    ]);
  });

  it("still separates metadata-addressed non-Spotify tracks", () => {
    const first = buildLyricsRequest({
      ...track,
      uri: "https://example.test/first",
    });
    const renamed = buildLyricsRequest({
      ...track,
      uri: "https://example.test/first",
      title: "Another Song",
    });

    expect(lyricsQueryKey(first)).not.toEqual(lyricsQueryKey(renamed));
  });
});
