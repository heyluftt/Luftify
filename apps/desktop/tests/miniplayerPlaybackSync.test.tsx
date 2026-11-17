import { cleanup, render } from "@testing-library/react";
import type { PlaybackState } from "@luft/protocol-types";
import { afterEach, expect, it, vi } from "vitest";
import { PlaybackSync } from "../src/features/playback/PlaybackSync";
import { resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";

vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: () => ({}),
}));
vi.mock("../src/features/playback/usePlaybackEngine", () => ({
  usePlaybackEngine: () => ({ localReady: true, engineReady: true, mockMode: false, localPhase: "ready", credentialsPresent: true }),
}));
vi.mock("../src/features/queue/queueQueries", () => ({ QUEUE_QUERY_KEY: ["queue"], useQueueQuery: vi.fn() }));
vi.mock("../src/features/playback/playbackEvents", () => ({ retainPlaybackEvents: () => () => {}, resyncPlayback: vi.fn() }));
vi.mock("../src/features/playback/VolumeCommandCoordinator", () => ({ volumeCoordinator: { abort: vi.fn() } }));
vi.mock("../src/features/playback/playbackStateLoader", () => ({ invalidatePlaybackStateLoader: vi.fn() }));

afterEach(() => { cleanup(); resetPlayerStore(); });

it("follows volume updates and the next song without a local play click after opening", () => {
  resetPlayerStore();
  render(<PlaybackSync mode="compact" />);
  const store = usePlayerStore.getState();
  store.setConnection("online");
  const first: PlaybackState = {
    currentItem: { uri: "spotify:track:first", title: "First", creators: [{ name: "Artist" }], source: "spotify", itemType: "track", durationMs: 200_000, explicit: false, playable: true },
    isPlaying: true, positionMs: 20_000, durationMs: 200_000, volume: 0.7,
    isMuted: false, shuffleEnabled: false, repeatMode: "off", isSaved: false,
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
  store.setPlayback(first);
  store.setPlayback({ ...first, volume: 0.4, updatedAt: "2026-09-06T12:00:01.000Z" });
  expect(usePlayerStore.getState().playback).toMatchObject({ isPlaying: true, volume: 0.4, positionMs: 20_000 });
  store.setPlayback({ ...first, currentItem: { ...first.currentItem!, uri: "spotify:track:second", title: "Second" }, updatedAt: "2026-09-06T12:00:02.000Z" });
  expect(usePlayerStore.getState().playback).toMatchObject({ isPlaying: true, currentItem: { title: "Second" } });
});
