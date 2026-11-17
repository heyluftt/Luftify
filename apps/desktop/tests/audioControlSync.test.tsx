import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudioControlSync,
  DEFAULT_AUDIO_CONTROL_SETTINGS,
} from "../src/features/audio-control/audioControl";
import { DEFAULT_LYRICS_VISUAL_SETTINGS } from "../src/features/lyrics/lyricsVisualSettings";
import { volumeCoordinator } from "../src/features/playback/VolumeCommandCoordinator";
import { desktopApi } from "../src/services/desktopApi";
import { resetPlayerStore, usePlayerStore } from "../src/stores/playerStore";
import type { Settings } from "../src/types/tauri";

vi.mock("../src/features/playback/usePlaybackEngine", () => ({
  usePlaybackEngine: () => ({ localReady: true, engineReady: true, mockMode: false, localPhase: "ready", credentialsPresent: true }),
}));

describe("audio control startup sync", () => {
  beforeEach(() => {
    resetPlayerStore();
    volumeCoordinator.resetForTests();
    localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("waits for persisted settings before deciding whether to restore volume", async () => {
    const pending = deferred<Settings>();
    vi.spyOn(desktopApi, "settings").mockReturnValue(pending.promise);
    const restore = vi.spyOn(volumeCoordinator, "set").mockImplementation(() => undefined);
    // Restoring needs a remembered volume and the engine's reported one.
    localStorage.setItem("luft.audio-control.last-volume.v1", "0.8");
    usePlayerStore.getState().setConnection("online");
    usePlayerStore.getState().setPlayback({
      isPlaying: false, positionMs: 0, durationMs: 0, volume: 0.3, isMuted: false,
      shuffleEnabled: false, repeatMode: "off", isSaved: false, updatedAt: new Date().toISOString(),
    });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AudioControlSync />
      </QueryClientProvider>,
    );
    expect(restore).not.toHaveBeenCalled();

    pending.resolve(settingsWithRestore());
    await waitFor(() => expect(restore).toHaveBeenCalledOnce());
    expect(restore).toHaveBeenCalledWith(0.8);
  });
});

function settingsWithRestore(): Settings {
  return {
    theme: "dark",
    reconnectResumeMode: "ifWasPlaying",
    closeBehavior: "minimizeToTray",
    windowsAutostart: false,
    startInTrayOnAutostart: false,
    lastRoute: "/",
    searchHistoryEnabled: true,
    nowPlayingListNavigationEnabled: true,
    listeningAnalyticsEnabled: true,
    homeFeatureMode: "lastPlayed",
    homeFeaturePlaylistUri: null,
    lyricsEnabled: true,
    songVideosEnabled: false,
    experimentalLibreCanvas: false,
    lyricsVisuals: DEFAULT_LYRICS_VISUAL_SETTINGS,
    audioControl: {
      ...DEFAULT_AUDIO_CONTROL_SETTINGS,
      restoreOnStart: true,
    },
    miniplayer: { scale: 1, opacityPercent: 94, alwaysOnTop: true, clickThrough: false, positionX: null, positionY: null },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
