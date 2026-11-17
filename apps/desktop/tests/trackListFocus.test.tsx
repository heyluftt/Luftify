import type { MediaItem } from "@luft/protocol-types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { TrackList } from "../src/components/TrackList";

const virtualizer = vi.hoisted(() => ({
  getTotalSize: () => 6_200,
  getVirtualItems: () => [],
  scrollToIndex: vi.fn((index: number) => {
    document.querySelector<HTMLElement>(".page-scroll")!.scrollTop = index * 62;
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => virtualizer,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const tracks: MediaItem[] = Array.from({ length: 100 }, (_, index) => ({
  uri: `spotify:track:${index}`,
  source: "spotify",
  itemType: "track",
  title: `Track ${index}`,
  creators: [],
  explicit: false,
  playable: true,
}));

function PlaylistWithNavigationReset({ items = tracks }: { items?: MediaItem[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState(0);
  // AppShell resets scroll on query navigation after the child's effects.
  useEffect(() => {
    scroller.current!.scrollTop = 0;
  }, [request]);
  return (
    <div ref={scroller} className="page-scroll" data-testid="scroller">
      <button onClick={() => setRequest((value) => value + 1)}>Jump</button>
      <TrackList
        tracks={items}
        onPlay={vi.fn()}
        showActions={false}
        focusRequest={request ? {
          trackUri: tracks[90]!.uri,
          requestId: String(request),
        } : undefined}
      />
    </div>
  );
}

it("keeps repeated track jumps after the navigation reset in an open virtual playlist", async () => {
  const client = new QueryClient();
  client.setQueryData(["settings"], { nowPlayingListNavigationEnabled: true });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PlaylistWithNavigationReset /></MemoryRouter>
    </QueryClientProvider>,
  );

  for (let request = 1; request <= 2; request += 1) {
    screen.getByTestId("scroller").scrollTop = 300;
    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    await waitFor(() => {
      expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(request);
      expect(screen.getByTestId("scroller").scrollTop).toBe(90 * 62);
    });
  }
  expect(virtualizer.scrollToIndex).toHaveBeenLastCalledWith(90, { align: "center" });
});

it("follows a track moved by refreshed data until the user scrolls, then allows a fresh jump", async () => {
  const client = new QueryClient();
  client.setQueryData(["settings"], { nowPlayingListNavigationEnabled: true });
  const view = (items: MediaItem[]) => (
    <QueryClientProvider client={client}>
      <MemoryRouter><PlaylistWithNavigationReset items={items} /></MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view(tracks));
  fireEvent.click(screen.getByRole("button", { name: "Jump" }));
  await waitFor(() => expect(virtualizer.scrollToIndex).toHaveBeenLastCalledWith(90, { align: "center" }));

  // Same count, but a new sorted snapshot moves the target from 90 to 9.
  rerender(view([...tracks].reverse()));
  await waitFor(() => expect(virtualizer.scrollToIndex).toHaveBeenLastCalledWith(9, { align: "center" }));

  fireEvent.wheel(screen.getByTestId("scroller"), { deltaY: 200 });
  screen.getByTestId("scroller").scrollTop = 758;
  rerender(view(tracks));
  // Flush a frame so an unwanted scheduled correction would be observed.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("scroller").scrollTop).toBe(758);

  fireEvent.click(screen.getByRole("button", { name: "Jump" }));
  await waitFor(() => expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(3));
  expect(virtualizer.scrollToIndex).toHaveBeenLastCalledWith(90, { align: "center" });
});
