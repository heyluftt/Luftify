import type { PlaybackState } from "@luft/protocol-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidatePlaybackStateLoader,
  loadPlaybackStateOnce,
  resetPlaybackStateLoaderForTests,
} from "../src/features/playback/playbackStateLoader";

const api = vi.hoisted(() => ({ playbackState: vi.fn() }));
vi.mock("../src/services/desktopApi", () => ({ desktopApi: api }));

describe("playback state loader", () => {
  beforeEach(() => {
    resetPlaybackStateLoaderForTests();
    api.playbackState.mockReset();
  });

  it("deduplicates concurrent full-state requests", async () => {
    const request = deferred<PlaybackState>();
    api.playbackState.mockReturnValue(request.promise);
    const first = loadPlaybackStateOnce();
    const second = loadPlaybackStateOnce();
    expect(first).toBe(second);
    expect(api.playbackState).toHaveBeenCalledOnce();
    request.resolve(playback());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("starts a fresh generation after a disconnect without letting the old request clear it", async () => {
    const stale = deferred<PlaybackState>();
    const fresh = deferred<PlaybackState>();
    api.playbackState
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);

    const staleRequest = loadPlaybackStateOnce();
    invalidatePlaybackStateLoader();
    const freshRequest = loadPlaybackStateOnce();

    expect(freshRequest).not.toBe(staleRequest);
    expect(api.playbackState).toHaveBeenCalledTimes(2);

    stale.resolve(playback());
    await staleRequest;
    expect(loadPlaybackStateOnce()).toBe(freshRequest);
    expect(api.playbackState).toHaveBeenCalledTimes(2);

    fresh.resolve(playback());
    await freshRequest;
  });
});

function playback(): PlaybackState {
  return {
    currentItem: { uri: "spotify:track:one", source: "spotify", itemType: "track", title: "One", creators: [{ name: "Artist" }], durationMs: 200_000, explicit: false, playable: true },
    isPlaying: true, positionMs: 10_000, durationMs: 200_000, volume: 0.7, isMuted: false,
    shuffleEnabled: false, repeatMode: "off", isSaved: false, updatedAt: "2026-07-16T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
