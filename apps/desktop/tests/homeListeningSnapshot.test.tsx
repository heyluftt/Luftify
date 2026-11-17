import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { HomeListeningSnapshot } from "../src/features/home/HomeListeningSnapshot";
import type { ListeningOverview } from "../src/features/analytics/analyticsTypes";

const overview: ListeningOverview = {
  fromUnixMs: 0,
  toUnixMs: 1,
  totalListeningMs: 5_400_000,
  sessionCount: 4,
  qualifiedPlayCount: 12,
  completedPlayCount: 8,
  uniqueTrackCount: 9,
  uniqueArtistCount: 6,
  uniquePlaylistCount: 3,
  topTracks: [{
    track: {
      uri: "spotify:track:1",
      itemType: "track",
      title: "Nordlicht",
      creators: [{ name: "Luft" }],
    },
    listeningMs: 900_000,
    sessionCount: 2,
    playCount: 3,
    completedCount: 2,
    lastPlayedAtMs: 1,
  }],
  topArtists: [],
  topPlaylists: [],
  dailyActivity: [],
  behavior: {
    averageSessionMs: 1,
    longestSessionMs: 1,
    skipCount: 0,
    seekCount: 0,
    pauseCount: 0,
    repeatCount: 0,
    activeDayCount: 2,
    completionRate: 0.5,
  },
};

describe("home listening snapshot", () => {
  it("shows real weekly metrics and the top track", () => {
    renderWithQueryClient(
      <HomeListeningSnapshot
        enabled
        error={false}
        loading={false}
        overview={overview}
        onOpen={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );

    expect(screen.getByText("1 Std. 30 Min.")).toBeVisible();
    expect(screen.getByText("Nordlicht")).toBeVisible();
    expect(screen.getByText("Luft")).toBeVisible();
  });

  it("starts the weekly top track from the highlight", () => {
    const onPlayTrack = vi.fn();
    renderWithQueryClient(
      <HomeListeningSnapshot
        enabled
        error={false}
        loading={false}
        overview={overview}
        onOpen={() => undefined}
        onOpenSettings={() => undefined}
        onPlayTrack={onPlayTrack}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Nordlicht/ }));
    expect(onPlayTrack).toHaveBeenCalledWith(overview.topTracks[0]?.track);
  });

  it("links to settings when local analytics are disabled", () => {
    const onOpenSettings = vi.fn();
    renderWithQueryClient(
      <HomeListeningSnapshot
        enabled={false}
        error={false}
        loading={false}
        overview={undefined}
        onOpen={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Einstellungen öffnen/ }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

function renderWithQueryClient(element: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {element}
    </QueryClientProvider>,
  );
}
