import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackState } from "@luft/protocol-types";
import {
  resetPlaybackEventSubscriptionForTests,
  resyncPlayback,
  retainPlaybackEvents,
} from "../src/features/playback/playbackEvents";
import { playbackCommands } from "../src/features/playback/playbackCommands";
import { resetPlaybackCommandsForTests } from "../src/features/playback/playbackCommands";
import { invalidatePlaybackStateLoader } from "../src/features/playback/playbackStateLoader";
import { desktopApi } from "../src/services/desktopApi";
import { resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";
import { DEFAULT_AUDIO_CONTROL_SETTINGS } from "../src/features/audio-control/audioControl";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../src/features/lyrics/lyricsVisualSettings";
import type { Settings } from "../src/types/tauri";

const playback = (overrides: Partial<PlaybackState> = {}): PlaybackState => ({
  currentItem: { uri: "spotify:track:one", source: "spotify", itemType: "track", title: "One", creators: [{ name: "Artist" }], durationMs: 200_000, explicit: false, playable: true },
  isPlaying: true, positionMs: 10_000, durationMs: 200_000, volume: 0.7, isMuted: false,
  shuffleEnabled: false, repeatMode: "off", isSaved: false, updatedAt: "2026-07-16T12:00:00.000Z",
  ...overrides,
});

const settings = (reconnectResumeMode: Settings["reconnectResumeMode"]): Settings => ({
  theme: "dark", reconnectResumeMode, closeBehavior: "minimizeToTray",
  windowsAutostart: false, startInTrayOnAutostart: false, lastRoute: "/", searchHistoryEnabled: true,
  nowPlayingListNavigationEnabled: true, listeningAnalyticsEnabled: true,
  homeFeatureMode: "lastPlayed", homeFeaturePlaylistUri: null,
  lyricsEnabled: true, songVideosEnabled: false, experimentalLibreCanvas: false,
  lyricsVisuals: DEFAULT_LYRICS_VISUAL_SETTINGS,
  audioControl: DEFAULT_AUDIO_CONTROL_SETTINGS,
  miniplayer: { scale: 1, opacityPercent: 94, alwaysOnTop: true, clickThrough: false, positionX: null, positionY: null },
});

const eventApi = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: eventApi.listen }));

