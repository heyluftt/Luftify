import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerBar } from "../src/features/playback/PlayerBar";
import { usePlayerStore } from "../src/stores/playerStore";
import { useUiStore } from "../src/stores/uiStore";
import { desktopApi } from "../src/services/desktopApi";
import type { AudioControlSettings } from "../src/types/tauri";
import "../src/styles/index.css";

const command = vi.fn();
const beginSeek = vi.fn();
const previewSeek = vi.fn();
const commitSeek = vi.fn();
let pendingControls = { seek: null, shuffle: null, repeat: null, volume: null } as { seek: number | null; shuffle: number | null; repeat: number | null; volume: number | null };
let transportPending = { count: 0, activeAction: undefined as "next" | "previous" | undefined };
let connected = true;
let audioEnabled = true;
vi.mock("../src/features/audio-control/audioControl", () => ({
  useAudioControlSettings: () => ({ enabled: audioEnabled, presets: [20, 40, 60, 80, 100], stepPercent: 5, wheelEnabled: true, restoreOnStart: false, rememberBeforeMute: true, showPercentage: true, curve: "linear", shortcutsEnabled: true, volumeUpShortcut: "Ctrl+ArrowUp", volumeDownShortcut: "Ctrl+ArrowDown", muteShortcut: "Ctrl+M",
    dsp: { enabled: false, presetId: "flat", volumeBoostEnabled: false, volumeBoostDb: 0, spatial: { enabled: false, presetId: "off" } } }),
  uiToSpotify: (value: number) => value,
  spotifyToUi: (value: number) => value,
  mappedVolume: (value: number) => ({ uiValue: value, spotifyValue: value, curve: "linear" }),
  setUiVolume: vi.fn(),
  setAudioPreset: vi.fn(),
  setRuntimeAudioControlSettings: vi.fn(),
  effectiveDsp: (settings: AudioControlSettings) => settings.dsp,
}));
vi.mock("../src/features/spotify/useEngineCapability", () => ({
  useEngineCapability: () => true,
  useOptionalCapability: () => ({ show: true, enabled: true }),
}));
vi.mock("../src/features/playback/usePlayback", () => ({ usePlayback: () => ({
  playback: usePlayerStore.getState().playback,
  command,
  isError: false,
  connected,
  connection: connected ? "online" : "offline",
  transportPending,
  pending: pendingControls,
  seek: { status: { phase: "idle", generation: 1 }, begin: beginSeek, preview: previewSeek, commit: commitSeek },
}) }));

