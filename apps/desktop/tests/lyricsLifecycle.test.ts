import { describe, expect, it } from "vitest";
import { resolveLyricsLifecycle } from "../src/features/lyrics/lyricsLifecycle";

const base = {
  cachedFallback: undefined,
  document: undefined,
  error: undefined,
  hasTrack: true,
  lyricsEnabled: true,
  lookupTimedOut: false,
  metadataReady: true,
  metadataTimedOut: false,
  pending: false,
};

describe("lyrics lifecycle", () => {
  it("sends a confirmed miss directly to the cover view", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      error: { code: "LYRICS_NOT_FOUND" },
    });

    expect(lifecycle.availability).toBe("not-found");
    expect(lifecycle.lyricsAvailable).toBe(false);
    expect(lifecycle.fallbackReason).toBe("not-found");
  });

  it("uses a remembered miss while a quiet refresh is pending", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      cachedFallback: "not-found",
      pending: true,
    });

    expect(lifecycle.availability).toBe("not-found");
    expect(lifecycle.lyricsAvailable).toBe(false);
  });

  it("lets newly found lyrics override an old fallback hint", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      cachedFallback: "not-found",
      document: {
        provider: "Spotify",
        synced: true,
        instrumental: false,
        lines: [{ startMs: 1_000, text: "First line" }],
      },
    });

    expect(lifecycle.availability).toBe("available");
    expect(lifecycle.hasLyrics).toBe(true);
    expect(lifecycle.lyricsAvailable).toBe(true);
  });

  it("finishes a timed-out lookup as a retryable error state", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      error: { code: "LYRICS_LOOKUP_TIMEOUT" },
    });

    expect(lifecycle.availability).toBe("error");
    expect(lifecycle.lyricsAvailable).toBe(true);
    expect(lifecycle.fallbackReason).toBe("temporarily-unavailable");
  });

  it("leaves incomplete metadata after a bounded wait", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      metadataReady: false,
      metadataTimedOut: true,
    });

    expect(lifecycle.availability).toBe("metadata-unavailable");
    expect(lifecycle.lyricsAvailable).toBe(false);
  });

  it("leaves a lookup that exceeded the track-wide deadline", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      lookupTimedOut: true,
      pending: true,
    });

    expect(lifecycle.availability).toBe("lookup-timeout");
    expect(lifecycle.lyricsAvailable).toBe(false);
    expect(lifecycle.fallbackReason).toBe("temporarily-unavailable");
  });

  it("keeps a remembered temporary miss on the cover when reopening", () => {
    const lifecycle = resolveLyricsLifecycle({
      ...base,
      cachedFallback: "temporarily-unavailable",
      pending: true,
    });

    expect(lifecycle.availability).toBe("lookup-timeout");
    expect(lifecycle.lyricsAvailable).toBe(false);
  });
});
