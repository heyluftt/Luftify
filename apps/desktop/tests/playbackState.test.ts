import type { MediaItem, PlaybackState } from "@luft/protocol-types";
import { beforeEach, describe, expect, it } from "vitest";
import { nextRepeatMode, resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";

const track = (uri: string): MediaItem => ({
  uri,
  source: "spotify",
  itemType: "track",
  title: uri,
  creators: [{ name: "Artist" }],
  durationMs: 200_000,
  explicit: false,
  playable: true,
});

const playback = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  currentItem: track("spotify:track:one"),
  isPlaying: true,
  positionMs: 10_000,
  durationMs: 200_000,
  volume: 0.7,
  isMuted: false,
  shuffleEnabled: false,
  repeatMode: "off",
  isSaved: false,
  updatedAt: "2026-07-15T12:00:00.000Z",
  ...overrides,
});

describe("playback state synchronization", () => {
  beforeEach(() => {
    resetPlayerStore();
    usePlayerStore.getState().setPlayback(playback());
    usePlayerStore.getState().setConnection("online");
  });

  it("a shuffle confirmation changes only shuffle", () => {
    usePlayerStore.getState().applyRepeat("one");
    usePlayerStore.getState().applyShuffle(true);
    expect(usePlayerStore.getState().playback).toMatchObject({ shuffleEnabled: true, repeatMode: "one" });
  });

  it("keeps live playback when a late paused snapshot arrives during volume adjustment", () => {
    const store = usePlayerStore.getState();
    store.setPlayback(playback({ updatedAt: "2026-07-15T12:00:02.000Z" }));
    store.setVolumeOptimistic("volume-1", 0.4, false);
    store.setPlayback(playback({ isPlaying: false, updatedAt: "2026-07-15T12:00:01.000Z" }));
    store.applyPatch({ isPlaying: false, updatedAt: "2026-07-15T12:00:01.000Z" });
    store.confirmVolume("volume-1", 0.4, false);
    expect(usePlayerStore.getState().playback).toMatchObject({ isPlaying: true, volume: 0.4 });
    store.applyPatch({ isPlaying: false, updatedAt: "2026-07-15T12:00:03.000Z" });
    expect(usePlayerStore.getState().playback?.isPlaying).toBe(false);
  });

  it("a repeat confirmation changes only repeat", () => {
    usePlayerStore.getState().applyShuffle(true);
    usePlayerStore.getState().applyRepeat("all");
    expect(usePlayerStore.getState().playback).toMatchObject({ shuffleEnabled: true, repeatMode: "all" });
  });

  it("cycles repeat off to all to one to off", () => {
    expect(nextRepeatMode("off")).toBe("all");
    expect(nextRepeatMode("all")).toBe("one");
    expect(nextRepeatMode("one")).toBe("off");
  });

  it("accepts backend truth when the engine returns to a previously played track", () => {
    usePlayerStore.getState().setPlayback(playback({
      currentItem: track("spotify:track:two"),
      positionMs: 0,
    }));
    usePlayerStore.getState().applyPatch({
      currentItem: track("spotify:track:one"),
      positionMs: 87_000,
      durationMs: 200_000,
    });
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
    expect(usePlayerStore.getState().playback?.positionMs).toBe(87_000);
  });

  it("accepts a different authoritative engine track", () => {
    usePlayerStore.getState().setPlayback(playback({
      currentItem: track("spotify:track:three"),
      positionMs: 320,
    }));
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:three");
    expect(usePlayerStore.getState().playback?.positionMs).toBe(320);
  });

  it("keeps repeat when a partial song change omits repeat", () => {
    usePlayerStore.getState().applyRepeat("one");
    usePlayerStore.getState().applyPatch({ currentItem: track("spotify:track:two"), positionMs: 0 });
    expect(usePlayerStore.getState().playback?.repeatMode).toBe("one");
    expect(usePlayerStore.getState().generation).toBe(2);
  });

  it("merges a partial player event without resetting unrelated fields", () => {
    usePlayerStore.getState().applyShuffle(true);
    usePlayerStore.getState().applyRepeat("all");
    usePlayerStore.getState().applyPatch({ isPlaying: false });
    expect(usePlayerStore.getState().playback).toMatchObject({
      isPlaying: false,
      shuffleEnabled: true,
      repeatMode: "all",
      volume: 0.7,
      durationMs: 200_000,
    });
  });

  it("a late shuffle event cannot overwrite repeat", () => {
    usePlayerStore.getState().applyRepeat("one");
    usePlayerStore.getState().applyShuffle(true);
    expect(usePlayerStore.getState().playback?.repeatMode).toBe("one");
  });

  it("a late repeat event cannot overwrite shuffle", () => {
    usePlayerStore.getState().applyShuffle(true);
    usePlayerStore.getState().applyRepeat("all");
    expect(usePlayerStore.getState().playback?.shuffleEnabled).toBe(true);
  });

  it("a partial volume event changes no unrelated playback fields", () => {
    usePlayerStore.getState().applyShuffle(true);
    usePlayerStore.getState().applyRepeat("one");
    usePlayerStore.getState().applyVolume(0.25, true);
    expect(usePlayerStore.getState().playback).toMatchObject({
      volume: 0.25,
      isMuted: true,
      isPlaying: true,
      positionMs: 10_000,
      shuffleEnabled: true,
      repeatMode: "one",
      currentItem: { uri: "spotify:track:one" },
    });
  });

  it("an external old volume value cannot replace the current optimistic value", () => {
    usePlayerStore.getState().setVolumeOptimistic("volume-new", 0.85, false);
    usePlayerStore.getState().applyVolume(0.2, false);
    expect(usePlayerStore.getState().playback?.volume).toBe(0.85);
    expect(usePlayerStore.getState().confirmed?.volume).toBe(0.2);
  });

  it("shows the seek target immediately", () => {
    const store = usePlayerStore.getState();
    store.beginSeek();
    usePlayerStore.getState().previewSeek(80_000);
    expect(usePlayerStore.getState().playback?.positionMs).toBe(80_000);
  });

  it("ignores an old progress value while seek confirmation is pending", () => {
    usePlayerStore.getState().beginSeek();
    usePlayerStore.getState().previewSeek(80_000);
    usePlayerStore.getState().commitSeek("seek-1");
    usePlayerStore.getState().applyProgress({ positionMs: 11_000, trackUri: "spotify:track:one", eventTimestampMs: 1 });
    expect(usePlayerStore.getState().playback?.positionMs).toBe(80_000);
    expect(usePlayerStore.getState().seek.phase).toBe("confirming");
  });

  it("ends seeking when the engine reports a position near the target", () => {
    usePlayerStore.getState().beginSeek();
    usePlayerStore.getState().previewSeek(80_000);
    usePlayerStore.getState().commitSeek("seek-1");
    usePlayerStore.getState().applyProgress({ positionMs: 81_000, trackUri: "spotify:track:one", eventTimestampMs: 2 });
    expect(usePlayerStore.getState().seek.phase).toBe("idle");
    expect(usePlayerStore.getState().playback?.positionMs).toBe(81_000);
  });

  it("ignores a progress event from an old track", () => {
    usePlayerStore.getState().setPlayback(playback({ currentItem: track("spotify:track:two"), positionMs: 500 }));
    usePlayerStore.getState().applyProgress({ positionMs: 90_000, trackUri: "spotify:track:one", eventTimestampMs: 3 });
    expect(usePlayerStore.getState().playback?.positionMs).toBe(500);
  });

  it("accepts the same track jumping back to the beginning for repeat-one", () => {
    usePlayerStore.getState().setPlayback(playback({ positionMs: 199_500, repeatMode: "one" }));
    usePlayerStore.getState().applyProgress({ positionMs: 240, trackUri: "spotify:track:one", eventTimestampMs: 4 });
    expect(usePlayerStore.getState().playback).toMatchObject({
      positionMs: 240,
      isPlaying: true,
      repeatMode: "one",
      currentItem: { uri: "spotify:track:one" },
    });
  });

  it("ignores a delayed progress event after a newer one", () => {
    usePlayerStore.getState().applyProgress({
      positionMs: 24_000,
      trackUri: "spotify:track:one",
      eventTimestampMs: 20,
    });
    usePlayerStore.getState().applyProgress({
      positionMs: 13_000,
      trackUri: "spotify:track:one",
      eventTimestampMs: 19,
    });
    expect(usePlayerStore.getState().playback?.positionMs).toBe(24_000);
  });

  it("engine disconnect freezes confirmed progress and stops playback", () => {
    usePlayerStore.getState().applyProgress({ positionMs: 12_345, trackUri: "spotify:track:one", eventTimestampMs: 4 });
    usePlayerStore.getState().disconnect();
    expect(usePlayerStore.getState().playback).toMatchObject({ positionMs: 12_345, isPlaying: false });
    usePlayerStore.getState().applyProgress({ positionMs: 99_000, trackUri: "spotify:track:one", eventTimestampMs: 5 });
    expect(usePlayerStore.getState().playback?.positionMs).toBe(12_345);
  });

  it("engine disconnect cancels an in-flight seek and all optimistic controls", () => {
    usePlayerStore.getState().beginSeek();
    usePlayerStore.getState().previewSeek(80_000);
    usePlayerStore.getState().commitSeek("seek-1");
    usePlayerStore.getState().setControlOptimistic("volume", "volume-1", 0.2);
    usePlayerStore.getState().disconnect();
    expect(usePlayerStore.getState().seek.phase).toBe("idle");
    expect(usePlayerStore.getState().pending).toEqual({ seek: null, shuffle: null, repeat: null, volume: null });
    expect(usePlayerStore.getState().playback?.positionMs).toBe(10_000);
  });

  it("a user action during reconnect prevents claiming automatic resume", () => {
    usePlayerStore.getState().disconnect();
    usePlayerStore.getState().markUserAction();
    expect(usePlayerStore.getState().claimResume()).toBeUndefined();
  });

  it("resume can be claimed at most once per disconnect", () => {
    usePlayerStore.getState().disconnect();
    expect(usePlayerStore.getState().claimResume()).toBeDefined();
    expect(usePlayerStore.getState().claimResume()).toBeUndefined();
  });
});

export { playback, track };
