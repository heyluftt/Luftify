import { describe, expect, it } from "vitest";
import type { PlaybackState } from "@luft/protocol-types";
import { remoteStateChanged, remoteStateOf } from "../src/features/remote/remoteState";

const playback = (patch: Partial<PlaybackState> = {}): PlaybackState => ({
  currentItem: {
    uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", source: "spotify", itemType: "track", title: "Nachtbus",
    creators: [{ name: "Paula Hartmann", uri: "spotify:artist:x" }], coverUri: "https://i.scdn.co/image/x", explicit: false, playable: true,
  },
  isPlaying: true, positionMs: 10_000, durationMs: 180_000, volume: 0.6, isMuted: false, shuffleEnabled: false,
  repeatMode: "off", isSaved: true, updatedAt: "", clockReady: true, ...patch,
} as PlaybackState);

describe("remote state for the phone", () => {
  it("carries the track, the place and the volume", () => {
    const state = remoteStateOf(playback());
    expect(state.track?.title).toBe("Nachtbus");
    expect(state.track?.artists).toEqual(["Paula Hartmann"]);
    expect(state).toMatchObject({ isPlaying: true, positionMs: 10_000, volume: 0.6, liked: true });
    expect(remoteStateOf(playback({ isMuted: true })).volume).toBe(0);
    expect(remoteStateOf(undefined)).toMatchObject({ isPlaying: false, positionMs: 0 });
  });

  it("is sent again on a change or a jump, not on every tick", () => {
    const before = remoteStateOf(playback());
    expect(remoteStateChanged(null, before, 0)).toBe(true);
    expect(remoteStateChanged(before, remoteStateOf(playback({ positionMs: 11_000 })), 1_000)).toBe(false);
    expect(remoteStateChanged(before, remoteStateOf(playback({ positionMs: 60_000 })), 1_000)).toBe(true);
    expect(remoteStateChanged(before, remoteStateOf(playback({ isPlaying: false })), 0)).toBe(true);
    expect(remoteStateChanged(before, remoteStateOf(playback({ volume: 0.3 })), 0)).toBe(true);
  });
});
