import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../src/features/command-palette/CommandPalette";
import { usePlayerStore } from "../src/stores/playerStore";
import { useUiStore } from "../src/stores/uiStore";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => { throw new Error("offline in tests"); }),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));

const send = vi.fn();
vi.mock("../src/features/playback/playbackCommands", () => ({
  playbackCommands: {
    send: (...args: unknown[]) => send(...args),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette />
        <LocationProbe />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path="/search" element={<div>search-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("command palette", () => {
  afterEach(() => {
    cleanup();
    send.mockReset();
  });

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    useUiStore.getState().setCommandPaletteOpen(true);
    usePlayerStore.getState().setPlayback({
      currentItem: {
        uri: "spotify:track:1",
        source: "spotify",
        itemType: "track",
        title: "Airborne",
        creators: [{ name: "Atlas" }],
        durationMs: 180_000,
        explicit: false,
        playable: true,
      },
      isPlaying: true,
      positionMs: 1000,
      durationMs: 180_000,
      volume: 0.7,
      isMuted: false,
      shuffleEnabled: false,
      repeatMode: "off",
      isSaved: false,
      updatedAt: new Date().toISOString(),
    });
    usePlayerStore.getState().setConnection("online");
  });

  it("shows the current track and runs pause from the catalog", async () => {
    renderPalette();

    expect(screen.getByRole("dialog", { name: /Suchen oder Befehl/ })).toBeVisible();
    expect(screen.getByText("Airborne")).toBeVisible();
    fireEvent.click(screen.getByRole("option", { name: /Pausieren/ }));

    expect(send).toHaveBeenCalledWith({ command: "pause" });
    await waitFor(() => {
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  it("moves the highlight with arrow keys and keeps it in view", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderPalette();

    const first = screen.getByRole("option", { name: /Pausieren/ });
    expect(first).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Nächster Titel/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("runs a typed volume directly and clears the query with the first Escape", async () => {
    renderPalette();
    const field = screen.getByRole("combobox");

    fireEvent.change(field, { target: { value: "zzqx" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(field).toHaveValue("");
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);

    fireEvent.change(field, { target: { value: "1:30" } });
    expect(screen.getByRole("option", { name: /Springe zu 1:30/ })).toHaveAttribute("aria-selected", "true");
  });

  it("turns a typed query into a Spotify search", async () => {
    renderPalette();

    const field = screen.getByRole("combobox");
    fireEvent.change(field, {
      target: { value: "night air" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Nach „night air“ suchen/ }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/search?q=night%20air");
    });
  });

  it("submits a typed query with Enter", async () => {
    renderPalette();

    const field = screen.getByRole("combobox");
    fireEvent.change(field, {
      target: { value: "night air" },
    });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/search?q=night%20air");
    });
  });
});
