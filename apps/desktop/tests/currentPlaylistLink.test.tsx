import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentPlaylistLink } from "../src/features/playback/CurrentPlaylistLink";
import type { Settings } from "../src/types/tauri";

vi.mock("../src/features/playback/usePlaybackPlaylistContext", () => ({
  usePlaybackPlaylistContext: () => ({
    uri: "spotify:playlist:focus-test",
    name: "Focus Test",
  }),
}));

const PLAYLIST_PATH = "/playlist/spotify%3Aplaylist%3Afocus-test";

afterEach(cleanup);

describe("CurrentPlaylistLink", () => {
  it("opens the playlist with a repeatable current-track focus request", () => {
    renderLink(true, "/");

    fireEvent.click(screen.getByRole("button", {
      name: /und zum aktuellen Titel/,
    }));

    const probe = screen.getByTestId("location");
    expect(probe.dataset.path).toBe(PLAYLIST_PATH);
    expect(probe.dataset.type).toBe("PUSH");
    const query = new URLSearchParams(probe.dataset.search);
    expect(query.get("nowPlaying")).toBe("spotify:track:current");
    expect(query.get("focusRequest")).toBeTruthy();
  });

  it("replaces the entry when already on the playlist, so Back leaves it", () => {
    renderLink(true, PLAYLIST_PATH);

    fireEvent.click(screen.getByRole("button", { name: /und zum aktuellen Titel/ }));

    expect(screen.getByTestId("location").dataset.type).toBe("REPLACE");
  });

  it("only opens the playlist when the preference is disabled", () => {
    renderLink(false, "/");

    fireEvent.click(screen.getByRole("button", {
      name: "Zur Playlist „Focus Test“",
    }));

    const probe = screen.getByTestId("location");
    expect(probe.dataset.path).toBe(PLAYLIST_PATH);
    expect(probe.dataset.search).toBe("");
  });
});

function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return <span data-testid="location" data-path={location.pathname} data-search={location.search} data-type={type} />;
}

function renderLink(enabled: boolean, initialPath: string) {
  const client = new QueryClient();
  client.setQueryData(["settings"], {
    nowPlayingListNavigationEnabled: enabled,
  } as Settings);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CurrentPlaylistLink
          connected
          contextUri="spotify:playlist:focus-test"
          currentTrackUri="spotify:track:current"
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
