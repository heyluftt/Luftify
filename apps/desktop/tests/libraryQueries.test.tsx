import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlbumArt } from "../src/components/AlbumArt";
import { usePlaylistLibrary } from "../src/features/library/libraryQueries";
import { desktopApi } from "../src/services/desktopApi";

vi.mock("../src/features/playback/usePlaybackEngine", () => ({ usePlaybackEngine: () => ({ localReady: true, engineReady: true, mockMode: false, localPhase: "ready", credentialsPresent: true }) }));

function Consumer({ name }: { name: string }) {
  const library = usePlaylistLibrary();
  return <span>{name}:{library.view.data?.items[0]?.name ?? "loading"}</span>;
}

describe("library queries", () => {
  afterEach(() => vi.restoreAllMocks());

  it("deduplicates simultaneous first-page requests", async () => {
    vi.spyOn(desktopApi, "cachedPlaylists").mockResolvedValue(null);
    const playlists = vi.spyOn(desktopApi, "playlists").mockResolvedValue({ items: [{ uri: "spotify:playlist:one", name: "One" }], offset: 0, limit: 50, total: 1, hasMore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Consumer name="a" /><Consumer name="b" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByText("a:One")).toBeInTheDocument());
    expect(screen.getByText("b:One")).toBeInTheDocument();
    expect(playlists).toHaveBeenCalledTimes(1);
  });

  it("does not block playlist metadata while a cover is pending", () => {
    vi.spyOn(desktopApi, "coverData").mockReturnValue(new Promise(() => undefined));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><article><AlbumArt title="One" image="https://i.scdn.co/image/test" /><strong>One</strong></article></QueryClientProvider>);
    expect(screen.getByText("One")).toBeVisible();
  });
});
