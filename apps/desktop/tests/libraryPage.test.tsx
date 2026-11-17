import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaylistsSection } from "../src/features/library/PlaylistsSection";
import { SavedTracksSection } from "../src/features/library/SavedTracksSection";

vi.mock("../src/components/AlbumArt", () => ({
  AlbumArt: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock("../src/components/TrackList", () => ({
  TrackList: ({ tracks }: { tracks: Array<{ title: string }> }) => (
    <ul>{tracks.map((track) => <li key={track.title}>{track.title}</li>)}</ul>
  ),
}));

const playlistPage = {
  items: [
    { uri: "spotify:playlist:night", name: "Nachtfahrt", subtitle: "Eigene Playlist" },
    { uri: "spotify:playlist:morning", name: "Morning Mix", subtitle: "Spotify" },
  ],
  offset: 0,
  limit: 50,
  total: 2,
  hasMore: false,
};

describe("library page sections", () => {
  afterEach(() => cleanup());

  it("filters playlists locally and can play a visible card", () => {
    const onPlay = vi.fn();
    render(
      <PlaylistsSection
        data={playlistPage}
        phase="ready"
        hasNextPage={false}
        pending={false}
        onLoadMore={() => undefined}
        onOpenPlaylist={() => undefined}
        onPlayPlaylist={onPlay}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Filtern"), {
      target: { value: "nacht" },
    });
    expect(screen.getByText("1 von 2 Playlists")).toBeVisible();
    expect(screen.getByRole("button", { name: "Nachtfahrt öffnen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Morning Mix öffnen" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nachtfahrt abspielen" }));
    expect(onPlay).toHaveBeenCalledWith(playlistPage.items[0]);

    fireEvent.click(screen.getByRole("combobox", { name: "Playlists sortieren" }));
    fireEvent.click(screen.getByRole("option", { name: "Name A–Z" }));
    fireEvent.change(screen.getByPlaceholderText("Filtern"), {
      target: { value: "" },
    });
    const openButtons = screen.getAllByRole("button", { name: /öffnen$/ });
    expect(openButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Morning Mix öffnen",
      "Nachtfahrt öffnen",
    ]);
  });

  it("remembers the owner filter when the page is opened again", () => {
    const page = {
      ...playlistPage,
      items: [
        { ...playlistPage.items[0]!, library: { owner: "me" as const } },
        { ...playlistPage.items[1]!, library: { owner: "spotify" as const } },
      ],
    };
    const section = () => (
      <PlaylistsSection
        data={page}
        phase="ready"
        hasNextPage={false}
        pending={false}
        onLoadMore={() => undefined}
        onOpenPlaylist={() => undefined}
        onPlayPlaylist={() => undefined}
      />
    );
    const { unmount } = render(section());
    fireEvent.click(screen.getByRole("button", { name: /^Eigene/ }));
    unmount();

    render(section());
    expect(screen.getByRole("button", { name: /^Eigene/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Morning Mix öffnen" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Alle/ }));
  });

  it("hides the saved-track count while the list is still loading", () => {
    render(
      <SavedTracksSection
        data={undefined}
        tracks={[]}
        phase="loading-library"
        hasNextPage={false}
        pending={false}
        onLoadMore={() => undefined}
        onPlay={() => undefined}
        onQueue={() => undefined}
        onSavedChange={() => undefined}
      />,
    );
    expect(screen.queryByText(/^\d+ Titel$/)).not.toBeInTheDocument();
    expect(screen.getByText("Bibliothek wird geladen …")).toBeVisible();
  });
});
