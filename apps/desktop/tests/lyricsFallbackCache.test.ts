import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetLyricsFallback,
  lyricsFallbackCacheKey,
  readLyricsFallback,
  rememberLyricsFallback,
} from "../src/features/lyrics/lyricsFallbackCache";

const TRACK_URI = "file:///C:/private/music/example.mp3";
const NOW = 1_800_000_000_000;

describe("lyrics fallback cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a confirmed miss without storing the track URI", () => {
    const key = lyricsFallbackCacheKey(TRACK_URI);
    rememberLyricsFallback(key, "not-found", NOW);

    expect(readLyricsFallback(key, NOW + 13 * 24 * 60 * 60_000))
      .toBe("not-found");
    expect(localStorage.getItem("luftplayer.lyrics.fallbacks.v1"))
      .not.toContain(TRACK_URI);
  });

  it("expires confirmed misses and temporary provider failures separately", () => {
    const missingKey = lyricsFallbackCacheKey("spotify:track:missing");
    const unavailableKey = lyricsFallbackCacheKey("spotify:track:offline");
    rememberLyricsFallback(missingKey, "not-found", NOW);
    rememberLyricsFallback(unavailableKey, "temporarily-unavailable", NOW);

    expect(readLyricsFallback(unavailableKey, NOW + 29 * 60_000))
      .toBe("temporarily-unavailable");
    expect(readLyricsFallback(unavailableKey, NOW + 31 * 60_000))
      .toBeUndefined();
    expect(readLyricsFallback(missingKey, NOW + 15 * 24 * 60 * 60_000))
      .toBeUndefined();
  });

  it("forgets the hint as soon as lyrics become available", () => {
    const key = lyricsFallbackCacheKey("spotify:track:found-later");
    rememberLyricsFallback(key, "not-found", NOW);
    forgetLyricsFallback(key);

    expect(readLyricsFallback(key, NOW)).toBeUndefined();
  });

  it("ignores malformed persisted data", () => {
    localStorage.setItem("luftplayer.lyrics.fallbacks.v1", "not-json");
    expect(readLyricsFallback("anything", NOW)).toBeUndefined();
  });
});