describe("playback event subscription", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    resetPlaybackEventSubscriptionForTests();
    eventApi.listen.mockReset();
    eventApi.listen.mockImplementation(() => Promise.resolve(vi.fn()));
    resetPlaybackCommandsForTests();
    resetPlayerStore();
  });

  it("registers only one listener set for multiple consumers and removes it exactly once", async () => {
    const releaseFirst = retainPlaybackEvents();
    const releaseSecond = retainPlaybackEvents();
    await flush();
    expect(eventApi.listen).toHaveBeenCalledTimes(7);
    const unlisteners = await Promise.all(eventApi.listen.mock.results.map((result) => result.value));
    releaseFirst();
    expect(unlisteners.every((unlisten) => !unlisten.mock.calls.length)).toBe(true);
    releaseSecond();
    expect(unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

  it("still releases successful listeners when one registration fails", async () => {
    const unlisteners = Array.from({ length: 6 }, () => vi.fn());
    let resolved = 0;
    eventApi.listen.mockImplementation(() => {
      const index = eventApi.listen.mock.calls.length - 1;
      return index === 3
        ? Promise.reject(new Error("listener unavailable"))
        : Promise.resolve(unlisteners[resolved++]!);
    });

    const release = retainPlaybackEvents();
    await flush();
    release();

    expect(unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

  it("a lost session freezes playback and ignores late state events", async () => {
    usePlayerStore.getState().setPlayback(playback({ positionMs: 21_000, isPlaying: true }));
    usePlayerStore.getState().setConnection("online");
    retainPlaybackEvents();
    await flush();
    usePlayerStore.getState().disconnect();
    expect(usePlayerStore.getState().playback).toMatchObject({ positionMs: 21_000, isPlaying: false });
    expect(usePlayerStore.getState().connection).toBe("offline");

    emit("player://state-changed", playback({ positionMs: 42_000, isPlaying: true }));
    expect(usePlayerStore.getState().playback).toMatchObject({ positionMs: 21_000, isPlaying: false });
  });

  it("resync loads the real state before one allowed resume attempt", async () => {
    usePlayerStore.getState().setPlayback(playback({ positionMs: 21_000, isPlaying: true }));
    usePlayerStore.getState().setConnection("online");
    usePlayerStore.getState().disconnect();
    const actual = playback({ positionMs: 2_000, isPlaying: false });
    vi.spyOn(desktopApi, "playbackState").mockResolvedValue(actual);
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings("ifWasPlaying"));
    const resume = vi.spyOn(playbackCommands, "resume").mockImplementation(() => undefined);
    await resyncPlayback("engine-ready");
    expect(resume).toHaveBeenCalledOnce();
    expect(desktopApi.playbackState).toHaveBeenCalledBefore(resume);
    expect(usePlayerStore.getState().connection).toBe("online");
    await resyncPlayback("engine-ready");
    expect(resume).toHaveBeenCalledOnce();
  });

  it("starts a fresh state sync when the session returns before an old sync settles", async () => {
    let rejectStale!: (reason: Error) => void;
    const staleRequest = new Promise<PlaybackState>((_resolve, reject) => {
      rejectStale = reject;
    });
    const freshState = playback({
      currentItem: {
        uri: "spotify:track:fresh",
        source: "spotify",
        itemType: "track",
        title: "Fresh",
        creators: [{ name: "Artist" }],
        durationMs: 210_000,
        explicit: false,
        playable: true,
      },
      positionMs: 3_000,
      durationMs: 210_000,
    });
    vi.spyOn(desktopApi, "playbackState")
      .mockReturnValueOnce(staleRequest)
      .mockResolvedValueOnce(freshState);

    void resyncPlayback("engine-ready");
    await vi.waitFor(() => expect(desktopApi.playbackState).toHaveBeenCalledOnce());

    // PlaybackSync does this when the Libre session drops and returns.
    usePlayerStore.getState().disconnect();
    invalidatePlaybackStateLoader();
    void resyncPlayback("engine-ready");

    await vi.waitFor(() => expect(desktopApi.playbackState).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(usePlayerStore.getState()).toMatchObject({
      connection: "online",
      playback: { currentItem: { uri: "spotify:track:fresh" } },
    }));

    rejectStale(new Error("stale connection closed"));
    await flush();
    expect(usePlayerStore.getState()).toMatchObject({
      connection: "online",
      playback: { currentItem: { uri: "spotify:track:fresh" } },
    });
  });

  it("retries a transient full-state failure while the same connection epoch stays", async () => {
    const freshState = playback({ positionMs: 6_000, isPlaying: false });
    vi.spyOn(desktopApi, "playbackState")
      .mockRejectedValueOnce(new Error("Libre session is warming up"))
      .mockResolvedValueOnce(freshState);

    await resyncPlayback("startup");

    expect(desktopApi.playbackState).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState()).toMatchObject({
      connection: "online",
      playback: { positionMs: 6_000, isPlaying: false },
    });
  });

  it("never-resume setting blocks automatic playback", async () => {
    usePlayerStore.getState().setPlayback(playback({ isPlaying: true }));
    usePlayerStore.getState().setConnection("online");
    usePlayerStore.getState().disconnect();
    vi.spyOn(desktopApi, "playbackState").mockResolvedValue(playback({ isPlaying: false }));
    vi.spyOn(desktopApi, "settings").mockResolvedValue(settings("never"));
    const resume = vi.spyOn(playbackCommands, "resume").mockImplementation(() => undefined);
    await resyncPlayback("engine-ready");
    expect(desktopApi.settings).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
  });

  it("loads the real state before flushing one early playlist click", async () => {
    usePlayerStore.getState().setConnection("connecting");
    vi.spyOn(desktopApi, "playbackState").mockResolvedValue(playback({ isPlaying: false }));
    const playUri = vi.spyOn(desktopApi, "playUri").mockResolvedValue(playback({
      contextUri: "spotify:playlist:luft",
      isPlaying: true,
    }));
    playbackCommands.playUri("spotify:playlist:luft");
    await resyncPlayback("engine-ready");

    await vi.waitFor(() => expect(playUri).toHaveBeenCalledOnce());
    expect(desktopApi.playbackState).toHaveBeenCalledBefore(playUri);
  });
});

function emit(name: string, payload: unknown): void {
  const call = eventApi.listen.mock.calls.find(([eventName]) => eventName === name);
  if (!call) throw new Error(`listener missing: ${name}`);
  call[1]({ payload });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
