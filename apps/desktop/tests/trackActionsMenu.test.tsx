import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackActionsMenu } from "../src/components/track-actions/TrackActionsMenu";
import { desktopApi } from "../src/services/desktopApi";
import { usePlayerStore } from "../src/stores/playerStore";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const track = {
  uri: "spotify:track:airborne",
  source: "spotify" as const,
  itemType: "track" as const,
  title: "Airborne",
  creators: [{ name: "Atlas", uri: "spotify:artist:atlas" }],
  albumName: "Glass Cities",
  albumUri: "spotify:album:glass",
  durationMs: 185_000,
  explicit: false,
  playable: true,
};

function renderMenu(
  extras: Partial<ComponentProps<typeof TrackActionsMenu>> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrackActionsMenu
          track={track}
          position={{ x: 80, y: 80 }}
          initialView="actions"
          canQueue
          saved={false}
          onSavedChange={undefined}
          onClose={vi.fn()}
          {...extras}
        />
        <LocationProbe />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path="/album/:uri" element={<div>album</div>} />
          <Route path="/artist/:uri" element={<div>artist</div>} />
          <Route path="/lyrics" element={<div>lyrics</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("track actions menu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    usePlayerStore.getState().setConnection("online");
    vi.spyOn(desktopApi, "connectionInfo").mockResolvedValue({
      mockMode: true,
      startup: { phase: "ready", elapsedMs: 0, sequence: 1 },
    });
  });

  it("offers share, credits and in-app destinations", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderMenu();

    expect(await screen.findByRole("button", { name: "Teilen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Abspielen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mitwirkende anzeigen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zum Album" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zum Künstler" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Songtext öffnen" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Teilen" }));
    fireEvent.click(await screen.findByRole("button", { name: "Link kopieren" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://open.spotify.com/track/airborne");
    });
    expect(screen.getByText("Link kopiert.")).toBeVisible();
  });

  it("opens credits and jumps to the artist page", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    fireEvent.click(await screen.findByRole("button", { name: "Mitwirkende anzeigen" }));
    expect(screen.getByText("Glass Cities")).toBeVisible();
    expect(screen.getByText("3:05")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Atlas/ }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/artist/spotify%3Aartist%3Aatlas",
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("marks playlist removal as a destructive action", async () => {
    renderMenu({ onRemoveFromPlaylist: vi.fn() });

    expect(
      await screen.findByRole("button", { name: "Aus Playlist entfernen" }),
    ).toHaveClass("track-actions-danger");
  });
});
