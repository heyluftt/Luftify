import type { PlaybackState, QueueState } from "@luft/protocol-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  playbackCommands,
  resetPlaybackCommandsForTests,
  waitForPlaybackCommandsForTests,
} from "../src/features/playback/playbackCommands";
import { resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";
import { dispatchTrayPlayerAction } from "../src/features/playback/trayPlayerActions";
import { queryClient } from "../src/queryClient";
import { QUEUE_QUERY_KEY } from "../src/features/queue/queueQueries";

const api = vi.hoisted(() => ({
  playerCommand: vi.fn(),
  transportCommand: vi.fn(),
  previewVolume: vi.fn(),
  volumeCommand: vi.fn(),
  playbackState: vi.fn(),
  playUri: vi.fn(),
  playContext: vi.fn(),
}));

vi.mock("../src/services/desktopApi", () => ({ desktopApi: api }));

const state = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  currentItem: {
    uri: "spotify:track:one",
    source: "spotify",
    itemType: "track",
    title: "One",
    creators: [{ name: "Artist" }],
    durationMs: 200_000,
    explicit: false,
    playable: true,
  },
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

describe("serialized playback commands", () => {
  beforeEach(async () => {
    await waitForPlaybackCommandsForTests();
    resetPlaybackCommandsForTests();
    resetPlayerStore();
    usePlayerStore.getState().setPlayback(state());
    usePlayerStore.getState().setConnection("online");
    vi.clearAllMocks();
    queryClient.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("adopts a ready playback clock from the transport response", async () => {
    usePlayerStore.getState().setPlayback(state({ isPlaying: false, positionMs: 0, clockReady: false }));
    api.playerCommand.mockResolvedValue(state({ isPlaying: true, positionMs: 250, clockReady: true }));
    playbackCommands.send({ command: "toggle" });
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback).toMatchObject({
      isPlaying: true, positionMs: 250, clockReady: true,
    });
  });

  it("locks repeat while a confirmation is pending", async () => {
    const request = deferred<PlaybackState>();
    api.playerCommand.mockReturnValue(request.promise);
    playbackCommands.send({ command: "setRepeat", repeatMode: "all" });
    playbackCommands.send({ command: "setRepeat", repeatMode: "one" });
    expect(api.playerCommand).toHaveBeenCalledTimes(1);
    expect(api.playerCommand).toHaveBeenCalledWith({ command: "setRepeat", repeatMode: "all" });
    request.resolve(state({ repeatMode: "all" }));
    await flush();
    expect(usePlayerStore.getState().playback?.repeatMode).toBe("all");
  });

  it("prevents contradictory shuffle requests on rapid clicks", async () => {
    const request = deferred<PlaybackState>();
    api.playerCommand.mockReturnValue(request.promise);
    playbackCommands.send({ command: "setShuffle", enabled: true });
    playbackCommands.send({ command: "setShuffle", enabled: false });
    expect(api.playerCommand).toHaveBeenCalledTimes(1);
    expect(api.playerCommand).toHaveBeenCalledWith({ command: "setShuffle", enabled: true });
    request.resolve(state({ shuffleEnabled: true }));
    await flush();
    expect(usePlayerStore.getState().playback?.shuffleEnabled).toBe(true);
  });

  it("sends a newer final volume immediately and ignores the older response", async () => {
    const first = deferred<PlaybackState>();
    api.volumeCommand
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(state({ volume: 0.8 }));
    usePlayerStore.getState().applyPatch({ isMuted: true });
    playbackCommands.send({ command: "setVolume", value: 0.2 });
    playbackCommands.send({ command: "setVolume", value: 0.5 });
    playbackCommands.send({ command: "setVolume", value: 0.8 });
    expect(api.volumeCommand).toHaveBeenCalledTimes(3);
    first.resolve(state({ volume: 0.2 }));
    await waitForPlaybackCommandsForTests();
    expect(api.volumeCommand).toHaveBeenCalledTimes(3);
    expect(api.volumeCommand.mock.calls.at(-1)?.[0]).toMatchObject({ volume: 0.8, unmute: true });
    expect(usePlayerStore.getState().playback?.volume).toBe(0.8);
    expect(usePlayerStore.getState().playback?.isMuted).toBe(false);
  });

  it("resynchronizes from Spotify when seek confirmation times out", async () => {
    vi.useFakeTimers();
    const seekRequest = deferred<PlaybackState>();
    api.playerCommand.mockReturnValue(seekRequest.promise);
    api.playbackState.mockResolvedValue(state({ positionMs: 79_500 }));
    playbackCommands.beginSeek();
    playbackCommands.previewSeek(80_000);
    playbackCommands.commitSeek();
    expect(usePlayerStore.getState().playback?.positionMs).toBe(80_000);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(api.playbackState).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().seek.phase).toBe("idle");
    expect(usePlayerStore.getState().playback?.positionMs).toBe(79_500);
    seekRequest.resolve(state({ positionMs: 79_500 }));
    await waitForPlaybackCommandsForTests();
  });

  it("ignores an in-flight command response after disconnect", async () => {
    const request = deferred<PlaybackState>();
    api.playerCommand.mockReturnValue(request.promise);
    playbackCommands.send({ command: "pause" });
    usePlayerStore.getState().disconnect();
    request.resolve(state({ isPlaying: false, positionMs: 99_000 }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback).toMatchObject({ isPlaying: false, positionMs: 10_000 });
  });

  it("sends every next click to the engine at once instead of queueing them", async () => {
    const requests = [deferred<PlaybackState>(), deferred<PlaybackState>(), deferred<PlaybackState>()];
    requests.forEach((request) => api.transportCommand.mockReturnValueOnce(request.promise));

    playbackCommands.send({ command: "next" });
    playbackCommands.send({ command: "next" });
    playbackCommands.send({ command: "next" });

    expect(api.transportCommand).toHaveBeenCalledTimes(3);
    expect(api.transportCommand.mock.calls.map(([request]) => request.action)).toEqual(["next", "next", "next"]);
    expect(usePlayerStore.getState().transportPending).toMatchObject({ count: 3, activeAction: "next" });

    requests.forEach((request, index) => request.resolve(state({
      currentItem: { ...state().currentItem!, uri: `spotify:track:${index + 2}` },
      positionMs: 0,
      updatedAt: `2026-07-15T12:00:0${index + 1}.000Z`,
    })));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().transportPending.count).toBe(0);
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:4");
  });

  it("keeps the newest answer when an older skip response arrives late", async () => {
    const first = deferred<PlaybackState>();
    const second = deferred<PlaybackState>();
    api.transportCommand.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    playbackCommands.send({ command: "next" });
    playbackCommands.send({ command: "next" });
    second.resolve(state({
      currentItem: { ...state().currentItem!, uri: "spotify:track:three" },
      positionMs: 0,
      updatedAt: "2026-07-15T12:00:02.000Z",
    }));
    await flush();
    first.resolve(state({
      currentItem: { ...state().currentItem!, uri: "spotify:track:two" },
      positionMs: 0,
      updatedAt: "2026-07-15T12:00:01.000Z",
    }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:three");
  });

  it("shows the engine's next title as soon as the transport answers", async () => {
    const upcoming = { ...state().currentItem!, uri: "spotify:track:two", title: "Two" };
    const pending = deferred<PlaybackState>();
    api.transportCommand.mockReturnValue(pending.promise);
    playbackCommands.send({ command: "next" });
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
    pending.resolve(state({ currentItem: upcoming, positionMs: 0, updatedAt: "2026-07-15T12:00:01.000Z" }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:two");
    expect(usePlayerStore.getState().playback?.positionMs).toBe(0);
  });

  it("accepts previous returning to the track played before a next", async () => {
    const second = { ...state().currentItem!, uri: "spotify:track:two", title: "Two" };
    api.transportCommand
      .mockResolvedValueOnce(state({ currentItem: second, positionMs: 0, updatedAt: "2026-07-15T12:00:01.000Z" }))
      .mockResolvedValueOnce(state({ positionMs: 0, updatedAt: "2026-07-15T12:00:02.000Z" }));

    playbackCommands.send({ command: "next" });
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:two");

    playbackCommands.send({ command: "previous" });
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
  });

  it("keeps the current track when next is a backend no-op", async () => {
    api.transportCommand.mockResolvedValue(state({ updatedAt: "2026-07-15T12:00:01.000Z" }));
    playbackCommands.send({ command: "next" });
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
    expect(usePlayerStore.getState().transportPending.count).toBe(0);
    expect(api.playbackState).not.toHaveBeenCalled();
  });

  it("accepts a different track returned authoritatively by the engine", async () => {
    const requested = { ...state().currentItem!, uri: "spotify:track:two", title: "Two" };
    const actual = { ...state().currentItem!, uri: "spotify:track:three", title: "Three" };
    const pending = deferred<PlaybackState>();
    api.playContext.mockReturnValue(pending.promise);

    playbackCommands.playContext("spotify:playlist:luft", requested.uri, [requested]);
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
    pending.resolve(state({ currentItem: actual, positionMs: 0 }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:three");
  });

  it("routes next through the transport command without play pause or seek", async () => {
    api.transportCommand.mockResolvedValue(state({ currentItem: { ...state().currentItem!, uri: "spotify:track:two" }, positionMs: 0 }));
    playbackCommands.send({ command: "next" });
    await waitForPlaybackCommandsForTests();
    expect(api.transportCommand).toHaveBeenCalledOnce();
    expect(api.transportCommand.mock.calls[0]?.[0]).toMatchObject({ action: "next", trackUriBefore: "spotify:track:one", positionBeforeMs: 10_000 });
    expect(api.playerCommand).not.toHaveBeenCalled();
  });

  it("does not hold pause behind pending skips", async () => {
    const skip = deferred<PlaybackState>();
    api.transportCommand.mockReturnValue(skip.promise);
    api.playerCommand.mockResolvedValue(state({ isPlaying: false }));

    playbackCommands.send({ command: "next" });
    playbackCommands.send({ command: "next" });
    playbackCommands.send({ command: "pause" });
    await flush();
    expect(api.transportCommand).toHaveBeenCalledTimes(2);
    expect(api.playerCommand).toHaveBeenCalledWith({ command: "pause" });

    skip.resolve(state({ currentItem: { ...state().currentItem!, uri: "spotify:track:two" }, positionMs: 0, isPlaying: false }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().transportPending.count).toBe(0);
  });

  it("drops a skip answer that arrives after a disconnect", async () => {
    const skip = deferred<PlaybackState>();
    api.transportCommand.mockReturnValue(skip.promise);
    playbackCommands.send({ command: "next" });
    usePlayerStore.getState().disconnect();
    skip.resolve(state({ currentItem: { ...state().currentItem!, uri: "spotify:track:two" }, positionMs: 0 }));
    await waitForPlaybackCommandsForTests();
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:one");
    expect(usePlayerStore.getState().transportPending.count).toBe(0);
  });

  it("routes tray and visible transport actions through the same path", async () => {
    api.transportCommand
      .mockResolvedValueOnce(state({ currentItem: { ...state().currentItem!, uri: "spotify:track:two" }, positionMs: 0, updatedAt: "2026-07-15T12:00:01.000Z" }))
      .mockResolvedValueOnce(state({ currentItem: { ...state().currentItem!, uri: "spotify:track:three" }, positionMs: 0, updatedAt: "2026-07-15T12:00:02.000Z" }));
    playbackCommands.send({ command: "next" });
    await waitForPlaybackCommandsForTests();
    dispatchTrayPlayerAction("next");
    await waitForPlaybackCommandsForTests();
    expect(api.transportCommand).toHaveBeenCalledTimes(2);
    expect(api.transportCommand.mock.calls.every(([request]) => request.action === "next")).toBe(true);
    expect(usePlayerStore.getState().playback?.currentItem?.uri).toBe("spotify:track:three");
  });

  it("keeps one early play choice and sends it once after the real state is connected", async () => {
    usePlayerStore.getState().setConnection("connecting");
    api.playUri.mockResolvedValue(state({ contextUri: "spotify:playlist:luft" }));
    playbackCommands.playUri("spotify:playlist:luft");
    expect(api.playUri).not.toHaveBeenCalled();

    usePlayerStore.getState().setConnection("online");
    expect(playbackCommands.flushDeferredIntent()).toBe(true);
    expect(playbackCommands.flushDeferredIntent()).toBe(false);
    await waitForPlaybackCommandsForTests();

    expect(api.playUri).toHaveBeenCalledOnce();
    expect(api.playUri).toHaveBeenCalledWith("spotify:playlist:luft");
  });

});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