describe("PlayerBar", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  beforeEach(() => {
    command.mockClear();
    beginSeek.mockClear();
    previewSeek.mockClear();
    commitSeek.mockClear();
    pendingControls = { seek: null, shuffle: null, repeat: null, volume: null };
    transportPending = { count: 0, activeAction: undefined };
    connected = true;
    audioEnabled = true;
    window.localStorage.removeItem("luftplayer.layout.v1");
    useUiStore.setState({ playerBarCollapsed: false });
    usePlayerStore.getState().setPlayback({ currentItem: { uri: "mock:1", source: "spotify", itemType: "track", title: "Airborne", creators: [{ name: "Nocturne Atlas" }], durationMs: 200000, explicit: false, playable: true }, isPlaying: true, positionMs: 1000, durationMs: 200000, volume: .7, isMuted: false, shuffleEnabled: false, repeatMode: "off", isSaved: false, updatedAt: new Date().toISOString() });
  });

  it("marks lyrics as the current extras target", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/lyrics"]}><PlayerBar /></MemoryRouter></QueryClientProvider>);
    const extrasLyrics = screen.getByRole("button", { name: "Songtexte öffnen" });
    expect(extrasLyrics).toHaveClass("active");
    expect(extrasLyrics).toHaveAttribute("aria-current", "page");
  });

  it("opens lyrics from the cover and the album from the title", () => {
    usePlayerStore.getState().setPlayback({
      ...usePlayerStore.getState().playback!,
      currentItem: {
        ...usePlayerStore.getState().playback!.currentItem!,
        albumUri: "spotify:album:glass",
        albumName: "Glass",
      },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PlayerBar />
          <LocationProbe />
          <Routes>
            <Route path="/lyrics" element={<div>lyrics-page</div>} />
            <Route path="/album/:uri" element={<div>album-page</div>} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Songtextansicht öffnen" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/lyrics");

    fireEvent.click(screen.getByRole("button", { name: "Airborne" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/album/${encodeURIComponent("spotify:album:glass")}`);
  });

  it("sends a typed toggle command", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(command).toHaveBeenCalledWith({ command: "pause" });
    expect(screen.getByText("Airborne")).toBeInTheDocument();
  });

  it("collapses into a compact rail and remembers the preference", async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Wiedergabeleiste einklappen" }));

    expect(screen.getByLabelText("Wiedergabesteuerung")).toHaveClass("is-collapsed");
    // The toggle and the whole collapsed summary both expand; only the toggle reports state.
    expect(screen.getAllByRole("button", { name: "Wiedergabeleiste ausklappen" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Wiedergabeleiste ausklappen", expanded: false }))
      .toHaveClass("playerbar-collapse-toggle");
    await waitFor(() => {
      expect(localStorage.getItem("luftplayer.layout.v1"))
        .toContain('"playerBarCollapsed":true');
    });
    const summary = document.querySelector(".playerbar-collapsed-summary");
    expect(summary).toHaveTextContent("Airborne");
    expect(summary).toHaveTextContent("Nocturne Atlas");
    expect(summary?.querySelector("button")).toBeNull();
  });

  it("marks shuffle and repeat as pressed when they are on", () => {
    usePlayerStore.getState().setPlayback({
      ...usePlayerStore.getState().playback!,
      shuffleEnabled: true,
      repeatMode: "one",
      isSaved: true,
    });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);

    const shuffle = screen.getByRole("button", { name: "Zufallswiedergabe" });
    const repeat = screen.getByRole("button", { name: "Wiederholen: dieser Titel" });
    expect(shuffle).toHaveAttribute("aria-pressed", "true");
    expect(shuffle).toHaveClass("active");
    expect(repeat).toHaveAttribute("aria-pressed", "true");
    expect(repeat).toHaveAttribute("data-repeat", "one");
    expect(repeat).toHaveClass("active");
    expect(screen.getByRole("button", { name: "Aus Lieblingssongs entfernen" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("sends explicit and independent shuffle and repeat targets", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Zufallswiedergabe" }));
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen: aus" }));
    expect(command).toHaveBeenNthCalledWith(1, { command: "setShuffle", enabled: true });
    expect(command).toHaveBeenNthCalledWith(2, { command: "setRepeat", repeatMode: "all" });
  });

  it("keeps skipping possible while the current title is still transitioning", () => {
    transportPending = { count: 1, activeAction: "next" };
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);

    const previous = screen.getByRole("button", { name: "Vorheriger Titel" });
    const next = screen.getByRole("button", { name: "Nächster Titel" });
    expect(previous).not.toBeDisabled();
    expect(next).not.toBeDisabled();
    expect(next).toHaveAttribute("aria-busy", "true");
    fireEvent.click(next);
    expect(command).toHaveBeenCalledWith({ command: "next" });
  });

  it("previews seek locally and commits only on release", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    const slider = screen.getByRole("slider", { name: "Fortschritt" });
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "80000" } });
    expect(beginSeek).toHaveBeenCalled();
    expect(previewSeek).toHaveBeenCalledWith(80_000);
    expect(commitSeek).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(commitSeek).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalledWith(expect.objectContaining({ command: "seek" }));
  });

  it("keeps a pointer cursor while native shuffle and repeat locks block extra commands", () => {
    pendingControls = { seek: null, shuffle: 1, repeat: 2, volume: null };
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    const shuffle = screen.getByRole("button", { name: "Zufallswiedergabe" });
    const repeat = screen.getByRole("button", { name: "Wiederholen: aus" });
    expect(shuffle).toBeDisabled();
    expect(repeat).toBeDisabled();
    expect(getComputedStyle(shuffle).cursor).toBe("pointer");
    expect(getComputedStyle(repeat).cursor).toBe("pointer");
    fireEvent.click(shuffle);
    fireEvent.click(repeat);
    fireEvent.click(shuffle);
    fireEvent.click(repeat);
    expect(command).not.toHaveBeenCalled();
  });

  it("stops progress interpolation at the confirmed position after disconnect", async () => {
    vi.useFakeTimers();
    const view = render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    const slider = screen.getByRole("slider", { name: "Fortschritt" }) as HTMLInputElement;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(Number(slider.value)).toBeGreaterThan(1_000);
    usePlayerStore.getState().setConnection("online");
    usePlayerStore.getState().disconnect();
    connected = false;
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    await vi.advanceTimersByTimeAsync(0);
    expect(Number(slider.value)).toBe(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(Number(slider.value)).toBe(1_000);
    vi.useRealTimers();
  });

  it("keeps the core volume slider when Audio Control is disabled", () => {
    audioEnabled = false;
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("slider", { name: "Lautstärke" })).toBeEnabled();
    // Mute lives in the audio quick settings popover.
    fireEvent.click(screen.getByRole("button", { name: "Audio-Quicksettings" }));
    expect(screen.getByRole("button", { name: "Stummschalten" })).toBeEnabled();
  });

  it("does not disable the volume slider while a value is being confirmed", () => {
    pendingControls = { seek: null, shuffle: null, repeat: null, volume: 7 };
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);
    const slider = screen.getByRole("slider", { name: "Lautstärke" });
    expect(slider).toBeEnabled();
    expect(getComputedStyle(slider).cursor).toBe("pointer");
  });

  it.each([
    ["EQ-Preset", "Warm", "warm"],
    ["Raum-Presets", "Studio", "studio"],
  ])("keeps the audio popover open while choosing %s", async (label, name, presetId) => {
    const user = userEvent.setup();
    vi.spyOn(desktopApi, "previewDspSettings").mockResolvedValue();
    const save = vi.spyOn(desktopApi, "saveDspSettings").mockResolvedValue();
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><PlayerBar /></MemoryRouter></QueryClientProvider>);

    await user.click(screen.getByRole("button", { name: "Audio-Quicksettings" }));
    const trigger = screen.getByRole("combobox", { name: label });
    await user.click(trigger);
    const list = screen.getByRole("listbox", { name: label });
    // Its options are portalled outside the audio popover's DOM subtree.
    expect(screen.getByRole("dialog")).not.toContainElement(list);
    fireEvent.scroll(list);
    await user.click(screen.getByRole("option", { name }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0]![0];
    expect(label === "EQ-Preset" ? saved.presetId : saved.spatial.presetId).toBe(presetId);
    expect(screen.getByRole("dialog", { name: "Audio-Schnelleinstellungen" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}
