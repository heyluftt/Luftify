import type { MediaItem } from "@luft/protocol-types";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackList } from "../src/components/TrackList";
import { usePlayerStore } from "../src/stores/playerStore";
import type { Settings } from "../src/types/tauri";

afterEach(cleanup);

const TRACK: MediaItem = {
  uri: "spotify:track:in-my-room",
  source: "spotify",
  itemType: "track",
  title: "In My Room",
  creators: [{
    name: "Julia Wolf",
    uri: "spotify:artist:julia-wolf",
  }],
  albumName: "Girls in Purgatory",
  durationMs: 163_000,
  explicit: false,
  playable: true,
};

function renderTrackList(
  tracks: MediaItem[],
  navigationEnabled = true,
  focusRequest?: { trackUri: string; requestId: string },
) {
  const client = new QueryClient();
  client.setQueryData(["settings"], {
    nowPlayingListNavigationEnabled: navigationEnabled,
  } as Settings);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrackList
          tracks={tracks}
          onPlay={vi.fn()}
          showActions={false}
          focusRequest={focusRequest}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TrackList Wiedergabezahlen", () => {
  it("zeigt echte Spotify-Werte deutsch formatiert", () => {
    renderTrackList([{ ...TRACK, playCount: 222_793_148 }]);

    expect(screen.getByText("Wiedergaben")).toBeVisible();
    expect(screen.getByText("222.793.148")).toBeVisible();
  });

  it("lässt die Spalte ohne gelieferten Spotify-Wert weg", () => {
    renderTrackList([TRACK]);

    expect(screen.queryByText("Wiedergaben")).not.toBeInTheDocument();
  });

  it("hebt den aktuell laufenden Titel optional hervor", () => {
    usePlayerStore.getState().setPlayback({
      currentItem: TRACK,
      isPlaying: true,
      positionMs: 1_000,
      durationMs: TRACK.durationMs ?? 0,
      volume: 0.7,
      isMuted: false,
      shuffleEnabled: false,
      repeatMode: "off",
      isSaved: false,
      updatedAt: new Date().toISOString(),
    });

    const enabled = renderTrackList([TRACK]);
    expect(screen.getByRole("row", { current: true }))
      .toHaveClass("is-current-track");
    const playback = usePlayerStore.getState().playback!;
    act(() => usePlayerStore.getState().setPlayback({
      ...playback,
      currentItem: { ...TRACK, uri: "spotify:track:regional-version" },
    }));
    // The permanent mark also resolves a relink, without a focus request/flash.
    expect(screen.getByRole("row", { current: true }))
      .toHaveClass("is-current-track");
    expect(screen.getByRole("row", { current: true }))
      .not.toHaveClass("is-focus-flash");
    act(() => usePlayerStore.getState().setPlayback({
      ...playback,
      currentItem: {
        ...TRACK,
        uri: "spotify:track:another-song",
        creators: [{ name: "Another artist" }],
      },
    }));
    expect(screen.queryByRole("row", { current: true })).not.toBeInTheDocument();
    act(() => usePlayerStore.getState().setPlayback(playback));
    enabled.unmount();

    renderTrackList([TRACK], false);
    expect(screen.queryByRole("row", { current: true }))
      .not.toBeInTheDocument();
  });

  it("scrollt bei einem Playlist-Sprung zur angeforderten Titelzeile", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    renderTrackList([TRACK], true, {
      trackUri: TRACK.uri,
      requestId: "focus-1",
    });

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });
});
